import { rng } from './rng'

/**
 * Pure colour maths for the reference palette (`mba reference`): sRGB ↔ CIE Lab, ΔE, WCAG contrast,
 * weighted k-means, cluster merge and roles. No I/O; the node side samples the pixels.
 */

/** An sRGB colour, 0..255 per channel. */
export type RGB = [number, number, number]

export type PaletteRole = 'background' | 'surface' | 'accent' | 'text'

export interface PaletteColour {
  /** `#rrggbb`, lower case. */
  hex: string
  /** Part of all sampled pixels (0..1, 4 decimals). */
  share: number
  role: PaletteRole
}

/**
 * Colour clustering (`paletteOf`): k-means in CIE Lab
 * (k clusters, seeded k-means++ init, `iterations` Lloyd steps), clusters closer than `mergeDeltaE`
 * (CIE76) merged. Roles: background = largest share; accent = highest chroma among the rest with
 * share ≥ `accentMinShare` (and chroma ≥ `accentMinChroma`, so a grey is never the accent); text =
 * highest WCAG contrast against the background among the rest with share ≥ `textMinShare`; every
 * other colour is a surface. At most `maxColours`.
 */
export const PALETTE = {
  k: 8,
  iterations: 20,
  mergeDeltaE: 8,
  accentMinShare: 0.01,
  accentMinChroma: 10,
  textMinShare: 0.005,
  maxColours: 6,
} as const

type Lab = [number, number, number]

const toLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
// D65 white.
const XN = 0.95047
const ZN = 1.08883
const fLab = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
const fLabInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27))

/** sRGB (0..255) → CIE Lab (D65). */
export function rgbToLab([r, g, b]: RGB): Lab {
  const R = toLinear(r)
  const G = toLinear(g)
  const B = toLinear(b)
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / ZN
  const fx = fLab(x)
  const fy = fLab(y)
  const fz = fLab(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIE Lab (D65) → sRGB (0..255, rounded and clamped). */
export function labToRgb([L, a, b]: Lab): RGB {
  const fy = (L + 16) / 116
  const x = fLabInv(fy + a / 500) * XN
  const y = fLabInv(fy)
  const z = fLabInv(fy - b / 200) * ZN
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const G = -0.969266 * x + 1.8760108 * y + 0.041556 * z
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
  const c = (v: number) => Math.min(255, Math.max(0, Math.round(fromLinear(Math.min(1, Math.max(0, v))))))
  return [c(R), c(G), c(B)]
}

const labDist = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])

/** CIE76 colour difference of two sRGB colours. */
export function deltaE(a: RGB, b: RGB): number {
  return labDist(rgbToLab(a), rgbToLab(b))
}

