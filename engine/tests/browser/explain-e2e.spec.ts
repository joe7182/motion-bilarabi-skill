import { test, expect } from '@playwright/test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { alignScript, parseScript, type Transcript } from '../../src/core/transcript'
import { cutCue } from '../../src/core/params/transitions'
import { loadStoryboardFile, openRenderPage, renderStills, renderVideo, type ChunkEvent, type RenderStart } from '../../src/node/render'
import { openProject, type Project } from '../../src/node/project'
import { partsDirOf, projectTempDir } from '../../src/node/tempdirs'
import { resolveFfmpeg } from '../../src/node/tools'
import { SCREEN_COLOURS } from '../fixtures/explain/make-fixtures'
import { isNearBlank } from './helpers'

// Task 12, end to end: an Arabic "voice" goes in, an explainer MP4 comes out, through the CLI only
// (project init → ingest → transcript → script.md → explain → render --draft → verify → review).
// The voice is tests/fixtures/explain/voice.wav: band-limited noise bursts on the fixture
// transcript's word times (make-fixtures.ts). CI copies the fixture transcript (what
// `mba transcribe` would write); MBA_E2E_WHISPER=1 runs whisper.cpp instead (MBA_E2E_VOICE: a real
// recording of script.md to use as the voice, since whisper hears no words in noise).
// Serial: each test builds on the project the one before left.
test.describe.configure({ mode: 'serial', timeout: 600_000 })

const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const FIX = join(ENGINE, 'tests/fixtures/explain')
const WHISPER = process.env.MBA_E2E_WHISPER === '1'

let root: string
let dir: string
let project: Project

/** Runs the CLI with node + tsx directly (no shell), so Arabic/space/% paths pass through untouched. */
function cli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, encoding: 'utf8', maxBuffer: 1 << 26 })
}

function ff(args: string[]): Buffer {
  const r = spawnSync(resolveFfmpeg(), ['-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 30 })
  expect(r.status, String(r.stderr)).toBe(0)
  return r.stdout
}

async function unlock(d: string): Promise<void> {
  if (!existsSync(d)) return
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) await unlock(p)
    else await chmod(p, 0o644)
  }
}

function killTree(proc: ChildProcess): void {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'])
  else process.kill(-proc.pid!, 'SIGKILL')
}

/** Mono 48 kHz PCM of a render's audio, as floats in −1..1. */
function pcmOf(file: string): Float32Array {
  const b = ff(['-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'])
  const out = new Float32Array(b.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(i * 2) / 32768
  return out
}

/** RMS level (dBFS) of [a, b) seconds. */
function rmsDb(pcm: Float32Array, a: number, b: number): number {
  const i0 = Math.max(0, Math.round(a * 48000))
  const i1 = Math.min(pcm.length, Math.round(b * 48000))
  let s = 0
  for (let i = i0; i < i1; i++) s += pcm[i]! * pcm[i]!
  return 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-12)
}

interface Metrics {
  movingPct: number
  maxEventGap: number
  medianEventGap: number
  frame0Blank: boolean
  staticRuns: { start: number; end: number }[]
  audit: { t: number; issues: { rule: string; text?: string }[] }[] | null
}

const readMetrics = async (review: string): Promise<Metrics> => JSON.parse(await readFile(join(review, 'metrics.json'), 'utf8'))

/** Share of pixels within `tol` of `rgb` in a PNG. */
function colourShare(png: Buffer, rgb: readonly number[], tol = 12): number {
  const img = PNG.sync.read(png)
  let n = 0
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.abs(img.data[i]! - rgb[0]!) <= tol && Math.abs(img.data[i + 1]! - rgb[1]!) <= tol && Math.abs(img.data[i + 2]! - rgb[2]!) <= tol) n++
  }
  return n / (img.width * img.height)
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-e2e-'))
  dir = join(root, 'مشاريع تجربة 100%', 'شرح')
  const inputs = join(root, 'مواد 100%')
  await mkdir(inputs, { recursive: true })
  await copyFile(process.env.MBA_E2E_VOICE ?? join(FIX, 'voice.wav'), join(inputs, 'صوت 100%.wav'))
  // Music: a soft three-note chord, 24 s.
  ff(['-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*220*t)+0.15*sin(2*PI*277.18*t)+0.1*sin(2*PI*329.63*t):s=48000:d=24', join(inputs, 'موسيقى.wav')])
})

test.afterAll(async () => {
  if (project) await rm(projectTempDir(project), { recursive: true, force: true })
  await unlock(root)
  await rm(root, { recursive: true, force: true })
})

