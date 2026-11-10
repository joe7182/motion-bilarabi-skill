import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * screen-mockup — a real screenshot in a device: a desktop browser (tab bar, address bar with the
 * URL) or a phone (rounded body, island, status bar). The page scrolls through its keys, a spotlight
 * dims everything but one box and zooms the device onto it, and a cursor (browser) or a finger
 * (phone) taps with a ripple. Made for explainers and tutorials: the image is the user's screenshot
 * or one taken with `mba shot <url> out.jpg [--mobile] [--full]`.
 */

const at = z.number().min(0)
const unit = z.number().min(0).max(1)

export const screenMockupParams = z.object({
  device: z.enum(['browser', 'phone']).default('browser'),
  /** The screenshot (a project image path or a data URL): one screen, or a whole tall page to scroll. */
  image: z.string().min(1),
  /** The address-bar text (browser), e.g. `motionbilarabi.com/start`. */
  url: z.string().max(60).optional(),
  /** Local s the device rises in. */
  at: at.default(0),
  /** Scroll keys: by `at` the page shows from `y` (0 = top, 1 = bottom of the image), easing over `dur`. */
  scroll: z.array(z.object({ at, y: unit, dur: z.number().min(0.1).max(4).default(0.8) })).max(8).default([]),
  /**
   * Spotlights, in image fractions (x, w of the width; y, h of the whole image's height, so a box
   * scrolls with the page): the rest dims, the box gets an accent outline, and the device zooms by
   * `zoom` onto it, from `at` to `out`.
   */
  focus: z
    .array(z.object({ x: unit, y: unit, w: unit, h: unit, at, out: at.optional(), zoom: z.number().min(1).max(2.6).default(1.5), label: z.string().max(30).optional() }))
    .max(6)
    .default([]),
  /** Taps at image points: the cursor (browser) glides there and clicks, or a finger (phone) taps. */
  taps: z.array(z.object({ x: unit, y: unit, at })).max(8).default([]),
  /** Device width as a fraction of the safe width (default: browser 0.96, phone 0.6). */
  size: z.number().min(0.3).max(1).optional(),
  /** Vertical centre, fraction of the safe height. */
  y: unit.default(0.5),
  /** A slight 3D tilt that settles flat as the device lands. */
  tilt: z.boolean().default(true),
  theme: z.enum(['light', 'dark']).default('light'),
})
export type ScreenMockupParams = z.infer<typeof screenMockupParams>

/** Browser window height / width, and the phone's (screen inside the bezel). */
export const MOCKUP = { browserAspect: 1.4, phoneAspect: 2.05 } as const

export const cuesOfScreenMockup = (p: ScreenMockupParams): Cue[] => [
  { t: p.at, kind: 'whoosh' as const },
  ...p.taps.map((t) => ({ t: t.at, kind: 'tick' as const })),
]
