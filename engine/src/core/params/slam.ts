import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { splitWords } from '../text'

/** Params of `slam`. */
export const slamParams = z
  .object({
    text: z
      .string()
      .min(1)
      .max(80)
      .refine((t) => splitWords(t).length > 0, { message: 'text must contain at least one word' }),
    accent: z.string().optional(),
    tag: z.string().min(1).optional(),
  })
  .refine((p) => p.accent === undefined || splitWords(p.text).includes(p.accent), {
    path: ['accent'],
    message: 'accent must be exactly one of the words of text',
  })

export type SlamParams = z.infer<typeof slamParams>

/** `slam` intro (every word has landed) and exit lengths (s); the runtime's SLAM uses these. */
export const SLAM_TIMING = { intro: 0.55, exit: 0.25 } as const

/** Sound cue of `slam`: one `action` when the words land (the shake starts). */
export function cuesOfSlam(_p: SlamParams, ctx: { duration: number }): Cue[] {
  const k = Math.min(1, ctx.duration / (SLAM_TIMING.intro + SLAM_TIMING.exit))
  return [{ t: SLAM_TIMING.intro * k, kind: 'action' }]
}
