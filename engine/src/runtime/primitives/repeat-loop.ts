import { REPEAT_LOOP, repeatLoopParams, type RepeatLoopParams } from '../../core/params/repeat-loop'
import { easeOutExpo, seg } from '../../core/ease'
import { FONT_WEIGHT } from '../looks'
import { frameRect } from '../drift-fit'
import { lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

/** One copy of the word. */
interface Copy {
  unit: HTMLElement
  /** Slot in the loop (0 = the readable copy in the middle) and entrance order. */
  slot: number
}

/**
 * repeat-loop (Plan 3 Task 6b): repetition the eye can read. `copies` whole-word DOM copies of one
 * word (`lineUnit`, never split). The readable copy sits still in the middle, in the accent at full
 * opacity; it enters first, then one ghost copy per beat (`REPEAT_LOOP.beat`), each sliding in.
 *
 * - `stack`: the ghosts fill a tight vertical ring (pitch `REPEAT_LOOP.pitch` × the line box) that
 *   scrolls up `turns` whole rings over the scene and wraps — an endless loop — masked to a box with
 *   soft top and bottom edges; a ghost's opacity falls with its distance from the middle and dips to
 *   0 as it passes behind the readable copy.
 * - `orbit`: the ghosts sit on a circle around the readable copy, tangent to it, turning `turns`
 *   times over the scene.
 *
 * Ghost copies are `aria-hidden` and stay below the audit's opacity floor (texture, like word-wall);
 * the readable copy is kept inside the safe area. Every position is a pure function of local time.
 */
export const repeatLoop: Primitive<RepeatLoopParams> = {
  id: 'repeat-loop',
  params: repeatLoopParams,
  build(ctx, p) {
    const box = document.createElement('div')
    box.dataset.mbaPart = 'repeat-loop'
    if (p.key) box.dataset.mbaKey = p.key
    Object.assign(box.style, {
      position: 'absolute',
      fontFamily: ctx.look.fontDisplay,
      fontWeight: String(FONT_WEIGHT.display),
      lineHeight: '1.3',
      whiteSpace: 'nowrap',
    })
    ctx.layer.append(box)

    // the readable copy first in entrance order, then the ghosts slot by slot
    const copies: Copy[] = []
    for (let slot = 0; slot < p.copies; slot++) {
      const unit = lineUnit(box, p.text)
      Object.assign(unit.style, { position: 'absolute', left: '0px', top: '0px', color: slot === 0 ? ctx.look.vars.accent : ctx.look.vars.fg })
      if (slot > 0) unit.setAttribute('aria-hidden', 'true')
      else unit.style.zIndex = '1'
      copies.push({ unit, slot })
    }
    // DOM order: the readable copy in the middle of the stack
    const mid = Math.floor(p.copies / 2)
    box.insertBefore(copies[0]!.unit, box.children[mid + 1] ?? null)

    // the word as wide as `size` of the safe width (orbit: a little under half of it), its line box at most a quarter of the safe height
    const PROBE = 100
    box.style.fontSize = `${PROBE}px`
    const probe = frameRect(ctx.layer, ctx.size.w, [copies[0]!.unit])
    const wantW = p.size * ctx.safe.w * (p.mode === 'orbit' ? 0.45 : 1)
    const fs = Math.max(8, Math.floor(Math.min((PROBE * wantW) / probe.w, (PROBE * ctx.safe.h * 0.25) / probe.h)))
    box.style.fontSize = `${fs}px`
    const word = frameRect(ctx.layer, ctx.size.w, [copies[0]!.unit])

    // centre: `at`, kept so the readable copy is inside the safe area
    const at = safePointPx(ctx, p.at)
    // Task 7: by its glyph box too (taller than the line box), which the audit checks.
    const range = document.createRange()
    range.selectNodeContents(copies[0]!.unit)
    const glyph = frameRect(ctx.layer, ctx.size.w, [range])
    const hw = Math.max(word.w, glyph.w) / 2
    const hh = Math.max(word.h, glyph.h) / 2
    const cx = Math.min(Math.max(at.x, ctx.safe.x + hw), ctx.safe.x + ctx.safe.w - hw)
    const cy = Math.min(Math.max(at.y, ctx.safe.y + hh), ctx.safe.y + ctx.safe.h - hh)
    const pitch = REPEAT_LOOP.pitch * word.h
    const ring = p.copies * pitch
    const len = Math.max(ctx.duration, 1e-3)

    let place: (c: Copy, t: number) => { x: number; y: number; rot: number; alpha: number }
    if (p.mode === 'stack') {
      // the mask box: the ring's height (at most 0.8 of the safe height), the safe width
      const bw = ctx.safe.w
      const bh = Math.min(ring, ctx.safe.h * 0.8)
      const bx = ctx.safe.x
      // R32 (Task 7): the box is clamped to the safe area, so a loop placed near an edge never masks ghosts outside it.
      const by = Math.min(Math.max(cy - bh / 2, ctx.safe.y), ctx.safe.y + ctx.safe.h - bh)
      Object.assign(box.style, {
        left: `${bx}px`,
        top: `${by.toFixed(2)}px`,
        width: `${bw}px`,
        height: `${bh.toFixed(2)}px`,
        overflow: 'hidden',
        maskImage: 'linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)',
        webkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)',
      })
      const x0 = cx - bx - word.w / 2
      const y0 = cy - by - word.h / 2
      const reach = Math.max(1.5, bh / 2 / pitch)
      const speed = (p.turns * ring) / len
      place = (c, t) => {
        if (c.slot === 0) return { x: x0, y: y0, rot: 0, alpha: 1 }
        const raw = c.slot * pitch - speed * t
        const y = ((((raw + ring / 2) % ring) + ring) % ring) - ring / 2
        const d = Math.abs(y) / pitch
        // gone behind the readable copy (within half a pitch), peaks beside it, fades with distance
        const alpha = d < 1 ? REPEAT_LOOP.near * seg(d, 0.5, 1) ** 2 : REPEAT_LOOP.near - (REPEAT_LOOP.near - REPEAT_LOOP.far) * Math.min(1, (d - 1) / Math.max(0.5, reach - 1))
        return { x: x0, y: y0 + y, rot: 0, alpha }
      }
    } else {
      Object.assign(box.style, { left: '0px', top: '0px', width: `${ctx.size.w}px`, height: `${ctx.size.h}px` })
      const R = REPEAT_LOOP.orbitR * ctx.safe.w
      const ghosts = p.copies - 1
      const turn = (2 * Math.PI * p.turns) / len
      place = (c, t) => {
        if (c.slot === 0) return { x: cx - word.w / 2, y: cy - word.h / 2, rot: 0, alpha: 1 }
        const a = -Math.PI / 2 + (2 * Math.PI * (c.slot - 1)) / ghosts + turn * t
        return { x: cx + R * Math.cos(a) - word.w / 2, y: cy + R * Math.sin(a) - word.h / 2, rot: a + Math.PI / 2, alpha: REPEAT_LOOP.orbitAlpha }
      }
    }

    return {
      update(localT) {
        for (const c of copies) {
          const pos = place(c, localT)
          // entrance: a beat after the previous copy, sliding in from below
          const e = easeOutExpo(seg(localT, c.slot * REPEAT_LOOP.beat, c.slot * REPEAT_LOOP.beat + REPEAT_LOOP.enterSec))
          const dy = (1 - e) * (c.slot === 0 ? 0.2 : 0.6) * word.h
          const rot = pos.rot ? ` rotate(${pos.rot.toFixed(4)}rad)` : ''
          c.unit.style.transform = `translate(${pos.x.toFixed(2)}px, ${(pos.y + dy).toFixed(2)}px)${rot}`
          c.unit.style.opacity = String(Math.round(pos.alpha * e * 1000) / 1000)
        }
      },
    }
  },
}
