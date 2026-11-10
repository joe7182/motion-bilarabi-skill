import { easeInOutCubic, easeInOutSine, easeOutCubic, seg } from '../../core/ease'
import { PEN_RED, redPenParams, sketchWordsParams, type RedPenParams, type SketchWordsParams } from '../../core/params/sketch'
import { FONT_SERIF } from '../looks'
import type { Primitive } from './registry'

const f2 = (x: number) => x.toFixed(2)
const f3 = (x: number) => x.toFixed(3)
const NS = 'http://www.w3.org/2000/svg'
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}
let uid = 0

/** sketch-words: pencil outlines traced in two wobbly passes, then hatching or ink fills the letters. */
export const sketchWords: Primitive<SketchWordsParams> = {
  id: 'sketch-words',
  params: sketchWordsParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const s = ctx.safe
    const id = `mba-sk${uid++}`
    const fg = ctx.look.vars.fg
    const accent = ctx.look.vars.accent
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}` })
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px`, overflow: 'visible' })
    ctx.layer.append(svg)
    const defs = el('defs')
    svg.append(defs)
    const turb = el('feTurbulence', { type: 'fractalNoise', baseFrequency: f3(0.018 / k), numOctaves: '2', seed: '3' })
    const filter = el('filter', { id: `${id}-wob`, x: '-10%', y: '-30%', width: '120%', height: '160%' })
    filter.append(turb, el('feDisplacementMap', { in: 'SourceGraphic', scale: f2(5 * k), xChannelSelector: 'R', yChannelSelector: 'G' }))
    defs.append(filter)
    const hatch = (name: string, colour: string, angle: number) => {
      const pat = el('pattern', { id: `${id}-${name}`, patternUnits: 'userSpaceOnUse', width: f2(11 * k), height: f2(11 * k), patternTransform: `rotate(${angle})` })
      pat.append(el('line', { x1: '0', y1: '0', x2: '0', y2: f2(11 * k), stroke: colour, 'stroke-width': f2(2.6 * k) }))
      defs.append(pat)
    }
    hatch('h', fg, 40)
    hatch('ha', accent, 40)
    hatch('h2', fg, -40)

    // Tajawal Black: static outlines without overlapping contours (Cairo's variable outlines overlap,
    // which shows as stray boxes inside traced letters).
    const font = "'Tajawal', sans-serif"
    let px = p.size * k
    const lh = () => px * 1.25
    const isAccent = (wd: string) => p.accent.some((a) => wd.includes(a))
    const root = el('g', { filter: p.boil ? `url(#${id}-wob)` : '' })
    svg.append(root)
    const fillG = el('g')
    const fill2G = el('g')
    const lineG = [el('g'), el('g')]
    root.append(fillG, fill2G, ...lineG)
    const texts: SVGTextElement[] = []
    const make = (parent: SVGGElement, i: number, line: string, attrs: (accent: boolean) => Record<string, string>, dx = 0, dy = 0) => {
      const t = el('text', { 'text-anchor': 'middle', direction: 'rtl', 'font-family': font, 'font-weight': '900', 'font-size': f2(px), x: f2(w / 2 + dx), y: '0' })
      t.dataset.dy = String(dy)
      t.dataset.line = String(i)
      line.split(' ').forEach((wd, j) => {
        const ts = el('tspan', attrs(isAccent(wd)))
        ts.textContent = (j > 0 ? ' ' : '') + wd
        t.append(ts)
      })
      parent.append(t)
      texts.push(t)
      return t
    }
    const fills: SVGTextElement[] = []
    const fills2: SVGTextElement[] = []
    const strokes: SVGTextElement[][] = [[], []]
    p.lines.forEach((line, i) => {
      if (p.fill !== 'none') fills.push(make(fillG, i, line, (a) => ({ fill: p.fill === 'solid' ? (a ? accent : fg) : `url(#${id}-${a ? 'ha' : 'h'})` })))
      if (p.fill === 'hatch') fills2.push(make(fill2G, i, line, (a) => ({ fill: a ? 'none' : `url(#${id}-h2)` })))
      strokes[0]!.push(make(lineG[0]!, i, line, (a) => ({ fill: 'none', stroke: a ? accent : fg, 'stroke-width': f2(3 * k), 'stroke-linejoin': 'round' })))
      strokes[1]!.push(make(lineG[1]!, i, line, (a) => ({ fill: 'none', stroke: a ? accent : fg, 'stroke-width': f2(1.8 * k), 'stroke-opacity': '0.7' }), 2.2 * k, 1.6 * k))
    })
    // Fit the widest line to the safe width, then place the lines.
    let measured = false
    const layout = () => {
      if (measured) return
      measured = true
      const widest = Math.max(...strokes[0]!.map((t) => t.getComputedTextLength()))
      if (widest > s.w * 0.94) px *= (s.w * 0.94) / widest
      const top = s.y + p.y * s.h - (lh() * p.lines.length) / 2
      for (const t of texts) {
        t.setAttribute('font-size', f2(px))
        t.setAttribute('y', f2(top + lh() * (Number(t.dataset.line) + 0.72) + Number(t.dataset.dy)))
      }
    }
    // A dash longer than any glyph outline: offset from DASH to 0 traces every outline at once.
    const DASH = 9 * p.size * k

    return {
      update(localT) {
        layout()
        const t = Math.max(0, localT)
        if (p.boil) turb.setAttribute('seed', String(3 + (Math.floor(t * 8) % 5)))
        const n = p.lines.length
        strokes.forEach((pass, j) =>
          pass.forEach((tx, i) => {
            const a = p.at + (p.draw / n) * i + j * 0.12
            const d = easeInOutSine(seg(t, a, a + p.draw / n + 0.15))
            tx.setAttribute('stroke-dasharray', `${f2(DASH)} ${f2(DASH)}`)
            tx.setAttribute('stroke-dashoffset', f2(DASH * (1 - d)))
            tx.style.opacity = d > 0 ? '1' : '0'
          }),
        )
        const fIn = easeOutCubic(seg(t, p.at + p.draw * 0.7, p.at + p.draw + 0.5))
        const f2In = easeOutCubic(seg(t, p.at + p.draw + 0.2, p.at + p.draw + 0.7))
        fillG.style.opacity = f3(fIn * (p.fill === 'solid' ? 1 : 0.9))
        fill2G.style.opacity = f3(f2In * 0.55)
        // Hatching sweeps in from the right.
        const clipR = 1 - fIn
        fillG.style.clipPath = clipR > 0.001 ? `inset(0 0 0 ${f2(clipR * 100)}%)` : ''
        const gone = p.out === undefined ? 0 : easeInOutCubic(seg(t, p.out, p.out + 0.35))
        root.style.opacity = f3(1 - gone)
        root.style.transform = gone > 0 ? `translateY(${f2(-0.04 * h * gone)}px)` : ''
      },
    }
  },
}

