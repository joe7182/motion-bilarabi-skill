import type { Cue } from '../audio-plan'
import { z } from 'zod'

const codePoints = (t: string) => [...t].length

/** Params of `search-typing`. */
export const searchTypingParams = z.object({
  text: z
    .string()
    .refine((t) => codePoints(t) >= 1 && codePoints(t) <= 60, { message: 'text must be 1..60 characters' })
    .refine((t) => t.trim().length > 0, { message: 'text must not be blank' })
    .refine((t) => !/[\r\n]/.test(t), { message: 'text must be a single line' }),
  results: z.number().int().min(0).max(8).default(4),
  cps: z.number().min(1).max(60).default(14),
  zoom: z.number().min(1).max(4).default(1.9),
})

export type SearchTypingParams = z.infer<typeof searchTypingParams>

/** Typing phases of `search-typing` (seconds, uncompressed); the runtime's SEARCH uses these. */
export const TYPING = {
  /** The bar scales in over 0..intro; typing starts at `intro`. */
  intro: 0.5,
  /** Pause after the last character before the camera pulls back. */
  hold: 0.4,
  /** The camera eases back to scale 1 over this long. */
  pullback: 0.45,
  /** Time kept for the result rows when a short scene forces the typing to speed up. */
  resultsMin: 0.6,
  /** Typing never gets shorter than this (unless the whole scene is compressed). */
  minTyping: 0.5,
} as const

/**
 * The typing schedule for a scene of `duration` s (local time): `appear[i]` is when code point i
 * is shown (a space takes two per-char slots, every other character one). Short scenes speed the
 * typing up; only when even TYPING.minTyping does not fit are all phases scaled by `k`. One
 * schedule for picture (runtime) and sound (`core/audio-plan.ts`).
 */
export function typingSchedule(p: SearchTypingParams, duration: number): { k: number; typeStart: number; typingDur: number; appear: number[] } {
  const chars = [...p.text]
  const slots = chars.map((c) => (c === ' ' ? 2 : 1))
  const units = slots.reduce((a, b) => a + b, 0)
  const naturalTyping = units / p.cps
  const fixed = TYPING.intro + TYPING.hold + TYPING.pullback + TYPING.resultsMin
  let k = 1
  let typingDur = naturalTyping
  if (duration < fixed + naturalTyping) {
    const minTyping = Math.min(naturalTyping, TYPING.minTyping)
    if (duration - fixed >= minTyping) typingDur = duration - fixed
    else {
      k = duration / (fixed + minTyping)
      typingDur = minTyping * k
    }
  }
  const slot = typingDur / units
  const typeStart = TYPING.intro * k
  const appear: number[] = []
  let acc = 0
  for (let i = 0; i < chars.length; i++) {
    appear.push(typeStart + acc * slot)
    acc += slots[i]!
  }
  return { k, typeStart, typingDur, appear }
}

/** Local time each code point of `p.text` is typed, in a scene of `duration` s (default: no compression). */
export function typingTimes(p: SearchTypingParams, duration = Infinity): number[] {
  return typingSchedule(p, duration).appear
}

/** Sound cues of `search-typing` (`core/audio-plan.ts`): one `type-letter` per typed non-space character. */
export function cuesOfSearchTyping(p: SearchTypingParams, ctx: { duration: number }): Cue[] {
  const chars = [...p.text]
  return typingSchedule(p, ctx.duration).appear.flatMap((t, i) => (/\s/.test(chars[i]!) ? [] : [{ t, kind: 'type-letter' as const }]))
}
