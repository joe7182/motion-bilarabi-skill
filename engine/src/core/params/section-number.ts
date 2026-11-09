import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { oneLine, morphKey } from './common'
import { MASK, RISE } from './kinetic-text'
import { safePoint } from './line-art'

/** Params of `section-number`: a giant two-digit section number with its title under it. */
export const sectionNumberParams = z.object({
  /** 1..99, written with two digits («٠٤» / "04"). */
  number: z.number().int().min(1).max(99),
  title: oneLine(40, 'title'),
  /** Centre of the block in the safe area (default x 0.5, y 0.3). */
  at: safePoint.optional(),
  /** Fraction of the safe width the two-digit number spans. */
  size: z.number().min(0.3).max(0.9).default(0.7),
  /** `arabic`: «٠٤» (the creative prototype); `latin`: "04". One style per video, matching the counters. */
  digits: z.enum(['arabic', 'latin']).default('arabic'),
  /** `rise`: translates up out of a blur; `mask-line`: lifts out from under its row. */
  enter: z.enum(['rise', 'mask-line']).default('mask-line'),
  /**
   * Ruling T9-c: the block (number + title, drift included) stays inside the top `band` of the safe
   * height, shrinking the number when it must (every format); absent: the whole safe area.
   */
  band: z.number().min(0.15).max(1).optional(),
  /** `out`: entrances ease out (default); `easy`: easy ease, eased in and out (sine). */
  ease: z.enum(['out', 'easy']).default('out'),
  key: morphKey,
})

export type SectionNumberParams = z.infer<typeof sectionNumberParams>

export const SECTION_NUMBER = {
  /** The default centre of the block (fraction of the safe area). */
  at: { x: 0.5, y: 0.3 },
  /** The title enters this long (s) after the number. */
  titleDelay: 0.12,
  /** Title font size relative to the number's, and its floor (px). */
  titleRatio: 0.22,
  titleMinPx: 48,
  /** The number's line height (em) and the vertical padding of its clipping row (em). */
  numberLine: 0.9,
  numberPad: 0.12,
} as const

/** Gain (dB) of the `impact` that lands with the number. */
export const SECTION_IMPACT_GAIN = -12

/** Seconds the entrance of the number takes. */
export const sectionEnterSec = (enter: SectionNumberParams['enter']): number => (enter === 'rise' ? RISE.sec : MASK.sec)

/** The shown text: two digits, in the chosen digit style. */
export function sectionNumberText(p: Pick<SectionNumberParams, 'number' | 'digits'>): string {
  const two = String(p.number).padStart(2, '0')
  return p.digits === 'arabic' ? [...two].map((c) => '٠١٢٣٤٥٦٧٨٩'[Number(c)]).join('') : two
}

/** Sound cue of `section-number`: one `impact` (SECTION_IMPACT_GAIN) as the number's entrance ends. */
export function cuesOfSectionNumber(p: SectionNumberParams, _ctx: { duration: number }): Cue[] {
  return [{ t: sectionEnterSec(p.enter), kind: 'impact' }]
}
