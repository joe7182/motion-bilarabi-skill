import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { rng } from '../rng'
import { morphKey, oneLine } from './common'
import { safePoint } from './line-art'

/**
 * `build-number` (Stage 2, Yousif's idea: «سبعة وتلاتين ألف طابوقة… وأربعمية وستة وخمسين كيس سمنت»):
 * vector objects fall from the top of the frame and STACK into the digits of a number, then the
 * stacked digits pull together into the clean typographic number (DOM text). Not a plain counter.
 * With bills (`item: 'banknote'`; the Iraqi dinar is paper) they can `flutter` in like thrown cash
 * or burst out of a point (`from`).
 */

/** The glyphs a value may hold: Latin digits, the separators `,` `٬` `.`, and the question marks `?` `؟`. */
export const BUILD_NUMBER_CHARS = '0123456789,٬.?؟'
const SEPARATORS = ',٬.'
export const isSeparator = (ch: string): boolean => SEPARATORS.includes(ch)

export const buildNumberParams = z
  .object({
    /** The number: Latin digits, separators (`,` `٬` `.`) and question marks (`?` `؟`), at most 11 characters. */
    value: z
      .string()
      .refine((v) => [...v].length >= 1 && [...v].length <= 11, { message: 'الرقم من ١ إلى ١١ خانة — value must be 1..11 characters' })
      .refine((v) => [...v].every((ch) => BUILD_NUMBER_CHARS.includes(ch)), {
        message: 'الرقم أرقام لاتينية وفواصل (, ٬ .) وعلامات استفهام (? ؟) فقط — value may hold only Latin digits, separators (, ٬ .) and question marks (? ؟)',
      })
      .refine((v) => [...v].some((ch) => !isSeparator(ch)), { message: 'الرقم يحتاج خانة واحدة على الأقل غير الفاصلة — value needs at least one digit or question mark' }),
    /** What the number is built of. */
    item: z.enum(['brick', 'cement-bag', 'banknote']).default('brick'),
    /** How the items come in: they `fall` and stack, or (bills only) `flutter` in like thrown cash. */
    entry: z.enum(['fall', 'flutter']).default('fall'),
    /** Burst out of this point (safe-area fractions) instead of entering from the top. */
    from: safePoint.optional(),
    /** After the morph, the clean number's digits (and question marks) keep rolling through random digits. */
    scramble: z.boolean().default(false),
    /** Centre of the number in the safe area. */
    at: safePoint.default({ x: 0.5, y: 0.5 }),
    /** Width of the number as a fraction of the safe width. */
    width: z.number().min(0.2).max(0.95).default(0.9),
    /** Scene s the first item drops. */
    fallFrom: z.number().min(0).default(0),
    /** Seconds from the first drop until the last item lands. */
    buildSec: z.number().min(0.5, { message: 'مدة البناء من ٠٫٥ ثانية — buildSec must be at least 0.5' }).max(10).default(1.3),
    /** Scene s the stacked digits become the clean number (default `BUILD_NUMBER.morphAfter` after the last landing). */
    morphAt: z.number().min(0).optional(),
    /** A word shown under the number after the morph (e.g. «طابوقة»). */
    label: oneLine(16, 'label').optional(),
    key: morphKey,
  })
  .superRefine((p, ctx) => {
    if (p.morphAt !== undefined && p.morphAt < p.fallFrom + p.buildSec) {
      ctx.addIssue({ code: 'custom', path: ['morphAt'], message: 'التحول قبل أن يكتمل البناء — morphAt must be no earlier than fallFrom + buildSec' })
    }
    if (p.entry === 'flutter' && p.item !== 'banknote') {
      ctx.addIssue({ code: 'custom', path: ['entry'], message: 'الرفرفة للأوراق النقدية فقط — entry flutter is for item banknote only' })
    }
  })

export type BuildNumberParams = z.infer<typeof buildNumberParams>

