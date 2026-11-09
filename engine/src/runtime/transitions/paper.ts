import { bladeSliceParams, layerExplodeParams, profileGridParams, type BladeSliceParams, type LayerExplodeParams, type ProfileGridParams } from '../../core/params/transitions'
import type { Transition } from './registry'
import { n } from './fmt'

/** Creator cuts: blade-slice, layer-explode and profile-grid. Pure in the window progress `p` (cut at 0.5). */

const SVG = 'http://www.w3.org/2000/svg'
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const cubicInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}
/** Every layer on each side of the cut (the transition's scene plus the lower-track scenes it joins). */
const sides = (ctx: { in: HTMLElement; out: HTMLElement; inLayers?: HTMLElement[]; outLayers?: HTMLElement[] }) => ({
  ins: ctx.inLayers?.length ? ctx.inLayers : [ctx.in],
  outs: ctx.outLayers?.length ? ctx.outLayers : [ctx.out],
})
/** While a cover hides the frame, only one side of the cut shows. */
function oneSide(ctx: Parameters<typeof sides>[0], pr: number) {
  const { ins, outs } = sides(ctx)
  for (const l of pr < 0.5 ? ins : outs) l.style.clipPath = 'inset(100%)'
}

/** A blade crosses the frame along `angle`; the incoming scene shows under the cut, the cut-off half slides away along the blade. */
export const bladeSlice: Transition<BladeSliceParams> = {
  id: 'blade-slice',
  params: bladeSliceParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const a = (p.angle * Math.PI) / 180
    const d = { x: Math.cos(a), y: Math.sin(a) }
    const nn = { x: -d.y, y: d.x }
    const L = Math.hypot(w, h) * 1.5
    const c = { x: w / 2, y: h / 2 }
    const A = { x: c.x - L * d.x, y: c.y - L * d.y }
    const B = { x: c.x + L * d.x, y: c.y + L * d.y }
    // The half above the blade (towards -n).
    const upper = [A, B, { x: B.x - L * nn.x, y: B.y - L * nn.y }, { x: A.x - L * nn.x, y: A.y - L * nn.y }]
    const poly = (q: { x: number; y: number }[], v = { x: 0, y: 0 }) => q.map((pt) => `${n(pt.x + v.x)}px ${n(pt.y + v.y)}px`).join(', ')
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' })
    const glow = el('line', { 'stroke-linecap': 'round' })
    const blade = el('line', { 'stroke-linecap': 'round' })
    glow.style.stroke = ctx.look.vars[p.edge]
    blade.style.stroke = '#fff'
    glow.style.filter = 'blur(10px)'
    svg.append(glow, blade)
    ctx.overlay.append(svg)
    const half = Math.hypot(w, h) / 2
    const k = w / 1080
    return {
      bothVisible: true,
      twoWorlds: true,
      update(pr) {
        const { ins, outs } = sides(ctx)
        const draw = clamp01(pr / 0.35)
        const e = cubicInOut(draw)
        const x1 = c.x - half * d.x
        const y1 = c.y - half * d.y
        for (const ln of [glow, blade]) {
          ln.setAttribute('x1', n(x1))
          ln.setAttribute('y1', n(y1))
          ln.setAttribute('x2', n(x1 + 2 * half * d.x * e))
          ln.setAttribute('y2', n(y1 + 2 * half * d.y * e))
        }
        const fade = 1 - clamp01((pr - 0.35) / 0.3)
        blade.style.strokeWidth = n(6 * k * fade)
        glow.style.strokeWidth = n(26 * k * fade)
        svg.style.opacity = n(fade)
        if (pr < 0.35) {
          for (const l of ins) l.style.clipPath = 'inset(100%)'
          for (const l of outs) {
            l.style.clipPath = ''
            l.style.transform = ''
          }
          return
        }
        const go = clamp01((pr - 0.42) / 0.58)
        const s = (go * go * go) * L * 0.8
        const v = { x: -d.x * s, y: -d.y * s - go * go * 0.15 * h }
        for (const l of outs) {
          l.style.clipPath = `polygon(${poly(upper)})`
          l.style.transform = `translate(${n(v.x)}px, ${n(v.y)}px) rotate(${n(-go * go * 6)}deg)`
          l.style.transformOrigin = `${n(c.x)}px ${n(c.y)}px`
        }
        // Everything outside the moved upper half: the frame with that half cut out.
        const moved = upper.map((pt) => ({ x: pt.x + v.x, y: pt.y + v.y }))
        const hole = `M${moved.map((pt) => `${n(pt.x)} ${n(pt.y)}`).join(' L')} Z`
        for (const l of ins) l.style.clipPath = pr >= 1 ? '' : `path(evenodd, 'M${-w} ${-h} H${2 * w} V${2 * h} H${-w} Z ${hole}')`
      },
    }
  },
}

