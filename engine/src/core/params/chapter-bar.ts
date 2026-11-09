import { z } from 'zod'
import { oneLineAr } from './common'

/**
 * Params of `chapter-bar`: the progress header of a numbered video. A row of `count` dashes along
 * the top of the safe area (reading order: the first dash on the right), the dashes before `index`
 * solid, the current one filling in accent from its reading side, the rest faint; `label` («حركة ·
 * ٠٣») on the other end. One scene per item; put it on a fixed track so the camera never moves it.
 */
export const chapterBarParams = z
  .object({
    count: z.number().int().min(2).max(12),
    /** 1-based. */
    index: z.number().int().min(1),
    label: oneLineAr(32, 'label').optional(),
    /** Local s the current dash starts to fill, and how long the fill takes. */
    at: z.number().min(0).default(0),
    fill: z.number().min(0.1).max(3).default(0.5),
    /** `fade`: the bar fades in over the first 0.25 s; `none`: shown from frame 0 (the bar carried over from the previous item). */
    enter: z.enum(['fade', 'none']).default('none'),
    /** Distance from the top of the safe area, as a fraction of the safe height. */
    y: z.number().min(0).max(0.2).default(0.015),
    /** `out`: ease-out, snappy (default); `easy`: easy ease, eased in and out (sine). */
    ease: z.enum(['out', 'easy']).default('out'),
  })
  .refine((p) => p.index <= p.count, { message: 'الرقم أكبر من العدد — index must be 1..count', path: ['index'] })

export type ChapterBarParams = z.infer<typeof chapterBarParams>

export const CHAPTER_BAR = {
  /** Dash length and the gap between dashes as fractions of the safe width; thickness (px at 1080 wide). */
  dash: 0.055,
  gap: 0.014,
  thick: 6,
  /** Faint dashes' opacity. */
  faint: 0.22,
  /** Label px at 1080 wide. */
  labelPx: 34,
  fadeIn: 0.25,
} as const
