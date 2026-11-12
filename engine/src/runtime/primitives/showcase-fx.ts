import { easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import {
  AR_KEYS, glassCardParams, orderStepsParams, pageFlyoverParams, phoneReplyParams, SHOWCASE as S,
  type GlassCardParams, type OrderStepsParams, type PageFlyoverParams, type PhoneReplyParams,
} from '../../core/params/showcase-fx'
import { spring } from '../../core/params/ui-morph'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

const f2 = (n: number) => n.toFixed(2)
const f4 = (n: number) => n.toFixed(4)
const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const mix = (v: string, pct: number, other = 'transparent') => `color-mix(in srgb, ${v} ${pct}%, ${other})`
function div(parent: HTMLElement, style: Partial<CSSStyleDeclaration> = {}, text?: string): HTMLElement {
  const el = document.createElement('div')
  Object.assign(el.style, style)
  if (text !== undefined) el.textContent = text
  parent.append(el)
  return el
}

/**
 * page-flyover: the page lies tilted back; the camera glides down it while pieces lift off toward
 * the lens (each casting a soft shadow on the page), then the page turns flat under an overhead
 * camera and lands as a rounded card. CSS 3D inside this scene's own layer; pure in `localT`.
 */
export const pageFlyover: Primitive<PageFlyoverParams> = {
  id: 'page-flyover',
  params: pageFlyoverParams,
  async build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const D = ctx.duration
    const img = new Image()
    img.src = p.image
    await img.decode()
    const W = p.size * s.w
    const pageH = (W * img.naturalHeight) / img.naturalWidth
    const cardH = Math.min(pageH, W * p.aspect)
    const landY = p.land * (pageH - cardH)
    const stage = div(ctx.layer, { position: 'absolute', inset: '0', perspective: `${f2(1700 * k)}px`, perspectiveOrigin: '50% 46%' })
    const holder = div(stage, { position: 'absolute', left: `${f2(s.x + (s.w - W) / 2)}px`, top: `${f2(s.y + p.y * s.h - cardH / 2)}px`, width: `${f2(W)}px`, height: `${f2(cardH)}px`, transformStyle: 'preserve-3d' })
    const page = div(holder, { position: 'absolute', left: '0', top: '0', width: `${f2(W)}px`, height: `${f2(pageH)}px`, transformStyle: 'preserve-3d' })
    const bg = `url("${p.image}")`
    const sheet = div(page, { position: 'absolute', inset: '0', backgroundImage: bg, backgroundSize: '100% 100%', borderRadius: `${f2(18 * k)}px`, boxShadow: `0 ${f2(50 * k)}px ${f2(120 * k)}px rgba(0,0,0,0.3)` })
    // the far end of a tilted page falls off into the world's colour
    const fog = div(page, { position: 'absolute', left: '0', right: '0', top: '0', height: '45%', background: `linear-gradient(${ctx.look.vars.bg}, transparent)`, borderRadius: `${f2(18 * k)}px`, pointerEvents: 'none' })
    const layers = p.layers.map((l, i) => {
      const box = { left: `${f4(l.x * 100)}%`, top: `${f4(l.y * 100)}%`, width: `${f4(l.w * 100)}%`, height: `${f4(l.h * 100)}%` }
      const shadow = div(page, { position: 'absolute', ...box, background: 'rgba(15,20,40,0.55)', borderRadius: `${f2(14 * k)}px` })
      const piece = div(page, { position: 'absolute', ...box, backgroundImage: bg, backgroundSize: `${f2(W)}px ${f2(pageH)}px`, backgroundPosition: `${f2(-l.x * W)}px ${f2(-l.y * pageH)}px`, borderRadius: `${f2(14 * k)}px`, transformOrigin: '50% 100%' })
      return { piece, shadow, lift: l.lift * W, at: l.at ?? D * S.glide * (0.22 + (0.62 * i) / Math.max(1, p.layers.length)) }
    })
    const settleAt = D * (S.rise + 0.02)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const a = easeInOutCubic(seg(t, 0, D * S.glide))
        const b = easeInOutCubic(seg(t, D * S.glide, D * S.rise))
        const c = easeInOutCubic(seg(t, D * S.rise, D * 0.97))
        const tilt = p.tilt * (1 - b)
        const fit = Math.min(1, (s.h * 0.86) / pageH)
        const scale = lerp(lerp(1.16, fit, b), 1, c)
        const focus = lerp(lerp(lerp(cardH * 0.42, Math.max(cardH * 0.5, pageH - cardH * 0.55), a), pageH / 2, b), landY + cardH / 2, c)
        page.style.transformOrigin = `50% ${f2(focus)}px`
        page.style.transform = `translateY(${f2(cardH / 2 - focus)}px) rotateX(${f2(tilt)}deg) scale(${f4(scale)})`
        // The page is there from the first frame (a video that opens on it never starts blank).
        fog.style.opacity = f4(0.75 * (tilt / p.tilt))
        // the landing crops the page to its card (only once every piece is flat again)
        const flat = t >= settleAt + 0.35
        const top = landY * c
        const bottom = (pageH - landY - cardH) * c
        page.style.clipPath = flat && c > 0 ? `inset(${f2(top)}px 0 ${f2(bottom)}px 0 round ${f2(22 * k)}px)` : 'none'
        sheet.style.boxShadow = flat && c > 0 ? 'none' : `0 ${f2(50 * k)}px ${f2(120 * k)}px rgba(0,0,0,0.3)`
        holder.style.filter = flat && c > 0 ? `drop-shadow(0 ${f2(34 * k)}px ${f2(50 * k)}px rgba(0,0,0,${f4(0.26 * c)}))` : ''
        for (const l of layers) {
          const up = (t >= l.at ? Math.min(1, easeOutBack(seg(t, l.at, l.at + 0.55), 1.3)) : 0) * (1 - easeInOutCubic(seg(t, settleAt - 0.25, settleAt + 0.3)))
          const z = l.lift * up
          l.piece.style.transform = `translateZ(${f2(z)}px) rotateX(${f2(-tilt * 0.3 * up)}deg)`
          l.piece.style.boxShadow = up > 0.01 ? `0 0 0 ${f2(1.5 * k)}px rgba(255,255,255,${f4(0.5 * up)})` : 'none'
          l.shadow.style.opacity = f4(0.5 * up)
          l.shadow.style.transform = `translateY(${f2(z * 0.42)}px) scale(${f4(1 + 0.04 * up)})`
          l.shadow.style.filter = `blur(${f2(Math.max(0.01, z * 0.22))}px)`
        }
      },
    }
  },
}

