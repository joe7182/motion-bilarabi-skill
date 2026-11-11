import { describe, expect, it } from 'vitest'
import { cuesOfUiMorph, spring, UI_BOX, UI_STATES, uiMorphParams } from '../../src/core/params/ui-morph'

describe('ui-morph', () => {
  it('springs from 0 to 1 with a small overshoot', () => {
    expect(spring(0)).toBe(0)
    expect(spring(-1)).toBe(0)
    const peak = Math.max(...Array.from({ length: 60 }, (_, i) => spring(i / 60)))
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThan(1.12)
    expect(spring(1.5)).toBeCloseTo(1, 2)
  })
  it('has a box for every state', () => {
    for (const s of UI_STATES) expect(UI_BOX[s].w).toBeGreaterThan(0)
  })
  it('needs rising state times', () => {
    expect(uiMorphParams.safeParse({ states: [{ kind: 'button', at: 1 }, { kind: 'check', at: 0.5 }] }).success).toBe(false)
    const p = uiMorphParams.parse({ states: [{ kind: 'button', at: 0.1 }, { kind: 'loader', at: 1 }] })
    expect(p.cursor).toBe(true)
    expect(cuesOfUiMorph(p).map((c) => c.t)).toEqual([0.1, 1])
  })
})
