import { spaceFieldParams, type SpaceFieldParams } from '../../core/params/space'
import type { Primitive } from './registry'

const f1 = (x: number) => x.toFixed(1)
const f2 = (x: number) => x.toFixed(2)
const f3 = (x: number) => x.toFixed(3)
const NS = 'http://www.w3.org/2000/svg'
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}
let uid = 0

/** space-field: one vector layer of the one-space world (dots, grid, stars, shapes or bokeh). */
export const spaceField: Primitive<SpaceFieldParams> = {
  id: 'space-field',
  params: spaceFieldParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const id = `mba-sp${uid++}`
    const fg = ctx.look.vars.fg
    const accent = ctx.look.vars.accent
    const pick = (i: number) => (p.tint === 'fg' ? fg : p.tint === 'accent' ? accent : i % 4 === 0 ? accent : fg)
    // Twice the frame, centred on it.
    const svg = el('svg', { viewBox: `${f1(-w / 2)} ${f1(-h / 2)} ${f1(2 * w)} ${f1(2 * h)}` })
    Object.assign(svg.style, { position: 'absolute', left: `${f1(-w / 2)}px`, top: `${f1(-h / 2)}px`, width: `${f1(2 * w)}px`, height: `${f1(2 * h)}px`, overflow: 'visible', opacity: f3(p.alpha) })
    ctx.layer.append(svg)
    const defs = el('defs')
    svg.append(defs)
    const R = ctx.rng
    const X = () => -w / 2 + R() * 2 * w
    const Y = () => -h / 2 + R() * 2 * h
    const twinkles: { e: SVGElement; ph: number; sp: number; base: number }[] = []
    const spins: { e: SVGElement; x: number; y: number; ph: number; sp: number; bob: number }[] = []

    if (p.kind === 'dots' || p.kind === 'grid') {
      const cell = (p.kind === 'dots' ? 54 : 108) * k / Math.sqrt(p.density)
      const pat = el('pattern', { id: `${id}-p`, patternUnits: 'userSpaceOnUse', width: f2(cell), height: f2(cell), x: f1(-w / 2), y: f1(-h / 2) })
      if (p.kind === 'dots') pat.append(el('circle', { cx: f2(cell / 2), cy: f2(cell / 2), r: f2(2.6 * k), fill: fg }))
      else pat.append(el('path', { d: `M${f2(cell)},0 L0,0 L0,${f2(cell)}`, fill: 'none', stroke: fg, 'stroke-width': f2(1.6 * k), 'stroke-opacity': '0.7' }))
      defs.append(pat)
      // Fades out towards the outer edge, so the world has a soft horizon.
      const grad = el('radialGradient', { id: `${id}-g`, cx: '50%', cy: '50%', r: '55%' })
      grad.append(el('stop', { offset: '0.55', 'stop-color': '#fff', 'stop-opacity': '1' }), el('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }))
      const mask = el('mask', { id: `${id}-m` })
      defs.append(grad, mask)
      mask.append(el('rect', { x: f1(-w / 2), y: f1(-h / 2), width: f1(2 * w), height: f1(2 * h), fill: `url(#${id}-g)` }))
      svg.append(el('rect', { x: f1(-w / 2), y: f1(-h / 2), width: f1(2 * w), height: f1(2 * h), fill: `url(#${id}-p)`, mask: `url(#${id}-m)` }))
    } else if (p.kind === 'stars') {
      const n = Math.round(260 * p.density)
      for (let i = 0; i < n; i++) {
        const r = (0.8 + R() * R() * 4.5) * k
        const c = el('circle', { cx: f1(X()), cy: f1(Y()), r: f2(r), fill: pick(i) })
        svg.append(c)
        twinkles.push({ e: c, ph: R() * 6.28, sp: 1 + R() * 3, base: 0.35 + R() * 0.65 })
      }
    } else if (p.kind === 'shapes') {
      const n = Math.round(46 * p.density)
      for (let i = 0; i < n; i++) {
        const x = X()
        const y = Y()
        const s = (14 + R() * 30) * k
        const kind = Math.floor(R() * 4)
        const stroke = pick(i)
        const sw = f2(3 * k)
        const g = el('g')
        if (kind === 0) g.append(el('circle', { r: f2(s), fill: 'none', stroke, 'stroke-width': sw }))
        else if (kind === 1) g.append(el('path', { d: `M${f2(-s)},0 H${f2(s)} M0,${f2(-s)} V${f2(s)}`, stroke, 'stroke-width': sw, 'stroke-linecap': 'round' }))
        else if (kind === 2) g.append(el('rect', { x: f2(-s * 0.8), y: f2(-s * 0.8), width: f2(s * 1.6), height: f2(s * 1.6), rx: f2(4 * k), fill: 'none', stroke, 'stroke-width': sw }))
        else g.append(el('path', { d: `M0,${f2(-s)} L${f2(s * 0.9)},${f2(s * 0.6)} L${f2(-s * 0.9)},${f2(s * 0.6)} Z`, fill: 'none', stroke, 'stroke-width': sw, 'stroke-linejoin': 'round' }))
        svg.append(g)
        spins.push({ e: g, x, y, ph: R() * 360, sp: (R() - 0.5) * 40, bob: (4 + R() * 10) * k })
      }
    } else if (p.kind === 'bokeh') {
      const n = Math.round(18 * p.density)
      for (let i = 0; i < n; i++) {
        const gid = `${id}-b${i}`
        const grad = el('radialGradient', { id: gid })
        const col = pick(i)
        grad.append(el('stop', { offset: '0', 'stop-color': col, 'stop-opacity': '0.55' }), el('stop', { offset: '0.6', 'stop-color': col, 'stop-opacity': '0.22' }), el('stop', { offset: '1', 'stop-color': col, 'stop-opacity': '0' }))
        defs.append(grad)
        const c = el('circle', { cx: '0', cy: '0', r: f1((40 + R() * 110) * k), fill: `url(#${gid})` })
        const g = el('g')
        g.append(c)
        svg.append(g)
        spins.push({ e: g, x: X(), y: Y(), ph: R() * 6.28, sp: 0, bob: (10 + R() * 26) * k })
      }
    }

    return {
      update(localT) {
        const t = Math.max(0, localT)
        for (const s of twinkles) s.e.style.opacity = f3(s.base * (0.6 + 0.4 * Math.sin(t * s.sp + s.ph)))
        for (const s of spins) {
          const dy = Math.sin(t * 0.7 + s.ph) * s.bob
          const dx = Math.cos(t * 0.5 + s.ph) * s.bob * 0.6
          s.e.setAttribute('transform', `translate(${f1(s.x + dx)},${f1(s.y + dy)}) rotate(${f1(s.ph + s.sp * t)})`)
        }
      },
    }
  },
}
