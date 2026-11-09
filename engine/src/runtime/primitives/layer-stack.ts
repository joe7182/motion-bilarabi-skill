import { easeOutCubic, seg } from '../../core/ease'
import { emphasisAt, settle } from '../../core/params/common'
import { LAYER_STACK as LS, layerStackParams, slabNumber, slabSlideStart, type LayerStackParams } from '../../core/params/layer-stack'
import { FONT_WEIGHT } from '../looks'
import { bidiWordUnits, lineUnit } from '../text/units'
import { frameRect } from '../drift-fit'
import { safePointPx } from './line-art'
import { alpha, clampIn, el, fitFont, loadImage, mix, nextUid, opacityOf, px, show, svgEl } from './layers-kit'
import type { Primitive } from './registry'

interface Slab {
  box: HTMLElement
  svg: SVGSVGElement
  rim: SVGPathElement
  veil: SVGSVGElement
  icons: { img: HTMLImageElement; shadow: HTMLElement }[]
  label: HTMLElement
  leader: HTMLElement
  badge?: HTMLElement
  title: HTMLElement
  subtitle?: HTMLElement
  /** Top-face centre (holder px) at rest. */
  y: number
}

interface Wire {
  svg: SVGSVGElement
  lines: SVGLineElement[]
  pulses: SVGGElement[]
  phase: number[]
  /** Lower / upper slab (listed index) and their face-centre ys. */
  lower: number
  upper: number
  y0: number
  y1: number
}

/** A rounded square [-1, 1]² with corner radius `r` (face units). */
function roundedSquare(r: number): string {
  const a = 1 - r
  return `M ${-a} -1 H ${a} A ${r} ${r} 0 0 1 1 ${-a} V ${a} A ${r} ${r} 0 0 1 ${a} 1 H ${-a} A ${r} ${r} 0 0 1 -1 ${a} V ${-a} A ${r} ${r} 0 0 1 ${-a} -1 Z`
}

/**
 * `layer-stack`: 2..4 isometric slabs stacked vertically (listed TOP to BOTTOM), drawn flat-isometric
 * in SVG (crisp at any size): a rounded top face with a soft front-lit gradient and a hairline rim,
 * a thickness band shaded left → right, a soft contact shadow under the stack. Each slab slides down
 * and lands with a tiny settle at its `at`; its logos pop up on the face, then its label (RTL, to the
 * left: hairline leader, numbered badge, title wipe, subtitle) comes in. `active` lifts one slab by
 * 4 % with an accent rim and glow and dims the rest to 45 %; from `flowAt` accent pulses climb thin
 * wires between the slabs, looping (seeded phases). Layout is measured once at build; `update`
 * writes transforms / opacity / clip / attributes only, from `localT`.
 */
