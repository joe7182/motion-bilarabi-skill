import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { MAX_PROJECT_MEDIA_SEC, PROJECT_MANIFEST } from '../core/project'
import { fsStep, isAtomicTemp, renameWithRetry, writeFileAtomic } from './fsx'
import { appendLog, recordWorkingCopies, type Project } from './project'
import { lastVideoPacketEnd, videoDurationFrom } from './frames'
import { resolveFfmpeg, resolveFfprobe } from './tools'

/**
 * `mba ingest`: phone media → upright, constant-frame-rate SDR working copies in `work/`, where
 * frame n is exactly the picture at n/fps (spec §16.2). ffmpeg and ffprobe are always spawned with
 * argv arrays (no shell), so paths with spaces, Arabic and `%` pass through untouched.
 */

/** Longest side of a working copy, in pixels. */
export const WORK_MAX_SIDE = 1920

export type Rotation = 0 | 90 | 180 | 270
/** How HDR is turned into SDR: zscale + tonemap, or the `colorspace` filter fallback. */
export type HdrPath = 'zscale' | 'colorspace'

export interface MediaInfo {
  /** False for an audio-only file (then w = h = fps = frames = 0 and `codec` is the audio codec). */
  hasVideo: boolean
  /** Coded size of the first video stream (before rotation). */
  w: number
  h: number
  /** Clockwise turn that shows the picture upright (display matrix or legacy `rotate` tag). */
  rotation: Rotation
  /** Average frame rate. */
  fps: number
  /** r_frame_rate and avg_frame_rate differ by more than 1%. */
  vfr: boolean
  /** PQ (smpte2084) or HLG (arib-std-b67) transfer. */
  hdr: boolean
  codec: string
  durationSec: number
  hasAudio: boolean
  /** ffprobe index of the audio stream a working copy takes (see `pickAudioStream`), or null. */
  audioStream: number | null
  /** Frame count from the container (0 when unknown). */
  frames: number
  pixFmt: string
  colorTransfer: string | null
  colorPrimaries: string | null
  colorSpace: string | null
  /**
   * When the video stream starts after the file's start (e.g. audio first), by how much, in s.
   * ffmpeg's `fps` filter pads such video back to t = 0 (first frame repeated), so in a working
   * copy the video ends at videoStartSec + durationSec; the audio is trimmed there.
   */
  videoStartSec: number
}

const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67'])

function parseRate(s: unknown): number {
  if (typeof s !== 'string') return NaN
  const [a, b] = s.split('/').map(Number)
  if (b === undefined) return Number(a)
  return b ? a! / b : NaN
}

/** Any angle → 0/90/180/270 (nearest multiple of 90, either sign). */
export function normalizeRotation(deg: number): Rotation {
  const q = Math.round(deg / 90) * 90
  return (((q % 360) + 360) % 360) as Rotation
}

type Json = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' && v !== 'unknown' ? v : null)

/**
 * The audio stream to keep: among decodable audio streams (a known codec), the first with the
 * default disposition, else the first AAC, else the first. Returns its ffprobe index, or null.
 */
export function pickAudioStream(streams: Json[]): number | null {
  const audio = streams
    .map((s, i) => ({ s, index: Number.isInteger(s.index) ? (s.index as number) : i }))
    .filter(({ s }) => s.codec_type === 'audio' && str(s.codec_name) !== null && s.codec_name !== 'none' && Number(s.channels ?? 1) > 0)
  const isDefault = (s: Json) => Number((s.disposition as Json | undefined)?.default) === 1
  const hit = audio.find(({ s }) => isDefault(s)) ?? audio.find(({ s }) => s.codec_name === 'aac') ?? audio[0]
  return hit ? hit.index : null
}

