import { z, type ZodType } from 'zod'

/**
 * Transition types and their params schemas, DOM-free so Node (CLI `validate`, renderer) and the
 * runtime check transitions with the same rules (both go through `parseStoryboard`).
 */
export const TRANSITION_IDS = ['color-wipe', 'whip-pan', 'zoom-through', 'glitch-cut', 'morph', 'flood', 'iris', 'reveal', 'page-turn', 'paper-tear', 'pen-dot-curtain', 'pixel-curtain', 'ink-slab', 'blinds', 'blade-slice', 'layer-explode', 'profile-grid'] as const
export type TransitionId = (typeof TRANSITION_IDS)[number]

/** Window length in seconds: default and allowed range. */
export const TRANSITION_DURATION = { default: 0.4, min: 0.1, max: 1.2 } as const

/** Default window length per type (seconds): `TRANSITION_DURATION.default`, except morph (0.6), flood (0.5), iris (0.45) and reveal (0.42). */
export function defaultTransitionDuration(type: TransitionId): number {
  return type === 'morph'
    ? MORPH_DURATION
    : type === 'flood'
      ? FLOOD_DURATION
      : type === 'iris'
        ? IRIS_DURATION
        : type === 'reveal'
          ? REVEAL_DURATION
          : (PAPER_TRANSITION_DURATION as Partial<Record<TransitionId, number>>)[type] ?? TRANSITION_DURATION.default
}

/** Default windows of `flood` and `iris` (seconds). */
export const FLOOD_DURATION = 0.5
export const IRIS_DURATION = 0.45
/** Default window of `reveal` (s): the creative prototype's iris length. */
export const REVEAL_DURATION = 0.42

/** Default window of `morph`: the clone needs time to fly. */
export const MORPH_DURATION = 0.6

/**
 * `hit: true` marks a hard cut: the sound planner puts a riser ending exactly on it and an impact
 * on it, with near-silence before (`core/audio-plan.ts`). Default false: a plain transition is silent.
 */
const hit = z.boolean().default(false)

/** Riser length before a hard cut (s); the planner and the synth both use it. */
export const RISER_SEC = 0.6

/**
 * The sound cue of a transition: a hard cut (`params.hit === true`) has a riser starting at
 * `riserAt` (never before 0) and an impact at `impactAt` = the cut; any other transition: null.
 * A `reveal` is never a hard cut: its `hit` is an impact at the window end (`planSfx`).
 */
export function cutCue(tr: { type?: string; at: number; params: Record<string, unknown> }): { riserAt: number; impactAt: number } | null {
  if (tr.type === 'reveal' || tr.params.hit !== true) return null
  return { riserAt: Math.max(0, tr.at - RISER_SEC), impactAt: tr.at }
}

export const colorWipeParams = z.object({
  hit,
  color: z.enum(['accent', 'fg', 'bg']).default('accent'),
  direction: z.enum(['rtl', 'ltr', 'up', 'down']).default('rtl'),
})
export type ColorWipeParams = z.infer<typeof colorWipeParams>

export const whipPanParams = z.object({
  hit,
  direction: z.enum(['left', 'right', 'up', 'down']).default('left'),
  blur: z.number().finite().min(0).max(120).default(28),
})
export type WhipPanParams = z.infer<typeof whipPanParams>

export const zoomThroughParams = z.object({
  hit,
  scale: z.number().finite().min(1.5).max(20).default(7),
})
export type ZoomThroughParams = z.infer<typeof zoomThroughParams>

export const glitchCutParams = z.object({
  hit,
  intensity: z.number().finite().min(0.1).max(3).default(1),
})
export type GlitchCutParams = z.infer<typeof glitchCutParams>

/**
 * Morph / match cut: the element with `data-mba-key = key` in the outgoing scene flies into the one
 * with the same key in the incoming scene (`runtime/transitions/morph.ts`).
 */
export const morphParams = z.object({
  key: z
    .string({ error: 'مفتاح العنصر مطلوب — key (the data-mba-key shared by both scenes) is required' })
    .min(1, { message: 'مفتاح العنصر فارغ — key must not be empty' }),
  hit,
})
export type MorphParams = z.infer<typeof morphParams>

/** A frame fraction 0..1 (x is not mirrored for RTL). */
const unit = (name: string) =>
  z
    .number({ error: `${name} رقم بين 0 و1 — ${name} must be a number from 0 to 1` })
    .finite()
    .min(0, { message: `${name} بين 0 و1 — ${name} must be from 0 to 1` })
    .max(1, { message: `${name} بين 0 و1 — ${name} must be from 0 to 1` })
const originAt = (dflt: { x: number; y: number }) => z.object({ x: unit('origin.x'), y: unit('origin.y') }).default(dflt)
const origin = originAt({ x: 0.5, y: 0.5 })

/**
 * Flood: a circle or square grows from `origin` to cover the frame by the cut, then contracts to
 * `origin` revealing the incoming scene (`runtime/transitions/flood.ts`).
 */
export const floodParams = z.object({
  hit,
  shape: z.enum(['circle', 'square']).default('circle'),
  origin,
  color: z.enum(['accent', 'fg', 'bg']).default('fg'),
})
export type FloodParams = z.infer<typeof floodParams>

/**
 * Iris: a cover fades in, then a circular hole grows from `origin` (`open`), or the mirror
 * (`close`) (`runtime/transitions/iris.ts`).
 */
export const irisParams = z.object({
  hit,
  origin,
  color: z.enum(['accent', 'fg', 'bg']).default('bg'),
  direction: z.enum(['open', 'close']).default('open'),
})
export type IrisParams = z.infer<typeof irisParams>