/** WCAG 2 contrast ratio (1..21) of two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const rgb = (h: string): RGB => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h.trim())
    if (!m) throw new Error(`لون غير صالح — Invalid colour: ${h}`)
    return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
  }
  return contrast(rgb(a), rgb(b))
}

/** WCAG 2 contrast ratio (1..21). */
function contrast(a: RGB, b: RGB): number {
  const lum = ([r, g, bl]: RGB) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(bl)
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const hexOf = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

/**
 * The palette of `pixels` (packed `rgb24`, any number of frames), largest share first (see `PALETTE`).
 * Pure: the same pixels and seed give the same palette. Weighted k-means over the distinct colours,
 * so the result does not depend on pixel order.
 */
export function paletteOf(pixels: Uint8Array, seed: number): PaletteColour[] {
  if (pixels.length % 3 !== 0) throw new Error(`بيانات البكسل ليست RGB — pixel buffer length ${pixels.length} is not a multiple of 3 (RGB)`)
  const total = pixels.length / 3
  if (total === 0) return []
  // Distinct colours (24-bit keys, sorted for an order-independent result) and their counts.
  const counts = new Map<number, number>()
  for (let i = 0; i < pixels.length; i += 3) {
    const key = (pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const keys = [...counts.keys()].sort((a, b) => a - b)
  const n = keys.length
  const lab: Lab[] = keys.map((k) => rgbToLab([(k >> 16) & 255, (k >> 8) & 255, k & 255]))
  const w = keys.map((k) => counts.get(k)!)

  // Seeded k-means++ (weighted): stops early when every colour already is a centre.
  const rand = rng(seed)
  const pick = (weights: number[]) => {
    const sum = weights.reduce((a, x) => a + x, 0)
    let r = rand() * sum
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!
      if (r < 0) return i
    }
    return weights.length - 1
  }
  const centres: Lab[] = [[...lab[pick(w)]!] as Lab]
  const d2 = lab.map((p) => labDist(p, centres[0]!) ** 2)
  while (centres.length < PALETTE.k) {
    const weights = d2.map((d, i) => d * w[i]!)
    if (!(weights.reduce((a, x) => a + x, 0) > 0)) break
    const c = [...lab[pick(weights)]!] as Lab
    centres.push(c)
    for (let i = 0; i < n; i++) d2[i] = Math.min(d2[i]!, labDist(lab[i]!, c) ** 2)
  }

  const assign = new Int32Array(n)
  let weight: number[] = []
  for (let it = 0; it < PALETTE.iterations; it++) {
    const sum = centres.map(() => [0, 0, 0])
    weight = centres.map(() => 0)
    for (let i = 0; i < n; i++) {
      let best = 0
      let bd = Infinity
      for (let c = 0; c < centres.length; c++) {
        const d = labDist(lab[i]!, centres[c]!)
        if (d < bd) {
          bd = d
          best = c
        }
      }
      assign[i] = best
      const p = lab[i]!
      sum[best]![0]! += p[0] * w[i]!
      sum[best]![1]! += p[1] * w[i]!
      sum[best]![2]! += p[2] * w[i]!
      weight[best]! += w[i]!
    }
    centres.forEach((c, k) => {
      if (weight[k]! > 0) for (let j = 0; j < 3; j++) c[j] = sum[k]![j]! / weight[k]!
    })
  }

  // Merge clusters closer than mergeDeltaE, closest pair first (weighted mean).
  let clusters = centres.map((c, k) => ({ lab: c, weight: weight[k]! })).filter((c) => c.weight > 0)
  for (;;) {
    let bi = -1
    let bj = -1
    let bd: number = PALETTE.mergeDeltaE
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = labDist(clusters[i]!.lab, clusters[j]!.lab)
        if (d < bd) {
          bd = d
          bi = i
          bj = j
        }
      }
    }
    if (bi < 0) break
    const a = clusters[bi]!
    const b = clusters[bj]!
    const W = a.weight + b.weight
    const merged = { lab: a.lab.map((v, j) => (v * a.weight + b.lab[j]! * b.weight) / W) as Lab, weight: W }
    clusters = clusters.filter((_, k) => k !== bi && k !== bj)
    clusters.push(merged)
  }

  const cols = clusters
    .map((c) => ({ rgb: labToRgb(c.lab), lab: c.lab, share: c.weight / total }))
    .sort((a, b) => b.share - a.share || a.lab[0] - b.lab[0])
  const roles = new Map<number, PaletteRole>([[0, 'background']])
  const chroma = (l: Lab) => Math.hypot(l[1], l[2])
  let accent = -1
  cols.forEach((c, i) => {
    if (i === 0 || c.share < PALETTE.accentMinShare || chroma(c.lab) < PALETTE.accentMinChroma) return
    if (accent < 0 || chroma(c.lab) > chroma(cols[accent]!.lab)) accent = i
  })
  if (accent >= 0) roles.set(accent, 'accent')
  let text = -1
  cols.forEach((c, i) => {
    if (roles.has(i) || c.share < PALETTE.textMinShare) return
    if (text < 0 || contrast(c.rgb, cols[0]!.rgb) > contrast(cols[text]!.rgb, cols[0]!.rgb)) text = i
  })
  if (text >= 0) roles.set(text, 'text')
  // Keep the roles, then the largest surfaces, up to maxColours; largest share first.
  const keep = new Set(roles.keys())
  for (let i = 0; i < cols.length && keep.size < PALETTE.maxColours; i++) keep.add(i)
  return cols
    .map((c, i) => ({ i, c }))
    .filter(({ i }) => keep.has(i))
    .map(({ i, c }) => ({ hex: hexOf(c.rgb), share: Math.round(c.share * 1e4) / 1e4, role: roles.get(i) ?? 'surface' }))
}
