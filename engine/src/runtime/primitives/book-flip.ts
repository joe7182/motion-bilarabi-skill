import { easeInOutCubic, easeInOutSine, easeOutCubic, seg } from '../../core/ease'
import { BOOK, bookFlipParams, type BookFlipParams } from '../../core/params/book-flip'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

/**
 * book-flip: an open textbook (two paper pages, a spine shadow, faint printed lines). Leaves turn
 * over the spine one after another (rotateY 0 → −180 in RTL reading direction: right to left
 * pages turn from left to right), each easing in and out, and stop on the figure page. At `liftAt`
 * a copy of the figure lifts from its place on the page and grows into the target box while its
 * print grey turns to full colour; the book fades. Pure in `localT`.
 */
export const bookFlip: Primitive<BookFlipParams> = {
  id: 'book-flip',
  params: bookFlipParams,
  build(ctx, p) {
    const E = p.ease === 'easy' ? easeInOutSine : easeOutCubic
    const s = ctx.safe
    const W = Math.round(BOOK.width * s.w)
    const H = Math.round(W / BOOK.aspect)
    const cx = s.x + BOOK.at.x * s.w
    const cy = s.y + BOOK.at.y * s.h
    const pageW = W / 2
    const root = document.createElement('div')
    root.dataset.mbaPart = 'book'
    Object.assign(root.style, { position: 'absolute', left: `${cx - W / 2}px`, top: `${cy - H / 2}px`, width: `${W}px`, height: `${H}px`, perspective: `${Math.round(W * 2.2)}px` })
    ctx.layer.append(root)

    /** A page face: paper, faint lines of print, optional figure. */
    const face = (lines: number, seed: number) => {
      const f = document.createElement('div')
      Object.assign(f.style, { position: 'absolute', inset: '0', background: BOOK.paper, overflow: 'hidden', padding: `${pageW * 0.1}px ${pageW * 0.09}px`, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: `${pageW * 0.035}px`, backfaceVisibility: 'hidden' })
      for (let i = 0; i < lines; i++) {
        const l = document.createElement('div')
        const w = 55 + ((Math.sin(seed * 9.1 + i * 2.7) + 1) / 2) * 40
        Object.assign(l.style, { height: `${pageW * 0.018}px`, width: `${w.toFixed(1)}%`, alignSelf: 'flex-end', background: BOOK.ink, borderRadius: '2px' })
        f.append(l)
      }
      return f
    }
    const shadow = 'inset 0 0 0 1px rgba(0,0,0,0.06)'
    // Left (verso) and right (recto) static pages; RTL books open from the right, so leaves turn left → right.
    const left = document.createElement('div')
    Object.assign(left.style, { position: 'absolute', left: '0', top: '0', width: `${pageW}px`, height: `${H}px`, boxShadow: shadow })
    left.append(face(12, 1))
    const right = document.createElement('div')
    Object.assign(right.style, { position: 'absolute', left: `${pageW}px`, top: '0', width: `${pageW}px`, height: `${H}px`, boxShadow: shadow })
    // The figure page sits on the LEFT in an RTL book (the last page turned lands there).
    const figPage = face(3, 7)
    figPage.style.justifyContent = 'flex-end'
    const fig = document.createElement('img')
    fig.alt = ''
    fig.src = p.image
    const figW = pageW * 0.82
    const figH = figW / p.target.aspect
    const figTop = pageW * 0.22
    Object.assign(fig.style, { position: 'absolute', left: `${(pageW - figW) / 2}px`, top: `${figTop}px`, width: `${figW}px`, height: `${figH}px`, objectFit: 'cover', filter: 'grayscale(1) contrast(1.05)', borderRadius: '3px' })
    figPage.prepend(fig)
    if (p.title) {
      const t = document.createElement('div')
      Object.assign(t.style, { position: 'absolute', top: `${pageW * 0.035}px`, right: `${pageW * 0.09}px`, fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.bodyBold), fontSize: `${Math.max(Math.ceil(30 * (ctx.size.w / 1080)), Math.round(pageW * 0.065))}px`, color: '#2a241e' })
      lineUnit(t, p.title)
      figPage.append(t)
    }
    left.replaceChildren(figPage)
    right.append(face(13, 3))
    const spine = document.createElement('div')
    Object.assign(spine.style, { position: 'absolute', left: `${pageW - W * 0.03}px`, top: '0', width: `${W * 0.06}px`, height: `${H}px`, background: 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 50%, rgba(0,0,0,0) 100%)' })
    root.append(left, right)

    // Leaves: lying on the right page, turning over the spine onto the left page (rotateY 0 → 180).
    const leaves = Array.from({ length: p.flips }, (_, i) => {
      const leaf = document.createElement('div')
      Object.assign(leaf.style, { position: 'absolute', left: `${pageW}px`, top: '0', width: `${pageW}px`, height: `${H}px`, transformOrigin: '0% 50%', transformStyle: 'preserve-3d' })
      const front = face(13, 11 + i)
      const back = face(12, 31 + i)
      back.style.transform = 'rotateY(180deg)'
      leaf.append(front, back)
      root.append(leaf)
      return leaf
    })
    // Until the flipping ends, a plain page covers the figure page on the left.
    const cover = document.createElement('div')
    Object.assign(cover.style, { position: 'absolute', left: '0', top: '0', width: `${pageW}px`, height: `${H}px`, boxShadow: shadow })
    cover.append(face(12, 2))
    root.insertBefore(cover, leaves[0]!)
    root.append(spine)

    // The figure's flight: from its spot on the page to the target box.
    const T = p.target
    const tw = Math.floor(T.width * s.w)
    const th = Math.round(tw / T.aspect)
    const tx = s.x + T.at.x * s.w - tw / 2
    const ty = s.y + T.at.y * s.h - th / 2
    const fly = document.createElement('img')
    fly.alt = ''
    fly.src = p.image
    Object.assign(fly.style, { position: 'absolute', left: '0', top: '0', width: `${tw}px`, height: `${th}px`, objectFit: 'cover', transformOrigin: '0 0', borderRadius: '10px', visibility: 'hidden', boxShadow: '0 1.2em 2.6em rgba(0,0,0,0.3)' })
    ctx.layer.append(fly)
    // The figure's rest box in layer px (the book is laid out in plain px, no transform at rest).
    const from = { x: cx - W / 2 + (pageW - figW) / 2, y: cy - H / 2 + figTop, w: figW, h: figH }

    const leafStart = (i: number) => p.at + (i * p.flipSec) / (p.flips + 1)
    const leafLen = (2 * p.flipSec) / (p.flips + 1)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const e = E(seg(t, 0, BOOK.enter))
        root.style.opacity = e === 1 ? '' : e.toFixed(4)
        leaves.forEach((leaf, i) => {
          const k = easeInOutCubic(seg(t, leafStart(i), leafStart(i) + leafLen))
          leaf.style.transform = `rotateY(${(-180 * k).toFixed(2)}deg)`
          // A turned leaf lies on the left page: hide it once the next one lands (keeps depth simple).
          leaf.style.visibility = k >= 1 && i < leaves.length - 1 && t > leafStart(i + 1) + leafLen ? 'hidden' : ''
        })
        // The last leaf lands on the left: it and the cover give way to the figure page.
        const done = t >= leafStart(leaves.length - 1) + leafLen
        cover.style.visibility = done ? 'hidden' : ''
        leaves[leaves.length - 1]!.style.visibility = done ? 'hidden' : ''

        if (p.liftAt === undefined) return
        const l = E(seg(t, p.liftAt, p.liftAt + BOOK.lift))
        if (l <= 0) {
          fly.style.visibility = 'hidden'
          fig.style.visibility = ''
          return
        }
        fig.style.visibility = 'hidden'
        fly.style.visibility = ''
        const x = from.x + (tx - from.x) * l
        const y = from.y + (ty - from.y) * l
        const sx = (from.w + (tw - from.w) * l) / tw
        const sy = (from.h + (th - from.h) * l) / th
        fly.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
        fly.style.filter = `grayscale(${(1 - l).toFixed(3)})`
        root.style.opacity = (1 - l).toFixed(4)
      },
    }
  },
}
