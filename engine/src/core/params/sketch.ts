import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { oneLineAr } from './common'

/**
 * sketch-words — words drawn like a pencil sketch: the letter outlines are traced in two wobbly
 * passes, then cross-hatching (or solid ink) fills them; the lines "boil" a little, like a drawing.
 *
 * red-pen — an editor's red pen over whatever is on screen: circles, wavy underlines, strikes,
 * arrows, ticks, crosses, carets and brackets drawn stroke by stroke with a pen nib at the tip, plus
 * handwritten margin notes.
 */

const at = z.number().min(0)
const frac = z.number().min(-0.1).max(1.1)

export const sketchWordsParams = z.object({
  lines: z.array(oneLineAr(18, 'lines[]')).min(1).max(3),
  /** Words hatched in the accent colour. */
  accent: z.array(z.string().min(1).max(18)).max(4).default([]),
  at: at.default(0.1),
  /** Seconds to trace the outlines (all lines). */
  draw: z.number().min(0.3).max(4).default(1.1),
  fill: z.enum(['hatch', 'solid', 'none']).default('hatch'),
  /** The wobble of a hand-drawn line, redrawn eight times a second. */
  boil: z.boolean().default(true),
  out: at.optional(),
  y: z.number().min(0).max(1).default(0.42),
  size: z.number().min(60).max(320).default(240),
})
export type SketchWordsParams = z.infer<typeof sketchWordsParams>

export const PEN_MARKS = ['circle', 'underline', 'strike', 'arrow', 'check', 'cross', 'caret', 'bracket'] as const

export const redPenParams = z.object({
  /** Each mark's box as fractions of the frame (x, y = top-left; an arrow goes from (x, y) to (x+w, y+h)). */
  marks: z
    .array(z.object({ kind: z.enum(PEN_MARKS), x: frac, y: frac, w: z.number().min(-1).max(1), h: z.number().min(-1).max(1), at, dur: z.number().min(0.1).max(2).default(0.45) }))
    .max(10)
    .default([]),
  /** Handwritten notes in red (Amiri italic), written in from the right. */
  notes: z.array(z.object({ text: oneLineAr(28, 'notes[].text'), x: frac, y: frac, at, dur: z.number().min(0.2).max(2).default(0.6), rotate: z.number().min(-20).max(20).default(-4), size: z.number().min(30).max(140).default(64) })).max(6).default([]),
  /** The pen nib riding the stroke while it draws. */
  pen: z.boolean().default(true),
  colour: z.enum(['red', 'accent']).default('red'),
  out: at.optional(),
})
export type RedPenParams = z.infer<typeof redPenParams>
export const PEN_RED = '#d42a1e'

export const cuesOfSketchWords = (p: SketchWordsParams): Cue[] => [{ t: p.at, kind: 'action' }]
export const cuesOfRedPen = (p: RedPenParams): Cue[] => p.marks.map((m) => ({ t: m.at, kind: 'tick' as const }))
