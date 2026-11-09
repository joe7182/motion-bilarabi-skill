import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { isStretchable, splitWords } from '../text'
import { morphKey, oneLineAr } from './common'
import { safePoint } from './line-art'

/**
 * Params of `type-stretch`: one Arabic word that stretches by kashida (tatweels) while a ruler under
 * it measures the growth («تتمــدّد» +271px). The word rises in, then from `at` its tatweel count
 * climbs to `to` over `duration` (expo.out, continuous: between two counts the next form is shown
 * squeezed to the current width). With `ruler`, an accent bracket under the word spans its current
 * width over a faint line of the plain width, and a «+N px» label counts the growth.
 */
export const typeStretchParams = z.object({
  word: oneLineAr(24, 'word')
    .refine((t) => splitWords(t).length === 1 && t.trim() === t, { message: 'كلمة واحدة فقط — word must be exactly one word' })
    .refine((t) => isStretchable(t), { message: 'الكلمة لا تقبل التطويل — word has no kashida slot' }),
  /** Local s the stretch starts. */
  at: z.number().min(0).default(0.5),
  /** Tatweels at the peak. */
  to: z.number().int().min(1).max(12).default(8),
  /** Length of the stretch (s). */
  duration: z.number().min(0.2).max(3).default(1.1),
  ruler: z.boolean().default(true),
  /** Centre of the word in the safe area (default x 0.5, y 0.45). */
  place: safePoint.optional(),
  /** Width of the fully stretched word as a fraction of the safe width. */
  size: z.number().min(0.4).max(0.95).default(0.92),
  /** `out`: ease-out, snappy (default); `easy`: easy ease, eased in and out (sine). */
  ease: z.enum(['out', 'easy']).default('out'),
  key: morphKey,
})

export type TypeStretchParams = z.infer<typeof typeStretchParams>

export const TYPE_STRETCH = {
  /** The word rises in over [0, enter] (s) by `lift` em. */
  enter: 0.35,
  lift: 0.4,
  /** The ruler draws in over this long (s) from `at` − `rulerLead`. */
  rulerIn: 0.3,
  rulerLead: 0.15,
  /** Largest font px tried. */
  maxPx: 420,
  /** The ruler sits this far (em) under the word's line box; the label this far under the ruler. */
  rulerGap: 0.08,
} as const

/** Cues: `action` as the word lands, `final` as the stretch starts. */
export function cuesOfTypeStretch(p: TypeStretchParams, _ctx: { duration: number }): Cue[] {
  return [
    { t: 0, kind: 'action' },
    { t: p.at, kind: 'final' },
  ]
}

/** The stretch scene must start stretching before it ends. */
export function timingIssueOfTypeStretch(p: TypeStretchParams, sceneLen: number) {
  if (p.at < sceneLen) return undefined
  return { path: ['at'], ar: 'التطويل يبدأ بعد نهاية المشهد', en: `stretch starts at ${p.at} s, at or after the scene end (${sceneLen} s)` }
}
