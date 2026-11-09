import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MALLET_HZ, SFX_RECIPE, sfxWav, synthSfx } from '../../src/node/sfx-synth'
import { measureLoudness, sourceGain, SOURCE_REF_LUFS } from '../../src/node/audio'
import { SFX_NAMES } from '../../src/core/storyboard'

const RATE = 48000

/** Frequency estimate from the zero crossings of `x[a, b)`. */
function zcHz(x: Float32Array, a: number, b: number): number {
  let n = 0
  let first = -1
  let last = -1
  for (let i = a + 1; i < b; i++) {
    if ((x[i - 1]! < 0 && x[i]! >= 0) || (x[i - 1]! >= 0 && x[i]! < 0)) {
      if (first < 0) first = i
      last = i
      n++
    }
  }
  return ((n - 1) / 2) / ((last - first) / RATE)
}

const rms = (x: Float32Array, a: number, b: number) => {
  let s = 0
  for (let i = a; i < b; i++) s += x[i]! * x[i]!
  return Math.sqrt(s / (b - a))
}
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

describe('synthSfx', () => {
  it('is deterministic: the same name and variant give byte-identical samples', () => {
    const a = synthSfx('mallet', { rate: RATE, variant: 2 })
    const b = synthSfx('mallet', { rate: RATE, variant: 2 })
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true)
    for (const name of SFX_NAMES) {
      const x = synthSfx(name, { rate: RATE, variant: 1 })
      expect(Buffer.from(x.buffer).equals(Buffer.from(synthSfx(name, { rate: RATE, variant: 1 }).buffer))).toBe(true)
      expect(peak(x)).toBeGreaterThan(0.05)
      expect(peak(x)).toBeLessThanOrEqual(1)
    }
  })
  it('mallet: constant pitch (first vs last 50 ms within 2 %), 5 variants = the 5 pentatonic notes', () => {
    const hz: number[] = []
    for (let v = 0; v < 5; v++) {
      const x = synthSfx('mallet', { rate: RATE, variant: v })
      const head = zcHz(x, 0, 0.05 * RATE)
      const tail = zcHz(x, x.length - 0.05 * RATE, x.length)
      expect(Math.abs(head - tail) / head).toBeLessThan(0.02)
      expect(Math.abs(head - MALLET_HZ[v]!) / MALLET_HZ[v]!).toBeLessThan(0.02)
      hz.push(head)
    }
    expect(new Set(hz.map((h) => Math.round(h))).size).toBe(5)
    expect(MALLET_HZ).toHaveLength(5)
  })
  it('tap, tick, key: no glide either', () => {
    for (const name of ['tap', 'tick', 'key'] as const) {
      const x = synthSfx(name, { rate: RATE, variant: 0 })
      const from = Math.round(0.005 * RATE) // after the key's 3 ms noise transient
      const half = Math.floor((from + x.length) / 2)
      const a = zcHz(x, from, half)
      const b = zcHz(x, half, x.length)
      expect(Math.abs(a - b) / a, name).toBeLessThan(0.05)
    }
  })
  it('riser: lasts the given duration and ends at full level (last 10 ms RMS ≥ 0.5 × peak)', () => {
    const x = synthSfx('riser', { rate: RATE, variant: 0, duration: 0.6 })
    expect(x.length).toBe(0.6 * RATE)
    expect(rms(x, x.length - 0.01 * RATE, x.length)).toBeGreaterThanOrEqual(0.5 * peak(x))
  })
  it('impact: a thump of at most 0.4 s', () => {
    expect(synthSfx('impact', { rate: RATE, variant: 0 }).length).toBeLessThanOrEqual(0.4 * RATE)
  })
})

describe('sfxWav (cached WAV, levelled like user SFX)', () => {
  it('writes work/sfx/<name>-<variant>-<SFX_RECIPE>.wav once; after R12 levelling it sits at the source reference', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mba sfx %'))
    try {
      for (const name of ['key', 'mallet', 'impact', 'riser'] as const) {
        const w = await sfxWav(dir, name, 1)
        expect(w.path).toBe(join(dir, 'work', 'sfx', `${name}-1-${SFX_RECIPE}.wav`))
        const bytes = await readFile(w.path)
        expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
        expect((await sfxWav(dir, name, 1)).durationSec).toBe(w.durationSec)
        const m = await measureLoudness(w.path)
        expect(m.i, name).toBeGreaterThan(-70)
        // the same correction user SFX get (sourceGain), not capped: levelled = reference
        expect(SOURCE_REF_LUFS - m.i, name).toBeLessThan(24)
        expect(m.i + sourceGain(m.i)).toBeCloseTo(SOURCE_REF_LUFS, 6)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
