import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { safePoint } from './line-art'
import { morphKey, oneLine } from './common'

/**
 * Params of `repeat-loop` (Plan 3 Task 6b): repetition the eye can read. One word copied
 * `copies` times — `stack`: a tight vertical column scrolling up like an endless loop, masked to a
 * box; `orbit`: copies on a circle, rotating. The middle copy is the readable one (accent, full
 * opacity, still); the others are decoration (`aria-hidden`).
 */
export const repeatLoopParams = z.object({
  text: oneLine(24),
  /** Centre of the loop in the safe area (fractions). */
  at: safePoint.default({ x: 0.5, y: 0.5 }),
  /** Width of one copy as a fraction of the safe width (orbit: of the circle's diameter). */
  size: z.number().min(0.2).max(0.9).default(0.6),
  copies: z.number().int().min(3).max(12).default(7),
  /** Full loops over the scene: the stack scrolls its whole ring this many times; the orbit turns. */
  turns: z.number().min(-12).max(12).default(1.5),
  mode: z.enum(['stack', 'orbit']).default('stack'),
  key: morphKey,
})

export type RepeatLoopParams = z.infer<typeof repeatLoopParams>

export const REPEAT_LOOP = {
  /** A copy slides in this long after the previous one (entrance order: the readable copy first). */
  beat: 0.09,
  /** One copy's entrance (expo out). */
  enterSec: 0.4,
  /** Stack pitch as a share of a copy's line box height (tight: the copies nearly touch). */
  pitch: 0.8,
  /** Stack: the copies furthest from the middle end at this opacity, the neighbours at `near`. */
  near: 0.45,
  far: 0.06,
  /** Orbit: the circle's radius as a share of the safe width, and the ghost copies' opacity. */
  orbitR: 0.36,
  orbitAlpha: 0.32,
  /** At most this many entrance taps. */
  maxTaps: 6,
} as const

/** Sound: a `tap` per copy entrance, a beat apart, at most `REPEAT_LOOP.maxTaps`. */
export function cuesOfRepeatLoop(p: RepeatLoopParams, _ctx: { duration: number }): Cue[] {
  const n = Math.min(p.copies, REPEAT_LOOP.maxTaps)
  return Array.from({ length: n }, (_, i): Cue => ({ t: i * REPEAT_LOOP.beat, kind: 'action' }))
}
