import { morphParams, type MorphParams } from '../../core/params/transitions'
import { StoryboardError } from '../../core/storyboard'
import { clamp01, easeInOutCubic, seg } from '../../core/ease'
import type { Transition } from './registry'
import { n } from './fmt'

/** Attribute that hides a keyed original while the clone flies (a stylesheet rule, see `ensureStyle`). */
const HIDDEN_ATTR = 'data-mba-morph-hidden'

/** The two contents cross-fade inside the clone over this part of the window (centred on the cut). */
export const MORPH_CROSSFADE = [0.3, 0.7] as const

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
type Rgba = [number, number, number, number]

/** What is measured of a keyed element at rest. */
interface Snap {
  /** Drawn box in frame px (transforms included: drift, entrance). */
  rect: Rect
  /** Layout box size (untransformed). */
  layout: { w: number; h: number }
  /** Top-left border radius in frame px. */
  radius: number
  fill: Rgba
  /** A deep copy taken at that pose. */
  copy: HTMLElement
}

/**
 * `opacity: 0 !important` beats every inline opacity a primitive writes, and opacity (unlike
 * visibility) cannot be undone by a descendant. One rule for the whole page, added once.
 */
function ensureStyle(): void {
  if (document.getElementById('mba-morph-style')) return
  const st = document.createElement('style')
  st.id = 'mba-morph-style'
  st.textContent = `[${HIDDEN_ATTR}] { opacity: 0 !important; }`
  document.head.append(st)
}

function parseRgba(css: string): Rgba {
  const m = css.match(/rgba?\(([^)]+)\)/)
  if (!m) return [0, 0, 0, 0]
  const v = m[1]!.split(/[\s,/]+/).filter(Boolean).map(parseFloat)
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1]
}

const lerp = (a: number, b: number, e: number) => a + (b - a) * e
/** Scale factors need more precision than `n` (a 3-decimal scale of a 900 px box is off by 0.45 px). */
const n5 = (x: number) => String(Number(x.toFixed(5)))

/**
 * Morph / match cut. The element with `data-mba-key = key` in the outgoing scene flies into the one
 * with the same key in the incoming scene.
 *
 * - Both scenes stay shown over the whole window (`bothVisible`): the outgoing layer fades 1 → 0
 *   over p 0 → 0.5, the incoming 0 → 1 over p 0.5 → 1.
 * - At build, each keyed element is measured once, at rest at its window boundary: the outgoing one
 *   posed at the window start, the incoming one at the window end (`ctx.pose`). Its drawn box
 *   includes the primitive's drift and entrance transforms at that instant, so the clone starts
 *   exactly where the outgoing original was last drawn and lands exactly where the incoming one is
 *   drawn on the first frame after the window: no jump at either edge, whatever the drift. Measured
 *   at build because after build a layer outside its window is `display: none` (zero boxes).
 * - Over the window a clone in the overlay interpolates the box (FLIP: translate + scale from the
 *   outgoing box), the border radius and the fill (background) colour, eased by power3.inOut
 *   (`easeInOutCubic`). It holds copies of both elements taken at those poses, cross-faded over
 *   `MORPH_CROSSFADE`. Both originals are hidden while it flies (p < 1); at p = 1 the clone is gone
 *   and the incoming original shows.
 * - `hit` only marks a hard cut for the sound planner (`cutCue`).
 * A key missing from either scene throws at build (a page error: the render fails).
 */
