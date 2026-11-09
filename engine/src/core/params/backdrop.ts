import { z } from 'zod'

/**
 * Params of `backdrop`: the colour world behind everything (Task 10 recipe: one per chapter on
 * track 0). A soft glow over the world's background, optionally a generative pattern (all motion a
 * pure function of t); no text, no sound.
 */
export const BACKDROP_WORLDS = ['paper', 'ink', 'accent'] as const
export type BackdropWorld = (typeof BACKDROP_WORLDS)[number]
export const BACKDROP_PATTERNS = ['none', 'dots', 'stripes', 'ridges', 'shapes', 'blobs'] as const

export const backdropParams = z.object({
  /** `base`: the look's background only; `warm`: an accent glow; `cool`: a blue glow; `deep`: a faint foreground glow. */
  tone: z.enum(['base', 'warm', 'cool', 'deep']).default('base'),
  /** Seconds the backdrop fades in from transparent over the one below it (a chapter cross-fade). */
  fadeIn: z.number().min(0).max(2).default(0),
  /**
   * The colour world while this backdrop is visible (an instantaneous flip of the whole frame's
   * colours): `paper` the look as it is; `ink` bg and fg swapped; `accent` bg = accent, fg = the
   * look's bg, accent = the look's fg.
   */
  world: z.enum(BACKDROP_WORLDS).default('paper'),
  /** Generative pattern drawn in the world's fg at `patternAlpha`. */
  pattern: z.enum(BACKDROP_PATTERNS).default('none'),
  patternAlpha: z.number().min(0).max(0.5).default(0.12),
  /**
   * The id of a `hero` scene the `dots` field reacts to: while that scene shows, dots near the
   * hero swell (`BACKDROP_REACT`). An id that names no hero scene is ignored, with a warning from
   * `validateSceneParams`; other patterns ignore it.
   */
  react: z.object({ hero: z.string().min(1) }).optional(),
  /**
   * Plan 3: a printed-paper surface. When set, the backdrop paints on a canvas (64 px of bleed on
   * every side, so camera motion never shows an edge): the world's bg, the tone's glow, a seeded
   * paper texture multiplied at `paper`, a radial vignette (centre 0.47 H) at `vignette`, a halftone
   * dot field from the bottom-left corner when `halftone`, and film grain at `grain` (a new seeded
   * tile/offset every frame). Absent: the plain backdrop as before.
   */
  material: z
    .object({
      paper: z.number().min(0).max(1).default(0.5),
      grain: z.number().min(0).max(0.2).default(0.08),
      vignette: z.number().min(0).max(1).default(0.6),
      halftone: z.boolean().default(false),
    })
    .optional(),
})

export type BackdropParams = z.infer<typeof backdropParams>

export type BackdropTone = BackdropParams['tone']

/** Glow strength (share of the glow colour at the centre). */
export const BACKDROP = { glow: 0.12, cool: '#4f7cff' } as const

/**
 * `react.hero` on `dots`: a dot at distance d from the hero (frame px) gets
 * `gain · exp(−(d / (radius · spacing))²)` base radii on top of its breathing (0.4..1.6 base).
 */
export const BACKDROP_REACT = { gain: 3.5, radius: 2 } as const
