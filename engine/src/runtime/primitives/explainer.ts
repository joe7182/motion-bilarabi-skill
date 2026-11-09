import { clamp01, easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import {
  CRAWL, TIMELINE, codeChatParams, contextWindowParams, knowledgeTimelineParams, misquoteParams, signatureCardParams, webCrawlParams,
  type CodeChatParams, type ContextWindowParams, type KnowledgeTimelineParams, type MisquoteParams, type SignatureCardParams, type WebCrawlParams,
} from '../../core/params/explainer'
import { lineUnit, wordUnits } from '../text/units'
import { FONT_MONO as FONT_MONO_CC } from '../looks'
import type { Primitive } from './registry'

const SVG = 'http://www.w3.org/2000/svg'
const f4 = (x: number) => x.toFixed(3)
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}
const div = (part: string, style: Partial<CSSStyleDeclaration> = {}) => {
  const d = document.createElement('div')
  d.dataset.mbaPart = part
  Object.assign(d.style, style)
  return d
}

/**
 * knowledge-timeline: a time line read right → left. Data blocks drop onto it up to the cutoff,
 * the cutoff flag drops, the stretch after it fogs over news cards marked «؟»; with `bridgeAt`, a
 * search bridge arcs from the cutoff over the fog to «اليوم», a page rides back along it, and the
 * news clears. Pure in `localT`.
 */
