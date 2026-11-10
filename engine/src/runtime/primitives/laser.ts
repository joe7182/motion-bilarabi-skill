import { easeInOutCubic, easeInOutSine, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import {
  LASER, beatSlamParams, glowWordsParams, laserBeamParams, laserTypeParams, techGridParams,
  type BeatSlamParams, type GlowWordsParams, type LaserBeamParams, type LaserTypeParams, type TechGridParams,
} from '../../core/params/laser'
import { FONT_MONO } from '../looks'
import { fitText, lineUnit } from '../text/units'
import type { Primitive } from './registry'

const f3 = (x: number) => x.toFixed(3)
const CHARCOAL = '#0d0f12'
const HOT = '#ffd9a0'
const RED = '#ff3b47'

function fullCanvas(layer: HTMLElement, w: number, h: number) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  Object.assign(cv.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px` })
  layer.append(cv)
  return { cv, g: cv.getContext('2d')! }
}
/** The look's accent as a colour string (CSS variables resolved on the layer). */
function accentOf(ctx: { layer: HTMLElement; look: { vars: { accent: string } } }): string {
  const v = ctx.look.vars.accent
  return v.startsWith('var(') ? getComputedStyle(ctx.layer).getPropertyValue(v.slice(4, -1)).trim() || '#ff5a1f' : v
}
const rgba = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1]!, 16) : 0xff5a1f
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** tech-grid: charcoal, a fine grid (or a perspective floor), soft drifting glows, a vignette. */
export const techGrid: Primitive<TechGridParams> = {
  id: 'tech-grid',
  params: techGridParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const { g } = fullCanvas(ctx.layer, w, h)
    const accent = accentOf(ctx)
    const cell = p.cell * w
    const seeds = Array.from({ length: p.glows }, () => ({ x: ctx.rng(), y: ctx.rng(), ph: ctx.rng() * 6.28 }))
    return {
      update(localT) {
        const t = Math.max(0, localT)
        g.fillStyle = CHARCOAL
        g.fillRect(0, 0, w, h)
        seeds.forEach((s, i) => {
          const x = w * (0.2 + 0.6 * s.x + 0.06 * Math.sin(t * 0.4 + s.ph))
          const y = h * (0.2 + 0.6 * s.y + 0.05 * Math.cos(t * 0.33 + s.ph))
          const r = w * 0.45
          const gr = g.createRadialGradient(x, y, 0, x, y, r)
          gr.addColorStop(0, i % 2 ? 'rgba(90,120,255,0.06)' : rgba(accent, 0.07))
          gr.addColorStop(1, 'rgba(0,0,0,0)')
          g.fillStyle = gr
          g.fillRect(0, 0, w, h)
        })
        g.lineWidth = Math.max(1, w / 1080)
        if (!p.floor) {
          for (let x = (w / 2) % cell, i = 0; x < w; x += cell, i++) {
            g.strokeStyle = Math.round((x - w / 2) / cell) % 4 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.075)'
            g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke()
          }
          for (let y = (h / 2) % cell; y < h; y += cell) {
            g.strokeStyle = Math.round((y - h / 2) / cell) % 4 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.075)'
            g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke()
          }
        } else {
          const hy = h * 0.46
          g.strokeStyle = 'rgba(255,255,255,0.08)'
          for (let i = -14; i <= 14; i++) {
            g.beginPath(); g.moveTo(w / 2 + i * cell * 0.4, hy); g.lineTo(w / 2 + i * cell * 4, h); g.stroke()
          }
          const scroll = (t * 0.35) % 1
          for (let k = 0; k < 18; k++) {
            const z = (k + scroll) / 18
            const y = hy + (h - hy) * z * z
            g.strokeStyle = `rgba(255,255,255,${f3(0.03 + 0.08 * z)})`
            g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke()
          }
        }
        const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75)
        v.addColorStop(0, 'rgba(0,0,0,0)')
        v.addColorStop(1, 'rgba(0,0,0,0.65)')
        g.fillStyle = v
        g.fillRect(0, 0, w, h)
      },
    }
  },
}

/** laser-type: a laser cuts the headline in, right to left; the cut glows hot, cools to white; sparks fly. */
export const laserType: Primitive<LaserTypeParams> = {
  id: 'laser-type',
  params: laserTypeParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const s = ctx.safe
    const { cv, g } = fullCanvas(ctx.layer, w, h)
    const accent = accentOf(ctx)
    cv.style.filter = `drop-shadow(0 0 ${f3(3 * k)}px ${rgba(accent, 0.45)}) drop-shadow(0 0 ${f3(9 * k)}px ${rgba(accent, 0.18)})`
    const font = (px: number) => `900 ${px}px ${ctx.look.fontDisplay}`
    // Fit every line to the safe width.
    g.font = font(100)
    const widest = Math.max(...p.lines.map((l) => g.measureText(l).width))
    const px = Math.min(p.size * k, (100 * s.w * 0.94) / Math.max(1, widest))
    const lineH = px * 1.12
    const cy = s.y + p.y * s.h
    const top = cy - (lineH * p.lines.length) / 2
    // Each line pre-drawn word by word (RTL), accent words in the accent colour.
    const lines = p.lines.map((text, li) => {
      g.font = font(px)
      const words = text.split(' ')
      const space = g.measureText(' ').width
      const widths = words.map((wd) => g.measureText(wd).width)
      const width = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1)
      const c = document.createElement('canvas')
      c.width = Math.ceil(width + px * 0.4)
      c.height = Math.ceil(lineH * 1.3)
      const cg = c.getContext('2d')!
      cg.font = font(px)
      cg.direction = 'rtl'
      cg.textAlign = 'right'
      cg.textBaseline = 'alphabetic'
      let x = c.width - px * 0.2
      words.forEach((wd, i) => {
        cg.fillStyle = p.accent.includes(wd) ? accent : '#ffffff'
        cg.fillText(wd, x, lineH * 0.98)
        x -= widths[i]! + space
      })
      const left = w / 2 - c.width / 2
      const y = top + li * lineH - lineH * 0.15
      return { c, left, y, right: left + c.width, start: p.at + li * p.cut * 0.85 }
    })
    const sparks = lines.map(() => Array.from({ length: LASER.sparks }, () => ({ u: ctx.rng(), yy: ctx.rng(), vx: (ctx.rng() * 1.3 + 0.2), vy: (ctx.rng() - 0.65) * 1.4, life: 0.25 + ctx.rng() * 0.4 })))
    const hot = document.createElement('canvas')
    return {
      update(localT) {
        const t = Math.max(0, localT)
        g.clearRect(0, 0, w, h)
        lines.forEach((L, li) => {
          const e = easeInOutSine(seg(t, L.start, L.start + p.cut))
          if (e <= 0) return
          const span = L.right - L.left
          const cutX = L.right - e * span
          // The revealed part (right of the cut), settled.
          g.save()
          g.beginPath()
          g.rect(cutX, L.y, L.right - cutX, L.c.height)
          g.clip()
          g.drawImage(L.c, L.left, L.y)
          g.restore()
          // The hot band just behind the cut: the letters glow orange-white, cooling over `band`.
          const band = px * 0.9
          if (e < 1 || t < L.start + p.cut + LASER.cool) {
            const fade = e < 1 ? 1 : 1 - seg(t, L.start + p.cut, L.start + p.cut + LASER.cool)
            hot.width = L.c.width
            hot.height = L.c.height
            const hg = hot.getContext('2d')!
            hg.clearRect(0, 0, hot.width, hot.height)
            hg.drawImage(L.c, 0, 0)
            hg.globalCompositeOperation = 'source-in'
            const lx = cutX - L.left
            const gr = hg.createLinearGradient(lx, 0, lx + band, 0)
            gr.addColorStop(0, HOT)
            gr.addColorStop(0.25, accent)
            gr.addColorStop(1, rgba(accent, 0))
            hg.fillStyle = gr
            hg.fillRect(0, 0, hot.width, hot.height)
            hg.globalCompositeOperation = 'source-over'
            g.save()
            g.globalCompositeOperation = 'lighter'
            g.globalAlpha = fade
            g.drawImage(hot, L.left, L.y)
            g.restore()
          }
          // The beam and its flare at the cut.
          if (e > 0 && e < 1) {
            const by0 = L.y - lineH * 0.25
            const by1 = L.y + L.c.height + lineH * 0.1
            g.save()
            g.shadowColor = accent
            g.shadowBlur = 8 * k
            g.strokeStyle = HOT
            g.lineWidth = 2 * k
            g.beginPath(); g.moveTo(cutX, by0); g.lineTo(cutX, by1); g.stroke()
            const fy = L.y + L.c.height * 0.55
            const fr = g.createRadialGradient(cutX, fy, 0, cutX, fy, 22 * k)
            fr.addColorStop(0, 'rgba(255,255,240,1)')
            fr.addColorStop(0.3, rgba(accent, 0.7))
            fr.addColorStop(1, rgba(accent, 0))
            g.fillStyle = fr
            g.fillRect(cutX - 22 * k, fy - 22 * k, 44 * k, 44 * k)
            g.fillStyle = 'rgba(255,240,220,0.55)'
            g.fillRect(cutX - 70 * k, fy - 0.75 * k, 140 * k, 1.5 * k)
            g.restore()
          }
          // Sparks: born where the cut was, flying off with gravity.
          g.save()
          g.globalCompositeOperation = 'lighter'
          for (const sp of sparks[li]!) {
            const born = L.start + p.cut * sp.u
            const age = t - born
            if (age < 0 || age > sp.life) continue
            const bornX = L.right - easeInOutSine(sp.u) * span
            const x0 = bornX
            const y0 = L.y + L.c.height * (0.25 + 0.6 * sp.yy)
            const x = x0 + sp.vx * 420 * k * age
            const y = y0 + sp.vy * 300 * k * age + 900 * k * age * age
            const a = 1 - age / sp.life
            g.strokeStyle = `rgba(255,${Math.round(150 + 90 * a)},${Math.round(60 + 120 * a)},${f3(a)})`
            g.lineWidth = 2 * k
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - sp.vx * 18 * k, y - (sp.vy * 300 + 1800 * age) * 0.05 * k); g.stroke()
          }
          g.restore()
        })
        // A slight push-in as it settles.
        const sc = 1.04 - 0.04 * easeOutCubic(seg(t, p.at, p.at + p.cut * p.lines.length + 0.4))
        cv.style.transform = `scale(${f3(sc)})`
      },
    }
  },
}

/** laser-beam: beams with a hot head and trail, glowing diagram boxes, red ✕ marks, a crosshair. */
export const laserBeam: Primitive<LaserBeamParams> = {
  id: 'laser-beam',
  params: laserBeamParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const s = ctx.safe
    const { g } = fullCanvas(ctx.layer, w, h)
    const accent = accentOf(ctx)
    const P = (q: { x: number; y: number }) => ({ x: s.x + q.x * s.w, y: s.y + q.y * s.h })
    const col = (c: 'accent' | 'red' | 'white') => (c === 'red' ? RED : c === 'white' ? '#ffffff' : accent)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        g.clearRect(0, 0, w, h)
        // Crosshair.
        if (p.crosshair && t >= p.crosshair.at) {
          const c = P(p.crosshair)
          const e = easeOutCubic(seg(t, p.crosshair.at, p.crosshair.at + 0.4))
          g.save()
          g.shadowColor = accent
          g.shadowBlur = 5 * k
          g.strokeStyle = rgba(accent, 0.6)
          g.lineWidth = 2 * k
          g.beginPath()
          g.moveTo(c.x - e * w, c.y); g.lineTo(c.x + e * w, c.y)
          g.moveTo(c.x, c.y - e * h); g.lineTo(c.x, c.y + e * h)
          g.stroke()
          g.restore()
        }
        // Boxes.
        for (const b of p.boxes) {
          if (t < b.from) continue
          const e = easeOutBack(seg(t, b.from, b.from + 0.35), 1.4)
          const c = P(b)
          const bw = s.w * 0.38 * (0.8 + 0.2 * e)
          const bh = s.h * 0.095 * (0.8 + 0.2 * e)
          g.save()
          g.globalAlpha = Math.min(1, seg(t, b.from, b.from + 0.15))
          g.shadowColor = 'rgba(255,255,255,0.35)'
          g.shadowBlur = 4 * k
          g.strokeStyle = 'rgba(255,255,255,0.85)'
          g.fillStyle = 'rgba(255,255,255,0.04)'
          g.lineWidth = 2 * k
          g.beginPath()
          g.roundRect(c.x - bw / 2, c.y - bh / 2, bw, bh, 10 * k)
          g.fill(); g.stroke()
          g.shadowBlur = 0
          g.fillStyle = '#ffffff'
          g.textAlign = 'center'
          g.textBaseline = 'middle'
          g.font = `700 ${Math.round(34 * k)}px ${FONT_MONO}`
          g.fillText(b.label, c.x, c.y - (b.sub ? 13 * k : 0))
          if (b.sub) {
            g.fillStyle = 'rgba(255,255,255,0.55)'
            g.font = `400 ${Math.round(24 * k)}px ${FONT_MONO}`
            g.fillText(b.sub, c.x, c.y + 22 * k)
          }
          g.restore()
        }
        // Beams.
        for (const bm of p.beams) {
          if (t < bm.at) continue
          const a = P(bm.from)
          const b = P(bm.to)
          const u = easeInOutCubic(seg(t, bm.at, bm.at + bm.dur))
          const c = col(bm.colour)
          const hx = a.x + (b.x - a.x) * u
          const hy = a.y + (b.y - a.y) * u
          g.save()
          g.shadowColor = c
          g.shadowBlur = 6 * k
          if (bm.keep || u < 1) {
            g.strokeStyle = rgba(c.startsWith('#') ? c : accent, u < 1 ? 0.35 : 0.55)
            g.lineWidth = 2 * k
            g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(hx, hy); g.stroke()
          }
          if (u < 1) {
            const tail = Math.max(0, u - 0.3)
            const tx = a.x + (b.x - a.x) * tail
            const ty = a.y + (b.y - a.y) * tail
            const gr = g.createLinearGradient(tx, ty, hx, hy)
            gr.addColorStop(0, rgba(c.startsWith('#') ? c : accent, 0))
            gr.addColorStop(1, HOT)
            g.strokeStyle = gr
            g.lineWidth = 3 * k
            g.beginPath(); g.moveTo(tx, ty); g.lineTo(hx, hy); g.stroke()
            const fr = g.createRadialGradient(hx, hy, 0, hx, hy, 16 * k)
            fr.addColorStop(0, 'rgba(255,255,240,1)')
            fr.addColorStop(0.35, rgba(c.startsWith('#') ? c : accent, 0.6))
            fr.addColorStop(1, 'rgba(0,0,0,0)')
            g.fillStyle = fr
            g.fillRect(hx - 16 * k, hy - 16 * k, 32 * k, 32 * k)
          }
          g.restore()
        }
        // Red ✕ marks.
        for (const m of p.marks) {
          if (t < m.at) continue
          const c = P(m)
          const r = 26 * k
          const e1 = easeOutCubic(seg(t, m.at, m.at + 0.15))
          const e2 = easeOutCubic(seg(t, m.at + 0.12, m.at + 0.27))
          g.save()
          g.shadowColor = RED
          g.shadowBlur = 6 * k
          g.strokeStyle = RED
          g.lineWidth = 6 * k
          g.lineCap = 'round'
          g.beginPath()
          g.moveTo(c.x - r, c.y - r); g.lineTo(c.x - r + 2 * r * e1, c.y - r + 2 * r * e1)
          if (e2 > 0) { g.moveTo(c.x + r, c.y - r); g.lineTo(c.x + r - 2 * r * e2, c.y - r + 2 * r * e2) }
          g.stroke()
          g.restore()
        }
      },
    }
  },
}

/** glow-words: the sentence waits dim; each word lights up in the accent as it is said, then cools to white. */
export const glowWords: Primitive<GlowWordsParams> = {
  id: 'glow-words',
  params: glowWordsParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const accent = accentOf(ctx)
    const box = document.createElement('div')
    Object.assign(box.style, { position: 'absolute', left: `${s.x}px`, width: `${s.w}px`, top: `${s.y + p.y * s.h}px`, transform: 'translateY(-50%)', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `0 ${Math.round(0.28 * p.size * k)}px`, direction: 'rtl', fontFamily: ctx.look.fontDisplay, fontWeight: '800', fontSize: `${Math.round(p.size * k)}px`, lineHeight: '1.3' })
    ctx.layer.append(box)
    // Consecutive Latin words (After Effects) keep their own left-to-right order inside the RTL line.
    const latin = (x: string) => !/[ء-يٮ-ۓ]/.test(x)
    let run: HTMLElement | null = null
    // Each word's elements (a Latin word's trailing Arabic punctuation is its own element, placed
    // after the Latin run so it ends the sentence on the left).
    const spans = p.words.map((wd) => {
      const els: HTMLElement[] = []
      if (latin(wd.text)) {
        const m = /^(.*?)([؟،…!?.,]+)$/.exec(wd.text)
        const sp = document.createElement('div')
        sp.dir = 'ltr'
        lineUnit(sp, m ? m[1]! : wd.text)
        if (!run) {
          run = document.createElement('div')
          Object.assign(run.style, { display: 'flex', direction: 'ltr', gap: `0 ${Math.round(0.28 * p.size * k)}px` })
          box.append(run)
        }
        run.append(sp)
        els.push(sp)
        if (m) {
          const tail = document.createElement('div')
          lineUnit(tail, m[2]!)
          tail.style.marginInlineStart = `${Math.round(-0.22 * p.size * k)}px`
          box.append(tail)
          els.push(tail)
          run = null
        }
      } else {
        const sp = document.createElement('div')
        lineUnit(sp, wd.text)
        run = null
        box.append(sp)
        els.push(sp)
      }
      return els
    })
    return {
      update(localT) {
        const t = Math.max(0, localT)
        box.style.opacity = f3(Math.min(1, seg(t, 0, 0.25)))
        spans.forEach((els, i) => {
          const wd = p.words[i]!
          const lit = seg(t, wd.at, wd.at + 0.12)
          const cool = wd.key ? 0 : seg(t, wd.at + 0.25, wd.at + 0.8)
          for (const sp of els) {
            if (lit <= 0) {
              sp.style.color = 'rgba(255,255,255,0.26)'
              sp.style.textShadow = 'none'
              sp.style.transform = ''
              continue
            }
            const hotA = lit * (1 - cool)
            sp.style.color = cool >= 1 ? '#ffffff' : hotA > 0.5 ? accent : '#ffffff'
            sp.style.textShadow = `0 0 ${f3((3 + 7 * hotA) * k)}px ${rgba(accent, 0.25 + 0.4 * hotA)}, 0 0 ${f3(16 * k * hotA)}px ${rgba(accent, 0.2 * hotA)}`
            const pop = lit < 1 ? 1 + 0.06 * Math.sin(Math.PI * lit) : 1
            sp.style.transform = pop === 1 ? '' : `scale(${f3(pop)})`
          }
        })
      },
    }
  },
}

/** beat-slam: on each beat the frame flashes the accent with one giant ink word that punches in. */
export const beatSlam: Primitive<BeatSlamParams> = {
  id: 'beat-slam',
  params: beatSlamParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const accent = accentOf(ctx)
    const bg = document.createElement('div')
    Object.assign(bg.style, { position: 'absolute', inset: '0', background: p.flash === 'accent' ? accent : '#0d0f12', visibility: 'hidden' })
    ctx.layer.append(bg)
    const words = p.words.map((wd) => {
      const el = document.createElement('div')
      Object.assign(el.style, { position: 'absolute', left: `${w * 0.05}px`, width: `${w * 0.9}px`, top: '50%', textAlign: 'center', transform: 'translateY(-50%)', fontFamily: ctx.look.fontDisplay, fontWeight: '900', color: p.flash === 'accent' ? '#141210' : accent, lineHeight: '1.1', whiteSpace: 'nowrap', visibility: 'hidden', direction: 'rtl' })
      lineUnit(el, wd.text)
      ctx.layer.append(el)
      el.style.fontSize = `${Math.round(0.42 * w)}px`
      fitText(el, { w: w * 0.9, h: h * 0.5 }, Math.round(0.42 * w), Math.round(0.08 * w))
      return el
    })
    return {
      update(localT) {
        const t = Math.max(0, localT)
        let cur = -1
        p.words.forEach((wd, i) => {
          if (t >= wd.at) cur = i
        })
        bg.style.visibility = cur >= 0 ? 'visible' : 'hidden'
        words.forEach((el, i) => {
          const on = i === cur
          el.style.visibility = on ? 'visible' : 'hidden'
          if (!on) return
          const u = t - p.words[i]!.at
          const e = easeOutCubic(seg(u, 0, 0.18))
          const sc = 1.28 - 0.28 * e
          const shake = 10 * k * Math.sin(u * 70) * (1 - seg(u, 0, 0.22))
          el.style.transform = `translate(${f3(shake)}px, -50%) scale(${f3(sc)})`
          el.style.filter = u < 0.09 ? `blur(${f3((1 - u / 0.09) * 10 * k)}px)` : 'none'
        })
        // A short white flash on each beat.
        const flash = cur >= 0 ? 1 - seg(t - p.words[cur]!.at, 0, 0.12) : 0
        bg.style.filter = flash > 0 ? `brightness(${f3(1 + 0.6 * flash)})` : 'none'
      },
    }
  },
}
