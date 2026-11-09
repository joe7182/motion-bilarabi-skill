import { test, expect } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initProject, openProject } from '../../src/node/project'
import { ingestProject } from '../../src/node/ingest'
import { measureLoudness } from '../../src/node/audio'
import { latestRender, verifyLoudness } from '../../src/node/verify'
import { resolveFfmpeg } from '../../src/node/tools'

// Node-side ffmpeg work (no page): real projects with a voice, user music and a short music file,
// rendered through `mba render --draft`, then measured. Serial; run this file alone.
test.describe.configure({ mode: 'serial', timeout: 240_000 })

const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const TOTAL = 12
/** Voice bursts (440 Hz sine) at [1, 5) and [8, 10) s; silence elsewhere. */
const VOICE_ON = 'between(t\\,1\\,5)+between(t\\,8\\,10)'
const VOICE_WINDOW = [3.2, 4.8] as const
const FREE_WINDOW = [6.0, 7.5] as const

let root: string
let media: string

function ff(args: string[]): Buffer {
  const r = spawnSync(resolveFfmpeg(), ['-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 30 })
  expect(r.status, String(r.stderr)).toBe(0)
  return r.stdout
}

/** Runs the CLI with node + tsx directly (no shell), so Arabic/space/% paths pass through untouched. */
function mba(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    proc.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    proc.once('close', (code) => res({ code, stdout, stderr }))
  })
}

async function unlock(d: string): Promise<void> {
  if (!existsSync(d)) return
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) await unlock(p)
    else await chmod(p, 0o644)
  }
}

/** The voice: stereo sine bursts, measured and re-made so its integrated loudness is `lufs`. */
async function makeVoice(file: string, lufs: number): Promise<void> {
  const make = (db: number) =>
    ff(['-f', 'lavfi', '-i', `sine=f=440:r=48000:samples_per_frame=48:d=${TOTAL},volume='if(${VOICE_ON}\\,1\\,0)':eval=frame,volume=${db}dB,aformat=channel_layouts=stereo`, '-c:a', 'pcm_s16le', file])
  make(0)
  const first = (await measureLoudness(file)).i
  make(lufs - first)
  expect(Math.abs((await measureLoudness(file)).i - lufs)).toBeLessThan(0.3)
}

/** Mono f32 samples of a file's audio at 48 kHz, after `af`. */
function samples(file: string, af = 'anull'): Float32Array {
  const raw = ff(['-i', file, '-vn', '-af', af, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'])
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
}

/** RMS (dBFS) of samples [a, b) s. */
function rmsDb(x: Float32Array, a: number, b: number): number {
  const i0 = Math.round(a * 48000)
  const i1 = Math.min(x.length, Math.round(b * 48000))
  let sum = 0
  for (let i = i0; i < i1; i++) sum += x[i]! * x[i]!
  return 10 * Math.log10(sum / Math.max(1, i1 - i0) + 1e-20)
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-audio-'))
  media = join(root, 'مصادر صوت 100%')
  await mkdir(media, { recursive: true })
  // Music: 60 s of pink noise (used from 0:32) and a 3 s music file (fades out at its own end).
  ff(['-f', 'lavfi', '-i', 'anoisesrc=c=pink:r=48000:a=0.3:seed=7:d=60', '-ac', '2', '-c:a', 'pcm_s16le', join(media, 'موسيقى طويلة.wav')])
  ff(['-f', 'lavfi', '-i', 'anoisesrc=c=brown:r=48000:a=0.3:seed=9:d=3', '-ac', '2', '-c:a', 'aac', '-b:a', '128k', join(media, 'short music %3.m4a')])
})
test.afterAll(async () => {
  await unlock(root)
  await rm(root, { recursive: true, force: true })
})

for (const lufs of [-35, -6]) {
  test(`voice at ${lufs} LUFS + ducked music from 0:32 + a 3 s music file → −14 LUFS, TP ≤ −1, music ducked ≥ 10 dB, silent end`, async () => {
    const voice = join(media, `صوت ${lufs}.wav`)
    await makeVoice(voice, lufs)
    const dir = join(root, `مشروع ${lufs} %`)
    await initProject({ dir, media: [voice] })
    for (const name of ['موسيقى طويلة.wav', 'short music %3.m4a']) {
      const r = await mba(['project', 'add', dir, join(media, name), '--kind', 'music'])
      expect(r.code, r.stderr).toBe(0)
      expect(r.stdout).toMatch(/^أُضيفت المادة — Added: m[23] {2}source\//)
    }
    const p = await openProject(dir)
    expect(p.manifest.media.map((m) => [m.id, m.kind, m.role])).toEqual([['m1', 'audio', undefined], ['m2', 'audio', 'music'], ['m3', 'audio', 'music']])
    await ingestProject(p)

    const editFile = join(dir, 'edit.json')
    const edit = JSON.parse(await readFile(editFile, 'utf8')) as { audio: unknown[]; scenes: { duration: number }[] }
    expect(edit.audio).toEqual([{ kind: 'voice', media: 'm1' }]) // as init wrote it (R2)
    expect(edit.scenes[0]!.duration).toBe(TOTAL)
    edit.audio.push({ kind: 'music', media: 'm2', in: 32 }, { kind: 'music', media: 'm3' })
    await writeFile(editFile, JSON.stringify(edit, null, 2))

    const r = await mba(['render', dir, '--draft'])
    expect(r.code, r.stderr).toBe(0)
    const out = (await latestRender(p))!
    expect(r.stdout.trim()).toBe(out)

    const loud = await measureLoudness(out)
    expect(loud.i).toBeGreaterThanOrEqual(-15)
    expect(loud.i).toBeLessThanOrEqual(-13)
    expect(loud.tp).toBeLessThanOrEqual(-1)
    expect((await verifyLoudness(p)).ok).toBe(true)

    // The music alone: everything above 2 kHz (the 440 Hz voice is ≈ 80 dB down there).
    const music = samples(out, 'highpass=f=2000,highpass=f=2000,highpass=f=2000')
    const ducked = rmsDb(music, ...VOICE_WINDOW)
    const free = rmsDb(music, ...FREE_WINDOW)
    expect(free - ducked, `music ${ducked.toFixed(1)} dB under the voice vs ${free.toFixed(1)} dB without`).toBeGreaterThanOrEqual(10)
    expect(free).toBeGreaterThan(-70) // the music is there at all

    const all = samples(out)
    console.log(`voice ${lufs} LUFS: I ${loud.i} LUFS, TP ${loud.tp} dBTP, music ducked ${(free - ducked).toFixed(1)} dB, last 0.1 s ${rmsDb(all, TOTAL - 0.1, TOTAL).toFixed(1)} dBFS`)
    expect(all.length / 48000).toBeCloseTo(TOTAL, 1)
    expect(rmsDb(all, TOTAL - 0.1, TOTAL)).toBeLessThan(-50)
  })
}
