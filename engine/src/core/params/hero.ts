import { z } from 'zod'
import { springStep, type Spring } from '../springs'
import { morphKey } from './common'

/**
 * One point of a hero's path: the hero ARRIVES there at `at` (scene-local s; an anchor in the
 * storyboard, R3). Either `x`, `y` (fractions of the safe area) or `target`, the `data-mba-key` of
 * an element in an earlier scene overlapping this one, whose glyph-box centre is measured at build.
 */
export const heroPoint = z
  .object({
    at: z.number().min(0),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
    target: z.string().min(1).optional(),
    /** Squash on arrival: sy 0.8 / sx 1.2 and back over `HERO.squashSec`. */
    squash: z.boolean().optional(),
  })
  .refine((pt) => (pt.target !== undefined) !== (pt.x !== undefined || pt.y !== undefined), {
    message: 'نقطة المسار إما x و y أو target — a path point is either x and y (safe-area fractions) or a target key',
  })
  .refine((pt) => pt.target !== undefined || (pt.x !== undefined && pt.y !== undefined), {
    message: 'نقطة المسار تحتاج x و y معًا — a path point needs both x and y',
  })

/**
 * Params of `hero`: one recurring element (a dot, a ball or a square) that travels between points
 * and lands on keyed elements of other scenes (a handoff: it arrives on the word as the word is
 * spoken). A `backdrop` with `react.hero` swells its `dots` around it.
 */
export const heroParams = z
  .object({
    shape: z.enum(['dot', 'ball', 'square']).default('dot'),
    /** Diameter (side for `square`) as a fraction of the frame width. */
    size: z.number().min(0.02).max(0.2).default(0.05),
    color: z.enum(['accent', 'fg']).default('accent'),
    path: z.array(heroPoint).min(2, { message: 'المسار يحتاج نقطتين على الأقل — path must have at least two points' }),
    /** `snappy` (ζ 0.75, ω 14) or `soft` (ζ 0.9, ω 8). */
    spring: z.enum(['soft', 'snappy']).default('snappy'),
    /** The segment travelled in the last `HERO.trailSec` drawn as a fading line behind the hero. */
    trail: z.boolean().default(false),
    /** Return to the first point at the scene end. */
    loop: z.boolean().default(false),
    key: morphKey,
  })
  .superRefine((p, ctx) => {
    for (let k = 1; k < p.path.length; k++) {
      if (!(p.path[k]!.at > p.path[k - 1]!.at)) {
        ctx.addIssue({ code: 'custom', path: ['path', k, 'at'], message: 'نقاط المسار مرتبة تصاعديًا حسب at — path points must be in ascending order of at' })
        return
      }
    }
  })

export type HeroParams = z.infer<typeof heroParams>

export const HERO = {
  /** A move to a point starts this long before its `at`, so the hero arrives on time (s). */
  springLead: 0.35,
  /** Squash on arrival: lasts this long (s) and peaks at these scales. */
  squashSec: 0.12,
  squashSx: 1.2,
  squashSy: 0.8,
  /** The trail covers this much of the past (s). */
  trailSec: 0.3,
} as const

/** The hero springs, as `springs.ts` springs (response = 2π / ω). */
export const HERO_SPRINGS: Record<HeroParams['spring'], Spring> = {
  snappy: { response: (2 * Math.PI) / 14, damping: 0.75 },
  soft: { response: (2 * Math.PI) / 8, damping: 0.9 },
}

/**
 * Progress of one move whose spring starts at τ = 0 and must arrive at τ = `lead`: the spring's
 * own step plus a correction that makes it exactly 1 at `lead` and fades away after it,
 * `s(τ) + (1 − s(lead)) · g(τ / lead)` with `g(u) = (u·e^(1−u))⁴` (g(0) = 0, g(1) = 1, g'(1) = 0,
 * g(∞) = 0). So the move keeps the spring's character (and its overshoot after arrival) and still
 * lands on the point at `at`. Closed form: a pure function of τ.
 */
export function moveProgress(tau: number, lead: number, s: Spring): number {
  if (!(tau > 0)) return 0
  const u = tau / lead
  const g = (u * Math.exp(1 - u)) ** 4
  return springStep(tau, s) + (1 - springStep(lead, s)) * g
}

export interface HeroPose {
  x: number
  y: number
  sx: number
  sy: number
}

/**
 * The hero at scene-local `t`, in frame px (`resolved[i]` = path point i in frame px). Before the
 * first point's `at` it rests there; the move to point k starts at `at_k − lead_k` (lead =
 * min(`HERO.springLead`, the gap since the previous point)) and arrives exactly at `at_k`
 * (moves superpose like `springTrack`, so a still-settling move blends into the next; with points
 * ≥ 1 s apart the arrival error is far below 0.5 px). A point with `squash` squashes the hero on
 * arrival. `loop`: the first point is appended at `end` (the scene's local length, duration +
 * preroll) when it is after the last point. Pure.
 */
export function heroAt(p: HeroParams, resolved: readonly { x: number; y: number }[], t: number, end?: number): HeroPose {
  const pts = p.path.map((pt, i) => ({ at: pt.at, squash: pt.squash === true, x: resolved[i]!.x, y: resolved[i]!.y }))
  if (p.loop && end !== undefined && end > pts.at(-1)!.at) pts.push({ ...pts[0]!, at: end })
  const spring = HERO_SPRINGS[p.spring]
  let x = pts[0]!.x
  let y = pts[0]!.y
  let squash = 0
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]!
    const b = pts[k]!
    const lead = Math.min(HERO.springLead, b.at - a.at)
    const m = moveProgress(t - (b.at - lead), lead, spring)
    x += (b.x - a.x) * m
    y += (b.y - a.y) * m
    if (b.squash && t >= b.at && t < b.at + HERO.squashSec) squash = Math.max(squash, Math.sin((Math.PI * (t - b.at)) / HERO.squashSec))
  }
  return { x, y, sx: 1 + (HERO.squashSx - 1) * squash, sy: 1 - (1 - HERO.squashSy) * squash }
}
