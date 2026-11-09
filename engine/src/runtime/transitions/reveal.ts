import { REVEAL, revealParams, type RevealParams } from '../../core/params/transitions'
import { clamp01, easeInExpo, seg } from '../../core/ease'
import type { Transition } from './registry'
import { n } from './fmt'

const SVG = 'http://www.w3.org/2000/svg'

/** expo.inOut (GSAP's): flat at both ends, the whole move in the middle. */
const easeInOutExpo = (x: number): number =>
  x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2

const lerp = (a: number, b: number, e: number) => a + (b - a) * e

type Pt = { x: number; y: number }
/** A closed polygon in overlay coordinates. */
type Quad = Pt[]
/** The opening at one frame, in overlay coordinates: a circle, or a union of disjoint quads. */
type Opening = { kind: 'circle'; cx: number; cy: number; r: number } | { kind: 'quads'; quads: Quad[] }

/**
 * Reveal (Plan 3): the next world opens THROUGH a shape while both worlds stay live (`twoWorlds`):
 * every incoming layer (`ctx.inLayers`: the incoming scene and the lower-track scenes starting at the
 * cut, e.g. its backdrop) gets the same `clip-path`, so its DOM text and canvases are clipped
 * together; the outgoing world stays whole underneath, each side in its own colours (the stage).
 *
 * - `circle`: radius expo.in from 0 at `origin` to `REVEAL.circleOver` × the farthest corner of
 *   the bled frame; the accent ring (34 → 5 px, eased with the radius) hugs the opening from outside.
 * - `bands`: `REVEAL.bands.count` horizontal bands slide in from the right (expo.inOut,
 *   `REVEAL.bands.sec` each, `stagger` apart), the band at `origin.y` first, then outwards; that
 *   schedule is scaled to fill the window exactly. A 10 px accent edge leads each moving band.
 * - `panel`: a diagonal edge (top leaning right) sweeps right → left (expo.inOut), led by a 14 px
 *   accent line.
 *
 * Every outgoing layer that draws ABOVE an incoming layer (e.g. the outgoing word on the reveal's
 * track over the incoming backdrop on track 0) is clipped to the complement of the opening (an
 * even-odd path: a rectangle well past the bled frame minus the shape), so nothing of the old
 * world shows through the new one (R28); outgoing layers below every incoming layer stay whole.
 *
 * The accent edges sit on the outgoing side of the boundary, so the incoming world is never covered.
 * Their colour is `var(--mba-accent)`, which the stage pins to the outgoing world on the overlay.
 * Geometry is computed in the overlay's space and mapped into each layer's own space
 * (`ctx.toLayer`), so layers at another camera depth are clipped on the same screen shape. The edge
 * SVG bleeds `REVEAL.bleed` px past the frame on every side (R16).
 */
