import { easeOutCubic, seg } from '../../core/ease'
import { earlyStart } from '../../core/params/common'
import { HUD, hudParams, hudSectionAt, type HudParams } from '../../core/params/hud'
import { FONT_WEIGHT } from '../looks'
import { fitText, lineUnit } from '../text/units'
import type { Primitive } from './registry'

export const HUD_STYLE = {
  /** Label px: the larger of these (× min(w, h) / 1080 and × w / 1080), so it stays readable in every format. */
  labelPx: 48,
  labelPxPerWidth: 34,
  minPx: 28,
  /** Pip size (× label px). */
  pipW: 0.9,
  pipH: 0.3,
  pipGap: 0.3,
  /** Handle px (× label px). */
  handle: 0.8,
  /** A new label slides in from the start side by this much (× label px). */
  slide: 0.5,
} as const

/**
 * A heads-up overlay for a top track, at the safe area's top edge in every format: the current
 * section's label top-right (RTL start side; one line unit each, only the current one shown,
 * sliding in at its `at`), one pip per section top-left, filling right → left (a pip is full once
 * its section is over; the current one fills with the section's progress), and an optional handle
 * tag at 35 % opacity under the pips. It does not drift (an overlay that changes with sections);
 * the filling pip keeps it moving. Pure in `localT`.
 */
export const hud: Primitive<HudParams> = {
  id: 'hud',
  params: hudParams,
  build(ctx, p) {
    const px = Math.max(
      HUD_STYLE.minPx,
      Math.round(Math.max((HUD_STYLE.labelPx * Math.min(ctx.size.w, ctx.size.h)) / 1080, (HUD_STYLE.labelPxPerWidth * ctx.size.w) / 1080)),
    )
    const root = document.createElement('div')
    root.dataset.mbaPart = 'hud'
    if (p.key) root.dataset.mbaKey = p.key
    root.dir = 'rtl'
    Object.assign(root.style, {
      position: 'absolute',
      left: `${ctx.safe.x}px`,
      top: `${ctx.safe.y}px`,
      width: `${ctx.safe.w}px`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      fontFamily: ctx.look.fontBody,
      fontWeight: String(FONT_WEIGHT.bodyBold),
      fontSize: `${px}px`,
      lineHeight: '1.3',
      color: ctx.look.vars.fg,
      // The glyph boxes overhang the 1.3 line box; keep them below the safe area's top edge.
      paddingTop: '0.15em',
    })
    ctx.layer.append(root)

    const labelBox = document.createElement('div')
    labelBox.dataset.mbaPart = 'hud-label'
    const labelCap = Math.floor(p.size * ctx.safe.w)
    Object.assign(labelBox.style, { position: 'relative', maxWidth: `${labelCap}px` })
    root.append(labelBox)
    const labels = p.sections.map((s) => {
      const el = document.createElement('div')
      el.dataset.mbaPart = 'hud-section'
      Object.assign(el.style, { display: 'flex', alignItems: 'center', gap: '0.35em', whiteSpace: 'nowrap' })
      const mark = document.createElement('span')
      Object.assign(mark.style, { width: '0.28em', height: '0.9em', borderRadius: '0.1em', background: ctx.look.vars.accent, flexShrink: '0' })
      el.append(mark)
      lineUnit(el, s.label)
      labelBox.append(el)
      // A label too wide for its share of the safe width shrinks (never wraps: one line unit). The
      // box is capped by labelBox's maxWidth, so the overflow shows in scrollWidth, not offsetWidth.
      if (el.scrollWidth > labelCap) fitText(el, { w: labelCap, h: px * 3 }, px, HUD_STYLE.minPx)
      return el
    })

    // The pips and the handle keep to the rest of the width, a gap away from the label.
    const sideCap = Math.floor(ctx.safe.w - labelCap - px)
    const side = document.createElement('div')
    Object.assign(side.style, { maxWidth: `${sideCap}px`, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3em', paddingTop: '0.45em' })
    root.append(side)
    const pips =
      p.progress === 'pips'
        ? p.sections.map(() => {
            const pip = document.createElement('div')
            pip.dataset.mbaPart = 'hud-pip'
            Object.assign(pip.style, {
              width: `${HUD_STYLE.pipW}em`,
              height: `${HUD_STYLE.pipH}em`,
              borderRadius: `${HUD_STYLE.pipH / 2}em`,
              background: `color-mix(in srgb, ${ctx.look.vars.fg} 25%, transparent)`,
              overflow: 'hidden',
            })
            const fill = document.createElement('div')
            Object.assign(fill.style, { width: '100%', height: '100%', background: ctx.look.vars.accent, transformOrigin: '100% 50%' })
            pip.append(fill)
            return { pip, fill }
          })
        : []
    if (pips.length) {
      const row = document.createElement('div')
      // RTL row: the first section's pip is the rightmost, so progress runs right → left.
      Object.assign(row.style, { display: 'flex', gap: `${HUD_STYLE.pipGap}em` })
      row.append(...pips.map((x) => x.pip))
      side.append(row)
    }
    if (p.handle) {
      const tag = document.createElement('div')
      tag.dataset.mbaPart = 'hud-handle'
      Object.assign(tag.style, { fontSize: `${HUD_STYLE.handle}em`, opacity: String(HUD.handleOpacity), whiteSpace: 'nowrap' })
      lineUnit(tag, p.handle)
      side.append(tag)
      if (tag.scrollWidth > sideCap) {
        const hpx = Math.round(px * HUD_STYLE.handle)
        fitText(tag, { w: sideCap, h: hpx * 3 }, hpx, Math.min(hpx, HUD_STYLE.minPx))
      }
    }

    const ends = p.sections.map((s, k) => p.sections[k + 1]?.at ?? ctx.duration)
    return {
      update(localT) {
        const t = Math.min(Math.max(localT, 0), ctx.duration)
        const cur = hudSectionAt(p, t)
        labels.forEach((el, k) => {
          if (k !== cur) {
            el.style.display = 'none'
            return
          }
          el.style.display = 'flex'
          // R17: a section at 0 (before labelIn) is fully in on its `at`.
          const a0 = earlyStart(p.sections[k]!.at, HUD.labelIn)
          const x = seg(t, a0, a0 + HUD.labelIn)
          el.style.opacity = x === 1 ? '' : String(x)
          el.style.transform = x === 1 ? '' : `translateX(${((1 - easeOutCubic(x)) * HUD_STYLE.slide * px).toFixed(2)}px)`
        })
        pips.forEach(({ pip, fill }, k) => {
          const f = k < cur ? 1 : k === cur ? seg(t, p.sections[k]!.at, ends[k]!) : 0
          pip.dataset.mbaFilled = k < cur ? '1' : '0'
          fill.style.transform = `scaleX(${f.toFixed(4)})`
        })
      },
    }
  },
}