export const knowledgeTimeline: Primitive<KnowledgeTimelineParams> = {
  id: 'knowledge-timeline',
  params: knowledgeTimelineParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const s = ctx.safe
    const xR = s.x + s.w * 0.95
    const xL = s.x + s.w * 0.05
    const X = (f: number) => xR - f * (xR - xL)
    const yLine = s.y + p.y * s.h
    const xCut = X(p.cut)
    const fg = ctx.look.vars.fg
    const accent = ctx.look.vars.accent
    const root = div('knowledge-timeline', { position: 'absolute', inset: '0', pointerEvents: 'none' })
    ctx.layer.append(root)
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}` })
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible' })
    root.append(svg)
    const sw = Math.max(4, 8 * k)

    // Fog (behind everything after the cutoff): a hatched band, faded in at fogAt.
    const defs = svgEl('defs')
    const pid = `kt-hatch-${ctx.rng().toString(36).slice(2, 8)}`
    const pat = svgEl('pattern', { id: pid, width: String(18 * k), height: String(18 * k), patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(35)' })
    const hatch = svgEl('rect', { width: String(6 * k), height: String(18 * k) })
    hatch.style.fill = fg
    pat.append(hatch)
    defs.append(pat)
    svg.append(defs)
    const fogH = 0.5 * s.h
    const fog = svgEl('rect', { x: f4(xL - 20 * k), y: f4(yLine - fogH * 0.92), width: f4(xCut - xL + 20 * k), height: f4(fogH), rx: String(28 * k), fill: `url(#${pid})` })
    svg.append(fog)

    // The line: the known past (solid) and the unknown after the cutoff (dashed).
    const past = svgEl('line', { x1: f4(xR), y1: f4(yLine), y2: f4(yLine), 'stroke-linecap': 'round' })
    past.style.stroke = fg
    past.setAttribute('stroke-width', f4(sw))
    const future = svgEl('line', { x1: f4(xCut), y1: f4(yLine), y2: f4(yLine), 'stroke-dasharray': `${f4(10 * k)} ${f4(12 * k)}`, 'stroke-linecap': 'round' })
    future.style.stroke = fg
    future.setAttribute('stroke-width', f4(sw * 0.6))
    svg.append(past, future)

    // Tick labels under the line.
    const tickFs = Math.round(44 * k)
    const ticks = p.ticks.map((label, i) => {
      const f = p.ticks.length === 1 ? 0 : i / (p.ticks.length - 1)
      const t = div('kt-tick', { position: 'absolute', left: `${X(f)}px`, top: `${yLine + 30 * k}px`, transform: 'translateX(-50%)', fontFamily: ctx.look.fontBody, fontWeight: '800', fontSize: `${tickFs}px`, color: fg, whiteSpace: 'nowrap' })
      lineUnit(t, label)
      const mark = svgEl('line', { x1: f4(X(f)), x2: f4(X(f)), y1: f4(yLine - 10 * k), y2: f4(yLine + 10 * k) })
      mark.style.stroke = fg
      mark.setAttribute('stroke-width', f4(sw * 0.6))
      svg.append(mark)
      root.append(t)
      return { t, mark, f }
    })

    // Data blocks: seeded positions before the cutoff, stacked a few high.
    const blockW = 38 * k
    const blocks = Array.from({ length: 150 }, () => {
      const f = ctx.rng() * p.cut * 0.97
      const level = Math.floor(ctx.rng() ** 1.4 * 11)
      const r = svgEl('rect', { width: f4(blockW), height: f4(blockW), rx: f4(4 * k) })
      r.style.fill = ctx.rng() < 0.18 ? accent : fg
      svg.append(r)
      return { r, f, level, j: ctx.rng() }
    })

    // News cards in the fog.
    const cards = p.news.map((label, i) => {
      const f = p.cut + ((i + 0.6) / (p.news.length + 0.4)) * (1 - p.cut)
      const card = div('kt-news', { position: 'absolute', left: `${X(f)}px`, top: `${yLine - fogH * (0.2 + 0.26 * i)}px`, transform: 'translate(-50%, -50%)', background: ctx.look.vars.bg, color: fg, border: `${Math.max(2, 3 * k)}px solid ${fg}`, borderRadius: `${14 * k}px`, padding: `${10 * k}px ${16 * k}px`, fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${Math.round(42 * k)}px`, whiteSpace: 'nowrap', textAlign: 'center', boxShadow: '0 10px 26px #0002' })
      lineUnit(card, label)
      const q = div('kt-q', { position: 'absolute', left: '50%', top: '-0.9em', transform: 'translateX(-50%)', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(72 * k)}px`, color: accent })
      lineUnit(q, '؟')
      card.append(q)
      root.append(card)
      return { card, q, f }
    })

    // The cutoff flag.
    const flagH = 0.36 * s.h
    const pole = svgEl('line', { x1: f4(xCut), x2: f4(xCut), y2: f4(yLine + 14 * k), 'stroke-linecap': 'round' })
    pole.style.stroke = accent
    pole.setAttribute('stroke-width', f4(sw * 1.2))
    svg.append(pole)
    const flag = div('kt-flag', { position: 'absolute', left: `${xCut}px`, top: `${yLine - flagH}px`, transform: 'translate(-50%, -100%)', background: accent, color: '#fff', borderRadius: `${12 * k}px`, padding: `${14 * k}px ${28 * k}px`, fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(58 * k)}px`, whiteSpace: 'nowrap', boxShadow: '0 12px 30px #0003' })
    lineUnit(flag, p.cutLabel)
    root.append(flag)

    // Today marker.
    const today = div('kt-today', { position: 'absolute', left: `${xL}px`, top: `${yLine + 26 * k}px`, transform: 'translateX(-50%)', background: fg, color: ctx.look.vars.bg, borderRadius: '999px', padding: `${4 * k}px ${16 * k}px`, fontFamily: ctx.look.fontBody, fontWeight: '800', fontSize: `${tickFs}px`, whiteSpace: 'nowrap' })
    lineUnit(today, p.todayLabel)
    root.append(today)
    const pulse = svgEl('circle', { cx: f4(xL), cy: f4(yLine), r: f4(14 * k) })
    pulse.style.fill = accent
    svg.append(pulse)

    // The search bridge: an arc from the cutoff over the fog to today, a lens riding it, a page back.
    const arcTop = yLine - fogH * 0.86
    const arcD = `M ${f4(xCut)} ${f4(yLine - flagH * 0.2)} C ${f4(xCut)} ${f4(arcTop)}, ${f4(xL)} ${f4(arcTop)}, ${f4(xL)} ${f4(yLine - 12 * k)}`
    const arc = svgEl('path', { d: arcD, fill: 'none', 'stroke-linecap': 'round' })
    arc.style.stroke = accent
    arc.setAttribute('stroke-width', f4(sw))
    svg.append(arc)
    const arcLen = () => (arc as SVGPathElement).getTotalLength()
    const lens = div('kt-lens', { position: 'absolute', left: '0', top: '0', width: `${84 * k}px`, height: `${84 * k}px`, borderRadius: '50%', border: `${9 * k}px solid ${accent}`, background: ctx.look.vars.bg, boxSizing: 'border-box' })
    const page = div('kt-page', { position: 'absolute', left: '0', top: '0', width: `${96 * k}px`, height: `${122 * k}px`, background: '#fff', borderRadius: `${8 * k}px`, boxShadow: '0 8px 20px #0004', border: `${3 * k}px solid ${accent}` })
    const bridgeTag = div('kt-bridge', { position: 'absolute', left: `${xL + (xCut - xL) * 0.42}px`, top: `${arcTop + 4 * k}px`, transform: 'translate(-50%, -100%)', color: accent, fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(60 * k)}px`, whiteSpace: 'nowrap' })
    lineUnit(bridgeTag, p.bridgeLabel)
    root.append(lens, page, bridgeTag)

    return {
      update(localT) {
        const t = Math.max(0, localT)
        // Line and ticks draw with the fill.
        const fill = seg(t, p.fillAt, p.fillAt + p.fillDur)
        const lineF = easeInOutCubic(clamp01(fill * 1.15)) * p.cut
        past.setAttribute('x2', f4(X(lineF)))
        for (const tk of ticks) {
          const on = tk.f <= lineF + 0.02 || t >= p.cutAt
          tk.t.style.opacity = on ? (tk.f > p.cut ? '0.45' : '1') : '0'
          tk.mark.style.opacity = tk.t.style.opacity
        }
        for (const b of blocks) {
          const start = p.fillAt + (b.f / p.cut) * p.fillDur * 0.85 + b.j * 0.12
          const d = seg(t, start, start + 0.32)
          const show = d > 0
          b.r.style.display = show ? '' : 'none'
          if (!show) continue
          const y = yLine - sw - (b.level + 1) * (blockW + 4 * k) - (1 - easeOutBack(d, 1.2)) * 140 * k
          b.r.setAttribute('x', f4(X(b.f) - blockW / 2))
          b.r.setAttribute('y', f4(y))
          b.r.style.opacity = f4(Math.min(1, d * 3))
        }
        // Cutoff.
        const cd = seg(t, p.cutAt, p.cutAt + TIMELINE.cutDrop)
        const cut = cd > 0 ? easeOutBack(cd, 1.6) : 0
        pole.setAttribute('y1', f4(yLine - flagH * cut))
        pole.style.opacity = cd > 0 ? '1' : '0'
        flag.style.opacity = cd > 0 ? '1' : '0'
        flag.style.transform = `translate(-50%, calc(-100% + ${f4((1 - cut) * flagH)}px)) scale(${f4(0.7 + 0.3 * Math.min(1, cd * 2))})`
        future.setAttribute('x2', f4(xCut - (xCut - xL) * easeOutCubic(seg(t, p.cutAt, p.cutAt + 0.6))))
        future.style.opacity = t >= p.cutAt ? '0.6' : '0'
        today.style.opacity = f4(seg(t, p.cutAt + 0.3, p.cutAt + 0.6))
        pulse.style.opacity = today.style.opacity
        pulse.setAttribute('r', f4(14 * k * (1 + 0.35 * Math.abs(Math.sin(t * 3)))))
        // Fog.
        const fg2 = easeOutCubic(seg(t, p.fogAt, p.fogAt + TIMELINE.fog))
        // The bridge clears the fog as the page comes home.
        const b0 = p.bridgeAt
        const bridge = b0 === undefined ? 0 : seg(t, b0, b0 + TIMELINE.bridge)
        const fetch = b0 === undefined ? 0 : seg(t, b0 + TIMELINE.bridge, b0 + TIMELINE.bridge + TIMELINE.fetch)
        const clear = easeOutCubic(fetch)
        fog.style.opacity = f4(fg2 * 0.16 * (1 - clear))
        cards.forEach((c, i) => {
          const ci = seg(t, p.fogAt + 0.1 + i * 0.12, p.fogAt + 0.45 + i * 0.12)
          c.card.style.opacity = f4(ci * (1 - 0.45 * fg2 * (1 - clear)))
          c.card.style.filter = fg2 * (1 - clear) > 0.01 ? `blur(${f4(4 * k * fg2 * (1 - clear))}px)` : ''
          c.card.style.transform = `translate(-50%, -50%) scale(${f4(0.8 + 0.2 * easeOutBack(ci))})`
          c.q.style.opacity = f4(1 - clear)
          c.card.style.borderColor = clear > 0.5 ? accent : ''
        })
        // Bridge.
        const L = b0 === undefined ? 0 : arcLen()
        arc.setAttribute('stroke-dasharray', `${f4(L)} ${f4(L)}`)
        arc.setAttribute('stroke-dashoffset', f4(L * (1 - easeInOutCubic(bridge))))
        arc.style.opacity = bridge > 0 ? '1' : '0'
        bridgeTag.style.opacity = f4(seg(t, (b0 ?? 0) + 0.2, (b0 ?? 0) + 0.5) * (bridge > 0 ? 1 : 0))
        const ride = (u: number, el: HTMLElement, wpx: number, hpx: number) => {
          const pt = (arc as SVGPathElement).getPointAtLength(L * u)
          el.style.transform = `translate(${f4(pt.x - wpx / 2)}px, ${f4(pt.y - hpx / 2)}px)`
        }
        lens.style.display = bridge > 0 && fetch === 0 ? '' : 'none'
        if (bridge > 0 && fetch === 0) ride(easeInOutCubic(bridge), lens, 84 * k, 84 * k)
        page.style.display = fetch > 0 && fetch < 1 ? '' : 'none'
        if (fetch > 0 && fetch < 1) ride(1 - easeInOutCubic(fetch), page, 96 * k, 122 * k)
      },
    }
  },
}

