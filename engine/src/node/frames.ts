import { spawn } from 'node:child_process'
import { mkdir, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ANALYSIS_FPS, type RGB } from './metrics'
import { resolveFfmpeg, resolveFfprobe } from './tools'

/** Decoding helpers for the review kit: ffprobe/ffmpeg, always spawned with argv arrays. */

export interface VideoInfo {
  w: number
  h: number
  fps: number
  /** frames / fps (the frame grid the analysis tools sample). */
  duration: number
  frames: number
  /**
   * The video stream's own duration (`videoDurationFrom`: stream duration, DURATION tag, the
   * container only without audio, else the last packet's end), 0 when unknown. Unlike `duration`
   * it does not depend on the average frame rate, which a variable-frame-rate file can misreport
   * (e.g. Matroska: avg 60 fps for a clip that slows down, so frames / fps drops its tail).
   */
  streamDuration: number
}

interface RunResult {
  code: number | null
  stdout: Buffer
  stderr: string
  error?: Error
}

/** Spawns `cmd args` (no shell) and collects stdout fully: chunks are joined, never assumed to align with frames. */
function run(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((res) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const out: Buffer[] = []
    let err = ''
    proc.stdout.on('data', (d: Buffer) => out.push(d))
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      err = (err + d).slice(-4000)
    })
    proc.once('error', (error) => res({ code: null, stdout: Buffer.concat(out), stderr: err, error }))
    proc.once('close', (code) => res({ code, stdout: Buffer.concat(out), stderr: err }))
  })
}

/**
 * Cuts a byte stream into whole frames of `frameBytes` as it arrives: the bytes of a frame split
 * across two stdout chunks wait in a remainder buffer (at most one frame), so the whole video is
 * never joined in memory. Returned frames are copies.
 */
export class FrameSlicer {
  private rest: Buffer = Buffer.alloc(0)
  constructor(readonly frameBytes: number) {
    if (!(Number.isInteger(frameBytes) && frameBytes > 0)) throw new Error(`حجم إطار غير صالح — Invalid frame size ${frameBytes}`)
  }
  /** Bytes waiting for the rest of their frame. */
  get remainder(): number {
    return this.rest.length
  }
  push(chunk: Buffer): Uint8Array[] {
    const n = this.frameBytes
    const out: Uint8Array[] = []
    let off = 0
    if (this.rest.length > 0) {
      const need = n - this.rest.length
      if (chunk.length < need) {
        this.rest = Buffer.concat([this.rest, chunk])
        return out
      }
      out.push(new Uint8Array(Buffer.concat([this.rest, chunk.subarray(0, need)])))
      off = need
    }
    for (; off + n <= chunk.length; off += n) out.push(new Uint8Array(chunk.subarray(off, off + n)))
    this.rest = Buffer.from(chunk.subarray(off))
    return out
  }
}

/**
 * Spawns `cmd args` (no shell) and hands stdout to `onFrame` frame by frame (`FrameSlicer`); a
 * trailing partial frame is dropped. Nothing but one frame's remainder is buffered.
 */
function runFrames(cmd: string, args: string[], frameBytes: number, onFrame: (f: Uint8Array) => void): Promise<Omit<RunResult, 'stdout'>> {
  return new Promise((res) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const slicer = new FrameSlicer(frameBytes)
    let err = ''
    let thrown: Error | undefined
    proc.stdout.on('data', (d: Buffer) => {
      if (thrown) return
      try {
        for (const f of slicer.push(d)) onFrame(f)
      } catch (e) {
        thrown = e as Error
        proc.kill()
      }
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      err = (err + d).slice(-4000)
    })
    proc.once('error', (error) => res({ code: null, stderr: err, error }))
    proc.once('close', (code) => res({ code, stderr: err, ...(thrown ? { error: thrown } : {}) }))
  })
}

function failed(what: string, r: Omit<RunResult, 'stdout'>): Error {
  return new Error(`${what} (${r.error ? r.error.message : `exit code ${r.code}`}): ${r.stderr.trim().slice(-1500)}`)
}

function assertExists(path: string): void {
  if (!existsSync(path)) throw new Error(`لم يتم العثور على ملف الفيديو — Video file not found: ${path}`)
}

function parseRate(s: unknown): number {
  if (typeof s !== 'string') return NaN
  const [a, b] = s.split('/').map(Number)
  if (b === undefined) return Number(a)
  return b ? a! / b : NaN
}

