import { easeOutCubic, seg } from '../../core/ease'
import {
  APP_WINDOW_TIMING,
  appWindowParams,
  lineDuration,
  lineReveal,
  typedChars,
  type AppWindowParams,
} from '../../core/params/app-window'
import { earlyStart } from '../../core/params/common'
import { DRIFT_MIN_FIT_SCALE, DRIFT_PER_SEC, driftCss, driftFitBox, translateDrift } from '../../core/params/drift'
import { FONT_MONO, FONT_WEIGHT } from '../looks'
import { lineUnit, textDir, typingUnit } from '../text/units'
import { driftFit } from '../drift-fit'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

export const APP_WINDOW = {
  /** Body font range (px at a 1080 px wide frame; scaled with the frame width). */
  maxPx: 72,
  minPx: 30,
  /** Share of the safe height the window may take. */
  maxH: 0.8,
  /** Corner radius (× window width). */
  radius: 0.03,
  /** Code font: the bundled JetBrains Mono (Latin; the Arabic faces are proportional). */
  mono: FONT_MONO,
  /** Window colours per mode: background, text, border. */
  colors: {
    terminal: { bg: '#15130f', fg: '#efe9df', border: 'rgba(255, 255, 255, 0.14)', bar: '#211e19' },
    app: { bg: '#fbf8f3', fg: '#151311', border: 'rgba(0, 0, 0, 0.12)', bar: '#ece7df' },
  },
  dots: ['#ff5f57', '#febc2e', '#28c840'],
  /** `app` lines rise by this much (× body px) as they fade in. */
  rise: 0.4,
} as const

/**
 * A program window (`app`) or terminal (`terminal`) with a title bar and lines that start at
 * their `at`. Terminal: a Latin/code line types per character (one text node, never one node per
 * letter) with a caret that blinks once the line is typed; an Arabic line is one line unit wiped
 * right → left (clip-path) over the same duration, never typed per letter. App: each line fades
 * and rises in whole. All from `localT` in `update`; the window keeps the shared slow drift (R16).
 */
