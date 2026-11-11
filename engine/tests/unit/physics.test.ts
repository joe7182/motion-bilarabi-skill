import { describe, expect, it } from 'vitest'
import { bounceBallParams, cuesOfBounceBall, hopArc, settleAt } from '../../src/core/params/physics'

describe('bounce physics', () => {
  it('falls with gravity then bounces lower each time', () => {
    expect(settleAt(-0.4, 0.4, 0.5, 4).h).toBeCloseTo(1)
    expect(settleAt(0, 0.4, 0.5, 4).h).toBeCloseTo(0)
    // First bounce: flight 2·0.4·0.5 = 0.4 s, peak e² = 0.25 at its middle.
    expect(settleAt(0.2, 0.4, 0.5, 4).h).toBeCloseTo(0.25)
    // Second bounce peaks at e⁴.
    expect(settleAt(0.4 + 0.1, 0.4, 0.5, 4).h).toBeCloseTo(0.0625)
    expect(settleAt(5, 0.4, 0.5, 4).h).toBe(0)
  })
  it('hops on a parabola', () => {
    expect(hopArc(0)).toBe(0)
    expect(hopArc(0.5)).toBe(1)
    expect(hopArc(1)).toBe(0)
  })
  it('needs words, targets or a drop, with rising times', () => {
    expect(bounceBallParams.safeParse({}).success).toBe(false)
    expect(bounceBallParams.safeParse({ words: [{ text: 'أ', at: 1 }, { text: 'ب', at: 0.5 }] }).success).toBe(false)
    const p = bounceBallParams.parse({ words: [{ text: 'الموشن', at: 0.6 }, { text: 'أسهل', at: 1.1, key: true }] })
    expect(p.size).toBe(0.07)
    expect(cuesOfBounceBall(p).map((c) => c.t)).toEqual([0.6, 1.1])
    expect(bounceBallParams.parse({ drop: { x: 0.5, y: 0.5, at: 1 } }).drop!.bounce).toBe(0.58)
  })
})
