import { z } from 'zod'
import { BUILD_NUMBER } from '../params/build-number'
import { CTA_TIMING } from '../params/comment-cta'
import { defaultTransitionDuration } from '../params/transitions'
import { LOOK_IDS, type Storyboard } from '../storyboard'
import type { StyleDna } from '../style'
import { normalizeAr, type Marks, type Transcript } from '../transcript'
import { FORMATS } from '../types'
import { compilePlan, planExplainer } from './plan'
import { BRIEF_TYPES, HOOK_FAMILIES_AR, type HookFamily } from './types'

export { compilePlan, parsePlan, planExplainer, rowText, type ExplainPlan } from './plan'

/**
 * The explainer-from-voiceover recipe (`mba explain`, Task 10; Plan 2a+ Task 9): transcript + marks
 * + brief → a plan (`plan.json`: the creative director's beats, ideas, worlds, hero and camera,
 * `planExplainer`) → `edit.json` content with word anchors (`compilePlan`, resolved to seconds only
 * at load). This file holds the brief, the planned-pace estimate and the composed wrapper
 * `explainerStoryboard`; `plan.ts` the planning and the span → scene compilation; `ideas.ts` the
 * director's vocabulary. Pure and deterministic: the same input gives a deep-equal output (the only
 * randomness is `rng(seed)`).
 *
 * Tracks: 0 backdrop (one colour world per script section) and word walls, 1 the main line (hook,
 * kinetic text in short stacks, counters, checklists, the user's screens, the end card), 2 keyword
 * visuals (icons, line art; the hook's stamp; section numbers, shape states), 3 accents
 * (highlights: stressed words, pace fillers), 4 the hero, 5 the HUD (0 and 5 are fixed under the camera).
 */

// ---------------------------------------------------------------------------------------------
// Brief

const ids = HOOK_FAMILIES_AR.map((h) => h.id)

/** The hook family an id or alias names (compared with `normalizeAr`). */
export function hookFamilyOf(name: string): HookFamily | undefined {
  const n = normalizeAr(name)
  return HOOK_FAMILIES_AR.find((h) => [h.id, ...h.aliases].some((a) => normalizeAr(a) === n))?.id
}

const hookFamily = z
  .string()
  .superRefine((s, ctx) => {
    if (hookFamilyOf(s) === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `عائلة الافتتاحية «${s}» غير معروفة، المتاح: ${ids.join('، ')} — unknown hook family "${s}"; known: ${ids.join(', ')}`,
      })
    }
  })
  .transform((s) => hookFamilyOf(s)!)

const text = (max: number) => z.string().trim().min(1).max(max)

export const briefSchema = z.object({
  title: text(120).optional(),
  type: z.enum(BRIEF_TYPES).default('explainer'),
  format: z.enum(FORMATS).optional(),
  /** Default by type: paper-editorial (educational, informational, explainer), dark-tech (product-launch, motion), light-editorial (corporate). */
  look: z.enum(LOOK_IDS).optional(),
  hook: z.object({ family: hookFamily, text: text(120).optional() }).optional(),
  /** A string is the CTA text; `keyword` makes the end card a «comment the word» card. */
  cta: z
    .union([text(120), z.object({ keyword: text(20).optional(), text: text(120).optional() })])
    .transform((c) => (typeof c === 'string' ? { text: c } : c))
    .optional(),
  /** Spoken word → the value its counter rolls to (e.g. a number said in words). */
  numbers: z.record(z.string().min(1), z.number().finite()).optional(),
  musicMedia: z.string().min(1).optional(),
  /** A `style.json` (`mba reference --style`), path relative to the project: the recipe aims at its rhythm, text density and colours. */
  style: z.string().min(1).optional(),
  musicFrom: z.number().finite().min(0).optional(),
  /**
   * Plan 2a+ Task 9: the music's beat. Planned fillers, non-word transitions and hero rests snap to
   * the nearest beat (offset + n · 60 / bpm) when within BEAT_SNAP s; word-anchored events never move.
   */
  beat: z.object({ bpm: z.number().finite().min(40).max(220), offset: z.number().finite().min(0).optional() }).optional(),
  /** The hero returns to its first point at the end (a looping video). */
  loop: z.boolean().optional(),
  /** Force the recurring hero on (true or its shape) or off (false); absent: the director decides. */
  hero: z.union([z.boolean(), z.enum(['dot', 'ball', 'square'])]).optional(),
  /** Default by type: corporate / educational `none`, explainer / informational `push`, product-launch / motion `world`. */
  camera: z.enum(['none', 'push', 'world']).optional(),
  /**
   * Plan 3 Task 7: the sign on the coin in the `signature` look (AED, SAR, USD, EUR, IQD; case-insensitive,
   * `parseCurrency`). Unknown → AED with an Arabic-first warning; absent → AED.
   */
  currency: z.string().trim().min(1).max(12).optional(),
  /** Screenshots in the project's `source/` folder, shown in order on a phone (portrait) or in an app window (landscape); never invented UI. */
  screens: z
    .array(z.string().min(1).refine((s) => !/^[a-z][a-z0-9+.-]*:/i.test(s), { message: 'a screen is a file in source/, not a URL' }))
    .max(8)
    .optional(),
})

