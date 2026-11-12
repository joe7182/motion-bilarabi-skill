import { easeInOutCubic, easeOutCubic, seg } from '../../core/ease'
import { bento, evenGrid, gooMergeParams, MERGE_FX as M, photoGridParams, type GooMergeParams, type PhotoGridParams } from '../../core/params/merge-fx'
import { spring } from '../../core/params/ui-morph'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

const f2 = (n: number) => n.toFixed(2)
const f4 = (n: number) => n.toFixed(4)
const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const SVG = 'http://www.w3.org/2000/svg'
function div(parent: HTMLElement, style: Partial<CSSStyleDeclaration> = {}): HTMLElement {
  const el = document.createElement('div')
  Object.assign(el.style, style)
  parent.append(el)
  return el
}

/**
 * goo-merge: the drops are plain circles inside a layer with a "goo" filter (a blur, then a hard
 * alpha threshold), so wherever two come close they bridge and fuse like liquid. The labels and the
 * result's text are outside the filter and stay sharp.
 */
export const gooMerge: Primitive<GooMergeParams> = {
  id: 'goo-merge',
  params: gooMergeParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const colour = ctx.look.vars[p.colour]
    const n = p.from.length
    const W = p.width * s.w
    const R = Math.min(78 * k, (W / n) * 0.36)
    const cy = s.y + p.y * s.h
    const x0 = s.x + (s.w - W) / 2
    const id = `mba-goo-${Math.round(ctx.rng() * 1e9)}`
    const svg = document.createElementNS(SVG, 'svg')
    Object.assign(svg.style, { position: 'absolute', width: '0', height: '0' })
    const blur = R * 0.42
    svg.innerHTML = `<filter id="${id}" x="-20%" y="-60%" width="140%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="${f2(blur)}"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10"/></filter>`
    ctx.layer.append(svg)
    const goo = div(ctx.layer, { position: 'absolute', inset: '0', filter: `url(#${id})` })
    const xs = p.from.map((_, i) => x0 + ((i + 0.5) * W) / n)
    const order = ctx.dir === 'rtl' ? [...xs].reverse() : xs
    const drops = order.map((x) => div(goo, { position: 'absolute', left: `${f2(-R)}px`, top: `${f2(cy - R)}px`, width: `${f2(2 * R)}px`, height: `${f2(2 * R)}px`, borderRadius: '50%', background: colour, transform: `translateX(${f2(x)}px)` }))
    const pill = div(goo, { position: 'absolute', top: `${f2(cy - R)}px`, height: `${f2(2 * R)}px`, borderRadius: `${f2(R)}px`, background: colour })
    const labels = p.from.map((text, i) => {
      const el = div(ctx.layer, { position: 'absolute', left: `${f2(order[i]!)}px`, top: `${f2(cy + R + 22 * k)}px`, transform: 'translateX(-50%)', fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: `${f2(34 * k)}px`, lineHeight: '1.4', color: ctx.look.vars.fg, whiteSpace: 'nowrap' })
      lineUnit(el, text)
      return el
    })
    const result = div(ctx.layer, { position: 'absolute', left: `${f2(s.x + s.w / 2)}px`, top: `${f2(cy)}px`, transform: 'translate(-50%, -50%)', fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), fontSize: `${f2(Math.min(R * 0.95, 76 * k))}px`, lineHeight: '1.3', color: p.colour === 'accent' ? '#ffffff' : ctx.look.vars.bg, whiteSpace: 'nowrap' })
    lineUnit(result, p.to)
    const pillW = Math.min(W, result.offsetWidth + R * 1.6)
    const cx = s.x + s.w / 2
    return {
      update(localT) {
        const t = Math.max(0, localT)
        // drops pop in one after another, wobble a little, then flow to the centre
        const m = easeInOutCubic(seg(t, p.at, p.at + p.dur * 0.7))
        drops.forEach((d, i) => {
          const inn = spring((t - 0.08 - i * 0.09) * 2.2, 0.55, 9)
          const bob = Math.sin(t * 2.2 + i * 1.3) * 6 * k * (1 - m)
          const x = lerp(order[i]!, cx, m)
          d.style.transform = `translate(${f2(x)}px, ${f2(bob)}px) scale(${f4(Math.max(0, inn) * (1 - 0.25 * m))})`
          labels[i]!.style.opacity = f4(seg(t, 0.25 + i * 0.09, 0.55 + i * 0.09) * (1 - seg(t, p.at, p.at + p.dur * 0.35)))
        })
        // the fused drop spreads into the pill
        const g = spring(seg(t, p.at + p.dur * 0.55, p.at + p.dur) * 1.4, 0.62, 9) * (t >= p.at + p.dur * 0.55 ? 1 : 0)
        const w = lerp(2 * R, pillW, g)
        pill.style.left = `${f2(cx - w / 2)}px`
        pill.style.width = `${f2(w)}px`
        pill.style.opacity = t >= p.at + p.dur * 0.5 ? '1' : '0'
        const r = easeOutCubic(seg(t, p.at + p.dur * 0.8, p.at + p.dur * 1.15))
        result.style.opacity = f4(r)
        result.style.transform = `translate(-50%, calc(-50% + ${f2((1 - r) * 14 * k)}px))`
      },
    }
  },
}

