import { easeOutCubic } from '../../core/ease'
import { beatPulseParams, beatTimes, type BeatPulseParams } from '../../core/params/beat'
import type { Primitive } from './registry'

/** The look's accent as a colour string (CSS variables resolved on the layer). */
function accentOf(layer: HTMLElement, v: string): string {
  return v.startsWith('var(') ? getComputedStyle(layer).getPropertyValue(v.slice(4, -1)).trim() || '#ff5a1f' : v
}
const rgba = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1]!, 16) : 0xff5a1f
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`
}

/** beat-pulse: on every beat a shockwave ring, speed lines and an edge flash. */
export const beatPulse: Primitive<BeatPulseParams> = {
  id: 'beat-pulse',
  params: beatPulseParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    Object.assign(cv.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px`, pointerEvents: 'none' })
    ctx.layer.append(cv)
    const g = cv.getContext('2d')!
    const beats = beatTimes(p)
    const cx = p.x * w
    const cy = p.y * h
    // Each beat's speed lines: seeded angles and lengths, fixed per beat.
    const lines = beats.map(() => Array.from({ length: 22 }, () => ({ a: ctx.rng() * Math.PI * 2, r: 0.18 + ctx.rng() * 0.25, l: 0.12 + ctx.rng() * 0.22, wd: 2 + ctx.rng() * 4 })))
    const has = (kind: string) => p.kinds.includes(kind as never)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        g.clearRect(0, 0, w, h)
        const col = p.colour === 'white' ? '#ffffff' : accentOf(ctx.layer, ctx.look.vars.accent)
        g.globalCompositeOperation = 'lighter'
        beats.forEach((b, i) => {
          const d = t - b.t
          if (d < 0 || d > 0.6) return
          const s = p.strength * (b.strong ? 1.25 : 0.8)
          const u = d / 0.6
          if (has('ring')) {
            // Two rings: a fast thin one and a slow thick one.
            for (const [speed, width, alpha] of [[1.0, 10, 0.55], [0.62, 26, 0.28]] as const) {
              const r = easeOutCubic(Math.min(1, u / speed)) * 0.95 * Math.hypot(w, h) * 0.55
              g.strokeStyle = rgba(col, alpha * s * (1 - u))
              g.lineWidth = width * k * (1 - u * 0.7)
              g.beginPath()
              g.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2)
              g.stroke()
            }
          }
          if (has('lines') && d < 0.32) {
            const v = d / 0.32
            g.lineCap = 'round'
            for (const ln of lines[i]!) {
              const r0 = (ln.r + v * 0.55) * w
              const r1 = r0 + ln.l * w * (1 - v)
              g.strokeStyle = rgba(col, 0.6 * s * (1 - v))
              g.lineWidth = ln.wd * k
              g.beginPath()
              g.moveTo(cx + Math.cos(ln.a) * r0, cy + Math.sin(ln.a) * r0)
              g.lineTo(cx + Math.cos(ln.a) * r1, cy + Math.sin(ln.a) * r1)
              g.stroke()
            }
          }
          if (has('edge') && d < 0.35) {
            const v = 1 - d / 0.35
            const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6)
            gr.addColorStop(0, rgba(col, 0))
            gr.addColorStop(1, rgba(col, 0.42 * s * v * v))
            g.fillStyle = gr
            g.fillRect(0, 0, w, h)
          }
        })
        g.globalCompositeOperation = 'source-over'
      },
    }
  },
}
