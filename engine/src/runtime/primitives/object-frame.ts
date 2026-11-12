import { easeOutCubic, seg } from '../../core/ease'
import { OBJECT_FRAME as F, objectFrameParams, type ObjectFrameParams } from '../../core/params/object-frame'
import { spring } from '../../core/params/ui-morph'
import { FONT_MONO, FONT_WEIGHT } from '../looks'
import type { Primitive } from './registry'

const mix = (v: string, pct: number, other = 'transparent') => `color-mix(in srgb, ${v} ${pct}%, ${other})`

/**
 * object-frame: a pack's stage under the object of a sentence (card, panel, spot or column).
 * Pure in `localT`: it builds once over `OBJECT_FRAME.build`, then holds.
 */
export const objectFrame: Primitive<ObjectFrameParams> = {
  id: 'object-frame',
  params: objectFrameParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const px = (n: number) => `${(n * k).toFixed(2)}px`
    const { fg, bg, accent } = ctx.look.vars
    const w = p.width * ctx.safe.w
    const h = p.height * ctx.safe.h
    const root = document.createElement('div')
    root.dataset.mbaPart = 'object-frame'
    Object.assign(root.style, { position: 'absolute', left: `${(ctx.safe.x + (ctx.safe.w - w) / 2).toFixed(2)}px`, top: `${(ctx.safe.y + p.y * ctx.safe.h - h / 2).toFixed(2)}px`, width: `${w.toFixed(2)}px`, height: `${h.toFixed(2)}px`, pointerEvents: 'none' })
    ctx.layer.append(root)
    const add = (style: Partial<CSSStyleDeclaration>, parent: HTMLElement = root) => {
      const el = document.createElement('div')
      Object.assign(el.style, { position: 'absolute' }, style)
      parent.append(el)
      return el
    }
    const text = (el: HTMLElement, mono: boolean) => {
      el.dir = 'auto'
      el.textContent = p.label ?? ''
      Object.assign(el.style, { font: mono ? `400 ${px(F.labelPx)} ${FONT_MONO}, ${ctx.look.fontBody}` : `${FONT_WEIGHT.bodyBold} ${px(F.labelPx)} ${ctx.look.fontBody}`, lineHeight: '1.2', whiteSpace: 'nowrap', color: fg })
    }
    let update: (u: number) => void

    if (p.kind === 'card') {
      const card = add({ inset: '0', borderRadius: px(F.radius), background: mix(bg, 45, '#ffffff'), boxShadow: `0 ${px(22)} ${px(60)} ${mix(fg, 16)}, 0 ${px(2)} ${px(6)} ${mix(fg, 10)}`, transformOrigin: '50% 60%' })
      update = (u) => {
        const s = spring(u * 1.6, 0.6, 12)
        card.style.opacity = easeOutCubic(seg(u, 0, 0.5)).toFixed(4)
        card.style.transform = `translateY(${((1 - s) * 0.12 * h).toFixed(2)}px) rotate(${(F.tilt + (1 - s) * (F.tiltFrom - F.tilt)).toFixed(3)}deg)`
      }
    } else if (p.kind === 'panel') {
      const panel = add({ inset: '0', borderRadius: px(14), border: `${px(F.rule)} solid ${mix(fg, 30)}`, background: mix(fg, 4), boxSizing: 'border-box', overflow: 'hidden' })
      const bar = add({ left: '0', right: '0', top: '0', height: px(F.bar), borderBottom: `${px(F.rule)} solid ${mix(fg, 22)}`, background: mix(fg, 5), display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${px(20)}`, boxSizing: 'border-box', direction: 'ltr' }, panel)
      const dots = add({ position: 'static', display: 'flex', gap: px(10) }, bar)
      for (let i = 0; i < 3; i++) add({ position: 'static', width: px(13), height: px(13), borderRadius: '50%', background: i === 0 ? accent : mix(fg, 35) }, dots)
      const lab = add({ position: 'static', opacity: '0.7' }, bar)
      text(lab, true)
      const hot = add({ left: '0', top: '0', height: px(3), width: '22%', background: accent, transformOrigin: '0% 50%' }, panel)
      update = (u) => {
        const e = easeOutCubic(u)
        panel.style.opacity = e.toFixed(4)
        panel.style.clipPath = `inset(0 0 ${((1 - e) * 100).toFixed(2)}% 0)`
        hot.style.transform = `scaleX(${easeOutCubic(seg(u, 0.3, 1)).toFixed(4)})`
      }
    } else if (p.kind === 'spot') {
      const pool = add({ left: '-6%', right: '-6%', top: '8%', bottom: '-12%', background: `radial-gradient(ellipse 50% 46% at 50% 56%, ${mix(accent, 30)} 0%, ${mix(accent, 9)} 55%, transparent 100%)` })
      const line = add({ left: '8%', right: '8%', bottom: '0', height: px(3), background: `linear-gradient(90deg, transparent, ${accent} 25%, #ffffff 50%, ${accent} 75%, transparent)`, boxShadow: `0 0 ${px(24)} ${px(4)} ${mix(accent, 55)}` })
      update = (u) => {
        pool.style.opacity = easeOutCubic(u).toFixed(4)
        line.style.transform = `scaleX(${easeOutCubic(seg(u, 0.1, 0.9)).toFixed(4)})`
        line.style.opacity = seg(u, 0.1, 0.3).toFixed(4)
      }
    } else if (p.kind === 'arch') {
      // A pointed arch: two arcs meeting at the crown, drawn from the feet upward; a small eight-point star above it.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 100 100')
      svg.setAttribute('preserveAspectRatio', 'none')
      Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible' })
      const mk = (dPath: string, wd: number) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        el.setAttribute('d', dPath)
        el.setAttribute('fill', 'none')
        el.setAttribute('pathLength', '1')
        el.setAttribute('vector-effect', 'non-scaling-stroke')
        Object.assign(el.style, { stroke: accent, strokeWidth: px(wd), strokeLinecap: 'round' })
        svg.append(el)
        return el
      }
      const outer = mk('M2 100 V42 C2 20 30 8 50 0 C70 8 98 20 98 42 V100', 3)
      const inner = mk('M9 100 V44 C9 26 32 15 50 8 C68 15 91 26 91 44 V100', 1.5)
      root.append(svg)
      const star = add({ left: '50%', top: px(-34), width: px(26), height: px(26), marginLeft: px(-13), background: accent, clipPath: 'polygon(50% 0, 62% 21%, 85% 15%, 79% 38%, 100% 50%, 79% 62%, 85% 85%, 62% 79%, 50% 100%, 38% 79%, 15% 85%, 21% 62%, 0 50%, 21% 38%, 15% 15%, 38% 21%)' })
      const wash = add({ inset: '0', background: `linear-gradient(${mix(accent, 10)}, transparent 70%)`, clipPath: 'polygon(2% 100%, 2% 42%, 14% 22%, 32% 9%, 50% 0, 68% 9%, 86% 22%, 98% 42%, 98% 100%)' })
      root.prepend(wash)
      update = (u) => {
        outer.style.strokeDasharray = `${easeOutCubic(u).toFixed(4)} 1`
        inner.style.strokeDasharray = `${easeOutCubic(seg(u, 0.25, 1)).toFixed(4)} 1`
        inner.style.opacity = '0.6'
        wash.style.opacity = seg(u, 0.4, 1).toFixed(4)
        star.style.transform = `scale(${easeOutCubic(seg(u, 0.6, 1)).toFixed(4)}) rotate(${(22.5 * (1 - seg(u, 0.6, 1))).toFixed(2)}deg)`
      }
    } else if (p.kind === 'blob') {
      // A cut-paper blob: it drops in a little turned and settles with a small bounce.
      const blob = add({ inset: '-3% -2%', borderRadius: '46% 54% 58% 42% / 52% 46% 54% 48%', background: p.colour ?? '#e0a526', boxShadow: `0 ${px(14)} ${px(38)} rgba(40,30,15,0.22)`, transformOrigin: '50% 60%' })
      update = (u) => {
        const s = spring(u * 1.6, 0.55, 11)
        blob.style.opacity = easeOutCubic(seg(u, 0, 0.4)).toFixed(4)
        blob.style.transform = `scale(${(0.7 + 0.3 * s).toFixed(4)}) rotate(${(-3 + 9 * (1 - s)).toFixed(3)}deg)`
      }
    } else {
      // column: the rule on the far side from the headline's edge (the left in RTL), caption at its top, a square at its foot.
      const side = ctx.dir === 'rtl' ? 'left' : 'right'
      const rule = add({ [side]: '0', top: '0', bottom: '0', width: px(F.rule * 1.5), background: fg, opacity: '0.85', transformOrigin: '50% 0%' })
      const cap = add({ [side]: px(22), top: '0', opacity: '0.62' })
      text(cap, false)
      const sq = add({ [side]: px(22), bottom: '0', width: px(26), height: px(26), background: accent })
      update = (u) => {
        rule.style.transform = `scaleY(${easeOutCubic(u).toFixed(4)})`
        cap.style.opacity = (0.62 * seg(u, 0.3, 0.8)).toFixed(4)
        sq.style.transform = `scale(${easeOutCubic(seg(u, 0.5, 1)).toFixed(4)})`
      }
    }

    return {
      update(localT) {
        update(seg(Math.max(0, localT), p.at, p.at + F.build))
      },
    }
  },
}
