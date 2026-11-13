import { easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import { ORB, orbCardParams, type OrbCardParams, type OrbTile } from '../../core/params/orb-card'
import { spring } from '../../core/params/ui-morph'
import { FONT_WEIGHT, worldIsLight } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

const f2 = (n: number) => n.toFixed(2)
const f4 = (n: number) => n.toFixed(4)
/** Two digits, Latin: «01 /05» (an Arabic zero is a dot, so «٠١» reads like «-١» at this size). */
const two = (n: number) => String(n).padStart(2, '0')
const mix = (v: string, pct: number, other = 'transparent') => `color-mix(in srgb, ${v} ${pct}%, ${other})`
function div(parent: HTMLElement, style: Partial<CSSStyleDeclaration> = {}, text?: string): HTMLElement {
  const el = document.createElement('div')
  Object.assign(el.style, style)
  if (text !== undefined) el.textContent = text
  parent.append(el)
  return el
}

/**
 * orb-card: a glowing orb (a lit sphere with a soft halo that breathes) and white app tiles.
 * Chapter: number above, two tiles joined through the orb, the name in the serif below. Hub: one
 * tile at the centre, satellites arriving on a ring, each joined to the centre by a light line.
 */
export const orbCard: Primitive<OrbCardParams> = {
  id: 'orb-card',
  params: orbCardParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const accent = ctx.look.vars.accent
    const fg = ctx.look.vars.fg
    const D = p.size * s.w
    const cx = s.x + s.w / 2
    const cy = s.y + p.y * s.h
    const root = div(ctx.layer, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    // The tool's name: the display face (Cairo), heavy, filled with a gradient from the accent to pink.
    const gradientText = (): Partial<CSSStyleDeclaration> => ({ fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), backgroundImage: `linear-gradient(100deg, ${mix(accent, 55, '#ffffff')} 5%, ${mix(accent, 30, '#ff8fd0')} 95%)`, backgroundClip: 'text', webkitBackgroundClip: 'text', color: 'transparent', padding: `0 ${f2(10 * k)}px` })
    // halo, orb, rim light
    const halo = div(root, { position: 'absolute', left: f2(cx - D * 1.4) + 'px', top: f2(cy - D * 1.4) + 'px', width: f2(D * 2.8) + 'px', height: f2(D * 2.8) + 'px', borderRadius: '50%', background: `radial-gradient(circle, ${mix(accent, 46)} 0%, ${mix(accent, 16)} 34%, transparent 66%)` })
    const orb = div(root, {
      position: 'absolute', left: f2(cx - D / 2) + 'px', top: f2(cy - D / 2) + 'px', width: f2(D) + 'px', height: f2(D) + 'px', borderRadius: '50%',
      background: `radial-gradient(circle at 34% 30%, #ffffff 0%, ${mix(accent, 55, '#ffd9f2')} 18%, ${mix(accent, 85, '#3d2a8f')} 52%, #120d3a 100%)`,
      boxShadow: `0 0 ${f2(60 * k)}px ${mix(accent, 70)}, inset ${f2(-18 * k)}px ${f2(-22 * k)}px ${f2(50 * k)}px rgba(10,6,40,0.55)`,
    })
    // the svg layer for joining lines
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', `0 0 ${ctx.size.w} ${ctx.size.h}`)
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible' })
    root.append(svg)
    const line = (x1: number, y1: number, x2: number, y2: number, w: number) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      el.setAttribute('x1', f2(x1)); el.setAttribute('y1', f2(y1)); el.setAttribute('x2', f2(x2)); el.setAttribute('y2', f2(y2))
      el.setAttribute('pathLength', '1')
      Object.assign(el.style, { stroke: '#ffffff', strokeWidth: f2(w), strokeLinecap: 'round', opacity: '0.85', filter: `drop-shadow(0 0 ${f2(8 * k)}px ${accent})` })
      svg.append(el)
      return el
    }
    const makeTile = (t: OrbTile, size: number, x: number, y: number) => {
      const el = div(root, {
        position: 'absolute', left: f2(x - size / 2) + 'px', top: f2(y - size / 2) + 'px', width: f2(size) + 'px', height: f2(size) + 'px', borderRadius: f2(size * 0.24) + 'px',
        background: '#ffffff', boxShadow: `0 ${f2(10 * k)}px ${f2(30 * k)}px rgba(0,0,0,0.35), 0 0 0 ${f2(1.5 * k)}px rgba(255,255,255,0.6)`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      })
      if (t.image) {
        div(el, { width: '64%', height: '64%', backgroundImage: `url("${t.image}")`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' })
      } else {
        const m = div(el, { width: '70%', height: '70%', borderRadius: f2(size * 0.16) + 'px', background: t.colour ?? accent, color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), fontSize: f2(size * 0.36) + 'px', lineHeight: '1', direction: 'ltr' }, t.mark ?? '•')
        void m
      }
      let cap: HTMLElement | undefined
      if (t.label) {
        cap = div(root, { position: 'absolute', left: f2(x) + 'px', top: f2(y + size / 2 + 12 * k) + 'px', transform: 'translateX(-50%)', fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: f2(Math.max(22 * k, size * 0.2)) + 'px', color: fg, opacity: '0.85', whiteSpace: 'nowrap', direction: 'ltr' })
        lineUnit(cap, t.label)
      }
      return { el, cap }
    }
    type Item = { el: HTMLElement; cap?: HTMLElement; at: number; dx: number; ln?: SVGLineElement }
    const items: Item[] = []
    let header: HTMLElement[] = []
    let nameEl: HTMLElement | undefined
    if (p.mode === 'chapter') {
      const T = D * ORB.chapterTile
      const off = D * 0.62
      const a = makeTile(p.from!, T, cx + off, cy) // the reading side (right) first
      const b = makeTile(p.to!, T, cx - off, cy)
      const ln = line(cx + off - T / 2, cy, cx - off + T / 2, cy, 3 * k)
      items.push({ ...a, at: 0.05, dx: 1, ln }, { ...b, at: 0.15, dx: -1 })
      if (p.label) header.push(div(root, { position: 'absolute', left: '0', right: '0', top: f2(cy - D * 1.36) + 'px', textAlign: 'center', fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: f2(42 * k) + 'px', lineHeight: '1.4', color: fg, opacity: '0.8' }, p.label))
      if (p.number !== undefined) {
        const num = div(root, { position: 'absolute', left: '0', right: '0', top: f2(cy - D * 1.02) + 'px', textAlign: 'center', fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), fontSize: f2(150 * k) + 'px', lineHeight: '1', color: fg, direction: 'ltr', letterSpacing: '-0.02em' })
        const big = document.createElement('span')
        big.textContent = two(p.number)
        num.append(big)
        if (p.total !== undefined) {
          const small = document.createElement('span')
          small.textContent = ` /${two(p.total)}`
          Object.assign(small.style, { fontSize: f2(54 * k) + 'px', opacity: '0.55', fontWeight: String(FONT_WEIGHT.body) })
          num.append(small)
        }
        header.push(num)
      }
      if (p.name) {
        nameEl = div(root, { position: 'absolute', left: '0', right: '0', top: f2(cy + D * 0.66) + 'px', textAlign: 'center', fontSize: f2(118 * k) + 'px', lineHeight: '1.25', direction: 'ltr', ...gradientText() })
        lineUnit(nameEl, p.name)
      }
    } else {
      const C = D * ORB.hubTile
      const c = makeTile(p.centre!, C, cx, cy)
      items.push({ ...c, at: 0, dx: 0 })
      const n = p.satellites.length
      const R = D * ORB.ring
      const S = D * ORB.satTile
      p.satellites.forEach((t, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n)
        const x = cx + R * Math.cos(a)
        const y = cy + R * Math.sin(a)
        const ln = line(cx + (C / 2 + 6 * k) * Math.cos(a), cy + (C / 2 + 6 * k) * Math.sin(a), x - (S / 2 + 4 * k) * Math.cos(a), y - (S / 2 + 4 * k) * Math.sin(a), 2.5 * k)
        const tt = makeTile(t, S, x, y)
        items.push({ ...tt, at: t.at ?? p.at + i * p.stagger, dx: 0, ln })
      })
      if (p.count) {
        nameEl = div(root, { position: 'absolute', left: '0', right: '0', top: f2(cy + R + S / 2 + 46 * k) + 'px', textAlign: 'center', fontSize: f2(104 * k) + 'px', lineHeight: '1.2', ...gradientText() })
        lineUnit(nameEl, p.count)
      }
    }
    const nameAt = p.mode === 'chapter' ? p.nameAt : p.countAt ?? p.at + p.satellites.length * p.stagger + 0.2
    let light: boolean | undefined
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const l = worldIsLight(ctx.layer)
        if (nameEl && l !== light) {
          light = l
          nameEl.style.backgroundImage = l ? `linear-gradient(100deg, ${mix(accent, 80, '#3a1fd0')} 5%, #e0469d 95%)` : `linear-gradient(100deg, ${mix(accent, 55, '#ffffff')} 5%, ${mix(accent, 30, '#ff8fd0')} 95%)`
        }
        const o = spring(t * 2.2 + 0.35, 0.6, 9)
        const breathe = 1 + 0.025 * Math.sin(t * 2.4)
        orb.style.transform = `scale(${f4(Math.max(0, o) * breathe)})`
        halo.style.opacity = f4(Math.min(1, t * 3 + 0.3) * (0.85 + 0.15 * Math.sin(t * 1.7)))
        halo.style.transform = `scale(${f4(0.9 + 0.1 * breathe)})`
        for (const it of items) {
          const u = spring((t - it.at) * 2.4, 0.62, 9)
          const shown = t >= it.at - 0.001
          it.el.style.opacity = shown ? f4(Math.min(1, (t - it.at) * 6 + 0.25)) : '0'
          it.el.style.transform = `translateX(${f2((1 - Math.max(0, u)) * it.dx * 80 * k)}px) scale(${f4(shown ? 0.55 + 0.45 * u : 0.55)})`
          if (it.cap) it.cap.style.opacity = f4(0.85 * seg(t, it.at + 0.15, it.at + 0.45))
          if (it.ln) it.ln.style.strokeDasharray = `${f4(easeInOutCubic(seg(t, it.at + 0.1, it.at + 0.45)))} 1`
        }
        header.forEach((h, i) => {
          const u = easeOutCubic(seg(t, i * 0.06, 0.3 + i * 0.06))
          h.style.opacity = f4(u)
          h.style.transform = `translateY(${f2((1 - u) * 24 * k)}px)`
        })
        if (nameEl) {
          const u = seg(t, nameAt, nameAt + 0.45)
          nameEl.style.opacity = f4(easeOutCubic(u))
          nameEl.style.clipPath = `inset(-30% 0 -30% ${f2((1 - easeInOutCubic(u)) * 100)}%)`
          nameEl.style.transform = `scale(${f4(0.94 + 0.06 * easeOutBack(u, 1.4))})`
        }
      },
    }
  },
}
