import { seg } from '../../core/ease'
import { DRIFT_PER_SEC, driftCss, driftGrow, translateDrift } from '../../core/params/drift'
import { HIGHLIGHT, highlightParams, UNDERLINE, type HighlightParams } from '../../core/params/highlight'
import { power2Out } from '../../core/params/line-art'
import { frameRect } from '../drift-fit'
import { drawnStrokes, safePointPx, strokeSvg } from './line-art'
import type { Primitive } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Smallest half-size of a mark (× frame width) when its target hugs a safe edge (fix round 3). */
const HIGHLIGHT_MIN_MARK = 0.05

/** A region in frame px; for text, also its font size (px). */
interface Region {
  x: number
  y: number
  w: number
  h: number
  px?: number
}

/**
 * The glyph ink box of `el` in frame px: horizontally the text's advance boxes (each text node's
 * Range rect, not the element box), vertically the font's actual ink above and below the
 * baseline (canvas `measureText`), so a mark hugs the drawn letters; `px` is the font size, the
 * unit of an underline's offset. Undefined without text.
 */
export function inkRect(layer: HTMLElement, frameW: number, el: Element): Region | undefined {
  const L = layer.getBoundingClientRect()
  const k = L.width > 0 ? L.width / frameW : 1
  const canvas = document.createElement('canvas').getContext('2d')
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let px = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? ''
    if (!text.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    const r = range.getBoundingClientRect()
    if (!(r.width > 0)) continue
    const cs = getComputedStyle(n.parentElement!)
    px = Math.max(px, parseFloat(cs.fontSize) / k)
    let top = r.top
    let bottom = r.bottom
    if (canvas) {
      canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const m = canvas.measureText(text)
      // Content-area top + font ascent = baseline (client px; the rect is already scaled by k).
      const base = r.top + m.fontBoundingBoxAscent * (r.height / (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent || 1))
      const s = r.height / (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent || 1)
      top = base - m.actualBoundingBoxAscent * s
      bottom = base + m.actualBoundingBoxDescent * s
    }
    x0 = Math.min(x0, r.left)
    x1 = Math.max(x1, r.right)
    y0 = Math.min(y0, top)
    y1 = Math.max(y1, bottom)
  }
  if (x0 === Infinity) return undefined
  return { x: (x0 - L.left) / k, y: (y0 - L.top) / k, w: (x1 - x0) / k, h: (y1 - y0) / k, px }
}

type Pt = [number, number]

