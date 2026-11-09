import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { storyboardDuration, trackOf, type Storyboard } from '../core/storyboard'
import { adherence, type AdherenceRow, type StyleDna } from '../core/style'
import { defaultGraySize, grayFrames, probeVideo, type VideoInfo } from './frames'
import { renameWithRetry, rmWithRetry, writeFileAtomic } from './fsx'
import { ANALYSIS_FPS, blockMotionSeries, paceOf, type Pace } from './metrics'
import { detectCuts, REFERENCE, shotStats } from './reference'
import { loadStoryboardFile } from './render'
import { REVIEW } from './review'
import { resolveFfmpeg, resolveFfprobe } from './tools'

/**
 * `mba compare`: our render next to the reference, scene by scene. Each scene's pace (the same
 * `paceOf` as `mba review` / `mba reference`) is measured in our render and in the same fraction of
 * the reference; §17.1: the scene that moves less is the one to fix. Writes `compare.mp4` (both
 * side by side, labelled «المرجع» / «نسختنا»), `compare.json` and `compare.md`.
 */

export interface CompareScene {
  id: string
  /** Window in our render (s). The reference window is the same fraction of its own duration. */
  a: number
  b: number
  /** Pace of our render in [a, b); events in render time. */
  ours: Pace
  /** Pace of the reference's window; events in reference time. */
  ref: Pace
  /** `short`: shorter than `COMPARE.minScene`, indicative only (never counted as a fix). */
  verdict: Verdict
}

export type Verdict = 'ok' | 'fix' | 'short'

/** Where the scenes came from: a storyboard track, or the render's own cuts. */
export type CompareSource =
  | { kind: 'storyboard'; track: number; trackScenes: number; auto: boolean; summary: string }
  | { kind: 'cuts'; shots: number; summary: string }
  /** `--units shots` (the reference's cuts) or `fixed:<s>` (equal windows). */
  | { kind: 'windows'; units: string; windows: number; summary: string }

export interface CompareReport {
  scenes: CompareScene[]
  source: CompareSource
  /** Holes and overlaps in the chosen track's tiling of [0, render duration] (storyboard only). */
  tiling: Tiling
  /** Analysed durations (s) and ref / ours, the factor that maps a scene onto the reference. */
  durations: { ours: number; ref: number; ratio: number }
  /** Arabic first: the render may not have been made from this storyboard, etc. */
  warnings: string[]
  /** With a style (`--style`): our whole render against the style's targets, one row per field. */
  adherence?: AdherenceRow[]
}

/**
 * What a scene is (`--units`): `beats` the content track's scenes joined into beats of ≥ `COMPARE.minScene` s
 * (the default for a recipe storyboard), `scenes` the track as written, `shots` the reference's cuts,
 * `{ fixed }` equal windows of that many seconds.
 */
export type CompareUnits = 'beats' | 'scenes' | 'shots' | { fixed: number }

/** `beats` | `scenes` | `shots` | `fixed:<seconds>` (Arabic-first error otherwise). */
export function parseUnits(text: string): CompareUnits {
  const t = text.trim()
  if (t === 'beats' || t === 'scenes' || t === 'shots') return t
  const m = /^fixed:(\d+(?:\.\d+)?)$/.exec(t)
  if (m && Number(m[1]) > 0) return { fixed: Number(m[1]) }
  throw new Error(`قيمة --units غير صالحة — --units must be beats, scenes, shots or fixed:<seconds> (seconds > 0), got "${text}"`)
}

export interface Tiling {
  gaps: { a: number; b: number }[]
  overlaps: { a: number; b: number; ids: [string, string] }[]
}

export interface CompareOptions {
  reference: string
  render: string
  /** Scenes come from this storyboard (`track`, else the content track, see `storyboardScenes`); else from the render's cuts. */
  storyboard?: string
  /** Storyboard track to take the scenes from (default: the content track, see `storyboardScenes`). */
  track?: number
  /** What a scene is; default: the storyboard's content track (merged into beats for a recipe storyboard), else the render's cuts. */
  units?: CompareUnits
  /** Score our whole render against this style (`report.adherence`). */
  style?: StyleDna
  outDir: string
}

