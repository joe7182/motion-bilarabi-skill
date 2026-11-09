import { z } from 'zod'
import { StoryboardError } from './storyboard'
import type { Marks, Transcript } from './transcript'

/**
 * Word-anchored timing (V1). A storyboard time (`scenes[].start`, `scenes[].duration`,
 * `transitions[].at`, `audio[].at`) may be a number of seconds or an anchor:
 * - `{ word: k, edge?: 'start' | 'end', offset?: s }`: the start (default) or end of transcript word k;
 * - `{ pause: k, offset?: s }`: `marks.pauses[k].at` (the end of the word before the pause).
 * `scenes[].duration` may also be `{ until: <anchor or seconds> }`: the scene ends there.
 * R3: any field named `at` under `scenes[i].params` (deep, in objects and arrays) may be an anchor
 * too; it becomes scene-local seconds (absolute time − the scene start). Plan 2a+: `camera.keys[i].at`
 * may be an anchor; it stays absolute (the camera is not a scene). Plan 3: so may `camera.shakes[i].at`.
 *
 * Anchors are resolved once, at load time (`loadStoryboardFile`), to seconds on the frame grid; the
 * page only ever sees numbers. Pure (no Node, no DOM).
 */

export type Anchor = { word: number; edge?: 'start' | 'end'; offset?: number } | { pause: number; offset?: number }

export interface AnchorContext {
  transcript?: Transcript
  marks?: Marks
  fps: number
}

const offsetSchema = z.number().finite().optional()
const wordAnchorSchema = z.strictObject({
  word: z.number().int().nonnegative(),
  edge: z.enum(['start', 'end']).optional(),
  offset: offsetSchema,
})
const pauseAnchorSchema = z.strictObject({
  pause: z.number().int().nonnegative(),
  offset: offsetSchema,
})

const marksSchema = z.object({
  stress: z.array(z.number().int().nonnegative()),
  pauses: z.array(z.object({ after: z.number().int().nonnegative(), at: z.number().finite().nonnegative(), gap: z.number().finite().nonnegative() })),
  unmatched: z.array(z.string()).default([]),
  // R11: section titles aligned to their first spoken word (absent before Task 10).
  sections: z.array(z.object({ title: z.string().min(1), word: z.number().int().nonnegative() })).default([]),
  // Fix wave I2: the script's spelling per transcript word (absent before the fix wave).
  display: z.array(z.object({ word: z.number().int().nonnegative(), text: z.string().min(1) })).default([]),
  // Critic round 2: words that end a sentence in the script.
  stops: z.array(z.number().int().nonnegative()).default([]),
})

