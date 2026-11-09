/**
 * Currency signs drawn as our own simple vector strokes (not traced from any font or logo).
 * Unit coordinates: glyph height 1, centred on (0, 0), y grows downwards.
 */
import type { Pt } from './morph'

/** Currencies a scene can name (Stage 1A: the Iraqi dinar). */
export const CURRENCIES = ['AED', 'SAR', 'USD', 'EUR', 'IQD'] as const
export type Currency = (typeof CURRENCIES)[number]

/** A sign as polylines; `closed[i]` says whether stroke i joins back to its first point. */
export interface CurrencySign {
  strokes: Pt[][]
  closed: boolean[]
}

const ARC_STEPS = 28
const DEG = Math.PI / 180

/** Points of an elliptical arc from angle a0 to a1 (radians, either direction), both ends included. */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, steps = ARC_STEPS): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps)
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return out
}

/** The dirham sign: a «D» (stem + elliptical bow) crossed by two bars that run past stem and bow. */
function aed(): CurrencySign {
  const h = 0.5, sx = -0.3, bx = 0.02, rx = 0.36
  const d: Pt[] = [[sx, -h], [bx, -h], ...arc(bx, 0, rx, h, -Math.PI / 2, Math.PI / 2).slice(1), [sx, h]]
  const bars: Pt[][] = [-0.11, 0.11].map((y) => [[sx - 0.2, y], [bx + rx + 0.1, y]] as Pt[])
  return { strokes: [d, ...bars], closed: [true, false, false] }
}

/** Riyal sign (our own form): a tall hooked stem, a long bar across it and a short slanted dash. */
function sar(): CurrencySign {
  const hook: Pt[] = [[0.3, -0.5], [0.3, 0.1], ...arc(0.05, 0.1, 0.25, 0.4, 0, Math.PI, 20).slice(1)]
  const bar: Pt[] = [[-0.5, -0.08], [0.5, -0.08]]
  const dash: Pt[] = [[-0.38, -0.34], [-0.08, -0.5]]
  return { strokes: [hook, bar, dash], closed: [false, false, false] }
}

/** Dollar sign: an «S» built from two arcs, crossed by a full-height vertical bar. */
function usd(): CurrencySign {
  const r = 0.2
  const upper = arc(0, -r, r, r, -35 * DEG, -270 * DEG, 20)
  const lower = arc(0, r, r, r, -90 * DEG, 145 * DEG, 20)
  const s: Pt[] = [...upper, ...lower.slice(1)]
  const bar: Pt[] = [[0, -0.5], [0, 0.5]]
  return { strokes: [s, bar], closed: [false, false] }
}

/** Euro sign: an open «C» with two horizontal bars across its left side. */
function eur(): CurrencySign {
  const c = arc(0.04, 0, 0.42, 0.5, -50 * DEG, -310 * DEG, 40)
  const bars: Pt[][] = [-0.1, 0.1].map((y) => [[-0.5, y], [0.22, y]] as Pt[])
  return { strokes: [c, ...bars], closed: [false, false, false] }
}

/** Samples a cubic Bézier (start point excluded). */
function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps = 16): Pt[] {
  const out: Pt[] = []
  for (let i = 1; i <= steps; i++) {
    const u = i / steps
    const v = 1 - u
    const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]])
  }
  return out
}

/** Scales strokes uniformly to height 1 and centres their box on (0, 0). */
function fitUnit(strokes: Pt[][]): Pt[][] {
  const all = strokes.flat()
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const k = 1 / (y1 - y0)
  return strokes.map((s) => s.map(([x, y]) => [(x - (x0 + x1) / 2) * k, (y - (y0 + y1) / 2) * k] as Pt))
}

/**
 * Iraqi dinar «د.ع» (our own strokes, not traced from a font), read right → left: a «د» hook on
 * the right (a slanted head turning into a flat base on the baseline), the abbreviation dot on the
 * baseline, and a «ع» on the left (a small head open to the right over a bowl that sweeps below
 * the baseline and back).
 */
function iqd(): CurrencySign {
  // «د»: a short stroke falling to the right, then the base running back left with a small lift
  const dal: Pt[] = [
    [0.24, -0.2],
    ...cubic([0.24, -0.2], [0.31, -0.14], [0.4, -0.04], [0.4, 0.04]),
    ...cubic([0.4, 0.04], [0.4, 0.09], [0.37, 0.1], [0.33, 0.1], 8),
    [0.19, 0.1],
    [0.15, 0.06],
  ]
  const dot = arc(0.0, 0.075, 0.035, 0.035, 0, 2 * Math.PI, 16).slice(0, -1)
  const head = arc(-0.27, -0.13, 0.115, 0.11, -30 * DEG, -290 * DEG, 24)
  const h0 = head[head.length - 1]!
  const ain: Pt[] = [
    ...head,
    ...cubic(h0, [-0.44, 0.0], [-0.5, 0.36], [-0.27, 0.4]),
    ...cubic([-0.27, 0.4], [-0.15, 0.42], [-0.1, 0.39], [-0.06, 0.34], 10),
  ]
  const strokes = fitUnit([dal, dot, ain])
  return { strokes, closed: [false, true, false] }
}

/** The vector strokes of a currency sign, in unit coordinates (height 1, centred). */
export function currencySign(c: Currency): CurrencySign {
  switch (c) {
    case 'AED': return aed()
    case 'SAR': return sar()
    case 'USD': return usd()
    case 'EUR': return eur()
    case 'IQD': return iqd()
    default:
      throw new Error(`عملة غير معروفة "${String(c)}" — unknown currency "${String(c)}" (expected ${CURRENCIES.join(', ')})`)
  }
}

/** Read a currency code (case-insensitive). Missing → AED; an unknown code → AED plus `unknown` (the code as written). */
export function parseCurrency(code: string | undefined): { currency: Currency; unknown?: string } {
  const raw = code?.trim()
  if (!raw) return { currency: 'AED' }
  const up = raw.toUpperCase()
  if ((CURRENCIES as readonly string[]).includes(up)) return { currency: up as Currency }
  return { currency: 'AED', unknown: raw }
}
