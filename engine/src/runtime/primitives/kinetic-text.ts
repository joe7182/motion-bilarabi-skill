import { easeInOutCubic, easeInOutSine, easeOutCubic, easeOutExpo, seg } from '../../core/ease'
import { driftCss, driftGrow } from '../../core/params/drift'
import { earlyStart } from '../../core/params/common'
import {
  BOX,
  ECHO,
  entranceOf,
  FADE,
  entranceStart,
  GIANT,
  KINETIC_TIMING as K,
  kineticTextParams,
  MASK,
  punchPeak,
  punchStart,
  RISE,
  STRETCH_BACK_SEC,
  STRIKE,
  type KineticTextParams,
} from '../../core/params/kinetic-text'
import { stretchArabic } from '../../core/text'
import { FONT_WEIGHT } from '../looks'
import { bidiWordUnits, fitText, wordUnits } from '../text/units'
import type { Primitive } from './registry'
import { shakeAt, shakeKeys } from './slam'

/** `underline`: the line's thickness and how far below the line box it sits (em). */
export const UNDERLINE = { thick: 0.07, drop: 0.04 } as const

export const KINETIC = {
  maxPx: 180,
  minPx: 56,
  /** Stress 0 slides up from this far below (× font px). */
  rise: 0.35,
  /** `mask` entrance: the word slides this far from its reading side while it is wiped in (× font px). */
  maskSlide: 0.3,
  /** `pop` entrance: starting scale and the overshoot of its back-ease. */
  popFrom: 0.6,
  popBack: 1.6,
} as const

/** Back-ease out (overshoots, then settles at 1). */
const backOut = (x: number, s: number) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2

/** Punch envelope 0..1..0 at `u` s after the word appears: fast rise, eased settle back. */
function punch(u: number): number {
  if (u <= 0) return 0
  if (u < K.punchRise) return easeOutCubic(u / K.punchRise)
  return 1 - easeInOutCubic(seg(u, K.punchRise, K.punchRise + K.punchSettle))
}

/** One laid-out word: the text unit, what moves with it, and its optional decorations. */
interface Unit {
  span: HTMLSpanElement
  /** The element the entrance and the punch transform: the host when the word has copies or a strike, else the unit. */
  mover: HTMLElement
  /** `mask-line`: the clipping row box around the mover. */
  mask?: HTMLElement
  echoes: HTMLElement[]
  strike?: HTMLElement
  /** `box`: the accent rectangle behind the word. */
  box?: HTMLElement
  /** `underline`: the accent line under the word. */
  under?: HTMLElement
  /** The text currently shown (the stretch changes it). */
  shown: string
}

const el = (tagName: string, part: string): HTMLElement => {
  const e = document.createElement(tagName)
  e.dataset.mbaPart = part
  return e
}

/**
 * A strike line element (`STRIKE.thick` em, scaleX 0, drawn from the reading side `side` by
 * setting `strikeTransform`): the caller positions it (`left`, `right` or `width`, `top`).
 * Shared by the kinetic-text strike and the counter strike.
 */
export function strikeLine(color: string, side: 1 | -1): HTMLElement {
  const line = el('div', 'strike')
  Object.assign(line.style, {
    position: 'absolute',
    height: `${STRIKE.thick}em`,
    marginTop: `${-STRIKE.thick / 2}em`,
    background: color,
    transformOrigin: side > 0 ? 'right center' : 'left center',
    transform: 'scaleX(0)',
    pointerEvents: 'none',
  })
  return line
}

/** The `transform` of a strike line `u` s after its `at` (eased draw over `STRIKE.sec`). */
export const strikeTransform = (u: number): string => `scaleX(${+easeOutCubic(seg(u, 0, STRIKE.sec)).toFixed(4)})`

