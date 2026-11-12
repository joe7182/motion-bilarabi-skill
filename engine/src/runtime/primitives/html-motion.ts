import { htmlMotionParams, type HtmlMotionParams } from '../../core/params/html-motion'
import type { Primitive } from './registry'

let serial = 0

/**
 * html-motion: the scene's own HTML and CSS on a design canvas scaled to the frame. Its CSS
 * animations run on the video clock: every animation is paused and seeked by its delay
 * (`animation-delay: <own delay − t>`), so a frame is the same however it is reached (seek, render,
 * still) and the stage hiding the layer (display:none) between seeks changes nothing.
 */
export const htmlMotion: Primitive<HtmlMotionParams> = {
  id: 'html-motion',
  params: htmlMotionParams,
  build(ctx, p) {
    const uid = `mbah${++serial}`
    const k = ctx.size.w / p.design
    const fill = (s: string) => s.replace(/@@/g, `${uid}-`).replace(/\{\{a(\d+)\}\}/g, (_, i: string) => p.assets[Number(i)] ?? '')
    const style = document.createElement('style')
    style.textContent = fill(p.css.replace(/&/g, `.${uid}`))
    const root = document.createElement('div')
    root.className = uid
    Object.assign(root.style, {
      position: 'absolute', left: '0', top: '0', width: `${p.design}px`, height: `${(ctx.size.h / k).toFixed(2)}px`,
      transform: `scale(${k.toFixed(6)})`, transformOrigin: '0 0', overflow: 'hidden', pointerEvents: 'none',
    })
    root.innerHTML = fill(p.html)
    ctx.layer.append(style, root)
    // Every animated element with its own delays (s), read once while the layer is laid out.
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
    return {
      update(localT) {
        const t = Math.max(0, localT)
        for (const { el, delays } of animated) {
          el.style.animationPlayState = 'paused'
          el.style.animationDelay = delays.map((d) => `${(d - t).toFixed(4)}s`).join(', ')
        }
      },
    }
  },
}