/** A Matroska/WebM `DURATION` tag (`HH:MM:SS.fffffffff`) in seconds; NaN otherwise. */
export function parseClockDuration(v: unknown): number {
  if (typeof v !== 'string') return NaN
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v.trim())
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN
}

/**
 * The video stream's own length from ffprobe's stream/format entries: the stream `duration`,
 * else its `DURATION` tag (Matroska/WebM write no stream duration), else the container duration,
 * but only when the file has no audio (the container lasts as long as its LONGEST stream, so with
 * longer audio it overstates the video). 0 when unknown: ask the packets (`lastVideoPacketEnd`).
 */
export function videoDurationFrom(stream: Record<string, unknown>, format: Record<string, unknown> | undefined, hasAudio: boolean): number {
  const sd = Number(stream.duration)
  if (sd > 0) return sd
  const tags = (stream.tags ?? {}) as Record<string, unknown>
  const td = parseClockDuration(tags.DURATION ?? tags.duration)
  if (td > 0) return td
  const fd = Number(format?.duration)
  return !hasAudio && fd > 0 ? fd : 0
}

/** End of the first video stream from its packets: max(pts + duration) − start, in s (0 when unknown). */
export async function lastVideoPacketEnd(path: string): Promise<number> {
  const r = await run(resolveFfprobe(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,duration_time:stream=start_time', '-of', 'csv=p=0', resolve(path)])
  if (r.error || r.code !== 0) return 0
  let end = 0
  let start = 0
  for (const line of r.stdout.toString('utf8').split(/\r?\n/)) {
    const [a, b] = line.split(',')
    const pts = Number(a)
    if (b === undefined) {
      if (Number.isFinite(pts)) start = pts
      continue
    }
    const d = Number(b)
    if (Number.isFinite(pts)) end = Math.max(end, pts + (Number.isFinite(d) ? d : 0))
  }
  return Math.max(0, end - start)
}

/** True when the file has an audio stream. */
async function hasAudioStream(file: string): Promise<boolean> {
  const r = await run(resolveFfprobe(), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file])
  return r.code === 0 && r.stdout.toString('utf8').trim() !== ''
}

/** Size, frame rate, duration and frame count of the first video stream (packets are counted, not decoded). */
export async function probeVideo(path: string): Promise<VideoInfo> {
  const file = resolve(path)
  assertExists(file)
  const r = await run(resolveFfprobe(), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-count_packets',
    '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,nb_read_packets,duration:stream_tags=DURATION:format=duration',
    '-of', 'json',
    file,
  ])
  if (r.error || r.code !== 0) throw failed(`تعذّر فحص الفيديو — ffprobe could not read the video ${file}`, r)
  let j: { streams?: Record<string, unknown>[]; format?: Record<string, unknown> }
  try {
    j = JSON.parse(r.stdout.toString('utf8'))
  } catch {
    throw new Error(`مخرجات ffprobe غير صالحة — ffprobe returned invalid JSON for ${file}`)
  }
  const s = j.streams?.[0]
  if (!s) throw new Error(`لا يوجد مسار فيديو في الملف — No video stream in ${file}`)
  const w = Number(s.width)
  const h = Number(s.height)
  let fps = parseRate(s.avg_frame_rate)
  if (!(fps > 0)) fps = parseRate(s.r_frame_rate)
  if (!(w > 0 && h > 0 && fps > 0)) throw new Error(`بيانات الفيديو ناقصة — Missing video size or frame rate in ${file}`)
  // Snap rates like 29.97002997 stay as they are; exact integer rates are kept exact.
  if (Math.abs(fps - Math.round(fps)) < 1e-6) fps = Math.round(fps)
  let frames = Number(s.nb_read_packets)
  const dur = Number(s.duration) > 0 ? Number(s.duration) : Number(j.format?.duration)
  if (!(frames > 0)) frames = dur > 0 ? Math.round(dur * fps) : 0
  const duration = frames > 0 ? frames / fps : dur > 0 ? dur : 0
  // The video's own length (never the container's when there is audio: that is the longest stream).
  let streamDuration = videoDurationFrom(s, j.format, true)
  if (!(streamDuration > 0)) {
    streamDuration = (await hasAudioStream(file)) ? await lastVideoPacketEnd(file) : videoDurationFrom(s, j.format, false)
  }
  return { w, h, fps, duration, frames, streamDuration }
}

