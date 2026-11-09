import { easeOutBack, easeOutCubic, seg } from '../../core/ease'
import {
  SCREEN_CLIP,
  screenClipDrift,
  screenClipFocusAt,
  screenClipFrameAt,
  screenClipLayout,
  screenClipParams,
  screenClipPose,
  screenClipReveal,
  screenClipView,
  sourceToBody,
  type ScreenClipParams,
} from '../../core/params/screen-clip'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'
import { frameUrl } from './video'

const SVG = 'http://www.w3.org/2000/svg'

/** Window chrome colours: a light browser window (the recordings are light UIs). */
const CHROME = {
  win: '#fbfaf7',
  bar: '#ecebe7',
  barLine: 'rgba(20, 18, 15, 0.08)',
  pill: '#ffffff',
  pillText: '#5c5852',
  dots: ['#ff5f57', '#febc2e', '#28c840'],
  /** The body under an unrevealed scan: paper with a faint drafting grid. */
  body: '#f4f2ee',
  grid: 'rgba(20, 18, 15, 0.06)',
} as const

const px = (n: number) => `${n.toFixed(2)}px`

/** Loads frame `n` of `media` into `img` and waits until it is decoded (rejects Arabic first). */
async function loadFrame(img: HTMLImageElement, media: string, n: number): Promise<void> {
  const url = frameUrl(media, n)
  img.src = url
  try {
    await img.decode()
  } catch (e) {
    throw new Error(
      `تعذّر تحميل الإطار ${n} من المادة ${media} — screen-clip ${media}: frame ${n} could not be loaded (${url}; ${e instanceof Error ? e.message : String(e)})`,
    )
  }
  img.dataset.n = String(n)
}

/**
 * `screen-clip` (Stage 1B): the user's screen recording in a floating browser window, a designed
 * object of the reel. Frames come from the frame server exactly like `video` (frame-exact JPEGs,
 * `update` awaits each decode; a `still` shows the frame at `in` for the whole scene).
 *
 * - The window (title bar with dots + url pill, body of aspect `aspect`, default the media's) is
 *   centred on `at` and must lie inside the safe area (refused otherwise). It arrives from a 3D
 *   tilt (or rises) and leaves the same way in reverse; a deep layered soft shadow sits under it.
 * - `focus` keys bring a source point to the body centre at a zoom (1 = cover), spring-eased and
 *   clamped to the image, plus a seeded drift of ≤ 1 % so a still never freezes. The frame stays
 *   put; only the picture moves inside it (clipped).
 * - Pins, marks and click ripples are NOT inside the zoomed picture: each frame maps their source
 *   points through the current view to body px, so they track the zoom without scaling. Callout
 *   labels are DOM line units (fg pill, accent border) clamped inside the body, so inside the safe area.
 * - `reveal: scan` uncovers the picture top → bottom behind an accent line with a soft glow.
 */
