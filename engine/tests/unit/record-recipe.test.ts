import { describe, expect, it } from 'vitest'
import { easeMove, recordRecipeSchema, shotFrames } from '../../src/core/record-recipe'

describe('record recipe', () => {
  it('fills the defaults and takes each kind of step and move', () => {
    const r = recordRecipeSchema.parse({
      url: 'tool.html',
      shots: [
        { name: 'plan', seconds: 1 },
        { name: 'orbit', seconds: 2, setup: [{ click: '3D' }, { wait: 500 }, { set: '#tod', value: 16 }], move: { drag: { from: [300, 480], to: [460, 480] } } },
        { name: 'sun', seconds: 2, move: { sweep: { target: '#tod', from: 6.5, to: 18.5, step: 0.25 } } },
        { name: 'inside', seconds: 1, setup: [{ check: 'السقف' }] },
        { name: 'list', seconds: 2, setup: [{ scrollTo: '#rooms' }, { scrollTop: 0 }], move: { scroll: { by: 500 } } },
        { name: 'search', seconds: 2, move: { type: { target: '#q', text: 'مطبخ' } } },
        { name: 'point', seconds: 1, move: { hover: { from: [0, 0], to: [100, 100] } } },
      ],
    })
    expect(r.viewport).toEqual({ w: 1280, h: 960 })
    expect([r.scale, r.fps, r.wait]).toEqual([1.5, 25, 2500])
    expect(r.shots[3]!.setup[0]).toEqual({ check: 'السقف', on: true })
  })
  it('refuses a repeated shot name, a bad name and an unknown step', () => {
    expect(() => recordRecipeSchema.parse({ url: 'x', shots: [{ name: 'a', seconds: 1 }, { name: 'a', seconds: 1 }] })).toThrow(/twice/)
    expect(() => recordRecipeSchema.parse({ url: 'x', shots: [{ name: 'Orbit 1', seconds: 1 }] })).toThrow()
    expect(() => recordRecipeSchema.parse({ url: 'x', shots: [{ name: 'a', seconds: 1, setup: [{ login: 'me' }] }] })).toThrow()
  })
  it('eases moves in and out and counts frames', () => {
    expect(easeMove(0)).toBe(0)
    expect(easeMove(1)).toBe(1)
    expect(easeMove(0.5)).toBeCloseTo(0.5)
    expect(easeMove(0.1)).toBeLessThan(0.1)
    expect(shotFrames(1.6, 25)).toBe(40)
    expect(shotFrames(0.01, 25)).toBe(1)
  })
})
