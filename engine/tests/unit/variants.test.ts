import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/core/palette'
import { VARIANT_IDS, VARIANTS } from '../../src/core/variants'
import { getLook } from '../../src/runtime/looks'

describe('colour variants', () => {
  it.each(VARIANT_IDS)('%s reads: ink ≥ 7 and accent ≥ 4.5 on its ground', (id) => {
    const v = VARIANTS[id]
    expect(contrastRatio(v.fg, v.bg)).toBeGreaterThanOrEqual(7)
    expect(contrastRatio(v.accent, v.bg)).toBeGreaterThanOrEqual(4.5)
    // the ink world (a light ground with the variant's ground as ink) reads too
    expect(contrastRatio(v.bg, v.fg)).toBeGreaterThanOrEqual(7)
  })

  it('replaces the look colours and brings the glows; a brand still sets the accent', () => {
    const plain = getLook('nebula')
    expect(plain.glows).toBeUndefined()
    const e = getLook('nebula', undefined, 'electric')
    expect([e.bg, e.fg, e.accent]).toEqual([VARIANTS.electric.bg, VARIANTS.electric.fg, VARIANTS.electric.accent])
    expect(e.glows?.dark).toHaveLength(4)
    expect(e.fontDisplay).toBe(plain.fontDisplay)
    const branded = getLook('nebula', { colors: { primary: '#123456' } } as never, 'coral')
    expect(branded.accent).toBe('#123456')
    expect(branded.bg).toBe(VARIANTS.coral.bg)
  })
})

describe('storyboard "variant"', () => {
  const sb = (variant?: string) => ({ version: 1, look: 'nebula', ...(variant ? { variant } : {}), scenes: [{ id: 'a', type: 'hue-field', start: 0, duration: 2 }] })
  it('takes a known variant and refuses an unknown one', async () => {
    const { parseStoryboard } = await import('../../src/core/storyboard')
    expect(parseStoryboard(sb('electric'), ['hue-field']).variant).toBe('electric')
    expect(parseStoryboard(sb(), ['hue-field']).variant).toBeUndefined()
    expect(() => parseStoryboard(sb('neon'), ['hue-field'])).toThrow()
  })
})
