import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initProject, openProject } from '../../src/node/project'
import { loadStoryboardFile } from '../../src/node/render'
import { INGEST_RECIPE, ingestProject, probeMedia, type IngestResult } from '../../src/node/ingest'
import { resolveFfmpeg, resolveFfprobe } from '../../src/node/tools'

// Node-side: ingest (ffmpeg only, no browser page). Serial, explicit timeout.
const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
test.describe.configure({ mode: 'serial', timeout: 180_000 })

/*
 * Test inputs (lavfi, argv only). Every frame carries its source TIME as an 8-bit code
 * c = round(t·120) in 8 vertical stripes (stripe k white ⇔ bit k of c), drawn in the lower 7/8 of
 * the upright picture; the top 1/8 is a white bar, so the orientation is provable too. Black and
 * white survive lossy coding and tone mapping, unlike a grey ramp (x264 skips tiny luma steps).
 * The code is drawn on a small canvas and scaled up with `neighbor`, so geq stays cheap.
 */
const code = (off: number, hi: number, lo: number) =>
  `geq=lum='if(lt(Y,H/8),${hi},if(mod(floor(floor((T+${off})*120+0.5)/pow(2,floor(X*8/W))),2),${hi},${lo}))':cb=${(hi + lo) / 2 > 255 ? 512 : 128}:cr=${(hi + lo) / 2 > 255 ? 512 : 128}`
const code8 = (off = 0) => code(off, 235, 16)
const code10 = (off = 0) => code(off, 940, 64)

let root: string
let projects: string
const src: Record<'rot' | 'vfr' | 'f60' | 'hdr', string> = { rot: '', vfr: '', f60: '', hdr: '' }
let skipHdr = '' // R2: reason when the local ffmpeg cannot SYNTHESIZE the HLG clip
let skipRot = ''

