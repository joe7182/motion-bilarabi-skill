import { z } from 'zod'
import { oneLineAr } from './common'

/**
 * `arabic-move`: one Arabic headline line brought on by one of nine moves. The line is always drawn
 * whole (so the browser shapes and joins it) and only then split into its connected ink pieces —
 * letter bodies and their dots — so a letter is never broken apart.
 *
 * dots-drop      the bodies settle, then each dot drops onto its letter
 * pen-write      a nib writes the bodies one after another, the dots follow
 * word-melt      `text` melts into `to`
 * unblur         the words come into focus one by one
 * decrypt        scrambled letters lock into the line, with a progress bar
 * redacted-stamp black bars slide off each word, then an optional `stamp` lands
 * letters-snap   strips of the line float apart, then snap together
 * kufi-tiles     square tiles build the line on a grid, then it turns solid
 * echo-stack     outlined copies fan out above and below the filled line
 */
export const ARABIC_MOVES = ['dots-drop', 'pen-write', 'word-melt', 'unblur', 'decrypt', 'redacted-stamp', 'letters-snap', 'kufi-tiles', 'echo-stack'] as const
export type ArabicMove = (typeof ARABIC_MOVES)[number]

export const arabicMoveParams = z
  .object({
    move: z.enum(ARABIC_MOVES),
    text: oneLineAr(40, 'text'),
    /** word-melt: what the line melts into. */
    to: oneLineAr(40, 'to').optional(),
    /** redacted-stamp: a stamp that lands once every word is revealed. */
    stamp: oneLineAr(16, 'stamp').optional(),
    /** Moves the line up (−) or down (+), as a fraction of the frame height. */
    dy: z.number().min(-0.4).max(0.4).default(0),
    /** Lower bound for the auto-fitted font size, in 1/270ths of the frame width. */
    fitFloor: z.number().min(1).max(120).default(1),
    /** true: the scene ends on a hard cut — no exit, so it only has to last for the entrance. */
    cut: z.boolean().default(false),
  })
  .refine((p) => p.move !== 'word-melt' || p.to !== undefined, { message: 'word-melt يحتاج to — word-melt needs to', path: ['to'] })
export type ArabicMoveParams = z.infer<typeof arabicMoveParams>

const letterCount = (s: string) => Array.from(s.replace(/\s/g, '')).length
const wordCount = (s: string) => s.trim().split(/\s+/).length

/** Seconds until each move has fully landed. The runtime builds its schedules from these numbers. */
export function arabicMoveEntrance(p: Pick<ArabicMoveParams, 'move' | 'text' | 'stamp'>): number {
  const n = letterCount(p.text)
  const words = wordCount(p.text)
  switch (p.move) {
    case 'dots-drop': return 1.0 + 0.1 * Math.max(0, n - 1)
    case 'pen-write': return 0.2 + 0.32 * n
    case 'word-melt': return 1.8
    case 'unblur': return 0.7 + 0.2 * (words - 1)
    case 'decrypt': return 0.6 + 0.14 * Math.max(0, Array.from(p.text).length - 1)
    case 'redacted-stamp': return 1.15 + 0.6 * (words - 1) + (p.stamp ? 0.7 : 0)
    case 'letters-snap': return lettersSnapAt(n) + 0.25
    case 'kufi-tiles': return 1.7 + 0.06 * n
    case 'echo-stack': return 0.6
  }
}

/** letters-snap: when the floating strips snap into the joined line. */
export const lettersSnapAt = (n: number) => Math.max(1.2, 0.3 + 0.06 * n)

/** Length (s) of the shared exit (fade and lift) at the end of a scene without `cut`. */
export const arabicMoveExit = (move: ArabicMove) => (move === 'word-melt' ? 0.8 : 0.6)

/** Shortest scene (s) for a move: entrance, a short hold and the exit — or, with `cut`, the entrance alone. */
export function arabicMoveMinSeconds(p: Pick<ArabicMoveParams, 'move' | 'text' | 'stamp'> & { cut?: boolean }): number {
  const enter = arabicMoveEntrance(p)
  if (p.cut) return p.move === 'word-melt' ? 2.0 : enter + 0.05
  return enter + 0.6 + arabicMoveExit(p.move)
}

export function timingIssueOfArabicMove(p: ArabicMoveParams, sceneLen: number) {
  const min = arabicMoveMinSeconds(p)
  if (sceneLen + 1e-6 >= min) return undefined
  return { path: ['move'], ar: `هذه الحركة تحتاج ${min.toFixed(1)} ث على الأقل`, en: `${p.move} needs a scene of at least ${min.toFixed(2)} s, got ${sceneLen} s` }
}
