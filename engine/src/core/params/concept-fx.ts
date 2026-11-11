import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { oneLineAr } from './common'

/**
 * Concept pieces — scenes that carry an idea by themselves:
 * - before-after: two states side by side under one divider; a hand drags the divider across and
 *   the after-state takes the frame (images, or one image with a "before" filter, or two words).
 * - fan-cards: one input card (a prompt, a file) fans out into many result cards along an arc, each
 *   linked by a drawn curve — "one input, many outputs".
 * - funnel: many items fall into a funnel; only the chosen few pass the neck and land in a row,
 *   the rest are struck and drop away — "a shortlist survives the filter".
 */

const at = z.number().min(0)
const side = z.object({
  /** A project image path or data URL (inlined at load). */
  image: z.string().min(1).optional(),
  label: oneLineAr(14, 'label').optional(),
  /** Without an image: a big word on a plain panel. */
  text: oneLineAr(16, 'text').optional(),
  /** A CSS filter on this side's image (e.g. "grayscale(1) brightness(0.75)"). */
  filter: z.string().max(80).optional(),
})

export const beforeAfterParams = z.object({
  before: side.default({ label: 'قبل' }),
  after: side.default({ label: 'بعد' }),
  /** Local s the hand grabs the divider, and how long the drag takes. */
  at: at.default(0.4),
  dur: z.number().min(0.3).max(4).default(1.4),
  /** Divider start and end (fractions of the panel width, from the left). */
  from: z.number().min(0).max(1).default(0.85),
  to: z.number().min(0).max(1).default(0.15),
  /** Panel: vertical centre (safe-height fraction), width (safe-width fraction), height / width. */
  y: z.number().min(0).max(1).default(0.45),
  width: z.number().min(0.4).max(1).default(0.92),
  aspect: z.number().min(0.4).max(1.8).default(1.15),
})
export type BeforeAfterParams = z.infer<typeof beforeAfterParams>

export const fanCardsParams = z.object({
  input: oneLineAr(30, 'input'),
  /** The result cards (2–8), each a title and an optional emoji or symbol. */
  outputs: z.array(z.object({ title: oneLineAr(18, 'outputs[].title'), icon: z.string().max(4).optional() })).min(2).max(8),
  at: at.default(0.3),
  /** Seconds between cards. */
  stagger: z.number().min(0.03).max(0.6).default(0.12),
  y: z.number().min(0).max(1).default(0.42),
})
export type FanCardsParams = z.infer<typeof fanCardsParams>

export const funnelParams = z.object({
  /** Every candidate (4–14 words); `keep` marks the ones that pass. */
  items: z.array(z.object({ text: oneLineAr(14, 'items[].text'), keep: z.boolean().default(false) })).min(3).max(14),
  /** Label on the funnel, and on the row of survivors. */
  label: z.string().max(20).optional(),
  result: z.string().max(24).optional(),
  at: at.default(0.2),
  /** Seconds for the whole pour. */
  dur: z.number().min(0.8).max(6).default(2.2),
  y: z.number().min(0).max(1).default(0.42),
})
  .refine((p) => p.items.some((i) => i.keep) && p.items.some((i) => !i.keep), { path: ['items'], message: 'لازم شي ينقبل وشي ينرفض — some items must pass and some must not' })
export type FunnelParams = z.infer<typeof funnelParams>

export const cuesOfBeforeAfter = (p: BeforeAfterParams): Cue[] => [{ t: p.at, kind: 'whoosh' }]
export const cuesOfFanCards = (p: FanCardsParams): Cue[] => p.outputs.map((_, i) => ({ t: p.at + i * p.stagger, kind: 'pop' as const }))
export const cuesOfFunnel = (p: FunnelParams): Cue[] => [{ t: p.at, kind: 'whoosh' }, { t: p.at + p.dur, kind: 'final' }]
