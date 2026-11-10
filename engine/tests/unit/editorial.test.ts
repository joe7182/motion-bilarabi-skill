import { describe, expect, it } from 'vitest'
import { cuesOfEditorialType, editorialTypeParams } from '../../src/core/params/editorial'

const lines = [{ words: [{ text: 'التصميم', at: 0.1 }, { text: 'الحلو', at: 0.4, serif: true }] }]

describe('editorial-type params', () => {
  it('fills defaults', () => {
    const p = editorialTypeParams.parse({ lines })
    expect(p.size).toBe(150)
    expect(p.swaps).toEqual([])
    expect(p.lines[0]!.words[0]!.serif).toBe(false)
  })
  it('rejects a select or swap on a word that does not exist', () => {
    expect(editorialTypeParams.safeParse({ lines, select: { line: 0, word: 2, at: 1 } }).success).toBe(false)
    expect(editorialTypeParams.safeParse({ lines, swaps: [{ line: 1, word: 0, to: 'الذكي', at: 2 }] }).success).toBe(false)
    expect(editorialTypeParams.safeParse({ lines, select: { line: 0, word: 1, at: 1 }, swaps: [{ line: 0, word: 1, to: 'الذكي', at: 2 }] }).success).toBe(true)
  })
  it('rejects a two-line word and more than four lines', () => {
    expect(editorialTypeParams.safeParse({ lines: [{ words: [{ text: 'a\nb', at: 0 }] }] }).success).toBe(false)
    expect(editorialTypeParams.safeParse({ lines: [...lines, ...lines, ...lines, ...lines, ...lines] }).success).toBe(false)
  })
  it('cues a tick on the select and an action on each swap', () => {
    const p = editorialTypeParams.parse({ lines, select: { line: 0, word: 1, at: 1.2 }, swaps: [{ line: 0, word: 1, to: 'الذكي', at: 2 }] })
    expect(cuesOfEditorialType(p)).toEqual([{ t: 1.2, kind: 'tick' }, { t: 2, kind: 'action' }])
  })
})
