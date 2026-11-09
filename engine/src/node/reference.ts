import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { chromium, type Browser } from '@playwright/test'
import { paletteOf, type PaletteColour } from '../core/palette'
import { fewCuts, FEW_CUTS_RATIO, styleFromReports, styleSchema, type StyleDna } from '../core/style'
import { defaultGraySize, frameIndexAt, grayFrames, probeVideo, rgbFrames, stillsAt } from './frames'
import { writeFileAtomic } from './fsx'
import { ANALYSIS_FPS, blockMotionSeries, frameDetail, median, motionSeries, paceOf, type Pace } from './metrics'
import { REVIEW } from './review'
import { composeSheet, timeLabel, type SheetImage } from './sheets'
import { resolveFfmpeg } from './tools'

/**
 * `mba reference`: learns the GRAMMAR of a video the user likes (cuts, shot lengths, motion
 * profile, event density) and writes a style-guide skeleton. Never its content.
 *
 * The pace numbers (events, eventsPerSec, …) come from the same `paceOf` (metrics.ts) as `mba review`,
 * at the same analysis rate, so a reference and our render compare directly.
 */

export interface ReferenceReport {
  duration: number
  /** The video's own frame rate. */
  fps: number
  /** Rate the pace and motion numbers are measured at (`ANALYSIS_FPS`), whatever the source fps. */
  analysisFps: number
  w: number
  h: number
  /** Scene-score threshold used for cut detection. */
  sceneThr: number
  /** Times (s) of the first frame of each new shot. */
  cuts: number[]
  shotLengths: number[]
  avgShot: number
  medianShot: number
  /** 4 Hz: mean global |Δ| (0..255, `motionSeries`) of the frame changes in [t, t + 0.25). */
  motionProfile: { t: number; motion: number }[]
  /** Motion events (block motion, as in `mba review`). */
  events: Pace['events']
  eventsPerSec: Pace['eventsPerSec']
  /** Median gap between consecutive events (the whole max gap when there are fewer than 2 events). */
  medianEventGap: Pace['medianEventGap']
  maxEventGap: Pace['maxEventGap']
  /** 1 − total static-run time / duration (0..1). */
  movingPct: Pace['movingPct']
  longestStatic: Pace['longestStatic']
  /** Colours SEEN in the pixels (`paletteOf`), largest share first, at most `PALETTE.maxColours` (core/palette.ts). */
  palette: PaletteColour[]
}

export { deltaE, labToRgb, paletteOf, PALETTE, rgbToLab, type PaletteColour, type PaletteRole } from '../core/palette'

/** Pixel sampling for `paletteOf`: frames at `fps`, decoded `width` px wide; k-means seed. */
export const PALETTE_SAMPLING = { fps: 2, width: 96, seed: 1 } as const

export const REFERENCE = {
  sceneThr: 0.3,
  profileHz: 4,
  framesFps: 2,
  framesCols: 6,
  framesTileW: 180,
  cutsCols: 6,
  cutsTileW: 180,
  /** "Few cuts": fewer than one cut per this many motion events. */
  fewCutsRatio: FEW_CUTS_RATIO,
} as const

const r3 = (x: number) => Math.round(x * 1000) / 1000

/** `pts_time:` of every frame `showinfo` printed (one per selected frame), in stderr order. */
export function parseShowinfoTimes(stderr: string): number[] {
  const out: number[] = []
  for (const line of stderr.split(/\r?\n/)) {
    if (!/Parsed_showinfo/.test(line)) continue
    const m = /\bpts_time:\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i.exec(line)
    if (m) out.push(Number(m[1]))
  }
  return out
}

/**
 * Cuts kept inside the clip (more than one frame from either end and from each other), sorted,
 * and the shots they make.
 */
