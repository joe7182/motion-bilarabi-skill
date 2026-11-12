import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * Backgrounds that belong to a style pack.
 * - geo-pattern (Arabic heritage): an eight-point star tiling drawn line by line from one point
 *   outward, then breathing slowly; it fades away behind the text band so headlines stay clear.
 * - paper-shapes (cut paper): big cut-paper shapes peeking in from the top and bottom of the frame,
 *   outside the text area; they slide in, settle with a small snap, and re-arrange at each shift.
 */

export const geoPatternParams = z.object({
  /** Tile size as a fraction of the frame width. */
  cell: z.number().min(0.1).max(0.4).default(0.2),
  colour: z.enum(['accent', 'fg']).default('accent'),
  alpha: z.number().min(0.05).max(1).default(0.4),
  /** Seconds the drawing takes to reach the farthest tile, from `origin` (frame fractions). */
  draw: z.number().min(0.2).max(6).default(1.8),
  origin: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).default({ x: 0.5, y: 0.45 }),
  /** The band kept calm for text: its centre and height (frame fractions); `false`: pattern everywhere. */
  calm: z.union([z.literal(false), z.object({ y: z.number().min(0).max(1), h: z.number().min(0.1).max(1) })]).default({ y: 0.42, h: 0.52 }),
})
export type GeoPatternParams = z.infer<typeof geoPatternParams>

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'لون بصيغة #rrggbb — a colour as #rrggbb' })

export const paperShapesParams = z.object({
  /** The paper colours, used in turn. */
  colours: z.array(hex).min(2).max(6).default(['#e0a526', '#1f7a7a', '#e4572e', '#223a5e']),
  /** Local s the shapes slide in. */
  at: z.number().min(0).default(0),
  /** Local times the shapes trade places (a section change). */
  shifts: z.array(z.number().min(0)).max(24).default([]),
  /** Steps a second for the shapes' motion (12 = animated "on twos", a hand-made feel); 0: smooth. */
  steps: z.union([z.literal(0), z.literal(8), z.literal(12), z.literal(15)]).default(12),
  /** Size of every shape (1 = the default sizes). */
  scale: z.number().min(0.5).max(1.5).default(1),
})
export type PaperShapesParams = z.infer<typeof paperShapesParams>

export const PACK_FX = {
  /** paper-shapes: seconds a shape takes to arrive or to trade places, and the stagger between shapes. */
  move: 0.7,
  stagger: 0.07,
} as const

export const cuesOfGeoPattern = (): Cue[] => []
export const cuesOfPaperShapes = (p: PaperShapesParams): Cue[] => p.shifts.map((t) => ({ t, kind: 'whoosh' as const }))
