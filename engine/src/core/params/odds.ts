import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { oneLineAr } from './common'

/**
 * Explainers for how a language model picks its words.
 * - token-stream: a sentence written token by token, each token a chip; pieces of one word stay joined.
 * - token-odds: the next-token candidates as probability bars; temperature keys sharpen or flatten
 *   them; an optional pick lights one option.
 * - loaded-die: a 3D die whose faces are tokens (the strong one on more faces) that rolls and lands.
 * - server-batch: several people's questions enter one server together; your answer comes out and
 *   one word of it changes.
 */

const at = z.number().min(0)

export const tokenStreamParams = z.object({
  /** The tokens in reading order. `joinNext`: this piece and the next are one word (kept joined). */
  tokens: z.array(z.object({ text: z.string().min(1).max(16), at, joinNext: z.boolean().default(false) })).min(1).max(24),
  /** Vertical centre of the line, fraction of the safe height. */
  y: z.number().min(0.1).max(0.9).default(0.45),
  /** Small caption above the line. */
  label: oneLineAr(24, 'label').optional(),
  /** Font px at 1080 wide. */
  size: z.number().min(30).max(120).default(64),
})
export type TokenStreamParams = z.infer<typeof tokenStreamParams>

export const tokenOddsParams = z
  .object({
    /** The text so far; the candidates are what may come next. */
    prompt: oneLineAr(30, 'prompt'),
    options: z.array(z.object({ text: z.string().min(1).max(14), p: z.number().positive() })).min(2).max(6),
    /** Local s the bars grow. */
    at: at.default(0.2),
    /** Temperature over time (linear between keys); none: 1 throughout. */
    temps: z.array(z.object({ at, t: z.number().min(0.05).max(2) })).max(6).default([]),
    /** Show the temperature slider. */
    showTemp: z.boolean().default(false),
    /** Light one option (index) at a time, and send it into the prompt. */
    pick: z.object({ at, index: z.number().int().min(0).max(5) }).optional(),
    /** Card top, fraction of the safe height. */
    top: z.number().min(0).max(0.6).default(0.16),
  })
  .refine((p) => !p.pick || p.pick.index < p.options.length, { message: 'pick.index out of range', path: ['pick', 'index'] })
export type TokenOddsParams = z.infer<typeof tokenOddsParams>

export const loadedDieParams = z.object({
  /** The six faces (front, right, back, left, top, bottom). Repeat a token to load the die. */
  faces: z.array(z.string().min(1).max(10)).length(6),
  /** Each roll: when it starts (local s) and the face index it lands on (it tumbles for 0.9 s). */
  rolls: z.array(z.object({ at, face: z.number().int().min(0).max(5) })).max(6).default([]),
  /** A legend under the die: how many faces each token has. */
  legend: z.boolean().default(true),
  /** Die centre, fraction of the safe height. */
  y: z.number().min(0.2).max(0.8).default(0.45),
})
export type LoadedDieParams = z.infer<typeof loadedDieParams>
export const DIE = { tumble: 0.9 } as const

export const serverBatchParams = z.object({
  /** The questions arriving together; the first one is yours. */
  questions: z.array(oneLineAr(22, 'questions[]')).min(2).max(4),
  /** Local s the questions fly in, and when your answer comes out. */
  at: at.default(0.2),
  outAt: at.default(1.6),
  /** Your answer as [before, changed word, after]; the word flips from `changed[0]` to `changed[1]` at `flipAt`. */
  answer: z.tuple([oneLineAr(20, 'answer[0]'), oneLineAr(20, 'answer[1]')]),
  changed: z.tuple([z.string().min(1).max(12), z.string().min(1).max(12)]),
  flipAt: at.default(2.6),
})
export type ServerBatchParams = z.infer<typeof serverBatchParams>

export const cuesOfTokenStream = (p: TokenStreamParams): Cue[] => p.tokens.map((t) => ({ t: t.at, kind: 'tick' as const }))
export const cuesOfTokenOdds = (p: TokenOddsParams): Cue[] => (p.pick ? [{ t: p.pick.at, kind: 'pop' as const }] : [])
export const cuesOfLoadedDie = (p: LoadedDieParams): Cue[] => p.rolls.map((r) => ({ t: r.at + DIE.tumble, kind: 'tick' as const }))
export const cuesOfServerBatch = (p: ServerBatchParams): Cue[] => [{ t: p.outAt, kind: 'pop' }]
