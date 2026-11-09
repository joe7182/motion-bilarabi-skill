import type { Cue } from '../audio-plan'
import { z } from 'zod'

/** Params of `wipe-reveal`. */
export const wipeRevealParams = z.object({
  title: z.string().min(1).max(40),
  subtitle: z.string().optional(),
  withLine: z.boolean().default(true),
})

export type WipeRevealParams = z.infer<typeof wipeRevealParams>

/** Sound cue of `wipe-reveal`: one `action` as the wipe starts (its exit is silent, §13.5). */
export function cuesOfWipeReveal(_p: WipeRevealParams, _ctx: { duration: number }): Cue[] {
  return [{ t: 0, kind: 'action' }]
}
