import { easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import { DECK, skillDeckParams, twinSyncParams, type SkillDeckParams, type TwinSyncParams } from '../../core/params/skills-fx'
import { FONT_MONO } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

const f3 = (x: number) => x.toFixed(3)
const SVG = 'http://www.w3.org/2000/svg'
const div = (part: string, style: Partial<CSSStyleDeclaration> = {}) => {
  const d = document.createElement('div')
  d.dataset.mbaPart = part
  Object.assign(d.style, style)
  return d
}
const DARK = '#0f1115'
const PANEL = '#171a21'
const INK = '#e6e8ec'
const PALETTE = ['#ff5a1f', '#4f8cff', '#3ecf8e', '#b37bff', '#ffb020']

/** A skill card: a coloured glyph tile, the name, and a version pill. */
function skillCard(k: number, w: number, h: number, name: string, ver: string | undefined, colour: string) {
  const c = div('sk-card', { position: 'absolute', left: '0', top: '0', width: `${w}px`, height: `${h}px`, display: 'flex', alignItems: 'center', gap: `${Math.round(14 * k)}px`, padding: `0 ${Math.round(16 * k)}px`, boxSizing: 'border-box', borderRadius: `${Math.round(16 * k)}px`, background: '#f7f3ea', color: '#16130f', boxShadow: '0 10px 26px rgba(0,0,0,0.35)', direction: 'ltr', fontFamily: FONT_MONO, fontWeight: '700', fontSize: `${Math.round(h * 0.3)}px`, willChange: 'transform' })
  const tile = div('sk-tile', { width: `${Math.round(h * 0.62)}px`, height: `${Math.round(h * 0.62)}px`, borderRadius: `${Math.round(10 * k)}px`, background: colour, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' })
  const g = document.createElementNS(SVG, 'svg')
  g.setAttribute('viewBox', '0 0 24 24')
  Object.assign(g.style, { width: '62%', height: '62%' })
  g.innerHTML = '<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="#fff"/>'
  tile.append(g)
  const nm = div('sk-name', { flex: '1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })
  nm.textContent = name
  c.append(tile, nm)
  if (ver) {
    const v = div('sk-ver', { padding: `${Math.round(2 * k)}px ${Math.round(10 * k)}px`, borderRadius: `${Math.round(20 * k)}px`, background: '#16130f', color: '#f7f3ea', fontSize: `${Math.round(h * 0.26)}px`, flex: 'none' })
    v.textContent = ver
    c.append(v)
  }
  return c
}

/** An app window with a title bar; `slot(i)` is the top-left of the i-th card place in its body. */
function dock(k: number, x: number, y: number, w: number, h: number, name: string, tint: string) {
  const win = div('sk-dock', { position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, background: DARK, borderRadius: `${Math.round(24 * k)}px`, boxShadow: '0 24px 60px rgba(0,0,0,0.4)', overflow: 'hidden', border: `${Math.max(1, Math.round(2 * k))}px solid #262a33` })
  const bar = div('sk-bar', { height: `${Math.round(64 * k)}px`, display: 'flex', alignItems: 'center', gap: `${Math.round(10 * k)}px`, padding: `0 ${Math.round(18 * k)}px`, background: PANEL, color: INK, fontFamily: FONT_MONO, fontWeight: '700', fontSize: `${Math.round(28 * k)}px`, direction: 'ltr' })
  const logo = div('sk-logo', { width: `${Math.round(34 * k)}px`, height: `${Math.round(34 * k)}px`, borderRadius: `${Math.round(9 * k)}px`, background: tint })
  const nm = document.createElement('span')
  nm.textContent = name
  bar.append(logo, nm)
  win.append(bar)
  const q = div('sk-q', { position: 'absolute', left: '0', right: '0', top: `${Math.round(64 * k)}px`, bottom: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', fontWeight: '900', fontSize: `${Math.round(w * 0.42)}px`, color: 'rgba(230,232,236,0.18)' })
  q.textContent = '?'
  q.style.visibility = 'hidden'
  win.append(q)
  const pad = 18 * k
  const bodyTop = y + 64 * k + pad
  return { win, q, slot: (i: number, ch: number) => ({ x: x + pad, y: bodyTop + i * (ch + 12 * k) }), cw: w - 2 * pad }
}

/** skill-deck: the source box fans its skill cards and deals them along arcs into the app windows. */
export const skillDeck: Primitive<SkillDeckParams> = {
  id: 'skill-deck',
  params: skillDeckParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const nd = p.docks.length
    const gap = s.w * 0.04
    const dw = (s.w - gap * (nd - 1)) / nd
    const ch = Math.round((nd > 2 ? 84 : 104) * k)
    const dh = Math.max(s.h * 0.3, 64 * k + 36 * k + p.skills.length * (ch + 12 * k) + 40 * k)
    const dy = s.y + s.h * (p.source ? 0.46 : 0.3)
    // RTL: the first dock sits on the right.
    const docks = p.docks.map((d, i) => dock(k, s.x + (nd - 1 - i) * (dw + gap), dy, dw, dh, d.name, d.tint ?? PALETTE[(i + 1) % PALETTE.length]!))
    for (const d of docks) ctx.layer.append(d.win)
    // The source: a package box with a lid and a file label.
    let box: { el: HTMLElement; lid: HTMLElement; cx: number; top: number } | null = null
    if (p.source) {
      const bw = s.w * 0.36
      const bh = s.h * 0.12
      const bx = s.x + s.w / 2 - bw / 2
      const by = s.y + s.h * 0.2
      const el = div('sk-box', { position: 'absolute', left: `${bx}px`, top: `${by}px`, width: `${bw}px`, height: `${bh}px`, perspective: `${Math.round(900 * k)}px` })
      const front = div('sk-box-front', { position: 'absolute', inset: '0', background: 'linear-gradient(180deg,#c96442,#a44e32)', borderRadius: `${Math.round(18 * k)}px`, boxShadow: '0 18px 40px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: FONT_MONO, fontWeight: '700', fontSize: `${Math.round(36 * k)}px`, direction: 'ltr' })
      front.textContent = p.source
      const lid = div('sk-box-lid', { position: 'absolute', left: `${-0.04 * bw}px`, width: `${1.08 * bw}px`, top: `${-0.22 * bh}px`, height: `${0.3 * bh}px`, background: '#d9744f', borderRadius: `${Math.round(12 * k)}px`, transformOrigin: '50% 100%' })
      el.append(front, lid)
      ctx.layer.append(el)
      box = { el, lid, cx: s.x + s.w / 2, top: by }
    }
    const cw = docks[0]!.cw
    const dealTo = p.dealTo ?? p.docks.map((_, i) => i).filter((i) => !p.preloaded.includes(i))
    type Inst = { el: HTMLElement; d: number; i: number; dealt: boolean }
    const insts: Inst[] = []
    p.docks.forEach((_, d) => {
      p.skills.forEach((sk, i) => {
        const pre = p.preloaded.includes(d)
        const dealt = !pre && p.dealAt !== undefined && dealTo.includes(d)
        if (!pre && !dealt) return
        const el = skillCard(k, cw, ch, sk.name, sk.ver, PALETTE[i % PALETTE.length]!)
        ctx.layer.append(el)
        insts.push({ el, d, i, dealt })
      })
    })
    const n = p.skills.length
    const fanPos = (i: number) => {
      const mid = (n - 1) / 2
      const cx = box ? box.cx : s.x + s.w / 2
      const top = box ? box.top : s.y + s.h * 0.1
      return { x: cx - cw / 2 + (i - mid) * cw * 0.32, y: top - ch * 1.25 - Math.abs(i - mid) * -0.25 * ch, rot: (i - mid) * 7 }
    }
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const enter = easeOutCubic(seg(t, 0, 0.35))
        for (const d of docks) {
          d.win.style.opacity = f3(enter)
          d.win.style.transform = `translateY(${f3((1 - enter) * 40 * k)}px)`
        }
        if (box) {
          const b = easeOutBack(seg(t, 0.05, 0.4), 1.5)
          box.el.style.opacity = f3(Math.min(1, seg(t, 0.05, 0.2)))
          box.el.style.transform = `scale(${f3(0.6 + 0.4 * b)})`
          box.lid.style.transform = `rotateX(${f3(-120 * easeOutBack(seg(t, p.fanAt, p.fanAt + 0.35), 1.4))}deg)`
        }
        // Docks: question mark until the first card lands; a glow flash on each landing.
        p.docks.forEach((_, d) => {
          const firstLand = p.dealAt !== undefined && dealTo.includes(d) ? p.dealAt + DECK.fly + dealTo.indexOf(d) * 0.08 : Infinity
          docks[d]!.q.style.visibility = p.question === d && t < firstLand ? 'visible' : 'hidden'
          const flash = t >= firstLand ? 1 - seg(t, firstLand, firstLand + 0.6) : 0
          docks[d]!.win.style.boxShadow = flash > 0 ? `0 0 0 ${f3(6 * k * flash)}px rgba(255,90,31,${f3(0.8 * flash)}), 0 24px 60px rgba(0,0,0,0.4)` : '0 24px 60px rgba(0,0,0,0.4)'
        })
        for (const c of insts) {
          const slot = docks[c.d]!.slot(c.i, ch)
          if (!c.dealt) {
            const a = easeOutBack(seg(t, 0.25 + c.i * 0.08, 0.6 + c.i * 0.08), 1.5)
            c.el.style.opacity = f3(Math.min(1, seg(t, 0.25 + c.i * 0.08, 0.4 + c.i * 0.08)))
            c.el.style.transform = `translate(${f3(slot.x)}px, ${f3(slot.y)}px) scale(${f3(0.8 + 0.2 * a)})`
            continue
          }
          const fan = fanPos(c.i)
          const fanIn = easeOutBack(seg(t, p.fanAt + 0.15 + c.i * 0.06, p.fanAt + 0.5 + c.i * 0.06), 1.4)
          const start = p.dealAt! + c.i * DECK.stagger + dealTo.indexOf(c.d) * 0.08
          const u = seg(t, start, start + DECK.fly)
          const e = easeInOutCubic(u)
          const origin = box ? { x: box.cx - cw / 2, y: box.top + 10 * k } : fan
          // Out of the box to the fan, then along an arc to the slot.
          let x = origin.x + (fan.x - origin.x) * fanIn
          let y = origin.y + (fan.y - origin.y) * fanIn
          let rot = fan.rot * fanIn
          if (u > 0) {
            const cx = (fan.x + slot.x) / 2 + (c.d % 2 ? -1 : 1) * s.w * 0.12
            const cy = Math.min(fan.y, slot.y) - s.h * 0.08
            x = (1 - e) ** 2 * fan.x + 2 * (1 - e) * e * cx + e * e * slot.x
            y = (1 - e) ** 2 * fan.y + 2 * (1 - e) * e * cy + e * e * slot.y
            rot = fan.rot * (1 - e) + 360 * Math.sin(Math.PI * e) * 0.05 * (c.d % 2 ? -1 : 1)
          }
          const vis = box ? t >= p.fanAt + 0.15 + c.i * 0.06 : t >= start
          c.el.style.visibility = vis ? 'visible' : 'hidden'
          c.el.style.opacity = '1'
          c.el.style.zIndex = u > 0 && u < 1 ? '5' : '2'
          const sc = u > 0 && u < 1 ? 1 + 0.12 * Math.sin(Math.PI * u) : 1
          c.el.style.transform = `translate(${f3(x)}px, ${f3(y)}px) rotate(${f3(rot)}deg) scale(${f3(sc)})`
        }
      },
    }
  },
}

/** twin-sync: your machine and a friend's; the lock file snaps shut and the friend's rows fill to match. */
export const twinSync: Primitive<TwinSyncParams> = {
  id: 'twin-sync',
  params: twinSyncParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const accent = ctx.look.vars.accent
    const pw = s.w * 0.46
    const ph = s.h * 0.5
    const py = s.y + s.h * 0.34
    const rowH = Math.round(Math.min(92 * k, (ph - 120 * k) / p.rows.length - 10 * k))
    const panel = (x: number, label: string, mine: boolean) => {
      const el = div('ts-panel', { position: 'absolute', left: `${x}px`, top: `${py}px`, width: `${pw}px`, height: `${ph}px`, background: DARK, borderRadius: `${Math.round(26 * k)}px`, boxShadow: '0 24px 60px rgba(0,0,0,0.4)', padding: `${Math.round(20 * k)}px`, boxSizing: 'border-box' })
      const headRow = div('ts-head', { display: 'flex', alignItems: 'center', gap: `${Math.round(14 * k)}px`, marginBottom: `${Math.round(18 * k)}px`, direction: 'rtl', color: INK, fontFamily: ctx.look.fontBody, fontWeight: '800', fontSize: `${Math.round(34 * k)}px` })
      const av = div('ts-av', { width: `${Math.round(52 * k)}px`, height: `${Math.round(52 * k)}px`, borderRadius: '50%', background: mine ? accent : '#4f8cff', display: 'flex', alignItems: 'center', justifyContent: 'center' })
      const g = document.createElementNS(SVG, 'svg')
      g.setAttribute('viewBox', '0 0 24 24')
      Object.assign(g.style, { width: '60%', height: '60%' })
      g.innerHTML = '<circle cx="12" cy="8" r="4" fill="#fff"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="#fff"/>'
      av.append(g)
      const nm = div('ts-name')
      lineUnit(nm, label)
      headRow.append(av, nm)
      el.append(headRow)
      const rows = p.rows.map((r, i) => {
        const row = div('ts-row', { height: `${rowH}px`, marginBottom: `${Math.round(10 * k)}px`, borderRadius: `${Math.round(14 * k)}px`, border: `${Math.max(1, Math.round(2 * k))}px dashed rgba(230,232,236,0.18)`, position: 'relative', boxSizing: 'border-box' })
        const fill = div('ts-fill', { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', gap: `${Math.round(10 * k)}px`, padding: `0 ${Math.round(14 * k)}px`, borderRadius: `${Math.round(14 * k)}px`, background: '#f7f3ea', color: '#16130f', fontFamily: FONT_MONO, fontWeight: '700', fontSize: `${Math.round(rowH * 0.3)}px`, direction: 'ltr' })
        const tile = div('ts-tile', { width: `${Math.round(rowH * 0.5)}px`, height: `${Math.round(rowH * 0.5)}px`, borderRadius: `${Math.round(8 * k)}px`, background: PALETTE[i % PALETTE.length]!, flex: 'none' })
        const nm2 = div('ts-skill', { flex: '1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })
        nm2.textContent = r.name
        fill.append(tile, nm2)
        if (r.ver) {
          const v = div('ts-ver', { padding: `${Math.round(2 * k)}px ${Math.round(8 * k)}px`, borderRadius: `${Math.round(16 * k)}px`, background: '#16130f', color: '#f7f3ea', fontSize: `${Math.round(rowH * 0.28)}px` })
          v.textContent = r.ver
          fill.append(v)
        }
        row.append(fill)
        el.append(row)
        return { row, fill }
      })
      ctx.layer.append(el)
      return { el, rows }
    }
    const you = panel(s.x + s.w - pw, p.you, true)
    const friend = panel(s.x, p.friend, false)
    // The lock card between and above the panels.
    const lw = s.w * 0.5
    const lock = div('ts-lock', { position: 'absolute', left: `${s.x + s.w / 2 - lw / 2}px`, top: `${s.y + s.h * 0.16}px`, width: `${lw}px`, padding: `${Math.round(18 * k)}px`, boxSizing: 'border-box', background: '#f7f3ea', borderRadius: `${Math.round(20 * k)}px`, boxShadow: '0 18px 44px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: `${Math.round(16 * k)}px`, direction: 'ltr', fontFamily: FONT_MONO, fontWeight: '700', fontSize: `${Math.round(32 * k)}px`, color: '#16130f' })
    const padSvg = document.createElementNS(SVG, 'svg')
    padSvg.setAttribute('viewBox', '0 0 24 30')
    Object.assign(padSvg.style, { width: `${Math.round(54 * k)}px`, height: `${Math.round(68 * k)}px`, flex: 'none', overflow: 'visible' })
    padSvg.innerHTML = '<g class="shackle"><path d="M6 13V8a6 6 0 0 1 12 0v5" fill="none" stroke="#16130f" stroke-width="3"/></g><rect x="3" y="13" width="18" height="15" rx="3" fill="#ff5a1f"/><circle cx="12" cy="20" r="2.2" fill="#fff"/>'
    const shackle = padSvg.querySelector('.shackle') as SVGGElement
    const lt = div('ts-lock-text')
    const ln = div('ts-lock-name')
    ln.textContent = p.lock
    const hash = div('ts-hash', { fontSize: `${Math.round(22 * k)}px`, opacity: '0.6' })
    lt.append(ln, hash)
    lock.append(padSvg, lt)
    ctx.layer.append(lock)
    // Match lines from each of your rows to the friend's row.
    const lines = document.createElementNS(SVG, 'svg')
    Object.assign(lines.style, { position: 'absolute', left: '0', top: '0', width: `${ctx.size.w}px`, height: `${ctx.size.h}px`, overflow: 'visible', pointerEvents: 'none' })
    lines.setAttribute('viewBox', `0 0 ${ctx.size.w} ${ctx.size.h}`)
    const rowY = (i: number) => py + 20 * k + 52 * k + 18 * k + i * (rowH + 10 * k) + rowH / 2
    const links = p.rows.map((_, i) => {
      const l = document.createElementNS(SVG, 'line')
      l.setAttribute('x1', f3(s.x + s.w - pw))
      l.setAttribute('x2', f3(s.x + pw))
      l.setAttribute('y1', f3(rowY(i)))
      l.setAttribute('y2', f3(rowY(i)))
      l.setAttribute('stroke-width', f3(4 * k))
      l.setAttribute('stroke-linecap', 'round')
      l.setAttribute('pathLength', '1')
      l.setAttribute('stroke-dasharray', '1 1')
      l.style.stroke = '#3ecf8e'
      lines.append(l)
      return l
    })
    ctx.layer.append(lines)
    const badge = div('ts-badge', { position: 'absolute', left: `${s.x}px`, width: `${s.w}px`, top: `${py + ph + s.h * 0.04}px`, textAlign: 'center' })
    const pill = div('ts-pill', { display: 'inline-block', padding: `${Math.round(12 * k)}px ${Math.round(30 * k)}px`, borderRadius: `${Math.round(40 * k)}px`, background: '#3ecf8e', color: '#0f1115', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(46 * k)}px`, direction: 'rtl' })
    lineUnit(pill, `✓ ${p.badge}`)
    badge.append(pill)
    ctx.layer.append(badge)
    const HEX = '0123456789abcdef'
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const enter = easeOutCubic(seg(t, 0, 0.35))
        for (const pn of [you, friend]) {
          pn.el.style.opacity = f3(enter)
          pn.el.style.transform = `translateY(${f3((1 - enter) * 40 * k)}px)`
        }
        you.rows.forEach((r) => (r.fill.style.opacity = '1'))
        friend.rows.forEach((r, i) => {
          const a = easeOutBack(seg(t, p.fillAt + i * 0.18, p.fillAt + i * 0.18 + 0.3), 1.6)
          r.fill.style.opacity = f3(Math.min(1, seg(t, p.fillAt + i * 0.18, p.fillAt + i * 0.18 + 0.1)))
          r.fill.style.transform = `translateX(${f3((1 - a) * 60 * k)}px) scale(${f3(0.85 + 0.15 * a)})`
        })
        const ld = easeOutBack(seg(t, p.lockAt, p.lockAt + 0.4), 1.4)
        lock.style.opacity = f3(Math.min(1, seg(t, p.lockAt, p.lockAt + 0.12)))
        lock.style.transform = `translateY(${f3((1 - ld) * -60 * k)}px)`
        const snap = easeOutBack(seg(t, p.lockAt + 0.35, p.lockAt + 0.55), 2)
        shackle.setAttribute('transform', `translate(0 ${f3(-5 + 5 * snap)})`)
        // The content hash ticks until the lock snaps, then holds.
        const tick = Math.floor(Math.min(t, p.lockAt + 0.55) * 24)
        let h = 'sha256:'
        for (let i = 0; i < 12; i++) h += HEX[(tick * 7 + i * 13 + (i * i) % 5) % 16]
        hash.textContent = h
        links.forEach((l, i) => l.setAttribute('stroke-dashoffset', f3(1 - easeOutCubic(seg(t, p.matchAt + i * 0.08, p.matchAt + i * 0.08 + 0.35)))))
        const b = easeOutBack(seg(t, p.matchAt + 0.4, p.matchAt + 0.8), 1.6)
        badge.style.opacity = f3(Math.min(1, seg(t, p.matchAt + 0.4, p.matchAt + 0.55)))
        badge.style.transform = `scale(${f3(0.6 + 0.4 * b)})`
      },
    }
  },
}
