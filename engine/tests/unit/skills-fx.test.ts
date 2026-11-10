import { describe, expect, it } from 'vitest'
import { skillDeckParams, twinSyncParams } from '../../src/core/params/skills-fx'

describe('skill explainers (skill-deck, twin-sync)', () => {
  it('skill-deck: 1–5 skills, 1–3 docks; nothing preloaded by default', () => {
    const p = skillDeckParams.parse({ skills: [{ name: 'review', ver: 'v2.1' }], docks: [{ name: 'Claude Code' }, { name: 'Cursor' }] })
    expect(p.preloaded).toEqual([])
    expect(() => skillDeckParams.parse({ skills: [], docks: [{ name: 'x' }] })).toThrow()
    expect(() => skillDeckParams.parse({ skills: [{ name: 'a' }], docks: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] })).toThrow()
  })
  it('twin-sync: the lock file defaults to apm.lock.yaml', () => {
    expect(twinSyncParams.parse({ rows: [{ name: 'review' }] }).lock).toBe('apm.lock.yaml')
  })
})
