import { easeInCubic, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import { softSpring } from '../../core/params/morph-object'
import {
  NUMBERED_SLOTS as NS,
  numberedSlotsParams,
  slotAppearAt,
  slotEmphasis,
  slotNumeral,
  type NumberedSlotsParams,
} from '../../core/params/numbered-slots'
import { frameRect } from '../drift-fit'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

const SVG = 'http://www.w3.org/2000/svg'
const px = (n: number) => `${n.toFixed(2)}px`
const pct = (x: number) => `${(Math.min(Math.max(x, 0), 1) * 100).toFixed(2)}%`

/** `color-mix` of `a` over `b` by `x` (0 → b, 1 → a); plain `b` / `a` at the ends. */
const mix = (a: string, b: string, x: number) => (x <= 0 ? b : x >= 1 ? a : `color-mix(in srgb, ${a} ${pct(x)}, ${b})`)

/** Padlock (viewBox 0 0 100 100): shackle group (pivots on its left leg) + body with a keyhole. */
function padlock(fg: string, hole: string): { svg: SVGSVGElement; shackle: SVGGElement } {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.overflow = 'visible'
  const shackle = document.createElementNS(SVG, 'g')
  shackle.innerHTML = `<path d="M31 47 V31 a19 19 0 0 1 38 0 V47" fill="none" stroke="${fg}" stroke-width="10" stroke-linecap="round"/>`
  const body = document.createElementNS(SVG, 'g')
  body.innerHTML =
    `<rect x="17" y="43" width="66" height="48" rx="11" fill="${fg}"/>` +
    `<circle cx="50" cy="62" r="7.5" fill="${hole}"/>` +
    `<rect x="46.25" y="63" width="7.5" height="14" rx="3.5" fill="${hole}"/>`
  svg.append(shackle, body)
  return { svg, shackle }
}

interface Slot {
  wrap: HTMLElement
  card: HTMLElement
  numeral: HTMLElement
  label?: HTMLElement
  lock?: { el: HTMLElement; shackle: SVGGElement }
}

/**
 * `numbered-slots` (Stage 1B): `count` numbered cards in a row, slot «١» the RIGHTMOST (RTL). Each
 * card is a rounded square of the look's surface with its numeral (display font, large, a DOM line
 * unit) and an optional label under it. Slots pop in at their `appear` time (soft spring); one may
 * be `locked` (dark card, padlock, numeral blurred) and open at `unlockAt` (the shackle snaps, the
 * lock drops and fades, the card flashes accent, the numeral clears); `active` entries highlight
 * one slot (accent fill, ×1.08) and dim the others to 45 %. Everything from `localT` in `update`.
 */
export const numberedSlots: Primitive<NumberedSlotsParams> = {
  id: 'numbered-slots',
  params: numberedSlotsParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const N = p.count
    const rowW = p.width * ctx.safe.w
    let side = rowW / (N + (N - 1) * NS.gap)
    side = Math.min(side, ctx.safe.h * 0.42)
    const gap = side * NS.gap
    const pitch = side + gap
    const surface = `color-mix(in srgb, ${ctx.look.vars.fg} 6%, ${ctx.look.vars.bg})`

    const holder = document.createElement('div')
    holder.dataset.mbaPart = 'numbered-slots'
    if (p.key) holder.dataset.mbaKey = p.key
    Object.assign(holder.style, { position: 'absolute', left: '0px', top: '0px', width: px(N * side + (N - 1) * gap), height: px(side) })
    ctx.layer.append(holder)

    // Label font: labelRatio × side within [min, max]; shrunk (to the min) until each fits the pitch.
    const labelMax = Math.min(NS.labelMaxPx * k, Math.max(NS.labelMinPx * k, NS.labelRatio * side))
    const labelBox = side + gap * 0.9

    const slots: Slot[] = []
    for (let i = 0; i < N; i++) {
      const wrap = document.createElement('div')
      wrap.dataset.mbaPart = 'numbered-slot'
      wrap.dataset.i = String(i)
      Object.assign(wrap.style, {
        position: 'absolute',
        left: px((N - 1 - i) * pitch),
        top: '0px',
        width: px(side),
        height: px(side),
        transformOrigin: '50% 50%',
      })
      // In the document from the start: the label is measured below.
      holder.append(wrap)
      const card = document.createElement('div')
      Object.assign(card.style, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        width: px(side),
        height: px(side),
        borderRadius: px(NS.radius * side),
        background: surface,
        boxShadow: [
          `inset 0 0 0 ${px(Math.max(1.5, 2 * k))} color-mix(in srgb, ${ctx.look.vars.fg} 12%, transparent)`,
          `0 ${px(2 * k)} ${px(5 * k)} rgba(20, 16, 10, 0.08)`,
          `0 ${px(12 * k)} ${px(30 * k)} rgba(20, 16, 10, 0.12)`,
          `0 ${px(30 * k)} ${px(70 * k)} rgba(20, 16, 10, 0.10)`,
        ].join(', '),
      })
      const numHost = document.createElement('div')
      Object.assign(numHost.style, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        width: px(side),
        height: px(side),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: ctx.look.fontDisplay,
        fontWeight: String(FONT_WEIGHT.display),
        fontSize: px(NS.numeral * side),
        lineHeight: '1',
        color: ctx.look.vars.fg,
      })
      const numeral = lineUnit(numHost, slotNumeral(p, i))
      card.append(numHost)
      wrap.append(card)
      const slot: Slot = { wrap, card, numeral }
      if (p.locked === i) {
        const { svg, shackle } = padlock(NS.lockFg, NS.lockedBg)
        const el = document.createElement('div')
        const d = NS.lockSize * side
        Object.assign(el.style, { position: 'absolute', left: px((side - d) / 2), top: px((side - d) / 2), width: px(d), height: px(d), transformOrigin: '50% 50%' })
        Object.assign(svg.style, { width: '100%', height: '100%', display: 'block' })
        shackle.style.transformOrigin = '31px 47px'
        shackle.style.transformBox = 'view-box'
        el.append(svg)
        wrap.append(el)
        slot.lock = { el, shackle }
      }
      if (p.labels) {
        const label = document.createElement('div')
        Object.assign(label.style, {
          position: 'absolute',
          left: px(-(labelBox - side) / 2),
          top: px(side * (1 + NS.labelGap)),
          width: px(labelBox),
          textAlign: 'center',
          fontFamily: ctx.look.fontBody,
          fontWeight: String(FONT_WEIGHT.bodyBold),
          lineHeight: '1.25',
          color: ctx.look.vars.fg,
          whiteSpace: 'pre',
        })
        const u = lineUnit(label, p.labels[i]!)
        wrap.append(label)
        let fs = Math.round(labelMax)
        label.style.fontSize = `${fs}px`
        while (fs > Math.round(NS.labelMinPx * k) && u.offsetWidth > labelBox) label.style.fontSize = `${--fs}px`
        if (u.offsetWidth > labelBox + 0.5) {
          throw new Error(
            `التسمية «${p.labels[i]}» أعرض من خانتها؛ قلّل عدد الخانات أو كبّر width — numbered-slots: label "${p.labels[i]}" is wider than its slot (${Math.round(u.offsetWidth)} > ${Math.round(labelBox)} px at ${fs} px)`,
          )
        }
        slot.label = label
      }
      slots.push(slot)
    }
    // One label size for the whole row: the smallest any label needed.
    if (p.labels) {
      const fs = Math.min(...slots.map((s) => parseFloat(s.label!.style.fontSize)))
      for (const s of slots) s.label!.style.fontSize = `${fs}px`
    }

    // Place the row's extent (cards, numeral glyphs, labels) on `at`, inside the safe area with room
    // for the active card's 1.08 scale.
    const ranges = slots.flatMap((s) => [s.numeral, ...(s.label ? [s.label.firstElementChild!] : [])]).map((el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return r
    })
    const u = frameRect(ctx.layer, ctx.size.w, [...slots.map((s) => s.card), ...ranges])
    const c = safePointPx(ctx, p.at)
    const m = (NS.activeScale - 1) * side * 0.5 + 2
    const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi))
    holder.style.left = px(clamp(c.x - (u.x + u.w / 2), ctx.safe.x + m - u.x, ctx.safe.x + ctx.safe.w - m - u.w - u.x))
    holder.style.top = px(clamp(c.y - (u.y + u.h / 2), ctx.safe.y + m - u.y, ctx.safe.y + ctx.safe.h - m - u.h - u.y))

    const U = p.unlockAt
    return {
      update(localT) {
        const t = localT
        slots.forEach((s, i) => {
          const a = slotAppearAt(p, i)
          if (t < a) {
            s.wrap.style.display = 'none'
            return
          }
          s.wrap.style.display = ''
          const pop = NS.popFrom + (1 - NS.popFrom) * softSpring(seg(t, a, a + NS.popSec))
          const fade = easeOutCubic(seg(t, a, a + NS.fadeSec))
          const { hl, dim } = slotEmphasis(p, i, t)

          // Lock state: L = 1 locked … 0 open; F = the unlock flash.
          let L = 0
          let F = 0
          let punch = 1
          let clear = 1
          if (p.locked === i) {
            if (U === undefined || t < U) {
              L = 1
              clear = 0
            } else {
              L = 1 - easeOutCubic(seg(t, U + 0.05, U + 0.35))
              F = t < U + NS.flashPeak ? easeOutCubic(seg(t, U, U + NS.flashPeak)) : 1 - easeOutCubic(seg(t, U + NS.flashPeak, U + NS.flashEnd))
              punch = 1 + 0.07 * Math.sin(Math.PI * seg(t, U, U + 0.35))
              clear = easeOutCubic(seg(t, U + NS.revealFrom, U + NS.revealFrom + NS.revealSec))
            }
            const lock = s.lock!
            const sh = U === undefined ? 0 : seg(t, U, U + NS.shackleSec)
            const e = easeOutBack(sh, 2.4)
            lock.shackle.style.transform = sh <= 0 ? '' : `translate(0px, ${(-9 * e).toFixed(3)}px) rotate(${(-32 * e).toFixed(3)}deg)`
            const d = U === undefined ? 0 : seg(t, U + NS.dropFrom, U + NS.dropFrom + NS.dropSec)
            lock.el.style.display = d >= 1 ? 'none' : ''
            const fall = easeInCubic(d)
            lock.el.style.transform = d <= 0 ? '' : `translateY(${px(fall * 0.8 * side)}) rotate(${(16 * fall).toFixed(3)}deg)`
            lock.el.style.opacity = d <= 0 ? '' : (1 - d * d).toFixed(4)
          }

          const A = Math.max(hl, F)
          s.card.style.background = mix(ctx.look.vars.accent, mix(NS.lockedBg, surface, L), A)
          s.numeral.style.color = mix(ctx.look.vars.bg, mix(NS.lockFg, ctx.look.vars.fg, L), A)
          s.numeral.style.opacity = clear >= 1 ? '' : (NS.lockedNumeral + (1 - NS.lockedNumeral) * clear).toFixed(4)
          s.numeral.style.filter = clear >= 1 ? '' : `blur(${px(NS.lockedBlur * side * (1 - clear))})`

          const scale = pop * (1 + (NS.activeScale - 1) * hl) * punch
          s.wrap.style.transform = Math.abs(scale - 1) < 1e-6 ? '' : `scale(${scale.toFixed(5)})`
          const op = fade * (1 - (1 - NS.dim) * dim)
          s.wrap.style.opacity = op >= 1 ? '' : op.toFixed(4)
        })
      },
    }
  },
}