export function shotStats(
  rawCuts: number[],
  duration: number,
  fps: number,
): { cuts: number[]; shotLengths: number[]; avgShot: number; medianShot: number } {
  const minGap = 1 / fps - 1e-9
  const cuts: number[] = []
  for (const c of [...rawCuts].sort((a, b) => a - b)) {
    if (c < minGap || c > duration - minGap) continue
    if (cuts.length && c - cuts[cuts.length - 1]! < minGap) continue
    cuts.push(r3(c))
  }
  const bounds = [0, ...cuts, duration]
  const shotLengths = bounds.slice(1).map((b, i) => r3(b - bounds[i]!))
  return { cuts, shotLengths, avgShot: r3(duration / shotLengths.length), medianShot: r3(median(shotLengths)) }
}

export { fewCuts }

/** Sampled pixels of a video for `paletteOf`: `PALETTE_SAMPLING.fps` frames a second, `.width` px wide. */
async function samplePixels(video: string, w: number, h: number): Promise<Uint8Array> {
  const pw = PALETTE_SAMPLING.width
  const ph = Math.max(2, Math.round((pw * h) / w / 2) * 2)
  const frames: Uint8Array[] = []
  await rgbFrames(video, { w: pw, h: ph }, PALETTE_SAMPLING.fps, (f) => frames.push(f))
  const out = new Uint8Array(frames.reduce((a, f) => a + f.length, 0))
  let off = 0
  for (const f of frames) {
    out.set(f, off)
    off += f.length
  }
  return out
}

/** 4 Hz profile: mean of the series values whose change time (i+1)/fps falls in each bin. */
function profileOf(series: number[], fps: number, duration: number, hz: number): { t: number; motion: number }[] {
  const bins = Math.max(1, Math.ceil(duration * hz - 1e-9))
  const sum = new Array<number>(bins).fill(0)
  const cnt = new Array<number>(bins).fill(0)
  series.forEach((v, i) => {
    const b = Math.min(bins - 1, Math.floor(((i + 1) / fps) * hz + 1e-9))
    sum[b]! += v
    cnt[b]!++
  })
  return sum.map((s, b) => ({ t: r3(b / hz), motion: r3(cnt[b] ? s / cnt[b]! : 0) }))
}

/** Mean `frameDetail` over the frames, sampled at `REFERENCE.framesFps` a second. */
function detailMeanOf(gray: Uint8Array[], w: number, fps: number): number {
  const step = Math.max(1, Math.round(fps / REFERENCE.framesFps))
  const vals: number[] = []
  for (let i = 0; i < gray.length; i += step) vals.push(frameDetail(gray[i]!, w))
  return r3(vals.length ? vals.reduce((a, x) => a + x, 0) / vals.length : 0)
}

/** Mean of the block-motion series at the events (an event at t is the change into frame t·fps: series index t·fps − 1). */
function motionAtEvents(series: number[], events: number[], fps: number): number {
  const vals = events.map((t) => series[Math.min(series.length - 1, Math.max(0, Math.round(t * fps) - 1))]!).filter((v) => v !== undefined)
  return r3(vals.length ? vals.reduce((a, x) => a + x, 0) / vals.length : 0)
}

/** Scene cuts: `select='gt(scene,THR)',showinfo`, times relative to the first frame. */
export async function detectCuts(file: string, thr: number): Promise<number[]> {
  const args = [
    '-hide_banner', '-nostdin',
    '-i', file,
    '-an', '-sn', '-dn',
    '-vf', `setpts=PTS-STARTPTS,select='gt(scene,${thr})',showinfo`,
    '-f', 'null', '-',
  ]
  // Collect only the showinfo lines (a long video prints a lot of other stderr).
  const { code, lines, tail, error } = await new Promise<{ code: number | null; lines: string[]; tail: string; error?: Error }>((res) => {
    const proc = spawn(resolveFfmpeg(), args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    const lines: string[] = []
    let buf = ''
    let tail = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      tail = (tail + d).slice(-2000)
      buf += d
      const parts = buf.split(/\r?\n/)
      buf = parts.pop()!
      for (const l of parts) if (l.includes('Parsed_showinfo')) lines.push(l)
    })
    proc.once('error', (e) => res({ code: null, lines, tail, error: e }))
    proc.once('close', (c) => {
      if (buf.includes('Parsed_showinfo')) lines.push(buf)
      res({ code: c, lines, tail })
    })
  })
  if (error || code !== 0) {
    throw new Error(`تعذّر كشف القطعات — ffmpeg scene detection failed for ${file} (${error ? error.message : `exit code ${code}`}): ${tail.trim()}`)
  }
  return parseShowinfoTimes(lines.join('\n'))
}

