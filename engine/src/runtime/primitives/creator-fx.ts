import { clamp01, easeInOutCubic, easeInOutSine, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import {
  DIAL, DROP, KEYS, LIST, LOOK, STACK, VOICE,
  commentDropParams, dayDialParams, effectListParams, headStackParams, liveCursorParams, photoLookParams, postWallParams, predictKeysParams, voiceNoteParams,
  type CommentDropParams, type DayDialParams, type EffectListParams, type HeadStackParams, type LiveCursorParams, type PhotoLookParams, type PostWallParams, type PredictKeysParams, type VoiceNoteParams,
} from '../../core/params/creator-fx'
import { FONT_MONO } from '../looks'
import { fitText, lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

/**
 * Creator overlays (batch 1). Our own art. Every
 * text is one line unit; every `update` sets what it uses on every call (pure in `localT`).
 */

const SVG = 'http://www.w3.org/2000/svg'
const easing = (e: 'out' | 'easy') => (e === 'easy' ? easeInOutSine : easeOutCubic)
const div = (part: string, style: Partial<CSSStyleDeclaration> = {}) => {
  const d = document.createElement('div')
  d.dataset.mbaPart = part
  Object.assign(d.style, style)
  return d
}
const latin = (text: string, style: Partial<CSSStyleDeclaration> = {}) => {
  const s = document.createElement('span')
  s.dir = 'ltr'
  s.textContent = text
  Object.assign(s.style, style)
  return s
}
const f4 = (x: number) => x.toFixed(4)
/** The app colours of the device overlays (cards, keyboards): fixed, like a real phone UI. */
const UI = { card: '#ffffff', ink: '#111111', soft: '#6b6b6b', line: '#e6e6e6', like: '#ff3040' } as const

/** effect-list: a side panel listing the video's items; the current one is lit, the counter follows. */
export const effectList: Primitive<EffectListParams> = {
  id: 'effect-list',
  params: effectListParams,
  build(ctx, p) {
    const E = easing(p.ease)
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const w = Math.round(p.width * s.w)
    const x = p.side === 'left' ? s.x : s.x + s.w - w
    const fs = Math.round(40 * k)
    const panel = div('effect-list', {
      position: 'absolute', left: `${x}px`, top: `${s.y + p.top * s.h}px`, width: `${w}px`,
      background: ctx.look.vars.fg, color: ctx.look.vars.bg, borderRadius: `${Math.round(22 * k)}px`,
      padding: `${Math.round(20 * k)}px ${Math.round(18 * k)}px`, boxSizing: 'border-box',
      fontFamily: ctx.look.fontBody, fontSize: `${fs}px`, lineHeight: '1.25', boxShadow: '0 18px 50px #0005',
    })
    const head = div('el-head', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: `${Math.round(12 * k)}px`, opacity: '0.75', fontSize: `${Math.round(fs * 0.82)}px` })
    const title = div('el-title', { whiteSpace: 'nowrap' })
    lineUnit(title, p.title)
    const count = latin('', { fontFamily: FONT_MONO })
    head.append(title, count)
    panel.append(head)
    const rows = p.items.map((it) => {
      const row = div('el-row', { display: 'flex', alignItems: 'center', gap: '0.45em', padding: `${Math.round(5 * k)}px ${Math.round(10 * k)}px`, borderRadius: `${Math.round(10 * k)}px`, whiteSpace: 'nowrap' })
      const dot = div('el-dot', { width: '0.42em', height: '0.42em', borderRadius: '50%', border: '0.09em solid currentColor', flex: 'none' })
      const label = div('el-label', { overflow: 'hidden' })
      lineUnit(label, it.text)
      row.append(dot, label)
      panel.append(row)
      return { row, dot, at: it.at }
    })
    let more: HTMLElement | null = null
    if (p.more) {
      more = div('el-more', { marginTop: `${Math.round(14 * k)}px`, background: ctx.look.vars.accent, color: '#fff', borderRadius: '999px', padding: `${Math.round(6 * k)}px ${Math.round(14 * k)}px`, textAlign: 'center', whiteSpace: 'nowrap', fontSize: `${Math.round(fs * 0.9)}px` })
      lineUnit(more, p.more)
      panel.append(more)
    }
    ctx.layer.append(panel)
    // Fit the rows to the safe height: shrink the font until the panel fits.
    const maxH = s.h * (1 - p.top) - 8
    let size = fs
    while (panel.offsetHeight > maxH && size > 12) {
      size -= 1
      panel.style.fontSize = `${size}px`
    }
    const total = String(p.items.length).padStart(2, '0')
    const dir = p.side === 'left' ? -1 : 1
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const e = E(seg(t, 0, LIST.enter))
        panel.style.opacity = e === 1 ? '' : f4(e)
        panel.style.transform = e === 1 ? '' : `translateX(${f4(dir * (1 - e) * (w + s.x))}px)`
        let cur = -1
        rows.forEach((r, i) => {
          if (t >= r.at) cur = i
        })
        rows.forEach((r, i) => {
          const on = i === cur
          const lit = on ? E(seg(t, r.at, r.at + LIST.row)) : 0
          r.row.style.background = on ? ctx.look.vars.accent : 'transparent'
          r.row.style.color = on ? '#fff' : ''
          r.row.style.opacity = on ? '1' : i < cur ? '0.5' : '0.82'
          r.row.style.transform = on ? `scale(${f4(1 + 0.04 * Math.sin(Math.PI * lit))})` : ''
          r.dot.style.background = i < cur ? 'currentColor' : 'transparent'
        })
        count.textContent = `${String(Math.max(1, cur + 1)).padStart(2, '0')} / ${total}`
      },
    }
  },
}

/** A small arrow pointer (tip at 0,0). */
function pointerSvg(size: number, fill: string) {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.innerHTML = `<path d="M2 1.5 L2 20 L7.2 15.2 L10.6 22.5 L14 21 L10.7 13.9 L17.6 13.6 Z" fill="${fill}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>`
  return svg
}

