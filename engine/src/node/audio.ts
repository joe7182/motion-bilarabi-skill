import { spawn } from 'node:child_process'
import { open, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Project } from '../core/project'
import { storyboardDuration, type AudioKind, type SfxName, type Storyboard } from '../core/storyboard'
import { frameCount } from '../core/clock'
import { videoParams } from '../core/params/video'
import { resolveFfmpeg } from './tools'
import { sfxKey } from './sfx-synth'

/**
 * The render's sound (spec §13.5, §17.5, §17.9): every `audio[]` clip of the storyboard (voice,
 * music, SFX) plus the media audio of every `video` scene (on the voice bus), mixed by ffmpeg:
 *
 *   clip  → trim, tempo, fades, gain (+ source level), delay to its start
 *   buses → voice, music (ducked under the voice bus), sfx
 *   mix   → amix normalize=0 → alimiter 0.89 → two-pass loudnorm −14 LUFS / −1.5 dBTP target (linear;
 *           verify's limit is −1 dBTP)
 *
 * Pass 1 writes the pre-normalized mix (32-bit float WAV) and measures it in the same run; pass 2
 * applies the measured values to that WAV. Working copies start their audio at t = 0 (ingest).
 */

export const AUDIO_RATE = 48000
/** Shortest fade at both ends of every voice/music piece (s): a hard cut in a waveform clicks. */
export const AUDIO_FADE_SEC = 0.008
/** Peak limit after the mix, before loudness normalization (≈ −1 dBFS). */
export const MIX_LIMIT = 0.89
/** Loudness target of the final mix: integrated LUFS, true peak dBTP, loudness range LU. */
export const LOUDNESS = { i: -14, tp: -1, lra: 11 } as const

/**
 * True-peak target loudnorm is given (dBTP). Lower than the LOUDNESS.tp limit `mba verify`
 * checks: pass 2 with `linear=true` plus resampling and AAC encoding overshot −1 by ~0.1 dB on a
 * real render (−0.9 dBTP), so the mix aims 0.5 dB under the limit.
 */
export const LOUDNORM_TP = -1.5
/**
 * Fix wave I1: `loudnorm … linear=true` silently falls back to dynamic mode when the measured
 * true peak plus its gain would pass LOUDNORM_TP, and dynamic mode shifts the timestamps (a real
 * track came out 3200 samples short and the mux dropped 3 frames). When the measured peak leaves
 * less room than that, pass 2 first limits the mix this far (dB) under the highest peak linear mode
 * accepts (a sample-peak limiter; the margin covers the inter-sample overshoot).
 */
export const PASS2_TP_MARGIN = 0.5
/** alimiter's lowest limit (0.0625 ≈ −24.1 dBFS). */
const ALIMITER_MIN_DB = -24
/**
 * Every media source is first brought to this integrated loudness, so clip gains are relative
 * (voice 0 dB, SFX −14 dB, music −21 dB) whatever level the user recorded at, and the ducking key
 * (the voice bus) always sits at the same level.
 */
export const SOURCE_REF_LUFS = -14
/** Largest level boost of a quiet source (dB): beyond it, it is mostly noise. */
export const MAX_SOURCE_BOOST = 24
/** At or below this, a source or mix counts as silent (ebur128 reports silence as −70 LUFS). */
export const SILENT_LUFS = -70
/**
 * Music ducking under the voice (`sidechaincompress`, keyed by the voice bus). With the voice at
 * SOURCE_REF_LUFS, `levelSc` puts the key ≈ 14 dB over the threshold: ≈ −12 dB on the music while
 * someone speaks.
 */
export const DUCK = { threshold: 0.02, ratio: 8, attack: 20, release: 300, levelSc: 0.5 } as const

export type Bus = AudioKind

/** A clip ready to mix: absolute input, timeline placement and final gain. */
export interface ResolvedClip {
  /** The storyboard clip id (`scene:<id>` for a video scene's audio). */
  id: string
  bus: Bus
  /** Absolute path of the input file (working copy or synthesized WAV). */
  input: string
  /** Source offset (s). */
  in: number
  /** Timeline length (s). */
  duration: number
  /** Playback speed (video scenes; 1 for audio clips): `duration·speed` s of source are used. */
  speed: number
  /** Timeline start (s). */
  at: number
  /** dB: the clip gain plus its source level correction. */
  gain: number
  fadeIn: number
  fadeOut: number
  /** Music only (R4): volume steps, timeline seconds. */
  dips?: { at: number; duration: number; db: number }[]
}

