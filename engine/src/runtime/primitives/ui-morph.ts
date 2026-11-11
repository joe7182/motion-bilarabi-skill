import { easeInOutCubic, easeOutCubic, seg } from '../../core/ease'
import { fmtNumber } from '../../core/params/data-fx'
import { spring, UI_BOX, uiMorphParams, type UiMorphParams, type UiState } from '../../core/params/ui-morph'
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

const FILL: Record<string, string> = {
  accent: 'var(--mba-accent)',
  ink: 'var(--mba-fg)',
  card: 'color-mix(in srgb, var(--mba-fg) 7%, var(--mba-bg))',
  ok: '#22b45e',
  black: '#0b0b0c',
}
const ON: Record<string, string> = { accent: '#ffffff', ink: 'var(--mba-bg)', card: 'var(--mba-fg)', ok: '#ffffff', black: '#ffffff' }

/** ui-morph: one shape becoming button → loader → check → toggle → slider → tabs → chart → toast → island. */
export const uiMorph: Primitive<UiMorphParams> = {
  id: 'ui-morph',
  params: uiMorphParams,
  build(ctx, p) {
    const s = ctx.safe
    const k = ctx.size.w / 1080
    const U = s.w * p.scale
    const cx = s.x + p.x * s.w
    const cy = s.y + p.y * s.h
    const shape = div(ctx.layer, { position: 'absolute', left: '0', top: '0', boxSizing: 'border-box', overflow: 'hidden', direction: 'rtl', boxShadow: `0 ${f2(18 * k)}px ${f2(44 * k)}px rgba(0,0,0,0.22)` })

    const font = (px: number, weight = 900) => ({ fontFamily: ctx.look.fontDisplay, fontWeight: String(weight), fontSize: `${f2(px)}px`, lineHeight: '1.2', whiteSpace: 'nowrap' })
    const contents = p.states.map((st) => {
      const box = UI_BOX[st.kind]
      const W = box.w * U
      const H = box.h * U
      const c = div(shape, { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ON[box.fill], opacity: '0' })
      const parts: Record<string, HTMLElement | SVGElement> = {}
      const kind: UiState = st.kind
      if (kind === 'button') div(c, font(H * 0.4), st.label ?? 'ابدأ الآن')
      else if (kind === 'loader' || kind === 'check') {
        const svg = document.createElementNS(NS, 'svg')
        svg.setAttribute('viewBox', '0 0 100 100')
        Object.assign(svg.style, { width: '62%', height: '62%' })
        const path = document.createElementNS(NS, 'path')
        path.setAttribute('d', kind === 'loader' ? 'M50 10 A40 40 0 1 1 15.4 30' : 'M24 52 L43 70 L77 32')
        path.setAttribute('fill', 'none')
        path.setAttribute('stroke', 'currentColor')
        path.setAttribute('stroke-width', '11')
        path.setAttribute('stroke-linecap', 'round')
        path.setAttribute('stroke-linejoin', 'round')
        path.setAttribute('pathLength', '1')
        svg.append(path)
        c.append(svg)
        parts.svg = svg
        parts.path = path
      } else if (kind === 'toggle') {
        parts.knob = div(c, { position: 'absolute', top: '10%', height: '80%', borderRadius: '999px', background: '#ffffff', boxShadow: `0 ${f2(4 * k)}px ${f2(10 * k)}px rgba(0,0,0,0.25)` })
      } else if (kind === 'slider') {
        parts.fill = div(c, { position: 'absolute', right: '0', top: '0', bottom: '0', borderRadius: '999px', background: FILL.accent })
        parts.knob = div(c, { position: 'absolute', top: '50%', width: `${f2(H * 1.5)}px`, height: `${f2(H * 1.5)}px`, borderRadius: '50%', background: '#ffffff', boxShadow: `0 ${f2(4 * k)}px ${f2(12 * k)}px rgba(0,0,0,0.3)` })
        parts.bubble = div(ctx.layer, { position: 'absolute', left: '0', top: '0', ...font(H * 0.85), padding: `${f2(6 * k)}px ${f2(16 * k)}px`, borderRadius: `${f2(14 * k)}px`, background: FILL.ink, color: 'var(--mba-bg)', opacity: '0', direction: 'rtl' })
      } else if (kind === 'tabs') {
        const labels = (st.label ?? 'الكل،صور،فيديو').split(/[،,]/).map((x) => x.trim()).filter(Boolean).slice(0, 4)
        parts.ind = div(c, { position: 'absolute', top: '12%', height: '76%', borderRadius: '999px', background: FILL.accent })
        const row = div(c, { position: 'absolute', inset: '0', display: 'flex', direction: 'rtl' })
        labels.forEach((l) => div(row, { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', ...font(H * 0.36, 800) }, l))
        parts.count = div(c, {}, String(labels.length))
        parts.count.style.display = 'none'
      } else if (kind === 'chart') {
        const wrap = div(c, { position: 'absolute', inset: '26% 8% 12% 8%', display: 'flex', alignItems: 'flex-end', gap: '5%', direction: 'rtl' })
        const hs = [0.36, 0.55, 0.44, 0.72, 0.6, 1]
        parts.bars = wrap
        hs.forEach((v, i) => div(wrap, { flex: '1', height: `${v * 100}%`, borderRadius: `${f2(10 * k)}px ${f2(10 * k)}px ${f2(4 * k)}px ${f2(4 * k)}px`, background: i === hs.length - 1 ? FILL.accent : 'color-mix(in srgb, var(--mba-fg) 70%, transparent)', transformOrigin: '50% 100%', transform: 'scaleY(0)' }))
        parts.chip = div(c, { position: 'absolute', top: '6%', right: '6%', ...font(H * 0.13), padding: `${f2(4 * k)}px ${f2(14 * k)}px`, borderRadius: '999px', background: FILL.accent, color: '#fff', direction: 'rtl', transform: 'scale(0)' }, st.label ?? '+٤٢٪')
      } else if (kind === 'toast') {
        const row = div(c, { display: 'flex', alignItems: 'center', gap: `${f2(H * 0.22)}px`, direction: 'rtl' })
        div(row, { width: `${f2(H * 0.56)}px`, height: `${f2(H * 0.56)}px`, borderRadius: '50%', background: FILL.ok, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', ...font(H * 0.34) }, '✓')
        div(row, font(H * 0.34), st.label ?? 'تم النشر بنجاح')
      } else if (kind === 'island') {
        const row = div(c, { display: 'flex', alignItems: 'center', gap: `${f2(H * 0.2)}px`, direction: 'rtl' })
        parts.dot = div(row, { width: `${f2(H * 0.22)}px`, height: `${f2(H * 0.22)}px`, borderRadius: '50%', background: '#ff3b30' })
        div(row, font(H * 0.3, 800), st.label ?? 'يسجّل…')
        const wave = div(row, { display: 'flex', alignItems: 'center', gap: `${f2(H * 0.05)}px`, height: `${f2(H * 0.45)}px` })
        parts.wave = wave
        for (let i = 0; i < 9; i++) div(wave, { width: `${f2(H * 0.05)}px`, height: '100%', borderRadius: '999px', background: FILL.accent, transformOrigin: '50% 50%' })
      }
      void W
      return { c, parts, st }
    })

    // The cursor, and the ripple of its click.
    const cursor = div(ctx.layer, { position: 'absolute', left: '0', top: '0', opacity: '0', zIndex: '5' })
    cursor.innerHTML = `<svg width="${f2(52 * k)}" height="${f2(72 * k)}" viewBox="0 0 23 32"><path d="M1 1 L1 25 L7 19.5 L11.5 30 L15.5 28 L11 18 L19 18 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`
    const ripple = div(ctx.layer, { position: 'absolute', left: '0', top: '0', width: `${f2(80 * k)}px`, height: `${f2(80 * k)}px`, marginLeft: `${f2(-40 * k)}px`, marginTop: `${f2(-40 * k)}px`, borderRadius: '50%', border: `${f2(5 * k)}px solid var(--mba-accent)`, boxSizing: 'border-box', opacity: '0', zIndex: '4' })

    const boxOf = (i: number) => UI_BOX[p.states[i]!.kind]
    /** The shape's geometry and fill blend at t. */
    const geo = (t: number) => {
      let i = 0
      while (i + 1 < p.states.length && t >= p.states[i + 1]!.at) i++
      const cur = boxOf(i)
      const st = p.states[i]!
      const m = spring(t - st.at)
      if (i === 0) {
        // The first state pops in from 40 % (never from nothing, so a scene that opens on it is never blank).
        const pop = 0.4 + 0.6 * spring(t - st.at, 0.55, 13)
        return { w: cur.w * U * pop, h: cur.h * U * pop, r: cur.r, fill: FILL[cur.fill]!, prev: FILL[cur.fill]!, m: 1, i }
      }
      const prev = boxOf(i - 1)
      return {
        w: (prev.w + (cur.w - prev.w) * m) * U,
        h: (prev.h + (cur.h - prev.h) * m) * U,
        r: prev.r + (cur.r - prev.r) * Math.min(1, m),
        fill: FILL[cur.fill]!,
        prev: FILL[prev.fill]!,
        m: Math.min(1, Math.max(0, m)),
        i,
      }
    }

    return {
      update(localT) {
        const t = Math.max(0, localT)
        const g = geo(t)
        const W = Math.max(0, g.w)
        const H = Math.max(0, g.h)
        Object.assign(shape.style, {
          width: `${f2(W)}px`, height: `${f2(H)}px`, transform: `translate(${f2(cx - W / 2)}px, ${f2(cy - H / 2)}px)`,
          borderRadius: `${f2(g.r * Math.min(W, H))}px`,
          background: g.m >= 1 ? g.fill : `color-mix(in srgb, ${g.fill} ${f2(g.m * 100)}%, ${g.prev})`,
          opacity: t < p.states[0]!.at ? '0' : '1',
          border: p.states[g.i]!.kind === 'chart' || p.states[g.i]!.kind === 'slider' ? `${f2(2 * k)}px solid color-mix(in srgb, var(--mba-fg) 14%, transparent)` : 'none',
        })
        // Contents: the current state's fades in under a blur, the last one leaves the same way.
        contents.forEach((ct, i) => {
          const a = ct.st.at + 0.12
          const b = i + 1 < p.states.length ? p.states[i + 1]!.at : Infinity
          const vin = easeOutCubic(seg(t, a, a + 0.22))
          const vout = b === Infinity ? 0 : seg(t, b - 0.02, b + 0.14)
          const v = vin * (1 - vout)
          ct.c.style.opacity = f3(v)
          ct.c.style.filter = v < 0.999 ? `blur(${f2((1 - v) * 10 * k)}px)` : ''
          const lt = t - ct.st.at
          const P = ct.parts
          const box = UI_BOX[ct.st.kind]
          const bw = box.w * U
          const bh = box.h * U
          if (ct.st.kind === 'loader' && P.svg) (P.svg as SVGElement).style.transform = `rotate(${f2(lt * 420)}deg)`
          if (ct.st.kind === 'check' && P.path) (P.path as SVGPathElement).setAttribute('stroke-dasharray', `${f3(easeOutCubic(seg(lt, 0.15, 0.5)))} 1`)
          if (ct.st.kind === 'toggle' && P.knob) {
            const on = spring(lt - 0.42, 0.55, 16)
            const d = bh * 0.8
            const stretch = 1 + 0.55 * Math.sin(Math.PI * Math.min(1, Math.max(0, on)))
            const right = bh * 0.1 + (bw - d - bh * 0.2) * on
            const el = P.knob as HTMLElement
            el.style.width = `${f2(d * stretch)}px`
            el.style.right = `${f2(right - (d * (stretch - 1)) / 2)}px`
            if (i === g.i && on > 0) shape.style.background = `color-mix(in srgb, ${FILL.accent} ${f2(Math.min(1, on) * 100)}%, ${FILL.ink})`
          }
          if (ct.st.kind === 'slider' && P.fill) {
            const to = (ct.st.value ?? 80) / 100
            const m = easeInOutCubic(seg(lt, 0.35, 1.25)) * to
            ;(P.fill as HTMLElement).style.width = `${f2(m * 100)}%`
            const kx = bw * (1 - m)
            ;(P.knob as HTMLElement).style.right = 'auto'
            ;(P.knob as HTMLElement).style.left = `${f2(kx - bh * 0.75)}px`
            ;(P.knob as HTMLElement).style.transform = 'translateY(-50%)'
            const bub = P.bubble as HTMLElement
            bub.textContent = fmtNumber(Math.round(m * 100), 0, 'arabic') + '٪'
            bub.style.opacity = f3(v * seg(lt, 0.3, 0.45))
            bub.style.transform = `translate(${f2(cx - bw / 2 + kx - bub.offsetWidth / 2)}px, ${f2(cy - bh / 2 - bh * 2.1 - bub.offsetHeight / 2)}px)`
          }
          if (ct.st.kind === 'tabs' && P.ind) {
            const n = Number((P.count as HTMLElement).textContent)
            const tw = bw / n
            const lead = spring(lt - 0.5, 0.7, 18) + spring(lt - 1.0, 0.7, 18)
            const trail = spring(lt - 0.58, 0.7, 14) + spring(lt - 1.08, 0.7, 14)
            // RTL: tab 0 is on the right; the indicator's leading edge runs ahead, the trailing edge follows.
            const r0 = tw * Math.min(lead, trail)
            const r1 = tw * (Math.max(lead, trail) + 1)
            const el = P.ind as HTMLElement
            el.style.right = `${f2(r0 + tw * 0.06)}px`
            el.style.width = `${f2(r1 - r0 - tw * 0.12)}px`
          }
          if (ct.st.kind === 'chart' && P.bars) {
            Array.from((P.bars as HTMLElement).children).forEach((bar, j) => ((bar as HTMLElement).style.transform = `scaleY(${f3(Math.max(0, spring(lt - 0.25 - j * 0.07, 0.6, 13)))})`))
            ;(P.chip as HTMLElement).style.transform = `scale(${f3(Math.max(0, spring(lt - 0.85, 0.5, 14)))})`
          }
          if (ct.st.kind === 'island' && P.wave) {
            ;(P.dot as HTMLElement).style.opacity = f3(0.45 + 0.55 * (Math.sin(lt * 9) > 0 ? 1 : 0.3))
            Array.from((P.wave as HTMLElement).children).forEach((bar, j) => ((bar as HTMLElement).style.transform = `scaleY(${f3(0.25 + 0.75 * Math.abs(Math.sin(lt * 7 + j * 0.9)))})`))
          }
        })

        // The cursor: glides to each change and clicks just as it starts.
        if (!p.cursor) return
        let pos: { x: number; y: number } | null = null
        let press = 0
        let rip: { x: number; y: number; r: number } | null = null
        for (let i = 1; i < p.states.length; i++) {
          const at = p.states[i]!.at
          const prevBox = boxOf(i - 1)
          const target = { x: cx + prevBox.w * U * 0.18, y: cy + prevBox.h * U * 0.15 }
          const prevTarget = i === 1 ? { x: cx + 0.42 * U, y: cy + 0.55 * U } : { x: cx + boxOf(i - 2).w * U * 0.18, y: cy + boxOf(i - 2).h * U * 0.15 }
          const start = Math.max(p.states[i - 1]!.at + 0.3, at - 0.55)
          if (t >= start - 0.2 && t < at + 0.35) {
            const m = easeInOutCubic(seg(t, start, at - 0.06))
            pos = { x: prevTarget.x + (target.x - prevTarget.x) * m, y: prevTarget.y + (target.y - prevTarget.y) * m }
            press = Math.sin(Math.PI * seg(t, at - 0.07, at + 0.1))
          }
          const r = seg(t, at - 0.02, at + 0.45)
          if (r > 0 && r < 1) rip = { x: target.x, y: target.y, r }
        }
        const P2 = pos as { x: number; y: number } | null
        cursor.style.opacity = P2 ? '1' : '0'
        if (P2) cursor.style.transform = `translate(${f2(P2.x)}px, ${f2(P2.y)}px) scale(${f3(1 - 0.16 * press)})`
        const R = rip as { x: number; y: number; r: number } | null
        ripple.style.opacity = R ? f3(1 - R.r) : '0'
        if (R) ripple.style.transform = `translate(${f2(R.x)}px, ${f2(R.y)}px) scale(${f3(0.3 + 1.6 * easeOutCubic(R.r))})`
      },
    }
  },
}
