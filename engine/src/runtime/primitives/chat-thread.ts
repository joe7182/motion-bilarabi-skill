import { easeInOutCubic, easeOutCubic, seg } from '../../core/ease'
import { settle } from '../../core/params/common'
import { CHAT, chatThreadParams, typingWindow, type ChatThreadParams } from '../../core/params/chat-thread'
import { contrastRatio } from '../../core/palette'
import { FONT_WEIGHT } from '../looks'
import { bidiWordUnits, lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import { clampIn, el, loadImage, opacityOf, px, show, svgEl } from './layers-kit'
import type { Primitive } from './registry'

/** `#rrggbb` mixed toward `#rrggbb` by `x` (0 → a, 1 → b), as a hex (the chat's fixed colours). */
function mixHex(a: string, b: string, x: number): string {
  const c = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16)
  return '#' + [0, 1, 2].map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * x).toString(16).padStart(2, '0')).join('')
}

const ICON = {
  back: '<path d="M9 5l7 7-7 7"/>',
  video: '<rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="M15.5 10.5l5-3v9l-5-3z"/>',
  phone: '<path d="M6.6 3.5h2.6l1.4 4.2-2 1.4a12 12 0 0 0 6.3 6.3l1.4-2 4.2 1.4v2.6a2 2 0 0 1-2 2A16.6 16.6 0 0 1 4.6 5.5a2 2 0 0 1 2-2z"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0"/><circle cx="9.3" cy="9.8" r=".9" fill="currentColor"/><circle cx="14.7" cy="9.8" r=".9" fill="currentColor"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
} as const

function icon(name: keyof typeof ICON, color: string, size: number, stroke = 2): SVGSVGElement {
  const s = svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })
  s.innerHTML = ICON[name]
  Object.assign(s.style, { width: px(size), height: px(size), display: 'block', color, stroke: 'currentColor', flexShrink: '0' })
  return s
}

/** Double ticks (read, blue), our own drawing. */
function ticks(color: string, h: number): SVGSVGElement {
  const s = svgEl('svg', { viewBox: '0 0 18 11', fill: 'none', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })
  s.innerHTML = '<path d="M1.2 5.8l3.2 3.2L11 2"/><path d="M7.4 8.6l.4.4L14.4 2"/>'
  Object.assign(s.style, { width: px((h * 18) / 11), height: px(h), display: 'block', stroke: color, flexShrink: '0' })
  return s
}

interface Slot {
  wrap: HTMLElement
  bubble: HTMLElement
  typing?: { bubble: HTMLElement; dots: HTMLElement[] }
  top: number
  h: number
  typingH: number
}

/**
 * `chat-thread`: a phone-width messaging chat (booking demo) in fixed chat colours (a chat reads
 * the same in every world). A header (back chevron, round avatar, name, status with an accent dot,
 * call icons), a wallpaper body tinted by the accent, a composer bar. Messages follow the
 * WhatsApp-Arabic convention: `out` (the business / bot) on the LEFT in accent-tinted bubbles with
 * double ticks, `in` (the customer) on the RIGHT in white. Every message has a slot reserved at
 * build (absolute, measured once), so nothing ever reflows; before an `out` message three typing
 * dots show in that slot for `CHAT.typingSec`, then the bubble grows from its tail corner. A `card`
 * is a booking confirmation (accent header with a check, ≤ 3 key / value rows). The thread scrolls up
 * (eased translate) as new messages arrive; messages leaving the top dissolve under the header.
 */
