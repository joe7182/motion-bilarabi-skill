import { test, expect } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { probeMedia } from '../../src/node/ingest'
import { loadStoryboardFile, openRenderPage } from '../../src/node/render'
import { getLook } from '../../src/runtime/looks'
import { resolveFfmpeg, resolveFfprobe } from '../../src/node/tools'
import { openProject } from '../../src/node/project'
import { projectTempDir } from '../../src/node/tempdirs'

// End to end, through the CLI only, as a user would: a synthetic phone clip (20 s, portrait,
// HEVC, display-rotated, variable frame rate, tone audio) → project init → ingest → edit.json
// (video on track 0 with a whip-pan, motion on track 1) → validate → verify → render → review.
// Serial and slow (several Chromium + ffmpeg runs).
test.describe.configure({ mode: 'serial', timeout: 600_000 })

const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const SRC_SEC = 20
const WHIP_AT = 8.0
const WHIP_D = 0.4

let root = ''
let clip = ''
let dir = '' // the project
let skip = '' // R2: why the local ffmpeg cannot synthesize the input

interface Run {
  code: number | null
  stdout: string
  stderr: string
}
/** `mba <args>` in a child process (async, so the test timeout still works). */
function mba(args: string[]): Promise<Run> {
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    proc.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    proc.once('error', rej)
    proc.once('close', (code) => res({ code, stdout, stderr }))
  })
}
const ok = (r: Run) => expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr.slice(-3000)}`).toBe(0)

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

interface Streams {
  video: { codec: string; frames: number; w: number; h: number }
  audio?: { codec: string; rate: number; channels: number; dur: number }
}
function streamsOf(file: string): Streams {
  const r = spawnSync(
    resolveFfprobe(),
    ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,codec_name,width,height,sample_rate,channels,nb_read_packets,duration', '-of', 'json', file],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
  const ss = (JSON.parse(r.stdout) as { streams: Record<string, string>[] }).streams
  const v = ss.find((s) => s.codec_type === 'video')!
  const a = ss.find((s) => s.codec_type === 'audio')
  return {
    video: { codec: v.codec_name!, frames: Number(v.nb_read_packets), w: Number(v.width), h: Number(v.height) },
    ...(a ? { audio: { codec: a.codec_name!, rate: Number(a.sample_rate), channels: Number(a.channels), dur: Number(a.duration) } } : {}),
  }
}

/** Peak |sample| (0..1) of the file's audio between `from` and `to` seconds (mono, 48 kHz). */
function peakBetween(file: string, from: number, to: number): number {
  const pcm = ff(['-ss', String(from), '-t', String(to - from), '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'])
  let peak = 0
  for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)))
  return peak / 32768
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-'))
  const media = join(root, 'مصادر %50')
  await mkdir(media, { recursive: true })
  dir = join(root, 'مشاريع تجربة 100%', 'تجربة المحرر')
  const encoders = spawnSync(resolveFfmpeg(), ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout
  const help = spawnSync(resolveFfmpeg(), ['-hide_banner', '-h', 'full'], { encoding: 'utf8' }).stdout
  if (!/libx265/.test(encoders)) skip = 'local ffmpeg has no libx265 encoder to synthesize the HEVC phone clip'
  else if (!/display_rotation/.test(help)) skip = 'local ffmpeg has no -display_rotation option to tag the rotated input'
  if (skip) return

  // The phone clip. Upright it is 270×480 (portrait) testsrc2 (moving pattern + timecode); it is
  // stored transposed as 480×270 HEVC with a 90° display rotation, as phones store portrait video.
  // Variable frame rate: 10 s at 24 fps then 10 s at 60 fps, timestamps kept (timescale 120).
  // Audio: a 440 Hz tone over the whole 20 s.
  const half = SRC_SEC / 2
  const vfr = join(root, 'vfr.mp4')
  ff([
    '-f', 'lavfi', '-i', `testsrc2=s=270x480:r=24:d=${half},format=yuv420p,transpose=2,settb=1/120`,
    '-f', 'lavfi', '-i', `testsrc2=s=270x480:r=60:d=${half},format=yuv420p,transpose=2,settb=1/120`,
    '-f', 'lavfi', '-i', `sine=f=440:r=48000:d=${SRC_SEC},volume=4`,
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-fps_mode', 'passthrough',
    '-c:v', 'libx265', '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-video_track_timescale', '120',
    '-c:a', 'aac', '-b:a', '128k', vfr,
  ])
  clip = join(media, 'مقطع هاتف %1.mp4')
  ff(['-display_rotation:v:0', '-90', '-i', vfr, '-c', 'copy', clip])
})
test.afterAll(async () => {
  if (!root) return
  await unlock(root)
  await rm(root, { recursive: true, force: true })
})

test('editor e2e: phone clip → init → ingest → edit (tracks + whip-pan) → verify → render (chunked, audio) → review', async () => {
  test.slow()
  test.skip(!!skip, skip)

  // The input really is a phone-like clip.
  const src = await probeMedia(clip)
  expect(src).toMatchObject({ codec: 'hevc', rotation: 90, vfr: true, hasAudio: true, w: 480, h: 270 })
  expect(src.durationSec).toBeCloseTo(SRC_SEC, 0)

  // 1. project init (30 fps explicitly: the product default is 60, this test checks the 30 fps pipeline).
  const init = await mba(['project', 'init', dir, clip, '--fps', '30'])
  ok(init)
  expect(init.stdout.split('\n')[0]).toMatch(/^تم إنشاء المشروع — Project created: /)
  expect(existsSync(join(dir, 'mba-project.json'))).toBe(true)

  // 2. ingest: upright, CFR 30, h264, audio kept.
  const ing = await mba(['ingest', dir])
  ok(ing)
  expect(ing.stdout).toMatch(/m1 .*مُدار 90° — rotated 90°/)
  expect(ing.stdout).toMatch(/إطارات متغيرة — variable frame rate/)
  const work = await probeMedia(join(dir, 'work', 'm1.mp4'))
  expect(work).toMatchObject({ w: 270, h: 480, rotation: 0, fps: 30, vfr: false, codec: 'h264', hasAudio: true })

  // 3. The edit: two cuts of the clip on track 0 joined by a whip-pan, motion on track 1. The
  //    caption (6.8–9.2) overlaps the whip window, to prove the cover stays below track 1. No
  //    preroll on the video scenes (R6).
  const editPath = join(dir, 'edit.json')
  const edit = JSON.parse(await readFile(editPath, 'utf8')) as Record<string, unknown>
  const scenes = [
    { id: 'c1', type: 'video', start: 0, duration: 8, track: 0, params: { media: 'm1', in: 2.0 } },
    { id: 'c2', type: 'video', start: 8, duration: 6, track: 0, params: { media: 'm1', in: 12.0 } },
    { id: 's1', type: 'slam', start: 1, duration: 2, track: 1, params: { text: 'تجربة المحرّر', accent: 'المحرّر' } },
    { id: 'cap', type: 'wipe-reveal', start: 6.8, duration: 2.4, track: 1, params: { title: 'تعليق', withLine: false } },
    { id: 'w1', type: 'wipe-reveal', start: 10, duration: 3, track: 1, params: { title: 'يوسف', subtitle: '@yousif_aljbouri' } },
  ]
  const transitions = [{ type: 'whip-pan', at: WHIP_AT, duration: WHIP_D, track: 0, params: { direction: 'left', blur: 12 } }]
  await writeFile(editPath, JSON.stringify({ ...edit, look: 'dark-tech', scenes, transitions }, null, 2))

  // 4. validate and verify, given the project folder.
  const val = await mba(['validate', dir])
  ok(val)
  expect(val.stdout.trim()).toBe('OK')
  const ver = await mba(['verify', dir])
  ok(ver)
  expect(ver.stdout).toMatch(/^التحقق من الحتمية — Determinism check: OK — \d+ probes identical/)

  // 5. render: the next version, in 10 s chunks, with the clip's audio.
  const ren = await mba(['render', dir, '--draft'])
  ok(ren)
  expect(ren.stderr).toMatch(/الإصدار v001-draft — version v001-draft/)
  const out = ren.stdout.trim()
  expect(out).toBe(join(dir, 'renders', 'v001-draft.mp4'))
  const st = streamsOf(out)
  expect(st.video.frames).toBe(14 * 30)
  expect(st.audio).toMatchObject({ codec: 'aac', rate: 48000, channels: 2 })
  expect(st.audio!.dur).toBeGreaterThan(13.9)
  expect(st.audio!.dur).toBeLessThan(14.1)
  // The tone is there in both cuts (not the silent base).
  expect(peakBetween(out, 1, 7)).toBeGreaterThan(0.1)
  expect(peakBetween(out, 9, 13)).toBeGreaterThan(0.1)
  expect(existsSync(join(dir, 'renders', '.parts'))).toBe(false)
  expect(existsSync(join(dir, 'work', '.frames'))).toBe(false)
  expect(existsSync(projectTempDir(await openProject(dir)))).toBe(false) // frames and parts live in <tmp>/mba/<id>
  expect(await readFile(join(dir, 'log.md'), 'utf8')).toMatch(/render — renders\/v001-draft\.mp4 \(draft, 14 s, 420 frames, 2 chunks/)

  // 6. review, given the project folder: the kit goes to <project>/review/r1.
  const rev = await mba(['review', dir])
  ok(rev)
  const kit = join(dir, 'review', 'r1')
  expect(rev.stdout).toContain(`مجلد المراجعة — Review kit: ${kit}`)
  const m = JSON.parse(await readFile(join(kit, 'metrics.json'), 'utf8')) as {
    duration: number
    frame0Blank: boolean
    nearBlankRuns: { start: number; end: number; designed: boolean }[]
    audit: { t: number; issues: unknown[] }[] | null
    sheets: string[]
  }
  expect(m.duration).toBeCloseTo(14, 1)
  expect(m.frame0Blank).toBe(false)
  expect(m.audit).not.toBeNull()
  expect(m.audit!.filter((a) => a.issues.length)).toEqual([])
  expect(m.nearBlankRuns.filter((r) => !r.designed)).toEqual([])
  for (const f of m.sheets) expect(existsSync(join(kit, f)), f).toBe(true)
})

test('editor e2e: the track-0 whip-pan covers only track 0 — the track-1 caption is drawn above it', async () => {
  test.skip(!!skip, skip)
  const editPath = join(dir, 'edit.json')
  const edit = JSON.parse(await readFile(editPath, 'utf8')) as Record<string, unknown>
  // The same edit without the transition, beside it in the project (so it is project-aware too).
  const plainPath = join(dir, 'edit-no-transition.json')
  await writeFile(plainPath, JSON.stringify({ ...edit, transitions: [] }, null, 2))
  const fg = getLook('dark-tech').fg

  const shot = async (sbPath: string, t: number) => {
    const s = await openRenderPage(await loadStoryboardFile(sbPath))
    try {
      await s.prepareTimes([t])
      await s.seek(t)
      const info = await s.page.evaluate(() => {
        const frame = document.getElementById('frame')!
        const order = [...frame.children].map((el) => {
          const h = el as HTMLElement
          return h.dataset.mbaScene ?? `tr:${h.dataset.mbaTrOverlay}`
        })
        const cap = frame.querySelector<HTMLElement>('[data-mba-scene=cap]')!
        let box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
        for (const u of cap.querySelectorAll<HTMLElement>('[data-mba-text]')) {
          const r = u.getBoundingClientRect()
          box = { x0: Math.min(box.x0, r.left), y0: Math.min(box.y0, r.top), x1: Math.max(box.x1, r.right), y1: Math.max(box.y1, r.bottom) }
        }
        return {
          order,
          tr: frame.dataset.mbaTr ?? '',
          capVisible: cap.style.visibility,
          capFx: [cap.style.transform, cap.style.filter, cap.style.clipPath, cap.style.opacity],
          box: { x0: Math.floor(box.x0), y0: Math.floor(box.y0), x1: Math.ceil(box.x1), y1: Math.ceil(box.y1) },
        }
      })
      const png = PNG.sync.read(await s.page.locator('#frame').screenshot({ caret: 'hide' }))
      return { ...info, png }
    } finally {
      await s.close()
    }
  }

  const fgRgb = [1, 3, 5].map((i) => parseInt(fg.slice(i, i + 2), 16))
  const isFg = (png: PNG, x: number, y: number) => {
    const i = (y * png.width + x) * 4
    return Math.abs(png.data[i]! - fgRgb[0]!) + Math.abs(png.data[i + 1]! - fgRgb[1]!) + Math.abs(png.data[i + 2]! - fgRgb[2]!) < 24
  }

  // At the cut (p = 0.5: the outgoing cut has flown off, the cover fills the uncovered frame).
  for (const t of [WHIP_AT - 0.1, WHIP_AT, WHIP_AT + 0.1]) {
    const withTr = await shot(editPath, t)
    const plain = await shot(plainPath, t)
    // DOM: track-0 layers, then the whip-pan overlay, then every track-1 layer.
    expect(withTr.order).toEqual(['c1', 'c2', 'tr:whip-pan', 's1', 'cap', 'w1'])
    expect(withTr.tr).toBe('1')
    expect(withTr.capVisible).toBe('visible')
    expect(withTr.capFx).toEqual(['', '', '', ''])
    expect(withTr.box).toEqual(plain.box)
    // The caption's glyph interiors (fg colour, with all 8 neighbours fg too, without the
    // transition; edge pixels blend with whatever lies below) are still fg with it.
    let glyph = 0
    let kept = 0
    const { x0, y0, x1, y1 } = plain.box
    const interior = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isFg(plain.png, x + dx, y + dy)) return false
      return true
    }
    for (let y = Math.max(1, y0); y < Math.min(plain.png.height - 1, y1); y++) {
      for (let x = Math.max(1, x0); x < Math.min(plain.png.width - 1, x1); x++) {
        if (!interior(x, y)) continue
        glyph++
        if (isFg(withTr.png, x, y)) kept++
      }
    }
    expect(glyph, `t=${t}: caption glyph pixels`).toBeGreaterThan(500)
    expect(kept / glyph, `t=${t}: share of caption pixels kept over the whip-pan`).toBeGreaterThan(0.995)
    // …while the whip-pan did change the picture below (track 0).
    let diff = 0
    for (let i = 0; i < plain.png.data.length; i += 4) if (Math.abs(plain.png.data[i]! - withTr.png.data[i]!) > 24) diff++
    expect(diff / (plain.png.width * plain.png.height), `t=${t}: share of the frame the whip-pan changed`).toBeGreaterThan(0.2)
  }
  await rm(plainPath)
  expect(existsSync(join(dir, 'work', '.frames'))).toBe(false)
  expect(existsSync(projectTempDir(await openProject(dir)))).toBe(false) // frames and parts live in <tmp>/mba/<id>
})
