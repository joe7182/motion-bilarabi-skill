import { BUILT_OBJECTS, CALENDAR, checkAtOf, MORPH_OBJECT, morphObjectAt, morphObjectParams, morphObjectPose, timelineCutOffsets, type MorphObjectParams } from '../../core/params/morph-object'
import { lerpPts, type Pt } from '../../core/morph'
import { easeInOutCubic } from '../../core/ease'
import { OBJECT_IDS, objectOutline, type ObjectId } from '../../core/objects'
import { currencySign, parseCurrency } from '../../core/currency'
import { resolvedWorld, sceneCanvas } from '../canvas'
import { drawGlow, drawObject, drawRing, pathOf, type ObjectDraw } from '../objects-draw'
import type { Primitive } from './registry'

/** What `ctx.sceneParams(id).exports()` returns for a morph-object scene. */
export interface MorphObjectExports {
  kind: 'morph-object'
  /** The object's centre and radius at this scene's local time, in frame px of this scene's layer. */
  at(localT: number): { x: number; y: number; r: number }
}

/** Canvas bleed (px): rings and glow near the frame edge stay whole under camera motion. */
const BLEED = 64

/**
 * morph-object (Plan 3): the hero dot becomes objects — a ring, a bar, a clock, a coin carrying the
 * currency sign — and back, on one canvas repainted every update (pure in t, colours from
 * `resolvedWorld(ctx.layer)`). Between states the 240-point outline blends point by point on the
 * soft spring (`morphObjectPose`): the outgoing object's body stays under the incoming one, which
 * fades in with the spring, and the outgoing details fade before the midpoint; the incoming details
 * build over `MORPH_OBJECT.buildSec` after arrival. Glow behind a coin or clock, rings expanding
 * from the object at `rings`. Task 6b: a document writes its lines (a state's `text` is its first
 * line), a microphone's bars follow a state's `levels`, a timeline sweeps its playhead and cuts its
 * clips. Task 6c: the script's own objects — a calendar flipping its months, an envelope letting
 * out invoices, a bell ringing with sticky notes, a voice-note bubble recording and playing, a
 * phone whose notification becomes a paid check (`objects-draw.ts`). Stage 1A: the house reel's
 * brick, house, blueprint, eye, photo and chat (`objects-draw-home.ts`). Stage 2: the cost and sun
 * sections' scale, materials, file (`objects-draw-cost.ts`) and sun, room, pin, window, sun-path
 * (`objects-draw-sun.ts`), each with its own `beats`; the brick's variants. Video 2: the hard hats,
 * bulb, AI chip, tool, magnifier, follow card, compass and receipt (`objects-draw-mission.ts`). Decoration only: the canvas is `aria-hidden`, no DOM text (canvas text is decoration).
 */
export const morphObject: Primitive<MorphObjectParams> = {
  id: 'morph-object',
  params: morphObjectParams,
  build(ctx, p) {
    const surface = sceneCanvas(ctx, { bleed: BLEED })
    const { el, g } = surface
    el.dataset.mbaPart = 'morph-object'
    if (p.key) el.dataset.mbaKey = p.key
    const currency = parseCurrency(p.currency).currency
    const sign = currencySign(currency)
    const end = ctx.duration
    const dt = 1 / ctx.fps
    const unit = new Map<ObjectId, Pt[]>(OBJECT_IDS.map((id) => [id, objectOutline(id, 1)]))
    const scaled = (id: ObjectId, s: number): Pt[] => unit.get(id)!.map(([x, y]) => [x * s, y * s] as Pt)
    const exports: MorphObjectExports = { kind: 'morph-object', at: (t) => morphObjectAt(p, t, end, ctx.safe) }
    // per-state drawing inputs (Task 6b): a seed from the scene's PRNG, the timeline cut offsets
    const sceneSeed = Math.floor(ctx.rng() * 2 ** 31)
    const perState = p.states.map((s, k) => ({
      levels: s.levels,
      text: s.text,
      seed: (sceneSeed + k * 977) >>> 0,
      cuts: s.object === 'timeline' ? timelineCutOffsets(k, s.at) : [],
      flipSec: s.flipSec ?? CALENDAR.flipSec,
      checkAt: s.checkAt ?? checkAtOf(s.object),
      beats: s.beats ?? [],
    }))
    type StateDraw = Pick<ObjectDraw, 'since' | 'levels' | 'text' | 'seed' | 'cuts' | 'flipSec' | 'checkAt' | 'beats' | 'textMix' | 'prevText'>
    const stateOf = (k: number, t: number): StateDraw => ({ ...perState[k]!, since: t - p.states[k]!.at, textMix: 1 })

    const paint = (t: number) => {
      g.save()
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.clearRect(0, 0, el.width, el.height)
      g.restore()
      const colours = resolvedWorld(ctx.layer)
      const pose = morphObjectPose(p, t, end, ctx.safe)
      const from = p.states[pose.from]!.object
      const to = p.states[pose.to]!.object
      const r = pose.size / 2

      // rings: behind the object, centred where it is now
      for (const rt of p.rings) drawRing(g, pose.x, pose.y, (t - rt) / MORPH_OBJECT.ring.sec, colours.accent, MORPH_OBJECT.ring)
      if (!(r > 0.5)) return

      const moving = pose.move < 1 && !pose.same
      const uc = Math.min(1, Math.max(0, pose.u))
      if (p.glow) {
        const w = moving ? (BUILT_OBJECTS.has(from) ? 1 - uc : 0) + (BUILT_OBJECTS.has(to) ? uc : 0) : BUILT_OBJECTS.has(to) ? 1 : 0
        drawGlow(g, pose.x, pose.y, r, colours.accent, w, MORPH_OBJECT.glow)
      }

      const pts = from === to ? scaled(to, pose.size) : lerpPts(scaled(from, pose.sizeFrom), scaled(to, pose.sizeTo), pose.u)
      const path = pathOf(pts)
      const clip = moving && (from === 'bar' || to === 'bar')
      const buildPrev = morphObjectPose(p, t - dt, end, ctx.safe).build
      const base = { r, path, clip, colours, t, dt, sign, currency, font: ctx.look.fontDisplay }
      g.save()
      g.translate(pose.x, pose.y)
      g.scale(pose.sx, pose.sy)
      if (moving) {
        // the outgoing body stays opaque under an opaque newcomer; under a ring it fades out
        drawObject(g, from, { ...base, ...stateOf(pose.from, t), angle: pose.angleFrom, alpha: to === 'ring' ? 1 - uc : 1, build: 1, buildPrev: 1, detailAlpha: pose.fade })
        drawObject(g, to, { ...base, ...stateOf(pose.to, t), angle: pose.angleTo, alpha: uc, build: 0, buildPrev: 0, detailAlpha: 1 })
      } else {
        // Stage 2: a move between two states of the same object hands the look over on the move
        // (the brick's variants crossfade their face details)
        const hand = pose.same && pose.move < 1 ? { prevText: p.states[pose.from]!.text, textMix: easeInOutCubic(pose.move) } : {}
        drawObject(g, to, { ...base, ...stateOf(pose.to, t), ...hand, angle: pose.angleTo, alpha: 1, build: pose.build, buildPrev, detailAlpha: 1 })
      }
      g.restore()
    }

    return {
      exports,
      update(localT) {
        paint(localT)
      },
    }
  },
}
