import { easeOutCubic, seg } from '../../core/ease'
import { emphasisAt, settle } from '../../core/params/common'
import { LOGO_ROW as LR, logoColumns, logoRowParams, type LogoRowParams } from '../../core/params/logo-row'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import { alpha, clampIn, el, fitFont, loadImage, opacityOf, px, show, softDropShadow, svgEl } from './layers-kit'
import type { Primitive } from './registry'

interface Tile {
  wrap: HTMLElement
  img: HTMLImageElement
  ring: HTMLElement
  strike: SVGPathElement[]
  label?: HTMLElement
}

/**
 * `logo-row`: brand logos (project images: white tiles or bare marks) that pop in one by one —
 * scale 0.6 → 1 with a tiny settle and a fade — in a row (index 0 rightmost, RTL) or a grid of 3 per
 * row. Labels sit under the tiles (body font, fg at 80 %). `focus` grows one tile to ×1.15 inside an
 * accent ring while the others dim to 35 %; `strike` draws an accent line across a tile and greys
 * it; `out` fades the whole group. Layout is measured once at build; `update` only writes
 * transform / opacity / filter / dash offsets, from `localT`.
 */
export const logoRow: Primitive<LogoRowParams> = {
  id: 'logo-row',
  params: logoRowParams,
  async build(ctx, p) {
    const k = ctx.size.w / 1080
    const n = p.items.length
    const cols = logoColumns(p.layout, n)
    const rows = Math.ceil(n / cols)
    const side = p.size * ctx.safe.w
    const gap = LR.gap * side
    const pitch = side + gap
    const hasLabels = p.items.some((it) => it.label)
    const shadow = softDropShadow(k)

    const holder = el('div', { position: 'absolute', left: '0px', top: '0px' }, 'logo-row')
    if (p.key) holder.dataset.mbaKey = p.key
    ctx.layer.append(holder)

    // Labels first (they set the row height): one font size for every label, the largest that fits a pitch.
    const labelBox = side + gap * 0.9
    const labels: (HTMLElement | undefined)[] = p.items.map((it) => {
      if (!it.label) return undefined
      const l = el('div', {
        position: 'absolute', width: px(labelBox), textAlign: 'center', fontFamily: ctx.look.fontBody,
        fontWeight: String(FONT_WEIGHT.bodyBold), lineHeight: '1.2', whiteSpace: 'pre', color: alpha(ctx.look.vars.fg, 0.8),
      }, 'logo-label')
      const u = lineUnit(l, it.label)
      holder.append(l)
      const fs = fitFont(l, u, LR.labelPx * k, LR.labelMinPx * k, labelBox)
      if (u.offsetWidth > labelBox + 0.5) {
        throw new Error(`التسمية «${it.label}» أعرض من مكانها تحت الشعار؛ كبّر size أو قلّل الشعارات — logo-row: label "${it.label}" is wider than its tile (${Math.round(u.offsetWidth)} > ${Math.round(labelBox)} px at ${fs} px)`)
      }
      return l
    })
    const labelPx = Math.min(...labels.filter((l) => l).map((l) => parseFloat(l!.style.fontSize)), Infinity)
    for (const l of labels) if (l) l.style.fontSize = `${labelPx}px`
    const labelH = hasLabels ? Math.max(...labels.map((l) => l?.offsetHeight ?? 0)) : 0
    const labelTop = side * (1 + LR.labelGap)
    const rowH = hasLabels ? labelTop + labelH : side
    const rowGap = gap + (LR.focusScale - 1) * side

    const imgs = await Promise.all(p.items.map((it, i) => loadImage(it.image, `logo-row items[${i}].image`)))
    const tiles: Tile[] = p.items.map((it, i) => {
      const r = Math.floor(i / cols)
      const inRow = Math.min(cols, n - r * cols)
      const c = i % cols
      // RTL: index 0 is the rightmost; a shorter last row is centred.
      const x = (cols - inRow) * pitch * 0.5 + (inRow - 1 - c) * pitch
      const y = r * (rowH + rowGap)
      const wrap = el('div', { position: 'absolute', left: px(x), top: px(y), width: px(side), height: px(side), transformOrigin: '50% 50%' }, 'logo-tile')
      wrap.dataset.i = String(i)
      const img = imgs[i]!
      Object.assign(img.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', display: 'block', filter: shadow })
      const ring = el('div', {
        position: 'absolute', inset: px(-0.075 * side), borderRadius: px(0.31 * side),
        border: `${px(Math.max(2, 3 * k))} solid ${ctx.look.vars.accent}`,
        boxShadow: `0 0 0 ${px(7 * k)} ${alpha(ctx.look.vars.accent, 0.14)}`, display: 'none',
      })
      const sv = svgEl('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' })
      Object.assign(sv.style, { position: 'absolute', inset: px(-0.04 * side), width: px(side * 1.08), height: px(side * 1.08), overflow: 'visible', display: 'none' })
      const d = 'M 90 12 L 10 88'
      const under = svgEl('path', { d, fill: 'none', 'stroke-width': 13, 'stroke-linecap': 'round', pathLength: 100, 'stroke-dasharray': '100 100' })
      under.style.stroke = ctx.look.vars.bg
      const line = svgEl('path', { d, fill: 'none', 'stroke-width': 7, 'stroke-linecap': 'round', pathLength: 100, 'stroke-dasharray': '100 100' })
      line.style.stroke = ctx.look.vars.accent
      sv.append(under, line)
      wrap.append(ring, img, sv)
      holder.append(wrap)
      const label = labels[i]
      if (label) {
        label.style.left = px(x - (labelBox - side) / 2)
        label.style.top = px(y + labelTop)
      }
      return { wrap, img, ring, strike: [under, line], label }
    })

    // Place the group's extent on `at`, inside the safe area with room for the focus scale.
    const W = cols * side + (cols - 1) * gap
    const H = rows * rowH + (rows - 1) * rowGap
    const c = safePointPx(ctx, p.at)
    const m = (LR.focusScale - 1) * side * 0.5 + 0.075 * side + 2
    holder.style.left = px(clampIn(c.x - W / 2, ctx.safe.x + m, ctx.safe.x + ctx.safe.w - m - W))
    holder.style.top = px(clampIn(c.y - H / 2, ctx.safe.y + m, ctx.safe.y + ctx.safe.h - m - H))

    const focus = p.focus.map((f) => ({ at: f.at, key: f.index }))
    return {
      update(localT) {
        const t = localT
        const o = p.out === undefined ? 0 : easeOutCubic(seg(t, p.out, p.out + LR.outSec))
        tiles.forEach((tile, i) => {
          const a = p.items[i]!.at
          const visible = t >= a && o < 1
          show(tile.wrap, visible)
          if (tile.label) show(tile.label, visible)
          if (!visible) return
          const pop = LR.popFrom + (1 - LR.popFrom) * settle(seg(t, a, a + LR.popSec))
          const fade = easeOutCubic(seg(t, a, a + LR.popSec * 0.7))
          const { hl, dim } = emphasisAt(focus, i, t, LR.focusSec)
          const scale = pop * (1 + (LR.focusScale - 1) * hl) * (1 - (1 - LR.outScale) * o)
          const op = fade * (1 - (1 - LR.dim) * dim) * (1 - o)
          tile.wrap.style.transform = Math.abs(scale - 1) < 1e-6 ? '' : `scale(${scale.toFixed(5)})`
          tile.wrap.style.opacity = opacityOf(op)
          show(tile.ring, hl > 0.001)
          if (hl > 0.001) tile.ring.style.opacity = opacityOf(hl)

          // Strike: the last strike on this tile draws its line and greys the logo.
          const st = p.strike.filter((s) => s.index === i && t >= s.at).map((s) => s.at)
          const s = st.length ? easeOutCubic(seg(t, st[0]!, st[0]! + LR.strikeSec)) : 0
          show(tile.strike[0]!.parentNode as SVGElement, s > 0)
          if (s > 0) for (const path of tile.strike) path.setAttribute('stroke-dashoffset', (100 * (1 - s)).toFixed(3))
          tile.img.style.opacity = opacityOf(1 - (1 - LR.struckOpacity) * s)
          tile.img.style.filter = s > 0 ? `grayscale(${s.toFixed(4)}) ${shadow}` : shadow

          if (tile.label) {
            const lift = (LR.focusScale - 1) * side * 0.5 * hl + (1 - fade) * 10 * k - (1 - LR.outScale) * side * 0.5 * o
            tile.label.style.transform = Math.abs(lift) < 1e-4 ? '' : `translateY(${px(lift)})`
            tile.label.style.opacity = opacityOf(op)
          }
        })
      },
    }
  },
}
