import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { rng } from '../core/rng'
import type { SfxName } from '../core/storyboard'
import { RISER_SEC } from '../core/params/transitions'
import { couldNotWrite, renameWithRetry } from './fsx'

/**
 * The built-in sound effects (spec §13.5, §17.5, §17.9), synthesized sample by sample: pure and
 * deterministic (seeded `rng`, no `Math.random`). UI sounds (`tap`, `mallet`, `tick`, `key`) hold
 * one pitch and decay exponentially: no pitch slides. Levels are left to the mix: like user SFX,
 * every synth WAV is measured and brought to SOURCE_REF_LUFS (R12, `resolveAudioClips`), then the
 * clip gain applies; the peaks here only keep that correction small (< MAX_SOURCE_BOOST).
 */

/** Bump when any sound changes: it names the cached WAVs and goes into the job hash. */
export const SFX_RECIPE = 'sfx1'

/** Mallet notes: a C major pentatonic (C5 D5 E5 G5 A5), one per variant (mod 5). */
export const MALLET_HZ = [523.25, 587.33, 659.25, 783.99, 880] as const

export { RISER_SEC }

/** Length of the `count` loop when the caller gives none (s). */
export const COUNT_SEC = 3

/** Effects whose length is a parameter (in the cache name and the job hash). */
const SIZED: ReadonlySet<SfxName> = new Set(['count'])

/**
 * The cache/hash key of an effect: `<name>-<variant>-<SFX_RECIPE>`, and for `count` (synthesized
 * at the roll's length) `<name>-<variant>-<len>s-<SFX_RECIPE>`.
 */
export function sfxKey(name: SfxName, variant = 0, lengthSec?: number): string {
  const len = SIZED.has(name) ? `${Number((lengthSec ?? COUNT_SEC).toFixed(3))}s-` : ''
  return `${name}-${variant}-${len}${SFX_RECIPE}`
}

const TAU = Math.PI * 2

/** A seed for (name, variant): FNV-1a of the name, mixed with the variant. */
function seedOf(name: string, variant: number): number {
  let h = 0x811c9dc5
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193)
  return (h ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0
}

/** Constant-pitch decaying sine of `len` s (2 ms linear attack). */
function pluck(rate: number, len: number, hz: number, tau: number, amp: number): Float32Array {
  const n = Math.round(len * rate)
  const x = new Float32Array(n)
  const att = 0.002 * rate
  for (let i = 0; i < n; i++) {
    const t = i / rate
    x[i] = amp * Math.min(1, i / att) * Math.exp(-t / tau) * Math.sin(TAU * hz * t)
  }
  return x
}

function scaleToPeak(x: Float32Array, p: number): Float32Array {
  let m = 0
  for (const v of x) m = Math.max(m, Math.abs(v))
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i]! / m) * p
  return x
}

/**
 * One effect as mono samples in [−1, 1] at `o.rate`. `variant` picks a mallet note (mod 5) and
 * small constant-pitch differences elsewhere; `duration` is the riser's or the count roll's length.
 */
