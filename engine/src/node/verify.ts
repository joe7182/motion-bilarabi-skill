import type { Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CUT_TOLERANCE, sceneAt, storyboardDuration, trackOf, type Storyboard } from '../core/storyboard'
import { rng } from '../core/rng'
import { loadStoryboardFile, openRenderPage } from './render'
import type { FrameServerStats } from './framesrv'
import { diffPngs } from './png-diff'
import { loudnessVerdict, measureLoudness } from './audio'
import { latestRender } from './project'
import type { Project } from '../core/project'

export interface VerifyProbe {
  sceneId: string
  /** Absolute storyboard time in seconds. */
  t: number
}

export interface VerifyMismatch extends VerifyProbe {
  /** Pixels where any RGBA channel of the warm frame differs from the cold one. */
  diffPixels: number
  /** Largest channel delta (0..255). */
  maxChannelDelta: number
  /** The cold frame (fresh page, one seek), written only because it mismatched. */
  coldPng: string
  /** The warm frame (long-lived page after the random seek history). */
  warmPng: string
  /** True when the cold redraw differed from the first cold draw (the cold frame itself is unstable). */
  unstable?: boolean
}

export interface VerifyOptions {
  storyboardPath: string
  /** Probes per scene: the first N of `PROBE_FRACTIONS` (default 5; values above 5 are clamped to 5). */
  samplesPerScene?: number
  /**
   * Absolute times (seconds) probed in addition to the per-scene samples. Each is attributed to the
   * scene visible at that time (`sceneAt`). When omitted, `defaultExtraTimes(storyboard)` is used
   * (every transition window and hard cut); when given, it REPLACES those derived times (so `[]`
   * probes the scene samples only).
   */
  extraTimes?: number[]
  /**
   * Most probes in total (default `DEFAULT_PROBE_BUDGET`): cut/transition probes come first, the
   * per-scene samples share the rest in proportion to scene duration (`planProbes`).
   */
  probeBudget?: number
  /**
   * Where the cold and warm PNGs of a mismatch go (nothing is written when every probe matches).
   * Default: `<project>/review/verify` for a project storyboard, else a new folder in the OS temp.
   */
  mismatchDir?: string
  /** Seed of the warm pass's random seek history (default 1). */
  seed?: number
  /** Called after every probe frame (cold and warm): total = 2 × probes. */
  onProgress?: (done: number, total: number) => void
  /**
   * Test only (hidden CLI flag `--test-primitives`): source of a browser function returning test
   * primitives. The page is then opened with `?test=1` and `_`-prefixed unknown scene types parse.
   */
  testPrimitivesSource?: string
}

export interface VerifyResult {
  probes: VerifyProbe[]
  mismatches: VerifyMismatch[]
  /** Uncaught page errors logged while probing (cold and warm). Any error fails the check. */
  pageErrors: string[]
  /** Frame-server statistics (project storyboards only); `onDemand` is 0 when every probe was prepared. */
  frames?: FrameServerStats
  /** The budget the probes were planned under. */
  probeBudget: number
  /** Wall time of the whole check (load, cold and warm passes), seconds. */
  wallSec: number
  /** The folder holding the mismatch PNGs; only set when there is a mismatch. */
  mismatchDir?: string
}

/** Default total probe count: a 3-minute edit is checked in minutes, not tens of minutes. */
export const DEFAULT_PROBE_BUDGET = 60

/** Probes whose video frames are prepared (and released) together. */
export const VERIFY_BATCH = 10

/** Probe times per scene: `start + f · duration` for these fractions (inside the scene, away from its cuts). */
export const PROBE_FRACTIONS = [0.08, 0.3, 0.5, 0.7, 0.92] as const

/** Seeks to random times over the whole storyboard before each warm probe. */
export const WARM_SEEKS = 6

/** The probes for a parsed storyboard, in scene order. */
export function verifyProbes(sb: Storyboard, samplesPerScene: number = PROBE_FRACTIONS.length): VerifyProbe[] {
  if (!Number.isInteger(samplesPerScene) || samplesPerScene < 1) {
    throw new Error(`عدد العينات غير صالح — samplesPerScene must be an integer >= 1, got ${samplesPerScene}`)
  }
  const fractions = PROBE_FRACTIONS.slice(0, Math.min(samplesPerScene, PROBE_FRACTIONS.length))
  const probes: VerifyProbe[] = []
  for (const sc of sb.scenes) {
    for (const f of fractions) {
      const t = Math.min(Math.max(sc.start + f * sc.duration, sc.start), sc.start + sc.duration)
      probes.push({ sceneId: sc.id, t })
    }
  }
  return probes
}

