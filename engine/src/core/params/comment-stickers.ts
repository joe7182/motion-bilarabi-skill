import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { oneLineAr } from './common'

/**
 * Params of `comment-stickers`: followers' comments («طريقة؟ وش البرنامج؟ كيف سويته؟») popping in
 * one by one as tilted comment cards, alternating sides and filling `band` of the safe height top
 * to bottom. Each card: a small avatar dot and the comment, white card, dark text in every world.
 */
export const commentStickersParams = z.object({
  items: z.array(z.object({ text: oneLineAr(28, 'text'), at: z.number().min(0) })).min(1).max(6),
  /** `out`: ease-out, snappy (default); `easy`: easy ease, eased in and out (sine). */
  ease: z.enum(['out', 'easy']).default('out'),
  /** Top and bottom of the area the cards fill, as fractions of the safe height. */
  band: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).default([0.32, 0.92]),
})

export type CommentStickersParams = z.infer<typeof commentStickersParams>

export const STICKERS = {
  /** Pop: scale from 0.4 with a back-ease over `pop` s. */
  pop: 0.32,
  /** Largest tilt (degrees) either way. */
  tilt: 5,
  /** Font px at 1080 wide; card max width as a fraction of the safe width. */
  fontPx: 46,
  maxW: 0.7,
  /** Horizontal centres (fractions of the safe width), alternating from the reading side. */
  xs: [0.62, 0.38],
} as const

/** One `pop` per comment. */
export function cuesOfCommentStickers(p: CommentStickersParams, _ctx: { duration: number }): Cue[] {
  return p.items.map((it) => ({ t: it.at, kind: 'pop' as const }))
}

export function timingIssueOfCommentStickers(p: CommentStickersParams, sceneLen: number) {
  const k = p.items.findIndex((it) => !(it.at < sceneLen))
  if (k < 0) {
    if (p.band[1] > p.band[0]) return undefined
    return { path: ['band'], ar: 'أعلى المنطقة يجب أن يكون فوق أسفلها', en: 'band[0] must be less than band[1]' }
  }
  return { path: ['items', k, 'at'], ar: `التعليق «${p.items[k]!.text}» يظهر بعد نهاية المشهد`, en: `comment ${k} appears at or after the scene end (${sceneLen} s)` }
}