/** loudnorm's pass-1 measurement (`input_*`, `target_offset`). */
export interface LoudnormMeasure {
  i: number
  tp: number
  lra: number
  thresh: number
  offset: number
}

/** `atempo` factors (each within 0.5..2, the filter's range) whose product is `speed`; [] at 1. */
export function atempoChain(speed: number): number[] {
  const out: number[] = []
  let s = speed
  while (s > 2 + 1e-12) {
    out.push(2)
    s /= 2
  }
  while (s < 0.5 - 1e-12) {
    out.push(0.5)
    s /= 0.5
  }
  if (Math.abs(s - 1) > 1e-12) out.push(Number(s.toFixed(9)))
  return out
}

/**
 * Timeline length of a clip whose source has `srcLen` s left after `in`: its `duration`, or by
 * default the rest of the source (music: up to the storyboard end); never longer than the source,
 * never past `total`. 0: the clip is not heard.
 */
export function clipSpan(c: { kind: AudioKind; at: number; in: number; duration?: number }, srcLen: number, total: number): number {
  const want = c.duration ?? srcLen
  return Math.max(0, Math.min(want, srcLen, total - c.at))
}

/** dB that brings a source measured at `i` LUFS to SOURCE_REF_LUFS (boost capped; silence: 0). */
export function sourceGain(i: number): number {
  if (!(i > SILENT_LUFS)) return 0
  return Math.min(SOURCE_REF_LUFS - i, MAX_SOURCE_BOOST)
}

/**
 * `JobHashInput.audio`: every clip input and its hash, in storyboard order: `audio[]` clips (the
 * source sha1 of their media, or `sfx:<sfxKey>` for a built-in effect), then `video` scenes.
 */
export function audioHashInputs(sb: Storyboard, records: readonly { id: string; sourceHash: string }[]): { id: string; hash: string }[] {
  const hashOf = (media: string) => records.find((r) => r.id === media)?.sourceHash ?? `missing:${media}`
  const out = (sb.audio ?? []).map((c) => ({ id: c.id, hash: c.sfx !== undefined ? `sfx:${sfxKey(c.sfx, c.variant ?? 0, c.duration)}` : hashOf(c.media!) }))
  for (const sc of sb.scenes) {
    if (sc.type === 'video' && !videoParams.parse(sc.params).muted) out.push({ id: `scene:${sc.id}`, hash: hashOf(videoParams.parse(sc.params).media) })
  }
  return out
}

const num = (x: number) => String(Number(x.toFixed(6)))

const BUSES: readonly Bus[] = ['voice', 'music', 'sfx']

/** Samples (per channel) of `total` s at AUDIO_RATE: the track's exact length. */
export const trackSamples = (total: number): number => Math.round(total * AUDIO_RATE)

/**
 * Pass 2's plan (I1): the gain linear mode applies (target − measured integrated loudness) and,
 * when the measured true peak plus that gain would pass LOUDNORM_TP (loudnorm would fall back to
 * dynamic mode), a peak limit `limitDb` (dBFS) PASS2_TP_MARGIN under that room; loudnorm is then
 * told a peak (`measuredTp`) just inside the room.
 */
export function pass2Plan(m: LoudnormMeasure): { gain: number; measuredTp: number; limitDb?: number; lra: number; measuredLra: number } {
  const gain = LOUDNESS.i - m.i
  const room = LOUDNORM_TP - gain
  // Linear mode also needs the target LRA ≥ the measured one, and reads a measured LRA of 0 as
  // "not given" (both fall back to dynamic); in linear mode the target LRA changes nothing else.
  const measuredLra = Math.max(m.lra, 0.1)
  const lra = Math.min(50, Math.max(LOUDNESS.lra, Math.ceil(measuredLra + 1)))
  if (m.tp <= room - 0.05) return { gain, measuredTp: m.tp, lra, measuredLra }
  const limitDb = Math.max(ALIMITER_MIN_DB, room - PASS2_TP_MARGIN)
  return { gain, measuredTp: Math.min(m.tp, room - 0.05), limitDb, lra, measuredLra }
}

