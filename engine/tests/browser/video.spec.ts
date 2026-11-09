import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { initProject, type Project } from '../../src/node/project'
import { ingestProject } from '../../src/node/ingest'
import { loadStoryboardFile, openRenderPage, renderStills, renderVideo, seekFrame, type RenderPage } from '../../src/node/render'
import { verifyDeterminism } from '../../src/node/verify'
import { createFrameServer, framesNeeded, ON_DEMAND_MAX, sweepStaleTemps, type FrameServerStats } from '../../src/node/framesrv'
import { framesRootOf, projectTempDir } from '../../src/node/tempdirs'
import { resolveFfmpeg } from '../../src/node/tools'
import type {} from '../../src/runtime/mba-api'

// Node-side: a real project (lavfi clip → init → ingest), frames served by the frame server to the
// runtime page that openRenderPage starts. Serial, explicit timeout.
test.describe.configure({ mode: 'serial', timeout: 240_000 })

/*
 * The clip: 3 s at 30 fps, 270×480 (9:16). Every frame carries its own FRAME INDEX n as an 8-bit
 * code in 8 vertical black/white stripes (stripe k white ⇔ bit k of n), the trick ingest.spec uses
 * (binary stripes survive x264 and JPEG, a grey ramp does not). Stripes run the full height, so any
 * row outside the motion graphics reads the code.
 */
const W = 1080
const H = 1920
const CLIP_SEC = 3
const CLIP_FRAMES = 90
const stripes = `geq=lum='if(mod(floor(floor(T*30+0.5)/pow(2\\,floor(X*8/W)))\\,2)\\,235\\,16)':cb=128:cr=128`

let root: string
let project: Project
let dir: string

async function unlock(d: string): Promise<void> {
  if (!existsSync(d)) return
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) await unlock(p)
    else await chmod(p, 0o644)
  }
}

