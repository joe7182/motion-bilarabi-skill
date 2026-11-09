import { test, expect } from '@playwright/test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initProject, type Project } from '../../src/node/project'
import { ingestProject, probeMedia } from '../../src/node/ingest'
import { LOCK_GRACE_MS, renderVideo, type ChunkEvent } from '../../src/node/render'
import type { FrameServerStats } from '../../src/node/framesrv'
import { resolveFfmpeg, resolveFfprobe } from '../../src/node/tools'
import { framesRootOf, partsDirOf, projectTempDir } from '../../src/node/tempdirs'

// Node-side: real projects (lavfi clip → init → ingest) rendered through the chunked project path.
// Serial; the long (170 s) test is test.slow().
test.describe.configure({ mode: 'serial', timeout: 200_000 })

const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const FPS = 30
const ETA_RE = /^الوقت المتبقي تقريباً ~ (\d+):(\d\d) — about \1:\2 left$/

let root: string
let projects: string
let media: string

async function unlock(d: string): Promise<void> {
  if (!existsSync(d)) return
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) await unlock(p)
    else await chmod(p, 0o644)
  }
}

function ff(args: string[], cwd?: string): Buffer {
  const r = spawnSync(resolveFfmpeg(), ['-v', 'error', '-nostdin', '-y', ...args], { cwd, maxBuffer: 1 << 30 })
  expect(r.status, String(r.stderr)).toBe(0)
  return r.stdout
}

/**
 * A lavfi clip: black 270×480 video at 30 fps with ONE white frame (`flashFrame`, counted from
 * the first video frame) and a 1 kHz beep of 0.1 s at `beepSec` (audio time, ~0.75 of full scale:
 * lavfi sine is 1/8 scale, ×6; 48-sample frames so the gate opens within 1 ms), silence elsewhere.
 * `videoDelay` > 0 makes the video stream start that much after the audio (the late-video case).
 */