/**
 * The loudnorm filter: measuring (pass 1) or applying `m` linearly (pass 2, after the I1 peak limit
 * when `pass2Plan` needs one). Both print their JSON (pass 2: its `normalization_type`).
 */
function loudnormFilter(m?: LoudnormMeasure): string {
  if (!m) return `loudnorm=I=${LOUDNESS.i}:TP=${LOUDNORM_TP}:LRA=${LOUDNESS.lra}:print_format=json`
  const plan = pass2Plan(m)
  const limit = plan.limitDb !== undefined ? `alimiter=limit=${num(10 ** (plan.limitDb / 20))}:level=false:latency=true,` : ''
  return (
    `${limit}loudnorm=I=${LOUDNESS.i}:TP=${LOUDNORM_TP}:LRA=${plan.lra}:measured_I=${num(m.i)}:measured_TP=${num(plan.measuredTp)}:measured_LRA=${num(plan.measuredLra)}:` +
    `measured_thresh=${num(m.thresh)}:offset=${num(m.offset)}:linear=true:print_format=json`
  )
}

/** Padded and cut to exactly `total` s by sample count, timestamps re-counted from the samples (I1). */
function exactSamples(total: number): string {
  const n = trackSamples(total)
  return `asetpts=N/SR/TB,apad=whole_len=${n},atrim=end_sample=${n}`
}

/**
 * ffmpeg argv of the mix (48 kHz stereo WAV, exactly `total` s):
 * - per clip: `atrim` from `in` (`duration·speed` s), `atempo` when speed ≠ 1, padded/cut to its
 *   timeline length, `afade` in and out (voice and music at least AUDIO_FADE_SEC, at most half the
 *   clip), `volume` (its gain, when not 0 dB), `adelay` (in samples) to `at`;
 * - per bus (voice, music, sfx): the clips summed (`amix normalize=0`) over a silent base of the
 *   total length; music is ducked by `sidechaincompress` keyed by the voice bus (DUCK);
 * - the buses summed (`amix normalize=0`), peak-limited to MIX_LIMIT (`alimiter`, its lookahead
 *   compensated so the audio stays in sync);
 * - without `loudnorm` (pass 1): the mix is written as 32-bit float and measured by `loudnorm
 *   print_format=json` (on stderr, see `parseLoudnormJson`); with it (pass 2 in one graph): the
 *   measured values are applied linearly and the result written as 16-bit PCM.
 * One `-i` per distinct input (split when several clips use it). No clip: silence, no loudnorm.
 */
