import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium, type Browser } from '@playwright/test'
import { storyboardDuration } from '../core/storyboard'
import { FORMATS, FORMAT_SIZE } from '../core/types'
import type { AuditIssue } from '../runtime/audit'
import type {} from '../runtime/mba-api'
import { worldColours } from '../core/worlds'
import { defaultGraySize, frameIndexAt, grayFrames, meanColors, probeVideo, stillsAt } from './frames'
import {
  ANALYSIS_FPS,
  STRIP_FRAMES,
  blankRuns,
  blockMotionSeries,
  emptyFrames,
  hexToRgb,
  type BlankRun,
  type RGB,
  eventTimes,
  fastestMoments,
  PACE,
  nearBlank,
  paceOf,
  staticRuns,
  stripWindow,
} from './metrics'
import { loadStoryboardFile, openRenderPage, renderVideo } from './render'
import { SHEET_PAGE_TILES, composeSheet, composeSheetPages, removeSheetPages, timeLabel, type SheetImage } from './sheets'

/**
 * `mba review`: the review kit a critic judges a video from, built from the rendered MP4 (what the
 * viewer sees), plus the in-page text audit when a storyboard is given.
 */

export interface ReviewMetrics {
  duration: number
  /** The video's own frame rate (sheets and strips use its frames). */
  fps: number
  /** Rate the motion metrics are measured at (`ANALYSIS_FPS`), whatever the source fps. */
  analysisFps: number
  format: string
  frame0Blank: boolean
  /**
   * Empty frames: no detail (R23) and, for storyboard input, a mean colour within `BG_TOLERANCE` of
   * the look's background (a flat cover in another colour, e.g. a colour-wipe's accent, is designed,
   * not blank). For plain video input every flat frame counts.
   */
  nearBlankTimes: number[]
  /**
   * `nearBlankTimes` grouped into runs of consecutive frames, each with its mean colour
   * (`nearBlankColor`, [r, g, b]) and `designed`: true when the run lies inside a transition window
   * (storyboard input only; always false for plain video).
   */
  nearBlankRuns: BlankRun[]
  longestStatic: number
  staticRuns: { start: number; end: number }[]
  /** Pace (`paceOf`, the same function and thresholds as `mba reference`). */
  maxEventGap: number
  eventsPerSec: number
  /** Median gap between consecutive events (the whole max gap when there are fewer than 2 events). */
  medianEventGap: number
  /** 1 − total `staticRuns` time / duration (0..1). */
  movingPct: number
  eventTimes: number[]
  fastest: number[]
  audit: { t: number; issues: AuditIssue[] }[] | null
  /**
   * Every sheet image written, in reading order (file names in the kit folder). Long videos have
   * several pages of at most `SHEET_PAGE_TILES` tiles: `contact.jpg`, `contact-2.jpg`, …, then the
   * strips, then `phone.jpg`, `phone-2.jpg`, … and (9:16) `safe.jpg`, `safe-2.jpg`, ….
   */
  sheets: string[]
  notes: string[]
}

/** The keys of `ReviewMetrics`, in metrics.json order. */
export const REVIEW_METRIC_KEYS = [
  'duration',
  'fps',
  'analysisFps',
  'format',
  'frame0Blank',
  'nearBlankTimes',
  'nearBlankRuns',
  'longestStatic',
  'staticRuns',
  'maxEventGap',
  'eventsPerSec',
  'medianEventGap',
  'movingPct',
  'eventTimes',
  'fastest',
  'audit',
  'sheets',
  'notes',
] as const satisfies readonly (keyof ReviewMetrics)[]

// Compile-time check that the list is complete.
type _MissingKeys = Exclude<keyof ReviewMetrics, (typeof REVIEW_METRIC_KEYS)[number]>
const _complete: [_MissingKeys] extends [never] ? true : never = true
void _complete

