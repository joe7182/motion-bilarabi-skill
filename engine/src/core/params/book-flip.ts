import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { imageSrc, oneLineAr } from './common'
import { safePoint } from './line-art'

/**
 * Params of `book-flip`: an open textbook whose pages flip fast and stop on a printed figure
 * (`image`, a still of the real scene, shown grey like print). At `liftAt` the figure lifts off the
 * page, grows into `target` (the box the next scene's window occupies: a screen-clip with no chrome
 * at the same `at`, `width` and `aspect`) and gets its colour back, so the cut to the live clip is
 * seamless.
 */
export const bookFlipParams = z.object({
  image: imageSrc,
  /** The chapter line printed over the figure (e.g. «الفصل ١٩ · القلب»). */
  title: oneLineAr(30, 'title').optional(),
  /** Local s the flipping starts, how many leaves turn, over how long. */
  at: z.number().min(0).default(0.3),
  flips: z.number().int().min(2).max(14).default(8),
  flipSec: z.number().min(0.4).max(3).default(1.3),
  /** Local s the figure lifts off and grows into `target` (absent: it stays printed). */
  liftAt: z.number().min(0).optional(),
  target: z
    .object({ at: safePoint.default({ x: 0.5, y: 0.6 }), width: z.number().min(0.3).max(1).default(0.92), aspect: z.number().min(0.3).max(4).default(1.44) })
    .default({ at: { x: 0.5, y: 0.6 }, width: 0.92, aspect: 1.44 }),
  ease: z.enum(['out', 'easy']).default('out'),
})
export type BookFlipParams = z.infer<typeof bookFlipParams>

export const BOOK = {
  /** Book (open spread) width as a fraction of the safe width, its aspect, centre (safe fractions). */
  width: 0.94,
  aspect: 1.42,
  at: { x: 0.5, y: 0.58 },
  /** The book rises in over `enter` s; the lift takes `lift` s; the book fades out with it. */
  enter: 0.35,
  lift: 0.6,
  paper: '#f6f1e6',
  ink: 'rgba(40,34,28,0.22)',
} as const

export function cuesOfBookFlip(p: BookFlipParams): Cue[] {
  return [{ t: p.at, kind: 'action' }, ...(p.liftAt === undefined ? [] : [{ t: p.liftAt, kind: 'final' as const }])]
}
export function timingIssueOfBookFlip(p: BookFlipParams, sceneLen: number) {
  if (p.at < sceneLen && (p.liftAt === undefined || p.liftAt < sceneLen)) return undefined
  return { path: [p.at < sceneLen ? 'liftAt' : 'at'], ar: 'الحركة تبدأ بعد نهاية المشهد', en: `the flip or the lift starts at or after the scene end (${sceneLen} s)` }
}