export function synthSfx(name: SfxName, o: { rate: 48000; variant: number; duration?: number }): Float32Array {
  const { rate } = o
  const v = Math.max(0, Math.floor(o.variant))
  const r = rng(seedOf(name, v))
  switch (name) {
    case 'tick':
      return pluck(rate, 0.04, 2400 + 60 * (v % 3), 0.008, 0.5)
    case 'key': {
      // A short click: a constant 1.9 kHz body plus a very short noise transient on top.
      const x = pluck(rate, 0.045, 1900 + 80 * (v % 4), 0.01, 0.45)
      const burst = Math.round(0.003 * rate)
      for (let i = 0; i < burst; i++) x[i] = x[i]! + 0.15 * (r() * 2 - 1) * (1 - i / burst)
      return x
    }
    case 'tap':
      return pluck(rate, 0.12, 740 + 40 * (v % 3), 0.03, 0.5)
    case 'mallet':
      return pluck(rate, 0.4, MALLET_HZ[v % MALLET_HZ.length]!, 0.12, 0.5)
    case 'count': {
      // A roll: soft ticks at 16 per second for the whole roll (`duration`, default COUNT_SEC).
      const n = Math.round((o.duration ?? COUNT_SEC) * rate)
      const x = new Float32Array(n)
      const tick = pluck(rate, 0.03, 2000, 0.006, 0.4)
      const step = Math.round(rate / 16)
      for (let s = 0, k = 0; s + tick.length <= n; s += step, k++) {
        const a = k % 2 === 0 ? 1 : 0.8
        for (let i = 0; i < tick.length; i++) x[s + i] = x[s + i]! + a * tick[i]!
      }
      return x
    }
    case 'chime': {
      // Two bell partials (E6 + B6), long decay.
      const n = Math.round(1.2 * rate)
      const x = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const t = i / rate
        const e = Math.min(1, i / (0.003 * rate))
        x[i] = e * (0.6 * Math.exp(-t / 0.35) * Math.sin(TAU * 1318.5 * t) + 0.35 * Math.exp(-t / 0.22) * Math.sin(TAU * 1975.5 * t))
      }
      return scaleToPeak(x, 0.5)
    }
    case 'riser': {
      // Low-passed noise opening up + a rising saturated tone; the level climbs to full on the
      // last sample (it ends exactly on the cut).
      const len = o.duration ?? RISER_SEC
      const n = Math.round(len * rate)
      const x = new Float32Array(n)
      let lp = 0
      let phase = 0
      for (let i = 0; i < n; i++) {
        const u = (i + 1) / n
        const hz = 180 * Math.pow(900 / 180, u)
        phase += (TAU * hz) / rate
        const a = Math.min(0.99, 0.02 + 0.5 * u * u)
        lp += a * (r() * 2 - 1 - lp)
        const tone = Math.tanh(2.5 * Math.sin(phase)) / Math.tanh(2.5)
        x[i] = Math.pow(u, 1.5) * (0.8 * tone + 0.2 * lp)
      }
      return scaleToPeak(x, 0.6)
    }
    case 'impact': {
      // A low thump (≤ 0.4 s): a 95 → 45 Hz body and a short noise attack.
      const n = Math.round(0.35 * rate)
      const x = new Float32Array(n)
      let phase = 0
      for (let i = 0; i < n; i++) {
        const t = i / rate
        phase += (TAU * (45 + 50 * Math.exp(-t / 0.04))) / rate
        const noise = i < 0.006 * rate ? 0.3 * (r() * 2 - 1) * (1 - i / (0.006 * rate)) : 0
        x[i] = Math.exp(-t / 0.09) * Math.sin(phase) + noise
      }
      return scaleToPeak(x, 0.7)
    }
  }
}

/** 16-bit PCM mono WAV bytes of `x`. */
export function wavBytes(x: Float32Array, rate: number): Buffer {
  const b = Buffer.alloc(44 + x.length * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + x.length * 2, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(x.length * 2, 40)
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), 44 + i * 2)
  return b
}

/**
 * The effect's WAV in `<projectDir>/work/sfx/<sfxKey>.wav`, written once (atomically) and reused
 * without synthesizing again (its length is read from the file size); returns its path and
 * length. The riser is always RISER_SEC long (clips play its end, `align: 'end'`); `count` is
 * synthesized at `lengthSec`.
 */
export async function sfxWav(projectDir: string, name: SfxName, variant = 0, lengthSec?: number): Promise<{ path: string; durationSec: number }> {
  const dir = join(projectDir, 'work', 'sfx')
  const path = join(dir, `${sfxKey(name, variant, lengthSec)}.wav`)
  const have = await stat(path).catch(() => null)
  if (have?.isFile() && have.size > 44) return { path, durationSec: (have.size - 44) / 2 / 48000 }
  const x = synthSfx(name, { rate: 48000, variant, ...(SIZED.has(name) && lengthSec !== undefined ? { duration: lengthSec } : {}) })
  const durationSec = x.length / 48000
  {
    const tmp = `${path}.${process.pid}.tmp`
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(tmp, wavBytes(x, 48000))
      await renameWithRetry(tmp, path)
    } catch (e) {
      throw couldNotWrite(path, e)
    }
  }
  return { path, durationSec }
}
