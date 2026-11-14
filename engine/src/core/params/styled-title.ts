import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { TITLE_FONT_IDS, TITLE_IN_IDS, TITLE_OUT_IDS, TITLE_STYLE_IDS } from '../title-styles'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const unit = z.number().min(0).max(1)

/**
 * Params of `styled-title`: one title the way the person placed it in the style picker (`mba pick`,
 * which writes these params to `pick.json`): a style, a font, own colours, one or two lines, a spot
 * (centre + width as fractions of the frame), and an entrance and an exit. `layer: 'behind'` is
 * the title behind the head: it needs a `cutout` scene of the same clip on the track above
 * (`mba pick` writes that scene too). Positions are for 9:16.
 */
export const styledTitleParams = z.object({
  text: z.string().min(1).max(40),
  /** The key word(s), drawn last in the style's accent (or the custom gradient). */
  key: z.string().max(24).default(''),
  lines: z.union([z.literal(1), z.literal(2)]).default(1),
  style: z.enum(TITLE_STYLE_IDS).default('nebula'),
  font: z.enum(TITLE_FONT_IDS).default('cairo'),
  layer: z.enum(['front', 'behind']).default('front'),
  cx: unit.default(0.5),
  cy: unit.default(0.55),
  w: z.number().min(0.2).max(1).default(0.84),
  /** Font px on the 1080-wide canvas. */
  size: z.number().min(40).max(260).default(92),
  in: z.enum(TITLE_IN_IDS).default('blur'),
  out: z.enum(TITLE_OUT_IDS).default('blur'),
  /** Local s the entrance starts. */
  at: z.number().min(0).default(0.2),
  /** Local s the exit starts (default: 0.5 s before the scene ends). */
  outAt: z.number().min(0).optional(),
  colors: z.object({ text: hex, k1: hex, k2: hex, box: hex, boxAlpha: unit }).optional(),
})
export type StyledTitleParams = z.infer<typeof styledTitleParams>

export const cuesOfStyledTitle = (p: StyledTitleParams): Cue[] => [{ t: p.at, kind: 'pop' }]
