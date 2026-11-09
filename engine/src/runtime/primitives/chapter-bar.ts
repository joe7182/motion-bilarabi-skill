import { easeInOutSine, easeOutCubic, seg } from '../../core/ease'
import { CHAPTER_BAR as C, chapterBarParams, type ChapterBarParams } from '../../core/params/chapter-bar'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

/**
 * chapter-bar: dashes for the items of a numbered video along the top of the safe area, the
 * current one filling in accent, and the item label at the other end. Pure in `localT`.
 */
export const chapterBar: Primitive<ChapterBarParams> = {
  id: 'chapter-bar',
  params: chapterBarParams,
  build(ctx, p) {
    const E = p.ease === 'easy' ? easeInOutSine : easeOutCubic
    const k = ctx.size.w / 1080
    const bar = document.createElement('div')
    bar.dataset.mbaPart = 'chapter-bar'
    bar.dir = ctx.dir
    Object.assign(bar.style, {
      position: 'absolute', left: `${ctx.safe.x}px`, width: `${ctx.safe.w}px`, top: `${ctx.safe.y + p.y * ctx.safe.h}px`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: ctx.look.vars.fg,
    })
    ctx.layer.append(bar)
    const dashes = document.createElement('div')
    Object.assign(dashes.style, { display: 'flex', gap: `${(C.gap * ctx.safe.w).toFixed(1)}px` })
    const fills: HTMLElement[] = []
    for (let i = 1; i <= p.count; i++) {
      const d = document.createElement('div')
      d.dataset.mbaPart = 'chapter-dash'
      Object.assign(d.style, { position: 'relative', width: `${(C.dash * ctx.safe.w).toFixed(1)}px`, height: `${Math.round(C.thick * k)}px` })
      const back = document.createElement('div')
      Object.assign(back.style, { position: 'absolute', inset: '0', background: ctx.look.vars.fg, opacity: i < p.index ? '1' : String(C.faint) })
      d.append(back)
      if (i === p.index) {
        const f = document.createElement('div')
        // Fills from the reading side: the right edge in RTL.
        Object.assign(f.style, { position: 'absolute', inset: '0', background: ctx.look.vars.accent, transformOrigin: ctx.dir === 'rtl' ? '100% 50%' : '0% 50%' })
        d.append(f)
        fills.push(f)
      }
      dashes.append(d)
    }
    bar.append(dashes)
    if (p.label) {
      const lab = document.createElement('div')
      Object.assign(lab.style, { fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: `${Math.round(C.labelPx * k)}px`, opacity: '0.7', lineHeight: '1.2' })
      lineUnit(lab, p.label)
      bar.append(lab)
    }
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const o = p.enter === 'fade' ? E(seg(t, 0, C.fadeIn)) : 1
        bar.style.opacity = o === 1 ? '' : o.toFixed(4)
        const f = E(seg(t, p.at, p.at + p.fill))
        for (const el of fills) el.style.transform = `scaleX(${f.toFixed(4)})`
      },
    }
  },
}