/** Frame indices at `rate` per second plus the last frame. */
function sampled(rate: number, fps: number, frames: number): number[] {
  const out: number[] = []
  for (let k = 0; k / rate < frames / fps - 1e-9; k++) out.push(frameIndexAt(k / rate, fps, frames))
  out.push(frames - 1)
  return [...new Set(out)].sort((a, b) => a - b)
}

const fmt = (x: number) => String(Number(x.toFixed(3)))

/** The style-guide skeleton: measured numbers filled in, observations left for Claude. */
export function referenceMarkdown(r: ReferenceReport, source: string): string {
  const TODO = 'TODO (Claude fills from frames.jpg)'
  const few = fewCuts(r.cuts.length, r.duration, r.eventsPerSec)
  const peaks = [...r.motionProfile].sort((a, b) => b.motion - a.motion || a.t - b.t).slice(0, 3)
  const meanMotion = r.motionProfile.length ? r.motionProfile.reduce((a, p) => a + p.motion, 0) / r.motionProfile.length : 0
  const L: string[] = [
    `# Reference: ${source}`,
    '',
    '> **Take the grammar, never the content.** Copy the rhythm, transitions, camera and text in/out;',
    '> never its words, images, logos, footage, characters or layout as a whole.',
    '',
    `Source: \`${source}\` · ${fmt(r.duration)} s · ${r.w}×${r.h} · ${fmt(r.fps)} fps (motion measured at ${r.analysisFps} fps). Sheets: \`frames.jpg\` (2 fps), \`cuts.jpg\` (first frame of each shot). Numbers: \`reference.json\`.`,
    '',
    '## Rhythm (cuts and shots)',
    '',
    `- Hard cuts (scene score > ${r.sceneThr}): **${r.cuts.length}**${r.cuts.length ? ` at ${r.cuts.map(fmt).join(', ')} s` : ''}`,
    `- Shots: ${r.shotLengths.length}; average **${fmt(r.avgShot)} s**, median **${fmt(r.medianShot)} s**`,
    `- Shot lengths (s): ${r.shotLengths.map(fmt).join(', ')}`,
    `- Pattern: ${TODO}`,
    '',
    '## Pace (event density, comparable with `mba review`)',
    '',
    `- Motion events: **${r.events.length}** → **${fmt(r.eventsPerSec)} per second**`,
    `- Median gap between events: **${fmt(r.medianEventGap)} s**${r.events.length < 2 ? ' (fewer than 2 events: this is the longest gap)' : ''}; longest gap: ${fmt(r.maxEventGap)} s`,
    `- Moving: **${fmt(r.movingPct * 100)} %** of the time; longest static hold: ${fmt(r.longestStatic)} s`,
    `- Global motion (4 Hz profile, 0..255): mean ${fmt(meanMotion)}; peaks at ${peaks.map((p) => `${fmt(p.t)} s (${fmt(p.motion)})`).join(', ')}`,
    '',
    `**Our render should match: eventsPerSec ≈ ${r.eventsPerSec}, medianEventGap ≈ ${r.medianEventGap}** (and keep the longest static hold near ${fmt(r.longestStatic)} s).`,
    '',
  ]
  if (few) {
    L.push(
      `Few hard cuts (${r.cuts.length} in ${fmt(r.duration)} s, ${fmt(r.cuts.length / r.duration)}/s) against ${fmt(r.eventsPerSec)} events/s: ` +
        'this reference relies on continuous motion, morphs and camera moves rather than hard cuts. ' +
        'Match the event density with in-scene motion and morph transitions, not by adding cuts.',
      '',
    )
  }
  L.push(
    '## Transitions',
    '',
    `- Between shots (look at each tile of cuts.jpg and the frames around it): ${TODO}`,
    `- Within shots (morphs, wipes, match moves): ${TODO}`,
    '',
    '## Camera',
    '',
    `- Moves (push, pan, orbit, shake), speed and easing: ${TODO}`,
    '',
    '## Text in/out',
    '',
    `- How text enters and leaves (unit: whole word / line, direction, timing): ${TODO}`,
    '- Arabic rule: our text animates by whole word or line, never per letter.',
    '',
    '## Palette',
    '',
    `**SEEN (measured)**: k-means of the pixels (${PALETTE_SAMPLING.fps} fps, ${PALETTE_SAMPLING.width} px wide); share = part of all sampled pixels.`,
    '',
  )
  if (r.palette.length) {
    L.push('| Role | Colour | Share |', '|---|---|---|', ...r.palette.map((c) => `| ${c.role} | \`${c.hex}\` | ${Number((c.share * 100).toFixed(1))} % |`))
  } else {
    L.push('No colours were measured.')
  }
  L.push(
    '',
    `- How the accent is used (which elements, how often), contrast of text on background: ${TODO}`,
    '',
    '## Type',
    '',
    `- Weight, size relative to frame, case/style, placement: ${TODO}`,
    '',
  )
  return L.join('\n')
}