function makeClip(file: string, sec: number, flashFrame: number, beepSec: number, videoDelay = 0): void {
  const vf = `color=c=black:s=270x480:r=${FPS}:d=${sec},format=yuv420p,geq=lum='if(eq(N\\,${flashFrame})\\,235\\,16)':cb=128:cr=128`
  const af = `sine=f=1000:r=48000:samples_per_frame=48:d=${sec + videoDelay},volume='if(between(t\\,${beepSec}\\,${beepSec + 0.1})\\,6\\,0)':eval=frame`
  if (videoDelay === 0) {
    ff(['-f', 'lavfi', '-i', vf, '-f', 'lavfi', '-i', af, '-c:v', 'libx264', '-crf', '12', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', file])
    return
  }
  const v = `${file}.v.mp4`
  const a = `${file}.a.m4a`
  ff(['-f', 'lavfi', '-i', vf, '-c:v', 'libx264', '-crf', '12', '-g', '30', '-pix_fmt', 'yuv420p', v])
  ff(['-f', 'lavfi', '-i', af, '-c:a', 'aac', '-b:a', '192k', a])
  ff(['-itsoffset', String(videoDelay), '-i', v, '-i', a, '-map', '0:v', '-map', '1:a', '-c', 'copy', file])
}

/** Index of the first frame whose mean luma is > 128 (the flash), or -1. */
function flashFrameOf(file: string): number {
  const px = ff(['-i', file, '-an', '-vf', 'scale=1:1:flags=area,format=gray', '-f', 'rawvideo', '-'])
  for (let i = 0; i < px.length; i++) if (px[i]! > 128) return i
  return -1
}

/** Time (s) of the first audio sample above a third of full scale (the beep onset), or -1. */
function beepOnsetOf(file: string): number {
  const pcm = ff(['-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'])
  for (let i = 0; i + 1 < pcm.length; i += 2) if (Math.abs(pcm.readInt16LE(i)) > 10_000) return i / 2 / 48000
  return -1
}

interface Streams {
  video: { frames: number; start: number; dur: number }
  audio?: { codec: string; rate: number; channels: number; start: number; dur: number }
}
function streamsOf(file: string): Streams {
  const r = spawnSync(resolveFfprobe(), ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,codec_name,sample_rate,channels,nb_read_packets,start_time,duration', '-of', 'json', file], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  const ss = (JSON.parse(r.stdout) as { streams: Record<string, string>[] }).streams
  const v = ss.find((s) => s.codec_type === 'video')!
  const a = ss.find((s) => s.codec_type === 'audio')
  return {
    video: { frames: Number(v.nb_read_packets), start: Number(v.start_time), dur: Number(v.duration) },
    ...(a ? { audio: { codec: a.codec_name!, rate: Number(a.sample_rate), channels: Number(a.channels), start: Number(a.start_time), dur: Number(a.duration) } } : {}),
  }
}

/** SHA-1 of the decoded frames at `indices` (raw RGB). */
function frameHashes(file: string, indices: number[]): string[] {
  const { w, h } = (() => {
    const r = spawnSync(resolveFfprobe(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' })
    const [a, b] = r.stdout.trim().split(',').map(Number)
    return { w: a!, h: b! }
  })()
  const expr = indices.map((n) => `eq(n\\,${n})`).join('+')
  const raw = ff(['-i', file, '-an', '-vf', `select=${expr}`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  const n = w * h * 3
  expect(raw.length).toBe(n * indices.length)
  return indices.map((_, k) => createHash('sha1').update(raw.subarray(k * n, (k + 1) * n)).digest('hex'))
}

async function newProject(name: string, sec: number, flashFrame: number, beepSec: number, videoDelay = 0): Promise<Project> {
  const clip = join(media, `${name} %1.mp4`)
  makeClip(clip, sec, flashFrame, beepSec, videoDelay)
  const p = await initProject({ dir: join(projects, name), media: [clip] })
  await ingestProject(p)
  return p
}

// Temp data lives in <tmp>/mba/<project id>/{parts,frames}; the project folder never gets any.
const partsOf = (p: Project) => {
  expect(existsSync(join(p.dir, 'renders', '.parts'))).toBe(false)
  return partsDirOf(p)
}
const framesOf = (p: Project) => {
  expect(existsSync(join(p.dir, 'work', '.frames'))).toBe(false)
  return framesRootOf(p)
}
const countJpegs = async (d: string): Promise<number> =>
  existsSync(d) ? (await readdir(d, { recursive: true })).filter((f) => String(f).endsWith('.jpg')).length : 0

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-'))
  projects = join(root, 'مشاريع تجربة 100%')
  media = join(root, 'مصادر %50')
  await mkdir(media, { recursive: true })
})
test.afterAll(async () => {
  await unlock(root)
  await rm(root, { recursive: true, force: true })
})

test('chunks + audio: 25 s in 10 s chunks → 750 frames, AAC audio, flash and beep within one frame; one chunk of frames on disk at a time', async () => {
  const p = await newProject('مقطع ٢٥', 25, 450, 15.0)
  const edit = join(p.dir, 'edit.json')
  const etas: string[] = []
  const chunks: ChunkEvent[] = []
  let peak = 0
  let stats: FrameServerStats | undefined
  const t0 = performance.now()
  const res = await renderVideo({
    storyboardPath: edit,
    draft: true,
    chunkSec: 10,
    onEta: (line) => etas.push(line),
    onChunk: (e) => chunks.push(e),
    onProgress: (done) => {
      if (done % 25 === 0) void countJpegs(framesOf(p)).then((n) => (peak = Math.max(peak, n)))
    },
    onFrames: (s) => (stats = s),
  })
  const wall = (performance.now() - t0) / 1000
  console.log(`[render-chunks] 25 s draft: ${wall.toFixed(1)} s wall, ${(750 / wall).toFixed(1)} frames/s`)

  expect(res.outPath).toBe(join(p.dir, 'renders', 'v001-draft.mp4'))
  expect(res.version).toBe('v001-draft')
  expect(chunks.map((c) => [c.index, c.frames, c.skipped])).toEqual([[0, 300, false], [1, 300, false], [2, 150, false]])
  expect(stats?.onDemand).toBe(0)
  expect(peak).toBeLessThanOrEqual(301) // one chunk (+ the t = 0 frame of the page load)
  expect(etas.length).toBeGreaterThanOrEqual(2)
  for (const l of etas) expect(l).toMatch(ETA_RE)

  const s = streamsOf(res.outPath)
  expect(s.video.frames).toBe(750)
  expect(s.audio).toBeDefined()
  expect(s.audio!.codec).toBe('aac')
  expect(s.audio!.rate).toBe(48000)
  expect(Math.abs(s.audio!.dur - 25)).toBeLessThan(0.05)
  const flash = flashFrameOf(res.outPath)
  const beep = beepOnsetOf(res.outPath)
  console.log(`[render-chunks] flash frame ${flash} (${(flash / FPS).toFixed(3)} s), beep onset ${beep.toFixed(4)} s`)
  expect(flash).toBe(450)
  expect(Math.abs(beep - flash / FPS)).toBeLessThanOrEqual(1 / FPS)

  expect(existsSync(partsOf(p))).toBe(false)
  expect(existsSync(framesOf(p))).toBe(false)
  const log = await readFile(join(p.dir, 'log.md'), 'utf8')
  expect(log).toMatch(/— render — renders\/v001-draft\.mp4/)
})

test('late video: a source whose video starts 0.2 s after its audio stays in sync through ingest and render', async () => {
  // Flash on source-video frame 444 → container time 0.2 + 444/30 = 15.0 s, beep at 15.0 s.
  const p = await newProject('متأخر', 25, 444, 15.0, 0.2)
  const src = await probeMedia(join(p.dir, p.manifest.media[0]!.source))
  expect(src.videoStartSec).toBeGreaterThan(0.15)

  // The working copy: video padded to start at 0 (first frame repeated), flash at 15.0 s; audio
  // runs to the end of the video.
  const work = join(p.dir, p.manifest.media[0]!.work!)
  const ws = streamsOf(work)
  expect(ws.video.start).toBeLessThan(0.005)
  expect(ws.video.frames).toBe(756)
  expect(flashFrameOf(work)).toBe(450)
  expect(Math.abs(beepOnsetOf(work) - 15)).toBeLessThanOrEqual(1 / FPS)
  expect(Math.abs(ws.audio!.dur - 25.2)).toBeLessThan(0.05)

  // A render of media 13..17 s: flash at frame 60, beep at 2.0 s.
  const sb = JSON.parse(await readFile(join(p.dir, 'edit.json'), 'utf8')) as { scenes: { duration: number; params: { in: number } }[] }
  sb.scenes[0]!.params.in = 13
  sb.scenes[0]!.duration = 4
  await writeFile(join(p.dir, 'edit.json'), JSON.stringify(sb, null, 2))
  const res = await renderVideo({ storyboardPath: join(p.dir, 'edit.json'), draft: true, chunkSec: 10 })
  const flash = flashFrameOf(res.outPath)
  const beep = beepOnsetOf(res.outPath)
  console.log(`[render-chunks] late video: flash frame ${flash}, beep ${beep.toFixed(4)} s`)
  expect(flash).toBe(60)
  expect(Math.abs(beep - flash / FPS)).toBeLessThanOrEqual(1 / FPS)
})

test('explicit out: two renders of one file at once — one writes it, the other is refused Arabic first; locks are judged by pid only', async () => {
  const p = await newProject('خارجي', 3, 30, 1.0)
  const edit = join(p.dir, 'edit.json')
  const out = join(root, 'خارج المشروع %', 'v.mp4')
  const both = await Promise.allSettled([
    renderVideo({ storyboardPath: edit, outPath: out, draft: true }),
    renderVideo({ storyboardPath: edit, outPath: out, draft: true }),
  ])
  const ok = both.filter((r) => r.status === 'fulfilled')
  const bad = both.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  expect(ok).toHaveLength(1)
  expect(bad).toHaveLength(1)
  expect(String(bad[0]!.reason?.message)).toMatch(/^عرض آخر يكتب هذا الملف الآن — Another render is writing .*v\.mp4 right now/)
  expect(streamsOf(out).video.frames).toBe(90)
  expect(existsSync(partsDirOf(p))).toBe(false)

  // Locks are judged by pid only (round 2): the job folder is in the machine-local temp folder.
  const jobDir = join(partsDirOf(p), `out-${createHash('sha1').update(out).digest('hex').slice(0, 12)}`)
  const lock = join(jobDir, 'job.lock')
  await mkdir(jobDir, { recursive: true })
  // A live pid is busy whatever host name the lock carries.
  await writeFile(lock, JSON.stringify({ pid: process.pid, host: 'اسم-قديم.local' }))
  await expect(renderVideo({ storyboardPath: edit, outPath: out, draft: true })).rejects.toThrow(/^عرض آخر يكتب هذا الملف الآن — Another render is writing .*v\.mp4 right now/)
  // A fresh empty lock (a claim being written) is busy; the same lock older than LOCK_GRACE_MS is stale.
  await writeFile(lock, '')
  await expect(renderVideo({ storyboardPath: edit, outPath: out, draft: true })).rejects.toThrow(/^عرض آخر يكتب هذا الملف الآن/)
  const old = new Date(Date.now() - LOCK_GRACE_MS - 5000)
  await utimes(lock, old, old)
  await renderVideo({ storyboardPath: edit, outPath: out, draft: true })
  expect(existsSync(partsDirOf(p))).toBe(false)
  // A dead pid under another host name (this machine renamed, e.g. macOS on a new network) is taken over.
  const dead = spawnSync(process.execPath, ['-e', '0']).pid!
  await mkdir(jobDir, { recursive: true })
  await writeFile(lock, JSON.stringify({ pid: dead, host: 'اسم-قديم.local' }))
  await renderVideo({ storyboardPath: edit, outPath: out, draft: true })
  expect(existsSync(partsDirOf(p))).toBe(false)
})

function killTree(proc: ChildProcess): void {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'])
  else process.kill(-proc.pid!, 'SIGKILL')
}

function cli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    proc.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    proc.once('close', (code) => res({ code, stdout, stderr }))
  })
}

test('resume: a render killed (process tree) after chunk 000 resumes the same version, skips chunk 000 and equals an uninterrupted render; versions + log', async () => {
  const p = await newProject('استئناف', 8, 150, 5.0)
  const parts = join(partsOf(p), 'v001-draft')

  // 1. Start the CLI, kill its whole tree once chunk-000.done exists.
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'render', p.dir, '--draft', '--chunk', '2'], {
    cwd: ENGINE,
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  let err1 = ''
  proc.stderr!.setEncoding('utf8').on('data', (d: string) => (err1 += d))
  proc.stdout!.resume()
  const exited = new Promise<void>((r) => proc.once('close', () => r()))
  const deadline = Date.now() + 120_000
  while (!existsSync(join(parts, 'chunk-000.done'))) {
    if (Date.now() > deadline || proc.exitCode !== null) throw new Error(`no chunk-000.done: ${err1}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  killTree(proc)
  await exited
  console.log(`[render-chunks] after the kill: ${(await readdir(parts)).sort().join(', ')}`)
  expect(existsSync(join(p.dir, 'renders', 'v001-draft.mp4'))).toBe(false)
  expect(existsSync(join(parts, 'job.json'))).toBe(true)
  // A planted, unfinished chunk (no .done) must be deleted, never reused.
  await writeFile(join(parts, 'chunk-002.mp4'), 'partial')

  // 2. Rerun: same version, chunk 000 skipped.
  const r2 = await cli(['render', p.dir, '--draft', '--chunk', '2'])
  expect(r2.code, r2.stderr).toBe(0)
  const out1 = join(p.dir, 'renders', 'v001-draft.mp4')
  expect(r2.stdout.trim().split('\n').at(-1)).toBe(out1)
  expect(r2.stderr).toMatch(/^استئناف v001-draft — resuming v001-draft/m)
  expect(r2.stderr).toMatch(/القطعة 1\/4 .* chunk 1\/4 already done, skipped/)
  expect(r2.stderr).not.toMatch(/chunk 2\/4 already done/)
  expect(r2.stderr).not.toMatch(/chunk 3\/4 already done/)
  expect(existsSync(partsOf(p))).toBe(false)
  expect(existsSync(framesOf(p))).toBe(false) // the killed process's frames are swept too
  expect(existsSync(projectTempDir(p))).toBe(false)

  // 3. An uninterrupted render of the same edit is the next version, v002.
  const res = await renderVideo({ storyboardPath: join(p.dir, 'edit.json'), draft: true, chunkSec: 2 })
  expect(res.outPath).toBe(join(p.dir, 'renders', 'v002-draft.mp4'))
  expect(res.skipped).toBe(0)
  expect(streamsOf(out1).video.frames).toBe(240)
  expect(streamsOf(res.outPath).video.frames).toBe(240)
  const idx = Array.from({ length: 20 }, (_, k) => Math.min(239, Math.round((k * 239) / 19)))
  expect(frameHashes(out1, idx)).toEqual(frameHashes(res.outPath, idx))
  expect(flashFrameOf(out1)).toBe(150)
  expect(Math.abs(beepOnsetOf(out1) - 5)).toBeLessThanOrEqual(1 / FPS)

  const log = await readFile(join(p.dir, 'log.md'), 'utf8')
  expect(log).toMatch(/— render — renders\/v001-draft\.mp4/)
  expect(log).toMatch(/— render — renders\/v002-draft\.mp4/)
})

test('long: 170 s project renders draft end to end; flash and beep at 165 s within one frame', async () => {
  test.slow()
  const p = await newProject('طويل', 170, 4950, 165.0)
  let stats: FrameServerStats | undefined
  const etas: string[] = []
  const t0 = performance.now()
  const res = await renderVideo({ storyboardPath: join(p.dir, 'edit.json'), draft: true, onFrames: (s) => (stats = s), onEta: (l) => etas.push(l) })
  const wall = (performance.now() - t0) / 1000
  console.log(`[render-chunks] 170 s draft: ${wall.toFixed(1)} s wall, ${(5100 / wall).toFixed(1)} frames/s; ETAs: ${etas.join(' | ')}`)
  expect(stats?.onDemand).toBe(0)
  expect(res.chunks).toBe(17)
  // One estimate after 60 frames, then one per chunk but the last; it counts down to the end.
  expect(etas).toHaveLength(17)
  const secs = etas.map((l) => {
    const m = ETA_RE.exec(l)!
    return Number(m[1]) * 60 + Number(m[2])
  })
  expect(secs.at(-1)!).toBeLessThan(secs[0]! / 5)
  expect(Math.abs(secs[0]! - wall)).toBeLessThan(wall * 0.5) // a sane first estimate
  const s = streamsOf(res.outPath)
  expect(s.video.frames).toBe(5100)
  expect(Math.abs(s.audio!.dur - 170)).toBeLessThan(0.05)
  const flash = flashFrameOf(res.outPath)
  const beep = beepOnsetOf(res.outPath)
  console.log(`[render-chunks] 170 s: flash frame ${flash}, beep ${beep.toFixed(4)} s`)
  expect(flash).toBe(4950)
  expect(Math.abs(beep - flash / FPS)).toBeLessThanOrEqual(1 / FPS)
  expect(existsSync(partsOf(p))).toBe(false)
  expect(existsSync(framesOf(p))).toBe(false)
})
