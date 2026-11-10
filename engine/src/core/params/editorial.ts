import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { oneLineAr } from './common'

/**
 * editorial-type — a magazine headline: bold sans words mixed with italic serif words (Amiri),
 * each word blurring in as it is said; a design-tool selection box (dashed edges, corner handles,
 * a small label) lands on one word; a word swaps for another (the old one blurs out, the slot
 * resizes, the new one blurs in) and the box follows it; at `out` the whole headline blurs away.
 */

const at = z.number().min(0)
const word = z.object({
  text: oneLineAr(18, 'lines[].words[].text'),
  /** Local s the word blurs in. */
  at,
  /** Italic serif (Amiri) instead of the bold sans. */
  serif: z.boolean().default(false),
  /** In the accent colour. */
  accent: z.boolean().default(false),
})

const ref = { line: z.number().int().min(0).max(3), word: z.number().int().min(0).max(5) }

export const editorialTypeParams = z
  .object({
    /** One to four lines, read right to left, each up to six words. */
    lines: z.array(z.object({ words: z.array(word).min(1).max(6) })).min(1).max(4),
    /** The selection box on one word, from `at` until `out` (or the scene's end). */
    select: z
      .object({ ...ref, at, out: at.optional(), label: z.string().max(24).optional(), colour: z.enum(['accent', 'blue', 'fg']).default('accent') })
      .optional(),
    /** Word swaps: the word at line/word becomes `to` at `at`. */
    swaps: z.array(z.object({ ...ref, to: oneLineAr(18, 'swaps[].to'), at, serif: z.boolean().optional(), accent: z.boolean().optional() })).max(4).default([]),
    /** Local s every word blurs away (staggered); omit to hold to the end. */
    out: at.optional(),
    /** Vertical centre of the block, fraction of the safe height. */
    y: z.number().min(0).max(1).default(0.42),
    /** Sans font px at 1080 wide (serif words are drawn 40% larger to match). */
    size: z.number().min(50).max(220).default(150),
  })
  .superRefine((p, c) => {
    const has = (r: { line: number; word: number }) => r.line < p.lines.length && r.word < p.lines[r.line]!.words.length
    if (p.select && !has(p.select)) c.addIssue({ code: 'custom', path: ['select'], message: 'لا توجد كلمة بهذا الموضع — select names a word that does not exist' })
    p.swaps.forEach((s, i) => {
      if (!has(s)) c.addIssue({ code: 'custom', path: ['swaps', i], message: 'لا توجد كلمة بهذا الموضع — swap names a word that does not exist' })
    })
  })
export type EditorialTypeParams = z.infer<typeof editorialTypeParams>

/** Timings (s): blur in, blur out, the slot resize of a swap. */
export const EDITORIAL = { blurIn: 0.45, blurOut: 0.32, resize: 0.42 } as const

export const cuesOfEditorialType = (p: EditorialTypeParams): Cue[] => [
  ...(p.select ? [{ t: p.select.at, kind: 'tick' as const }] : []),
  ...p.swaps.map((s) => ({ t: s.at, kind: 'action' as const })),
]
