import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { PNG } from 'pngjs'
import { STILLS_PER_PASS, frameIndexAt, grayFrames, stillsAt } from '../../src/node/frames'
import { resolveFfmpeg } from '../../src/node/tools'

// Node-side: ffmpeg only (R5: serial, 180 s).
test.describe.configure({ mode: 'serial', timeout: 180_000 })

let root: string
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-'))
})
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

test('stillsAt over several passes: right frames, input order, shared duplicates, no temp dir left', async () => {
  // 3 s at 30 fps = 90 frames, lossless; frame n is a flat grey with luma 16 + 2n, so the content of
  // a still proves which frame it is (limited-range RGB ≈ 2n·255/219, neighbours ≈ 2.3 apart).
  const video = join(root, 'index frames.mp4')
  const r = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', "color=c=black:s=32x32:r=30:d=3,format=yuv420p,geq=lum='16+2*N':cb=128:cr=128",
      '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', video],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)

  // 50 distinct frames (more than one pass), shuffled deterministically, plus duplicates.
  const distinct = Array.from({ length: 50 }, (_, k) => ((k * 37) % 90) / 30)
  expect(new Set(distinct.map((t) => Math.round(t * 30))).size).toBe(50)
  expect(50).toBeGreaterThan(STILLS_PER_PASS)
  const times = [...distinct, distinct[3]!, distinct[0]!, distinct[49]!, distinct[3]! + 0.004]
  const out = join(root, 'stills 50% dir')
  const paths = await stillsAt(video, times, out)

  expect(paths).toHaveLength(times.length)
  const level = new Map<string, number>()
  for (let k = 0; k < times.length; k++) {
    const idx = frameIndexAt(times[k]!, 30, 90)
    expect(basename(paths[k]!)).toBe(`frame-${idx}.png`)
    if (!level.has(paths[k]!)) level.set(paths[k]!, PNG.sync.read(await readFile(paths[k]!)).data[0]!)
    expect(Math.abs(level.get(paths[k]!)! - (2 * idx * 255) / 219), `frame ${idx}`).toBeLessThanOrEqual(1)
  }
  // Equal frames share one file.
  expect(paths[50]).toBe(paths[3])
  expect(paths[51]).toBe(paths[0])
  expect(paths[52]).toBe(paths[49])
  expect(paths[53]).toBe(paths[3])
  const files = await readdir(out)
  expect(files.filter((f) => f.startsWith('.stills-'))).toEqual([])
  expect(files.filter((f) => f.endsWith('.png'))).toHaveLength(50)
})

test('stillsAt seeks per pass on a long GOP clip and still lands on the exact frames', async () => {
  // 20 s at 30 fps = 600 frames, GOP 30, lossless. Each frame carries its index in two flat halves:
  // left luma 16 + 2·(n mod 100), right luma 16 + 20·floor(n / 100), so a still proves its frame.
  const video = join(root, 'seek frames %1.mp4')
  const lum = "if(lt(X\,16)\,16+2*mod(N\,100)\,16+20*floor(N/100))"
  const r = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=32x32:r=30:d=20,format=yuv420p,geq=lum='${lum}':cb=128:cr=128`,
      '-c:v', 'libx264', '-qp', '0', '-g', '30', '-pix_fmt', 'yuv420p', video],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
  // Sparse indices across several passes: GOP starts, mid-GOP frames, neighbours, the last frame.
  const want = [0, 1, 29, 30, 31, 59, 89, 100, 145, 199, 200, 201, 299, 300, 333, 377, 401, 449, 450, 451, 480, 500,
    511, 520, 530, 540, 541, 542, 550, 560, 561, 570, 575, 580, 585, 590, 591, 592, 593, 594, 595, 596, 597, 598, 599]
  expect(want.length).toBeGreaterThan(STILLS_PER_PASS)
  const out = join(root, 'stills seek')
  const paths = await stillsAt(video, want.map((n) => n / 30), out)
  const code = (n: number) => [(2 * (n % 100) * 255) / 219, (20 * Math.floor(n / 100) * 255) / 219]
  for (let k = 0; k < want.length; k++) {
    const png = PNG.sync.read(await readFile(paths[k]!))
    const left = png.data[(16 * 32 + 4) * 4]!
    const right = png.data[(16 * 32 + 28) * 4]!
    const [l, rr] = code(want[k]!)
    expect(Math.abs(left - l!), `frame ${want[k]} (left)`).toBeLessThanOrEqual(1.5)
    expect(Math.abs(right - rr!), `frame ${want[k]} (right)`).toBeLessThanOrEqual(1.5)
  }
})

test('grayFrames streams: identical frames to the old concat-whole-stdout implementation', async () => {
  const video = join(root, 'gray stream.mp4')
  const r = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=270x480:r=30:d=4', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', video],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
  const size = { w: 72, h: 128 }
  const got = await grayFrames(video, size)
  // The old way: the whole stdout at once, then sliced.
  const old = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-nostdin', '-i', video, '-an', '-sn', '-vf', 'fps=30', '-fps_mode', 'passthrough',
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', '72x128', '-'],
    { maxBuffer: 1 << 28 },
  )
  expect(old.status).toBe(0)
  const n = size.w * size.h
  const want: Uint8Array[] = []
  for (let off = 0; off + n <= old.stdout.length; off += n) want.push(new Uint8Array(old.stdout.subarray(off, off + n)))
  expect(got.length).toBe(120)
  expect(got.length).toBe(want.length)
  for (let k = 0; k < want.length; k++) expect(Buffer.from(got[k]!).equals(Buffer.from(want[k]!)), `frame ${k}`).toBe(true)
})