export interface ReferenceOptions {
  videoPath: string
  outDir: string
  /** Scene-score threshold for a hard cut, 0..1. Default 0.3. */
  sceneThr?: number
}

/**
 * Analyses a reference video into `outDir`: `frames.jpg` (2 fps + last frame), `cuts.jpg` (the
 * opening frame and the first frame after each cut), `reference.json` (`ReferenceReport`) and
 * `reference.md` (the style-guide skeleton). Stills go to `<outDir>/frames/` (cleared each run).
 */
export async function analyzeReference(o: ReferenceOptions): Promise<ReferenceReport> {
  return (await analyzeReferenceFull(o)).report
}

/** `analyzeReference` plus the two measurements the style DNA needs (not part of `reference.json`). */
export interface ReferenceAnalysis {
  report: ReferenceReport
  /** Mean `frameDetail` of the analysed frames (sampled at 2 a second). */
  detailMean: number
  /** Mean block-motion value (0..255) at the motion events. */
  motionMean: number
}

export async function analyzeReferenceFull(o: ReferenceOptions): Promise<ReferenceAnalysis> {
  const sceneThr = o.sceneThr ?? REFERENCE.sceneThr
  if (!(Number.isFinite(sceneThr) && sceneThr > 0 && sceneThr < 1)) {
    throw new Error(`قيمة sceneThr غير صالحة — sceneThr must be between 0 and 1, got ${sceneThr}`)
  }
  const video = resolve(o.videoPath)
  const outDir = resolve(o.outDir)
  const info = await probeVideo(video)
  await mkdir(outDir, { recursive: true })
  const framesDir = join(outDir, 'frames')
  await rm(framesDir, { recursive: true, force: true })

  // Pace and motion profile: decoded at ANALYSIS_FPS. Cut detection and sheets: the source frames.
  const graySize = defaultGraySize(info.w, info.h)
  const afps = ANALYSIS_FPS
  const gray = await grayFrames(video, graySize, afps)
  if (gray.length === 0) throw new Error(`لم يُفك ترميز أي إطار — No frames could be decoded from ${video}`)
  const duration = gray.length / afps
  const fps = info.fps
  const n = info.frames > 0 ? info.frames : Math.max(1, Math.round(duration * fps))

  // Cut times are pts-based (showinfo pts_time) while duration, pace and the sheet tiles use n/fps.
  // On variable-frame-rate input the two clocks drift apart slightly (a few frames over a minute),
  // so a cut tile can sit a frame or two off the exact cut.
  const shots = shotStats(await detectCuts(video, sceneThr), duration, fps)
  const portrait = graySize.h > graySize.w
  const [cols, rows] = portrait ? [REVIEW.gridShort, REVIEW.gridLong] : [REVIEW.gridLong, REVIEW.gridShort]
  const block = blockMotionSeries(gray, graySize.w, graySize.h, cols, rows)
  const pace = paceOf(block, afps, duration)
  const motionProfile = profileOf(motionSeries(gray), afps, duration, REFERENCE.profileHz)

  const report: ReferenceReport = {
    duration: r3(duration),
    fps: r3(fps),
    analysisFps: afps,
    w: info.w,
    h: info.h,
    sceneThr,
    ...shots,
    motionProfile,
    ...pace,
    palette: paletteOf(await samplePixels(video, info.w, info.h), PALETTE_SAMPLING.seed),
  }

  const contact = sampled(REFERENCE.framesFps, fps, n)
  const shotStarts = [0, ...shots.cuts].map((t) => frameIndexAt(t, fps, n))
  const all = [...new Set([...contact, ...shotStarts])].sort((a, b) => a - b)
  const stillW = Math.min(REFERENCE.framesTileW * 2, info.w)
  const paths = await stillsAt(video, all.map((i) => i / fps), framesDir, stillW - (stillW % 2))
  const still = new Map(all.map((i, k) => [i, paths[k]!]))
  const frameTiles: SheetImage[] = contact.map((i) => ({ path: still.get(i)!, label: timeLabel(i / fps) }))
  const cutTiles: SheetImage[] = shotStarts.map((i, k) => ({
    path: still.get(i)!,
    label: k === 0 ? `start ${timeLabel(0)}` : `cut ${k} ${timeLabel(shots.cuts[k - 1]!)}`,
  }))

  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ headless: true })
    await composeSheet(frameTiles, { cols: REFERENCE.framesCols, tileW: REFERENCE.framesTileW, out: join(outDir, 'frames.jpg'), browser })
    await composeSheet(cutTiles, { cols: REFERENCE.cutsCols, tileW: REFERENCE.cutsTileW, out: join(outDir, 'cuts.jpg'), browser })
  } finally {
    await browser?.close().catch(() => {})
  }

  await writeFileAtomic(join(outDir, 'reference.md'), referenceMarkdown(report, basename(video)))
  await writeFileAtomic(join(outDir, 'reference.json'), JSON.stringify(report, null, 2) + '\n')
  return { report, detailMean: detailMeanOf(gray, graySize.w, afps), motionMean: motionAtEvents(block, pace.events, afps) }
}