/** Re-exported: `sceneAt` lives in core/storyboard (pure, shared with unit tests). */
export { sceneAt }

/**
 * The extra probe times a storyboard needs beyond its per-scene samples, so cuts and transition
 * windows are always checked:
 * - each transition: at − d/4, at − 1/fps, at, at + 1/fps, at + d/4;
 * - each hard cut, per track (a scene end that equals the start of another scene on the SAME track
 *   within CUT_TOLERANCE, with no transition on that track there): cut − 1/fps and cut (the
 *   incoming scene's start). A scene ending where a scene on another track starts is not a cut.
 * Clamped to [0, duration], deduped (to 1e-9 s) and sorted.
 */
export function defaultExtraTimes(sb: Storyboard): number[] {
  return dedupeSorted(defaultExtraUnits(sb).flat())
}

/**
 * `defaultExtraTimes` grouped into probe UNITS that the probe budget keeps or drops whole: one unit
 * per transition (its window of 5 times) and one per hard cut (cut − 1/fps and cut), clamped to
 * [0, duration], in storyboard order (transitions, then cuts).
 */
export function defaultExtraUnits(sb: Storyboard): number[][] {
  return defaultExtraTracked(sb).map((u) => u.times)
}

/** `defaultExtraUnits` with the track of each unit's transition or cut (so probes name that track's scene). */
function defaultExtraTracked(sb: Storyboard): { times: number[]; track: number }[] {
  const frame = 1 / sb.fps
  const end = storyboardDuration(sb)
  const clamp = (x: number) => Math.min(Math.max(x, 0), end)
  const units: { times: number[]; track: number }[] = []
  const trs = sb.transitions ?? []
  for (const tr of trs) {
    units.push({ times: [tr.at - tr.duration / 4, tr.at - frame, tr.at, tr.at + frame, tr.at + tr.duration / 4].map(clamp), track: trackOf(tr) })
  }
  for (const out of sb.scenes) {
    const scEnd = out.start + out.duration
    const track = trackOf(out)
    const into = sb.scenes.find((o) => o !== out && trackOf(o) === track && Math.abs(o.start - scEnd) <= CUT_TOLERANCE)
    if (!into) continue
    if (trs.some((tr) => trackOf(tr) === track && Math.abs(tr.at - scEnd) <= CUT_TOLERANCE)) continue
    units.push({ times: [into.start - frame, into.start].map(clamp), track })
  }
  return units
}

const timeKey = (t: number): number => Math.round(t * 1e9)