/** Decodes the code from a gray row of 8 stripe centres. */
function decode(px: (x: number) => number): number {
  let c = 0
  for (let k = 0; k < 8; k++) if (px(Math.round(((k + 0.5) * W) / 8)) > 127) c |= 1 << k
  return c
}
/** The frame index shown in a 1080×1920 PNG, read on row `y` (default: near the bottom). */
function codeOf(png: Buffer, y = H - 40): number {
  const img = PNG.sync.read(png)
  return decode((x) => {
    const i = (y * img.width + x) * 4
    return (img.data[i]! + img.data[i + 1]! + img.data[i + 2]!) / 3
  })
}
/** The code of an extracted JPEG (decoded by ffmpeg to 8 gray pixels). */
function codeOfJpeg(file: string): number {
  const r = spawnSync(resolveFfmpeg(), ['-v', 'error', '-i', file, '-vf', 'scale=8:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
  expect(r.status, String(r.stderr)).toBe(0)
  let c = 0
  for (let k = 0; k < 8; k++) if (r.stdout[k]! > 127) c |= 1 << k
  return c
}

/** The code of a JPEG held in memory. */
function codeOfJpegBuf(buf: Buffer): number {
  const r = spawnSync(resolveFfmpeg(), ['-v', 'error', '-f', 'mjpeg', '-i', '-', '-vf', 'scale=8:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { input: buf })
  expect(r.status, String(r.stderr)).toBe(0)
  let c = 0
  for (let k = 0; k < 8; k++) if (r.stdout[k]! > 127) c |= 1 << k
  return c
}

const shot = (rp: RenderPage) => rp.page.screenshot({ clip: { x: 0, y: 0, width: W, height: H }, type: 'png', caret: 'hide' })

type Scene = Record<string, unknown>
const vid = (extra: Scene = {}, params: Scene = {}): Scene => ({
  id: 'v', type: 'video', start: 0, duration: 1, track: 0, params: { media: 'm1', in: 1.0, ...params }, ...extra,
})
const slam: Scene = { id: 's', type: 'slam', start: 0, duration: 1, track: 1, params: { text: 'عنوان فوق الفيديو' } }

async function writeSb(name: string, scenes: Scene[], extra: Scene = {}): Promise<string> {
  const p = join(dir, name)
  await writeFile(p, JSON.stringify({ version: 1, format: '9:16', fps: 30, look: 'dark-tech', scenes, ...extra }, null, 2))
  return p
}
/** Everything left in the project's frame folder (`<tmp>/mba/<id>/frames`); the project folder never gets one. */
const framesLeft = async () => {
  expect(existsSync(join(dir, 'work', '.frames'))).toBe(false)
  const root = framesRootOf(project)
  return existsSync(root) ? await readdir(root, { recursive: true }) : []
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-'))
  const media = join(root, 'مصادر %50')
  await mkdir(media, { recursive: true })
  const clip = join(media, 'مقطع %1.mp4')
  const r = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=black:s=72x128:r=30:d=${CLIP_SEC},format=yuv420p,${stripes},scale=270:480:flags=neighbor`,
      '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', clip],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
  dir = join(root, 'مشاريع تجربة 100%', 'فيديو')
  project = await initProject({ dir, media: [clip] })
  await ingestProject(project)
  expect(project.manifest.media[0]!.durationSec).toBeCloseTo(CLIP_SEC, 3)
})
test.afterAll(async () => {
  await unlock(root)
  await rm(root, { recursive: true, force: true })
})

test('prepare extracts exactly frame n as <n>.jpg (time-coded frames), from any start, one call per media; release empties the frame folder', async () => {
  const fs = createFrameServer(project)
  const t0 = performance.now()
  await fs.prepare([{ mediaId: 'm1', from: 0, to: CLIP_FRAMES - 1 }])
  const allMs = performance.now() - t0
  expect(fs.stats().calls).toBe(1)
  for (let n = 0; n < CLIP_FRAMES; n++) expect(codeOfJpeg(fs.framePath('m1', n)), `frame ${n}`).toBe(n)
  await fs.release()
  expect(await framesLeft()).toEqual([])

  // Starts inside a GOP (17), on a GOP boundary (45), sparse runs, and the very last frame.
  const fs2 = createFrameServer(project)
  await fs2.prepare([
    { mediaId: 'm1', from: 17, to: 20 },
    { mediaId: 'm1', from: 45, to: 45 },
    { mediaId: 'm1', from: 60, to: 62 },
    { mediaId: 'm1', from: 89, to: 89 },
  ])
  expect(fs2.stats().calls).toBe(1)
  const got = (await readdir(join(framesRootOf(project), 'm1'))).sort((a, b) => parseInt(a) - parseInt(b))
  expect(got).toEqual(['17.jpg', '18.jpg', '19.jpg', '20.jpg', '45.jpg', '60.jpg', '61.jpg', '62.jpg', '89.jpg'])
  for (const f of got) expect(codeOfJpeg(join(framesRootOf(project), 'm1', f)), f).toBe(parseInt(f))
  // A second prepare of frames already there costs no ffmpeg call.
  await fs2.prepare([{ mediaId: 'm1', from: 18, to: 19 }])
  expect(fs2.stats().calls).toBe(1)
  // Releasing part keeps the rest; releasing everything leaves nothing.
  await fs2.release([{ mediaId: 'm1', from: 17, to: 20 }])
  expect((await readdir(join(framesRootOf(project), 'm1'))).length).toBe(5)
  await fs2.release()
  expect(await framesLeft()).toEqual([])
  // Frames outside the working copy are refused, never substituted.
  await expect(fs2.prepare([{ mediaId: 'm1', from: 89, to: 90 }])).rejects.toThrow(/^[؀-ۿ].*Frame 90 is outside/s)
  await fs2.release()
  console.log(`[video.spec] extraction: ${CLIP_FRAMES} frames in ${allMs.toFixed(0)} ms (${((CLIP_FRAMES * 1000) / allMs).toFixed(0)} frames/s)`)
})

test('frames live in the system temp folder <tmp>/mba/<project id>/frames, never in the (possibly synced) project folder', async () => {
  const fs = createFrameServer(project, { session: true })
  expect(fs.dir.startsWith(join(tmpdir(), 'mba', project.manifest.id, 'frames'))).toBe(true)
  expect(framesRootOf(project)).toBe(join(tmpdir(), 'mba', project.manifest.id, 'frames'))
  await fs.prepare([{ mediaId: 'm1', from: 3, to: 5 }])
  expect(existsSync(fs.framePath('m1', 4))).toBe(true)
  expect(fs.framePath('m1', 4).startsWith(dir)).toBe(false)
  expect(existsSync(join(dir, 'work', '.frames'))).toBe(false)
  await fs.release()
  expect(await framesLeft()).toEqual([])
  // The emptied project temp folder goes too.
  expect(existsSync(projectTempDir(project))).toBe(false)
})

test('preview cap: on-demand frames are kept to maxOnDemand per media, least recently served evicted first', async () => {
  expect(ON_DEMAND_MAX).toBe(600)
  const fs = createFrameServer(project, { session: true, maxOnDemand: 40 })
  try {
    // Frame 0 → window 0..29 (30 frames); frame 50 → window 46..75: 60 > 40, so the 20 least
    // recently served go: 1..20 (frame 0 was just served, so it stays).
    expect(codeOfJpegBuf(await fs.readFrame('m1', 0))).toBe(0)
    expect(codeOfJpegBuf(await fs.readFrame('m1', 50))).toBe(50)
    const left = (await readdir(join(fs.dir, 'm1'))).filter((f) => f.endsWith('.jpg')).map((f) => parseInt(f)).sort((a, b) => a - b)
    expect(left).toHaveLength(40)
    expect(left).toContain(0)
    expect(left).toContain(50)
    for (let n = 1; n <= 20; n++) expect(left).not.toContain(n)
    // Served again: frame 25 is still on disk (no extraction), and now most recent.
    const calls = fs.stats().calls
    expect(codeOfJpegBuf(await fs.readFrame('m1', 25))).toBe(25)
    expect(fs.stats().calls).toBe(calls)
    // Prepared frames are never evicted by on-demand traffic.
    await fs.prepare([{ mediaId: 'm1', from: 85, to: 89 }])
    expect(codeOfJpegBuf(await fs.readFrame('m1', 10))).toBe(10)
    for (let n = 85; n <= 89; n++) expect(existsSync(fs.framePath('m1', n)), `prepared ${n}`).toBe(true)
    expect(fs.stats().onDemand).toBe(3)
  } finally {
    await fs.release()
  }
  expect(await framesLeft()).toEqual([])
})

test('framesNeeded maps storyboard times to working-copy frames (n = round((in + localT·speed)·fps))', async () => {
  const { sb } = await loadStoryboardFile(await writeSb('need.json', [vid(), vid({ id: 'v2', start: 1, duration: 0.9 }, { speed: 2 }), { ...slam, duration: 1.9 }]))
  expect(framesNeeded(sb, [0.5])).toEqual([{ mediaId: 'm1', from: 45, to: 45 }])
  expect(framesNeeded(sb, [1.5])).toEqual([{ mediaId: 'm1', from: 60, to: 60 }])
  expect(framesNeeded(sb, [0, 1 / 30, 2 / 30])).toEqual([{ mediaId: 'm1', from: 30, to: 32 }])
})

test('the video layer shows frame round((in + t·speed)·fps); slam draws above it; audit clean; zoom scales only the picture', async () => {
  const main = await writeSb('edit-main.json', [vid(), slam])
  const rp = await openRenderPage(await loadStoryboardFile(main))
  try {
    expect(rp.frames).toBeDefined()
    await rp.prepareTimes([0.5])
    await seekFrame(rp.page, 0.5)
    const withSlam = await shot(rp)
    expect(codeOf(withSlam)).toBe(45)
    expect(await rp.page.evaluate(() => window.__mba.audit())).toEqual([])
    // No <video> element, no text in the video layer, the layer itself never styled by the primitive.
    const dom = await rp.page.evaluate(() => {
      const layers = [...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')]
      const v = layers.find((l) => l.dataset.mbaScene === 'v')!
      const img = v.querySelector('img')!
      return {
        order: layers.map((l) => l.dataset.mbaScene),
        videos: document.querySelectorAll('video').length,
        text: v.textContent,
        cam: img.parentElement!.classList.contains('cam') && img.parentElement!.parentElement === v,
        src: new URL(img.src).pathname,
        n: img.dataset.n,
        fx: [v.style.transform, v.style.filter, v.style.opacity],
        head: (() => {
          const r = document.querySelector<HTMLElement>('[data-mba-scene=s] [data-mba-part=headline]')!.getBoundingClientRect()
          return { x0: Math.ceil(r.left), y0: Math.ceil(r.top), x1: Math.floor(r.right), y1: Math.floor(r.bottom) }
        })(),
      }
    })
    expect(dom.order).toEqual(['v', 's'])
    expect(dom.videos).toBe(0)
    expect(dom.text).toBe('')
    expect(dom.cam).toBe(true)
    expect(dom.src).toBe('/__frames/m1/45.jpg')
    expect(dom.n).toBe('45')
    expect(dom.fx).toEqual(['', '', ''])
    // Prepared == requested: nothing went through the on-demand path.
    expect(rp.frames!.stats().onDemand).toBe(0)

    // The slam is drawn over the picture: inside its headline box the frame differs from video only.
    const only = await openRenderPage(await loadStoryboardFile(await writeSb('edit-only.json', [vid()])))
    try {
      await seekFrame(only.page, 0.5)
      const bare = PNG.sync.read(await shot(only))
      expect(codeOf(PNG.sync.write(bare))).toBe(45)
      const top = PNG.sync.read(withSlam)
      let differ = 0
      let total = 0
      for (let y = dom.head.y0; y < dom.head.y1; y += 2) {
        for (let x = dom.head.x0; x < dom.head.x1; x += 2) {
          const i = (y * W + x) * 4
          total++
          if (Math.abs(top.data[i]! - bare.data[i]!) + Math.abs(top.data[i + 1]! - bare.data[i + 1]!) > 60) differ++
        }
      }
      expect(differ / total).toBeGreaterThan(0.05)
    } finally {
      await only.close()
    }
  } finally {
    await rp.close()
  }
  expect(await framesLeft()).toEqual([])

  // speed 2: at t = 0.5 the frame is round((1.0 + 2·0.5)·30) = 60.
  const fast = await openRenderPage(await loadStoryboardFile(await writeSb('edit-fast.json', [vid({ duration: 0.9 }, { speed: 2 }), { ...slam, duration: 0.9 }])))
  try {
    await fast.prepareTimes([0.5])
    await seekFrame(fast.page, 0.5)
    expect(codeOf(await shot(fast))).toBe(60)
  } finally {
    await fast.close()
  }

  // zoom: the picture is scaled ~2× about the centre, the slam headline does not move.
  const zoomed = await openRenderPage(
    await loadStoryboardFile(await writeSb('edit-zoom.json', [vid({}, { zoom: [{ t: 0, scale: 1 }, { t: 0.1, scale: 2, x: 0.5, y: 0.5 }] }), slam])),
  )
  const plain = await openRenderPage(await loadStoryboardFile(main))
  try {
    const box = async (rp: RenderPage) => {
      await rp.prepareTimes([0.9])
      await seekFrame(rp.page, 0.9)
      return rp.page.evaluate(() => {
        const r = (sel: string) => {
          const b = document.querySelector(sel)!.getBoundingClientRect()
          return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10)
        }
        const v = document.querySelector<HTMLElement>('[data-mba-scene=v]')!
        return { img: r('[data-mba-scene=v] img'), head: r('[data-mba-scene=s] [data-mba-part=headline]'), layer: v.style.transform }
      })
    }
    const z = await box(zoomed)
    const p = await box(plain)
    expect(p.img).toEqual([0, 0, W, H])
    expect(z.img[2]! / W).toBeGreaterThan(1.8)
    expect(z.img[2]! / W).toBeLessThan(2.2)
    // About the centre: the picture's centre stays put.
    expect(z.img[0]! + z.img[2]! / 2).toBeCloseTo(W / 2, 0)
    expect(z.img[1]! + z.img[3]! / 2).toBeCloseTo(H / 2, 0)
    expect(z.head).toEqual(p.head)
    expect(z.layer).toBe('')
  } finally {
    await zoomed.close()
    await plain.close()
  }
  expect(await framesLeft()).toEqual([])
})

test('preview path: an unprepared frame is extracted on demand, never substituted', async () => {
  const rp = await openRenderPage(await loadStoryboardFile(await writeSb('edit-main.json', [vid(), slam])))
  try {
    for (const [t, n] of [[0.5, 45], [0.9, 57], [0.1, 33]] as const) {
      await seekFrame(rp.page, t)
      expect(codeOf(await shot(rp)), `t=${t}`).toBe(n)
    }
    expect(rp.frames!.stats().onDemand).toBeGreaterThan(0)
    // A frame outside the working copy is a 404, not another frame.
    const res = await rp.page.evaluate(async () => (await fetch('/__frames/m1/90.jpg')).status)
    expect(res).toBe(404)
  } finally {
    await rp.close()
  }
  expect(await framesLeft()).toEqual([])
})

test('verify reports 0 mismatches; stills show the frame with the slam; frames released afterwards', async () => {
  const main = await writeSb('edit-main.json', [vid(), slam])
  const r = await verifyDeterminism({ storyboardPath: main })
  expect(r.pageErrors).toEqual([])
  expect(r.mismatches).toEqual([])
  expect(r.frames?.onDemand).toBe(0)
  expect(await framesLeft()).toEqual([])
  const out = join(root, 'stills')
  let st: FrameServerStats | undefined
  const paths = await renderStills({ storyboardPath: main, times: [0.1, 0.5, 0.9], outDir: out, onFrames: (s) => (st = s) })
  expect(st?.onDemand).toBe(0)
  const codes: number[] = []
  for (const p of paths) codes.push(codeOf(await readFile(p)))
  expect(codes).toEqual([33, 45, 57])
  expect(await framesLeft()).toEqual([])

  // A full render: every frame prepared up front (one call), none on demand, all released.
  let rs: FrameServerStats | undefined
  await renderVideo({ storyboardPath: main, outPath: join(root, 'out', 'v.mp4'), draft: true, onFrames: (s) => (rs = s) })
  expect(existsSync(join(root, 'out', 'v.mp4'))).toBe(true)
  expect(rs?.onDemand).toBe(0)
  expect(rs?.calls).toBe(2) // t = 0 at open, then the whole storyboard
  expect(await framesLeft()).toEqual([])
})

test('a frame that cannot be loaded rejects the seek Arabic first, with the frame server cause', async () => {
  const work = join(dir, 'work', 'm1.mp4')
  const backup = join(root, 'm1-backup.mp4')
  const rp = await openRenderPage(await loadStoryboardFile(await writeSb('edit-main.json', [vid(), slam])))
  try {
    // A prepared frame whose file is not a JPEG: the browser cannot decode it.
    await rp.prepareTimes([0.9])
    await writeFile(rp.frames!.framePath('m1', 57), 'not a jpeg')
    await expect(rp.seek(0.9)).rejects.toThrow(/^تعذّر تحميل الإطار 57 من المادة m1 — video m1: frame 57 could not be loaded/)

    // On-demand extraction fails (the working copy is damaged): ffmpeg's error reaches the user.
    await copyFile(work, backup)
    await writeFile(work, 'damaged working copy')
    const err = await rp.seek(0.5).then(() => null, (e: Error) => e)
    expect(err).not.toBeNull()
    expect(err!.message).toMatch(/^تعذّر تحميل الإطار 45 من المادة m1 — video m1: frame 45 could not be loaded/)
    expect(err!.message).toMatch(/السبب — cause: تعذّر استخراج إطارات m1 — ffmpeg could not extract frames 41–70 of m1 \(exit code \d+\): .+/s)
  } finally {
    if (existsSync(backup)) await copyFile(backup, work)
    await rp.close()
  }
  expect(await framesLeft()).toEqual([])
})

test('startup sweep removes extraction temp folders of dead processes only', async () => {
  const m1 = join(framesRootOf(project), 'm1')
  const dead = spawnSync(process.execPath, ['-e', '0']).pid!
  const stale = join(m1, `.x${dead}-3`)
  const mine = join(m1, `.x${process.pid}-999`)
  await mkdir(stale, { recursive: true })
  await mkdir(mine, { recursive: true })
  await writeFile(join(stale, '0.jpg'), 'x')
  createFrameServer(project)
  expect(existsSync(stale)).toBe(false)
  expect(existsSync(mine)).toBe(true)
  expect(sweepStaleTemps(framesRootOf(project))).toEqual([])
  await rm(framesRootOf(project), { recursive: true, force: true })
})

test('2a fresh-paint determinism with a video layer: cold vs warm byte-equal (≥ 10 probes)', async () => {
  // Two video scenes on a hard cut (one zoomed, one at speed 1.5) under a slam on track 1.
  const p = await writeSb('edit-det.json', [
    vid({ duration: 1 }, { zoom: [{ t: 0, scale: 1.1 }, { t: 0.3, scale: 1.6, x: 0.3, y: 0.6 }] }),
    vid({ id: 'v2', start: 1, duration: 1 }, { in: 0.2, speed: 1.5 }),
    { ...slam, duration: 2 },
  ])
  const res = await verifyDeterminism({ storyboardPath: p })
  expect(res.probes.length).toBeGreaterThanOrEqual(10)
  expect(res.pageErrors).toEqual([])
  expect(res.mismatches).toEqual([])
  expect(await framesLeft()).toEqual([])
})

test('project-aware loading: media, working copy, range and fps are checked, Arabic first', async () => {
  const bad = async (name: string, scenes: Scene[], re: RegExp, extra: Scene = {}) => {
    await expect(loadStoryboardFile(await writeSb(name, scenes, extra)), name).rejects.toThrow(re)
  }
  await bad('e-media.json', [vid({}, { media: 'm7' })], /^[؀-ۿ][^]*scenes\[0\]\.params\.media/)
  // in + duration·speed past the working copy (3 s): in, or speed when in alone fits.
  await bad('e-in.json', [vid({ duration: 1 }, { in: 2.5 })], /^[؀-ۿ][^]*scenes\[0\]\.params\.in/)
  await bad('e-speed.json', [vid({ duration: 1 }, { in: 1.5, speed: 2 })], /^[؀-ۿ][^]*scenes\[0\]\.params\.speed/)
  // Exactly to the end is fine.
  await loadStoryboardFile(await writeSb('ok-end.json', [vid({ duration: 2 }, { in: 1 })]))
  await bad('e-fps.json', [vid()], /^[؀-ۿ][^]*fps/, { fps: 60 })
  // R6: no preroll on a video scene (its in-point is the first visible frame).
  await bad('e-preroll.json', [vid({ preroll: 0.5 })], /^[؀-ۿ][^]*scenes\[0\]\.preroll/)

  // No working copy (not ingested, or deleted): run mba ingest.
  const other = join(root, 'مشاريع تجربة 100%', 'بلا نسخ')
  await initProject({ dir: other, media: [join(dir, project.manifest.media[0]!.source)] })
  await expect(loadStoryboardFile(join(other, 'edit.json'))).rejects.toThrow(/^[؀-ۿ][^]*mba ingest/)

  // Outside a project a video scene cannot be drawn.
  const loose = join(root, 'قصة.json')
  await writeFile(loose, JSON.stringify({ version: 1, scenes: [vid()] }))
  await expect(loadStoryboardFile(loose)).rejects.toThrow(/^[؀-ۿ][^]*mba-project\.json/)
})