export const layerStack: Primitive<LayerStackParams> = {
  id: 'layer-stack',
  params: layerStackParams,
  async build(ctx, p) {
    const k = ctx.size.w / 1080
    const n = p.layers.length
    const W = p.width * ctx.safe.w
    const a = (LS.slabShare * W) / 2
    const b = LS.flat * a
    const h = LS.thick * a
    const P = LS.pitch * b + h
    const liftPx = LS.lift * 2 * a
    const top0 = b + liftPx + 4 * k
    const cx = W - a
    const H = top0 + (n - 1) * P + b + h + 0.35 * b
    const pad = 16 * k
    const fg = ctx.look.vars.fg
    const bg = ctx.look.vars.bg
    const accent = ctx.look.vars.accent
    const id = nextUid('ls')

    const holder = el('div', { position: 'absolute', left: '0px', top: '0px', width: px(W), height: px(H) }, 'layer-stack')
    if (p.key) holder.dataset.mbaKey = p.key
    ctx.layer.append(holder)

    // The soft contact shadow under the whole stack.
    const yBottom = top0 + (n - 1) * P
    const ground = el('div', {
      position: 'absolute', left: px(cx - a * 1.15), top: px(yBottom + h + b * 0.15 - b * 0.55), width: px(a * 2.3), height: px(b * 1.6),
      background: 'radial-gradient(closest-side, rgba(20,16,10,0.22), rgba(20,16,10,0.08) 55%, rgba(20,16,10,0) 100%)',
    })
    holder.append(ground)

    // Shared gradients (userSpaceOnUse, face-centre origin).
    const defsSvg = svgEl('svg', { width: 0, height: 0, 'aria-hidden': 'true' })
    defsSvg.style.position = 'absolute'
    const defs = svgEl('defs')
    const grad = (gid: string, x1: number, y1: number, x2: number, y2: number, stops: [number, string][]) => {
      const g = svgEl('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1, y1, x2, y2 })
      for (const [o, c] of stops) {
        const s = svgEl('stop', { offset: o })
        s.style.stopColor = c
        g.append(s)
      }
      defs.append(g)
    }
    // Light slabs in every world: a near-white face lit from the back, a thickness band shaded left → right.
    const front = mix('#ffffff', bg, 48)
    grad(`${id}-top`, 0, -b, 0, b, [[0, mix('#ffffff', bg, 82)], [1, front]])
    grad(`${id}-side`, -a, 0, a, 0, [[0, mix('#000000', front, 24)], [0.5, mix('#000000', front, 15)], [1, mix('#000000', front, 7)]])
    defsSvg.append(defs)
    holder.append(defsSvg)

    const face = roundedSquare(LS.radius)
    const M = `matrix(${(a / 2).toFixed(4)} ${(b / 2).toFixed(4)} ${(-a / 2).toFixed(4)} ${(b / 2).toFixed(4)} 0 0)`
    const xr = a * (1 - LS.radius + LS.radius / Math.SQRT2)
    const iconImgs = await Promise.all(p.layers.map((l, i) => Promise.all(l.icons.map((src, j) => loadImage(src, `layer-stack layers[${i}].icons[${j}]`)))))

    // Labels: one font size for every title (and every subtitle), the largest that fits the column.
    const badgeR = 27 * k
    const xLeaderR = cx - a - LS.leaderGap * a
    const xLeaderL = xLeaderR - LS.leaderW * W
    const textR = xLeaderL - (p.number ? 2 * badgeR + 0.45 * badgeR : 0.3 * badgeR)
    const textW = textR

    const slabs: Slab[] = []
    const wires: Wire[] = []
    const mkSlab = (i: number): Slab => {
      const L = p.layers[i]!
      const y = top0 + i * P
      const box = el('div', { position: 'absolute', left: '0px', top: '0px', width: px(W), height: px(H) }, 'layer-slab')
      box.dataset.i = String(i)
      const svg = svgEl('svg', { viewBox: `${(-a - pad).toFixed(2)} ${(-b - pad).toFixed(2)} ${(2 * a + 2 * pad).toFixed(2)} ${(2 * b + h + 2 * pad).toFixed(2)}`, 'aria-hidden': 'true' })
      Object.assign(svg.style, { position: 'absolute', left: px(cx - a - pad), top: px(y - b - pad), width: px(2 * a + 2 * pad), height: px(2 * b + h + 2 * pad), overflow: 'visible' })
      const g = svgEl('g')
      // Thickness band: the face shifted down by h, joined to the top face by the band between the extreme corners.
      const side = svgEl('g')
      side.append(svgEl('path', { d: face, transform: `translate(0 ${h.toFixed(3)}) ${M}`, fill: `url(#${id}-side)` }))
      side.append(svgEl('rect', { x: (-xr).toFixed(3), y: 0, width: (2 * xr).toFixed(3), height: h.toFixed(3), fill: `url(#${id}-side)` }))
      const outline = svgEl('path', { d: face, transform: `translate(0 ${h.toFixed(3)}) ${M}`, fill: 'none', 'vector-effect': 'non-scaling-stroke', 'stroke-width': Math.max(1, 1.5 * k).toFixed(2) })
      outline.style.stroke = mix(fg, bg, 22)
      const topFace = svgEl('path', { d: face, transform: M, fill: `url(#${id}-top)`, 'vector-effect': 'non-scaling-stroke', 'stroke-width': Math.max(1, 1.5 * k).toFixed(2) })
      topFace.style.stroke = mix(fg, bg, 20)
      // An inner highlight hairline along the face (premium edge), then the accent rim (active).
      const inner = svgEl('path', { d: face, transform: `${M} scale(0.94)`, fill: 'none', 'vector-effect': 'non-scaling-stroke', 'stroke-width': Math.max(1, 1.2 * k).toFixed(2) })
      inner.style.stroke = alpha('#ffffff', 0.35)
      const rim = svgEl('path', { d: face, transform: M, fill: 'none', 'vector-effect': 'non-scaling-stroke', 'stroke-width': (3 * k).toFixed(2) })
      rim.style.stroke = accent
      rim.style.opacity = '0'
      g.append(outline, side, topFace, inner, rim)
      svg.append(g)
      box.append(svg)
      // The dim veil (the background colour over the whole slab, logos included): solid slabs never turn see-through.
      const veil = svgEl('svg', { viewBox: svg.getAttribute('viewBox')!, 'aria-hidden': 'true' })
      Object.assign(veil.style, { position: 'absolute', left: svg.style.left, top: svg.style.top, width: svg.style.width, height: svg.style.height, overflow: 'visible', display: 'none' })
      const vg = svgEl('g')
      vg.style.fill = bg
      vg.append(svgEl('path', { d: face, transform: `translate(0 ${h.toFixed(3)}) ${M}` }), svgEl('rect', { x: (-xr).toFixed(3), y: 0, width: (2 * xr).toFixed(3), height: h.toFixed(3) }), svgEl('path', { d: face, transform: M }))
      veil.append(vg)

      // Logos standing on the face (upright, readable), each over a soft contact shadow.
      const s = LS.icon * a
      const icons = iconImgs[i]!.map((img, j) => {
        const dx = LS.iconSlots[L.icons.length]![j]! * a
        const fy = y + 0.2 * b
        const shadow = el('div', {
          position: 'absolute', left: px(cx + dx - s * 0.5), top: px(fy - s * 0.16), width: px(s), height: px(s * 0.32),
          background: 'radial-gradient(closest-side, rgba(20,16,10,0.28), rgba(20,16,10,0) 100%)',
        })
        Object.assign(img.style, { position: 'absolute', left: px(cx + dx - s / 2), top: px(fy - s * 0.96), width: px(s), height: px(s), objectFit: 'contain', transformOrigin: '50% 100%', display: 'block' })
        box.append(shadow, img)
        return { img, shadow }
      })
      box.append(veil)

      // Label (RTL, left of the slab): leader → badge → title / subtitle, the title's centre on the face centre.
      const label = el('div', { position: 'absolute', left: '0px', top: '0px', width: px(W), height: px(H), pointerEvents: 'none' }, 'layer-label')
      const leader = el('div', { position: 'absolute', left: px(xLeaderL), top: px(y - Math.max(1, 1.5 * k) / 2), width: px(xLeaderR - xLeaderL), height: px(Math.max(1, 1.5 * k)), background: mix(fg, bg, 45), transformOrigin: '100% 50%' })
      const dot = el('div', { position: 'absolute', left: px(xLeaderR - 4 * k), top: px(y - 4 * k), width: px(8 * k), height: px(8 * k), borderRadius: '50%', background: mix(fg, bg, 55) })
      leader.append(dot)
      dot.style.left = px(xLeaderR - xLeaderL - 4 * k)
      dot.style.top = px(-4 * k + Math.max(1, 1.5 * k) / 2)
      label.append(leader)
      let badge: HTMLElement | undefined
      if (p.number) {
        badge = el('div', {
          position: 'absolute', left: px(xLeaderL - 2 * badgeR), top: px(y - badgeR), width: px(2 * badgeR), height: px(2 * badgeR), borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', background: fg, color: bg, fontFamily: ctx.look.fontDisplay,
          fontWeight: String(FONT_WEIGHT.display), fontSize: px(30 * k), lineHeight: '1', transformOrigin: '50% 50%',
        }, 'layer-badge')
        lineUnit(badge, slabNumber(p, i))
        label.append(badge)
      }
      const title = el('div', { position: 'absolute', left: '0px', width: px(textW), textAlign: 'right', whiteSpace: 'pre', fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), lineHeight: '1.25', color: fg }, 'layer-title')
      title.dir = 'rtl'
      const tu = lineUnit(title, L.title)
      label.append(title)
      let subtitle: HTMLElement | undefined
      if (L.subtitle) {
        // The subtitle may wrap to two lines (whole words), right-aligned under the title.
        subtitle = el('div', { position: 'absolute', left: '0px', width: px(textW), textAlign: 'right', fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.bodyBold), lineHeight: '1.25', color: alpha(fg, 0.68) }, 'layer-subtitle')
        subtitle.dir = 'rtl'
        bidiWordUnits(subtitle, L.subtitle)
        label.append(subtitle)
      }
      ;(title as HTMLElement & { unit?: HTMLElement }).unit = tu
      return { box, svg, rim, veil, icons, label, leader, badge, title, subtitle, y }
    }

    // DOM order bottom → top, wires between: an upper slab hides the wire ends tucked under it.
    for (let i = n - 1; i >= 0; i--) {
      const s = mkSlab(i)
      slabs[i] = s
      holder.append(s.box)
      if (i > 0) {
        const y0 = s.y
        const y1 = top0 + (i - 1) * P
        const svg = svgEl('svg', { viewBox: `0 0 ${W.toFixed(2)} ${H.toFixed(2)}`, 'aria-hidden': 'true' })
        Object.assign(svg.style, { position: 'absolute', left: '0px', top: '0px', width: px(W), height: px(H), overflow: 'visible' })
        const lines: SVGLineElement[] = []
        const pulses: SVGGElement[] = []
        for (const wx of LS.wires) {
          const x = cx + wx * a
          const ln = svgEl('line', { x1: x.toFixed(2), x2: x.toFixed(2), y1: y0.toFixed(2), y2: y0.toFixed(2), 'stroke-width': Math.max(1.5, 2 * k).toFixed(2), 'stroke-linecap': 'round' })
          ln.style.stroke = mix(fg, bg, 30)
          const pg = svgEl('g')
          const glow = svgEl('rect', { x: (x - 7 * k).toFixed(2), y: (-16 * k).toFixed(2), width: (14 * k).toFixed(2), height: (32 * k).toFixed(2), rx: (7 * k).toFixed(2) })
          glow.style.fill = alpha(accent, 0.22)
          const core = svgEl('rect', { x: (x - 3.5 * k).toFixed(2), y: (-11 * k).toFixed(2), width: (7 * k).toFixed(2), height: (22 * k).toFixed(2), rx: (3.5 * k).toFixed(2) })
          core.style.fill = accent
          pg.append(glow, core)
          pg.style.display = 'none'
          svg.append(ln, pg)
          lines.push(ln)
          pulses.push(pg)
        }
        holder.append(svg)
        wires.push({ svg, lines, pulses, phase: LS.wires.map(() => ctx.rng()), lower: i, upper: i - 1, y0, y1 })
      }
    }
    for (const s of slabs) holder.append(s.label)

    // Fit the labels: titles share one size, subtitles another.
    type U = HTMLElement & { unit?: HTMLElement }
    const fitAll = (els: U[], from: number) => {
      if (els.length === 0) return 0
      const sizes = els.map((e) => fitFont(e, e.unit!, from * k, LS.minPx * k, textW))
      const fs = Math.min(...sizes)
      for (const e of els) {
        e.style.fontSize = `${fs}px`
        if (e.unit!.offsetWidth > textW + 0.5) {
          throw new Error(`النص «${e.unit!.textContent}» أعرض من عمود التسميات؛ اختصره أو كبّر width — layer-stack: "${e.unit!.textContent}" is wider than the label column (${Math.round(e.unit!.offsetWidth)} > ${Math.round(textW)} px)`)
        }
      }
      return fs
    }
    fitAll(slabs.map((s) => s.title as U), LS.titlePx)
    // Subtitles: one size, the largest at which each wraps to at most two lines.
    const subs = slabs.filter((s) => s.subtitle).map((s) => s.subtitle!)
    if (subs.length) {
      const lines = (e: HTMLElement) => Math.round(e.offsetHeight / (parseFloat(e.style.fontSize) * 1.25))
      let fs = Math.round(LS.subtitlePx * k)
      const set = (v: number) => subs.forEach((e) => (e.style.fontSize = `${v}px`))
      set(fs)
      while (fs > Math.round(LS.minPx * k) && subs.some((e) => lines(e) > 2)) set(--fs)
      const bad = subs.find((e) => lines(e) > 2)
      if (bad) {
        throw new Error(`النص «${bad.textContent}» لا يتسع في سطرين بجانب الطبقة؛ اختصره أو كبّر width — layer-stack: subtitle "${bad.textContent}" needs more than two lines in the label column (${Math.round(textW)} px)`)
      }
    }
    for (const s of slabs) {
      const th = s.title.offsetHeight
      s.title.style.top = px(s.y - th / 2)
      if (s.subtitle) s.subtitle.style.top = px(s.y + th / 2 - 0.12 * th)
    }

    // Place the figure's visible extent (the widest label to the slabs' right corner) on `at`, inside the safe area.
    const units = slabs.flatMap((s) => [s.title.firstElementChild as HTMLElement, ...(s.subtitle ? [...s.subtitle.querySelectorAll<HTMLElement>('[data-mba-text]')] : [])])
    const x0 = Math.max(0, frameRect(ctx.layer, ctx.size.w, units).x)
    const c = safePointPx(ctx, p.at)
    holder.style.left = px(clampIn(c.x - (x0 + W) / 2, ctx.safe.x - x0, ctx.safe.x + ctx.safe.w - W))
    holder.style.top = px(clampIn(c.y - H / 2, ctx.safe.y, ctx.safe.y + ctx.safe.h - H))

    const active = p.active.map((x) => ({ at: x.at, key: x.index }))
    const landed = (i: number) => p.layers[i]!.at
    return {
      update(localT) {
        const t = localT
        const firstStart = Math.min(...p.layers.map((_, i) => slabSlideStart(p, i)))
        show(ground, t >= firstStart)
        ground.style.opacity = opacityOf(easeOutCubic(seg(t, firstStart, firstStart + LS.slideSec)))

        const offs: number[] = []
        slabs.forEach((s, i) => {
          const at = landed(i)
          const t0 = at - LS.slideSec
          const visible = t >= t0
          show(s.box, visible)
          if (!visible) {
            show(s.label, false)
            offs[i] = 0
            return
          }
          const x = seg(t, t0, at)
          const drop = (1 - settle(x)) * LS.drop * P
          const { hl, dim } = emphasisAt(active, i, t, LS.activeSec)
          const off = drop - liftPx * hl
          offs[i] = off
          s.box.style.transform = Math.abs(off) < 1e-4 ? '' : `translateY(${px(off)})`
          s.box.style.opacity = opacityOf(easeOutCubic(seg(t, t0, t0 + LS.slideSec * 0.6)))
          show(s.veil, dim > 0.001)
          if (dim > 0.001) s.veil.style.opacity = ((1 - LS.dim) * dim).toFixed(4)
          s.rim.style.opacity = hl.toFixed(4)
          s.svg.style.filter = hl > 0.001 ? `drop-shadow(0 0 ${px(16 * k)} ${alpha(accent, 0.38 * hl)}) drop-shadow(0 ${px(14 * k)} ${px(20 * k)} rgba(20,16,10,${(0.14 * hl).toFixed(3)}))` : ''

          s.icons.forEach((ic, j) => {
            const q = seg(t, at + LS.iconPop[0] + j * 0.06, at + LS.iconPop[1] + j * 0.06)
            show(ic.img, q > 0)
            show(ic.shadow, q > 0)
            if (q <= 0) return
            const sc = 0.6 + 0.4 * settle(q)
            ic.img.style.transform = sc === 1 ? '' : `scale(${sc.toFixed(5)})`
            ic.img.style.opacity = opacityOf(easeOutCubic(Math.min(1, q * 1.6)))
            ic.shadow.style.opacity = opacityOf(easeOutCubic(q))
          })

          // Label beats after landing; it rides the slab's lift.
          const lt = t - at
          show(s.label, lt >= LS.leader[0])
          if (lt < LS.leader[0]) return
          s.label.style.transform = Math.abs(off) < 1e-4 ? '' : `translateY(${px(off)})`
          s.label.style.opacity = opacityOf(1 - (1 - LS.dim) * dim)
          const ld = easeOutCubic(seg(lt, LS.leader[0], LS.leader[1]))
          s.leader.style.transform = ld >= 1 ? '' : `scaleX(${ld.toFixed(5)})`
          if (s.badge) {
            const bq = seg(lt, LS.badge[0], LS.badge[1])
            show(s.badge, bq > 0)
            const bs = 0.5 + 0.5 * settle(bq)
            s.badge.style.transform = bs === 1 ? '' : `scale(${bs.toFixed(5)})`
            s.badge.style.opacity = opacityOf(easeOutCubic(Math.min(1, bq * 2)))
            s.badge.style.background = hl > 0.001 ? mix(accent, fg, hl * 100) : fg
          }
          const tw = easeOutCubic(seg(lt, LS.title[0], LS.title[1]))
          show(s.title, tw > 0)
          s.title.style.clipPath = tw >= 1 ? '' : `inset(-20% 0% -20% ${(100 * (1 - tw)).toFixed(3)}%)`
          if (s.subtitle) {
            const sf = easeOutCubic(seg(lt, LS.subtitle[0], LS.subtitle[1]))
            show(s.subtitle, sf > 0)
            s.subtitle.style.opacity = opacityOf(sf)
            s.subtitle.style.transform = sf >= 1 ? '' : `translateY(${px((1 - sf) * 10 * k)})`
          }
        })

        // Wires: they grow up once both slabs are down; pulses climb from `flowAt`.
        for (const w of wires) {
          const ready = Math.max(landed(w.lower), landed(w.upper))
          const g = easeOutCubic(seg(t, ready, ready + 0.35))
          show(w.svg, g > 0)
          if (g <= 0) continue
          const yTop = w.y0 + (w.y1 - w.y0) * g
          w.lines.forEach((ln, j) => {
            ln.setAttribute('y2', yTop.toFixed(2))
            const pg = w.pulses[j]!
            if (p.flowAt === undefined || t < Math.max(p.flowAt, ready + 0.35)) {
              show(pg, false)
              return
            }
            const f0 = Math.max(p.flowAt, ready + 0.35)
            const u = (t - f0) / LS.pulseSec + w.phase[j]!
            const q = u - Math.floor(u)
            const yy = w.y0 + (w.y1 - w.y0) * q
            const on = easeOutCubic(seg(t, f0, f0 + 0.4))
            const win = Math.min(1, q / 0.12) * Math.min(1, (1 - q) / 0.25)
            show(pg, true)
            pg.setAttribute('transform', `translate(0 ${(yy + (offs[w.lower] ?? 0) * (1 - q) + (offs[w.upper] ?? 0) * q).toFixed(2)})`)
            pg.style.opacity = (on * win).toFixed(4)
          })
        }
      },
    }
  },
}
