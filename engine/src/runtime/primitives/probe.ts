import gsap from 'gsap'
import { wordUnits } from '../text/units'
import { FONT_WEIGHT } from '../looks'
import type { Primitive } from './registry'
import { probeParams, type ProbeParams } from '../../core/params/probe'

/**
 * Internal test primitive (never documented to users). Renders `text` as word units in a box that
 * moves `x = 100 * localT` px via the pure `update`, and fades in on a paused GSAP timeline so
 * both motion paths are exercised by the determinism tests.
 */
export const probe: Primitive<ProbeParams> = {
  id: '_probe',
  params: probeParams,
  build(ctx, p) {
    const box = document.createElement('div')
    Object.assign(box.style, {
      position: 'absolute',
      left: `${ctx.safe.x}px`,
      top: `${ctx.safe.y + ctx.safe.h / 3}px`,
      width: `${ctx.safe.w}px`,
      fontFamily: ctx.look.fontDisplay,
      fontWeight: String(FONT_WEIGHT.display),
      fontSize: '120px',
      lineHeight: '1.4',
      color: ctx.look.vars.fg,
      textAlign: 'center',
    })
    ctx.layer.append(box)
    const words = wordUnits(box, p.text)
    words[0]?.style.setProperty('color', ctx.look.vars.accent)
    const timeline = gsap.timeline({ paused: true })
    timeline.fromTo(box, { opacity: 0.25 }, { opacity: 1, duration: ctx.duration, ease: 'none' })
    return {
      timeline,
      update(localT) {
        box.style.transform = `translateX(${100 * localT}px)`
      },
    }
  },
}
