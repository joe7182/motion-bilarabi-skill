import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * spring-graph — the hero dot draws a line chart: it springs from point to point (right to left, in
 * reading order), the line grows behind it, and a callout pops on the last point («+٢٢٪»).
 *
 * halftone-field — a grid of dots whose size follows a hero dot moving over it (bigger near it), and
 * an optional halftone wipe: the dots swell until they cover the frame in one colour, then shrink to
 * reveal what is underneath — a scene change made of the same dots.
 */

const at = z.number().min(0)
const frac = z.number().min(-0.2).max(1.2)

export const springGraphParams = z.object({
  /** Values left in reading order (first = rightmost point); any scale, min..max is the chart height. */
  values: z.array(z.number().finite()).min(2).max(12),
  at: at.default(0.2),
  /** Seconds per segment. */
  step: z.number().min(0.1).max(1.5).default(0.32),
  callout: z.string().max(14).default('+٢٢٪'),
  /** Axis labels under the first and last points. */
  from: z.string().max(14).optional(),
  to: z.string().max(14).optional(),
  /** Chart box in the safe area (fractions). */
  y: z.number().min(0).max(1).default(0.45),
  height: z.number().min(0.1).max(0.7).default(0.38),
  width: z.number().min(0.4).max(1).default(0.86),
})
export type SpringGraphParams = z.infer<typeof springGraphParams>

export const halftoneFieldParams = z.object({
  /** The hero's path: where it is at each time (frame fractions); it springs between them. */
  path: z.array(z.object({ x: frac, y: frac, at })).max(16).default([]),
  /** Draw the hero dot itself (off when another scene draws it). */
  hero: z.boolean().default(true),
  /** Grid cell (fraction of the width) and the largest dot (fraction of a cell). */
  cell: z.number().min(0.02).max(0.12).default(0.045),
  reach: z.number().min(0.05).max(0.8).default(0.28),
  /** The wipe: from `at` the dots swell over `dur` to cover the frame, hold, then shrink away. */
  wipe: z.object({ at, dur: z.number().min(0.2).max(2).default(0.6), colour: z.enum(['fg', 'accent']).default('fg') }).optional(),
  alpha: z.number().min(0.05).max(1).default(0.5),
})
export type HalftoneFieldParams = z.infer<typeof halftoneFieldParams>

export const cuesOfSpringGraph = (p: SpringGraphParams): Cue[] => [{ t: p.at + p.step * (p.values.length - 1), kind: 'pop' }]
export const cuesOfHalftoneField = (p: HalftoneFieldParams): Cue[] => (p.wipe ? [{ t: p.wipe.at, kind: 'whoosh' }] : [])
