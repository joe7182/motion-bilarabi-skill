import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * Params of `object-frame`: the stage a style pack builds under the object of a sentence, so the
 * object area of each pack has its own composition. It sits on a track below the object and never
 * moves or covers it.
 * - `card`: a paper card with a soft shadow, a touch tilted (it settles as it lands).
 * - `panel`: an outlined interface panel with a title bar (three dots, a code-style label).
 * - `spot`: a pool of light under the object and a thin glowing line.
 * - `column`: a flat editorial column — a vertical rule, a small caption, one accent square.
 * - `arch`: a pointed arch in thin accent lines that draws itself, a small star at its crown.
 * - `blob`: a cut-paper blob in a paper colour (`colour`), with a soft shadow.
 */
export const OBJECT_FRAME_KINDS = ['card', 'panel', 'spot', 'column', 'arch', 'blob'] as const

export const objectFrameParams = z.object({
  kind: z.enum(OBJECT_FRAME_KINDS),
  /** A short caption (the section's title): shown by `panel` and `column`. */
  label: z.string().max(28).optional(),
  /** Centre and size of the object area, as fractions of the safe area. */
  y: z.number().min(0.2).max(0.9).default(0.56),
  height: z.number().min(0.15).max(0.7).default(0.36),
  width: z.number().min(0.4).max(1.12).default(0.9),
  /** `blob`: the paper colour (default: a warm mustard). */
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Local s it starts to build. */
  at: z.number().min(0).default(0),
})
export type ObjectFrameParams = z.infer<typeof objectFrameParams>

export const OBJECT_FRAME = {
  /** Seconds to build. */
  build: 0.5,
  /** `card`: its resting tilt (degrees) and the tilt it lands from. */
  tilt: -1.6,
  tiltFrom: -5,
  /** px at 1080 wide. */
  radius: 30,
  bar: 52,
  labelPx: 26,
  rule: 2,
} as const

export const cuesOfObjectFrame = (): Cue[] => []
