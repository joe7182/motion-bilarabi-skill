import { easeOutCubic, seg } from '../../core/ease'
import { geoPatternParams, PACK_FX, paperShapesParams, type GeoPatternParams, type PaperShapesParams } from '../../core/params/pack-fx'
import { spring } from '../../core/params/ui-morph'
import type { Primitive } from './registry'

const TAU = Math.PI * 2

/** A look colour (a CSS variable on the layer) as a hex string. */
function resolved(layer: HTMLElement, v: string, fallback: string): string {
  return v.startsWith('var(') ? getComputedStyle(layer).getPropertyValue(v.slice(4, -1)).trim() || fallback : v
}
const rgba = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1]!, 16) : 0xd7ae55
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** A closed polygon drawn up to share `k` of its length (the line draws itself). */
function drawn(g: CanvasRenderingContext2D, pts: [number, number][], k: number): void {
  if (!(k > 0)) return
  let total = 0
  for (let i = 0; i < pts.length; i++) total += Math.hypot(pts[(i + 1) % pts.length]![0] - pts[i]![0], pts[(i + 1) % pts.length]![1] - pts[i]![1])
  g.setLineDash(k >= 1 ? [] : [total * k, total])
  g.beginPath()
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
  g.closePath()
  g.stroke()
}
const square = (cx: number, cy: number, r: number, rot: number): [number, number][] => [0, 1, 2, 3].map((i) => [cx + r * Math.cos(rot + (i * TAU) / 4), cy + r * Math.sin(rot + (i * TAU) / 4)])

/**
 * geo-pattern: a tiling of eight-point stars (two squares), with a small diamond at every tile
 * corner and short ties between neighbours. Each tile draws itself when the wave from `origin`
 * reaches it; afterwards the inner square of every star breathes (turns a few degrees, slowly).
 */
