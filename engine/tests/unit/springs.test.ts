import { describe, it, expect } from 'vitest'
import { SPRINGS, springStep, springTrack, springLead } from '../../src/core/springs'
import {
  clamp01,
  easeInCubic,
  easeInExpo,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  easeOutExpo,
  seg,
} from '../../src/core/ease'
import { FORMAT_SIZE, SAFE_AREA } from '../../src/core/types'

describe('springs', () => {
  it('step response starts at 0 and settles at 1', () => {
    expect(springStep(0, 'default')).toBe(0)
    expect(springStep(-1, 'heavy')).toBe(0)
    expect(springStep(5, 'snappy')).toBeCloseTo(1, 4)
    expect(springStep(5, 'playful')).toBeCloseTo(1, 3)
    expect(springStep(10, 'heavy')).toBeCloseTo(1, 6)
  })
  it('heavy (critically damped) is monotone non-decreasing', () => {
    const xs = Array.from({ length: 200 }, (_, i) => springStep(i * 0.01, 'heavy'))
    xs.forEach((v, i) => i && expect(v).toBeGreaterThanOrEqual(xs[i - 1]! - 1e-12))
  })
  it('playful overshoots by exp(-pi z / sqrt(1 - z^2))', () => {
    const peak = Math.max(...Array.from({ length: 2000 }, (_, i) => springStep(i * 0.001, 'playful')))
    expect(peak - 1).toBeCloseTo(Math.exp((-Math.PI * 0.5) / Math.sqrt(1 - 0.25)), 2)
  })
  it('overdamped custom spring is monotone and settles', () => {
    const s = { response: 0.4, damping: 1.6 }
    const xs = Array.from({ length: 300 }, (_, i) => springStep(i * 0.01, s))
    xs.forEach((v, i) => i && expect(v).toBeGreaterThanOrEqual(xs[i - 1]! - 1e-12))
    expect(xs[0]).toBe(0)
    expect(springStep(20, s)).toBeCloseTo(1, 6)
  })
  it('ζ just below / above 1 is continuous with the critical form', () => {
    for (const tau of [0.05, 0.2, 0.5]) {
      const crit = springStep(tau, { response: 0.5, damping: 1 })
      expect(springStep(tau, { response: 0.5, damping: 1 - 1e-6 })).toBeCloseTo(crit, 5)
      expect(springStep(tau, { response: 0.5, damping: 1 + 1e-6 })).toBeCloseTo(crit, 5)
    }
  })
  it('values are ours, verbatim', () => {
    expect(SPRINGS).toEqual({
      snappy: { response: 0.24, damping: 0.82 },
      default: { response: 0.42, damping: 0.88 },
      heavy: { response: 0.56, damping: 1 },
      playful: { response: 0.52, damping: 0.5 },
    })
  })
  it('springTrack sums keyed steps', () => {
    expect(springTrack(10, [[0, 0], [1, 100], [2, 40]])).toBeCloseTo(40, 3)
    expect(springTrack(0.5, [[0, 0], [1, 100]])).toBe(0)
    expect(springTrack(1.3, [[0, 5], [1, 15, 'heavy']])).toBeCloseTo(5 + 10 * springStep(0.3, 'heavy'), 12)
  })
  it('springLead is where the step first reaches 0.6', () => {
    expect(springStep(springLead('default'), 'default')).toBeCloseTo(0.6, 3)
    for (const name of ['snappy', 'heavy', 'playful'] as const) {
      const lead = springLead(name)
      expect(springStep(lead, name)).toBeCloseTo(0.6, 3)
      expect(springStep(lead * 0.9, name)).toBeLessThan(0.6)
    }
  })
})

describe('ease', () => {
  it('basics', () => {
    expect(seg(1.5, 1, 2)).toBe(0.5)
    expect(seg(0, 1, 2)).toBe(0)
    expect(seg(3, 1, 2)).toBe(1)
    expect(easeInOutCubic(0.5)).toBe(0.5)
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    for (const f of [easeInCubic, easeOutCubic, easeInOutCubic, easeInExpo, easeOutExpo, (x: number) => easeOutBack(x)]) {
      expect(f(0)).toBeCloseTo(0, 12)
      expect(f(1)).toBeCloseTo(1, 12)
    }
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => easeOutBack(i / 100)))).toBeGreaterThan(1)
  })
})

describe('formats', () => {
  it('sizes and safe areas', () => {
    expect(FORMAT_SIZE['4:5']).toEqual({ w: 1080, h: 1350 })
    expect(FORMAT_SIZE['1:1']).toEqual({ w: 1080, h: 1080 })
    expect(SAFE_AREA['9:16'].top).toBe(0.14)
  })
})
