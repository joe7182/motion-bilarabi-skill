import { easeOutCubic, seg } from '../../core/ease'
import { CHECKLIST_TIMING, checklistParams, checkStart, rowStart, type ChecklistParams } from '../../core/params/checklist'
import { DRIFT_MIN_FIT_SCALE, DRIFT_PER_SEC, driftCss, driftFitBox, translateDrift } from '../../core/params/drift'
import { power2Out } from '../../core/params/line-art'
import { FONT_WEIGHT } from '../looks'
import { fitText, lineUnit } from '../text/units'
import { drawnStrokes, strokeSvg } from './line-art'
import { driftFit } from '../drift-fit'
import type { Primitive } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'

export const CHECKLIST = {
  /**
   * Scale drift per second once settled (Pro Pace; drift.ts). On its own it is under the review's
   * static threshold here, so a seeded translate drift (R16, DRIFT_PX_PER_SEC) is added.
   */
  drift: DRIFT_PER_SEC,
  /** Font range (px). The block aims at `fillW` of the safe width; below minPx only as a last resort. */
  maxPx: 160,
  minPx: 56,
  hardMinPx: 40,
  fillW: 0.78,
  /** Check box side, gap between box and text, gap between rows (× font px). */
  box: 1.1,
  gap: 0.45,
  rowGap: 0.5,
  /** A row slides in from its start side by this much (× font px). */
  slide: 0.8,
  /** Our own check mark and box, in a 24×24 view box. */
  checkPath: 'M6.5 12.5l3.6 3.6L17.5 8.5',
  boxRadius: 5,
} as const

/**
 * A checklist: row i fades and slides in from its start side at `items[i].at` (0.25 s), then its
 * check stroke self-draws over 0.3 s (power2.out), all from `localT` in `update`. Each label is one
 * line unit; the list is fitted to the safe area (≤ 8 rows) and keeps a slow scale + seeded translate drift (R16)
 * after the last check.
 */
