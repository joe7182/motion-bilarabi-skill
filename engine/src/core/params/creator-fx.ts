import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { oneLine, oneLineAr } from './common'
import { safePoint } from './line-art'

/**
 * Creator overlays: `effect-list` (a side panel listing the video's items, the
 * current one lit), `live-cursor` (a named pointer drags a selection box, then a title pops),
 * `voice-note` (a voice-message bubble playing), `comment-drop` (comment notifications drop in and
 * stack) and `head-stack` (label tags land one on another above a point).
 */

const at = z.number().min(0)
const ease = z.enum(['out', 'easy']).default('out')

export const effectListParams = z.object({
  title: oneLineAr(24, 'title').default('في هذا الفيديو'),
  /** Every row, in order; row i becomes the current one at its `at` (local s). */
  items: z.array(z.object({ text: oneLineAr(22, 'items[].text'), at })).min(2).max(24),
  /** A footer pill (e.g. «+٤٠ تأثير»), or none. */
  more: oneLineAr(20, 'more').optional(),
  /** Which frame edge the panel hugs. */
  side: z.enum(['left', 'right']).default('left'),
  /** Panel width as a fraction of the safe width. */
  width: z.number().min(0.25).max(0.7).default(0.46),
  /** Panel top as a fraction of the safe height. */
  top: z.number().min(0).max(0.6).default(0.04),
  ease,
})
export type EffectListParams = z.infer<typeof effectListParams>
export const LIST = { enter: 0.45, row: 0.2 } as const

const point = safePoint.extend({ at })
export const liveCursorParams = z.object({
  /** The pointer's name tag (Latin, e.g. Claude). */
  name: oneLine(16, 'name').default('Claude'),
  /** Where the pointer is at each `at` (safe-area fractions); it eases between points. */
  path: z.array(point).min(1).max(12),
  /** A selection box dragged from `from` to `to` between `at` and `at + dur`, held after. */
  box: z.object({ at, dur: z.number().min(0.2).max(3).default(0.8), from: safePoint, to: safePoint }).optional(),
  /** A title pill that pops at `titleAt` near the top of the safe area. */
  title: oneLineAr(40, 'title').optional(),
  titleAt: at.default(0),
  ease,
})
export type LiveCursorParams = z.infer<typeof liveCursorParams>

export const voiceNoteParams = z.object({
  /** Local s the bubble pops in, then plays for `length` s. */
  at: at.default(0.1),
  length: z.number().min(1).max(30).default(6),
  /** The small label under the bubble. */
  label: oneLineAr(20, 'label').default('رسالة صوتية'),
  place: safePoint.default({ x: 0.5, y: 0.2 }),
  /** Bubble width as a fraction of the safe width. */
  width: z.number().min(0.4).max(0.9).default(0.62),
})
export type VoiceNoteParams = z.infer<typeof voiceNoteParams>
export const VOICE = { bars: 34, pop: 0.35 } as const

export const commentDropParams = z.object({
  /** Notifications, in order; each drops in at its `at` and pushes the older ones down. */
  comments: z.array(z.object({ name: oneLine(24, 'comments[].name'), text: oneLineAr(44, 'comments[].text'), at })).min(1).max(5),
  /** Top of the stack, as a fraction of the safe height. */
  top: z.number().min(0).max(0.7).default(0.03),
  width: z.number().min(0.5).max(1).default(0.9),
  /** The heart turns red this long after a card lands (none: never). */
  likeAfter: z.number().min(0).max(3).optional().default(0.6),
})
export type CommentDropParams = z.infer<typeof commentDropParams>
export const DROP = { fall: 0.42, gap: 0.018 } as const

export const headStackParams = z.object({
  /** Tags, bottom first; each lands on the stack at its `at`. */
  tags: z.array(z.object({ text: oneLineAr(20, 'tags[].text'), at })).min(1).max(8),
  /** The bottom of the stack (safe-area fractions), e.g. just above a head. */
  place: safePoint.default({ x: 0.5, y: 0.32 }),
  /** Tag text size as a fraction of the safe width. */
  size: z.number().min(0.02).max(0.08).default(0.042),
})
export type HeadStackParams = z.infer<typeof headStackParams>
export const STACK = { drop: 0.28, type: 0.35 } as const

