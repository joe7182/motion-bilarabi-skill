import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendLog, findProjectFor, initProject, nextVersion, openProject } from '../../src/node/project'
import { loadStoryboardFile } from '../../src/node/render'
import { ingestProject } from '../../src/node/ingest'
import { resolveFfmpeg } from '../../src/node/tools'

// Node-side: project folders (no browser page). ffmpeg makes the inputs, ffprobe measures them.
const ENGINE = fileURLToPath(new URL('../..', import.meta.url))

test.describe.configure({ mode: 'serial', timeout: 120_000 })

let root: string
let projects: string
let clipA: string
let clipB: string

/** A lavfi clip with video and audio (argv only, no shell). */
function lavfi(out: string, sec: number, size = '180x320', rate = 30): void {
  const r = spawnSync(
    resolveFfmpeg(),
    [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=s=${size}:r=${rate}:d=${sec}`,
      '-f', 'lavfi', '-i', `sine=f=440:d=${sec}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      out,
    ],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
}

/** Makes every file under `dir` writable again so it can be deleted (read-only copies). */
async function unlock(dir: string): Promise<void> {
  if (!existsSync(dir)) return
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await unlock(p)
    else await chmod(p, 0o644)
  }
}

/** Runs the CLI with node + tsx directly (no shell), so Arabic/space/% paths pass through untouched. */
function cli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, encoding: 'utf8' })
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-'))
  projects = join(root, 'مشاريع تجربة 100%')
  // Same file name in two folders, so the copies must be deduped as "name (2).ext".
  await mkdir(join(root, 'مصادر'), { recursive: true })
  await mkdir(join(root, 'مصادر 2'), { recursive: true })
  clipA = join(root, 'مصادر', 'مقطع %1.mp4')
  clipB = join(root, 'مصادر 2', 'مقطع %1.mp4')
  lavfi(clipA, 2)
  lavfi(clipB, 3)
})
test.afterAll(async () => {
  await unlock(root)
  await rm(root, { recursive: true, force: true })
})

test('init: layout, read-only copies, edit.json, log, manifest', async () => {
  const dir = join(projects, 'p1')
  const before = await readFile(clipA)
  const p = await initProject({ dir, media: [clipA, clipB] })

  for (const d of ['source', 'work', 'renders', 'review']) expect((await stat(join(dir, d))).isDirectory(), d).toBe(true)
  for (const f of ['mba-project.json', 'edit.json', 'log.md']) expect(existsSync(join(dir, f)), f).toBe(true)

  const m = p.manifest
  expect(m.version).toBe(1)
  expect(m.fps).toBe(30)
  expect(m.format).toBe('9:16')
  expect(Number.isNaN(Date.parse(m.createdAt))).toBe(false)
  expect(m.media.map((x) => x.id)).toEqual(['m1', 'm2'])
  expect(m.media.map((x) => x.source)).toEqual(['source/مقطع %1.mp4', 'source/مقطع %1 (2).mp4'])
  expect(m.media[0]!.durationSec).toBeCloseTo(2, 2)
  expect(m.media[1]!.durationSec).toBeCloseTo(3, 2)
  expect(m.media.every((x) => x.work === undefined)).toBe(true)
  expect(JSON.parse(await readFile(join(dir, 'mba-project.json'), 'utf8'))).toEqual(m)

  // The copies are byte-identical and read-only: a write throws. The original is untouched.
  expect((await readFile(join(dir, 'source', 'مقطع %1.mp4'))).equals(before)).toBe(true)
  for (const name of ['مقطع %1.mp4', 'مقطع %1 (2).mp4']) {
    await expect(writeFile(join(dir, 'source', name), 'x'), name).rejects.toThrow(/EPERM|EACCES/)
  }
  await writeFile(join(root, 'probe-write.txt'), 'x') // sanity: the temp root itself is writable
  expect((await readFile(clipA)).equals(before)).toBe(true)

  // edit.json is a valid storyboard: two video scenes end to end on track 0. Its video scenes
  // need working copies (Task 5, project-aware loading): before ingest it is refused, Arabic first.
  await expect(loadStoryboardFile(join(dir, 'edit.json'))).rejects.toThrow(/^[؀-ۿ][^]*mba ingest/)
  const before0 = cli(['validate', join(dir, 'edit.json')])
  expect(before0.status).toBe(1)
  await ingestProject(await openProject(dir))
  const { sb } = await loadStoryboardFile(join(dir, 'edit.json'))
  expect(sb.format).toBe('9:16')
  expect(sb.fps).toBe(30)
  expect(sb.scenes.map((s) => [s.type, s.start, s.start + s.duration, s.track, s.params.media, s.params.in])).toEqual([
    ['video', 0, 2, 0, 'm1', 0],
    ['video', 2, 5, 0, 'm2', 0],
  ])
  const v = cli(['validate', join(dir, 'edit.json')])
  expect(v.status, v.stdout + v.stderr).toBe(0)

  const log = await readFile(join(dir, 'log.md'), 'utf8')
  expect(log).toMatch(/^- \*\*\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\*\* — init — /m)
  expect(log).toContain('مقطع %1 (2).mp4')

  // openProject / findProjectFor / nextVersion / appendLog on the real folder.
  const again = await openProject(dir)
  // Ingest recorded the working copies; everything else is unchanged.
  expect({ ...again.manifest, media: again.manifest.media.map(({ work: _w, durationSec: _d, ...x }) => x) }).toEqual({
    ...m,
    media: m.media.map(({ durationSec: _d, ...x }) => x),
  })
  expect((await findProjectFor(join(dir, 'edit.json')))?.manifest.id).toBe(m.id)
  expect(nextVersion(again, 'draft')).toBe('renders/v001-draft.mp4')
  await appendLog(again, { action: 'render', details: 'renders/v001-draft.mp4\nسطر ثانٍ' })
  const log2 = await readFile(join(dir, 'log.md'), 'utf8')
  expect(log2.startsWith(log)).toBe(true)
  expect(log2.slice(log.length)).toMatch(/^- \*\*\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\*\* — render — renders\/v001-draft\.mp4 سطر ثانٍ\n$/)
})