/** Thresholds and sheet layout (all in one place; see the task-5 report). */
export const REVIEW = {
  gridLong: 8, // motion blocks along the long side of the frame
  gridShort: 6, // and along the short side
  staticThr: PACE.staticThr, // block mean |Δ| (0..255) below which consecutive frames count as the same picture
  minStatic: PACE.minStatic, // s; shorter static runs are not reported
  eventThr: PACE.eventThr, // block mean |Δ| peak that counts as a motion event
  eventApart: PACE.eventApart, // s between events
  blankDetail: 2, // frameDetail (edge pixels per 1000) below which a frame is near-blank (R23)
  fastN: 2,
  fastApart: 1.0, // s between the two fastest moments
  contactFps: 2,
  contactCols: 6,
  contactTileW: 180,
  stripCols: 6,
  stripTileW: 180,
  phoneFps: 1,
  phoneCols: 6,
  phoneTileW: 360,
  safeFps: 1,
  safeCols: 6,
  safeTileW: 180,
  auditEvery: 0.5,
  auditBatch: 20, // audit times whose video frames are prepared (and released) together
} as const

export interface ReviewOptions {
  storyboardPath?: string
  videoPath?: string
  outDir: string
  /** Seconds between text-audit samples (storyboard input only). Default 0.5. */
  auditEvery?: number
  /** Draft-render progress (storyboard input only). */
  onProgress?: (done: number, total: number) => void
}

const r3 = (x: number) => Math.round(x * 1000) / 1000

/** '9:16' etc. when the aspect matches a known format within 1 %, else `WxH`. */
export function formatOf(w: number, h: number): string {
  for (const f of FORMATS) {
    const s = FORMAT_SIZE[f]
    if (Math.abs(w / h / (s.w / s.h) - 1) < 0.01) return f
  }
  return `${w}x${h}`
}

/** Frame indices sampled at `rate` per second, plus the last frame (so the ending is always shown). */
function sampledFrames(rate: number, fps: number, frames: number): number[] {
  const out: number[] = []
  for (let k = 0; k / rate < frames / fps - 1e-9; k++) out.push(frameIndexAt(k / rate, fps, frames))
  out.push(frames - 1)
  return [...new Set(out)].sort((a, b) => a - b)
}

async function runAudit(storyboardPath: string, every: number): Promise<{ t: number; issues: AuditIssue[] }[]> {
  const session = await openRenderPage(await loadStoryboardFile(storyboardPath))
  try {
    const duration = storyboardDuration(session.sb)
    const out: { t: number; issues: AuditIssue[] }[] = []
    const times: number[] = []
    for (let k = 0; k * every < duration - 1e-9; k++) times.push(k * every)
    // Video frames are prepared per batch and released after it: a 3-minute edit never has all its
    // audit frames on disk at once.
    for (let b = 0; b < times.length; b += REVIEW.auditBatch) {
      const batch = times.slice(b, b + REVIEW.auditBatch)
      await session.prepareTimes(batch)
      for (const t of batch) {
        await session.seek(t)
        const stats = await session.page.evaluate(() => window.__mba.auditStats())
        out.push({ t: r3(t), issues: stats.issues })
      }
      await session.releaseTimes(batch)
    }
    return out
  } finally {
    await session.close()
  }
}

/**
 * Builds the review kit in `outDir`:
 * - `contact.jpg`: 2 fps (+ last frame), 6 columns, 180 px tiles
 * - `strip_fast_1.jpg`, `strip_fast_2.jpg`: 12 consecutive frames around the two fastest moments
 * - `phone.jpg`: 1 fps (+ last frame) at 360 px wide, 6 columns
 * - `safe.jpg`: 9:16 only, 1 fps (+ last frame) with the platform UI zones shaded
 * - contact, phone and safe are paginated at `SHEET_PAGE_TILES` tiles: `contact-2.jpg`, … (all
 *   listed in `metrics.sheets`)
 * - `metrics.json`: `ReviewMetrics`; `frames/`: the stills the sheets use
 * With a storyboard, a draft is rendered first (`<outDir>/draft.mp4`) and the text audit runs every
 * `auditEvery` seconds in the render page.
 */
