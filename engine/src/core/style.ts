import { z } from 'zod'
import { contrastRatio, deltaE, PALETTE, type PaletteColour, type RGB } from './palette'
import { IDEA_IDS } from './recipes/ideas'

/**
 * Style DNA (`mba reference --style`): the GRAMMAR of one or more reference videos as numbers (rhythm,
 * colours, text density, motion size), never their content. Pure: the node side measures, this file
 * merges, derives the recipe's targets (Task 9) and scores our render against them (`adherence`).
 */

export const STYLE = {
  /** Sources shorter than this (s) say too little about cuts, text and motion. */
  minDuration: 6,
  /** … and so do sources with fewer motion events than this. */
  minEvents: 8,
  /** A measured range is widened to at least this width around its mean. */
  minWidth: { eventsPerSec: 0.4, medianEventGap: 0.1 },
  /** `text.density` from the mean `frameDetail` (edge pixels per 1000): below sparse, below medium, else dense. */
  detail: { sparse: 6, medium: 14 },
  /** `motion.size` from the mean block-motion value (0..255) at the events. */
  motion: { small: 8, medium: 20 },
  /** Colours closer than this ΔE (CIE76) are one colour. */
  mergeDeltaE: 8,
  /** `adherence`: maxEventGap may exceed the target by this factor; movingPct may fall short by this much. */
  maxGapSlack: 1.1,
  movingSlack: 0.03,
  /** `adherence`: a continuous style allows at most this many cuts a second in our render. */
  maxCutsPerSec: 0.15,
  /** `styleTargets`: text and accent need this contrast (WCAG) against the background to become a world. */
  worldContrast: 4.5,
} as const

/** "Few cuts": fewer than one cut per this many motion events (`fewCuts`). */
export const FEW_CUTS_RATIO = 4

/** True when the video moves far more often than it cuts (continuous motion / morphs). */
export function fewCuts(cuts: number, duration: number, eventsPerSec: number): boolean {
  if (!(duration > 0) || !(eventsPerSec > 0)) return false
  return cuts / duration < eventsPerSec / FEW_CUTS_RATIO
}

const range = z.tuple([z.number(), z.number()])

