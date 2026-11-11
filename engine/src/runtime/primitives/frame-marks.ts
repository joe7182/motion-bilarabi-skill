import { easeOutCubic, seg } from '../../core/ease'
import { FRAME_MARKS as F, frameMarksParams, type FrameMarksParams } from '../../core/params/frame-marks'
import { FONT_MONO, FONT_WEIGHT } from '../looks'
import type { Primitive } from './registry'

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const twoDigits = (n: number) => String(n).padStart(2, '0').replace(/\d/g, (d) => AR_DIGITS[+d]!)

/**
 * frame-marks: a pack's frame furniture (tag, rules, corner ticks, section number) on the edges of
 * the safe area. Pure in `localT`: each mark draws in from the reading side, then holds.
 */
export const frameMarks: Primitive<FrameMarksParams> = {
  id: 'frame-marks',
  params: frameMarksParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const rtl = ctx.dir === 'rtl'
    const root = document.createElement('div')
    root.dataset.mbaPart = 'frame-marks'
    Object.assign(root.style, { position: 'absolute', left: `${ctx.safe.x}px`, top: `${ctx.safe.y}px`, width: `${ctx.safe.w}px`, height: `${ctx.safe.h}px`, color: ctx.look.vars.fg, opacity: String(p.alpha), pointerEvents: 'none' })
    ctx.layer.append(root)
    const px = (n: number) => `${(n * k).toFixed(2)}px`
    const thick = `${Math.max(1, Math.round(F.rule * k))}px`

    const rules = p.rules.map((r) => {
      const line = document.createElement('div')
      Object.assign(line.style, {
        position: 'absolute', top: `${(r.y * 100).toFixed(3)}%`, left: `${(Math.min(r.from, r.to) * 100).toFixed(3)}%`, width: `${(Math.abs(r.to - r.from) * 100).toFixed(3)}%`,
        height: thick, background: 'currentColor', transformOrigin: rtl ? '100% 50%' : '0% 50%', transform: 'scaleX(0)',
      })
      root.append(line)
      return { line, at: r.at }
    })

    const fades: HTMLElement[] = []
    if (p.ticks) {
      for (const [v, h] of [['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']] as const) {
        const t = document.createElement('div')
        Object.assign(t.style, { position: 'absolute', [v]: '0', [h]: '0', width: px(F.tick), height: px(F.tick), [`border-${v}`]: `${thick} solid currentColor`, [`border-${h}`]: `${thick} solid currentColor`, boxSizing: 'border-box' })
        root.append(t)
        fades.push(t)
      }
    }
    // With corner ticks the tag and the number move inside them.
    const padX = p.ticks ? px(F.tick * 0.7) : '0'
    const padY = p.ticks ? `calc(${(F.inset * 100).toFixed(2)}% + ${px(F.tick * 0.5)})` : `${(F.inset * 100).toFixed(2)}%`
    if (p.tag) {
      const tag = document.createElement('div')
      tag.dir = 'auto'
      tag.textContent = p.tag.text
      Object.assign(tag.style, {
        position: 'absolute', top: padY, [p.tag.corner === 'top-right' ? 'right' : 'left']: padX,
        font: p.tag.mono ? `400 ${px(F.tagPx)} ${FONT_MONO}, ${ctx.look.fontBody}` : `${FONT_WEIGHT.bodyBold} ${px(F.tagPx)} ${ctx.look.fontBody}`,
        letterSpacing: p.tag.mono ? '0.04em' : '0', lineHeight: '1.2', whiteSpace: 'nowrap',
      })
      root.append(tag)
      fades.push(tag)
    }
    if (p.number) {
      const num = document.createElement('div')
      num.textContent = twoDigits(p.number.value)
      const c = p.number.corner
      Object.assign(num.style, {
        position: 'absolute', [c.startsWith('top') ? 'top' : 'bottom']: padY, [c.endsWith('left') ? 'left' : 'right']: padX,
        font: `${FONT_WEIGHT.display} ${px(F.numberPx)} ${ctx.look.fontDisplay}`, lineHeight: '1', whiteSpace: 'nowrap', direction: 'ltr',
      })
      root.append(num)
      fades.push(num)
    }

    return {
      update(localT) {
        const t = Math.max(0, localT)
        for (const r of rules) r.line.style.transform = `scaleX(${easeOutCubic(seg(t, r.at, r.at + F.draw)).toFixed(4)})`
        const o = easeOutCubic(seg(t, 0, F.draw))
        for (const el of fades) el.style.opacity = o === 1 ? '' : o.toFixed(4)
      },
    }
  },
}
