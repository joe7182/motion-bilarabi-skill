import type { ZodType } from 'zod'
import type gsap from 'gsap'
import type { Brand } from '../../core/brand'
import type { LookTokens } from '../looks'
import type { Cue } from '../../core/audio-plan'

/** Everything a primitive may use while building one scene. */
export interface BuildCtx {
  /** The scene's layer: absolutely positioned, full frame, `dir=rtl`. Append content here; never style it. */
  layer: HTMLElement
  /** Frame size in px (FORMAT_SIZE). */
  size: { w: number; h: number }
  /** Safe area in px, frame coordinates (SAFE_AREA). */
  safe: { x: number; y: number; w: number; h: number }
  look: LookTokens
  brand?: Brand
  /** Seeded PRNG for this scene; the only allowed source of randomness. */
  rng: () => number
  dir: 'rtl' | 'ltr'
  /**
   * The storyboard's frame rate. For a project storyboard it equals the project fps, the rate of
   * every working copy (the `video` primitive maps local time to working-copy frames with it).
   */
  fps: number
  /**
   * Scene length the primitive animates over, in seconds: the scene's `duration + preroll`. Local
   * time 0 is `preroll` seconds before the scene appears; the scene ends at local `duration`.
   */
  duration: number
  /**
   * The element with `data-mba-key = key` in an EARLIER scene (already built) shown over this
   * scene's whole span (it starts no later and ends no earlier; any track), first in storyboard order. Throws a
   * StoryboardError at `scenes[i].params.<field>` when there is none. Measure it at build: its
   * layer is laid out (visibility hidden) but no `update` has run yet, so its box is at rest.
   */
  keyed(key: string, field: string): HTMLElement
  /**
   * Like `keyed`, for the element carrying transcript word index `n` (`data-mba-word`, Task 1).
   * Throws a StoryboardError at `scenes[i].params.<field>` when no earlier scene shown over this
   * whole scene has that word.
   */
  keyedWord(n: number, field: string): HTMLElement
  /**
   * Plan 2a+ Task 6: like `keyed`, but the EARLIER scene (storyboard order, any track) need only
   * overlap this scene's span, not cover it (a hero lands on a word that appears mid-scene).
   * Throws a StoryboardError at `scenes[i].params.<field>` when there is none. Measure at build.
   */
  keyedAny(key: string, field: string): HTMLElement
  /**
   * Plan 2a+ Task 6: another scene (any storyboard order, read-only): its absolute window
   * [`start`, `end`), its parsed params, `localOf(localT)` = that scene's own local time (preroll
   * included) at THIS scene's local time `localT`, or undefined while it is not showing, and
   * `exports()`, what its `Built.exports` holds (undefined until it is built: read it in `update`,
   * when every scene is built). Undefined for an unknown id.
   */
  sceneParams(id: string): SceneInfo | undefined
}

/** What `BuildCtx.sceneParams` returns. */
export interface SceneInfo {
  start: number
  end: number
  params: Record<string, unknown>
  localOf(localT: number): number | undefined
  /**
   * Fix round 1: a point in that scene's layer coordinates (frame px) expressed in THIS scene's
   * layer coordinates at this scene's local time `localT`, through the one-world camera (pure in t):
   * a world point seen from a fixed track is mapped to the screen, a fixed point seen from the world
   * is mapped back. Identity without a camera or when both scenes are on the same side.
   */
  toThisSpace(pt: { x: number; y: number }, localT: number): { x: number; y: number }
  exports(): unknown
}

/**
 * A built scene.
 *
 * - `timeline` must be created `paused`. The stage un-pauses it and places it on the paused master
 *   timeline at the scene start; primitives must never touch its play state afterwards
 *   (no play/pause/seek/restart/progress calls).
 * - The stage seeks with events suppressed: timeline callbacks (`.call()`, onStart, onComplete,
 *   onUpdate, ...) do NOT run during seek, and must never change visual state. Anything that is not
 *   a tween belongs in `update`.
 * - `update` must be a pure function of `localT` (seconds since scene start, plus the scene's preroll: the
 *   first visible frame has localT = preroll). It runs after the
 *   master seek on every frame where the scene is visible, so it wins on properties it shares with
 *   the timeline. It may be async (e.g. waiting for an image decode): the stage awaits the returned
 *   promise before the seek resolves. Updates run one scene at a time, in storyboard order.
 * - Seeks are serialized by the stage (latest wins), so an `update` never overlaps another seek.
 * - An async `update` (and an async `build`) must always settle: a never-settling update stalls
 *   every later seek.
 */
export interface Built {
  timeline?: gsap.core.Timeline
  update?: (localT: number) => void | Promise<void>
  /**
   * Read-only data other scenes may read through `ctx.sceneParams(id).exports()` (Task 6: the hero's
   * resolved path in frame px). Fixed at build: it must never change afterwards.
   */
  exports?: unknown
}

/**
 * A scene type.
 *
 * - `build` may be async (return a Promise); the stage awaits it before the next scene is built.
 * - Primitives never style their own scene layer (`ctx.layer`): its visibility, transform,
 *   filter, clip-path and opacity belong to the stage and transitions. Style children only.
 */
export interface Primitive<P = any> {
  id: string
  params: ZodType<P>
  build(ctx: BuildCtx, p: P): Built | Promise<Built>
  /**
   * Sound cues (local seconds, pure). Optional here: the planner computes cues in Node from the
   * params module (`cuesOf<Id>` next to `core/params/<id>.ts`, listed in `core/audio-plan.ts` CUES).
   */
  cues?(params: P, ctx: { duration: number }): Cue[]
}

const registry = new Map<string, Primitive>()

export function registerPrimitive(p: Primitive): void {
  if (registry.has(p.id)) throw new Error(`primitive "${p.id}" is already registered`)
  registry.set(p.id, p)
}

export function hasPrimitive(id: string): boolean {
  return registry.has(id)
}

export function getPrimitive(id: string): Primitive {
  const p = registry.get(id)
  if (!p) throw new Error(`no primitive registered for "${id}"`)
  return p
}

export function primitiveIds(): string[] {
  return [...registry.keys()].sort()
}