test('explainer: voice + music → init → ingest → transcript → explain → render --draft → verify → review passes Pro Pace', async () => {
  const inputs = join(root, 'مواد 100%')
  const init = cli(['project', 'init', dir, join(inputs, 'صوت 100%.wav'), join(inputs, 'موسيقى.wav')])
  expect(init.status, init.stderr).toBe(0)
  const ing = cli(['ingest', dir])
  expect(ing.status, ing.stderr).toBe(0)
  project = await openProject(dir)
  expect(project.manifest.media.map((m) => m.kind)).toEqual(['audio', 'audio'])

  // Transcript + marks (what `mba transcribe` writes with a script.md in the project).
  const script = await readFile(join(FIX, 'script.md'), 'utf8')
  await writeFile(join(dir, 'script.md'), script)
  const fixture = JSON.parse(await readFile(join(FIX, 'transcript.json'), 'utf8')) as Transcript
  if (WHISPER) {
    const tr = cli(['transcribe', dir])
    expect(tr.status, tr.stderr).toBe(0)
    const heard = JSON.parse(await readFile(join(dir, 'transcript.json'), 'utf8')) as Transcript
    const marks = alignScript(parseScript(script), heard.words)
    expect(1 - marks.unmatched.length / fixture.words.length).toBeGreaterThanOrEqual(0.9)
  } else {
    await copyFile(join(FIX, 'transcript.json'), join(dir, 'transcript.json'))
    const marks = alignScript(parseScript(script), fixture.words)
    expect(marks.unmatched).toEqual([])
    await writeFile(join(dir, 'marks.json'), JSON.stringify(marks, null, 2) + '\n')
  }
  await copyFile(join(FIX, 'brief.json'), join(dir, 'brief.json'))

  const ex = cli(['explain', dir])
  expect(ex.status, ex.stderr).toBe(0)
  console.log(`[explain-e2e] ${ex.stdout.trim()}`)
  const edit = join(dir, 'edit.json')

  const rn = cli(['render', dir, '--draft'])
  expect(rn.status, rn.stderr).toBe(0)
  const render = join(dir, 'renders', 'v001-draft.mp4')
  expect(rn.stdout.trim().split('\n').at(-1)).toBe(render)
  expect(existsSync(render)).toBe(true)

  const vf = cli(['verify', dir])
  console.log(`[explain-e2e] verify: ${vf.stdout.trim()}`)
  expect(vf.status, vf.stdout + vf.stderr).toBe(0)
  expect(vf.stdout).toMatch(/Determinism check: OK/)
  expect(vf.stdout).toMatch(/v001-draft\.mp4/) // the loudness line checked this render

  const rv = cli(['review', dir])
  expect(rv.status, rv.stderr).toBe(0)
  console.log(`[explain-e2e] review: ${rv.stdout.trim()}`)
  const m = await readMetrics(join(dir, 'review', 'r1'))
  // Event times and the project id (its seed) make a pace failure reproducible.
  console.log(`[explain-e2e] events ${JSON.stringify((m as { eventTimes?: number[] }).eventTimes)} id ${project!.manifest.id}`)
  console.log(`[explain-e2e] explainer: moving ${m.movingPct}, maxEventGap ${m.maxEventGap}, median ${m.medianEventGap}, static ${JSON.stringify(m.staticRuns)}`)
  expect(m.movingPct).toBeGreaterThanOrEqual(0.9)
  expect(m.maxEventGap).toBeLessThanOrEqual(1.0)
  const long = m.staticRuns.filter((r) => r.end - r.start > 1.0 + 1e-6)
  expect(long.length).toBeLessThanOrEqual(1)
  for (const r of long) expect(r.end - r.start).toBeLessThanOrEqual(2.0 + 1e-6)
  expect(m.medianEventGap).toBeGreaterThanOrEqual(0.35)
  expect(m.medianEventGap).toBeLessThanOrEqual(0.5)
  expect(m.frame0Blank).toBe(false)
  // Plan 2a+ Task 9: the explainer default look is paper-editorial; no blank frame outside a transition.
  expect(((m as { nearBlankRuns?: { designed: boolean }[] }).nearBlankRuns ?? []).filter((r) => !r.designed)).toEqual([])
  expect(JSON.parse(await readFile(join(dir, 'edit.json'), 'utf8')).look).toBe('paper-editorial')
  expect(existsSync(join(dir, 'plan.json'))).toBe(true)
  expect(m.audit).not.toBeNull()
  expect(m.audit!.flatMap((a) => a.issues.map((i) => `${a.t}: ${i.rule} ${i.text ?? ''}`))).toEqual([])

  // The stressed word (*المال*) punches above 1.2 on its frame (from the transcript).
  const loaded = await loadStoryboardFile(edit)
  const marks = JSON.parse(await readFile(join(dir, 'marks.json'), 'utf8')) as { stress: number[] }
  const heard = JSON.parse(await readFile(join(dir, 'transcript.json'), 'utf8')) as Transcript
  expect(marks.stress.length).toBe(1)
  const sw = heard.words[marks.stress[0]!]!
  const rp = await openRenderPage(loaded)
  let peak = 0
  let peakT = sw.start
  try {
    for (let t = sw.start - 0.1; t <= sw.start + 0.3; t += 1 / 30) {
      await rp.seek(t)
      const s = await rp.page.evaluate((text) => {
        let best = 0
        for (const el of document.querySelectorAll<HTMLElement>('#frame [data-mba-scene] *')) {
          // Plan 2a+ Task 9: a kashida-stretched word carries tatweels while it punches.
          if (el.textContent?.replace(/\u0640/g, '') !== text || el.children.length) continue
          if (getComputedStyle(el.closest('[data-mba-scene]')!).display === 'none') continue
          const mm = /scale\(([\d.]+)\)/.exec(el.style.transform)
          best = Math.max(best, mm ? Number(mm[1]) : 1)
        }
        return best
      }, sw.text)
      if (s > peak) {
        peak = s
        peakT = t
      }
    }
    expect(rp.pageErrors()).toEqual([])
  } finally {
    await rp.close()
  }
  console.log(`[explain-e2e] stressed «${sw.text}» at ${sw.start} s: peak scale ${peak.toFixed(3)} at ${peakT.toFixed(3)} s`)
  expect(peak).toBeGreaterThan(1.2)
  const [still] = await renderStills({ storyboardPath: edit, times: [peakT], outDir: join(dir, 'review', 'r1', 'stress') })
  expect(isNearBlank(await readFile(still!))).toBe(false)

  // An impact is heard on every hard cut: ≥ 6 dB louder in the 50 ms after `at` than in the 50 ms before.
  const hits = (loaded.sb.transitions ?? []).map((tr) => cutCue(tr)).filter((c) => c !== null)
  expect(hits.length).toBeGreaterThan(0)
  const pcm = pcmOf(render)
  for (const c of hits) {
    const before = rmsDb(pcm, c.impactAt - 0.05, c.impactAt)
    const after = rmsDb(pcm, c.impactAt, c.impactAt + 0.05)
    console.log(`[explain-e2e] hit at ${c.impactAt.toFixed(3)} s: ${before.toFixed(1)} → ${after.toFixed(1)} dBFS`)
    expect(after - before, `hit at ${c.impactAt}`).toBeGreaterThanOrEqual(6)
  }
})