/** A smooth open path through `pts` (Catmull-Rom as cubic Béziers). */
function smoothPath(pts: Pt[]): string {
  const f = (n: number) => n.toFixed(1)
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`
  }
  return d
}

/**
 * A hand-drawn mark around a region: a wobbly ellipse (`circle`), radial burst lines (`burst`), an
 * underline (`underline`, UNDERLINE.below em under the ink box) or a line through the middle
 * (`strike`), both sweeping right → left, self-drawing over `drawIn` (power2.out). The
 * region is a `target` element or the `word` (transcript index) of an overlapping earlier scene
 * (measured once at build, at rest: no update has run yet, so its box is its layout box), a `box`
 * in safe-area fractions, or `at` +
 * `size`. The wobble comes from the scene's seeded rng. It keeps the shared slow drift: scale only
 * around a target's centre (so the mark keeps enclosing it), scale + seeded translate otherwise.
 */
export const highlight: Primitive<HighlightParams> = {
  id: 'highlight',
  params: highlightParams,
  build(ctx, p) {
    const move = translateDrift(ctx.rng, ctx.size.w)
    let region: Region
    // A word or keyed element of an earlier scene: the mark follows it, so it drifts with it.
    const onElement = p.target !== undefined || p.word !== undefined
    if (onElement) {
      const el = p.word !== undefined ? ctx.keyedWord(p.word, 'word') : ctx.keyed(p.target!, 'target')
      // The drawn ink, not the container: a width-locked counter or a laid-out block is far wider
      // than its glyphs (fix round 3).
      region = inkRect(ctx.layer, ctx.size.w, el) ?? frameRect(ctx.layer, ctx.size.w, [el])
    } else if (p.box) {
      region = { x: ctx.safe.x + p.box.x * ctx.safe.w, y: ctx.safe.y + p.box.y * ctx.safe.h, w: p.box.w * ctx.safe.w, h: p.box.h * ctx.safe.h }
    } else {
      const c = safePointPx(ctx, p.at)
      const w = p.size * ctx.safe.w
      region = { x: c.x - w / 2, y: c.y - w / 4, w, h: w / 2 }
    }
    const pad = HIGHLIGHT.pad * ctx.size.w
    const sw = Math.max(6, Math.round(0.012 * ctx.size.w))
    const grow = driftGrow(ctx.duration)
    // Fix round 3: a target centred on or past a safe edge would leave no room (a collapsed mark):
    // the mark's centre is moved inward until it has at least MIN_MARK of room on each side.
    const minRoom = HIGHLIGHT_MIN_MARK * ctx.size.w * grow + sw
    const inward = (c: number, lo: number, hi: number) => (hi - lo < 2 * minRoom ? (lo + hi) / 2 : Math.min(Math.max(c, lo + minRoom), hi - minRoom))
    const cx = inward(region.x + region.w / 2, ctx.safe.x, ctx.safe.x + ctx.safe.w)
    const cy = inward(region.y + region.h / 2, ctx.safe.y, ctx.safe.y + ctx.safe.h)
    // The smallest ellipse of the region's aspect that holds its corners, plus the pad.
    // Task 10 fix round 2: a circle or burst never leaves the safe area. Its outer reach (wobble or
    // ray tip, half the stroke, the scale drift at the scene end) is clamped to the room between
    // the region's centre and each safe edge; a mark around something wider than the safe area
    // shrinks into it instead of running off the frame.
    const reach = (p.kind === 'burst' ? HIGHLIGHT.rayTo * 1.12 : 1 + HIGHLIGHT.wobble) * grow
    const roomX = Math.max(0, Math.min(cx - ctx.safe.x, ctx.safe.x + ctx.safe.w - cx) - sw / 2) / reach
    const roomY = Math.max(0, Math.min(cy - ctx.safe.y, ctx.safe.y + ctx.safe.h - cy) - sw / 2) / reach
    const rx = Math.min(region.w / Math.SQRT2 + pad, roomX)
    const ry = Math.min(region.h / Math.SQRT2 + pad, roomY)
    const rnd = () => ctx.rng()

    const paths: string[] = []
    if (p.kind === 'circle') {
      // Starts at the upper right and runs counter-clockwise past its start (a hand overshoots).
      const n = Math.round(HIGHLIGHT.points * HIGHLIGHT.turns)
      const a0 = -Math.PI / 3
      const pts: Pt[] = []
      for (let k = 0; k <= n; k++) {
        const a = a0 - (k / n) * HIGHLIGHT.turns * 2 * Math.PI
        const r = 1 + HIGHLIGHT.wobble * rnd()
        pts.push([cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)])
      }
      paths.push(smoothPath(pts))
    } else if (p.kind === 'burst') {
      for (let k = 0; k < HIGHLIGHT.rays; k++) {
        const a = -Math.PI / 2 - (k / HIGHLIGHT.rays) * 2 * Math.PI + (rnd() - 0.5) * 0.15
        const r0 = HIGHLIGHT.rayFrom * (1 + 0.04 * rnd())
        const r1 = HIGHLIGHT.rayTo * (1 + 0.12 * rnd())
        const at = (r: number): Pt => [cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)]
        const [x0, y0] = at(r0)
        const [x1, y1] = at(r1)
        paths.push(`M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`)
      }
    } else {
      // From the right end to the left: drawing the path sweeps right → left. Fix round 3: the
      // ink width plus a small pad, clamped inside the safe area (with the scale drift about the
      // centre). An underline lies UNDERLINE.below em under the ink box (its stroke clear of the
      // letters); a strike runs through the ink box's vertical middle.
      const half = Math.min(region.w / 2 + pad * 0.3, (Math.min(cx - ctx.safe.x, ctx.safe.x + ctx.safe.w - cx) - sw / 2) / grow)
      const x0 = cx + Math.max(half, HIGHLIGHT_MIN_MARK * ctx.size.w)
      const x1 = cx - Math.max(half, HIGHLIGHT_MIN_MARK * ctx.size.w)
      const wanted =
        p.kind === 'strike'
          ? region.y + region.h / 2
          : region.px !== undefined
            ? region.y + region.h + UNDERLINE.below * region.px + sw / 2 + pad * 0.15
            : region.y + region.h + pad * 0.4
      const y = Math.min(wanted, ctx.safe.y + ctx.safe.h - sw / 2 - pad * 0.15)
      const pts: Pt[] = []
      // A strike stays level on the word's middle: it wavers far less than an underline.
      const wave = p.kind === 'strike' ? 0.04 : 0.3
      for (let k = 0; k <= 4; k++) pts.push([x0 + ((x1 - x0) * k) / 4, y + (rnd() - 0.5) * pad * wave])
      paths.push(smoothPath(pts))
    }

    const root = document.createElement('div')
    root.dataset.mbaPart = 'highlight'
    if (p.key) root.dataset.mbaKey = p.key
    ctx.layer.append(root)
    const svg = strokeSvg({ w: 1, h: 1 }, p.color ?? ctx.look.vars.accent, sw)
    const els = paths.map((d) => {
      const el = document.createElementNS(SVG_NS, 'path')
      el.setAttribute('d', d)
      svg.append(el)
      return el
    })
    root.append(svg)
    // The root is the drawn region (stroke included), so a morph key measures the mark itself.
    const boxes = els.map((el) => el.getBBox())
    const bx = Math.min(...boxes.map((b) => b.x)) - sw
    const by = Math.min(...boxes.map((b) => b.y)) - sw
    const bw = Math.max(...boxes.map((b) => b.x + b.width)) + sw - bx
    const bh = Math.max(...boxes.map((b) => b.y + b.height)) + sw - by
    svg.setAttribute('viewBox', `${bx.toFixed(1)} ${by.toFixed(1)} ${bw.toFixed(1)} ${bh.toFixed(1)}`)
    Object.assign(root.style, {
      position: 'absolute',
      left: `${bx.toFixed(1)}px`,
      top: `${by.toFixed(1)}px`,
      width: `${bw.toFixed(1)}px`,
      height: `${bh.toFixed(1)}px`,
      // Drift about the region's centre.
      transformOrigin: `${(cx - bx).toFixed(1)}px ${(cy - by).toFixed(1)}px`,
    })
    const strokes = drawnStrokes(els)
    const n = strokes.length
    const stagger = n > 1 ? (p.drawIn * HIGHLIGHT.rayStagger) / (n - 1) : 0
    const each = n > 1 ? p.drawIn * (1 - HIGHLIGHT.rayStagger) : p.drawIn

    return {
      update(localT) {
        const t = Math.min(Math.max(localT, 0), ctx.duration)
        strokes.forEach((s, i) => s.set(power2Out(seg(t, i * stagger, i * stagger + each))))
        root.style.transform = driftCss(t, DRIFT_PER_SEC, onElement ? undefined : move)
      },
    }
  },
}