const normKey = (ch: string) => (ch === 'أ' || ch === 'إ' || ch === 'آ' ? 'ا' : ch === 'ئ' ? 'ى' : ch)

/**
 * phone-reply: a phone with a chat — the other person's messages pop in, the keyboard rises, the
 * reply appears in the field word by word while the keys of each word light in turn, and at the
 * send it leaves the field and lands as a sent bubble; the keyboard goes back down.
 */
export const phoneReply: Primitive<PhoneReplyParams> = {
  id: 'phone-reply',
  params: phoneReplyParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const dark = p.theme === 'dark'
    const accent = ctx.look.vars.accent
    const W = p.size * s.w
    const H = Math.min(W * 2, s.h * 0.98)
    const ink = dark ? '#f2f0ea' : '#16130f'
    const paper = dark ? '#111214' : '#f6f4ef'
    const soft = dark ? '#26272b' : '#e6e2d8'
    const body = div(ctx.layer, { position: 'absolute', left: `${f2(s.x + (s.w - W) / 2)}px`, top: `${f2(s.y + p.y * s.h - H / 2)}px`, width: `${f2(W)}px`, height: `${f2(H)}px`, background: '#101012', borderRadius: `${f2(W * 0.14)}px`, boxShadow: `0 ${f2(40 * k)}px ${f2(90 * k)}px rgba(0,0,0,0.32), inset 0 0 0 ${f2(3 * k)}px #2a2a2e` })
    const bezel = 14 * k
    const screen = div(body, { position: 'absolute', inset: `${f2(bezel)}px`, borderRadius: `${f2(W * 0.115)}px`, overflow: 'hidden', background: paper, color: ink, fontFamily: ctx.look.fontBody, direction: 'rtl' })
    div(screen, { position: 'absolute', left: '50%', top: `${f2(14 * k)}px`, width: `${f2(W * 0.28)}px`, height: `${f2(32 * k)}px`, transform: 'translateX(-50%)', borderRadius: `${f2(18 * k)}px`, background: '#101012', zIndex: '3' })
    // the chat's bar: an avatar and the contact's name
    const bar = div(screen, { position: 'absolute', left: '0', right: '0', top: '0', height: `${f2(124 * k)}px`, display: 'flex', alignItems: 'flex-end', gap: `${f2(14 * k)}px`, padding: `0 ${f2(28 * k)}px ${f2(14 * k)}px`, boxSizing: 'border-box', borderBottom: `${f2(1.5 * k)}px solid ${soft}` })
    div(bar, { width: `${f2(46 * k)}px`, height: `${f2(46 * k)}px`, borderRadius: '50%', background: accent, flex: 'none' })
    const name = div(bar, { fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: `${f2(30 * k)}px`, lineHeight: '1.5' })
    lineUnit(name, p.name ?? 'رسالة')
    const sw = W - 2 * bezel
    const sh = H - 2 * bezel
    const fs = 28 * k
    const bubble = (text: string, mine: boolean, top: number) => {
      const el = div(screen, { position: 'absolute', top: `${f2(top)}px`, [mine ? 'left' : 'right']: `${f2(24 * k)}px`, maxWidth: `${f2(sw * 0.74)}px`, padding: `${f2(14 * k)}px ${f2(22 * k)}px`, borderRadius: `${f2(26 * k)}px`, background: mine ? accent : soft, color: mine ? '#ffffff' : ink, fontSize: `${f2(fs)}px`, lineHeight: '1.5', fontWeight: String(FONT_WEIGHT.body), transformOrigin: mine ? '0% 100%' : '100% 100%' })
      lineUnit(el, text)
      return el
    }
    const step = 96 * k
    const incoming = p.messages.map((m, i) => ({ el: bubble(m.text, false, 150 * k + i * step), at: m.at }))
    const sent = bubble(p.reply, true, 150 * k + p.messages.length * step + 10 * k)
    // the keyboard, and the input row riding on top of it
    const kbH = sh * 0.34
    const kb = div(screen, { position: 'absolute', left: '0', right: '0', bottom: '0', height: `${f2(kbH)}px`, background: dark ? '#1b1c1f' : '#dcd8ce', padding: `${f2(12 * k)}px ${f2(8 * k)}px`, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: `${f2(9 * k)}px`, direction: 'rtl' })
    const keys = new Map<string, HTMLElement>()
    const keyStyle = { flex: '1', borderRadius: `${f2(8 * k)}px`, background: dark ? '#3a3b40' : '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${f2(24 * k)}px`, color: ink, fontFamily: ctx.look.fontBody }
    for (const row of AR_KEYS) {
      const r = div(kb, { display: 'flex', gap: `${f2(6 * k)}px`, flex: '1', padding: row.length < 11 ? `0 ${f2(sw * 0.045)}px` : '0' })
      for (const ch of row) keys.set(ch, div(r, keyStyle, ch))
    }
    const last = div(kb, { display: 'flex', gap: `${f2(6 * k)}px`, flex: '1' })
    div(last, { ...keyStyle, flex: '1.4', fontSize: `${f2(18 * k)}px` }, '١٢٣')
    const space = div(last, { ...keyStyle, flex: '5' })
    div(last, { ...keyStyle, flex: '1.4', background: accent, color: '#ffffff' }, '↵')
    const rowH = 84 * k
    const input = div(screen, { position: 'absolute', left: '0', right: '0', bottom: '0', height: `${f2(rowH)}px`, display: 'flex', alignItems: 'center', gap: `${f2(12 * k)}px`, padding: `0 ${f2(18 * k)}px`, boxSizing: 'border-box', background: paper })
    const field = div(input, { flex: '1', height: `${f2(58 * k)}px`, borderRadius: `${f2(29 * k)}px`, border: `${f2(2 * k)}px solid ${soft}`, display: 'flex', alignItems: 'center', gap: `${f2(8 * k)}px`, padding: `0 ${f2(22 * k)}px`, boxSizing: 'border-box', fontSize: `${f2(fs)}px`, overflow: 'hidden', whiteSpace: 'nowrap' })
    const words = p.reply.trim().split(/\s+/)
    const wordEls = words.map((w) => {
      const el = div(field, { flex: 'none' })
      lineUnit(el, w)
      return el
    })
    const send = div(input, { width: `${f2(58 * k)}px`, height: `${f2(58 * k)}px`, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: `${f2(28 * k)}px` }, '↑')
    const lit = dark ? '#6a6c74' : '#bdb8ab'
    return {
      update(localT) {
        const t = Math.max(0, localT)
        for (const m of incoming) {
          const u = spring((t - m.at) / S.pop, 0.62, 9)
          m.el.style.opacity = f4(seg(t, m.at, m.at + 0.12))
          m.el.style.transform = `scale(${f4(0.6 + 0.4 * u)})`
        }
        // keyboard: up before typing, down after the send
        const up = easeOutCubic(seg(t, p.typeAt - S.keys - 0.1, p.typeAt - 0.1)) * (1 - easeInOutCubic(seg(t, p.sendAt + 0.25, p.sendAt + 0.25 + S.keys)))
        kb.style.transform = `translateY(${f2((1 - up) * kbH)}px)`
        input.style.transform = `translateY(${f2(-up * kbH)}px)`
        // typing: whole words appear; the keys of the word being typed light one after another
        const typed = t < p.typeAt ? -1 : Math.min(words.length - 1, Math.floor((t - p.typeAt) / S.word))
        const gone = t >= p.sendAt
        wordEls.forEach((el, i) => (el.style.opacity = !gone && i <= typed ? '1' : '0'))
        for (const el of keys.values()) el.style.background = dark ? '#3a3b40' : '#ffffff'
        space.style.background = dark ? '#3a3b40' : '#ffffff'
        if (typed >= 0 && !gone && t < p.typeAt + words.length * S.word) {
          const w = words[typed]!
          const frac = (t - p.typeAt) / S.word - typed
          const chars = [...w].filter((c) => /\p{L}/u.test(c))
          if (frac > 0.86) space.style.background = lit
          else {
            const key = keys.get(normKey(chars[Math.min(chars.length - 1, Math.floor((frac / 0.86) * chars.length))] ?? ''))
            if (key) key.style.background = lit
          }
        }
        const ready = typed >= 0 && !gone
        const press = 1 - 0.18 * Math.sin(seg(t, p.sendAt - 0.08, p.sendAt + 0.14) * Math.PI)
        send.style.background = ready || (gone && t < p.sendAt + 0.2) ? accent : soft
        send.style.transform = `scale(${f4(press)})`
        const su = spring((t - p.sendAt) / S.pop, 0.6, 9)
        sent.style.opacity = f4(seg(t, p.sendAt, p.sendAt + 0.1))
        sent.style.transform = `translateY(${f2((1 - su) * 60 * k)}px) scale(${f4(0.7 + 0.3 * su)})`
      },
    }
  },
}

