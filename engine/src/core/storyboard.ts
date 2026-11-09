import { z } from 'zod'
import { FORMATS, type Format } from './types'
import { brandSchema, formatPath, type Brand } from './brand'
import { defaultTransitionDuration, TRANSITION_DURATION, TRANSITION_IDS, TRANSITION_PARAMS, type TransitionId } from './params/transitions'
import { CAMERA, type CameraSpec } from './camera'

export type { TransitionId }

/** Every look, in schema order (the storyboard `look` enum and the explain brief use it). */
export const LOOK_IDS = ['dark-tech', 'light-editorial', 'paper-editorial', 'signature', 'swiss-red'] as const
export type LookId = (typeof LOOK_IDS)[number]

/**
 * Times (`start`, `duration`, transition `at`, …) are numbers of seconds here. In a storyboard file
 * they may be word or pause anchors (`core/anchors.ts`); `loadStoryboardFile` resolves those to
 * seconds before parsing, so the page and every parsed storyboard only ever see numbers.
 */
export interface SceneSpec {
  id: string
  type: string
  start: number
  duration: number
  /**
   * Seconds, 0 ≤ preroll ≤ min(1, duration), default 0 (always set after parsing). The scene is still
   * visible only over [start, start + duration), but its primitive is built for a scene of length
   * `duration + preroll` and evaluated at local time `(t − start) + preroll`: the first `preroll`
   * seconds of its animation have already played when the scene appears. Its exit still lands at
   * start + duration. Cuts and transitions use start/end only.
   */
  preroll?: number
  /**
   * Integer 0..MAX_TRACK, default 0 (always set after parsing). Higher tracks draw above lower ones;
   * inside one track, storyboard order decides (later on top). The user's video sits on track 0,
   * motion graphics and captions on higher tracks.
   */
  track?: number
  /**
   * Plan 3 Task 4: parallax depth, 0..CAMERA.maxDepth (absent = 1; never filled in by parsing). A
   * layer under the camera at depth d follows `poseAtDepth(pose, d)` and the jitter × d: 0 never
   * moves (far), 2 moves twice as much (near). Ignored without a camera and on fixed tracks.
   */
  depth?: number
  params: Record<string, unknown>
}

/** Highest allowed track index (tracks are 0..MAX_TRACK). */
export const MAX_TRACK = 9

/** Largest allowed scene preroll (seconds). */
export const MAX_PREROLL = 1

/**
 * A transition on a cut: its window is [at − duration/2, at + duration/2]. `at` is the end of the
 * outgoing scene and the start of the incoming one, both on the transition's `track`; scenes on
 * other tracks may start, end or overlap at `at` freely. `params` are parsed (defaults applied).
 */
export interface TransitionSpec {
  type: TransitionId
  at: number
  /**
   * Integer 0..MAX_TRACK, default 0 (always set after parsing). The cut is looked up on this track
   * only, and the overlay draws above this track and the ones below, never above higher tracks.
   */
  track?: number
  /** Seconds, 0.1..1.2, default 0.4 (morph: 0.6); always set after parsing. */
  duration: number
  params: Record<string, unknown>
}

/** Built-in synthesized sound effects (synthesis: Task 5). */
export const SFX_NAMES = ['tick', 'key', 'tap', 'mallet', 'count', 'chime', 'riser', 'impact'] as const
export type SfxName = (typeof SFX_NAMES)[number]

export type AudioKind = 'voice' | 'music' | 'sfx'

/**
 * One sound on the timeline (render: mixed by ffmpeg, `node/audio.ts`; preview: `runtime/preview/audio.ts`).
 * Exactly one of `media` (a project media id, audio or video) and `sfx` (a built-in effect, kind `sfx` only).
 * Times are seconds (`at` may be a word or pause anchor in the file, resolved at load time).
 */