export const geoPattern: Primitive<GeoPatternParams> = {
  id: 'geo-pattern',
  params: geoPatternParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    Object.assign(cv.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px` })
    ctx.layer.append(cv)
    const g = cv.getContext('2d')!
    const colour = resolved(ctx.layer, ctx.look.vars[p.colour], '#d7ae55')
    const c = p.cell * w
    const cols = Math.ceil(w / c) + 2
    const rows = Math.ceil(h / c) + 2
    const x0 = (w - cols * c) / 2 + c / 2
    const y0 = (h - rows * c) / 2 + c / 2
    const ox = p.origin.x * w
    const oy = p.origin.y * h
    const far = Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy))
    const tile = 0.55 // seconds one tile takes to draw
    return {
      update(localT) {
        const t = Math.max(0, localT)
        g.clearRect(0, 0, w, h)
        g.lineWidth = Math.max(1.2, w / 720)
        g.lineJoin = 'round'
        g.strokeStyle = rgba(colour, p.alpha)
        const breathe = Math.sin(t * 0.5) * 0.05
        for (let r = 0; r < rows; r++) {
          for (let q = 0; q < cols; q++) {
            const cx = x0 + q * c
            const cy = y0 + r * c
            const start = (Math.hypot(cx - ox, cy - oy) / far) * p.draw
            const k = easeOutCubic(seg(t, start, start + tile))
            if (!(k > 0)) continue
            const R = c * 0.4
            drawn(g, square(cx, cy, R, Math.PI / 4), k)
            drawn(g, square(cx, cy, R, breathe * seg(t, start + tile, start + tile + 1)), seg(k, 0.25, 1))
            // the diamond at the tile's corner and the ties to the next tiles
            const k2 = seg(k, 0.5, 1)
            if (k2 > 0) {
              drawn(g, square(cx + c / 2, cy + c / 2, c * 0.1, 0), k2)
              g.setLineDash([])
              g.beginPath()
              g.moveTo(cx + R, cy); g.lineTo(cx + R + (c - 2 * R) * k2, cy)
              g.moveTo(cx, cy + R); g.lineTo(cx, cy + R + (c - 2 * R) * k2)
              g.stroke()
            }
          }
        }
        g.setLineDash([])
        // the calm band for text: the pattern fades out toward its middle
        if (p.calm) {
          const cy = p.calm.y * h
          const half = (p.calm.h * h) / 2
          const gr = g.createLinearGradient(0, cy - half, 0, cy + half)
          gr.addColorStop(0, 'rgba(0,0,0,0)')
          gr.addColorStop(0.28, 'rgba(0,0,0,0.92)')
          gr.addColorStop(0.72, 'rgba(0,0,0,0.92)')
          gr.addColorStop(1, 'rgba(0,0,0,0)')
          g.globalCompositeOperation = 'destination-out'
          g.fillStyle = gr
          g.fillRect(0, cy - half, w, 2 * half)
          g.globalCompositeOperation = 'source-over'
        }
      },
    }
  },
}

/** The places a shape can take: centres outside the text area (x of the width, y of the height), top band then bottom band. */
const PLACES: [number, number][] = [[0.06, 0.015], [0.93, 0.05], [0.16, 0.975], [0.9, 0.955], [0.55, -0.02], [0.5, 1.01]]
/** The shapes: border radii (a circle, an arch, a blob, a rounded square, a pill, a small circle), size (of the width), turn. */
const SHAPES = [
  { radius: '50%', size: 0.5, turn: 0 },
  { radius: '50% 50% 8% 8% / 62% 62% 8% 8%', size: 0.4, turn: 180 },
  { radius: '44% 56% 60% 40% / 50% 44% 56% 50%', size: 0.5, turn: 0 },
  { radius: '14%', size: 0.3, turn: 12 },
  { radius: '50%', size: 0.2, turn: 0 },
  { radius: '50% 50% 8% 8% / 62% 62% 8% 8%', size: 0.34, turn: 0 },
]

/**
 * paper-shapes: six cut-paper shapes with a soft shadow, each at one of six places around the text
 * area. They slide in from beyond the nearest edge and settle on a spring; at every shift each shape
 * moves on to the next place. With `steps`, their motion is held on twos.
 */
export const paperShapes: Primitive<PaperShapesParams> = {
  id: 'paper-shapes',
  params: paperShapesParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const root = document.createElement('div')
    root.dataset.mbaPart = 'paper-shapes'
    Object.assign(root.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' })
    ctx.layer.append(root)
    const els = SHAPES.map((sh, i) => {
      const el = document.createElement('div')
      const size = sh.size * p.scale * w
      Object.assign(el.style, {
        position: 'absolute', left: `${(-size / 2).toFixed(1)}px`, top: `${(-size / 2).toFixed(1)}px`, width: `${size.toFixed(1)}px`, height: `${size.toFixed(1)}px`,
        borderRadius: sh.radius, background: p.colours[i % p.colours.length]!, boxShadow: `0 ${(w * 0.012).toFixed(1)}px ${(w * 0.035).toFixed(1)}px rgba(40,30,15,0.22)`,
      })
      root.append(el)
      return el
    })
    const place = (i: number, layout: number) => PLACES[(i + layout) % PLACES.length]!
    /** Where a shape waits before it enters: beyond the edge nearest its first place. */
    const outside = ([x, y]: [number, number]): [number, number] => [x, y < 0.5 ? y - 0.45 : y + 0.45]
    const shifts = [...p.shifts].sort((a, b) => a - b)
    return {
      update(localT) {
        const raw = Math.max(0, localT)
        const t = p.steps ? Math.floor(raw * p.steps + 1e-6) / p.steps : raw
        els.forEach((el, i) => {
          const sh = SHAPES[i]!
          const delay = i * PACK_FX.stagger
          // position: enter, then one move per shift
          let [x, y] = outside(place(i, 0))
          const enter = spring((t - p.at - delay) / PACK_FX.move, 0.7, 9)
          const to0 = place(i, 0)
          x += (to0[0] - x) * enter
          y += (to0[1] - y) * enter
          shifts.forEach((at, n) => {
            const k = spring((t - at - delay) / PACK_FX.move, 0.7, 9)
            if (!(k > 0)) return
            const a = place(i, n)
            const b = place(i, n + 1)
            x += (b[0] - a[0]) * k
            y += (b[1] - a[1]) * k
          })
          const wobble = Math.sin(t * 0.6 + i * 1.7) * 1.5
          el.style.transform = `translate(${(x * w).toFixed(1)}px, ${(y * h).toFixed(1)}px) rotate(${(sh.turn + wobble).toFixed(2)}deg)`
        })
      },
    }
  },
}

export { geoPatternParams, paperShapesParams }
