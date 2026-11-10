import { easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import { GLITCH, glitchTextParams, zoomCalloutParams, type GlitchTextParams, type ZoomCalloutParams } from '../../core/params/glitch'
import { videoFrameAt } from '../../core/video'
import { frameUrl } from './video'
import type { Primitive } from './registry'

const f3 = (x: number) => x.toFixed(3)

/** The look's colours resolved (CSS variables on the layer). */
function colourOf(layer: HTMLElement, v: string, fallback: string): string {
  return v.startsWith('var(') ? getComputedStyle(layer).getPropertyValue(v.slice(4, -1)).trim() || fallback : v
}

/** A seeded hash in [0, 1) of (seed, step, k): the same frame always glitches the same way. */
function rnd(seed: number, step: number, k: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(step + 1, 0xc2b2ae35) ^ Math.imul(k + 7, 0x27d4eb2f)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

interface Plate {
  /** The words in the current look colours (redrawn when the colour world flips). */
  ink: HTMLCanvasElement
  inkKey: string
  /** White masks of the plain and the accent words. */
  fgM: HTMLCanvasElement
  accM: HTMLCanvasElement
  red: HTMLCanvasElement
  cyan: HTMLCanvasElement
  /** The text block's band on the frame (px). */
  top: number
  bottom: number
}

/** glitch-text: a headline that glitches in, bursts on hits, glitches into new words and breaks away. */
export const glitchText: Primitive<GlitchTextParams> = {
  id: 'glitch-text',
  params: glitchTextParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const s = ctx.safe
    // Colours are read every frame: a backdrop can flip the colour world under the scene.
    let fg = ''
    let accent = ''
    const seed = Math.floor(ctx.rng() * 1e9)
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    Object.assign(cv.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px` })
    ctx.layer.append(cv)
    const g = cv.getContext('2d')!

    const canvas = () => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      return c
    }
    /** Draws the lines (right to left, word by word) into ink, red and cyan plates. */
    const plate = (lines: string[], accentWords: string[]): Plate => {
      const fgM = canvas()
      const accM = canvas()
      const ig = fgM.getContext('2d')!
      const ag = accM.getContext('2d')!
      const font = (px: number) => `900 ${px}px ${ctx.look.fontDisplay}`
      let px = p.size * k
      ig.font = font(px)
      const space = () => ig.measureText(' ').width * 1.3
      const widthOf = (line: string) => line.split(' ').reduce((a, wd) => a + ig.measureText(wd).width, 0) + space() * (line.split(' ').length - 1)
      while (px > 40 * k && Math.max(...lines.map(widthOf)) > s.w * 0.96) {
        px -= 4 * k
        ig.font = font(px)
      }
      const lh = px * 1.18
      const cy = s.y + p.y * s.h
      const top = cy - (lh * lines.length) / 2
      ig.textBaseline = 'middle'
      ig.direction = 'rtl'
      ig.textAlign = 'right'
      lines.forEach((line, i) => {
        const y = top + lh * (i + 0.5)
        let x = w / 2 + widthOf(line) / 2
        for (const wd of line.split(' ')) {
          const on = accentWords.some((a) => wd.includes(a)) ? ag : ig
          on.font = ig.font
          on.textBaseline = 'middle'
          on.direction = 'rtl'
          on.textAlign = 'right'
          on.fillStyle = '#ffffff'
          on.fillText(wd, x, y)
          x -= ig.measureText(wd).width + space()
        }
      })
      const tint = (colour: string) => {
        const c = canvas()
        const cg = c.getContext('2d')!
        cg.drawImage(fgM, 0, 0)
        cg.drawImage(accM, 0, 0)
        cg.globalCompositeOperation = 'source-in'
        cg.fillStyle = colour
        cg.fillRect(0, 0, w, h)
        return c
      }
      return { ink: canvas(), inkKey: '', fgM, accM, red: tint(GLITCH.red), cyan: tint(GLITCH.cyan), top: top - px * 0.25, bottom: top + lh * lines.length + px * 0.25 }
    }
    const tmp = canvas()
    const tg = tmp.getContext('2d')!
    /** The plate's words in fg and accent, redrawn only when the colours change. */
    const inkOf = (pl: Plate): HTMLCanvasElement => {
      const key = fg + '|' + accent
      if (pl.inkKey === key) return pl.ink
      pl.inkKey = key
      const c = pl.ink.getContext('2d')!
      c.globalCompositeOperation = 'source-over'
      c.clearRect(0, 0, w, h)
      c.drawImage(pl.fgM, 0, 0)
      c.globalCompositeOperation = 'source-in'
      c.fillStyle = fg
      c.fillRect(0, 0, w, h)
      tg.globalCompositeOperation = 'source-over'
      tg.clearRect(0, 0, w, h)
      tg.drawImage(pl.accM, 0, 0)
      tg.globalCompositeOperation = 'source-in'
      tg.fillStyle = accent
      tg.fillRect(0, 0, w, h)
      c.globalCompositeOperation = 'source-over'
      c.drawImage(tmp, 0, 0)
      return pl.ink
    }
    const A = plate(p.lines, p.accent)
    const B = p.to ? plate(p.to.lines, p.to.accent) : null

    /** Glitch strength at t (0 calm … 1 wild). */
    const strength = (t: number) => {
      let gl = t < p.at ? 0 : 1 - easeOutCubic(seg(t, p.at, p.at + p.settle))
      for (const hit of p.hits) if (t >= hit.at && t < hit.at + hit.dur) gl = Math.max(gl, hit.strength * (1 - (t - hit.at) / hit.dur))
      if (p.to && Math.abs(t - p.to.at) < 0.25) gl = Math.max(gl, 1 - Math.abs(t - p.to.at) / 0.25)
      if (p.out !== undefined && t >= p.out) gl = Math.max(gl, seg(t, p.out, p.out + 0.3))
      return gl
    }

    return {
      update(localT) {
        const t = Math.max(0, localT)
        g.clearRect(0, 0, w, h)
        if (t < p.at) return
        fg = colourOf(ctx.layer, ctx.look.vars.fg, '#f2ece2')
        accent = colourOf(ctx.layer, ctx.look.vars.accent, '#ff5a1f')
        const step = Math.floor(t * GLITCH.rate)
        const r = (n: number) => rnd(seed, step, n)
        const gl = strength(t)
        const gone = p.out === undefined ? 0 : seg(t, p.out + 0.15, p.out + 0.45)
        if (gone >= 1) return
        // Which words: around a swap, bands pick from both.
        const swapping = p.to !== undefined && B !== null && Math.abs(t - p.to.at) < 0.2
        const base = p.to && B && t >= p.to.at ? B : A
        // The glitch-in flickers: some early frames are blank.
        if (t < p.at + p.settle * 0.35 && r(1) < 0.3 * gl) return
        g.globalAlpha = 1 - gone
        if (gl < 0.02) {
          g.drawImage(inkOf(base), 0, 0)
          g.globalAlpha = 1
          return
        }
        // Red and cyan copies pull apart.
        const dx = (0.012 + 0.03 * gl) * w * (r(2) < 0.5 ? -1 : 1)
        const dy = 0.004 * w * gl * (r(3) - 0.5)
        g.globalAlpha = (1 - gone) * Math.min(1, 0.25 + gl)
        g.drawImage(base.red, dx, dy)
        g.drawImage(base.cyan, -dx * 0.8, -dy)
        g.globalAlpha = 1 - gone
        g.drawImage(inkOf(base), 0, 0)
        // Bands slip sideways (and, mid-swap, show the other words).
        const bands = 2 + Math.floor(gl * 7)
        const span = base.bottom - base.top
        for (let i = 0; i < bands; i++) {
          const y = base.top + r(10 + i) * span
          const bh = (0.03 + 0.12 * r(30 + i)) * span
          const sx = (r(50 + i) - 0.5) * 0.16 * w * gl
          const src = swapping && r(70 + i) < 0.5 ? (base === A ? B! : A) : base
          g.clearRect(0, y, w, bh)
          g.drawImage(inkOf(src), 0, y, w, bh, sx, y, w, bh)
          if (r(90 + i) < 0.35) g.drawImage(r(95 + i) < 0.5 ? src.red : src.cyan, 0, y, w, bh, sx + dx * 1.6, y, w, bh)
        }
        // Blocks and scanlines.
        if (gl > 0.35) {
          for (let i = 0; i < 3; i++) {
            if (r(110 + i) > gl) continue
            g.fillStyle = i === 0 ? accent : i === 1 ? GLITCH.cyan : fg
            g.fillRect(w * (0.1 + 0.8 * r(120 + i)), base.top + span * r(130 + i), w * (0.03 + 0.12 * r(140 + i)), span * (0.015 + 0.04 * r(150 + i)))
          }
        }
        if (p.scan) {
          g.globalAlpha = 0.12 * gl * (1 - gone)
          // Only over the letters (source-atop), dark lines through them.
          g.globalCompositeOperation = 'source-atop'
          g.globalAlpha = 0.35 * gl * (1 - gone)
          g.fillStyle = '#000000'
          for (let y = base.top; y < base.bottom; y += 6 * k) g.fillRect(0, y, w, 2 * k)
          g.globalCompositeOperation = 'source-over'
        }
        g.globalAlpha = 1
      },
    }
  },
}

/** zoom-callout: a ring on a spot of the clip, guide lines, and an inset that grows there showing it magnified. */
export const zoomCallout: Primitive<ZoomCalloutParams> = {
  id: 'zoom-callout',
  params: zoomCalloutParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const accent = ctx.look.vars.accent
    const sx = p.spot.x * w
    const sy = p.spot.y * h
    const sr = p.spot.r * w
    const L = p.lens.size * w
    const lx = p.lens.x * w
    const ly = p.lens.y * h
    const zoom = L / 2 / sr
    const bw = 7 * k
    const round = p.shape === 'circle' ? '50%' : `${f3(28 * k)}px`

    const svgNS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(svgNS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px`, overflow: 'visible' })
    ctx.layer.append(svg)
    const ring = document.createElementNS(svgNS, p.shape === 'circle' ? 'circle' : 'rect')
    if (p.shape === 'circle') {
      ring.setAttribute('cx', f3(sx))
      ring.setAttribute('cy', f3(sy))
      ring.setAttribute('r', f3(sr))
    } else {
      ring.setAttribute('x', f3(sx - sr))
      ring.setAttribute('y', f3(sy - sr))
      ring.setAttribute('width', f3(2 * sr))
      ring.setAttribute('height', f3(2 * sr))
      ring.setAttribute('rx', f3(10 * k))
    }
    ring.setAttribute('fill', 'none')
    ring.setAttribute('stroke', accent)
    ring.setAttribute('stroke-width', f3(5 * k))
    ring.setAttribute('pathLength', '1')
    ring.setAttribute('stroke-dasharray', '1 1')
    svg.append(ring)
    // Two guide lines: the outer tangents of the spot and the inset, approximated by the ends of the
    // diameter at right angles to the line between the centres.
    const ang = Math.atan2(ly - sy, lx - sx) + Math.PI / 2
    const guides = [1, -1].map((sgn) => {
      const ln = document.createElementNS(svgNS, 'line')
      ln.setAttribute('x1', f3(sx + Math.cos(ang) * sr * sgn))
      ln.setAttribute('y1', f3(sy + Math.sin(ang) * sr * sgn))
      ln.setAttribute('x2', f3(lx + (Math.cos(ang) * L) / 2 * sgn))
      ln.setAttribute('y2', f3(ly + (Math.sin(ang) * L) / 2 * sgn))
      ln.setAttribute('stroke', accent)
      ln.setAttribute('stroke-width', f3(3 * k))
      ln.setAttribute('stroke-opacity', '0.85')
      ln.setAttribute('pathLength', '1')
      ln.setAttribute('stroke-dasharray', '1 1')
      svg.append(ln)
      return ln
    })

    // The inset: a window onto the same frame, scaled about the spot.
    const lens = document.createElement('div')
    Object.assign(lens.style, {
      position: 'absolute', left: `${f3(lx - L / 2)}px`, top: `${f3(ly - L / 2)}px`, width: `${f3(L)}px`, height: `${f3(L)}px`,
      borderRadius: round, overflow: 'hidden', border: `${f3(bw)}px solid #ffffff`, boxSizing: 'border-box',
      boxShadow: `0 ${f3(18 * k)}px ${f3(50 * k)}px rgba(0,0,0,0.35), 0 0 0 ${f3(4 * k)}px ${accent}`, background: '#111',
    })
    const img = document.createElement('img')
    img.alt = ''
    img.draggable = false
    img.decoding = 'sync'
    Object.assign(img.style, { position: 'absolute', left: '0px', top: '0px', width: `${w}px`, height: `${h}px`, objectFit: 'cover', transformOrigin: '0 0', maxWidth: 'none' })
    lens.append(img)
    ctx.layer.append(lens)
    let chip: HTMLElement | null = null
    if (p.label) {
      chip = document.createElement('div')
      chip.textContent = p.label
      const below = ly + L / 2 + 90 * k < h * 0.9
      Object.assign(chip.style, {
        position: 'absolute', left: `${f3(lx)}px`, top: `${f3(below ? ly + L / 2 + 26 * k : ly - L / 2 - 88 * k)}px`, transform: 'translateX(-50%)',
        background: accent, color: '#ffffff', font: `800 ${f3(40 * k)}px ${ctx.look.fontDisplay}`, padding: `${f3(8 * k)}px ${f3(22 * k)}px`,
        borderRadius: `${f3(12 * k)}px`, whiteSpace: 'nowrap', direction: 'rtl',
      })
      ctx.layer.append(chip)
    }

    return {
      async update(localT) {
        const t = Math.max(0, localT)
        const end = p.out === undefined ? 1 : 1 - seg(t, p.out, p.out + 0.3)
        const ringIn = easeInOutCubic(seg(t, p.at, p.at + 0.35))
        ring.setAttribute('stroke-dashoffset', f3(1 - ringIn))
        ring.style.opacity = f3(end)
        const gIn = easeOutCubic(seg(t, p.at + 0.25, p.at + 0.6))
        for (const ln of guides) {
          ln.setAttribute('stroke-dashoffset', f3(1 - gIn))
          ln.style.opacity = f3(end)
        }
        const o = easeOutBack(seg(t, p.at + 0.35, p.at + 0.85))
        const grow = Math.max(0, o)
        // The inset grows out of the spot to its place, zooming in as it goes.
        const cx = sx + (lx - sx) * Math.min(1, grow)
        const cy = sy + (ly - sy) * Math.min(1, grow)
        const scale = (sr * 2) / L + (1 - (sr * 2) / L) * grow
        lens.style.transform = `translate(${f3(cx - lx)}px, ${f3(cy - ly)}px) scale(${f3(scale)})`
        lens.style.opacity = f3(Math.min(1, seg(t, p.at + 0.35, p.at + 0.45)) * end)
        const z = 1 + (zoom - 1) * easeInOutCubic(seg(t, p.at + 0.35, p.at + 0.9))
        img.style.transform = `translate(${f3(L / 2 - bw - sx * z)}px, ${f3(L / 2 - bw - sy * z)}px) scale(${f3(z)})`
        if (chip) {
          const c = easeOutBack(seg(t, p.at + 0.75, p.at + 1.05))
          chip.style.opacity = f3(Math.min(1, seg(t, p.at + 0.75, p.at + 0.85)) * end)
          chip.style.transform = `translateX(-50%) scale(${f3(Math.max(0, c))})`
        }
        const n = String(videoFrameAt(p, localT, ctx.duration, ctx.fps))
        if (img.dataset.n === n) return
        delete img.dataset.n
        const url = frameUrl(p.media, Number(n))
        img.src = url
        try {
          await img.decode()
        } catch (e) {
          throw new Error(`تعذّر تحميل الإطار ${n} من المادة ${p.media} — zoom-callout ${p.media}: frame ${n} could not be loaded (${url}; ${e instanceof Error ? e.message : String(e)})`)
        }
        img.dataset.n = n
      },
    }
  },
}
