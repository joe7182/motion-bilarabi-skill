import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * Params of `html-motion`: a hand-designed scene in HTML and CSS, for a reel whose look the stock
 * objects cannot reach (a brand's UI, a bespoke diagram). It is laid out on a `design`-wide canvas
 * (1080 by default) scaled to the frame, and every CSS animation in it runs on the video's clock:
 * each frame sets the animations' time to the scene's local time, so `animation-delay` is the
 * moment (local s) a part starts. A negative delay starts an animation part-way (a backdrop that
 * keeps drifting across cuts uses `-<scene start>s`).
 * - `css`: `&` is the scene's root class (`& .card {…}`); `@@` prefixes names that must be unique
 *   per scene (`@keyframes @@rise`, `animation: @@rise .4s`).
 * - `assets`: project images (logos, photos), inlined at render; `{{a0}}`, `{{a1}}`… in the html or
 *   css stand for their data URLs.
 */
export const htmlMotionParams = z.object({
  html: z.string().min(1).max(120_000),
  css: z.string().max(120_000).default(''),
  assets: z.array(z.string().min(1)).max(48).default([]),
  /** The canvas width the html is designed at; the frame height follows the format. */
  design: z.number().int().min(320).max(4096).default(1080),
})
export type HtmlMotionParams = z.infer<typeof htmlMotionParams>

export const cuesOfHtmlMotion = (): Cue[] => []
