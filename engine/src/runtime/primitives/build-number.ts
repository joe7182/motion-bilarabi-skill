import { easeInCubic, easeInOutCubic, easeOutCubic, seg } from '../../core/ease'
import { rng } from '../../core/rng'
import { softSpring } from '../../core/params/morph-object'
import {
  BUILD_NUMBER as BN,
  buildNumberLayout,
  buildNumberParams,
  buildNumberText,
  morphAtOf,
  type BuildNumberParams,
  type StackItem,
} from '../../core/params/build-number'
import { resolvedWorld, sceneCanvas } from '../canvas'
import { frameRect } from '../drift-fit'
import { FONT_WEIGHT } from '../looks'
import { rgba } from '../materials'
import { hash01, mixHex } from '../objects-draw'
import { drawBill, drawBrickBlock } from '../objects-draw-home'
import { drawCementBag } from '../objects-draw-cost'
import { fitText, lineUnit, textDir } from '../text/units'
import { hasArabic } from '../../core/text'
import type { Primitive } from './registry'

const TAU = Math.PI * 2

/** An item's pose at a time: centre (px), turn, scales, alpha. */
interface Pose {
  x: number
  y: number
  rot: number
  sx: number
  sy: number
  a: number
}

/**
 * `build-number` (Stage 2): items fall from above the frame (or flutter in, or burst out of
 * `from`) and stack into the digits of a number on a canvas (`aria-hidden`) — bricks in running
 * bond, cement sacks, or bills (`drawBill`: the Iraqi dinar is paper) — with a tiny bounce and a
 * dust puff on landing (not for paper). At `morphAt` the items pull together and shrink into the
 * clean number, the only text (a DOM line unit in the display font and accent, audit-clean) with a
 * short sparkle and a small overshoot; the `label` rises in under it. With `scramble` the number's
 * digits keep rolling afterwards. Hidden DOM uses display:none; everything is pure in localT.
 */