export const COMPARE = {
  /** A scene is fixed when it moves this much less of the time than the reference … */
  movingSlack: 0.05,
  /** … or has fewer than this share of the reference's events per second. */
  eventsRatio: 0.8,
  /** Scenes shorter than this (s) get verdict `short`: too little time to judge pace. */
  minScene: 1.0,
  /** Both videos are scaled to this height, side by side. */
  height: 960,
  /** Label pill: font size and distance from the top (px of the 960-high output). */
  labelPx: 44,
  labelTop: 28,
  refLabel: 'المرجع',
  oursLabel: 'نسختنا',
} as const

const r3 = (x: number) => Math.round(x * 1000) / 1000
const fmt = (x: number) => String(Number(x.toFixed(3)))

/** §17.1: `fix` when our scene moves less than the reference's (time moving, or event density). */
export function compareVerdict(ours: Pace, ref: Pace): 'ok' | 'fix' {
  if (ours.movingPct < ref.movingPct - COMPARE.movingSlack - 1e-9) return 'fix'
  if (ours.eventsPerSec < COMPARE.eventsRatio * ref.eventsPerSec - 1e-9) return 'fix'
  return 'ok'
}

/** A scene's verdict: `short` below `COMPARE.minScene` s (too little time to judge pace), else `compareVerdict`. */
export function sceneVerdict(a: number, b: number, ours: Pace, ref: Pace): Verdict {
  return b - a < COMPARE.minScene - 1e-9 ? 'short' : compareVerdict(ours, ref)
}

type Window = { id: string; a: number; b: number }

/**
 * Scene types that are never the content track (fix wave M1): a background, the HUD, and pace
 * accents (a track holding only these is skipped by default).
 */
export const NON_CONTENT_TYPES: ReadonlySet<string> = new Set(['backdrop', 'hud', 'highlight'])

/** Seconds of [0, duration] covered by at least one of `scenes`. */
function coverage(scenes: readonly { start: number; duration: number }[], duration: number): number {
  const iv = scenes.map((s) => [Math.max(0, s.start), Math.min(duration, s.start + s.duration)] as const).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0
  let end = 0
  for (const [a, b] of iv) {
    if (b <= end) continue
    total += b - Math.max(a, end)
    end = b
  }
  return total
}

/**
 * Fix wave M1: consecutive windows shorter than `minSec` (default COMPARE.minScene) joined into beats of at least that
 * long (ids joined with `+`); a short remainder joins the beat before it. Recipe output cuts the main
 * line into sub-second word chunks, which alone would all be `short`.
 */
export function mergeShortWindows(ws: readonly Window[], minSec: number = COMPARE.minScene): Window[] {
  const out: Window[] = []
  let cur: Window | undefined
  for (const w of ws) {
    cur = cur ? { id: `${cur.id}+${w.id}`, a: cur.a, b: Math.max(cur.b, w.b) } : { ...w }
    if (cur.b - cur.a >= minSec - 1e-9) {
      out.push(cur)
      cur = undefined
    }
  }
  if (cur) {
    const last = out.pop()
    out.push(last ? { id: `${last.id}+${cur.id}`, a: last.a, b: Math.max(last.b, cur.b) } : cur)
  }
  return out
}

/**
 * The storyboard's scene sequence: the scenes of `track`, by start, clipped to `duration`.
 * Default (M1): the content track — tracks holding only NON_CONTENT_TYPES (backdrop, HUD, accents)
 * are skipped, and of the rest the one covering the most of the timeline wins (then the most
 * scenes, then the lowest track); a storyboard written by `mba explain` (it names its transcript)
 * has its sub-second scenes merged into beats of at least COMPARE.minScene (`mergeShortWindows`).
 * `--track` takes that track's scenes as they are. `trackScenes` counts the track's scenes before
 * clipping. `merge` overrides that default: true joins sub-second scenes into beats for any
 * storyboard and track (`--units beats`), false keeps the track as it is (`--units scenes`).
 */
