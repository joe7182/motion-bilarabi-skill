/**
 * Pure motion metrics over decoded grayscale frames (see frames.ts `grayFrames`). No I/O.
 *
 * Time conventions: frame k is shown over [k/fps, (k+1)/fps). `series[i]` is the change from frame i
 * to frame i+1, so it happens at the moment frame i+1 appears: (i+1)/fps.
 */

/**
 * Frame rate every motion metric is measured at: videos are decoded resampled to this rate
 * (`grayFrames`), whatever their own fps, so per-frame thresholds mean the same at 30 and 60 fps.
 */
export const ANALYSIS_FPS = 30

/**
 * Pace thresholds shared by `mba review` and `mba reference` (block mean |Δ|, 0..255, per
 * ANALYSIS_FPS frame): below `staticThr` consecutive frames are the same picture; static runs
 * shorter than `minStatic` s are dropped; a peak above `eventThr` is a motion event, events at
 * least `eventApart` s apart.
 */
export const PACE = { staticThr: 0.6, minStatic: 0.25, eventThr: 4, eventApart: 0.25 } as const

/** Frames in a fast-action strip. */
export const STRIP_FRAMES = 12

/** Mean absolute difference between consecutive frames, 0..255. Length frames − 1 (0 for < 2 frames). */
export function motionSeries(frames: Uint8Array[]): number[] {
  const out: number[] = []
  for (let k = 1; k < frames.length; k++) {
    const a = frames[k - 1]!
    const b = frames[k]!
    const n = Math.min(a.length, b.length)
    let sum = 0
    for (let i = 0; i < n; i++) sum += Math.abs(a[i]! - b[i]!)
    out.push(n ? sum / n : 0)
  }
  return out
}

/**
 * Local motion: for each pair of consecutive frames (w×h, row-major), the frame is split into a
 * cols×rows grid of blocks and the LARGEST block mean abs diff is kept (0..255). Unlike
 * `motionSeries`, motion confined to a small area (typing, a text wipe, a fading subtitle) is not
 * diluted by the static rest of the frame. Length frames − 1.
 */
export function blockMotionSeries(frames: Uint8Array[], w: number, h: number, cols = 6, rows = 8): number[] {
  const xs = Array.from({ length: cols + 1 }, (_, c) => Math.floor((c * w) / cols))
  const ys = Array.from({ length: rows + 1 }, (_, r) => Math.floor((r * h) / rows))
  const out: number[] = []
  for (let k = 1; k < frames.length; k++) {
    const a = frames[k - 1]!
    const b = frames[k]!
    let best = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0
        let n = 0
        for (let y = ys[r]!; y < ys[r + 1]!; y++) {
          const row = y * w
          for (let x = xs[c]!; x < xs[c + 1]!; x++) {
            sum += Math.abs(a[row + x]! - b[row + x]!)
            n++
          }
        }
        if (n && sum / n > best) best = sum / n
      }
    }
    out.push(best)
  }
  return out
}

/**
 * Stretches where the picture does not change: consecutive series values below `thr`. A run of
 * static diffs i..j means frames i..j+1 are the same picture, shown from i/fps until frame j+2
 * replaces it at (j+2)/fps. Runs shorter than `minDur` seconds are dropped.
 */
export function staticRuns(series: number[], fps: number, thr = 0.6, minDur = 0.25): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = []
  let i = 0
  while (i < series.length) {
    if (!(series[i]! < thr)) {
      i++
      continue
    }
    let j = i
    while (j + 1 < series.length && series[j + 1]! < thr) j++
    const start = i / fps
    const end = (j + 2) / fps
    if (end - start >= minDur - 1e-9) runs.push({ start, end })
    i = j + 1
  }
  return runs
}

/**
 * Indices of the strongest values, at least `minGap` indices apart (greedy, strongest first;
 * ties go to the earlier index). Only values passing `keep` are considered.
 */
function separatedPeaks(values: number[], minGap: number, keep: (v: number, i: number) => boolean, limit = Infinity): number[] {
  const idx = values.map((_, i) => i).filter((i) => keep(values[i]!, i))
  idx.sort((a, b) => values[b]! - values[a]! || a - b)
  const chosen: number[] = []
  for (const i of idx) {
    if (chosen.length >= limit) break
    if (chosen.every((c) => Math.abs(c - i) >= minGap - 1e-9)) chosen.push(i)
  }
  return chosen
}

