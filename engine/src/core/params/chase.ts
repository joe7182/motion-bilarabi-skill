import { z } from 'zod'
import type { Cue } from '../audio-plan'
import type { Pt } from '../morph'
import { rng } from '../rng'
import { safePoint } from './line-art'
import { morphKey } from './common'

/**
 * Params of `chase` (Plan 3 Task 6c, "follow your customers"): small customer figures run along a
 * seeded closed curve, always just ahead of the accent pursuer (the hero dot), which gains on them
 * but never catches them.
 */
export const chaseParams = z.object({
  customers: z
    .number()
    .int({ error: 'عدد العملاء عدد صحيح — customers must be a whole number' })
    .min(3, { error: 'العملاء من ٣ إلى ٧ — customers must be 3 to 7' })
    .max(7, { error: 'العملاء من ٣ إلى ٧ — customers must be 3 to 7' })
    .default(4),
  /** Centre of the loop in the safe area (fractions). */
  at: safePoint.default({ x: 0.5, y: 0.5 }),
  /** The loop's width as a fraction of the safe width. */
  size: z.number().min(0.3).max(0.9).default(0.6),
  /** Laps the pursuer runs over the scene. */
  laps: z.number().min(0.1).max(8).default(1.2),
  key: morphKey,
})

export type ChaseParams = z.infer<typeof chaseParams>

/**
 * Lengths are fractions of the safe width unless noted.
 *
 * - The curve: an ellipse `squash` as tall as it is wide, its radius wobbled by seeded 2nd and 3rd
 *   harmonics (amplitudes in `wobble2` / `wobble3`), kept convex enough that a short arc is close to
 *   its chord; sampled at `dense` points and walked by arc length.
 * - The pack: the nearest customer runs `gapMin`..`gapMax` ahead of the pursuer along the curve
 *   (oscillating over `gapPeriod` s: it gains, then they pull away); the others follow at
 *   `spacing` (± `jitter`, a slow seeded sway). A small loop scales the pack down to `packShare` of
 *   its length, never the gap below `gapMin`.
 * - Drawing: figures `figH` tall, the pursuer `dotD` across with a dotted trail of `trail.n` dots
 *   `trail.step` apart; things pop in `stagger` s apart over `enterSec`; a stride is `stride` Hz.
 * - Sound: a `tap` every `tapEvery` s, at most `maxTaps`.
 */
export const CHASE = {
  squash: 0.72,
  wobble2: [0.04, 0.09],
  wobble3: [0.015, 0.045],
  dense: 480,
  gapMin: 0.075,
  gapMax: 0.17,
  gapPeriod: 1.7,
  spacing: 0.085,
  jitter: 0.012,
  packShare: 0.6,
  figH: 0.095,
  dotD: 0.05,
  trail: { n: 14, step: 0.02 },
  enterSec: 0.4,
  stagger: 0.07,
  stride: 3.4,
  tapEvery: 0.4,
  maxTaps: 6,
} as const

/** The seeded loop: dense points, cumulative arc length, total length (frame px). */
export interface ChaseCurve {
  pts: Pt[]
  cum: number[]
  len: number
  /** The pack's spacing, gap range and the figure height, in px (scaled to the loop). */
  spacing: number
  gapMin: number
  gapMax: number
  figH: number
  /** Amplitude of the followers' sway (px) and its seeded phases. */
  sway: number
  phases: number[]
}

type Safe = { x: number; y: number; w: number; h: number }

/**
 * The loop for `seed` (pure): centred at `p.at` in the safe area, `p.size` × the safe width
 * across, shrunk and moved so the curve and the figures standing on it stay inside the safe area.
 */
