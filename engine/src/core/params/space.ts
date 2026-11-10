import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * space-field — one layer of the one-space world, drawn in vectors over twice the frame (so pulls
 * back and parallax never show an edge). Stack two or three with scene `depth` for parallax: a far
 * dot grid and stars (depth 0.3–0.5), the route between the stops (depth 1, the stops' own plane),
 * and near soft bokeh (depth 1.5–2) that rushes past.
 */

const frac = z.number().min(-0.5).max(1.5)

export const spaceFieldParams = z.object({
  kind: z.enum(['dots', 'grid', 'stars', 'shapes', 'bokeh', 'route']).default('dots'),
  /** How many things (1 = the default amount). */
  density: z.number().min(0.2).max(3).default(1),
  tint: z.enum(['fg', 'accent', 'mix']).default('fg'),
  /** Overall strength. */
  alpha: z.number().min(0.05).max(1).default(0.5),
  /**
   * `route`: the path between the stops — the stops' places (x, y) and the times the camera lands
   * (`at`, scene seconds). Breadcrumb dots pop in along each leg as the camera flies it (none
   * within `clear` of a stop); a ring ripples out from each stop as the camera lands.
   */
  stops: z.array(z.object({ x: frac, y: frac, at: z.number().min(0) })).max(12).default([]),
  /** Seconds each leg of the route takes to draw (ending at the next stop's `at`). */
  travel: z.number().min(0.2).max(4).default(1.1),
  /** Around each stop the route stays clear (fraction of the width), so it never runs under the stop's text. */
  clear: z.number().min(0.03).max(0.4).default(0.16),
})
export type SpaceFieldParams = z.infer<typeof spaceFieldParams>

export const cuesOfSpaceField = (p: SpaceFieldParams): Cue[] => (p.kind === 'route' ? p.stops.slice(1).map((s) => ({ t: s.at, kind: 'whoosh' as const })) : [])
