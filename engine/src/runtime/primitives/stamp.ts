import { DRIFT_MIN_FIT_SCALE, DRIFT_PER_SEC, driftCss, driftFitBox, translateDrift } from '../../core/params/drift'
import { STAMP_TIMING, stampParams, stampScale, type StampParams } from '../../core/params/stamp'
import { FONT_WEIGHT } from '../looks'
import { fitText, lineUnit } from '../text/units'
import { driftFit } from '../drift-fit'
import { safePointPx } from './line-art'
import { shakeAt, shakeKeys } from './slam'
import type { Primitive } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'

export const STAMP = {
  maxPx: 190,
  minPx: 56,
  /** Share of the safe height the stamp may take. */
  maxH: 0.36,
  /** Border stroke, inset and corner jitter (× font px). */
  stroke: 0.08,
  jitter: 0.035,
  /** One border vertex every `step` × font px. */
  step: 0.45,
  /** Border dash: ink runs of `run` (× font px), each followed by a gap of up to `gap`. */
  run: [0.5, 1.6],
  gap: 0.12,
} as const

/** A closed rough rectangle (frame px of the ink box) and a broken dash pattern, both from `rng`. */
function roughBorder(rng: () => number, w: number, h: number, px: number): { d: string; dash: string } {
  const inset = STAMP.stroke * px
  const j = () => (rng() * 2 - 1) * STAMP.jitter * px
  const pts: [number, number][] = []
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / (STAMP.step * px)))
    for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n + j(), y0 + ((y1 - y0) * k) / n + j()])
  }
  const [l, t, r, b] = [inset, inset, w - inset, h - inset]
  edge(l, t, r, t)
  edge(r, t, r, b)
  edge(r, b, l, b)
  edge(l, b, l, t)
  const d = `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`
  const dash: string[] = []
  const per = 2 * (w + h)
  for (let len = 0; len < per; ) {
    const run = (STAMP.run[0] + rng() * (STAMP.run[1] - STAMP.run[0])) * px
    const gap = rng() * STAMP.gap * px
    dash.push(run.toFixed(1), gap.toFixed(1))
    len += run + gap
  }
  return { d, dash: dash.join(' ') }
}

/**
 * A rubber stamp: the word (one line unit) inside a rough, broken border, rotated `rot`, in the
 * ink colour. It slams from 1.7× to 1 (expo.out, 0.25 s) on local 0, then a seeded 3 px shake
 * (0.15 s); the edge distress comes from the scene's seeded rng. It keeps the shared slow drift
 * (R16) afterwards. All from `localT` in `update`.
 */
export const stamp: Primitive<StampParams> = {
  id: 'stamp',
  params: stampParams,
  build(ctx, p) {
    const move = translateDrift(ctx.rng, ctx.size.w)
    const keys = shakeKeys(ctx.rng, STAMP_TIMING.shakeSteps, (STAMP_TIMING.shakeAmp * ctx.size.w) / 1080)
    const c = safePointPx(ctx, p.at)
    const color = p.color ?? ctx.look.vars.accent
    const root = document.createElement('div')
    root.dataset.mbaPart = 'stamp-root'
    Object.assign(root.style, { position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, transform: 'translate(-50%, -50%)' })
    const slam = document.createElement('div')
    slam.dataset.mbaPart = 'stamp-slam'
    slam.style.transformOrigin = '50% 50%'
    const ink = document.createElement('div')
    ink.dataset.mbaPart = 'stamp'
    if (p.key) ink.dataset.mbaKey = p.key
    Object.assign(ink.style, {
      position: 'relative',
      padding: '0.12em 0.55em',
      fontFamily: ctx.look.fontDisplay,
      fontWeight: String(FONT_WEIGHT.display),
      lineHeight: '1.35',
      color,
      whiteSpace: 'nowrap',
      transformOrigin: '50% 50%',
    })
    lineUnit(ink, p.text)
    slam.append(ink)
    root.append(slam)
    ctx.layer.append(root)

    let px = 0
    const sizeTo = (fit: { w: number; h: number }) => {
      ink.style.transform = ''
      px = fitText(ink, { w: Math.floor(p.size * fit.w), h: Math.floor(fit.h * STAMP.maxH) }, STAMP.maxPx, STAMP.minPx)
      ink.style.transform = `rotate(${p.rot}deg)`
    }
    // Natural size; shrunk as a whole when the drift (R16) would take it out of the safe area.
    sizeTo(ctx.safe)
    let fit = driftFit(ctx, root, [ink], DRIFT_PER_SEC, move)
    if (fit < DRIFT_MIN_FIT_SCALE) {
      sizeTo(driftFitBox(ctx.safe, ctx.duration, DRIFT_PER_SEC, move))
      fit = driftFit(ctx, root, [ink], DRIFT_PER_SEC, move)
    }

    // The distressed border, drawn for the final layout size.
    const w = ink.offsetWidth
    const h = ink.offsetHeight
    const border = roughBorder(ctx.rng, w, h, px)
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    svg.setAttribute('width', String(w))
    svg.setAttribute('height', String(h))
    Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', overflow: 'visible', pointerEvents: 'none' })
    const path = document.createElementNS(SVG_NS, 'path')
    for (const [k, v] of Object.entries({ d: border.d, fill: 'none', stroke: color, 'stroke-width': (STAMP.stroke * px).toFixed(1), 'stroke-linejoin': 'round', 'stroke-dasharray': border.dash })) {
      path.setAttribute(k, v)
    }
    svg.append(path)
    ink.prepend(svg)

    return {
      update(localT) {
        const t = Math.min(Math.max(localT, 0), ctx.duration)
        const o = shakeAt(keys, STAMP_TIMING.shake, t - STAMP_TIMING.slam)
        const s = stampScale(t)
        slam.style.transform = `translate(${o.x.toFixed(2)}px, ${o.y.toFixed(2)}px) scale(${s.toFixed(4)})`
        root.style.transform = `translate(-50%, -50%) ${driftCss(t, DRIFT_PER_SEC, move, fit)}`
      },
    }
  },
}