/** SHA-1 of a file (hex), streamed. */
export function sha1File(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash('sha1')
    createReadStream(path).on('data', (d) => h.update(d)).once('error', rej).once('end', () => res(h.digest('hex')))
  })
}

/**
 * `mba reference a.mp4 [b.mp4 …] --style`: the style DNA of the analyses (see core/style.ts). `signature`
 * stays empty: the distinctive moves are for the watcher to name after looking at the frames.
 */
export function styleOf(analyses: { analysis: ReferenceAnalysis; file: string; sha1: string }[]): StyleDna {
  return styleFromReports(analyses.map((a) => ({ report: a.analysis.report, detailMean: a.analysis.detailMean, motionMean: a.analysis.motionMean, file: a.file, sha1: a.sha1 })))
}

/** Reads and validates a `style.json` (Arabic-first errors). */
export async function loadStyleFile(path: string): Promise<StyleDna> {
  const file = resolve(path)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`لم يتم العثور على ملف الأسلوب — Style file not found: ${file}`)
    throw e
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`ملف الأسلوب ليس JSON صالحًا — Style file is not valid JSON (${file}): ${(e as Error).message}`)
  }
  const r = styleSchema.safeParse(json)
  if (!r.success) {
    const i = r.error.issues[0]!
    throw new Error(`ملف الأسلوب غير صالح — Invalid style file ${file}: ${i.path.join('.') || '(root)'}: ${i.message}`)
  }
  return r.data
}