/** MediaInfo from `ffprobe -show_streams -show_format -of json` output (pure). */
export function parseProbe(j: { streams?: Json[]; format?: Json }, file = ''): MediaInfo {
  const streams = j.streams ?? []
  // Cover art (an attached picture, common in m4a/mp3) is a still image, not the file's video.
  const isArt = (s: Json) => Number((s.disposition as Json | undefined)?.attached_pic) === 1
  const v = streams.find((s) => !isArt(s) && (s.codec_type === 'video' || (s.codec_type === undefined && s.width !== undefined)))
  if (!v) {
    const audioStream = pickAudioStream(streams)
    if (audioStream === null) throw new Error(`لا يوجد مسار فيديو أو صوت في الملف — No media stream (no video, no audio) in ${file || 'the file'}`)
    const a = streams.find((s, i) => (Number.isInteger(s.index) ? (s.index as number) : i) === audioStream)!
    const ad = Number(a.duration)
    const fd = Number(j.format?.duration)
    return {
      hasVideo: false, w: 0, h: 0, rotation: 0, fps: 0, vfr: false, hdr: false,
      codec: String(a.codec_name ?? ''),
      durationSec: ad > 0 ? ad : fd > 0 ? fd : 0,
      hasAudio: true, audioStream, frames: 0, pixFmt: '',
      colorTransfer: null, colorPrimaries: null, colorSpace: null, videoStartSec: 0,
    }
  }
  const w = Number(v.width)
  const h = Number(v.height)
  const r = parseRate(v.r_frame_rate)
  let fps = parseRate(v.avg_frame_rate)
  if (!(fps > 0)) fps = r
  if (!(w > 0 && h > 0 && fps > 0)) throw new Error(`بيانات الفيديو ناقصة — Missing video size or frame rate in ${file || 'the file'}`)
  if (Math.abs(fps - Math.round(fps)) < 1e-6) fps = Math.round(fps)
  const vfr = r > 0 && Math.abs(r - fps) / fps > 0.01

  // ffprobe's display-matrix rotation is counter-clockwise; the legacy tag is clockwise.
  let rotation: Rotation = 0
  const dm = (v.side_data_list as Json[] | undefined)?.find((d) => d.side_data_type === 'Display Matrix')
  const tag = (v.tags as Json | undefined)?.rotate
  if (dm && Number.isFinite(Number(dm.rotation))) rotation = normalizeRotation(-Number(dm.rotation))
  else if (tag !== undefined && Number.isFinite(Number(tag))) rotation = normalizeRotation(Number(tag))

  const colorTransfer = str(v.color_transfer)
  const audioStream = pickAudioStream(streams)
  const hasAnyAudio = streams.some((x) => x.codec_type === 'audio')
  const vs = Number(v.start_time)
  const fs = Number(j.format?.start_time)
  const videoStartSec = Number.isFinite(vs) && v.start_time !== undefined ? Math.max(0, vs - (Number.isFinite(fs) && j.format?.start_time !== undefined ? fs : 0)) : 0
  return {
    hasVideo: true,
    w,
    h,
    rotation,
    fps,
    vfr,
    hdr: colorTransfer !== null && HDR_TRANSFERS.has(colorTransfer),
    codec: String(v.codec_name ?? ''),
    // The video's own length; 0 when only the packets can tell (probeMedia asks them).
    durationSec: videoDurationFrom(v, j.format, hasAnyAudio),
    hasAudio: audioStream !== null,
    audioStream,
    frames: Number(v.nb_frames) > 0 ? Number(v.nb_frames) : 0,
    pixFmt: String(v.pix_fmt ?? ''),
    colorTransfer,
    colorPrimaries: str(v.color_primaries),
    colorSpace: str(v.color_space),
    videoStartSec,
  }
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  error?: Error
}

/** Spawns `cmd args` (no shell); `onLine` sees stdout line by line. */
function run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<RunResult> {
  return new Promise((res) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    let pending = ''
    let err = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (d: string) => {
      out += d
      if (!onLine) return
      pending += d
      const lines = pending.split(/\r?\n/)
      pending = lines.pop()!
      for (const l of lines) onLine(l)
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      err = (err + d).slice(-4000)
    })
    proc.once('error', (error) => res({ code: null, stdout: out, stderr: err, error }))
    proc.once('close', (code) => res({ code, stdout: out, stderr: err }))
  })
}

const why = (r: RunResult) => `(${r.error ? r.error.message : `exit code ${r.code}`}): ${r.stderr.trim().slice(-1500)}`

