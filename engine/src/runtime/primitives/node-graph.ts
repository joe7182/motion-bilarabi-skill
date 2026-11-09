import { easeOutCubic, seg } from '../../core/ease'
import { emphasisAt, settle } from '../../core/params/common'
import { NODE_GRAPH as NG, nodeGraphParams, type GraphNode, type NodeGraphParams } from '../../core/params/node-graph'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import { alpha, clampIn, el, loadImage, mix, nextUid, opacityOf, px, show, softShadow, svgEl } from './layers-kit'
import type { Primitive } from './registry'

/** Our own glyphs (viewBox 0 0 24 24, stroked): the agent's robot head, a spark, a bolt, a plus, a step's list. */
const GLYPH = {
  robot: '<rect x="4.5" y="7.5" width="15" height="11" rx="3.2"/><path d="M12 7.5V4.6"/><circle cx="12" cy="3.6" r="1.1"/><circle cx="9.3" cy="12.6" r="1.25" fill="currentColor" stroke="none"/><circle cx="14.7" cy="12.6" r="1.25" fill="currentColor" stroke="none"/><path d="M9.6 15.6h4.8"/><path d="M2.6 11.5v3M21.4 11.5v3"/>',
  spark: '<path d="M12 3.2c.5 3.9 1.9 5.3 5.8 5.8-3.9.5-5.3 1.9-5.8 5.8-.5-3.9-1.9-5.3-5.8-5.8 3.9-.5 5.3-1.9 5.8-5.8z" fill="currentColor" stroke="none"/>',
  bolt: '<path d="M13.2 2.8 5.6 13.4h5.6l-1 7.8 7.6-10.6h-5.6z" fill="currentColor" stroke-linejoin="round"/>',
  plus: '<path d="M12 6.5v11M6.5 12h11"/>',
  list: '<path d="M8.5 7.5h10M8.5 12h10M8.5 16.5h10"/><circle cx="5.2" cy="7.5" r=".9" fill="currentColor"/><circle cx="5.2" cy="12" r=".9" fill="currentColor"/><circle cx="5.2" cy="16.5" r=".9" fill="currentColor"/>',
} as const

function glyph(name: keyof typeof GLYPH, color: string, size: number, stroke = 1.8): SVGSVGElement {
  const s = svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })
  s.innerHTML = GLYPH[name]
  Object.assign(s.style, { width: px(size), height: px(size), display: 'block', color, stroke: 'currentColor' })
  return s
}

interface NodeView {
  n: GraphNode
  /** Box centre and size (panel px). */
  cx: number
  cy: number
  w: number
  h: number
  group: HTMLElement
  box: HTMLElement
  outline: HTMLElement
  /** Slot parts: the dashed socket, its plus, the filled face, the pulse ring. */
  slot?: { dashed: SVGSVGElement; plus: SVGSVGElement; filled: HTMLElement; ring: HTMLElement; mark: HTMLElement }
}

interface EdgeView {
  at: number
  kind: 'main' | 'sub'
  path: SVGPathElement
  extras: SVGElement[]
  clip?: SVGRectElement
  ys?: number
  ye?: number
  /** Sampled points along the path (panel px) and its length. */
  pts: { x: number; y: number }[]
  len: number
  pulse: SVGGElement
  phase: number
}

/**
 * `node-graph`: a workflow canvas in our own drawing (n8n / Zapier style). A rounded panel with a
 * toolbar strip and a dot grid rises in; nodes pop in (trigger: rounded left side + bolt; step:
 * square card with its logo; agent: a wide card with our robot glyph and ports underneath; slot: a
 * dashed socket with «+» that becomes a filled node at `fillAt`); `main` wires draw left → right as
 * smooth horizontal beziers, `sub` wires drop dashed from a node's bottom to the node under it; from
 * `flowAt` pulses run along every drawn wire, looping; `focus` outlines one node in accent. Layout
 * is measured once at build; `update` writes transforms / opacity / dash offsets only.
 */
