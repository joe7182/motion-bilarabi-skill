import { n } from './fmt'

/** The overlay of flood and iris: one full-frame SVG with a single even-odd path, filled with a look colour. */
export interface ShapeOverlay {
  /** Sets the path: an optional full-frame cover plus the shape of radius `r` px around (cx, cy) (even-odd: the shape is a hole in the cover). */
  draw(o: { cover: boolean; shape: 'circle' | 'square' | 'star'; cx: number; cy: number; r: number; opacity: number }): void
}

const SVG = 'http://www.w3.org/2000/svg'

export function shapeOverlay(parent: HTMLElement, size: { w: number; h: number }, fill: string): ShapeOverlay {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'hidden' })
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('fill-rule', 'evenodd')
  path.style.fill = fill
  svg.append(path)
  parent.append(svg)
  return {
    draw({ cover, shape, cx, cy, r, opacity }) {
      let d = cover ? `M0 0H${size.w}V${size.h}H0Z` : ''
      if (r > 0) {
        d +=
          shape === 'star'
            ? starPath(cx, cy, r)
            : shape === 'circle'
            ? `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`
            : `M${n(cx - r)} ${n(cy - r)}h${n(2 * r)}v${n(2 * r)}h${n(-2 * r)}Z`
      }
      path.setAttribute('d', d || 'M0 0')
      svg.style.opacity = n(opacity)
    },
  }
}

/** An eight-point star (two squares) of tip radius r as one outline: 8 tips, 8 notches. */
function starPath(cx: number, cy: number, r: number): string {
  const notch = r * STAR_NOTCH
  let d = ''
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2
    const rad = i % 2 ? notch : r
    d += `${i ? 'L' : 'M'}${n(cx + rad * Math.cos(a))} ${n(cy + rad * Math.sin(a))}`
  }
  return d + 'Z'
}
/** The star's notches sit at this share of its tip radius (where the two squares cross). */
export const STAR_NOTCH = Math.SQRT1_2 / Math.cos(Math.PI / 8)

/** Radius that covers the frame from (cx, cy): to the farthest corner (circle) or the farthest edge distance (square), plus a margin. */
export function coverRadius(size: { w: number; h: number }, cx: number, cy: number, shape: 'circle' | 'square'): number {
  const dx = Math.max(cx, size.w - cx)
  const dy = Math.max(cy, size.h - cy)
  return (shape === 'circle' ? Math.hypot(dx, dy) : Math.max(dx, dy)) * 1.02 + 1
}
