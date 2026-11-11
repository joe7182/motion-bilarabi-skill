import { describe, expect, it } from 'vitest'
import { cuesOfHalftoneField, cuesOfSpringGraph, halftoneFieldParams, springGraphParams } from '../../src/core/params/dots'

describe('spring-graph and halftone-field', () => {
  it('spring-graph needs two values and pops the callout on the last point', () => {
    expect(springGraphParams.safeParse({ values: [1] }).success).toBe(false)
    const p = springGraphParams.parse({ values: [1, 2, 3], at: 0.5, step: 0.4 })
    expect(p.callout).toBe('+٢٢٪')
    expect(cuesOfSpringGraph(p)).toEqual([{ t: 1.3, kind: 'pop' }])
  })
  it('halftone-field defaults and its wipe cue', () => {
    const p = halftoneFieldParams.parse({})
    expect(p.hero).toBe(true)
    expect(cuesOfHalftoneField(p)).toEqual([])
    expect(cuesOfHalftoneField(halftoneFieldParams.parse({ wipe: { at: 2 } }))).toEqual([{ t: 2, kind: 'whoosh' }])
  })
})