export type Brief = z.output<typeof briefSchema>
export type BriefInput = z.input<typeof briefSchema>

/** Validates `brief.json` (Arabic-first errors); idempotent on an already parsed brief. */
export function parseBrief(json: unknown): Brief {
  const r = briefSchema.safeParse(json ?? {})
  if (!r.success) {
    const issue = r.error.issues[0]!
    const path = issue.path.join('.') || '(root)'
    throw new Error(/[؀-ۿ]/.test(issue.message) ? `${issue.message} (brief.${path})` : `ملف الموجز غير صالح — Invalid brief.json: ${path}: ${issue.message}`)
  }
  return r.data
}

/** `source/<name>` for a brief screen (a name already under source/ is kept). */
export const screenPath = (name: string): string => {
  const file = name.replace(/\\/g, '/')
  return file.startsWith('source/') ? file : `source/${file}`
}

// ---------------------------------------------------------------------------------------------
// Planned pace

/**
 * The review measured the median event gap about this much above the planned one on the fixture
 * renders (fix round 1: planned 0.40 s, measured 0.467 s): a word's motion peak lands a little
 * after its start. Steering aims below the type's upper bound by this much.
 */
export const PLAN_BIAS = 0.05
/** Planned-event spacing the review metric resolves (`PACE.eventApart`). */
export const EVENT_APART = 0.25
/** A non-drifting element (or a kinetic word) counts as moving this long after each of its events (s). */
export const ENTRANCE_SEC = 0.35
/** Static runs shorter than this are not counted (`PACE.minStatic`). */
const MIN_STATIC = 0.25
/**
 * Plan 2a+ Task 9: the recipe plans to at most this `maxEventGap` (s) for the types Pro Pace binds
 * (intensity ≥ 3), so a rendered gap of 1.0 s never sits on the limit.
 */
export const PLAN_MAX_GAP = 0.95
/**
 * Draw time of accent underlines/circles (s): a 0.4 s underline under a three-word stack does not
 * register as an event, a 0.25 s one does (fix round 1 probe 2) but only just (a 0.25 s underline under
 * the hook stack missed in a fix round 2 render); 0.15 s registers with margin.
 */
export const ACCENT_DRAW_IN = 0.15

/**
 * Primitives whose content keeps moving after its entrance (R16 translate + scale drift, Task 7
 * round 4): a settled tail of these is not static. Kinetic text is NOT in the set (fix round 1,
 * I3): its scale-only drift leaves ~0.3 s static after each entrance (Task 7) and a long line stays
 * static, so it is planned as moving only for ENTRANCE_SEC after each word.
 */
export const DRIFTING_TYPES: ReadonlySet<string> = new Set([
  'counter',
  'checklist',
  'icon',
  'line-art',
  'wipe-reveal',
  'phone',
  'app-window',
  'stamp',
  'comment-cta',
  'highlight',
  // Plan 2a+: a section number keeps the shared drift; a word wall's rows never stop.
  'section-number',
  'word-wall',
  // Plan 3 Task 7: the repeat loop scrolls and the chase runs over their whole scene.
  'repeat-loop',
  'chase',
  // Stage 1B: a screen clip plays or drifts its picture over its whole scene.
  'screen-clip',
])

/**
 * Scene starts the review registers as motion events (measured in fix round 1 with a probe
 * storyboard at 540×960: cuts, stack words, a popped icon, a stamp, highlight underline/circle
 * register; a drawn icon, small line art, a highlight burst, a checklist row, a word joining a
 * long line, a HUD section and a backdrop glow do not).
 */
const REGISTERED_START: ReadonlySet<string> = new Set([
  'kinetic-text',
  'counter',
  'checklist',
  'phone',
  'app-window',
  'comment-cta',
  'stamp',
  'wipe-reveal',
  'slam',
  'search-typing',
  'video',
  // Plan 2a+: a giant section number lifting in; a word wall coming in (measured behind a comment card,
  // alpha 0.1, dark-tech and paper-editorial). Its drift is motion, not events.
  'section-number',
  'word-wall',
  // Plan 3 Task 7: the loop's copies sliding in, the chase's figures popping in.
  'repeat-loop',
  'chase',
  // Stage 1B: a window tilting in; numbered cards popping in.
  'screen-clip',
  'numbered-slots',
  // Stage 2: items dropping into a number from the scene start.
  'build-number',
])

