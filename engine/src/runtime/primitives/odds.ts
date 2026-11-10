import { easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import {
  DIE, loadedDieParams, serverBatchParams, tokenOddsParams, tokenStreamParams,
  type LoadedDieParams, type ServerBatchParams, type TokenOddsParams, type TokenStreamParams,
} from '../../core/params/odds'
import { FONT_MONO } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

const f3 = (x: number) => x.toFixed(3)
const ZWJ = '‍'
const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]!)
const div = (part: string, style: Partial<CSSStyleDeclaration> = {}) => {
  const d = document.createElement('div')
  d.dataset.mbaPart = part
  Object.assign(d.style, style)
  return d
}

/** token-stream: the line builds chip by chip; a word split into pieces keeps its letters joined. */
export const tokenStream: Primitive<TokenStreamParams> = {
  id: 'token-stream',
  params: tokenStreamParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const accent = ctx.look.vars.accent
    const wrap = div('ts-wrap', { position: 'absolute', left: `${s.x}px`, width: `${s.w}px`, top: `${s.y + p.y * s.h}px`, transform: 'translateY(-50%)', textAlign: 'center' })
    if (p.label) {
      const lab = div('ts-label', { fontFamily: FONT_MONO, fontSize: `${Math.round(30 * k)}px`, letterSpacing: '0.08em', opacity: '0.6', marginBottom: `${Math.round(26 * k)}px`, direction: 'rtl' })
      lineUnit(lab, p.label)
      wrap.append(lab)
    }
    const line = div('ts-line', { display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: `${Math.round(10 * k)}px`, direction: 'rtl', maxWidth: `${s.w}px`, fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${Math.round(p.size * k)}px`, lineHeight: '1.45' })
    wrap.append(line)
    ctx.layer.append(wrap)
    const chips = p.tokens.map((tok, i) => {
      const prevJoin = i > 0 && p.tokens[i - 1]!.joinNext
      const text = (prevJoin ? ZWJ : '') + tok.text + (tok.joinNext ? ZWJ : '')
      const c = div('ts-chip', {
        padding: `${Math.round(4 * k)}px ${Math.round(16 * k)}px`, borderRadius: `${Math.round(14 * k)}px`,
        background: i % 2 ? 'rgba(255,90,31,0.16)' : 'rgba(22,19,15,0.08)', border: `${Math.max(1, Math.round(2 * k))}px solid rgba(22,19,15,0.12)`,
        marginInlineStart: prevJoin ? `${Math.round(-6 * k)}px` : '0', opacity: '0',
      })
      lineUnit(c, text)
      line.append(c)
      return c
    })
    const cursor = div('ts-cursor', { width: `${Math.round(6 * k)}px`, height: `${Math.round(p.size * 1.1 * k)}px`, background: accent, borderRadius: `${Math.round(3 * k)}px` })
    line.append(cursor)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        let shown = 0
        chips.forEach((c, i) => {
          const a = easeOutBack(seg(t, p.tokens[i]!.at, p.tokens[i]!.at + 0.22), 1.6)
          if (t >= p.tokens[i]!.at) shown = i + 1
          c.style.opacity = f3(Math.min(1, seg(t, p.tokens[i]!.at, p.tokens[i]!.at + 0.1)))
          c.style.transform = a < 1 ? `translateY(${f3((1 - a) * 18 * k)}px) scale(${f3(0.85 + 0.15 * a)})` : ''
          // The newest chip glows in the accent.
          const fresh = t >= p.tokens[i]!.at && i === shown - 1
          c.style.boxShadow = fresh ? `0 0 0 ${Math.round(3 * k)}px ${accent}` : ''
        })
        // The cursor sits after the last chip shown and blinks between tokens.
        line.insertBefore(cursor, chips[shown] ?? null)
        cursor.style.opacity = Math.floor(t * 3) % 2 === 0 ? '1' : '0.25'
      },
    }
  },
}

/** Temperature at local t (linear between keys; 1 with none). */
function tempAt(keys: TokenOddsParams['temps'], t: number): number {
  if (!keys.length) return 1
  if (t <= keys[0]!.at) return keys[0]!.t
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!
    const b = keys[i]!
    if (t <= b.at) return a.t + (b.t - a.t) * easeInOutCubic(seg(t, a.at, b.at))
  }
  return keys[keys.length - 1]!.t
}
/** Softmax of log-probabilities over temperature T. */
const reshape = (ps: number[], T: number) => {
  const w = ps.map((q) => Math.pow(q, 1 / T))
  const sum = w.reduce((a, b) => a + b, 0)
  return w.map((x) => x / sum)
}

/** token-odds: a card with the text so far and the next-token candidates as live probability bars. */
export const tokenOdds: Primitive<TokenOddsParams> = {
  id: 'token-odds',
  params: tokenOddsParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const accent = ctx.look.vars.accent
    const card = div('to-card', { position: 'absolute', left: `${s.x + s.w * 0.04}px`, width: `${s.w * 0.92}px`, top: `${s.y + p.top * s.h}px`, background: '#16130f', color: '#f3efe7', borderRadius: `${Math.round(30 * k)}px`, padding: `${Math.round(44 * k)}px ${Math.round(44 * k)}px`, boxSizing: 'border-box', boxShadow: '0 24px 60px #0004', direction: 'rtl' })
    const promptRow = div('to-prompt', { display: 'flex', alignItems: 'center', gap: `${Math.round(14 * k)}px`, fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${Math.round(66 * k)}px`, marginBottom: `${Math.round(40 * k)}px` })
    const pt = div('to-prompt-text')
    lineUnit(pt, p.prompt)
    const slot = div('to-slot', { minWidth: `${Math.round(150 * k)}px`, padding: `0 ${Math.round(14 * k)}px`, borderRadius: `${Math.round(12 * k)}px`, border: `${Math.round(3 * k)}px dashed rgba(243,239,231,0.45)`, color: accent, textAlign: 'center' })
    const slotText = div('to-slot-text', { visibility: 'hidden' })
    lineUnit(slotText, p.pick ? p.options[p.pick.index]!.text : '؟')
    slot.append(slotText)
    promptRow.append(pt, slot)
    card.append(promptRow)
    const rows = p.options.map((o) => {
      const row = div('to-row', { display: 'flex', alignItems: 'center', gap: `${Math.round(18 * k)}px`, margin: `${Math.round(22 * k)}px 0`, fontFamily: ctx.look.fontBody, fontWeight: '700', fontSize: `${Math.round(48 * k)}px` })
      const name = div('to-name', { width: `${Math.round(230 * k)}px`, flex: 'none' })
      lineUnit(name, o.text)
      const track = div('to-track', { flex: '1', height: `${Math.round(40 * k)}px`, background: 'rgba(243,239,231,0.1)', borderRadius: `${Math.round(20 * k)}px`, overflow: 'hidden' })
      const bar = div('to-bar', { height: '100%', width: '0%', background: 'rgba(243,239,231,0.85)', borderRadius: `${Math.round(15 * k)}px` })
      track.append(bar)
      const pct = div('to-pct', { width: `${Math.round(130 * k)}px`, flex: 'none', textAlign: 'left', fontFamily: FONT_MONO, fontSize: `${Math.round(40 * k)}px` })
      const pctText = document.createElement('span')
      pct.append(pctText)
      row.append(name, track, pct)
      card.append(row)
      return { row, bar, pctText }
    })
    let slider: { knob: HTMLElement; val: HTMLElement } | null = null
    if (p.showTemp) {
      const box = div('to-temp', { marginTop: `${Math.round(30 * k)}px`, paddingTop: `${Math.round(24 * k)}px`, borderTop: `${Math.max(1, Math.round(2 * k))}px solid rgba(243,239,231,0.15)`, direction: 'ltr' })
      const head = div('to-temp-head', { display: 'flex', justifyContent: 'space-between', fontFamily: FONT_MONO, fontSize: `${Math.round(32 * k)}px`, marginBottom: `${Math.round(16 * k)}px` })
      const name = document.createElement('span')
      name.textContent = 'temperature'
      const val = document.createElement('span')
      val.style.color = accent
      head.append(name, val)
      const rail = div('to-temp-rail', { position: 'relative', height: `${Math.round(10 * k)}px`, borderRadius: `${Math.round(5 * k)}px`, background: 'linear-gradient(90deg,#4aa3ff,#ff5a1f)' })
      const knob = div('to-temp-knob', { position: 'absolute', top: '50%', width: `${Math.round(38 * k)}px`, height: `${Math.round(38 * k)}px`, borderRadius: '50%', background: '#f3efe7', transform: 'translate(-50%,-50%)', boxShadow: '0 4px 12px #0006' })
      rail.append(knob)
      box.append(head, rail)
      card.append(box)
      slider = { knob, val }
    }
    ctx.layer.append(card)
    const base = p.options.map((o) => o.p)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const enter = easeOutCubic(seg(t, 0, 0.35))
        card.style.opacity = f3(enter)
        card.style.transform = `translateY(${f3((1 - enter) * 30 * k)}px)`
        const T = tempAt(p.temps, t)
        const q = reshape(base, T)
        const grow = easeOutCubic(seg(t, p.at, p.at + 0.6))
        const picked = p.pick && t >= p.pick.at ? p.pick.index : -1
        rows.forEach((r, i) => {
          r.bar.style.width = `${f3(100 * q[i]! * grow)}%`
          r.pctText.textContent = `${toArabicDigits(Math.round(100 * q[i]! * grow))}٪`
          const lit = i === picked
          r.bar.style.background = lit ? accent : 'rgba(243,239,231,0.85)'
          r.row.style.opacity = picked >= 0 && !lit ? '0.45' : '1'
        })
        const fill = p.pick ? seg(t, p.pick.at + 0.15, p.pick.at + 0.45) : 0
        slotText.style.visibility = fill > 0 ? 'visible' : 'hidden'
        slot.style.borderStyle = fill > 0 ? 'solid' : 'dashed'
        slot.style.transform = fill > 0 && fill < 1 ? `scale(${f3(1 + 0.12 * Math.sin(Math.PI * fill))})` : ''
        if (slider) {
          slider.knob.style.left = `${f3((100 * (T - 0.05)) / 1.95)}%`
          slider.val.textContent = T.toFixed(2)
        }
      },
    }
  },
}

