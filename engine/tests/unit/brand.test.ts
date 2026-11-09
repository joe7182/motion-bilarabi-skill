import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseBrand } from '../../src/core/brand'
import { loadBrand, saveBrand } from '../../src/node/brand-fs'

const good = { name: 'يوسف', handle: '@yousif_aljbouri', colors: { primary: '#ff5a1f', secondary: '#111111', bg: '#0e0d0c', text: '#f2ece2' } }

describe('brand', () => {
  it('watermark defaults false', () => { expect(parseBrand(good).watermark).toBe(false) })
  it('rejects non-hex colour', () => {
    expect(() => parseBrand({ ...good, colors: { ...good.colors, primary: 'orange' } })).toThrow()
  })
  it('fs round-trip in a dir with space and Arabic', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mba test تجربة-'))
    try {
      expect(await loadBrand(dir, dir)).toBeNull()
      const b = parseBrand({ ...good, watermark: true })
      await saveBrand(dir, b)
      const raw = await readFile(join(dir, 'mba-brand.json'), 'utf8')
      expect(raw).toBe(JSON.stringify(b, null, 2) + '\n')
      expect(await loadBrand(dir, dir)).toEqual(b)
      await writeFile(join(dir, 'mba-brand.json'), '\uFEFF' + raw, 'utf8')
      expect(await loadBrand(dir, dir)).toEqual(b)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('falls back to the personal ~/.mba/brand.json; the project file wins; links, avatar and keyword validate', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mba home-'))
    const dir = await mkdtemp(join(tmpdir(), 'mba proj-'))
    try {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(home, '.mba'), { recursive: true })
      const mine = { ...good, avatar: 'me.jpg', links: { instagram: '@yousif', site: 'example.com' }, keyword: 'موشن' }
      await writeFile(join(home, '.mba', 'brand.json'), JSON.stringify(mine), 'utf8')
      expect((await loadBrand(dir, home))?.links?.instagram).toBe('@yousif')
      await saveBrand(dir, parseBrand(good))
      expect((await loadBrand(dir, home))?.links).toBeUndefined()
      expect(() => parseBrand({ ...good, keyword: '' })).toThrow()
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  })
})
