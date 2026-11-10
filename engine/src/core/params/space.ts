import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * space-field — one layer of the one-space world, drawn in vectors over twice the frame (so pulls
 * back and parallax never show an edge). Stack two or three with scene `depth` for parallax: a far
 * dot grid or stars (depth 0.3–0.5), floating shapes (depth 0.7–1) and near soft bokeh (depth
 * 1.5–2) that rushes past.
 */


export const spaceFieldParams = z.object({
  kind: z.enum(['dots', 'grid', 'stars', 'shapes', 'bokeh']).default('dots'),
  /** How many things (1 = the default amount). */
  density: z.number().min(0.2).max(3).default(1),
  tint: z.enum(['fg', 'accent', 'mix']).default('fg'),
  /** Overall strength. */
  alpha: z.number().min(0.05).max(1).default(0.5),
})
export type SpaceFieldParams = z.infer<typeof spaceFieldParams>

export const cuesOfSpaceField = (): Cue[] => []