export const chatThread: Primitive<ChatThreadParams> = {
  id: 'chat-thread',
  params: chatThreadParams,
  async build(ctx, p) {
    const k = ctx.size.w / 1080
    const PW = Math.round(p.width * ctx.safe.w)
    const PH = Math.round(p.height * ctx.safe.h)
    const acc = (p.accent ?? ctx.look.accent).toLowerCase()
    const outBg = mixHex(acc, '#ffffff', 0.78)
    const onAccent = contrastRatio(acc, '#ffffff') >= contrastRatio(acc, CHAT.ink) ? '#ffffff' : CHAT.ink
    const wall = mixHex(CHAT.wallpaper, acc, 0.06)
    const HH = Math.round(0.17 * PW)
    const CH = Math.round(0.15 * PW)
    const R = Math.round(0.065 * PW)
    const side = Math.round(0.04 * PW)
    const font = ctx.look.fontBody
    const fs = (n: number) => px(n * k)

    const panel = el('div', {
      position: 'absolute', left: '0px', top: '0px', width: px(PW), height: px(PH), borderRadius: px(R), overflow: 'hidden', background: wall,
      boxShadow: [`0 0 0 ${px(Math.max(1, 1.5 * k))} rgba(17,27,33,0.08)`, `0 ${px(2 * k)} ${px(5 * k)} rgba(20,16,10,0.10)`, `0 ${px(16 * k)} ${px(36 * k)} rgba(20,16,10,0.14)`, `0 ${px(40 * k)} ${px(90 * k)} rgba(20,16,10,0.14)`].join(', '),
      fontFamily: font, color: CHAT.ink,
    }, 'chat-thread')
    panel.dir = 'rtl'
    if (p.key) panel.dataset.mbaKey = p.key
    ctx.layer.append(panel)

    // Wallpaper: a faint dot pattern (static).
    const paper = el('div', { position: 'absolute', inset: '0', backgroundImage: `radial-gradient(circle, rgba(17,27,33,0.05) ${px(2 * k)}, transparent ${px(2.6 * k)})`, backgroundSize: `${px(30 * k)} ${px(30 * k)}` })
    panel.append(paper)

    // Header.
    const header = el('div', {
      position: 'absolute', left: '0px', top: '0px', width: px(PW), height: px(HH), boxSizing: 'border-box', background: CHAT.header, display: 'flex',
      alignItems: 'center', gap: px(14 * k), padding: `0 ${px(side)}`, boxShadow: `0 ${px(1 * k)} 0 rgba(17,27,33,0.08), 0 ${px(4 * k)} ${px(12 * k)} rgba(17,27,33,0.05)`, zIndex: '2',
    })
    header.append(icon('back', CHAT.ink, 30 * k, 2.2))
    const av = await loadImage(p.avatar, 'chat-thread avatar')
    Object.assign(av.style, { width: px(0.11 * PW), height: px(0.11 * PW), borderRadius: '50%', objectFit: 'cover', display: 'block', flexShrink: '0', background: '#dfe5e7' })
    header.append(av)
    const who = el('div', { display: 'flex', flexDirection: 'column', gap: px(2 * k), flex: '1', minWidth: '0' })
    const name = el('div', { fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: fs(CHAT.namePx), lineHeight: '1.2', whiteSpace: 'pre' }, 'chat-name')
    lineUnit(name, p.name)
    const status = el('div', { display: 'flex', alignItems: 'center', gap: px(8 * k), fontSize: fs(CHAT.statusPx), color: CHAT.muted, lineHeight: '1.2', whiteSpace: 'pre' }, 'chat-status')
    status.append(el('div', { width: px(11 * k), height: px(11 * k), borderRadius: '50%', background: acc, flexShrink: '0' }))
    lineUnit(status, p.status)
    who.append(name, status)
    header.append(who)
    const calls = el('div', { display: 'flex', gap: px(26 * k), alignItems: 'center' })
    calls.append(icon('video', CHAT.ink, 36 * k, 1.8), icon('phone', CHAT.ink, 31 * k, 1.8))
    header.append(calls)
    panel.append(header)

    // Composer.
    const comp = el('div', { position: 'absolute', left: '0px', top: px(PH - CH), width: px(PW), height: px(CH), boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: px(12 * k), padding: `0 ${px(side * 0.8)}`, zIndex: '2' })
    const pill = el('div', { flex: '1', height: px(CH * 0.64), borderRadius: px(CH * 0.32), background: '#ffffff', display: 'flex', alignItems: 'center', gap: px(12 * k), padding: `0 ${px(20 * k)}`, boxShadow: `0 ${px(1 * k)} ${px(2 * k)} rgba(17,27,33,0.12)` })
    pill.append(icon('smile', CHAT.muted, 32 * k, 1.8))
    const ph = el('div', { fontSize: fs(CHAT.statusPx + 4), color: CHAT.muted, whiteSpace: 'pre', lineHeight: '1.2' }, 'chat-placeholder')
    lineUnit(ph, p.placeholder)
    pill.append(ph)
    const mic = el('div', { width: px(CH * 0.64), height: px(CH * 0.64), borderRadius: '50%', background: acc, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0', boxShadow: `0 ${px(2 * k)} ${px(5 * k)} rgba(17,27,33,0.16)` })
    mic.append(icon('mic', onAccent, 34 * k, 2))
    comp.append(pill, mic)
    panel.append(comp)

    // Body viewport and the thread.
    const bodyTop = HH
    const VH = PH - HH - CH
    const fadeTop = `linear-gradient(to bottom, transparent 0px, #000 ${px(26 * k)})`
    const body = el('div', { position: 'absolute', left: '0px', top: px(bodyTop), width: px(PW), height: px(VH), overflow: 'hidden', maskImage: fadeTop, webkitMaskImage: fadeTop } as Partial<CSSStyleDeclaration>)
    const content = el('div', { position: 'absolute', left: '0px', top: '0px', width: px(PW) }, 'chat-content')
    body.append(content)
    panel.insertBefore(body, comp)

    const maxW = Math.round((PW - 2 * side) * 0.78)
    const cardW = Math.round((PW - 2 * side) * 0.74)
    const radius = px(18 * k)
    const tail = (out: boolean, color: string) => {
      const s = svgEl('svg', { viewBox: '0 0 12 16', 'aria-hidden': 'true' })
      s.innerHTML = out ? `<path d="M12 0H2.2C.6 0-.4 1.8.6 3.1L12 16z" fill="${color}"/>` : `<path d="M0 0h9.8c1.6 0 2.6 1.8 1.6 3.1L0 16z" fill="${color}"/>`
      Object.assign(s.style, { position: 'absolute', top: '0px', width: px(12 * k), height: px(16 * k), [out ? 'left' : 'right']: px(-11 * k), display: 'block' })
      return s
    }
    const bubbleStyle = (out: boolean): Partial<CSSStyleDeclaration> => ({
      position: 'relative', boxSizing: 'border-box', background: out ? outBg : CHAT.inBubble,
      borderRadius: out ? `0 ${radius} ${radius} ${radius}` : `${radius} 0 ${radius} ${radius}`,
      boxShadow: `0 ${px(1 * k)} ${px(1.5 * k)} rgba(17,27,33,0.13), 0 ${px(4 * k)} ${px(10 * k)} rgba(17,27,33,0.05)`,
    })
    const meta = (m: ChatThreadParams['messages'][number], out: boolean) => {
      const row = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: px(6 * k), direction: 'ltr', marginTop: px(2 * k) })
      const tm = el('div', { fontSize: fs(CHAT.timePx), color: CHAT.muted, lineHeight: '1.2', whiteSpace: 'pre', fontFamily: font }, 'chat-time')
      lineUnit(tm, m.time ?? p.time)
      row.append(tm)
      if (out) row.append(ticks(CHAT.tick, 15 * k))
      return row
    }

    const slots: Slot[] = p.messages.map((m, i) => {
      const out = m.side === 'out'
      const wrap = el('div', { position: 'absolute', top: '0px', left: px(side), width: px(PW - 2 * side) }, 'chat-slot')
      wrap.dataset.i = String(i)
      // The business (`out`) bubbles sit on the LEFT, the customer's on the RIGHT.
      const bubble = el('div', { ...bubbleStyle(out), position: 'absolute', top: '0px', [out ? 'left' : 'right']: '0px', maxWidth: px(maxW), transformOrigin: out ? '0% 0%' : '100% 0%' }, 'chat-bubble')
      bubble.dataset.side = m.side
      bubble.append(tail(out, out ? outBg : CHAT.inBubble))
      if (m.kind === 'card') {
        Object.assign(bubble.style, { width: px(cardW), padding: px(7 * k) })
        const card = el('div', { borderRadius: px(13 * k), overflow: 'hidden', background: '#ffffff', boxShadow: `inset 0 0 0 ${px(Math.max(1, 1.5 * k))} rgba(17,27,33,0.08)` })
        const head = el('div', { display: 'flex', alignItems: 'center', gap: px(12 * k), padding: `${px(14 * k)} ${px(18 * k)}`, background: acc, color: onAccent, fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: fs(CHAT.textPx), lineHeight: '1.2' })
        const chk = el('div', { width: px(38 * k), height: px(38 * k), borderRadius: '50%', background: onAccent === '#ffffff' ? 'rgba(255,255,255,0.22)' : 'rgba(17,27,33,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0' })
        chk.append(icon('check', onAccent, 26 * k, 3))
        head.append(chk)
        const ht = el('div', { whiteSpace: 'pre' }, 'chat-card-title')
        lineUnit(ht, m.text)
        head.append(ht)
        card.append(head)
        for (const [j, [key, value]] of (m.rows ?? []).entries()) {
          const row = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: px(16 * k), padding: `${px(12 * k)} ${px(18 * k)}`, borderTop: j === 0 ? 'none' : `${px(Math.max(1, 1.2 * k))} solid rgba(17,27,33,0.08)`, fontSize: fs(CHAT.rowPx), lineHeight: '1.25' })
          const kk = el('div', { color: CHAT.muted, whiteSpace: 'pre' }, 'chat-card-key')
          lineUnit(kk, key)
          const vv = el('div', { color: CHAT.ink, fontWeight: String(FONT_WEIGHT.bodyBold), whiteSpace: 'pre' }, 'chat-card-value')
          bidiWordUnits(vv, value)
          row.append(kk, vv)
          card.append(row)
        }
        bubble.append(card)
        const mt = meta(m, out)
        mt.style.padding = `${px(4 * k)} ${px(8 * k)} 0`
        bubble.append(mt)
      } else {
        Object.assign(bubble.style, { padding: `${px(12 * k)} ${px(20 * k)} ${px(8 * k)}` })
        const tx = el('div', { fontSize: fs(CHAT.textPx), lineHeight: '1.38', fontWeight: String(FONT_WEIGHT.body) }, 'chat-text')
        bidiWordUnits(tx, m.text)
        bubble.append(tx, meta(m, out))
      }
      wrap.append(bubble)
      content.append(wrap)

      let typing: Slot['typing']
      if (out) {
        const tb = el('div', { ...bubbleStyle(true), position: 'absolute', top: '0px', left: '0px', display: 'flex', gap: px(9 * k), padding: `${px(22 * k)} ${px(24 * k)}`, transformOrigin: '0% 0%' }, 'chat-typing')
        tb.append(tail(true, outBg))
        const dots = [0, 1, 2].map(() => el('div', { width: px(12 * k), height: px(12 * k), borderRadius: '50%', background: CHAT.muted }))
        tb.append(...dots)
        wrap.append(tb)
        typing = { bubble: tb, dots }
      }
      return { wrap, bubble, typing, top: 0, h: 0, typingH: 0 }
    })

    // Measure once, then fix every slot in place.
    let y = Math.round(18 * k)
    slots.forEach((s, i) => {
      const prev = p.messages[i - 1]
      if (i > 0) y += prev!.side === p.messages[i]!.side ? Math.round(8 * k) : Math.round(18 * k)
      s.top = y
      s.h = s.bubble.offsetHeight
      s.typingH = s.typing?.bubble.offsetHeight ?? 0
      s.wrap.style.top = px(y)
      s.wrap.style.height = px(s.h)
      y += s.h
    })
    const bottomPad = Math.round(18 * k)

    // Scroll keyframes: each new bottom (typing bubble, then the message) eases in.
    const events: { t: number; target: number }[] = []
    p.messages.forEach((m, i) => {
      const tw = typingWindow(p, i)
      if (tw) events.push({ t: tw[0], target: Math.max(0, slots[i]!.top + slots[i]!.typingH + bottomPad - VH) })
      events.push({ t: m.at, target: Math.max(0, slots[i]!.top + slots[i]!.h + bottomPad - VH) })
    })
    events.sort((a, b) => a.t - b.t)
    const scrollAt = (t: number) => {
      let off = 0
      let prev = 0
      for (const e of events) {
        off += (e.target - prev) * easeInOutCubic(seg(t, e.t, e.t + CHAT.scrollSec))
        prev = e.target
      }
      return off
    }

    const c = safePointPx(ctx, p.at)
    panel.style.left = px(clampIn(c.x - PW / 2, ctx.safe.x, ctx.safe.x + ctx.safe.w - PW))
    panel.style.top = px(clampIn(c.y - PH / 2, ctx.safe.y, ctx.safe.y + ctx.safe.h - PH))
    const fadeLen = 0.8 * HH

    return {
      update(localT) {
        const t = localT
        const pin = easeOutCubic(seg(t, 0, CHAT.panelSec))
        panel.style.opacity = opacityOf(pin)
        panel.style.transform = pin >= 1 ? '' : `translateY(${px((1 - pin) * 40 * k)})`
        const off = scrollAt(t)
        content.style.transform = Math.abs(off) < 1e-4 ? '' : `translateY(${px(-off)})`

        slots.forEach((s, i) => {
          const m = p.messages[i]!
          const tw = typingWindow(p, i)
          const start = tw ? tw[0] : m.at
          const visible = t >= start
          show(s.wrap, visible)
          if (!visible) return
          // Leaving the top: dissolve under the header (opacity < 0.5 well before the text crosses it).
          const above = off - s.top
          const leave = above <= 0 ? 1 : Math.max(0, 1 - above / Math.min(fadeLen, s.h))
          s.wrap.style.opacity = opacityOf(leave)
          if (leave <= 0) {
            show(s.wrap, false)
            return
          }
          if (s.typing) {
            const on = t < m.at ? easeOutCubic(seg(t, tw![0], tw![0] + CHAT.dotsFade)) : 1 - easeOutCubic(seg(t, m.at, m.at + CHAT.dotsFade))
            show(s.typing.bubble, on > 0)
            if (on > 0) {
              s.typing.bubble.style.opacity = opacityOf(on)
              const sc = 0.85 + 0.15 * settle(seg(t, tw![0], tw![0] + 0.25))
              s.typing.bubble.style.transform = sc === 1 ? '' : `scale(${sc.toFixed(5)})`
              s.typing.dots.forEach((d, j) => {
                const ph = (t - tw![0]) / CHAT.dotPeriod - j * 0.16
                const b = Math.max(0, Math.sin(2 * Math.PI * (ph - Math.floor(ph))))
                d.style.transform = b <= 0 ? '' : `translateY(${px(-5 * k * b)})`
                d.style.opacity = (0.45 + 0.55 * b).toFixed(4)
              })
            }
          }
          const q = seg(t, m.at, m.at + CHAT.popSec)
          show(s.bubble, q > 0)
          if (q <= 0) return
          const sc = CHAT.popFrom + (1 - CHAT.popFrom) * settle(q)
          const rise = (1 - easeOutCubic(q)) * 14 * k
          s.bubble.style.transform = q >= 1 ? '' : `translateY(${px(rise)}) scale(${sc.toFixed(5)})`
          s.bubble.style.opacity = opacityOf(easeOutCubic(Math.min(1, q * 1.6)))
        })
      },
    }
  },
}