export const BUILD_NUMBER = {
  /** A falling item drops for `fallSec` (ease-in, gravity); a fluttering bill travels `flutterSec`; a burst from `from` takes `burstSec`. */
  fallSec: 0.42,
  flutterSec: 1.1,
  burstSec: 0.6,
  /** Default morph: this long after the last landing. */
  morphAfter: 0.4,
  /** The morph takes `morphSec`; the label rises in from `labelAt` into it over `labelSec`. */
  morphSec: 0.45,
  labelAt: 0.3,
  labelSec: 0.35,
  /** Scrambled digits change every `scrambleEvery` s. */
  scrambleEvery: 0.08,
  /** Landing: a tiny bounce (`bounce` × the cell height over `bounceSec`) and a dust puff over `dustSec` (not for paper). */
  bounce: 0.12,
  bounceSec: 0.16,
  dustSec: 0.32,
  /** Cue clusters: landings within `clusterSec` share one tick (at most `maxTicks`). */
  clusterSec: 0.2,
  maxTicks: 8,
  /** Flutter: extra bills beyond the cells (× the cell count, plus `extraMin`), each falling past for `extraSec` s. */
  extra: 0.7,
  extraMin: 8,
  extraSec: [1.5, 2.4],
  /** The stack's height at most this share of the safe height; a single glyph is `bigH` × the safe width tall. */
  maxH: 0.42,
  bigH: 0.55,
  /** Gap between glyphs (× the cell width). */
  gap: 0.35,
} as const

/** Cell size in units (w × h) of each item: bricks and bills are 2 : 1, cement sacks 1 : 1.3. */
export const ITEM_CELL = { brick: [2, 1], 'cement-bag': [1, 1.3], banknote: [2, 1] } as const

// Our own blocky digit fonts: rows top → bottom, '#' = a cell.
const FONT_5: Record<string, readonly string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '?': ['###', '..#', '.##', '...', '.#.'],
  '؟': ['###', '#..', '##.', '...', '.#.'],
}
const FONT_7: Record<string, readonly string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '..#', '###', '#..', '#..', '###'],
  '3': ['###', '..#', '..#', '.##', '..#', '..#', '###'],
  '4': ['#.#', '#.#', '#.#', '###', '..#', '..#', '..#'],
  '5': ['###', '#..', '#..', '###', '..#', '..#', '###'],
  '6': ['###', '#..', '#..', '###', '#.#', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '#.#', '###', '#.#', '#.#', '###'],
  '9': ['###', '#.#', '#.#', '###', '..#', '..#', '###'],
  '?': ['###', '..#', '..#', '.##', '.#.', '...', '.#.'],
  '؟': ['###', '#..', '#..', '##.', '.#.', '...', '.#.'],
}
const FONT_BIG: Record<string, readonly string[]> = {
  '?': ['.###.', '##.##', '...##', '..##.', '..#..', '..#..', '.....', '..#..', '..#..'],
  '؟': ['.###.', '##.##', '##...', '.##..', '..#..', '..#..', '.....', '..#..', '..#..'],
}

/** A glyph's bitmap: 3 × 7 for bricks, 3 × 5 otherwise, 5 × 9 for a single big glyph (digits scaled up from 3 × 7). */
export function glyphBitmap(ch: string, item: BuildNumberParams['item'], big: boolean): readonly string[] {
  if (big) {
    const own = FONT_BIG[ch]
    if (own) return own
    const base = FONT_7[ch]!
    const cols = [0, 1, 1, 1, 2]
    const rows = [0, 1, 2, 3, 3, 4, 5, 5, 6]
    return rows.map((r) => cols.map((c) => base[r]![c]!).join(''))
  }
  return (item === 'brick' ? FONT_7 : FONT_5)[ch]!
}

/** One item of the stack, in cell units: its box (x, y = top-left; y down from the stack top), glyph index, and its timing. */
export interface StackItem {
  glyph: number
  x: number
  y: number
  w: number
  h: number
  /** Row from the bottom (0 = the bottom course). */
  row: number
  /** A half brick (running bond's course ends) or a separator's small item. */
  small: boolean
  /** Scene s it lands (or settles). */
  land: number
  /** Scene s it starts to move. */
  start: number
  /** A per-item seed. */
  seed: number
}