/**
 * Motion events: local maxima of the series above `thr`, at least `minApart` seconds apart (the
 * larger of two close peaks wins). Returned in time order, as the time the new frame appears.
 */
export function eventTimes(series: number[], fps: number, thr = 4, minApart = 0.25): number[] {
  const n = series.length
  const isPeak = (v: number, i: number) =>
    v > thr && (i === 0 || v >= series[i - 1]!) && (i === n - 1 || v > series[i + 1]!)
  return separatedPeaks(series, minApart * fps, isPeak)
    .sort((a, b) => a - b)
    .map((i) => (i + 1) / fps)
}

/** The longest stretch without an event, counting start → first event and last event → end. */
export function maxEventGap(events: number[], duration: number): number {
  if (events.length === 0) return duration
  const ts = [...events].sort((a, b) => a - b)
  let gap = Math.max(ts[0]!, duration - ts[ts.length - 1]!)
  for (let i = 1; i < ts.length; i++) gap = Math.max(gap, ts[i]! - ts[i - 1]!)
  return gap
}

/** Grey levels a pixel must differ from its 3×3 neighbourhood mean to count as an edge pixel. */
export const DETAIL_EDGE = 8
/** Default near-blank threshold on `frameDetail`: fewer than 2 edge pixels per 1000 is blank. */
export const DETAIL_BLANK = 2

/**
 * High-pass detail of one w-wide grayscale frame: the per-mille (0..1000) of pixels that differ by
 * more than `DETAIL_EDGE` grey levels from the mean of their 3×3 neighbourhood (clamped at the
 * borders). Smooth backgrounds (flat fills, gradients, vignettes) score ~0; text, UI and any edge
 * content score well above `DETAIL_BLANK`. Without `w` the frame is treated as square.
 */
export function frameDetail(f: Uint8Array, w?: number): number {
  const n = f.length
  if (n === 0) return 0
  const W = w && w > 0 ? w : Math.max(1, Math.round(Math.sqrt(n)))
  const H = Math.floor(n / W)
  let edges = 0
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - 1)
    const y1 = Math.min(H - 1, y + 1)
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - 1)
      const x1 = Math.min(W - 1, x + 1)
      let sum = 0
      let cnt = 0
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
        sum += f[yy * W + xx]!
        cnt++
      }
      if (Math.abs(f[y * W + x]! - sum / cnt) > DETAIL_EDGE) edges++
    }
  }
  return (1000 * edges) / (W * H)
}

/**
 * Times (k/fps) of near-blank frames: `frameDetail(frame, w) < thr` (thr in edge pixels per 1000,
 * default `DETAIL_BLANK`). A frame showing only a background (flat, gradient or vignette) is blank;
 * one with any text or UI is not (R23: detail, not overall variance).
 */
export function nearBlank(frames: Uint8Array[], fps: number, thr: number = DETAIL_BLANK, w?: number): number[] {
  const out: number[] = []
  frames.forEach((f, k) => {
    if (frameDetail(f, w) < thr) out.push(k / fps)
  })
  return out
}

/** Groups frame times (k/fps) into runs of consecutive frames; a run ends where its last frame ends. */
export function runsOf(times: number[], fps: number): { start: number; end: number }[] {
  const ks = [...new Set(times.map((t) => Math.round(t * fps)))].sort((a, b) => a - b)
  const runs: { start: number; end: number }[] = []
  for (let i = 0; i < ks.length; ) {
    let j = i
    while (j + 1 < ks.length && ks[j + 1] === ks[j]! + 1) j++
    runs.push({ start: ks[i]! / fps, end: (ks[j]! + 1) / fps })
    i = j + 1
  }
  return runs
}

/**
 * The `n` moments of fastest change, at least `minApart` seconds apart, fastest first, as the time
 * the new frame appears. Changes below `minValue` (the static threshold) are not moments, so a
 * static or too-short clip returns fewer than `n`.
 */
export function fastestMoments(series: number[], fps: number, n = 2, minApart = 1.0, minValue = 0.6): number[] {
  return separatedPeaks(series, minApart * fps, (v) => v >= minValue, n).map((i) => (i + 1) / fps)
}

/**
 * The frames of a strip around a moment at time `t`: `STRIP_FRAMES` consecutive frames with the
 * frame at round(t·fps) as the 7th, clamped to the clip. A clip shorter than a strip uses every frame.
 */
