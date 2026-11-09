import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMixArgs, measureLoudness, mixAudio, parseLoudnormJson, pass2Plan, trackSamples, type ResolvedClip } from '../../src/node/audio'
import { resolveFfmpeg, resolveFfprobe } from '../../src/node/tools'

// Fix wave I1 (node-side ffmpeg, no page): a mix whose true peak sits near the limit made
// `loudnorm … linear=true` fall back to dynamic mode, which shifted the timestamps; the track came
// out short and the mux dropped 3 frames of a 775-frame render. The track must be exactly
// `total` s long by sample count, normalized linearly, under the true-peak limit.
test.describe.configure({ mode: 'serial', timeout: 120_000 })

const TOTAL = 775 / 30
let dir: string

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mba-audio-len-'))
})
test.afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

function samplesOf(file: string): number {
  const r = spawnSync(resolveFfprobe(), ['-v', 'error', '-count_packets', '-select_streams', 'a:0', '-show_entries', 'stream=duration_ts', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return Number(r.stdout.trim())
}

test('a near-limit true peak: exact sample count, linear normalization, true peak ≤ −1 dBTP', async () => {
  const src = join(dir, 'voice.wav')
  // A swelling tone with 20 ms bursts every 0.5 s: peaks near the mix limiter, about −16.6 LUFS (the +2.6 dB gain would pass −1.5 dBTP).
  const sig = 'aevalsrc=0.15*(1+0.6*sin(2*PI*0.15*t))*sin(2*PI*440*t)+0.8*lt(mod(t\\,0.5)\\,0.02)*sin(2*PI*1000*t):s=48000:d=25'
  const g = spawnSync(resolveFfmpeg(), ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', sig, '-ac', '2', src], { encoding: 'utf8' })
  expect(g.status, g.stderr).toBe(0)
  const clips: ResolvedClip[] = [{ id: 'a0', bus: 'voice', input: src, in: 0, duration: 25, speed: 1, at: 0, gain: 0, fadeIn: 0, fadeOut: 0 }]

  // The pass-1 measurement leaves less true-peak room than the gain needs: without the pass-2
  // limit loudnorm would run dynamically (the failure this test guards against).
  const p1 = spawnSync(resolveFfmpeg(), buildMixArgs({ clips, total: TOTAL, out: join(dir, 'probe.wav') }), { encoding: 'utf8' })
  expect(p1.status, p1.stderr.slice(-500)).toBe(0)
  const m = parseLoudnormJson(p1.stderr)
  expect(m.tp + (-14 - m.i)).toBeGreaterThan(-1.5)
  expect(pass2Plan(m).limitDb).toBeDefined()

  const out = join(dir, 'audio.wav')
  const r = await mixAudio(clips, TOTAL, out)
  expect(r.normalization).toBe('linear')
  expect(r.warnings).toEqual([])
  expect(samplesOf(out)).toBe(trackSamples(TOTAL))
  const loud = await measureLoudness(out)
  expect(Math.abs(loud.i + 14)).toBeLessThanOrEqual(1)
  expect(loud.tp).toBeLessThanOrEqual(-1)
})

/** Peak (0..1) of `file` between `from` and `to` s. */
function peakOf(file: string, from: number, to: number): number {
  const r = spawnSync(resolveFfmpeg(), ['-v', 'error', '-ss', String(from), '-t', String(to - from), '-i', file, '-ac', '1', '-f', 's16le', '-'], { maxBuffer: 1 << 28 })
  expect(r.status, String(r.stderr)).toBe(0)
  const pcm = r.stdout as Buffer
  let peak = 0
  for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)))
  return peak / 32768
}

test('one input feeding several delayed clips (planned SFX, two cuts of a clip): sound to the end, exact length', async () => {
  // A sample-count trim on the mix graph once stopped this mix at 3.5 s of 14 (silence after it).
  const src = join(dir, 'tone.wav')
  const g = spawnSync(resolveFfmpeg(), ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=20,volume=4', '-ac', '2', src], { encoding: 'utf8' })
  expect(g.status, g.stderr).toBe(0)
  const clip = (id: string, inSec: number, duration: number, at: number): ResolvedClip => ({ id, bus: 'voice', input: src, in: inSec, duration, speed: 1, at, gain: 0, fadeIn: 0, fadeOut: 0 })
  const out = join(dir, 'two-cuts.wav')
  const r = await mixAudio([clip('c1', 2, 8, 0), clip('c2', 12, 6, 8)], 14, out)
  expect(r.normalization).toBe('linear')
  expect(samplesOf(out)).toBe(trackSamples(14))
  for (const [a, b] of [[1, 7], [9, 13]] as const) expect(peakOf(out, a, b), `${a}–${b} s`).toBeGreaterThan(0.1)
})