export interface StackLayout {
  /** The whole stack in cell units. */
  w: number
  h: number
  /** Each glyph's box in cell units (x0, x1), its character, whether it is a separator. */
  glyphs: { ch: string; x0: number; x1: number; sep: boolean }[]
  items: StackItem[]
  big: boolean
  /** The seed of the whole build (from the params). */
  seed: number
}

/** A stable seed from the params that shape the build (pure; Node and the page agree). */
export function buildNumberSeed(p: Pick<BuildNumberParams, 'value' | 'item' | 'entry' | 'key'>): number {
  const s = `${p.value}|${p.item}|${p.entry}|${p.key ?? ''}`
  let h = 2166136261
  for (const ch of s) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** The scene s of the morph. */
export const morphAtOf = (p: Pick<BuildNumberParams, 'morphAt' | 'fallFrom' | 'buildSec'>): number => p.morphAt ?? p.fallFrom + p.buildSec + BUILD_NUMBER.morphAfter

/** How long one item travels (s). */
export function travelSecOf(p: Pick<BuildNumberParams, 'entry' | 'from' | 'buildSec'>): number {
  const base = p.entry === 'flutter' ? BUILD_NUMBER.flutterSec : p.from ? BUILD_NUMBER.burstSec : BUILD_NUMBER.fallSec
  return Math.min(base, p.buildSec * 0.6)
}

/**
 * The stack (pure, in cell units): glyphs left → right in the value's own order (digits stay in
 * Latin left-to-right order), each a cell bitmap; bricks in running bond (every other course offset
 * by half a brick: half bricks at the ends of runs, a one-cell pier stays whole); a separator is one
 * small item on the bottom course. Landing order: bottom courses first, seeded within a course;
 * the landings spread over [fallFrom + travel, fallFrom + buildSec].
 */
export function buildNumberLayout(p: BuildNumberParams): StackLayout {
  const chars = [...p.value]
  const big = chars.filter((c) => !isSeparator(c)).length === 1 && chars.length === 1
  const [cw, ch] = ITEM_CELL[p.item]
  const seed = buildNumberSeed(p)
  const R = rng(seed)
  const rowsOf = big ? 9 : p.item === 'brick' ? 7 : 5
  const glyphs: StackLayout['glyphs'] = []
  const raw: Omit<StackItem, 'land' | 'start' | 'seed'>[] = []
  let x = 0
  chars.forEach((c, gi) => {
    if (gi > 0) x += BUILD_NUMBER.gap * cw
    if (isSeparator(c)) {
      const w = cw * 0.6
      const hh = ch * 0.6
      glyphs.push({ ch: c, x0: x, x1: x + w, sep: true })
      raw.push({ glyph: gi, x, y: rowsOf * ch - hh, w, h: hh, row: 0, small: true })
      x += w
      return
    }
    const bm = glyphBitmap(c, p.item, big)
    const cols = bm[0]!.length
    glyphs.push({ ch: c, x0: x, x1: x + cols * cw, sep: false })
    bm.forEach((line, r) => {
      const row = rowsOf - 1 - r
      const y = r * ch
      // runs of filled cells on this course
      let c0 = -1
      for (let k = 0; k <= cols; k++) {
        const on = k < cols && line[k] === '#'
        if (on && c0 < 0) c0 = k
        if (!on && c0 >= 0) {
          const n = k - c0
          if (p.item === 'brick' && row % 2 === 1 && n >= 2) {
            // running bond: a half brick, n − 1 whole ones offset by half, a half brick
            raw.push({ glyph: gi, x: x + c0 * cw, y, w: cw / 2, h: ch, row, small: true })
            for (let m = 0; m < n - 1; m++) raw.push({ glyph: gi, x: x + (c0 + 0.5 + m) * cw, y, w: cw, h: ch, row, small: false })
            raw.push({ glyph: gi, x: x + (k - 0.5) * cw, y, w: cw / 2, h: ch, row, small: true })
          } else for (let m = c0; m < k; m++) raw.push({ glyph: gi, x: x + m * cw, y, w: cw, h: ch, row, small: false })
          c0 = -1
        }
      }
    })
    x += cols * cw
  })
  // landing order: by course from the bottom, seeded within a course
  const keyed = raw.map((it) => ({ it, k: it.row + 0.98 * R() }))
  keyed.sort((a, b) => a.k - b.k)
  const travel = travelSecOf(p)
  const t0 = p.fallFrom + travel
  const t1 = p.fallFrom + p.buildSec
  const n = keyed.length
  const items: StackItem[] = keyed.map(({ it }, i) => {
    const land = n === 1 ? t1 : t0 + (t1 - t0) * (i / (n - 1)) ** 0.92
    return { ...it, land, start: land - travel, seed: (seed + (i + 1) * 7919) >>> 0 }
  })
  // draw order: bottom courses first, left to right (a course covers the top faces below it)
  items.sort((a, b) => a.row - b.row || a.x - b.x)
  return { w: x, h: rowsOf * ch, glyphs, items, big, seed }
}

/**
 * The text of the clean number at scene s `t`: the value, or with `scramble` its digits and
 * question marks rolling through seeded digits (a new set every `scrambleEvery` s).
 */
export function buildNumberText(p: Pick<BuildNumberParams, 'value' | 'scramble' | 'item' | 'entry' | 'key'>, t: number): string {
  if (!p.scramble) return p.value
  const step = Math.floor(t / BUILD_NUMBER.scrambleEvery)
  const seed = buildNumberSeed(p)
  return [...p.value].map((c, i) => (isSeparator(c) ? c : String(Math.floor(rng((seed ^ Math.imul(step + 1, 2654435761)) + i * 40503)() * 10)))).join('')
}

/**
 * Sound: soft `tick`s for the landings, one per cluster of landings within `clusterSec` (at most
 * `maxTicks`; bills fluttering in get one `whoosh` instead); a `pop` as the number morphs.
 */
export function cuesOfBuildNumber(p: BuildNumberParams): Cue[] {
  const L = buildNumberLayout(p)
  const out: Cue[] = []
  if (p.entry === 'flutter' || p.from) out.push({ t: p.fallFrom, kind: 'whoosh' })
  if (p.entry === 'fall') {
    const lands = L.items.map((it) => it.land).sort((a, b) => a - b)
    let last = -Infinity
    for (const t of lands) {
      if (t - last < BUILD_NUMBER.clusterSec) continue
      out.push({ t, kind: 'tick' })
      last = t
    }
    const ticks = out.filter((c) => c.kind === 'tick')
    if (ticks.length > BUILD_NUMBER.maxTicks) {
      const keep = new Set(Array.from({ length: BUILD_NUMBER.maxTicks }, (_, i) => ticks[Math.round((i * (ticks.length - 1)) / (BUILD_NUMBER.maxTicks - 1))]))
      for (let i = out.length - 1; i >= 0; i--) if (out[i]!.kind === 'tick' && !keep.has(out[i]!)) out.splice(i, 1)
    }
  }
  out.push({ t: morphAtOf(p), kind: 'pop' })
  return out.sort((a, b) => a.t - b.t)
}

/** The morph (and the label rising in) must finish inside the scene. */
export function timingIssueOfBuildNumber(p: BuildNumberParams, sceneLen: number): { path: (string | number)[]; ar: string; en: string } | undefined {
  const end = morphAtOf(p) + BUILD_NUMBER.morphSec
  if (end > sceneLen) {
    return {
      path: [p.morphAt !== undefined ? 'morphAt' : 'buildSec'],
      ar: `الرقم يكتمل عند ${end.toFixed(2)} ث بعد نهاية المشهد (${sceneLen.toFixed(2)} ث)`,
      en: `the number finishes at ${end.toFixed(2)} s, after the scene ends (${sceneLen.toFixed(2)} s)`,
    }
  }
  return undefined
}
