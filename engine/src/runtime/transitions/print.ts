import {
  blindsParams, inkSlabParams, pageTurnParams, paperTearParams, penDotCurtainParams, pixelCurtainParams,
  type BlindsParams, type InkSlabParams, type PageTurnParams, type PaperTearParams, type PenDotCurtainParams, type PixelCurtainParams,
} from '../../core/params/transitions'
import { n } from './fmt'
import type { Transition, TransitionCtx } from './registry'

/**
 * Print-shop transitions: paper, ink and type-case moves between two scenes. All geometry is in frame
 * pixels on the transition's overlay; every update is a pure function of the window progress `pr`
 * (the cut is at 0.5).
 */

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const inOutQuart = (x: number) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2)
const inOutSine = (x: number) => 0.5 - Math.cos(Math.PI * clamp01(x)) / 2
const outQuad = (x: number) => 1 - (1 - x) ** 2
/** Progress through the first (cover) and second (uncover) half of the window. */
const halves = (pr: number) => ({ cover: clamp01(pr * 2), uncover: clamp01(pr * 2 - 1), covering: pr < 0.5 })

const box = (parent: HTMLElement, style: Partial<CSSStyleDeclaration> = {}) => {
  const d = document.createElement('div')
  Object.assign(d.style, { position: 'absolute', pointerEvents: 'none' }, style)
  parent.append(d)
  return d
}
const layersOf = (ctx: TransitionCtx) => ({
  incoming: ctx.inLayers?.length ? ctx.inLayers : [ctx.in],
  outgoing: ctx.outLayers?.length ? ctx.outLayers : [ctx.out],
})
/** While the paper covers the frame it hides the side that should not show yet. */
function showOneSide(ctx: TransitionCtx, pr: number) {
  const { incoming, outgoing } = layersOf(ctx)
  for (const l of pr < 0.5 ? incoming : outgoing) l.style.clipPath = 'inset(100%)'
}
/** A look token (often `var(--…)`) resolved to a colour on the overlay, for canvas drawing. */
function resolved(ctx: TransitionCtx, token: string): string {
  if (!token.startsWith('var(')) return token
  return getComputedStyle(ctx.overlay).getPropertyValue(token.slice(4, -1)).trim() || '#111111'
}
function frameCanvas(ctx: TransitionCtx) {
  const cv = document.createElement('canvas')
  cv.width = ctx.size.w
  cv.height = ctx.size.h
  Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
  ctx.overlay.append(cv)
  const c = cv.getContext('2d')
  if (!c) throw new Error('transition needs a 2D canvas')
  return c
}

/** A sheet of paper sweeps over the frame left to right, as a page turns in an Arabic book, then lifts away to the right. */
export const pageTurn: Transition<PageTurnParams> = {
  id: 'page-turn',
  params: pageTurnParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const colour = ctx.look.vars[p.color]
    // A tilted holder much taller than the frame, so the tilted sheet still covers every corner.
    const holder = box(ctx.overlay, { left: `${-w}px`, top: `${-h}px`, width: `${3 * w}px`, height: `${3 * h}px`, transform: 'rotate(7deg)' })
    const sheet = box(holder, { top: '0', height: '100%', background: colour })
    const curl = box(holder, {
      top: '0', height: '100%', width: `${0.07 * w}px`, background: colour,
      backgroundImage: 'linear-gradient(90deg, rgba(0,0,0,0.2), rgba(0,0,0,0.03) 35%, rgba(255,255,255,0.16) 75%, rgba(0,0,0,0.08))',
      boxShadow: `${n(0.013 * w)}px 0 ${n(0.04 * w)}px rgba(0,0,0,0.22)`,
    })
    const cast = box(holder, { top: '0', height: '100%', width: `${0.06 * w}px`, background: 'rgba(0,0,0,0.16)', filter: `blur(${n(0.015 * w)}px)` })
    const L = w // holder x of the frame's left edge
    return {
      bothVisible: true,
      twoWorlds: true,
      update(pr) {
        showOneSide(ctx, pr)
        const { cover, uncover, covering } = halves(pr)
        // Covering: the sheet's leading (right) edge moves from off-left to past the right edge.
        // Uncovering: its trailing (left) edge follows, the curl riding on that edge.
        const edge = L - 0.25 * w + 1.5 * w * inOutQuart(covering ? cover : uncover)
        if (covering) {
          sheet.style.left = `${n(0)}px`
          sheet.style.width = `${n(Math.max(0, edge))}px`
          curl.style.left = `${n(edge - 0.07 * w)}px`
          cast.style.display = 'none'
        } else {
          sheet.style.left = `${n(edge)}px`
          sheet.style.width = `${n(3 * w - edge)}px`
          curl.style.left = `${n(edge)}px`
          curl.style.width = `${n(Math.max(0.02 * w, 0.07 * w + 0.15 * w * uncover))}px`
          cast.style.display = ''
          cast.style.left = `${n(edge - 0.06 * w)}px`
        }
      },
    }
  },
}

