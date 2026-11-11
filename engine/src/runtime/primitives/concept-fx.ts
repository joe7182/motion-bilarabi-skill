import { easeInCubic, easeInOutCubic, easeOutCubic, seg } from '../../core/ease'
import { beforeAfterParams, fanCardsParams, funnelParams, type BeforeAfterParams, type FanCardsParams, type FunnelParams } from '../../core/params/concept-fx'
import { spring } from '../../core/params/ui-morph'
import type { Primitive } from './registry'

const f2 = (x: number) => x.toFixed(2)
const f3 = (x: number) => x.toFixed(3)
const NS = 'http://www.w3.org/2000/svg'
const div = (parent: HTMLElement, style: Partial<CSSStyleDeclaration>, text?: string) => {
  const d = document.createElement('div')
  Object.assign(d.style, style)
  if (text !== undefined) d.textContent = text
  parent.append(d)
  return d
}
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}
const CARD = 'color-mix(in srgb, var(--mba-fg) 7%, var(--mba-bg))'
const CURSOR = (k: number) => `<svg width="${f2(52 * k)}" height="${f2(72 * k)}" viewBox="0 0 23 32"><path d="M1 1 L1 25 L7 19.5 L11.5 30 L15.5 28 L11 18 L19 18 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`

/** before-after: two states under one divider; a hand drags it across and the after-state wins. */
export const beforeAfter: Primitive<BeforeAfterParams> = {
  id: 'before-after',
  params: beforeAfterParams,
  async build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const W = p.width * s.w
    const H = W * p.aspect
    const x0 = s.x + (s.w - W) / 2
    const y0 = s.y + p.y * s.h - H / 2
    const panel = div(ctx.layer, { position: 'absolute', left: `${f2(x0)}px`, top: `${f2(y0)}px`, width: `${f2(W)}px`, height: `${f2(H)}px`, borderRadius: `${f2(34 * k)}px`, overflow: 'hidden', boxShadow: `0 ${f2(30 * k)}px ${f2(70 * k)}px rgba(0,0,0,0.28)`, background: CARD })
    const face = async (sd: BeforeAfterParams['before'], isAfter: boolean) => {
      const layer = div(panel, { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isAfter ? 'var(--mba-accent)' : 'color-mix(in srgb, var(--mba-fg) 14%, var(--mba-bg))' })
      if (sd.image) {
        const img = document.createElement('img')
        img.src = sd.image
        Object.assign(img.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', filter: sd.filter ?? '' })
        layer.append(img)
        await img.decode().catch(() => undefined)
      } else if (sd.text) {
        div(layer, { fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${f2(W * 0.17)}px`, color: isAfter ? '#ffffff' : 'color-mix(in srgb, var(--mba-fg) 55%, transparent)', direction: 'rtl' }, sd.text)
      }
      return layer
    }
    await face(p.after, true)
    const before = await face(p.before, false)
    const chip = (text: string | undefined, left: boolean) =>
      text ? div(panel, { position: 'absolute', top: `${f2(26 * k)}px`, [left ? 'left' : 'right']: `${f2(26 * k)}px`, fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${f2(44 * k)}px`, padding: `${f2(6 * k)}px ${f2(22 * k)}px`, borderRadius: '999px', background: left ? 'rgba(0,0,0,0.6)' : 'var(--mba-accent)', color: '#fff', direction: 'rtl', zIndex: '3' }, text) : null
    const cb = chip(p.before.label, true)
    const ca = chip(p.after.label, false)
    const line = div(panel, { position: 'absolute', top: '0', bottom: '0', width: `${f2(6 * k)}px`, marginLeft: `${f2(-3 * k)}px`, background: '#ffffff', boxShadow: `0 0 ${f2(14 * k)}px rgba(0,0,0,0.4)`, zIndex: '4' })
    const handle = div(panel, { position: 'absolute', top: '50%', width: `${f2(88 * k)}px`, height: `${f2(88 * k)}px`, marginLeft: `${f2(-44 * k)}px`, marginTop: `${f2(-44 * k)}px`, borderRadius: '50%', background: '#ffffff', boxShadow: `0 ${f2(8 * k)}px ${f2(24 * k)}px rgba(0,0,0,0.35)`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: `${f2(10 * k)}px`, color: '#111', fontFamily: ctx.look.fontBody, fontWeight: '900', fontSize: `${f2(34 * k)}px`, zIndex: '5', direction: 'ltr' }, '‹ ›')
    const cursor = div(ctx.layer, { position: 'absolute', left: '0', top: '0', opacity: '0', zIndex: '6' })
    cursor.innerHTML = CURSOR(k)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const appear = easeOutCubic(seg(t, 0, 0.35))
        panel.style.opacity = f3(appear)
        panel.style.transform = `scale(${f3(0.94 + 0.06 * appear)})`
        const m = easeInOutCubic(seg(t, p.at, p.at + p.dur))
        const d = p.from + (p.to - p.from) * m
        // The before-state holds the left of the divider; the after-state comes in from the right (reading order).
        before.style.clipPath = `inset(0 ${f2((1 - d) * 100)}% 0 0)`
        line.style.left = `${f2(d * W)}px`
        handle.style.left = `${f2(d * W)}px`
        const grab = Math.sin(Math.PI * Math.min(1, seg(t, p.at - 0.08, p.at + 0.08)))
        handle.style.transform = `scale(${f3(1 - 0.08 * grab + 0.06 * (m > 0 && m < 1 ? 1 : 0))})`
        if (cb) cb.style.opacity = f3(Math.min(1, d * 5))
        if (ca) ca.style.opacity = f3(Math.min(1, (1 - d) * 5))
        // The hand: arrives on the handle, drags it, lets go.
        const hx = x0 + d * W
        const hy = y0 + H / 2
        const come = easeOutCubic(seg(t, p.at - 0.5, p.at - 0.05))
        const leave = seg(t, p.at + p.dur + 0.15, p.at + p.dur + 0.5)
        cursor.style.opacity = f3(Math.min(come, 1 - leave))
        cursor.style.transform = `translate(${f2(hx + (1 - come) * 0.2 * W + leave * 0.15 * W)}px, ${f2(hy + (1 - come) * 0.15 * H)}px)`
      },
    }
  },
}