export interface PlannedPace {
  /** Planned visual events (s, 3 decimals), at least EVENT_APART apart. */
  events: number[]
  /** Longest stretch without an event, counting from 0 and to the end. */
  maxEventGap: number
  /** Median gap between consecutive events. */
  medianEventGap: number
  /** Longest planned static run (s). */
  longestStatic: number
  /** 1 − planned static time / duration. */
  movingPct: number
}

const r3 = (t: number) => Math.round(t * 1000) / 1000

function startRegisters(sc: { type: string; params: Record<string, unknown> }): boolean {
  if (REGISTERED_START.has(sc.type)) return true
  if (sc.type === 'icon') return sc.params.enter === 'pop'
  // An underline registers only when drawn fast (≤ ACCENT_DRAW_IN); a circle always; a burst never.
  if (sc.type === 'highlight') return sc.params.kind === 'circle' || (sc.params.kind === 'underline' && Number(sc.params.drawIn ?? 0.45) <= ACCENT_DRAW_IN + 1e-9)
  return false
}

/**
 * Local times (scene-local s) of the registered events inside a scene, besides its start.
 * `signature` (Plan 3 Task 7): the look's headline is one short line set large in the headline
 * zone, and each word entering it registers (measured on the approved voice-1 render, t6b-v1:
 * events within 0.1 s of the line words).
 */
function sceneEvents(sc: { type: string; params: Record<string, unknown> }, signature = false): number[] {
  const p = sc.params as Record<string, any>
  const ats = (xs: unknown) => (Array.isArray(xs) ? xs.map((x) => Number(x?.at)).filter(Number.isFinite) : [])
  switch (sc.type) {
    case 'kinetic-text':
      // Only words entering a stack register; a word joining a long line does not.
      // An opacity-only `fade` entrance (the particle word's line) does not register.
      return (p.mode ?? 'stack') === 'stack' || (signature && p.mode === 'line' && p.enter !== 'fade') ? ats(p.words) : []
    case 'morph-object':
      // Plan 3 Task 7: every move of the hero (dot ↔ object, object → object) arrives at its state's `at`.
      return ats(p.states).slice(1)
    case 'build-number':
      // Stage 2: the stacked items fusing into the clean number.
      return [Number(p.morphAt ?? Number(p.fallFrom ?? 0) + Number(p.buildSec ?? 1.3) + BUILD_NUMBER.morphAfter)].filter(Number.isFinite)
    case 'particle-word':
      // The burst's flash ring and the cloud landing on the word.
      return [Number(p.burst), Number(p.land)].filter(Number.isFinite)
    case 'checklist':
      // Fix wave: a row entering does not reliably register (measured: the e2e fixture's second row
      // registered with one seed's drift and not with another's, a 1.1 s gap). Not planned as an
      // event: the pace fillers underline the rows instead.
      return []
    case 'comment-cta':
      // Measured: the keyword wipe, the posted comment settling (~0.15 s after its rise) and the DM card.
      return [CTA_TIMING.keyword[0], CTA_TIMING.post[0] + 0.15, CTA_TIMING.dm[0]]
    default:
      return []
  }
}

/** Every entrance inside a scene (registered or not): where it is planned as moving. */
function sceneEntrances(sc: { type: string; params: Record<string, unknown> }): number[] {
  const p = sc.params as Record<string, any>
  const ats = (xs: unknown) => (Array.isArray(xs) ? xs.map((x) => Number(x?.at)).filter(Number.isFinite) : [])
  if (sc.type === 'kinetic-text') return ats(p.words)
  if (sc.type === 'hud') return ats(p.sections)
  if (sc.type === 'morph-object') return ats(p.states)
  return sceneEvents(sc)
}

/**
 * The pace a storyboard (seconds, e.g. after `resolveAnchors` + `parseStoryboard`) plans, as an
 * estimate of what `mba review` measures; the render review remains the judge. Events are the
 * starts and entrances the review registers (REGISTERED_START, stack words, comment-cta beats,
 * popped icons, highlight underline/circle) and transitions, merged when closer than EVENT_APART.
 * Static time: a drifting primitive (DRIFTING_TYPES) moves over its whole scene; anything else,
 * kinetic text included, only for ENTRANCE_SEC after each start or entrance (its tail is static).
 */
