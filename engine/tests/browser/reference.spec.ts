import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { analyzeReference, deltaE, type ReferenceReport } from '../../src/node/reference'
import { compareVideos, type CompareReport, type CompareUnits } from '../../src/node/compare'
import { styleSchema, type StyleDna } from '../../src/core/style'
import { probeVideo } from '../../src/node/frames'
import { ANALYSIS_FPS, hexToRgb } from '../../src/node/metrics'
import { resolveFfmpeg } from '../../src/node/tools'

// Node-side: ffmpeg scene detection + decode, sheets screenshotted by Chromium. Slow (R5).
const ENGINE = fileURLToPath(new URL('../..', import.meta.url))

test.describe.configure({ mode: 'serial', timeout: 180_000 })

let root: string
let video: string
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-'))
  // 6 s, 30 fps: three solid colours with temporal noise, hard cuts at 2.0 and 4.0 s.
  const dir = join(root, 'مخرجات مراجعة')
  await mkdir(dir, { recursive: true })
  video = join(dir, 'ref.mp4')
  const shot = (c: string, l: string) => `color=c=${c}:s=360x640:r=30:d=2,noise=alls=25:allf=t+u[${l}]`
  const graph = `${shot('0xC02020', 'a')};${shot('0xE0E0E0', 'b')};${shot('0x2040A0', 'c')};[a][b][c]concat=n=3:v=1:a=0[v]`
  const r = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-y', '-filter_complex', graph, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
})
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const PACE_KEYS = ['eventsPerSec', 'medianEventGap', 'maxEventGap', 'movingPct', 'longestStatic'] as const

async function expectFile(path: string) {
  expect(existsSync(path), path).toBe(true)
  expect((await stat(path)).size).toBeGreaterThan(0)
}

test('analyzeReference finds the two cuts and writes the kit', async () => {
  const out = join(root, 'مخرجات مراجعة', 'ref kit')
  const r = await analyzeReference({ videoPath: video, outDir: out })
  expect(r.fps).toBe(30)
  expect(r.analysisFps).toBe(ANALYSIS_FPS)
  expect(r.w).toBe(360)
  expect(r.h).toBe(640)
  expect(r.duration).toBeCloseTo(6, 6)
  expect(r.cuts).toHaveLength(2)
  expect(Math.abs(r.cuts[0]! - 2)).toBeLessThanOrEqual(1 / 30 + 1e-9)
  expect(Math.abs(r.cuts[1]! - 4)).toBeLessThanOrEqual(1 / 30 + 1e-9)
  expect(r.shotLengths).toHaveLength(3)
  for (const s of r.shotLengths) expect(s).toBeCloseTo(2, 1)
  expect(r.avgShot).toBeCloseTo(2, 1)
  expect(r.medianShot).toBeCloseTo(2, 1)
  // 4 Hz motion profile over the whole clip.
  expect(r.motionProfile.length).toBe(24)
  expect(r.motionProfile[1]!.t).toBeCloseTo(0.25, 6)
  for (const p of r.motionProfile) expect(Number.isFinite(p.motion)).toBe(true)
  // Pace (R26): present and finite.
  expect(Array.isArray(r.events)).toBe(true)
  for (const k of PACE_KEYS) expect(Number.isFinite(r[k]), k).toBe(true)
  expect(r.movingPct).toBeGreaterThanOrEqual(0)
  expect(r.movingPct).toBeLessThanOrEqual(1)

  for (const f of ['frames.jpg', 'cuts.jpg', 'reference.json', 'reference.md']) await expectFile(join(out, f))
  const onDisk = JSON.parse(await readFile(join(out, 'reference.json'), 'utf8')) as ReferenceReport
  expect(onDisk).toEqual(r)
  const md = await readFile(join(out, 'reference.md'), 'utf8')
  expect(md).toContain('Take the grammar, never the content.')
  for (const h of ['Rhythm', 'Pace', 'Transitions', 'Camera', 'Text in/out', 'Palette', 'Type']) expect(md).toMatch(new RegExp(`^##.*${h}`, 'm'))
  expect(md).toContain(`Our render should match: eventsPerSec ≈ ${r.eventsPerSec}, medianEventGap ≈ ${r.medianEventGap}`)
  expect(md).toContain('TODO (Claude fills from frames.jpg)')
})

