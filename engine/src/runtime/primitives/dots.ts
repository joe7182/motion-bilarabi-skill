import { easeInOutCubic, easeOutCubic, seg } from '../../core/ease'
import { halftoneFieldParams, springGraphParams, type HalftoneFieldParams, type SpringGraphParams } from '../../core/params/dots'
import { spring } from '../../core/params/ui-morph'
import type { Primitive } from './registry'

const f2 = (x: number) => x.toFixed(2)
const f3 = (x: number) => x.toFixed(3)
const NS = 'http://www.w3.org/2000/svg'
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}
function colourOf(layer: HTMLElement, v: string, fb: string): string {
  return v.startsWith('var(') ? getComputedStyle(layer).getPropertyValue(v.slice(4, -1)).trim() || fb : v
}

/** spring-graph: the hero dot springs point to point, the line grows behind it, a callout pops at the end. */
export const springGraph: Primitive<SpringGraphParams> = {
  id: 'spring-graph',
  params: springGraphParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const s = ctx.safe
    const W = p.width * s.w
    const H = p.height * s.h
    const x0 = s.x + (s.w - W) / 2
    const yc = s.y + p.y * s.h
    const y0 = yc - H / 2
    const lo = Math.min(...p.values)
    const hi = Math.max(...p.values)
    const n = p.values.length
    // Reading order: the first point on the right.
    const pts = p.values.map((v, i) => ({ x: x0 + W - (W * i) / (n - 1), y: y0 + H - (H * (v - lo)) / (hi - lo || 1) }))
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}` })
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px`, overflow: 'visible' })
    ctx.layer.append(svg)
    const fg = ctx.look.vars.fg
    const accent = ctx.look.vars.accent
    // Grid: three faint rules and a baseline.
    for (let i = 0; i <= 3; i++) svg.append(el('line', { x1: f2(x0), x2: f2(x0 + W), y1: f2(y0 + (H * i) / 3), y2: f2(y0 + (H * i) / 3), stroke: fg, 'stroke-opacity': i === 3 ? '0.35' : '0.1', 'stroke-width': f2(2 * k) }))
    const area = el('path', { fill: accent, 'fill-opacity': '0.12', stroke: 'none' })
    const line = el('path', { fill: 'none', stroke: accent, 'stroke-width': f2(8 * k), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
    svg.append(area, line)
    const marks = pts.map(() => {
      const c = el('circle', { r: f2(9 * k), fill: 'var(--mba-bg)', stroke: accent, 'stroke-width': f2(5 * k), opacity: '0' })
      svg.append(c)
      return c
    })
    const dot = el('circle', { r: f2(22 * k), fill: accent })
    const halo = el('circle', { r: f2(22 * k), fill: accent, 'fill-opacity': '0.25' })
    svg.append(halo, dot)
    const chip = document.createElement('div')
    chip.textContent = p.callout
    Object.assign(chip.style, { position: 'absolute', left: '0', top: '0', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${f2(64 * k)}px`, padding: `${f2(8 * k)}px ${f2(24 * k)}px`, borderRadius: `${f2(18 * k)}px`, background: accent, color: '#fff', direction: 'rtl', whiteSpace: 'nowrap', transformOrigin: '50% 100%', opacity: '0' })
    ctx.layer.append(chip)
    const labels = [p.from, p.to].map((t, i) => {
      if (!t) return null
      const d = document.createElement('div')
      d.textContent = t
      const pt = pts[i === 0 ? 0 : n - 1]!
      Object.assign(d.style, { position: 'absolute', left: `${f2(pt.x)}px`, top: `${f2(y0 + H + 22 * k)}px`, transform: 'translateX(-50%)', fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${f2(40 * k)}px`, color: fg, opacity: '0.6', direction: 'rtl', whiteSpace: 'nowrap' })
      ctx.layer.append(d)
      return d
    })
    /** Where the dot is at t: springing from point i to i+1 over each step. */
    const at = (t: number) => {
      const u = (t - p.at) / p.step
      if (u <= 0) return { x: pts[0]!.x, y: pts[0]!.y, i: 0, f: 0 }
      const i = Math.min(n - 2, Math.floor(u))
      const f = Math.min(1.2, spring((u - i) * p.step * 1.15, 0.55, 18))
      const a = pts[i]!
      const b = pts[i + 1]!
      return { x: a.x + (b.x - a.x) * Math.min(1, (u - i)), y: a.y + (b.y - a.y) * f, i, f: u - i }
    }
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const appear = easeOutCubic(seg(t, p.at - 0.3, p.at))
        svg.style.opacity = f3(appear)
        for (const l of labels) if (l) l.style.opacity = f3(0.6 * appear)
        const P = at(t)
        // The drawn line: every reached point, then the dot's own position.
        const done = t <= p.at ? 0 : Math.min(n - 1, Math.floor((t - p.at) / p.step))
        let d = `M${f2(pts[0]!.x)},${f2(pts[0]!.y)}`
        for (let i = 1; i <= done; i++) d += ` L${f2(pts[i]!.x)},${f2(pts[i]!.y)}`
        const end = done >= n - 1 ? pts[n - 1]! : P
        d += ` L${f2(end.x)},${f2(end.y)}`
        line.setAttribute('d', d)
        area.setAttribute('d', `${d} L${f2(end.x)},${f2(y0 + H)} L${f2(pts[0]!.x)},${f2(y0 + H)} Z`)
        marks.forEach((m, i) => m.setAttribute('opacity', i <= done ? '1' : '0'))
        dot.setAttribute('cx', f2(end.x))
        dot.setAttribute('cy', f2(end.y))
        const pulse = 1 + 0.9 * ((t * 1.6) % 1)
        halo.setAttribute('cx', f2(end.x))
        halo.setAttribute('cy', f2(end.y))
        halo.setAttribute('r', f2(22 * k * pulse))
        halo.setAttribute('fill-opacity', f3(0.3 * (1 - ((t * 1.6) % 1))))
        const fin = p.at + p.step * (n - 1)
        const c = spring(t - fin - 0.05, 0.5, 14)
        chip.style.opacity = f3(Math.min(1, Math.max(0, c * 3)))
        const last = pts[n - 1]!
        chip.style.transform = `translate(${f2(last.x - chip.offsetWidth / 2)}px, ${f2(last.y - chip.offsetHeight - 40 * k)}px) scale(${f3(Math.max(0, c))})`
      },
    }
  },
}