export function storyboardScenes(
  sb: Pick<Storyboard, 'scenes'> & { transcript?: unknown },
  duration: number,
  track?: number,
  merge?: boolean,
): { track: number; trackScenes: number; auto: boolean; merged: boolean; scenes: Window[] } {
  const byTrack = new Map<number, Storyboard['scenes']>()
  for (const sc of sb.scenes) byTrack.set(trackOf(sc), [...(byTrack.get(trackOf(sc)) ?? []), sc])
  let pick = 0
  if (track !== undefined) {
    if (!byTrack.has(track)) {
      const have = [...byTrack.keys()].sort((x, y) => x - y).join(', ')
      throw new Error(`لا توجد مشاهد على المسار ${track} — No scenes on track ${track} (tracks with scenes: ${have || 'none'})`)
    }
    pick = track
  } else {
    const all = [...byTrack].sort((x, y) => x[0] - y[0])
    const content = all.filter(([, scs]) => scs.some((sc) => !NON_CONTENT_TYPES.has(sc.type)))
    let best = -1
    let bestN = -1
    for (const [t, scs] of content.length ? content : all) {
      const cov = r3(coverage(scs, duration))
      if (cov > best + 1e-9 || (Math.abs(cov - best) <= 1e-9 && scs.length > bestN)) {
        best = cov
        bestN = scs.length
        pick = t
      }
    }
  }
  let scenes = (byTrack.get(pick) ?? [])
    .map((sc) => ({ id: sc.id, a: r3(Math.max(0, sc.start)), b: r3(Math.min(duration, sc.start + sc.duration)) }))
    .filter((s) => s.b - s.a > 1e-9)
    .sort((x, y) => x.a - y.a || x.b - y.b)
  const wantMerge = merge ?? (track === undefined && sb.transcript !== undefined)
  const merged = wantMerge && scenes.some((s) => s.b - s.a < COMPARE.minScene - 1e-9)
  if (merged) scenes = mergeShortWindows(scenes)
  return { track: pick, trackScenes: byTrack.get(pick)?.length ?? 0, auto: track === undefined, merged, scenes }
}

/**
 * Holes and overlaps of `scenes` (sorted by start) over [0, duration]: a hole is any stretch longer
 * than one frame that no scene covers; an overlap is a scene starting more than a frame before the
 * one reaching furthest so far ends.
 */
export function tilingOf(scenes: Window[], duration: number, fps: number): Tiling {
  const tol = 1 / fps + 1e-6
  const gaps: Tiling['gaps'] = []
  const overlaps: Tiling['overlaps'] = []
  let end = 0
  let last: Window | undefined
  for (const s of scenes) {
    if (s.a - end > tol) gaps.push({ a: r3(end), b: r3(s.a) })
    if (last && end - s.a > tol) overlaps.push({ a: r3(s.a), b: r3(Math.min(end, s.b)), ids: [last.id, s.id] })
    if (!last || s.b > end) {
      end = Math.max(end, s.b)
      last = s
    }
  }
  if (duration - end > tol) gaps.push({ a: r3(end), b: r3(duration) })
  return { gaps, overlaps }
}

/**
 * Signs that the render was not made from this storyboard (no job hash survives a finished render:
 * its job.json is removed once the MP4 is in place). Arabic first.
 */
export function staleWarnings(o: { sbDuration: number; renderDuration: number; fps: number; sbMtimeMs: number; renderMtimeMs: number; sbName: string }): string[] {
  const out: string[] = []
  if (Math.abs(o.sbDuration - o.renderDuration) > 1 / o.fps + 1e-6) {
    out.push(
      `مدة ملف القصة لا تطابق العرض: إما أنه صُنع من قصة أخرى أو أن العرض فقد إطارات — ${o.sbName} lasts ${fmt(o.sbDuration)} s but the render lasts ${fmt(o.renderDuration)} s ` +
        '(more than one frame apart): either the render was made from a different storyboard, or the render lost frames (a render made before ' +
        'RENDER_RECIPE 7 could drop frames at the audio mux); render again before trusting the verdicts',
    )
  }
  if (o.sbMtimeMs > o.renderMtimeMs + 1000) {
    out.push(
      `ملف القصة عُدّل بعد العرض — ${o.sbName} was changed after the render was made: the scene windows may not match the video; render again before trusting the verdicts`,
    )
  }
  return out
}

/** One scene per shot of the render: `shot-1`, `shot-2`, … between the cuts. */
export function cutScenes(cuts: number[], duration: number): { id: string; a: number; b: number }[] {
  const bounds = [0, ...cuts, duration]
  return bounds.slice(1).map((b, i) => ({ id: `shot-${i + 1}`, a: r3(bounds[i]!), b: r3(b) }))
}

