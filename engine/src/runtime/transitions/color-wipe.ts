import { colorWipeParams, type ColorWipeParams } from '../../core/params/transitions'
import { easeInCubic, easeOutCubic, seg } from '../../core/ease'
import type { Transition } from './registry'
import { n } from './fmt'

/** clip-path inset sides, in CSS order: top, right, bottom, left. The side the panel enters from. */
const LEAD = { rtl: 1, ltr: 3, up: 2, down: 0 } as const

/**
 * A solid panel (look accent / fg / bg) sweeps across the frame. It grows in from the leading edge
 * over p 0 → 0.5 (easeInCubic), covers the whole frame at the cut (p = 0.5), then retreats out of
 * the far edge over p 0.5 → 1 (easeOutCubic). `rtl` enters from the right edge, `ltr` from the
 * left, `up` from the bottom, `down` from the top. Touches only its own overlay.
 */
export const colorWipe: Transition<ColorWipeParams> = {
  id: 'color-wipe',
  params: colorWipeParams,
  build(ctx, p) {
    const panel = document.createElement('div')
    Object.assign(panel.style, { position: 'absolute', inset: '0', background: ctx.look.vars[p.color] })
    ctx.overlay.append(panel)
    const lead = LEAD[p.direction]
    const far = (lead + 2) % 4
    return {
      update(pr) {
        const ins = [0, 0, 0, 0]
        // Growing: the uncovered part is on the far side. Retreating: the lead side opens up.
        if (pr < 0.5) ins[far] = 100 * (1 - easeInCubic(seg(pr, 0, 0.5)))
        else ins[lead] = 100 * easeOutCubic(seg(pr, 0.5, 1))
        panel.style.clipPath = `inset(${ins.map((v) => `${n(v)}%`).join(' ')})`
      },
    }
  },
}