export interface AudioClip {
  /** Default `a<index>`. */
  id: string
  kind: AudioKind
  media?: string
  sfx?: SfxName
  /**
   * SFX only: `end` places the clip so it ends at `at + duration` whatever the source length L is
   * (resolved in the mix: `in = max(0, L − duration)`, start `at + duration − min(L, duration)`).
   * The planner's risers use it: they end exactly on the cut.
   */
  align?: 'end'
  /** Built-in effects only: which take of the sound (mallet: the pentatonic note, mod 5). Default 0. */
  variant?: number
  /** Timeline start (s), default 0. */
  at: number
  /** Source offset (s), default 0: music "from 0:32" is `in: 32`. */
  in: number
  /**
   * Timeline length (s). Default: music runs to the storyboard end (or to its own end when shorter),
   * voice and sfx to the end of their source. Never past the storyboard end.
   */
  duration?: number
  /** dB, applied before ducking and loudness normalization. Defaults per kind: AUDIO_DEFAULTS. */
  gain: number
  /** Seconds. */
  fadeIn: number
  /** Seconds; music fades out over this, ending at its own end. */
  fadeOut: number
  /**
   * Music only (R4): volume steps of `db` over [at, at + duration) (timeline seconds), e.g. the
   * planner's −12 dB dip before a riser (`core/audio-plan.ts`).
   */
  dips?: { at: number; duration: number; db: number }[]
}

/**
 * Per-kind defaults. Voice 0 dB; SFX −14 dB (always under the voice, §13.5); music 7 dB under the
 * effects (R6: ≈ 45 %, §17.5), with a 1.5 s fade-out.
 */
export const AUDIO_DEFAULTS: Record<AudioKind, { gain: number; fadeIn: number; fadeOut: number }> = {
  voice: { gain: 0, fadeIn: 0, fadeOut: 0 },
  sfx: { gain: -14, fadeIn: 0, fadeOut: 0 },
  music: { gain: -21, fadeIn: 0, fadeOut: 1.5 },
}

/** Loudest allowed SFX gain (dB): effects stay below the voice. */
export const SFX_MAX_GAIN = -6

export interface Storyboard {
  version: 1
  format: Format
  fps: 30 | 60
  look: LookId
  dir: 'rtl'
  seed: number
  brand?: Brand
  scenes: SceneSpec[]
  transitions?: TransitionSpec[]
  audio?: AudioClip[]
  /** `false`: no automatic sound effects (`planSfx`); the user's `audio[]` is used as written. */
  autoSfx?: boolean
  /** Motion blur: sub-frame samples averaged over the shutter (render only). */
  motionBlur?: { samples: number; shutter: number }
  /**
   * dB added to every planned SFX gain (−24..0, default 0): a calmer video type (Task 10
   * `TYPE_PRESETS.corporate`: −4) keeps its effects softer. Never raises an effect.
   */
  sfxGainDb?: number
  /**
   * I3: the transcript the word anchors were written for (`mba explain` writes it): its
   * `sourceHash` and word count. `loadStoryboardFile` warns when `transcript.json` is another one.
   */
  transcript?: { sourceHash: string; words: number; hash?: string }
  /**
   * Plan 2a+ Task 6: the one-world camera (`core/camera.ts`). Scene layers on tracks outside
   * `fixedTracks` (always set after parsing) move with it. Absent: no camera at all (no world
   * wrapper; the frame is drawn exactly as before).
   */
  camera?: CameraSpec
}

export class StoryboardError extends Error {
  path: string
  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message)
    this.name = 'StoryboardError'
    this.path = path
  }
}

const trackSchema = z.number().int().min(0).max(MAX_TRACK).default(0)

const sceneSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  start: z.number().finite().min(0),
  duration: z.number().finite().positive(),
  preroll: z.number().finite().min(0).max(MAX_PREROLL).default(0),
  track: trackSchema,
  depth: z.number().finite().min(0).max(CAMERA.maxDepth).optional(),
  params: z.record(z.string(), z.unknown()).default({}),
})

