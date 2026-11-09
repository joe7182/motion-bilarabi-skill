import { easeInOutSine, easeOutCubic, seg } from '../../core/ease'
import { DRIFT_PER_SEC, driftCss, driftGrow, translateDrift } from '../../core/params/drift'
import { MASK, RISE } from '../../core/params/kinetic-text'
import {
  SECTION_NUMBER,
  sectionEnterSec,
  sectionNumberParams,
  sectionNumberText,
  type SectionNumberParams,
} from '../../core/params/section-number'
import { driftFit, frameRect } from '../drift-fit'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

/** One line of the block: the whole-word unit and, for `mask-line`, the row box that clips its entrance. */
interface Row {
  /** The row: carries the font size (so the mask's padding in em follows it). */
  host: HTMLElement
  unit: HTMLElement
  mask?: HTMLElement
  /** Seconds after the scene start the line starts to enter. */
  delay: number
  px: number
  /** Room (frame px) between the glyph box and the frame's bottom edge at rest. */
  room: number
}

/**
 * A section number: a giant two-digit number (`fontDisplay` 900, «٠٤» or "04") with its title under
 * it (`fontBody` 700, at least 48 px), each one whole line unit. The number spans `size` of the safe
 * width (capped by the safe height); the block is centred on `at` and kept inside the safe area. It
 * enters with `mask-line` (each line lifts out from under its row) or `rise` (translates up out of a
 * blur), the title a beat after the number, and keeps the shared slow scale + seeded translate drift.
 */