/**
 * order-steps: nodes on a line that runs the reading way. A step's node fills with the accent and
 * its check draws at the step's `at`; the line reaches it just before; the next step's node pulses.
 */
export const orderSteps: Primitive<OrderStepsParams> = {
  id: 'order-steps',
  params: orderStepsParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const { fg, bg, accent } = ctx.look.vars
    const W = p.width * s.w
    const rtl = ctx.dir === 'rtl'
    const root = div(ctx.layer, { position: 'absolute', left: `${f2(s.x + (s.w - W) / 2)}px`, top: `${f2(s.y + p.y * s.h)}px`, width: `${f2(W)}px`, transform: 'translateY(-50%)', padding: p.card ? `${f2(44 * k)}px ${f2(36 * k)}px ${f2(40 * k)}px` : '0', boxSizing: 'border-box', borderRadius: `${f2(30 * k)}px`, background: p.card ? mix(bg, 55, '#ffffff') : 'transparent', boxShadow: p.card ? `0 ${f2(22 * k)}px ${f2(60 * k)}px ${mix(fg, 16)}` : 'none', color: p.card ? '#16130f' : fg })
    if (p.title) {
      const title = div(root, { fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), fontSize: `${f2(44 * k)}px`, lineHeight: '1.4', textAlign: rtl ? 'right' : 'left', marginBottom: `${f2(30 * k)}px`, direction: ctx.dir })
      lineUnit(title, p.title)
    }
    const n = p.steps.length
    const node = 62 * k
    const row = div(root, { position: 'relative', height: `${f2(node)}px`, direction: ctx.dir })
    // The end nodes sit in from the edges, so their labels stay inside the card.
    const inset = 44 * k
    const inner = W - (p.card ? 72 * k : 0) - 2 * inset
    const gap = (inner - node) / (n - 1)
    const track = div(row, { position: 'absolute', left: `${f2(inset + node / 2)}px`, right: `${f2(inset + node / 2)}px`, top: `${f2(node / 2 - 3 * k)}px`, height: `${f2(6 * k)}px`, borderRadius: `${f2(3 * k)}px`, background: 'rgba(22,19,15,0.14)' })
    if (!p.card) track.style.background = mix(fg, 18)
    const fill = div(track, { position: 'absolute', top: '0', bottom: '0', [rtl ? 'right' : 'left']: '0', background: accent, borderRadius: `${f2(3 * k)}px` })
    const labels = div(root, { position: 'relative', height: `${f2(64 * k)}px`, marginTop: `${f2(16 * k)}px` })
    const nodes = p.steps.map((st, i) => {
      const x = inset + i * gap
      const el = div(row, { position: 'absolute', top: '0', [rtl ? 'right' : 'left']: `${f2(x)}px`, width: `${f2(node)}px`, height: `${f2(node)}px`, borderRadius: '50%', boxSizing: 'border-box', border: `${f2(5 * k)}px solid ${p.card ? 'rgba(22,19,15,0.2)' : mix(fg, 26)}`, background: p.card ? mix(bg, 55, '#ffffff') : bg })
      const dot = div(el, { position: 'absolute', inset: `${f2(-5 * k)}px`, borderRadius: '50%', background: accent })
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      Object.assign(svg.style, { position: 'absolute', inset: '18%', width: '64%', height: '64%' })
      const check = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      check.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5')
      check.setAttribute('fill', 'none')
      check.setAttribute('pathLength', '1')
      Object.assign(check.style, { stroke: '#ffffff', strokeWidth: '3.2', strokeLinecap: 'round', strokeLinejoin: 'round' })
      svg.append(check)
      dot.append(svg)
      const pulse = div(el, { position: 'absolute', inset: `${f2(-5 * k)}px`, borderRadius: '50%', border: `${f2(5 * k)}px solid ${accent}`, boxSizing: 'border-box' })
      const label = div(labels, { position: 'absolute', top: '0', [rtl ? 'right' : 'left']: `${f2(x + node / 2)}px`, transform: `translateX(${rtl ? '50%' : '-50%'})`, fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: `${f2(27 * k)}px`, lineHeight: '1.4', whiteSpace: 'nowrap' })
      lineUnit(label, st.label)
      return { dot, check, pulse, label, at: st.at }
    })
    return {
      update(localT) {
        const t = Math.max(0, localT)
        let reach = 0
        nodes.forEach((nd, i) => {
          const u = seg(t, nd.at, nd.at + S.fill)
          nd.dot.style.transform = `scale(${f4(u > 0 ? Math.min(1.12, easeOutBack(u, 2)) : 0)})`
          nd.check.style.strokeDasharray = `${f4(easeOutCubic(seg(u, 0.35, 1)))} 1`
          nd.label.style.opacity = f4(0.45 + 0.55 * seg(u, 0, 0.6))
          // the next step to come pulses
          const isNext = t < nd.at && (i === 0 || t >= nodes[i - 1]!.at)
          const ph = (t * 1.1) % 1
          nd.pulse.style.opacity = isNext ? f4(0.9 * (1 - ph)) : '0'
          nd.pulse.style.transform = `scale(${f4(1 + 0.45 * ph)})`
          if (i > 0) reach = Math.max(reach, i - 1 + easeInOutCubic(seg(t, nd.at - 0.45, nd.at)))
        })
        fill.style.width = `${f4((reach / (n - 1)) * 100)}%`
      },
    }
  },
}

