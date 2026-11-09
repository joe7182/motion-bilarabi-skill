import { zoomThroughParams, type ZoomThroughParams } from '../../core/params/transitions'
import { easeInExpo, easeOutBack, seg } from '../../core/ease'
import type { Transition } from './registry'
import { n } from './fmt'

/** Incoming opacity at the cut (R12), so the cut frame already shows the incoming scene. */
export const ZOOM_IN_FROM_OPACITY = 0.3

/**
 * Zoom through the frame centre. Outgoing: scale 1 → `scale` (easeInExpo) over p 0 → 0.5, fading
 * 1 → 0 only over p 0.38 → 0.5. Incoming: scale 0.7 → 1 (easeOutBack, s = 1.2) over p 0.5 → 1,
 * opacity 0.3 → 1 over p 0.5 → 0.58.
 */
export const zoomThrough: Transition<ZoomThroughParams> = {
  id: 'zoom-through',
  params: zoomThroughParams,
  build(ctx, p) {
    return {
      update(pr) {
        let layer: HTMLElement
        let s: number
        let o: number
        if (pr < 0.5) {
          layer = ctx.out
          s = 1 + (p.scale - 1) * easeInExpo(seg(pr, 0, 0.5))
          o = 1 - seg(pr, 0.38, 0.5)
        } else {
          layer = ctx.in
          s = 0.7 + 0.3 * easeOutBack(seg(pr, 0.5, 1), 1.2)
          o = ZOOM_IN_FROM_OPACITY + (1 - ZOOM_IN_FROM_OPACITY) * seg(pr, 0.5, 0.58)
        }
        const sc = n(s)
        layer.style.transformOrigin = '50% 50%'
        layer.style.transform = sc === '1' ? '' : `scale(${sc})`
        layer.style.opacity = n(o)
      },
    }
  },
}