const transitionSchema = z.object({
  type: z.enum(TRANSITION_IDS),
  at: z.number().finite().min(0),
  // Default per type (`defaultTransitionDuration`), filled in `checkTransitions`.
  duration: z.number().finite().min(TRANSITION_DURATION.min).max(TRANSITION_DURATION.max).optional(),
  track: trackSchema,
  params: z.record(z.string(), z.unknown()).default({}),
})

const audioClipSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(['voice', 'music', 'sfx']),
  media: z.string().min(1).optional(),
  sfx: z.enum(SFX_NAMES).optional(),
  at: z.number().finite().min(0).default(0),
  in: z.number().finite().min(0).default(0),
  duration: z.number().finite().positive().optional(),
  gain: z.number().finite().optional(),
  fadeIn: z.number().finite().min(0).optional(),
  fadeOut: z.number().finite().min(0).optional(),
  variant: z.number().int().min(0).optional(),
  align: z.literal('end').optional(),
  dips: z
    .array(z.object({ at: z.number().finite().min(0), duration: z.number().finite().positive(), db: z.number().finite().max(0) }))
    .optional(),
})

const cameraKeySchema = z.object({
  at: z.number().finite().min(0),
  x: z.number().finite().min(0).max(1).default(0.5),
  y: z.number().finite().min(0).max(1).default(0.5),
  zoom: z.number().finite().min(CAMERA.minZoom).max(CAMERA.maxZoom),
  ease: z.enum(['linear', 'smooth']).default('smooth'),
})

const cameraSchema = z.object({
  keys: z
    .array(cameraKeySchema)
    .min(1, 'الكاميرا تحتاج مفتاحًا واحدًا على الأقل — the camera needs at least one key')
    .superRefine((keys, ctx) => {
      for (let k = 1; k < keys.length; k++) {
        if (keys[k]!.at < keys[k - 1]!.at) {
          ctx.addIssue({ code: 'custom', path: [k, 'at'], message: 'مفاتيح الكاميرا مرتبة حسب الوقت — camera keys must be sorted by at' })
          return
        }
      }
    }),
  fixedTracks: z.array(z.number().int().min(0).max(MAX_TRACK)).default([...CAMERA.fixedTracks]),
  // Plan 3 Task 4: the living camera (both optional; absent = no jitter, exactly as before).
  handheld: z.object({ amp: z.number().finite().min(0).max(CAMERA.maxHandheld).default(1) }).optional(),
  shakes: z.array(z.object({ at: z.number().finite().min(0), amp: z.number().finite().min(0).max(CAMERA.maxShake) })).optional(),
})

const storyboardSchema = z.object({
  version: z.literal(1),
  format: z.enum(FORMATS).default('9:16'),
  fps: z.union([z.literal(30), z.literal(60)]).default(30),
  look: z.enum(LOOK_IDS).default('dark-tech'),
  dir: z.literal('rtl').default('rtl'),
  seed: z.number().int().default(1),
  brand: brandSchema.optional(),
  scenes: z.array(sceneSchema).min(1, 'at least one scene is required'),
  transitions: z.array(transitionSchema).optional(),
  audio: z.array(audioClipSchema).optional(),
  autoSfx: z.boolean().optional(),
  sfxGainDb: z.number().finite().min(-24).max(0).optional(),
  transcript: z.object({ sourceHash: z.string(), words: z.number().int().nonnegative(), hash: z.string().optional() }).optional(),
  camera: cameraSchema.optional(),
  /**
   * Motion blur (the film-camera way): each frame averages `samples` sub-frame moments spread over
   * the shutter (`shutter` degrees of the frame interval, 180 = film look). Render time × samples.
   */
  motionBlur: z.object({ samples: z.number().int().min(2).max(8).default(4), shutter: z.number().min(45).max(360).default(180) }).optional(),
})

/** A transition's `at` may differ from the cut by at most this much (seconds). */
export const CUT_TOLERANCE = 0.001

/** A scene's or transition's track (0 when unset, e.g. a storyboard built without parsing). */
export function trackOf(x: { track?: number }): number {
  return x.track ?? 0
}

