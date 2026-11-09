import type { ZodType } from 'zod'
import type { TransitionId } from '../../core/params/transitions'
import type { LookTokens } from '../looks'

/**
 * Everything a transition may use while building. A transition writes ONLY to `out` / `in`
 * (transform, filter, clip-path, opacity, transform-origin) and to its own `overlay`; never to the
 * primitives' inner elements, with one exception: morph marks the keyed elements of both scenes
 * with an attribute (hidden while its clone flies) and removes it in `reset`. The stage resets the
 * layer properties to '' and calls every `reset` on every seek before applying the active
 * transitions, so nothing outlives the window.
 */
export interface TransitionCtx {
  /** Full-frame element above every scene layer, owned by this transition; shown only during the window. */
  overlay: HTMLElement
  /** The outgoing scene's layer (visible until the cut). */
  out: HTMLElement
  /** The incoming scene's layer (visible from the cut). */
  in: HTMLElement
  size: { w: number; h: number }
  look: LookTokens
  /** Seeded PRNG of this effect, for build time only. */
  rng: () => number
  /** Window length in seconds. */
  duration: number
  dir: 'rtl' | 'ltr'
  /** Index of the transition in the storyboard (for unique ids such as SVG filter ids). */
  index: number
  /** `data-mba-scene` ids of the outgoing and incoming scenes (for messages). */
  outId: string
  inId: string
  /**
   * Build time only: draws the outgoing scene at the window start (`'out'`) or the incoming one at
   * the window end (`'in'`), so the transition can measure it from layout at rest. Layers are
   * still laid out then (visibility-hidden, not `display: none`); after build, a layer outside its
   * window is `display: none` and measures as zero. Deterministic: scene updates are pure in t.
   */
  pose(side: 'out' | 'in'): Promise<void>
  /**
   * The two worlds of the cut (used by a `twoWorlds` transition, i.e. reveal): `in` first, then
   * every scene layer on a LOWER track that starts at the cut (within CUT_TOLERANCE) and is not
   * joined by another transition (e.g. the incoming backdrop); `outLayers` likewise for the scenes
   * ending there. The transition's overlay covers exactly these tracks.
   */
  inLayers: HTMLElement[]
  outLayers: HTMLElement[]
  /**
   * The matrix that maps the overlay's coordinates (frame px in the overlay's own space) to `el`'s,
   * for the frame being drawn: under the camera, layers of another depth sit in other wrappers
   * (identity without a camera, or in the same wrapper). Call it in `update`, not at build.
   */
  toLayer(el: HTMLElement): DOMMatrix
}

export interface TransitionBuilt {
  /**
   * Draws the transition at progress `p` = (t − (at − d/2)) / d in [0, 1] (0.5 = the cut). Pure in
   * `p`: it must set every property it uses on every call (no state carried between calls). Only 2D
   * transforms, filters, clip-path and opacity; no CSS 3D, no will-change.
   */
  update(p: number): void
  /**
   * Keep BOTH scenes shown over the whole window (morph) instead of outgoing for p < 0.5 and
   * incoming for p >= 0.5. The transition then fades them itself.
   */
  bothVisible?: boolean
  /**
   * Both WORLDS stay live over the window (reveal; implies `bothVisible`): the stage also shows
   * every layer of `ctx.inLayers` / `ctx.outLayers` over the whole window and gives each side its
   * own colour world (`--mba-*` on those layers: the backdrop world in force just before / just
   * after the cut), so a canvas reading `resolvedWorld(ctx.layer)` paints its own world. The
   * overlay keeps the OUTGOING world's colours over the whole window (its edge never changes colour
   * at the cut). The frame root takes the outgoing world for p < 0.5, the incoming one from 0.5.
   * Reset on every seek.
   */
  twoWorlds?: boolean
  /**
   * Called on every seek, for every transition, before anything is drawn: undoes whatever the
   * transition wrote outside `out`/`in`'s layer properties and its overlay (morph marks the keyed
   * elements of both scenes), so nothing outlives the window.
   */
  reset?(): void
}

export interface Transition<P = any> {
  id: TransitionId
  params: ZodType<P>
  build(ctx: TransitionCtx, p: P): TransitionBuilt | Promise<TransitionBuilt>
}

const registry = new Map<string, Transition>()

export function registerTransition(t: Transition): void {
  if (registry.has(t.id)) throw new Error(`transition "${t.id}" is already registered`)
  registry.set(t.id, t)
}

export function getTransition(id: string): Transition {
  const t = registry.get(id)
  if (!t) throw new Error(`no transition registered for "${id}"`)
  return t
}

export function transitionIds(): string[] {
  return [...registry.keys()].sort()
}