/** A live copy of a scene layer for this frame: the DOM cloned, every canvas's pixels copied over. */
function snapshot(layer: HTMLElement): HTMLElement {
  const copy = layer.cloneNode(true) as HTMLElement
  copy.setAttribute('aria-hidden', 'true')
  copy.removeAttribute('data-mba-scene')
  for (const el of copy.querySelectorAll('[data-mba-part], [data-mba-text], [data-mba-key]')) {
    el.removeAttribute('data-mba-part')
    el.removeAttribute('data-mba-text')
    el.removeAttribute('data-mba-key')
  }
  const from = layer.querySelectorAll('canvas')
  const to = copy.querySelectorAll('canvas')
  from.forEach((c, i) => {
    const t = to[i]
    if (!t || !c.width || !c.height) return
    t.width = c.width
    t.height = c.height
    t.getContext('2d')?.drawImage(c, 0, 0)
  })
  Object.assign(copy.style, { clipPath: '', visibility: 'visible', display: '' })
  return copy
}

/**
 * The outgoing shot itself tears in two along a ragged line: each half is a piece of paper with a
 * white, fibrous torn edge. The tear opens from the top (the halves hinge apart at the bottom), then
 * both pieces lift, turn and fly off either side, casting shadows on the new scene underneath.
 */
export const paperTear: Transition<PaperTearParams> = {
  id: 'paper-tear',
  params: paperTearParams,
  build(ctx) {
    const { w, h } = ctx.size
    const k = w / 1080
    // The tear: a random walk from the top (a little right of centre) to the bottom (a little left).
    const steps = 140
    let jog = 0
    const tear = Array.from({ length: steps + 1 }, (_, i) => {
      const f = i / steps
      jog = jog * 0.75 + (ctx.rng() - 0.5) * 0.022 * w
      return { x: w * (0.56 - 0.12 * f) + jog + (ctx.rng() - 0.5) * 0.005 * w, y: -0.02 * h + f * 1.04 * h }
    })
    // The paper core shows along each torn edge: a white band of uneven width, wider in chunks.
    let bw = 7
    const band = tear.map(() => {
      bw = Math.max(2.5, Math.min(18, bw + (ctx.rng() - 0.5) * 5))
      return (bw + (ctx.rng() < 0.08 ? 8 * ctx.rng() : 0)) * k
    })
    // Paper fibres that poke out of the torn edge into the gap (drawn unclipped).
    const fibres = Array.from({ length: 170 }, () => {
      const i = Math.floor(ctx.rng() * steps)
      const a = tear[i]!
      const b = tear[i + 1]!
      const u = ctx.rng()
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, len: (2 + 7 * ctx.rng() ** 2) * k, tilt: (ctx.rng() - 0.5) * 1.2 }
    })
    const pts = (xs: { x: number; y: number }[]) => xs.map((q) => `${n(q.x)},${n(q.y)}`).join(' ')
    const pieces = (['a', 'b'] as const).map((side) => {
      const sign = side === 'a' ? -1 : 1
      const outer = box(ctx.overlay, { inset: '0', left: '0', top: '0', width: `${w}px`, height: `${h}px` })
      const edgeTo = sign < 0 ? -0.3 * w : 1.3 * w
      const poly = `polygon(${edgeTo}px ${-0.3 * h}px, ${tear.map((q) => `${n(q.x)}px ${n(q.y)}px`).join(', ')}, ${edgeTo}px ${1.3 * h}px)`
      const inner = box(outer, { left: '0', top: '0', width: `${w}px`, height: `${h}px`, clipPath: poly })
      const holder = box(inner, { left: '0', top: '0', width: `${w}px`, height: `${h}px`, overflow: 'hidden' })
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
      Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: `${w}px`, height: `${h}px`, overflow: 'visible' })
      const fid = `tear-fibre-${ctx.index}-${side}`
      const inward = tear.map((q, i) => ({ x: q.x + sign * band[i]!, y: q.y }))
      svg.innerHTML =
        `<defs><filter id="${fid}" x="-20%" y="-5%" width="140%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.08 1.4" numOctaves="3" seed="${side === 'a' ? 3 : 7}"/>` +
        `<feColorMatrix values="0 0 0 0 0.72  0 0 0 0 0.69  0 0 0 0 0.63  0 0 0 0.75 -0.1"/><feComposite in2="SourceGraphic" operator="in" result="f"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="f"/></feMerge></filter></defs>` +
        `<polygon points="${pts([...tear, ...inward.slice().reverse()])}" fill="#f6f2ea" filter="url(#${fid})"/>` +
        `<polyline points="${pts(inward)}" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="${n(1.5 * k)}"/>`
      inner.append(svg)
      const hair = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      hair.setAttribute('viewBox', `0 0 ${w} ${h}`)
      Object.assign(hair.style, { position: 'absolute', left: '0', top: '0', width: `${w}px`, height: `${h}px`, overflow: 'visible' })
      hair.innerHTML = fibres
        .map((f) => `<line x1="${n(f.x)}" y1="${n(f.y)}" x2="${n(f.x - sign * f.len)}" y2="${n(f.y + f.tilt * f.len)}" stroke="#f6f2ea" stroke-opacity="0.85" stroke-width="${n(1.1 * k)}" stroke-linecap="round"/>`)
        .join('')
      outer.append(hair)
      return { side, sign, outer, holder }
    })
    // Hinges near the bottom of the tear: the top opens first, as if the tear were running down.
    const hinge = tear[steps]!
    return {
      bothVisible: true,
      update(pr) {
        const { incoming, outgoing } = layersOf(ctx)
        for (const l of incoming) l.style.clipPath = ''
        // Both pieces carry live copies of the outgoing scene; the originals are hidden.
        const shots = outgoing.slice().reverse().map((l) => snapshot(l))
        for (const l of outgoing) l.style.clipPath = 'inset(100%)'
        const open = inOutSine(clamp01(pr / 0.42))
        const fly = inOutQuart(clamp01((pr - 0.36) / 0.64))
        for (const pc of pieces) {
          pc.holder.replaceChildren(...(pc === pieces[0] ? shots : shots.map((s) => s.cloneNode(true) as HTMLElement)))
          if (pc !== pieces[0]) {
            // The second copy needs its own canvas pixels too.
            const src = pieces[0]!.holder.querySelectorAll('canvas')
            pc.holder.querySelectorAll('canvas').forEach((c, i) => {
              const s = src[i]
              if (!s || !s.width) return
              c.width = s.width
              c.height = s.height
              c.getContext('2d')?.drawImage(s, 0, 0)
            })
          }
          const rot = pc.sign * (3.4 * open + 14 * fly)
          const dx = pc.sign * (0.02 * w * open + 1.05 * w * fly)
          const dy = 0.14 * h * fly * fly
          const lift = 1 + 0.035 * Math.max(open * 0.6, fly)
          pc.outer.style.transformOrigin = `${n(hinge.x)}px ${n(hinge.y)}px`
          pc.outer.style.transform = `translate(${n(dx)}px, ${n(dy)}px) rotate(${n(rot)}deg) scale(${n(lift)})`
          const sh = 10 + 34 * Math.max(open * 0.7, fly)
          pc.outer.style.filter = `drop-shadow(${n(pc.sign * 0.4 * sh * k)}px ${n(0.6 * sh * k)}px ${n(sh * k)}px rgba(0,0,0,0.55))`
          pc.outer.style.opacity = pr >= 1 ? '0' : '1'
        }
      },
    }
  },
}

