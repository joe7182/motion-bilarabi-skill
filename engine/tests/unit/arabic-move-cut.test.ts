import { describe, expect, it } from 'vitest'
import { PARAMS } from '../../src/core/params'
import { arabicMoveMinSeconds } from '../../src/core/params/arabic-move'

describe('arabic-move cut', () => {
  it('defaults to false', () => {
    expect(PARAMS['arabic-move'].parse({ move: 'pen-write', text: 'قلم' }).cut).toBe(false)
  })
  it('a cut scene only needs the entrance (word-melt 2.0 s)', () => {
    const full = arabicMoveMinSeconds({ move: 'pen-write', text: 'قلم' })
    const cut = arabicMoveMinSeconds({ move: 'pen-write', text: 'قلم', cut: true })
    expect(cut).toBeCloseTo(0.2 + 0.32 * 3 + 0.05, 6)
    expect(cut).toBeLessThan(full)
    expect(arabicMoveMinSeconds({ move: 'word-melt', text: 'كلمة', cut: true })).toBe(2.0)
  })
})
