import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { OBJECT_FRAME_KINDS } from './object-frame'

/**
 * Params of `name-strip`: the lower third of a talking video — who is speaking, and their handle.
 * It slides in from the reading side, holds, and slides back out. `kind` is the style pack's own
 * material (the same four as `object-frame`): a paper tag, an interface panel, a glowing line, a
 * flat editorial block.
 */
export const nameStripParams = z
  .object({
    name: z.string().min(1).max(28).refine((t) => !/[\r\n]/.test(t), { message: 'سطر واحد — one line' }),
    /** A handle or a role under the name (`@yousif_aljbouri`). */
    handle: z.string().max(32).optional(),
    kind: z.enum(OBJECT_FRAME_KINDS).default('card'),
    /** The edge it hugs. */
    side: z.enum(['right', 'left']).default('right'),
    /** Vertical centre, fraction of the safe height. */
    y: z.number().min(0.1).max(0.95).default(0.66),
    /** Local s it slides in, and (optional) slides out; absent: it stays to the scene's end. */
    at: z.number().min(0).default(0.2),
    out: z.number().min(0).optional(),
  })
  .refine((p) => p.out === undefined || p.out > p.at + 0.6, { path: ['out'], message: 'out بعد at بـ 0.6 ث على الأقل — out must come at least 0.6 s after at' })
export type NameStripParams = z.infer<typeof nameStripParams>

export const NAME_STRIP = {
  /** Seconds to slide in / out. */
  move: 0.45,
  /** px at 1080 wide. */
  namePx: 46,
  handlePx: 26,
} as const

export const cuesOfNameStrip = (): Cue[] => []
