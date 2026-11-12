import { easeInOutCubic, easeOutCubic, seg } from '../../core/ease'
import { NAME_STRIP as N, nameStripParams, type NameStripParams } from '../../core/params/name-strip'
import { FONT_MONO, FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

const mix = (v: string, pct: number, other = 'transparent') => `color-mix(in srgb, ${v} ${pct}%, ${other})`

/**
 * name-strip: the speaker's name and handle on a strip in the pack's material, sliding in from its
 * edge of the safe area and back out. Pure in `localT`.
 */
export const nameStrip: Primitive<NameStripParams> = {
  id: 'name-strip',
  params: nameStripParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const px = (n: number) => `${(n * k).toFixed(2)}px`
    const { fg, bg, accent } = ctx.look.vars
    const strip = document.createElement('div')
    strip.dataset.mbaPart = 'name-strip'
    Object.assign(strip.style, {
      position: 'absolute', [p.side]: `${ctx.size.w - ctx.safe.x - ctx.safe.w}px`, top: `${(ctx.safe.y + p.y * ctx.safe.h).toFixed(2)}px`,
      display: 'flex', flexDirection: 'column', alignItems: p.side === 'right' ? 'flex-end' : 'flex-start', gap: px(4), padding: `${px(14)} ${px(26)}`,
      transformOrigin: p.side === 'right' ? '100% 50%' : '0% 50%', boxSizing: 'border-box', whiteSpace: 'nowrap',
    })
    if (p.side === 'left') strip.style.left = `${ctx.safe.x}px`
    const name = document.createElement('div')
    Object.assign(name.style, { font: `${FONT_WEIGHT.display} ${px(N.namePx)} ${ctx.look.fontDisplay}`, lineHeight: '1.25' })
    lineUnit(name, p.name)
    strip.append(name)
    let handle: HTMLElement | undefined
    if (p.handle) {
      handle = document.createElement('div')
      handle.dir = 'ltr'
      handle.textContent = p.handle
      Object.assign(handle.style, { font: `400 ${px(N.handlePx)} ${FONT_MONO}, ${ctx.look.fontBody}`, lineHeight: '1.2', letterSpacing: '0.02em' })
      strip.append(handle)
    }
    const rule = document.createElement('div')
    strip.append(rule)
    let rest = 'rotate(0deg)'

    if (p.kind === 'card') {
      // A paper tag: light paper, ink text, a soft shadow, a touch tilted.
      Object.assign(strip.style, { background: mix(bg, 30, '#ffffff'), color: '#16130f', borderRadius: px(18), boxShadow: `0 ${px(14)} ${px(40)} rgba(0,0,0,0.28)` })
      if (handle) handle.style.color = accent
      rule.remove()
      rest = `rotate(${p.side === 'right' ? -2 : 2}deg)`
    } else if (p.kind === 'panel') {
      // An interface panel: dark glass, a hairline border, an accent bar on its edge.
      Object.assign(strip.style, { background: 'rgba(14,13,12,0.82)', color: '#f2ece2', borderRadius: px(10), border: `${px(2)} solid rgba(242,236,226,0.28)` })
      if (handle) handle.style.opacity = '0.7'
      Object.assign(rule.style, { position: 'absolute', top: '0', bottom: '0', [p.side]: '0', width: px(6), background: accent, borderRadius: px(3) })
    } else if (p.kind === 'spot') {
      // Light only: glowing text over the picture and a hot line under it.
      Object.assign(strip.style, { color: '#ffffff', textShadow: `0 0 ${px(18)} ${mix(accent, 80)}, 0 ${px(2)} ${px(8)} rgba(0,0,0,0.6)` })
      if (handle) handle.style.color = accent
      Object.assign(rule.style, { alignSelf: 'stretch', height: px(3), marginTop: px(6), background: `linear-gradient(90deg, transparent, ${accent} 30%, #ffffff 50%, ${accent} 70%, transparent)`, boxShadow: `0 0 ${px(18)} ${px(3)} ${mix(accent, 60)}` })
    } else {
      // A flat editorial block: ink on the page colour's opposite, one accent rule.
      Object.assign(strip.style, { background: '#111111', color: '#f4f2ec', borderRadius: '0' })
      if (handle) handle.style.opacity = '0.75'
      Object.assign(rule.style, { alignSelf: 'stretch', height: px(5), marginTop: px(8), background: accent, transformOrigin: p.side === 'right' ? '100% 50%' : '0% 50%' })
    }
    ctx.layer.append(strip)
    void fg

    return {
      update(localT) {
        const t = Math.max(0, localT)
        const on = easeOutCubic(seg(t, p.at, p.at + N.move)) * (p.out === undefined ? 1 : 1 - easeInOutCubic(seg(t, p.out, p.out + N.move)))
        const dir = p.side === 'right' ? 1 : -1
        strip.style.opacity = on.toFixed(4)
        strip.style.transform = `translateX(${((1 - on) * dir * 0.18 * ctx.size.w).toFixed(2)}px) translateY(-50%) ${rest}`
        if (p.kind !== 'card') rule.style.transform = p.kind === 'panel' ? '' : `scaleX(${easeOutCubic(seg(t, p.at + 0.2, p.at + 0.2 + N.move)).toFixed(4)})`
      },
    }
  },
}