/**
 * Pace of a block-motion series (`series[i]` = change from frame i to i+1 at `fps`) inside the
 * window [a, b): only the changes between frames shown in the window, so the cut into the next
 * scene is not counted. Events are shifted back to absolute time.
 */
export function windowPace(series: number[], fps: number, a: number, b: number): Pace {
  const frames = series.length + 1
  const k0 = Math.min(Math.max(0, Math.round(a * fps)), frames)
  const k1 = Math.min(Math.max(k0, Math.round(b * fps)), frames)
  const p = paceOf(series.slice(k0, Math.max(k0, k1 - 1)), fps, (k1 - k0) / fps)
  return { ...p, events: p.events.map((t) => r3(t + k0 / fps)) }
}

export interface CompareArgsInput {
  reference: string
  render: string
  refLabel: string
  oursLabel: string
  refDuration: number
  oursDuration: number
  fps: number
  hasAudio: boolean
  out: string
}

/**
 * ffmpeg argv for `compare.mp4`: reference on the left, our render on the right, both resampled to
 * the render's fps and scaled to `COMPARE.height`; the shorter one holds its last frame (`tpad`
 * clone) until the longer ends. Each label is a transparent PNG overlaid at the top centre of its
 * half (image2 with `-pattern_type none`, so a '%' in the path is not a pattern). Audio: ours, if any.
 */
export function buildCompareArgs(o: CompareArgsInput): string[] {
  const total = Math.max(o.refDuration, o.oursDuration)
  const side = (i: number, d: number, label: number, out: string) => {
    const pad = total - d > 1e-6 ? `,tpad=stop_mode=clone:stop_duration=${fmt(total - d)}` : ''
    return (
      `[${i}:v]fps=${o.fps},scale=-2:${COMPARE.height}:flags=lanczos,setsar=1${pad}[s${i}];` +
      `[s${i}][${label}:v]overlay=x=(W-w)/2:y=${COMPARE.labelTop}:format=auto[${out}]`
    )
  }
  const graph = `${side(0, o.refDuration, 2, 'l')};${side(1, o.oursDuration, 3, 'r')};[l][r]hstack=inputs=2,format=yuv420p[v]`
  return [
    '-v', 'error', '-nostdin', '-y',
    '-i', o.reference,
    '-i', o.render,
    '-f', 'image2', '-pattern_type', 'none', '-i', o.refLabel,
    '-f', 'image2', '-pattern_type', 'none', '-i', o.oursLabel,
    '-filter_complex', graph,
    '-map', '[v]',
    ...(o.hasAudio ? ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(o.fps),
    '-t', fmt(total),
    '-movflags', '+faststart',
    '-f', 'mp4',
    o.out,
  ]
}

function run(cmd: string, args: string[]): Promise<{ code: number | null; stderr: string; error?: Error }> {
  return new Promise((res) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let err = ''
    proc.stdout.resume()
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      err = (err + d).slice(-4000)
    })
    proc.once('error', (error) => res({ code: null, stderr: err, error }))
    proc.once('close', (code) => res({ code, stderr: err }))
  })
}

async function hasAudio(file: string): Promise<boolean> {
  return new Promise((res) => {
    const proc = spawn(resolveFfprobe(), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    let out = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (d: string) => (out += d))
    proc.once('error', () => res(false))
    proc.once('close', (code) => res(code === 0 && out.trim() !== ''))
  })
}

/** Block-motion series at `ANALYSIS_FPS` (the grid `mba review` uses) and the analysed duration. */
async function motionOf(video: string, info: VideoInfo): Promise<{ series: number[]; duration: number }> {
  const size = defaultGraySize(info.w, info.h)
  const gray = await grayFrames(video, size, ANALYSIS_FPS)
  if (gray.length === 0) throw new Error(`لم يُفك ترميز أي إطار — No frames could be decoded from ${video}`)
  const portrait = size.h > size.w
  const [cols, rows] = portrait ? [REVIEW.gridShort, REVIEW.gridLong] : [REVIEW.gridLong, REVIEW.gridShort]
  return { series: blockMotionSeries(gray, size.w, size.h, cols, rows), duration: gray.length / ANALYSIS_FPS }
}

