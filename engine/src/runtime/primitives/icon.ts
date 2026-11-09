import { seg, easeOutCubic } from '../../core/ease'
import { springStep } from '../../core/springs'
import { drawEnd, drawProgress } from '../../core/params/line-art'
import { ICON_TIMING, iconParams, type IconParams } from '../../core/params/icon'
import { LUCIDE } from '../icons/lucide'
import { FONT_WEIGHT } from '../looks'
import { fitText, lineUnit } from '../text/units'
import { drawnStrokes, safePointPx, strokeSvg } from './line-art'
import { DRIFT_MIN_FIT_SCALE, DRIFT_PER_SEC, driftCss, driftFitBox, translateDrift } from '../../core/params/drift'
import { driftFit } from '../drift-fit'
import type { Primitive } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'

export const ICON = {
  /** Label size range (px at any frame width; ≥ 48 px keeps it readable at 1080 w). */
  labelMaxPx: 88,
  labelMinPx: 48,
  /** Last resort for a long label (up to 40 characters, one line) that overflows at labelMinPx. */
  labelHardMinPx: 36,
  /** Gap between the icon and its label, in label px × this. */
  labelGap: 0.35,
} as const

/**
 * An animated Lucide icon with an optional Arabic label (one line unit) under it.
 * - `draw`: the strokes self-draw (0.6 s each, staggered 0.12 s, power2.out) at 94 % scale, then
 *   settle to 100 % on the `playful` spring (the 6 % settle).
 * - `pop`: fully drawn, scale 0 → 1 on the `playful` spring.
 * The label fades in and rises. Everything is computed from `localT` in `update`.
 */
export const icon: Primitive<IconParams> = {
  id: 'icon',
  params: iconParams,
  build(ctx, p) {
    const move = translateDrift(ctx.rng, ctx.size.w)
    const c = safePointPx(ctx, p.at)
    const root = document.createElement('div')
    root.dataset.mbaPart = 'icon'
    if (p.key) root.dataset.mbaKey = p.key
    Object.assign(root.style, {
      position: 'absolute',
      left: `${c.x}px`,
      top: `${c.y}px`,
      transform: 'translate(-50%, -50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    })
    const box = document.createElement('div')
    box.dataset.mbaPart = 'icon-box'
    Object.assign(box.style, { transformOrigin: '50% 50%' })
    const svg = strokeSvg({ w: 24, h: 24 }, p.color ?? ctx.look.vars.accent, 2)
    const els = LUCIDE[p.icon].map(([tag, attrs]) => {
      const el = document.createElementNS(SVG_NS, tag) as SVGGeometryElement
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
      svg.append(el)
      return el
    })
    box.append(svg)
    root.append(box)
    ctx.layer.append(root)

    let label: HTMLElement | undefined
    if (p.label) {
      label = document.createElement('div')
      label.dataset.mbaPart = 'label'
      Object.assign(label.style, {
        fontFamily: ctx.look.fontBody,
        fontWeight: String(FONT_WEIGHT.bodyBold),
        lineHeight: '1.3',
        color: ctx.look.vars.fg,
        whiteSpace: 'nowrap',
      })
      lineUnit(label, p.label)
      root.append(label)
    }
    /** Sizes the icon to `size` of `fitW` and fits the label (one line) inside `fitW`. */
    const sizeTo = (fitW: number) => {
      const side = p.size * fitW
      Object.assign(box.style, { width: `${side}px`, height: `${side}px` })
      if (!label) return
      const lbox = { w: fitW, h: ICON.labelMaxPx * 2 }
      let px = fitText(label, lbox, ICON.labelMaxPx, ICON.labelMinPx)
      // A label too long for one line at labelMinPx shrinks further, down to labelHardMinPx.
      if (Math.max(label.scrollWidth, label.offsetWidth) > fitW) px = fitText(label, lbox, ICON.labelMinPx, ICON.labelHardMinPx)
      label.style.marginTop = `${Math.round(px * ICON.labelGap)}px`
    }
    // Natural size, as without a drift; shrunk as a whole only when the icon and label would drift
    // (R16) out of the safe area, and laid out again in the drift's room only for a large shrink.
    const content = label ? [box, label] : [box]
    sizeTo(Math.floor(ctx.safe.w))
    let fit = driftFit(ctx, root, content, DRIFT_PER_SEC, move)
    if (fit < DRIFT_MIN_FIT_SCALE) {
      sizeTo(driftFitBox(ctx.safe, ctx.duration, DRIFT_PER_SEC, move).w)
      fit = driftFit(ctx, root, content, DRIFT_PER_SEC, move)
    }

    const strokes = drawnStrokes(els)
    const draw = p.enter === 'draw'
    const end = drawEnd(strokes.length, ICON_TIMING.drawIn)
    // A short scene compresses the draw and the label timing; the springs keep their own pace.
    const k = draw ? Math.min(1, ctx.duration / (end + ICON_TIMING.labelIn)) : 1
    const settleAt = end * k
    const labelAt = ICON_TIMING.labelAt[p.enter] * k

    return {
      update(localT) {
        let scale: number
        if (draw) {
          strokes.forEach((s, i) => s.set(drawProgress(localT / k, i, ICON_TIMING.drawIn)))
          scale = ICON_TIMING.settleFrom + (1 - ICON_TIMING.settleFrom) * springStep(localT - settleAt, 'playful')
        } else {
          for (const s of strokes) s.set(1)
          scale = springStep(localT, 'playful')
        }
        box.style.transform = `scale(${scale})`
        root.style.transform = `translate(-50%, -50%) ${driftCss(localT, DRIFT_PER_SEC, move, fit)}`
        if (label) {
          const x = seg(localT, labelAt, labelAt + ICON_TIMING.labelIn * k)
          label.style.opacity = String(x)
          label.style.transform = x === 1 ? '' : `translateY(${(1 - easeOutCubic(x)) * ICON_TIMING.labelRise}px)`
        }
      },
    }
  },
}
