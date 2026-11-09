import { easeInOutCubic, easeInOutSine, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import { LETTERS_JOIN as L, lettersJoinParams, lettersOf, type LettersJoinParams } from '../../core/params/letters-join'
import { FONT_WEIGHT } from '../looks'
import { fitText, lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

/**
 * letters-join: separate letters that slide together into the joined word (or, `reverse`, a word
 * that breaks into letters). Every separate letter is its own line unit (isolated form, by design);
 * the joined word is one unit laid over the row. Each letter travels from its place in the row to
 * the centre of its glyph inside the joined word (measured with a Range at build), then the letters
 * hand over to the joined word in the last slice of the move. Pure in `localT`.
 */
export const lettersJoin: Primitive<LettersJoinParams> = {
  id: 'letters-join',
  params: lettersJoinParams,
  build(ctx, p) {
    const E = p.ease === 'easy' ? easeInOutSine : easeOutCubic
    const c = safePointPx(ctx, p.place ?? { x: 0.5, y: 0.45 })
    const letters = lettersOf(p.word)
    const holder = document.createElement('div')
    holder.dataset.mbaPart = 'letters-join'
    if (p.key) holder.dataset.mbaKey = p.key
    Object.assign(holder.style, {
      position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, transform: 'translate(-50%, -50%)',
      fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), lineHeight: '1.3', color: ctx.look.vars.fg, whiteSpace: 'nowrap',
    })
    ctx.layer.append(holder)

    const row = document.createElement('div')
    row.dir = 'rtl'
    Object.assign(row.style, { display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: `${p.gap}em` })
    holder.append(row)
    const units = letters.map((ch) => {
      const u = lineUnit(row, ch)
      u.dataset.mbaPart = 'letter'
      u.style.transformOrigin = '50% 60%'
      return u
    })
    fitText(holder, { w: Math.floor(p.size * ctx.safe.w), h: Math.floor(0.35 * ctx.safe.h) }, L.maxPx, 48)

    const px = parseFloat(holder.style.fontSize) || 48
    // The liquid morph filter (one per scene, seeded id).
    const fid = `mba-goo-${Math.floor(ctx.rng() * 1e9)}`
    const SVG = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    Object.assign(svg.style, { position: 'absolute' })
    const filter = document.createElementNS(SVG, 'filter')
    filter.id = fid
    filter.setAttribute('color-interpolation-filters', 'sRGB')
    filter.setAttribute('x', '-20%'); filter.setAttribute('y', '-40%'); filter.setAttribute('width', '140%'); filter.setAttribute('height', '180%')
    const blur = document.createElementNS(SVG, 'feGaussianBlur')
    blur.setAttribute('in', 'SourceGraphic')
    const matrix = document.createElementNS(SVG, 'feColorMatrix')
    matrix.setAttribute('mode', 'matrix')
    filter.append(blur, matrix)
    svg.append(filter)
    ctx.layer.append(svg)

    const joined = lineUnit(holder, p.word)
    joined.dataset.mbaPart = 'joined'
    Object.assign(joined.style, { position: 'absolute', left: '50%', top: '0px', transform: 'translateX(-50%)' })

    // Centres in holder layout px: the row letters from their offsets, the joined glyphs from a Range.
    const hb = holder.getBoundingClientRect()
    const scale = holder.offsetWidth > 0 ? hb.width / holder.offsetWidth : 1
    const apartX = units.map((u) => u.offsetLeft + u.offsetWidth / 2)
    const text = joined.firstChild as Text
    const range = document.createRange()
    let off = 0
    const joinX = letters.map((ch) => {
      range.setStart(text, off)
      range.setEnd(text, off + ch.length)
      off += ch.length
      const rs = [...range.getClientRects()].filter((r) => r.width > 0)
      if (rs.length === 0) return undefined
      const l = Math.min(...rs.map((r) => r.left))
      const r = Math.max(...rs.map((r) => r.right))
      return ((l + r) / 2 - hb.left) / scale
    })
    // A glyph with no box of its own (inside a ligature) takes its neighbour's centre.
    joinX.forEach((x, i) => {
      if (x === undefined) joinX[i] = joinX[i - 1] ?? joinX.find((v) => v !== undefined) ?? apartX[i]
    })
    const dx = units.map((_, i) => joinX[i]! - apartX[i]!)

    return {
      update(localT) {
        const t = Math.max(0, localT)
        // u: raw progress of the move; v: the same seen from the apart state (reverse mirrors it).
        const u = seg(t, p.at, p.at + p.duration)
        const v = p.reverse ? 1 - u : u
        // The letters travel over the first `travel` of the move, then melt into the joined word.
        const m = (p.ease === 'easy' ? easeInOutSine : easeInOutCubic)(seg(v, 0, L.travel))
        const s = seg(v, L.swap[0], L.swap[1])
        units.forEach((u, i) => {
          let o = 1 - s
          let sc = 1
          if (!p.reverse) {
            const a = seg(t, i * L.stagger, i * L.stagger + L.pop)
            o *= E(a)
            sc = p.ease === 'easy' ? 0.6 + 0.4 * easeInOutSine(a) : a >= 1 ? 1 : 0.6 + 0.4 * Math.max(0, easeOutBack(a, 1.6))
          }
          u.style.opacity = o === 1 ? '' : o.toFixed(4)
          const x = dx[i]! * m
          u.style.transform = x === 0 && sc === 1 ? '' : `translateX(${x.toFixed(2)}px) scale(${sc.toFixed(4)})`
        })
        let jo = s
        if (p.reverse) jo *= E(seg(t, 0, L.pop))
        joined.style.opacity = jo === 1 ? '' : jo.toFixed(4)
        // Liquid morph: strongest mid-move, gone at both ends.
        const gu = seg(v, L.goo[0], L.goo[1])
        const g = gu > 0 && gu < 1 ? Math.sin(Math.PI * gu) ** 0.7 : 0
        if (g < 1e-3) {
          holder.style.filter = ''
        } else {
          blur.setAttribute('stdDeviation', (g * L.gooBlur * px).toFixed(3))
          matrix.setAttribute('values', `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${(1 + (L.gooGain - 1) * g).toFixed(3)} ${(-L.gooBias * g).toFixed(3)}`)
          holder.style.filter = `url(#${fid})`
        }
      },
    }
  },
}