/** The master card's palette (brand/signature-card.html), used when neither the scene nor brand.json gives colours. */
const SIG = { bg: '#F3EFE6', ink: '#16140F', acc: '#C2412A' } as const
const MONO = "'JetBrains Mono', monospace"
const ICONS = {
  ig: (c: string) => `<svg width="38" height="38" viewBox="0 0 36 36"><rect x="3" y="3" width="30" height="30" rx="9" fill="none" stroke="${c}" stroke-width="3.5"/><circle cx="18" cy="18" r="7" fill="none" stroke="${c}" stroke-width="3.5"/><circle cx="27" cy="9" r="2.2" fill="${c}"/></svg>`,
  yt: (c: string, ink: string) => `<svg width="42" height="32" viewBox="0 0 40 30"><rect x="1" y="1" width="38" height="28" rx="8" fill="${c}"/><path d="M16 9 L26 15 L16 21 Z" fill="${ink}"/></svg>`,
  tt: (c: string) => `<svg width="34" height="38" viewBox="0 0 32 36"><path d="M18 2 V24 A7 7 0 1 1 11 17" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/><path d="M18 2 Q20 10 29 11" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>`,
  web: () => '<svg width="38" height="38" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="#fff" stroke-width="3.5"/><path d="M3 18 H33 M18 3 C 10 12, 10 24, 18 33 M18 3 C 26 12, 26 24, 18 33" fill="none" stroke="#fff" stroke-width="3"/></svg>',
} as const
const PLATFORMS = [
  { key: 'instagram', ic: 'ig', pl: 'Instagram', host: 'instagram.com/', keepAt: false },
  { key: 'youtube', ic: 'yt', pl: 'YouTube', host: 'youtube.com/', keepAt: true },
  { key: 'tiktok', ic: 'tt', pl: 'TikTok', host: 'tiktok.com/', keepAt: true },
  { key: 'site', ic: 'web', pl: 'Website', host: '', keepAt: false },
] as const

/**
 * How a link shows: a handle (`@name`) becomes `host/` + the handle in the accent colour (Instagram
 * drops the @, as its addresses do); a full address keeps its host and accents its last part.
 */
export function linkParts(platform: (typeof PLATFORMS)[number], value: string): { base: string; bold: string } {
  const v = value.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
  if (platform.key === 'site') return { base: '', bold: v }
  if (v.startsWith('@')) return { base: platform.host, bold: platform.keepAt ? v : v.slice(1) }
  const cut = v.lastIndexOf('/')
  return cut >= 0 ? { base: v.slice(0, cut + 1), bold: v.slice(cut + 1) } : { base: platform.host, bold: v }
}