/**
 * Small analysis size that keeps the aspect: 72×128 for 9:16, 128×72 for 16:9, 96×96 for 1:1,
 * 96×120 for 4:5; other shapes get a long side of 128 (even sizes).
 */
export function defaultGraySize(w: number, h: number): { w: number; h: number } {
  const r = w / h
  const known: [number, { w: number; h: number }][] = [
    [9 / 16, { w: 72, h: 128 }],
    [16 / 9, { w: 128, h: 72 }],
    [1, { w: 96, h: 96 }],
    [4 / 5, { w: 96, h: 120 }],
  ]
  for (const [k, size] of known) if (Math.abs(r / k - 1) < 0.01) return { ...size }
  const even = (x: number) => Math.max(2, Math.round(x / 2) * 2)
  return r >= 1 ? { w: 128, h: even(128 / r) } : { w: even(128 * r), h: 128 }
}

/**
 * The video as 8-bit luminance at a small size (`-f rawvideo -pix_fmt gray -s WxH -`), one array
 * per frame, resampled to `fps` frames per second (`-vf fps=…`; default `ANALYSIS_FPS`, so motion
 * metrics do not depend on the source frame rate). Frame k is the picture shown at k/fps.
 * `fps: null` keeps every source frame. Default size: `defaultGraySize` of the video.
 */
