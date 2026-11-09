import gsap from 'gsap'
import { bidiWordUnits, fitText, lineUnit } from '../text/units'
import { FONT_WEIGHT } from '../looks'
import type { Primitive } from './registry'
import { wipeRevealParams, type WipeRevealParams } from '../../core/params/wipe-reveal'
import { DRIFT_MIN_FIT_SCALE, DRIFT_PER_SEC, driftCss, driftFitBox, translateDrift } from '../../core/params/drift'
import { driftFit } from '../drift-fit'

/** Timing constants (seconds) for `wipe-reveal`. Scenes shorter than introEnd + exit are compressed. */
export const WIPE = {
  /** Title wipe, right to left, power3.out. */
  wipe: 0.6,
  /** Underline grows to `lineWidth` of the title width, starting at `lineAt`. */
  lineAt: 0.45,
  line: 0.4,
  lineWidth: 0.6,
  /** Subtitle fades in and rises `subRise` px, starting at `subAt`. */
  subAt: 0.6,
  sub: 0.4,
  subRise: 8,
  /** Everything has landed by this time. */
  introEnd: 1.0,
  /** Reverse wipe at the end of the scene. */
  exit: 0.3,
  maxPx: 160,
  minPx: 40,
  /** Lines allowed when a title too wide for one line at minPx falls back to wrapping. */
  maxLines: 2,
  /** Last-resort floor for a wrapped title whose single word is still too wide at minPx. */
  hardMinPx: 16,
} as const

const clip = (leftPct: number) => `inset(0% 0% 0% ${leftPct}%)`

/**
 * Largest integer px in [minPx, maxPx] at which the wrapped `words` (inside `wrap`, whose width is
 * fixed) fit `box` on at most `maxLines` lines; minPx if none does.
 */
function fitWrapped(
  wrap: HTMLElement,
  words: HTMLElement[],
  box: { w: number; h: number },
  maxLines: number,
  maxPx: number,
  minPx: number,
): number {
  const fits = () =>
    wrap.scrollWidth <= box.w &&
    wrap.offsetHeight <= box.h &&
    new Set(words.map((w) => Math.round(w.offsetTop))).size <= maxLines
  let lo = Math.ceil(minPx)
  let hi = Math.floor(maxPx)
  let best = lo
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    wrap.style.fontSize = `${mid}px`
    if (fits()) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  wrap.style.fontSize = `${best}px`
  return best
}

/**
 * Title revealed by a right-to-left wipe (`clip-path: inset(0 0 0 X%)`, X 100 → 0), an accent
 * underline growing from the title's right edge, and a subtitle that fades up. The exit plays the
 * wipe in reverse over the last 0.3 s. The card keeps the shared slow scale + seeded translate
 * drift (R16) so it never holds still.
 */
