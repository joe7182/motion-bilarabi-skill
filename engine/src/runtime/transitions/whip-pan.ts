import { whipPanParams, type WhipPanParams } from '../../core/params/transitions'
import { easeInExpo, easeOutExpo, seg } from '../../core/ease'
import type { Transition } from './registry'
import { n } from './fmt'

/** The incoming layer starts this fraction of the frame away (R11), so it is on screen at the cut. */
export const WHIP_IN_FROM = 0.8

/**
 * Whip pan. The outgoing layer flies 0 → −1 frame (width for left/right, height for up/down) over
 * p 0 → 0.5 with easeInExpo; the incoming flies in from +0.8 frame → 0 over p 0.5 → 1 with
 * easeOutExpo. The blur follows the eased value, so it tracks the speed: 0 → blur, then blur → 0.
 * The overlay paints look.vars.bg only over the strip the moving layer has uncovered (never a full-frame
 * backing above the layers, R13), so no transparent gap shows.
 */
export const whipPan: Transition<WhipPanParams> = {
  id: 'whip-pan',
  params: whipPanParams,
  build(ctx, p) {
    const vertical = p.direction === 'up' || p.direction === 'down'
    const sign = p.direction === 'left' || p.direction === 'up' ? -1 : 1
    const len = vertical ? ctx.size.h : ctx.size.w
    const backing = document.createElement('div')
    Object.assign(backing.style, { position: 'absolute', inset: '0', background: ctx.look.vars.bg })
    ctx.overlay.append(backing)
    return {
      update(pr) {
        let layer: HTMLElement
        let off: number
        let blur: number
        if (pr < 0.5) {
          const e = easeInExpo(seg(pr, 0, 0.5))
          layer = ctx.out
          off = sign * len * e
          blur = p.blur * e
        } else {
          const e = easeOutExpo(seg(pr, 0.5, 1))
          layer = ctx.in
          off = -sign * len * WHIP_IN_FROM * (1 - e)
          blur = p.blur * (1 - e)
        }
        const o = n(off)
        layer.style.transform = o === '0' ? '' : vertical ? `translateY(${o}px)` : `translateX(${o}px)`
        layer.style.filter = blur < 0.01 ? '' : `blur(${n(blur)}px)`
        // The uncovered strip: on the far side when the layer moved negative, the near side when positive.
        const ins = [0, 0, 0, 0]
        if (vertical) {
          if (off <= 0) ins[0] = len + off
          else ins[2] = len - off
        } else if (off <= 0) ins[3] = len + off
        else ins[1] = len - off
        backing.style.clipPath = `inset(${ins.map((v) => `${n(v)}px`).join(' ')})`
      },
    }
  },
}