export async function grayFrames(
  path: string,
  size?: { w: number; h: number },
  fps: number | null = ANALYSIS_FPS,
): Promise<Uint8Array[]> {
  const file = resolve(path)
  assertExists(file)
  const sz: { w: number; h: number } = size ?? defaultGraySize(...(await probeVideo(file).then((p) => [p.w, p.h] as const)))
  const frames: Uint8Array[] = []
  const r = await runFrames(
    resolveFfmpeg(),
    [
      '-v', 'error', '-nostdin',
      '-i', file,
      '-an', '-sn',
      ...(fps !== null ? ['-vf', `fps=${fps}`] : []),
      '-fps_mode', 'passthrough',
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${sz.w}x${sz.h}`,
      '-',
    ],
    sz.w * sz.h,
    (f) => frames.push(f),
  )
  if (r.error || r.code !== 0) throw failed(`تعذّر فك ترميز الفيديو — ffmpeg could not decode ${file}`, r)
  return frames
}

/**
 * Mean sRGB colour of every frame, resampled to `fps` like `grayFrames` (same frame count and
 * times): each frame is area-averaged down to 8×8 (`scale=8:8:flags=area`, `rgb24`) and averaged.
 */
export async function meanColors(path: string, fps: number = ANALYSIS_FPS): Promise<RGB[]> {
  const file = resolve(path)
  assertExists(file)
  const n = 8 * 8 * 3
  const out: RGB[] = []
  const r = await runFrames(
    resolveFfmpeg(),
    [
      '-v', 'error', '-nostdin',
      '-i', file,
      '-an', '-sn',
      '-vf', `fps=${fps},scale=8:8:flags=area`,
      '-fps_mode', 'passthrough',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24',
      '-',
    ],
    n,
    (f) => {
      const sum = [0, 0, 0]
      for (let i = 0; i < n; i++) sum[i % 3]! += f[i]!
      out.push(sum.map((v) => v / 64) as RGB)
    },
  )
  if (r.error || r.code !== 0) throw failed(`تعذّر فك ترميز الفيديو — ffmpeg could not decode ${file}`, r)
  return out
}

/**
 * The video as `rgb24` frames of `size` (area-scaled), resampled to `fps`, handed to `onFrame` one
 * at a time as they are decoded (streamed: only one frame's remainder is buffered).
 */
export async function rgbFrames(path: string, size: { w: number; h: number }, fps: number, onFrame: (f: Uint8Array) => void): Promise<void> {
  const file = resolve(path)
  assertExists(file)
  const r = await runFrames(
    resolveFfmpeg(),
    [
      '-v', 'error', '-nostdin',
      '-i', file,
      '-an', '-sn',
      '-vf', `fps=${fps},scale=${size.w}:${size.h}:flags=area`,
      '-fps_mode', 'passthrough',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24',
      '-',
    ],
    size.w * size.h * 3,
    onFrame,
  )
  if (r.error || r.code !== 0) throw failed(`تعذّر فك ترميز الفيديو — ffmpeg could not decode ${file}`, r)
}

/** Most frames one ffmpeg pass of `stillsAt` selects. */
export const STILLS_PER_PASS = 40

/** Frame index shown at time t (nearest frame start), clamped to the clip. */
export function frameIndexAt(t: number, fps: number, frames: number): number {
  return Math.min(Math.max(Math.round(t * fps), 0), Math.max(0, frames - 1))
}

/**
 * ffmpeg argv for one `stillsAt` pass: the frames `chunk` (sorted, unique) of a CFR video at `fps`,
 * written to `outPattern` (`…%05d.png`, numbered from 1). The input seek lands half a frame before
 * the chunk's first frame, so that frame is the first one decoded out (ffmpeg seeks to the keyframe
 * before and drops frames up to the seek time); `select` counts n from there, so the indices are
 * offset by the first frame. A chunk starting at frame 0 needs no seek.
 */
export function buildStillsArgs(file: string, chunk: readonly number[], fps: number, width: number | undefined, outPattern: string): string[] {
  const first = chunk[0]!
  const select = `select='${chunk.map((i) => `eq(n\\,${i - first})`).join('+')}'`
  const vf = width ? `${select},scale=${width}:-2:flags=lanczos` : select
  return [
    '-v', 'error', '-nostdin', '-y',
    ...(first > 0 ? ['-ss', String((first - 0.5) / fps)] : []),
    '-i', file,
    '-an', '-sn',
    '-vf', vf,
    '-fps_mode', 'passthrough',
    '-frames:v', String(chunk.length),
    outPattern,
  ]
}

/**
 * One PNG per time (the frame shown at that time; see `frameIndexAt`). Frames are extracted in
 * passes of at most `STILLS_PER_PASS` sorted indices, each seeking near its first frame
 * (`buildStillsArgs`), so a long video is decoded about once in total, not once per pass. `width`
 * scales the stills (height keeps the aspect). Returns the paths in the order of `times`; equal
 * frames share a file. Files are `<outDir>/frame-<index>.png`.
 */
export async function stillsAt(path: string, times: number[], outDir: string, width?: number): Promise<string[]> {
  const file = resolve(path)
  const info = await probeVideo(file)
  if (info.frames < 1) throw new Error(`الفيديو بلا إطارات — The video has no frames: ${file}`)
  const dir = resolve(outDir)
  await mkdir(dir, { recursive: true })
  const idx = times.map((t) => frameIndexAt(t, info.fps, info.frames))
  const unique = [...new Set(idx)].sort((a, b) => a - b)
  if (unique.length === 0) return []
  const tmp = join(dir, `.stills-${process.pid}-${Date.now()}`)
  await mkdir(tmp, { recursive: true })
  try {
    // ffmpeg's expression parser rejects a long eq(n,i)+… sum (about 100 terms fails), so long
    // videos are extracted in several passes of at most STILLS_PER_PASS frames.
    const byIndex = new Map<number, string>()
    for (let c = 0; c < unique.length; c += STILLS_PER_PASS) {
      const chunk = unique.slice(c, c + STILLS_PER_PASS)
      const sub = join(tmp, `p${c}`)
      await mkdir(sub, { recursive: true })
      // image2 reads '%' in the path as a pattern: escape the directory part, keep ours.
      const r = await run(resolveFfmpeg(), buildStillsArgs(file, chunk, info.fps, width, join(sub.replace(/%/g, '%%'), 's%05d.png')))
      if (r.error || r.code !== 0) throw failed(`تعذّر استخراج الإطارات — ffmpeg could not extract stills from ${file}`, r)
      for (let k = 0; k < chunk.length; k++) {
        const src = join(sub, `s${String(k + 1).padStart(5, '0')}.png`)
        // A container whose real frame count is below the probed one can yield fewer stills: reuse the last.
        const dst = join(dir, `frame-${chunk[k]}.png`)
        if (existsSync(src)) {
          await rename(src, dst)
          byIndex.set(chunk[k]!, dst)
        } else {
          const last = byIndex.get(unique[c + k - 1]!)
          if (!last) throw new Error(`لم يُستخرج أي إطار — ffmpeg produced no stills from ${file}`)
          byIndex.set(chunk[k]!, last)
        }
      }
      await rm(sub, { recursive: true, force: true })
    }
    return idx.map((i) => byIndex.get(i)!)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
