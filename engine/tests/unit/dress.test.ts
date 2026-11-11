import { describe, expect, it } from 'vitest'
import { PARAMS, validateSceneParams } from '../../src/core/params/index'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { parseStoryboard } from '../../src/core/storyboard'
import { recommend, sentenceOf } from '../../src/library/concepts'
import { dressStoryboard } from '../../src/packs/dress'
import { PACKS, packList } from '../../src/packs/index'

type Sc = { id: string; type: string; track: number; params: Record<string, unknown> }
const kt = (id: string, start: number, over: object = {}) => ({ id, type: 'kinetic-text', track: 2, start, duration: 2, params: { mode: 'line', words: [{ text: 'كلمة', at: 0.1 }], ...over } })
const raw = () => ({
  version: 1,
  fps: 30,
  scenes: [kt('a', 0), kt('b', 2, { y: 0.4, align: 'left' }), { id: 'g', type: 'spring-graph', track: 3, start: 2, duration: 2, params: { values: [1, 2, 3] } }] as Record<string, unknown>[],
})

describe('dressStoryboard', () => {
  it('gives a valid storyboard for every pack and is idempotent', () => {
    for (const p of packList()) {
      const one = dressStoryboard(raw(), p)
      expect(one.changes.length).toBeGreaterThan(0)
      validateSceneParams(parseStoryboard(structuredClone(one.storyboard), PRIMITIVE_IDS))
      const two = dressStoryboard(one.storyboard, p)
      expect(two.changes).toEqual([])
      expect(two.storyboard).toEqual(one.storyboard)
    }
  })
  it('fills what is open and leaves what is set', () => {
    const { storyboard } = dressStoryboard(raw(), PACKS['dark-tech'])
    const sc = storyboard.scenes as Sc[]
    expect(sc.find((s) => s.id === 'a')!.params.align).toBe('right')
    expect(sc.find((s) => s.id === 'b')!.params).toMatchObject({ y: 0.4, align: 'left' })
    expect(sc[0]!.type).toBe('tech-grid')
    expect(sc.some((s) => s.type === 'frame-marks')).toBe(true)
    expect(storyboard.look).toBe('dark-tech')
    expect((storyboard.transitions as { type: string; track: number }[])[0]).toMatchObject({ type: 'glitch-cut', track: 2 })
  })
  it('keeps a look, a transition and a background that are already there', () => {
    const r = { ...raw(), look: 'signature', transitions: [{ type: 'iris', at: 2, track: 2, duration: 0.4, params: {} }] }
    r.scenes.unshift({ id: 'bg', type: 'backdrop', track: 0, start: 0, duration: 4, params: { world: 'ink' } })
    const { storyboard } = dressStoryboard(r, PACKS['swiss-red'])
    expect(storyboard.look).toBe('signature')
    expect((storyboard.transitions as unknown[]).length).toBe(1)
    expect((storyboard.scenes as Sc[]).filter((s) => s.type === 'backdrop').length).toBe(1)
  })
  it('with word-anchor times it only sets what needs no clock', () => {
    const r = { version: 1, scenes: [{ ...kt('a', 0), start: '@word:3' }] }
    const { storyboard, changes } = dressStoryboard(r, PACKS['swiss-red'])
    expect((storyboard.scenes as unknown[]).length).toBe(1)
    expect(changes.join(' ')).toMatch(/anchors/)
  })
  it('recommend with a pack still builds valid scenes', () => {
    const recs = recommend(sentenceOf('كل كلمة لها حركة', 0, 2.4), 9, PACKS['swiss-red'])
    expect(recs.length).toBeGreaterThan(0)
    for (const r of recs) for (const sc of r.scenes) expect((PARAMS as Record<string, { safeParse: (x: unknown) => { success: boolean } }>)[sc.type]!.safeParse(sc.params).success, r.id).toBe(true)
  })
})
