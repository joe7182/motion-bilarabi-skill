import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { oneLineAr } from './common'

/**
 * glitch-text — a headline that glitches in: red and cyan copies split apart, horizontal bands
 * slip sideways, blocks flicker, then it snaps clean. `hits` are short bursts on beats; `to` glitches
 * the headline into new words; `out` breaks it up and away.
 *
 * zoom-callout — a lens that pops out of a clip: a ring lands on one spot of the media under it, two
 * guide lines draw to an inset, and the inset grows there showing that spot magnified, with a label.
 */

const at = z.number().min(0)
const frac = z.number().min(0).max(1)
const lines = z.array(oneLineAr(18, 'lines[]')).min(1).max(2)

export const glitchTextParams = z.object({
  lines,
  /** Words drawn in the accent colour. */
  accent: z.array(z.string().min(1).max(18)).max(4).default([]),
  /** Local s the glitch-in starts, and how long it takes to settle. */
  at: at.default(0.1),
  settle: z.number().min(0.2).max(2).default(0.6),
  /** Short bursts (local s), e.g. on beats. */
  hits: z.array(z.object({ at, dur: z.number().min(0.05).max(1).default(0.22), strength: z.number().min(0.1).max(1).default(0.7) })).max(12).default([]),
  /** Glitch into new words at `at`. */
  to: z.object({ lines, accent: z.array(z.string().min(1).max(18)).max(4).default([]), at }).optional(),
  /** Local s it breaks up and leaves. */
  out: at.optional(),
  /** Faint scanlines over the text while it glitches. */
  scan: z.boolean().default(true),
  y: z.number().min(0).max(1).default(0.42),
  /** Largest font px at 1080 wide; long lines shrink to fit. */
  size: z.number().min(60).max(320).default(190),
})
export type GlitchTextParams = z.infer<typeof glitchTextParams>
export const GLITCH = { rate: 24, red: '#ff2a4f', cyan: '#00d8ff' } as const

export const zoomCalloutParams = z.object({
  /** The project media under this scene (`m1`…), and the media time at the scene start: the same
   *  `in` as the video scene beneath plus how far into it this scene starts. */
  media: z.string().min(1),
  in: z.number().finite().min(0),
  speed: z.number().finite().min(0.25).max(4).default(1),
  /** The spot to magnify, as a fraction of the frame (the clip fills the frame), and its radius (fraction of the width). */
  spot: z.object({ x: frac, y: frac, r: z.number().min(0.02).max(0.3).default(0.07) }),
  /** Where the inset sits (its centre) and its size (fraction of the width). */
  lens: z.object({ x: frac, y: frac, size: z.number().min(0.2).max(0.8).default(0.46) }),
  shape: z.enum(['circle', 'rect']).default('circle'),
  /** Local s the ring lands; the inset opens 0.35 s later. */
  at: at.default(0.2),
  out: at.optional(),
  label: oneLineAr(28, 'label').optional(),
})
export type ZoomCalloutParams = z.infer<typeof zoomCalloutParams>


export const cuesOfGlitchText = (p: GlitchTextParams): Cue[] => [
  { t: p.at, kind: 'hit' as const },
  ...p.hits.map((h) => ({ t: h.at, kind: 'hit' as const })),
  ...(p.to ? [{ t: p.to.at, kind: 'hit' as const }] : []),
]
export const cuesOfZoomCallout = (p: ZoomCalloutParams): Cue[] => [{ t: p.at + 0.35, kind: 'whoosh' }]