export function buildMixArgs(o: { clips: readonly ResolvedClip[]; total: number; out: string; loudnorm?: LoudnormMeasure }): string[] {
  const { clips, total } = o
  const inputs: string[] = []
  const uses = new Map<string, number[]>()
  for (const [j, c] of clips.entries()) {
    if (!uses.has(c.input)) {
      uses.set(c.input, [])
      inputs.push(c.input)
    }
    uses.get(c.input)!.push(j)
  }
  const graph: string[] = []
  const label = new Map<number, string>()
  for (const [k, input] of inputs.entries()) {
    const js = uses.get(input)!
    if (js.length === 1) label.set(js[0]!, `${k}:a`)
    else {
      graph.push(`[${k}:a]asplit=${js.length}${js.map((_, i) => `[s${k}_${i}]`).join('')}`)
      js.forEach((j, i) => label.set(j, `s${k}_${i}`))
    }
  }
  for (const [j, c] of clips.entries()) {
    const minFade = c.bus === 'sfx' ? 0 : AUDIO_FADE_SEC
    const fadeIn = Math.min(Math.max(c.fadeIn, minFade), c.duration / 2)
    const fadeOut = Math.min(Math.max(c.fadeOut, minFade), c.duration / 2)
    const f = [
      `atrim=start=${num(c.in)}:duration=${num(c.duration * c.speed)}`,
      'asetpts=PTS-STARTPTS',
      `aresample=${AUDIO_RATE}`,
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      ...atempoChain(c.speed).map((x) => `atempo=${x}`),
      'apad',
      `atrim=duration=${num(c.duration)}`,
      ...(fadeIn > 0 ? [`afade=t=in:d=${num(fadeIn)}`] : []),
      ...(fadeOut > 0 ? [`afade=t=out:st=${num(c.duration - fadeOut)}:d=${num(fadeOut)}`] : []),
      ...(c.gain !== 0 ? [`volume=${num(c.gain)}dB`] : []),
      ...(c.dips ?? []).map((d) => `volume=${num(d.db)}dB:enable='between(t,${num(d.at - c.at)},${num(d.at - c.at + d.duration)})'`),
      `adelay=delays=${Math.round(c.at * AUDIO_RATE)}S:all=1`,
    ]
    graph.push(`[${label.get(j)}]${f.join(',')}[p${j}]`)
  }
  const pass1 = o.loudnorm === undefined
  const silence = `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${num(total)}`
  if (clips.length === 0) {
    graph.push(`${silence}[out]`)
  } else {
    const buses = BUSES.filter((b) => clips.some((c) => c.bus === b))
    for (const b of buses) {
      const js = [...clips.keys()].filter((j) => clips[j]!.bus === b)
      graph.push(`${silence}[base_${b}]`)
      graph.push(`[base_${b}]${js.map((j) => `[p${j}]`).join('')}amix=inputs=${js.length + 1}:normalize=0:duration=first:dropout_transition=0[${b}]`)
    }
    const mixIn = buses.map((b) => `[${b}]`)
    if (buses.includes('voice') && buses.includes('music')) {
      graph.push('[voice]asplit=2[voicemix][vkey]')
      graph.push(
        `[music][vkey]sidechaincompress=threshold=${DUCK.threshold}:ratio=${DUCK.ratio}:attack=${DUCK.attack}:release=${DUCK.release}:level_sc=${DUCK.levelSc}[musicduck]`,
      )
      mixIn[buses.indexOf('voice')] = '[voicemix]'
      mixIn[buses.indexOf('music')] = '[musicduck]'
    }
    const mix =
      `${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:duration=first:dropout_transition=0,` +
      // Cut by time here: sample-count trims (`apad=whole_len`, `atrim=end_sample`) on this graph
      // stopped the mix at 3.5 s of 14 when one input feeds two delayed clips (ffmpeg 9). The exact
      // sample count is enforced in pass 2, on the plain WAV.
      `alimiter=limit=${MIX_LIMIT}:level=false:latency=true,atrim=duration=${num(total)}`
    if (pass1) {
      graph.push(`${mix},asplit=2[out][measure]`)
      graph.push(`[measure]${loudnormFilter()},anullsink`)
    } else {
      graph.push(`${mix},${loudnormFilter(o.loudnorm)},aresample=${AUDIO_RATE},${exactSamples(total)}[out]`)
    }
  }
  return [
    // Info level: loudnorm prints its measurement (pass 1) or its mode (pass 2) there.
    ...(clips.length ? ['-hide_banner', '-nostats', '-v', 'info'] : ['-v', 'error']),
    '-nostdin', '-y',
    ...inputs.flatMap((i) => ['-i', i]),
    '-filter_complex', graph.join(';'),
    '-map', '[out]',
    '-c:a', pass1 ? 'pcm_f32le' : 'pcm_s16le', '-ar', String(AUDIO_RATE), '-ac', '2',
    '-f', 'wav',
    o.out,
  ]
}

/**
 * Pass 2 on the pre-normalized mix WAV: `loudnorm` with the pass-1 measurement, linear (one gain
 * for the whole track; peak-limited first when `pass2Plan` says so), back to 48 kHz 16-bit PCM,
 * exactly `total` s by sample count (I1). Info level: loudnorm prints its `normalization_type`
 * (`parseNormalizationType`). `loudnorm: null` (a silent mix, nothing to normalize): only converted.
 */
export function buildLoudnormArgs(o: { input: string; out: string; total: number; loudnorm: LoudnormMeasure | null }): string[] {
  const af = o.loudnorm ? `${loudnormFilter(o.loudnorm)},aresample=${AUDIO_RATE},${exactSamples(o.total)}` : exactSamples(o.total)
  const log = o.loudnorm ? ['-hide_banner', '-nostats', '-v', 'info'] : ['-v', 'error']
  return [...log, '-nostdin', '-y', '-i', o.input, '-af', af, '-c:a', 'pcm_s16le', '-ar', String(AUDIO_RATE), '-ac', '2', '-f', 'wav', o.out]
}

