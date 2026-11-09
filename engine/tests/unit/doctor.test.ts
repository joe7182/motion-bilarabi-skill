import { describe, expect, it } from 'vitest'
import { doctorReport, type Check } from '../../src/node/doctor'
import { parseBrand } from '../../src/core/brand'
import { readFileSync } from 'node:fs'

const c = (id: string, ok: boolean, need: 'required' | 'optional' = 'required'): Check => ({ id, need, ok, ar: `فحص ${id}`, en: `check ${id}`, fix: { terminal: `fix ${id}`, claude: `أصلح ${id}` } })

describe('mba doctor', () => {
  it('ready when every required check passes; a missing optional only gets its fix, both ways', () => {
    const r = doctorReport([c('node', true), c('brand', false, 'optional')])
    expect(r.ok).toBe(true)
    expect(r.text).toContain('fix brand')
    expect(r.text).toContain('«أصلح brand»')
    expect(r.text).not.toContain('fix node')
  })
  it('not ready when a required check fails', () => {
    expect(doctorReport([c('ffmpeg', false)]).ok).toBe(false)
  })
  it('the brand template in examples/ is a valid brand', () => {
    expect(parseBrand(JSON.parse(readFileSync('examples/brand.json', 'utf8'))).keyword).toBe('موشن')
  })
})
