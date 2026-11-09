import { describe, expect, it } from 'vitest'
import { TRANSITION_PARAMS, defaultTransitionDuration } from '../../src/core/params/transitions'
import { buildEncodeArgs, frameMoments } from '../../src/node/render'
import { parseStoryboard } from '../../src/core/storyboard'

const PAPER = ['page-turn', 'paper-tear', 'pen-dot-curtain', 'pixel-curtain', 'ink-slab', 'blinds'] as const

describe('paper transitions (the original ports)', () => {
  it('each has a schema with defaults and its own window length', () => {
    for (const id of PAPER) {
      expect(TRANSITION_PARAMS[id].parse({})).toHaveProperty('hit', false)
      expect(defaultTransitionDuration(id)).toBeGreaterThan(0.1)
    }
    expect(defaultTransitionDuration('page-turn')).toBe(0.9)
    expect(TRANSITION_PARAMS['blinds'].parse({}).slats).toBe(6)
    expect(() => TRANSITION_PARAMS['blinds'].parse({ slats: 2 })).toThrow()
  })
})

describe('motion blur', () => {
  it('frameMoments: one moment without blur, samples spread over the shutter', () => {
    expect(frameMoments(30, 60)).toEqual([0.5])
    const m = frameMoments(30, 60, { samples: 4, shutter: 180 })
    expect(m).toHaveLength(4)
    expect(m[3]! - m[0]!).toBeCloseTo(0.5 / 60, 9)
    expect((m[0]! + m[3]!) / 2).toBeCloseTo(0.5, 9)
    expect(frameMoments(0, 60, { samples: 4, shutter: 360 })[0]).toBe(0)
  })
  it('buildEncodeArgs: blends groups of S sub-frames back to fps', () => {
    const a = buildEncodeArgs({ fps: 60, draft: false, out: 'x.mp4', blurSamples: 4 })
    expect(a[a.indexOf('-framerate') + 1]).toBe('240')
    expect(a[a.indexOf('-vf') + 1]!.startsWith("tmix=frames=4,select='eq(mod(n\\,4)\\,3)',setpts=N/(60*TB),")).toBe(true)
    expect(a[a.indexOf('-r') + 1]).toBe('60')
    const plain = buildEncodeArgs({ fps: 60, draft: false, out: 'x.mp4' })
    expect(plain).not.toContain('-r')
    expect(plain[plain.indexOf('-vf') + 1]).not.toContain('tmix')
  })
})
