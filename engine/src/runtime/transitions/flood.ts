import { floodParams, type FloodParams } from '../../core/params/transitions'
import { easeInExpo, easeOutExpo, seg } from '../../core/ease'
import type { Transition } from './registry'
import { coverRadius, shapeOverlay } from './shape-path'

/**
 * Flood. A circle or square in a look colour (accent / fg / bg) grows from `origin` (frame
 * fractions) over p 0 → 0.5 (expo.in) until it covers the whole frame at the cut, then contracts to
 * a point at `origin` over p 0.5 → 1 (expo.out), revealing the incoming scene. One SVG with a
 * single path in the overlay; the outgoing scene shows for p < 0.5, the incoming from p = 0.5.
 * The colour is a `var(--mba-*)`, so a world flip under the transition recolours it.
 */
export const flood: Transition<FloodParams> = {
  id: 'flood',
  params: floodParams,
  build(ctx, p) {
    const cx = p.origin.x * ctx.size.w
    const cy = p.origin.y * ctx.size.h
    const full = coverRadius(ctx.size, cx, cy, p.shape)
    const ov = shapeOverlay(ctx.overlay, ctx.size, ctx.look.vars[p.color])
    return {
      update(pr) {
        const grow = pr < 0.5 ? easeInExpo(seg(pr, 0, 0.5)) : 1 - easeOutExpo(seg(pr, 0.5, 1))
        ov.draw({ cover: false, shape: p.shape, cx, cy, r: full * grow, opacity: 1 })
      },
    }
  },
}