/** `normalization_type` of the last loudnorm JSON block in ffmpeg's stderr (`linear` / `dynamic`). */
export function parseNormalizationType(stderr: string): string | undefined {
  const all = [...stderr.matchAll(/"normalization_type"\s*:\s*"([a-z]+)"/gi)]
  return all.at(-1)?.[1]?.toLowerCase()
}

/** A loudnorm value: a number, or ±inf for silence. */
function lnNumber(v: unknown): number {
  const s = String(v).trim()
  if (/^-inf/i.test(s)) return -Infinity
  if (/^\+?inf/i.test(s)) return Infinity
  return Number(s)
}

/** The measurement of the last `loudnorm … print_format=json` block in ffmpeg's stderr. */
export function parseLoudnormJson(stderr: string): LoudnormMeasure {
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  let j: Record<string, unknown> | undefined
  if (start >= 0 && end > start) {
    try {
      j = JSON.parse(stderr.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      j = undefined
    }
  }
  if (!j || j.input_i === undefined) {
    throw new Error(`تعذّر قياس مستوى الصوت — ffmpeg loudnorm printed no measurement: ${stderr.trim().slice(-500)}`)
  }
  return { i: lnNumber(j.input_i), tp: lnNumber(j.input_tp), lra: lnNumber(j.input_lra), thresh: lnNumber(j.input_thresh), offset: lnNumber(j.target_offset) }
}

/** Integrated loudness (LUFS) and true peak (dBTP) of an `ebur128=peak=true` summary. */
export function parseEbur128(stderr: string): { i: number; tp: number } {
  const s = stderr.slice(stderr.lastIndexOf('Summary:'))
  const i = /\bI:\s*(-?inf|-?[\d.]+)\s*LUFS/i.exec(s)
  const tp = /True peak:\s*Peak:\s*(-?inf|-?[\d.]+)\s*dBFS/i.exec(s)
  if (!i || !tp) throw new Error(`تعذّر قياس مستوى الصوت — ebur128 printed no summary: ${stderr.trim().slice(-500)}`)
  return { i: lnNumber(i[1]), tp: lnNumber(tp[1]) }
}

/** Runs ffmpeg (argv, no shell); throws Arabic first with the stderr tail. Returns stderr (tail). */
async function ffmpeg(args: string[], ar: string, en: string): Promise<string> {
  const r = await new Promise<{ code: number | null; stderr: string; error?: Error }>((res) => {
    const proc = spawn(resolveFfmpeg(), args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => (stderr = (stderr + d).slice(-20000)))
    proc.once('error', (error) => res({ code: null, stderr, error }))
    proc.once('close', (code) => res({ code, stderr }))
  })
  if (r.error || r.code !== 0) {
    throw new Error(`${ar} — ${en} (${r.error ? r.error.message : `exit code ${r.code}`}): ${r.stderr.trim().slice(-1500)}`)
  }
  return r.stderr
}

/**
 * Sources shorter than this are padded with silence to it before measuring: ebur128 gates on
 * 400 ms blocks, so a one-shot effect (a click, a tap) would otherwise read as silence and never
 * be levelled. User SFX and synth SFX go through the same measurement.
 */
export const MEASURE_MIN_SEC = 0.4

/** Integrated loudness (LUFS) and true peak (dBTP) of a file's audio (`ebur128`). */
export async function measureLoudness(file: string): Promise<{ i: number; tp: number }> {
  const abs = resolve(file)
  const stderr = await ffmpeg(
    ['-hide_banner', '-nostats', '-nostdin', '-i', abs, '-vn', '-sn', '-dn', '-af', `apad=whole_dur=${MEASURE_MIN_SEC},ebur128=peak=true:framelog=quiet`, '-f', 'null', '-'],
    'تعذّر قياس مستوى الصوت',
    `ffmpeg could not measure the loudness of ${abs}`,
  )
  return parseEbur128(stderr)
}

/** `mba verify` loudness check: I within −14 ± 1 LUFS and true peak ≤ −1 dBTP. */
export function loudnessVerdict(m: { i: number; tp: number }): { ok: boolean; message: string } {
  const ok = Math.abs(m.i - LOUDNESS.i) <= 1 && m.tp <= LOUDNESS.tp
  const values = `I = ${m.i.toFixed(1)} LUFS, TP = ${m.tp.toFixed(1)} dBTP`
  return ok
    ? { ok, message: `مستوى الصوت سليم — Loudness: OK — ${values}` }
    : { ok, message: `مستوى الصوت خارج الحد (−14 ± 1 LUFS، الذروة ≤ −1 dBTP) — Loudness: FAILED — ${values} (target −14 ± 1 LUFS, true peak ≤ −1 dBTP)` }
}

export interface ResolveAudioOptions {
  /**
   * Built-in effect → its synthesized WAV (absolute path) and length (s): `sfxWav` of
   * `node/sfx-synth.ts`. Without it a storyboard with `sfx` clips is refused.
   */
  synth?: (name: SfxName, variant: number, lengthSec?: number) => Promise<{ path: string; durationSec: number }>
}

/**
 * The clips of a project storyboard, ready to mix (`total` s long): every `audio[]` clip, then the
 * media audio of every `video` scene (voice bus, gain 0). Media inputs are working copies; each
 * source is measured once and its level corrected to SOURCE_REF_LUFS (`sourceGain`). Clips that
 * start at or after `total` are dropped. Load-time checks (`loadStoryboardFile`) have already
 * verified the media ids and working copies.
 */
export async function resolveAudioClips(project: Project, sb: Storyboard, total: number, o: ResolveAudioOptions = {}): Promise<ResolvedClip[]> {
  const level = new Map<string, number>()
  const levelOf = async (input: string): Promise<number> => {
    if (!level.has(input)) level.set(input, sourceGain((await measureLoudness(input)).i))
    return level.get(input)!
  }
  const workOf = (id: string): { input: string; durationSec: number } => {
    const m = project.manifest.media.find((x) => x.id === id)
    if (!m?.work || m.durationSec === undefined) {
      throw new Error(`لا توجد نسخة عمل للمادة ${id}؛ شغّل mba ingest — Media ${id} has no working copy; run mba ingest`)
    }
    return { input: join(project.dir, m.work), durationSec: m.durationSec }
  }
  const out: ResolvedClip[] = []
  for (const c of sb.audio ?? []) {
    let input: string
    let srcLen: number
    let gain = c.gain
    if (c.sfx !== undefined) {
      if (!o.synth) {
        throw new Error(`المؤثرات المدمجة غير متاحة بعد (${c.id}: ${c.sfx}) — Built-in sound effects are not available yet (${c.id}: ${c.sfx})`)
      }
      const s = await o.synth(c.sfx, c.variant ?? 0, c.duration)
      input = s.path
      srcLen = s.durationSec - c.in
      // Levelled like user SFX (R12): every effect starts from the same reference loudness.
      gain += await levelOf(input)
    } else {
      const w = workOf(c.media!)
      input = w.input
      srcLen = w.durationSec - c.in
      gain += await levelOf(input)
    }
    let at = c.at
    let inSec = c.in
    if (c.align === 'end' && c.duration !== undefined) {
      // End-aligned (planned risers): play the source's last min(L, d) s, ending at at + d.
      const L = srcLen + c.in
      inSec = Math.max(0, L - c.duration)
      at = c.at + c.duration - Math.min(L, c.duration)
      srcLen = L - inSec
    }
    const duration = clipSpan({ ...c, at, in: inSec }, srcLen, total)
    if (!(duration > 0)) continue
    out.push({ id: c.id, bus: c.kind, input, in: inSec, duration, speed: 1, at, gain, fadeIn: c.fadeIn, fadeOut: c.fadeOut, ...(c.dips?.length ? { dips: c.dips } : {}) })
  }
  for (const sc of sb.scenes) {
    if (sc.type !== 'video' || sc.start >= total) continue
    const p = videoParams.parse(sc.params)
    if (p.muted) continue
    const { input } = workOf(p.media)
    out.push({
      id: `scene:${sc.id}`, bus: 'voice', input, in: p.in, duration: Math.min(sc.duration, total - sc.start), speed: p.speed,
      at: sc.start, gain: await levelOf(input), fadeIn: 0, fadeOut: 0,
    })
  }
  return out
}

/** What `mixAudio` / `buildAudioTrack` did: loudnorm's pass-2 mode and Arabic-first warnings. */
export interface AudioTrackResult {
  /** `none`: a silent mix (only converted). */
  normalization: 'linear' | 'dynamic' | 'none'
  warnings: string[]
}

/**
 * Mixes resolved clips into `outWav` (exactly `total` s): pass 1 into `mix.wav` next to it, measured
 * in the same run; pass 2 normalizes that WAV (`buildLoudnormArgs`). A pass 2 that loudnorm still
 * ran in dynamic mode is reported in `warnings` (the length stays exact; the level is approximate).
 */
export async function mixAudio(clips: readonly ResolvedClip[], total: number, outWav: string): Promise<AudioTrackResult> {
  const mix = join(dirname(outWav), 'mix.wav')
  const err = ['تعذّر بناء مسار الصوت', 'ffmpeg could not build the audio track'] as const
  try {
    const stderr = await ffmpeg(buildMixArgs({ clips, total, out: mix }), ...err)
    // R28: a pass-1 mix that stopped early (the mid-wave `asplit` regression: 3.5 s of 14) must
    // never reach pass 2, where apad would silently fill the rest.
    assertMixLength(wavSampleCount(await readHead(mix)), total)
    let m: LoudnormMeasure | null = clips.length ? parseLoudnormJson(stderr) : null
    if (m && !(m.i > SILENT_LUFS)) m = null
    const log = await ffmpeg(buildLoudnormArgs({ input: mix, out: outWav, total, loudnorm: m }), 'تعذّر توحيد مستوى الصوت', 'ffmpeg could not normalize the loudness')
    if (!m) return { normalization: 'none', warnings: [] }
    const type = parseNormalizationType(log)
    if (type === 'linear') return { normalization: 'linear', warnings: [] }
    return {
      normalization: 'dynamic',
      warnings: [
        `وحّد ffmpeg مستوى الصوت بالوضع الديناميكي لا الخطي، فقد يختلف المستوى قليلًا — loudnorm ran in ${type ?? 'an unknown'} mode instead of linear ` +
          `(measured I ${num(m.i)} LUFS, TP ${num(m.tp)} dBTP): the track length is still exact; check the loudness with mba verify`,
      ],
    }
  } finally {
    await rm(mix, { force: true }).catch(() => {})
  }
}

/**
 * Writes the render's audio track to `outWav` (`total` s, default: `frames / fps` of the render):
 * the storyboard's clips (`resolveAudioClips`) mixed and normalized to LOUDNESS (`mixAudio`).
 */
export async function buildAudioTrack(project: Project, sb: Storyboard, outWav: string, total?: number, o: ResolveAudioOptions = {}): Promise<AudioTrackResult> {
  const len = total ?? frameCount(storyboardDuration(sb), sb.fps) / sb.fps
  const clips = await resolveAudioClips(project, sb, len, o)
  return mixAudio(clips, len, outWav)
}

/** The first 64 KiB of a file (enough for a WAV header and its info chunks). */
async function readHead(path: string): Promise<Buffer> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(65536)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/**
 * R28: the sample count (frames per channel) of a WAV from its header: the `fmt ` chunk's block
 * align and the `data` chunk's size, skipping other chunks (`LIST`). Throws (Arabic first) when
 * the bytes are not a RIFF/WAVE file with both chunks.
 */
export function wavSampleCount(head: Buffer): number {
  const bad = (en: string) => new Error(`ملف WAV غير صالح — not a WAV file: ${en}`)
  if (head.length < 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') throw bad('no RIFF/WAVE header')
  let blockAlign: number | undefined
  let p = 12
  while (p + 8 <= head.length) {
    const id = head.toString('latin1', p, p + 4)
    const size = head.readUInt32LE(p + 4)
    if (id === 'fmt ') blockAlign = head.readUInt16LE(p + 8 + 12)
    if (id === 'data') {
      if (blockAlign === undefined || blockAlign === 0) throw bad('data before fmt')
      return Math.floor(size / blockAlign)
    }
    p += 8 + size + (size % 2)
  }
  throw bad('no data chunk in the header')
}

/** Samples a pass-1 mix may fall short of the track by (1 ms at AUDIO_RATE): float rounding of the graph, never a cut. */
export const MIX_SHORT_TOLERANCE = Math.round(AUDIO_RATE / 1000)

/** R28: refuses a mix shorter than the track by more than MIX_SHORT_TOLERANCE samples, Arabic first. */
export function assertMixLength(samples: number, total: number): void {
  const want = trackSamples(total)
  if (samples >= want - MIX_SHORT_TOLERANCE) return
  throw new Error(
    `توقّف مزج الصوت قبل نهاية الفيديو (${samples} من ${want} عيّنة)؛ لم يُكتب المسار — the audio mix stopped early: ${samples} of ${want} samples ` +
      `(${(samples / AUDIO_RATE).toFixed(2)} of ${total.toFixed(2)} s); the track was not written. This is an engine bug: report it with the storyboard`,
  )
}

/** Runs ffmpeg (argv, no shell) and returns its stdout; throws Arabic first with the stderr tail. */
async function ffmpegStdout(args: string[], ar: string, en: string): Promise<Buffer> {
  const r = await new Promise<{ code: number | null; stdout: Buffer; stderr: string; error?: Error }>((res) => {
    const proc = spawn(resolveFfmpeg(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const chunks: Buffer[] = []
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => chunks.push(d))
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => (stderr = (stderr + d).slice(-20000)))
    proc.once('error', (error) => res({ code: null, stdout: Buffer.concat(chunks), stderr, error }))
    proc.once('close', (code) => res({ code, stdout: Buffer.concat(chunks), stderr }))
  })
  if (r.error || r.code !== 0) {
    throw new Error(`${ar} — ${en} (${r.error ? r.error.message : `exit code ${r.code}`}): ${r.stderr.trim().slice(-1500)}`)
  }
  return r.stdout
}

/** Sample rate `voiceLevels` decodes at (plenty for a loudness envelope). */
export const LEVELS_RATE = 16000

/**
 * Task 6b: the voice's level per video frame over [from, to) of `wavPath` (s, file time): the RMS
 * of each 1/fps window of the mono mix, normalised by the span's 95th percentile and clamped to
 * 0..1 (all silence → zeros). `round((to − from) · fps)` values; the microphone's bars and the
 * timeline's waveform read them as a morph-object state's `levels`. A file shorter than `to`
 * reads as silence past its end.
 */
export async function voiceLevels(wavPath: string, from: number, to: number, fps = 30): Promise<number[]> {
  if (!(from >= 0) || !(to > from) || !(fps > 0)) {
    throw new Error(`مدة مستويات الصوت غير صالحة — voiceLevels needs 0 ≤ from < to and fps > 0 (got from ${from}, to ${to}, fps ${fps})`)
  }
  const abs = resolve(wavPath)
  const raw = await ffmpegStdout(
    ['-hide_banner', '-nostats', '-nostdin', '-i', abs, '-vn', '-sn', '-dn', '-ac', '1', '-af', `atrim=start=${from}:end=${to}`, '-ar', String(LEVELS_RATE), '-f', 'f32le', '-'],
    'تعذّر قراءة مستويات الصوت',
    `ffmpeg could not read the voice levels of ${abs}`,
  )
  // read little-endian floats directly: the buffer may sit at an unaligned offset of a pooled slab
  const count = Math.floor(raw.length / 4)
  const n = Math.round((to - from) * fps)
  const rms: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.round((i * LEVELS_RATE) / fps)
    const b = Math.round(((i + 1) * LEVELS_RATE) / fps)
    let sum = 0
    for (let j = a; j < b; j++) {
      const v = j < count ? raw.readFloatLE(j * 4) : 0
      sum += v * v
    }
    rms.push(b > a ? Math.sqrt(sum / (b - a)) : 0)
  }
  const sorted = [...rms].sort((x, y) => x - y)
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0
  if (!(p95 > 1e-6)) return rms.map(() => 0)
  return rms.map((v) => Math.min(1, v / p95))
}