/** live-cursor: a named pointer moves along its points, drags a selection box with a size readout, a title pops. */
export const liveCursor: Primitive<LiveCursorParams> = {
  id: 'live-cursor',
  params: liveCursorParams,
  build(ctx, p) {
    const E = easing(p.ease)
    const k = ctx.size.w / 1080
    const root = div('live-cursor', { position: 'absolute', inset: '0', pointerEvents: 'none' })
    ctx.layer.append(root)
    const accent = ctx.look.vars.accent
    let title: HTMLElement | null = null
    if (p.title) {
      title = div('lc-title', { position: 'absolute', left: '50%', top: `${ctx.safe.y + 0.035 * ctx.safe.h}px`, background: UI.card, color: UI.ink, borderRadius: `${Math.round(18 * k)}px`, padding: `${Math.round(12 * k)}px ${Math.round(26 * k)}px`, fontFamily: ctx.look.fontDisplay, fontWeight: '800', whiteSpace: 'nowrap', boxShadow: '0 14px 40px #0004', transformOrigin: '50% 0' })
      lineUnit(title, p.title)
      root.append(title)
      fitText(title, { w: Math.floor(0.9 * ctx.safe.w), h: Math.floor(0.09 * ctx.safe.h) }, Math.round(58 * k), 18)
    }
    const box = div('lc-box', { position: 'absolute', border: `${Math.max(2, Math.round(3 * k))}px solid ${accent}`, background: '#ff5a1f14', boxSizing: 'border-box' })
    const handles = [0, 1, 2, 3].map(() => {
      const h = div('lc-handle', { position: 'absolute', width: `${Math.round(14 * k)}px`, height: `${Math.round(14 * k)}px`, background: '#fff', border: `${Math.max(2, Math.round(3 * k))}px solid ${accent}`, boxSizing: 'border-box', transform: 'translate(-50%, -50%)' })
      box.append(h)
      return h
    })
    const readout = div('lc-size', { position: 'absolute', left: '50%', top: `-${Math.round(46 * k)}px`, transform: 'translateX(-50%)', background: accent, color: '#fff', fontFamily: FONT_MONO, fontSize: `${Math.round(24 * k)}px`, padding: `${Math.round(3 * k)}px ${Math.round(10 * k)}px`, borderRadius: `${Math.round(6 * k)}px`, whiteSpace: 'nowrap' })
    const rd = latin('')
    readout.append(rd)
    box.append(readout)
    root.append(box)
    const cursor = div('lc-cursor', { position: 'absolute', left: '0', top: '0' })
    const ps = Math.round(64 * k)
    cursor.append(pointerSvg(ps, accent))
    const tag = div('lc-tag', { position: 'absolute', left: `${Math.round(ps * 0.62)}px`, top: `${Math.round(ps * 0.82)}px`, background: accent, color: '#fff', fontFamily: ctx.look.fontBody, fontWeight: '700', fontSize: `${Math.round(26 * k)}px`, padding: `${Math.round(4 * k)}px ${Math.round(14 * k)}px`, borderRadius: '999px', whiteSpace: 'nowrap' })
    tag.append(latin(p.name))
    cursor.append(tag)
    root.append(cursor)
    const pts = p.path.map((q) => ({ ...safePointPx(ctx, q), at: q.at }))
    const bx = p.box ? { at: p.box.at, dur: p.box.dur, a: safePointPx(ctx, p.box.from), b: safePointPx(ctx, p.box.to) } : null
    const posAt = (t: number) => {
      if (bx && t >= bx.at) {
        const d = E(seg(t, bx.at, bx.at + bx.dur))
        return { x: bx.a.x + (bx.b.x - bx.a.x) * d, y: bx.a.y + (bx.b.y - bx.a.y) * d }
      }
      let q = pts[0]!
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!
        const b = pts[i]!
        if (t < a.at) break
        const d = easeInOutCubic(seg(t, a.at, b.at))
        q = { x: a.x + (b.x - a.x) * d, y: a.y + (b.y - a.y) * d, at: 0 }
        if (t < b.at) break
      }
      return q
    }
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const c = posAt(t)
        const press = bx ? 1 - 0.12 * Math.sin(Math.PI * seg(t, bx.at - 0.08, bx.at + 0.12)) : 1
        cursor.style.transform = `translate(${f4(c.x)}px, ${f4(c.y)}px) scale(${f4(press)})`
        cursor.style.opacity = f4(seg(t, 0, 0.2))
        if (bx && t >= bx.at) {
          const x0 = Math.min(bx.a.x, c.x)
          const y0 = Math.min(bx.a.y, c.y)
          const bw = Math.abs(c.x - bx.a.x)
          const bh = Math.abs(c.y - bx.a.y)
          Object.assign(box.style, { display: '', left: `${f4(x0)}px`, top: `${f4(y0)}px`, width: `${f4(bw)}px`, height: `${f4(bh)}px` })
          const hp = [[0, 0], [1, 0], [0, 1], [1, 1]] as const
          handles.forEach((h, i) => Object.assign(h.style, { left: `${hp[i]![0] * 100}%`, top: `${hp[i]![1] * 100}%` }))
          rd.textContent = `${Math.round(bw / k)} × ${Math.round(bh / k)}`
          readout.style.opacity = bw > 40 * k ? '1' : '0'
        } else box.style.display = 'none'
        if (title) {
          const e = seg(t, p.titleAt, p.titleAt + 0.4)
          title.style.opacity = e > 0 ? '1' : '0'
          title.style.transform = `translateX(-50%) scale(${f4(e > 0 ? easeOutBack(e) : 0.6)})`
        }
      },
    }
  },
}

