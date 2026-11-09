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

/** Paper slides in from the right, then rips down a ragged seam and the two halves pull apart. */
export const paperTear: Transition<PaperTearParams> = {
  id: 'paper-tear',
  params: paperTearParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const colour = ctx.look.vars[p.color]
    const steps = 44
    const seam = Array.from({ length: steps + 1 }, (_, i) => ({ x: 0.5 * w + (ctx.rng() - 0.5) * 0.045 * w, y: (h * i) / steps }))
    const seamPath = (side: 'l' | 'r') =>
      `polygon(${side === 'l' ? `-20% 0, ` : `120% 0, `}${seam.map((q) => `${n(q.x)}px ${n(q.y)}px`).join(', ')}${side === 'l' ? ', -20% 100%' : ', 120% 100%'})`
    const sheet = box(ctx.overlay, { top: '0', left: '0', width: `${w}px`, height: `${h}px`, background: colour })
    const halvesEl = (['l', 'r'] as const).map((side) =>
      box(ctx.overlay, { top: '0', left: '0', width: `${w}px`, height: `${h}px`, background: colour, clipPath: seamPath(side), filter: `drop-shadow(${side === 'l' ? '' : '-'}${n(0.01 * w)}px 0 ${n(0.008 * w)}px rgba(0,0,0,0.25))`, transformOrigin: side === 'l' ? '0% 100%' : '100% 100%' }),
    )
    return {
      bothVisible: true,
      twoWorlds: true,
      update(pr) {
        showOneSide(ctx, pr)
        const { cover, uncover, covering } = halves(pr)
        sheet.style.display = covering ? '' : 'none'
        for (const el of halvesEl) el.style.display = covering ? 'none' : ''
        if (covering) {
          sheet.style.transform = `translateX(${n(w * (1 - inOutQuart(cover)))}px)`
          return
        }
        const k = inOutQuart(uncover)
        halvesEl[0]!.style.transform = `translateX(${n(-1.1 * w * k)}px) rotate(${n(-4 * k)}deg)`
        halvesEl[1]!.style.transform = `translateX(${n(1.1 * w * k)}px) rotate(${n(4 * k)}deg)`
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