/** Size, rotation, frame rate (VFR?), HDR, codec, duration and audio of a media file (ffprobe). */
export async function probeMedia(path: string): Promise<MediaInfo> {
  const file = resolve(path)
  if (!existsSync(file)) throw new Error(`لم يتم العثور على الملف — Media file not found: ${file}`)
  const r = await run(resolveFfprobe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])
  if (r.error || r.code !== 0) throw new Error(`تعذّر فحص الملف — ffprobe could not read ${file} ${why(r)}`)
  let j: { streams?: Json[]; format?: Json }
  try {
    j = JSON.parse(r.stdout)
  } catch {
    throw new Error(`مخرجات ffprobe غير صالحة — ffprobe returned invalid JSON for ${file}`)
  }
  const info = parseProbe(j, file)
  if (info.hasVideo && !(info.durationSec > 0)) info.durationSec = await lastVideoPacketEnd(file)
  return info
}

/** Upright (display) size of the working copy: long side ≤ WORK_MAX_SIDE, aspect kept, even sides. */
export function workSize(info: MediaInfo): { w: number; h: number } {
  const turned = info.rotation === 90 || info.rotation === 270
  const dw = turned ? info.h : info.w
  const dh = turned ? info.w : info.h
  const s = Math.min(1, WORK_MAX_SIDE / Math.max(dw, dh))
  const even = (x: number) => Math.max(2, Math.floor(x / 2) * 2)
  return { w: even(dw * s + 1e-9), h: even(dh * s + 1e-9) }
}

const pick = (v: string | null, allowed: string[], fallback: string) => (v !== null && allowed.includes(v) ? v : fallback)

/** The HDR → bt709 SDR part of the filter chain (ends in 8-bit yuv420p). */
function hdrChain(info: MediaInfo, path: HdrPath): string {
  if (path === 'zscale') {
    const tin = pick(info.colorTransfer, ['smpte2084', 'arib-std-b67'], 'arib-std-b67')
    const pin = pick(info.colorPrimaries, ['bt2020', 'bt709', 'smpte432'], 'bt2020')
    const min = pick(info.colorSpace, ['bt2020nc', 'bt2020c', 'bt709'], 'bt2020nc')
    return [
      `zscale=tin=${tin}:pin=${pin}:min=${min}:rin=tv:t=linear:npl=100`,
      'format=gbrpf32le',
      'zscale=p=bt709',
      'tonemap=tonemap=hable:desat=0',
      'zscale=t=bt709:m=bt709:r=tv',
      'format=yuv420p',
    ].join(',')
  }
  // Fallback without zscale: `colorspace` has no PQ/HLG curve, so the transfer is read as
  // bt2020-10 and primaries/matrix are converted to bt709 (approximate, no tone mapping).
  return 'colorspace=all=bt709:iall=bt2020:itrc=bt2020-10:irange=tv:range=tv:format=yuv420p'
}

const num = (x: number) => String(Number(x.toFixed(6)))

/** swscale flags of every colour conversion: exact rounding and full chroma interpolation. */
export const SCALE_FLAGS = 'bicubic+accurate_rnd+full_chroma_int'

/** A YCbCr matrix name as the `scale` filter's `in_color_matrix` takes it. */
export type ScaleMatrix = 'bt709' | 'bt601' | 'bt2020' | 'smpte240m' | 'fcc'

/**
 * The YCbCr matrix the source's pixels were encoded with, read from its `color_space` tag. HDR
 * sources leave the tone-map chain already in BT.709. An untagged (or unknown) source is guessed
 * the way players do: HD (shorter side ≥ 720 px, so 1280×720 and 720×1280 alike) is BT.709,
 * anything smaller BT.601.
 */
export function sourceMatrix(info: MediaInfo): ScaleMatrix {
  if (info.hdr) return 'bt709'
  switch (info.colorSpace) {
    case 'bt709':
      return 'bt709'
    case 'bt2020nc':
    case 'bt2020c':
      return 'bt2020'
    case 'smpte240m':
      return 'smpte240m'
    case 'fcc':
      return 'fcc'
    case 'smpte170m':
    case 'bt470bg':
      return 'bt601'
    default: // untagged, unknown
      return Math.min(info.w, info.h) >= 720 ? 'bt709' : 'bt601'
  }
}