export const appWindow: Primitive<AppWindowParams> = {
  id: 'app-window',
  params: appWindowParams,
  async build(ctx, p) {
    const k = ctx.size.w / 1080
    const col = APP_WINDOW.colors[p.mode]
    const move = translateDrift(ctx.rng, ctx.size.w)
    const c = safePointPx(ctx, p.at)
    const root = document.createElement('div')
    root.dataset.mbaPart = 'app-window-root'
    Object.assign(root.style, { position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, transform: 'translate(-50%, -50%)' })
    const pop = document.createElement('div')
    pop.style.transformOrigin = '50% 50%'
    const win = document.createElement('div')
    win.dataset.mbaPart = 'app-window'
    if (p.key) win.dataset.mbaKey = p.key
    Object.assign(win.style, {
      background: col.bg,
      color: col.fg,
      border: `${Math.max(2, Math.round(2 * k))}px solid ${col.border}`,
      overflow: 'hidden',
      fontFamily: ctx.look.fontBody,
      fontWeight: String(FONT_WEIGHT.bodyBold),
      lineHeight: '1.45',
    })
    pop.append(win)
    root.append(pop)
    ctx.layer.append(root)

    const bar = document.createElement('div')
    bar.dataset.mbaPart = 'app-window-bar'
    bar.dir = 'ltr'
    Object.assign(bar.style, { position: 'relative', display: 'flex', alignItems: 'center', gap: '0.45em', padding: '0.35em 0.7em', background: col.bar })
    for (const d of APP_WINDOW.dots) {
      const dot = document.createElement('span')
      Object.assign(dot.style, { width: '0.62em', height: '0.62em', borderRadius: '50%', background: d, flexShrink: '0' })
      bar.append(dot)
    }
    if (p.title) {
      const title = document.createElement('div')
      Object.assign(title.style, { flex: '1', textAlign: 'center', whiteSpace: 'nowrap', opacity: '0.75', paddingInlineEnd: '2.4em' })
      lineUnit(title, p.title)
      bar.append(title)
    } else {
      // Keeps the bar's height when there is no title.
      bar.append(Object.assign(document.createElement('span'), { textContent: ' ' }))
    }
    win.append(bar)

    const body = document.createElement('div')
    body.dataset.mbaPart = 'app-window-body'
    Object.assign(body.style, { padding: '0.55em 0.8em 0.75em', display: 'flex', flexDirection: 'column', gap: '0.2em' })
    win.append(body)
    if (p.image !== undefined) {
      const img = document.createElement('img')
      img.alt = ''
      img.dataset.mbaPart = 'app-window-image'
      Object.assign(img.style, { display: 'block', width: '100%', height: 'auto', maxHeight: `${Math.floor(ctx.safe.h * APP_WINDOW.maxH * 0.8)}px`, objectFit: 'contain', borderRadius: '0.25em' })
      img.src = p.image
      body.append(img)
      try {
        await img.decode()
      } catch (e) {
        throw new Error(`تعذّر تحميل صورة النافذة — app-window: the image could not be loaded (${p.image.slice(0, 80)}; ${e instanceof Error ? e.message : String(e)})`)
      }
    }
    const rows = p.lines.map((l) => {
      const row = document.createElement('div')
      row.dataset.mbaPart = 'app-window-line'
      const how = lineReveal(p, l.text)
      row.dir = textDir(l.text)
      Object.assign(row.style, { whiteSpace: 'pre', textAlign: 'start', minHeight: '1.45em' })
      if (l.color) row.style.color = l.color
      if (how === 'type') {
        row.style.fontFamily = APP_WINDOW.mono
        row.style.fontWeight = '400'
        const u = typingUnit(row, l.text)
        Object.assign(u.caret.style, { width: '0.55em', height: '1.05em', verticalAlign: 'text-bottom', marginInlineStart: '0.06em', background: 'currentColor' })
        u.setProgress(Infinity) // measured at full length
        body.append(row)
        return { row, how, typing: u, unit: u.el }
      }
      const unit = lineUnit(row, l.text)
      body.append(row)
      return { row, how, unit, typing: undefined }
    })

    /** Sizes the window to `fit` (whole px): its width, then the largest body px that fits. */
    const sizeTo = (fit: { w: number; h: number }) => {
      const w = Math.floor(p.size * fit.w)
      Object.assign(win.style, { width: `${w}px`, borderRadius: `${Math.round(APP_WINDOW.radius * w)}px` })
      // The window's font size scales the bar and the body together: the largest that fits.
      const fits = () => rows.every((r) => r.row.scrollWidth <= r.row.clientWidth + 1) && win.offsetHeight <= fit.h * APP_WINDOW.maxH
      let px = Math.round(APP_WINDOW.maxPx * k)
      win.style.fontSize = `${px}px`
      while (px > Math.round(APP_WINDOW.minPx * k) && !fits()) {
        px -= 1
        win.style.fontSize = `${px}px`
      }
    }
    sizeTo(ctx.safe)
    let fit = driftFit(ctx, root, [win], DRIFT_PER_SEC, move)
    if (fit < DRIFT_MIN_FIT_SCALE) {
      sizeTo(driftFitBox(ctx.safe, ctx.duration, DRIFT_PER_SEC, move))
      fit = driftFit(ctx, root, [win], DRIFT_PER_SEC, move)
    }

    return {
      update(localT) {
        const t = Math.min(Math.max(localT, 0), ctx.duration)
        const e = easeOutCubic(seg(t, 0, APP_WINDOW_TIMING.windowIn))
        pop.style.transform = e === 1 ? '' : `scale(${(APP_WINDOW_TIMING.popFrom + (1 - APP_WINDOW_TIMING.popFrom) * e).toFixed(4)})`
        root.style.transform = `translate(-50%, -50%) ${driftCss(t, DRIFT_PER_SEC, move, fit)}`
        // The caret sits on the latest started line (only a typed line shows it).
        let caretLine = -1
        p.lines.forEach((l, i) => {
          if (t >= l.at) caretLine = i
        })
        rows.forEach((r, i) => {
          const l = p.lines[i]!
          if (r.how === 'fade') {
            const a0 = earlyStart(l.at, APP_WINDOW_TIMING.lineIn)
            const x = seg(t, a0, a0 + APP_WINDOW_TIMING.lineIn)
            r.row.style.opacity = x === 1 ? '' : String(x)
            r.row.style.transform = x === 1 ? '' : `translateY(${((1 - easeOutCubic(x)) * APP_WINDOW.rise).toFixed(3)}em)`
            return
          }
          r.row.style.visibility = t >= l.at ? '' : 'hidden'
          if (r.how === 'wipe') {
            const x = seg(t, l.at, l.at + lineDuration(p, l.text))
            r.unit.style.clipPath = x >= 1 ? '' : `inset(0% 0% 0% ${(100 * (1 - x)).toFixed(3)}%)`
            return
          }
          const typing = r.typing!
          typing.setProgress(typedChars(p, l, t))
          const done = l.at + lineDuration(p, l.text)
          // Solid while typing; after it, blinks (pure in t) until the next line starts.
          const on = i === caretLine && (t < done || Math.floor((t - done) / APP_WINDOW_TIMING.blink) % 2 === 0)
          typing.caret.style.visibility = on ? '' : 'hidden'
        })
      },
    }
  },
}
