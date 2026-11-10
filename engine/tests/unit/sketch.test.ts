import { describe, expect, it } from 'vitest'
import { cuesOfRedPen, cuesOfSketchWords, PEN_MARKS, redPenParams, sketchWordsParams } from '../../src/core/params/sketch'

describe('sketch-words params', () => {
  it('fills defaults', () => {
    const p = sketchWordsParams.parse({ lines: ['الفكرة'] })
    expect(p.fill).toBe('hatch')
    expect(p.boil).toBe(true)
    expect(p.size).toBe(240)
    expect(cuesOfSketchWords(p)).toEqual([{ t: p.at, kind: 'action' }])
  })
  it('rejects four lines and an unknown fill', () => {
    expect(sketchWordsParams.safeParse({ lines: ['أ', 'ب', 'ج', 'د'] }).success).toBe(false)
    expect(sketchWordsParams.safeParse({ lines: ['أ'], fill: 'dots' }).success).toBe(false)
  })
})

describe('red-pen params', () => {
  it('takes every mark kind and a note', () => {
    const marks = PEN_MARKS.map((kind, i) => ({ kind, x: 0.2, y: 0.3, w: 0.2, h: 0.05, at: i * 0.5 }))
    const p = redPenParams.parse({ marks, notes: [{ text: 'إحساس', x: 0.3, y: 0.6, at: 2 }] })
    expect(p.marks).toHaveLength(8)
    expect(p.notes[0]!.rotate).toBe(-4)
    expect(p.colour).toBe('red')
    expect(cuesOfRedPen(p)).toHaveLength(8)
  })
  it('rejects an unknown mark and a two-line note', () => {
    expect(redPenParams.safeParse({ marks: [{ kind: 'star', x: 0, y: 0, w: 0.1, h: 0.1, at: 0 }] }).success).toBe(false)
    expect(redPenParams.safeParse({ notes: [{ text: 'أ\nب', x: 0, y: 0, at: 0 }] }).success).toBe(false)
  })
})