/** Rotation (deg) that brings face i to the front: front, right, back, left, top, bottom. */
const FACE_ROT: readonly [number, number][] = [[0, 0], [0, -90], [0, 180], [0, 90], [-90, 0], [90, 0]]

/** loaded-die: a CSS 3D die with a token on each face; each roll tumbles and lands on its face. */
export const loadedDie: Primitive<LoadedDieParams> = {
  id: 'loaded-die',
  params: loadedDieParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const accent = ctx.look.vars.accent
    const size = Math.round(340 * k)
    const stage = div('ld-stage', { position: 'absolute', left: `${s.x + s.w / 2 - size / 2}px`, top: `${s.y + p.y * s.h - size / 2}px`, width: `${size}px`, height: `${size}px`, perspective: `${Math.round(1400 * k)}px` })
    const cube = div('ld-cube', { position: 'absolute', inset: '0', transformStyle: 'preserve-3d' })
    stage.append(cube)
    const top = p.faces[0]!
    const place = ['', `rotateY(90deg)`, `rotateY(180deg)`, `rotateY(-90deg)`, `rotateX(90deg)`, `rotateX(-90deg)`]
    p.faces.forEach((f, i) => {
      const strong = f === top
      const face = div('ld-face', {
        position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
        borderRadius: `${Math.round(42 * k)}px`, background: strong ? accent : '#f7f3ea', color: strong ? '#ffffff' : '#16130f',
        border: `${Math.round(6 * k)}px solid #16130f`, fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(70 * k)}px`,
        transform: `${place[i]} translateZ(${size / 2}px)`, backfaceVisibility: 'hidden',
      })
      lineUnit(face, f)
      cube.append(face)
    })
    const shadow = div('ld-shadow', { position: 'absolute', left: `${s.x + s.w / 2 - size * 0.55}px`, top: `${s.y + p.y * s.h + size * 0.62}px`, width: `${size * 1.1}px`, height: `${Math.round(40 * k)}px`, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(0,0,0,0.28), transparent)' })
    ctx.layer.append(shadow, stage)
    if (p.legend) {
      const counts = new Map<string, number>()
      for (const f of p.faces) counts.set(f, (counts.get(f) ?? 0) + 1)
      const leg = div('ld-legend', { position: 'absolute', left: `${s.x}px`, width: `${s.w}px`, top: `${s.y + p.y * s.h + size * 0.95}px`, display: 'flex', justifyContent: 'center', gap: `${Math.round(22 * k)}px`, direction: 'rtl', fontFamily: ctx.look.fontBody, fontWeight: '700', fontSize: `${Math.round(36 * k)}px` })
      for (const [f, c] of [...counts].sort((a, b) => b[1] - a[1])) {
        const chip = div('ld-chip', { padding: `${Math.round(8 * k)}px ${Math.round(20 * k)}px`, borderRadius: `${Math.round(30 * k)}px`, background: f === top ? accent : 'rgba(22,19,15,0.08)', color: f === top ? '#fff' : 'inherit' })
        lineUnit(chip, `${f} × ${toArabicDigits(c)}`)
        leg.append(chip)
      }
      ctx.layer.append(leg)
    }
    return {
      update(localT) {
        const t = Math.max(0, localT)
        // The last roll that has started decides the pose; before any roll the die rests on face 0.
        let rx = -18
        let ry = 24
        let lift = 0
        let from: [number, number] = [-18, 24]
        for (const r of p.rolls) {
          if (t < r.at) break
          const [fx, fy] = FACE_ROT[r.face]!
          const target: [number, number] = [fx - 14, fy + 18]
          const u = seg(t, r.at, r.at + DIE.tumble)
          const e = easeOutCubic(u)
          // Two extra turns while it tumbles.
          rx = from[0] + (target[0] + 720 - from[0]) * e
          ry = from[1] + (target[1] + 360 - from[1]) * e
          lift = Math.sin(Math.PI * Math.min(1, u * 1.3)) * (1 - u) * 160 * k
          if (u >= 1) from = target
        }
        cube.style.transform = `translateY(${f3(-lift)}px) rotateX(${f3(rx)}deg) rotateY(${f3(ry)}deg)`
        shadow.style.transform = `scale(${f3(1 - lift / (400 * k))})`
        const enter = easeOutBack(seg(t, 0, 0.35), 1.5)
        stage.style.opacity = f3(Math.min(1, seg(t, 0, 0.15)))
        stage.style.transform = `scale(${f3(0.7 + 0.3 * enter)})`
      },
    }
  },
}

/** server-batch: questions from several people fly into one server; your answer comes out and a word flips. */
export const serverBatch: Primitive<ServerBatchParams> = {
  id: 'server-batch',
  params: serverBatchParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const accent = ctx.look.vars.accent
    const cx = s.x + s.w / 2
    const rackW = s.w * 0.72
    const rackTop = s.y + s.h * 0.34
    const rackH = s.h * 0.28
    const rack = div('sb-rack', { position: 'absolute', left: `${cx - rackW / 2}px`, top: `${rackTop}px`, width: `${rackW}px`, height: `${rackH}px`, background: '#16130f', borderRadius: `${Math.round(26 * k)}px`, boxShadow: '0 24px 60px #0005', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: `${Math.round(14 * k)}px`, padding: `${Math.round(24 * k)}px`, boxSizing: 'border-box' })
    const leds: HTMLElement[] = []
    for (let i = 0; i < 3; i++) {
      const unit = div('sb-unit', { display: 'flex', alignItems: 'center', gap: `${Math.round(12 * k)}px`, height: `${Math.round(64 * k)}px`, background: '#26221c', borderRadius: `${Math.round(10 * k)}px`, padding: `0 ${Math.round(16 * k)}px` })
      for (let j = 0; j < 4; j++) {
        const led = div('sb-led', { width: `${Math.round(20 * k)}px`, height: `${Math.round(20 * k)}px`, borderRadius: '50%', background: '#3a352d' })
        leds.push(led)
        unit.append(led)
      }
      rack.append(unit)
    }
    const label = div('sb-label', { position: 'absolute', left: `${cx - rackW / 2}px`, width: `${rackW}px`, top: `${rackTop - Math.round(56 * k)}px`, textAlign: 'center', fontFamily: FONT_MONO, fontSize: `${Math.round(30 * k)}px`, letterSpacing: '0.1em', opacity: '0.7' })
    label.textContent = 'SERVER'
    ctx.layer.append(rack, label)
    // Question cards start spread across the top and fly into the rack.
    const n = p.questions.length
    const cards = p.questions.map((q, i) => {
      const yours = i === 0
      const c = div('sb-q', { position: 'absolute', top: '0', left: '0', padding: `${Math.round(14 * k)}px ${Math.round(22 * k)}px`, borderRadius: `${Math.round(22 * k)}px`, background: yours ? accent : '#ffffff', color: yours ? '#ffffff' : '#16130f', fontFamily: ctx.look.fontBody, fontWeight: '700', fontSize: `${Math.round(40 * k)}px`, boxShadow: '0 10px 30px #0002', direction: 'rtl', whiteSpace: 'nowrap' })
      const who = div('sb-who', { fontSize: `${Math.round(22 * k)}px`, opacity: '0.75' })
      lineUnit(who, yours ? 'إنت' : `مستخدم ${toArabicDigits(i + 1)}`)
      const tx = div('sb-qt')
      lineUnit(tx, q)
      c.append(who, tx)
      ctx.layer.append(c)
      const col = n === 1 ? 0.5 : i / (n - 1)
      return { c, x0: s.x + s.w * (0.12 + 0.76 * col), y0: s.y + s.h * (i % 2 ? 0.17 : 0.07) }
    })
    // Your answer bubble under the rack.
    const ans = div('sb-ans', { position: 'absolute', left: `${s.x + s.w * 0.06}px`, width: `${s.w * 0.88}px`, top: `${rackTop + rackH + s.h * 0.08}px`, background: '#ffffff', color: '#16130f', borderRadius: `${Math.round(26 * k)}px`, padding: `${Math.round(26 * k)}px ${Math.round(30 * k)}px`, boxSizing: 'border-box', boxShadow: '0 18px 50px #0003', direction: 'rtl', fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${Math.round(58 * k)}px`, display: 'flex', flexWrap: 'wrap', gap: '0.3em', alignItems: 'center' })
    const a0 = div('sb-a0')
    lineUnit(a0, p.answer[0])
    const flip = div('sb-flip', { position: 'relative', padding: '0 0.2em', borderRadius: '0.2em' })
    const w0 = div('sb-w0')
    lineUnit(w0, p.changed[0])
    const w1 = div('sb-w1', { position: 'absolute', inset: '0', padding: '0 0.2em', opacity: '0' })
    lineUnit(w1, p.changed[1])
    flip.append(w0, w1)
    const a1 = div('sb-a1')
    lineUnit(a1, p.answer[1])
    ans.append(a0, flip, a1)
    ctx.layer.append(ans)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const rackIn = easeOutCubic(seg(t, 0, 0.35))
        rack.style.opacity = label.style.opacity = f3(rackIn)
        cards.forEach(({ c, x0, y0 }, i) => {
          const start = p.at + i * 0.08
          const e = easeInOutCubic(seg(t, start + 0.35, start + 0.95))
          const tx = x0 + (s.x + s.w / 2 - x0) * e
          const ty = y0 + (rackTop + rackH * 0.45 - y0) * e
          const pop = Math.min(1, seg(t, start, start + 0.2))
          c.style.opacity = f3(pop * (1 - seg(t, start + 0.8, start + 0.95)))
          c.style.transform = `translate(${f3(tx)}px, ${f3(ty)}px) translate(-50%, -50%) scale(${f3(1 - 0.5 * e)})`
        })
        // The LEDs blink while it works (between the arrival and the answer).
        const busy = t > p.at + 0.9 && t < p.outAt + 0.3
        leds.forEach((l, i) => (l.style.background = busy && Math.floor(t * 10 + i * 1.7) % 3 === 0 ? accent : '#3a352d'))
        const out = easeOutBack(seg(t, p.outAt, p.outAt + 0.4), 1.4)
        ans.style.opacity = f3(Math.min(1, seg(t, p.outAt, p.outAt + 0.15)))
        ans.style.transform = `translateY(${f3((1 - out) * 40 * k)}px)`
        const f = seg(t, p.flipAt, p.flipAt + 0.3)
        w0.style.opacity = f3(1 - f)
        w1.style.opacity = f3(f)
        flip.style.background = f > 0 ? `rgba(255,90,31,${f3(0.22 * Math.min(1, f * 2))})` : 'transparent'
        flip.style.transform = f > 0 && f < 1 ? `rotateX(${f3(180 * f)}deg)` : ''
      },
    }
  },
}
