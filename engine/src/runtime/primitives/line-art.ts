import { seg } from '../../core/ease'
import { drawEnd, drawProgress, LINE_ART_TIMING, lineArtParams, type LineArtParams } from '../../core/params/line-art'
import { LINE_ART } from '../icons/line-art'
import { DRIFT_MIN_FIT_SCALE, DRIFT_PER_SEC, driftCss, driftFitBox, translateDrift } from '../../core/params/drift'
import { driftFit } from '../drift-fit'
import type { BuildCtx, Primitive } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** A stroked SVG element drawn by dashoffset: `set(p)` shows the first `p` (0..1) of its length. */
export interface DrawnStroke {
  el: SVGGeometryElement
  length: number
  set(p: number): void
}

/**
 * Prepares stroked elements (already in the DOM, so their length can be measured) to self-draw:
 * dash = length, gap > length, offset = length · (1 − p). An undrawn stroke is hidden so its
 * round cap leaves no dot at the start; a finished one drops the dash.
 */
export function drawnStrokes(els: SVGGeometryElement[]): DrawnStroke[] {
  return els.map((el) => {
    const length = el.getTotalLength()
    const dash = `${length} ${length + 1}`
    const set = (p: number) => {
      el.setAttribute('stroke-dashoffset', String(length * (1 - p)))
      // Fully drawn: no dash at all. getTotalLength of a closed shape (rect, circle) can differ
      // slightly from the rendered outline, which would leave a cap bump where the dash ends.
      el.setAttribute('stroke-dasharray', p >= 1 ? 'none' : dash)
      el.setAttribute('opacity', p > 0 ? '1' : '0')
    }
    set(0)
    return { el, length, set }
  })
}

/** An `<svg>` filling its box, with stroke defaults (no fill, round caps and joins). */
export function strokeSvg(viewBox: { w: number; h: number }, color: string, strokeWidth: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${viewBox.w} ${viewBox.h}`)
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', color)
  svg.setAttribute('stroke-width', String(strokeWidth))
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.style.display = 'block'
  svg.style.overflow = 'visible'
  return svg
}

/** Frame px of a 0..1 safe-area point (default: the safe area's centre). */
export function safePointPx(ctx: BuildCtx, at?: { x: number; y: number }): { x: number; y: number } {
  return { x: ctx.safe.x + (at?.x ?? 0.5) * ctx.safe.w, y: ctx.safe.y + (at?.y ?? 0.5) * ctx.safe.h }
}

/**
 * Self-drawing line art (our own paths): each path draws by stroke-dashoffset from its length to 0
 * over `drawIn`, paths staggered 0.12 s, power2.out, all from `localT` in `update`. A scene shorter
 * than the draw compresses it. With `hold`, the finished art fades out `hold` s after it is drawn.
 * The art keeps the shared slow scale + seeded translate drift (R16).
 */
export const lineArt: Primitive<LineArtParams> = {
  id: 'line-art',
  params: lineArtParams,
  build(ctx, p) {
    const art = LINE_ART[p.art]
    const move = translateDrift(ctx.rng, ctx.size.w)
    const c = safePointPx(ctx, p.at)
    const root = document.createElement('div')
    root.dataset.mbaPart = 'line-art'
    if (p.key) root.dataset.mbaKey = p.key
    Object.assign(root.style, { position: 'absolute', transformOrigin: '50% 50%' })
    /** Sizes the art to `size` of the fit width (capped by its height), centred on `at`. */
    const sizeTo = (fit: { w: number; h: number }) => {
      let w = p.size * fit.w
      let h = (w * art.viewBox.h) / art.viewBox.w
      if (h > fit.h) {
        w *= fit.h / h
        h = fit.h
      }
      Object.assign(root.style, { left: `${c.x - w / 2}px`, top: `${c.y - h / 2}px`, width: `${w}px`, height: `${h}px` })
    }
    const svg = strokeSvg(art.viewBox, p.color ?? ctx.look.vars.accent, art.stroke)
    const paths = art.paths.map((d) => {
      const el = document.createElementNS(SVG_NS, 'path')
      el.setAttribute('d', d)
      svg.append(el)
      return el
    })
    root.append(svg)
    ctx.layer.append(root)
    // Natural size, as without a drift; shrunk as a whole only when the art would drift (R16) out of
    // the safe area, and laid out again in the drift's room only for a large shrink.
    sizeTo(ctx.safe)
    let fit = driftFit(ctx, root, [root], DRIFT_PER_SEC, move)
    if (fit < DRIFT_MIN_FIT_SCALE) {
      sizeTo(driftFitBox(ctx.safe, ctx.duration, DRIFT_PER_SEC, move))
      fit = driftFit(ctx, root, [root], DRIFT_PER_SEC, move)
    }
    const strokes = drawnStrokes(paths)

    const end = drawEnd(strokes.length, p.drawIn)
    const k = Math.min(1, ctx.duration / end)
    const fadeAt = p.hold === undefined ? Infinity : end * k + p.hold

    return {
      update(localT) {
        const t = localT / k
        strokes.forEach((s, i) => s.set(drawProgress(t, i, p.drawIn)))
        const o = 1 - seg(localT, fadeAt, fadeAt + LINE_ART_TIMING.exit)
        root.style.opacity = o === 1 ? '' : String(o)
        root.style.transform = driftCss(localT, DRIFT_PER_SEC, move, fit)
      },
    }
  },
}