/** The scene tilts into a glass pane with ghost panes fanned out beside it; the next scene settles out of the same pose (2D only). */
export const layerExplode: Transition<LayerExplodeParams> = {
  id: 'layer-explode',
  params: layerExplodeParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const panes = Array.from({ length: p.panes }, () => {
      const d = document.createElement('div')
      Object.assign(d.style, { position: 'absolute', left: '0', top: '0', width: `${w}px`, height: `${h}px`, border: `${Math.max(2, Math.round(4 * k))}px solid #ffffffb0`, background: 'linear-gradient(135deg, #ffffff22, #ffffff06)', boxSizing: 'border-box', borderRadius: `${Math.round(24 * k)}px`, transformOrigin: '50% 50%', boxShadow: '0 30px 80px #0006' })
      ctx.overlay.append(d)
      return d
    })
    const pose = (e: number) => `translate(${n(-0.06 * w * e)}px, ${n(0.05 * h * e)}px) scale(${n(1 - 0.38 * e)}) skewY(${n(-9 * e)}deg) rotate(${n(-5 * e)}deg)`
    return {
      bothVisible: true,
      twoWorlds: true,
      update(pr) {
        oneSide(ctx, pr)
        const { ins, outs } = sides(ctx)
        // In: 0 → 0.5 the scene folds into the pose; 0.5 → 1 the next one unfolds out of it.
        const e = pr <= 0.5 ? cubicInOut(pr * 2) : 1 - cubicInOut((pr - 0.5) * 2)
        const fan = Math.sin(Math.PI * pr)
        for (const l of pr < 0.5 ? outs : ins) {
          l.style.transform = e > 0 ? pose(e) : ''
          l.style.transformOrigin = '50% 50%'
          l.style.borderRadius = ''
        }
        panes.forEach((pane, i) => {
          const off = (i + 1) * fan
          pane.style.transform = `translate(${n(0.09 * w * off)}px, ${n(-0.07 * h * off)}px) ${pose(e)}`
          pane.style.opacity = n(clamp01(fan * 1.6) * (1 - i * 0.18))
        })
      },
    }
  },
}

/**
 * The scene zooms out into one tile of a profile grid (status bar, handle, Follow, tabs, three
 * columns of posts with view counts); the next scene is already playing in another tile, and the
 * camera dives into it. Both scenes stay live in their tiles over the whole window.
 */
