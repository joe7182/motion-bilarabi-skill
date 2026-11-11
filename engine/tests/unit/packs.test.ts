import { describe, expect, it } from 'vitest'
import { PACKS, getPack, packList } from '../../src/packs/index'
import { PACK_IDS, PACK_ROLES, packSchema, paramKeysOf } from '../../src/packs/schema'
import { TRANSITION_IDS } from '../../src/core/params/transitions'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'

describe('packs', () => {
  it('every pack parses and is registered under its id', () => {
    for (const id of PACK_IDS) expect(packSchema.parse(PACKS[id]).id).toBe(id)
  })
  it('numbers are 1..n with no gap', () => {
    expect(packList().map((p) => p.n)).toEqual(PACK_IDS.map((_, i) => i + 1))
  })
  it('no two packs share the same signature', () => {
    const sig = packList().map((p) => [Math.round(p.layout.headline.y * 10), p.layout.headline.align, p.layout.keyMark, p.transitions.default].join('|'))
    expect(new Set(sig).size).toBe(sig.length)
  })
  it('every transition id exists and none is both used and avoided', () => {
    for (const p of packList()) {
      const used = [p.transitions.default, p.transitions.section, ...p.transitions.more]
      for (const t of [...used, ...p.avoid.transitions]) expect(TRANSITION_IDS as readonly string[]).toContain(t)
      expect(used.filter((t) => p.avoid.transitions.includes(t))).toEqual([])
      expect(new Set(used).size).toBe(used.length)
    }
  })
  it('every role names a scene type and only params that type has', () => {
    for (const p of packList()) {
      for (const role of PACK_ROLES) {
        const r = p.roles[role]
        expect(PRIMITIVE_IDS as readonly string[], `${p.id}.${role}`).toContain(r.type)
        const keys = paramKeysOf(r.type)
        for (const k of Object.keys(r.params)) expect(keys, `${p.id}.${role}.${k}`).toContain(k)
        expect(p.avoid.scenes).not.toContain(r.type)
      }
    }
  })
  it('every background scene type is a primitive and the gap is at least 0.04', () => {
    for (const p of packList()) {
      expect(p.background.length).toBeGreaterThan(0)
      for (const b of p.background) {
        expect(PRIMITIVE_IDS as readonly string[]).toContain(b.type)
        for (const k of Object.keys(b.params)) expect(paramKeysOf(b.type)).toContain(k)
      }
      expect(p.layout.gap).toBeGreaterThanOrEqual(0.04)
    }
  })
  it('getPack takes an id or a number and names the valid ids when it fails', () => {
    expect(getPack('swiss-red').n).toBe(4)
    expect(getPack('2').id).toBe('dark-tech')
    expect(() => getPack('nope')).toThrow(/signature-cream/)
  })
})
