import { z } from 'zod'
import type { Cue } from '../audio-plan'
import type { Storyboard } from '../storyboard'
import { clamp01, seg } from '../ease'
import { covers } from './highlight'

const frac = z.number().min(0).max(1)

export const PARTICLE_WORD = {
  /** `land` must come at least this long after `burst` (s). */
  minFlight: 0.3,
  /** Most particles a word may have. */
  maxCount: 6000,
  /** Ink area (px²) per particle: count ≈ ink area / density, so the dots tile the silhouette. */
  density: 18,
  /** From `land` the particles fade out over this long while the DOM word fades in (s). */
  fade: 0.25,
  /** A particle leaves `delay` ∈ [0, delay]·flight after the burst … */
  delay: 0.3,
  /** … and flies for `dur` ∈ [dur[0], dur[1]]·flight, arriving by `land` at the latest. */
  dur: [0.55, 0.7] as const,
  /** Start jitter around the source (± px). */
  jitter: 8,
  /** The arc's control point: this far from the start (× the safe area's short side), 1.2× vertically. */
  reach: [0.19, 0.68] as const,
  reachY: 1.2,
  /** Control points stay this far inside the safe area (× its short side). */
  inset: 0.08,
  /** Sideways arc amplitude (× the safe area's short side) × swirl ∈ ±[swirl[0], swirl[1]]; zero at both ends. */
  arc: 0.043,
  swirl: [0.5, 1.8] as const,
  /** Dots swell by up to this share mid-flight. */
  swell: 0.9,
  /** After arrival: a small settle along a seeded direction, amp·e^(−decay·k)·sin(freq·k) px. */
  wobble: { amp: 4, decay: 7, freq: 20 },
  /** Dot radius × the grid step. */
  radius: [0.46, 0.62] as const,
  /** Flash ring at the burst: grows by `reach` × the safe short side (expo.out) over `sec`, stroke `width` → 1 px. */
  flash: { sec: 0.36, reach: 0.34, width: 10 },
  /** Radius of the source when it is a point (× the safe width): the hero dot's size. */
  dot: 0.02,
} as const

/**
 * Params of `particle-word` (Plan 3): at `burst` the hero bursts into particles that gather into
 * the silhouette of a DOM word (`target`, the `data-mba-key` of a kinetic-text word shown from
 * `land` on) and hand over to it.
 */
export const particleWordParams = z
  .object({
    /** `data-mba-key` of the DOM word the particles become (an earlier scene shown over this whole scene). */
    target: z.string().min(1),
    /** Where the particles come from: a `morph-object` scene (its object at `burst`) or a point in the safe area (fractions). */
    from: z.union([z.object({ scene: z.string().min(1) }).strict(), z.object({ x: frac, y: frac }).strict()], {
      error: 'المصدر مشهد أو نقطة — from must be { scene } or { x, y } (safe-area fractions)',
    }),
    /** Local s: the burst. */
    burst: z.number().min(0),
    /** Local s: every particle is on its target; the particles fade out over `PARTICLE_WORD.fade`. */
    land: z.number().min(0),
    /** Cap on the particle count (default `PARTICLE_WORD.maxCount`). */
    count: z
      .number()
      .int()
      .min(1)
      .max(PARTICLE_WORD.maxCount, { message: `عدد الجسيمات لا يزيد عن ٦٠٠٠ — count must be at most ${PARTICLE_WORD.maxCount}` })
      .optional(),
  })
  .superRefine((p, ctx) => {
    if (!(p.land > p.burst + PARTICLE_WORD.minFlight)) {
      ctx.addIssue({
        code: 'custom',
        path: ['land'],
        message: `وقت الهبوط يجب أن يتأخر أكثر من ٠٫٣ ث عن الانفجار — land must be more than ${PARTICLE_WORD.minFlight} s after burst`,
      })
    }
  })

export type ParticleWordParams = z.infer<typeof particleWordParams>

/** Scene-level check: the particles land before the scene ends. */
export function timingIssueOfParticleWord(p: ParticleWordParams, sceneLen: number) {
  if (p.land < sceneLen) return undefined
  return {
    path: ['land'],
    ar: 'الجسيمات تهبط بعد نهاية المشهد',
    en: `land (${p.land} s) is at or after the scene end (${sceneLen} s local, duration + preroll)`,
  }
}

/**
 * Storyboard-level check: `target` is a key in an earlier scene shown over the whole of scene `i`
 * (what `ctx.keyed` needs at build), and `from.scene` names a `morph-object` scene.
 */
export function targetIssueOfParticleWord(sb: Storyboard, i: number, p: ParticleWordParams) {
  const me = sb.scenes[i]!
  const keys = (sc: { params: Record<string, unknown> }) => {
    const ps = sc.params as { key?: unknown; words?: { key?: unknown }[] } | undefined
    return [ps?.key, ...(Array.isArray(ps?.words) ? ps.words.map((w) => w?.key) : [])]
  }
  if (!sb.scenes.slice(0, i).some((sc) => keys(sc).includes(p.target) && covers(sc, me))) {
    return {
      path: ['target'],
      ar: `لا يوجد مشهد سابق يغطي مدة المشهد كلها فيه الكلمة ذات المفتاح «${p.target}»`,
      en: `no earlier scene shown over this whole scene has key "${p.target}"`,
    }
  }
  if ('scene' in p.from) {
    const id = p.from.scene
    if (sb.scenes.find((o) => o.id === id)?.type !== 'morph-object') {
      return {
        path: ['from', 'scene'],
        ar: `لا يوجد مشهد morph-object بالمعرّف «${id}»`,
        en: `there is no morph-object scene "${id}"`,
      }
    }
  }
  return undefined
}

