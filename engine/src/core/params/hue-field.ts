import { z } from 'zod'
import type { Cue } from '../audio-plan'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/**
 * Params of `hue-field`: a soft gradient of hues behind everything (no dots, no lines): four large
 * glows drifting slowly over the frame's background colour, a light vignette and fine grain. It
 * follows the colour world: on a dark background it glows violet, magenta and blue (`dark`); on a
 * light one it turns peach, pink and lilac (`light`). Its drift is a function of the video's time,
 * so it keeps flowing across cuts.
 */
export const hueFieldParams = z.object({
  /** Four glow colours on a dark background (default: the look's accent, magenta, blue, pink). */
  dark: z.array(hex).length(4).optional(),
  /** Four glow colours on a light background (default: peach, pink, lilac, cream). */
  light: z.array(hex).length(4).optional(),
  /** The ground under the glows in a dark world / a light world (default: the frame's background colour). */
  base: hex.optional(),
  lightBase: hex.optional(),
  /** How strong the glows are (1 = as designed). */
  strength: z.number().min(0.2).max(1.5).default(1),
  /** Drift speed (1 ≈ one slow sway every 11–13 s; 0 holds still). */
  speed: z.number().min(0).max(3).default(1),
  /** Film grain over the glows (0 = none). */
  grain: z.number().min(0).max(0.2).default(0.06),
})
export type HueFieldParams = z.infer<typeof hueFieldParams>

export const HUE_FIELD = {
  /** Glow sizes (fraction of the frame width) and resting centres (fractions of the frame). */
  glows: [
    { size: 1.4, x: 0.55, y: 0.06, alpha: 0.62, period: 11, dx: -0.2, dy: 0.08 },
    { size: 1.3, x: -0.05, y: 0.75, alpha: 0.38, period: 13, dx: 0.24, dy: -0.1 },
    { size: 1.2, x: 0.95, y: 0.92, alpha: 0.4, period: 12, dx: -0.22, dy: -0.06 },
    { size: 0.85, x: 0.62, y: 0.5, alpha: 0.16, period: 9, dx: 0.18, dy: -0.08 },
  ],
  dark: ['#6240ff', '#b840ff', '#2856ff', '#ff78c8'],
  light: ['#ffbea0', '#ffa8d6', '#baaaff', '#ffecbe'],
  /** Light glows are stronger (they tint a pale ground). */
  lightAlpha: [0.85, 0.7, 0.85, 0.55],
} as const

export const cuesOfHueField = (): Cue[] => []
