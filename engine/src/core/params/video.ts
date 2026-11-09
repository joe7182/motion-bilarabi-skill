import { z } from 'zod'

/** One zoom keyframe of a `video` scene: at local time `t` (s) the picture is scaled by `scale` around (x, y). */
const zoomKey = z.object({
  t: z.number().finite().min(0),
  scale: z.number().finite().positive(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
})

/**
 * Params of `video`: a clip of project media. `media` is a media id from `mba-project.json`
 * (`m1`, `m2`, …); `in` is the media time (s) shown at the scene start; `speed` 0.25..4.
 */
export const videoParams = z.object({
  media: z.string().min(1),
  in: z.number().finite().min(0),
  speed: z.number().finite().min(0.25).max(4).default(1),
  fit: z.enum(['cover', 'contain']).default('cover'),
  zoom: z.array(zoomKey).optional(),
})

export type VideoParams = z.infer<typeof videoParams>
