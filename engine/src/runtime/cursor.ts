const SVG_NS = 'http://www.w3.org/2000/svg'

/** The fake pointer's artwork box (px at scale 1) and where its tip sits inside it. */
export const CURSOR_BOX = { w: 22, h: 31, tipX: 2, tipY: 2 } as const

/**
 * Our own arrow pointer as an `<svg>` (fill `fill`, outline `stroke`), sized `width` px wide. Its
 * tip is at (`tipX`, `tipY`) · width / CURSOR_BOX.w from the element's top-left, so a primitive
 * positions it by the tip. Shared by the primitives that draw a fake cursor (shape-states).
 */
export function cursorSvg(width: number, fill: string, stroke: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${CURSOR_BOX.w} ${CURSOR_BOX.h}`)
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String((width * CURSOR_BOX.h) / CURSOR_BOX.w))
  svg.style.display = 'block'
  svg.style.overflow = 'visible'
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', 'M2 2 L2 24 L7.5 19 L11.5 28 L15 26.5 L11 17.5 L18.5 17.5 Z')
  path.setAttribute('stroke-width', '1.6')
  path.setAttribute('stroke-linejoin', 'round')
  path.style.fill = fill
  path.style.stroke = stroke
  svg.append(path)
  return svg
}
