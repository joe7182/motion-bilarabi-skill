import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { oneLineAr } from './common'

/**
 * Data and phone moments:
 * - notify-stack: phone notifications drop in from the top and stack (newest on top, older ones tuck behind).
 * - stat-bars: a bar chart whose bars grow one by one while their numbers count up; one bar can be the hero.
 * - gauge-ring: a ring that sweeps to a value, the number counting in the middle.
 * - live-timer: a stopwatch or countdown ticking in mono digits, with a pulsing dot and an optional progress ring.
 */

const at = z.number().min(0)
const digits = z.enum(['arabic', 'latin']).default('arabic')

export const notifyStackParams = z.object({
  items: z
    .array(
      z.object({
        app: oneLineAr(20, 'items[].app'),
        title: oneLineAr(34, 'items[].title'),
        body: z.string().max(80).optional(),
        /** One letter or emoji on the app icon, and its colour. */
        icon: z.string().min(1).max(2).optional(),
        tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#25d366'),
        time: z.string().max(10).default('الآن'),
        at,
      }),
    )
    .min(1)
    .max(8),
  /** Top of the stack, fraction of the safe height. */
  y: z.number().min(0).max(1).default(0.06),
  /** Cards shown before older ones tuck behind. */
  show: z.number().int().min(1).max(4).default(3),
  theme: z.enum(['light', 'dark']).default('light'),
  out: at.optional(),
})
export type NotifyStackParams = z.infer<typeof notifyStackParams>

export const statBarsParams = z.object({
  title: oneLineAr(34, 'title').optional(),
  rows: z.array(z.object({ label: oneLineAr(18, 'rows[].label'), value: z.number().finite().min(0), hero: z.boolean().default(false) })).min(1).max(7),
  /** The full-bar value; defaults to the largest row. */
  max: z.number().positive().optional(),
  suffix: z.string().max(4).default(''),
  digits,
  at: at.default(0.2),
  /** Seconds between bars, and each bar's grow time. */
  stagger: z.number().min(0).max(1).default(0.18),
  grow: z.number().min(0.2).max(3).default(0.8),
  y: z.number().min(0).max(1).default(0.45),
})
export type StatBarsParams = z.infer<typeof statBarsParams>

export const gaugeRingParams = z.object({
  /** 0–100 (percent of the ring). */
  value: z.number().min(0).max(100),
  from: z.number().min(0).max(100).default(0),
  label: oneLineAr(28, 'label').optional(),
  suffix: z.string().max(4).default('٪'),
  digits,
  at: at.default(0.2),
  dur: z.number().min(0.2).max(5).default(1.4),
  /** Ring diameter as a fraction of the width. */
  size: z.number().min(0.25).max(0.9).default(0.62),
  y: z.number().min(0).max(1).default(0.45),
})
export type GaugeRingParams = z.infer<typeof gaugeRingParams>

export const TIMER_FORMATS = ['mm:ss', 'mm:ss.cc', 'hh:mm:ss'] as const
export const liveTimerParams = z.object({
  /** Shown time (s) at `at` and at `at + dur`: from < to counts up, from > to counts down. */
  from: z.number().min(0).max(359999),
  to: z.number().min(0).max(359999),
  at: at.default(0),
  /** Seconds of the scene the count takes (a long span plays fast). */
  dur: z.number().min(0.2).max(600),
  format: z.enum(TIMER_FORMATS).default('mm:ss'),
  digits: z.enum(['arabic', 'latin']).default('latin'),
  label: z.string().max(20).optional(),
  /** A ring around the digits filling with the progress. */
  ring: z.boolean().default(false),
  /** The last seconds of a countdown flash in the accent. */
  warn: z.number().min(0).max(60).default(0),
  y: z.number().min(0).max(1).default(0.45),
  size: z.number().min(60).max(260).default(170),
})
export type LiveTimerParams = z.infer<typeof liveTimerParams>

const AR = '٠١٢٣٤٥٦٧٨٩'
/** A number with `decimals` places in Arabic-Indic or Latin digits (Arabic uses ٫ as the decimal mark). */
export function fmtNumber(n: number, decimals: number, d: 'arabic' | 'latin'): string {
  const s = n.toFixed(decimals)
  return d === 'latin' ? s : s.replace(/\d/g, (c) => AR[Number(c)]!).replace('.', '٫')
}
/** Decimal places a value needs (0–2). */
export const decimalsOf = (n: number) => (Number.isInteger(n) ? 0 : Number(n.toFixed(1)) === n ? 1 : 2)

/** Timer text for `sec` seconds (floored to the format's unit). */
export function timerText(sec: number, format: (typeof TIMER_FORMATS)[number], d: 'arabic' | 'latin'): string {
  const s = Math.max(0, sec)
  const two = (n: number) => String(Math.floor(n)).padStart(2, '0')
  let out: string
  if (format === 'hh:mm:ss') out = `${two(s / 3600)}:${two((s % 3600) / 60)}:${two(s % 60)}`
  else if (format === 'mm:ss.cc') out = `${two(s / 60)}:${two(s % 60)}.${two((s * 100) % 100)}`
  else out = `${two(s / 60)}:${two(s % 60)}`
  return d === 'latin' ? out : out.replace(/\d/g, (c) => AR[Number(c)]!)
}

export const cuesOfNotifyStack = (p: NotifyStackParams): Cue[] => p.items.map((it) => ({ t: it.at, kind: 'pop' as const }))
export const cuesOfStatBars = (p: StatBarsParams): Cue[] => p.rows.map((_, i) => ({ t: p.at + i * p.stagger, kind: 'tick' as const }))
export const cuesOfGaugeRing = (p: GaugeRingParams): Cue[] => [{ t: p.at + p.dur, kind: 'final' }]
export const cuesOfLiveTimer = (): Cue[] => []