export const reveal: Transition<RevealParams> = {
  id: 'reveal',
  params: revealParams,
  build(ctx, p) {
    const { w: W, h: H } = ctx.size
    const B = REVEAL.bleed
    const cx = p.origin.x * W
    const cy = p.origin.y * H

    // The edge drawing: one SVG over the frame plus its bleed (the overlay must not clip it).
    ctx.overlay.style.overflow = 'visible'
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('viewBox', `${-B} ${-B} ${W + 2 * B} ${H + 2 * B}`)
    svg.setAttribute('aria-hidden', 'true')
    Object.assign(svg.style, { position: 'absolute', left: `${-B}px`, top: `${-B}px`, width: `${W + 2 * B}px`, height: `${H + 2 * B}px`, overflow: 'visible' })
    const ring = document.createElementNS(SVG, 'circle')
    ring.style.fill = 'none'
    ring.style.stroke = ctx.look.vars.accent
    const edges = document.createElementNS(SVG, 'path')
    edges.style.fill = ctx.look.vars.accent
    svg.append(ring, edges)
    ctx.overlay.append(svg)

    const quadPath = (qs: Quad[]) => qs.map((q) => `M${q.map((pt) => `${n(pt.x)} ${n(pt.y)}`).join('L')}Z`).join('')
    const mapQuads = (m: DOMMatrix, qs: Quad[]): Quad[] => qs.map((q) => q.map((pt) => m.transformPoint(new DOMPoint(pt.x, pt.y))))
    /** Similarity scale of `m` (the camera wrappers only translate, rotate and scale uniformly). */
    const scaleOf = (m: DOMMatrix) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))
    // The complement's outer rectangle: well past the bled frame, so its edges never show.
    const outer: Quad = [{ x: -2 * B, y: -2 * B }, { x: W + 2 * B, y: -2 * B }, { x: W + 2 * B, y: H + 2 * B }, { x: -2 * B, y: H + 2 * B }]
    /**
     * Clips every incoming layer to the opening and every outgoing layer drawn above an incoming
     * one to its complement (all mapped into each layer's own space for this frame).
     */
    const clip = (o: Opening) => {
      const empty = o.kind === 'circle' ? !(o.r > 0) : o.quads.length === 0
      for (const el of ctx.inLayers) {
        const m = ctx.toLayer(el)
        if (o.kind === 'circle') {
          const c = m.transformPoint(new DOMPoint(o.cx, o.cy))
          el.style.clipPath = `circle(${n(o.r * scaleOf(m))}px at ${n(c.x)}px ${n(c.y)}px)`
        } else el.style.clipPath = empty ? 'circle(0px at 0px 0px)' : `path('${quadPath(mapQuads(m, o.quads))}')`
      }
      const above = ctx.outLayers.filter((el) => ctx.inLayers.some((l) => (l.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0))
      for (const el of above) {
        if (empty) {
          el.style.clipPath = ''
          continue
        }
        const m = ctx.toLayer(el)
        let hole: string
        if (o.kind === 'circle') {
          const c = m.transformPoint(new DOMPoint(o.cx, o.cy))
          const r = o.r * scaleOf(m)
          hole = `M${n(c.x - r)} ${n(c.y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`
        } else hole = quadPath(mapQuads(m, o.quads))
        el.style.clipPath = `path(evenodd, '${quadPath(mapQuads(m, [outer]))}${hole}')`
      }
    }
    const setEdges = (qs: Quad[]) => edges.setAttribute('d', qs.length ? quadPath(qs) : 'M0 0')

    if (p.shape === 'circle') {
      // Farthest corner of the frame + bleed from the origin.
      const far = Math.max(...[-B, W + B].flatMap((x) => [-B, H + B].map((y) => Math.hypot(x - cx, y - cy))))
      const full = far * REVEAL.circleOver
      return {
        bothVisible: true,
        twoWorlds: true,
        update(pr) {
          const e = easeInExpo(clamp01(pr))
          const r = full * e
          clip({ kind: 'circle', cx, cy, r })
          const w = lerp(REVEAL.ring.from, REVEAL.ring.to, e)
          ring.style.display = p.ring && pr < 1 ? '' : 'none'
          ring.setAttribute('cx', n(cx))
          ring.setAttribute('cy', n(cy))
          ring.setAttribute('r', n(r + w / 2))
          ring.style.strokeWidth = n(w)
          setEdges([])
        },
      }
    }

    if (p.shape === 'bands') {
      const { count, stagger, sec, edge } = REVEAL.bands
      const bh = H / count
      const order = Array.from({ length: count }, (_, k) => Math.abs(k + 0.5 - cy / bh))
      const nominal = Math.max(...order) * stagger + sec
      // The prototype's schedule (seconds), scaled so the last band lands exactly at p = 1.
      const f = ctx.duration / nominal
      const x0 = -B
      const x1 = W + B
      return {
        bothVisible: true,
        twoWorlds: true,
        update(pr) {
          const t = clamp01(pr) * ctx.duration
          const open: Quad[] = []
          const lead: Quad[] = []
          for (let k = 0; k < count; k++) {
            const e = easeInOutExpo(seg(t, order[k]! * stagger * f, (order[k]! * stagger + sec) * f))
            if (e <= 0) continue
            const ya = k === 0 ? -B : k * bh
            const yb = k === count - 1 ? H + B : (k + 1) * bh
            const x = x1 - (x1 - x0) * e
            open.push([{ x, y: ya }, { x: x1, y: ya }, { x: x1, y: yb }, { x, y: yb }])
            if (e < 1) lead.push([{ x: x - edge, y: ya }, { x, y: ya }, { x, y: yb }, { x: x - edge, y: yb }])
          }
          clip({ kind: 'quads', quads: open })
          ring.style.display = 'none'
          setEdges(lead)
        },
      }
    }

    // panel: the edge runs from (xe + s, 0) to (xe − s, H); x(y) on that line, extended into the bleed.
    const s = REVEAL.panel.slant * H
    const line = REVEAL.panel.line
    const xAt = (xe: number, y: number) => xe + s - (2 * s * y) / H
    // Horizontal width of a `line`-px band along the edge (measured across the edge).
    const dx = (line * Math.hypot(H, 2 * s)) / H
    // Far enough that the edge and its line are outside the bled frame at both ends.
    const over = B + s * (1 + (2 * B) / H) + dx + 2
    return {
      bothVisible: true,
      twoWorlds: true,
      update(pr) {
        const e = easeInOutExpo(clamp01(pr))
        const xe = lerp(W + over, -over, e)
        const top = xAt(xe, -B)
        const bot = xAt(xe, H + B)
        clip({ kind: 'quads', quads: e > 0 ? [[{ x: top, y: -B }, { x: W + B, y: -B }, { x: W + B, y: H + B }, { x: bot, y: H + B }]] : [] })
        ring.style.display = 'none'
        setEdges(
          e > 0 && e < 1
            ? [[{ x: top - dx, y: -B }, { x: top, y: -B }, { x: bot, y: H + B }, { x: bot - dx, y: H + B }]]
            : [],
        )
      },
    }
  },
}