export const sectionNumber: Primitive<SectionNumberParams> = {
  id: 'section-number',
  params: sectionNumberParams,
  build(ctx, p) {
    /** Easing of the entrances: ease-out (default) or easy ease (sine in-out, both ends eased). */
    const EO = p.ease === 'easy' ? easeInOutSine : easeOutCubic
    const holder = document.createElement('div')
    holder.dataset.mbaPart = 'section-number'
    if (p.key) holder.dataset.mbaKey = p.key
    Object.assign(holder.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      color: ctx.look.vars.fg,
      transformOrigin: '50% 50%',
    })
    ctx.layer.append(holder)

    const row = (text: string, delay: number, font: { family: string; weight: number }, lineHeight: number, pad: number): Row => {
      const host = document.createElement('div')
      Object.assign(host.style, { lineHeight: String(lineHeight) })
      holder.append(host)
      let mask: HTMLElement | undefined
      let parent: HTMLElement = host
      if (p.enter === 'mask-line') {
        // The row clips the line while it lifts; the padding keeps marks and dots inside it.
        mask = document.createElement('div')
        mask.dataset.mbaPart = 'mask'
        Object.assign(mask.style, { overflow: 'hidden', padding: `${pad}em 0.1em` })
        host.append(mask)
        parent = mask
      }
      const unit = lineUnit(parent, text)
      Object.assign(unit.style, { fontFamily: font.family, fontWeight: String(font.weight), transformOrigin: '50% 55%' })
      return { host, unit, ...(mask ? { mask } : {}), delay, px: 0, room: 0 }
    }
    // The digits fill their line box (a line height of 0.9 em); the title's row leaves room for marks.
    const num = row(sectionNumberText(p), 0, { family: ctx.look.fontDisplay, weight: FONT_WEIGHT.display }, SECTION_NUMBER.numberLine, SECTION_NUMBER.numberPad)
    const title = row(p.title, SECTION_NUMBER.titleDelay, { family: ctx.look.fontBody, weight: FONT_WEIGHT.bodyBold }, 1.3, MASK.pad)
    const glyphs = (u: HTMLElement) => {
      const r = document.createRange()
      r.selectNodeContents(u)
      return r
    }
    const numGlyphs = glyphs(num.unit)
    const titleGlyphs = glyphs(title.unit)

    // Size. The number spans `size` of the safe width; but the audit measures glyph boxes (the
    // font's whole ascent + descent, 1.87 em for Cairo), so the block is also shrunk until those
    // fit the safe area with the drift's growth (its travel is then fitted by `driftFit`).
    const grow = driftGrow(ctx.duration)
    const limitW = ctx.safe.w / grow
    // Ruling T9-c: a `band` keeps the whole block in the top of the safe area.
    const limitH = ctx.safe.h * (p.band ?? 1)
    const PROBE = 100
    num.host.style.fontSize = `${PROBE}px`
    let px = Math.floor((PROBE * p.size * limitW) / frameRect(ctx.layer, ctx.size.w, [num.unit]).w)
    const titleW = () => frameRect(ctx.layer, ctx.size.w, [title.unit]).w
    const extent = () => frameRect(ctx.layer, ctx.size.w, [holder, numGlyphs, titleGlyphs])
    for (let pass = 0; pass < 4; pass++) {
      num.px = px
      num.host.style.fontSize = `${num.px}px`
      // The title: at least 48 px; a long one shrinks to that floor, and only then wraps (whole words).
      title.px = Math.max(SECTION_NUMBER.titleMinPx, Math.round(num.px * SECTION_NUMBER.titleRatio))
      title.host.style.fontSize = `${title.px}px`
      Object.assign(title.unit.style, { whiteSpace: 'pre', maxWidth: '' })
      while (title.px > SECTION_NUMBER.titleMinPx && titleW() > limitW) {
        title.px -= 1
        title.host.style.fontSize = `${title.px}px`
      }
      if (titleW() > limitW) Object.assign(title.unit.style, { whiteSpace: 'normal', maxWidth: `${Math.floor(limitW)}px` })
      const e = extent()
      const shrink = Math.min(1, limitH / (e.h * grow), limitW / e.w)
      if (shrink >= 0.995) break
      px = Math.floor(px * shrink)
    }

    // Place the block's glyph extent on `at`, kept inside the safe area.
    const c = safePointPx(ctx, p.at ?? SECTION_NUMBER.at)
    const u = frameRect(ctx.layer, ctx.size.w, [holder, numGlyphs, titleGlyphs])
    const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi))
    holder.style.left = `${clamp(c.x - (u.x + u.w / 2), ctx.safe.x - u.x, ctx.safe.x + ctx.safe.w - u.w - u.x).toFixed(2)}px`
    holder.style.top = `${clamp(c.y - (u.y + u.h / 2), ctx.safe.y - u.y, ctx.safe.y + limitH - u.h * grow - u.y).toFixed(2)}px`

    const move = translateDrift(ctx.rng, ctx.size.w)
    const fit = driftFit(ctx, holder, [holder, numGlyphs, titleGlyphs], DRIFT_PER_SEC, move)

    const rows = [num, title]
    // The audit ignores the row's clip: a line still lower than the frame's bottom edge would be
    // reported as clipped-by-frame, so it stays invisible until it has risen into the frame.
    for (const r of rows) {
      const g = frameRect(ctx.layer, ctx.size.w, [glyphs(r.unit)])
      r.room = ctx.size.h - g.y - g.h - 4
    }
    return {
      update(localT) {
        for (const r of rows) {
          const len = sectionEnterSec(p.enter)
          const x = seg(localT - r.delay, 0, len)
          const e = EO(x)
          let opacity: number
          let y: number
          let filter = ''
          if (p.enter === 'rise') {
            opacity = x
            y = (1 - e) * RISE.lift * r.px
            if (x > 0 && x < 1) filter = `blur(${((1 - e) * RISE.blur).toFixed(2)}px)`
          } else {
            y = (1 - e) * MASK.from * r.px
            opacity = x > 0 && y <= r.room ? 1 : 0
            r.mask!.style.overflow = x < 1 ? 'hidden' : 'visible'
          }
          r.unit.style.opacity = opacity === 1 ? '' : String(opacity)
          r.unit.style.transform = y === 0 ? '' : `translateY(${y.toFixed(2)}px)`
          r.unit.style.filter = filter
        }
        holder.style.transform = driftCss(localT, DRIFT_PER_SEC, move, fit)
      },
    }
  },
}