/**
 * Frame colour properties of BT.709 limited range. ffmpeg 9 takes the stream tags from the filtered
 * frames, so output options alone (`-color_primaries` …) can be lost; `setparams` sets them on the
 * frames themselves.
 */
export const SET_BT709 = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv'

/** Tags of every working copy: BT.709 primaries, transfer and matrix, limited range. */
const BT709_TAGS = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv']

export interface IngestArgsOptions {
  src: string
  out: string
  info: MediaInfo
  fps: number
  /** How to tone-map when `info.hdr`; ignored for SDR. */
  hdrPath: HdrPath | null
}

/**
 * ffmpeg argv for one working copy. ffmpeg's default autorotate turns the picture upright before
 * `-vf`; `fps=` makes it constant frame rate (frame n at n/fps); HDR is tone-mapped to bt709;
 * `scale` keeps the long side ≤ 1920 and converts the source matrix (`sourceMatrix`) to BT.709
 * limited range; the copy is tagged BT.709. x264 CRF 16 with a 15-frame GOP (fast extraction of any
 * chunk); AAC 48 kHz stereo, or a silent track of the same length when the source has no audio.
 * The audio starts at t = 0 like the video (`aresample=async=1:first_pts=0` turns a late start
 * into leading silence) and ends with it (`apad` + `atrim`), so audio and frames stay in sync.
 */
export function buildIngestArgs(o: IngestArgsOptions): string[] {
  const { w, h } = workSize(o.info)
  const hdr = o.info.hdr
  if (hdr && !o.hdrPath) throw new Error('لا توجد طريقة لتحويل HDR — No HDR conversion path given')
  // The end of the video in the output timeline: a late-starting video is padded back to 0.
  const end = num(o.info.videoStartSec + o.info.durationSec)
  // Every copy ends in BT.709 limited range (converted from the source's matrix, tagged below), so
  // the frame server and the renderer convert from one known colour space.
  const scale = `scale=${w}:${h}:in_color_matrix=${sourceMatrix(o.info)}:out_color_matrix=bt709:out_range=tv:flags=${SCALE_FLAGS}`
  const vf = [`fps=${o.fps}`, ...(hdr ? [hdrChain(o.info, o.hdrPath!)] : []), scale, 'setsar=1', 'format=yuv420p', SET_BT709].join(',')
  return [
    '-v', 'error', '-nostdin', '-y', '-nostats', '-progress', 'pipe:1',
    '-i', o.src,
    ...(o.info.audioStream !== null ? [] : ['-f', 'lavfi', '-t', end, '-i', 'anullsrc=r=48000:cl=stereo']),
    '-map', '0:v:0',
    '-map', o.info.audioStream !== null ? `0:${o.info.audioStream}` : '1:a:0',
    '-vf', vf,
    '-af', `aresample=async=1:first_pts=0,apad,atrim=end=${end}`,
    '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-crf', '16', '-g', '15', '-pix_fmt', 'yuv420p',
    ...BT709_TAGS,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-f', 'mp4',
    o.out,
  ]
}

/**
 * ffmpeg argv for the working copy of an audio-only media: `work/<id>.wav`, 48 kHz stereo
 * `pcm_s16le`, starting at t = 0 (`first_pts=0` turns a late start into leading silence). The
 * container is forced (`-f wav`) because the output is a `.part` file.
 */
export function buildAudioIngestArgs(o: { input: string; out: string; audioStream: number }): string[] {
  return [
    '-v', 'error', '-nostdin', '-y', '-nostats', '-progress', 'pipe:1',
    '-i', o.input,
    '-vn',
    '-map', `0:${o.audioStream}`,
    '-af', 'aresample=async=1:first_pts=0',
    '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2',
    '-f', 'wav',
    o.out,
  ]
}

