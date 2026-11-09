import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { morphKey, oneLine } from './common'
import { safePoint } from './line-art'

/** Params of `comment-cta`: the «comment the word» end card. */
export const commentCtaParams = z.object({
  /** The word viewers comment (≤ 20 characters). */
  keyword: oneLine(20, 'keyword'),
  placeholder: oneLine(30, 'placeholder').default('أضف تعليقاً…'),
  dmTitle: oneLine(30, 'dmTitle').default('وصلتك الرسالة'),
  dmBody: oneLine(40, 'dmBody').optional(),
  /** Centre of the card in the safe area (default: its centre). */
  at: safePoint.optional(),
  /** Card width as a fraction of the safe width. */
  size: z.number().min(0.4).max(1).default(0.9),
  key: morphKey,
})

export type CommentCtaParams = z.infer<typeof commentCtaParams>

/** The beats of `comment-cta` (local s). */
export const CTA_TIMING = {
  /** The comment field slides up and fades in. */
  fieldIn: [0, 0.3],
  /** The keyword wipes in right → left (the placeholder goes as it starts). */
  keyword: [0.35, 0.95],
  /** The send button pulses (peak on `send`). */
  pulse: [0.9, 1.1],
  send: 1.0,
  /** The comment posts: it rises out of the field into the thread; the field empties. */
  post: [1.2, 1.5],
  /** The DM card slides in. */
  dm: [1.7, 2.05],
} as const

/** Shortest scene (local s) that shows the whole card. */
export const CTA_MIN_SEC = CTA_TIMING.dm[1]

/** Scene-level check: the scene must last until the DM card has landed. */
export function timingIssueOfCommentCta(_p: CommentCtaParams, sceneLen: number) {
  if (sceneLen + 1e-9 >= CTA_MIN_SEC) return undefined
  return {
    path: [],
    ar: `بطاقة التعليق تحتاج ${CTA_MIN_SEC} ث على الأقل`,
    en: `comment-cta needs a scene of at least ${CTA_MIN_SEC} s (local, duration + preroll), got ${sceneLen} s`,
  }
}

/** Sound cues of `comment-cta`: `action` on the send pulse, `final` as the DM lands in. */
export function cuesOfCommentCta(_p: CommentCtaParams, _ctx: { duration: number }): Cue[] {
  return [
    { t: CTA_TIMING.send, kind: 'action' },
    { t: CTA_TIMING.dm[0], kind: 'final' },
  ]
}
