import { describe, expect, it } from 'vitest'
import { groundOf, PICK_GROUNDS } from '../../src/core/pick-grounds'
import { LOOK_IDS } from '../../src/core/storyboard'
import { TITLE_STYLE_IDS } from '../../src/core/title-styles'
import { VARIANT_IDS } from '../../src/core/variants'

describe('picker backgrounds (faceless)', () => {
  it('pairs every title style with a background of the same id, on a real look', () => {
    expect(PICK_GROUNDS.map((g) => g.id).sort()).toEqual([...TITLE_STYLE_IDS].sort())
    for (const g of PICK_GROUNDS) {
      expect(LOOK_IDS).toContain(g.look)
      if (g.variant) expect(VARIANT_IDS).toContain(g.variant)
    }
  })
  it('falls back to the first background for an unknown id', () => {
    expect(groundOf('electric').variant).toBe('electric')
    expect(groundOf('nope').id).toBe(PICK_GROUNDS[0]!.id)
  })
})