/** signature-card: the creator's closing card, vertical, following the master card; details from brand.json. */
export const signatureCard: Primitive<SignatureCardParams> = {
  id: 'signature-card',
  params: signatureCardParams,
  build(ctx, p) {
    const { w } = ctx.size
    const k = w / 1080
    const C = p.colors ? { bg: p.colors.bg, ink: p.colors.ink, acc: p.colors.accent } : SIG
    const soft = `color-mix(in srgb, ${C.ink} 55%, ${C.bg})`
    const root = div('signature-card', { position: 'absolute', inset: '0', background: C.bg, color: C.ink, fontFamily: ctx.look.fontDisplay, direction: 'rtl', overflow: 'hidden' })
    ctx.layer.append(root)
    const cx = w / 2
    const top = ctx.safe.y + 0.1 * ctx.safe.h
    const R = 170 * k
    const ring = div('sig-ring', { position: 'absolute', left: `${cx - R}px`, top: `${top}px`, width: `${2 * R}px`, height: `${2 * R}px`, borderRadius: '50%', border: `${7 * k}px solid ${C.acc}`, boxSizing: 'border-box' })
    const photo = div('sig-photo', { position: 'absolute', left: `${cx - R + 20 * k}px`, top: `${top + 20 * k}px`, width: `${2 * R - 40 * k}px`, height: `${2 * R - 40 * k}px`, borderRadius: '50%', overflow: 'hidden', background: C.ink, display: 'grid', placeItems: 'center' })
    if (p.photo) {
      const img = document.createElement('img')
      img.src = p.photo
      img.alt = ''
      Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 28%', display: 'block' })
      photo.append(img)
    } else {
      // No photo: the name's first letter.
      const initial = div('sig-initial', { color: C.bg, fontWeight: '900', fontSize: `${Math.round(150 * k)}px` })
      lineUnit(initial, [...p.name.trim()][0] ?? '•')
      photo.append(initial)
    }
    const y0 = top + 2 * R + 40 * k
    const name = div('sig-name', { position: 'absolute', left: '0', right: '0', top: `${y0}px`, textAlign: 'center', fontSize: `${Math.round(96 * k)}px`, fontWeight: '900', lineHeight: '1.3' })
    lineUnit(name, p.name)
    const en = div('sig-en', { position: 'absolute', left: '0', right: '0', top: `${y0 + 140 * k}px`, textAlign: 'center', fontFamily: MONO, fontSize: `${Math.round(32 * k)}px`, fontWeight: '700', letterSpacing: '.18em', color: soft, direction: 'ltr' })
    en.textContent = (p.en ?? '').toUpperCase()
    const line = div('sig-line', { position: 'absolute', left: '0', right: '0', top: `${y0 + 200 * k}px`, textAlign: 'center', fontSize: `${Math.round(46 * k)}px`, fontWeight: '700', whiteSpace: 'nowrap' })
    if (p.line) lineUnit(line, p.line)
    if (p.lineAccent) {
      if (p.line) line.append(document.createTextNode(' '))
      const acc = document.createElement('span')
      acc.style.color = C.acc
      lineUnit(acc, p.lineAccent)
      line.append(acc)
    }
    const hasLine = Boolean(p.line || p.lineAccent)
    const ruleY = y0 + (hasLine ? 300 : 210) * k
    const rule = div('sig-rule', { position: 'absolute', left: `${w * 0.14}px`, width: `${w * 0.72}px`, top: `${ruleY}px`, height: `${2 * k}px`, background: `color-mix(in srgb, ${C.ink} 18%, ${C.bg})` })
    root.append(ring, photo, name, en, line, rule)
    const links = p.links as Partial<Record<(typeof PLATFORMS)[number]['key'], string>>
    const rows = PLATFORMS.filter((pf) => links[pf.key]).map((pf, i) => {
      const { base, bold } = linkParts(pf, links[pf.key]!)
      const cell = div('sig-cell', { position: 'absolute', left: `${w * 0.17}px`, top: `${ruleY + 50 * k + i * 128 * k}px`, height: `${104 * k}px`, display: 'flex', alignItems: 'center', gap: `${24 * k}px`, direction: 'ltr' })
      const icon = div('sig-ic', { width: `${84 * k}px`, height: `${84 * k}px`, borderRadius: `${22 * k}px`, background: pf.key === 'site' ? C.acc : C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' })
      icon.innerHTML = ICONS[pf.ic](C.bg, C.ink)
      const tx = div('sig-tx', { display: 'flex', flexDirection: 'column', lineHeight: '1.25' })
      const pl = document.createElement('span')
      pl.textContent = pf.pl
      Object.assign(pl.style, { fontSize: `${Math.round(30 * k)}px`, fontWeight: '700', color: soft })
      const url = document.createElement('span')
      Object.assign(url.style, { fontFamily: MONO, fontSize: `${Math.round(36 * k)}px`, fontWeight: '700', whiteSpace: 'nowrap' })
      url.append(document.createTextNode(base))
      const b = document.createElement('b')
      b.textContent = bold
      b.style.color = C.acc
      url.append(b)
      tx.append(pl, url)
      cell.append(icon, tx)
      root.append(cell)
      return cell
    })
    const fade = (el: HTMLElement, t: number, a: number, d: number, blur: number) => {
      const e = easeOutCubic(seg(t, a, a + d))
      el.style.opacity = f4(e)
      el.style.filter = e < 1 ? `blur(${f4(blur * (1 - e))}px)` : ''
    }
    return {
      update(localT) {
        const t = Math.max(0, localT)
        // The master card's timing.
        const ph = seg(t, 0, 0.7)
        photo.style.opacity = f4(Math.min(1, ph * 2))
        photo.style.transform = `scale(${f4(0.8 + 0.2 * easeOutBack(ph, 1.5))})`
        const rg = seg(t, 0.15, 0.95)
        ring.style.opacity = f4(Math.min(1, rg * 2))
        ring.style.transform = `scale(${f4(0.9 + 0.1 * easeOutCubic(rg))}) rotate(${f4(-90 * (1 - easeOutCubic(rg)))}deg)`
        fade(name, t, 0.3, 0.3, 8)
        fade(en, t, 0.55, 0.3, 6)
        fade(line, t, 1.4, 0.3, 6)
        rule.style.transform = `scaleX(${f4(easeInOutCubic(seg(t, 1.1, 1.7)))})`
        rows.forEach((r, i) => {
          const e = easeOutCubic(seg(t, 1.8 + i * 0.18, 2.4 + i * 0.18))
          r.style.opacity = f4(e)
          r.style.transform = `translateY(${f4((1 - e) * 24 * k)}px)`
        })
      },
    }
  },
}

/** Search-page colours: a white page, link blue titles, quiet greys (a generic search look, no brand). */
const WEB = { page: '#ffffff', ink: '#1f1f1f', link: '#1a3fbf', url: '#4d5156', line: '#dfe1e5', soft: '#f1f3f4', ad: '#ffe9a8', warn: '#d93025' } as const

/** A browser frame: address bar (lock or «غير آمن») + body. Returns the frame and its body. */
function browserFrame(k: number, url: string, secure: boolean) {
  const frame = div('browser', { position: 'absolute', background: WEB.page, borderRadius: `${22 * k}px`, boxShadow: '0 24px 60px #0003', overflow: 'hidden', border: `${2 * k}px solid ${WEB.line}` })
  const bar = div('browser-bar', { height: `${76 * k}px`, background: WEB.soft, display: 'flex', alignItems: 'center', gap: `${14 * k}px`, padding: `0 ${22 * k}px`, direction: 'ltr' })
  for (const c of ['#ff5f57', '#febc2e', '#28c840']) bar.append(div('dot', { width: `${16 * k}px`, height: `${16 * k}px`, borderRadius: '50%', background: c, flex: 'none' }))
  const addr = div('addr', { flex: '1', height: `${46 * k}px`, borderRadius: '999px', background: WEB.page, display: 'flex', alignItems: 'center', gap: `${10 * k}px`, padding: `0 ${18 * k}px`, fontFamily: "'JetBrains Mono', monospace", fontSize: `${Math.round(24 * k)}px`, color: WEB.url, whiteSpace: 'nowrap', overflow: 'hidden' })
  const lock = document.createElementNS(SVG, 'svg')
  lock.setAttribute('viewBox', '0 0 20 20')
  lock.setAttribute('width', String(Math.round(24 * k)))
  lock.setAttribute('height', String(Math.round(24 * k)))
  lock.innerHTML = secure
    ? '<rect x="4" y="9" width="12" height="9" rx="2" fill="#5f6368"/><path d="M7 9 V6 a3 3 0 0 1 6 0 V9" fill="none" stroke="#5f6368" stroke-width="2"/>'
    : '<path d="M10 2 L19 18 H1 Z" fill="#d93025"/><rect x="9.1" y="7" width="1.8" height="6" fill="#fff"/><rect x="9.1" y="14.3" width="1.8" height="1.8" fill="#fff"/>'
  const u = document.createElement('span')
  u.textContent = url
  addr.append(lock, u)
  bar.append(addr)
  const body = div('browser-body', { position: 'relative', padding: `${26 * k}px`, direction: 'rtl' })
  frame.append(bar, body)
  return { frame, body, addr }
}
/** A grey text line of `wf` × the width. */
const textLine = (k: number, wf: number, hpx = 14) => div('tline', { height: `${hpx * k}px`, width: `${(wf * 100).toFixed(1)}%`, borderRadius: '999px', background: WEB.line, marginBottom: `${12 * k}px`, marginInlineStart: 'auto' })

/** The crawler bot: a small robot head with an antenna and two eyes. */
function botSvg(size: number, accent: string) {
  const s = document.createElementNS(SVG, 'svg')
  s.setAttribute('viewBox', '0 0 40 40')
  s.setAttribute('width', String(size))
  s.setAttribute('height', String(size))
  s.innerHTML = `<line x1="20" y1="2" x2="20" y2="9" stroke="${accent}" stroke-width="2.5"/><circle cx="20" cy="3" r="2.6" fill="${accent}"/><rect x="5" y="9" width="30" height="24" rx="8" fill="#16130f"/><circle cx="14" cy="21" r="3.6" fill="${accent}"/><circle cx="26" cy="21" r="3.6" fill="${accent}"/><rect x="13" y="28" width="14" height="2.4" rx="1.2" fill="#f3efe7"/><rect x="1" y="17" width="4" height="9" rx="2" fill="#16130f"/><rect x="35" y="17" width="4" height="9" rx="2" fill="#16130f"/>`
  return s
}

/** web-crawl: a search, a crawler bot scanning the results, and the picked page opening. */
export const webCrawl: Primitive<WebCrawlParams> = {
  id: 'web-crawl',
  params: webCrawlParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const pw = s.w * 0.92
    const px0 = s.x + (s.w - pw) / 2
    const py0 = s.y + 0.2 * s.h
    const ph = s.h * 0.64
    const accent = ctx.look.vars.accent
    const panel = div('web-crawl', { position: 'absolute', left: `${px0}px`, top: `${py0}px`, width: `${pw}px`, height: `${ph}px`, background: WEB.page, borderRadius: `${28 * k}px`, boxShadow: '0 30px 70px #0003', overflow: 'hidden', fontFamily: ctx.look.fontBody, color: WEB.ink })
    ctx.layer.append(panel)
    // The search bar.
    const bar = div('wc-bar', { position: 'absolute', left: `${30 * k}px`, right: `${30 * k}px`, top: `${34 * k}px`, height: `${92 * k}px`, borderRadius: '999px', border: `${2 * k}px solid ${WEB.line}`, boxShadow: '0 4px 14px #0001', display: 'flex', alignItems: 'center', gap: `${18 * k}px`, padding: `0 ${30 * k}px`, direction: 'rtl', fontSize: `${Math.round(38 * k)}px` })
    const mag = document.createElementNS(SVG, 'svg')
    mag.setAttribute('viewBox', '0 0 24 24')
    mag.setAttribute('width', String(Math.round(38 * k)))
    mag.setAttribute('height', String(Math.round(38 * k)))
    mag.innerHTML = '<circle cx="10" cy="10" r="6.5" fill="none" stroke="#5f6368" stroke-width="2.4"/><path d="M15 15 L21 21" stroke="#5f6368" stroke-width="2.6" stroke-linecap="round"/>'
    const q = div('wc-query', { whiteSpace: 'nowrap', fontWeight: '700' })
    lineUnit(q, p.query)
    bar.append(mag, q)
    panel.append(bar)
    // Results.
    const rowTop = 160 * k
    const rowH = (ph - rowTop - 30 * k) / p.results.length
    const rows = p.results.map((r, i) => {
      const row = div('wc-row', { position: 'absolute', left: `${30 * k}px`, right: `${30 * k}px`, top: `${rowTop + i * rowH}px`, height: `${rowH - 14 * k}px`, borderRadius: `${16 * k}px`, padding: `${12 * k}px ${20 * k}px`, boxSizing: 'border-box', direction: 'rtl', border: `${3 * k}px solid transparent` })
      const url = div('wc-url', { fontFamily: "'JetBrains Mono', monospace", fontSize: `${Math.round(22 * k)}px`, color: WEB.url, direction: 'ltr', textAlign: 'right', whiteSpace: 'nowrap' })
      url.textContent = r.url
      const title = div('wc-title', { fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${Math.round(36 * k)}px`, color: WEB.link, whiteSpace: 'nowrap', lineHeight: '1.35' })
      lineUnit(title, r.title)
      row.append(url, title, textLine(k, 0.86, 12), textLine(k, 0.6, 12))
      panel.append(row)
      return row
    })
    // The bot and its scan beam.
    const beam = div('wc-beam', { position: 'absolute', left: `${20 * k}px`, right: `${20 * k}px`, height: `${rowH - 6 * k}px`, borderRadius: `${16 * k}px`, background: 'linear-gradient(90deg, #ff5a1f00, #ff5a1f22, #ff5a1f00)' })
    const botSize = Math.round(96 * k)
    const bot = div('wc-bot', { position: 'absolute', left: `${-14 * k}px`, top: '0', width: `${botSize}px`, height: `${botSize}px`, filter: 'drop-shadow(0 8px 14px #0004)' })
    bot.append(botSvg(botSize, '#ff5a1f'))
    panel.append(beam, bot)
    // The picked page.
    const pick = Math.min(p.pick, p.results.length - 1)
    const page = browserFrame(k, p.results[pick]!.url, !p.weak)
    Object.assign(page.frame.style, { left: '0', top: '0', width: `${pw}px`, height: `${ph}px`, transformOrigin: '50% 0' })
    const b = page.body
    const pic = div('pg-pic', { height: `${ph * 0.26}px`, borderRadius: `${14 * k}px`, background: p.weak ? WEB.soft : '#e8eef9', marginBottom: `${22 * k}px`, position: 'relative', overflow: 'hidden' })
    if (p.weak) {
      const broken = document.createElementNS(SVG, 'svg')
      broken.setAttribute('viewBox', '0 0 40 30')
      Object.assign(broken.style, { position: 'absolute', left: '50%', top: '50%', width: `${110 * k}px`, transform: 'translate(-50%, -50%)' })
      broken.innerHTML = '<rect x="2" y="2" width="36" height="26" rx="3" fill="none" stroke="#9aa0a6" stroke-width="2"/><path d="M6 24 L15 14 L21 20 L26 15 L34 24" fill="none" stroke="#9aa0a6" stroke-width="2"/><path d="M4 4 L36 26" stroke="#d93025" stroke-width="2.4"/>'
      pic.append(broken)
    }
    const ptitle = div('pg-title', { fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(42 * k)}px`, marginBottom: `${16 * k}px`, whiteSpace: 'nowrap' })
    lineUnit(ptitle, p.results[pick]!.title)
    b.append(pic, ptitle)
    for (const wf of [0.95, 0.88, 0.92, 0.7]) b.append(textLine(k, wf))
    const ads: HTMLElement[] = []
    if (p.weak) {
      for (let i = 0; i < 2; i++) {
        const ad = div('pg-ad', { height: `${86 * k}px`, borderRadius: `${12 * k}px`, background: WEB.ad, border: `${2 * k}px dashed #e0b400`, marginBottom: `${14 * k}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(32 * k)}px`, color: '#8a6d00' })
        lineUnit(ad, 'إعلان')
        b.append(ad)
        ads.push(ad)
      }
      const warn = div('pg-warn', { position: 'absolute', top: `${18 * k}px`, insetInlineEnd: `${200 * k}px`, color: WEB.warn, fontFamily: ctx.look.fontBody, fontWeight: '800', fontSize: `${Math.round(22 * k)}px`, whiteSpace: 'nowrap' })
      lineUnit(warn, 'غير آمن')
      page.addr.append(warn)
      Object.assign(warn.style, { position: 'static' })
    }
    for (const wf of [0.9, 0.8]) b.append(textLine(k, wf))
    panel.append(page.frame)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const pin = easeOutCubic(seg(t, 0, 0.35))
        panel.style.opacity = f4(pin)
        panel.style.transform = `translateY(${f4((1 - pin) * 40 * k)}px)`
        const ty = easeInOutCubic(seg(t, p.typeAt, p.typeAt + CRAWL.type))
        q.style.clipPath = ty >= 1 ? '' : `inset(0 0 0 ${f4((1 - ty) * 100)}%)`
        rows.forEach((r, i) => {
          const e = easeOutCubic(seg(t, p.listAt + i * 0.08, p.listAt + i * 0.08 + 0.35))
          r.style.opacity = f4(e)
          r.style.transform = `translateY(${f4((1 - e) * 30 * k)}px)`
          r.style.borderColor = i === pick && t >= p.crawlAt + pick * CRAWL.perRow + 0.15 ? accent : 'transparent'
        })
        // The bot steps down the rows to its pick.
        const scanEnd = p.crawlAt + pick * CRAWL.perRow
        const pos = t < p.crawlAt ? 0 : t >= scanEnd ? pick : (t - p.crawlAt) / CRAWL.perRow
        const yRow = rowTop + pos * rowH
        const on = t >= p.crawlAt - 0.2 && t < p.openAt + 0.1
        bot.style.display = beam.style.display = on ? '' : 'none'
        bot.style.transform = `translateY(${f4(yRow + (rowH - botSize) / 2 + Math.sin(t * 14) * 3 * k)}px) scale(${f4(t >= scanEnd && t < scanEnd + 0.2 ? 1.15 : 1)})`
        beam.style.top = `${f4(yRow + 3 * k)}px`
        beam.style.opacity = f4(0.6 + 0.4 * Math.abs(Math.sin(t * 9)))
        // The page opens from the picked row.
        const op = seg(t, p.openAt, p.openAt + CRAWL.open)
        page.frame.style.display = op > 0 ? '' : 'none'
        const e2 = easeOutCubic(op)
        page.frame.style.transform = `translateY(${f4((1 - e2) * (rowTop + pick * rowH))}px) scale(${f4(0.35 + 0.65 * e2)})`
        page.frame.style.opacity = f4(Math.min(1, op * 2.5))
        ads.forEach((ad, i) => (ad.style.opacity = Math.floor(t * 4 + i) % 2 ? '1' : '0.7'))
      },
    }
  },
}

/** misquote: the page's sentence (fact highlighted) and the AI summary getting that fact wrong. */
export const misquote: Primitive<MisquoteParams> = {
  id: 'misquote',
  params: misquoteParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const accent = ctx.look.vars.accent
    const w = s.w * 0.92
    const x0 = s.x + (s.w - w) / 2
    const sentence = (parts: readonly [string, string, string], fs: number, factStyle: Partial<CSSStyleDeclaration>) => {
      const row = div('mq-sentence', { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.28em', fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${fs}px`, lineHeight: '1.5', direction: 'rtl' })
      const a = div('mq-a')
      lineUnit(a, parts[0])
      const f = div('mq-fact', { position: 'relative', padding: '0 0.18em', borderRadius: '0.2em', ...factStyle })
      lineUnit(f, parts[1])
      const c = div('mq-c')
      lineUnit(c, parts[2])
      row.append(a, f, c)
      return { row, f }
    }
    const page = browserFrame(k, p.url, true)
    Object.assign(page.frame.style, { left: `${x0}px`, top: `${s.y + 0.2 * s.h}px`, width: `${w}px` })
    for (const wf of [0.9, 0.75]) page.body.append(textLine(k, wf))
    const ps = sentence(p.page, Math.round(46 * k), { background: '#ffe08a' })
    ps.row.style.margin = `${10 * k}px 0 ${16 * k}px`
    page.body.append(ps.row)
    for (const wf of [0.85, 0.6]) page.body.append(textLine(k, wf))
    ctx.layer.append(page.frame)
    const ai = div('mq-ai', { position: 'absolute', left: `${x0}px`, top: `${s.y + 0.56 * s.h}px`, width: `${w}px`, background: '#16130f', color: '#f3efe7', borderRadius: `${26 * k}px`, padding: `${26 * k}px ${30 * k}px`, boxSizing: 'border-box', boxShadow: '0 24px 60px #0004' })
    const head = div('mq-head', { display: 'flex', alignItems: 'center', gap: `${14 * k}px`, marginBottom: `${10 * k}px`, fontFamily: ctx.look.fontBody, fontWeight: '700', fontSize: `${Math.round(28 * k)}px`, opacity: '0.8', direction: 'rtl' })
    head.append(div('mq-dot', { width: `${26 * k}px`, height: `${26 * k}px`, borderRadius: '50%', background: accent }))
    const hn = div('mq-name')
    lineUnit(hn, p.aiName)
    head.append(hn)
    const said = sentence(p.said, Math.round(46 * k), {})
    ai.append(head, said.row)
    ctx.layer.append(ai)
    // The circle + strike drawn over the AI's fact.
    const mark = document.createElementNS(SVG, 'svg')
    mark.setAttribute('viewBox', '0 0 100 40')
    mark.setAttribute('preserveAspectRatio', 'none')
    Object.assign(mark.style, { position: 'absolute', left: '-18%', top: '-30%', width: '136%', height: '160%', overflow: 'visible', pointerEvents: 'none' })
    const ring = svgEl('ellipse', { cx: '50', cy: '20', rx: '48', ry: '18', fill: 'none', 'stroke-width': '3.5', pathLength: '1', 'stroke-dasharray': '1 1' })
    ring.style.stroke = accent
    const strike = svgEl('line', { x1: '6', y1: '30', x2: '94', y2: '10', 'stroke-width': '4', pathLength: '1', 'stroke-dasharray': '1 1', 'stroke-linecap': 'round' })
    strike.style.stroke = accent
    mark.append(ring, strike)
    said.f.append(mark)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const a = easeOutCubic(seg(t, p.pageAt, p.pageAt + 0.4))
        page.frame.style.opacity = f4(a)
        page.frame.style.transform = `translateY(${f4((1 - a) * 30 * k)}px)`
        const b = easeOutBack(seg(t, p.saidAt, p.saidAt + 0.4), 1.3)
        ai.style.opacity = f4(Math.min(1, seg(t, p.saidAt, p.saidAt + 0.2) * 1))
        ai.style.transform = `translateY(${f4((1 - b) * 40 * k)}px)`
        ring.setAttribute('stroke-dashoffset', f4(1 - easeInOutCubic(seg(t, p.strikeAt, p.strikeAt + 0.35))))
        strike.setAttribute('stroke-dashoffset', f4(1 - easeInOutCubic(seg(t, p.strikeAt + 0.35, p.strikeAt + 0.6))))
        const glow = seg(t, p.strikeAt + 0.5, p.strikeAt + 0.9)
        ps.f.style.boxShadow = glow > 0 ? `0 0 0 ${f4(4 * k * glow)}px #ff5a1f` : ''
      },
    }
  },
}