/**
 * Reveal (Plan 3): the next world opens THROUGH a shape while both worlds stay live — a circle
 * from `origin` (the hero), 10 horizontal bands sliding in from the right (the band at `origin.y`
 * first), or a diagonal panel sweeping right → left. The incoming layers are clipped to the shape;
 * an accent edge rides its rim (`ring: false` drops the circle's ring). `hit` lands an impact at
 * the window end (`runtime/transitions/reveal.ts`; sound: a whoosh at the window start).
 */
export const revealParams = z.object({
  hit,
  shape: z.enum(['circle', 'bands', 'panel']).default('circle'),
  origin: originAt({ x: 0.5, y: 0.45 }),
  ring: z.boolean().default(true),
})
export type RevealParams = z.infer<typeof revealParams>

/**
 * Reveal geometry and timing (frame px for a 1080 px short side; seconds), from the creative
 * prototype: the ring 34 → 5 px; bands 0.024 s apart, 0.32 s each (expo.inOut), 10 px accent
 * edges; the panel's 14 px accent line, its edge leaning `slant` × H each way from its middle.
 * The circle's radius runs expo.in from 0 to `circleOver` × the farthest (bled) corner, so the frame
 * is fully open at p = 0.9 and the ring has left it before the window ends (the prototype's
 * 44 + 2300 px). The edge overlay bleeds `bleed` px on every side (R16).
 */
export const REVEAL = {
  bleed: 64,
  ring: { from: 34, to: 5 },
  circleOver: 2,
  bands: { count: 10, stagger: 0.024, sec: 0.32, edge: 10 },
  panel: { line: 14, slant: 190 / 1920 },
} as const

/**
 * Print-shop transitions: page-turn (paper sweeps over the frame the way an Arabic page turns),
 * paper-tear (the outgoing shot itself rips in two: white fibrous torn edges, the pieces fly apart over the next scene), pen-dot-curtain (pen-dot
 * diamonds spread from an ink drop and shrink away), pixel-curtain (square cells fill and clear in
 * a seeded order), ink-slab (an ink slab with an accent edge sweeps across, the new scene behind it),
 * blinds (slats open from their right ends).
 */
const paperColour = z.enum(['bg', 'fg', 'accent'])
export const pageTurnParams = z.object({ hit, color: paperColour.default('fg') })
export const paperTearParams = z.object({ hit, color: paperColour.default('fg') })
export const penDotCurtainParams = z.object({ hit, color: paperColour.default('fg'), edge: paperColour.default('accent') })
export const pixelCurtainParams = z.object({ hit, color: paperColour.default('fg'), cell: z.number().min(20).max(160).default(45) })
export const inkSlabParams = z.object({ hit, color: paperColour.default('fg'), edge: paperColour.default('accent') })
export const blindsParams = z.object({ hit, slats: z.number().int().min(3).max(12).default(6) })
export type PageTurnParams = z.infer<typeof pageTurnParams>
export type PaperTearParams = z.infer<typeof paperTearParams>
export type PenDotCurtainParams = z.infer<typeof penDotCurtainParams>
export type PixelCurtainParams = z.infer<typeof pixelCurtainParams>
export type InkSlabParams = z.infer<typeof inkSlabParams>
export type BlindsParams = z.infer<typeof blindsParams>
/**
 * Creator cuts (our own art): blade-slice (a blade crosses the
 * frame; the cut-off half slides away along it), layer-explode (the scene tilts into a glass pane
 * with ghost panes behind, the next scene settles out of the same pose; 2D only).
 */
export const bladeSliceParams = z.object({ hit, angle: z.number().min(-60).max(60).default(-28), edge: paperColour.default('accent') })
export const layerExplodeParams = z.object({ hit, panes: z.number().int().min(2).max(5).default(3) })
/** profile-grid: the scene zooms out into a tile of a profile grid, the camera dives into the next scene's tile. */
export const profileGridParams = z.object({
  hit,
  user: z.string().min(1).max(24).default('motion.bilarabi'),
  views: z.string().min(1).max(8).default('1.1M'),
  /** The creator's own posts (cover images; files next to the storyboard) filling the other tiles; none: line-art posts. */
  tiles: z.array(z.string().min(1)).max(10).default([]),
})
export type ProfileGridParams = z.infer<typeof profileGridParams>
export type BladeSliceParams = z.infer<typeof bladeSliceParams>
export type LayerExplodeParams = z.infer<typeof layerExplodeParams>
export const PAPER_TRANSITION_DURATION = { 'page-turn': 0.9, 'paper-tear': 0.8, 'pen-dot-curtain': 0.9, 'pixel-curtain': 0.7, 'ink-slab': 0.4, blinds: 0.6, 'blade-slice': 0.6, 'layer-explode': 1.0, 'profile-grid': 1.4 } as const

export const TRANSITION_PARAMS = {
  'color-wipe': colorWipeParams,
  'whip-pan': whipPanParams,
  'zoom-through': zoomThroughParams,
  'glitch-cut': glitchCutParams,
  morph: morphParams,
  flood: floodParams,
  iris: irisParams,
  reveal: revealParams,
  'page-turn': pageTurnParams,
  'paper-tear': paperTearParams,
  'pen-dot-curtain': penDotCurtainParams,
  'pixel-curtain': pixelCurtainParams,
  'ink-slab': inkSlabParams,
  blinds: blindsParams,
  'blade-slice': bladeSliceParams,
  'layer-explode': layerExplodeParams,
  'profile-grid': profileGridParams,
} as const satisfies Record<TransitionId, ZodType>
