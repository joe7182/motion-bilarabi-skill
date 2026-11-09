import { easeInOutSine, easeOutCubic, easeOutExpo, seg } from '../../core/ease'
import { TYPE_STRETCH as T, typeStretchParams, type TypeStretchParams } from '../../core/params/type-stretch'
import { stretchArabic } from '../../core/text'
import { FONT_MONO, FONT_WEIGHT } from '../looks'
import { fitText, lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

/**
 * type-stretch: one word that grows by kashida with a ruler measuring it. The word is one line unit
 * (its letters always joined); its text steps through `stretchArabic(word, n)`, and between two
 * counts the longer form is squeezed (scaleX) to the interpolated width, so the growth reads as one
 * continuous stretch. Widths of every form are measured at build, so `update` only reads tables.
 * Pure in `localT`.
 */
export const typeStretch: Primitive<TypeStretchParams> = {
  id: 'type-stretch',
  params: typeStretchParams,
  build(ctx, p) {
    const E = p.ease === 'easy' ? easeInOutSine : easeOutCubic
    const c = safePointPx(ctx, p.place ?? { x: 0.5, y: 0.45 })
    const root = document.createElement('div')
    root.dataset.mbaPart = 'type-stretch'
    if (p.key) root.dataset.mbaKey = p.key
    Object.assign(root.style, {
      position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, transform: 'translate(-50%, -50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', color: ctx.look.vars.fg,
    })
    ctx.layer.append(root)

    const wordBox = document.createElement('div')
    Object.assign(wordBox.style, {
      fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), lineHeight: '1.25', whiteSpace: 'nowrap',
    })
    root.append(wordBox)
    const forms = Array.from({ length: p.to + 1 }, (_, n) => stretchArabic(p.word, n))
    const unit = lineUnit(wordBox, forms[p.to]!)
    unit.style.transformOrigin = '50% 50%'
    const px = fitText(wordBox, { w: Math.floor(p.size * ctx.safe.w), h: Math.floor(0.4 * ctx.safe.h) }, T.maxPx, 48)
    const widths = forms.map((f) => {
      unit.textContent = f
      return unit.offsetWidth
    })
    // Keep the box at the widest form so nothing reflows while the word grows.
    wordBox.style.width = `${Math.ceil(widths[p.to]!)}px`
    wordBox.style.textAlign = 'center'
    unit.textContent = forms[0]!
    let shown = forms[0]!

    // Ruler: a faint line of the plain width, the accent bracket of the current width, the label.
    const ruler = document.createElement('div')
    ruler.dataset.mbaPart = 'type-stretch-ruler'
    const stroke = Math.max(3, Math.round(px * 0.025))
    const tick = Math.round(px * 0.12)
    Object.assign(ruler.style, { position: 'relative', width: `${Math.ceil(widths[p.to]!)}px`, height: `${tick}px`, marginTop: `${(T.rulerGap * px).toFixed(1)}px` })
    const base = document.createElement('div')
    Object.assign(base.style, { position: 'absolute', left: '50%', top: `${(tick - stroke) / 2}px`, height: `${stroke}px`, width: `${widths[0]!.toFixed(1)}px`, transform: 'translateX(-50%)', background: ctx.look.vars.fg, opacity: '0.22' })
    const bracket = document.createElement('div')
    Object.assign(bracket.style, {
      position: 'absolute', left: '50%', top: '0px', height: `${tick}px`, boxSizing: 'border-box',
      borderLeft: `${stroke}px solid ${ctx.look.vars.accent}`, borderRight: `${stroke}px solid ${ctx.look.vars.accent}`,
    })
    const bar = document.createElement('div')
    Object.assign(bar.style, { position: 'absolute', left: '0px', right: '0px', top: `${(tick - stroke) / 2}px`, height: `${stroke}px`, background: ctx.look.vars.accent })
    bracket.append(bar)
    ruler.append(base, bracket)
    const label = document.createElement('div')
    Object.assign(label.style, {
      marginTop: `${Math.round(px * 0.08)}px`, fontFamily: FONT_MONO, fontSize: `${Math.max(Math.round(px * 0.16), Math.ceil(30 * (ctx.size.w / 1080)))}px`,
      color: ctx.look.vars.accent, direction: 'ltr', fontVariantNumeric: 'tabular-nums', minWidth: '6em', textAlign: 'center',
    })
    const labelText = document.createElement('span')
    labelText.dir = 'ltr'
    labelText.textContent = '+0px'
    label.append(labelText)
    if (p.ruler) root.append(ruler, label)

    /** The stretch amount (fractional tatweel count) at local `t`. */
    const amount = (t: number) => p.to * (p.ease === 'easy' ? easeInOutSine : easeOutExpo)(seg(t - p.at, 0, p.duration))

    return {
      update(localT) {
        const t = Math.max(0, localT)
        const e = E(seg(t, 0, T.enter))
        root.style.opacity = e === 1 ? '' : String(e)
        wordBox.style.transform = e === 1 ? '' : `translateY(${((1 - e) * T.lift * px).toFixed(2)}px)`

        const k = amount(t)
        const lo = Math.floor(k)
        const hi = Math.min(p.to, Math.ceil(k))
        const w = widths[lo]! + (widths[hi]! - widths[lo]!) * (k - lo)
        const form = forms[hi]!
        if (form !== shown) {
          shown = form
          unit.textContent = form
        }
        const sx = widths[hi]! > 0 ? w / widths[hi]! : 1
        unit.style.transform = Math.abs(sx - 1) < 1e-4 ? '' : `scaleX(${sx.toFixed(4)})`

        if (p.ruler) {
          const r = E(seg(t, p.at - T.rulerLead, p.at - T.rulerLead + T.rulerIn))
          ruler.style.opacity = String(r)
          label.style.opacity = String(r)
          bracket.style.width = `${w.toFixed(1)}px`
          bracket.style.transform = 'translateX(-50%)'
          labelText.textContent = `+${Math.round(w - widths[0]!)}px`
        }
      },
    }
  },
}
