import { HUE_FIELD as H, hueFieldParams, type HueFieldParams } from '../../core/params/hue-field'
import { worldIsLight } from '../looks'
import type { Primitive } from './registry'

const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`

/**
 * hue-field: the frame's background colour with four large radial glows drifting on the video
 * clock (sin/cos of the local time, no CSS animation), a vignette and grain. Each update reads the
 * live colour world (`--mba-bg`) and picks the dark or light hues, so a backdrop flip follows.
 */
export const hueField: Primitive<HueFieldParams> = {
  id: 'hue-field',
  params: hueFieldParams,
  build(ctx, p) {
    const W = ctx.size.w
    const Hh = ctx.size.h
    const root = document.createElement('div')
    Object.assign(root.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: 'var(--mba-bg)', pointerEvents: 'none' })
    const glows = H.glows.map((g) => {
      const el = document.createElement('div')
      const d = g.size * W
      Object.assign(el.style, { position: 'absolute', left: `${(g.x * W - d / 2).toFixed(1)}px`, top: `${(g.y * Hh - d / 2).toFixed(1)}px`, width: `${d.toFixed(1)}px`, height: `${d.toFixed(1)}px`, borderRadius: '50%' })
      root.append(el)
      return el
    })
    const vig = document.createElement('div')
    const grain = document.createElement('div')
    Object.assign(grain.style, { position: 'absolute', inset: '0', backgroundImage: GRAIN, opacity: p.grain.toFixed(3), mixBlendMode: 'overlay' })
    Object.assign(vig.style, { position: 'absolute', inset: '0' })
    root.append(vig, grain)
    ctx.layer.append(root)
    let mode: 'dark' | 'light' | '' = ''
    const paint = (m: 'dark' | 'light') => {
      const hues = m === 'dark' ? (p.dark ?? [ctx.look.vars.accent, ...H.dark.slice(1)]) : (p.light ?? [...H.light])
      glows.forEach((el, i) => {
        const a = Math.min(1, (m === 'dark' ? H.glows[i]!.alpha : H.lightAlpha[i]!) * p.strength)
        el.style.background = `radial-gradient(circle, color-mix(in srgb, ${hues[i]} ${(a * 100).toFixed(0)}%, transparent) 0%, transparent 62%)`
      })
      root.style.background = (m === 'dark' ? p.base : p.lightBase) ?? 'var(--mba-bg)'
      vig.style.background = `radial-gradient(ellipse at 50% 45%, transparent 55%, ${m === 'dark' ? 'rgba(0,0,0,.45)' : 'rgba(120,90,200,.10)'} 100%)`
      mode = m
    }
    return {
      update(localT) {
        const m = worldIsLight(ctx.layer) ? 'light' : 'dark'
        if (m !== mode) paint(m)
        const t = Math.max(0, localT) * p.speed
        glows.forEach((el, i) => {
          const g = H.glows[i]!
          const u = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / (2 * g.period))
          const s = 1 + 0.1 * Math.sin((2 * Math.PI * t) / (2 * g.period))
          el.style.transform = `translate(${(g.dx * W * u).toFixed(1)}px, ${(g.dy * Hh * u).toFixed(1)}px) scale(${s.toFixed(4)})`
        })
      },
    }
  },
}
