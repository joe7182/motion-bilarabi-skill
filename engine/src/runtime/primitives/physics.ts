import { BOUNCE, bounceBallParams, hopArc, settleAt, type BounceBallParams } from '../../core/params/physics'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

const f2 = (x: number) => x.toFixed(2)
const f3 = (x: number) => x.toFixed(3)

interface Land {
  x: number
  /** Ball centre when resting on the target. */
  y: number
  at: number
}
interface Pose {
  x: number
  y: number
  /** The ground under the ball (its shadow line). */
  ground: number
  /** Height above the ground (px). */
  lift: number
  /** Seconds since the last impact (−1: none yet). */
  since: number
  /** Vertical speed, −1..1 (up negative). */
  vy: number
  visible: boolean
}

/** bounce-ball: a ball with bounce physics hopping word to word (or point to point), squash and shadow. */
export const bounceBall: Primitive<BounceBallParams> = {
  id: 'bounce-ball',
  params: bounceBallParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const s = ctx.safe
    const r = (p.size * w) / 2
    let fs = p.fontSize * k
    const fg = ctx.look.vars.fg
    const accent = ctx.look.vars.accent
    const base = p.colour === 'accent' ? accent : p.colour === 'white' ? '#ffffff' : fg

    // The words' line (RTL), each word its own box so it can dip when hit.
    const line = document.createElement('div')
    Object.assign(line.style, { position: 'absolute', left: `${f2(s.x)}px`, width: `${f2(s.w)}px`, top: `${f2(s.y + p.y * s.h)}px`, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: `0 ${f2(0.3 * fs)}px`, direction: 'rtl', flexWrap: 'nowrap' })
    const words = p.words.map((wd) => {
      const holder = document.createElement('div')
      Object.assign(holder.style, { position: 'relative', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${f2(fs)}px`, lineHeight: '1.25' })
      lineUnit(holder, wd.text)
      line.append(holder)
      return holder
    })
    if (words.length) ctx.layer.append(line)

    // Shadow, trail and ball.
    const shadow = document.createElement('div')
    Object.assign(shadow.style, { position: 'absolute', left: '0', top: '0', width: `${f2(2 * r)}px`, height: `${f2(0.5 * r)}px`, borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(0,0,0,0.45), rgba(0,0,0,0))', opacity: '0' })
    ctx.layer.append(shadow)
    const trail = p.trail
      ? Array.from({ length: 7 }, (_, i) => {
          const d = document.createElement('div')
          Object.assign(d.style, { position: 'absolute', left: '0', top: '0', width: `${f2(2 * r)}px`, height: `${f2(2 * r)}px`, borderRadius: '50%', background: base, opacity: '0', transform: 'scale(0)' })
          ctx.layer.append(d)
          return { d, i: i + 1 }
        })
      : []
    const ball = document.createElement('div')
    Object.assign(ball.style, {
      position: 'absolute', left: '0', top: '0', width: `${f2(2 * r)}px`, height: `${f2(2 * r)}px`, borderRadius: '50%', transformOrigin: '50% 100%',
      background:
        p.look === 'glossy'
          ? `radial-gradient(circle at 34% 28%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.35) 14%, rgba(255,255,255,0) 30%), radial-gradient(circle at 42% 38%, ${base} 0%, ${base} 48%, color-mix(in srgb, ${base} 55%, #000) 100%)`
          : base,
      boxShadow: p.look === 'glossy' ? `inset ${f2(-0.12 * r)}px ${f2(-0.16 * r)}px ${f2(0.35 * r)}px rgba(0,0,0,0.35)` : 'none',
      opacity: '0',
    })
    ctx.layer.append(ball)

    let lands: Land[] | null = null
    const measure = (): Land[] => {
      if (words.length) {
        // Long lines shrink to fit the safe width.
        const wide = line.scrollWidth
        if (wide > s.w * 0.94) {
          fs *= (s.w * 0.94) / wide
          for (const el of words) el.style.fontSize = `${f2(fs)}px`
          line.style.gap = `0 ${f2(0.3 * fs)}px`
        }
        const host = ctx.layer.getBoundingClientRect()
        const sc = host.width > 0 ? w / host.width : 1
        return words.map((el, i) => {
          const b = el.getBoundingClientRect()
          // The ball rests on the letters' tops (about a fifth of the line box below its top).
          return { x: (b.left + b.width / 2 - host.left) * sc, y: (b.top - host.top) * sc + 0.36 * fs - r, at: p.words[i]!.at }
        })
      }
      if (p.targets.length) return p.targets.map((t) => ({ x: t.x * w, y: t.y * h - r, at: t.at }))
      return []
    }

    const arcPx = p.arc * h
    const poseAt = (t: number): Pose => {
      const L = lands!
      if (p.drop) {
        const gx = p.drop.x * w
        const gy = p.drop.y * h - r
        const height = gy + 2 * r
        const st = settleAt(t - p.drop.at, BOUNCE.dropIn, p.drop.bounce, 6)
        const lift = st.h * height
        return { x: gx, y: gy - lift, ground: gy + r, lift, since: st.since, vy: st.since < 0 ? 1 : 0, visible: t >= p.drop.at - BOUNCE.dropIn }
      }
      const first = L[0]!
      if (t < first.at) {
        // Falling in from above the frame onto the first target.
        const u = (t - (first.at - BOUNCE.dropIn)) / BOUNCE.dropIn
        const y0 = -2 * r
        return { x: first.x, y: y0 + (first.y - y0) * Math.max(0, u) ** 2, ground: first.y + r, lift: (first.y - y0) * (1 - Math.max(0, u) ** 2), since: -1, vy: 1, visible: u >= 0 }
      }
      for (let i = 0; i + 1 < L.length; i++) {
        const a = L[i]!
        const b = L[i + 1]!
        if (t >= a.at && t < b.at) {
          const u = (t - a.at) / (b.at - a.at)
          const peak = arcPx + Math.max(0, a.y - b.y)
          const yb = a.y + (b.y - a.y) * u
          const lift = peak * hopArc(u)
          return { x: a.x + (b.x - a.x) * u, y: yb - lift, ground: yb + r, lift, since: t - a.at, vy: (2 * u - 1), visible: true }
        }
      }
      const last = L[L.length - 1]!
      if (p.out !== undefined && t >= p.out) {
        // Bounces off: one big hop out of the frame (towards the reading direction's end, the left).
        const u = (t - p.out) / 0.6
        return { x: last.x - u * 0.7 * w, y: last.y - arcPx * 1.6 * hopArc(Math.min(u, 1) * 0.6) + Math.max(0, u - 0.6) * h, ground: last.y + r, lift: 0, since: t - p.out, vy: 2 * u - 1, visible: u < 1.4 }
      }
      // Settles on the last word with small decaying bounces.
      const st = settleAt(t - last.at, 0.16, 0.45, BOUNCE.settleBounces)
      const lift = st.h * arcPx * 0.25
      return { x: last.x, y: last.y - lift, ground: last.y + r, lift, since: st.since, vy: 0, visible: true }
    }

    return {
      update(localT) {
        const t = Math.max(0, localT)
        lands ??= measure()
        if (!p.drop && lands.length === 0) return
        const P = poseAt(t)
        // Squash on impact (a damped wobble), stretch along the vertical speed in flight.
        const d = P.since
        const squash = d >= 0 ? BOUNCE.squash * Math.exp(-16 * d) * Math.cos(32 * d) : 0
        const stretch = P.lift > 2 ? 0.16 * Math.abs(P.vy) : 0
        const sy = Math.max(0.55, 1 - squash + stretch)
        const sx = Math.max(0.7, 1 + squash * 0.9 - stretch * 0.6)
        ball.style.opacity = P.visible ? '1' : '0'
        ball.style.transform = `translate(${f2(P.x - r)}px, ${f2(P.y - r)}px) scale(${f3(sx)}, ${f3(sy)})`
        const near = Math.max(0, 1 - P.lift / (arcPx * 1.4))
        shadow.style.opacity = P.visible ? f3(0.25 + 0.65 * near) : '0'
        const sw = 0.6 + 0.5 * near
        shadow.style.transform = `translate(${f2(P.x - r)}px, ${f2(P.ground - 0.25 * r)}px) scale(${f3(sw)}, ${f3(sw)})`
        for (const tr of trail) {
          const q = poseAt(Math.max(0, t - tr.i * 0.035))
          tr.d.style.opacity = q.visible && P.lift > 4 ? f3(0.32 * (1 - tr.i / 8)) : '0'
          tr.d.style.transform = `translate(${f2(q.x - r)}px, ${f2(q.y - r)}px) scale(${f3(1 - tr.i * 0.1)})`
        }
        // Words: dim until hit, then lit (accent for key words) with a dip on the impact.
        p.words.forEach((wd, i) => {
          const el = words[i]!
          const dt = t - wd.at
          const hit = dt >= 0
          el.style.color = hit && wd.key ? accent : fg
          el.style.opacity = hit ? '1' : '0.28'
          const dip = hit ? 0.09 * fs * Math.exp(-9 * dt) * Math.cos(20 * dt) : 0
          el.style.transform = Math.abs(dip) > 0.05 ? `translateY(${f2(dip)}px)` : ''
        })
      },
    }
  },
}