const CAIRO = fileURLToPath(new URL('../../assets/fonts/cairo/Cairo-Variable.ttf', import.meta.url))

/**
 * The two labels as transparent PNGs, drawn by Chromium with the bundled Cairo face (shaped Arabic,
 * never ffmpeg drawtext): a white word on a dark rounded pill.
 */
async function renderLabels(dir: string): Promise<{ ref: string; ours: string }> {
  const font = (await readFile(CAIRO)).toString('base64')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 200 }, deviceScaleFactor: 1 })
    const out: Record<'ref' | 'ours', string> = { ref: join(dir, 'label-ref.png'), ours: join(dir, 'label-ours.png') }
    for (const [key, text] of [['ref', COMPARE.refLabel], ['ours', COMPARE.oursLabel]] as const) {
      await page.setContent(
        `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:'MbaCairo';src:url(data:font/ttf;base64,${font}) format('truetype');font-weight:200 1000}
html,body{margin:0;background:transparent}
#l{display:inline-block;padding:4px 28px 10px;border-radius:999px;background:rgba(12,12,12,.72);color:#fff;
font:700 ${COMPARE.labelPx}px/1.3 'MbaCairo';white-space:nowrap}
</style></head><body><span id="l">${text}</span></body></html>`,
        { waitUntil: 'load' },
      )
      const ok = await page.evaluate(
        async ({ text, px }) => {
          await document.fonts.ready
          return document.fonts.check(`700 ${px}px MbaCairo`, text)
        },
        { text, px: COMPARE.labelPx },
      )
      if (!ok) throw new Error(`تعذّر تحميل خط Cairo — The bundled Cairo font did not load for the compare label «${text}»`)
      await writeFile(out[key], await page.locator('#l').screenshot({ omitBackground: true, type: 'png' }))
    }
    return out
  } finally {
    await browser.close().catch(() => {})
  }
}

/** compare.md: warnings, where the scenes came from, the timing note, then one row per scene. */
export function compareMarkdown(rep: CompareReport, refName: string, oursName: string): string {
  const pct = (x: number) => `${fmt(x * 100)} %`
  const { ours: dOurs, ref: dRef, ratio } = rep.durations
  const fixes = rep.scenes.filter((s) => s.verdict === 'fix')
  const shorts = rep.scenes.filter((s) => s.verdict === 'short')
  const L = [`# المقارنة — Compare: ${oursName} vs ${refName}`, '']
  if (rep.warnings.length) L.push('## تنبيهات — Warnings', '', ...rep.warnings.map((w) => `- **${w}**`), '')
  L.push(
    `Left «${COMPARE.refLabel}» = reference \`${refName}\` (${fmt(dRef)} s); right «${COMPARE.oursLabel}» = our render \`${oursName}\` (${fmt(dOurs)} s). Numbers: \`compare.json\`.`,
    '',
    `Scenes: ${rep.source.summary}.`,
  )
  if (rep.source.kind === 'storyboard') {
    for (const g of rep.tiling.gaps) L.push(`- Gap on that track: ${fmt(g.a)}–${fmt(g.b)} s (no scene; not scored)`)
    for (const o of rep.tiling.overlaps) L.push(`- Overlap on that track: ${o.ids[0]} and ${o.ids[1]} over ${fmt(o.a)}–${fmt(o.b)} s (scored in both)`)
  }
  L.push(
    '',
    `**Timing:** \`compare.mp4\` plays both videos in real time (ours ${fmt(dOurs)} s, reference ${fmt(dRef)} s; the shorter holds its last frame), ` +
      `but scoring maps each of our scenes onto the same FRACTION of the reference: reference window = our window × ${fmt(ratio)} (= ${fmt(dRef)} / ${fmt(dOurs)}). ` +
      'So unless the ratio is 1, a scene in the video is not shown next to the reference window it was scored against.',
    '',
    `§17.1: the scene that moves less is fixed — **fix** when our moving share is more than ${COMPARE.movingSlack * 100} points below the reference's, ` +
      `or our events per second are below ${COMPARE.eventsRatio} × the reference's. Scenes shorter than ${COMPARE.minScene} s are \`short\`: indicative only, never a fix.`,
    '',
    `Scenes to fix: **${fixes.length}** of ${rep.scenes.length - shorts.length} scored${fixes.length ? ` (${fixes.map((s) => s.id).join(', ')})` : ''}` +
      `${shorts.length ? `; ${shorts.length} short (indicative)` : ''}.`,
    '',
    '| Scene | Ours (s) | Reference (s) | Moving ours / ref | Events/s ours / ref | Longest static ours / ref | Verdict |',
    '|---|---|---|---|---|---|---|',
  )
  for (const s of rep.scenes) {
    const v = s.verdict === 'fix' ? '**fix**' : s.verdict === 'short' ? 'short (indicative)' : 'ok'
    L.push(
      `| ${s.id} | ${fmt(s.a)}–${fmt(s.b)} | ${fmt(s.a * ratio)}–${fmt(s.b * ratio)} | ${pct(s.ours.movingPct)} / ${pct(s.ref.movingPct)} | ` +
        `${fmt(s.ours.eventsPerSec)} / ${fmt(s.ref.eventsPerSec)} | ${fmt(s.ours.longestStatic)} / ${fmt(s.ref.longestStatic)} | ${v} |`,
    )
  }
  L.push('')
  if (rep.adherence) {
    const bad = rep.adherence.filter((r) => !r.ok)
    L.push(
      '## التزام الأسلوب — Adherence',
      '',
      `Our whole render against the style's targets: **${bad.length ? `${bad.length} of ${rep.adherence.length} rows off (${bad.map((r) => r.field).join(', ')})` : 'all rows ok'}**.`,
      '',
      '| Field | Target | Ours | |',
      '|---|---|---|---|',
      ...rep.adherence.map((r) => `| ${r.field} | ${r.target} | ${r.ours} | ${r.ok ? 'ok' : '**not ok**'} |`),
      '',
    )
  }
  return L.join('\n')
}