/** Sorted, deduped to 1e-9 s. */
function dedupeSorted(times: readonly number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const t of [...times].sort((x, y) => x - y)) {
    const key = timeKey(t)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/**
 * Probes at absolute times `extraTimes` (clamped to the storyboard), attributed with `sceneAt`;
 * `trackAt` gives the track a time belongs to (a derived cut/transition probe), else every track counts.
 */
export function extraProbes(sb: Storyboard, extraTimes: readonly number[], trackAt?: (t: number) => number | undefined): VerifyProbe[] {
  const end = storyboardDuration(sb)
  return extraTimes.map((t) => {
    if (!Number.isFinite(t)) throw new Error(`وقت فحص غير صالح — extraTimes must be finite numbers, got ${t}`)
    const tt = Math.min(Math.max(t, 0), end)
    return { sceneId: sceneAt(sb, tt, trackAt?.(tt)), t: tt }
  })
}

/**
 * Samples per scene for a budget: up to `cap` each; when the budget is short, every scene gets one
 * (the longest scenes first if there are fewer samples than scenes, ties spread evenly in time) and
 * the rest go by duration (D'Hondt: the next sample goes to the scene with the largest
 * duration / (samples + 1), ties to the earlier scene). Deterministic; the total is min(budget, cap × scenes).
 */
export function allocateSamples(durations: readonly number[], cap: number, budget: number): number[] {
  const n = durations.length
  const out = new Array<number>(n).fill(0)
  if (n === 0 || cap < 1 || budget < 1) return out
  if (budget >= cap * n) return out.fill(cap)
  if (budget < n) {
    // The longest scenes; among scenes tied at the cut-off duration, evenly spaced ones (in time).
    const thr = [...durations].sort((a, b) => b - a)[budget - 1]!
    const above = durations.flatMap((d, i) => (d > thr ? [i] : []))
    const tied = durations.flatMap((d, i) => (d === thr ? [i] : []))
    const need = budget - above.length
    const picked =
      need === 1 ? [tied[Math.floor((tied.length - 1) / 2)]!] : Array.from({ length: need }, (_, j) => tied[Math.round((j * (tied.length - 1)) / (need - 1))]!)
    for (const i of [...above, ...picked]) out[i] = 1
    return out
  }
  out.fill(1)
  for (let left = budget - n; left > 0; left--) {
    let best = -1
    for (let i = 0; i < n; i++) {
      if (out[i]! >= cap) continue
      if (best < 0 || durations[i]! / (out[i]! + 1) > durations[best]! / (out[best]! + 1)) best = i
    }
    if (best < 0) break
    out[best]!++
  }
  return out
}

/** Share of the budget reserved for scene samples (one per scene) before cut/transition units. */
export const SCENE_FLOOR_SHARE = 0.2

/**
 * Order in which fractions are used when the budget gives a scene fewer samples than requested:
 * the midpoint first, then spread towards the ends (used sorted by time).
 */
export const BUDGET_FRACTION_ORDER = [0.5, 0.08, 0.92, 0.3, 0.7] as const

/**
 * `units` (each a list of times) whose total size fits `capacity`, as many as possible, picked at
 * evenly spaced positions of the units sorted by their mean time (first and last included), so the
 * kept units spread over the whole storyboard. Returns the chosen units in time order.
 */
export function selectUnits(units: readonly (readonly number[])[], capacity: number): number[][] {
  const sorted = units
    .map((u) => ({ u: [...u], at: u.reduce((x, y) => x + y, 0) / Math.max(1, u.length) }))
    .sort((x, y) => x.at - y.at)
    .map((x) => x.u)
  const size = (us: number[][]) => us.reduce((n, u) => n + u.length, 0)
  if (size(sorted) <= capacity) return sorted
  for (let k = sorted.length - 1; k >= 1; k--) {
    const idx = k === 1 ? [0] : [...new Set(Array.from({ length: k }, (_, j) => Math.round((j * (sorted.length - 1)) / (k - 1))))]
    const pick = idx.map((i) => sorted[i]!)
    if (size(pick) <= capacity) return pick
  }
  return []
}

/**
 * The probes `verifyDeterminism` runs: per-scene samples (scene order), then the cut/transition
 * probes (`extraTimes`, default `defaultExtraTimes`). Under `probeBudget` (default 60) this is
 * exactly every scene's first `samplesPerScene` fractions plus every extra probe. Over budget (R9):
 * 1. a scene-sample floor is reserved first: one per scene, at most `SCENE_FLOOR_SHARE` (20 %) of
 *    the budget (at least 1), so scenes are always sampled;
 * 2. cut/transition probes are kept as whole units (`defaultExtraUnits`: a hard cut's pair, a
 *    transition's window of 5; each explicit `extraTimes` entry is its own unit), as many as fit
 *    in the rest, spread evenly over time (`selectUnits`);
 * 3. scene samples take everything left, in proportion to scene duration (`allocateSamples`); a
 *    scene given fewer samples than requested uses `BUDGET_FRACTION_ORDER` (midpoint first).
 */
export function planProbes(
  sb: Storyboard,
  o: { samplesPerScene?: number; extraTimes?: readonly number[]; probeBudget?: number } = {},
): VerifyProbe[] {
  const budget = o.probeBudget ?? DEFAULT_PROBE_BUDGET
  if (!Number.isInteger(budget) || budget < 1) {
    throw new Error(`ميزانية الفحوص غير صالحة — probeBudget must be an integer >= 1, got ${budget}`)
  }
  const per = o.samplesPerScene ?? PROBE_FRACTIONS.length
  verifyProbes(sb, per) // validates samplesPerScene
  const cap = Math.min(per, PROBE_FRACTIONS.length)
  const n = sb.scenes.length
  let extraTimes = o.extraTimes ?? defaultExtraTimes(sb)
  // Derived probes name the scene on their transition's or cut's track (the first unit wins a shared time).
  const tracks = new Map<number, number>()
  if (!o.extraTimes) for (const u of defaultExtraTracked(sb)) for (const t of u.times) if (!tracks.has(timeKey(t))) tracks.set(timeKey(t), u.track)
  const trackAt = (t: number) => tracks.get(timeKey(t))
  const wanted = n * cap + extraProbes(sb, extraTimes).length
  if (wanted > budget) {
    const floor = Math.min(n, Math.max(1, Math.floor(budget * SCENE_FLOOR_SHARE)))
    const units = o.extraTimes ? o.extraTimes.map((t) => [t]) : defaultExtraUnits(sb)
    extraTimes = dedupeSorted(selectUnits(units, Math.max(0, budget - floor)).flat())
  }
  const extras = extraProbes(sb, extraTimes, trackAt)
  const counts = allocateSamples(
    sb.scenes.map((sc) => sc.duration),
    cap,
    budget - extras.length,
  )
  const samples: VerifyProbe[] = []
  sb.scenes.forEach((sc, i) => {
    const k = counts[i]!
    const fractions = k >= cap ? PROBE_FRACTIONS.slice(0, k) : BUDGET_FRACTION_ORDER.slice(0, k).sort((x, y) => x - y)
    for (const f of fractions) {
      samples.push({ sceneId: sc.id, t: Math.min(Math.max(sc.start + f * sc.duration, sc.start), sc.start + sc.duration) })
    }
  })
  return [...samples, ...extras]
}

const sha1 = (b: Buffer): string => createHash('sha1').update(b).digest('hex')

async function grab(page: Page, size: { w: number; h: number }): Promise<Buffer> {
  return page.screenshot({ clip: { x: 0, y: 0, width: size.w, height: size.h }, type: 'png', caret: 'hide' })
}

/** Mismatch PNG names: `p07-<scene>-12.345s-cold.png` / `-warm.png`. */
const MISMATCH_PNG = /^p\d+-.*-(cold|warm)\.png$/

function probeFileBase(i: number, p: VerifyProbe): string {
  return `p${String(i + 1).padStart(2, '0')}-${p.sceneId.replace(/[^\p{L}\p{N}_-]/gu, '_')}-${p.t.toFixed(3)}s`
}

/**
 * Determinism check: every probe frame drawn on a fresh page (cold: a full reload, then exactly one
 * seek) must equal, pixel for pixel, the same frame drawn on one long-lived page (warm) after
 * `WARM_SEEKS` seeks to times drawn from `rng(seed)` across the whole storyboard. Each seek is
 * awaited before the next (R7), so no seek is ever superseded.
 * - Probes: `planProbes`, at most `probeBudget` (default 60).
 * - Cold frames are kept as SHA-1 hashes only. A warm frame whose hash differs is redrawn cold after
 *   the warm pass, and both PNGs are written to `mismatchDir`. It is a mismatch when any pixel
 *   differs, or when the cold redraw differs from the first cold draw.
 * - Video frames (project storyboards) are prepared and released per batch of `VERIFY_BATCH`
 *   probes, never for the whole video.
 * Any uncaught page error while probing is returned in `pageErrors` and fails the check too.
 * Same Chromium settings as `renderVideo`/`renderStills` (shared `openRenderPage`).
 */
export async function verifyDeterminism(o: VerifyOptions): Promise<VerifyResult> {
  const t0 = performance.now()
  const test = o.testPrimitivesSource !== undefined
  const loaded = await loadStoryboardFile(o.storyboardPath, { testTypes: test })
  const probeBudget = o.probeBudget ?? DEFAULT_PROBE_BUDGET
  const probes = planProbes(loaded.sb, {
    samplesPerScene: o.samplesPerScene ?? PROBE_FRACTIONS.length,
    ...(o.extraTimes !== undefined ? { extraTimes: o.extraTimes } : {}),
    probeBudget,
  })
  const duration = storyboardDuration(loaded.sb)
  const total = probes.length * 2
  let done = 0
  const tick = () => o.onProgress?.(++done, total)

  // The warm pass's seek history, drawn up front (same order as before) so its frames can be prepared.
  const rand = rng(o.seed ?? 1)
  const warmSeeks = probes.map(() => Array.from({ length: WARM_SEEKS }, () => rand() * duration))

  const dir =
    o.mismatchDir ??
    (loaded.project ? join(loaded.project.dir, 'review', 'verify') : join(tmpdir(), `mba-verify-${process.pid}-${Date.now()}`))
  // PNGs of an earlier run would read as this run's: cleared at the start of every run.
  const old = await readdir(dir).catch(() => [] as string[])
  for (const f of old) if (MISMATCH_PNG.test(f)) await rm(join(dir, f), { force: true })
  if (old.length) await rmdir(dir).catch(() => {}) // only if that left it empty
  let dirReady = false
  const writePng = async (name: string, png: Buffer): Promise<string> => {
    if (!dirReady) {
      await mkdir(dir, { recursive: true })
      dirReady = true
    }
    const file = join(dir, name)
    await writeFile(file, png)
    return file
  }

  const rp = await openRenderPage(loaded, test ? { test, testPrimitivesSource: o.testPrimitivesSource } : {})
  try {
    const { page, size } = rp
    const batches: number[][] = []
    for (let b = 0; b < probes.length; b += VERIFY_BATCH) {
      batches.push(Array.from({ length: Math.min(VERIFY_BATCH, probes.length - b) }, (_, k) => b + k))
    }

    // Cold: the page right after open (or a full reload) has only drawn the stage's initial t = 0.
    const cold: string[] = []
    for (const batch of batches) {
      const times = batch.map((i) => probes[i]!.t)
      await rp.prepareTimes(times)
      for (const i of batch) {
        if (i > 0) await rp.reload()
        await rp.seek(probes[i]!.t)
        cold[i] = sha1(await grab(page, size))
        tick()
      }
      await rp.releaseTimes(times)
    }

    // Warm: one page, a long random seek history before every probe.
    await rp.reload()
    const suspects: { i: number; warmPng: string }[] = []
    for (const batch of batches) {
      const times = batch.flatMap((i) => [...warmSeeks[i]!, probes[i]!.t])
      await rp.prepareTimes(times)
      for (const i of batch) {
        for (const t of warmSeeks[i]!) await rp.seek(t)
        await rp.seek(probes[i]!.t)
        const png = await grab(page, size)
        if (sha1(png) !== cold[i]) suspects.push({ i, warmPng: await writePng(`${probeFileBase(i, probes[i]!)}-warm.png`, png) })
        tick()
      }
      await rp.releaseTimes(times)
    }
    // Let a last microtask/task error from the final seek reach the pageerror listener.
    await page.evaluate(() => new Promise<void>((res) => queueMicrotask(res)))

    // Suspects: redraw the cold frame (the warm pass is over) and keep both PNGs of a real mismatch.
    const mismatches: VerifyMismatch[] = []
    for (const { i, warmPng } of suspects) {
      const p = probes[i]!
      await rp.prepareTimes([p.t])
      await rp.reload()
      await rp.seek(p.t)
      const png = await grab(page, size)
      await rp.releaseTimes([p.t])
      const d = diffPngs(png, await readFile(warmPng))
      const unstable = sha1(png) !== cold[i]
      if (d.diffPixels > 0 || unstable) {
        mismatches.push({ ...p, ...d, coldPng: await writePng(`${probeFileBase(i, p)}-cold.png`, png), warmPng, ...(unstable ? { unstable } : {}) })
      } else {
        await rm(warmPng, { force: true }) // the same pixels in different PNG bytes: not a mismatch
      }
    }
    if (dirReady && mismatches.length === 0) await rmdir(dir).catch(() => {}) // only if left empty
    return {
      probes,
      mismatches,
      pageErrors: rp.pageErrors(),
      ...(rp.frames ? { frames: rp.frames.stats() } : {}),
      probeBudget,
      wallSec: (performance.now() - t0) / 1000,
      ...(mismatches.length ? { mismatchDir: dir } : {}),
    }
  } finally {
    await rp.close()
  }
}

export { latestRender } from './project'

/**
 * `mba verify` check `loudness`: the project's newest render must be −14 ± 1 LUFS with a true peak
 * ≤ −1 dBTP (`loudnessVerdict`). `file: null` when there is no render yet (nothing to check).
 */
export async function verifyLoudness(project: Project): Promise<{ file: string | null; ok: boolean; message: string }> {
  const file = await latestRender(project)
  if (!file) return { file, ok: true, message: 'لا يوجد عرض بعد، لم يُفحص مستوى الصوت — Loudness: no render yet, not checked' }
  const v = loudnessVerdict(await measureLoudness(file))
  return { file, ...v }
}