export function plannedPace(sb: Pick<Storyboard, 'scenes' | 'transitions'> & Partial<Pick<Storyboard, 'look' | 'camera'>>): PlannedPace {
  const end = sb.scenes.reduce((m, s) => Math.max(m, s.start + s.duration), 0)
  const raw: number[] = []
  const moving: [number, number][] = []
  const signature = sb.look === 'signature'
  for (const sc of sb.scenes) {
    const a = sc.start
    const b = sc.start + sc.duration
    const local0 = sc.start - (sc.preroll ?? 0)
    const inScene = (ts: number[]) => ts.map((t) => local0 + t).filter((t) => t >= a - 1e-9 && t < b - 1e-9).map((t) => Math.max(a, t))
    if (startRegisters(sc)) raw.push(a)
    raw.push(...inScene(sceneEvents(sc, signature)))
    if (DRIFTING_TYPES.has(sc.type)) moving.push([a, b])
    else for (const t of [a, ...inScene(sceneEntrances(sc))]) moving.push([t, Math.min(b, t + ENTRANCE_SEC)])
  }
  // Plan 3 Task 4 / 7: a camera shake jolts the whole frame (2a+ storyboards have none).
  for (const sh of sb.camera?.shakes ?? []) {
    raw.push(sh.at)
    moving.push([sh.at, Math.min(end, sh.at + ENTRANCE_SEC)])
  }
  for (const tr of sb.transitions ?? []) {
    raw.push(tr.at)
    const d = tr.duration ?? defaultTransitionDuration(tr.type)
    moving.push([tr.at - d / 2, tr.at + d / 2])
  }
  raw.sort((x, y) => x - y)
  const events: number[] = []
  for (const t of raw) {
    if (t < -1e-9 || t > end + 1e-9) continue
    if (events.length && t - events.at(-1)! < EVENT_APART - 1e-9) continue
    events.push(t)
  }
  const gaps = events.slice(1).map((t, i) => t - events[i]!)
  const edges = events.length ? [events[0]!, end - events.at(-1)!] : [end]
  const maxGap = Math.max(...gaps, ...edges)
  const sorted = [...gaps].sort((x, y) => x - y)
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2) : maxGap
  // Static runs: the complement of the moving intervals in [0, end].
  moving.sort((x, y) => x[0] - y[0])
  let still = 0
  let longest = 0
  let cursor = 0
  const run = (from: number, to: number) => {
    const len = to - from
    if (len >= MIN_STATIC - 1e-9) {
      still += len
      longest = Math.max(longest, len)
    }
  }
  for (const [a, b] of moving) {
    if (a > cursor) run(cursor, Math.min(a, end))
    cursor = Math.max(cursor, b)
    if (cursor >= end) break
  }
  if (cursor < end) run(cursor, end)
  return {
    events: events.map(r3),
    maxEventGap: r3(maxGap),
    medianEventGap: r3(median),
    longestStatic: r3(longest),
    movingPct: end > 0 ? r3(Math.min(1, Math.max(0, 1 - still / end))) : 0,
  }
}

// ---------------------------------------------------------------------------------------------
// Recipe

export interface ExplainInput {
  transcript: Transcript
  marks: Marks
  brief: Brief | BriefInput
  /** Media id of the voice (the transcript's media). */
  voiceMedia: string
  fps: number
  seed: number
  /** Pixel size of each brief screen (by its name in `brief.screens`): a landscape one goes in an app window. */
  screenSizes?: Record<string, { w: number; h: number }>
  /** The style DNA `brief.style` names (`mba explain` reads and validates the file); the recipe aims at `styleTargets(style)`. */
  style?: StyleDna
  /** sha1 of the `transcript.json` bytes (`mba explain`); the plan records it (else the words hash). */
  transcriptSha1?: string
  /**
   * Plan 3 Task 7: the voice's levels (0..1) from 0 s at `LEVELS_FPS` (30 per second; Node:
   * `voiceLevels(work/<media>.wav, 0, duration)`). The `signature` look slices them for the
   * microphone, voice-note and timeline states; absent → those objects use seeded idle motion.
   */
  voiceLevels?: readonly number[]
  /** Out: Arabic-first warnings (dropped screens, a missing product-launch structure, pace out of range). */
  warnings?: string[]
}

/**
 * The storyboard of an explainer: `compilePlan(planExplainer(i), i)`, with the plan's warnings
 * (then the compile's) pushed to `i.warnings`. See `plan.ts` for what the plan decides and how it
 * compiles.
 */
export function explainerStoryboard(i: ExplainInput): unknown {
  const plan = planExplainer(i)
  i.warnings?.push(...plan.warnings)
  return compilePlan(plan, i)
}