/**
 * The scenes a transition joins: on the transition's track, those ending at `at` (outs) and those
 * starting there (ins), each within CUT_TOLERANCE. A valid transition has exactly one of each.
 */
export function transitionCut(scenes: readonly SceneSpec[], tr: { at: number; track?: number }): { outs: number[]; ins: number[] } {
  const outs: number[] = []
  const ins: number[] = []
  scenes.forEach((sc, i) => {
    if (trackOf(sc) !== trackOf(tr)) return
    if (Math.abs(sc.start + sc.duration - tr.at) <= CUT_TOLERANCE) outs.push(i)
    if (Math.abs(sc.start - tr.at) <= CUT_TOLERANCE) ins.push(i)
  })
  return { outs, ins }
}

/** Checks every transition against the scenes of its track (cut, window length, overlap) and parses its params. */
function checkTransitions(sb: Storyboard): void {
  const windows: { a: number; b: number; track: number }[] = []
  sb.transitions?.forEach((tr, i) => {
    const path = `transitions[${i}]`
    tr.duration ??= defaultTransitionDuration(tr.type)
    const track = trackOf(tr)
    const cut = transitionCut(sb.scenes, tr)
    const outs = cut.outs.map((k) => sb.scenes[k]!)
    const ins = cut.ins.map((k) => sb.scenes[k]!)
    if (outs.length !== 1 || ins.length !== 1 || outs[0] === ins[0]) {
      throw new StoryboardError(
        `${path}.at`,
        `transition at ${tr.at}s must sit on a cut on track ${track}: the end of exactly one scene and the start of exactly one other ` +
          `on that track (found ${outs.length} ending and ${ins.length} starting there)`,
      )
    }
    const shortest = Math.min(outs[0]!.duration, ins[0]!.duration)
    if (tr.duration / 2 > shortest + 1e-9) {
      throw new StoryboardError(
        `${path}.duration`,
        `half the transition (${tr.duration / 2}s) is longer than a scene it joins (${shortest}s)`,
      )
    }
    // Windows may overlap in time only on different tracks.
    const w = { a: tr.at - tr.duration / 2, b: tr.at + tr.duration / 2, track }
    const j = windows.findIndex((o) => o.track === track && w.a < o.b - 1e-9 && o.a < w.b - 1e-9)
    if (j >= 0) {
      throw new StoryboardError(`${path}.at`, `transition window [${w.a}, ${w.b}]s overlaps transitions[${j}]`)
    }
    windows.push(w)
    const r = TRANSITION_PARAMS[tr.type].safeParse(tr.params)
    if (!r.success) {
      const issue = r.error.issues[0]!
      const sub = formatPath(issue.path)
      throw new StoryboardError(sub ? (sub.startsWith('[') ? `${path}.params${sub}` : `${path}.params.${sub}`) : `${path}.params`, issue.message)
    }
    tr.params = r.data as Record<string, unknown>
  })
}