/** An ink drop falls to the centre; a lattice of pen-dot diamonds spreads from it to cover the frame, then shrinks away. */
export const penDotCurtain: Transition<PenDotCurtainParams> = {
  id: 'pen-dot-curtain',
  params: penDotCurtainParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const c = frameCanvas(ctx)
    const pitch = 0.085 * w
    const dots: { x: number; y: number; delay: number }[] = []
    const reach = Math.hypot(w, h)
    for (let a = -reach; a <= reach; a += pitch)
      for (let b = -reach; b <= reach; b += pitch) {
        const x = w / 2 + (a - b) * Math.SQRT1_2
        const y = h / 2 + (a + b) * Math.SQRT1_2
        if (x < -pitch || x > w + pitch || y < -pitch || y > h + pitch) continue
        dots.push({ x, y, delay: Math.hypot(x - w / 2, y - h / 2) / (0.65 * reach) })
      }
    return {
      bothVisible: true,
      twoWorlds: true,
      update(pr) {
        showOneSide(ctx, pr)
        const fill = resolved(ctx, ctx.look.vars[p.color])
        const rim = resolved(ctx, ctx.look.vars[p.edge])
        c.clearRect(0, 0, w, h)
        if (Math.abs(pr - 0.5) < 1e-6) {
          c.fillStyle = fill
          c.fillRect(0, 0, w, h)
          return
        }
        if (pr < 0.14) {
          c.fillStyle = fill
          c.beginPath()
          c.arc(w / 2, -0.03 * h + 0.53 * h * clamp01(pr / 0.12) ** 3, 0.028 * w, 0, Math.PI * 2)
          c.fill()
        }
        const phase = pr < 0.5 ? clamp01((pr - 0.12) / 0.38) : (pr - 0.5) * 2
        c.fillStyle = fill
        c.strokeStyle = rim
        for (const d of dots) {
          const grow = clamp01((phase * 1.35 - d.delay) / 0.3)
          const k = pr < 0.5 ? grow : 1 - grow
          const r = 0.8 * pitch * k ** 3
          if (r <= 0) continue
          c.beginPath()
          c.moveTo(d.x, d.y - r)
          c.lineTo(d.x + r, d.y)
          c.lineTo(d.x, d.y + r)
          c.lineTo(d.x - r, d.y)
          c.closePath()
          c.fill()
          const line = k < 0.8 ? 1 : (1 - k) / 0.2
          if (line > 0) {
            c.lineWidth = 0.002 * w * line
            c.stroke()
          }
        }
      },
    }
  },
}

