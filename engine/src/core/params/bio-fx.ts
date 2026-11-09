import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { splitWords } from '../text'
import { oneLineAr } from './common'
import { safePoint } from './line-art'

/**
 * Biology-flavoured effects : `ecg-line`, a heart-monitor trace sweeping across the
 * frame with a spike at every beat and the beat's word popping on its peak, going flat at `flatAt`;
 * `microscope`, a round lens over the scene: outside dark, inside blurred until it snaps into focus,
 * a reticle, a focus ring and a slide label.
 */

const ease = z.enum(['out', 'easy']).default('out')

export const ecgLineParams = z
  .object({
    beats: z
      .array(
        z.object({
          at: z.number().min(0),
          word: oneLineAr(16, 'word').refine((t) => splitWords(t).length === 1, { message: 'كلمة واحدة — one word' }).optional(),
          box: z.boolean().optional(),
          /** Spike height multiplier (1 = normal, up to 1.6 for the big beat). */
          size: z.number().min(0.5).max(1.6).default(1),
        }),
      )
      .min(1)
      .max(8),
    /** Local s the trace goes flat (no more beats) and turns from accent to fg. */
    flatAt: z.number().min(0).optional(),
    /** Baseline as a fraction of the safe height. */
    y: z.number().min(0.2).max(0.9).default(0.6),
    ease,
  })
  .superRefine((p, ctx) => {
    for (let k = 1; k < p.beats.length; k++) {
      if (!(p.beats[k]!.at > p.beats[k - 1]!.at)) ctx.addIssue({ code: 'custom', path: ['beats', k, 'at'], message: 'النبضات بالترتيب — beats must be in time order' })
    }
  })
export type EcgLineParams = z.infer<typeof ecgLineParams>

export const ECG = {
  /** Spike shape around a beat, as (dx in fractions of the width, height in units of `amp`): P wave, Q, R peak, S, T wave. */
  shape: [
    [-0.07, 0], [-0.055, 0.12], [-0.04, 0], [-0.015, -0.12], [0, 1], [0.015, -0.3], [0.03, 0], [0.06, 0.18], [0.09, 0],
  ] as const,
  /** Spike height as a fraction of the safe height. */
  amp: 0.17,
  /** The word pops over `pop` s and sits this far (em) above the peak. */
  pop: 0.3,
  lift: 0.35,
  fontW: 0.14,
} as const

export const microscopeParams = z.object({
  /** Lens centre (safe-area fractions) and radius (fraction of the safe width). */
  at: safePoint.default({ x: 0.5, y: 0.6 }),
  radius: z.number().min(0.2).max(0.6).default(0.44),
  /** Focus: blurred at 0, sharp at `focusSec`. */
  focusSec: z.number().min(0.2).max(3).default(1),
  label: oneLineAr(20, 'label').optional(),
  /** Local s the lens opens up and leaves (grows past the frame and fades): the real scene plays full. */
  openAt: z.number().min(0).optional(),
  ease,
})
export type MicroscopeParams = z.infer<typeof microscopeParams>
export const LENS = { blur: 14, dim: 0.9, ring: 0.035, open: 0.6 } as const

export function cuesOfEcgLine(p: EcgLineParams): Cue[] {
  return p.beats.map((b) => ({ t: b.at, kind: 'pop' as const }))
}
export function timingIssueOfEcgLine(p: EcgLineParams, sceneLen: number) {
  const k = p.beats.findIndex((b) => !(b.at < sceneLen))
  if (k < 0) return undefined
  return { path: ['beats', k, 'at'], ar: 'نبضة بعد نهاية المشهد', en: `beat ${k} is at or after the scene end (${sceneLen} s)` }
}