/** Fills the per-kind defaults of every audio clip (R2) and checks what the schema cannot. */
function checkAudio(sb: Storyboard): void {
  if (!sb.audio) return
  const seen = new Set<string>()
  sb.audio = sb.audio.map((raw, i) => {
    const path = `audio[${i}]`
    const c = raw as Omit<AudioClip, 'id' | 'gain' | 'fadeIn' | 'fadeOut'> & Partial<AudioClip>
    if ((c.media === undefined) === (c.sfx === undefined)) {
      throw new StoryboardError(path, 'يجب تحديد media أو sfx (واحد فقط) — exactly one of media (a project media id) or sfx (a built-in effect) is required')
    }
    if (c.sfx !== undefined && c.kind !== 'sfx') {
      throw new StoryboardError(`${path}.sfx`, `المؤثرات المدمجة لنوع sfx فقط — a built-in effect needs kind "sfx", got "${c.kind}"`)
    }
    if (c.dips !== undefined && c.kind !== 'music') {
      throw new StoryboardError(`${path}.dips`, `خفض المستوى للموسيقى فقط — dips are for kind "music" only, got "${c.kind}"`)
    }
    if (c.variant !== undefined && c.sfx === undefined) {
      throw new StoryboardError(`${path}.variant`, 'variant للمؤثرات المدمجة فقط — variant needs a built-in effect (sfx)')
    }
    if (c.align !== undefined && (c.kind !== 'sfx' || c.duration === undefined)) {
      throw new StoryboardError(`${path}.align`, 'align للمؤثرات ذات المدة فقط — align "end" needs kind "sfx" and a duration')
    }
    const d = AUDIO_DEFAULTS[c.kind]
    const clip: AudioClip = { ...c, id: c.id ?? `a${i}`, gain: c.gain ?? d.gain, fadeIn: c.fadeIn ?? d.fadeIn, fadeOut: c.fadeOut ?? d.fadeOut }
    if (clip.kind === 'sfx' && clip.gain > SFX_MAX_GAIN) {
      throw new StoryboardError(`${path}.gain`, 'المؤثرات يجب أن تبقى أخفض من الصوت — SFX must stay below the voice (≤ −6 dB)')
    }
    if (seen.has(clip.id)) throw new StoryboardError(`${path}.id`, `معرّف صوت مكرر — duplicate audio id "${clip.id}"`)
    seen.add(clip.id)
    return clip
  })
}

export function parseStoryboard(json: unknown, knownTypes: string[]): Storyboard {
  const r = storyboardSchema.safeParse(json)
  if (!r.success) {
    const issue = r.error.issues[0]!
    throw new StoryboardError(formatPath(issue.path), issue.message)
  }
  const sb = r.data as Storyboard
  const seen = new Set<string>()
  sb.scenes.forEach((sc, i) => {
    if (!knownTypes.includes(sc.type)) {
      throw new StoryboardError(`scenes[${i}].type`, `unknown scene type "${sc.type}"; known types: ${knownTypes.join(', ')}`)
    }
    if (seen.has(sc.id)) throw new StoryboardError(`scenes[${i}].id`, `duplicate scene id "${sc.id}"`)
    seen.add(sc.id)
    if ((sc.preroll ?? 0) > sc.duration) {
      throw new StoryboardError(`scenes[${i}].preroll`, `preroll (${sc.preroll}s) is longer than the scene (${sc.duration}s)`)
    }
  })
  checkTransitions(sb)
  checkAudio(sb)
  return sb
}

export function storyboardDuration(sb: Storyboard): number {
  return sb.scenes.reduce((m, s) => Math.max(m, s.start + s.duration), 0)
}

/**
 * The scene the stage shows at `t`: among the scenes whose window contains `t`, the one that started
 * last. At a cut (incoming start within CUT_TOLERANCE of the outgoing end, e.g. 0.1 + 0.2 vs 0.3)
 * that is the incoming scene, exactly as the stage draws it. With `track`, only scenes on that track
 * count (a probe of a track-0 cut is about the track-0 scenes, not a caption above them); without
 * it, scenes of every track do. '(none)' when no scene shows.
 */
export function sceneAt(sb: Storyboard, t: number, track?: number): string {
  const end = storyboardDuration(sb)
  const pool = track === undefined ? sb.scenes : sb.scenes.filter((sc) => trackOf(sc) === track)
  let best: SceneSpec | undefined
  for (const sc of pool) {
    const scEnd = sc.start + sc.duration
    // An outgoing scene whose end overshoots a cut by float noise does not count past that cut.
    const cutAhead = pool.some((o) => o !== sc && Math.abs(o.start - scEnd) <= CUT_TOLERANCE && t >= o.start)
    const shows = ((t >= sc.start && t < scEnd) || (t === end && scEnd === end)) && !cutAhead
    if (shows && (!best || sc.start >= best.start)) best = sc
  }
  // A sub-CUT_TOLERANCE gap before a cut: the stage keeps the outgoing scene (inside a transition window).
  best ??= pool.find((sc) => t >= sc.start + sc.duration && t - (sc.start + sc.duration) <= CUT_TOLERANCE)
  return best?.id ?? '(none)'
}