export function chaseCurve(seed: number, p: Pick<ChaseParams, 'at' | 'size' | 'customers'>, safe: Safe): ChaseCurve {
  const r = rng((seed * 2654435761 + 977) >>> 0)
  const a2 = CHASE.wobble2[0] + (CHASE.wobble2[1] - CHASE.wobble2[0]) * r()
  const a3 = CHASE.wobble3[0] + (CHASE.wobble3[1] - CHASE.wobble3[0]) * r()
  const f2 = 2 * Math.PI * r()
  const f3 = 2 * Math.PI * r()
  const wob = 1 + a2 + a3
  const figH = CHASE.figH * safe.w
  const margin = 0.03 * safe.w
  const R = Math.max(10, Math.min((p.size * safe.w) / 2, (safe.w / 2 - margin - figH * 0.3) / wob, (safe.h / 2 - figH - margin) / (CHASE.squash * wob)))
  const ex = R * wob + figH * 0.3 + margin
  const eyTop = CHASE.squash * R * wob + figH + margin
  const eyBot = CHASE.squash * R * wob + margin
  const cx = Math.min(Math.max(safe.x + p.at.x * safe.w, safe.x + ex), safe.x + safe.w - ex)
  const cy = Math.min(Math.max(safe.y + p.at.y * safe.h, safe.y + eyTop), safe.y + safe.h - eyBot)
  const pts: Pt[] = []
  for (let i = 0; i < CHASE.dense; i++) {
    // clockwise on screen (y down): along the bottom the runners head right → left
    const th = (2 * Math.PI * i) / CHASE.dense
    const rr = R * (1 + a2 * Math.sin(2 * th + f2) + a3 * Math.sin(3 * th + f3))
    pts.push([cx + rr * Math.cos(th), cy + CHASE.squash * rr * Math.sin(th)])
  }
  const cum = [0]
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    cum.push(cum[i]! + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const len = cum[pts.length]!
  const want = CHASE.gapMax * safe.w + (p.customers - 1) * CHASE.spacing * safe.w
  const k = Math.min(1, (CHASE.packShare * len) / want)
  const gapMin = CHASE.gapMin * safe.w
  return {
    pts,
    cum,
    len,
    spacing: CHASE.spacing * safe.w * k,
    gapMin,
    gapMax: Math.max(gapMin * 1.6, CHASE.gapMax * safe.w * k),
    figH,
    sway: CHASE.jitter * safe.w * k,
    phases: Array.from({ length: p.customers }, () => 2 * Math.PI * r()),
  }
}

/** A point on the curve at arc length `s` (any real; wraps), with the unit tangent (direction of travel). */
export function chasePoint(c: ChaseCurve, s: number): { x: number; y: number; dx: number; dy: number } {
  const n = c.pts.length
  let u = s % c.len
  if (u < 0) u += c.len
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (c.cum[mid]! <= u) lo = mid
    else hi = mid
  }
  const a = c.pts[lo]!
  const b = c.pts[(lo + 1) % n]!
  const seg = c.cum[lo + 1]! - c.cum[lo]!
  const f = seg > 0 ? (u - c.cum[lo]!) / seg : 0
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, dx: (b[0] - a[0]) / d, dy: (b[1] - a[1]) / d }
}

export interface ChaseBody {
  /** Arc length along the curve (unwrapped: figures are always ahead of the pursuer). */
  s: number
  x: number
  y: number
  dx: number
  dy: number
}

/**
 * Where everyone is at local `t` (pure, closed form): the pursuer runs `laps` laps over the
 * scene at a constant speed; the nearest customer is `gap(t)` ahead, the gap breathing between
 * `gapMin` and `gapMax` (`gapPeriod`); the others follow at `spacing` with a small sway.
 */
export function chasePose(p: Pick<ChaseParams, 'laps' | 'customers'>, c: ChaseCurve, t: number, duration: number): { pursuer: ChaseBody; figures: ChaseBody[]; gap: number } {
  const len = Math.max(duration, 1e-3)
  const sp = (c.len * p.laps * t) / len
  const gap = c.gapMin + (c.gapMax - c.gapMin) * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / CHASE.gapPeriod))
  const at = (s: number): ChaseBody => ({ s, ...chasePoint(c, s) })
  return {
    pursuer: at(sp),
    figures: Array.from({ length: p.customers }, (_, k) => at(sp + gap + k * c.spacing + (k > 0 ? c.sway * Math.sin(2 * Math.PI * 0.8 * t + c.phases[k]!) : 0))),
    gap,
  }
}

/** Sound: a `tap` every `CHASE.tapEvery` s inside the scene, at most `CHASE.maxTaps`. */
export function cuesOfChase(_p: ChaseParams, ctx: { duration: number }): Cue[] {
  const out: Cue[] = []
  for (let i = 0; i < CHASE.maxTaps && i * CHASE.tapEvery < ctx.duration - 1e-9; i++) out.push({ t: i * CHASE.tapEvery, kind: 'action' })
  return out
}