export function stripWindow(t: number, fps: number, frames: number, size = STRIP_FRAMES): { start: number; count: number } {
  if (frames <= size) return { start: 0, count: Math.max(0, frames) }
  const centre = Math.round(t * fps)
  const start = Math.min(Math.max(centre - Math.floor(size / 2), 0), frames - size)
  return { start, count: size }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000

/** Median of `xs` (0 for none). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Pace of a block-motion series (`blockMotionSeries`), shared by `mba review` and `mba reference`. */
export interface Pace {
  /** Motion events (s), 3 decimals. */
  events: number[]
  /** Events per second of `duration`. */
  eventsPerSec: number
  /** Median gap between consecutive events (the whole max gap when there are fewer than 2 events). */
  medianEventGap: number
  /** Longest stretch without an event, counting from 0 and to `duration`. */
  maxEventGap: number
  /** 1 − total static-run time / duration (0..1). */
  movingPct: number
  longestStatic: number
}

/** Event density and static share of a block-motion series, with the `PACE` thresholds. */
export function paceOf(series: number[], fps: number, duration: number): Pace {
  const events = eventTimes(series, fps, PACE.eventThr, PACE.eventApart)
  const runs = staticRuns(series, fps, PACE.staticThr, PACE.minStatic)
  const gaps = events.slice(1).map((t, i) => t - events[i]!)
  const maxGap = maxEventGap(events, duration)
  const still = runs.reduce((a, r) => a + (r.end - r.start), 0)
  return {
    events: events.map(r3),
    eventsPerSec: duration > 0 ? r3(events.length / duration) : 0,
    medianEventGap: r3(gaps.length ? median(gaps) : maxGap),
    maxEventGap: r3(maxGap),
    movingPct: duration > 0 ? r3(Math.min(1, Math.max(0, 1 - still / duration))) : 0,
    longestStatic: r3(runs.reduce((m, r) => Math.max(m, r.end - r.start), 0)),
  }
}

/** An sRGB colour, 0..255 per channel. */
export type RGB = [number, number, number]

/** `#rrggbb` → [r, g, b]. */
export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) throw new Error(`لون غير صالح — Invalid colour: ${hex}`)
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
}

/** Default tolerance (largest channel difference, 0..255) for a frame's mean colour to count as the background. */
export const BG_TOLERANCE = 32

/**
 * Near-blank (flat) frame times that are really EMPTY. Without `bg` (plain video input) every flat
 * frame is empty. With the look's background `bg`, only frames whose mean colour (`colors[k]`, frame
 * k = round(t·fps)) is within `tol` of it on every channel: a flat full-frame cover in another
 * colour (a colour-wipe's accent, a fg flash) is a designed frame, not a blank one. `bg` may be a
 * list (one background per colour world): a frame is empty when it matches any of them.
 */
export function emptyFrames(flat: number[], fps: number, colors: RGB[], bg?: RGB | RGB[], tol: number = BG_TOLERANCE): number[] {
  if (!bg) return [...flat]
  const bgs: RGB[] = typeof bg[0] === 'number' ? [bg as RGB] : (bg as RGB[])
  return flat.filter((t) => {
    const c = colors[Math.round(t * fps)]
    return c !== undefined && bgs.some((b) => c.every((v, i) => Math.abs(v - b[i]!) <= tol))
  })
}

export interface BlankRun {
  start: number
  end: number
  /** Mean colour of the run's frames (rounded). */
  nearBlankColor: RGB
  /** True when the whole run lies inside a transition window (± one frame): drawn by design. */
  designed: boolean
}

/**
 * `runsOf(times, fps)` with each run's mean colour (`colors` per frame, as in `emptyFrames`) and
 * whether it lies inside one of the transition `windows` [a, b] (its first frame starts at or after
 * a − 1/fps and its last frame starts at or before b + 1/fps).
 */
export function blankRuns(times: number[], fps: number, colors: RGB[], windows: { a: number; b: number }[]): BlankRun[] {
  return runsOf(times, fps).map((r) => {
    const k0 = Math.round(r.start * fps)
    const k1 = Math.round(r.end * fps) - 1
    const sum = [0, 0, 0]
    let n = 0
    for (let k = k0; k <= k1; k++) {
      const c = colors[k]
      if (!c) continue
      c.forEach((v, i) => (sum[i]! += v))
      n++
    }
    const nearBlankColor = sum.map((v) => (n ? Math.round(v / n) : 0)) as RGB
    const slack = 1 / fps + 1e-9
    const designed = windows.some((w) => r.start >= w.a - slack && k1 / fps <= w.b + slack)
    return { ...r, nearBlankColor, designed }
  })
}
