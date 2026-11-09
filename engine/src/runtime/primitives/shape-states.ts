import { clamp01, easeOutCubic, seg } from '../../core/ease'
import { earlyStart } from '../../core/params/common'
import { DRIFT_MIN_FIT_SCALE, DRIFT_PER_SEC, driftCss, driftFitBox, translateDrift } from '../../core/params/drift'
import { SHAPE_STATES, shapeAt, shapeStatesParams, stateLooks, type ShapeStatesParams } from '../../core/params/shape-states'
import { CURSOR_BOX, cursorSvg } from '../cursor'
import { driftFit } from '../drift-fit'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'
/** The root box is this much bigger than the widest / tallest state: room for the spring's overshoot. */
const OVERSHOOT = 1.06
const LABEL_PROBE_PX = 100

const px = (n: number) => `${n.toFixed(2)}px`
const pct = (n: number) => `${Math.min(100, Math.max(0, n)).toFixed(2)}%`

/** The opacity of state k's label at local `t`: it fades in ending at its `at` and out ending at the next `at`. */
function labelOpacity(p: ShapeStatesParams, k: number, t: number): number {
  const { fadeSec } = SHAPE_STATES
  const next = p.states[k + 1]
  const o = (k === 0 ? 1 : seg(t, p.states[k]!.at - fadeSec, p.states[k]!.at)) * (next ? 1 - seg(t, next.at - fadeSec, next.at) : 1)
  return clamp01(o)
}

/**
 * One shape that springs from UI state to UI state (button, pill, toggle, chip, card, window,
 * check): width, height, corner radius and paint are blended by closed-form springs (`shapeAt`),
 * so the shape IS each state at its `at`. A state's label is a whole line unit that cross-fades
 * to the next under a blur; a fake cursor glides in, presses and leaves around every change. The
 * shape drifts slowly like the other library primitives. Pure in `localT`.
 */
