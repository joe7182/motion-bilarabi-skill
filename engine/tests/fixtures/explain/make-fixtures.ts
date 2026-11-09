// Regenerates the binary fixtures of the explainer e2e (tests/browser/explain-e2e.spec.ts) from
// transcript.json, deterministically: `npx tsx tests/fixtures/explain/make-fixtures.ts`.
// - voice.wav: 20 s, 16 kHz mono s16. A stand-in "voice": band-limited noise (≈ 250–3000 Hz) in a
//   burst on each word's [start, end] of transcript.json (10 ms fades, a slow syllable wobble),
//   silence between words. Seeded LCG noise, so the bytes never change.
// - screen-1.png, screen-2.png: two portrait "app screenshots" (flat colour blocks) for the
//   product-launch run; each has its own dominant colour so a still can tell them apart.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const DIR = fileURLToPath(new URL('.', import.meta.url))
export const VOICE_SEC = 20
export const VOICE_RATE = 16_000
/** Dominant colour of each screen (RGB). */
export const SCREEN_COLOURS = [
  [25, 195, 166],
  [124, 77, 255],
] as const

interface Word { start: number; end: number }

/** One-pole high-pass + two-pole low-pass (RBJ biquad) over seeded white noise. */
function bandNoise(n: number, rate: number, seed: number): Float64Array {
  let s = seed >>> 0
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 31 - 1
  }
  const out = new Float64Array(n)
  // High-pass ~250 Hz.
  const a = Math.exp((-2 * Math.PI * 250) / rate)
  let hpX = 0
  let hpY = 0
  // Low-pass 3000 Hz, Q 0.707.
  const w0 = (2 * Math.PI * 3000) / rate
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2)
  const cos = Math.cos(w0)
  const a0 = 1 + alpha
  const b0 = (1 - cos) / 2 / a0
  const b1 = (1 - cos) / a0
  const b2 = b0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < n; i++) {
    const x = rnd()
    hpY = a * (hpY + x - hpX)
    hpX = x
    const y = b0 * hpY + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = hpY
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

export function voiceWav(words: readonly Word[]): Buffer {
  const n = VOICE_SEC * VOICE_RATE
  const noise = bandNoise(n, VOICE_RATE, 12345)
  let peak = 0
  for (const v of noise) peak = Math.max(peak, Math.abs(v))
  const env = new Float64Array(n)
  const fade = 0.01
  for (const w of words) {
    const a = Math.round(w.start * VOICE_RATE)
    const b = Math.min(n, Math.round(w.end * VOICE_RATE))
    for (let i = a; i < b; i++) {
      const t = i / VOICE_RATE
      const edge = Math.min(1, (t - w.start) / fade, (w.end - t) / fade)
      // Two "syllables" per word.
      const wobble = 0.65 + 0.35 * Math.abs(Math.sin((Math.PI * 2 * (t - w.start)) / (w.end - w.start)))
      env[i] = Math.max(0, edge) * wobble
    }
  }
  const data = Buffer.alloc(n * 2)
  // ≈ −12 dBFS peaks inside bursts.
  const gain = (0.25 / peak) * 32767
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(noise[i]! * env[i]! * gain))), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(VOICE_RATE, 24)
  h.writeUInt32LE(VOICE_RATE * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

export function screenPng(k: 0 | 1): Buffer {
  const w = 540
  const h = 1170
  const png = new PNG({ width: w, height: h })
  const [r, g, b] = SCREEN_COLOURS[k]
  const fill = (x0: number, y0: number, x1: number, y1: number, c: readonly number[]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) png.data.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4)
  }
  fill(0, 0, w, h, [r, g, b])
  fill(0, 0, w, 120, [255, 255, 255]) // header
  for (let row = 0; row < 4; row++) fill(40, 220 + row * 200, w - 40, 220 + row * 200 + 140, [245, 245, 245]) // cards
  if (k === 1) fill(140, 1020, 400, 1100, [255, 90, 31]) // a button
  return PNG.sync.write(png)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const t = JSON.parse(readFileSync(`${DIR}transcript.json`, 'utf8')) as { words: Word[] }
  writeFileSync(`${DIR}voice.wav`, voiceWav(t.words))
  writeFileSync(`${DIR}screen-1.png`, screenPng(0))
  writeFileSync(`${DIR}screen-2.png`, screenPng(1))
  process.stdout.write('voice.wav, screen-1.png, screen-2.png\n')
}
