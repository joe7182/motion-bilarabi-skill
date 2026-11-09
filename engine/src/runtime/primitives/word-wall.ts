import { wordWallParams, type WordWallParams } from '../../core/params/word-wall'
import { FONT_WEIGHT } from '../looks'
import { frameRect } from '../drift-fit'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

export const WORD_WALL = {
  /** The share of a row a copy's line box takes, and of the safe width a column's copy may take. */
  rowFill: 0.7,
  colFill: 0.9,
} as const

/** One copy of the word: its unit, row and column in the grid. */
interface Copy {
  unit: HTMLElement
  row: number
  col: number
  /** The one highlighted copy: accent, full opacity, never moves. */
  still: boolean
}

/**
 * A wall of one word: `rows × cols` whole-word copies in `fg` at `alpha`, the rows alternately
 * moving right and left at `speed` (px/s at a 1080 px frame, scaled with the frame width) and
 * wrapping; the `highlight` copy is `accent` at full opacity and stays put. At rest the copies sit
 * in even cells of the safe area; a moving copy travels a ring one copy wider than the grid, so it
 * wraps outside the grid box, which clips whatever runs out of it. Every position is a pure
 * function of local time.
 */
export const wordWall: Primitive<WordWallParams> = {
  id: 'word-wall',
  params: wordWallParams,
  build(ctx, p) {
    const grid = document.createElement('div')
    grid.dataset.mbaPart = 'word-wall'
    if (p.key) grid.dataset.mbaKey = p.key
    Object.assign(grid.style, {
      position: 'absolute',
      left: `${ctx.safe.x}px`,
      top: `${ctx.safe.y}px`,
      width: `${ctx.safe.w}px`,
      height: `${ctx.safe.h}px`,
      overflow: 'hidden',
      fontFamily: ctx.look.fontDisplay,
      fontWeight: String(FONT_WEIGHT.display),
      lineHeight: '1.3',
    })
    ctx.layer.append(grid)

    const copies: Copy[] = []
    for (let i = 0; i < p.rows * p.cols; i++) {
      const unit = lineUnit(grid, p.text)
      const still = i === p.highlight
      Object.assign(unit.style, {
        position: 'absolute',
        top: '0px',
        color: still ? ctx.look.vars.accent : ctx.look.vars.fg,
        opacity: still ? '' : String(p.alpha),
      })
      copies.push({ unit, row: Math.floor(i / p.cols), col: i % p.cols, still })
    }

    // The word as big as its row allows and as wide as its column allows.
    const rowH = ctx.safe.h / p.rows
    const PROBE = 100
    grid.style.fontSize = `${PROBE}px`
    const probe = frameRect(ctx.layer, ctx.size.w, [copies[0]!.unit])
    const px = Math.floor(
      Math.min((PROBE * rowH * WORD_WALL.rowFill) / probe.h, (PROBE * WORD_WALL.colFill * (ctx.safe.w / p.cols)) / probe.w),
    )
    grid.style.fontSize = `${Math.max(px, 8)}px`
    const box = frameRect(ctx.layer, ctx.size.w, [copies[0]!.unit])
    const ring = ctx.safe.w + box.w
    const cell = ctx.safe.w / p.cols
    const speed = p.speed * (ctx.size.w / 1080)
    for (const c of copies) c.unit.style.top = `${(c.row * rowH + (rowH - box.h) / 2).toFixed(2)}px`

    return {
      update(localT) {
        for (const c of copies) {
          const rest = (c.col + 0.5) * cell - box.w / 2
          // Even rows move right, odd rows left; a copy wraps at the ring, off the grid.
          const moved = c.still ? rest : ((((rest + box.w + (c.row % 2 === 0 ? 1 : -1) * speed * Math.max(0, localT)) % ring) + ring) % ring) - box.w
          c.unit.style.left = `${moved.toFixed(2)}px`
        }
      },
    }
  },
}
