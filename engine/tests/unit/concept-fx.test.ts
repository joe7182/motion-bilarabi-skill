import { describe, expect, it } from 'vitest'
import { beforeAfterParams, cuesOfFanCards, cuesOfFunnel, fanCardsParams, funnelParams } from '../../src/core/params/concept-fx'

describe('concept pieces', () => {
  it('before-after defaults to قبل / بعد and a right-to-left drag', () => {
    const p = beforeAfterParams.parse({})
    expect(p.before.label).toBe('قبل')
    expect(p.after.label).toBe('بعد')
    expect(p.from).toBeGreaterThan(p.to)
  })
  it('fan-cards: 2 to 8 outputs, a pop per card', () => {
    expect(fanCardsParams.safeParse({ input: 'طلب', outputs: [{ title: 'أ' }] }).success).toBe(false)
    const p = fanCardsParams.parse({ input: 'طلب', at: 1, stagger: 0.2, outputs: [{ title: 'أ' }, { title: 'ب' }] })
    expect(cuesOfFanCards(p).map((c) => c.t)).toEqual([1, 1.2])
  })
  it('funnel needs both kept and dropped items', () => {
    expect(funnelParams.safeParse({ items: [{ text: 'أ', keep: true }, { text: 'ب', keep: true }, { text: 'ج', keep: true }] }).success).toBe(false)
    const p = funnelParams.parse({ items: [{ text: 'أ', keep: true }, { text: 'ب' }, { text: 'ج' }], at: 0.5, dur: 2 })
    expect(cuesOfFunnel(p).map((c) => c.t)).toEqual([0.5, 2.5])
  })
})
