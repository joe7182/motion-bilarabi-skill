import { easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import {
  decimalsOf, fmtNumber, gaugeRingParams, liveTimerParams, notifyStackParams, statBarsParams, timerText,
  type GaugeRingParams, type LiveTimerParams, type NotifyStackParams, type StatBarsParams,
} from '../../core/params/data-fx'
import { FONT_MONO } from '../looks'
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

/** notify-stack: notifications drop in from the top, newest first; older ones tuck behind. */
export const notifyStack: Primitive<NotifyStackParams> = {
  id: 'notify-stack',
  params: notifyStackParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const dark = p.theme === 'dark'
    const W = s.w * 0.94
    const box = div(ctx.layer, { position: 'absolute', left: `${f2(s.x + (s.w - W) / 2)}px`, top: `${f2(s.y + p.y * s.h)}px`, width: `${f2(W)}px`, height: '0px' })
    const cards = p.items.map((it) => {
      const c = div(box, {
        position: 'absolute', left: '0px', top: '0px', width: `${f2(W)}px`, boxSizing: 'border-box', direction: 'rtl',
        display: 'flex', gap: `${f2(22 * k)}px`, alignItems: 'flex-start', padding: `${f2(30 * k)}px ${f2(34 * k)}px`,
        borderRadius: `${f2(38 * k)}px`, background: dark ? 'rgba(34,34,38,0.92)' : 'rgba(250,250,252,0.94)',
        boxShadow: `0 ${f2(14 * k)}px ${f2(40 * k)}px rgba(0,0,0,${dark ? 0.45 : 0.16})`, transformOrigin: '50% 0%',
        color: dark ? '#f5f5f7' : '#111111', fontFamily: ctx.look.fontBody,
      })
      const icon = div(c, {
        width: `${f2(96 * k)}px`, height: `${f2(96 * k)}px`, flex: 'none', borderRadius: `${f2(22 * k)}px`, background: it.tint,
        color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${f2(50 * k)}px`,
      }, it.icon ?? [...it.app][0])
      void icon
      const col = div(c, { flex: '1', minWidth: '0' })
      const head = div(col, { display: 'flex', justifyContent: 'space-between', fontSize: `${f2(32 * k)}px`, opacity: '0.6', fontWeight: '700', marginBottom: `${f2(4 * k)}px` })
      div(head, {}, it.app)
      div(head, {}, it.time)
      div(col, { fontSize: `${f2(46 * k)}px`, fontWeight: '900', lineHeight: '1.3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, it.title)
      if (it.body) div(col, { fontSize: `${f2(38 * k)}px`, lineHeight: '1.35', opacity: '0.78', display: '-webkit-box', webkitLineClamp: '2', webkitBoxOrient: 'vertical', overflow: 'hidden' } as Partial<CSSStyleDeclaration>, it.body)
      return c
    })
    let H = 0
    const gap = 22 * k
    return {
      update(localT) {
        const t = Math.max(0, localT)
        if (!H) {
          // One height for every card (like a phone's banners), so the stack spaces evenly.
          H = Math.max(...cards.map((c) => c.offsetHeight))
          for (const c of cards) c.style.height = `${f2(H)}px`
        }
        const end = p.out === undefined ? 0 : easeInOutCubic(seg(t, p.out, p.out + 0.4))
        p.items.forEach((it, i) => {
          const c = cards[i]!
          const inn = seg(t, it.at, it.at + 0.5)
          if (inn <= 0) {
            c.style.opacity = '0'
            return
          }
          // Rank: how many later cards have landed on top of this one (smooth).
          let r = 0
          for (let j = i + 1; j < p.items.length; j++) r += easeOutCubic(seg(t, p.items[j]!.at, p.items[j]!.at + 0.45))
          const over = Math.max(0, r - (p.show - 1))
          const y = Math.min(r, p.show - 1) * (H + gap) + over * 16 * k
          const drop = 1 - Math.max(0, Math.min(1.2, easeOutBack(inn)))
          const sc = (1 - over * 0.05) * (0.94 + 0.06 * Math.min(1, easeOutCubic(inn)))
          c.style.transform = `translateY(${f2(y + drop * -(H + 60 * k) - end * (H + 200 * k))}px) scale(${f3(sc)})`
          c.style.opacity = f3(Math.min(1, inn * 3) * Math.max(0, 1 - over * 0.5) * (1 - end))
          c.style.zIndex = String(100 - Math.round(r * 2))
        })
      },
    }
  },
}

/** stat-bars: bars grow one by one (right to left) while their numbers count up; a hero bar in the accent. */
export const statBars: Primitive<StatBarsParams> = {
  id: 'stat-bars',
  params: statBarsParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const fg = ctx.look.vars.fg
    const accent = ctx.look.vars.accent
    const max = p.max ?? Math.max(...p.rows.map((r) => r.value))
    const dec = Math.max(...p.rows.map((r) => decimalsOf(r.value)))
    const W = s.w * 0.92
    const box = div(ctx.layer, { position: 'absolute', left: `${f2(s.x + (s.w - W) / 2)}px`, width: `${f2(W)}px`, top: `${f2(s.y + p.y * s.h)}px`, transform: 'translateY(-50%)', direction: 'rtl', fontFamily: ctx.look.fontDisplay, color: fg })
    const title = p.title ? div(box, { fontWeight: '900', fontSize: `${f2(72 * k)}px`, marginBottom: `${f2(44 * k)}px`, lineHeight: '1.3' }, p.title) : null
    const rows = p.rows.map((r) => {
      const row = div(box, { display: 'flex', alignItems: 'center', gap: `${f2(24 * k)}px`, margin: `${f2(26 * k)}px 0` })
      const label = div(row, { width: '28%', flex: 'none', fontWeight: '800', fontSize: `${f2(54 * k)}px`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: r.hero ? accent : fg })
      label.textContent = r.label
      const track = div(row, { flex: '1', height: `${f2(80 * k)}px`, position: 'relative', borderRadius: `${f2(14 * k)}px`, background: 'color-mix(in srgb, currentColor 8%, transparent)' })
      const bar = div(track, { position: 'absolute', right: '0px', top: '0px', bottom: '0px', width: '0%', borderRadius: `${f2(14 * k)}px`, background: r.hero ? accent : fg, opacity: r.hero ? '1' : '0.86' })
      const num = div(track, { position: 'absolute', top: '50%', fontWeight: '900', fontSize: `${f2(50 * k)}px`, whiteSpace: 'nowrap', color: r.hero ? accent : fg })
      return { row, label, bar, num }
    })
    return {
      update(localT) {
        const t = Math.max(0, localT)
        if (title) title.style.opacity = f3(seg(t, p.at - 0.2, p.at + 0.1))
        p.rows.forEach((r, i) => {
          const a = p.at + i * p.stagger
          const g = easeOutCubic(seg(t, a, a + p.grow))
          const R = rows[i]!
          R.row.style.opacity = f3(seg(t, a - 0.1, a + 0.15))
          const frac = (r.value / max) * g
          R.bar.style.width = `${f2(frac * 100)}%`
          R.num.textContent = fmtNumber(r.value * g, dec, p.digits) + p.suffix
          // The number rides just past the bar's end (left of it, RTL), inside the bar when it is long.
          const inside = frac > 0.78
          R.num.style.right = `calc(${f2(frac * 100)}% ${inside ? '-' : '+'} ${f2(16 * k)}px)`
          R.num.style.transform = inside ? 'translate(100%, -50%)' : 'translateY(-50%)'
          if (inside) R.num.style.color = 'var(--mba-bg)'
          else R.num.style.color = r.hero ? accent : fg
        })
      },
    }
  },
}

/** gauge-ring: a ring sweeps to the value with a glowing head; the number counts in the middle. */
export const gaugeRing: Primitive<GaugeRingParams> = {
  id: 'gauge-ring',
  params: gaugeRingParams,
  build(ctx, p) {
    const { w } = ctx.size
    const k = w / 1080
    const s = ctx.safe
    const fg = ctx.look.vars.fg
    const accent = ctx.look.vars.accent
    const D = p.size * w
    const cx = w / 2
    const cy = s.y + p.y * s.h
    const sw = D * 0.075
    const R = D / 2 - sw
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${ctx.size.h}` })
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${ctx.size.h}px`, overflow: 'visible' })
    ctx.layer.append(svg)
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2
      const r1 = R + sw * 0.95
      const r2 = r1 + (i % 5 === 0 ? sw * 0.55 : sw * 0.3)
      svg.append(svgEl('line', { x1: f2(cx + Math.cos(a) * r1), y1: f2(cy + Math.sin(a) * r1), x2: f2(cx + Math.cos(a) * r2), y2: f2(cy + Math.sin(a) * r2), stroke: fg, 'stroke-opacity': i % 5 === 0 ? '0.35' : '0.18', 'stroke-width': f2(2.5 * k) }))
    }
    svg.append(svgEl('circle', { cx: f2(cx), cy: f2(cy), r: f2(R), fill: 'none', stroke: fg, 'stroke-opacity': '0.1', 'stroke-width': f2(sw) }))
    const arc = svgEl('circle', { cx: f2(cx), cy: f2(cy), r: f2(R), fill: 'none', stroke: accent, 'stroke-width': f2(sw), 'stroke-linecap': 'round', pathLength: '100', 'stroke-dasharray': '0 100', transform: `rotate(-90 ${f2(cx)} ${f2(cy)})` })
    svg.append(arc)
    const head = svgEl('circle', { r: f2(sw * 0.32), fill: '#ffffff' })
    svg.append(head)
    const num = div(ctx.layer, { position: 'absolute', left: `${f2(cx)}px`, top: `${f2(cy)}px`, transform: 'translate(-50%, -50%)', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${f2(D * 0.26)}px`, color: fg, whiteSpace: 'nowrap', direction: 'rtl', lineHeight: '1' })
    const label = p.label ? div(ctx.layer, { position: 'absolute', left: `${f2(cx)}px`, top: `${f2(cy + D / 2 + 40 * k)}px`, transform: 'translateX(-50%)', fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${f2(Math.max(48 * k, D * 0.08))}px`, color: fg, opacity: '0.85', whiteSpace: 'nowrap', direction: 'rtl' }, p.label) : null
    const dec = decimalsOf(p.value)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const g = easeInOutCubic(seg(t, p.at, p.at + p.dur))
        const v = p.from + (p.value - p.from) * g
        const appear = easeOutCubic(seg(t, p.at - 0.3, p.at + 0.1))
        svg.style.opacity = f3(appear)
        svg.style.transform = `scale(${f3(0.92 + 0.08 * appear)})`
        svg.style.transformOrigin = `${f2(cx)}px ${f2(cy)}px`
        arc.setAttribute('stroke-dasharray', `${f2(Math.max(0.01, v))} 100`)
        const a = (v / 100) * Math.PI * 2 - Math.PI / 2
        head.setAttribute('cx', f2(cx + Math.cos(a) * R))
        head.setAttribute('cy', f2(cy + Math.sin(a) * R))
        head.style.opacity = v > 0.5 ? '1' : '0'
        num.textContent = fmtNumber(v, dec, p.digits) + p.suffix
        num.style.opacity = f3(appear)
        if (label) label.style.opacity = f3(0.85 * seg(t, p.at + 0.2, p.at + 0.5))
      },
    }
  },
}

/** live-timer: a stopwatch or countdown in tabular digits, a pulsing dot, an optional progress ring. */
export const liveTimer: Primitive<LiveTimerParams> = {
  id: 'live-timer',
  params: liveTimerParams,
  build(ctx, p) {
    const { w } = ctx.size
    const k = w / 1080
    const s = ctx.safe
    const fg = ctx.look.vars.fg
    const accent = ctx.look.vars.accent
    const cx = w / 2
    const cy = s.y + p.y * s.h
    const px = p.size * k
    const latin = p.digits === 'latin'
    const box = div(ctx.layer, { position: 'absolute', left: `${f2(cx)}px`, top: `${f2(cy)}px`, transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${f2(16 * k)}px` })
    let dot: HTMLElement | null = null
    if (p.label !== undefined) {
      const lab = div(box, { display: 'flex', alignItems: 'center', gap: `${f2(14 * k)}px`, fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${f2(px * 0.24)}px`, color: fg, direction: 'rtl', letterSpacing: '0.04em' })
      dot = div(lab, { width: `${f2(px * 0.13)}px`, height: `${f2(px * 0.13)}px`, borderRadius: '50%', background: '#e8322b' })
      div(lab, {}, p.label)
    }
    const digitsEl = div(box, {
      fontFamily: latin ? FONT_MONO : ctx.look.fontDisplay, fontWeight: latin ? '400' : '900', fontSize: `${f2(px)}px`, color: fg, lineHeight: '1',
      fontVariantNumeric: 'tabular-nums', direction: 'ltr', whiteSpace: 'nowrap', letterSpacing: latin ? '-0.02em' : '0',
    })
    let arc: SVGCircleElement | null = null
    if (p.ring) {
      const D = Math.max(px * (p.format === 'mm:ss' ? 3.6 : 4.8), 0.5 * w)
      const R = D / 2
      const svg = svgEl('svg', { viewBox: `0 0 ${f2(D + 40 * k)} ${f2(D + 40 * k)}` })
      const C = D / 2 + 20 * k
      Object.assign(svg.style, { position: 'absolute', left: `${f2(cx - C)}px`, top: `${f2(cy - C)}px`, width: `${f2(2 * C)}px`, height: `${f2(2 * C)}px`, overflow: 'visible' })
      ctx.layer.insertBefore(svg, box)
      svg.append(svgEl('circle', { cx: f2(C), cy: f2(C), r: f2(R), fill: 'none', stroke: fg, 'stroke-opacity': '0.12', 'stroke-width': f2(10 * k) }))
      arc = svgEl('circle', { cx: f2(C), cy: f2(C), r: f2(R), fill: 'none', stroke: accent, 'stroke-width': f2(10 * k), 'stroke-linecap': 'round', pathLength: '100', 'stroke-dasharray': '0 100', transform: `rotate(-90 ${f2(C)} ${f2(C)})` })
      svg.append(arc)
    }
    const down = p.to < p.from
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const g = seg(t, p.at, p.at + p.dur)
        const sec = p.from + (p.to - p.from) * g
        digitsEl.textContent = timerText(down ? Math.ceil(sec - 1e-6) : sec, p.format, p.digits)
        const warn = down && p.warn > 0 && sec <= p.warn && g < 1
        digitsEl.style.color = warn || (down && g >= 1) ? accent : fg
        const beat = sec % 1
        digitsEl.style.transform = warn ? `scale(${f3(1 + 0.05 * Math.max(0, 1 - beat * 4))})` : ''
        if (dot) dot.style.opacity = f3(0.35 + 0.65 * (Math.sin(t * Math.PI * 2) > 0 ? 1 : 0.2))
        if (arc) arc.setAttribute('stroke-dasharray', `${f2(Math.max(0.01, g * 100))} 100`)
        box.style.opacity = f3(p.at < 0.25 ? 1 : seg(t, p.at - 0.25, p.at))
      },
    }
  },
}
