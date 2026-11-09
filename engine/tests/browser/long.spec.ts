import { test, expect } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initProject, openProject } from '../../src/node/project'
import { projectTempDir } from '../../src/node/tempdirs'
import { ingestProject } from '../../src/node/ingest'
import { REVIEW } from '../../src/node/review'
import { SHEET_PAGE_TILES } from '../../src/node/sheets'
import { DEFAULT_PROBE_BUDGET } from '../../src/node/verify'
import { resolveFfmpeg, resolveFfprobe } from '../../src/node/tools'

// Node-side: a 170 s project through review and verify, each in its own child process so its peak
// RSS is measured on the tool's process alone. Serial; test.slow() with an explicit timeout.
test.describe.configure({ mode: 'serial', timeout: 1_200_000 })

const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const SEC = 170
const RSS_LIMIT = 1.5 * 1024 ** 3

let root: string

async function unlock(d: string): Promise<void> {
  if (!existsSync(d)) return
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) await unlock(p)
    else await chmod(p, 0o644)
  }
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-'))
})
test.afterAll(async () => {
  await unlock(root)
  await rm(root, { recursive: true, force: true })
})

interface Measured<T> {
  wallSec: number
  sampledPeakRss: number
  maxRss: number
  result: T
}

function measure<T>(args: string[]): Promise<Measured<T>> {
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/measure-rss.ts', ...args], { cwd: ENGINE, windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    proc.stderr.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(-4000)))
    proc.once('close', (code) => {
      if (code !== 0) return rej(new Error(`measure ${args[0]} exit ${code}: ${stderr}`))
      res(JSON.parse(stdout.trim().split('\n').at(-1)!) as Measured<T>)
    })
  })
}

const mb = (b: number) => `${(b / 1024 ** 2).toFixed(0)} MB`

/** Height of a JPEG in px (ffprobe). */
function heightOf(file: string): number {
  const r = spawnSync(resolveFfprobe(), ['-v', 'error', '-show_entries', 'stream=height', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return Number(r.stdout.trim())
}

const HEADLINES = [
  { text: 'الذكاء الاصطناعي يغيّر كل شيء', accent: 'يغيّر' },
  { text: 'خبر عاجل من عالم التقنية', accent: 'عاجل' },
  { text: 'Claude أصبح أسرع', accent: 'أسرع' },
]

test('long: a 170 s project (video cuts + a slam every 20 s) — review paginates within 1.5 GB, verify stays within its probe budget', async () => {
  test.slow()
  // The clip: testsrc2 (a moving pattern with a timecode), 270×480 at 30 fps, GOP 30.
  const media = join(root, 'مصادر %50')
  await mkdir(media, { recursive: true })
  const clip = join(media, 'مقطع طويل %1.mp4')
  const r = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', `testsrc2=s=270x480:r=30:d=${SEC}`, '-c:v', 'libx264', '-crf', '20', '-g', '30', '-pix_fmt', 'yuv420p', clip],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
  const p = await initProject({ dir: join(root, 'مشاريع تجربة 100%', 'طويل'), media: [clip] })
  await ingestProject(p)

  // 17 back-to-back 10 s video scenes (16 hard cuts) + a 2.5 s slam every 20 s on track 1.
  const scenes = [
    ...Array.from({ length: 17 }, (_, k) => ({ id: `v${k + 1}`, type: 'video', start: k * 10, duration: 10, track: 0, params: { media: 'm1', in: k * 10 } })),
    ...Array.from({ length: 9 }, (_, k) => ({ id: `s${k + 1}`, type: 'slam', start: k * 20, duration: 2.5, track: 1, params: { ...HEADLINES[k % 3]!, tag: 'تحديث' } })),
  ]
  const edit = join(p.dir, 'edit.json')
  await writeFile(edit, JSON.stringify({ version: 1, format: '9:16', fps: 30, look: 'dark-tech', scenes }, null, 2))

  // Review.
  const out = join(p.dir, 'review', 'r1')
  const rv = await measure<{ sheets: string[]; duration: number; auditSamples: number; notes: string[] }>(['review', edit, out])
  console.log(`[long] review: ${rv.wallSec.toFixed(1)} s wall, peak RSS ${mb(rv.maxRss)} (sampled ${mb(rv.sampledPeakRss)}); sheets ${(rv.result.sheets ?? []).join(', ')}`)
  expect(rv.result.duration).toBeCloseTo(SEC, 1)
  const contactTiles = SEC * REVIEW.contactFps + 1 // 2 fps plus the last frame
  const phoneTiles = SEC * REVIEW.phoneFps + 1
  const pages = (base: string, tiles: number) =>
    Array.from({ length: Math.ceil(tiles / SHEET_PAGE_TILES) }, (_, k) => (k === 0 ? `${base}.jpg` : `${base}-${k + 1}.jpg`))
  const contact = pages('contact', contactTiles)
  const phone = pages('phone', phoneTiles)
  const safe = pages('safe', phoneTiles)
  expect(contact.length).toBeGreaterThanOrEqual(2)
  expect(rv.result.sheets).toEqual([...contact, 'strip_fast_1.jpg', 'strip_fast_2.jpg', ...phone, ...safe])
  const metrics = JSON.parse(await readFile(join(out, 'metrics.json'), 'utf8')) as { sheets: string[] }
  expect(metrics.sheets).toEqual(rv.result.sheets)
  for (const f of rv.result.sheets) expect(existsSync(join(out, f)), f).toBe(true)
  // At most 60 tiles a page: 10 rows of 6 (a 9:16 tile 180 px wide is 320 + 22 px label).
  const rowH = (REVIEW.contactTileW * 16) / 9 + 22
  for (const f of contact) expect(heightOf(join(out, f))).toBeLessThanOrEqual(Math.ceil((SHEET_PAGE_TILES / REVIEW.contactCols) * rowH))
  expect(rv.maxRss).toBeLessThan(RSS_LIMIT)
  expect(rv.sampledPeakRss).toBeLessThan(RSS_LIMIT)
  if (process.env.MBA_LONG_KEEP) {
    await mkdir(process.env.MBA_LONG_KEEP, { recursive: true })
    for (const f of rv.result.sheets) await copyFile(join(out, f), join(process.env.MBA_LONG_KEEP, f))
  }

  // Verify.
  const vf = await measure<{ probes: number; mismatches: unknown[]; pageErrors: string[]; frames?: { onDemand: number }; wallSec: number }>(['verify', edit])
  console.log(`[long] verify: ${vf.result.probes} probes, ${vf.wallSec.toFixed(1)} s wall (reported ${vf.result.wallSec.toFixed(1)} s), peak RSS ${mb(vf.maxRss)} (sampled ${mb(vf.sampledPeakRss)})`)
  expect(vf.result.probes).toBeLessThanOrEqual(DEFAULT_PROBE_BUDGET)
  expect(vf.result.probes).toBeGreaterThanOrEqual(DEFAULT_PROBE_BUDGET - 1)
  expect(vf.result.mismatches).toEqual([])
  expect(vf.result.pageErrors).toEqual([])
  expect(vf.result.frames?.onDemand).toBe(0)
  expect(vf.maxRss).toBeLessThan(RSS_LIMIT)

  // Nothing extracted is left behind; verify wrote no PNGs (no mismatch).
  expect(existsSync(join(p.dir, 'work', '.frames'))).toBe(false)
  expect(existsSync(projectTempDir(await openProject(p.dir)))).toBe(false)
  expect(existsSync(join(p.dir, 'review', 'verify'))).toBe(false)
})
