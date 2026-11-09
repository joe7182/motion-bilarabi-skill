import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { easeOutExpo, seg } from '../ease'
import { morphKey, oneLine } from './common'
import { safePoint } from './line-art'

/** Params of `stamp`. */
export const stampParams = z.object({
  text: oneLine(24),
  /** Ink colour (default: the look's accent). */
  color: z.string().min(1).optional(),
  /** Rotation (deg). */
  rot: z.number().min(-30).max(30).default(-7),
  /** Centre of the stamp in the safe area (default: its centre). */
  at: safePoint.optional(),
  /** Stamp width as a fraction of the safe width (at most; a short word may be narrower). */
  size: z.number().min(0.2).max(1).default(0.7),
  key: morphKey,
})

export type StampParams = z.infer<typeof stampParams>

export const STAMP_TIMING = {
  /** Slam: scale `from` → 1 over `slam` s, expo.out, starting on local 0 (the `hit` cue). */
  from: 1.7,
  slam: 0.25,
  /** Then a seeded camera shake of `shakeAmp` px (at 1080 w) over `shake` s. */
  shake: 0.15,
  shakeAmp: 3,
  shakeSteps: 5,
} as const

/** Slam scale at local `t` (pure): 1.7 at and before 0, expo.out to 1 by 0.25 s. */
export function stampScale(t: number): number {
  return STAMP_TIMING.from + (1 - STAMP_TIMING.from) * easeOutExpo(seg(t, 0, STAMP_TIMING.slam))
}

/** Sound cue of `stamp`: one `hit` as it slams (→ `impact`, −16 dB). */
export function cuesOfStamp(_p: StampParams, _ctx: { duration: number }): Cue[] {
  return [{ t: 0, kind: 'hit' }]
}