export const checklist: Primitive<ChecklistParams> = {
  id: 'checklist',
  params: checklistParams,
  build(ctx, p) {
    const root = document.createElement('div')
    root.dataset.mbaPart = 'checklist'
    Object.assign(root.style, {
      position: 'absolute',
      left: `${ctx.safe.x}px`,
      top: `${ctx.safe.y}px`,
      width: `${ctx.safe.w}px`,
      height: `${ctx.safe.h}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    })
    const list = document.createElement('div')
    if (p.key) list.dataset.mbaKey = p.key
    Object.assign(list.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: `${CHECKLIST.rowGap}em`,
      fontFamily: ctx.look.fontBody,
      fontWeight: String(FONT_WEIGHT.bodyBold),
      lineHeight: '1.4',
      color: ctx.look.vars.fg,
      transformOrigin: '50% 50%',
    })
    root.append(list)
    ctx.layer.append(root)

    const rows = p.items.map((it) => {
      const row = document.createElement('div')
      row.dataset.mbaPart = 'row'
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: `${CHECKLIST.gap}em` })
      const box = document.createElement('div')
      Object.assign(box.style, { width: `${CHECKLIST.box}em`, height: `${CHECKLIST.box}em`, flexShrink: '0' })
      const svg = strokeSvg({ w: 24, h: 24 }, ctx.look.vars.fg, 2.2)
      const frame = document.createElementNS(SVG_NS, 'rect')
      for (const [k, v] of Object.entries({ x: '2.5', y: '2.5', width: '19', height: '19', rx: String(CHECKLIST.boxRadius), opacity: '0.45' })) frame.setAttribute(k, v)
      const check = document.createElementNS(SVG_NS, 'path')
      check.dataset.mbaPart = 'check'
      check.setAttribute('d', CHECKLIST.checkPath)
      check.setAttribute('stroke', ctx.look.vars.accent)
      check.setAttribute('stroke-width', '3')
      svg.append(frame, check)
      box.append(svg)
      row.append(box)
      const label = lineUnit(row, it.text)
      if (it.key) label.dataset.mbaKey = it.key
      list.append(row)
      return { row, check }
    })

    // As in slam: the glyph boxes overhang the line boxes; keep them inside the fit box too.
    const glyphs = document.createRange()
    glyphs.selectNodeContents(list)
    const glyphH = () => glyphs.getBoundingClientRect().height
    /** Fits the list inside `fit`, sized to about CHECKLIST.fillW of the safe width, centred. */
    const rowPx = p.rowPx !== undefined ? Math.round((p.rowPx * ctx.size.w) / 1080) : undefined
    const fitTo = (fit: { w: number; h: number }): number => {
      // Re-review of the fix wave: the pulse (1.15, inside the audit's rest tolerance) must stay in
      // the safe area, so the rows are fitted to the width that leaves room for it.
      const fitW = p.pulse ? Math.floor(fit.w / CHECKLIST_TIMING.pulseScale) : fit.w
      const box = { w: rowPx !== undefined ? fitW : Math.min(fitW, Math.floor(ctx.safe.w * CHECKLIST.fillW)), h: fit.h }
      let px = fitText(list, box, rowPx ?? CHECKLIST.maxPx, CHECKLIST.minPx)
      const overflows = () => Math.max(list.scrollWidth, list.offsetWidth) > fit.w || Math.max(list.scrollHeight, list.offsetHeight) > fit.h
      if (overflows()) px = fitText(list, { w: fit.w, h: fit.h }, CHECKLIST.minPx, CHECKLIST.hardMinPx)
      while (px > CHECKLIST.hardMinPx && glyphH() > fit.h) {
        px -= 1
        list.style.fontSize = `${px}px`
      }
      return px
    }
    // Natural size, as without a drift; shrunk as a whole only when the list would drift (R16) out
    // of the safe area, and laid out again in the drift's room only for a large shrink.
    // Critic round 2: the list centred at `y` of the frame height, as far as the safe area allows
    // (a layout offset before the drift fit, so keyed rows are measured where they rest).
    const place = () => {
      if (p.y === undefined) return
      list.style.top = ''
      const lh = Math.max(list.getBoundingClientRect().height, glyphH())
      const room = Math.max(0, (ctx.safe.h - lh) / 2)
      const dy = Math.max(-room, Math.min(room, p.y * ctx.size.h - (ctx.safe.y + ctx.safe.h / 2)))
      list.style.position = 'relative'
      list.style.top = `${dy.toFixed(2)}px`
    }
    const move = translateDrift(ctx.rng, ctx.size.w)
    let px = fitTo({ w: Math.floor(ctx.safe.w), h: Math.floor(ctx.safe.h) })
    place()
    let fit = driftFit(ctx, list, [list, glyphs], CHECKLIST.drift, move)
    if (fit < DRIFT_MIN_FIT_SCALE) {
      px = fitTo(driftFitBox(ctx.safe, ctx.duration, CHECKLIST.drift, move))
      place()
      fit = driftFit(ctx, list, [list, glyphs], CHECKLIST.drift, move)
    }
    const strokes = drawnStrokes(rows.map((r) => r.check))
    const side = ctx.dir === 'rtl' ? 1 : -1

    return {
      update(localT) {
        list.style.transform = driftCss(localT, CHECKLIST.drift, move, fit)
        p.items.forEach((it, i) => {
          const { row } = rows[i]!
          const r = rowStart(it)
          const x = seg(localT, r, r + CHECKLIST_TIMING.rowIn)
          row.style.opacity = x === 1 ? '' : String(x)
          const c = checkStart(it)
          // Pulse after the tick (a sine swell, pure in t).
          const q = p.pulse ? seg(localT, c + CHECKLIST_TIMING.checkIn, c + CHECKLIST_TIMING.checkIn + CHECKLIST_TIMING.pulse) : 0
          const scale = q > 0 && q < 1 ? 1 + (CHECKLIST_TIMING.pulseScale - 1) * Math.sin(Math.PI * q) : 1
          const e = easeOutCubic(x)
          const slide = CHECKLIST.slide * (p.pulse ? CHECKLIST_TIMING.popSlide : 1)
          const tx = x === 1 ? '' : `translateX(${(side * (1 - e) * slide * px).toFixed(2)}px)`
          const s = x < 1 && p.pulse ? CHECKLIST_TIMING.popFrom + (1 - CHECKLIST_TIMING.popFrom) * e : scale
          row.style.transform = [tx, s !== 1 ? `scale(${s.toFixed(4)})` : ''].filter(Boolean).join(' ')
          strokes[i]!.set(power2Out(seg(localT, c, c + CHECKLIST_TIMING.checkIn)))
        })
      },
    }
  },
}
