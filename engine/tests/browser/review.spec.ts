import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReviewKit, REVIEW_METRIC_KEYS, type ReviewMetrics } from '../../src/node/review'
import { grayFrames, probeVideo } from '../../src/node/frames'
import { ANALYSIS_FPS } from '../../src/node/metrics'
import { resolveFfmpeg } from '../../src/node/tools'

// Node-side: review renders a draft (own Vite + Chromium), decodes with ffmpeg and screenshots the
// sheets with Playwright. Slow (R5).
const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const DEMO = join(ENGINE, 'examples/demo-ar.json')
const FIXTURES = join(ENGINE, 'tests/fixtures')
const BG: [number, number, number] = [14, 13, 12] // dark-tech look.bg #0e0d0c

test.describe.configure({ mode: 'serial', timeout: 180_000 })

let root: string
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-'))
})
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** `<tmp>/mba-<rand>/مخرجات مراجعة/<name>`: spaces and Arabic in every output path. */
const outDir = (name: string) => join(root, 'مخرجات مراجعة', name)

/** Makes a synthetic video with ffmpeg's lavfi source (argv only, no shell). */
async function lavfi(name: string, source: string): Promise<string> {
  const dir = join(root, 'مصادر')
  await mkdir(dir, { recursive: true })
  const out = join(dir, name)
  const r = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
  return out
}

/** Width and height from a JPEG's SOF marker. */
async function jpegSize(path: string): Promise<{ w: number; h: number }> {
  const b = await readFile(path)
  expect(b[0] === 0xff && b[1] === 0xd8, `${path} is a JPEG`).toBe(true)
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error('bad JPEG marker')
    const m = b[i + 1]!
    const len = b.readUInt16BE(i + 2)
    if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new Error('no SOF marker')
}

async function expectImage(path: string, width: number) {
  expect(existsSync(path), path).toBe(true)
  expect((await stat(path)).size).toBeGreaterThan(0)
  expect((await jpegSize(path)).w).toBe(width)
}

/** Runs the CLI with node + tsx directly (no shell), so Arabic/space paths pass through untouched. */
function cli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, encoding: 'utf8' })
}

function expectMetricShape(m: ReviewMetrics) {
  expect(Object.keys(m).sort()).toEqual([...REVIEW_METRIC_KEYS].sort())
  expect(m.analysisFps).toBe(ANALYSIS_FPS)
  // Pace fields come from the same paceOf as mba reference: consistent with eventTimes/staticRuns.
  for (const k of ['eventsPerSec', 'medianEventGap', 'maxEventGap', 'movingPct'] as const) expect(Number.isFinite(m[k]), k).toBe(true)
  expect(m.eventsPerSec).toBeCloseTo(m.eventTimes.length / m.duration, 2)
  const still = m.staticRuns.reduce((a, r) => a + (r.end - r.start), 0)
  expect(m.movingPct).toBeCloseTo(Math.max(0, 1 - still / m.duration), 2)
}

test('review on demo storyboard', async () => {
  const dir = outDir('r1')
  const m = await buildReviewKit({ storyboardPath: DEMO, outDir: dir })
  expectMetricShape(m)
  expect(existsSync(join(dir, 'draft.mp4'))).toBe(true)
  await expectImage(join(dir, 'contact.jpg'), 6 * 180)
  await expectImage(join(dir, 'strip_fast_1.jpg'), 6 * 180)
  await expectImage(join(dir, 'strip_fast_2.jpg'), 6 * 180)
  await expectImage(join(dir, 'phone.jpg'), 6 * 360)
  await expectImage(join(dir, 'safe.jpg'), 6 * 180)
  const onDisk = JSON.parse(await readFile(join(dir, 'metrics.json'), 'utf8')) as ReviewMetrics
  expect(onDisk).toEqual(m)

  expect(m.format).toBe('9:16')
  expect(m.fps).toBe(30)
  expect(m.duration).toBeCloseTo(8, 6)
  // The scene prerolls (R27/R28) put the search bar on frame 0 and the slam on the whip-pan cut
  // frame at 3.9 s, so no frame is background-only (detail, R23).
  expect(m.frame0Blank).toBe(false)
  expect(m.nearBlankTimes).toEqual([])
  expect(m.nearBlankRuns).toEqual([])
  expect(m.maxEventGap).toBeLessThan(4)
  expect(m.eventsPerSec).toBeGreaterThan(0.5)
  expect(m.medianEventGap).toBeGreaterThan(0)
  expect(m.medianEventGap).toBeLessThanOrEqual(m.maxEventGap)
  expect(m.movingPct).toBeGreaterThan(0.5)
  expect(m.fastest).toHaveLength(2)
  expect(Math.abs(m.fastest[0]! - m.fastest[1]!)).toBeGreaterThanOrEqual(1)
  // Audit: every 0.5 s over 8 s, and no issue anywhere.
  expect(m.audit).not.toBeNull()
  expect(m.audit!.map((a) => a.t)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5])
  expect(m.audit!.flatMap((a) => a.issues)).toEqual([])
})