/** Square cells fill the frame in a seeded order (solid at the cut), then clear the same way. */
export const pixelCurtain: Transition<PixelCurtainParams> = {
  id: 'pixel-curtain',
  params: pixelCurtainParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const c = frameCanvas(ctx)
    const size = (p.cell * w) / 1080
    const cols = Math.ceil(w / size)
    const rows = Math.ceil(h / size)
    const order = Array.from({ length: cols * rows }, () => ctx.rng())
    return {
      bothVisible: true,
      twoWorlds: true,
      update(pr) {
        showOneSide(ctx, pr)
        const covered = pr <= 0.5 ? pr * 2 : 2 - pr * 2
        c.clearRect(0, 0, w, h)
        c.fillStyle = resolved(ctx, ctx.look.vars[p.color])
        order.forEach((at, i) => {
          if (covered >= 1 || at < covered) c.fillRect(Math.floor((i % cols) * size), Math.floor(Math.floor(i / cols) * size), Math.ceil(size) + 1, Math.ceil(size) + 1)
        })
      },
    }
  },
}

/** A wide ink slab with an accent edge sweeps right to left: the old scene ahead of it, the new one behind. */
export const inkSlab: Transition<InkSlabParams> = {
  id: 'ink-slab',
  params: inkSlabParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const width = 0.52 * w
    const lip = 0.032 * w
    const slab = box(ctx.overlay, { top: '0', height: `${h}px`, width: `${width}px`, background: ctx.look.vars[p.color] })
    box(slab, { top: '0', left: '0', height: '100%', width: `${lip}px`, background: ctx.look.vars[p.edge] })
    return {
      bothVisible: true,
      twoWorlds: true,
      update(pr) {
        // The slab's left (leading) edge travels from just off the right side to past the left side.
        const lead = w * 1.04 - (w * 1.04 + width + 0.02 * w) * inOutQuart(clamp01(pr))
        slab.style.transform = `translateX(${n(lead)}px)`
        const { incoming, outgoing } = layersOf(ctx)
        const outClip = pr >= 1 ? 'inset(0 100% 0 0)' : `inset(0 ${n(Math.max(0, w - lead))}px 0 0)`
        const inClip = pr <= 0 ? 'inset(0 0 0 100%)' : `inset(0 0 0 ${n(Math.max(0, lead + width))}px)`
        for (const l of outgoing) l.style.clipPath = outClip
        for (const l of incoming) l.style.clipPath = inClip
      },
    }
  },
}

/** Horizontal slats open over the old scene, top slat first, each opening from its right end (the reading side). */
export const blinds: Transition<BlindsParams> = {
  id: 'blinds',
  params: blindsParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const band = h / p.slats
    const lag = 0.06
    const stagger = 0.02
    const open = (pr: number, i: number, end: 'right' | 'left') => outQuad(inOutSine(clamp01((pr - i * stagger - (end === 'left' ? lag : 0)) / (1 - p.slats * stagger - lag))))
    return {
      bothVisible: true,
      twoWorlds: true,
      update(pr) {
        const { incoming } = layersOf(ctx)
        if (pr >= 1) {
          for (const l of incoming) l.style.clipPath = ''
          return
        }
        const shapes: string[] = []
        for (let i = 0; i < p.slats; i++) {
          const mid = band * (i + 0.5)
          const r = (open(pr, i, 'right') * band) / 2
          const l = (open(pr, i, 'left') * band) / 2
          if (r <= 0 && l <= 0) continue
          shapes.push(`M${w} ${n(mid - r)}L0 ${n(mid - l)}L0 ${n(mid + l)}L${w} ${n(mid + r)}Z`)
        }
        const clip = shapes.length ? `path('${shapes.join('')}')` : 'inset(0 0 0 100%)'
        for (const l of incoming) l.style.clipPath = clip
      },
    }
  },
}