export const screenClip: Primitive<ScreenClipParams> = {
  id: 'screen-clip',
  params: screenClipParams,
  async build(ctx, p) {
    const k = ctx.size.w / 1080
    const len = ctx.duration

    const img = document.createElement('img')
    img.alt = ''
    img.draggable = false
    img.decoding = 'sync'
    img.dataset.mbaPart = 'screen-clip-image'
    await loadFrame(img, p.media, screenClipFrameAt(p, 0, len, ctx.fps))
    const srcAspect = img.naturalWidth / img.naturalHeight
    const laid = screenClipLayout(p, srcAspect, ctx.safe, ctx.size.w)
    if ('issue' in laid) throw new Error(`${laid.issue.ar} — screen-clip.${laid.issue.path.join('.')}: ${laid.issue.en}`)
    const box = laid.box
    const { bodyW, bodyH } = box

    // ---- window
    const root = document.createElement('div')
    root.dataset.mbaPart = 'screen-clip'
    Object.assign(root.style, {
      position: 'absolute',
      left: px(box.x),
      top: px(box.y),
      width: `${box.w}px`,
      height: `${box.h}px`,
      perspective: `${Math.round(SCREEN_CLIP.perspective * box.w)}px`,
      perspectiveOrigin: '50% 40%',
    })
    const win = document.createElement('div')
    win.dataset.mbaPart = 'screen-clip-window'
    if (p.key) win.dataset.mbaKey = p.key
    const radius = Math.max(10 * k, SCREEN_CLIP.radius * box.w)
    Object.assign(win.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: `${box.w}px`,
      height: `${box.h}px`,
      borderRadius: px(radius),
      overflow: 'hidden',
      background: CHROME.win,
      outline: `${Math.max(1, Math.round(1.5 * k))}px solid rgba(20, 18, 15, 0.10)`,
      // A deep soft shadow from layered blurs (no canvas shadowBlur).
      boxShadow: [
        `0 ${px(2 * k)} ${px(5 * k)} rgba(20, 16, 10, 0.10)`,
        `0 ${px(12 * k)} ${px(30 * k)} rgba(20, 16, 10, 0.14)`,
        `0 ${px(34 * k)} ${px(80 * k)} rgba(20, 16, 10, 0.20)`,
        `0 ${px(70 * k)} ${px(150 * k)} rgba(20, 16, 10, 0.16)`,
      ].join(', '),
      transformOrigin: '50% 62%',
    })
    root.append(win)
    ctx.layer.append(root)

    // ---- title bar
    if (box.bar > 0) {
      const bar = document.createElement('div')
      bar.dataset.mbaPart = 'screen-clip-bar'
      bar.dir = 'ltr'
      const padX = Math.round(box.bar * 0.36)
      Object.assign(bar.style, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        width: `${box.w}px`,
        height: `${box.bar}px`,
        background: CHROME.bar,
        boxShadow: `inset 0 -1px 0 ${CHROME.barLine}`,
        display: 'flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        padding: `0 ${padX}px`,
      })
      const dotD = Math.round(box.bar * 0.2)
      const dots = document.createElement('div')
      Object.assign(dots.style, { display: 'flex', gap: px(dotD * 0.62), flexShrink: '0', width: px(dotD * 3 + dotD * 1.24) })
      for (const c of CHROME.dots) {
        const d = document.createElement('span')
        Object.assign(d.style, { width: `${dotD}px`, height: `${dotD}px`, borderRadius: '50%', background: c, flexShrink: '0' })
        dots.append(d)
      }
      bar.append(dots)
      const mid = document.createElement('div')
      Object.assign(mid.style, { flex: '1', display: 'flex', justifyContent: 'center', minWidth: '0' })
      bar.append(mid)
      // Mirror of the dots so the pill is centred on the window.
      const mirror = document.createElement('div')
      Object.assign(mirror.style, { width: dots.style.width, flexShrink: '0' })
      bar.append(mirror)
      win.append(bar)
      if (p.chrome !== false && p.chrome.url) {
        const pill = document.createElement('div')
        pill.dataset.mbaPart = 'screen-clip-url'
        const ph = Math.round(box.bar * 0.62)
        Object.assign(pill.style, {
          height: `${ph}px`,
          borderRadius: `${ph}px`,
          background: CHROME.pill,
          boxShadow: `0 0 0 1px ${CHROME.barLine}`,
          display: 'flex',
          alignItems: 'center',
          gap: px(ph * 0.22),
          padding: `0 ${px(ph * 0.5)}`,
          color: CHROME.pillText,
          fontFamily: ctx.look.fontBody,
          fontWeight: String(FONT_WEIGHT.bodyBold),
          lineHeight: '1',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          boxSizing: 'border-box',
        })
        const lock = document.createElementNS(SVG, 'svg')
        lock.setAttribute('viewBox', '0 0 12 14')
        lock.setAttribute('aria-hidden', 'true')
        Object.assign(lock.style, { width: px(ph * 0.3), height: px(ph * 0.36), flexShrink: '0' })
        lock.innerHTML =
          '<path d="M3.2 6V4.2a2.8 2.8 0 0 1 5.6 0V6" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
          '<rect x="1.2" y="6" width="9.6" height="7.2" rx="1.6" fill="currentColor"/>'
        pill.append(lock)
        lineUnit(pill, p.chrome.url)
        mid.append(pill)
        // The largest url font (≤ urlPx) that fits; a url that cannot fit at urlMinPx is left out.
        let fs = Math.round(SCREEN_CLIP.urlPx * k)
        pill.style.fontSize = `${fs}px`
        while (fs > Math.round(SCREEN_CLIP.urlMinPx * k) && pill.scrollWidth > mid.clientWidth + 0.5) pill.style.fontSize = `${--fs}px`
        if (pill.scrollWidth > mid.clientWidth + 0.5) pill.style.display = 'none'
      }
    }

    // ---- body
    const body = document.createElement('div')
    body.dataset.mbaPart = 'screen-clip-body'
    const grid = Math.round(30 * k)
    Object.assign(body.style, {
      position: 'absolute',
      left: '0px',
      top: `${box.bar}px`,
      width: `${bodyW}px`,
      height: `${bodyH}px`,
      overflow: 'hidden',
      backgroundColor: CHROME.body,
      backgroundImage: `linear-gradient(${CHROME.grid} 1px, transparent 1px), linear-gradient(90deg, ${CHROME.grid} 1px, transparent 1px)`,
      backgroundSize: `${grid}px ${grid}px`,
    })
    win.append(body)

    const reveal = document.createElement('div')
    Object.assign(reveal.style, { position: 'absolute', left: '0px', top: '0px', width: `${bodyW}px`, height: `${bodyH}px`, overflow: 'hidden' })
    body.append(reveal)
    // The picture at scale 1 covers the body; later views scale it about its top-left corner.
    const v1 = screenClipView({ x: 0.5, y: 0.5, scale: 1 }, srcAspect, box.aspect)
    const coverW = bodyW / v1.w
    const coverH = bodyH / v1.h
    const content = document.createElement('div')
    content.dataset.mbaPart = 'screen-clip-content'
    Object.assign(content.style, { position: 'absolute', left: '0px', top: '0px', width: px(coverW), height: px(coverH), transformOrigin: '0 0' })
    Object.assign(img.style, { position: 'absolute', left: '0px', top: '0px', width: '100%', height: '100%', display: 'block' })
    content.append(img)
    reveal.append(content)

    // ---- marks (SVG over the picture, body px)
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('width', String(bodyW))
    svg.setAttribute('height', String(bodyH))
    Object.assign(svg.style, { position: 'absolute', left: '0px', top: '0px', overflow: 'visible' })
    body.append(svg)
    const markEls = p.marks.map((m) => {
      const g = document.createElementNS(SVG, 'g')
      const fill = document.createElementNS(SVG, 'rect')
      const stroke = document.createElementNS(SVG, 'rect')
      const rx = String(Math.round(12 * k))
      for (const r of [fill, stroke]) r.setAttribute('rx', rx)
      fill.setAttribute('fill', SCREEN_CLIP.hotColor)
      fill.setAttribute('stroke', 'none')
      stroke.setAttribute('fill', 'none')
      stroke.setAttribute('stroke', ctx.look.vars.accent)
      stroke.setAttribute('stroke-width', String(Math.max(2, Math.round(5 * k))))
      stroke.setAttribute('stroke-linejoin', 'round')
      stroke.setAttribute('pathLength', '1')
      if (m.style !== 'hot') fill.style.display = 'none'
      g.append(fill, stroke)
      svg.append(g)
      return { g, fill, stroke }
    })

    // ---- click ripples and pins
    const fx = document.createElement('div')
    Object.assign(fx.style, { position: 'absolute', left: '0px', top: '0px', width: `${bodyW}px`, height: `${bodyH}px` })
    body.append(fx)
    const ring = (d: number, w: number) => {
      const r = document.createElement('div')
      Object.assign(r.style, {
        position: 'absolute',
        left: px(-d / 2),
        top: px(-d / 2),
        width: px(d),
        height: px(d),
        borderRadius: '50%',
        boxSizing: 'border-box',
        border: `${px(w)} solid ${ctx.look.vars.accent}`,
      })
      return r
    }
    const clickEls = p.clicks.map(() => {
      const at = document.createElement('div')
      Object.assign(at.style, { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px' })
      const d = SCREEN_CLIP.clickPx * k
      const rings = [ring(d, 5 * k), ring(d, 3 * k)]
      const core = ring(d * 0.22, d * 0.11)
      at.append(...rings, core)
      fx.append(at)
      return { at, rings, core }
    })
    const pinD = SCREEN_CLIP.pinPx * k
    const pinEls = p.callouts.map((_, i) => {
      const at = document.createElement('div')
      at.dataset.mbaPart = 'screen-clip-pin'
      at.dataset.i = String(i)
      Object.assign(at.style, { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px' })
      const pulse = ring(pinD, 3 * k)
      const dot = document.createElement('div')
      Object.assign(dot.style, {
        position: 'absolute',
        left: px(-pinD / 2),
        top: px(-pinD / 2),
        width: px(pinD),
        height: px(pinD),
        borderRadius: '50%',
        boxSizing: 'border-box',
        background: ctx.look.vars.accent,
        border: `${px(4 * k)} solid #ffffff`,
        boxShadow: `0 ${px(2 * k)} ${px(6 * k)} rgba(20, 16, 10, 0.28), 0 ${px(6 * k)} ${px(16 * k)} rgba(20, 16, 10, 0.16)`,
      })
      at.append(pulse, dot)
      fx.append(at)
      return { at, pulse, dot }
    })

    // ---- callout labels (DOM text)
    const labelEls = p.callouts.map((c, i) => {
      const pill = document.createElement('div')
      pill.dataset.mbaPart = 'screen-clip-label'
      pill.dataset.i = String(i)
      Object.assign(pill.style, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        padding: `${px(0.16 * SCREEN_CLIP.labelPx * k)} ${px(0.55 * SCREEN_CLIP.labelPx * k)}`,
        borderRadius: px(SCREEN_CLIP.labelPx * k),
        background: ctx.look.vars.fg,
        color: ctx.look.vars.bg,
        border: `${px(3 * k)} solid ${ctx.look.vars.accent}`,
        boxShadow: `0 ${px(3 * k)} ${px(8 * k)} rgba(20, 16, 10, 0.22), 0 ${px(12 * k)} ${px(28 * k)} rgba(20, 16, 10, 0.16)`,
        fontFamily: ctx.look.fontBody,
        fontWeight: String(FONT_WEIGHT.bodyBold),
        fontSize: px(SCREEN_CLIP.labelPx * k),
        lineHeight: '1.25',
        whiteSpace: 'pre',
      })
      lineUnit(pill, c.label)
      fx.append(pill)
      return { pill, w: 0, h: 0 }
    })
    for (const l of labelEls) {
      l.w = l.pill.offsetWidth
      l.h = l.pill.offsetHeight
      if (l.w > bodyW - 20 * k) throw new Error(`التسمية أعرض من النافذة — screen-clip: callout label "${l.pill.textContent}" is wider than the window (${l.w} > ${bodyW} px)`)
    }

    // ---- scan line
    const scanLine = document.createElement('div')
    const scanTrail = document.createElement('div')
    const lineH = Math.max(3, Math.round(4 * k))
    const trailH = Math.round(150 * k)
    Object.assign(scanTrail.style, {
      position: 'absolute',
      left: '0px',
      width: `${bodyW}px`,
      height: `${trailH}px`,
      background: `linear-gradient(to bottom, transparent, color-mix(in srgb, ${ctx.look.vars.accent} 22%, transparent))`,
    })
    Object.assign(scanLine.style, {
      position: 'absolute',
      left: '0px',
      width: `${bodyW}px`,
      height: `${lineH}px`,
      background: `color-mix(in srgb, ${ctx.look.vars.accent} 55%, #ffffff)`,
      boxShadow: [
        `0 0 ${px(4 * k)} ${px(1 * k)} ${ctx.look.vars.accent}`,
        `0 0 ${px(18 * k)} ${px(4 * k)} color-mix(in srgb, ${ctx.look.vars.accent} 60%, transparent)`,
        `0 0 ${px(44 * k)} ${px(10 * k)} color-mix(in srgb, ${ctx.look.vars.accent} 28%, transparent)`,
      ].join(', '),
    })
    if (p.reveal === 'scan') body.append(scanTrail, scanLine)

    const ang = ctx.rng()
    const inset = 10 * k

    return {
      async update(localT) {
        const t = Math.min(Math.max(localT, 0), len)

        // Window pose.
        const pose = screenClipPose(p, t, len)
        root.style.display = pose.opacity <= 0 ? 'none' : ''
        const still = pose.rot === 0 && pose.scale === 1 && pose.rise === 0
        win.style.transform = still
          ? ''
          : `translateY(${px(pose.rise * box.h)}) rotateX(${pose.rot.toFixed(3)}deg) scale(${pose.scale.toFixed(5)})`
        win.style.opacity = pose.opacity >= 1 ? '' : pose.opacity.toFixed(4)

        // Picture view.
        const v = screenClipView(screenClipDrift(screenClipFocusAt(p.focus, t), ang, t, len), srcAspect, box.aspect)
        const s = bodyW / v.w / coverW
        content.style.transform = `translate(${px(-v.x * coverW * s)}, ${px(-v.y * coverH * s)}) scale(${s.toFixed(5)})`
        const at = (x: number, y: number) => sourceToBody(v, bodyW, bodyH, x, y)
        const inBody = (q: { x: number; y: number }) => q.x >= -1 && q.y >= -1 && q.x <= bodyW + 1 && q.y <= bodyH + 1

        // Scan reveal.
        const r = screenClipReveal(p, t)
        reveal.style.clipPath = r >= 1 ? '' : `inset(0px 0px ${((1 - r) * 100).toFixed(3)}% 0px)`
        const scanning = p.reveal === 'scan' && r > 0 && r < 1
        scanLine.style.display = scanning ? '' : 'none'
        scanTrail.style.display = scanning ? '' : 'none'
        if (scanning) {
          const y = r * bodyH
          scanLine.style.top = px(y - lineH / 2)
          scanTrail.style.top = px(y - trailH)
        }

        // Marks.
        p.marks.forEach((m, i) => {
          const el = markEls[i]!
          if (t < m.at) {
            el.g.style.display = 'none'
            return
          }
          el.g.style.display = ''
          const pad = 6 * k
          const a = at(m.x, m.y)
          const b = at(m.x + m.w, m.y + m.h)
          for (const rect of [el.fill, el.stroke]) {
            rect.setAttribute('x', (a.x - pad).toFixed(2))
            rect.setAttribute('y', (a.y - pad).toFixed(2))
            rect.setAttribute('width', Math.max(0, b.x - a.x + 2 * pad).toFixed(2))
            rect.setAttribute('height', Math.max(0, b.y - a.y + 2 * pad).toFixed(2))
          }
          const d = easeOutCubic(seg(t, m.at, m.at + SCREEN_CLIP.markDraw))
          el.stroke.setAttribute('stroke-dasharray', d >= 1 ? 'none' : `${d.toFixed(4)} 1`)
          if (m.style === 'hot') {
            const x = seg(t, m.at, m.at + SCREEN_CLIP.hotSec)
            const alpha = SCREEN_CLIP.hotAlpha * easeOutCubic(Math.min(1, x * 3)) + 0.24 * Math.sin(Math.PI * x)
            el.fill.setAttribute('fill-opacity', alpha.toFixed(4))
          }
        })

        // Click ripples.
        p.clicks.forEach((c, i) => {
          const el = clickEls[i]!
          const end = c.at + SCREEN_CLIP.clickGap + SCREEN_CLIP.clickSec
          const q = at(c.x, c.y)
          if (t < c.at || t >= end || !inBody(q)) {
            el.at.style.display = 'none'
            return
          }
          el.at.style.display = ''
          el.at.style.transform = `translate(${px(q.x)}, ${px(q.y)})`
          el.rings.forEach((rg, j) => {
            const x = seg(t, c.at + j * SCREEN_CLIP.clickGap, c.at + j * SCREEN_CLIP.clickGap + SCREEN_CLIP.clickSec)
            rg.style.display = x <= 0 || x >= 1 ? 'none' : ''
            rg.style.transform = `scale(${(0.25 + 1.15 * easeOutCubic(x)).toFixed(4)})`
            rg.style.opacity = ((1 - x) * 0.95).toFixed(4)
          })
          const xc = seg(t, c.at, c.at + 0.22)
          el.core.style.display = xc >= 1 ? 'none' : ''
          el.core.style.transform = `scale(${(1 + 0.6 * xc).toFixed(4)})`
          el.core.style.opacity = (1 - xc).toFixed(4)
        })

        // Callouts: pin on the tracked point, label beside it, clamped inside the body.
        p.callouts.forEach((c, i) => {
          const pin = pinEls[i]!
          const lab = labelEls[i]!
          const q = at(c.x, c.y)
          if (t < c.at || !inBody(q)) {
            pin.at.style.display = 'none'
            lab.pill.style.display = 'none'
            return
          }
          pin.at.style.display = ''
          pin.at.style.transform = `translate(${px(q.x)}, ${px(q.y)})`
          const xp = seg(t, c.at, c.at + SCREEN_CLIP.pinPop)
          pin.dot.style.transform = xp >= 1 ? '' : `scale(${Math.max(0, easeOutBack(xp, 2.2)).toFixed(4)})`
          const tau = t - c.at - SCREEN_CLIP.pinPop
          if (tau < 0) pin.pulse.style.display = 'none'
          else {
            const ph = (tau % SCREEN_CLIP.pulse) / SCREEN_CLIP.pulse
            pin.pulse.style.display = ''
            pin.pulse.style.transform = `scale(${(1 + 1.9 * easeOutCubic(ph)).toFixed(4)})`
            pin.pulse.style.opacity = (0.7 * (1 - ph)).toFixed(4)
          }
          // The label sits on the roomier side of the pin, vertically centred on it.
          const gap = pinD * 0.95
          const right = q.x < bodyW / 2
          let lx = right ? q.x + gap : q.x - gap - lab.w
          let ly = q.y - lab.h / 2
          lx = Math.min(Math.max(lx, inset), bodyW - inset - lab.w)
          ly = Math.min(Math.max(ly, inset), bodyH - inset - lab.h)
          const xl = seg(t, c.at + SCREEN_CLIP.labelDelay, c.at + SCREEN_CLIP.labelDelay + SCREEN_CLIP.pinPop)
          lab.pill.style.display = xl <= 0 ? 'none' : ''
          lab.pill.style.left = px(lx)
          lab.pill.style.top = px(ly)
          lab.pill.style.transformOrigin = right ? '0% 50%' : '100% 50%'
          lab.pill.style.transform = xl >= 1 ? '' : `scale(${(0.6 + 0.4 * easeOutBack(xl, 2)).toFixed(4)})`
          lab.pill.style.opacity = xl >= 1 ? '' : easeOutCubic(Math.min(1, xl * 2)).toFixed(4)
        })

        // The frame (a still keeps the frame decoded at build).
        if (!p.still) {
          const n = screenClipFrameAt(p, localT, len, ctx.fps)
          if (img.dataset.n !== String(n)) {
            delete img.dataset.n
            await loadFrame(img, p.media, n)
          }
        }
      },
    }
  },
}
