import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { initProject } from '../../src/node/project'
import { ingestProject } from '../../src/node/ingest'
import { loadStoryboardFile, openRenderPage, renderVideo } from '../../src/node/render'
import { resolveFfmpeg, resolveFfprobe } from '../../src/node/tools'

// Colour chain (final review, Important 1): a flat colour must come out of every path as itself.
// source (BT.709 / BT.601 / untagged) → ingest → frame-server JPEG → Chromium → final MP4 (BT.709,
// tagged), and a CSS graphic of the same colour → Chromium → final MP4. Every channel within ±4.
test.describe.configure({ mode: 'serial', timeout: 240_000 })

const RGB = [0xc8, 0x1e, 0x1e] as const
const HEX = '#C81E1E'
const GREY = [0x80, 0x80, 0x80] as const
const GREY_HEX = '808080'
const TOL = 4

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

function ff(args: string[]): Buffer {
  const r = spawnSync(resolveFfmpeg(), ['-v', 'error', '-nostdin', '-y', ...args], { maxBuffer: 1 << 30 })
  expect(r.status, String(r.stderr)).toBe(0)
  return r.stdout
}

/**
 * A 4 s clip, top two thirds #C81E1E and bottom third neutral grey #808080 (drawn in RGB), encoded
 * with `matrix` and `range`, tagged with them (or untagged).
 */
function makeClip(file: string, o: { matrix: 'bt709' | 'bt601'; tagged: boolean; range: 'tv' | 'pc'; size: string }): void {
  const tag = o.matrix === 'bt709' ? 'bt709' : 'smpte170m'
  const tags = o.tagged ? ['-colorspace', tag, '-color_primaries', tag, '-color_trc', tag, '-color_range', o.range] : []
  const set = o.tagged ? `,setparams=colorspace=${tag}:color_primaries=${tag}:color_trc=${tag}:range=${o.range}` : ''
  ff([
    '-f', 'lavfi', '-i', `color=c=0x${HEX.slice(1)}:s=${o.size}:r=30:d=4,format=rgb24,drawbox=x=0:y=ih*2/3:w=iw:h=ih/3:color=0x${GREY_HEX}:t=fill`,
    '-vf', `scale=out_color_matrix=${o.matrix}:out_range=${o.range},format=yuv420p${set}`,
    '-c:v', 'libx264', '-crf', '12', ...tags, file,
  ])
}