test('init: --fps 60 and --format 16:9 are stored and used by edit.json', async () => {
  const dir = join(projects, 'p60')
  await ingestProject(await initProject({ dir, media: [clipA], fps: 60, format: '16:9' }))
  const { sb } = await loadStoryboardFile(join(dir, 'edit.json'))
  expect([sb.fps, sb.format]).toEqual([60, '16:9'])
  expect((await openProject(dir)).manifest.fps).toBe(60)
})

test('init into an existing non-project folder is refused, nothing written', async () => {
  const dir = join(projects, 'مجلد عادي')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'ملاحظات.txt'), 'x')
  await expect(initProject({ dir, media: [clipA] })).rejects.toThrow(/^[؀-ۿ].*—.*not a project/s)
  expect(await readdir(dir)).toEqual(['ملاحظات.txt'])
  // An existing project is refused too (init never overwrites edit.json).
  await expect(initProject({ dir: join(projects, 'p1'), media: [clipA] })).rejects.toThrow(/already/)
  // A path that is a file is refused with its own message, and the file is untouched.
  const file = join(projects, 'ملف.txt')
  await writeFile(file, 'x')
  await expect(initProject({ dir: file, media: [clipA] })).rejects.toThrow(/^[؀-ۿ].*— The project path is a file/s)
  expect(await readFile(file, 'utf8')).toBe('x')
})

test('init into an existing EMPTY folder succeeds (R4)', async () => {
  const dir = join(projects, 'فارغ')
  await mkdir(dir, { recursive: true })
  const p = await initProject({ dir, media: [clipA] })
  expect(p.manifest.media).toHaveLength(1)
  expect((await readdir(dir)).sort()).toEqual(['edit.json', 'log.md', 'mba-project.json', 'renders', 'review', 'source', 'work'])
})

test('a copy failing part-way rolls back: pre-existing folder emptied, new folder removed; retry works', async () => {
  let n = 0
  const failSecond = async (src: string, dest: string) => {
    if (++n % 2 === 0) throw new Error('simulated copy failure')
    await copyFile(src, dest)
  }
  // Pre-existing empty folder: emptied again, never removed.
  const pre = join(projects, 'موجود سابقًا')
  await mkdir(pre, { recursive: true })
  const err = await initProject({ dir: pre, media: [clipA, clipB], copyMedia: failSecond }).then(
    () => null,
    (e: Error) => e,
  )
  expect(err?.message).toMatch(/^تعذّر إنشاء المشروع — Could not create the project: simulated copy failure/)
  expect(existsSync(pre)).toBe(true)
  expect(await readdir(pre)).toEqual([])
  // New folder (and new parent): the folder this call created is removed.
  const fresh = join(projects, 'جديد', 'p')
  await expect(initProject({ dir: fresh, media: [clipA, clipB], copyMedia: failSecond })).rejects.toThrow(/simulated copy failure/)
  expect(existsSync(fresh)).toBe(false)
  // A second init then succeeds in both.
  for (const dir of [pre, fresh]) {
    const p = await initProject({ dir, media: [clipA, clipB] })
    expect(p.manifest.media.map((x) => x.source)).toEqual(['source/مقطع %1.mp4', 'source/مقطع %1 (2).mp4'])
  }
})

test('more than 180 s of media is refused, naming the total', async () => {
  const long = join(root, 'مصادر', 'طويل.mp4')
  lavfi(long, 181, '16x16', 2)
  const dir = join(projects, 'طويل')
  const err = await initProject({ dir, media: [long] }).then(
    () => null,
    (e: Error) => e,
  )
  expect(err?.message).toMatch(/^[؀-ۿ]/)
  expect(err?.message).toContain('181')
  expect(err?.message).toContain('180')
  expect(existsSync(dir)).toBe(false)
})