/** photo-grid: every photo is one tile whose box travels from the even grid to the bento on a spring; the photo always covers its tile. */
export const photoGrid: Primitive<PhotoGridParams> = {
  id: 'photo-grid',
  params: photoGridParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const W = p.width * s.w
    const H = W * p.aspect
    const root = div(ctx.layer, { position: 'absolute', left: `${f2(s.x + (s.w - W) / 2)}px`, top: `${f2(s.y + p.y * s.h - H / 2)}px`, width: `${f2(W)}px`, height: `${f2(H)}px` })
    const n = p.images.length
    const a = evenGrid(n)
    // In RTL the hero sits on the reading side (the right): the bento is laid out as written, the grid mirrored to match reading order.
    const b = bento(n, p.hero)
    const mirror = (bx: [number, number, number, number]): [number, number, number, number] => (ctx.dir === 'rtl' ? [1 - bx[0] - bx[2], bx[1], bx[2], bx[3]] : bx)
    const gap = M.gap * W
    // (No z-index: a scene's layer is not a stacking context, and a z-index here would lift the photos over later scenes. The hero is drawn last instead.)
    const tiles = p.images.map((src, i) => {
      const el = div(root, { position: 'absolute', left: '0', top: '0', borderRadius: `${f2(22 * k)}px`, backgroundImage: `url("${src}")`, backgroundSize: 'cover', backgroundPosition: '50% 30%', boxShadow: `0 ${f2(10 * k)}px ${f2(30 * k)}px rgba(0,0,0,0.16)` })
      return { el, from: mirror(a[i]!), to: b[i]! }
    })
    root.append(tiles[p.hero]!.el)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        tiles.forEach((tile, i) => {
          const inn = spring((t - i * 0.07) * 2, 0.6, 9)
          const u = spring(((t - p.at - i * M.stagger) / M.flow) * 1.25, 0.72, 8)
          const g = t >= p.at + i * M.stagger ? u : 0
          const x = lerp(tile.from[0], tile.to[0], g) * W + gap / 2
          const y = lerp(tile.from[1], tile.to[1], g) * H + gap / 2
          const w = Math.max(1, lerp(tile.from[2], tile.to[2], g) * W - gap)
          const h = Math.max(1, lerp(tile.from[3], tile.to[3], g) * H - gap)
          Object.assign(tile.el.style, { width: `${f2(w)}px`, height: `${f2(h)}px`, transform: `translate(${f2(x)}px, ${f2(y)}px) scale(${f4(0.6 + 0.4 * Math.max(0, inn))})`, opacity: f4(seg(t, i * 0.07, i * 0.07 + 0.15)) })
        })
      },
    }
  },
}

export { gooMergeParams, photoGridParams }