/** context-window: result cards break into tokens that pour into the window until it is full. */
export const contextWindow: Primitive<ContextWindowParams> = {
  id: 'context-window',
  params: contextWindowParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const fg = ctx.look.vars.fg
    const accent = ctx.look.vars.accent
    const TINTS = ['#ff5a1f', '#2f6fde', '#1f9d6b', '#8a5cd6']
    // Source cards along the top.
    const cw = (s.w * 0.92 - (p.sources.length - 1) * 20 * k) / p.sources.length
    const cardTop = s.y + 0.2 * s.h
    const cards = p.sources.map((label, i) => {
      const x = s.x + s.w * 0.04 + i * (cw + 20 * k)
      const card = div('cw-card', { position: 'absolute', left: `${x}px`, top: `${cardTop}px`, width: `${cw}px`, height: `${120 * k}px`, background: '#fff', borderRadius: `${16 * k}px`, borderTop: `${8 * k}px solid ${TINTS[i % 4]}`, boxShadow: '0 12px 30px #0002', padding: `${12 * k}px`, boxSizing: 'border-box', fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${Math.round(30 * k)}px`, color: '#1f1f1f', textAlign: 'center' })
      lineUnit(card, label)
      card.append(textLine(k, 0.9, 10), textLine(k, 0.6, 10))
      ctx.layer.append(card)
      return { card, x: x + cw / 2, y: cardTop + 60 * k, tint: TINTS[i % 4]! }
    })
    // The window.
    const ww = s.w * 0.86
    const wx = s.x + (s.w - ww) / 2
    const wy = s.y + 0.38 * s.h
    const wh = s.h * 0.44
    const win = div('cw-window', { position: 'absolute', left: `${wx}px`, top: `${wy}px`, width: `${ww}px`, height: `${wh}px`, border: `${6 * k}px solid ${fg}`, borderRadius: `${26 * k}px`, boxSizing: 'border-box', overflow: 'hidden', background: '#ffffff80' })
    const title = div('cw-title', { position: 'absolute', left: `${wx}px`, top: `${wy - 66 * k}px`, width: `${ww}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(42 * k)}px`, color: fg, direction: 'rtl' })
    const tt = div('cw-t')
    lineUnit(tt, p.title)
    const pct = div('cw-pct', { fontFamily: ctx.look.fontBody, fontWeight: '800' })
    title.append(tt, pct)
    const meter = div('cw-meter', { position: 'absolute', left: `${wx}px`, top: `${wy + wh + 20 * k}px`, width: `${ww}px`, height: `${22 * k}px`, borderRadius: '999px', background: '#0001', overflow: 'hidden' })
    const fill = div('cw-fill', { height: '100%', width: '0%', background: fg, borderRadius: '999px', marginInlineStart: 'auto' })
    meter.append(fill)
    const full = div('cw-full', { position: 'absolute', left: `${wx + ww / 2}px`, top: `${wy + wh / 2}px`, transform: 'translate(-50%, -50%) rotate(-8deg)', border: `${8 * k}px solid ${accent}`, color: accent, background: '#fff', borderRadius: `${14 * k}px`, padding: `${10 * k}px ${34 * k}px`, fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(84 * k)}px`, whiteSpace: 'nowrap' })
    lineUnit(full, p.fullLabel)
    ctx.layer.append(win, title, meter)
    // Token slots, filled bottom-up, right to left.
    const cols = 9
    const rowsN = 12
    const gap = 8 * k
    const tw = (ww - 12 * k - gap * (cols + 1)) / cols
    const th = (wh - 12 * k - gap * (rowsN + 1)) / rowsN
    const tokens = Array.from({ length: cols * rowsN }, (_, i) => {
      const r = Math.floor(i / cols)
      const c = i % cols
      const x = wx + 6 * k + gap + (cols - 1 - c) * (tw + gap)
      const y = wy + wh - 6 * k - gap - (r + 1) * (th + gap) + gap
      const src = cards[Math.floor(ctx.rng() * cards.length)]!
      const wf = 0.55 + 0.45 * ctx.rng()
      const el = div('cw-token', { position: 'absolute', left: '0', top: '0', width: `${tw * wf}px`, height: `${th}px`, borderRadius: `${th / 2}px`, background: src.tint })
      ctx.layer.append(el)
      return { el, x: x + (tw - tw * wf) / 2, y, src, order: i / (cols * rowsN) }
    })
    // The «full» stamp sits above every token.
    ctx.layer.append(full)
    const nf = new Intl.NumberFormat('ar-EG')
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const pin = easeOutCubic(seg(t, 0, 0.35))
        for (const el of [win, title, meter]) el.style.opacity = f4(pin)
        let landed = 0
        for (const tk of tokens) {
          const st = p.at + tk.order * p.pour * 0.85
          const d = seg(t, st, st + 0.4)
          tk.el.style.display = d > 0 ? '' : 'none'
          if (d <= 0) continue
          const e = easeInOutCubic(d)
          const x = tk.src.x + (tk.x - tk.src.x) * e
          const y = tk.src.y + (tk.y - tk.src.y) * e - Math.sin(Math.PI * e) * 60 * k
          tk.el.style.transform = `translate(${f4(x)}px, ${f4(y)}px)`
          if (d >= 1) landed++
        }
        const frac = landed / tokens.length
        fill.style.width = `${f4(frac * 100)}%`
        const isFull = frac >= 0.999
        fill.style.background = frac > 0.8 ? accent : ''
        win.style.borderColor = isFull ? accent : ''
        pct.textContent = `${nf.format(Math.round(frac * 100))}٪`
        cards.forEach((c, i) => {
          const sh = seg(t, p.at - 0.25, p.at)
          c.card.style.transform = sh > 0 && sh < 1 ? `translateX(${f4(Math.sin(t * 60 + i) * 5 * k)}px)` : ''
          c.card.style.opacity = f4(pin * (1 - 0.6 * seg(t, p.at, p.at + p.pour)))
        })
        const fl = seg(t, p.at + p.pour + 0.2, p.at + p.pour + 0.45)
        full.style.opacity = fl > 0 ? '1' : '0'
        full.style.transform = `translate(-50%, -50%) rotate(-8deg) scale(${f4(fl > 0 ? 1.6 - 0.6 * easeOutCubic(fl) : 1)})`
      },
    }
  },
}