/** 'zscale' when `ffmpeg -filters` lists zscale and tonemap, else 'colorspace' if listed, else null. */
export function hdrPathFromFilters(listing: string): HdrPath | null {
  const has = (n: string) => new RegExp(`^\\s*\\S+\\s+${n}\\s`, 'm').test(listing)
  if (has('zscale') && has('tonemap')) return 'zscale'
  if (has('colorspace')) return 'colorspace'
  return null
}

const hdrPathCache = new Map<string, HdrPath | null>()

/**
 * Asks the local ffmpeg once (per binary) which HDR path it supports. A failed `ffmpeg -filters`
 * is reported (Arabic first) and not cached, so the next call asks again.
 */
export async function detectHdrPath(
  ffmpeg: string = resolveFfmpeg(),
  runner: (cmd: string, args: string[]) => Promise<RunResult> = run,
): Promise<HdrPath | null> {
  if (!hdrPathCache.has(ffmpeg)) {
    const r = await runner(ffmpeg, ['-hide_banner', '-filters'])
    if (r.error || r.code !== 0) throw new Error(`تعذّر سؤال ffmpeg عن مرشّحاته — ffmpeg -filters failed ${why(r)}`)
    hdrPathCache.set(ffmpeg, hdrPathFromFilters(r.stdout))
  }
  return hdrPathCache.get(ffmpeg)!
}

const fmtNum = (x: number) => String(Number(x.toFixed(2)))

/** The problems found in a source, one Arabic + English phrase each (empty when none). */
export function describeIssues(info: MediaInfo, fps: number): string[] {
  const out: string[] = []
  if (!info.hasVideo) return out
  if (info.rotation !== 0) out.push(`مُدار ${info.rotation}° — rotated ${info.rotation}°`)
  if (info.vfr) out.push('إطارات متغيرة — variable frame rate')
  if (info.hdr) {
    const kind = info.colorTransfer === 'smpte2084' ? 'PQ' : 'HLG'
    out.push(`HDR (${kind}) — نطاق ديناميكي عالٍ — high dynamic range`)
  }
  if (Math.abs(info.fps - fps) / fps > 0.01) out.push(`معدل الإطارات من ${fmtNum(info.fps)} إلى ${fps} — ${fmtNum(info.fps)} fps → ${fps}`)
  const { w, h } = workSize(info)
  const turned = info.rotation === 90 || info.rotation === 270
  if (Math.max(info.w, info.h) > WORK_MAX_SIDE) {
    const [dw, dh] = turned ? [info.h, info.w] : [info.w, info.h]
    out.push(`تصغير من ${dw}×${dh} إلى ${w}×${h} — resized ${dw}×${dh} → ${w}×${h}`)
  }
  if (!info.hasAudio) out.push('بلا صوت، أُضيف مسار صامت — no audio, a silent track was added')
  return out
}

/**
 * Version of the normalization recipe (filters, encoder settings, audio handling). Bump it when
 * any of them changes: copies made with another recipe count as stale and are redone.
 * 1: first version. 2: audio starts at 0 and ends with the video; audio stream selection.
 * 3: the audio ends where a late-starting video ends (videoStartSec + durationSec).
 * 4: every copy is converted to BT.709 limited range (untagged / BT.601 sources included) and tagged.
 * 5: untagged HD sources count as BT.709 (smaller ones as BT.601).
 * 6: audio-only media → WAV working copy (48 kHz stereo pcm_s16le).
 */
export const INGEST_RECIPE = 6

/** One record of `work/media.json`. */
export interface MediaRecord {
  id: string
  recipe: number
  source: string
  work: string
  /** sha1 of the source bytes; the copy is up to date while it matches. */
  sourceHash: string
  fps: number
  hdrPath: HdrPath | null
  info: MediaInfo
  workInfo: MediaInfo
}

interface MediaFile {
  version: 1
  media: MediaRecord[]
}

export interface IngestProgress {
  id: string
  /** 0-based position among the project's media. */
  index: number
  count: number
  /** Fraction of this media's encode, 0…1. */
  fraction: number
  phase: 'encoding' | 'done' | 'up-to-date'
}

export interface IngestOptions {
  onProgress?: (e: IngestProgress) => void
  /** Test hook only: force the HDR path instead of detecting it. */
  hdrPath?: HdrPath
}

