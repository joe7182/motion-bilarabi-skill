/**
 * Shared bits of the «layers» primitives (`logo-row`, `layer-stack`, `node-graph`, `chat-thread`):
 * px formatting, colour mixes of the look's CSS variables, layered soft shadows (CSS, never canvas
 * shadowBlur) and image loading that waits for the decode.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg'

export const px = (n: number): string => `${n.toFixed(2)}px`

/** `color-mix` of `a` into `b` at `pct` % (0 → b, 100 → a). */
export const mix = (a: string, b: string, pct: number): string =>
  pct <= 0 ? b : pct >= 100 ? a : `color-mix(in srgb, ${a} ${pct.toFixed(2)}%, ${b})`

/** `color` at `alpha` (0..1) over transparent. */
export const alpha = (color: string, a: number): string => mix(color, 'transparent', a * 100)

/** Three stacked soft shadows (contact, mid, ambient), `k` = frame width / 1080, `s` = strength. */
export function softShadow(k: number, s = 1): string {
  return [
    `0 ${px(1.5 * k)} ${px(3 * k)} rgba(20, 16, 10, ${(0.08 * s).toFixed(3)})`,
    `0 ${px(10 * k)} ${px(24 * k)} rgba(20, 16, 10, ${(0.1 * s).toFixed(3)})`,
    `0 ${px(28 * k)} ${px(64 * k)} rgba(20, 16, 10, ${(0.1 * s).toFixed(3)})`,
  ].join(', ')
}

/** The same shadows as a `filter` chain (follows an image's alpha: tiles and bare marks alike). */
export function softDropShadow(k: number, s = 1): string {
  return [
    `drop-shadow(0 ${px(1.5 * k)} ${px(2 * k)} rgba(20, 16, 10, ${(0.1 * s).toFixed(3)}))`,
    `drop-shadow(0 ${px(8 * k)} ${px(12 * k)} rgba(20, 16, 10, ${(0.12 * s).toFixed(3)}))`,
  ].join(' ')
}

/** An `<img>` of `src` (a data URL after load), decoded before it is returned. */
export async function loadImage(src: string, who: string): Promise<HTMLImageElement> {
  const img = document.createElement('img')
  img.alt = ''
  img.draggable = false
  img.src = src
  try {
    await img.decode()
  } catch (e) {
    throw new Error(`تعذّر تحميل الصورة — ${who}: the image could not be loaded (${src.slice(0, 80)}; ${e instanceof Error ? e.message : String(e)})`)
  }
  return img
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration> = {}, part?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  Object.assign(e.style, style)
  if (part) e.dataset.mbaPart = part
  // `show` restores this display (flex, …) when the element comes back.
  if (style.display && style.display !== 'none') e.dataset.mbaShow = style.display
  return e
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

/** Shows (its own display, see `el`) or hides (`display: none`) `e`, writing only on a change. */
export function show(e: HTMLElement | SVGElement, visible: boolean): void {
  const d = visible ? (e.dataset.mbaShow ?? '') : 'none'
  if (e.style.display !== d) e.style.display = d
}

export const opacityOf = (o: number): string => (o >= 1 ? '' : Math.max(0, o).toFixed(4))

/** A unique-per-page id prefix for SVG defs (gradients, clips). */
let uid = 0
export const nextUid = (what: string): string => `mba-${what}-${++uid}`

/** Clamps `v` into [lo, hi] (the midpoint when the range is empty). */
export const clampIn = (v: number, lo: number, hi: number): number => (hi < lo ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi))

/** Shrinks `host`'s font from `fromPx` down to `minPx` until `unit` is at most `maxW` wide; returns the size used. */
export function fitFont(host: HTMLElement, unit: HTMLElement, fromPx: number, minPx: number, maxW: number): number {
  let fs = Math.round(fromPx)
  host.style.fontSize = `${fs}px`
  while (fs > Math.round(minPx) && unit.offsetWidth > maxW) host.style.fontSize = `${--fs}px`
  return fs
}
