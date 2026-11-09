import { driftFitScale, type Rect, type TranslateDrift } from '../core/params/drift'

/** Anything with a border box: an element, or a Range over glyphs that overhang their line boxes. */
type Boxed = { getBoundingClientRect(): DOMRect }

/**
 * Union of the elements' border boxes in frame px (relative to `layer`, undoing any CSS scale of
 * the frame, e.g. the preview fitting it to the window). Measured at build time, before any drift.
 */
export function frameRect(layer: HTMLElement, frameW: number, els: Boxed[]): Rect {
  const L = layer.getBoundingClientRect()
  const k = L.width > 0 ? L.width / frameW : 1
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    x0 = Math.min(x0, r.left)
    y0 = Math.min(y0, r.top)
    x1 = Math.max(x1, r.right)
    y1 = Math.max(y1, r.bottom)
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: (x0 - L.left) / k, y: (y0 - L.top) / k, w: (x1 - x0) / k, h: (y1 - y0) / k }
}

/**
 * The uniform shrink (`driftFitScale`, 1 = none) that keeps the content `els`, as just laid out,
 * inside the safe area for the whole scene while `driftEl` drifts about its centre (50 % 50 %).
 * Primitives fold it into `driftCss`; below DRIFT_MIN_FIT_SCALE they lay out again in `driftFitBox`.
 */
export function driftFit(
  ctx: { layer: HTMLElement; size: { w: number }; safe: Rect; duration: number },
  driftEl: HTMLElement,
  els: Boxed[],
  rate: number,
  move?: TranslateDrift,
): number {
  const o = frameRect(ctx.layer, ctx.size.w, [driftEl])
  const c = frameRect(ctx.layer, ctx.size.w, els)
  return driftFitScale(c, ctx.safe, { x: o.x + o.w / 2, y: o.y + o.h / 2 }, ctx.duration, rate, move)
}