/** voice-note: a voice-message bubble pops in, its seeded waveform fills while the timer counts. */
export const voiceNote: Primitive<VoiceNoteParams> = {
  id: 'voice-note',
  params: voiceNoteParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const c = safePointPx(ctx, p.place)
    const w = Math.round(p.width * ctx.safe.w)
    const h = Math.round(118 * k)
    const root = div('voice-note', { position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, width: `${w}px`, transformOrigin: '50% 50%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${Math.round(12 * k)}px` })
    const bubble = div('vn-bubble', { width: '100%', height: `${h}px`, background: UI.card, borderRadius: `${h / 2}px`, display: 'flex', alignItems: 'center', gap: `${Math.round(18 * k)}px`, padding: `0 ${Math.round(22 * k)}px`, boxSizing: 'border-box', boxShadow: '0 16px 44px #0005', direction: 'ltr' })
    const play = div('vn-play', { width: `${Math.round(74 * k)}px`, height: `${Math.round(74 * k)}px`, borderRadius: '50%', background: ctx.look.vars.accent, flex: 'none', display: 'grid', placeItems: 'center' })
    const icon = document.createElementNS(SVG, 'svg')
    icon.setAttribute('viewBox', '0 0 24 24')
    icon.setAttribute('width', String(Math.round(34 * k)))
    icon.setAttribute('height', String(Math.round(34 * k)))
    play.append(icon)
    const wave = div('vn-wave', { flex: '1', height: `${Math.round(64 * k)}px`, display: 'flex', alignItems: 'center', gap: `${Math.max(2, Math.round(4 * k))}px` })
    const bars = Array.from({ length: VOICE.bars }, (_, i) => {
      const amp = 0.22 + 0.78 * Math.abs(Math.sin(i * 0.9 + ctx.rng() * 2)) * (0.55 + 0.45 * ctx.rng())
      const b = div('vn-bar', { flex: '1', height: `${Math.round(amp * 100)}%`, borderRadius: '999px', background: UI.line })
      wave.append(b)
      return b
    })
    const timer = latin('0:00', { fontFamily: FONT_MONO, fontSize: `${Math.round(30 * k)}px`, color: UI.soft, flex: 'none' })
    bubble.append(play, wave, timer)
    const label = div('vn-label', { background: UI.card, color: UI.ink, borderRadius: '999px', padding: `${Math.round(6 * k)}px ${Math.round(18 * k)}px`, fontFamily: ctx.look.fontBody, fontSize: `${Math.round(28 * k)}px`, whiteSpace: 'nowrap' })
    lineUnit(label, p.label)
    root.append(bubble, label)
    ctx.layer.append(root)
    const accent = ctx.look.vars.accent
    return {
      update(localT) {
        const t = localT - p.at
        const pop = seg(t, 0, VOICE.pop)
        root.style.opacity = t < 0 ? '0' : '1'
        root.style.transform = `translate(-50%, -50%) scale(${f4(t < 0 ? 0.5 : easeOutBack(pop))})`
        const prog = clamp01((t - VOICE.pop) / p.length)
        const playing = prog > 0 && prog < 1
        icon.innerHTML = playing ? '<rect x="6" y="5" width="4" height="14" rx="1" fill="#fff"/><rect x="14" y="5" width="4" height="14" rx="1" fill="#fff"/>' : '<path d="M8 5 L19 12 L8 19 Z" fill="#fff"/>'
        bars.forEach((b, i) => {
          const on = (i + 0.5) / bars.length <= prog
          b.style.background = on ? accent : UI.line
          b.style.transform = playing && Math.abs((i + 0.5) / bars.length - prog) < 0.04 ? 'scaleY(1.25)' : ''
        })
        const sec = Math.floor(prog * p.length)
        timer.textContent = `0:${String(sec).padStart(2, '0')}`
      },
    }
  },
}

function heart(size: number) {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  return svg
}
const HEART = 'M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z'

/** comment-drop: comment notifications drop from the top and stack, newest on top; each heart fills. */
export const commentDrop: Primitive<CommentDropParams> = {
  id: 'comment-drop',
  params: commentDropParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const w = Math.round(p.width * s.w)
    const left = s.x + (s.w - w) / 2
    const top = s.y + p.top * s.h
    const gap = DROP.gap * s.h
    const cards = p.comments.map((c, i) => {
      const card = div('cd-card', { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${w}px`, background: UI.card, color: UI.ink, borderRadius: `${Math.round(26 * k)}px`, padding: `${Math.round(18 * k)}px ${Math.round(22 * k)}px`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: `${Math.round(16 * k)}px`, boxShadow: '0 14px 40px #0004', fontFamily: ctx.look.fontBody })
      const av = div('cd-avatar', { width: `${Math.round(64 * k)}px`, height: `${Math.round(64 * k)}px`, borderRadius: '50%', flex: 'none', background: `hsl(${Math.round(ctx.rng() * 360)} 55% 55%)` })
      const body = div('cd-body', { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: `${Math.round(4 * k)}px` })
      const nm = div('cd-name', { fontSize: `${Math.round(24 * k)}px`, color: UI.soft, direction: 'ltr', textAlign: 'right' })
      nm.append(latin(c.name))
      const tx = div('cd-text', { fontSize: `${Math.round(32 * k)}px`, fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden' })
      lineUnit(tx, c.text)
      body.append(nm, tx)
      const ht = heart(Math.round(40 * k))
      card.append(av, body, ht)
      ctx.layer.append(card)
      return { card, ht, at: c.at, i }
    })
    return {
      update(localT) {
        const t = Math.max(0, localT)
        // Measured on every frame (fonts may load after build); a layout read, no state kept.
        for (const c of cards) c.card.style.display = t < c.at ? 'none' : 'flex'
        const hgt = cards.map((c) => c.card.offsetHeight || Math.round(110 * k))
        // Each landed card sits below every newer landed card.
        cards.forEach((c) => {
          const f = seg(t, c.at, c.at + DROP.fall)
          if (t < c.at) {
            c.card.style.display = 'none'
            return
          }
          c.card.style.display = 'flex'
          let y = 0
          for (const n of cards) if (n.at > c.at && t >= n.at) y += easeOutCubic(seg(t, n.at, n.at + DROP.fall)) * (hgt[n.i]! + gap)
          const drop = (1 - easeOutBack(f, 1.3)) * -(hgt[c.i]! + top)
          c.card.style.transform = `translateY(${f4(y + drop)}px)`
          c.card.style.opacity = f4(Math.min(1, f * 2.5) * (y > 3 * (hgt[c.i]! + gap) ? 0 : 1))
          const liked = p.likeAfter !== undefined && t >= c.at + DROP.fall + p.likeAfter
          const pulse = liked ? 1 + 0.35 * Math.sin(Math.PI * seg(t, c.at + DROP.fall + p.likeAfter!, c.at + DROP.fall + p.likeAfter! + 0.25)) : 1
          c.ht.innerHTML = `<path d="${HEART}" fill="${liked ? UI.like : 'none'}" stroke="${liked ? UI.like : UI.soft}" stroke-width="1.8"/>`
          c.ht.style.transform = `scale(${f4(pulse)})`
        })
      },
    }
  },
}

/** head-stack: label tags land one on another above a point, each typed in by a right-to-left wipe. */
export const headStack: Primitive<HeadStackParams> = {
  id: 'head-stack',
  params: headStackParams,
  build(ctx, p) {
    const c = safePointPx(ctx, p.place)
    const fs = Math.round(p.size * ctx.safe.w)
    const tags = p.tags.map((tg) => {
      const el = div('hs-tag', { position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, background: UI.card, color: UI.ink, fontFamily: FONT_MONO, fontWeight: '700', fontSize: `${fs}px`, lineHeight: '1.2', padding: '0.18em 0.5em', whiteSpace: 'nowrap', boxShadow: '0 6px 16px #0004', border: `0.06em solid ${UI.ink}` })
      const inner = div('hs-text', { fontFamily: 'inherit' })
      lineUnit(inner, tg.text)
      el.append(inner)
      ctx.layer.append(el)
      return { el, inner, at: tg.at, tilt: (ctx.rng() - 0.5) * 9, dx: (ctx.rng() - 0.5) * fs * 1.6 }
    })
    return {
      update(localT) {
        const t = Math.max(0, localT)
        for (const g of tags) g.el.style.display = t < g.at ? 'none' : ''
        const hs = tags.map((g) => g.el.offsetHeight || fs * 1.6)
        let y = 0
        tags.forEach((g, i) => {
          if (t < g.at) {
            g.el.style.display = 'none'
            return
          }
          g.el.style.display = ''
          const d = seg(t, g.at, g.at + STACK.drop)
          const fall = (1 - easeOutBack(d, 2)) * -fs * 3
          const typed = easeOutCubic(seg(t, g.at + 0.05, g.at + 0.05 + STACK.type))
          g.inner.style.clipPath = typed >= 1 ? '' : `inset(0 0 0 ${f4((1 - typed) * 100)}%)`
          g.el.style.transform = `translate(calc(-50% + ${f4(g.dx)}px), calc(-100% - ${f4(y)}px + ${f4(fall)}px)) rotate(${f4(g.tilt)}deg)`
          g.el.style.opacity = f4(Math.min(1, d * 3))
          y += hs[i]! * 0.92
        })
      },
    }
  },
}

/** The Arabic keyboard rows (as on a phone), right to left. */
const AR_ROWS = [
  ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج'],
  ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'],
  ['ئ', 'ء', 'ؤ', 'ر', 'ى', 'ة', 'و', 'ز', 'ظ', 'د', 'ذ'],
] as const
const KEY_OF: Record<string, string> = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا' }

/** predict-keys: an Arabic phone keyboard slides up; each letter lights its key, the field and the suggestion fill; the word is picked. */
export const predictKeys: Primitive<PredictKeysParams> = {
  id: 'predict-keys',
  params: predictKeysParams,
  build(ctx, p) {
    const E = easing(p.ease)
    const k = ctx.size.w / 1080
    const { w } = ctx.size
    const kb = div('predict-keys', { position: 'absolute', left: '0', bottom: '0', width: `${w}px`, background: '#d4d6dc', padding: `${Math.round(14 * k)}px ${Math.round(8 * k)}px ${Math.round(40 * k)}px`, boxSizing: 'border-box', fontFamily: ctx.look.fontBody, color: UI.ink, borderTopLeftRadius: `${Math.round(26 * k)}px`, borderTopRightRadius: `${Math.round(26 * k)}px` })
    const field = div('pk-field', { position: 'absolute', left: `${Math.round(30 * k)}px`, right: `${Math.round(30 * k)}px`, top: `-${Math.round(120 * k)}px`, height: `${Math.round(96 * k)}px`, background: UI.card, borderRadius: `${Math.round(48 * k)}px`, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: `0 ${Math.round(34 * k)}px`, boxSizing: 'border-box', fontSize: `${Math.round(40 * k)}px`, boxShadow: '0 10px 30px #0003', direction: 'rtl' })
    const chars = [...p.word]
    const prefixes = chars.map((_, i) => {
      const u = div('pk-prefix', { display: 'none', whiteSpace: 'pre' })
      lineUnit(u, chars.slice(0, i + 1).join(''))
      field.append(u)
      return u
    })
    const caret = div('pk-caret', { width: `${Math.max(2, Math.round(4 * k))}px`, height: '1.1em', background: ctx.look.vars.accent, marginInlineStart: '0.08em' })
    field.append(caret)
    kb.append(field)
    const bar = div('pk-bar', { display: 'flex', height: `${Math.round(84 * k)}px`, alignItems: 'center', fontSize: `${Math.round(34 * k)}px`, marginBottom: `${Math.round(10 * k)}px`, direction: 'rtl' })
    const cells = [0, 1, 2].map((i) => {
      const c = div('pk-cell', { flex: '1', textAlign: 'center', borderInlineStart: i ? '1px solid #0002' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', padding: `${Math.round(10 * k)}px 0`, borderRadius: `${Math.round(12 * k)}px` })
      bar.append(c)
      return c
    })
    const side = p.suggest ?? [chars.slice(0, Math.max(1, chars.length - 1)).join(''), `${p.word}؟`]
    lineUnit(cells[0]!, side[0]!)
    lineUnit(cells[2]!, side[1]!)
    const mids = chars.map((_, i) => {
      const u = div('pk-mid', { display: 'none' })
      lineUnit(u, chars.slice(0, i + 1).join(''))
      cells[1]!.append(u)
      return u
    })
    kb.append(bar)
    const keys = new Map<string, HTMLElement>()
    const kw = (w - 16 * k) / 11 - 8 * k
    for (const row of AR_ROWS) {
      const r = div('pk-row', { display: 'flex', justifyContent: 'center', gap: `${Math.round(8 * k)}px`, marginBottom: `${Math.round(14 * k)}px`, direction: 'rtl' })
      for (const ch of row) {
        const key = div('pk-key', { width: `${kw}px`, height: `${Math.round(96 * k)}px`, background: UI.card, borderRadius: `${Math.round(12 * k)}px`, display: 'grid', placeItems: 'center', fontSize: `${Math.round(40 * k)}px`, boxShadow: '0 2px 0 #0003', transformOrigin: '50% 100%' })
        lineUnit(key, ch)
        r.append(key)
        keys.set(ch, key)
      }
      kb.append(r)
    }
    const last = div('pk-row', { display: 'flex', justifyContent: 'center', gap: `${Math.round(8 * k)}px`, direction: 'rtl' })
    const space = div('pk-space', { width: `${Math.round(w * 0.52)}px`, height: `${Math.round(96 * k)}px`, background: UI.card, borderRadius: `${Math.round(12 * k)}px`, boxShadow: '0 2px 0 #0003' })
    last.append(space)
    kb.append(last)
    ctx.layer.append(kb)
    const done = p.at + chars.length / p.cps
    const accent = ctx.look.vars.accent
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const up = E(seg(t, p.at - KEYS.up - 0.1, p.at - 0.1))
        kb.style.transform = `translateY(${f4((1 - up) * (kb.offsetHeight + 130 * k))}px)`
        const n = Math.min(chars.length, Math.max(0, Math.floor((t - p.at) * p.cps) + 1))
        prefixes.forEach((u, i) => (u.style.display = i === n - 1 ? 'inline-block' : 'none'))
        mids.forEach((u, i) => (u.style.display = i === n - 1 ? 'block' : 'none'))
        caret.style.opacity = t >= done ? (Math.floor(t * 2.5) % 2 ? '0' : '1') : '1'
        for (const key of keys.values()) {
          key.style.background = UI.card
          key.style.color = UI.ink
          key.style.transform = ''
        }
        space.style.background = UI.card
        if (n > 0 && t < done + 0.1) {
          const ch = chars[n - 1]!
          const key = keys.get(KEY_OF[ch] ?? ch) ?? (ch === ' ' ? space : undefined)
          const press = seg(t, p.at + (n - 1) / p.cps, p.at + (n - 1) / p.cps + 0.12)
          if (key && press < 1) {
            key.style.background = accent
            key.style.color = '#fff'
            key.style.transform = key === space ? '' : 'scale(1.25) translateY(-30%)'
          }
        }
        const pick = seg(t, done + KEYS.hold, done + KEYS.hold + KEYS.pick)
        cells[1]!.style.background = pick > 0 ? accent : 'transparent'
        cells[1]!.style.color = pick > 0 ? '#fff' : ''
        cells[1]!.style.transform = pick > 0 ? `scale(${f4(1 + 0.12 * Math.sin(Math.PI * pick))})` : ''
      },
    }
  },
}

/** day-dial: a rotary dial of labels swings in and turns to its target; the target is named in the centre. */
export const dayDial: Primitive<DayDialParams> = {
  id: 'day-dial',
  params: dayDialParams,
  build(ctx, p) {
    const c = safePointPx(ctx, p.place)
    const D = Math.round(p.size * ctx.safe.w)
    const R = D / 2
    const n = p.labels.length
    const root = div('day-dial', { position: 'absolute', left: `${c.x - R}px`, top: `${c.y - R}px`, width: `${D}px`, height: `${D}px` })
    const disc = div('dd-disc', { position: 'absolute', inset: '0', borderRadius: '50%', background: ctx.look.vars.bg, border: `${Math.round(D * 0.012)}px solid ${ctx.look.vars.fg}`, boxShadow: '0 30px 80px #0006', color: ctx.look.vars.fg })
    const ticks = document.createElementNS(SVG, 'svg')
    ticks.setAttribute('viewBox', '-100 -100 200 200')
    Object.assign(ticks.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
    let t2 = ''
    for (let i = 0; i < n * 5; i++) {
      const a = (i / (n * 5)) * 2 * Math.PI
      const major = i % 5 === 0
      const r0 = major ? 84 : 89
      t2 += `<line x1="${(Math.sin(a) * r0).toFixed(2)}" y1="${(-Math.cos(a) * r0).toFixed(2)}" x2="${(Math.sin(a) * 94).toFixed(2)}" y2="${(-Math.cos(a) * 94).toFixed(2)}" stroke="currentColor" stroke-width="${major ? 1.4 : 0.6}"/>`
    }
    t2 += '<circle r="50" fill="none" stroke="currentColor" stroke-width="0.6"/>'
    ticks.innerHTML = t2
    disc.append(ticks)
    const fs = Math.round(D * 0.047)
    const labs = p.labels.map((l, i) => {
      const arm = div('dd-arm', { position: 'absolute', left: '50%', top: '50%', width: '0', height: '0', transform: `rotate(${(i / n) * 360}deg)` })
      const lab = div('dd-label', { position: 'absolute', left: '0', top: `${-R * 0.655}px`, transform: 'translate(-50%, -50%)', fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${fs}px`, whiteSpace: 'nowrap' })
      lineUnit(lab, l)
      arm.append(lab)
      disc.append(arm)
      return { lab, a: (i / n) * 360 }
    })
    const pointer = document.createElementNS(SVG, 'svg')
    pointer.setAttribute('viewBox', '0 0 20 20')
    Object.assign(pointer.style, { position: 'absolute', left: '50%', top: `${-D * 0.07}px`, width: `${D * 0.08}px`, height: `${D * 0.08}px`, transform: 'translateX(-50%)' })
    pointer.innerHTML = '<path d="M2 2 L18 2 L10 18 Z" fill="currentColor"/>'
    pointer.style.color = ctx.look.vars.accent
    const center = div('dd-center', { position: 'absolute', left: '50%', top: '50%', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(D * 0.11)}px`, color: ctx.look.vars.accent, whiteSpace: 'nowrap' })
    lineUnit(center, p.center ?? p.labels[p.target]!)
    root.append(disc, center, pointer)
    ctx.layer.append(root)
    const end = -(p.target / n) * 360
    const from = end - p.spin * 360 - 90
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const e = easeOutBack(seg(t, 0, DIAL.inDur), 1.2)
        root.style.opacity = f4(seg(t, 0, 0.15))
        root.style.transform = `translateY(${f4((1 - e) * ctx.size.h * 0.25)}px) rotate(${f4((1 - e) * -25)}deg)`
        const s2 = seg(t, p.at, p.at + DIAL.swing)
        const rot = from + (end - from) * easeOutBack(s2, 1.1)
        disc.style.transform = `rotate(${f4(rot)}deg)`
        // Arabic never reads upside down: every label stays upright as the dial turns.
        for (const l of labs) l.lab.style.transform = `translate(-50%, -50%) rotate(${f4(-(l.a + rot))}deg)`
        const cIn = seg(t, p.at + DIAL.swing - 0.1, p.at + DIAL.swing + 0.25)
        center.style.opacity = f4(cIn)
        center.style.transform = `translate(-50%, -50%) scale(${f4(cIn > 0 ? easeOutBack(cIn) : 0.6)})`
      },
    }
  },
}

/** post-wall: the frame fills with a wall of small posts in a wave from the centre while a counter climbs. */
export const postWall: Primitive<PostWallParams> = {
  id: 'post-wall',
  params: postWallParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const gap = Math.max(2, Math.round(5 * k))
    const cw = (w - gap * (p.cols + 1)) / p.cols
    const ch = cw * 1.25
    const rows = Math.ceil(h / (ch + gap)) + 1
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px` })
    ctx.layer.append(canvas)
    const g = canvas.getContext('2d')!
    const PAL = [['#f3efe7', '#16130f'], ['#16130f', '#f3efe7'], ['#ff5a1f', '#16130f'], ['#e8dcc8', '#7a5c3a'], ['#2b3a32', '#cfe3d4'], ['#3b2f5c', '#f1d7ff'], ['#ffd45a', '#16130f'], ['#c9d6e8', '#1d2b45']] as const
    const tiles = Array.from({ length: rows * p.cols }, (_, i) => {
      const x = gap + (i % p.cols) * (cw + gap)
      const y = gap + Math.floor(i / p.cols) * (ch + gap) - ch * 0.3
      const d = Math.hypot(x + cw / 2 - w / 2, y + ch / 2 - h / 2) / Math.hypot(w / 2, h / 2)
      return { x, y, d, pal: PAL[Math.floor(ctx.rng() * PAL.length)]!, kind: Math.floor(ctx.rng() * 4), j: ctx.rng() }
    })
    const counter = div('pw-counter', { position: 'absolute', right: `${ctx.safe.x}px`, top: `${ctx.safe.y + 0.02 * ctx.safe.h}px`, background: '#16130fe6', color: '#f3efe7', borderRadius: `${Math.round(18 * k)}px`, padding: `${Math.round(10 * k)}px ${Math.round(22 * k)}px`, display: 'flex', alignItems: 'baseline', gap: '0.35em', fontSize: `${Math.round(44 * k)}px`, fontFamily: ctx.look.fontDisplay, fontWeight: '900' })
    const num = latin('0', { fontFamily: FONT_MONO })
    const lab = div('pw-label', { fontSize: '0.6em', fontWeight: '700' })
    lineUnit(lab, p.label)
    counter.append(lab, num)
    ctx.layer.append(counter)
    const drawTile = (tl: (typeof tiles)[number], s: number) => {
      g.save()
      g.translate(tl.x + cw / 2, tl.y + ch / 2)
      g.scale(s, s)
      g.translate(-cw / 2, -ch / 2)
      g.fillStyle = tl.pal[0]
      g.beginPath()
      g.roundRect(0, 0, cw, ch, cw * 0.08)
      g.fill()
      g.fillStyle = tl.pal[1]
      if (tl.kind === 0) {
        g.beginPath()
        g.arc(cw / 2, ch * 0.42, cw * 0.24, 0, Math.PI * 2)
        g.fill()
      } else if (tl.kind === 1) {
        for (let r = 0; r < 4; r++) g.fillRect(cw * 0.15, ch * (0.25 + r * 0.14), cw * (0.7 - (r % 2) * 0.25), ch * 0.06)
      } else if (tl.kind === 2) {
        g.fillRect(cw * 0.12, ch * 0.12, cw * 0.76, ch * 0.5)
        g.fillRect(cw * 0.12, ch * 0.72, cw * 0.5, ch * 0.06)
      } else {
        g.beginPath()
        g.moveTo(cw * 0.1, ch * 0.8)
        g.lineTo(cw * 0.45, ch * 0.35)
        g.lineTo(cw * 0.65, ch * 0.6)
        g.lineTo(cw * 0.9, ch * 0.3)
        g.lineTo(cw * 0.9, ch * 0.8)
        g.fill()
      }
      g.restore()
    }
    return {
      update(localT) {
        const t = localT - p.at
        g.clearRect(0, 0, w, h)
        for (const tl of tiles) {
          const start = tl.d * p.build * 0.75 + tl.j * 0.12
          const s = seg(t, start, start + 0.3)
          if (s > 0) drawTile(tl, easeOutBack(s, 1.6))
        }
        counter.style.opacity = f4(seg(t, 0, 0.2))
        num.textContent = Math.round(p.total * easeOutCubic(seg(t, 0, p.build + 0.3))).toLocaleString('en-US')
      },
    }
  },
}