test('init measures a variable-frame-rate clip by its stream duration, not packets / average fps (VFR tail kept)', async () => {
  // 60 fps for 1 s, then every 4th frame (15 fps) to 2.95 s, in Matroska: ffprobe reports
  // avg_frame_rate 60, so 90 packets / 60 fps would claim 1.5 s and drop the tail.
  const vfr = join(root, 'مصادر', 'متغير %.mkv')
  const r = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=180x320:r=60:d=3', '-vf', "select='lt(t\\,1)+not(mod(n\\,4))'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vfr],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
  const dir = join(projects, 'متغير')
  const p = await initProject({ dir, media: [vfr] })
  expect(p.manifest.media[0]!.durationSec).toBeGreaterThan(2.9)
  const edit = JSON.parse(await readFile(join(dir, 'edit.json'), 'utf8')) as { scenes: { duration: number }[] }
  expect(edit.scenes[0]!.duration).toBeGreaterThan(2.9)
  // The working copy covers the whole scene: the init edit.json loads after ingest.
  await ingestProject(p)
  await loadStoryboardFile(join(dir, 'edit.json'))
})

for (const c of [
  { ext: 'mkv', v: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac'] },
  { ext: 'webm', v: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-deadline', 'realtime', '-cpu-used', '8'], a: ['-c:a', 'libopus'] },
  { ext: 'mp4', v: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac'] },
]) {
  test(`init measures the VIDEO of a ${c.ext} whose audio runs longer (2 s video, 2.6 s audio), never the container; the edit loads after ingest`, async () => {
    const src = join(root, 'مصادر', `صوت أطول %.${c.ext}`)
    const r = spawnSync(
      resolveFfmpeg(),
      ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=180x320:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=2.6', ...c.v, ...c.a, src],
      { encoding: 'utf8' },
    )
    expect(r.status, r.stderr).toBe(0)
    const dir = join(projects, `صوت أطول ${c.ext}`)
    const p = await initProject({ dir, media: [src] })
    expect(Math.abs(p.manifest.media[0]!.durationSec! - 2)).toBeLessThanOrEqual(1 / 30 + 1e-9)
    const edit = JSON.parse(await readFile(join(dir, 'edit.json'), 'utf8')) as { scenes: { duration: number }[] }
    expect(edit.scenes[0]!.duration).toBeLessThanOrEqual(2 + 1e-9)
    expect(edit.scenes[0]!.duration).toBeGreaterThan(1.9)
    await ingestProject(p)
    await loadStoryboardFile(join(dir, 'edit.json'))
  })
}

test('openProject on a plain folder is refused; findProjectFor gives null', async () => {
  const dir = join(projects, 'عادي')
  await mkdir(dir, { recursive: true })
  await expect(openProject(dir)).rejects.toThrow(/^[؀-ۿ].*—.*mba-project\.json/s)
  expect(await findProjectFor(join(dir, 'edit.json'))).toBeNull()
})

test('CLI: project init / info, Arabic first; usage errors exit 2', async () => {
  const dir = join(projects, 'cli p')
  const r = cli(['project', 'init', dir, clipA, clipB, '--fps', '30', '--format', '1:1'])
  expect(r.status, r.stderr).toBe(0)
  expect(r.stdout).toMatch(/^[؀-ۿ]/)
  expect(r.stdout).toContain(dir)
  const info = cli(['project', 'info', dir])
  expect(info.status, info.stderr).toBe(0)
  expect(info.stdout).toMatch(/^[؀-ۿ]/)
  for (const s of ['m1', 'm2', 'source/مقطع %1 (2).mp4', '1:1', 'renders/v001-draft.mp4', '5 s']) expect(info.stdout).toContain(s)
  expect(info.stdout).toMatch(/working copy/i)

  expect(cli(['project', 'info', join(projects, 'عادي')]).status).toBe(1)
  expect(cli(['project', 'init', join(projects, 'x'), clipA, '--fps', '25']).status).toBe(2)
  expect(cli(['project', 'init', join(projects, 'x'), clipA, '--format', '3:2']).status).toBe(2)
  expect(cli(['project', 'init', join(projects, 'x')]).status).toBe(2)
  expect(cli(['project', 'nope', dir]).status).toBe(2)
  expect(cli(['project', 'info', dir, '--fps', '60']).status).toBe(2)
  expect(existsSync(join(projects, 'x'))).toBe(false)
})

test('CLI: project init without --fps writes 60 fps (project and edit.json); --fps 30 writes 30', async () => {
  const read = async (d: string) => ({
    fps: (await openProject(d)).manifest.fps,
    editFps: (JSON.parse(await readFile(join(d, 'edit.json'), 'utf8')) as { fps: number }).fps,
  })
  const d60 = join(projects, 'cli fps default')
  const r60 = cli(['project', 'init', d60, clipA])
  expect(r60.status, r60.stderr).toBe(0)
  expect(r60.stdout).toMatch(/60 fps/)
  expect(await read(d60)).toEqual({ fps: 60, editFps: 60 })

  const d30 = join(projects, 'cli fps thirty')
  const r30 = cli(['project', 'init', d30, clipA, '--fps', '30'])
  expect(r30.status, r30.stderr).toBe(0)
  expect(r30.stdout).toMatch(/30 fps/)
  expect(await read(d30)).toEqual({ fps: 30, editFps: 30 })
})
