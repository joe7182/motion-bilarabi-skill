import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loopPeriod } from '../../src/core/loop'
import { loopSeam } from '../../src/node/loop-seam'

describe('loopPeriod', () => {
  it('fits a whole number of sways into the loop', () => {
    for (const [p, T] of [[11, 41.7], [13, 20], [9, 7], [12, 120]] as const) {
      const q = loopPeriod(p, T)
      const sways = T / (2 * q)
      expect(Math.abs(sways - Math.round(sways))).toBeLessThan(1e-9)
      expect(sways).toBeGreaterThanOrEqual(1)
    }
    expect(loopPeriod(11, 41.7)).toBeCloseTo(10.425, 3)
  })
  it('leaves the period alone without a loop length', () => {
    expect(loopPeriod(11, 0)).toBe(11)
  })
})

describe('loopSeam', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mba-seam-'))
  const make = (name: string, src: string) => {
    const f = join(dir, name)
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-t', '1', '-pix_fmt', 'yuv420p', f])
    return f
  }
  it('passes a clip whose first and last frames match', () => {
    expect(loopSeam(make('still.mp4', 'color=c=0x223344:s=320x240:r=30')).ok).toBe(true)
  })
  it('flags a clip that ends on another picture', () => {
    const r = loopSeam(make('fade.mp4', 'color=c=0x223344:s=320x240:r=30,fade=out:st=0:d=1'))
    expect(r.ok).toBe(false)
    expect(r.db).toBeLessThan(35)
  })
})
