import gsap from 'gsap'
import { fitText, textDir, typingUnit } from '../text/units'
import { FONT_WEIGHT } from '../looks'
import type { Primitive } from './registry'
import { searchTypingParams, typingSchedule, TYPING, type SearchTypingParams } from '../../core/params/search-typing'

/** Timing (seconds) and layout constants for `search-typing`. */
export const SEARCH = {
  ...TYPING,
  rowStagger: 0.08,
  row: 0.5,
  rowRise: 28,
  /** Camera push-in window: it starts mid-intro and lands shortly after typing begins. */
  zoomInFrom: 0.25,
  zoomInTo: 0.85,
  /** Caret blink period (square wave, 50% duty). */
  blink: 0.6,
  /**
   * Natural frequency (rad/s) of the critically damped camera spring. 14 rad/s settles a step in
   * about 0.3 s: soft enough to glide between keystrokes, tight enough to keep up with ~14 cps.
   */
  omega: 14,
  /** The caret's target point in the frame, as fractions of the frame size. */
  focusX: 0.5,
  focusY: 0.42,
  maxPx: 72,
  minPx: 24,
  padX: 40,
  icon: 44,
  gap: 24,
  rowH: 44,
  rowGap: 30,
  rowWidths: [0.62, 1, 0.84, 0.5, 0.92, 0.7],
} as const

const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)

/** Step response of a critically damped spring (natural frequency `w`) `tau` seconds after the step. */
function springStep(w: number, tau: number): number {
  if (tau <= 0) return 0
  return 1 - (1 + w * tau) * Math.exp(-w * tau)
}

/**
 * Search bar typing with a camera that follows the caret.
 *
 * Phases (local time, uncompressed): intro 0-0.5 s (bar scales in) -> typing (one per-char time
 * 1/cps per character, two for a space) -> hold 0.4 s -> pullback 0.45 s (camera back to scale 1)
 * -> results until the end (rows stagger in by 0.08 s, the first in the accent colour).
 *
 * Everything that moves with time is a pure function of `localT`:
 * - the typed prefix comes from a per-character schedule built here;
 * - the camera follows a caret table measured here, in untransformed layout coordinates, smoothed
 *   by a critically damped spring evaluated in closed form (a sum of step responses), so no state
 *   is carried from frame to frame.
 */