test('product-launch: a second mba explain with 2 screenshots and cta.keyword renders, passes verify, and shows both devices and the end card', async () => {
  for (const f of ['screen-1.png', 'screen-2.png']) await copyFile(join(FIX, f), join(dir, 'source', f))
  const brief = join(root, 'موجز إطلاق.json')
  await copyFile(join(FIX, 'brief-product.json'), brief)
  const ex = cli(['explain', dir, '--brief', brief])
  expect(ex.status, ex.stderr).toBe(0)
  console.log(`[explain-e2e] ${ex.stdout.trim()}`)
  expect(ex.stdout).toMatch(/product-launch/)

  const rn = cli(['render', dir, '--draft'])
  expect(rn.status, rn.stderr).toBe(0)
  const render = join(dir, 'renders', 'v002-draft.mp4')
  expect(existsSync(render)).toBe(true)
  const vf = cli(['verify', dir])
  console.log(`[explain-e2e] verify: ${vf.stdout.trim()}`)
  expect(vf.status, vf.stdout + vf.stderr).toBe(0)
  expect(vf.stdout).toMatch(/v002-draft\.mp4/)

  const rv = cli(['review', dir])
  expect(rv.status, rv.stderr).toBe(0)
  const review = join(dir, 'review', 'r2')
  const m = await readMetrics(review)
  console.log(`[explain-e2e] product-launch events ${JSON.stringify((m as { eventTimes?: number[] }).eventTimes)}`)
  console.log(`[explain-e2e] product-launch: moving ${m.movingPct}, maxEventGap ${m.maxEventGap}, median ${m.medianEventGap}, static ${JSON.stringify(m.staticRuns)}`)
  // Plan 2a+ Task 9: Pro Pace binds every type.
  expect(m.movingPct).toBeGreaterThanOrEqual(0.9)
  expect(m.maxEventGap).toBeLessThanOrEqual(1.0)
  expect(m.frame0Blank).toBe(false)
  expect(m.audit!.flatMap((a) => a.issues.map((i) => `${a.t}: ${i.rule}`))).toEqual([])

  // Stills at the anchors: each device shows its own screenshot, the end card is on screen.
  const edit = join(dir, 'edit.json')
  const { sb } = await loadStoryboardFile(edit)
  const devices = sb.scenes.filter((s) => s.type === 'phone' || s.type === 'app-window')
  const cta = sb.scenes.filter((s) => s.type === 'comment-cta')
  expect(devices.length).toBe(2)
  expect(cta.length).toBe(1)
  const end = Math.max(...sb.scenes.map((s) => s.start + s.duration))
  expect(cta[0]!.start + cta[0]!.duration).toBeCloseTo(end, 3)
  const times = [...devices.map((s) => s.start + Math.min(1, s.duration / 2)), cta[0]!.start + Math.min(1.5, cta[0]!.duration - 0.1)]
  const stills = await renderStills({ storyboardPath: edit, times, outDir: join(review, 'anchors') })
  for (const [k, p] of stills.slice(0, 2).entries()) {
    const png = await readFile(p)
    const own = colourShare(png, SCREEN_COLOURS[k]!)
    const other = colourShare(png, SCREEN_COLOURS[1 - k]!)
    console.log(`[explain-e2e] device ${k + 1} (${devices[k]!.type}) at ${times[k]!.toFixed(2)} s: own colour ${(own * 100).toFixed(1)} %, other ${(other * 100).toFixed(1)} %`)
    expect(own).toBeGreaterThan(0.02)
    expect(other).toBeLessThan(0.005)
  }
  expect(isNearBlank(await readFile(stills[2]!))).toBe(false)
  const rp = await openRenderPage(await loadStoryboardFile(edit))
  try {
    await rp.seek(times[2]!)
    const box = await rp.page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('#frame [data-mba-part=comment-cta]')
      if (!el || getComputedStyle(el.closest('[data-mba-scene]')!).display === 'none') return null
      const r = el.getBoundingClientRect()
      return { w: r.width, h: r.height }
    })
    expect(box).not.toBeNull()
    expect(box!.w).toBeGreaterThan(300)
  } finally {
    await rp.close()
  }
})