export interface IngestResult {
  id: string
  source: string
  work: string
  status: 'ingested' | 'up-to-date'
  issues: string[]
  hdrPath: HdrPath | null
  info: MediaInfo
  workInfo: MediaInfo
}

/** sha1 of a file's bytes, streamed. Errors are Arabic first. */
export function sha1File(path: string): Promise<string> {
  return fsStep('تعذّر قراءة الملف', 'Could not read', path, () =>
    new Promise<string>((res, rej) => {
      const hash = createHash('sha1')
      createReadStream(path)
        .on('data', (d) => hash.update(d))
        .on('error', rej)
        .on('end', () => res(hash.digest('hex')))
    }),
  )
}

async function readMediaFile(path: string): Promise<MediaFile> {
  try {
    const j = JSON.parse(await readFile(path, 'utf8')) as Partial<MediaFile>
    if (Array.isArray(j.media)) return { version: 1, media: j.media.filter((m) => m && typeof m.id === 'string') }
  } catch {
    // Missing or unreadable: every copy counts as stale.
  }
  return { version: 1, media: [] }
}

const removeFile = (path: string) => fsStep('تعذّر حذف الملف', 'Could not remove', path, () => rm(path, { force: true }))

/** Removes `<name>.<pid>.tmp` leftovers of `writeFileAtomic` from a process that died mid-write. */
async function cleanAtomicTemps(dir: string, base: string): Promise<void> {
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const n of names) if (isAtomicTemp(n, base)) await removeFile(join(dir, n))
}

const round3 = (x: number) => Number(x.toFixed(3))
const fmtSec = (t: number): string => String(round3(t))

function hdrNote(path: HdrPath): string {
  return path === 'zscale'
    ? 'تحويل HDR إلى SDR عبر zscale — HDR to SDR via zscale tonemap'
    : 'تحويل HDR إلى SDR عبر colorspace (بديل تقريبي) — HDR to SDR via colorspace (fallback: zscale unavailable; approximate, no tone mapping)'
}

/**
 * Makes an up-to-date working copy `work/<id>.mp4` (`work/<id>.wav` for audio-only media) for every media of the project:
 * - refuses more than MAX_PROJECT_MEDIA_SEC of media in total (Arabic + English), before writing;
 * - a copy is up to date when `work/media.json` has the same sha1 of the source bytes, the same
 *   project fps and the same INGEST_RECIPE, and the file exists; those are left untouched;
 * - leftover `.part` / `.<pid>.tmp` files of an interrupted run are removed;
 * - otherwise ffmpeg writes `work/<id>.mp4.part`, which is renamed into place only when complete,
 *   so an interrupted ingest never leaves a half file that counts as done;
 * - records each copy in `work/media.json`, `mba-project.json` (`work`, `durationSec`; unknown keys
 *   kept) and `log.md` (including the HDR path used).
 * A run where everything is up to date writes nothing.
 */
