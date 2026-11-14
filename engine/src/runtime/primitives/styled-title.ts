import { styledTitleParams, type StyledTitleParams } from '../../core/params/styled-title'
import { titleCss, titleHtml } from '../../core/title-styles'
import { cssClock, designCanvas } from './html-motion'
import type { Primitive } from './registry'

let serial = 0

/**
 * styled-title: a title placed with the style picker — the shared title CSS and HTML
 * (core/title-styles) on a 1080-wide canvas, its entrance and exit on the video clock. Behind the
 * head, the person comes from a `cutout` scene on the track above.
 */
export const styledTitle: Primitive<StyledTitleParams> = {
  id: 'styled-title',
  params: styledTitleParams,
  build(ctx, p) {
    const uid = `mbat${++serial}`
    const style = document.createElement('style')
    style.textContent = titleCss(`.${uid}`)
    ctx.layer.append(style)
    const root = designCanvas(ctx.layer, ctx.size, 1080, uid)
    root.innerHTML = titleHtml({
      text: p.text, key: p.key, lines: p.lines, style: p.style, font: p.font, layer: p.layer,
      cx: p.cx, cy: p.cy, w: p.w, size: p.size, animIn: p.in, animOut: p.out,
      at: p.at, outAt: p.outAt ?? Math.max(p.at + 0.8, ctx.duration - 0.5),
      ...(p.colors ? { colors: p.colors } : {}),
    })
    return { update: cssClock(root) }
  },
}