/** halftone-field: a dot grid reacting to a hero dot, and a halftone wipe made of the same dots. */
export const halftoneField: Primitive<HalftoneFieldParams> = {
  id: 'halftone-field',
  params: halftoneFieldParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    Object.assign(cv.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px` })
    ctx.layer.append(cv)
    const g = cv.getContext('2d')!
    const cell = p.cell * w
    const cols = Math.ceil(w / cell) + 1
    const rows = Math.ceil(h / cell) + 1
    const heroAt = (t: number) => {
      const P = p.path
      if (P.length === 0) return null
      if (t <= P[0]!.at) return { x: P[0]!.x * w, y: P[0]!.y * h }
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i]!
        const b = P[i + 1]!
        if (t < b.at) {
          const m = easeInOutCubic((t - a.at) / (b.at - a.at))
          return { x: (a.x + (b.x - a.x) * m) * w, y: (a.y + (b.y - a.y) * m) * h }
        }
      }
      const L = P[P.length - 1]!
      return { x: L.x * w, y: L.y * h }
    }
    return {
      update(localT) {
        const t = Math.max(0, localT)
        g.clearRect(0, 0, w, h)
        const fg = colourOf(ctx.layer, ctx.look.vars.fg, '#16130f')
        const accent = colourOf(ctx.layer, ctx.look.vars.accent, '#ff5a1f')
        const hero = heroAt(t)
        const R = p.reach * w
        // The wipe: grows in from the hero (or the centre), holds covered, then shrinks away.
        let wipe = 0
        let wipeColour = fg
        if (p.wipe) {
          const a = p.wipe.at
          const grow = easeInOutCubic(seg(t, a, a + p.wipe.dur))
          const shrink = easeInOutCubic(seg(t, a + p.wipe.dur + 0.15, a + 2 * p.wipe.dur + 0.15))
          wipe = grow * (1 - shrink)
          wipeColour = p.wipe.colour === 'accent' ? accent : fg
        }
        const ox = hero ? hero.x : w / 2
        const oy = hero ? hero.y : h / 2
        const far = Math.hypot(w, h)
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = c * cell + (r % 2 ? cell / 2 : 0)
            const y = r * cell
            const d = Math.hypot(x - ox, y - oy)
            let size = 0.1 + 0.32 * Math.max(0, 1 - d / R) ** 1.5
            let alpha = p.alpha
            let col = fg
            if (wipe > 0) {
              // The wave front runs out from the origin; behind it the dots are full and opaque.
              const front = wipe * 1.25 * far
              const k2 = Math.max(0, Math.min(1, (front - d) / (0.25 * far)))
              size = size + (0.78 - size) * k2
              alpha = alpha + (1 - alpha) * k2
              col = k2 > 0.02 ? wipeColour : fg
            }
            g.globalAlpha = alpha
            g.fillStyle = col
            g.beginPath()
            g.arc(x, y, Math.max(0.6, size * cell), 0, Math.PI * 2)
            g.fill()
          }
        }
        g.globalAlpha = 1
        if (hero && p.hero) {
          g.fillStyle = accent
          g.beginPath()
          g.arc(hero.x, hero.y, cell * 0.55, 0, Math.PI * 2)
          g.fill()
        }
      },
    }
  },
}