/** A wobbly polyline through points as a smooth path (quadratic midpoints). */
function smooth(pts: [number, number][]): string {
  if (pts.length < 3) return `M${pts.map((q) => `${f2(q[0])},${f2(q[1])}`).join(' L')}`
  let d = `M${f2(pts[0]![0])},${f2(pts[0]![1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]!
    const [nx, ny] = pts[i + 1]!
    d += ` Q${f2(x)},${f2(y)} ${f2((x + nx) / 2)},${f2((y + ny) / 2)}`
  }
  const last = pts[pts.length - 1]!
  return d + ` L${f2(last[0])},${f2(last[1])}`
}

/** red-pen: proofreading marks drawn stroke by stroke with a nib at the tip, and margin notes. */
export const redPen: Primitive<RedPenParams> = {
  id: 'red-pen',
  params: redPenParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const colour = p.colour === 'red' ? PEN_RED : ctx.look.vars.accent
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}` })
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px`, overflow: 'visible' })
    ctx.layer.append(svg)
    const j = (a: number) => (ctx.rng() - 0.5) * a
    const paths = p.marks.map((m) => {
      const x = m.x * w
      const y = m.y * h
      const W = m.w * w
      const H = m.h * h
      let d = ''
      const pts: [number, number][] = []
      switch (m.kind) {
        case 'circle': {
          const cx = x + W / 2
          const cy = y + H / 2
          const a0 = -2.4 + j(0.4)
          for (let i = 0; i <= 44; i++) {
            const a = a0 - (i / 44) * Math.PI * 2.15
            const grow = 1 + 0.06 * (i / 44)
            pts.push([cx + Math.cos(a) * (W / 2 + 14 * k) * grow + j(5 * k), cy + Math.sin(a) * (H / 2 + 12 * k) * grow + j(5 * k)])
          }
          d = smooth(pts)
          break
        }
        case 'underline': {
          const yy = y + H
          for (let i = 0; i <= 24; i++) pts.push([x + W - (i / 24) * W, yy + Math.sin(i * 1.3) * 7 * k + j(3 * k)])
          d = smooth(pts)
          break
        }
        case 'strike': {
          const yy = y + H / 2
          d = smooth([[x + W + 8 * k, yy + j(6 * k)], [x + W / 2, yy - 4 * k + j(4 * k)], [x - 8 * k, yy + 6 * k + j(6 * k)]]) + ' ' + smooth([[x - 4 * k, yy + 10 * k], [x + W / 2, yy + 2 * k + j(4 * k)], [x + W + 4 * k, yy - 6 * k]]).replace('M', 'M')
          break
        }
        case 'arrow': {
          const x2 = x + W
          const y2 = y + H
          const mx = (x + x2) / 2 - H * 0.25
          const my = (y + y2) / 2 + W * 0.25
          d = `M${f2(x)},${f2(y)} Q${f2(mx)},${f2(my)} ${f2(x2)},${f2(y2)}`
          const ang = Math.atan2(y2 - my, x2 - mx)
          const L = 34 * k
          d += ` M${f2(x2 - Math.cos(ang - 0.45) * L)},${f2(y2 - Math.sin(ang - 0.45) * L)} L${f2(x2)},${f2(y2)} L${f2(x2 - Math.cos(ang + 0.45) * L)},${f2(y2 - Math.sin(ang + 0.45) * L)}`
          break
        }
        case 'check':
          d = smooth([[x, y + H * 0.55], [x + W * 0.18, y + H * 0.75], [x + W * 0.35, y + H]]) + ` Q${f2(x + W * 0.55)},${f2(y + H * 0.4)} ${f2(x + W)},${f2(y)}`
          break
        case 'cross':
          d = `M${f2(x)},${f2(y)} Q${f2(x + W * 0.5 + j(10 * k))},${f2(y + H * 0.5)} ${f2(x + W)},${f2(y + H)} M${f2(x + W)},${f2(y)} Q${f2(x + W * 0.5)},${f2(y + H * 0.5 + j(10 * k))} ${f2(x)},${f2(y + H)}`
          break
        case 'caret':
          d = `M${f2(x)},${f2(y + H)} L${f2(x + W / 2 + j(4 * k))},${f2(y)} L${f2(x + W)},${f2(y + H)}`
          break
        case 'bracket':
          d = `M${f2(x + W)},${f2(y)} Q${f2(x)},${f2(y)} ${f2(x + j(4 * k))},${f2(y + H * 0.5)} Q${f2(x)},${f2(y + H)} ${f2(x + W)},${f2(y + H)}`
          break
      }
      const path = el('path', { d, fill: 'none', stroke: colour, 'stroke-width': f2(9 * k), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: '1', 'stroke-dasharray': '1 1', 'stroke-dashoffset': '1' })
      svg.append(path)
      return path
    })
    // The nib: a red pen tip pointing down-left, its point on the stroke head.
    const nib = el('g')
    nib.append(
      el('path', { d: `M0,0 L${f2(14 * k)},${f2(-30 * k)} L${f2(30 * k)},${f2(-22 * k)} Z`, fill: '#1b1b1b' }),
      el('path', { d: `M${f2(14 * k)},${f2(-30 * k)} L${f2(70 * k)},${f2(-150 * k)} L${f2(102 * k)},${f2(-136 * k)} L${f2(30 * k)},${f2(-22 * k)} Z`, fill: colour }),
      el('path', { d: `M${f2(70 * k)},${f2(-150 * k)} L${f2(86 * k)},${f2(-186 * k)} L${f2(118 * k)},${f2(-172 * k)} L${f2(102 * k)},${f2(-136 * k)} Z`, fill: '#f2ece2' }),
    )
    nib.style.opacity = '0'
    if (p.pen) svg.append(nib)
    let lens: number[] | null = null

    const notes = p.notes.map((n) => {
      const div = document.createElement('div')
      div.textContent = n.text
      Object.assign(div.style, {
        position: 'absolute', left: `${f2(n.x * w)}px`, top: `${f2(n.y * h)}px`, transform: `translate(-50%, -50%) rotate(${n.rotate}deg)`,
        fontFamily: FONT_SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: `${f2(n.size * k)}px`, color: colour, whiteSpace: 'nowrap', direction: 'rtl', lineHeight: '1.3',
      })
      ctx.layer.append(div)
      return div
    })

    return {
      update(localT) {
        const t = Math.max(0, localT)
        lens ??= paths.map((q) => q.getTotalLength())
        const gone = p.out === undefined ? 0 : seg(t, p.out, p.out + 0.3)
        let tip: { x: number; y: number } | null = null
        p.marks.forEach((m, i) => {
          const d = easeInOutCubic(seg(t, m.at, m.at + m.dur))
          paths[i]!.setAttribute('stroke-dashoffset', f3(1 - d))
          paths[i]!.style.opacity = f3(1 - gone)
          if (d > 0 && d < 1) {
            const q = paths[i]!.getPointAtLength(lens![i]! * d)
            tip = { x: q.x, y: q.y }
          }
        })
        notes.forEach((div, i) => {
          const n = p.notes[i]!
          const d = seg(t, n.at, n.at + n.dur)
          div.style.clipPath = d < 1 ? `inset(-20% 0 -20% ${f2((1 - d) * 100)}%)` : ''
          div.style.opacity = f3(d > 0 ? 1 - gone : 0)
          if (d > 0 && d < 1) {
            const r = div.getBoundingClientRect()
            const host = ctx.layer.getBoundingClientRect()
            const sc = host.width > 0 ? w / host.width : 1
            tip = { x: (r.right - (r.width * d)) * sc - host.left * sc, y: (r.top + r.height * 0.75) * sc - host.top * sc }
          }
        })
        if (p.pen) {
          const tp = tip as { x: number; y: number } | null
          nib.style.opacity = tp ? '1' : '0'
          if (tp) nib.setAttribute('transform', `translate(${f2(tp.x)},${f2(tp.y)})`)
        }
      },
    }
  },
}