test('a second render after one word of transcript.json moves 0.2 s reuses no chunk (the transcript is in the job hash)', async () => {
  const parts = partsDirOf(project)
  // 1. Leave an unfinished v003 job with done chunks: kill the render after its first chunk.
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'render', dir, '--draft', '--chunk', '2'], {
    cwd: ENGINE,
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  let err = ''
  proc.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d))
  proc.stdout!.resume()
  const exited = new Promise<void>((r) => proc.once('close', () => r()))
  const job = join(parts, 'v003-draft')
  const deadline = Date.now() + 300_000
  while (!existsSync(join(job, 'chunk-000.done'))) {
    if (Date.now() > deadline || proc.exitCode !== null) throw new Error(`no chunk-000.done: ${err}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  killTree(proc)
  await exited
  expect(existsSync(join(job, 'job.json'))).toBe(true)
  expect(existsSync(join(dir, 'renders', 'v003-draft.mp4'))).toBe(false)

  // 2. Move one word (the last before the 0.5 s silence) 0.2 s later; nothing else changes.
  const tPath = join(dir, 'transcript.json')
  const t = JSON.parse(await readFile(tPath, 'utf8')) as Transcript
  const k = t.words.findIndex((w, i) => i + 1 < t.words.length && t.words[i + 1]!.start - w.end >= 0.45 && i > 20)
  expect(k).toBeGreaterThan(0)
  t.words[k] = { ...t.words[k]!, start: +(t.words[k]!.start + 0.2).toFixed(3), end: +(t.words[k]!.end + 0.2).toFixed(3) }
  await writeFile(tPath, JSON.stringify(t, null, 2) + '\n')

  // 3. Same edit.json, same options: a new version, every chunk rendered again.
  let start: RenderStart | undefined
  const chunks: ChunkEvent[] = []
  const res = await renderVideo({
    storyboardPath: join(dir, 'edit.json'),
    draft: true,
    chunkSec: 2,
    onStart: (s) => (start = s),
    onChunk: (e) => chunks.push(e),
  })
  expect(start?.resumed).toBe(false)
  expect(res.outPath).toBe(join(dir, 'renders', 'v004-draft.mp4'))
  expect(res.skipped).toBe(0)
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks.filter((c) => c.skipped)).toEqual([])
  // The killed job was left alone, not resumed.
  expect(existsSync(join(job, 'chunk-000.done'))).toBe(true)
})
