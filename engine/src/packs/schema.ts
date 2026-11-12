import { z } from 'zod'
import { PARAMS } from '../core/params/index'
import { CAPTION_SKINS } from '../core/params/captions'
import { OBJECT_FRAME_KINDS } from '../core/params/object-frame'
import { TRANSITION_IDS, type TransitionId } from '../core/params/transitions'
import { PACK_IDS, type PackId } from '../core/pack-ids'
import { LOOK_IDS, type LookId } from '../core/storyboard'

/**
 * A style pack: one complete art direction. One choice fixes where the headline sits, how the key
 * word is marked, how things move, which transitions belong, what lies behind and which small marks
 * dress the frame. Packs are data: they are applied when a storyboard is built (`mba preset`,
 * `mba dress`, `mba recommend --pack`), never at render time, so a storyboard without `pack` is untouched.
 */
export { PACK_IDS, type PackId }

/** What a preset or a concept asks a pack for. */
export const PACK_ROLES = ['headline', 'keySentence', 'number', 'list', 'quote', 'compare', 'cta', 'signOff'] as const
export type PackRole = (typeof PACK_ROLES)[number]

export const KEY_MARKS = ['box', 'colour', 'underline', 'serif'] as const
export type KeyMark = (typeof KEY_MARKS)[number]

const transition = z.enum(TRANSITION_IDS)
const sceneRef = z.object({ type: z.string().min(1), params: z.record(z.string(), z.unknown()) })

export const packSchema = z.object({
  id: z.enum(PACK_IDS),
  /** Its number in the style menu (1-based, no gaps). */
  n: z.number().int().min(1),
  ar: z.string().min(1),
  en: z.string().min(1),
  /** One line: what it looks like (Arabic, for the catalog). */
  does: z.string().min(1),
  /** What a person says to pick it. */
  ask: z.string().min(1),
  /** A preview image in media/effects (without .jpg). */
  img: z.string().optional(),
  look: z.enum(LOOK_IDS),
  layout: z.object({
    /** Headline centre (fraction of the frame height), the edge it hugs, and its largest font px. */
    headline: z.object({ y: z.number().min(0.08).max(0.6), align: z.enum(['centre', 'right', 'left']), maxPx: z.number().min(80).max(320) }),
    /** Centre of the objects area (fraction of the safe height). */
    showY: z.number().min(0.3).max(0.85),
    objects: z.enum(['below', 'side', 'around']),
    /** Smallest clear gap between headline and objects (fraction of the frame height). */
    gap: z.number().min(0.04).max(0.2),
    keyMark: z.enum(KEY_MARKS),
  }),
  motion: z.object({
    ease: z.enum(['easy', 'snappy']),
    /** How a headline word enters (a `kinetic-text` entrance). */
    enter: z.enum(['slide', 'rise', 'mask-line', 'mask', 'pop', 'fade']),
    /** Motion-blur samples (0 = off). */
    blur: z.union([z.literal(0), z.literal(3)]),
    camera: z.enum(['locked', 'drift', 'pulse']),
  }),
  transitions: z.object({
    default: transition,
    section: transition,
    more: z.array(transition).max(4),
    /** Params per transition type, so a transition wears the pack's colours (absent: the transition's own defaults). */
    params: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  }),
  /** Track-0 scenes laid for the whole video. */
  background: z.array(sceneRef).min(1).max(3),
  /** `frame-marks` params: the small furniture of the frame (absent: none). */
  marks: z.record(z.string(), z.unknown()).optional(),
  /** The stage under the object of a sentence (`object-frame`): its kind and, when not the default, its place (absent: none). */
  stage: z.object({ kind: z.enum(OBJECT_FRAME_KINDS), y: z.number().optional(), height: z.number().optional(), width: z.number().optional(), colour: z.string().optional() }).optional(),
  /** What the pack gives a talking video (the `talking` preset): captions, the punch-in, the key-word pop-up, the name strip. */
  talking: z.object({
    captions: z.object({ skin: z.enum(CAPTION_SKINS), presentation: z.enum(['pill', 'minimal', 'strip']), emph: z.enum(['accent', 'underline', 'pop']) }),
    punch: z.object({ zoom: z.number().min(1.02).max(1.4), ease: z.enum(['smooth', 'linear', 'cut']) }),
    popup: z.enum(['box', 'underline', 'colour']),
    strip: z.enum(OBJECT_FRAME_KINDS),
  }),
  roles: z.object({ headline: sceneRef, keySentence: sceneRef, number: sceneRef, list: sceneRef, quote: sceneRef, compare: sceneRef, cta: sceneRef, signOff: sceneRef }),
  /** What clashes with the look: `mba validate` advises against these, it never refuses them. */
  avoid: z.object({ scenes: z.array(z.string()), transitions: z.array(transition) }),
})
export type Pack = z.infer<typeof packSchema>
export type { LookId, TransitionId }

/** The param names a scene type takes (the top-level keys of its schema). */
export function paramKeysOf(type: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let s: any = (PARAMS as Record<string, unknown>)[type]
  while (s && !s.shape) s = s.def?.in ?? s.def?.innerType ?? s.def?.schema ?? s._def?.schema ?? s._def?.innerType
  return s ? Object.keys(s.shape) : []
}