export async function ingestProject(project: Project, o: IngestOptions = {}): Promise<IngestResult[]> {
  const fps = project.manifest.fps
  const media = project.manifest.media
  const mediaJsonPath = join(project.dir, 'work', 'media.json')

  const infos: MediaInfo[] = []
  for (const m of media) infos.push(await probeMedia(join(project.dir, m.source)))
  const total = infos.reduce((a, x) => a + x.durationSec, 0)
  if (total > MAX_PROJECT_MEDIA_SEC + 1e-9) {
    throw new Error(
      `مدة المواد ${fmtSec(total)} ث وتتجاوز الحد (${MAX_PROJECT_MEDIA_SEC} ث = 3 دقائق) — ` +
        `Total media length is ${fmtSec(total)} s, over the ${MAX_PROJECT_MEDIA_SEC} s (3 minute) limit of v1`,
    )
  }

  await cleanAtomicTemps(join(project.dir, 'work'), 'media.json')
  await cleanAtomicTemps(project.dir, PROJECT_MANIFEST)
  const db = await readMediaFile(mediaJsonPath)
  const results: IngestResult[] = []
  const manifestUpdates: { id: string; work: string; durationSec: number }[] = []
  let hdrPath: HdrPath | null | undefined = o.hdrPath

  for (const [index, m] of media.entries()) {
    const info = infos[index]!
    const srcPath = join(project.dir, m.source)
    const work = `work/${m.id}.${info.hasVideo ? 'mp4' : 'wav'}`
    const outPath = join(project.dir, work)
    const part = `${outPath}.part`
    const progress = (fraction: number, phase: IngestProgress['phase']) =>
      o.onProgress?.({ id: m.id, index, count: media.length, fraction, phase })
    const issues = describeIssues(info, fps)

    const sourceHash = await sha1File(srcPath)
    const rec = db.media.find((r) => r.id === m.id)
    if (existsSync(part)) await removeFile(part)

    if (rec && rec.recipe === INGEST_RECIPE && rec.sourceHash === sourceHash && rec.fps === fps && rec.work === work && existsSync(outPath)) {
      const dur = round3(rec.workInfo.frames > 0 ? rec.workInfo.frames / rec.workInfo.fps : rec.workInfo.durationSec)
      if (m.work !== work || m.durationSec !== dur) manifestUpdates.push({ id: m.id, work, durationSec: dur })
      results.push({ id: m.id, source: m.source, work, status: 'up-to-date', issues, hdrPath: rec.hdrPath, info, workInfo: rec.workInfo })
      progress(1, 'up-to-date')
      continue
    }

    let used: HdrPath | null = null
    if (info.hdr) {
      if (hdrPath === undefined) hdrPath = await detectHdrPath()
      if (!hdrPath) {
        throw new Error('لا يدعم ffmpeg المحلي تحويل HDR (zscale أو colorspace) — The local ffmpeg has neither zscale nor colorspace to convert HDR')
      }
      used = hdrPath
    }

    progress(0, 'encoding')
    const dur = info.durationSec
    const args = info.hasVideo
      ? buildIngestArgs({ src: srcPath, out: part, info, fps, hdrPath: used })
      : buildAudioIngestArgs({ input: srcPath, out: part, audioStream: info.audioStream! })
    const r = await run(resolveFfmpeg(), args, (line) => {
      const mm = /^out_time_us=(\d+)/.exec(line)
      if (mm && dur > 0) progress(Math.min(1, Number(mm[1]) / 1e6 / dur), 'encoding')
    })
    if (r.error || r.code !== 0) {
      await rm(part, { force: true }).catch(() => {})
      throw new Error(`تعذّر تجهيز نسخة العمل — ffmpeg could not make the working copy of ${m.id} (${m.source}) ${why(r)}`)
    }
    const workInfo = await probeMedia(part).catch(async (e: Error) => {
      await rm(part, { force: true }).catch(() => {})
      throw e
    })
    // On failure the .part stays; the next run removes it and starts over.
    await renameWithRetry(part, outPath)

    const record: MediaRecord = { id: m.id, recipe: INGEST_RECIPE, source: m.source, work, sourceHash, fps, hdrPath: used, info, workInfo }
    db.media = [...db.media.filter((x) => x.id !== m.id), record].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    await writeFileAtomic(mediaJsonPath, JSON.stringify(db, null, 2) + '\n')

    const workDur = round3(workInfo.frames > 0 ? workInfo.frames / workInfo.fps : workInfo.durationSec)
    manifestUpdates.push({ id: m.id, work, durationSec: workDur })
    const notes = [...issues.filter((x) => !x.startsWith('HDR')), ...(used ? [hdrNote(used)] : [])]
    await appendLog(project, {
      action: 'ingest',
      details:
        `${m.id}: ${m.source} → ${work} (${info.hasVideo ? `${workInfo.w}×${workInfo.h}, ${fps} fps` : 'wav 48 kHz'}, ${fmtSec(workDur)} s)` +
        (notes.length ? ` — ${notes.join('; ')}` : ''),
    })
    results.push({ id: m.id, source: m.source, work, status: 'ingested', issues, hdrPath: used, info, workInfo })
    progress(1, 'done')
  }

  await recordWorkingCopies(project, manifestUpdates)
  return results
}
