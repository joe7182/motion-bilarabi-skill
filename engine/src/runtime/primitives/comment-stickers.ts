import { easeInOutSine, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import { commentStickersParams, STICKERS as S, type CommentStickersParams } from '../../core/params/comment-stickers'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

/**
 * comment-stickers: followers' comments popping in as tilted white cards, alternating sides down
 * the band. Tilts come from the scene's seeded rng (one draw per card, in order). Pure in `localT`.
 */
export const commentStickers: Primitive<CommentStickersParams> = {
  id: 'comment-stickers',
  params: commentStickersParams,
  build(ctx, p) {
    const E = p.ease === 'easy' ? easeInOutSine : easeOutCubic
    const k = ctx.size.w / 1080
    const n = p.items.length
    const [b0, b1] = p.band
    const cards = p.items.map((it, i) => {
      const card = document.createElement('div')
      card.dataset.mbaPart = 'comment-sticker'
      card.dir = 'rtl'
      const x = ctx.safe.x + S.xs[i % 2]! * ctx.safe.w
      const y = ctx.safe.y + (b0 + ((i + 0.5) * (b1 - b0)) / n) * ctx.safe.h
      const tilt = (ctx.rng() * 2 - 1) * S.tilt
      Object.assign(card.style, {
        position: 'absolute', left: `${x}px`, top: `${y}px`, maxWidth: `${S.maxW * ctx.safe.w}px`, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: '0.45em', padding: '0.45em 0.7em 0.45em 0.8em', borderRadius: '0.7em',
        background: '#ffffff', color: '#141414', fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display),
        fontSize: `${Math.round(S.fontPx * k)}px`, lineHeight: '1.25', whiteSpace: 'nowrap',
        boxShadow: '0 0.35em 0.9em rgba(0,0,0,0.22), 0 0.05em 0.15em rgba(0,0,0,0.18)',
      })
      const dot = document.createElement('div')
      Object.assign(dot.style, { width: '0.9em', height: '0.9em', borderRadius: '50%', background: ctx.look.vars.accent, flexShrink: '0', opacity: '0.85' })
      card.append(dot)
      lineUnit(card, it.text)
      ctx.layer.append(card)
      return { card, tilt }
    })
    return {
      update(localT) {
        p.items.forEach((it, i) => {
          const { card, tilt } = cards[i]!
          const a = seg(localT, it.at, it.at + S.pop)
          const sc = p.ease === 'easy' ? 0.6 + 0.4 * easeInOutSine(a) : a >= 1 ? 1 : 0.4 + 0.6 * Math.max(0, easeOutBack(a, 1.7))
          card.style.opacity = a >= 1 ? '' : a <= 0 ? '0' : String(E(Math.min(1, a * 2)))
          card.style.transform = `translate(-50%, -50%) rotate(${tilt.toFixed(2)}deg) scale(${sc.toFixed(4)})`
        })
      },
    }
  },
}