/** Grid step (px) that samples an ink area into ≈ area / density targets, at most `count` (or `maxCount`). */
export function particleStep(inkArea: number, count?: number): number {
  const cap = Math.min(count ?? PARTICLE_WORD.maxCount, PARTICLE_WORD.maxCount)
  const n = Math.max(1, Math.min(inkArea / PARTICLE_WORD.density, cap))
  return Math.sqrt(Math.max(1, inkArea) / n)
}

/** One particle: its target (frame px) and seeded flight parameters, fixed at build. */
export interface Particle {
  tx: number
  ty: number
  /** Dot radius at rest (px). */
  r: number
  /** Leaves `delay` s after the burst and flies for `dur` s (delay + dur ≤ land − burst). */
  delay: number
  dur: number
  /** Start offset from the source (px). */
  jx: number
  jy: number
  /** Control point direction (rad) and distance (× the safe short side). */
  ang: number
  reach: number
  /** Sideways arc factor (signed). */
  swirl: number
  /** Settle direction (rad). */
  wob: number
}

/** Seeded particles for `targets` (rng consumed in a fixed order: 9 draws per particle). `step` = the sampling grid step (px). */
export function makeParticles(targets: readonly { x: number; y: number }[], rng: () => number, p: Pick<ParticleWordParams, 'burst' | 'land'>, step: number): Particle[] {
  const P = PARTICLE_WORD
  const flight = p.land - p.burst
  return targets.map((t) => {
    const delay = rng() * P.delay * flight
    const dur = Math.min(flight - delay, (P.dur[0] + rng() * (P.dur[1] - P.dur[0])) * flight)
    return {
      tx: t.x,
      ty: t.y,
      r: step * (P.radius[0] + rng() * (P.radius[1] - P.radius[0])),
      delay,
      dur,
      jx: (rng() * 2 - 1) * P.jitter,
      jy: (rng() * 2 - 1) * P.jitter,
      ang: rng() * 2 * Math.PI,
      reach: P.reach[0] + rng() * (P.reach[1] - P.reach[0]),
      swirl: (rng() < 0.5 ? -1 : 1) * (P.swirl[0] + rng() * (P.swirl[1] - P.swirl[0])),
      wob: rng() * 2 * Math.PI,
    }
  })
}

const power3Out = (x: number): number => 1 - (1 - x) ** 3
const clampTo = (v: number, lo: number, hi: number): number => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))

/**
 * A particle at local `t` (closed form, no state): undefined before it leaves; then a quadratic arc
 * from the source (+ jitter) through a seeded control point kept inside the safe area to its
 * target, eased power3.out, plus a bounded sideways arc (zero at both ends); on arrival a small
 * decaying settle. Swells mid-flight. Always inside `safe`.
 */
export function particleAt(
  q: Particle,
  from: { x: number; y: number },
  t: number,
  p: Pick<ParticleWordParams, 'burst' | 'land'>,
  safe: { x: number; y: number; w: number; h: number },
): { x: number; y: number; r: number } | undefined {
  const P = PARTICLE_WORD
  const pr = (t - p.burst - q.delay) / q.dur
  if (!(pr >= 0)) return undefined
  const S = Math.min(safe.w, safe.h)
  const x0 = safe.x
  const x1 = safe.x + safe.w
  const y0 = safe.y
  const y1 = safe.y + safe.h
  const sx = clampTo(from.x + q.jx, x0, x1)
  const sy = clampTo(from.y + q.jy, y0, y1)
  const m = P.inset * S
  const bx = clampTo(sx + Math.cos(q.ang) * q.reach * S, x0 + m, x1 - m)
  const by = clampTo(sy + Math.sin(q.ang) * q.reach * S * P.reachY, y0 + m, y1 - m)
  const u = power3Out(clamp01(pr))
  const v = 1 - u
  let x = v * v * sx + 2 * v * u * bx + u * u * q.tx
  let y = v * v * sy + 2 * v * u * by + u * u * q.ty
  const ex = q.tx - sx
  const ey = q.ty - sy
  const el = Math.hypot(ex, ey) || 1
  const arc = q.swirl * P.arc * S * Math.sin(Math.PI * u)
  x += (-ey / el) * arc
  y += (ex / el) * arc
  if (pr > 1) {
    const k = (pr - 1) * q.dur
    const w = P.wobble.amp * Math.exp(-P.wobble.decay * k) * Math.sin(P.wobble.freq * k)
    x += w * Math.cos(q.wob)
    y += w * Math.sin(q.wob)
  }
  const r = pr >= 1 ? q.r : q.r * (1 + P.swell * Math.sin(Math.PI * u) * (1 - 0.4 * u))
  return { x: clampTo(x, x0, x1), y: clampTo(y, y0, y1), r }
}

/** The particles' opacity: 0 before the burst, 1 until `land`, then down to 0 over `PARTICLE_WORD.fade`. */
export function particleAlpha(p: Pick<ParticleWordParams, 'burst' | 'land'>, t: number): number {
  if (t < p.burst) return 0
  return 1 - seg(t, p.land, p.land + PARTICLE_WORD.fade)
}

/** Flash ring at the burst: progress 0..1 over `PARTICLE_WORD.flash.sec`, undefined outside. */
export function flashProgress(p: Pick<ParticleWordParams, 'burst'>, t: number): number | undefined {
  const k = (t - p.burst) / PARTICLE_WORD.flash.sec
  return k >= 0 && k < 1 ? k : undefined
}

/** Sound: a whoosh as the hero bursts, an impact (−12 dB) as the particles land. */
export function cuesOfParticleWord(p: ParticleWordParams, _ctx: { duration: number }): Cue[] {
  return [
    { t: p.burst, kind: 'whoosh' },
    { t: p.land, kind: 'impact' },
  ]
}