export const searchTyping: Primitive<SearchTypingParams> = {
  id: 'search-typing',
  params: searchTypingParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const { look } = ctx
    const chars = [...p.text]
    const N = chars.length

    // ---- timing -------------------------------------------------------------------------------
    // One schedule for picture and sound (core/params/search-typing.ts).
    const { k, typeStart, typingDur, appear } = typingSchedule(p, ctx.duration)
    const typeEnd = typeStart + typingDur
    const pullStart = typeEnd + SEARCH.hold * k
    const pullEnd = pullStart + SEARCH.pullback * k
    const zoomFrom = SEARCH.zoomInFrom * k
    const zoomTo = SEARCH.zoomInTo * k

    // ---- DOM ----------------------------------------------------------------------------------
    const glow = document.createElement('div')
    Object.assign(glow.style, {
      position: 'absolute',
      inset: '0',
      background: `radial-gradient(circle at ${SEARCH.focusX * 100}% ${SEARCH.focusY * 100}%, color-mix(in srgb, ${look.vars.fg} 9%, ${look.vars.bg}) 0%, ${look.vars.bg} 65%)`,
    })
    ctx.layer.append(glow)

    // cam (camera transform, via update) > bar (intro tween) + results (row tweens)
    const cam = document.createElement('div')
    cam.className = 'cam'
    cam.dataset.mbaPart = 'cam'
    Object.assign(cam.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${w}px`,
      height: `${h}px`,
      transformOrigin: '0 0',
    })
    ctx.layer.append(cam)

    const barW = Math.floor(ctx.safe.w)
    const barX = Math.round(ctx.safe.x + (ctx.safe.w - barW) / 2)
    const bar = document.createElement('div')
    bar.dataset.mbaPart = 'bar'
    // The bar follows the query's direction: icon at the start side, text growing towards the end
    // (an Arabic query grows leftward from an icon on the right, a Latin one rightward).
    bar.dir = textDir(p.text)
    Object.assign(bar.style, {
      position: 'absolute',
      left: `${barX}px`,
      top: '0',
      width: `${barW}px`,
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      gap: `${SEARCH.gap}px`,
      padding: `0 ${SEARCH.padX}px`,
      borderRadius: '999px',
      background: look.vars.fg,
      boxShadow: `0 0 0 14px color-mix(in srgb, ${look.vars.fg} 8%, transparent), 0 24px 60px rgba(0, 0, 0, 0.35)`,
    })
    cam.append(bar)

    // Magnifier icon: a ring and a handle (bar's start side: right in RTL, left in LTR).
    const iconColor = `color-mix(in srgb, ${look.vars.bg} 55%, ${look.vars.fg})`
    const icon = document.createElement('div')
    Object.assign(icon.style, { position: 'relative', flex: 'none', width: `${SEARCH.icon}px`, height: `${SEARCH.icon}px` })
    const ring = document.createElement('div')
    Object.assign(ring.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '72%',
      height: '72%',
      boxSizing: 'border-box',
      border: `6px solid ${iconColor}`,
      borderRadius: '50%',
    })
    const handle = document.createElement('div')
    Object.assign(handle.style, {
      position: 'absolute',
      right: '2%',
      bottom: '10%',
      width: '38%',
      height: '6px',
      borderRadius: '3px',
      background: iconColor,
      transform: 'rotate(45deg)',
      transformOrigin: '100% 50%',
    })
    icon.append(ring, handle)
    bar.append(icon)

    const txt = document.createElement('div')
    txt.dataset.mbaPart = 'query'
    Object.assign(txt.style, {
      flex: 'none',
      fontFamily: look.fontBody,
      fontWeight: String(FONT_WEIGHT.bodyBold),
      lineHeight: '1.5',
      color: look.vars.bg,
      whiteSpace: 'pre',
    })
    bar.append(txt)
    const typing = typingUnit(txt, p.text)
    const caret = typing.caret
    Object.assign(caret.style, {
      width: '0.07em',
      minWidth: '4px',
      height: '1.05em',
      borderRadius: '2px',
      background: look.vars.accent,
      verticalAlign: 'middle',
      marginInlineStart: '0.16em',
    })

    // Fit the whole question on one line inside the bar, then type into that size.
    typing.setProgress(N)
    const innerW = barW - 2 * SEARCH.padX - SEARCH.icon - SEARCH.gap
    const px = fitText(txt, { w: innerW, h: 100_000 }, SEARCH.maxPx, SEARCH.minPx)
    const barH = Math.max(88, Math.round(px * 2))
    bar.style.height = `${barH}px`
    const barY = Math.round(h * SEARCH.focusY - barH / 2)
    bar.style.top = `${barY}px`

    // Result rows: abstract bars, no text.
    const results = document.createElement('div')
    results.dataset.mbaPart = 'results'
    results.dir = bar.dir // rows hang from the same side as the query
    Object.assign(results.style, {
      position: 'absolute',
      left: `${barX}px`,
      top: `${barY + barH + 72}px`,
      width: `${barW}px`,
    })
    cam.append(results)
    const rows: HTMLElement[] = []
    for (let i = 0; i < p.results; i++) {
      const row = document.createElement('div')
      row.dataset.mbaPart = 'result'
      row.style.marginBottom = `${SEARCH.rowGap}px`
      const fill = document.createElement('div')
      Object.assign(fill.style, {
        width: `${SEARCH.rowWidths[i % SEARCH.rowWidths.length]! * 100}%`,
        height: `${SEARCH.rowH}px`,
        borderRadius: `${SEARCH.rowH / 2}px`,
        background: i === 0 ? look.vars.accent : `color-mix(in srgb, ${look.vars.fg} 16%, transparent)`,
      })
      row.append(fill)
      results.append(row)
      rows.push(row)
    }

    // ---- caret table --------------------------------------------------------------------------
    // Caret centre for every prefix length 0..N, in the camera's untransformed coordinates. The
    // offsetLeft/offsetTop chain ignores CSS transforms; the camera has no transform yet anyway
    // (cleared here for safety) and no tween has been created, so nothing is scaled.
    const savedCam = cam.style.transform
    cam.style.transform = ''
    const caretAt = (): { x: number; y: number } => {
      let x = caret.offsetWidth / 2
      let y = caret.offsetHeight / 2
      let el: HTMLElement | null = caret
      while (el && el !== cam) {
        x += el.offsetLeft
        y += el.offsetTop
        el = el.offsetParent as HTMLElement | null
      }
      if (el !== cam) throw new Error('search-typing: caret is not inside the camera element')
      return { x, y }
    }
    const tableX: number[] = []
    const tableY: number[] = []
    for (let n = 0; n <= N; n++) {
      typing.setProgress(n)
      const c = caretAt()
      tableX.push(c.x)
      tableY.push(c.y)
    }
    typing.setProgress(0)
    cam.style.transform = savedCam

    // The spring lags a steadily moving target by 2/omega seconds; the steps are fed to it that
    // much early so the caret, not a point behind it, sits on the focus point while typing.
    const lead = 2 / SEARCH.omega
    const focus = { x: w * SEARCH.focusX, y: h * SEARCH.focusY }
    const rtl = bar.dir === 'rtl'
    const startX = tableX[0]!
    const spanPad = px * 1.2
    const safeLeft = ctx.safe.x
    const safeRight = ctx.safe.x + ctx.safe.w

    /** Spring-smoothed caret position (camera look-at point) at local time t. */
    const lookAt = (t: number): { x: number; y: number } => {
      let x = tableX[0]!
      let y = tableY[0]!
      for (let i = 0; i < N; i++) {
        const s = springStep(SEARCH.omega, t - (appear[i]! - lead))
        if (s === 0) break // later steps start even later
        x += (tableX[i + 1]! - tableX[i]!) * s
        y += (tableY[i + 1]! - tableY[i]!) * s
      }
      return { x, y }
    }

    /** Camera push amount 0..1: 0 = whole layout at scale 1, 1 = zoomed on the caret. */
    const pushAt = (t: number): number => {
      if (t <= zoomFrom) return 0
      if (t < zoomTo) return easeInOutCubic((t - zoomFrom) / (zoomTo - zoomFrom))
      if (t <= pullStart) return 1
      if (t < pullEnd) return 1 - easeInOutCubic((t - pullStart) / (pullEnd - pullStart))
      return 0
    }

    /** Characters shown at local time t. */
    const charsAt = (t: number): number => {
      let n = 0
      while (n < N && appear[n]! <= t + 1e-9) n++
      return n
    }

    // ---- timeline -----------------------------------------------------------------------------
    const tl = gsap.timeline({ paused: true })
    tl.fromTo(bar, { scale: 0.6, transformOrigin: '50% 50%' }, { scale: 1, duration: SEARCH.intro * k, ease: 'back.out(1.4)' }, 0)
    tl.fromTo(bar, { opacity: 0 }, { opacity: 1, duration: SEARCH.intro * k * 0.6, ease: 'power2.out' }, 0)
    if (rows.length) {
      tl.fromTo(
        rows,
        { opacity: 0, y: SEARCH.rowRise },
        { opacity: 1, y: 0, duration: SEARCH.row * k, ease: 'power3.out', stagger: SEARCH.rowStagger * k },
        pullEnd,
      )
    }

    return {
      timeline: tl,
      update(localT) {
        typing.setProgress(charsAt(localT))

        // Caret: solid while characters are being typed (a blinking caret mid-word reads as lag),
        // otherwise a square wave with period SEARCH.blink.
        const typingNow = localT >= typeStart && localT <= typeEnd
        const blinkOn = Math.floor(localT / (SEARCH.blink / 2)) % 2 === 0
        caret.style.opacity = typingNow || blinkOn ? '1' : '0'

        // Camera: world point L (spring-smoothed caret) is drawn at screen point S with scale z.
        // e = 0 gives the identity; e = 1 puts L exactly on the focus point at the full zoom.
        const e = pushAt(localT)
        if (e === 0) {
          cam.style.transform = ''
          return
        }
        const L = lookAt(localT)
        // The typed span runs from the text's start edge (the caret at zero characters: right in
        // RTL, left in LTR) to the caret, plus a margin for glyphs the smoothed caret has not
        // reached yet. The zoom is limited so the span fits the safe width, and the pan is
        // clamped so the span, the start edge first, stays inside the safe area (pure in t).
        const spanA = Math.min(startX, L.x) - spanPad
        const spanB = Math.max(startX, L.x) + spanPad
        const zFit = safeRight - safeLeft > 0 ? (safeRight - safeLeft) / (spanB - spanA) : Infinity
        const z = Math.max(1, Math.min(1 + (p.zoom - 1) * e, zFit))
        const sx = L.x + (focus.x - L.x) * e
        const sy = L.y + (focus.y - L.y) * e
        let tx = sx - z * L.x
        const lowTx = safeLeft - z * spanA
        const highTx = safeRight - z * spanB
        if (lowTx <= highTx) tx = Math.min(Math.max(tx, lowTx), highTx)
        else tx = rtl ? Math.min(tx, safeRight - z * startX - z * spanPad) : Math.max(tx, safeLeft - z * startX + z * spanPad)
        const ty = sy - z * L.y
        cam.style.transform = `translate(${tx.toFixed(3)}px, ${ty.toFixed(3)}px) scale(${z.toFixed(5)})`
      },
    }
  },
}