function ff(args: string[]): { status: number | null; stderr: string } {
  return spawnSync(resolveFfmpeg(), ['-v', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' })
}
function ok(args: string[]): void {
  const r = ff(args)
  expect(r.status, r.stderr).toBe(0)
}
function ffprobeJson(file: string, args: string[]): any {
  const r = spawnSync(resolveFfprobe(), ['-v', 'error', ...args, '-of', 'json', file], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout)
}

/** Per frame: the time code read from the stripes (lower half) and the mean luma of the top 1/16. */
function readCodes(file: string): { codes: number[]; top: number[] } {
  const stripes = spawnSync(resolveFfmpeg(), ['-v', 'error', '-i', file, '-an', '-vf', 'crop=iw:ih/2:0:ih/2,scale=8:1:flags=area', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
  expect(stripes.status, String(stripes.stderr)).toBe(0)
  const bar = spawnSync(resolveFfmpeg(), ['-v', 'error', '-i', file, '-an', '-vf', 'crop=iw:ih/16:0:0,scale=1:1:flags=area', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
  expect(bar.status, String(bar.stderr)).toBe(0)
  const codes: number[] = []
  for (let i = 0; i + 8 <= stripes.stdout.length; i += 8) {
    let c = 0
    for (let k = 0; k < 8; k++) if (stripes.stdout[i + k]! > 127) c |= 1 << k
    codes.push(c)
  }
  return { codes, top: [...bar.stdout] }
}

/** Makes every file under `dir` writable again so it can be deleted (read-only source copies). */
async function unlock(dir: string): Promise<void> {
  if (!existsSync(dir)) return
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await unlock(p)
    else await chmod(p, 0o644)
  }
}

function cli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, encoding: 'utf8' })
}

const mtime = async (p: string) => (await stat(p)).mtimeMs

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-'))
  projects = join(root, 'مشاريع تجربة 100%')
  const media = join(root, 'مصادر %50')
  await mkdir(media, { recursive: true })
  const encoders = spawnSync(resolveFfmpeg(), ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout
  const help = spawnSync(resolveFfmpeg(), ['-hide_banner', '-h', 'full'], { encoding: 'utf8' }).stdout

  // (a) Phone portrait: the upright picture is 1080×1920, stored as 1920×1080 with a 90° display
  //     rotation (as phones do), 30 fps, no audio.
  src.rot = join(media, 'مقطع %أ مُدار.mp4')
  if (!/display_rotation/.test(help)) skipRot = 'local ffmpeg has no -display_rotation option to tag the rotated input'
  else {
    const land = join(root, 'land.mp4')
    ok(['-f', 'lavfi', '-i', `color=c=black:s=72x128:r=30:d=2,format=yuv420p,${code8()},scale=1080:1920:flags=neighbor,transpose=2`,
      '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', land])
    ok(['-display_rotation:v:0', '-90', '-i', land, '-c', 'copy', src.rot])
  }

  // (b) VFR: 1 s at 24 fps then 1 s at 60 fps, timestamps kept, 1280×720, no audio.
  src.vfr = join(media, 'مقطع %ب متغير.mp4')
  ok(['-f', 'lavfi', '-i', `color=c=black:s=128x72:r=24:d=1,format=yuv420p,${code8(0)},scale=1280:720:flags=neighbor,settb=1/120`,
    '-f', 'lavfi', '-i', `color=c=black:s=128x72:r=60:d=1,format=yuv420p,${code8(1)},scale=1280:720:flags=neighbor,settb=1/120`,
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-fps_mode', 'passthrough',
    '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-video_track_timescale', '120', src.vfr])

  // (c) 60 fps, 2560×1440 (over the 1920 long side), mono 44.1 kHz audio.
  src.f60 = join(media, 'مقطع %ج 60.mp4')
  ok(['-f', 'lavfi', '-i', `color=c=black:s=128x72:r=60:d=2,format=yuv420p,${code8()},scale=2560:1440:flags=neighbor`,
    '-f', 'lavfi', '-i', 'sine=f=440:d=2:r=44100',
    '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src.f60])

  // (d) 10-bit HEVC tagged HLG (bt2020), 30 fps, with audio.
  src.hdr = join(media, 'مقطع %د HDR.mp4')
  if (!/libx265/.test(encoders)) skipHdr = 'local ffmpeg has no libx265 encoder to synthesize the 10-bit HEVC HLG clip'
  else {
    ok(['-f', 'lavfi', '-i', `color=c=black:s=128x72:r=30:d=2,format=yuv420p10le,${code10()},scale=1280:720:flags=neighbor`,
      '-f', 'lavfi', '-i', 'sine=f=440:d=2:r=48000',
      '-c:v', 'libx265', '-x265-params', 'log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc',
      '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc',
      '-tag:v', 'hvc1', '-c:a', 'aac', '-shortest', src.hdr])
  }
})
test.afterAll(async () => {
  await unlock(root)
  await rm(root, { recursive: true, force: true })
})

test('probeMedia detects rotation, VFR, 60 fps and HDR', async () => {
  if (!skipRot) {
    const a = await probeMedia(src.rot)
    expect(a).toMatchObject({ w: 1920, h: 1080, rotation: 90, fps: 30, vfr: false, hdr: false, codec: 'h264', hasAudio: false })
    expect(a.durationSec).toBeCloseTo(2, 2)
  }
  const b = await probeMedia(src.vfr)
  expect(b.vfr).toBe(true)
  expect(b.rotation).toBe(0)
  const c = await probeMedia(src.f60)
  expect(c).toMatchObject({ w: 2560, h: 1440, fps: 60, vfr: false, hdr: false, hasAudio: true })
  if (!skipHdr) {
    const d = await probeMedia(src.hdr)
    expect(d).toMatchObject({ hdr: true, codec: 'hevc', colorTransfer: 'arib-std-b67', pixFmt: 'yuv420p10le', hasAudio: true })
  }
})

let dir: string
let first: IngestResult[]
const ids: Record<string, string> = {}

test('ingest: upright, CFR 30, right frames, SDR, AAC 48 kHz stereo, bookkeeping', async () => {
  const inputs = (['rot', 'vfr', 'f60', 'hdr'] as const).filter((k) => (k === 'rot' ? !skipRot : k === 'hdr' ? !skipHdr : true))
  dir = join(projects, 'هاتف 1')
  const p = await initProject({ dir, media: inputs.map((k) => src[k]) })
  inputs.forEach((k, i) => (ids[k] = `m${i + 1}`))
  // An unknown manifest key must survive the rewrite.
  const raw = JSON.parse(await readFile(join(dir, 'mba-project.json'), 'utf8'))
  raw.futureKey = { keep: true }
  raw.media[0].futureMediaKey = 'keep'
  await writeFile(join(dir, 'mba-project.json'), JSON.stringify(raw, null, 2))

  const progress: number[] = []
  const t0 = performance.now()
  first = await ingestProject(await openProject(dir), { onProgress: (e) => progress.push(e.fraction) })
  console.log(`ingest of ${inputs.length} clips took ${((performance.now() - t0) / 1000).toFixed(1)} s`)
  expect(first.map((r) => r.status)).toEqual(inputs.map(() => 'ingested'))
  expect(progress.length).toBeGreaterThan(0)
  for (const f of progress) expect(f >= 0 && f <= 1).toBe(true)

  const work = await readdir(join(dir, 'work'))
  expect(work.filter((f) => f.includes('.part'))).toEqual([])
  const p2 = await openProject(dir)
  const manifestRaw = JSON.parse(await readFile(join(dir, 'mba-project.json'), 'utf8'))
  expect(manifestRaw.futureKey).toEqual({ keep: true })
  expect(manifestRaw.media[0].futureMediaKey).toBe('keep')
  const mediaJson = JSON.parse(await readFile(join(dir, 'work', 'media.json'), 'utf8'))

  for (const k of inputs) {
    const id = ids[k]!
    const file = join(dir, 'work', `${id}.mp4`)
    expect(existsSync(file), id).toBe(true)
    const m = p2.manifest.media.find((x) => x.id === id)!
    expect(m.work).toBe(`work/${id}.mp4`)
    const info = await probeMedia(file)
    expect(info, id).toMatchObject({ rotation: 0, fps: 30, vfr: false, hdr: false, codec: 'h264', pixFmt: 'yuv420p', hasAudio: true })
    expect(m.durationSec).toBeCloseTo(info.durationSec, 3)

    // CFR: every frame 1/30 s apart, frame count = round(duration × 30) ± 1.
    const j = ffprobeJson(file, ['-count_frames', '-show_entries', 'stream=codec_type,nb_read_frames,r_frame_rate,avg_frame_rate,sample_rate,channels,codec_name,color_transfer,color_primaries,bits_per_raw_sample'])
    const v = j.streams.find((s: any) => s.codec_type === 'video')
    const a = j.streams.find((s: any) => s.codec_type === 'audio')
    expect(v.r_frame_rate).toBe('30/1')
    expect(v.avg_frame_rate).toBe('30/1')
    const n = Number(v.nb_read_frames)
    expect(Math.abs(n - Math.round(info.durationSec * 30)), id).toBeLessThanOrEqual(1)
    expect(Math.abs(n - 60), id).toBeLessThanOrEqual(1) // 2 s sources
    expect(a).toMatchObject({ codec_name: 'aac', sample_rate: '48000', channels: 2 })

    // Frame n shows the source picture at n/30.
    const { codes, top } = readCodes(file)
    expect(codes.length).toBe(n)
    for (const t of top) expect(t, `${id} top bar (upright)`).toBeGreaterThan(200)
    codes.forEach((c, i) => {
      if (k === 'vfr') {
        // 24 fps then 60 fps: the shown source frame lies within one source frame (1/24 s) of n/30.
        expect(Math.abs(c / 120 - i / 30), `${id} frame ${i} code ${c}`).toBeLessThan(1 / 24 + 1e-9)
        if (i > 0) expect(c).toBeGreaterThanOrEqual(codes[i - 1]!)
      } else {
        expect(c, `${id} frame ${i}`).toBe(4 * i) // source time i/30 exactly (30 fps, or every 2nd frame of 60)
      }
    })
    if (k === 'vfr') expect(codes.slice(30)).toEqual(codes.slice(30).map((_, i) => 120 + 4 * i)) // 60 fps half: exact

    const e = mediaJson.media.find((x: any) => x.id === id)
    expect(e.sourceHash).toMatch(/^[0-9a-f]{40}$/)
    expect(e.info).toBeTruthy()
    expect(e.workInfo).toMatchObject({ fps: 30, rotation: 0 })

    if (k === 'rot') expect({ w: info.w, h: info.h }).toEqual({ w: 1080, h: 1920 })
    if (k === 'vfr') expect({ w: info.w, h: info.h }).toEqual({ w: 1280, h: 720 })
    if (k === 'f60') expect({ w: info.w, h: info.h }).toEqual({ w: 1920, h: 1080 })
    if (k === 'hdr') {
      expect({ w: info.w, h: info.h }).toEqual({ w: 1280, h: 720 })
      expect(v.color_transfer).toBe('bt709')
      expect(v.color_primaries).toBe('bt709')
      expect(info.colorTransfer).toBe('bt709')
      expect(['zscale', 'colorspace']).toContain(e.hdrPath)
    }
  }
  const log = await readFile(join(dir, 'log.md'), 'utf8')
  for (const k of inputs) expect(log).toMatch(new RegExp(`ingest.*${ids[k]}`))
  if (!skipHdr) expect(log).toMatch(/zscale|colorspace/)
  if (!skipRot) expect(first.find((r) => r.id === ids.rot)!.issues).toContain('مُدار 90° — rotated 90°')
  expect(first.find((r) => r.id === ids.vfr)!.issues).toContain('إطارات متغيرة — variable frame rate')
  if (!skipHdr) expect(first.find((r) => r.id === ids.hdr)!.issues.some((x) => x.includes('HDR'))).toBe(true)
})

test('re-running ingest is a no-op: nothing rewritten', async () => {
  const files = [...Object.values(ids).map((id) => join(dir, 'work', `${id}.mp4`)), join(dir, 'work', 'media.json'), join(dir, 'mba-project.json'), join(dir, 'log.md')]
  const before = await Promise.all(files.map(mtime))
  const again = await ingestProject(await openProject(dir))
  expect(again.map((r) => r.status)).toEqual(first.map(() => 'up-to-date'))
  expect(await Promise.all(files.map(mtime))).toEqual(before)
})

test('only stale copies are redone: changed hash, half-written leftovers, missing copy', async () => {
  const m1 = join(dir, 'work', 'm1.mp4')
  const m2 = join(dir, 'work', 'm2.mp4')
  const t1 = await mtime(m1)
  // m2's record no longer matches its source (as if the source had changed).
  const mj = join(dir, 'work', 'media.json')
  const j = JSON.parse(await readFile(mj, 'utf8'))
  j.media.find((x: any) => x.id === 'm2').sourceHash = '0'.repeat(40)
  await writeFile(mj, JSON.stringify(j))
  // A leftover from an interrupted run must not count, and must be cleaned up.
  await writeFile(join(dir, 'work', 'm2.mp4.part'), 'half')
  const tmps = [join(dir, 'work', 'media.json.99999.tmp'), join(dir, 'mba-project.json.99999.tmp')]
  for (const t of tmps) await writeFile(t, '{')
  const r = await ingestProject(await openProject(dir))
  expect(r.find((x) => x.id === 'm1')!.status).toBe('up-to-date')
  expect(r.find((x) => x.id === 'm2')!.status).toBe('ingested')
  expect(await mtime(m1)).toBe(t1)
  expect(existsSync(join(dir, 'work', 'm2.mp4.part'))).toBe(false)
  for (const t of tmps) expect(existsSync(t), t).toBe(false)
  const j2 = JSON.parse(await readFile(mj, 'utf8'))
  expect(j2.media.map((x: any) => x.recipe)).toEqual(j2.media.map(() => INGEST_RECIPE))
  // A copy made with another recipe is stale.
  j2.media.find((x: any) => x.id === 'm1').recipe = INGEST_RECIPE - 1
  await writeFile(mj, JSON.stringify(j2))
  const r1 = await ingestProject(await openProject(dir))
  expect(r1.find((x) => x.id === 'm1')!.status).toBe('ingested')
  expect(r1.find((x) => x.id === 'm2')!.status).toBe('up-to-date')
  // A copy that is gone (or was never finished) is redone even if the record matches.
  await rm(m2)
  const r2 = await ingestProject(await openProject(dir))
  expect(r2.find((x) => x.id === 'm2')!.status).toBe('ingested')
  expect(existsSync(m2)).toBe(true)
})

test('audio: the default stream is taken, a late start becomes leading silence, trimmed at the video end', async () => {
  // 2 s video. Two audio streams: a1 silent mp3 (not default), a2 AAC (default) starting 0.2 s late
  // with a 1 kHz beep at source time 1.0 s (0.8 s into a2) and running 0.5 s past the video.
  const file = join(root, 'مصادر %50', 'صوت متأخر %.mp4')
  ok(['-f', 'lavfi', '-i', `color=c=black:s=128x72:r=30:d=2,format=yuv420p,${code8()},scale=640:360:flags=neighbor`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=2',
    '-itsoffset', '0.2', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,0.8,0.9),0.5*sin(2*PI*1000*t),0)':s=48000:d=2.3",
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p',
    '-c:a:0', 'libmp3lame', '-c:a:1', 'aac', '-disposition:a:0', '0', '-disposition:a:1', 'default', file])
  const sj = ffprobeJson(file, ['-show_entries', 'stream=index,codec_type,codec_name,start_time:stream_disposition=default'])
  const late = sj.streams.find((s: any) => s.codec_name === 'aac')
  expect(Number(late.start_time)).toBeGreaterThan(0.15) // the input really starts late
  expect((await probeMedia(file)).audioStream).toBe(late.index)

  const d = join(projects, 'صوت')
  await initProject({ dir: d, media: [file] })
  await ingestProject(await openProject(d))
  const out = join(d, 'work', 'm1.mp4')
  const j = ffprobeJson(out, ['-show_entries', 'stream=codec_type,start_time,duration'])
  const a = j.streams.find((s: any) => s.codec_type === 'audio')
  const v = j.streams.find((s: any) => s.codec_type === 'video')
  expect(Number(a.start_time)).toBeLessThan(0.005)
  expect(Number(a.duration)).toBeLessThanOrEqual(Number(v.duration) + 1 / 30)
  // Decode from the file start: the beep lands within one frame of its source time 1.0 s.
  const pcm = spawnSync(resolveFfmpeg(), ['-v', 'error', '-i', out, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'])
  expect(pcm.status, String(pcm.stderr)).toBe(0)
  const samples = new Int16Array(pcm.stdout.buffer, pcm.stdout.byteOffset, Math.floor(pcm.stdout.length / 2))
  const onset = samples.findIndex((x) => Math.abs(x) > 3000)
  expect(onset).toBeGreaterThan(0)
  expect(Math.abs(onset / 48000 - 1.0)).toBeLessThan(1 / 30)
  expect(samples.length / 48000).toBeLessThanOrEqual(2 + 1 / 30)
})

test('HDR fallback path (colorspace filter) also gives an 8-bit bt709 copy, recorded in log and media.json', async () => {
  test.skip(!!skipHdr, skipHdr)
  const d = join(projects, 'HDR بديل')
  await initProject({ dir: d, media: [src.hdr] })
  const [r] = await ingestProject(await openProject(d), { hdrPath: 'colorspace' })
  expect(r!.hdrPath).toBe('colorspace')
  const file = join(d, 'work', 'm1.mp4')
  const info = await probeMedia(file)
  expect(info).toMatchObject({ hdr: false, pixFmt: 'yuv420p', colorTransfer: 'bt709', fps: 30 })
  expect(readCodes(file).codes).toEqual(Array.from({ length: 60 }, (_, i) => 4 * i))
  expect(JSON.parse(await readFile(join(d, 'work', 'media.json'), 'utf8')).media[0].hdrPath).toBe('colorspace')
  expect(await readFile(join(d, 'log.md'), 'utf8')).toMatch(/ingest.*colorspace/)
})

test('media over the 3-minute limit is refused (Arabic first), nothing written', async () => {
  const d = join(projects, 'طويل')
  await initProject({ dir: d, media: [src.vfr] })
  // Stand-in for an over-long source (init refuses those, so swap the copy afterwards).
  const long = join(root, 'long.mp4')
  ok(['-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=2:d=181', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', long])
  const copy = join(d, 'source', 'مقطع %ب متغير.mp4')
  await chmod(copy, 0o644)
  await copyFile(long, copy)
  const err = await ingestProject(await openProject(d)).then(() => null, (e: Error) => e)
  expect(err?.message).toMatch(/^[؀-ۿ]/)
  expect(err?.message).toContain('181')
  expect(err?.message).toContain('180')
  expect(await readdir(join(d, 'work'))).toEqual([])
})

test('CLI: mba ingest prints one Arabic+English line per media; exit codes', async () => {
  const d = join(projects, 'سطر الأوامر')
  await initProject({ dir: d, media: skipRot ? [src.vfr] : [src.rot, src.vfr] })
  const r = cli(['ingest', d])
  expect(r.status, r.stderr).toBe(0)
  const lines = r.stdout.trim().split('\n')
  expect(lines[0]).toMatch(/^[؀-ۿ]/)
  if (!skipRot) expect(r.stdout).toMatch(/m1 .*مُدار 90° — rotated 90°/)
  expect(r.stdout).toMatch(/إطارات متغيرة — variable frame rate/)
  expect(r.stdout).toMatch(/work\/m1\.mp4/)
  expect(r.stderr).toMatch(/%/) // progress on stderr
  const again = cli(['ingest', d])
  expect(again.status).toBe(0)
  expect(again.stdout).toMatch(/محدّثة — up to date/)

  expect(cli(['ingest', join(root, 'مصادر %50')]).status).toBe(1) // not a project
  expect(cli(['ingest']).status).toBe(2)
  expect(cli(['ingest', d, 'extra']).status).toBe(2)
  expect(cli(['ingest', d, '--fps', '30']).status).toBe(2)
})

test('audio-only media: WAV working copy, placeholder scene, no video scene, re-ingest up to date', async () => {
  const media = join(root, 'مصادر صوت 100%')
  await mkdir(media, { recursive: true })
  const voice = join(media, 'صوتي 100%.m4a')
  ok(['-f', 'lavfi', '-i', 'sine=f=440:d=4', '-c:a', 'aac', voice])

  const d = join(projects, 'مشروع صوتي')
  const p = await initProject({ dir: d, media: [voice] })
  expect(p.manifest.media[0]).toMatchObject({ id: 'm1', kind: 'audio' })
  expect(JSON.parse(await readFile(join(d, 'mba-project.json'), 'utf8')).media[0].kind).toBe('audio')
  const edit = JSON.parse(await readFile(join(d, 'edit.json'), 'utf8'))
  expect(edit.scenes.some((s: any) => s.type === 'video')).toBe(false)
  expect(edit.scenes).toHaveLength(1)
  expect(edit.scenes[0]).toMatchObject({ type: 'wipe-reveal', start: 0 })
  expect(edit.scenes[0].duration).toBeCloseTo(4, 1)
  expect(edit.audio).toEqual([{ kind: 'voice', media: 'm1' }])

  const out = await ingestProject(p)
  expect(out[0]).toMatchObject({ id: 'm1', work: 'work/m1.wav', status: 'ingested' })
  const wav = join(d, 'work', 'm1.wav')
  expect(existsSync(wav)).toBe(true)
  const info = await probeMedia(wav)
  expect(info).toMatchObject({ hasVideo: false, hasAudio: true, codec: 'pcm_s16le' })
  expect(Math.abs(info.durationSec - 4)).toBeLessThanOrEqual(0.02)
  const st = ffprobeJson(wav, ['-show_streams']).streams[0]
  expect(st).toMatchObject({ sample_rate: '48000', channels: 2 })
  const m = JSON.parse(await readFile(join(d, 'mba-project.json'), 'utf8'))
  expect(m.media[0]).toMatchObject({ kind: 'audio', work: 'work/m1.wav' })
  expect(m.media[0].durationSec).toBeCloseTo(4, 1)

  const t0 = await mtime(wav)
  const again = await ingestProject(await openProject(d))
  expect(again[0]!.status).toBe('up-to-date')
  expect(await mtime(wav)).toBe(t0)

  // A video scene on audio-only media is refused, Arabic first.
  const bad = join(d, 'bad.json')
  await writeFile(bad, JSON.stringify({ ...edit, scenes: [{ id: 'c1', type: 'video', start: 0, duration: 2, track: 0, params: { media: 'm1', in: 0 } }] }))
  await copyFile(bad, join(d, 'edit.json'))
  const err = await loadStoryboardFile(join(d, 'edit.json')).then(() => null, (e: Error) => e)
  expect(err?.message).toMatch(/^المادة m1 صوت فقط ولا يمكن عرضها كفيديو — scenes\[0\]\.params\.media: m1 is audio-only and cannot be shown as video$/)
})