/** Validates `marks.json` (Arabic-first error). */
export function parseMarks(json: unknown): Marks {
  const r = marksSchema.safeParse(json)
  if (!r.success) {
    const issue = r.error.issues[0]!
    throw new Error(`ملف العلامات غير صالح — Invalid marks.json: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  return r.data
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** An object with a `word` or `pause` key: meant as an anchor (validated when resolved). */
export function isAnchor(x: unknown): x is Record<string, unknown> {
  return isObject(x) && ('word' in x || 'pause' in x)
}

/** Seconds on the frame grid. */
const snap = (t: number, fps: number) => Math.round(t * fps) / fps
/** Seconds for messages: at most 4 decimals. */
const sec = (t: number) => String(Math.round(t * 10000) / 10000)

function err(path: string, ar: string, en: string): StoryboardError {
  return new StoryboardError(path, `${ar} — ${en}`)
}

/** The absolute time of an anchor (not snapped), checked against the transcript and marks. */
function anchorTime(a: Record<string, unknown>, path: string, ctx: AnchorContext): number {
  if ('word' in a && 'pause' in a) {
    throw err(path, 'المرساة إما كلمة أو وقفة وليست الاثنتين', 'an anchor is either {word} or {pause}, not both')
  }
  if ('word' in a) {
    const r = wordAnchorSchema.safeParse(a)
    if (!r.success) throw anchorShapeError(path, r.error)
    const words = ctx.transcript?.words
    if (!words) throw err(path, 'لا يوجد تفريغ؛ شغّل mba transcribe', 'no transcript; run mba transcribe')
    const w = words[r.data.word]
    if (!w) {
      throw err(path, `الكلمة ${r.data.word} غير موجودة، التفريغ فيه ${words.length} كلمة`, `word ${r.data.word} does not exist; the transcript has ${words.length} words`)
    }
    return (r.data.edge === 'end' ? w.end : w.start) + (r.data.offset ?? 0)
  }
  const r = pauseAnchorSchema.safeParse(a)
  if (!r.success) throw anchorShapeError(path, r.error)
  const pauses = ctx.marks?.pauses
  if (!pauses) {
    throw err(path, 'لا توجد علامات الوقفات؛ أضف script.md وشغّل mba transcribe', 'no marks.json (pauses); add script.md and run mba transcribe')
  }
  const p = pauses[r.data.pause]
  if (!p) {
    throw err(path, `الوقفة ${r.data.pause} غير موجودة، في marks.json ${pauses.length} وقفة`, `pause ${r.data.pause} does not exist; marks.json has ${pauses.length} pauses`)
  }
  return p.at + (r.data.offset ?? 0)
}

function anchorShapeError(path: string, e: z.ZodError): StoryboardError {
  const issue = e.issues[0]!
  const keys = issue.code === 'unrecognized_keys' ? ` (${issue.keys.join(', ')})` : ''
  const field = issue.path.length ? `${issue.path.join('.')}: ` : ''
  return err(path, 'مرساة غير صالحة', `invalid anchor: ${field}${issue.message}${keys}`)
}

/** An absolute time on the frame grid; negative times are refused. */
function absolute(a: Record<string, unknown>, path: string, ctx: AnchorContext): number {
  const t = anchorTime(a, path, ctx)
  if (t < 0) throw err(path, `المرساة تعطي وقتًا سالبًا (${sec(t)} ث)`, `the anchor resolves to a negative time (${sec(t)} s)`)
  return snap(t, ctx.fps)
}

/**
 * Replaces every anchor in a storyboard JSON by seconds snapped to the frame grid
 * (`Math.round(t·fps)/fps`); `used` tells whether any anchor was found. Plain numbers are left as
 * they are; the input is not mutated. Anything that is neither a number nor an anchor is left for
 * the schema to report. Errors are `StoryboardError`s at the field's JSON path, Arabic first.
 */
export function resolveAnchors(json: unknown, ctx: AnchorContext): { json: unknown; used: boolean } {
  if (!isObject(json)) return { json, used: false }
  let used = false
  const out: Record<string, unknown> = { ...json }
  const at = (x: unknown, path: string): unknown => {
    if (!isAnchor(x)) return x
    used = true
    return absolute(x, path, ctx)
  }

  if (Array.isArray(json.scenes)) {
    out.scenes = json.scenes.map((raw, i) => {
      if (!isObject(raw)) return raw
      const path = `scenes[${i}]`
      const sc: Record<string, unknown> = { ...raw }
      sc.start = at(raw.start, `${path}.start`)
      const start = typeof sc.start === 'number' && Number.isFinite(sc.start) ? sc.start : undefined
      sc.duration = resolveDuration(raw.duration, start, `${path}.duration`, ctx, () => (used = true))
      if (isObject(raw.params) && start !== undefined) {
        sc.params = resolveParams(raw.params, start, `${path}.params`, ctx, () => (used = true))
      }
      return sc
    })
  }
  for (const key of ['transitions', 'audio'] as const) {
    const list = json[key]
    if (!Array.isArray(list)) continue
    out[key] = list.map((raw, i) => (isObject(raw) && 'at' in raw ? { ...raw, at: at(raw.at, `${key}[${i}].at`) } : raw))
  }
  // Plan 2a+ Task 6: camera keys are absolute times (the camera belongs to no scene); Plan 3 Task 4: so are its shakes.
  const camera = json.camera
  if (isObject(camera)) {
    const cam: Record<string, unknown> = { ...camera }
    for (const key of ['keys', 'shakes'] as const) {
      const list = camera[key]
      if (!Array.isArray(list)) continue
      cam[key] = list.map((raw, i) => (isObject(raw) && 'at' in raw ? { ...raw, at: at(raw.at, `camera.${key}[${i}].at`) } : raw))
    }
    out.camera = cam
  }
  return { json: out, used }
}

/** `duration`: a number, or `{ until: <anchor | seconds> }` → until − start, a whole number of frames. */
function resolveDuration(d: unknown, start: number | undefined, path: string, ctx: AnchorContext, mark: () => void): unknown {
  if (isAnchor(d)) {
    throw err(path, 'المدة لا تكون مرساة؛ استخدم { until: … } لإنهاء المشهد عند كلمة', 'a duration is a length, not an anchor; use { "until": … } to end the scene at a word')
  }
  if (!isObject(d) || !('until' in d)) return d
  mark()
  const extra = Object.keys(d).filter((k) => k !== 'until')
  if (extra.length) throw err(path, 'مفاتيح غير معروفة في المدة', `unknown keys in duration: ${extra.join(', ')}`)
  const u = d.until
  let end: number
  if (isAnchor(u)) end = absolute(u, `${path}.until`, ctx)
  else if (typeof u === 'number' && Number.isFinite(u) && u >= 0) end = u
  else throw err(`${path}.until`, 'until يجب أن يكون مرساة أو ثواني', 'until must be an anchor ({word} or {pause}) or seconds ≥ 0')
  if (start === undefined) return d // the schema reports the invalid start
  if (!(end - start > 1e-9)) {
    throw err(path, `نهاية المشهد (${sec(end)} ث) ليست بعد بدايته (${sec(start)} ث)`, `until (${sec(end)} s) is not after the scene start (${sec(start)} s)`)
  }
  return snap(end - start, ctx.fps)
}

/** R3: every `at` anchor under a scene's params (deep) → scene-local seconds on the frame grid. */
function resolveParams(params: Record<string, unknown>, start: number, path: string, ctx: AnchorContext, mark: () => void): Record<string, unknown> {
  const walk = (x: unknown, p: string): unknown => {
    if (Array.isArray(x)) return x.map((v, i) => walk(v, `${p}[${i}]`))
    if (!isObject(x)) return x
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x)) {
      const kp = `${p}.${k}`
      if (k === 'at' && isAnchor(v)) {
        mark()
        const abs = absolute(v, kp, ctx)
        const local = snap(abs - start, ctx.fps)
        if (local < 0) {
          throw err(kp, `المرساة (${sec(abs)} ث) قبل بداية المشهد (${sec(start)} ث)`, `the anchor (${sec(abs)} s) is before the scene start (${sec(start)} s)`)
        }
        o[k] = local
      } else {
        o[k] = walk(v, kp)
      }
    }
    return o
  }
  return walk(params, path) as Record<string, unknown>
}
