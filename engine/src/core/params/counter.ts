import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { seg } from '../ease'

const affix = z
  .string()
  .min(1)
  .max(12)
  .refine((t) => !/[\r\n]/.test(t), { message: 'must be a single line' })

/** Params of `counter`. */
export const counterParams = z
  .object({
    from: z.number().finite(),
    to: z.number().finite(),
    prefix: affix.optional(),
    /** e.g. `٪`. */
    suffix: affix.optional(),
    /** `arabic`: ٠-٩ (`ar-EG`); `latin`: 0-9 (`en`). */
    digits: z.enum(['arabic', 'latin']).default('arabic'),
    /** Seconds the value rolls from `from` to `to` (power3.out). */
    roll: z.number().positive({ message: 'roll must be > 0' }).max(30).default(1.2),
    /** A line drawn through the settled number from `at` (cue `tick`); `at` is no earlier than the end of the roll. */
    strike: z.object({ at: z.number().min(0) }).optional(),
    /** Morph key (Task 8). */
    key: z.string().min(1).optional(),
  })
  .refine((p) => p.strike === undefined || p.strike.at >= p.roll, { path: ['strike', 'at'], message: 'strike.at must be no earlier than the roll end' })

export type CounterParams = z.infer<typeof counterParams>

/** GSAP `power3.out`. */
export const power3Out = (x: number): number => 1 - (1 - x) ** 3

/** Decimal places shown: as many as `from`/`to` have (at most 3). */
export function counterDecimals(p: Pick<CounterParams, 'from' | 'to'>): number {
  const dec = (n: number) => {
    for (let d = 0; d < 3; d++) if (Number(n.toFixed(d)) === n) return d
    return 3
  }
  return Math.max(dec(p.from), dec(p.to))
}

/** The roll length in a scene of `duration` s: a shorter scene compresses it. */
export function rollOf(p: Pick<CounterParams, 'roll'>, duration: number): number {
  return Math.min(p.roll, duration)
}

/** The value at local `t` (pure): power3.out from `from` to `to` over the roll, rounded to the shown decimals. */
export function counterValue(p: CounterParams, t: number, duration = Infinity): number {
  const r = rollOf(p, duration)
  const x = seg(t, 0, r)
  if (x >= 1) return p.to
  const d = 10 ** counterDecimals(p)
  return Math.round((p.from + (p.to - p.from) * power3Out(x)) * d) / d
}

/** `prefix + number + suffix`, the number in `Intl.NumberFormat('ar-EG' | 'en')` with fixed decimals. */
export function formatCounter(p: CounterParams, value: number): string {
  const d = counterDecimals(p)
  const nf = new Intl.NumberFormat(p.digits === 'arabic' ? 'ar-EG' : 'en', { minimumFractionDigits: d, maximumFractionDigits: d })
  // A word affix (any letter: «ساعة», «ريال», "USD") takes a space; a symbol (٪ % $ +) stays attached.
  const gap = (a: string) => (/\p{L}/u.test(a) ? ' ' : '')
  const pre = p.prefix === undefined ? '' : p.prefix + gap(p.prefix)
  const suf = p.suffix === undefined ? '' : gap(p.suffix) + p.suffix
  return `${pre}${nf.format(value)}${suf}`
}

const DIGITS = { arabic: '٠١٢٣٤٥٦٧٨٩', latin: '0123456789' } as const

/**
 * Strings whose widest rendering bounds every value the counter can show: the formatted `from`,
 * `to` (and the signed maximum when a sign can appear), each with every digit replaced by each one
 * digit in turn. Fonts need not have tabular Arabic-Indic digits (Cairo does not), so the widest
 * digit decides the width lock.
 */
export function counterWidthProbes(p: CounterParams): string[] {
  const big = Math.max(Math.abs(p.from), Math.abs(p.to))
  const bases = [p.from, p.to, ...(Math.min(p.from, p.to) < 0 ? [-big] : [])].map((v) => formatCounter(p, v))
  const set = DIGITS[p.digits]
  const isDigit = (c: string) => set.includes(c)
  return bases.flatMap((b) => [...set].map((d) => [...b].map((c) => (isDigit(c) ? d : c)).join('')))
}

/** Sound cues of `counter`: `count` over the roll, `final` as it lands. */
export function cuesOfCounter(p: CounterParams, ctx: { duration: number }): Cue[] {
  const r = rollOf(p, ctx.duration)
  return [
    { t: 0, kind: 'count', duration: r },
    { t: r, kind: 'final' },
    ...(p.strike ? [{ t: p.strike.at, kind: 'tick' as const }] : []),
  ]
}
