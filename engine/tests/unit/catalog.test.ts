import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CATALOG, isInternal, STYLES } from '../../src/core/catalog'
import { effectsMd, skillCatalogMd } from '../../src/core/catalog-docs'
import { ARABIC_MOVES } from '../../src/core/params/arabic-move'
import { TRANSITION_IDS } from '../../src/core/params/transitions'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { LOOK_IDS } from '../../src/core/storyboard'

const root = resolve(__dirname, '..', '..', '..')
const effectsDir = resolve(root, 'media', 'effects')
const norm = (s: string) => s.replace(/\r\n/g, '\n')

describe('effects catalog', () => {
  it('names only real scene types, moves and transitions, each once', () => {
    const ids = CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      const [type, variant] = id.split(':')
      if (type === 'transition') expect(TRANSITION_IDS, id).toContain(variant)
      else expect(PRIMITIVE_IDS as readonly string[], id).toContain(type)
      if (type === 'arabic-move') expect(ARABIC_MOVES as readonly string[], id).toContain(variant)
    }
  })

  it('lists every scene type, every Arabic move and every transition', () => {
    const types = new Set(CATALOG.map((e) => e.id.split(':')[0]))
    const missing = PRIMITIVE_IDS.filter((p) => !isInternal(p) && !types.has(p))
    expect(missing).toEqual([])
    for (const m of ARABIC_MOVES) expect(CATALOG.map((e) => e.id), m).toContain(`arabic-move:${m}`)
    for (const t of TRANSITION_IDS) expect(CATALOG.map((e) => e.id), t).toContain(`transition:${t}`)
  })

  it('every preview exists, and every preview image is used', () => {
    const used = new Set([...CATALOG.map((e) => e.img), ...STYLES.map((s) => s.img)].filter(Boolean))
    for (const name of used) expect(existsSync(resolve(effectsDir, `${name}.jpg`)), String(name)).toBe(true)
    const files = readdirSync(effectsDir).map((f) => f.replace(/\.jpg$/, ''))
    expect(files.filter((f) => !used.has(f))).toEqual([])
  })

  it('styles use real looks and scene types', () => {
    for (const s of STYLES) {
      expect(LOOK_IDS as readonly string[]).toContain(s.look)
      for (const w of s.with ?? []) expect(PRIMITIVE_IDS as readonly string[]).toContain(w)
    }
  })

  it('EFFECTS.md and skill catalog.md are up to date (run: npx tsx scripts/catalog.ts)', () => {
    expect(norm(readFileSync(resolve(root, 'EFFECTS.md'), 'utf8'))).toBe(effectsMd())
    expect(norm(readFileSync(resolve(root, 'skill', 'motion-bilarabi', 'catalog.md'), 'utf8'))).toBe(skillCatalogMd())
  })
})