export async function buildReviewKit(o: ReviewOptions): Promise<ReviewMetrics> {
  if ((o.storyboardPath === undefined) === (o.videoPath === undefined)) {
    throw new Error('حدّد ملف قصة أو فيديو (واحدًا فقط) — Give exactly one of storyboardPath or videoPath')
  }
  const every = o.auditEvery ?? REVIEW.auditEvery
  if (!(Number.isFinite(every) && every > 0)) {
    throw new Error(`قيمة auditEvery غير صالحة — auditEvery must be a positive number of seconds, got ${every}`)
  }
  const outDir = resolve(o.outDir)
  await mkdir(outDir, { recursive: true })
  const framesDir = join(outDir, 'frames')
  await rm(framesDir, { recursive: true, force: true })
  const notes: string[] = []

  let video: string
  let format: string | undefined
  let audit: ReviewMetrics['audit'] = null
  let bg: RGB[] | undefined
  let windows: { a: number; b: number }[] = []
  if (o.storyboardPath !== undefined) {
    const loaded = await loadStoryboardFile(o.storyboardPath)
    notes.push(...loaded.warnings)
    format = loaded.sb.format
    // The same colours the runtime paints the frame background with: the look's and every backdrop world's.
    bg = worldColours(loaded.sb).map((w) => hexToRgb(w.bg))
    windows = (loaded.sb.transitions ?? []).map((tr) => ({ a: tr.at - tr.duration / 2, b: tr.at + tr.duration / 2 }))
    video = join(outDir, 'draft.mp4')
    // Re-review minor: the draft render's audio warnings (a dynamic loudnorm run) reach the notes.
    await renderVideo({ storyboardPath: o.storyboardPath, outPath: video, draft: true, onProgress: o.onProgress, onWarning: (w) => notes.push(w) })
    audit = await runAudit(o.storyboardPath, every)
  } else {
    video = resolve(o.videoPath!)
  }

  const info = await probeVideo(video)
  if (o.storyboardPath !== undefined) notes.push(`draft render analysed: ${info.w}x${info.h} (half resolution), draft.mp4`)
  else notes.push('plain video input: no text audit (audit: null)')
  format ??= formatOf(info.w, info.h)

  // Motion metrics: decoded at ANALYSIS_FPS (times k/afps). Sheets and strips: the source frames.
  const graySize = defaultGraySize(info.w, info.h)
  const afps = ANALYSIS_FPS
  const gray = await grayFrames(video, graySize, afps)
  const na = gray.length
  if (na === 0) throw new Error(`لم يُفك ترميز أي إطار — No frames could be decoded from ${video}`)
  const duration = na / afps
  const fps = info.fps
  const n = info.frames > 0 ? info.frames : Math.max(1, Math.round(duration * fps))

  // Local motion (largest block of a grid, long side 8 blocks, short side 6): a global mean would
  // dilute typing, text wipes and subtitle fades to below the static threshold (see the report).
  const portrait = graySize.h > graySize.w
  const [cols, rows] = portrait ? [REVIEW.gridShort, REVIEW.gridLong] : [REVIEW.gridLong, REVIEW.gridShort]
  const series = blockMotionSeries(gray, graySize.w, graySize.h, cols, rows)
  const runs = staticRuns(series, afps, REVIEW.staticThr, REVIEW.minStatic)
  const events = eventTimes(series, afps, REVIEW.eventThr, REVIEW.eventApart)
  const pace = paceOf(series, afps, duration)
  const flat = nearBlank(gray, afps, REVIEW.blankDetail, graySize.w)
  const colors = await meanColors(video, afps)
  const blanks = emptyFrames(flat, afps, colors, bg)
  const covers = flat.filter((t) => !blanks.includes(t))
  if (covers.length) {
    notes.push(
      `${covers.length} flat frame${covers.length === 1 ? '' : 's'} not the background colour (designed covers, not counted as blank) at ` +
        covers.map((t) => `${r3(t)}`).join(', ') + ' s',
    )
  }
  const fastest = fastestMoments(series, afps, REVIEW.fastN, REVIEW.fastApart, REVIEW.staticThr)
  const maxChange = series.reduce((m, v) => Math.max(m, v), 0)

  if (na < 2) notes.push(`only ${na} frame: no motion metrics`)
  else if (maxChange < REVIEW.staticThr) {
    notes.push(`no motion detected: every frame-to-frame change is below ${REVIEW.staticThr}/255 (the picture never changes)`)
  } else if (events.length === 0) {
    notes.push(`no motion events: changes peak at ${r3(maxChange)}/255, below the event threshold ${REVIEW.eventThr} (slow or subtle motion only)`)
  }
  if (blanks.length === na) notes.push(`every frame is near-blank (detail < ${REVIEW.blankDetail} edge pixels per 1000: background only)`)

  // Strip centres: the fastest moments, then fallbacks so both strips always exist.
  const centres = [...fastest]
  if (centres.length < REVIEW.fastN) {
    const found = centres.length
    for (const c of [duration / 3, (2 * duration) / 3, duration / 2]) {
      if (centres.length >= REVIEW.fastN) break
      if (centres.every((x) => Math.abs(x - c) >= REVIEW.fastApart)) centres.push(c)
    }
    while (centres.length < REVIEW.fastN) centres.push(duration / 2)
    for (let i = found; i < REVIEW.fastN; i++) {
      notes.push(
        `only ${found} fast moment${found === 1 ? '' : 's'} at least ${REVIEW.fastApart} s apart: ` +
          `strip_fast_${i + 1} is centred at ${timeLabel(centres[i]!)} (fallback, not a fast moment)`,
      )
    }
  }
  if (n < STRIP_FRAMES) notes.push(`video shorter than a strip (${n} frames < ${STRIP_FRAMES}): strips use all ${n} frames`)
  const strips = centres.map((c) => {
    const w = stripWindow(c, fps, n)
    return Array.from({ length: w.count }, (_, k) => w.start + k)
  })

  const contact = sampledFrames(REVIEW.contactFps, fps, n)
  const phone = sampledFrames(REVIEW.phoneFps, fps, n)
  const isPortrait916 = format === '9:16'
  if (!isPortrait916) notes.push(`safe.jpg skipped: the safe-zone overlay is for 9:16 only (format ${format})`)

  // One ffmpeg pass for every still, at the largest tile width (smaller tiles are scaled by the sheet).
  const all = [...new Set([...contact, ...phone, ...strips.flat()])].sort((a, b) => a - b)
  const stillW = Math.min(REVIEW.phoneTileW, info.w)
  const paths = await stillsAt(video, all.map((i) => i / fps), framesDir, stillW - (stillW % 2))
  const still = new Map(all.map((i, k) => [i, paths[k]!]))
  const tiles = (idx: number[]): SheetImage[] => idx.map((i) => ({ path: still.get(i)!, label: timeLabel(i / fps) }))

  const sheets: string[] = []
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ headless: true })
    sheets.push(...(await composeSheetPages(tiles(contact), { base: 'contact', cols: REVIEW.contactCols, tileW: REVIEW.contactTileW, outDir, browser })))
    for (let s = 0; s < strips.length; s++) {
      const name = `strip_fast_${s + 1}.jpg`
      await composeSheet(tiles(strips[s]!), { cols: REVIEW.stripCols, tileW: REVIEW.stripTileW, out: join(outDir, name), browser })
      sheets.push(name)
    }
    sheets.push(...(await composeSheetPages(tiles(phone), { base: 'phone', cols: REVIEW.phoneCols, tileW: REVIEW.phoneTileW, outDir, browser })))
    if (isPortrait916) {
      sheets.push(
        ...(await composeSheetPages(tiles(phone), {
          base: 'safe',
          cols: REVIEW.safeCols,
          tileW: REVIEW.safeTileW,
          overlay: 'safe-9x16',
          outDir,
          browser,
        })),
      )
    } else {
      await removeSheetPages(outDir, 'safe')
    }
  } finally {
    await browser?.close().catch(() => {})
  }
  const paged = [['contact', contact.length], ['phone', phone.length], ...(isPortrait916 ? [['safe', phone.length] as const] : [])] as const
  for (const [base, count] of paged) {
    if (count > SHEET_PAGE_TILES) {
      notes.push(`${base} sheet has ${Math.ceil(count / SHEET_PAGE_TILES)} pages (${count} tiles, at most ${SHEET_PAGE_TILES} a page): read every page`)
    }
  }

  const metrics: ReviewMetrics = {
    duration: r3(duration),
    fps: r3(fps),
    analysisFps: afps,
    format,
    frame0Blank: blanks.length > 0 && blanks[0] === 0,
    nearBlankTimes: blanks.map(r3),
    nearBlankRuns: blankRuns(blanks, afps, colors, windows).map((r) => ({ ...r, start: r3(r.start), end: r3(r.end) })),
    longestStatic: r3(runs.reduce((m, r) => Math.max(m, r.end - r.start), 0)),
    staticRuns: runs.map((r) => ({ start: r3(r.start), end: r3(r.end) })),
    maxEventGap: pace.maxEventGap,
    eventsPerSec: pace.eventsPerSec,
    medianEventGap: pace.medianEventGap,
    movingPct: pace.movingPct,
    eventTimes: pace.events,
    fastest: fastest.map(r3),
    audit,
    sheets,
    notes,
  }
  await writeFile(join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n', 'utf8')
  return metrics
}