export const shapeStates: Primitive<ShapeStatesParams> = {
  id: 'shape-states',
  params: shapeStatesParams,
  build(ctx, p) {
    const { fg, bg, accent } = ctx.look.vars
    const move = translateDrift(ctx.rng, ctx.size.w)
    const c = safePointPx(ctx, p.at)
    const looks = stateLooks(p)
    const maxW = Math.max(...looks.map((l) => l.w)) * OVERSHOOT
    const maxH = Math.max(...looks.map((l) => l.h)) * OVERSHOOT
    const border = Math.max(2, ctx.size.w * 0.004)
    let U = 1
    let rootW = 1
    let rootH = 1

    const root = document.createElement('div')
    root.dataset.mbaPart = 'shape-states'
    if (p.key) root.dataset.mbaKey = p.key
    Object.assign(root.style, { position: 'absolute', transformOrigin: '50% 50%' })

    const shape = document.createElement('div')
    shape.dataset.mbaPart = 'shape'
    Object.assign(shape.style, { position: 'absolute', boxSizing: 'border-box', overflow: 'hidden' })

    const bar = document.createElement('div')
    bar.dataset.mbaPart = 'bar'
    Object.assign(bar.style, { position: 'absolute', left: '0', right: '0', top: '0', boxSizing: 'border-box', display: 'flex', alignItems: 'center', direction: 'rtl' })
    const dots = Array.from({ length: 3 }, () => {
      const d = document.createElement('div')
      Object.assign(d.style, { borderRadius: '50%', background: `color-mix(in srgb, ${fg} 35%, transparent)` })
      bar.append(d)
      return d
    })

    const knob = document.createElement('div')
    knob.dataset.mbaPart = 'knob'
    Object.assign(knob.style, { position: 'absolute', borderRadius: '50%' })

    const tickSvg = document.createElementNS(SVG_NS, 'svg')
    tickSvg.dataset.mbaPart = 'tick'
    tickSvg.setAttribute('viewBox', '0 0 100 100')
    Object.assign(tickSvg.style, { position: 'absolute', overflow: 'visible' })
    const tick = document.createElementNS(SVG_NS, 'path')
    tick.setAttribute('d', 'M26 52 L43 69 L76 33')
    tick.setAttribute('pathLength', '1')
    tick.setAttribute('fill', 'none')
    tick.setAttribute('stroke-width', '10')
    tick.setAttribute('stroke-linecap', 'round')
    tick.setAttribute('stroke-linejoin', 'round')
    tick.setAttribute('stroke-dasharray', '1 2')
    tick.style.stroke = bg
    tickSvg.append(tick)

    // One whole-line unit per labelled state (never on toggle / check: those are glyph-only).
    const labels = p.states.map((s, k) => {
      if (!s.label || s.kind === 'toggle' || s.kind === 'check') return undefined
      const unit = lineUnit(shape, s.label)
      Object.assign(unit.style, {
        position: 'absolute',
        left: '50%',
        color: s.kind === 'button' ? bg : fg,
        fontFamily: ctx.look.fontDisplay,
        fontWeight: String(FONT_WEIGHT.display),
        lineHeight: '1.4',
        fontSize: `${LABEL_PROBE_PX}px`,
        transformOrigin: '50% 50%',
      })
      return { k, unit, kind: s.kind, probeW: 0 }
    })
    shape.append(bar, knob, tickSvg)
    root.append(shape)
    ctx.layer.append(root)
    for (const l of labels) if (l) l.probeW = l.unit.offsetWidth

    let cursor: HTMLElement | undefined
    let cursorSize = 1
    if (p.cursor) {
      cursor = document.createElement('div')
      cursor.dataset.mbaPart = 'cursor'
      Object.assign(cursor.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', display: 'none' })
      root.append(cursor)
    }

    /** Sizes everything in units of `U = size × box.w` (capped so the tallest state fits the box). */
    const layout = (box: { w: number; h: number }) => {
      U = Math.min(p.size * box.w, box.h / maxH)
      rootW = maxW * U
      rootH = maxH * U
      Object.assign(root.style, { left: px(c.x - rootW / 2), top: px(c.y - rootH / 2), width: px(rootW), height: px(rootH) })
      const barPx = SHAPE_STATES.bar * U
      Object.assign(bar.style, { height: px(barPx), padding: `0 ${px(0.025 * U)}`, gap: px(0.014 * U), borderBottom: `${px(border)} solid color-mix(in srgb, ${fg} 24%, transparent)` })
      for (const d of dots) Object.assign(d.style, { width: px(0.02 * U), height: px(0.02 * U) })
      for (const l of labels) {
        if (!l) continue
        const g = looks[l.k]!
        const win = l.kind === 'window'
        const byHeight = win ? barPx * 0.5 : g.h * U * (l.kind === 'card' ? 0.2 : 0.42)
        const byWidth = (LABEL_PROBE_PX * g.w * U * (win ? 0.6 : 0.84)) / l.probeW
        Object.assign(l.unit.style, { fontSize: px(Math.max(8, Math.min(byHeight, byWidth))), top: win ? px(barPx / 2) : '50%' })
      }
      cursorSize = 0.09 * U
      if (cursor) {
        cursor.replaceChildren(cursorSvg(cursorSize, fg, bg))
        cursor.style.transformOrigin = `${px((CURSOR_BOX.tipX / CURSOR_BOX.w) * cursorSize)} ${px((CURSOR_BOX.tipY / CURSOR_BOX.w) * cursorSize)}`
      }
    }
    layout(ctx.safe)
    let fit = driftFit(ctx, root, [root], DRIFT_PER_SEC, move)
    if (fit < DRIFT_MIN_FIT_SCALE) {
      layout(driftFitBox(ctx.safe, ctx.duration, DRIFT_PER_SEC, move))
      fit = driftFit(ctx, root, [root], DRIFT_PER_SEC, move)
    }

    const first = p.states[0]!.at
    const enterStart = earlyStart(first, SHAPE_STATES.enterSec)

    return {
      update(localT) {
        const s = shapeAt(p, localT)
        const w = s.w * U
        const h = s.h * U
        const wi = Math.max(0, w - 2 * border)
        const hi = Math.max(0, h - 2 * border)
        root.style.opacity = String(seg(localT, enterStart, enterStart + SHAPE_STATES.enterSec))
        Object.assign(shape.style, {
          left: px((rootW - w) / 2),
          top: px((rootH - h) / 2),
          width: px(w),
          height: px(h),
          borderRadius: px(Math.max(0, s.radius * U)),
          background: `color-mix(in srgb, ${accent} ${pct(s.accent)}, color-mix(in srgb, ${fg} ${pct(s.fill)}, transparent))`,
          border: `${px(border)} solid color-mix(in srgb, ${fg} ${pct(s.border)}, transparent)`,
        })

        const barW = clamp01(s.bar)
        bar.style.display = barW > 0.001 ? 'flex' : 'none'
        bar.style.opacity = String(barW)

        const knobW = clamp01(s.knob)
        const d = 0.8 * hi
        const inset = 0.1 * hi
        knob.style.display = knobW > 0.001 ? 'block' : 'none'
        Object.assign(knob.style, {
          opacity: String(knobW),
          width: px(d),
          height: px(d),
          top: px(inset),
          // pos 0: against the reading start (right in RTL); pos 1: against the reading end (left).
          left: px(wi - inset - d + (inset - (wi - inset - d)) * s.pos),
          background: `color-mix(in srgb, ${bg} ${pct(s.pos * 100)}, ${fg})`,
        })

        const tickP = clamp01(s.tick)
        const tickSize = 0.62 * hi
        tickSvg.style.display = tickP > 0.001 ? 'block' : 'none'
        Object.assign(tickSvg.style, { width: px(tickSize), height: px(tickSize), left: px((wi - tickSize) / 2), top: px((hi - tickSize) / 2) })
        tick.setAttribute('stroke-dashoffset', (1 - tickP).toFixed(4))

        for (const l of labels) {
          if (!l) continue
          const o = labelOpacity(p, l.k, localT)
          l.unit.style.display = o > 0 ? 'inline-block' : 'none'
          if (o <= 0) continue
          Object.assign(l.unit.style, {
            opacity: o === 1 ? '' : o.toFixed(4),
            filter: o === 1 ? '' : `blur(${(SHAPE_STATES.blurPx * (1 - o)).toFixed(2)}px)`,
            transform: 'translate(-50%, -50%)',
          })
        }

        if (cursor) {
          // The latest state whose cursor has started gliding in; none before the first click.
          let k = -1
          for (let j = 1; j < p.states.length; j++) if (localT >= p.states[j]!.at - SHAPE_STATES.cursorIn) k = j
          const at = k < 0 ? 0 : p.states[k]!.at
          const [outA, outB] = SHAPE_STATES.cursorOut
          const o = k < 0 ? 0 : seg(localT, at - SHAPE_STATES.cursorIn, at - SHAPE_STATES.cursorIn + 0.1) * (1 - seg(localT, at + outA, at + outB))
          cursor.style.display = o > 0 ? 'block' : 'none'
          if (o > 0) {
            const g = easeOutCubic(seg(localT, at - SHAPE_STATES.cursorIn, at - SHAPE_STATES.cursorGlideEnd))
            const press = Math.sin(Math.PI * seg(localT, at - SHAPE_STATES.pressAt, at - SHAPE_STATES.pressAt + SHAPE_STATES.pressSec))
            // From below-right of the shape to its centre; the tip (not the box corner) lands on the target.
            const tipX = (CURSOR_BOX.tipX / CURSOR_BOX.w) * cursorSize
            const tipY = (CURSOR_BOX.tipY / CURSOR_BOX.w) * cursorSize
            const x = rootW / 2 + 0.04 * U + (1 - g) * 0.3 * U - tipX
            const y = rootH / 2 + 0.04 * U + (1 - g) * 0.3 * U - tipY
            cursor.style.opacity = o.toFixed(4)
            cursor.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(1 - 0.18 * press).toFixed(4)})`
          }
        }

        root.style.transform = driftCss(localT, DRIFT_PER_SEC, move, fit)
      },
    }
  },
}
