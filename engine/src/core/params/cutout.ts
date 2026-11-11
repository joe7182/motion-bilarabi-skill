import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { oneLine, oneLineAr } from './common'
import { videoParams } from './video'

/**
 * `cutout`: a clip of project media with only the person shown, through the person matte that
 * `mba matte <project> <media>` made beside its working copy (`work/<id>.matte.mp4`). Anything on a
 * lower track sits BEHIND the person (letters, rings, a zoomed copy of the clip). Modes:
 * `person` (the person alone), `clones` (copies of the person pop in beside them), `code` (the
 * whole frame turns into code), `dust` (the person blows away, right to left; with
 * `background: clean` the room stays), `letters` (letter dive: the clip inside a giant word, the
 * camera dives through a letter) and `grid` (grid zoom: a carousel of video cards over the head, one
 * picked, it lands on the face as a lens that opens the whole scene into black and white).
 * `background: blur` draws the whole clip behind, blurring in from `at` (back focus).
 */
export const cutoutParams = videoParams.extend({
  mode: z.enum(['person', 'clones', 'code', 'dust', 'letters', 'grid', 'layers']).default('person'),
  /** grid: local s (after `at`) the cursor clicks the middle card, and the lens opens. */
  pick: z.number().min(0.4).max(4).default(1.2),
  zoom: z.number().min(0.6).max(5).default(1.9),
  /** letters: the word the clip plays inside (letter dive). */
  word: oneLineAr(14, 'word').default('عربي'),
  /** Local s the mode's effect starts (blur, clones, code, dust). */
  at: z.number().min(0).default(0.2),
  /** How long the effect takes to arrive. */
  dur: z.number().min(0.1).max(4).default(0.8),
  /** blur: back focus (the room blurred). clean: the room without the person (for dust). */
  background: z.enum(['none', 'blur', 'clean']).default('none'),
  /** Dolly zoom (with `background: clean`): the room scales from [0] to [1] over the scene while the person holds still. */
  dolly: z.tuple([z.number().min(0.5).max(3), z.number().min(0.5).max(3)]).optional(),
  /** The room without the person (a data URL), filled in automatically from `mba matte`'s clean plate. */
  plate: z.string().optional(),
  /**
   * The desk line: no person below this frame fraction (fading out over `feather`), so a desk,
   * a laptop or hands in front of the person never become part of the cut-out (or of its clones).
   */
  below: z.number().min(0.2).max(1).optional(),
  feather: z.number().min(0).max(0.2).default(0.05),
  /** Background blur at full (px on a 1080 px frame). */
  blur: z.number().min(0).max(60).default(22),
  /** layers: the effect names on the list pane; `lit` (0-based) is the lit one. */
  items: z.array(oneLineAr(16, 'items[]')).min(2).max(9).default(['جريدة', 'مصباح', 'جزيئات', 'دوللي', 'طبقات', 'صوت', 'ختم']),
  lit: z.number().int().min(0).max(8).default(4),
  /** clones: copies each side. */
  clones: z.number().int().min(1).max(4).default(2),
  /** code: the glyphs the person is drawn with (Latin). */
  glyphs: oneLine(60, 'glyphs').default('motion bilarabi 0110 creator studio {}'),
})
export type CutoutParams = z.infer<typeof cutoutParams>

/** The media id of a person matte (served by the frame server like a working copy). */
export const matteId = (media: string) => `${media}.matte`

export const cuesOfCutout = (p: CutoutParams): Cue[] => (p.mode === 'person' && p.background === 'none' ? [] : [{ t: p.at, kind: p.mode === 'dust' ? 'whoosh' : 'action' }])

/**
 * `orbit-ring`: words circling a point on a tilted ellipse (e.g. around a head). Place two scenes,
 * `half: back` BELOW the cutout and `half: front` above it, and the ring passes behind the person.
 */
export const orbitRingParams = z.object({
  words: z.array(oneLineAr(14, 'words[]')).min(1).max(10),
  place: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).default({ x: 0.5, y: 0.3 }),
  /** Ring radius as a fraction of the safe width, and its tilt (height / width). */
  radius: z.number().min(0.15).max(0.6).default(0.4),
  tilt: z.number().min(0.1).max(0.8).default(0.26),
  /** Turns per second (negative: the other way). */
  speed: z.number().min(-2).max(2).default(0.22),
  half: z.enum(['back', 'front', 'both']).default('both'),
  /** Word size as a fraction of the safe width. */
  size: z.number().min(0.03).max(0.14).default(0.085),
  /** Local s the ring opens. */
  at: z.number().min(0).default(0),
})
export type OrbitRingParams = z.infer<typeof orbitRingParams>
export const cuesOfOrbitRing = (p: OrbitRingParams): Cue[] => (p.half === 'back' ? [] : [{ t: p.at, kind: 'whoosh' }])
