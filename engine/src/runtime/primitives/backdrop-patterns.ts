import { BACKDROP_REACT, type BackdropParams } from '../../core/params/backdrop'
import type { BuildCtx } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'
const TAU = Math.PI * 2

export interface Pattern {
  svg: SVGSVGElement
  /** Redraws the pattern for local time `t` (a pure function of t and the seeded build). */
  update(t: number): void
}

const f = (x: number): string => x.toFixed(2)

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

/**
 * The generative pattern of a backdrop, as SVG in the layer: drawn in the world's fg
 * (`var(--mba-fg)`) at `patternAlpha`, seeded by `ctx.rng` at build, every moving value a pure
 * function of the local time. Sizes scale with the frame width (1080 = 1). `null` for `none`.
 * `hero` (Task 6, `dots` only): the hero's centre in frame px at local time t, or undefined while
 * there is none; dots near it swell (`BACKDROP_REACT`).
 */
export function buildPattern(ctx: BuildCtx, p: BackdropParams, hero?: (t: number) => { x: number; y: number } | undefined): Pattern | null {
  if (p.pattern === 'none') return null
  const { w, h } = ctx.size
  const k = w / 1080
  const rnd = ctx.rng
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: String(w), height: String(h) })
  svg.dataset.mbaPart = `pattern-${p.pattern}`
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none' })
  const g = el('g', { opacity: String(p.patternAlpha) })
  g.style.fill = ctx.look.vars.fg
  g.style.stroke = 'none'
  svg.append(g)
  const stroke = (width: number) => {
    g.style.fill = 'none'
    g.style.stroke = ctx.look.vars.fg
    g.setAttribute('stroke-width', f(width))
    g.setAttribute('stroke-linecap', 'round')
    g.setAttribute('stroke-linejoin', 'round')
  }

  if (p.pattern === 'dots') {
    // A grid of circles whose radius breathes on a 6 s cycle, each with its own phase.
    const sp = 64 * k
    const cols = Math.ceil(w / sp) + 1
    const rows = Math.ceil(h / sp) + 1
    const dots: { c: SVGCircleElement; phase: number; x: number; y: number }[] = []
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const c = el('circle', { cx: f(i * sp), cy: f(j * sp) })
        g.append(c)
        dots.push({ c, phase: rnd() * TAU, x: i * sp, y: j * sp })
      }
    }
    const base = 0.2 * sp
    const reach = BACKDROP_REACT.radius * sp
    return {
      svg,
      update(t) {
        const at = hero?.(t)
        for (const d of dots) {
          const swell = at ? BACKDROP_REACT.gain * Math.exp(-((d.x - at.x) ** 2 + (d.y - at.y) ** 2) / (reach * reach)) : 0
          d.c.setAttribute('r', f(base * (1 + 0.6 * Math.sin((TAU * t) / 6 + d.phase) + swell)))
        }
      },
    }
  }

  if (p.pattern === 'stripes') {
    // Diagonal lines sliding sideways at 18 px/s (at 1080 wide), wrapping every spacing.
    const sp = 56 * k
    stroke(4 * k)
    const from = -Math.ceil(h / sp) - 1
    const to = Math.ceil(w / sp)
    for (let i = from; i <= to; i++) g.append(el('line', { x1: f(i * sp), y1: f(h), x2: f(i * sp + h), y2: '0' }))
    const off0 = rnd() * sp
    return {
      svg,
      update(t) {
        g.setAttribute('transform', `translate(${f((off0 + 18 * k * t) % sp)} 0)`)
      },
    }
  }

  if (p.pattern === 'ridges') {
    // Five ridge lines: y = y0 + a·sin(kx·x + φ + ω·t).
    stroke(3 * k)
    const step = 24 * k
    const n = Math.ceil(w / step) + 1
    const ridges = Array.from({ length: 5 }, (_, j) => {
      const line = el('polyline')
      g.append(line)
      return {
        line,
        y0: h * (0.22 + 0.14 * j) + (rnd() - 0.5) * 0.04 * h,
        a: (28 + rnd() * 30) * k,
        kx: TAU / ((400 + rnd() * 500) * k),
        phase: rnd() * TAU,
        omega: (0.4 + rnd() * 0.6) * (rnd() < 0.5 ? -1 : 1),
      }
    })
    return {
      svg,
      update(t) {
        for (const r of ridges) {
          const pts: string[] = []
          for (let i = 0; i < n; i++) {
            const x = i * step
            pts.push(`${f(x)},${f(r.y0 + r.a * Math.sin(r.kx * x + r.phase + r.omega * t))}`)
          }
          r.line.setAttribute('points', pts.join(' '))
        }
      },
    }
  }

  if (p.pattern === 'shapes') {
    // 12 circles, squares and triangles turning slowly and drifting at most 24 px.
    const shapes = Array.from({ length: 12 }, (_, i) => {
      const s = (50 + rnd() * 90) * k
      const node = el('g')
      if (i % 3 === 0) node.append(el('circle', { r: f(s / 2) }))
      else if (i % 3 === 1) node.append(el('rect', { x: f(-s / 2), y: f(-s / 2), width: f(s), height: f(s) }))
      else node.append(el('polygon', { points: `0,${f(-s * 0.58)} ${f(s * 0.5)},${f(s * 0.29)} ${f(-s * 0.5)},${f(s * 0.29)}` }))
      g.append(node)
      return { node, cx: rnd() * w, cy: rnd() * h, a0: rnd() * 360, omega: (rnd() - 0.5) * 24, p1: rnd() * TAU, p2: rnd() * TAU }
    })
    const drift = 24 * k
    return {
      svg,
      update(t) {
        for (const s of shapes) {
          const x = s.cx + drift * Math.sin(0.35 * t + s.p1)
          const y = s.cy + drift * Math.cos(0.27 * t + s.p2)
          s.node.setAttribute('transform', `translate(${f(x)} ${f(y)}) rotate(${f(s.a0 + s.omega * t)})`)
        }
      },
    }
  }

  // blobs: three closed shapes of 8 control points, each moving on a small ellipse.
  const blobs = Array.from({ length: 3 }, (_, i) => {
    const path = el('path')
    g.append(path)
    return {
      path,
      cx: w * (0.2 + 0.3 * i + (rnd() - 0.5) * 0.1),
      cy: h * (0.25 + 0.25 * i + (rnd() - 0.5) * 0.1),
      R: (260 + rnd() * 160) * k,
      phase: rnd() * TAU,
      pts: Array.from({ length: 8 }, () => ({ omega: 0.5 + rnd() * 0.7, phase: rnd() * TAU })),
    }
  })
  return {
    svg,
    update(t) {
      for (const b of blobs) {
        const cx = b.cx + 40 * k * Math.cos(0.25 * t + b.phase)
        const cy = b.cy + 30 * k * Math.sin(0.2 * t + b.phase)
        const P = b.pts.map((c, m) => {
          const r = b.R * (1 + 0.16 * Math.sin(c.omega * t + c.phase))
          const a = (TAU * m) / 8
          return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
        })
        // Closed Catmull-Rom through the 8 points, as cubic Béziers.
        let d = `M${f(P[0]!.x)} ${f(P[0]!.y)}`
        for (let m = 0; m < 8; m++) {
          const p0 = P[(m + 7) % 8]!
          const p1 = P[m]!
          const p2 = P[(m + 1) % 8]!
          const p3 = P[(m + 2) % 8]!
          d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`
        }
        b.path.setAttribute('d', `${d}Z`)
      }
    },
  }
}