export const profileGrid: Transition<ProfileGridParams> = {
  id: 'profile-grid',
  params: profileGridParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const gap = 5 * k
    const cw = (w - 2 * gap) / 3
    const chh = cw * (h / w)
    const head = 0.2 * h
    const cell = (col: number, row: number) => ({ x: col * (cw + gap), y: head + row * (chh + gap) })
    const A = cell(1, 0)
    const B = cell(2, 1)
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', direction: 'ltr' })
    svg.setAttribute('direction', 'ltr')
    const g = el('g')
    svg.append(g)
    // The page: white everywhere except the two live tiles (holes).
    const rows = 4
    const pageH = head + rows * (chh + gap)
    const hole = (c: { x: number; y: number }) => `M${n(c.x)} ${n(c.y)} h${n(cw)} v${n(chh)} h${n(-cw)} Z`
    g.append(el('path', { d: `M${n(-w)} ${n(-h)} H${n(2 * w)} V${n(pageH + h)} H${n(-w)} Z ${hole(A)} ${hole(B)}`, 'fill-rule': 'evenodd', fill: '#ffffff' }))
    // Header: status bar, back arrow + handle + Follow, the tab icons.
    const txt = (x: number, y: number, s: string, size: number, weight = 600, fill = '#111', anchor = 'start') => {
      const t = el('text', { x: n(x), y: n(y), 'font-size': n(size), 'font-weight': String(weight), fill, 'text-anchor': anchor, 'font-family': "-apple-system, 'Segoe UI', Arial, sans-serif" })
      t.textContent = s
      return t
    }
    g.append(txt(40 * k, 60 * k, '11:31', 34 * k, 700))
    g.append(el('rect', { x: n(w - 110 * k), y: n(38 * k), width: n(60 * k), height: n(28 * k), rx: n(8 * k), fill: 'none', stroke: '#111', 'stroke-width': n(3 * k) }))
    g.append(el('path', { d: `M${n(56 * k)} ${n(120 * k)} l${n(-20 * k)} ${n(20 * k)} l${n(20 * k)} ${n(20 * k)}`, fill: 'none', stroke: '#111', 'stroke-width': n(5 * k), 'stroke-linecap': 'round' }))
    g.append(txt(96 * k, 152 * k, p.user, 44 * k, 700))
    g.append(el('circle', { cx: n(96 * k + p.user.length * 24 * k + 26 * k), cy: n(138 * k), r: n(13 * k), fill: '#3797f0' }))
    g.append(el('rect', { x: n(w - 210 * k), y: n(112 * k), width: n(170 * k), height: n(60 * k), rx: n(14 * k), fill: '#efefef' }))
    g.append(txt(w - 125 * k, 153 * k, 'Follow', 32 * k, 700, '#111', 'middle'))
    for (let i = 0; i < 3; i++) {
      const cx = (i + 0.5) * (w / 3)
      g.append(el('rect', { x: n(cx - 22 * k), y: n(head - 70 * k), width: n(44 * k), height: n(36 * k), rx: n(6 * k), fill: 'none', stroke: i === 1 ? '#111' : '#9a9a9a', 'stroke-width': n(4 * k) }))
    }
    g.append(el('rect', { x: n(w / 3), y: n(head - 12 * k), width: n(w / 3), height: n(4 * k), fill: '#111' }))
    // The other posts: black tiles with white line art and a view count.
    let seed = 7
    let tileN = 0
    const defs = el('defs')
    const fade = el('linearGradient', { id: 'pg-fade', x1: '0', y1: '0', x2: '0', y2: '1' })
    fade.append(el('stop', { offset: '0', 'stop-color': '#000', 'stop-opacity': '0' }), el('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '0.6' }))
    defs.append(fade)
    g.append(defs)
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        const q = cell(c, r)
        if ((q.x === A.x && q.y === A.y) || (q.x === B.x && q.y === B.y)) continue
        g.append(el('rect', { x: n(q.x), y: n(q.y), width: n(cw), height: n(chh), fill: '#0b0b0b' }))
        const tile = p.tiles.length ? p.tiles[tileN++ % p.tiles.length] : undefined
        if (tile) {
          // The creator's own post, cropped to the tile, with its view count.
          g.append(el('image', { href: tile, x: n(q.x), y: n(q.y), width: n(cw), height: n(chh), preserveAspectRatio: 'xMidYMid slice' }))
          g.append(el('rect', { x: n(q.x), y: n(q.y + chh * 0.78), width: n(cw), height: n(chh * 0.22), fill: 'url(#pg-fade)' }))
          g.append(txt(q.x + 16 * k, q.y + chh - 20 * k, `▶ ${(1 + rnd() * 9).toFixed(1)}M`, 26 * k, 700, '#fff'))
          continue
        }
        const mx = q.x + cw / 2
        const my = q.y + chh * (0.38 + 0.1 * rnd())
        const kind = Math.floor(rnd() * 4)
        const s = cw * (0.16 + 0.08 * rnd())
        if (kind === 0) g.append(el('circle', { cx: n(mx), cy: n(my), r: n(s), fill: '#fff' }))
        else if (kind === 1) g.append(el('rect', { x: n(mx - s), y: n(my - s * 1.3), width: n(2 * s), height: n(2.6 * s), fill: 'none', stroke: '#fff', 'stroke-width': n(3 * k) }))
        else if (kind === 2) g.append(el('path', { d: Array.from({ length: 9 }, (_, i) => `${i ? 'L' : 'M'}${n(mx + Math.cos((i / 9) * 6.283) * s)} ${n(my + Math.sin((i / 9) * 6.283) * s)}`).join(' ') + 'Z', fill: 'none', stroke: '#fff', 'stroke-width': n(3 * k) }))
        else g.append(el('path', { d: `M${n(mx)} ${n(my - s * 1.4)} V${n(my + s * 0.6)} M${n(mx - s * 0.5)} ${n(my + s)} a${n(s * 0.5)} ${n(s * 0.5)} 0 1 0 ${n(s)} 0 a${n(s * 0.5)} ${n(s * 0.5)} 0 1 0 ${n(-s)} 0`, fill: 'none', stroke: '#fff', 'stroke-width': n(3 * k) }))
        g.append(el('rect', { x: n(q.x + cw * 0.12), y: n(q.y + chh * 0.12), width: n(cw * (0.4 + 0.3 * rnd())), height: n(5 * k), fill: '#ffffff88' }))
        g.append(txt(q.x + 16 * k, q.y + chh - 20 * k, `▶ ${(1 + rnd() * 9).toFixed(1)}M`, 26 * k, 700, '#fff'))
      }
    }
    // View counts over the two live tiles.
    const viewsA = txt(A.x + 16 * k, A.y + chh - 20 * k, `▶ ${p.views}`, 26 * k, 700, '#fff')
    const viewsB = txt(B.x + 16 * k, B.y + chh - 20 * k, '▶ 2.4M', 26 * k, 700, '#fff')
    g.append(viewsA, viewsB)
    ctx.overlay.append(svg)
    // The camera: page coords → screen. S0 makes a tile fill the frame.
    const S0 = w / cw
    const cam = (c: { x: number; y: number }, e: number) => {
      const S = Math.exp(Math.log(S0) * (1 - e))
      return { S, ox: -c.x * S * (1 - e), oy: -c.y * S * (1 - e) }
    }
    const place = (layers: HTMLElement[], c: { x: number; y: number }, m: { S: number; ox: number; oy: number }) => {
      const s = (m.S * cw) / w
      for (const l of layers) {
        l.style.transformOrigin = '0 0'
        l.style.transform = `translate(${n(m.ox + c.x * m.S)}px, ${n(m.oy + c.y * m.S)}px) scale(${n(s)})`
        l.style.clipPath = ''
      }
    }
    return {
      bothVisible: true,
      twoWorlds: true,
      update(pr) {
        const { ins, outs } = sides(ctx)
        // 0 → 0.5: out of tile A to the page; 0.5 → 1: from the page into tile B.
        const m = pr <= 0.5 ? cam(A, cubicInOut(pr * 2)) : cam(B, 1 - cubicInOut((pr - 0.5) * 2))
        g.setAttribute('transform', `matrix(${n(m.S)} 0 0 ${n(m.S)} ${n(m.ox)} ${n(m.oy)})`)
        place(outs, A, m)
        place(ins, B, m)
        svg.style.opacity = pr <= 0.02 || pr >= 0.98 ? '0' : '1'
        viewsA.style.opacity = viewsB.style.opacity = Math.abs(pr - 0.5) < 0.35 ? '1' : '0'
      },
    }
  },
}