export const cuesOfEffectList = (p: EffectListParams): Cue[] => p.items.map((i) => ({ t: i.at, kind: 'tick' as const }))
export const cuesOfLiveCursor = (p: LiveCursorParams): Cue[] => (p.box ? [{ t: p.box.at, kind: 'action' }] : [])
export const cuesOfVoiceNote = (p: VoiceNoteParams): Cue[] => [{ t: p.at, kind: 'action' }]
export const cuesOfCommentDrop = (p: CommentDropParams): Cue[] => p.comments.map((c) => ({ t: c.at, kind: 'tick' as const }))
export const cuesOfHeadStack = (p: HeadStackParams): Cue[] => p.tags.map((c) => ({ t: c.at, kind: 'tick' as const }))

/** Batch 2: devices and paper. */

export const predictKeysParams = z.object({
  /** The word typed (Arabic, one word or a short phrase). */
  word: oneLineAr(18, 'word'),
  /** Local s typing starts (the keyboard slides up before it), and letters per second. */
  at: at.default(0.5),
  cps: z.number().min(2).max(20).default(7),
  /** The two side suggestions (the middle one is always the word being typed). */
  suggest: z.array(oneLineAr(14, 'suggest[]')).length(2).optional(),
  ease,
})
export type PredictKeysParams = z.infer<typeof predictKeysParams>
export const KEYS = { up: 0.35, pick: 0.35, hold: 0.25 } as const

export const dayDialParams = z.object({
  /** The labels around the dial (clockwise from the top). */
  labels: z.array(oneLineAr(10, 'labels[]')).min(4).max(16),
  /** The label the dial turns to, and when it settles (local s). */
  target: z.number().int().min(0).default(0),
  at: at.default(0.2),
  /** Turns of spin before settling. */
  spin: z.number().min(0).max(3).default(1),
  place: safePoint.default({ x: 0.5, y: 0.5 }),
  /** Dial diameter as a fraction of the safe width. */
  size: z.number().min(0.4).max(1.2).default(0.86),
  /** The big word shown in the centre after it settles (default: the target label). */
  center: oneLineAr(14, 'center').optional(),
})
export type DayDialParams = z.infer<typeof dayDialParams>
export const DIAL = { swing: 1.2, inDur: 0.45 } as const

export const postWallParams = z.object({
  /** The total the counter climbs to, and its label. */
  total: z.number().int().min(1).max(9_999_999).default(1577),
  label: oneLineAr(14, 'label').default('منشور'),
  /** Grid columns (rows fill the frame). */
  cols: z.number().int().min(4).max(16).default(9),
  /** Local s the wall starts building and how long the wave takes. */
  at: at.default(0.1),
  build: z.number().min(0.3).max(4).default(1.4),
})
export type PostWallParams = z.infer<typeof postWallParams>

export const cuesOfPredictKeys = (p: PredictKeysParams): Cue[] => [...p.word.replace(/\s/g, '')].map((_, i) => ({ t: p.at + i / p.cps, kind: 'type-letter' as const }))
export const cuesOfDayDial = (p: DayDialParams): Cue[] => [{ t: p.at + DIAL.swing, kind: 'final' }]
export const cuesOfPostWall = (p: PostWallParams): Cue[] => [{ t: p.at, kind: 'whoosh' }, { t: p.at + p.build, kind: 'final' }]

/** Batch 3: photo looks. */

export const photoLookParams = z.object({
  /** A project image (path relative to the storyboard, or a data URL; inlined at render). */
  image: z.string().min(1),
  look: z.enum(['banknote', 'press', 'vintage', 'impact']),
  /** banknote: the number that counts up; press: unused; impact: unused. */
  number: z.number().int().min(0).max(99_999_999).default(174953),
  /** banknote: the caption under the number; press: the headline; impact: the slammed word. */
  text: oneLineAr(36, 'text').default('تأثير'),
  /** press: the paper's name (our own masthead). */
  masthead: oneLineAr(24, 'masthead').default('الجريدة اليومية'),
  /** Local s the look lands (its hit). */
  at: at.default(0.15),
})
export type PhotoLookParams = z.infer<typeof photoLookParams>
export const LOOK = { enter: 0.4, count: 1.1 } as const

export const cuesOfPhotoLook = (p: PhotoLookParams): Cue[] => [{ t: p.at, kind: p.look === 'impact' ? 'impact' : 'action' }]