/**
 * glass-card: frosted glass over whatever lies beneath this scene — the backdrop is blurred and
 * a little more saturated, the rim catches light, and one bright band sweeps across as it lands.
 */
export const glassCard: Primitive<GlassCardParams> = {
  id: 'glass-card',
  params: glassCardParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const dark = p.tint === 'dark'
    const W = p.width * s.w
    const ink = dark ? '#ffffff' : '#16130f'
    const card = div(ctx.layer, {
      position: 'absolute', left: `${f2(s.x + (s.w - W) / 2)}px`, top: `${f2(s.y + p.y * s.h)}px`, width: `${f2(W)}px`, boxSizing: 'border-box', padding: `${f2(40 * k)}px ${f2(44 * k)}px`,
      borderRadius: `${f2(40 * k)}px`, background: dark ? 'rgba(18,18,22,0.46)' : 'rgba(255,255,255,0.4)', border: `${f2(2 * k)}px solid rgba(255,255,255,${dark ? 0.26 : 0.6})`,
      boxShadow: `0 ${f2(30 * k)}px ${f2(80 * k)}px rgba(0,0,0,0.28), inset 0 ${f2(2 * k)}px 0 rgba(255,255,255,${dark ? 0.22 : 0.7})`, color: ink, overflow: 'hidden', direction: ctx.dir, transformOrigin: '50% 60%',
    })
    let back = `blur(${f2(26 * k)}px) saturate(1.5)`
    if (p.liquid) {
      // A smooth, fixed displacement map bends what is behind the panel; less blur, so the bend shows.
      const id = `mba-glass-${Math.round(ctx.rng() * 1e9)}`
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      Object.assign(svg.style, { position: 'absolute', width: '0', height: '0' })
      svg.innerHTML = `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${f4(0.006 / k)}" numOctaves="1" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${f2(90 * k)}" xChannelSelector="R" yChannelSelector="G"/></filter>`
      ctx.layer.append(svg)
      back = `url(#${id}) blur(${f2(7 * k)}px) saturate(1.6)`
    }
    card.style.setProperty('backdrop-filter', back)
    card.style.setProperty('-webkit-backdrop-filter', back)
    const sweep = div(card, { position: 'absolute', top: '-20%', bottom: '-20%', width: '34%', left: '0', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.34), transparent)', transform: 'skewX(-18deg)', pointerEvents: 'none' })
    const rows: HTMLElement[] = []
    const title = div(card, { position: 'relative', fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), fontSize: `${f2(56 * k)}px`, lineHeight: '1.35' })
    lineUnit(title, p.title)
    rows.push(title)
    for (const text of p.lines) {
      const el = div(card, { position: 'relative', fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.body), fontSize: `${f2(34 * k)}px`, lineHeight: '1.6', opacity: '0.92', marginTop: `${f2(8 * k)}px` })
      lineUnit(el, text)
      rows.push(el)
    }
    if (p.chips.length) {
      const wrap = div(card, { position: 'relative', display: 'flex', flexWrap: 'wrap', gap: `${f2(12 * k)}px`, marginTop: `${f2(26 * k)}px` })
      for (const c of p.chips) {
        const chip = div(wrap, { padding: `${f2(8 * k)}px ${f2(22 * k)}px`, borderRadius: `${f2(30 * k)}px`, border: `${f2(2 * k)}px solid rgba(255,255,255,${dark ? 0.4 : 0.8})`, background: dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.5)', fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: `${f2(26 * k)}px`, lineHeight: '1.5' })
        lineUnit(chip, c)
      }
      rows.push(wrap)
    }
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const u = seg(t, p.at, p.at + S.land)
        const e = spring(u * 1.5, 0.7, 9)
        card.style.opacity = f4(easeOutCubic(seg(u, 0, 0.5)))
        card.style.transform = `translateY(calc(-50% + ${f2((1 - e) * 60 * k)}px)) scale(${f4(0.94 + 0.06 * e)})`
        const sw = seg(t, p.at + 0.2, p.at + 0.2 + S.sweep)
        sweep.style.left = `${f2(-40 + 150 * easeInOutCubic(sw))}%`
        sweep.style.opacity = f4(Math.sin(sw * Math.PI))
        rows.forEach((el, i) => {
          const r = easeOutCubic(seg(t, p.at + 0.18 + i * 0.09, p.at + 0.5 + i * 0.09))
          el.style.opacity = f4(r * (i === 0 || el.children.length > 1 ? 1 : 0.92))
          el.style.transform = `translateY(${f2((1 - r) * 18 * k)}px)`
        })
      },
    }
  },
}
