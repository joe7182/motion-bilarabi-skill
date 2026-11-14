import { describe, expect, it } from 'vitest'
import { boardMoments } from '../../src/core/board-moments'

const words = [
  { text: 'بيت', start: 0.1, end: 0.3 }, { text: 'واحد', start: 0.35, end: 0.6 },
  { text: 'أداة', start: 5.5, end: 5.9 }, { text: 'سويتها', start: 6.0, end: 6.6 },
  { text: 'الحكم', start: 12.2, end: 12.6 },
]

describe('board moments', () => {
  it('one moment per new scene, with the words said over it; the ground layers make none', () => {
    const m = boardMoments([
      { id: 'bg', type: 'backdrop', track: 0, start: 0, duration: 14 },
      { id: 'hue', type: 'hue-field', track: 0, start: 0, duration: 14 },
      { id: 'a', type: 'html-motion', track: 2, start: 0, duration: 5 },
      { id: 'b', type: 'screen-clip', track: 1, start: 5, duration: 7 },
      { id: 'b2', type: 'html-motion', track: 2, start: 5, duration: 7 },
      { id: 'c', type: 'html-motion', track: 2, start: 12, duration: 2 },
    ], words, 14)
    expect(m.map((x) => [x.from, x.to])).toEqual([[0, 5], [5, 12], [12, 14]])
    expect(m[0]!.words).toBe('بيت واحد')
    expect(m[1]!.words).toBe('أداة سويتها')
    expect(m[1]!.scenes.map((s) => s.id).sort()).toEqual(['b', 'b2'])
    for (const x of m) expect(x.t).toBeGreaterThan(x.from)
    for (const x of m) expect(x.t).toBeLessThan(x.to)
  })
  it('starts closer than a second merge; a long moment is stilled within 3.5 s', () => {
    const m = boardMoments([
      { id: 'a', type: 'kinetic-text', start: 0, duration: 0.5 + 9.5 },
      { id: 'b', type: 'icon', start: 0.4, duration: 9 },
      { id: 'c', type: 'icon', start: 10, duration: 2 },
    ], [], 12)
    expect(m.map((x) => x.from)).toEqual([0, 10])
    expect(m[0]!.t).toBe(3.5)
  })
})
