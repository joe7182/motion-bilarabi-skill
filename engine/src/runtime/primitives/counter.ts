import { DRIFT_MIN_FIT_SCALE, DRIFT_PER_SEC, driftCss, driftFitBox, driftGrow, translateDrift } from '../../core/params/drift'
import { counterParams, counterWidthProbes, counterValue, formatCounter, type CounterParams } from '../../core/params/counter'
import { FONT_WEIGHT } from '../looks'
import { fitText, lineUnit } from '../text/units'
import { driftFit, frameRect } from '../drift-fit'
import { inkRect } from './highlight'
import { strikeLine, strikeTransform } from './kinetic-text'
import type { Primitive } from './registry'

export const COUNTER = {
  /**
   * Scale drift per second once settled (Pro Pace; drift.ts). On its own it is under the review's
   * static threshold here, so a seeded translate drift (R16, DRIFT_PX_PER_SEC) is added.
   */
  drift: DRIFT_PER_SEC,
  maxPx: 260,
  minPx: 72,
  /** Share of the safe height the number may take. */
  maxH: 0.5,
} as const

/**
 * A rolling number: value = f(localT), power3.out from `from` to `to` over `roll` s, formatted with
 * `Intl.NumberFormat('ar-EG' | 'en')` (Arabic digits ٠-٩ by default) with `prefix`/`suffix`, in one
 * line unit. Tabular digits and a box fixed to the widest value keep the text from jittering;
 * the number keeps a slow scale + seeded translate drift (R16) after the roll.
 */
export const counter: Primitive<CounterParams> = {
  id: 'counter',
  params: counterParams,
  build(ctx, p) {
    const root = document.createElement('div')
    root.dataset.mbaPart = 'counter'
    Object.assign(root.style, {
      position: 'absolute',
      left: `${ctx.safe.x}px`,
      top: `${ctx.safe.y}px`,
      width: `${ctx.safe.w}px`,
      height: `${ctx.safe.h}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    })
    const holder = document.createElement('div')
    if (p.key) holder.dataset.mbaKey = p.key
    Object.assign(holder.style, {
      fontFamily: ctx.look.fontDisplay,
      fontWeight: String(FONT_WEIGHT.display),
      fontVariantNumeric: 'tabular-nums',
      lineHeight: '1.3',
      color: ctx.look.vars.fg,
      transformOrigin: '50% 50%',
    })
    root.append(holder)
    ctx.layer.append(root)

    // Every value between from and to is at most as wide as the widest probe (affixes included).
    const candidates = counterWidthProbes(p)
    const span = lineUnit(holder, candidates[0]!)
    span.style.textAlign = 'center'
    const widthOf = (c: string) => {
      span.textContent = c
      return span.getBoundingClientRect().width
    }
    // Fit the widest value, then lock the box to it (no transforms are set yet).
    const fitTo = (box: { w: number; h: number }, maxH: number) => {
      span.style.width = ''
      const widths = candidates.map(widthOf)
      span.textContent = candidates[widths.indexOf(Math.max(...widths))]!
      fitText(holder, { w: box.w, h: Math.min(box.h, maxH) }, COUNTER.maxPx, COUNTER.minPx)
      span.style.width = `${Math.ceil(Math.max(...candidates.map(widthOf)))}px`
    }
    // Natural size, as without a drift; shrunk as a whole only when the number would drift (R16)
    // out of the safe area, and laid out again in the drift's room only for a large shrink.
    const move = translateDrift(ctx.rng, ctx.size.w)
    fitTo({ w: Math.floor(ctx.safe.w), h: Math.floor(ctx.safe.h) }, Math.floor(ctx.safe.h * COUNTER.maxH))
    let fit = driftFit(ctx, holder, [holder], COUNTER.drift, move)
    if (fit < DRIFT_MIN_FIT_SCALE) {
      fitTo(driftFitBox(ctx.safe, ctx.duration, COUNTER.drift, move), Math.floor((ctx.safe.h * COUNTER.maxH) / driftGrow(ctx.duration, COUNTER.drift)))
      fit = driftFit(ctx, holder, [holder], COUNTER.drift, move)
    }

    // The strike line (same drawing as the kinetic-text strike): through the middle of the settled
    // number's ink, as wide as it, in the holder's frame so it drifts with the number.
    let strike: HTMLElement | undefined
    if (p.strike) {
      span.textContent = formatCounter(p, p.to)
      const h = frameRect(ctx.layer, ctx.size.w, [holder])
      const g = inkRect(ctx.layer, ctx.size.w, span)!
      strike = strikeLine(ctx.look.vars.accent, ctx.dir === 'rtl' ? 1 : -1)
      Object.assign(strike.style, {
        left: `${(g.x - h.x).toFixed(2)}px`,
        width: `${g.w.toFixed(2)}px`,
        top: `${(g.y + g.h / 2 - h.y).toFixed(2)}px`,
      })
      holder.style.position = 'relative'
      holder.append(strike)
    }

    return {
      update(localT) {
        span.textContent = formatCounter(p, counterValue(p, localT, ctx.duration))
        if (strike) strike.style.transform = strikeTransform(localT - p.strike!.at)
        holder.style.transform = driftCss(localT, COUNTER.drift, move, fit)
      },
    }
  },
}