/** Terminal colours of the Claude Code-style chat. */
const CC = { bg: '#1f1e1c', bar: '#2a2926', ink: '#ece8df', dim: '#9a958a', line: '#3a3833', orange: '#d97757' } as const
const SPIN = ['✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳']

/** code-chat: a Claude Code-style terminal chat (prompt, thinking spinner, typed reply, sources). */
export const codeChat: Primitive<CodeChatParams> = {
  id: 'code-chat',
  params: codeChatParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const w = s.w * 0.94
    const x0 = s.x + (s.w - w) / 2
    const win = div('code-chat', { position: 'absolute', left: `${x0}px`, top: `${s.y + p.top * s.h}px`, width: `${w}px`, height: `${p.height * s.h}px`, background: CC.bg, borderRadius: `${26 * k}px`, boxShadow: '0 30px 80px #0006', overflow: 'hidden', color: CC.ink, display: 'flex', flexDirection: 'column' })
    const bar = div('cc-bar', { height: `${62 * k}px`, background: CC.bar, display: 'flex', alignItems: 'center', gap: `${12 * k}px`, padding: `0 ${22 * k}px`, direction: 'ltr', flex: 'none' })
    for (const c of ['#ff5f57', '#febc2e', '#28c840']) bar.append(div('dot', { width: `${15 * k}px`, height: `${15 * k}px`, borderRadius: '50%', background: c }))
    const tl = div('cc-title', { flex: '1', textAlign: 'center', fontFamily: FONT_MONO_CC, fontSize: `${Math.round(24 * k)}px`, color: CC.dim, marginRight: `${60 * k}px` })
    tl.textContent = p.title
    bar.append(tl)
    const head = div('cc-head', { margin: `${22 * k}px ${26 * k}px ${10 * k}px`, border: `${2 * k}px solid ${CC.orange}`, borderRadius: `${14 * k}px`, padding: `${14 * k}px ${20 * k}px`, display: 'flex', alignItems: 'center', gap: `${14 * k}px`, direction: 'ltr', fontFamily: FONT_MONO_CC, fontSize: `${Math.round(26 * k)}px`, flex: 'none' })
    const star = document.createElement('span')
    star.textContent = '✻'
    star.style.color = CC.orange
    star.style.fontSize = `${Math.round(34 * k)}px`
    const hl = document.createElement('span')
    hl.textContent = 'Claude Code'
    hl.style.fontWeight = '700'
    head.append(star, hl)
    const body = div('cc-body', { flex: '1', padding: `${10 * k}px ${30 * k}px`, display: 'flex', flexDirection: 'column', gap: `${22 * k}px`, overflow: 'hidden' })
    const fs = Math.round(38 * k)
    const items = p.messages.map((m) => {
      const row = div('cc-msg', { display: 'flex', gap: `${16 * k}px`, alignItems: 'flex-start', direction: 'rtl' })
      const mark = div('cc-mark', { flex: 'none', fontFamily: FONT_MONO_CC, fontSize: `${fs}px`, lineHeight: '1.5', color: m.role === 'ai' ? CC.orange : CC.dim, direction: 'ltr' })
      mark.textContent = m.role === 'ai' ? '●' : '>'
      const text = div('cc-text', { fontFamily: ctx.look.fontBody, fontWeight: m.role === 'user' ? '500' : '700', fontSize: `${fs}px`, lineHeight: '1.5', color: m.role === 'user' ? CC.dim : CC.ink, background: m.role === 'user' ? '#ffffff0d' : 'transparent', borderRadius: `${10 * k}px`, padding: m.role === 'user' ? `${4 * k}px ${14 * k}px` : '0' })
      wordUnits(text, m.text)
      const col = div('cc-col', { display: 'flex', flexDirection: 'column', gap: `${10 * k}px` })
      col.append(text)
      const srcs = (m.sources ?? []).map((u) => {
        const sEl = div('cc-src', { fontFamily: FONT_MONO_CC, fontSize: `${Math.round(26 * k)}px`, color: CC.orange, direction: 'ltr', textAlign: 'right', textDecoration: 'underline', textUnderlineOffset: '0.2em' })
        sEl.textContent = `↗ ${u}`
        col.append(sEl)
        return sEl
      })
      row.append(mark, col)
      body.append(row)
      return { m, row, text, srcs }
    })
    const spin = div('cc-spin', { display: 'none', alignItems: 'center', gap: `${12 * k}px`, direction: 'rtl', fontFamily: ctx.look.fontBody, fontSize: `${Math.round(32 * k)}px`, color: CC.orange })
    const sg = document.createElement('span')
    sg.style.fontFamily = FONT_MONO_CC
    const sl = div('cc-spin-l')
    lineUnit(sl, 'يفكّر…')
    spin.append(sg, sl)
    body.append(spin)
    const input = div('cc-input', { margin: `0 ${26 * k}px ${12 * k}px`, border: `${2 * k}px solid ${CC.line}`, borderRadius: `${14 * k}px`, height: `${76 * k}px`, display: 'flex', alignItems: 'center', gap: `${12 * k}px`, padding: `0 ${20 * k}px`, direction: 'ltr', fontFamily: FONT_MONO_CC, fontSize: `${Math.round(30 * k)}px`, color: CC.dim, flex: 'none' })
    const gt = document.createElement('span')
    gt.textContent = '>'
    const caret = div('cc-caret', { width: `${14 * k}px`, height: `${34 * k}px`, background: CC.ink })
    input.append(gt, caret)
    const hint = div('cc-hint', { margin: `0 ${30 * k}px ${18 * k}px`, fontFamily: FONT_MONO_CC, fontSize: `${Math.round(20 * k)}px`, color: CC.dim, direction: 'ltr', flex: 'none' })
    hint.textContent = '? for shortcuts'
    win.append(bar, head, body, input, hint)
    ctx.layer.append(win)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const pin = easeOutCubic(seg(t, 0, 0.35))
        win.style.opacity = f4(pin)
        win.style.transform = `translateY(${f4((1 - pin) * 40 * k)}px)`
        let thinking = false
        for (const it of items) {
          const shownAt = it.m.role === 'ai' ? it.m.at : it.m.at
          const vis = t >= shownAt
          it.row.style.display = vis ? 'flex' : 'none'
          if (it.m.role === 'ai' && t >= it.m.at - p.think && t < it.m.at) thinking = true
          // The reply types in from the reading side; the user's line wipes in faster.
          const dur = it.m.role === 'ai' ? Math.min(1.4, 0.04 * it.m.text.length) : 0.3
          const e = seg(t, shownAt, shownAt + dur)
          it.text.style.clipPath = e >= 1 ? '' : `inset(0 0 0 ${f4((1 - e) * 100)}%)`
          it.srcs.forEach((sEl, i) => (sEl.style.opacity = f4(seg(t, shownAt + dur + i * 0.15, shownAt + dur + 0.25 + i * 0.15))))
        }
        spin.style.display = thinking ? 'flex' : 'none'
        sg.textContent = SPIN[Math.floor(t * 10) % SPIN.length]!
        caret.style.opacity = Math.floor(t * 2.2) % 2 ? '0' : '1'
      },
    }
  },
}