export const styleSchema = z.object({
  version: z.literal(1),
  sources: z.array(z.object({ file: z.string(), sha1: z.string().regex(/^[0-9a-f]{40}$/), duration: z.number() })).min(1),
  rhythm: z.object({
    eventsPerSec: range,
    medianEventGap: range,
    maxEventGap: z.number(),
    movingPct: z.number(),
    medianShot: z.number().nullable(),
    cutsPerSec: z.number().nullable(),
    continuous: z.boolean().nullable(),
  }),
  colours: z.array(z.object({ hex: z.string().regex(/^#[0-9a-f]{6}$/), share: z.number(), role: z.enum(['bg', 'surface', 'fg', 'accent']) })).max(PALETTE.maxColours),
  text: z.object({ density: z.enum(['sparse', 'medium', 'dense', 'unknown']) }),
  motion: z.object({ size: z.enum(['small', 'medium', 'large', 'unknown']) }),
  /** The distinctive moves, named by the watcher (`IDEA_IDS`; the director tries them first). `mba reference` leaves it empty. */
  signature: z.array(z.enum(IDEA_IDS)),
  warnings: z.array(z.string()),
})

export type StyleDna = z.output<typeof styleSchema>

/** What `styleFromReports` reads of a `ReferenceReport` (structural, so core stays free of node code). */
export interface StyleReport {
  duration: number
  cuts: readonly number[]
  medianShot: number
  events: readonly number[]
  eventsPerSec: number
  medianEventGap: number
  maxEventGap: number
  movingPct: number
  palette: readonly PaletteColour[]
}

export interface StyleSource {
  report: StyleReport
  /** Mean `frameDetail` over the frames. */
  detailMean: number
  /** Mean block-motion value (0..255) at the motion events. */
  motionMean: number
  file: string
  sha1: string
}

const r3 = (x: number) => Math.round(x * 1000) / 1000
const r4 = (x: number) => Math.round(x * 10000) / 10000
const fmt = (x: number) => String(Number(x.toFixed(3)))
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0)

/** `[min, max]` of `xs`, widened to at least `minWidth` around their mean. */
function rangeOf(xs: readonly number[], minWidth: number): [number, number] {
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  if (hi - lo >= minWidth - 1e-9) return [r3(lo), r3(hi)]
  const m = mean(xs)
  return [r3(Math.max(0, m - minWidth / 2)), r3(m + minWidth / 2)]
}

const rgbOf = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const ROLE = { background: 'bg', surface: 'surface', text: 'fg', accent: 'accent' } as const

/** The union of the sources' palettes, merged by ΔE (the larger colour keeps hex and role), at most 6, shares summing to 1. */
function mergeColours(sources: readonly StyleSource[]): StyleDna['colours'] {
  const all = sources.flatMap((s) => s.report.palette.map((c) => ({ hex: c.hex.toLowerCase(), share: c.share, role: ROLE[c.role] })))
  all.sort((a, b) => b.share - a.share)
  const clusters: { hex: string; share: number; role: StyleDna['colours'][number]['role'] }[] = []
  for (const c of all) {
    const near = clusters.find((k) => deltaE(rgbOf(k.hex), rgbOf(c.hex)) < STYLE.mergeDeltaE)
    if (near) near.share += c.share
    else clusters.push({ ...c })
  }
  const top = clusters.sort((a, b) => b.share - a.share).slice(0, PALETTE.maxColours)
  const total = top.reduce((a, c) => a + c.share, 0)
  return top.map((c) => ({ hex: c.hex, share: total > 0 ? r4(c.share / total) : 0, role: c.role }))
}

/**
 * The style of one or more references. Ranges are `[min, max]` across sources (at least `STYLE.minWidth`
 * wide); `maxEventGap` is the largest and `movingPct` the mean. A source shorter than `STYLE.minDuration`
 * or with fewer than `STYLE.minEvents` events says too little about cuts, text and motion: those fields
 * become `null` / `'unknown'` and a warning names it.
 */
export function styleFromReports(sources: readonly StyleSource[]): StyleDna {
  if (sources.length === 0) throw new Error('لا توجد مراجع — styleFromReports needs at least one reference')
  const warnings: string[] = []
  for (const s of sources) {
    const { duration, events } = s.report
    if (duration < STYLE.minDuration - 1e-9 || events.length < STYLE.minEvents) {
      warnings.push(
        `المرجع «${s.file}» قصير أو قليل الأحداث (${fmt(duration)} ث، ${events.length} حدثًا) فلا تُستنتج منه القطعات ولا كثافة النص ولا حجم الحركة — ` +
          `reference "${s.file}" is short or has few events (${fmt(duration)} s, ${events.length} events; needs ≥ ${STYLE.minDuration} s and ≥ ${STYLE.minEvents}): ` +
          'cuts, text density and motion size are not inferred from it',
      )
    }
  }
  const known = warnings.length === 0
  const reports = sources.map((s) => s.report)
  const density = (d: number) => (d < STYLE.detail.sparse ? 'sparse' : d < STYLE.detail.medium ? 'medium' : 'dense')
  const size = (m: number) => (m < STYLE.motion.small ? 'small' : m < STYLE.motion.medium ? 'medium' : 'large')
  return {
    version: 1,
    sources: sources.map((s) => ({ file: s.file, sha1: s.sha1, duration: r3(s.report.duration) })),
    rhythm: {
      eventsPerSec: rangeOf(reports.map((r) => r.eventsPerSec), STYLE.minWidth.eventsPerSec),
      medianEventGap: rangeOf(reports.map((r) => r.medianEventGap), STYLE.minWidth.medianEventGap),
      maxEventGap: r3(Math.max(...reports.map((r) => r.maxEventGap))),
      movingPct: r3(mean(reports.map((r) => r.movingPct))),
      medianShot: known ? r3(mean(reports.map((r) => r.medianShot))) : null,
      cutsPerSec: known ? r3(mean(reports.map((r) => (r.duration > 0 ? r.cuts.length / r.duration : 0)))) : null,
      continuous: known ? reports.every((r) => fewCuts(r.cuts.length, r.duration, r.eventsPerSec)) : null,
    },
    colours: mergeColours(sources),
    text: { density: known ? density(mean(sources.map((s) => s.detailMean))) : 'unknown' },
    motion: { size: known ? size(mean(sources.map((s) => s.motionMean))) : 'unknown' },
    signature: [],
    warnings,
  }
}

export interface StyleTargets {
  medianGap: [number, number]
  preferContinuous: boolean
  wordsPerShot: 1 | 2 | 3
  punchScale: 1.15 | 1.3 | 1.45
  worlds: { bg: string; fg: string; accent: string } | null
}

/**
 * What the recipe consumes: the median-gap range; continuous motion over cuts; words per shot from
 * the text density; punch scale from the motion size (`unknown` → the middle); and a colour world when
 * the style has a background, a foreground and an accent whose text contrast against the background
 * (WCAG) is at least `STYLE.worldContrast`, else `null`.
 */
export function styleTargets(s: StyleDna): StyleTargets {
  const role = (r: StyleDna['colours'][number]['role']) => s.colours.find((c) => c.role === r)?.hex
  const [bg, fg, accent] = [role('bg'), role('fg'), role('accent')]
  const worlds =
    bg && fg && accent && contrastRatio(fg, bg) >= STYLE.worldContrast - 1e-9 && contrastRatio(accent, bg) >= STYLE.worldContrast - 1e-9
      ? { bg, fg, accent }
      : null
  return {
    medianGap: [s.rhythm.medianEventGap[0], s.rhythm.medianEventGap[1]],
    preferContinuous: s.rhythm.continuous === true,
    wordsPerShot: s.text.density === 'sparse' ? 1 : s.text.density === 'dense' ? 3 : 2,
    punchScale: s.motion.size === 'small' ? 1.15 : s.motion.size === 'large' ? 1.45 : 1.3,
    worlds,
  }
}

export interface AdherenceRow {
  field: string
  target: string
  ours: string
  ok: boolean
}

/** What `adherence` reads of our render's pace. */
export interface OursPace {
  eventsPerSec: number
  medianEventGap: number
  maxEventGap: number
  movingPct: number
  cutsPerSec: number
}

/** Our render against the style: one row per field (`cuts` only for a continuous style). */
export function adherence(s: StyleDna, ours: OursPace): AdherenceRow[] {
  const e = 1e-9
  const [elo, ehi] = s.rhythm.eventsPerSec
  const [glo, ghi] = s.rhythm.medianEventGap
  const maxGap = s.rhythm.maxEventGap * STYLE.maxGapSlack
  const moving = s.rhythm.movingPct - STYLE.movingSlack
  const rows: AdherenceRow[] = [
    { field: 'eventsPerSec', target: `[${fmt(elo)}, ${fmt(ehi)}]`, ours: fmt(ours.eventsPerSec), ok: ours.eventsPerSec >= elo - e && ours.eventsPerSec <= ehi + e },
    { field: 'medianEventGap', target: `[${fmt(glo)}, ${fmt(ghi)}] s`, ours: `${fmt(ours.medianEventGap)} s`, ok: ours.medianEventGap >= glo - e && ours.medianEventGap <= ghi + e },
    { field: 'maxEventGap', target: `≤ ${fmt(maxGap)} s`, ours: `${fmt(ours.maxEventGap)} s`, ok: ours.maxEventGap <= maxGap + e },
    { field: 'movingPct', target: `≥ ${fmt(moving * 100)} %`, ours: `${fmt(ours.movingPct * 100)} %`, ok: ours.movingPct >= moving - e },
  ]
  if (s.rhythm.continuous === true) {
    rows.push({ field: 'cuts', target: `≤ ${STYLE.maxCutsPerSec} cuts/s (continuous)`, ours: `${fmt(ours.cutsPerSec)} cuts/s`, ok: ours.cutsPerSec <= STYLE.maxCutsPerSec + e })
  }
  return rows
}
