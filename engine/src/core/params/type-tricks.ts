import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { splitWords } from '../text'
import { oneLine, oneLineAr } from './common'
import { safePoint } from './line-art'

/**
 * The rest of the Arabic type pack (stage 4): `heavy-word` (a word that gets heavy: its weight
 * climbs, arrows push it down, its line sags), `said-written` («قلنا: علّق / كتبها: عَلَط», the
 * spoken word against the caption written), `word-cut` (an editor timeline cuts exactly on the
 * word: the word appears on the cut, no fade) and `viewfinder` (a camera REC frame over the scene).
 */

const oneWord = (max: number) =>
  oneLineAr(max, 'word').refine((t) => splitWords(t).length === 1 && t.trim() === t, { message: 'كلمة واحدة فقط — word must be exactly one word' })
const ease = z.enum(['out', 'easy']).default('out')

export const heavyWordParams = z.object({
  word: oneWord(16),
  /** Local s the word starts to get heavy, and how long it takes. */
  at: z.number().min(0).default(0.4),
  duration: z.number().min(0.2).max(3).default(0.9),
  place: safePoint.optional(),
  /** Width of the word at its heaviest, as a fraction of the safe width. */
  size: z.number().min(0.3).max(0.95).default(0.78),
  ease,
})
export type HeavyWordParams = z.infer<typeof heavyWordParams>
export const HEAVY = {
  /** Cairo variable weight: light → black. */
  from: 300,
  to: 1000,
  /** The word sinks this far (em) and its line sags this deep (em) at the end. */
  sink: 0.1,
  sag: 0.22,
  enter: 0.3,
} as const

export const saidWrittenParams = z.object({
  said: oneLineAr(20, 'said'),
  written: oneLineAr(20, 'written'),
  saidLabel: oneLineAr(12, 'saidLabel').default('قلنا'),
  writtenLabel: oneLineAr(12, 'writtenLabel').default('كتبها'),
  /** Local s each row enters. */
  saidAt: z.number().min(0).default(0.2),
  writtenAt: z.number().min(0).default(1),
  place: safePoint.optional(),
  width: z.number().min(0.5).max(1).default(0.86),
  ease,
})
export type SaidWrittenParams = z.infer<typeof saidWrittenParams>
export const SAID = { row: 0.35, mark: 0.35 } as const

export const wordCutParams = z.object({
  word: oneWord(20),
  /** Local s of the cut: the playhead reaches the cut and the word appears (hard cut). */
  at: z.number().min(0.3).default(1.2),
  place: safePoint.optional(),
  ease,
})
export type WordCutParams = z.infer<typeof wordCutParams>
export const CUT = {
  /** Where on the track the cut sits (fraction of its width, left to right) and the playhead's start. */
  x: 0.56,
  from: 0.08,
  /** Waveform bars and the track's height (fraction of the safe width). */
  bars: 44,
  trackH: 0.16,
  enter: 0.3,
} as const

export const viewfinderParams = z.object({
  /** The red label (Latin). */
  label: oneLine(12, 'label').default('REC'),
  /** Corners close in from `zoom`× to 1 over the first `CAM.enter` s (1: no move). */
  zoom: z.number().min(1).max(1.6).default(1.15),
  ease,
})
export type ViewfinderParams = z.infer<typeof viewfinderParams>
export const CAM = { enter: 0.5, inset: 0.02, corner: 0.09, blink: 1 } as const

export const cuesOfHeavyWord = (p: HeavyWordParams): Cue[] => [{ t: p.at, kind: 'final' }]
export const cuesOfSaidWritten = (p: SaidWrittenParams): Cue[] => [{ t: p.saidAt, kind: 'action' }, { t: p.writtenAt, kind: 'tick' }]
export const cuesOfWordCut = (p: WordCutParams): Cue[] => [{ t: p.at, kind: 'action' }]

export function timingIssueOfSaidWritten(p: SaidWrittenParams, sceneLen: number) {
  if (p.writtenAt < sceneLen && p.saidAt < sceneLen) return undefined
  return { path: ['writtenAt'], ar: 'السطر الثاني يظهر بعد نهاية المشهد', en: `a row appears at or after the scene end (${sceneLen} s)` }
}
export function timingIssueOfWordCut(p: WordCutParams, sceneLen: number) {
  if (p.at < sceneLen) return undefined
  return { path: ['at'], ar: 'القص بعد نهاية المشهد', en: `the cut (${p.at} s) is at or after the scene end (${sceneLen} s)` }
}
export function timingIssueOfHeavyWord(p: HeavyWordParams, sceneLen: number) {
  if (p.at < sceneLen) return undefined
  return { path: ['at'], ar: 'الثقل يبدأ بعد نهاية المشهد', en: `the word gets heavy at or after the scene end (${sceneLen} s)` }
}
