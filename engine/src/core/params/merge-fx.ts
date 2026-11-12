import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * - goo-merge: several things become one. Labelled drops sit in a row; at `at` they flow together
 *   like liquid (they stretch toward each other and fuse) into one pill that carries the result.
 * - photo-grid: photos in an even grid re-flow into a bento layout around one hero photo — every
 *   tile travels and resizes at once, on a spring.
 */

const line = (max: number) => z.string().min(1).max(max).refine((t) => !/[\r\n]/.test(t), { message: 'سطر واحد — one line' })
const unit = z.number().min(0).max(1)

export const gooMergeParams = z.object({
  /** The things that merge (a short label under each drop). */
  from: z.array(line(14)).min(2).max(5),
  /** What they become (the text on the merged pill). */
  to: line(24),
  /** Local s the drops start to flow together, and how long the merge takes. */
  at: z.number().min(0).default(1),
  dur: z.number().min(0.4).max(3).default(1.1),
  colour: z.enum(['accent', 'fg']).default('accent'),
  y: unit.default(0.5),
  /** Width of the row of drops, as a fraction of the safe width. */
  width: z.number().min(0.5).max(1).default(0.9),
})
export type GooMergeParams = z.infer<typeof gooMergeParams>

export const photoGridParams = z
  .object({
    /** Three to six photos (project image paths). */
    images: z.array(z.string().min(1)).min(3).max(6),
    /** Which photo becomes the large one. */
    hero: z.number().int().min(0).max(5).default(0),
    /** Local s the grid re-flows into the bento layout. */
    at: z.number().min(0).default(1.2),
    y: unit.default(0.5),
    width: z.number().min(0.5).max(1).default(0.94),
    /** The block's height / width. */
    aspect: z.number().min(0.6).max(1.6).default(1.1),
  })
  .refine((p) => p.hero < p.images.length, { path: ['hero'], message: 'رقم الصورة الرئيسية أكبر من عدد الصور — hero must be one of the images' })
export type PhotoGridParams = z.infer<typeof photoGridParams>

/** A tile's box in the block, as fractions (x, y, w, h). */
export type Box = [number, number, number, number]

/** The even grid: 3 photos in a row, 4 as 2 × 2, 5–6 as 3 × 2 (a missing sixth leaves the last cell empty). */
export function evenGrid(n: number): Box[] {
  const cols = n === 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  return Array.from({ length: n }, (_, i) => [(i % cols) / cols, Math.floor(i / cols) / rows, 1 / cols, 1 / rows])
}

/** The bento: the hero takes the upper two thirds (the reading side: the right two thirds of the width), the others fill a column beside it and a row beneath. */
export function bento(n: number, hero: number): Box[] {
  const others = Array.from({ length: n }, (_, i) => i).filter((i) => i !== hero)
  const out: Box[] = new Array<Box>(n)
  const side = n <= 4 ? 1 : 2 // tiles stacked beside the hero
  const under = others.length - side // tiles in the row beneath
  const top = under > 0 ? 0.64 : 1
  out[hero] = [0.36, 0, 0.64, top]
  others.forEach((i, k) => {
    out[i] = k < side ? [0, (k * top) / side, 0.36, top / side] : [((k - side) * 1) / under, top, 1 / under, 1 - top]
  })
  return out
}

export const MERGE_FX = {
  /** photo-grid: seconds a tile takes to travel, and the stagger between tiles. */
  flow: 0.8,
  stagger: 0.05,
  /** photo-grid: the gap between tiles, as a fraction of the block's width. */
  gap: 0.018,
} as const

export const cuesOfGooMerge = (p: GooMergeParams): Cue[] => [{ t: p.at + p.dur * 0.6, kind: 'pop' }]
export const cuesOfPhotoGrid = (p: PhotoGridParams): Cue[] => [{ t: p.at, kind: 'whoosh' }]
