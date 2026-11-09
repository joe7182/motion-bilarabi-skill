import { glitchCutParams, type GlitchCutParams } from '../../core/params/transitions'
import type { Transition } from './registry'
import { n } from './fmt'

const SVG = 'http://www.w3.org/2000/svg'

/** Steps across the window; each holds one precomputed keyframe. */
export const GLITCH_STEPS = 10
const SHIFT_PX = 24
const SPLIT_PX = 14
const BANDS = 3

interface Band {
  /** Top and height as fractions of the frame height. */
  y: number
  h: number
  /** How far the band is cut in from its side, px. */
  cut: number
  side: 'left' | 'right'
}
interface Key {
  x: number
  split: number
  bands: Band[]
}

/** Clip polygon: the full frame with each band notched in from its side (bands never overlap). */
function polygon(bands: Band[], w: number, h: number): string {
  const right = bands.filter((b) => b.side === 'right')
  const left = bands.filter((b) => b.side === 'left').reverse()
  const pts: [number, number][] = [
    [0, 0],
    [w, 0],
  ]
  for (const b of right) pts.push([w, b.y * h], [w - b.cut, b.y * h], [w - b.cut, (b.y + b.h) * h], [w, (b.y + b.h) * h])
  pts.push([w, h], [0, h])
  for (const b of left) pts.push([0, (b.y + b.h) * h], [b.cut, (b.y + b.h) * h], [b.cut, b.y * h], [0, b.y * h])
  return `polygon(${pts.map(([x, y]) => `${n(x)}px ${n(y)}px`).join(', ')})`
}

/**
 * Glitch cut: 10 rng keyframes (x shift ±24·intensity px, RGB split ±14·intensity px, 3 slice
 * bands), one per tenth of the window. The outgoing layer glitches for p < 0.5, the incoming from
 * p = 0.5. Each step sets `translateX`, a notched `clip-path` polygon and an SVG filter (in the
 * overlay's zero-size, rendered <svg>, id `mba-glitch-<index>`) that splits R/G/B with one
 * `feOffset` per channel; the dx values are written per step. Every value comes from `p` alone.
 */
export const glitchCut: Transition<GlitchCutParams> = {
  id: 'glitch-cut',
  params: glitchCutParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const sym = () => ctx.rng() * 2 - 1
    const keys: Key[] = []
    for (let k = 0; k < GLITCH_STEPS; k++) {
      const x = sym() * SHIFT_PX * p.intensity
      const split = sym() * SPLIT_PX * p.intensity
      const bands: Band[] = []
      for (let j = 0; j < BANDS; j++) {
        // One band per third of the frame, so bands never overlap.
        const y = (j + ctx.rng() * 0.7) / BANDS
        const bh = 0.02 + ctx.rng() * 0.08
        bands.push({ y, h: bh, cut: (60 + ctx.rng() * 180) * p.intensity, side: ctx.rng() < 0.5 ? 'left' : 'right' })
      }
      keys.push({ x, split, bands })
    }

    // The filter must stay rendered (Chromium ignores a filter inside display:none), so the <svg> is
    // zero-size and absolutely placed, and the overlay is hidden with visibility only.
    const id = `mba-glitch-${ctx.index}`
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    Object.assign(svg.style, { position: 'absolute', left: '0', top: '0' })
    const defs = document.createElementNS(SVG, 'defs')
    const filter = document.createElementNS(SVG, 'filter')
    filter.id = id
    const attrs: [string, string][] = [
      ['x', '-10%'],
      ['y', '0%'],
      ['width', '120%'],
      ['height', '100%'],
      ['color-interpolation-filters', 'sRGB'],
    ]
    for (const [a, v] of attrs) filter.setAttribute(a, v)
    const prim = (name: string, a: Record<string, string>) => {
      const e = document.createElementNS(SVG, name)
      for (const [k, v] of Object.entries(a)) e.setAttribute(k, v)
      filter.append(e)
      return e
    }
    const offsets: SVGElement[] = []
    for (let c = 0; c < 3; c++) {
      // Keep channel c only (and alpha).
      const rows = [0, 1, 2].map((r) => (r === c ? ['1 0 0 0 0', '0 1 0 0 0', '0 0 1 0 0'][c]! : '0 0 0 0 0'))
      prim('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: `${rows.join(' ')} 0 0 0 1 0`, result: `c${c}` })
      offsets.push(prim('feOffset', { in: `c${c}`, dx: '0', dy: '0', result: `o${c}` }))
    }
    prim('feBlend', { in: 'o0', in2: 'o1', mode: 'screen', result: 'rg' })
    prim('feBlend', { in: 'rg', in2: 'o2', mode: 'screen' })
    defs.append(filter)
    svg.append(defs)
    ctx.overlay.append(svg)

    return {
      update(pr) {
        const k = Math.min(GLITCH_STEPS - 1, Math.max(0, Math.floor(pr * GLITCH_STEPS)))
        const key = keys[k]!
        const layer = pr < 0.5 ? ctx.out : ctx.in
        // R shifts one way, B the other, G stays: a chromatic split.
        offsets[0]!.setAttribute('dx', n(key.split))
        offsets[1]!.setAttribute('dx', '0')
        offsets[2]!.setAttribute('dx', n(-key.split))
        layer.style.transform = `translateX(${n(key.x)}px)`
        layer.style.clipPath = polygon(key.bands, w, h)
        layer.style.filter = `url(#${id})`
      },
    }
  },
}
