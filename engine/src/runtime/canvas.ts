import type { BuildCtx } from './primitives/registry'

/** A scene canvas: the element, its 2D context (pre-translated by `bleed`) and the bleed in px. */
export interface SceneCanvas {
  el: HTMLCanvasElement
  g: CanvasRenderingContext2D
  bleed: number
}

/**
 * A frame-sized canvas (devicePixelRatio 1: one canvas px per frame px) appended to `ctx.layer`,
 * absolutely positioned at the frame origin, decorative (`aria-hidden`, no pointer events).
 *
 * `bleed` (px, default 0): the canvas is `size + 2·bleed` on each axis and placed at `−bleed`, so
 * layer motion (handheld camera, shakes, parallax) never shows its edge. The context is translated
 * by `bleed` once, so drawing code works in frame coordinates (the bleed is x, y in −bleed..0 and
 * size..size + bleed). Code that resets the transform must restore it with
 * `g.setTransform(1, 0, 0, 1, bleed, bleed)`.
 */
export function sceneCanvas(ctx: Pick<BuildCtx, 'layer' | 'size'>, opts: { bleed?: number } = {}): SceneCanvas {
  const bleed = Math.max(0, Math.round(opts.bleed ?? 0))
  const w = ctx.size.w + 2 * bleed
  const h = ctx.size.h + 2 * bleed
  const el = document.createElement('canvas')
  el.width = w
  el.height = h
  el.setAttribute('aria-hidden', 'true')
  Object.assign(el.style, {
    position: 'absolute',
    left: `${-bleed}px`,
    top: `${-bleed}px`,
    width: `${w}px`,
    height: `${h}px`,
    pointerEvents: 'none',
  })
  ctx.layer.append(el)
  const g = el.getContext('2d')
  if (!g) throw new Error('canvas 2D context unavailable')
  g.setTransform(1, 0, 0, 1, bleed, bleed)
  return { el, g, bleed }
}

let probe: CanvasRenderingContext2D | null = null

/**
 * A CSS colour as `#rrggbb` (lower case), through a canvas's own colour parser. An unparsable or
 * empty value gives `#000000`. A translucent colour keeps only its rgb.
 */
function toHex(css: string): string {
  const v = css.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  probe ??= document.createElement('canvas').getContext('2d')
  if (!probe) return '#000000'
  probe.fillStyle = '#000000'
  if (v) probe.fillStyle = v
  const out = String(probe.fillStyle)
  if (out.startsWith('#')) return out.toLowerCase()
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(out)
  if (!m) return '#000000'
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
}

/**
 * The colour world in force at `el`: the computed `--mba-bg/fg/accent` (custom properties inherit,
 * so a layer sees the frame root's world unless a transition overrides them on that layer), as
 * `#rrggbb`. Canvas code calls it in `update` with its own `ctx.layer`, so world flips and reveals
 * apply on the frame they happen.
 */
export function resolvedWorld(el: HTMLElement): { bg: string; fg: string; accent: string } {
  const cs = getComputedStyle(el)
  return {
    bg: toHex(cs.getPropertyValue('--mba-bg')),
    fg: toHex(cs.getPropertyValue('--mba-fg')),
    accent: toHex(cs.getPropertyValue('--mba-accent')),
  }
}
