import { HERO, heroAt, heroParams, type HeroParams } from '../../core/params/hero'
import type { BuildCtx, Primitive } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** What a hero scene exports (`Built.exports`): its path in frame px, for a backdrop's `react.hero`. */
export interface HeroExports {
  kind: 'hero'
  points: { x: number; y: number }[]
  /** The scene's local length (duration + preroll): where `loop` puts the return point. */
  end: number
}

/** Trail: this many fading pieces, each sampled every `TRAIL_STEP` s. */
const TRAIL_PIECES = 6
const TRAIL_STEP = 1 / 60

/**
 * The centre (frame px) of an element's glyph boxes: the union of its text's Range client rects
 * (what the audit measures), or its own box when it has no text. Measured relative to `layer`, so
 * it is in frame coordinates (at build no camera transform is set).
 */
function glyphCentre(layer: HTMLElement, frameW: number, el: Element): { x: number; y: number } {
  const L = layer.getBoundingClientRect()
  const k = L.width > 0 ? L.width / frameW : 1
  const range = document.createRange()
  range.selectNodeContents(el)
  let rs = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
  range.detach()
  if (rs.length === 0) rs = [el.getBoundingClientRect()]
  const x0 = Math.min(...rs.map((r) => r.left))
  const x1 = Math.max(...rs.map((r) => r.right))
  const y0 = Math.min(...rs.map((r) => r.top))
  const y1 = Math.max(...rs.map((r) => r.bottom))
  return { x: ((x0 + x1) / 2 - L.left) / k, y: ((y0 + y1) / 2 - L.top) / k }
}

/** Every path point in frame px: `x`, `y` in the safe area, or a keyed element's glyph-box centre (`ctx.keyedAny`). */
function resolvePath(ctx: BuildCtx, p: HeroParams): { x: number; y: number }[] {
  return p.path.map((pt, i) =>
    pt.target !== undefined
      ? glyphCentre(ctx.layer, ctx.size.w, ctx.keyedAny(pt.target, `path[${i}].target`))
      : { x: ctx.safe.x + pt.x! * ctx.safe.w, y: ctx.safe.y + pt.y! * ctx.safe.h },
  )
}

const f = (n: number) => n.toFixed(2)

/**
 * Hero: one recurring element (dot, ball or square, in the accent or fg colour) that travels its
 * path on a closed-form spring and arrives on each point at its `at` (`heroAt`); a `target` point
 * lands on the glyph-box centre of a keyed element of an earlier overlapping scene (a word as it is
 * spoken), measured once at build. Optional squash on arrival, a fading trail of the last 0.3 s,
 * and a loop back to the start at the scene end. Pure in `localT`.
 */
export const hero: Primitive<HeroParams> = {
  id: 'hero',
  params: heroParams,
  build(ctx, p) {
    const points = resolvePath(ctx, p)
    const end = ctx.duration
    const d = p.size * ctx.size.w
    const colour = p.color === 'fg' ? ctx.look.vars.fg : ctx.look.vars.accent

    let trail: SVGPolylineElement[] = []
    if (p.trail) {
      const svg = document.createElementNS(SVG_NS, 'svg')
      svg.setAttribute('viewBox', `0 0 ${ctx.size.w} ${ctx.size.h}`)
      svg.setAttribute('width', String(ctx.size.w))
      svg.setAttribute('height', String(ctx.size.h))
      svg.dataset.mbaPart = 'hero-trail'
      Object.assign(svg.style, { position: 'absolute', inset: '0', overflow: 'visible', pointerEvents: 'none' })
      trail = Array.from({ length: TRAIL_PIECES }, (_, k) => {
        const line = document.createElementNS(SVG_NS, 'polyline')
        line.setAttribute('fill', 'none')
        line.setAttribute('stroke-width', f(d * 0.35))
        line.setAttribute('stroke-linecap', 'round')
        line.setAttribute('stroke-linejoin', 'round')
        // Older pieces fade out.
        line.setAttribute('stroke-opacity', f((0.5 * (k + 1)) / TRAIL_PIECES))
        line.style.stroke = colour
        svg.append(line)
        return line
      })
      ctx.layer.append(svg)
    }

    const el = document.createElement('div')
    el.dataset.mbaPart = 'hero'
    if (p.key) el.dataset.mbaKey = p.key
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${d}px`,
      height: `${d}px`,
      borderRadius: p.shape === 'square' ? '18%' : '50%',
      background:
        p.shape === 'ball'
          ? `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${colour} 55%, white), ${colour} 55%, color-mix(in srgb, ${colour} 70%, black))`
          : colour,
      transformOrigin: '50% 50%',
    })
    ctx.layer.append(el)

    const exports: HeroExports = { kind: 'hero', points, end }
    return {
      exports,
      update(localT) {
        const h = heroAt(p, points, localT, end)
        el.style.transform = `translate(${f(h.x - d / 2)}px, ${f(h.y - d / 2)}px) scale(${h.sx.toFixed(4)}, ${h.sy.toFixed(4)})`
        if (trail.length === 0) return
        // The path of the last HERO.trailSec, oldest piece first; each piece shares its end point with the next.
        const n = Math.round(HERO.trailSec / TRAIL_STEP)
        const per = Math.ceil(n / TRAIL_PIECES)
        const sample = (j: number) => {
          const q = heroAt(p, points, localT - (n - j) * TRAIL_STEP, end)
          return `${f(q.x)},${f(q.y)}`
        }
        trail.forEach((line, k) => {
          const a = k * per
          const b = Math.min(n, (k + 1) * per)
          const pts: string[] = []
          for (let j = a; j <= b; j++) pts.push(sample(j))
          line.setAttribute('points', pts.join(' '))
        })
      },
    }
  },
}
