import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { voiceLevels } from '../../src/node/audio'

const RATE = 16000

/** A mono 16-bit PCM WAV of `sec` seconds: 440 Hz sine bursts of amplitude `amp` over [from, to), silence elsewhere. */
function burstWav(sec: number, bursts: { from: number; to: number; amp: number }[]): Buffer {
  const n = Math.round(sec * RATE)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const b = bursts.find((x) => t >= x.from && t < x.to)
    const v = b ? b.amp * Math.sin(2 * Math.PI * 440 * t) : 0
    data.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0, 'latin1')
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVE', 8, 'latin1')
  head.write('fmt ', 12, 'latin1')
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(RATE, 24)
  head.writeUInt32LE(RATE * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36, 'latin1')
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

describe('voiceLevels (Task 6b: microphone bars and timeline waveform)', () => {
  it('RMS per 1/30 s frame over [from, to), normalised by the 95th percentile and clamped to 0..1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mba levels %'))
    try {
      // silence 0–0.3, loud 0.3–0.6, silence 0.6–0.8, half as loud 0.8–1.0
      const wav = join(dir, 'بصوت voice.wav')
      await writeFile(wav, burstWav(1, [{ from: 0.3, to: 0.6, amp: 0.5 }, { from: 0.8, to: 1.0, amp: 0.25 }]))
      const lv = await voiceLevels(wav, 0, 1)
      expect(lv).toHaveLength(30)
      for (const v of lv) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
      // frames well inside each part (frame i covers [i/30, (i+1)/30))
      for (const i of [1, 5, 19, 22]) expect(lv[i]!, `silent frame ${i}`).toBeLessThan(0.02)
      for (const i of [10, 13, 16]) expect(lv[i]!, `loud frame ${i}`).toBeGreaterThan(0.97)
      for (const i of [25, 28]) expect(lv[i]!, `quiet frame ${i}`).toBeCloseTo(0.5, 1)
      // a window inside the loud burst: every frame at the top; another fps gives another frame count
      const loud = await voiceLevels(wav, 0.35, 0.55)
      expect(loud).toHaveLength(6)
      for (const v of loud) expect(v).toBeGreaterThan(0.97)
      expect(await voiceLevels(wav, 0, 1, 10)).toHaveLength(10)
      // pure: the same call gives the same values
      expect(await voiceLevels(wav, 0, 1)).toEqual(lv)
      // all silence: zeros, no division by zero
      expect(await voiceLevels(wav, 0, 0.25)).toEqual(new Array(8).fill(0))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('rejects an empty span and a missing file (Arabic first)', async () => {
    await expect(voiceLevels(join(tmpdir(), 'mba-no-such-file.wav'), 0, 1)).rejects.toThrow(/^[؀-ۿ].* — /)
    await expect(voiceLevels('x.wav', 1, 1)).rejects.toThrow(/^[؀-ۿ].* — /)
  })
})
