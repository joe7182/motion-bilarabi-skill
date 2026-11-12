import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { safePoint } from './line-art'

/** The Lucide icons the engine uses; only these are vendored (`scripts/vendor-icons.ts`). */
export const ICON_NAMES = [
  'banknote',
  'clock',
  'lock',
  'lightbulb',
  'target',
  'database',
  'sparkles',
  'smartphone',
  'message-circle',
  'globe',
  'triangle-alert',
  'check-circle',
  'users',
  'coins',
  'rocket',
  'chart-line',
  'shield-check',
  'zap',
  'bookmark',
] as const

export type IconName = (typeof ICON_NAMES)[number]

/** Params of `icon`. */
export const iconParams = z.object({
  icon: z.enum(ICON_NAMES),
  /** Caption under the icon (Arabic; one line unit). */
  label: z
    .string()
    .min(1)
    .max(40)
    .refine((t) => t.trim().length > 0, { message: 'label must not be blank' })
    .refine((t) => !/[\r\n]/.test(t), { message: 'label must be a single line' })
    .optional(),
  /** Centre of the icon (with its label) in the safe area (default: its centre). */
  at: safePoint.optional(),
  /** Icon width as a fraction of the safe width (default 0.55: R14 as updated in Task 7 fix round 3). */
  size: z.number().min(0.2).max(1).default(0.55),
  /** Stroke colour (default: the look's accent). */
  color: z.string().min(1).optional(),
  /** `draw`: strokes self-draw, then a 6 % scale settle; `pop`: scale 0 → 1 on a spring. */
  enter: z.enum(['draw', 'pop']).default('draw'),
  /** Morph key (Task 8). */
  key: z.string().min(1).optional(),
})

export type IconParams = z.infer<typeof iconParams>

export const ICON_TIMING = {
  /** Seconds each stroke takes to draw (`draw`). */
  drawIn: 0.6,
  /** Scale before the settle (`draw`): 6 % under rest. */
  settleFrom: 0.94,
  /** Label: fade/rise starts here (s, scaled like the draw) and lasts `labelIn`. */
  labelAt: { draw: 0.35, pop: 0.15 },
  labelIn: 0.3,
  labelRise: 16,
} as const

/** Sound cue of `icon`: one `pop` as it appears (a soft mallet, §17.5). */
export function cuesOfIcon(_p: IconParams, _ctx: { duration: number }): Cue[] {
  return [{ t: 0, kind: 'pop' }]
}
