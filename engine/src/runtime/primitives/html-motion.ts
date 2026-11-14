import { htmlMotionParams, type HtmlMotionParams } from '../../core/params/html-motion'
import type { Primitive } from './registry'

let serial = 0

/**
 * Puts every CSS animation under `root` on the video clock: each one is paused and seeked by its
 * delay (`animation-delay: <own delay − t>`), so a frame is the same however it is reached (seek,
 * render, still) and the stage hiding the layer (display:none) between seeks changes nothing. Call
 * once the elements are in the document (their delays are read then); returns the per-frame update.
 */
export function cssClock(root: HTMLElement): (localT: number) => void {
  const animated: { el: HTMLElement | SVGElement; delays: number[] }[] = []
  for (const el of [root, ...root.querySelectorAll<HTMLElement | SVGElement>('*')]) {
    const cs = getComputedStyle(el)
    if (!cs.animationName || cs.animationName === 'none') continue
    const delays = cs.animationDelay.split(',').map((d) => {
      const v = parseFloat(d)
      return d.trim().endsWith('ms') ? v / 1000 : v
    })
    animated.push({ el, delays })
    el.style.animationPlayState = 'paused'
  }
  return (localT) => {
    const t = Math.max(0, localT)
    for (const { el, delays } of animated) {
      el.style.animationPlayState = 'paused'
      el.style.animationDelay = delays.map((d) => `${(d - t).toFixed(4)}s`).join(', ')
    }
  }
}

/** A design canvas `design` px wide, scaled to the frame, appended to the layer. */
export function designCanvas(layer: HTMLElement, size: { w: number; h: number }, design: number, className: string): HTMLElement {
  const k = size.w / design
  const root = document.createElement('div')
  root.className = className
  Object.assign(root.style, {
    position: 'absolute', left: '0', top: '0', width: `${design}px`, height: `${(size.h / k).toFixed(2)}px`,
    transform: `scale(${k.toFixed(6)})`, transformOrigin: '0 0', overflow: 'hidden', pointerEvents: 'none',
  })
  layer.append(root)
  return root
}

/**
 * html-motion: the scene's own HTML and CSS on a design canvas scaled to the frame, its CSS
 * animations on the video clock (`cssClock`).
 */
export const htmlMotion: Primitive<HtmlMotionParams> = {
  id: 'html-motion',
  params: htmlMotionParams,
  build(ctx, p) {
    const uid = `mbah${++serial}`
    const fill = (s: string) => s.replace(/@@/g, `${uid}-`).replace(/\{\{a(\d+)\}\}/g, (_, i: string) => p.assets[Number(i)] ?? '')
    const style = document.createElement('style')
    style.textContent = fill(p.css.replace(/&/g, `.${uid}`))
    ctx.layer.append(style)
    const root = designCanvas(ctx.layer, ctx.size, p.design, uid)
    root.innerHTML = fill(p.html)
    const tick = cssClock(root)
    return { update: tick }
  },
}