/**
 * Compares our render with a reference into `outDir` (created; only `compare.mp4`, `compare.json`
 * and `compare.md` are written there, each atomically, `compare.json` last).
 */
export async function compareVideos(o: CompareOptions): Promise<CompareReport> {
  const reference = resolve(o.reference)
  const render = resolve(o.render)
  if (o.track !== undefined && o.storyboard === undefined) {
    throw new Error('الخيار track يحتاج ملف قصة — track needs a storyboard (scenes from the cuts of a render have no tracks)')
  }
  const [refInfo, ourInfo] = [await probeVideo(reference), await probeVideo(render)]
  const sb = o.storyboard !== undefined ? (await loadStoryboardFile(o.storyboard)).sb : undefined
  const ref = await motionOf(reference, refInfo)
  const ours = await motionOf(render, ourInfo)

  let windows: Window[]
  let source: CompareSource
  let tiling: Tiling = { gaps: [], overlaps: [] }
  const warnings: string[] = []
  const units = o.units
  const ratio = ref.duration / ours.duration
  // Cuts of our render: its own scenes by default, and the `cuts` row of the style adherence.
  let renderCuts: number[] | undefined
  const cutsOfRender = async () => (renderCuts ??= shotStats(await detectCuts(render, REFERENCE.sceneThr), ours.duration, ourInfo.fps).cuts)
  const storyboardUnits = units === undefined || units === 'beats' || units === 'scenes'
  if (sb && storyboardUnits) {
    const pick = storyboardScenes(sb, ours.duration, o.track, units === 'beats' ? true : units === 'scenes' ? false : undefined)
    windows = pick.scenes
    tiling = tilingOf(pick.scenes, ours.duration, ourInfo.fps)
    source = {
      kind: 'storyboard',
      track: pick.track,
      trackScenes: pick.trackScenes,
      auto: pick.auto,
      summary:
        `scenes from track ${pick.track} (${pick.trackScenes} scenes)` +
        (pick.auto ? ', the content track (most of the timeline covered)' : ', chosen with --track') +
        (pick.merged ? `; sub-second scenes merged into ${pick.scenes.length} beats of ≥ ${COMPARE.minScene} s` : ''),
    }
  } else if (units === 'shots') {
    const refCuts = shotStats(await detectCuts(reference, REFERENCE.sceneThr), ref.duration, refInfo.fps).cuts
    windows = cutScenes(refCuts.map((c) => r3(c / ratio)), ours.duration)
    source = { kind: 'windows', units: 'shots', windows: windows.length, summary: `scenes from the reference's cuts (${windows.length} shots, mapped onto our render by the duration ratio)` }
  } else if (typeof units === 'object') {
    const n = Math.max(1, Math.floor(ours.duration / units.fixed + 1e-9))
    windows = Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, a: r3(i * units.fixed), b: r3(i === n - 1 ? ours.duration : (i + 1) * units.fixed) }))
    source = { kind: 'windows', units: `fixed:${fmt(units.fixed)}`, windows: n, summary: `equal windows of ${fmt(units.fixed)} s (${n} windows; the last one runs to the end)` }
  } else {
    const cuts = await cutsOfRender()
    windows = cutScenes(cuts, ours.duration)
    const beats = units === 'beats'
    if (beats) windows = mergeShortWindows(windows)
    source = {
      kind: 'cuts',
      shots: windows.length,
      summary: beats ? `scenes from the render's cuts, merged into ${windows.length} beats of ≥ ${COMPARE.minScene} s` : `scenes from the render's cuts (${windows.length} shots)`,
    }
  }
  if (sb) {
    const [sbStat, renderStat] = [await stat(resolve(o.storyboard!)), await stat(render)]
    warnings.push(
      ...staleWarnings({
        sbDuration: storyboardDuration(sb),
        renderDuration: ourInfo.duration,
        fps: ourInfo.fps,
        sbMtimeMs: sbStat.mtimeMs,
        renderMtimeMs: renderStat.mtimeMs,
        sbName: basename(o.storyboard!),
      }),
    )
  }
  // Windows shorter than one frame cannot be measured.
  windows = windows.filter((w) => w.b - w.a >= 1 / ourInfo.fps - 1e-6)
  if (windows.length === 0) throw new Error('لا توجد مشاهد للمقارنة — No scenes to compare (the storyboard has no scene inside the render)')
  const report: CompareReport = {
    scenes: windows.map((w) => {
      const p = windowPace(ours.series, ANALYSIS_FPS, w.a, w.b)
      const q = windowPace(ref.series, ANALYSIS_FPS, w.a * ratio, w.b * ratio)
      return { id: w.id, a: w.a, b: w.b, ours: p, ref: q, verdict: sceneVerdict(w.a, w.b, p, q) }
    }),
    source,
    tiling,
    durations: { ours: r3(ours.duration), ref: r3(ref.duration), ratio: r3(ratio) },
    warnings,
  }
  if (o.style) {
    const whole = paceOf(ours.series, ANALYSIS_FPS, ours.duration)
    report.adherence = adherence(o.style, { ...whole, cutsPerSec: (await cutsOfRender()).length / ours.duration })
  }

  const outDir = resolve(o.outDir)
  await mkdir(outDir, { recursive: true })
  const tmp = await mkdtemp(join(tmpdir(), 'mba-compare-'))
  const video = join(outDir, 'compare.mp4')
  const part = `${video}.${process.pid}.tmp`
  try {
    const labels = await renderLabels(tmp)
    const r = await run(
      resolveFfmpeg(),
      buildCompareArgs({
        reference,
        render,
        refLabel: labels.ref,
        oursLabel: labels.ours,
        refDuration: refInfo.duration,
        oursDuration: ourInfo.duration,
        fps: ourInfo.fps,
        hasAudio: await hasAudio(render),
        out: part,
      }),
    )
    if (r.error || r.code !== 0) {
      throw new Error(`تعذّر إنشاء فيديو المقارنة — ffmpeg could not write compare.mp4 (${r.error ? r.error.message : `exit code ${r.code}`}): ${r.stderr.trim().slice(-1500)}`)
    }
    await renameWithRetry(part, video)
  } finally {
    await rm(part, { force: true }).catch(() => {})
    await rmWithRetry(tmp).catch(() => {})
  }
  await writeFileAtomic(join(outDir, 'compare.md'), compareMarkdown(report, basename(reference), basename(render)))
  await writeFileAtomic(join(outDir, 'compare.json'), JSON.stringify(report, null, 2) + '\n')
  return report
}