/** fan-cards: one input card fans out into result cards, each linked by a drawn curve. */
export const fanCards: Primitive<FanCardsParams> = {
  id: 'fan-cards',
  params: fanCardsParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const s = ctx.safe
    const cx = s.x + s.w / 2
    const yIn = s.y + p.y * s.h - 0.26 * s.w
    const n = p.outputs.length
    const cols = n <= 3 ? n : n <= 4 ? 2 : n <= 6 ? 3 : 4
    const rows = Math.ceil(n / cols)
    const cw = (s.w * 0.9) / cols - 18 * k
    const ch = Math.min(cw * 0.78, 0.2 * s.w)
    const gridTop = yIn + 0.22 * s.w
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}` })
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px`, overflow: 'visible' })
    ctx.layer.append(svg)
    const input = div(ctx.layer, { position: 'absolute', left: `${f2(cx)}px`, top: `${f2(yIn)}px`, transform: 'translate(-50%, -50%)', maxWidth: `${f2(s.w * 0.86)}px`, padding: `${f2(26 * k)}px ${f2(36 * k)}px`, borderRadius: `${f2(28 * k)}px`, background: 'var(--mba-fg)', color: 'var(--mba-bg)', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${f2(50 * k)}px`, direction: 'rtl', whiteSpace: 'nowrap', boxShadow: `0 ${f2(20 * k)}px ${f2(50 * k)}px rgba(0,0,0,0.25)`, zIndex: '3' }, p.input)
    const caret = div(input, { display: 'inline-block', width: `${f2(5 * k)}px`, height: `${f2(48 * k)}px`, marginInlineStart: `${f2(10 * k)}px`, background: 'var(--mba-accent)', verticalAlign: 'middle' })
    const cards = p.outputs.map((o, i) => {
      // Right to left, top to bottom.
      const r = Math.floor(i / cols)
      const c = i % cols
      const inRow = r === rows - 1 ? n - r * cols : cols
      const rowW = inRow * (cw + 18 * k) - 18 * k
      const x = cx + rowW / 2 - c * (cw + 18 * k) - cw / 2
      const y = gridTop + r * (ch + 22 * k) + ch / 2
      const card = div(ctx.layer, { position: 'absolute', left: '0', top: '0', width: `${f2(cw)}px`, height: `${f2(ch)}px`, borderRadius: `${f2(24 * k)}px`, background: CARD, border: `${f2(2 * k)}px solid color-mix(in srgb, var(--mba-fg) 12%, transparent)`, boxShadow: `0 ${f2(14 * k)}px ${f2(34 * k)}px rgba(0,0,0,0.18)`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: `${f2(10 * k)}px`, direction: 'rtl', opacity: '0', boxSizing: 'border-box' })
      if (o.icon) div(card, { width: `${f2(ch * 0.36)}px`, height: `${f2(ch * 0.36)}px`, borderRadius: '50%', background: 'var(--mba-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${f2(ch * 0.2)}px` }, o.icon)
      div(card, { fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${f2(Math.min(ch * 0.2, cw * 0.15))}px`, color: 'var(--mba-fg)', whiteSpace: 'nowrap' }, o.title)
      const path = svgEl('path', { d: `M${f2(cx)},${f2(yIn + 40 * k)} C${f2(cx)},${f2((yIn + y) / 2)} ${f2(x)},${f2((yIn + y) / 2)} ${f2(x)},${f2(y - ch / 2)}`, fill: 'none', stroke: 'var(--mba-accent)', 'stroke-width': f2(4 * k), 'stroke-linecap': 'round', pathLength: '1', 'stroke-dasharray': '1 1', 'stroke-dashoffset': '1', opacity: '0.7' })
      svg.append(path)
      return { card, path, x, y }
    })
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const a = spring(t, 0.6, 12)
        input.style.opacity = f3(Math.min(1, a * 2))
        input.style.transform = `translate(-50%, -50%) scale(${f3(0.85 + 0.15 * Math.min(1.05, a))})`
        caret.style.opacity = Math.floor(t * 2.5) % 2 === 0 ? '1' : '0'
        cards.forEach((c, i) => {
          const st = p.at + i * p.stagger
          c.path.setAttribute('stroke-dashoffset', f3(1 - easeOutCubic(seg(t, st, st + 0.35))))
          const m = spring(t - st - 0.18, 0.55, 13)
          // Each card flies out of the input card to its slot, turning flat as it lands.
          const fx = cx + (c.x - cx) * m
          const fy = yIn + (c.y - yIn) * m
          c.card.style.opacity = f3(Math.min(1, Math.max(0, m) * 3))
          c.card.style.transform = `translate(${f2(fx - parseFloat(c.card.style.width) / 2)}px, ${f2(fy - parseFloat(c.card.style.height) / 2)}px) rotate(${f2((1 - Math.min(1, m)) * (i % 2 ? 14 : -14))}deg) scale(${f3(0.4 + 0.6 * Math.min(1.05, Math.max(0, m)))})`
        })
      },
    }
  },
}

/** funnel: many items pour in; only the chosen pass the neck and line up; the rest drop away struck. */
export const funnel: Primitive<FunnelParams> = {
  id: 'funnel',
  params: funnelParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const s = ctx.safe
    const cx = s.x + s.w / 2
    const yc = s.y + p.y * s.h
    const mouthW = 0.82 * s.w
    const neckW = 0.18 * s.w
    const yMouth = yc - 0.05 * s.w
    const yNeck = yMouth + 0.36 * s.w
    const yRow = yNeck + 0.3 * s.w
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}` })
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px`, overflow: 'visible' })
    ctx.layer.append(svg)
    const body = svgEl('path', { d: `M${f2(cx - mouthW / 2)},${f2(yMouth)} L${f2(cx - neckW / 2)},${f2(yNeck)} L${f2(cx - neckW / 2)},${f2(yNeck + 0.08 * s.w)} M${f2(cx + mouthW / 2)},${f2(yMouth)} L${f2(cx + neckW / 2)},${f2(yNeck)} L${f2(cx + neckW / 2)},${f2(yNeck + 0.08 * s.w)}`, fill: 'none', stroke: 'var(--mba-fg)', 'stroke-width': f2(9 * k), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: '1', 'stroke-dasharray': '1 1' })
    const glass = svgEl('path', { d: `M${f2(cx - mouthW / 2)},${f2(yMouth)} L${f2(cx - neckW / 2)},${f2(yNeck)} L${f2(cx + neckW / 2)},${f2(yNeck)} L${f2(cx + mouthW / 2)},${f2(yMouth)} Z`, fill: 'var(--mba-accent)', 'fill-opacity': '0.08', stroke: 'none' })
    svg.append(glass, body)
    const label = p.label ? div(ctx.layer, { position: 'absolute', left: `${f2(cx)}px`, top: `${f2((yMouth + yNeck) / 2)}px`, transform: 'translate(-50%, -50%)', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${f2(46 * k)}px`, color: 'var(--mba-accent)', direction: 'rtl', whiteSpace: 'nowrap', opacity: '0' }, p.label) : null
    const keep = p.items.filter((i) => i.keep)
    const resultLabel = p.result ? div(ctx.layer, { position: 'absolute', left: `${f2(cx)}px`, top: `${f2(yRow + 0.1 * s.w)}px`, transform: 'translateX(-50%)', fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${f2(38 * k)}px`, color: 'var(--mba-fg)', opacity: '0', direction: 'rtl', whiteSpace: 'nowrap' }, p.result) : null
    const n = p.items.length
    const chipW = 0.28 * s.w
    const items = p.items.map((it, i) => {
      const chip = div(ctx.layer, { position: 'absolute', left: '0', top: '0', padding: `${f2(12 * k)}px ${f2(26 * k)}px`, borderRadius: '999px', background: it.keep ? 'var(--mba-accent)' : CARD, color: it.keep ? '#fff' : 'var(--mba-fg)', border: it.keep ? 'none' : `${f2(2 * k)}px solid color-mix(in srgb, var(--mba-fg) 18%, transparent)`, fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${f2(40 * k)}px`, direction: 'rtl', whiteSpace: 'nowrap', opacity: '0', boxShadow: `0 ${f2(8 * k)}px ${f2(20 * k)}px rgba(0,0,0,0.15)` }, it.text)
      const strike = div(chip, { position: 'absolute', left: '-6%', right: '-6%', top: '50%', height: `${f2(6 * k)}px`, background: '#e5322b', transformOrigin: '100% 50%', transform: 'scaleX(0)' })
      // Start scattered above the mouth (seeded), in rows.
      const col = i % 3
      const row = Math.floor(i / 3)
      const sx = cx + (1 - col) * chipW * 1.05 + (ctx.rng() - 0.5) * 0.06 * s.w
      const sy = yMouth - 0.16 * s.w - row * 0.11 * s.w
      const ki = keep.indexOf(it)
      const slotX = ki >= 0 ? cx + ((keep.length - 1) / 2 - ki) * (chipW * 0.95) : 0
      const kick = ctx.rng() < 0.5 ? -1 : 1
      return { chip, strike, it, sx, sy, slotX, kick, i }
    })
    return {
      update(localT) {
        const t = Math.max(0, localT)
        body.setAttribute('stroke-dashoffset', f3(1 - easeOutCubic(seg(t, 0, 0.5))))
        if (label) label.style.opacity = f3(seg(t, 0.3, 0.6) * 0.9)
        if (resultLabel) resultLabel.style.opacity = f3(seg(t, p.at + p.dur, p.at + p.dur + 0.3))
        for (const I of items) {
          const st = p.at + (p.dur * 0.55 * I.i) / n
          const appear = seg(t, 0.1 + I.i * 0.04, 0.35 + I.i * 0.04)
          const fall = easeInCubic(seg(t, st, st + 0.35))
          const slide = easeInOutCubic(seg(t, st + 0.35, st + 0.65))
          let x = I.sx
          let y = I.sy
          let sc = 1
          let op = appear
          // Fall to the mouth, then slide down the cone to the neck, shrinking.
          y = I.sy + (yMouth + 0.02 * s.w - I.sy) * fall
          x = I.sx + (cx - I.sx) * 0.25 * fall
          if (slide > 0) {
            x = x + (cx - x) * slide
            y = y + (yNeck - y) * slide
            sc = 1 - 0.35 * slide
          }
          const out = seg(t, st + 0.65, st + 1.05)
          if (out > 0) {
            if (I.it.keep) {
              const m = spring(t - st - 0.65, 0.6, 13)
              x = cx + (I.slotX - cx) * m
              y = yNeck + (yRow - yNeck) * Math.min(1, m)
              sc = 0.65 + 0.35 * Math.min(1, m)
            } else {
              // Stuck at the neck: struck, then thrown out sideways and dropped.
              I.strike.style.transform = `scaleX(${f3(easeOutCubic(seg(t, st + 0.6, st + 0.8)))})`
              const th = seg(t, st + 0.8, st + 1.35)
              x = cx + I.kick * th * 0.42 * s.w
              y = yNeck - 0.06 * s.w * Math.sin(Math.PI * th) + th * th * 0.45 * s.w
              op = 1 - th
              sc = 0.65
            }
          }
          I.chip.style.opacity = f3(Math.max(0, op))
          I.chip.style.transform = `translate(${f2(x)}px, ${f2(y)}px) translate(-50%, -50%) scale(${f3(sc)}) rotate(${f2(I.it.keep ? 0 : out * I.kick * 35)}deg)`
        }
      },
    }
  },
}