/**
 * Kinetic text: each word (one word unit, never split) appears at its `at`. Stress 0 slides and
 * fades in (0.25 s); stress 1 punches to 1.15 and settles; stress 2 punches to 1.3 in the accent
 * colour with a 0.12 s seeded camera shake (1.5 % of the frame width, decaying). The whole text
 * drifts (DRIFT_PER_SEC) so no frame is static. `stack`: one word per row (falling back to `line`
 * when the stack cannot fit at minPx); `line`: one line, wrapping only when it must; `giant`: one
 * word fitted to 0.92 of the safe width. The fit reserves the punch peak (and, for a stretching
 * word, its full stretch) so neither ever leaves the safe area.
 * Plan 2a+: `rise` / `mask-line` entrances, `echo` copies, kashida `stretch`, `strike` line.
 * Everything is computed from `localT` in `update`; the shake keys come from `ctx.rng` at build.
 */
export const kineticText: Primitive<KineticTextParams> = {
  id: 'kinetic-text',
  params: kineticTextParams,
  build(ctx, p) {
    /** Easing of the entrances: ease-out (default) or easy ease (sine in-out, both ends eased). */
    const EO = p.ease === 'easy' ? easeInOutSine : easeOutCubic
    // camera (shake) > drift (scale) > block (the words)
    const camera = document.createElement('div')
    camera.dataset.mbaPart = 'camera'
    Object.assign(camera.style, {
      position: 'absolute',
      left: `${ctx.safe.x}px`,
      top: `${ctx.safe.y}px`,
      width: `${ctx.safe.w}px`,
      height: `${ctx.safe.h}px`,
    })
    const drift = document.createElement('div')
    Object.assign(drift.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transformOrigin: '50% 50%',
    })
    camera.append(drift)
    ctx.layer.append(camera)
    const side = ctx.dir === 'rtl' ? 1 : -1
    // `align`: the block hugs an edge of the safe area (the drift then grows away from that edge).
    const edge = p.align === 'centre' ? undefined : p.align
    if (edge) {
      drift.style.direction = 'ltr'
      drift.style.justifyContent = edge === 'right' ? 'flex-end' : 'flex-start'
      drift.style.transformOrigin = edge === 'right' ? '100% 50%' : '0% 50%'
    }

    // The text must still fit the safe area at the end of the drift.
    const grow = driftGrow(ctx.duration)
    const fitW = Math.floor(ctx.safe.w / grow)
    const fitH = Math.floor(ctx.safe.h / grow)
    const block = document.createElement('div')
    block.dataset.mbaPart = 'kinetic-text'
    if (p.key) block.dataset.mbaKey = p.key
    Object.assign(block.style, {
      fontFamily: ctx.look.fontDisplay,
      fontWeight: String(FONT_WEIGHT.display),
      lineHeight: '1.3',
      color: ctx.look.vars.fg,
      textAlign: edge ?? 'center',
      direction: ctx.dir,
    })
    drift.append(block)
    // As in slam: the glyph boxes overhang the line boxes; keep them inside the fit box too.
    const glyphH = () => {
      const r = document.createRange()
      r.selectNodeContents(block)
      return r.getBoundingClientRect().height
    }
    let box = { w: fitW, h: fitH }
    const overflows = () =>
      Math.max(block.scrollWidth, block.offsetWidth) > box.w || Math.max(block.scrollHeight, block.offsetHeight) > box.h || glyphH() > box.h

    /** The most tatweels a word will carry: the fit is computed for this form (plain text without `stretch`). */
    const widest = p.words.map((w) => (w.stretch ? stretchArabic(w.text, Math.round(w.stretch.to)) : w.text))
    const peaks = p.words.map(punchPeak)

    /** Wraps a word unit in its optional echo/strike host and `mask-line` row. */
    const decorate = (span: HTMLSpanElement, i: number): Unit => {
      const w = p.words[i]!
      const unit: Unit = { span, mover: span, echoes: [], shown: widest[i]! }
      if (w.echo > 0 || w.strike || w.box || w.underline) {
        const host = el('span', 'word-host')
        Object.assign(host.style, { display: 'inline-block', position: 'relative' })
        // Padding keeps the copies and the strike inside the host box, so the fit sees them.
        const padX = Math.max(ECHO.dx * w.echo, w.box ? BOX.padX : 0)
        const padY = Math.max(ECHO.dy * w.echo, w.box ? BOX.padY : 0)
        if (w.echo > 0 || w.box) host.style.padding = `${padY}em ${padX}em`
        span.replaceWith(host)
        for (let k = 1; k <= w.echo; k++) {
          const copy = wordUnits(host, widest[i]!)[0]!
          copy.dataset.mbaEcho = String(k)
          copy.setAttribute('aria-hidden', 'true')
          Object.assign(copy.style, {
            position: 'absolute',
            left: `${padX}em`,
            top: `${padY}em`,
            opacity: String(+(ECHO.opacity / k).toFixed(4)),
            color: k === 1 ? ctx.look.vars.accent : ctx.look.vars.fg,
            transform: `translate(${-side * ECHO.dx * k}em, ${ECHO.dy * k}em)`,
          })
          unit.echoes.push(copy)
        }
        host.append(span)
        span.style.position = 'relative'
        if (w.strike) {
          const line = strikeLine(w.strike.color === 'fg' || (w.strike.color === undefined && w.stress === 2) ? ctx.look.vars.fg : ctx.look.vars.accent, side)
          Object.assign(line.style, { left: `${padX}em`, right: `${padX}em`, top: '50%' })
          host.append(line)
          unit.strike = line
        }
        if (w.box) {
          // Behind the word and its copies (the first child of the host paints first).
          const box = el('div', 'box')
          Object.assign(box.style, {
            position: 'absolute',
            inset: '0',
            borderRadius: `${BOX.radius}em`,
            background: ctx.look.vars.accent,
            transformOrigin: side > 0 ? 'right center' : 'left center',
            transform: 'scaleX(0)',
            pointerEvents: 'none',
          })
          host.prepend(box)
          unit.box = box
        }
        if (w.underline) {
          // Below the descenders and any harakat; the padding keeps it inside the host box, so the fit sees it.
          host.style.paddingBottom = `${UNDERLINE.drop + UNDERLINE.thick}em`
          const line = el('div', 'underline')
          Object.assign(line.style, {
            position: 'absolute',
            left: `${padX}em`,
            right: `${padX}em`,
            bottom: '0',
            height: `${UNDERLINE.thick}em`,
            background: ctx.look.vars.accent,
            transformOrigin: side > 0 ? 'right center' : 'left center',
            transform: 'scaleX(0)',
            pointerEvents: 'none',
          })
          host.append(line)
          unit.under = line
        }
        unit.mover = host
      }
      if (p.enter === 'mask-line') {
        const mask = el('span', 'mask')
        Object.assign(mask.style, { display: 'inline-block', verticalAlign: 'top', overflow: 'hidden', padding: `${MASK.pad}em 0.1em` })
        unit.mover.replaceWith(mask)
        mask.append(unit.mover)
        unit.mask = mask
      }
      unit.mover.style.transformOrigin = '50% 55%'
      return unit
    }

    /** Lays the words out in `mode` and fits them; returns the units and the font px. */
    const layout = (mode: 'stack' | 'line' | 'giant'): { units: Unit[]; px: number } => {
      block.replaceChildren()
      block.dataset.mbaMode = mode
      box = mode === 'giant' ? { w: Math.floor(Math.min(GIANT.width * ctx.safe.w, fitW)), h: Math.floor(Math.min(GIANT.height * ctx.safe.h, fitH)) } : { w: fitW, h: fitH }
      let spans: HTMLSpanElement[]
      if (mode === 'line') {
        Object.assign(block.style, { display: 'block', width: `${fitW}px`, whiteSpace: 'nowrap' })
        spans = bidiWordUnits(
          block,
          widest.join(' '),
          undefined,
          p.words.map((w) => w.word),
        )
      } else {
        Object.assign(block.style, { display: 'flex', flexDirection: 'column', alignItems: edge ? (edge === (ctx.dir === 'rtl' ? 'right' : 'left') ? 'flex-start' : 'flex-end') : 'center', width: '', whiteSpace: '' })
        spans = widest.map((text, i) => {
          const row = document.createElement('div')
          block.append(row)
          return wordUnits(row, text, undefined, p.words[i]!.word === undefined ? undefined : [p.words[i]!.word])[0]!
        })
      }
      const units = spans.map(decorate)
      const maxPx = p.maxPx ?? (mode === 'giant' ? GIANT.maxPx : KINETIC.maxPx)
      let px = fitText(block, box, maxPx, KINETIC.minPx)
      // Line: one line when it fits at minPx; only a line too long for that wraps.
      if (mode === 'line' && block.scrollWidth > fitW) {
        block.style.whiteSpace = ''
        px = fitText(block, box, maxPx, KINETIC.minPx)
      }
      // The glyph boxes (taller than the line boxes) must stay in the safe area; a giant word is
      // capped by its line box (GIANT.height) and its glyphs only by the safe height.
      const glyphLimit = mode === 'giant' ? fitH : box.h
      while (px > KINETIC.minPx && glyphH() > glyphLimit) {
        px -= 1
        block.style.fontSize = `${px}px`
      }
      // The punch peak of a stressed word must stay inside the safe area too (V1 real-voice overflow).
      const scale = camera.getBoundingClientRect().width / ctx.safe.w || 1
      const cx = camera.getBoundingClientRect().left + (ctx.safe.w * scale) / 2
      const peakFits = () =>
        units.every((u, i) => {
          if (peaks[i]! <= 1) return true
          const r = u.mover.getBoundingClientRect()
          return (Math.abs((r.left + r.right) / 2 - cx) + (r.width * peaks[i]!) / 2) / scale <= ctx.safe.w / grow / 2
        })
      while (px > KINETIC.minPx && !peakFits()) {
        px -= 1
        block.style.fontSize = `${px}px`
      }
      return { units, px }
    }
    let { units, px } = layout(p.mode)
    // A stack too tall for the safe area even at minPx (many words, 16:9) falls back to line mode.
    if (p.mode === 'stack' && overflows()) ({ units, px } = layout('line'))
    // The laid-out size is for the widest form of every word; the first frame sets the real text.
    // I4: the block centred at `y` of the frame height, as far as the safe area (and the drift's
    // growth) allows (giant: GIANT.y of the safe height by default). A layout offset, so keyed words
    // are measured where they rest.
    const centreY = p.y !== undefined ? p.y * ctx.size.h : p.mode === 'giant' ? ctx.safe.y + GIANT.y * ctx.safe.h : undefined
    if (centreY !== undefined) {
      const bh = Math.max(block.offsetHeight, glyphH()) * grow
      const room = Math.max(0, (ctx.safe.h - bh) / 2)
      const dy = Math.max(-room, Math.min(room, centreY - (ctx.safe.y + ctx.safe.h / 2)))
      drift.style.top = `${dy.toFixed(2)}px`
      drift.style.bottom = `${(-dy).toFixed(2)}px`
    }
    units.forEach((u, i) => {
      // Task 7 (R20): `color: 'accent'` colours the word without the stress punch.
      if (p.words[i]!.stress === 2 || p.words[i]!.color === 'accent') u.span.style.color = ctx.look.vars.accent
      // The word in the bg colour on its accent box.
      if (u.box) u.span.style.color = ctx.look.vars.bg
      // Task 10: a word key lets a highlight mark this word alone (its laid-out box at rest).
      const key = p.words[i]!.key
      if (key) u.span.dataset.mbaKey = key
    })

    // Task 7 (R19): a `fade` entrance never moves the block.
    const shakes = p.words.flatMap((w) =>
      w.stress === 2 && p.enter !== 'fade' ? [{ at: punchStart(w, p.enter), keys: shakeKeys(ctx.rng, K.shakeSteps, K.shakeAmp * ctx.size.w) }] : [],
    )

    /** The text of `w` at local `t`: its stretch (tatweel count rises expo.out, holds, returns) or the plain word. */
    const textAt = (w: KineticTextParams['words'][number], t: number): string => {
      const st = w.stretch
      if (!st) return w.text
      const v = t - st.at
      let k = st.to * easeOutExpo(seg(v, 0, st.duration))
      if (st.hold !== undefined) k *= 1 - seg(v, st.duration + st.hold, st.duration + st.hold + STRETCH_BACK_SEC)
      return k >= 0.5 ? stretchArabic(w.text, Math.round(k)) : w.text
    }

    return {
      update(localT) {
        drift.style.transform = driftCss(localT)
        p.words.forEach((w, i) => {
          const u = units[i]!
          const s = u.mover
          const age = localT - entranceStart(w, p.enter)
          let opacity: number
          let y = 0
          let dx = 0
          let scale = 1
          let clip = ''
          let filter = ''
          const editorial = p.enter === 'rise' || p.enter === 'mask-line'
          if (p.enter === 'fade') {
            // R19: opacity only (no slide, scale, blur or punch), whatever the stress.
            opacity = seg(age, 0, FADE.sec)
          } else if (editorial) {
            const len = entranceOf(w, p.enter)
            const x = seg(age, 0, len)
            const e = EO(x)
            if (p.enter === 'rise') {
              opacity = x
              y = (1 - e) * RISE.lift * px
              if (x > 0 && x < 1) filter = `blur(${((1 - e) * RISE.blur).toFixed(2)}px)`
            } else {
              opacity = x > 0 ? 1 : 0
              y = (1 - e) * MASK.from * px
              // The row clips the word while it rises; afterwards it must not clip the punch.
              u.mask!.style.overflow = x < 1 ? 'hidden' : 'visible'
            }
            if (w.stress !== 0) scale = 1 + (punchPeak(w) - 1) * punch(age - len)
          } else if (w.stress === 0 && p.enter === 'mask') {
            // Wiped in from the reading side (no fade: the mask carries the entrance).
            const x = seg(age, 0, K.slideIn)
            const e = EO(x)
            opacity = x > 0 ? 1 : 0
            dx = side * (1 - e) * KINETIC.maskSlide * px
            if (x > 0 && x < 1) clip = side > 0 ? `inset(-20% 0 -20% ${((1 - e) * 100).toFixed(2)}%)` : `inset(-20% ${((1 - e) * 100).toFixed(2)}% -20% 0)`
          } else if (w.stress === 0 && p.enter === 'pop') {
            const x = seg(age, 0, K.slideIn)
            opacity = seg(age, 0, K.slideIn / 2)
            scale = x >= 1 ? 1 : KINETIC.popFrom + (1 - KINETIC.popFrom) * backOut(x, KINETIC.popBack)
          } else if (w.stress === 0) {
            const x = seg(age, 0, K.slideIn)
            opacity = x
            y = (1 - EO(x)) * KINETIC.rise * px
          } else {
            opacity = seg(age, 0, K.fadeIn)
            scale = 1 + (punchPeak(w) - 1) * punch(age)
          }
          s.style.opacity = opacity === 1 ? '' : String(opacity)
          s.style.transform =
            y === 0 && dx === 0 && scale === 1 ? '' : dx !== 0 ? `translate(${dx.toFixed(2)}px, 0px) scale(${scale})` : `translateY(${y.toFixed(2)}px) scale(${scale})`
          s.style.clipPath = clip
          s.style.filter = filter

          const text = textAt(w, localT)
          if (text !== u.shown) {
            u.shown = text
            u.span.textContent = text
            for (const c of u.echoes) c.textContent = text
          }
          if (u.strike) u.strike.style.transform = strikeTransform(localT - w.strike!.at)
          // R17 as for the entrance: a box due before its draw is long enough is complete at `at`.
          if (u.under) u.under.style.transform = `scaleX(${+EO(seg(localT - earlyStart(w.at, BOX.sec), 0, BOX.sec)).toFixed(4)})`
          if (u.box) u.box.style.transform = `scaleX(${+EO(seg(localT - earlyStart(w.at, BOX.sec), 0, BOX.sec)).toFixed(4)})`
        })
        let ox = 0
        let oy = 0
        for (const sh of shakes) {
          const o = shakeAt(sh.keys, K.shake, localT - sh.at)
          ox += o.x
          oy += o.y
        }
        camera.style.transform = ox === 0 && oy === 0 ? '' : `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`
      },
    }
  },
}