test('review on a static 3 s lavfi video', async () => {
  const video = await lavfi('black 3s.mp4', 'color=c=black:s=1080x1920:d=3:r=30')
  const dir = outDir('static')
  const m = await buildReviewKit({ videoPath: video, outDir: dir })
  expectMetricShape(m)
  expect(m.audit).toBeNull()
  expect(m.format).toBe('9:16')
  expect(m.nearBlankTimes.length).toBeGreaterThan(0)
  expect(m.frame0Blank).toBe(true)
  // Plain video: every flat frame is blank; the run records its mean colour, never `designed`.
  expect(m.nearBlankRuns).toHaveLength(1)
  expect(m.nearBlankRuns[0]).toMatchObject({ start: 0, end: 3, designed: false })
  for (const c of m.nearBlankRuns[0]!.nearBlankColor) expect(c).toBeLessThanOrEqual(8)
  expect(m.longestStatic).toBeCloseTo(3, 1)
  expect(m.eventTimes).toEqual([])
  expect(m.maxEventGap).toBeCloseTo(3, 1)
  expect(m.eventsPerSec).toBe(0)
  expect(m.medianEventGap).toBeCloseTo(3, 1)
  expect(m.movingPct).toBe(0)
  expect(m.fastest).toEqual([])
  expect(m.notes.join('\n')).toMatch(/no motion/i)
  for (const f of ['contact.jpg', 'strip_fast_1.jpg', 'strip_fast_2.jpg', 'safe.jpg']) await expectImage(join(dir, f), 6 * 180)
  await expectImage(join(dir, 'phone.jpg'), 6 * 360)
})

test('review: the color-wipe cover at the cut is designed, not blank; a bare background gap is blank', async () => {
  // tr-color-wipe: the accent cover fills the frame at the cut (2.0 s) by design (R10).
  const wipe = await buildReviewKit({ storyboardPath: join(FIXTURES, 'tr-color-wipe.json'), outDir: outDir('color wipe') })
  expectMetricShape(wipe)
  const atCut = wipe.nearBlankRuns.filter((r) => !r.designed && r.start <= 2 + 1e-9 && r.end > 2 - 1e-9)
  expect(atCut).toEqual([])
  expect(wipe.nearBlankTimes.filter((t) => Math.abs(t - 2) < 0.1)).toEqual([])
  expect(wipe.notes.join(' | ')).toMatch(/not the background/i)

  // gap.json: nothing on screen between 1.2 and 1.7 s, only the look background.
  const gap = await buildReviewKit({ storyboardPath: join(FIXTURES, 'gap.json'), outDir: outDir('gap') })
  expectMetricShape(gap)
  const hole = gap.nearBlankRuns.find((r) => r.start <= 1.3 && r.end >= 1.6)
  expect(hole, JSON.stringify(gap.nearBlankRuns)).toBeDefined()
  expect(hole!.designed).toBe(false)
  hole!.nearBlankColor.forEach((c, i) => expect(Math.abs(c - BG[i]!)).toBeLessThanOrEqual(12))
})

test('review on a 0.5 s video', async () => {
  // 10 fps: 5 frames, fewer than a 12-frame strip, and no room for two moments 1 s apart.
  const video = await lavfi('short.mp4', 'testsrc2=s=1080x1920:r=10:d=0.5')
  const dir = outDir('short')
  const m = await buildReviewKit({ videoPath: video, outDir: dir })
  expectMetricShape(m)
  expect(m.duration).toBeCloseTo(0.5, 6)
  expect(m.fastest.length).toBeLessThan(2)
  const notes = m.notes.join('\n')
  expect(notes).toMatch(/shorter than a strip/i)
  expect(notes).toMatch(/5 frames/)
  expect(notes).toMatch(/strip_fast_2/)
  await expectImage(join(dir, 'strip_fast_1.jpg'), 6 * 180)
  await expectImage(join(dir, 'strip_fast_2.jpg'), 6 * 180)
  await expectImage(join(dir, 'contact.jpg'), 6 * 180)
})

test('review on a 16:9 video: no safe sheet, landscape gray frames', async () => {
  const video = await lavfi('wide.mp4', 'testsrc2=s=1920x1080:r=30:d=1')
  const p = await probeVideo(video)
  expect(p).toMatchObject({ w: 1920, h: 1080, fps: 30, frames: 30 })
  expect(p.duration).toBeCloseTo(1, 6)
  const g = await grayFrames(video)
  expect(g).toHaveLength(30)
  expect(g[0]!.length).toBe(128 * 72)
  const dir = outDir('wide')
  const m = await buildReviewKit({ videoPath: video, outDir: dir })
  expect(m.format).toBe('16:9')
  expect(existsSync(join(dir, 'safe.jpg'))).toBe(false)
  expect(m.notes.join('\n')).toMatch(/safe\.jpg/)
  await expectImage(join(dir, 'contact.jpg'), 6 * 180)
})

test('mba review CLI: summary, exit codes', async () => {
  const video = await lavfi('cli.mp4', 'color=c=black:s=1080x1920:d=1:r=30')
  const dir = outDir('cli')
  const ok = cli(['review', video, '--out', dir])
  expect(ok.status, ok.stderr).toBe(0)
  expect(ok.stdout).toContain(dir)
  expect(ok.stdout).toMatch(/أطول ثبات — Longest static/)
  expect(ok.stdout).toMatch(/Max event gap/)
  expect(ok.stdout).toMatch(/الإيقاع — Pace: eventsPerSec 0, medianEventGap 1 s, moving 0 %/)
  expect(ok.stdout).toMatch(/Audit issues/)
  expect(existsSync(join(dir, 'metrics.json'))).toBe(true)

  const missing = cli(['review', join(root, 'nope.mp4'), '--out', outDir('x')])
  expect(missing.status).toBe(1)
  expect(missing.stderr).toMatch(/[؀-ۿ].*—/)

  expect(cli(['review']).status).toBe(2)
  expect(cli(['review', video, '--draft']).status).toBe(2)
})