/** Luminance 0..1 of an image fitted `cover` into w × h (sampled once, cached). */
function lumaGrid(img: HTMLImageElement, w: number, h: number): { at: (x: number, y: number) => number } {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  const g = c.getContext('2d', { willReadFrequently: true })!
  const s = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight)
  g.drawImage(img, (c.width - img.naturalWidth * s) / 2, (c.height - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s)
  const data = g.getImageData(0, 0, c.width, c.height).data
  return {
    at(x, y) {
      const i = (Math.min(c.height - 1, Math.max(0, Math.round(y))) * c.width + Math.min(c.width - 1, Math.max(0, Math.round(x)))) * 4
      return (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255
    },
  }
}

/** Banknote line engraving: wavy horizontal lines whose weight follows the darkness. */
function engrave(g: CanvasRenderingContext2D, L: { at: (x: number, y: number) => number }, w: number, h: number, ink: string, k: number) {
  const step = Math.max(3, 5.5 * k)
  g.fillStyle = ink
  for (let y = step / 2; y < h; y += step) {
    for (let x = 0; x < w; x += 1.5) {
      // A contrast curve first: soft photos still engrave with clear blacks.
      const dark = clamp01((0.88 - L.at(x, y)) / 0.62)
      const t = dark ** 1.3 * step * 0.98
      if (t < 0.25) continue
      const yy = y + Math.sin(x * 0.045 + y * 0.02) * step * 0.35
      g.fillRect(x, yy - t / 2, 1.6, t)
    }
  }
}

/** Newspaper halftone: dots on a 45° grid sized by darkness. */
function halftone(g: CanvasRenderingContext2D, L: { at: (x: number, y: number) => number }, w: number, h: number, ink: string, k: number) {
  const cell = Math.max(4, 8 * k)
  g.fillStyle = ink
  const r2 = Math.SQRT1_2
  for (let u = -h; u < w + h; u += cell) {
    for (let v = -w; v < w + h; v += cell) {
      const x = (u - v) * r2
      const y = (u + v) * r2
      if (x < 0 || y < 0 || x > w || y > h) continue
      const r = (1 - L.at(x, y)) * cell * 0.62
      if (r < 0.3) continue
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
  }
}

/** Impact art: hard black-and-white with an ink outline where the light changes fast. */
function impactArt(g: CanvasRenderingContext2D, L: { at: (x: number, y: number) => number }, w: number, h: number) {
  const img = g.createImageData(Math.round(w), Math.round(h))
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const l = L.at(x, y)
      const edge = Math.abs(l - L.at(x + 2, y)) + Math.abs(l - L.at(x, y + 2))
      const black = edge > 0.09 || l < 0.28
      const i = (y * img.width + x) * 4
      const v = black ? 12 : 250
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
}

/** photo-look: an image re-drawn as a banknote engraving, a halftone front page, or black-and-white impact art. */
export const photoLook: Primitive<PhotoLookParams> = {
  id: 'photo-look',
  params: photoLookParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const root = div('photo-look', { position: 'absolute', inset: '0', overflow: 'hidden' })
    ctx.layer.append(root)
    const img = new Image()
    img.decoding = 'sync'
    img.src = p.image
    const ready = img.decode()
    const canvas = document.createElement('canvas')
    const sheet = div('pl-sheet', { position: 'absolute', inset: '0', transformOrigin: '50% 60%' })
    root.append(sheet)
    let drawn = false
    let number: HTMLSpanElement | null = null
    // Layout per look: where the picture sits, and the texts around it.
    let pic = { x: 0, y: 0, w, h }
    // Newsprint: crisp for `press`, aged for `vintage`.
    const PAPER = p.look === 'vintage' ? '#e3d2ad' : '#efe8da'
    const INK = p.look === 'vintage' ? '#2b1f12' : '#141210'
    if (p.look === 'banknote') {
      Object.assign(sheet.style, { background: '#ece4cc', color: '#2d5640' })
      pic = { x: w * 0.14, y: h * 0.12, w: w * 0.72, h: h * 0.48 }
      const oval = div('pl-oval', { position: 'absolute', left: `${pic.x}px`, top: `${pic.y}px`, width: `${pic.w}px`, height: `${pic.h}px`, borderRadius: '50%', overflow: 'hidden', boxShadow: `0 0 0 ${Math.round(10 * k)}px #ece4cc, 0 0 0 ${Math.round(14 * k)}px #2d5640, 0 0 0 ${Math.round(30 * k)}px #ece4cc, 0 0 0 ${Math.round(33 * k)}px #2d5640` })
      oval.append(canvas)
      const rings = document.createElementNS(SVG, 'svg')
      rings.setAttribute('viewBox', `0 0 ${w} ${h}`)
      Object.assign(rings.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
      let r = ''
      for (let i = 0; i < 46; i++) r += `<ellipse cx="${w / 2}" cy="${h * 0.36}" rx="${w * 0.47}" ry="${h * 0.12}" transform="rotate(${(i * 180) / 46} ${w / 2} ${h * 0.36})" fill="none" stroke="#2d5640" stroke-opacity="0.22" stroke-width="${1.2 * k}"/>`
      r += `<rect x="${w * 0.04}" y="${h * 0.035}" width="${w * 0.92}" height="${h * 0.93}" fill="none" stroke="#2d5640" stroke-width="${3 * k}"/><rect x="${w * 0.055}" y="${h * 0.045}" width="${w * 0.89}" height="${h * 0.91}" fill="none" stroke="#2d5640" stroke-width="${1.2 * k}"/>`
      rings.innerHTML = r
      sheet.append(rings, oval)
      const num = div('pl-number', { position: 'absolute', left: '0', right: '0', top: `${h * 0.66}px`, textAlign: 'center', fontFamily: "Georgia, 'Times New Roman', serif", fontSize: `${Math.round(150 * k)}px`, letterSpacing: '-0.02em' })
      number = latin('0')
      num.append(number)
      const cap = div('pl-caption', { position: 'absolute', left: '0', right: '0', top: `${h * 0.78}px`, textAlign: 'center', fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${Math.round(54 * k)}px` })
      lineUnit(cap, p.text)
      sheet.append(num, cap)
    } else if (p.look === 'press' || p.look === 'vintage') {
      const vintage = p.look === 'vintage'
      Object.assign(sheet.style, { background: PAPER, color: INK })
      if (vintage) {
        // Aged newsprint: fibre grain, foxing spots and burnt edges.
        const age = document.createElementNS(SVG, 'svg')
        age.setAttribute('viewBox', `0 0 ${w} ${h}`)
        Object.assign(age.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
        age.innerHTML = `<defs><filter id="pl-grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="4"/><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0.55 0"/></filter><filter id="pl-fox"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="9"/><feColorMatrix values="0 0 0 0 0.55  0 0 0 0 0.38  0 0 0 0 0.15  0 0 0 1.6 -0.9"/></filter><radialGradient id="pl-burn" cx="50%" cy="50%" r="75%"><stop offset="0.62" stop-color="#5a3a14" stop-opacity="0"/><stop offset="1" stop-color="#4a2d0e" stop-opacity="0.55"/></radialGradient></defs><rect width="${w}" height="${h}" filter="url(#pl-fox)" opacity="0.45"/><rect width="${w}" height="${h}" filter="url(#pl-grain)" opacity="0.5"/><rect width="${w}" height="${h}" fill="url(#pl-burn)"/>`
        sheet.append(age)
      }
      const mast = div('pl-mast', { position: 'absolute', left: `${w * 0.06}px`, right: `${w * 0.06}px`, top: `${h * 0.045}px`, textAlign: 'center', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(96 * k)}px`, borderBottom: `${Math.round(6 * k)}px double ${INK}`, paddingBottom: `${Math.round(10 * k)}px` })
      lineUnit(mast, p.masthead)
      const date = div('pl-date', { position: 'absolute', left: `${w * 0.06}px`, right: `${w * 0.06}px`, top: `${h * 0.108}px`, display: 'flex', justifyContent: 'space-between', fontFamily: ctx.look.fontBody, fontWeight: '700', fontSize: `${Math.round(24 * k)}px`, borderBottom: `${Math.round(2 * k)}px solid ${INK}`, paddingBottom: `${Math.round(4 * k)}px`, direction: 'rtl' })
      for (const part of ['العدد ٦٠', 'طبعة خاصة', 'الثمن قرشان']) {
        const d = div('pl-date-part')
        lineUnit(d, part)
        date.append(d)
      }
      const head = div('pl-head', { position: 'absolute', left: `${w * 0.06}px`, right: `${w * 0.06}px`, top: `${h * 0.135}px`, textAlign: 'center', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(78 * k)}px`, lineHeight: '1.1' })
      lineUnit(head, p.text)
      pic = { x: w * 0.22, y: h * 0.25, w: w * 0.56, h: h * 0.42 }
      const frame = div('pl-photo', { position: 'absolute', left: `${pic.x}px`, top: `${pic.y}px`, width: `${pic.w}px`, height: `${pic.h}px`, border: `${Math.round(3 * k)}px solid ${INK}`, boxSizing: 'border-box', overflow: 'hidden', background: PAPER })
      frame.append(canvas)
      const cols = document.createElementNS(SVG, 'svg')
      cols.setAttribute('viewBox', `0 0 ${w} ${h}`)
      Object.assign(cols.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
      let bars = ''
      const lineAt = (x: number, y: number, ww: number) => (bars += `<rect x="${x}" y="${y}" width="${ww}" height="${5 * k}" fill="${INK}" fill-opacity="0.38"/>`)
      for (const [x0, x1] of [[w * 0.06, w * 0.2], [w * 0.8, w * 0.94]] as const) for (let y = h * 0.26; y < h * 0.66; y += 13 * k) lineAt(x0, y, (x1 - x0) * (0.7 + 0.3 * Math.abs(Math.sin(y))))
      for (let c = 0; c < 4; c++) for (let y = h * 0.72; y < h * 0.95; y += 13 * k) lineAt(w * (0.06 + c * 0.225), y, w * 0.2 * (0.75 + 0.25 * Math.abs(Math.sin(y * 3 + c))))
      bars += `<line x1="${w * 0.06}" y1="${h * 0.7}" x2="${w * 0.94}" y2="${h * 0.7}" stroke="${INK}" stroke-width="${2 * k}"/>`
      cols.innerHTML = bars
      sheet.append(cols, mast, date, head, frame)
      if (p.look === 'vintage') frame.style.filter = 'sepia(0.5)'
    } else {
      Object.assign(sheet.style, { background: '#fafafa' })
      const lines = document.createElementNS(SVG, 'svg')
      lines.setAttribute('viewBox', `0 0 ${w} ${h}`)
      Object.assign(lines.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
      let l = ''
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 2 + ctx.rng() * 0.03
        const r0 = h * (0.22 + ctx.rng() * 0.12)
        const wd = (1 + ctx.rng() * 5) * k
        l += `<line x1="${w / 2 + Math.cos(a) * r0}" y1="${h * 0.4 + Math.sin(a) * r0}" x2="${w / 2 + Math.cos(a) * h}" y2="${h * 0.4 + Math.sin(a) * h}" stroke="#0c0c0c" stroke-width="${wd}"/>`
      }
      lines.innerHTML = l
      pic = { x: w * 0.12, y: h * 0.12, w: w * 0.76, h: h * 0.56 }
      const frame = div('pl-art', { position: 'absolute', left: `${pic.x}px`, top: `${pic.y}px`, width: `${pic.w}px`, height: `${pic.h}px`, borderRadius: '46% 46% 40% 40%', overflow: 'hidden' })
      frame.append(canvas)
      const word = div('pl-impact', { position: 'absolute', left: '0', right: '0', top: `${h * 0.7}px`, textAlign: 'center', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(230 * k)}px`, color: '#0c0c0c', lineHeight: '1', WebkitTextStroke: `${Math.round(6 * k)}px #fafafa` } as Partial<CSSStyleDeclaration>)
      lineUnit(word, p.text)
      sheet.append(lines, frame, word)
    }
    canvas.width = Math.round(pic.w)
    canvas.height = Math.round(pic.h)
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' })
    return {
      async update(localT) {
        if (!drawn) {
          await ready
          const g = canvas.getContext('2d', { willReadFrequently: true })!
          const L = lumaGrid(img, canvas.width, canvas.height)
          if (p.look === 'banknote') {
            g.fillStyle = '#ece4cc'
            g.fillRect(0, 0, canvas.width, canvas.height)
            engrave(g, L, canvas.width, canvas.height, '#2d5640', k)
          } else if (p.look === 'press' || p.look === 'vintage') {
            g.fillStyle = PAPER
            g.fillRect(0, 0, canvas.width, canvas.height)
            halftone(g, L, canvas.width, canvas.height, INK, k)
          } else impactArt(g, L, canvas.width, canvas.height)
          drawn = true
        }
        const t = localT - p.at
        const e = seg(t, -LOOK.enter, 0)
        if (p.look === 'impact') {
          const hitShake = t > 0 && t < 0.25 ? Math.sin(t * 90) * (1 - t / 0.25) * 14 * k : 0
          sheet.style.opacity = e > 0 ? '1' : '0'
          sheet.style.transform = `translate(${f4(hitShake)}px, 0) scale(${f4(1.25 - 0.25 * easeOutCubic(e))})`
        } else if (p.look === 'press' || p.look === 'vintage') {
          sheet.style.opacity = f4(Math.min(1, e * 3))
          sheet.style.transform = `translateY(${f4((1 - easeOutBack(e, 1.1)) * -h * 0.6)}px) rotate(${f4((1 - e) * -8)}deg)`
        } else {
          sheet.style.opacity = f4(Math.min(1, e * 3))
          sheet.style.transform = `scale(${f4(0.85 + 0.15 * easeOutBack(e))})`
        }
        if (number) number.textContent = Math.round(p.number * easeOutCubic(seg(t, 0, LOOK.count))).toLocaleString('en-US') + '.'
      },
    }
  },
}