export const wipeReveal: Primitive<WipeRevealParams> = {
  id: 'wipe-reveal',
  params: wipeRevealParams,
  build(ctx, p) {
    const move = translateDrift(ctx.rng, ctx.size.w)
    const stack = document.createElement('div')
    Object.assign(stack.style, {
      position: 'absolute',
      left: `${ctx.safe.x}px`,
      top: `${ctx.safe.y}px`,
      width: `${ctx.safe.w}px`,
      height: `${ctx.safe.h}px`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      transformOrigin: '50% 50%',
    })
    ctx.layer.append(stack)

    /** Lays the card out inside a fitW × fitH box (whole px); the elements the timeline animates. */
    const layout = (fitW: number, fitH: number) => {
      stack.replaceChildren()
      // titleWrap (font size, underline anchor) > exit (reverse wipe) > title (intro wipe) > line unit.
      // Two nested clips intersect, so the intro and exit never fight over one property.
      const titleWrap = document.createElement('div')
      Object.assign(titleWrap.style, {
        position: 'relative',
        fontFamily: ctx.look.fontDisplay,
        fontWeight: String(FONT_WEIGHT.display),
        lineHeight: '1.3',
        color: ctx.look.vars.fg,
      })
      const exitClip = document.createElement('div')
      exitClip.dataset.mbaWipe = 'exit'
      const title = document.createElement('div')
      title.dataset.mbaWipe = 'title'
      // Padding keeps Arabic glyph overhangs inside the clipped border box.
      title.style.padding = '0.08em 0.12em'
      const titleLine = lineUnit(title, p.title)
      exitClip.append(title)
      titleWrap.append(exitClip)
      stack.append(titleWrap)
      const titleBox = { w: fitW, h: Math.floor(fitH * 0.5) }
      let titlePx = fitText(titleWrap, titleBox, WIPE.maxPx, WIPE.minPx)
      /** Width of the title text (widest line): the underline is a fraction of it. */
      let textW = titleLine.offsetWidth
      if (Math.max(titleWrap.scrollWidth, titleWrap.offsetWidth) > fitW) {
        // Too wide for one line even at minPx: re-lay the title as whole-word units that wrap onto
        // two lines (never splitting a word), at the largest size that fits. The wipe and the exit
        // clip the whole title block, so they keep working unchanged.
        title.replaceChildren()
        const words = bidiWordUnits(title, p.title)
        titleWrap.style.width = `${fitW}px`
        titlePx = fitWrapped(titleWrap, words, titleBox, WIPE.maxLines, WIPE.maxPx, WIPE.minPx)
        // A single word wider than the safe area: shrink below minPx rather than overflow.
        if (titleWrap.scrollWidth > fitW) titlePx = fitWrapped(titleWrap, words, titleBox, Infinity, WIPE.minPx, WIPE.hardMinPx)
        // Shrink-wrap to the widest line so the underline hangs from the text's right edge.
        const left = Math.min(...words.map((w) => w.offsetLeft))
        const right = Math.max(...words.map((w) => w.offsetLeft + w.offsetWidth))
        textW = right - left
        const pad = parseFloat(getComputedStyle(title).paddingLeft) + parseFloat(getComputedStyle(title).paddingRight)
        titleWrap.style.width = `${Math.min(fitW, Math.ceil(textW + pad) + 1)}px`
      }

      let lineOuter: HTMLElement | undefined
      let lineInner: HTMLElement | undefined
      const thick = Math.max(6, Math.round(titlePx * 0.07))
      if (p.withLine) {
        lineOuter = document.createElement('div')
        lineOuter.dataset.mbaWipe = 'line'
        Object.assign(lineOuter.style, {
          position: 'absolute',
          right: '0.12em', // the title's right edge (inside the clip padding)
          top: '100%',
          width: `${Math.round(WIPE.lineWidth * textW)}px`,
          height: `${thick}px`,
          transformOrigin: '100% 50%',
        })
        lineInner = document.createElement('div')
        Object.assign(lineInner.style, {
          width: '100%',
          height: '100%',
          borderRadius: `${thick / 2}px`,
          background: ctx.look.vars.accent,
          transformOrigin: '100% 50%',
        })
        lineOuter.append(lineInner)
        titleWrap.append(lineOuter)
      }

      let subOuter: HTMLElement | undefined
      let subInner: HTMLElement | undefined
      let subWords: HTMLElement[] = []
      if (p.subtitle && p.subtitle.trim()) {
        subOuter = document.createElement('div')
        Object.assign(subOuter.style, {
          width: `${fitW}px`,
          marginTop: `${Math.round(thick + titlePx * 0.3)}px`,
          fontFamily: ctx.look.fontBody,
          fontWeight: String(FONT_WEIGHT.bodyBold),
          lineHeight: '1.35',
          color: ctx.look.vars.fg,
        })
        subInner = document.createElement('div')
        subInner.dataset.mbaWipe = 'subtitle'
        subWords = bidiWordUnits(subInner, p.subtitle)
        subOuter.append(subInner)
        stack.append(subOuter)
        const subMax = Math.max(28, Math.round(titlePx * 0.42))
        fitText(subOuter, { w: fitW, h: fitH - titleWrap.offsetHeight - thick - titlePx * 0.3 }, subMax, 24)
      }
      // What is drawn: the title block (padding included), the underline and the subtitle's words
      // (subOuter is a fitW-wide layout box, wider than its text).
      const ink: Element[] = [titleWrap, ...(lineOuter ? [lineOuter] : []), ...subWords]
      return { title, exitClip, lineOuter, lineInner, subOuter, subInner, ink }
    }

    // Natural size, as without a drift (whole-pixel box: a fractional safe width, e.g. 885.6, would
    // never fit an integer offsetWidth). A card that would drift out of the safe area (R16) is shrunk
    // as a whole instead of rewrapped; only a large shrink lays it out again in the drift's room.
    let card = layout(Math.floor(ctx.safe.w), Math.floor(ctx.safe.h))
    let fit = driftFit(ctx, stack, card.ink, DRIFT_PER_SEC, move)
    if (fit < DRIFT_MIN_FIT_SCALE) {
      const box = driftFitBox(ctx.safe, ctx.duration, DRIFT_PER_SEC, move)
      card = layout(box.w, box.h)
      fit = driftFit(ctx, stack, card.ink, DRIFT_PER_SEC, move)
    }
    const { title, exitClip, lineOuter, lineInner, subOuter, subInner } = card
    const k = Math.min(1, ctx.duration / (WIPE.introEnd + WIPE.exit))
    const exitDur = WIPE.exit * k
    const exitAt = ctx.duration - exitDur

    const tl = gsap.timeline({ paused: true })
    tl.fromTo(title, { clipPath: clip(100) }, { clipPath: clip(0), duration: WIPE.wipe * k, ease: 'power3.out' }, 0)
    if (lineInner) {
      tl.fromTo(lineInner, { scaleX: 0 }, { scaleX: 1, duration: WIPE.line * k, ease: 'power3.out' }, WIPE.lineAt * k)
    }
    if (subInner) {
      tl.fromTo(
        subInner,
        { opacity: 0, y: WIPE.subRise },
        { opacity: 1, y: 0, duration: WIPE.sub * k, ease: 'power2.out' },
        WIPE.subAt * k,
      )
    }
    // Exit: the reverse wipe (visible region shrinks back to the right edge), all parts together.
    // immediateRender: the exit's start values are written at build time, so before `exitAt` the
    // DOM is the same whether or not a seek has ever passed the exit (cold == warm, `mba verify`).
    // Its targets (exitClip, lineOuter, subOuter) are never touched by the intro tweens.
    const exitVars = { duration: exitDur, ease: 'power3.in', immediateRender: true }
    tl.fromTo(exitClip, { clipPath: clip(0) }, { clipPath: clip(100), ...exitVars }, exitAt)
    if (lineOuter) tl.fromTo(lineOuter, { scaleX: 1 }, { scaleX: 0, ...exitVars }, exitAt)
    if (subOuter) tl.fromTo(subOuter, { opacity: 1 }, { opacity: 0, ...exitVars }, exitAt)

    return {
      timeline: tl,
      // The drift is on `stack`, which no tween touches.
      update(localT) {
        stack.style.transform = driftCss(localT, DRIFT_PER_SEC, move, fit)
      },
    }
  },
}