/**
 * The same content at `fps`: a box whose brightness pulses once a second (amplitude 29 grey levels;
 * the per-pixel offset spreads 8-bit rounding). Measured per source frame, its peak change is about
 * 6/255 at 30 fps (two motion events a second) but only about 3/255 at 60 fps (no events at all).
 */
function paceClip(path: string, fps: number) {
  const lum = 'if(between(X,100,219)*between(Y,400,519),100+29*sin(2*PI*T)+mod(X,8)/8,16)'
  const r = spawnSync(
    resolveFfmpeg(),
    [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=360x640:r=${fps}:d=4,format=gray,geq=lum='${lum}'`,
      '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', path,
    ],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
}

test('pace metrics do not depend on the source frame rate (fixed analysis fps)', async () => {
  const reports: ReferenceReport[] = []
  for (const fps of [30, 60]) {
    const clip = join(root, 'مخرجات مراجعة', `pace ${fps}.mp4`)
    paceClip(clip, fps)
    const r = await analyzeReference({ videoPath: clip, outDir: join(root, 'مخرجات مراجعة', `pace ${fps}`) })
    expect(r.fps).toBe(fps)
    expect(r.duration).toBeCloseTo(4, 6)
    reports.push(r)
  }
  const [a, b] = reports as [ReferenceReport, ReferenceReport]
  expect(a.eventsPerSec).toBeGreaterThan(1)
  expect(Math.abs(a.eventsPerSec - b.eventsPerSec)).toBeLessThanOrEqual(0.25)
  expect(Math.abs(a.maxEventGap - b.maxEventGap)).toBeLessThanOrEqual(2 / ANALYSIS_FPS + 1e-9)
  expect(Math.abs(a.movingPct - b.movingPct)).toBeLessThanOrEqual(0.05)
  for (const r of reports) expect(r.analysisFps).toBe(ANALYSIS_FPS)
})

test('a clip without cuts is one shot; cuts.jpg still shows its opening', async () => {
  const one = join(root, 'مخرجات مراجعة', 'one shot.mp4')
  const r0 = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2040A0:s=360x640:r=30:d=3,noise=alls=25:allf=t+u', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', one],
    { encoding: 'utf8' },
  )
  expect(r0.status, r0.stderr).toBe(0)
  const dir = join(root, 'مخرجات مراجعة', 'one')
  const r = await analyzeReference({ videoPath: one, outDir: dir })
  expect(r.cuts).toEqual([])
  expect(r.shotLengths).toHaveLength(1)
  expect(r.shotLengths[0]).toBeCloseTo(3, 6)
  expect(r.avgShot).toBeCloseTo(3, 6)
  await expectFile(join(dir, 'cuts.jpg'))
})

test('mba reference CLI: summary, % in the out path, exit codes', async () => {
  const cli = (args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, encoding: 'utf8' })
  // A '%' in the output dir must not be read as an ffmpeg image-sequence pattern.
  const out = join(root, 'مخرجات مراجعة', '50% ref')
  const ok = cli(['reference', video, '--out', out, '--scene-thr', '0.3'])
  expect(ok.status, ok.stderr).toBe(0)
  expect(ok.stdout).toContain(out)
  expect(ok.stdout).toMatch(/القطعات — Cuts: 2/)
  expect(ok.stdout).toMatch(/eventsPerSec/)
  for (const f of ['frames.jpg', 'cuts.jpg', 'reference.json', 'reference.md']) await expectFile(join(out, f))

  const missing = cli(['reference', join(root, 'nope.mp4'), '--out', join(root, 'x')])
  expect(missing.status).toBe(1)
  expect(missing.stderr).toContain('لم يتم العثور على ملف الفيديو — Video file not found:')
  expect(missing.stderr).toContain('nope.mp4')
  expect(cli(['reference']).status).toBe(2)
  expect(cli(['reference', video, '--scene-thr', '2']).status).toBe(2)
  expect(cli(['reference', video, '--draft']).status).toBe(2)
  expect(cli(['review', video, '--scene-thr', '0.3']).status).toBe(2)
})

/**
 * A white box circling on black (no noise): x = 140 + 120·sin(2πT), y = 280 + 60·cos(2πT), with T
 * frozen at 1 over [1, 2] when `freeze` (static there, resuming seamlessly at 2 s).
 */
function boxClip(path: string, dur: number, freeze: boolean) {
  const T = freeze ? 'if(between(t,1,2),1,t)' : 't'
  const graph =
    `color=c=black:s=360x640:r=30:d=${dur}[bg];color=c=white:s=80x80:r=30:d=${dur}[box];` +
    `[bg][box]overlay=x='140+120*sin(2*PI*${T})':y='280+60*cos(2*PI*${T})':eval=frame,format=yuv420p[v]`
  const r = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-y', '-filter_complex', graph, '-map', '[v]', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', path],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
}

const MANIFEST = (id: string) => JSON.stringify({ version: 1, id, createdAt: '2026-10-30T00:00:00.000Z', fps: 30, format: '9:16', media: [] })
const slam = (id: string, start: number) => ({ id, type: 'slam', start, duration: 1, params: { text: 'جديد' } })
const THREE = JSON.stringify({ version: 1, scenes: [slam('s1', 0), slam('s2', 1), slam('s3', 2)] })

test('analyzeReference samples the palette from the pixels (SEEN)', async () => {
  // Solid bands: 70 % dark, 25 % light, 5 % orange (of 360×640).
  const clip = join(root, 'مخرجات مراجعة', 'palette.mp4')
  const graph =
    'color=c=0x101820:s=360x640:r=30:d=2[a];color=c=0xF2F2F2:s=360x160:r=30:d=2[b];color=c=0xFF6A00:s=360x32:r=30:d=2[c];' +
    '[a][b]overlay=0:448[ab];[ab][c]overlay=0:416,format=yuv420p[v]'
  const r0 = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-y', '-filter_complex', graph, '-map', '[v]', '-c:v', 'libx264', '-crf', '8', '-pix_fmt', 'yuv420p', clip],
    { encoding: 'utf8' },
  )
  expect(r0.status, r0.stderr).toBe(0)
  const out = join(root, 'مخرجات مراجعة', 'palette kit')
  const r = await analyzeReference({ videoPath: clip, outDir: out })
  const role = (x: string) => r.palette.find((c) => c.role === x)
  expect(r.palette.length).toBeLessThanOrEqual(6)
  expect(deltaE(hexToRgb(role('background')!.hex), [0x10, 0x18, 0x20])).toBeLessThan(5)
  expect(deltaE(hexToRgb(role('text')!.hex), [0xf2, 0xf2, 0xf2])).toBeLessThan(5)
  expect(deltaE(hexToRgb(role('accent')!.hex), [0xff, 0x6a, 0x00])).toBeLessThan(8)
  const md = await readFile(join(out, 'reference.md'), 'utf8')
  expect(md).toContain('**SEEN (measured)**')
  expect(md).toContain(role('accent')!.hex)
})

test('compareVideos: per-scene verdicts from the storyboard; side-by-side compare.mp4', async () => {
  const dir = join(root, 'مخرجات مراجعة', '50% compare')
  await mkdir(dir, { recursive: true })
  const ref = join(dir, 'ref clip.mp4')
  const ours = join(dir, 'ours clip.mp4')
  boxClip(ref, 3, false)
  boxClip(ours, 3, true)
  const sb = join(dir, 'edit.json')
  await writeFile(sb, THREE, 'utf8')
  const out = join(dir, 'out')
  const rep = await compareVideos({ reference: ref, render: ours, storyboard: sb, outDir: out })
  expect(rep.scenes.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  expect(rep.source).toMatchObject({ kind: 'storyboard', track: 0, trackScenes: 3, auto: true })
  expect(rep.source.summary).toContain('scenes from track 0 (3 scenes)')
  expect(rep.tiling).toEqual({ gaps: [], overlaps: [] })
  expect(rep.durations).toEqual({ ours: 3, ref: 3, ratio: 1 })
  expect(Object.fromEntries(rep.scenes.map((s) => [s.id, s.verdict]))).toEqual({ s1: 'ok', s2: 'fix', s3: 'ok' })
  const s2 = rep.scenes[1]!
  expect(s2.a).toBeCloseTo(1, 6)
  expect(s2.b).toBeCloseTo(2, 6)
  expect(s2.ours.movingPct).toBeLessThan(0.1)
  expect(s2.ref.movingPct).toBeGreaterThan(0.9)

  const onDisk = JSON.parse(await readFile(join(out, 'compare.json'), 'utf8')) as CompareReport
  expect(onDisk).toEqual(rep)
  const md = await readFile(join(out, 'compare.md'), 'utf8')
  expect(md).toMatch(/\| s2 \|.*\| \*\*fix\*\* \|/)
  const info = await probeVideo(join(out, 'compare.mp4'))
  expect(info.h).toBe(960)
  expect(info.w).toBe(2 * 540)
  expect(Math.abs(info.duration - 3)).toBeLessThanOrEqual(1 / 30 + 1e-6)
  expect(readdirSync(out).sort()).toEqual(['compare.json', 'compare.md', 'compare.mp4'])
})

test('compareVideos without a storyboard: scenes from the render cuts; the shorter is cloned; labels drawn', async () => {
  const dir = join(root, 'مخرجات مراجعة', '50% compare')
  const shortRef = join(dir, 'short ref.mp4')
  boxClip(shortRef, 2, false)
  const out = join(dir, 'out 2')
  const rep = await compareVideos({ reference: shortRef, render: join(dir, 'ours clip.mp4'), outDir: out })
  expect(rep.scenes).toHaveLength(1)
  expect(rep.scenes[0]!.id).toBe('shot-1')
  expect(rep.scenes[0]!.b).toBeCloseTo(3, 6)
  const info = await probeVideo(join(out, 'compare.mp4'))
  expect(Math.abs(info.duration - 3)).toBeLessThanOrEqual(1 / 30 + 1e-6)
  expect(info.w).toBe(1080)
  // Past the reference's end (2.5 s) its last frame is held, and both label images are on screen:
  // bright pixels in the label band of each half, where the sources are black.
  const png = join(root, 'label-probe.png')
  const r = spawnSync(resolveFfmpeg(), ['-v', 'error', '-y', '-ss', '2.5', '-i', join(out, 'compare.mp4'), '-frames:v', '1', '-update', '1', png], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  const img = PNG.sync.read(await readFile(png))
  const bright = (x0: number, x1: number) => {
    let n = 0
    for (let y = 0; y < 160; y++) for (let x = x0; x < x1; x++) if (img.data[(y * img.width + x) * 4]! > 200) n++
    return n
  }
  expect(bright(0, 540)).toBeGreaterThan(200)
  expect(bright(540, 1080)).toBeGreaterThan(200)
})

test('mba compare CLI: project → latest render + edit.json into review/compare-<n>', async () => {
  const cli = (args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, encoding: 'utf8' })
  const dir = join(root, 'مخرجات مراجعة', '50% compare')
  const ref = join(dir, 'ref clip.mp4')
  const proj = join(root, 'مشروع % مقارنة')
  await mkdir(join(proj, 'renders'), { recursive: true })
  await writeFile(join(proj, 'mba-project.json'), MANIFEST('cmp'), 'utf8')
  await writeFile(join(proj, 'edit.json'), THREE, 'utf8')
  await copyFile(join(dir, 'short ref.mp4'), join(proj, 'renders', 'v001-draft.mp4'))
  await copyFile(join(dir, 'ours clip.mp4'), join(proj, 'renders', 'v002-draft.mp4'))
  // copyFile keeps the clip's old mtime: make the render newer than edit.json (a fresh render).
  const later = new Date(Date.now() + 60_000)
  await utimes(join(proj, 'renders', 'v002-draft.mp4'), later, later)
  const before = await readFile(join(proj, 'renders', 'v002-draft.mp4'))

  const ok = cli(['compare', ref, proj])
  expect(ok.status, ok.stderr).toBe(0)
  const out1 = join(proj, 'review', 'compare-1')
  expect(ok.stdout).toContain(out1)
  expect(ok.stdout).toMatch(/s2.*fix/)
  expect(ok.stdout).toContain('scenes from track 0 (3 scenes)')
  expect(ok.stderr).not.toContain('Warning')
  const rep = JSON.parse(await readFile(join(out1, 'compare.json'), 'utf8')) as CompareReport
  expect(rep.scenes.map((s) => s.verdict)).toEqual(['ok', 'fix', 'ok'])
  // Never overwrites: a second run goes to compare-2; the project's files are untouched.
  const again = cli(['compare', ref, proj])
  expect(again.status, again.stderr).toBe(0)
  expect(existsSync(join(proj, 'review', 'compare-2', 'compare.mp4'))).toBe(true)
  expect(await readFile(join(proj, 'edit.json'), 'utf8')).toBe(THREE)
  expect((await readFile(join(proj, 'renders', 'v002-draft.mp4'))).equals(before)).toBe(true)

  const explicit = join(dir, 'cli out')
  const plain = cli(['compare', ref, join(dir, 'ours clip.mp4'), '--out', explicit])
  expect(plain.status, plain.stderr).toBe(0)
  expect(existsSync(join(explicit, 'compare.mp4'))).toBe(true)

  const empty = join(root, 'مشروع فارغ')
  await mkdir(empty, { recursive: true })
  await writeFile(join(empty, 'mba-project.json'), MANIFEST('empty'), 'utf8')
  const none = cli(['compare', ref, empty])
  expect(none.status).toBe(1)
  expect(none.stderr).toMatch(/^[\u0600-\u06FF]/)
  expect(none.stderr).toContain('No render')
  const missing = cli(['compare', join(root, 'nope.mp4'), join(dir, 'ours clip.mp4'), '--out', join(root, 'x')])
  expect(missing.status).toBe(1)
  expect(missing.stderr).toContain('لم يتم العثور على ملف الفيديو — Video file not found:')
  expect(cli(['compare', ref]).status).toBe(2)
  expect(cli(['compare', ref, proj, '--draft']).status).toBe(2)
  expect(cli(['compare', ref, proj, '--scene-thr', '0.3']).status).toBe(2)

  // --track: explicit choice is reported; an empty track is refused; it needs a storyboard.
  const t0 = cli(['compare', ref, proj, '--track', '0', '--out', join(dir, 'track0')])
  expect(t0.status, t0.stderr).toBe(0)
  expect(t0.stdout).toContain('scenes from track 0 (3 scenes), chosen with --track')
  const t5 = cli(['compare', ref, proj, '--track', '5', '--out', join(dir, 'track5')])
  expect(t5.status).toBe(1)
  expect(t5.stderr).toMatch(/^لا توجد مشاهد على المسار 5 — No scenes on track 5/)
  expect(cli(['compare', ref, join(dir, 'ours clip.mp4'), '--track', '0']).status).toBe(2)
  expect(cli(['compare', ref, proj, '--track', 'x']).status).toBe(2)
  expect(cli(['review', ref, '--track', '0']).status).toBe(2)
  const help = cli(['--help'])
  expect(help.stdout).toContain('mba compare <reference.mp4> <projectDir | render.mp4> [--out dir] [--track N]')
  expect(help.stdout).toContain('default --out: <projectDir>/review/compare-<n>, or ./review/compare-<n> for a render file')

  // Stale edit.json: edited after the render, and four seconds of scenes for a three-second render.
  const longer = JSON.stringify({ version: 1, scenes: [slam('s1', 0), slam('s2', 1), slam('s3', 2), slam('s4', 3)] })
  await writeFile(join(proj, 'edit.json'), longer, 'utf8')
  const muchLater = new Date(Date.now() + 120_000)
  await utimes(join(proj, 'edit.json'), muchLater, muchLater)
  const stale = cli(['compare', ref, proj, '--out', join(dir, 'stale')])
  expect(stale.status, stale.stderr).toBe(0)
  const warns = stale.stderr.split(/\r?\n/).filter((l) => l.startsWith('تنبيه — Warning: '))
  expect(warns).toHaveLength(2)
  for (const w of warns) expect(w.slice('تنبيه — Warning: '.length)).toMatch(/^[\u0600-\u06FF]/)
  expect(stale.stderr).toContain('edit.json lasts 4 s but the render lasts 3 s')
  expect(stale.stderr).toContain('edit.json was changed after the render')
  const staleMd = await readFile(join(dir, 'stale', 'compare.md'), 'utf8')
  expect(staleMd).toContain('## تنبيهات — Warnings')
  expect(staleMd).toContain('edit.json lasts 4 s but the render lasts 3 s')
  const staleJson = JSON.parse(await readFile(join(dir, 'stale', 'compare.json'), 'utf8')) as CompareReport
  expect(staleJson.warnings).toHaveLength(2)
})

// ---------------------------------------------------------------------------------------------
// Task 8: style DNA and compare units

const cliRun = (args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, encoding: 'utf8' })

test('mba reference a.mp4 b.mp4 --style writes a parseable StyleDna with both sources', async () => {
  const dir = join(root, 'مخرجات مراجعة', 'style')
  await mkdir(dir, { recursive: true })
  const a = join(dir, 'a.mp4')
  const b = join(dir, 'b.mp4')
  boxClip(a, 6, false)
  boxClip(b, 6, true)
  const out = join(dir, 'out')
  const styleFile = join(out, 'style.json')
  const r = cliRun(['reference', a, b, '--out', join(dir, 'kits'), '--style', styleFile])
  expect(r.status, r.stderr).toBe(0)
  expect(r.stdout).toContain('الأسلوب — Style (2 sources)')
  expect(r.stdout).toMatch(/signature is empty/)
  for (const n of ['a', 'b']) await expectFile(join(dir, 'kits', n, 'reference.json'))
  const style = styleSchema.parse(JSON.parse(await readFile(styleFile, 'utf8')))
  expect(style.sources.map((s) => s.file)).toEqual(['a.mp4', 'b.mp4'])
  for (const [i, f] of [a, b].entries()) {
    const sha1 = createHash('sha1').update(await readFile(f)).digest('hex')
    expect(style.sources[i]!.sha1).toBe(sha1)
    expect(style.sources[i]!.duration).toBeCloseTo(6, 3)
  }
  expect(style.signature).toEqual([])
  expect(style.colours.length).toBeLessThanOrEqual(6)
  expect(style.rhythm.eventsPerSec[1]).toBeGreaterThan(style.rhythm.eventsPerSec[0])

  // A single input keeps the old layout (--out is the kit folder) and --style stays optional.
  const one = cliRun(['reference', a, '--out', join(dir, 'single')])
  expect(one.status, one.stderr).toBe(0)
  await expectFile(join(dir, 'single', 'reference.json'))
  expect(one.stdout).not.toContain('Style (')
})

test('mba compare --units: scenes (short windows), beats (merged), shots, fixed:<s>; --style adherence and exit code', async () => {
  const dir = join(root, 'مخرجات مراجعة', 'units')
  await mkdir(dir, { recursive: true })
  const ref = join(dir, 'ref.mp4')
  const ours = join(dir, 'ours.mp4')
  boxClip(ref, 6, false)
  boxClip(ours, 6, false)
  // A recipe-style storyboard (it names its transcript): twelve half-second scenes on the main line.
  const scenes = Array.from({ length: 12 }, (_, i) => slam(`w${i + 1}`, i * 0.5)).map((s) => ({ ...s, duration: 0.5 }))
  const sb = join(dir, 'edit.json')
  await writeFile(sb, JSON.stringify({ version: 1, transcript: { sourceHash: 'x', words: 12 }, scenes }), 'utf8')
  const later = new Date(Date.now() + 60_000)
  await utimes(ours, later, later)
  const run = (name: string, units?: CompareUnits, style?: StyleDna) =>
    compareVideos({ reference: ref, render: ours, storyboard: sb, outDir: join(dir, name), ...(units ? { units } : {}), ...(style ? { style } : {}) })
  const shorts = (rep: CompareReport) => rep.scenes.filter((s) => s.verdict === 'short').length

  const scn = await run('scenes', 'scenes')
  expect(scn.scenes).toHaveLength(12)
  expect(shorts(scn)).toBeGreaterThan(10)
  for (const u of [undefined, 'beats'] as const) {
    const rep = await run(u ?? 'default', u)
    expect(shorts(rep), String(u)).toBe(0)
    expect(rep.scenes).toHaveLength(6)
    expect(rep.source.summary).toContain('merged into 6 beats')
  }
  const fixed = await run('fixed', { fixed: 2 })
  expect(fixed.scenes).toHaveLength(Math.floor(fixed.durations.ours / 2))
  expect(fixed.source).toMatchObject({ kind: 'windows', units: 'fixed:2' })
  const shots = await run('shots', 'shots')
  expect(shots.source.kind).toBe('windows')
  expect(shots.scenes[0]!.a).toBe(0)
  expect(shots.scenes.at(-1)!.b).toBeCloseTo(shots.durations.ours, 3)

  // --style: the Adherence table and adherence[]; exit code follows the rows.
  const styleFile = join(dir, 'style.json')
  const mk = cliRun(['reference', ref, '--out', join(dir, 'refkit'), '--style', styleFile])
  expect(mk.status, mk.stderr).toBe(0)
  const good = cliRun(['compare', ours, '--ref', ref, '--units', 'fixed:2', '--style', styleFile, '--out', join(dir, 'cli-good')])
  expect(good.status, good.stdout + good.stderr).toBe(0)
  expect(good.stdout).toContain('Style adherence')
  const goodJson = JSON.parse(await readFile(join(dir, 'cli-good', 'compare.json'), 'utf8')) as CompareReport
  expect(goodJson.adherence!.length).toBeGreaterThanOrEqual(4)
  expect(goodJson.adherence!.every((r) => r.ok)).toBe(true)
  expect(await readFile(join(dir, 'cli-good', 'compare.md'), 'utf8')).toMatch(/^## .*Adherence/m)

  const bad = JSON.parse(await readFile(styleFile, 'utf8')) as StyleDna
  bad.rhythm.medianEventGap = [3, 3.5]
  const badFile = join(dir, 'style-bad.json')
  await writeFile(badFile, JSON.stringify(bad), 'utf8')
  const off = cliRun(['compare', ref, ours, '--style', badFile, '--out', join(dir, 'cli-bad')])
  expect(off.status, off.stdout + off.stderr).toBe(1)
  expect(off.stdout).toMatch(/medianEventGap.*not ok/)
  const offJson = JSON.parse(await readFile(join(dir, 'cli-bad', 'compare.json'), 'utf8')) as CompareReport
  expect(offJson.adherence!.find((r) => r.field === 'medianEventGap')!.ok).toBe(false)
  expect(await readFile(join(dir, 'cli-bad', 'compare.md'), 'utf8')).toContain('**not ok**')

  // Without --style nothing changes: no table, exit 0.
  const plain = cliRun(['compare', ref, ours, '--out', join(dir, 'cli-plain')])
  expect(plain.status, plain.stderr).toBe(0)
  expect(JSON.parse(await readFile(join(dir, 'cli-plain', 'compare.json'), 'utf8'))).not.toHaveProperty('adherence')
  // Bad units and options that belong to other commands are usage errors.
  expect(cliRun(['compare', ref, ours, '--units', 'fixed:0']).status).toBe(2)
  expect(cliRun(['compare', ref, ours, '--units', 'nope']).status).toBe(2)
  expect(cliRun(['review', ours, '--units', 'beats']).status).toBe(2)
  expect(cliRun(['review', ours, '--style', badFile]).status).toBe(2)
})