export const buildNumber: Primitive<BuildNumberParams> = {
  id: 'build-number',
  params: buildNumberParams,
  build(ctx, p) {
    const L = buildNumberLayout(p)
    const morphAt = morphAtOf(p)
    const { el: canvas, g } = sceneCanvas(ctx)
    canvas.dataset.mbaPart = 'build-number-items'

    // the stack's size and place: the number `width` of the safe width (a single glyph BIG), its
    // height capped, centred on `at`
    const cx0 = ctx.safe.x + p.at.x * ctx.safe.w
    const cy0 = ctx.safe.y + p.at.y * ctx.safe.h
    const u = L.big ? Math.min((BN.bigH * ctx.safe.w) / L.h, (p.width * ctx.safe.w) / L.w) : Math.min((p.width * ctx.safe.w) / L.w, (BN.maxH * ctx.safe.h) / L.h)
    const SW = L.w * u
    const SH = L.h * u

    // the DOM: the clean number and the label, hidden until the morph
    const group = document.createElement('div')
    group.dataset.mbaPart = 'build-number'
    if (p.key) group.dataset.mbaKey = p.key
    Object.assign(group.style, { position: 'absolute', left: '0px', top: '0px', width: `${ctx.size.w}px`, height: `${ctx.size.h}px`, pointerEvents: 'none' })
    const numBox = document.createElement('div')
    Object.assign(numBox.style, {
      position: 'absolute',
      fontFamily: ctx.look.fontDisplay,
      fontWeight: String(FONT_WEIGHT.display),
      fontVariantNumeric: 'tabular-nums',
      lineHeight: '1.15',
      color: ctx.look.vars.accent,
      whiteSpace: 'nowrap',
      transformOrigin: '50% 50%',
    })
    const shown = buildNumberText(p, morphAt)
    const num = lineUnit(numBox, shown)
    group.append(numBox)
    let labelBox: HTMLElement | undefined
    if (p.label) {
      labelBox = document.createElement('div')
      Object.assign(labelBox.style, {
        position: 'absolute',
        fontFamily: ctx.look.fontDisplay,
        fontWeight: String(FONT_WEIGHT.display),
        lineHeight: '1.2',
        color: ctx.look.vars.fg,
        whiteSpace: 'nowrap',
      })
      lineUnit(labelBox, p.label)
      group.append(labelBox)
    }
    ctx.layer.append(group)
    // fit the widest form the number can take (rolling digits differ in width) to the stack's box
    const probes = p.scramble ? [...'0123456789'].map((d) => [...p.value].map((c) => (',٬.'.includes(c) ? c : d)).join('')) : [shown]
    const widest = () => {
      let best = probes[0]!
      let bw = -1
      for (const pr of probes) {
        num.textContent = pr
        const w = num.getBoundingClientRect().width
        if (w > bw) {
          bw = w
          best = pr
        }
      }
      return best
    }
    num.textContent = widest()
    fitText(numBox, { w: Math.floor(Math.min(SW * 1.05, ctx.safe.w)), h: Math.floor(L.big ? SH * 2.0 : Math.max(SH * 2, Math.min(SW * 0.3, 0.2 * ctx.safe.h))) }, L.big ? 1000 : 420, 36)
    num.style.width = `${Math.ceil(frameRect(ctx.layer, ctx.size.w, [num]).w)}px`
    num.style.textAlign = 'center'
    num.textContent = shown
    const nb = frameRect(ctx.layer, ctx.size.w, [numBox])
    const fontPx = parseFloat(numBox.style.fontSize) || 120
    let lb = { w: 0, h: 0 }
    if (labelBox) {
      labelBox.style.fontSize = `${Math.round(Math.max(36, Math.min(76, fontPx * 0.32)))}px`
      const r = frameRect(ctx.layer, ctx.size.w, [labelBox])
      lb = { w: r.w, h: r.h }
    }
    // the group (number, then the label under it) and the stack, kept inside the safe area
    const gap = labelBox ? fontPx * 0.05 : 0
    const totalH = Math.max(SH, nb.h) + gap + lb.h
    const half = Math.max(SW, nb.w, lb.w) / 2
    const cx = Math.min(Math.max(cx0, ctx.safe.x + half), ctx.safe.x + ctx.safe.w - half)
    const top = Math.min(Math.max(cy0 - Math.max(SH, nb.h) / 2, ctx.safe.y), ctx.safe.y + ctx.safe.h - totalH)
    const cy = top + Math.max(SH, nb.h) / 2
    numBox.style.left = `${(cx - nb.w / 2).toFixed(2)}px`
    numBox.style.top = `${(cy - nb.h / 2).toFixed(2)}px`
    if (labelBox) {
      labelBox.style.left = `${(cx - lb.w / 2).toFixed(2)}px`
      labelBox.style.top = `${(cy + Math.max(SH, nb.h) / 2 + gap).toFixed(2)}px`
    }
    // each glyph's box in the DOM number (frame px), for the morph's targets
    const node = num.firstChild as Text | null
    const range = document.createRange()
    const L0 = ctx.layer.getBoundingClientRect()
    const kz = L0.width > 0 ? L0.width / ctx.size.w : 1
    const domGlyph = L.glyphs.map((_, i) => {
      if (!node) return { x: cx, y: cy, w: 10, h: 10 }
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const r = range.getBoundingClientRect()
      return { x: (r.left - L0.left) / kz + r.width / kz / 2, y: (r.top - L0.top) / kz + r.height / kz / 2, w: r.width / kz, h: r.height / kz }
    })
    group.style.display = 'none'

    // the stack in frame px
    const sx0 = cx - SW / 2
    const sy0 = cy - SH / 2
    const target = (it: StackItem) => ({ x: sx0 + (it.x + it.w / 2) * u, y: sy0 + (it.y + it.h / 2) * u, w: it.w * u, h: it.h * u })
    const fromPx = p.from ? { x: ctx.safe.x + p.from.x * ctx.safe.w, y: ctx.safe.y + p.from.y * ctx.safe.h } : undefined
    const paper = p.item === 'banknote'

    /** An item's pose at scene s t, before the morph. */
    const poseOf = (it: StackItem, t: number): Pose | undefined => {
      if (t < it.start) return undefined
      const T = target(it)
      const r = rng(it.seed)
      const restRot = paper ? (r() - 0.5) * 0.22 : 0
      const k = seg(t, it.start, it.land)
      if (t >= it.land) {
        const tau = t - it.land
        const bounce = paper ? 0 : tau < BN.bounceSec ? -BN.bounce * T.h * Math.sin((Math.PI * tau) / BN.bounceSec) : 0
        return { x: T.x, y: T.y + bounce, rot: restRot, sx: 1, sy: 1, a: 1 }
      }
      if (p.entry === 'flutter') {
        // a thrown bill: from above (or a side, or the burst point) on its own sway, tumbling about its long axis, slowing into its cell
        const side = r()
        const start = fromPx
          ? { x: fromPx.x + (r() - 0.5) * 40, y: fromPx.y + (r() - 0.5) * 30 }
          : side < 0.18
            ? { x: -0.15 * ctx.size.w, y: ctx.size.h * (0.1 + 0.3 * r()) }
            : side < 0.36
              ? { x: 1.15 * ctx.size.w, y: ctx.size.h * (0.1 + 0.3 * r()) }
              : { x: T.x + (r() - 0.5) * 520, y: -120 - 260 * r() }
        const ctrl = fromPx ? { x: (start.x + T.x) / 2 + (r() - 0.5) * 300, y: Math.min(start.y, T.y) - 220 - 200 * r() } : { x: (start.x + T.x) / 2 + (r() - 0.5) * 240, y: (start.y + T.y) / 2 - 80 * r() }
        const e = 1 - (1 - k) ** 2.2
        const v = 1 - e
        const swayA = (40 + 50 * r()) * (1 - k) ** 1.5
        const ph = r() * TAU
        const x = v * v * start.x + 2 * v * e * ctrl.x + e * e * T.x + swayA * Math.sin(5.5 * t + ph)
        const y = v * v * start.y + 2 * v * e * ctrl.y + e * e * T.y
        const flips = 1 + Math.floor(r() * 3)
        const rot0 = (r() - 0.5) * 2.4
        return { x, y, rot: rot0 + (restRot - rot0) * e + 0.25 * (1 - k) * Math.sin(3.1 * t + ph), sx: 1, sy: Math.cos(TAU * flips * (1 - e)), a: Math.min(1, k * 6) }
      }
      if (fromPx) {
        // a burst: out of the point on an arc up and over into the cell
        const ctrl = { x: (fromPx.x + T.x) / 2 + (r() - 0.5) * 260, y: Math.min(fromPx.y, T.y) - 160 - 220 * r() }
        const e = easeOutCubic(k)
        const v = 1 - e
        return { x: v * v * fromPx.x + 2 * v * e * ctrl.x + e * e * T.x, y: v * v * fromPx.y + 2 * v * e * ctrl.y + e * e * T.y, rot: (1 - e) * (r() - 0.5) * 3, sx: 0.5 + 0.5 * e, sy: 0.5 + 0.5 * e, a: Math.min(1, k * 8) }
      }
      // a fall under gravity from above the frame
      const y0 = -T.h - 60 - 140 * r()
      return { x: T.x, y: y0 + (T.y - y0) * easeInCubic(k), rot: 0, sx: 1, sy: 1, a: 1 }
    }

    /** Draws one item at its pose (scale `z` of its own size). */
    const drawItem = (it: StackItem, ps: Pose, z: number) => {
      const w = it.w * u * z
      const h = it.h * u * z
      g.save()
      g.globalAlpha *= ps.a
      g.translate(ps.x, ps.y)
      g.rotate(ps.rot)
      g.scale(ps.sx, ps.sy)
      if (p.item === 'brick') {
        // a small three-faced brick (a mortar gap all round), its top and end faces showing
        const bw = w * 0.95, bh = h * 0.86
        drawBrickBlock(g, -bw / 2, -bh / 2 + h * 0.04, bw, bh, bh * 0.2, -bh * 0.3, it.seed)
      } else if (p.item === 'cement-bag') {
        drawCementBag(g, w * 0.94, h * 0.96, ctx.look.fontDisplay, it.seed)
      } else {
        drawBill(g, w * (L.big ? 1.2 : 1.12), ctx.look.fontDisplay, hash01(it.seed, 3) * 0.35)
      }
      g.restore()
    }

    // the cement sack stands on its bottom-centre: shift its pose to the cell's bottom
    const anchor = (it: StackItem, ps: Pose, z: number): Pose => (p.item === 'cement-bag' ? { ...ps, y: ps.y + (it.h * u * z) / 2 } : ps)

    // flutter: the extra bills that fly past and fall out of the frame
    const extras = p.entry === 'flutter'
      ? Array.from({ length: Math.round(L.items.length * BN.extra) + BN.extraMin }, (_, i) => {
          const r = rng((L.seed ^ 0x9e3779b9) + i * 2246822519)
          const s0 = p.fallFrom + r() * p.buildSec * 0.85
          const dur = BN.extraSec[0] + (BN.extraSec[1] - BN.extraSec[0]) * r()
          const side = r()
          const x0 = fromPx ? fromPx.x : side < 0.15 ? -0.1 * ctx.size.w : side < 0.3 ? 1.1 * ctx.size.w : r() * ctx.size.w
          const y0 = fromPx ? fromPx.y : side < 0.3 ? ctx.size.h * 0.15 * r() : -100 - 200 * r()
          return { s0, dur, x0, y0, drift: (r() - 0.5) * 500, peak: fromPx ? 300 + 300 * r() : 0, ph: r() * TAU, spin: 2 + 4 * r(), flip: 3 + 4 * r(), w: (L.items[0]?.w ?? 2) * u * (0.9 + 0.3 * r()), seed: (L.seed + i * 131) >>> 0 }
        })
      : []

    const sparkles = Array.from({ length: 36 }, (_, i) => {
      const r = rng((L.seed ^ 0x51ed270b) + i * 97)
      const it = L.items[Math.floor(r() * L.items.length)]!
      return { it, ang: r() * TAU, dist: 30 + 70 * r(), size: 2 + 4 * r(), delay: r() * 0.12, white: r() < 0.5 }
    })

    return {
      update(t) {
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, canvas.width, canvas.height)
        g.restore()
        const col = resolvedWorld(ctx.layer)
        const mk = seg(t, morphAt, morphAt + BN.morphSec)
        const me = easeInOutCubic(mk)

        // the extras flutter past (and keep going after the stack is built)
        for (const x of extras) {
          const k = (t - x.s0) / x.dur
          if (!(k > 0 && k < 1)) continue
          const y = fromPx ? x.y0 - x.peak * Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k) + (ctx.size.h + 200 - x.y0) * easeInCubic(k) : x.y0 + (ctx.size.h + 260 - x.y0) * (k * 0.6 + 0.4 * k * k)
          const xx = x.x0 + x.drift * k + 60 * Math.sin(4 * t + x.ph)
          g.save()
          g.translate(xx, y)
          g.rotate(x.ph + x.spin * k)
          g.scale(1, Math.cos(x.flip * TAU * k + x.ph))
          drawBill(g, x.w, ctx.look.fontDisplay, hash01(x.seed, 1) * 0.3)
          g.restore()
        }

        // the stack, then the morph: items pull into their DOM glyphs and fade
        if (mk < 1) {
          for (const it of L.items) {
            const base = poseOf(it, t)
            if (!base) continue
            let ps = base
            let z = 1
            if (mk > 0) {
              const T = target(it)
              const gi = L.glyphs[it.glyph]!
              const D = domGlyph[it.glyph]!
              // the item's place in its stacked glyph → the same place in the DOM glyph's ink box
              const fx = (T.x - (sx0 + gi.x0 * u)) / Math.max(1, (gi.x1 - gi.x0) * u) - 0.5
              const fy = (T.y - sy0) / SH - 0.5
              const inkH = D.h * 0.62
              const tx = D.x + fx * D.w * 0.8
              const ty = D.y + D.h * 0.04 + fy * (gi.sep ? D.h * 0.4 : inkH) + (gi.sep ? D.h * 0.22 : 0)
              z = 1 + ((inkH / SH) * (gi.sep ? 0.6 : 1) - 1) * me
              ps = { ...base, x: base.x + (tx - base.x) * me, y: base.y + (ty - base.y) * me, a: base.a * (1 - seg(mk, 0.45, 1)) }
            }
            const drawn = anchor(it, ps, z)
            drawItem(it, drawn, z)
            // the dust puff on landing (not for paper)
            const tau = t - it.land
            if (!paper && tau > 0 && tau < BN.dustSec && mk === 0) {
              const T = target(it)
              const dk = tau / BN.dustSec
              const dust = p.item === 'brick' ? '#D9C3A5' : '#D6D3CC'
              for (let i = 0; i < 4; i++) {
                const side = i < 2 ? -1 : 1
                const px = T.x + side * T.w * (0.4 + 0.25 * dk + 0.1 * (i % 2))
                const py = T.y + T.h * (0.42 - 0.25 * dk * (1 + (i % 2)))
                const rr = T.h * (0.12 + 0.35 * dk)
                const gr = g.createRadialGradient(px, py, 0, px, py, rr)
                gr.addColorStop(0, rgba(dust, 0.45 * (1 - dk)))
                gr.addColorStop(1, rgba(dust, 0))
                g.fillStyle = gr
                g.fillRect(px - rr, py - rr, 2 * rr, 2 * rr)
              }
            }
          }
          // the sparkle as they fuse
          if (mk > 0.3) {
            for (const sp of sparkles) {
              const k = seg(mk, 0.3 + sp.delay, 1)
              if (!(k > 0 && k < 1)) continue
              const D = domGlyph[sp.it.glyph]!
              const x = D.x + Math.cos(sp.ang) * sp.dist * easeOutCubic(k)
              const y = D.y + Math.sin(sp.ang) * sp.dist * easeOutCubic(k)
              g.fillStyle = rgba(sp.white ? mixHex(col.accent, '#ffffff', 0.7) : col.accent, 1 - k)
              g.beginPath()
              g.arc(x, y, sp.size * (1 - 0.5 * k), 0, TAU)
              g.fill()
            }
          }
        }

        // the clean number: in from the morph's first third with a small overshoot; the label rises in
        const showAt = morphAt + BN.morphSec * 0.4
        if (t < showAt) {
          group.style.display = 'none'
          return
        }
        group.style.display = ''
        const text = buildNumberText(p, t)
        if (num.textContent !== text) {
          num.textContent = text
          num.dir = textDir(text)
          if (hasArabic(text)) num.lang = 'ar'
          else num.removeAttribute('lang')
        }
        const nk = seg(t, showAt, morphAt + BN.morphSec)
        const sc = 0.86 + 0.14 * softSpring(seg(t, showAt, showAt + 0.55))
        numBox.style.opacity = String(easeOutCubic(nk).toFixed(4))
        numBox.style.transform = `scale(${sc.toFixed(4)})`
        if (labelBox) {
          const lk = easeOutCubic(seg(t, morphAt + BN.labelAt, morphAt + BN.labelAt + BN.labelSec))
          labelBox.style.display = lk > 0 ? '' : 'none'
          labelBox.style.opacity = lk.toFixed(4)
          labelBox.style.transform = `translateY(${((1 - lk) * 24).toFixed(2)}px)`
        }
      },
    }
  },
}
