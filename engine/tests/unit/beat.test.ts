import { describe, expect, it } from 'vitest'
import { cameraAt, pulseAt } from '../../src/core/camera'
import { beatPulseParams, beatTimes, cuesOfBeatPulse } from '../../src/core/params/beat'
import { cutoutParams } from '../../src/core/params/cutout'

describe('beat-pulse', () => {
  it('makes a beat grid from bpm and count, accents every Nth', () => {
    const p = beatPulseParams.parse({ bpm: 120, from: 1, count: 5, accent: 4 })
    expect(beatTimes(p)).toEqual([
      { t: 1, strong: true }, { t: 1.5, strong: false }, { t: 2, strong: false }, { t: 2.5, strong: false }, { t: 3, strong: true },
    ])
    expect(cuesOfBeatPulse(p).map((c) => c.t)).toEqual([1, 3])
  })
  it('merges listed beats with the grid, sorted', () => {
    const p = beatPulseParams.parse({ at: [0.25], bpm: 60, count: 2 })
    expect(beatTimes(p).map((b) => b.t)).toEqual([0, 0.25, 1])
  })
  it('rejects an unknown kind', () => {
    expect(beatPulseParams.safeParse({ kinds: ['smoke'] }).success).toBe(false)
  })
})

describe('camera beat kicks', () => {
  it('punches in on the beat and is gone by the window end', () => {
    const pulses = [{ at: 1, amp: 0.1 }]
    expect(pulseAt(pulses, 0.99)).toBe(1)
    expect(pulseAt(pulses, 1)).toBeCloseTo(1.1)
    expect(pulseAt(pulses, 1.2)).toBeCloseTo(1 + 0.1 * Math.exp(-2.2))
    expect(pulseAt(pulses, 1.46)).toBe(1)
    expect(cameraAt({ keys: [{ at: 0, x: 0.5, y: 0.5, zoom: 1 }], pulses }, 1).zoom).toBeCloseTo(1.1)
  })
})

describe('cutout desk line', () => {
  it('takes an optional desk line and a feather', () => {
    const p = cutoutParams.parse({ media: 'm1', in: 0, below: 0.62 })
    expect(p.below).toBe(0.62)
    expect(p.feather).toBe(0.05)
    expect(cutoutParams.safeParse({ media: 'm1', in: 0, below: 0.1 }).success).toBe(false)
  })
})
