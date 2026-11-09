import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderVideo, renderStills } from '../../src/node/render'
import { resolveFfprobe } from '../../src/node/tools'
import { parseStoryboard, storyboardDuration } from '../../src/core/storyboard'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'

// Node-side tests: the renderer starts its own Vite on a free port and its own Chromium.
const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const PROBE = join(ENGINE, 'tests/fixtures/probe.json')

test.describe.configure({ timeout: 120_000 })

test('renders probe storyboard to a path with spaces and Arabic', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'mba-'))
  try {
    const out = join(tmp, 'مخرجات تجربة', 'out put.mp4')
    let last = [0, -1]
    await renderVideo({ storyboardPath: PROBE, outPath: out, onProgress: (d, t) => (last = [d, t]) })
    expect(last[0]).toBe(last[1])
    const r = spawnSync(resolveFfprobe(), ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', out], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    const info = JSON.parse(r.stdout)
    const v = info.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
    expect(v.width).toBe(1080)
    expect(v.height).toBe(1920)
    expect(v.r_frame_rate).toBe('30/1')
    const sb = parseStoryboard(JSON.parse(await readFile(PROBE, 'utf8')), [...PRIMITIVE_IDS])
    expect(Math.abs(Number(info.format.duration) - storyboardDuration(sb))).toBeLessThanOrEqual(0.05)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('a 4:5 draft renders at half size with even sides (1080×1350 → 540×674)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'mba-'))
  try {
    const sb = join(tmp, 'مسودة 4x5.json')
    await writeFile(sb, JSON.stringify({ version: 1, format: '4:5', look: 'dark-tech', scenes: [{ id: 's', type: 'slam', start: 0, duration: 0.5, params: { text: 'مسودة' } }] }))
    const out = join(tmp, 'draft.mp4')
    await renderVideo({ storyboardPath: sb, outPath: out, draft: true })
    const r = spawnSync(resolveFfprobe(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout.trim().split(',').slice(0, 2)).toEqual(['540', '674'])
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('a final render of a 60 fps project is 60 fps; a draft may be asked at 30; an edit.json with no fps follows the project', async () => {
  test.setTimeout(240_000)
  const tmp = await mkdtemp(join(tmpdir(), 'mba-'))
  const probe = (file: string) => {
    const r = spawnSync(resolveFfprobe(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,nb_frames', '-of', 'json', file], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    return (JSON.parse(r.stdout) as { streams: { r_frame_rate: string; nb_frames: string }[] }).streams[0]!
  }
  try {
    const dir = join(tmp, 'مشروع ستين 100%')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'mba-project.json'), JSON.stringify({ version: 1, id: 'p60', createdAt: '2026-10-31T00:00:00.000Z', fps: 60, format: '9:16', media: [] }))
    await writeFile(join(dir, 'log.md'), '# log\n\n')
    // No fps in the edit: the project's 60.
    await writeFile(join(dir, 'edit.json'), JSON.stringify({ version: 1, format: '9:16', look: 'dark-tech', autoSfx: false, scenes: [{ id: 's', type: 'slam', start: 0, duration: 0.5, params: { text: 'ستون' } }] }))
    const final = await renderVideo({ storyboardPath: join(dir, 'edit.json') })
    expect(final.version).toBe('v001-final')
    expect(probe(final.outPath)).toMatchObject({ r_frame_rate: '60/1', nb_frames: '30' })
    const draft = await renderVideo({ storyboardPath: join(dir, 'edit.json'), draft: true, fps: 30 })
    expect(probe(draft.outPath)).toMatchObject({ r_frame_rate: '30/1', nb_frames: '15' })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('frame 0 is stable', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'mba-'))
  try {
    const [a] = await renderStills({ storyboardPath: PROBE, times: [0], outDir: join(tmp, 'أ') })
    await new Promise((r) => setTimeout(r, 1000))
    const [b] = await renderStills({ storyboardPath: PROBE, times: [0], outDir: join(tmp, 'ب b') })
    expect(a!.endsWith('still-0.png')).toBe(true)
    const [ba, bb] = [await readFile(a!), await readFile(b!)]
    expect(ba.length).toBeGreaterThan(1000)
    expect(ba.equals(bb)).toBe(true)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('a storyboard with bad primitive params fails with its field path instead of hanging', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'mba-'))
  try {
    // search-bad-params.json has no `text`: rejected node-side, before any browser starts.
    const run = renderStills({ storyboardPath: join(ENGINE, 'tests/fixtures/search-bad-params.json'), times: [0], outDir: tmp })
    await expect(run).rejects.toThrow(/scenes\[0\]\.params\.text/)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('validate prints field path', async () => {
  const r = spawnSync('npx tsx src/cli.ts validate tests/fixtures/bad-duration.json', { cwd: ENGINE, shell: true, encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(1)
  expect(r.stdout).toContain('scenes[0].duration')
})

test('validate prints OK for a good storyboard', async () => {
  const r = spawnSync('npx tsx src/cli.ts validate tests/fixtures/probe.json', { cwd: ENGINE, shell: true, encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  expect(r.stdout.trim()).toBe('OK')
})

test('validate rejects primitive params the renderer would reject (41-char wipe title)', async () => {
  const r = spawnSync('npx tsx src/cli.ts validate tests/fixtures/wipe-long-title.json', { cwd: ENGINE, shell: true, encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(1)
  expect(r.stdout).toContain('scenes[0].params.title')
})

test('preview rejects a bad storyboard up front (exit 1, field path) instead of serving a blank page', async () => {
  // Plain node (no shell) so a regression that starts the server is killed by the timeout.
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'preview', 'tests/fixtures/wipe-long-title.json'], {
    cwd: ENGINE,
    encoding: 'utf8',
    timeout: 60_000,
  })
  expect(r.error).toBeUndefined() // no timeout: the server never started
  expect(r.status, r.stdout).toBe(1)
  expect(r.stderr).toContain('scenes[0].params.title')
  expect(r.stderr).toMatch(/[؀-ۿ]/)
  expect(r.stdout).not.toContain('http://')
})
