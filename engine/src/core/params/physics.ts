import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { oneLineAr } from './common'

/**
 * bounce-ball — a ball with real bounce physics. It drops in from above and hops from word to word
 * as each one is said (a karaoke ball), or from point to point onto other objects; every landing
 * squashes it and dips the word, it stretches along its speed in flight, and a soft shadow on the
 * ground grows as it comes down. `drop` lets it fall onto a spot and settle with decaying bounces.
 */

const at = z.number().min(0)
const frac = z.number().min(-0.2).max(1.2)

export const bounceBallParams = z
  .object({
    /** A line the ball hops along: it lands on each word at its `at` (right to left). */
    words: z.array(z.object({ text: oneLineAr(18, 'words[].text'), at, key: z.boolean().default(false) })).max(10).default([]),
    /** Or points to land on (frame fractions): the top of an object in another scene. */
    targets: z.array(z.object({ x: frac, y: frac, at })).max(16).default([]),
    /** Fall onto (x, y) at `at` and settle with decaying bounces (restitution `bounce`). */
    drop: z.object({ x: frac, y: frac, at, bounce: z.number().min(0.2).max(0.85).default(0.58) }).optional(),
    /** Ball diameter as a fraction of the frame width. */
    size: z.number().min(0.02).max(0.3).default(0.07),
    colour: z.enum(['accent', 'white', 'fg']).default('accent'),
    /** glossy: a lit sphere; flat: one colour. */
    look: z.enum(['glossy', 'flat']).default('glossy'),
    /** Height of each hop's arc (fraction of the frame height). */
    arc: z.number().min(0.03).max(0.5).default(0.13),
    /** A fading trail of past positions. */
    trail: z.boolean().default(false),
    /** The words' line: vertical centre (safe-height fraction) and font px at 1080 wide. */
    y: z.number().min(0).max(1).default(0.55),
    fontSize: z.number().min(40).max(200).default(96),
    /** The ball leaves (bounces off the frame) at this local s; omit to rest on the last landing. */
    out: at.optional(),
  })
  .refine((p) => p.words.length > 0 || p.targets.length > 0 || p.drop !== undefined, { path: ['words'], message: 'أعطِ كلمات words أو أهداف targets أو سقطة drop — give words, targets or a drop' })
  .refine((p) => p.words.every((w, i) => i === 0 || w.at > p.words[i - 1]!.at) && p.targets.every((w, i) => i === 0 || w.at > p.targets[i - 1]!.at), {
    path: ['words'],
    message: 'الأوقات تصاعدية — landing times must increase',
  })
export type BounceBallParams = z.infer<typeof bounceBallParams>

export const BOUNCE = { dropIn: 0.42, squash: 0.38, settleBounces: 3 } as const

/**
 * Decaying bounces after a drop (pure): a fall of `fall` s, then each bounce lasts `e` times the
 * previous flight (height scales by e²). Returns, for local time u since the first impact, the height
 * above the ground as a fraction of the drop height, and the time since the last impact.
 */
export function settleAt(u: number, fall: number, e: number, bounces: number): { h: number; since: number; flight: number } {
  if (u < 0) {
    const v = 1 + u / fall // time since release, as a share of the fall: 0 at the top, 1 on the ground
    return { h: Math.max(0, 1 - v * v), since: -1, flight: fall }
  }
  let t0 = 0
  let flight = 2 * fall * e
  for (let i = 0; i < bounces; i++) {
    if (u < t0 + flight) {
      const s = (u - t0) / flight
      return { h: 4 * s * (1 - s) * e ** (2 * (i + 1)), since: u - t0, flight }
    }
    t0 += flight
    flight *= e
  }
  return { h: 0, since: u - t0, flight: 0 }
}

/** Height of a hop's parabola at s ∈ [0, 1] between two landings, `arc` above the higher one. */
export const hopArc = (s: number) => 4 * s * (1 - s)

export const cuesOfBounceBall = (p: BounceBallParams): Cue[] => [...p.words.map((w) => w.at), ...p.targets.map((t) => t.at), ...(p.drop ? [p.drop.at] : [])].map((t) => ({ t, kind: 'tick' as const }))