export const morph: Transition<MorphParams> = {
  id: 'morph',
  params: morphParams,
  async build(ctx, p) {
    const find = (layer: HTMLElement, sceneId: string): HTMLElement => {
      const el = layer.querySelector<HTMLElement>(`[data-mba-key="${CSS.escape(p.key)}"]`)
      if (!el) {
        throw new StoryboardError(
          `transitions[${ctx.index}].params.key`,
          `لم يُعثر على العنصر ذي المفتاح "${p.key}" في المشهد "${sceneId}" — element with key "${p.key}" not found in scene "${sceneId}"`,
        )
      }
      return el
    }
    const outEl = find(ctx.out, ctx.outId)
    const inEl = find(ctx.in, ctx.inId)
    ensureStyle()

    // The overlay covers the frame exactly (inset 0), so its box is the frame's, scaled or not.
    const snap = (el: HTMLElement): Snap => {
      const f = ctx.overlay.getBoundingClientRect()
      const k = f.width > 0 ? ctx.size.w / f.width : 1
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const rect = { x: (r.left - f.left) * k, y: (r.top - f.top) * k, w: r.width * k, h: r.height * k }
      const layout = { w: el.offsetWidth || rect.w, h: el.offsetHeight || rect.h }
      const rad = cs.borderTopLeftRadius.trim()
      const radPx = rad.endsWith('%') ? (parseFloat(rad) / 100) * layout.w : parseFloat(rad) || 0
      const copy = el.cloneNode(true) as HTMLElement
      copy.removeAttribute('data-mba-key')
      copy.removeAttribute('id')
      for (const d of copy.querySelectorAll('[id], [data-mba-key]')) {
        d.removeAttribute('id')
        d.removeAttribute('data-mba-key')
      }
      return { rect, layout, radius: radPx * (rect.w / layout.w), fill: parseRgba(cs.backgroundColor), copy }
    }
    await ctx.pose('out')
    const A = snap(outEl)
    await ctx.pose('in')
    const B = snap(inEl)
    if (!(A.rect.w > 0 && A.rect.h > 0 && B.rect.w > 0 && B.rect.h > 0)) {
      throw new StoryboardError(
        `transitions[${ctx.index}].params.key`,
        `العنصر ذو المفتاح "${p.key}" بلا أبعاد عند حدود الانتقال — the element with key "${p.key}" has an empty box at the window edge`,
      )
    }

    // The clone: a box at A's drawn rect, moved by transform only. Each copy is laid out at its own
    // layout size and scaled so it fills A's rect; the clone's FLIP scale then takes it to B's.
    const clone = document.createElement('div')
    clone.dataset.mbaMorphClone = p.key
    clone.dir = ctx.dir
    Object.assign(clone.style, {
      position: 'absolute',
      left: `${n(A.rect.x)}px`,
      top: `${n(A.rect.y)}px`,
      width: `${n(A.rect.w)}px`,
      height: `${n(A.rect.h)}px`,
      transformOrigin: '0 0',
      overflow: 'visible',
    })
    const place = (s: Snap): HTMLElement => {
      Object.assign(s.copy.style, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        right: 'auto',
        bottom: 'auto',
        margin: '0px',
        width: `${s.layout.w}px`,
        height: `${s.layout.h}px`,
        transformOrigin: '0 0',
        transform: `scale(${n5(A.rect.w / s.layout.w)}, ${n5(A.rect.h / s.layout.h)})`,
        opacity: '1',
        background: 'transparent',
      })
      clone.append(s.copy)
      return s.copy
    }
    const copyA = place(A)
    const copyB = place(B)
    ctx.overlay.append(clone)

    return {
      bothVisible: true,
      reset() {
        outEl.removeAttribute(HIDDEN_ATTR)
        inEl.removeAttribute(HIDDEN_ATTR)
      },
      update(pr) {
        ctx.out.style.opacity = n(1 - seg(pr, 0, 0.5))
        ctx.in.style.opacity = n(seg(pr, 0.5, 1))
        if (pr >= 1) {
          // Landed: the incoming original takes over (reset already un-hid it this seek).
          clone.style.visibility = 'hidden'
          return
        }
        outEl.setAttribute(HIDDEN_ATTR, '')
        inEl.setAttribute(HIDDEN_ATTR, '')
        clone.style.visibility = 'visible'
        const e = easeInOutCubic(clamp01(pr))
        const sx = lerp(A.rect.w, B.rect.w, e) / A.rect.w
        const sy = lerp(A.rect.h, B.rect.h, e) / A.rect.h
        const dx = lerp(A.rect.x, B.rect.x, e) - A.rect.x
        const dy = lerp(A.rect.y, B.rect.y, e) - A.rect.y
        clone.style.transform = `translate(${n(dx)}px, ${n(dy)}px) scale(${n5(sx)}, ${n5(sy)})`
        // The radius is drawn scaled by (sx, sy): divide so the on-screen radius is the lerp.
        const r = lerp(A.radius, B.radius, e)
        clone.style.borderRadius = `${n(r / sx)}px / ${n(r / sy)}px`
        const c = A.fill.map((v, i) => lerp(v, B.fill[i]!, e))
        clone.style.backgroundColor = `rgba(${Math.round(c[0]!)}, ${Math.round(c[1]!)}, ${Math.round(c[2]!)}, ${n(c[3]!)})`
        const x = seg(pr, MORPH_CROSSFADE[0], MORPH_CROSSFADE[1])
        copyA.style.opacity = n(1 - x)
        copyB.style.opacity = n(x)
      },
    }
  },
}
