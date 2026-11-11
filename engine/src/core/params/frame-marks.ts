import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * Params of `frame-marks`: the small furniture a style pack puts on the frame — a code-style tag in a
 * top corner, thin rules, corner ticks, a section number. Everything sits on the edges of the safe
 * area (never in the headline band), is drawn in the look's ink at `alpha`, draws in from the
 * reading side over `FRAME_MARKS.draw` and makes no sound. Put it on a fixed track.
 */
export const frameMarksParams = z.object({
  /** A short label in a top corner (`01 / الفكرة`); `mono`: the code face. */
  tag: z.object({ text: z.string().min(1).max(28), corner: z.enum(['top-right', 'top-left']).default('top-right'), mono: z.boolean().default(true) }).optional(),
  /** Thin horizontal rules: `y` of the safe height, from `from` to `to` of the safe width, drawn at `at`. */
  rules: z
    .array(z.object({ y: z.number().min(0).max(1), from: z.number().min(0).max(1).default(0), to: z.number().min(0).max(1).default(1), at: z.number().min(0).default(0) }))
    .max(4)
    .default([]),
  /** Small ticks at the four corners of the safe area. */
  ticks: z.boolean().default(false),
  /** A two-digit section number in a corner. */
  number: z.object({ value: z.number().int().min(0).max(99), corner: z.enum(['top-left', 'bottom-left', 'bottom-right']).default('top-left') }).optional(),
  alpha: z.number().min(0.1).max(1).default(0.55),
})
export type FrameMarksParams = z.infer<typeof frameMarksParams>

export const FRAME_MARKS = {
  /** Seconds a mark takes to draw in. */
  draw: 0.4,
  /** px at 1080 wide: rule thickness, tick length, tag and number font sizes. */
  rule: 2,
  tick: 30,
  tagPx: 26,
  numberPx: 72,
  /** The tag and the number sit this far inside the safe area's top / bottom edge (fraction of the safe height). */
  inset: 0.008,
} as const

export const cuesOfFrameMarks = (): Cue[] => []