function tagsOf(file: string): Record<string, string> {
  const r = spawnSync(resolveFfprobe(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_primaries,color_transfer,color_range,width,height', '-of', 'json', file], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return (JSON.parse(r.stdout) as { streams: Record<string, string>[] }).streams[0]!
}

/** Frame `n` of an MP4 as RGB, decoded with the BT.709 limited-range matrix (what its tags say). */
function rgbFrame(file: string, n: number): { w: number; h: number; data: Buffer } {
  const t = tagsOf(file)
  const w = Number(t.width)
  const h = Number(t.height)
  const data = ff(['-i', file, '-an', '-vf', `select=eq(n\\,${n}),scale=in_color_matrix=bt709:in_range=tv:flags=accurate_rnd+full_chroma_int,format=rgb24`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-'])
  expect(data.length).toBe(w * h * 3)
  return { w, h, data }
}

/** Mean RGB of the w×h box centred on (cx, cy) of an RGB(A) buffer with `ch` channels. */
function meanBox(img: { w: number; data: Buffer | Uint8Array }, ch: number, cx: number, cy: number, half = 8): number[] {
  const s = [0, 0, 0]
  let n = 0
  for (let y = cy - half; y < cy + half; y++) {
    for (let x = cx - half; x < cx + half; x++) {
      const i = (y * img.w + x) * ch
      for (let k = 0; k < 3; k++) s[k]! += img.data[i + k]!
      n++
    }
  }
  return s.map((v) => Math.round((v / n) * 10) / 10)
}

/** Mean RGB of the interior (whole 9×9 neighbourhood reddish) of the reddish pixels of a frame. */
function meanRedInterior(img: { w: number; h: number; data: Buffer }): { rgb: number[]; count: number } {
  const red = (x: number, y: number) => {
    const i = (y * img.w + x) * 3
    return img.data[i]! > 120 && img.data[i + 1]! < 90 && img.data[i + 2]! < 90
  }
  const s = [0, 0, 0]
  let count = 0
  for (let y = 4; y < img.h - 4; y++) {
    for (let x = 4; x < img.w - 4; x++) {
      let all = true
      for (let dy = -4; dy <= 4 && all; dy++) for (let dx = -4; dx <= 4 && all; dx++) all = red(x + dx, y + dy)
      if (!all) continue
      const i = (y * img.w + x) * 3
      for (let k = 0; k < 3; k++) s[k]! += img.data[i + k]!
      count++
    }
  }
  return { rgb: s.map((v) => Math.round((v / Math.max(1, count)) * 10) / 10), count }
}

const near = (got: number[], what: string, want: readonly number[] = RGB) => {
  for (let k = 0; k < 3; k++) expect(Math.abs(got[k]! - want[k]!), `${what} ${JSON.stringify(got)} vs ${JSON.stringify(want)}`).toBeLessThanOrEqual(TOL)
}

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

const CASES = [
  { name: 'bt709', matrix: 'bt709', tagged: true, range: 'tv', size: '360x640' },
  { name: 'bt601', matrix: 'bt601', tagged: true, range: 'tv', size: '360x640' },
  { name: 'untagged', matrix: 'bt601', tagged: false, range: 'tv', size: '360x640' },
  // Untagged HD is read as BT.709 (round 2): encoded so, it must come out right.
  { name: 'untagged-hd', matrix: 'bt709', tagged: false, range: 'tv', size: '1280x720' },
  // Full range (yuvj / pc), as some phones and screen recorders write.
  { name: 'fullrange', matrix: 'bt709', tagged: true, range: 'pc', size: '360x640' },
] as const

for (const c of CASES) {
  test(`colour: ${c.name} footage and a CSS graphic of ${HEX} stay within ±${TOL} through ingest → JPEG → Chromium → final MP4`, async () => {
    const clip = join(media, `أحمر ${c.name} %.mp4`)
    makeClip(clip, c)
    const p = await initProject({ dir: join(projects, c.name), media: [clip], format: '9:16' })
    await ingestProject(p)

    // The working copy is tagged BT.709, limited range.
    const work = tagsOf(join(p.dir, p.manifest.media[0]!.work!))
    expect(work.color_space).toBe('bt709')
    expect(work.color_primaries).toBe('bt709')
    expect(work.color_transfer).toBe('bt709')
    expect(work.color_range).toBe('tv')

    // 0–1 s footage (cover), 1–4 s graphics only: a wipe-reveal whose underline is the brand colour.
    const edit = {
      version: 1,
      format: '9:16',
      fps: 30,
      brand: { name: 'x', handle: '@x', colors: { primary: HEX, secondary: '#000000', bg: '#000000', text: '#ffffff' } },
      scenes: [
        { id: 'v', type: 'video', start: 0, duration: 1, track: 0, params: { media: 'm1', in: 0.5 } },
        { id: 'g', type: 'wipe-reveal', start: 1, duration: 3, track: 0, params: { title: 'لون', withLine: true } },
      ],
    }
    const editPath = join(p.dir, 'edit.json')
    await writeFile(editPath, JSON.stringify(edit, null, 2) + '\n')

    // In Chromium: the frame-server JPEG as drawn, and the CSS graphic.
    const session = await openRenderPage(await loadStoryboardFile(editPath))
    let chromeFootage: number[]
    let chromeGrey: number[]
    let chromeGraphic: { rgb: number[]; count: number }
    try {
      await session.prepareTimes([0.5])
      await session.seek(0.5)
      const shot = PNG.sync.read(await session.page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } }))
      chromeFootage = meanBox({ w: shot.width, data: shot.data }, 4, 540, 960)
      chromeGrey = meanBox({ w: shot.width, data: shot.data }, 4, 540, 1600)
      await session.seek(2.5)
      const g = PNG.sync.read(await session.page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } }))
      const rgb = Buffer.alloc(g.width * g.height * 3)
      for (let i = 0, j = 0; i < g.data.length; i += 4, j += 3) g.data.copy(rgb, j, i, i + 3)
      chromeGraphic = meanRedInterior({ w: g.width, h: g.height, data: rgb })
    } finally {
      await session.close()
    }

    // The final render.
    const out = join(p.dir, 'renders', 'colour.mp4')
    await renderVideo({ storyboardPath: editPath, outPath: out })
    const tags = tagsOf(out)
    expect(tags.color_space).toBe('bt709')
    expect(tags.color_primaries).toBe('bt709')
    expect(tags.color_transfer).toBe('bt709')
    expect(tags.color_range).toBe('tv')
    const f = rgbFrame(out, 15)
    const mp4Footage = meanBox(f, 3, 540, 960)
    const mp4Grey = meanBox(f, 3, 540, 1600)
    const mp4Graphic = meanRedInterior(rgbFrame(out, 75))

    const report = { case: c.name, chromeFootage, chromeGrey, mp4Grey, chromeGraphic: chromeGraphic.rgb, mp4Footage, mp4Graphic: mp4Graphic.rgb, graphicPx: mp4Graphic.count }
    console.log(`[colour] ${JSON.stringify(report)}`)
    expect(chromeGraphic.count).toBeGreaterThan(50)
    expect(mp4Graphic.count).toBeGreaterThan(50)
    near(chromeFootage, 'Chromium footage')
    near(chromeGrey, 'Chromium grey', GREY)
    near(mp4Grey, 'final MP4 grey', GREY)
    near(chromeGraphic.rgb, 'Chromium graphic')
    near(mp4Footage, 'final MP4 footage')
    near(mp4Graphic.rgb, 'final MP4 graphic')
  })
}
