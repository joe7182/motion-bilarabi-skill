import { irisParams, type IrisParams } from '../../core/params/transitions'
import { easeOutExpo, seg } from '../../core/ease'
import type { Transition } from './registry'
import { coverRadius, shapeOverlay, STAR_NOTCH } from './shape-path'

/** The cover fades in over this part of an `open` iris; the hole then grows over the rest. */
export const IRIS_FADE = 0.2

/**
 * Iris. `open`: a full-frame cover in a look colour fades in over p 0 → 0.2 (over the outgoing
 * scene), then a circular hole at `origin` grows from nothing to the farthest corner over
 * p 0.2 → 1 (expo.out), revealing the incoming scene through it. `close` is the exact time mirror:
 * the hole shrinks onto `origin` over p 0 → 0.8, then the cover fades out over 0.8 → 1; the hole
 * shows the outgoing scene and the incoming one appears when the cover is gone.
 * Both scenes stay shown (`bothVisible`); the one the hole must not show has opacity 0 from the
 * moment the cover is opaque. One SVG with an even-odd path (cover minus circle).
 */
export const iris: Transition<IrisParams> = {
  id: 'iris',
  params: irisParams,
  build(ctx, p) {
    const cx = p.origin.x * ctx.size.w
    const cy = p.origin.y * ctx.size.h
    // A star must reach the corners with its notches, so its tips go further out.
    const full = coverRadius(ctx.size, cx, cy, 'circle') / (p.shape === 'star' ? STAR_NOTCH : 1)
    const ov = shapeOverlay(ctx.overlay, ctx.size, ctx.look.vars[p.color])
    const open = p.direction === 'open'
    return {
      bothVisible: true,
      update(pr) {
        // m runs 0 → 1 as an open iris; a close iris is the same picture played backwards.
        const m = open ? pr : 1 - pr
        // The hole shows the incoming scene (open) / the outgoing one (close); before it exists
        // (m < IRIS_FADE) the cover sits over the other.
        const holeScene = m >= IRIS_FADE
        const showOut = open ? !holeScene : holeScene
        ctx.out.style.opacity = showOut ? '1' : '0'
        ctx.in.style.opacity = showOut ? '0' : '1'
        ov.draw({
          cover: true,
          shape: p.shape,
          cx,
          cy,
          r: full * easeOutExpo(seg(m, IRIS_FADE, 1)),
          opacity: seg(m, 0, IRIS_FADE),
        })
      },
    }
  },
}
