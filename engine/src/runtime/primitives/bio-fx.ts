import { easeInOutSine, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import { ECG, LENS, ecgLineParams, microscopeParams, type EcgLineParams, type MicroscopeParams } from '../../core/params/bio-fx'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

const SVG = 'http://www.w3.org/2000/svg'

/**
 * ecg-line: a heart-monitor trace. The head sweeps left to right across the safe width over the
 * scene (as monitors do); the trace behind it is drawn (a clip on one fixed path, so the line never
 * reflows), a glowing dot rides the head, each beat is a P-QRS-T spike at the head's x at its time,
 * its word pops on the peak (accent box when `box`). From `flatAt` the trace is flat and fades to fg.
 */
export const ecgLine: Primitive<EcgLineParams> = {
  id: 'ecg-line',
  params: ecgLineParams,
  build(ctx, p) {
    const s = ctx.safe
    const W = s.w
    const T = Math.max(0.5, ctx.duration)
    // The beats sit evenly across the width whatever their timing: the head runs piecewise-linearly
    // through (0, 0), (beat k at, its slot), (end, W), so close beats never pile up.
    const live = p.beats.filter((b) => p.flatAt === undefined || b.at < p.flatAt)
    // The head starts a little in, so frame 0 already shows the monitor line.
    const keys: [number, number][] = [[0, W * 0.12], ...live.map((b, k): [number, number] => [b.at, (W * (k + 1)) / (live.length + 1)]), [T, W]]
    const xOf = (t: number) => {
      const u = Math.max(0, Math.min(T, t))
      for (let i = 1; i < keys.length; i++) {
        const [t0, x0] = keys[i - 1]!
        const [t1, x1] = keys[i]!
        if (u <= t1) return t1 === t0 ? x1 : x0 + ((x1 - x0) * (u - t0)) / (t1 - t0)
      }
      return W
    }
    // RTL: the sweep runs right to left, so the words land in reading order.
    const rtl = ctx.dir === 'rtl'
    const mx = (x: number) => (rtl ? W - x : x)
    const base = s.y + p.y * s.h
    const amp = ECG.amp * s.h
    // The trace: the baseline plus each beat's spike (its shape in fractions of the width).
    const pts: [number, number][] = [[0, 0]]
    for (const b of live) {
      const cx = xOf(b.at)
      for (const [dx, h] of ECG.shape) pts.push([cx + dx * W, -h * amp * b.size])
    }
    pts.push([W, 0])
    pts.sort((a, b) => a[0] - b[0])
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${mx(x).toFixed(1)} ${y.toFixed(1)}`).join('')

    const svg = document.createElementNS(SVG, 'svg')
    svg.dataset.mbaPart = 'ecg'
    const top = 1.8 * amp
    svg.setAttribute('viewBox', `0 ${-top} ${W} ${top + 0.6 * amp}`)
    Object.assign(svg.style, { position: 'absolute', left: `${s.x}px`, top: `${base - top}px`, width: `${W}px`, height: `${top + 0.6 * amp}px`, overflow: 'visible' })
    const clipId = `ecg-clip-${Math.floor(ctx.rng() * 1e9)}`
    const defs = document.createElementNS(SVG, 'defs')
    const clip = document.createElementNS(SVG, 'clipPath')
    clip.id = clipId
    const rect = document.createElementNS(SVG, 'rect')
    rect.setAttribute('x', '-10'); rect.setAttribute('y', String(-top - 10)); rect.setAttribute('height', String(top + amp + 20))
    clip.append(rect)
    defs.append(clip)
    const line = document.createElementNS(SVG, 'path')
    line.setAttribute('d', d)
    line.setAttribute('fill', 'none')
    line.setAttribute('stroke-width', String(Math.max(5, Math.round(W * 0.008))))
    line.setAttribute('stroke-linejoin', 'round')
    line.setAttribute('stroke-linecap', 'round')
    line.setAttribute('clip-path', `url(#${clipId})`)
    const dot = document.createElementNS(SVG, 'circle')
    dot.setAttribute('r', String(Math.max(7, Math.round(W * 0.012))))
    // The monitor: a faint grid and the full baseline, there from frame 0; the readout in a corner.
    const grid = document.createElementNS(SVG, 'g')
    grid.setAttribute('stroke', ctx.look.vars.fg)
    grid.setAttribute('stroke-width', '1')
    grid.setAttribute('opacity', '0.1')
    const gH = top + 0.6 * amp
    const step = W / 14
    for (let gx = 0; gx <= W + 0.5; gx += step) {
      const l = document.createElementNS(SVG, 'line')
      l.setAttribute('x1', gx.toFixed(1)); l.setAttribute('x2', gx.toFixed(1)); l.setAttribute('y1', String(-top)); l.setAttribute('y2', String(gH - top))
      grid.append(l)
    }
    for (let gy = -top; gy <= gH - top + 0.5; gy += step) {
      const l = document.createElementNS(SVG, 'line')
      l.setAttribute('x1', '0'); l.setAttribute('x2', String(W)); l.setAttribute('y1', gy.toFixed(1)); l.setAttribute('y2', gy.toFixed(1))
      grid.append(l)
    }
    const ghost = document.createElementNS(SVG, 'line')
    ghost.setAttribute('x1', '0'); ghost.setAttribute('x2', String(W)); ghost.setAttribute('y1', '0'); ghost.setAttribute('y2', '0')
    ghost.setAttribute('stroke', ctx.look.vars.fg); ghost.setAttribute('stroke-width', '2'); ghost.setAttribute('opacity', '0.18')
    svg.append(defs, grid, ghost, line, dot)
    ctx.layer.append(svg)
    const readout = document.createElement('div')
    readout.dataset.mbaPart = 'ecg-readout'
    readout.dir = 'ltr'
    Object.assign(readout.style, {
      position: 'absolute', left: `${s.x}px`, top: `${(base + 0.6 * amp + 6).toFixed(1)}px`, fontFamily: "'JetBrains Mono', monospace",
      fontSize: `${Math.ceil(30 * (ctx.size.w / 1080))}px`, color: ctx.look.vars.accent, letterSpacing: '0.04em',
    })
    readout.textContent = 'ECG · 75 BPM'
    ctx.layer.append(readout)

    /** The trace's height at x (linear between points). */
    const yAt = (x: number) => {
      for (let i = 1; i < pts.length; i++) {
        if (pts[i]![0] >= x) {
          const [x0, y0] = pts[i - 1]!
          const [x1, y1] = pts[i]!
          return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
        }
      }
      return 0
    }

    const font = Math.round(ECG.fontW * W)
    const words = p.beats.flatMap((b) => {
      if (!b.word) return []
      const el = document.createElement('div')
      el.dataset.mbaPart = 'ecg-word'
      Object.assign(el.style, {
        position: 'absolute', fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), fontSize: `${font}px`, lineHeight: '1.2',
        whiteSpace: 'nowrap', padding: b.box ? '0.02em 0.25em' : '0', borderRadius: '0.12em',
        color: b.box ? ctx.look.vars.bg : ctx.look.vars.fg, background: b.box ? ctx.look.vars.accent : 'transparent', transformOrigin: '50% 100%',
      })
      lineUnit(el, b.word)
      ctx.layer.append(el)
      // Above the peak, kept inside the safe width.
      const w = el.offsetWidth
      const cx = Math.max(s.x + w / 2, Math.min(s.x + W - w / 2, s.x + mx(xOf(b.at))))
      const peak = base - amp * b.size
      // Alternate above the peak and under the line, so neighbours never overlap.
      const below = p.beats.indexOf(b) % 2 === 1
      el.style.left = `${(cx - w / 2).toFixed(1)}px`
      el.style.top = `${(below ? base + 0.45 * amp + ECG.lift * font * 0.5 : peak - el.offsetHeight - ECG.lift * font).toFixed(1)}px`
      el.style.transformOrigin = below ? '50% 0%' : '50% 100%'
      return [{ el, at: b.at }]
    })

    return {
      update(localT) {
        const t = Math.max(0, localT)
        const hx = xOf(t)
        // The drawn part: from the start edge to the head.
        rect.setAttribute('x', rtl ? (W - hx - 10).toFixed(1) : '-10')
        rect.setAttribute('width', (hx + 20).toFixed(1))
        dot.setAttribute('cx', mx(hx).toFixed(1))
        dot.setAttribute('cy', yAt(hx).toFixed(1))
        const flat = p.flatAt !== undefined && t >= p.flatAt
        const k = p.flatAt === undefined ? 0 : easeInOutSine(seg(t, p.flatAt, p.flatAt + 0.4))
        line.setAttribute('stroke', k > 0.5 ? ctx.look.vars.fg : ctx.look.vars.accent)
        line.setAttribute('opacity', flat ? (1 - 0.5 * k).toFixed(3) : '1')
        dot.setAttribute('fill', k > 0.5 ? ctx.look.vars.fg : ctx.look.vars.accent)
        for (const w of words) {
          const a = seg(t, w.at, w.at + ECG.pop)
          const sc = a >= 1 ? 1 : 0.4 + 0.6 * Math.max(0, p.ease === 'easy' ? easeInOutSine(a) : easeOutBack(a, 1.8))
          w.el.style.opacity = a <= 0 ? '0' : a >= 1 ? '' : easeOutCubic(Math.min(1, a * 2)).toFixed(3)
          w.el.style.transform = sc === 1 ? '' : `scale(${sc.toFixed(4)})`
        }
      },
    }
  },
}

/**
 * microscope: a round lens. Outside the lens the frame goes dark; inside, a backdrop blur over
 * whatever is underneath eases to sharp over `focusSec` while the focus ring turns; a reticle
 * (cross + ticks) sits on top; the slide label pops when the image is sharp.
 */
export const microscope: Primitive<MicroscopeParams> = {
  id: 'microscope',
  params: microscopeParams,
  build(ctx, p) {
    const E = p.ease === 'easy' ? easeInOutSine : easeOutCubic
    const c = safePointPx(ctx, p.at)
    const r = p.radius * ctx.safe.w
    const root = document.createElement('div')
    root.dataset.mbaPart = 'microscope'
    Object.assign(root.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    const shade = document.createElement('div')
    Object.assign(shade.style, {
      position: 'absolute', inset: '0', background: `radial-gradient(circle at ${c.x}px ${c.y}px, transparent ${r - 1}px, rgba(14,12,10,${LENS.dim}) ${r + 1}px, rgba(14,12,10,0) ${(r * 1.45).toFixed(1)}px)`,
    })
    const glass = document.createElement('div')
    Object.assign(glass.style, { position: 'absolute', left: `${c.x - r}px`, top: `${c.y - r}px`, width: `${2 * r}px`, height: `${2 * r}px`, borderRadius: '50%' })
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('viewBox', '-100 -100 200 200')
    Object.assign(svg.style, { position: 'absolute', left: `${c.x - r * 1.08}px`, top: `${c.y - r * 1.08}px`, width: `${2.16 * r}px`, height: `${2.16 * r}px`, overflow: 'visible', transformOrigin: '50% 50%' })
    const mk = (tag: string, attrs: Record<string, string>) => {
      const e = document.createElementNS(SVG, tag)
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
      svg.append(e)
      return e
    }
    mk('circle', { cx: '0', cy: '0', r: '92.6', fill: 'none', stroke: '#f3efe7', 'stroke-width': '2.2' })
    const ring = mk('g', {})
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2
      const r0 = i % 5 === 0 ? 94.5 : 95.5
      const l = document.createElementNS(SVG, 'line')
      l.setAttribute('x1', (Math.cos(a) * r0).toFixed(2)); l.setAttribute('y1', (Math.sin(a) * r0).toFixed(2))
      l.setAttribute('x2', (Math.cos(a) * 99).toFixed(2)); l.setAttribute('y2', (Math.sin(a) * 99).toFixed(2))
      l.setAttribute('stroke', i % 5 === 0 ? ctx.look.accent : '#f3efe7'); l.setAttribute('stroke-width', i % 5 === 0 ? '1.6' : '0.8')
      ring.append(l)
    }
    for (const [x1, y1, x2, y2] of [[-14, 0, -4, 0], [4, 0, 14, 0], [0, -14, 0, -4], [0, 4, 0, 14]] as const) {
      mk('line', { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2), stroke: '#f3efe7', 'stroke-width': '0.9', opacity: '0.8' })
    }
    root.append(shade, glass, svg)
    let label: HTMLElement | undefined
    if (p.label) {
      label = document.createElement('div')
      label.dataset.mbaPart = 'microscope-label'
      Object.assign(label.style, {
        position: 'absolute', left: `${c.x}px`, top: `${c.y + r * 0.62}px`, transform: 'translate(-50%, 0)', padding: '0.15em 0.6em', borderRadius: '0.3em',
        background: '#f3efe7', color: '#16130f', fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), fontSize: `${Math.round(0.07 * ctx.safe.w)}px`, whiteSpace: 'nowrap',
      })
      lineUnit(label, p.label)
      root.append(label)
    }
    ctx.layer.append(root)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const f = E(seg(t, 0, p.focusSec))
        const b = (1 - f) * LENS.blur
        glass.style.backdropFilter = b > 0.05 ? `blur(${b.toFixed(2)}px)` : ''
        ring.setAttribute('transform', `rotate(${((1 - f) * -40).toFixed(2)})`)
        // Opening: the lens grows past the frame and fades; the dark surround lifts.
        const o = p.openAt === undefined ? 0 : E(seg(t, p.openAt, p.openAt + LENS.open))
        shade.style.opacity = o === 0 ? '' : (1 - o).toFixed(3)
        svg.style.opacity = o === 0 ? '' : (1 - o).toFixed(3)
        svg.style.transform = o === 0 ? '' : `scale(${(1 + 1.6 * o).toFixed(4)})`
        if (label) {
          const a = E(seg(t, p.focusSec * 0.8, p.focusSec * 0.8 + 0.35)) * (1 - o)
          label.style.opacity = a >= 1 ? '' : a.toFixed(3)
          label.style.transform = `translate(-50%, ${((1 - a) * 0.4).toFixed(3)}em)`
        }
      },
    }
  },
}