export const nodeGraph: Primitive<NodeGraphParams> = {
  id: 'node-graph',
  params: nodeGraphParams,
  async build(ctx, p) {
    const k = ctx.size.w / 1080
    let PW = p.width * ctx.safe.w
    let PH = PW / p.aspect
    if (PH > ctx.safe.h) {
      PH = ctx.safe.h
      PW = PH * p.aspect
    }
    const fg = ctx.look.vars.fg
    const bg = ctx.look.vars.bg
    const accent = ctx.look.vars.accent
    const R = NG.radius * PW
    const TB = NG.toolbar * PW
    const PAD = NG.pad * PW
    const S = NG.side * PW
    const uid = nextUid('ng')

    const panel = el('div', {
      position: 'absolute', left: '0px', top: '0px', width: px(PW), height: px(PH), borderRadius: px(R), overflow: 'hidden',
      background: mix(fg, bg, 4), boxShadow: `inset 0 0 0 ${px(Math.max(1, 1.5 * k))} ${alpha(fg, 0.1)}, ${softShadow(k, 1.1)}`,
    }, 'node-graph')
    if (p.key) panel.dataset.mbaKey = p.key
    ctx.layer.append(panel)
    const grid = el('div', {
      position: 'absolute', left: '0px', top: px(TB), width: px(PW), height: px(PH - TB),
      backgroundImage: `radial-gradient(circle, ${alpha(fg, 0.17)} ${px(1.6 * k)}, transparent ${px(2.3 * k)})`,
      backgroundSize: `${px(NG.dot * PW)} ${px(NG.dot * PW)}`, backgroundPosition: `${px(PAD * 0.5)} ${px(PAD * 0.5)}`,
    })
    const bar = el('div', {
      position: 'absolute', left: '0px', top: '0px', width: px(PW), height: px(TB), boxSizing: 'border-box', background: mix(fg, bg, 2),
      borderBottom: `${px(Math.max(1, 1.5 * k))} solid ${alpha(fg, 0.1)}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: `0 ${px(PAD * 0.9)}`, direction: 'ltr',
    })
    const dots = el('div', { display: 'flex', gap: px(10 * k) })
    for (let i = 0; i < 3; i++) dots.append(el('div', { width: px(13 * k), height: px(13 * k), borderRadius: '50%', background: alpha(fg, 0.16) }))
    bar.append(dots)
    if (p.panel.title) {
      const title = el('div', { fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: px(NG.titlePx * k), color: alpha(fg, 0.78), whiteSpace: 'pre', lineHeight: '1.2' }, 'node-graph-title')
      lineUnit(title, p.panel.title)
      bar.append(title)
    }
    panel.append(grid, bar)

    const edgeSvg = svgEl('svg', { viewBox: `0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}`, 'aria-hidden': 'true' })
    Object.assign(edgeSvg.style, { position: 'absolute', left: '0px', top: '0px', width: px(PW), height: px(PH), overflow: 'visible' })
    const defs = svgEl('defs')
    edgeSvg.append(defs)
    panel.append(edgeSvg)

    const icons = await Promise.all(p.nodes.map((n, i) => (n.icon ? loadImage(n.icon, `node-graph nodes[${i}].icon`) : Promise.resolve(undefined))))
    // Cards a touch lighter than the background in every world (near-white on paper, lifted on ink).
    const cardBg = mix('#ffffff', bg, 14)
    const cardEdge = alpha(fg, 0.14)
    const views = new Map<string, NodeView>()

    const labelBlock = (n: GraphNode, align: 'center' | 'right') => {
      const wrap = el('div', { display: 'flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : 'flex-end', gap: px(2 * k) })
      const lab = el('div', { fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: px(NG.labelPx * k), lineHeight: '1.2', color: fg, whiteSpace: 'pre' }, 'node-label')
      lineUnit(lab, n.label)
      wrap.append(lab)
      if (n.sub) {
        const sub = el('div', { fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.body), fontSize: px(NG.subPx * k), lineHeight: '1.2', color: alpha(fg, 0.62), whiteSpace: 'pre' }, 'node-sub')
        lineUnit(sub, n.sub)
        wrap.append(sub)
      }
      return wrap
    }

    p.nodes.forEach((n, i) => {
      const group = el('div', { position: 'absolute', left: '0px', top: '0px' }, 'graph-node')
      group.dataset.id = n.id
      // In the document from the start: the card and its label are measured below.
      panel.append(group)
      const isAgent = n.kind === 'agent'
      const isSlot = n.kind === 'slot'
      let w = isAgent ? NG.agentW * S : isSlot ? NG.slot * S : S
      const h = isAgent ? NG.agentH * S : isSlot ? NG.slot * S : S
      const radius = isSlot ? w / 2 : 0.2 * S
      const box = el('div', {
        position: 'absolute', left: '0px', top: '0px', width: px(w), height: px(h), boxSizing: 'border-box', borderRadius: px(radius),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      })
      if (n.kind === 'trigger') box.style.borderRadius = `${px(0.5 * S)} ${px(0.2 * S)} ${px(0.2 * S)} ${px(0.5 * S)}`
      if (!isSlot) {
        box.style.background = cardBg
        box.style.boxShadow = `inset 0 0 0 ${px(Math.max(1.5, 2 * k))} ${cardEdge}, ${softShadow(k, 0.8)}`
      }
      group.append(box)
      const outline = el('div', { position: 'absolute', inset: px(-8 * k), borderRadius: n.kind === 'trigger' ? `${px(0.5 * S + 8 * k)} ${px(0.2 * S + 8 * k)} ${px(0.2 * S + 8 * k)} ${px(0.5 * S + 8 * k)}` : px(radius + 8 * k), border: `${px(3 * k)} solid ${accent}`, boxShadow: `0 0 0 ${px(8 * k)} ${alpha(accent, 0.14)}`, display: 'none' })
      box.append(outline)
      const icon = icons[i]
      const mark = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'center' })
      if (icon) {
        Object.assign(icon.style, { width: px((isAgent ? 0.42 : 0.5) * S), height: px((isAgent ? 0.42 : 0.5) * S), objectFit: 'contain', display: 'block' })
        mark.append(icon)
      } else if (isAgent) {
        mark.append(glyph('robot', bg, 0.3 * S, 1.9))
        Object.assign(mark.style, { width: px(0.46 * S), height: px(0.46 * S), borderRadius: px(0.13 * S), background: accent })
      } else mark.append(glyph(isSlot ? 'spark' : 'list', alpha(fg, 0.7), 0.42 * S))
      let lblH = 0
      let lblW = 0
      let slot: NodeView['slot']
      if (isAgent) {
        // Agent: logo / robot at the right (RTL), label and sub to its left; ports underneath.
        Object.assign(box.style, { justifyContent: 'flex-start', flexDirection: 'row-reverse', gap: px(0.14 * S), padding: `0 ${px(0.2 * S)}` })
        const lb = labelBlock(n, 'right')
        box.append(mark, lb)
        // The card grows to its content (measured once): never narrower than agentW × side.
        box.style.width = 'max-content'
        box.style.minWidth = px(w)
        w = Math.ceil(box.offsetWidth)
        box.style.width = px(w)
      } else if (isSlot) {
        const dashed = svgEl('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' })
        Object.assign(dashed.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible' })
        const c = svgEl('circle', { cx: 50, cy: 50, r: 48.5, fill: 'none', 'stroke-width': (2.5 * k * 100) / w, 'stroke-dasharray': '7 6', 'stroke-linecap': 'round' })
        c.style.stroke = alpha(fg, 0.42)
        dashed.append(c)
        const plus = glyph('plus', alpha(fg, 0.55), 0.42 * w, 2)
        Object.assign(plus.style, { position: 'absolute', left: px(0.29 * w), top: px(0.29 * w) })
        const filled = el('div', { position: 'absolute', inset: '0', borderRadius: '50%', background: cardBg, boxShadow: `inset 0 0 0 ${px(Math.max(1.5, 2 * k))} ${cardEdge}, ${softShadow(k, 0.8)}`, display: 'none', alignItems: 'center', justifyContent: 'center' })
        if (icon) Object.assign(icon.style, { width: px(0.52 * w), height: px(0.52 * w) })
        filled.append(mark)
        const ring = el('div', { position: 'absolute', inset: '0', borderRadius: '50%', border: `${px(3 * k)} solid ${accent}`, display: 'none' })
        box.append(dashed, filled, plus, ring)
        slot = { dashed, plus, filled, ring, mark }
      } else box.append(mark)
      if (n.kind === 'trigger') {
        const bolt = el('div', { position: 'absolute', left: px(-0.3 * S), top: px(0.5 * h - 0.16 * S), width: px(0.32 * S), height: px(0.32 * S), borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: softShadow(k, 0.5) })
        bolt.append(glyph('bolt', '#ffffff', 0.2 * S, 1.2))
        box.append(bolt)
      }
      if (!isAgent) {
        const lb = labelBlock(n, 'center')
        Object.assign(lb.style, { position: 'absolute', top: px(h + 0.1 * S), left: '0px' })
        group.append(lb)
        lblW = lb.offsetWidth
        lblH = lb.offsetHeight + 0.1 * S
        lb.style.left = px((w - lblW) / 2)
      }

      // Place the box centre inside the canvas (its label too).
      const hw = Math.max(w, lblW) / 2 + (n.kind === 'trigger' ? 0.3 * S : 0)
      const x0 = PAD + hw
      const x1 = PW - PAD - hw
      const y0 = TB + PAD + h / 2
      const y1 = PH - PAD - h / 2 - lblH
      if (x1 < x0 - 0.5 || y1 < y0 - 0.5) {
        throw new Error(`العقدة «${n.label}» لا تتسع في اللوحة؛ اختصر التسمية أو كبّر width — node-graph: node "${n.id}" does not fit the panel`)
      }
      const cx = clampIn(x0 + n.x * (x1 - x0), x0, x1)
      const cy = clampIn(y0 + n.y * (y1 - y0), y0, y1)
      group.style.left = px(cx - w / 2)
      group.style.top = px(cy - h / 2)
      Object.assign(group.style, { width: px(w), height: px(h), transformOrigin: '50% 50%' })
      views.set(n.id, { n, cx, cy, w, h, group, box, outline, slot })
    })

    // Wires.
    const port = (x: number, y: number, kind: 'out' | 'in' | 'sub') => {
      if (kind === 'out') {
        const c = svgEl('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: (6.5 * k).toFixed(2), 'stroke-width': (2 * k).toFixed(2) })
        c.style.fill = cardBg
        c.style.stroke = alpha(fg, 0.5)
        return c
      }
      if (kind === 'in') {
        const r = svgEl('rect', { x: (x - 4 * k).toFixed(2), y: (y - 8 * k).toFixed(2), width: (8 * k).toFixed(2), height: (16 * k).toFixed(2), rx: (2 * k).toFixed(2) })
        r.style.fill = alpha(fg, 0.5)
        return r
      }
      const d = svgEl('rect', { x: (x - 6 * k).toFixed(2), y: (y - 6 * k).toFixed(2), width: (12 * k).toFixed(2), height: (12 * k).toFixed(2), rx: (1.5 * k).toFixed(2), transform: `rotate(45 ${x.toFixed(2)} ${y.toFixed(2)})`, 'stroke-width': (2 * k).toFixed(2) })
      d.style.fill = cardBg
      d.style.stroke = alpha(fg, 0.5)
      return d
    }
    const edges: EdgeView[] = p.edges.map((e, i) => {
      const A = views.get(e.from)!
      const B = views.get(e.to)!
      let d: string
      const extras: SVGElement[] = []
      let clip: SVGRectElement | undefined
      let ys: number | undefined
      let ye: number | undefined
      const path = svgEl('path', { fill: 'none', 'stroke-width': (2.6 * k).toFixed(2), 'stroke-linecap': 'round' })
      path.style.stroke = alpha(fg, 0.46)
      if (e.kind === 'main') {
        // The output port sits just outside the card edge (the wire starts at its centre).
        const xs = A.cx + A.w / 2 + 7 * k
        const xe = B.cx - B.w / 2 - 6 * k
        const y0 = A.cy
        const y1 = B.cy
        const dx = Math.max(40 * k, Math.abs(xe - xs) * 0.5)
        d = `M ${xs.toFixed(2)} ${y0.toFixed(2)} C ${(xs + dx).toFixed(2)} ${y0.toFixed(2)} ${(xe - dx).toFixed(2)} ${y1.toFixed(2)} ${xe.toFixed(2)} ${y1.toFixed(2)}`
        path.setAttribute('pathLength', '1000')
        path.setAttribute('stroke-dasharray', '1000 1000')
        const head = svgEl('path', { d: `M ${(xe - 12 * k).toFixed(2)} ${(y1 - 8 * k).toFixed(2)} L ${(xe + 1 * k).toFixed(2)} ${y1.toFixed(2)} L ${(xe - 12 * k).toFixed(2)} ${(y1 + 8 * k).toFixed(2)}`, fill: 'none', 'stroke-width': (2.6 * k).toFixed(2), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
        head.style.stroke = alpha(fg, 0.46)
        extras.push(port(xs, y0, 'out'), head)
      } else {
        const xs = clampIn(B.cx, A.cx - A.w / 2 + 0.25 * S, A.cx + A.w / 2 - 0.25 * S)
        ys = A.cy + A.h / 2
        ye = B.cy - B.h / 2 - 2 * k
        const dy = (ye - ys) * 0.5
        d = `M ${xs.toFixed(2)} ${ys.toFixed(2)} C ${xs.toFixed(2)} ${(ys + dy).toFixed(2)} ${B.cx.toFixed(2)} ${(ye - dy).toFixed(2)} ${B.cx.toFixed(2)} ${ye.toFixed(2)}`
        path.setAttribute('stroke-dasharray', `${(9 * k).toFixed(2)} ${(8 * k).toFixed(2)}`)
        const cp = svgEl('clipPath', { id: `${uid}-c${i}` })
        clip = svgEl('rect', { x: 0, y: (ys - 10 * k).toFixed(2), width: PW.toFixed(2), height: 0 })
        cp.append(clip)
        defs.append(cp)
        path.setAttribute('clip-path', `url(#${uid}-c${i})`)
        extras.push(port(xs, ys, 'sub'))
      }
      path.setAttribute('d', d)
      edgeSvg.append(path)
      for (const x of extras) edgeSvg.append(x)
      const len = path.getTotalLength()
      const pts = Array.from({ length: 97 }, (_, j) => {
        const q = path.getPointAtLength((len * j) / 96)
        return { x: q.x, y: q.y }
      })
      const pulse = svgEl('g')
      const glow = svgEl('circle', { r: (12 * k).toFixed(2) })
      glow.style.fill = alpha(accent, 0.22)
      const core = svgEl('circle', { r: (6 * k).toFixed(2) })
      core.style.fill = accent
      pulse.append(glow, core)
      pulse.style.display = 'none'
      edgeSvg.append(pulse)
      return { at: e.at, kind: e.kind, path, extras, clip, ys, ye, pts, len, pulse, phase: ctx.rng() }
    })
    // Edge ends sit under the nodes: move the node groups after the wires.
    for (const v of views.values()) panel.append(v.group)

    const c = safePointPx(ctx, p.at)
    panel.style.left = px(clampIn(c.x - PW / 2, ctx.safe.x, ctx.safe.x + ctx.safe.w - PW))
    panel.style.top = px(clampIn(c.y - PH / 2, ctx.safe.y, ctx.safe.y + ctx.safe.h - PH))

    const focus = p.focus.map((f) => ({ at: f.at, key: f.id }))
    const speed = NG.pulseSpeed * PW
    return {
      update(localT) {
        const t = localT
        const pin = easeOutCubic(seg(t, 0, NG.panelSec))
        panel.style.opacity = opacityOf(pin)
        panel.style.transform = pin >= 1 ? '' : `translateY(${px((1 - pin) * 34 * k)}) scale(${(0.985 + 0.015 * pin).toFixed(5)})`

        for (const v of views.values()) {
          const a = v.n.at
          show(v.group, t >= a)
          if (t < a) continue
          const q = seg(t, a, a + NG.popSec)
          const sc = NG.popFrom + (1 - NG.popFrom) * settle(q)
          v.group.style.transform = sc === 1 ? '' : `scale(${sc.toFixed(5)})`
          v.group.style.opacity = opacityOf(easeOutCubic(Math.min(1, q * 1.5)))
          const { hl } = emphasisAt(focus, v.n.id, t, NG.focusSec)
          show(v.outline, hl > 0.001)
          if (hl > 0.001) v.outline.style.opacity = opacityOf(hl)
          if (v.slot) {
            const f = v.n.fillAt === undefined ? 0 : seg(t, v.n.fillAt, v.n.fillAt + NG.fillSec)
            const fe = easeOutCubic(f)
            v.slot.dashed.style.opacity = opacityOf(1 - fe)
            show(v.slot.dashed, fe < 1)
            show(v.slot.plus, fe < 1)
            v.slot.plus.style.opacity = opacityOf(1 - Math.min(1, fe * 2))
            v.slot.plus.style.transform = fe <= 0 ? '' : `scale(${(1 - 0.5 * fe).toFixed(5)}) rotate(${(90 * fe).toFixed(3)}deg)`
            const filled = f > 0
            const disp = filled ? 'flex' : 'none'
            if (v.slot.filled.style.display !== disp) v.slot.filled.style.display = disp
            v.slot.filled.style.opacity = opacityOf(fe)
            const ms = 0.55 + 0.45 * settle(f)
            v.slot.mark.style.transform = f >= 1 ? '' : `scale(${ms.toFixed(5)})`
            const rq = v.n.fillAt === undefined ? 0 : seg(t, v.n.fillAt + 0.1, v.n.fillAt + 0.75)
            show(v.slot.ring, rq > 0 && rq < 1)
            if (rq > 0 && rq < 1) {
              v.slot.ring.style.transform = `scale(${(1 + 0.4 * easeOutCubic(rq)).toFixed(5)})`
              v.slot.ring.style.opacity = (0.7 * (1 - rq)).toFixed(4)
            }
          }
        }

        for (const e of edges) {
          const dq = seg(t, e.at, e.at + NG.drawSec)
          const visible = dq > 0
          show(e.path, visible)
          for (const x of e.extras) show(x, visible)
          if (!visible) {
            show(e.pulse, false)
            continue
          }
          const dr = easeOutCubic(dq)
          e.extras[0]!.style.opacity = opacityOf(seg(dq, 0, 0.35))
          if (e.kind === 'main') {
            e.path.setAttribute('stroke-dashoffset', (1000 * (1 - dr)).toFixed(3))
            e.extras[1]!.style.opacity = opacityOf(seg(dr, 0.85, 1))
          } else {
            e.clip!.setAttribute('height', ((e.ye! - e.ys! + 20 * k) * dr).toFixed(2))
          }
          const f0 = p.flowAt === undefined ? Infinity : Math.max(p.flowAt, e.at + NG.drawSec)
          if (t < f0) {
            show(e.pulse, false)
            continue
          }
          const u = ((t - f0) * speed) / e.len + e.phase
          const q = u - Math.floor(u)
          const j = q * 96
          const j0 = Math.floor(j)
          const fr = j - j0
          const P0 = e.pts[j0]!
          const P1 = e.pts[Math.min(96, j0 + 1)]!
          show(e.pulse, true)
          e.pulse.setAttribute('transform', `translate(${(P0.x + (P1.x - P0.x) * fr).toFixed(2)} ${(P0.y + (P1.y - P0.y) * fr).toFixed(2)})`)
          const win = Math.min(1, q / 0.1) * Math.min(1, (1 - q) / 0.1)
          e.pulse.style.opacity = (easeOutCubic(seg(t, f0, f0 + 0.4)) * win).toFixed(4)
        }
      },
    }
  },
}
