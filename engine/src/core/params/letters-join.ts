import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { hasArabic, HARAKAT, splitWords } from '../text'
import { morphKey, oneLineAr } from './common'
import { safePoint } from './line-art'

/**
 * Splits an Arabic word into its letters: each base letter with the marks (harakat, tatweel) that
 * follow it. The letters of «العربي» are «ا ل ع ر ب ي».
 */
export function lettersOf(word: string): string[] {
  const out: string[] = []
  for (const ch of word) {
    if (HARAKAT.test(ch) && out.length > 0) out[out.length - 1] += ch
    else out.push(ch)
  }
  return out
}

/**
 * Params of `letters-join`: an Arabic word shown as separate letters («ا ل ع ر ب ي») that slide
 * together at `at` and become the joined word («العربي»), or with `reverse` the joined word that
 * breaks apart into letters (the «broken Arabic» mistake). Each separate letter is its own unit
 * (its isolated form, on purpose); the joined word is one unit, so the letters are never split
 * inside a word.
 */
export const lettersJoinParams = z.object({
  word: oneLineAr(14, 'word')
    .refine((t) => splitWords(t).length === 1 && t.trim() === t, { message: 'كلمة واحدة فقط — word must be exactly one word' })
    .refine((t) => hasArabic(t), { message: 'الكلمة يجب أن تكون عربية — word must be Arabic' })
    .refine((t) => lettersOf(t).length >= 2 && lettersOf(t).length <= 10, { message: 'من ٢ إلى ١٠ حروف — word must have 2..10 letters' }),
  /** Local s the letters start to move. */
  at: z.number().min(0).default(0.8),
  /** Length of the move (s). */
  duration: z.number().min(0.3).max(2).default(0.8),
  /** `true`: starts joined and breaks apart. */
  reverse: z.boolean().default(false),
  /** Space between the separate letters (em). */
  gap: z.number().min(0.1).max(1.2).default(0.42),
  /** Centre in the safe area (default x 0.5, y 0.45). */
  place: safePoint.optional(),
  /** Width of the separate-letter row as a fraction of the safe width. */
  size: z.number().min(0.4).max(0.95).default(0.86),
  /** `out`: ease-out, snappy (default); `easy`: easy ease, eased in and out (sine). */
  ease: z.enum(['out', 'easy']).default('out'),
  key: morphKey,
})

export type LettersJoinParams = z.infer<typeof lettersJoinParams>

export const LETTERS_JOIN = {
  /** Each letter pops in over `pop` s, staggered `stagger` s (reading order); the joined word fades in over `pop`. */
  pop: 0.28,
  stagger: 0.06,
  /**
   * The swap between the letters and the joined word happens over this slice of the move (0..1),
   * under the liquid morph: a blur + alpha-threshold filter that rises and falls with the move
   * (peak blur `gooBlur` em, alpha gain `gooGain`, bias `gooBias`), so the shapes melt into each
   * other instead of fading. Crisp text (no filter) before and after the move.
   */
  swap: [0.5, 0.82] as const,
  /** The letters reach their place in the word over this first part of the move (0..1). */
  travel: 0.62,
  /** The melt rises and falls over this slice of the move (0..1, seen from the apart state). */
  goo: [0.3, 1] as const,
  gooBlur: 0.05,
  gooGain: 16,
  gooBias: 5.5,
  maxPx: 360,
} as const

/** Cues: `pop` per letter as it lands (joined: one), `final` when the letters join or break. */
export function cuesOfLettersJoin(p: LettersJoinParams, _ctx: { duration: number }): Cue[] {
  const n = p.reverse ? 1 : lettersOf(p.word).length
  return [
    ...Array.from({ length: n }, (_, i) => ({ t: i * LETTERS_JOIN.stagger, kind: 'pop' as const })),
    { t: p.at + p.duration * LETTERS_JOIN.swap[0], kind: 'final' as const },
  ]
}

/** The move must start before the scene ends. */
export function timingIssueOfLettersJoin(p: LettersJoinParams, sceneLen: number) {
  if (p.at < sceneLen) return undefined
  return { path: ['at'], ar: 'الحركة تبدأ بعد نهاية المشهد', en: `the join starts at ${p.at} s, at or after the scene end (${sceneLen} s)` }
}
