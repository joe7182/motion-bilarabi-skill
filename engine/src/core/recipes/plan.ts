import { z } from 'zod'
import { resolveAnchors, type Anchor } from '../anchors'
import { isUiWord, matchKeywords, numberValue, stripClitics, type Visual } from '../keywords-ar'
import { BACKDROP_PATTERNS, BACKDROP_WORLDS, type BackdropParams, type BackdropTone } from '../params/backdrop'
import { heroAt, heroParams, type HeroParams } from '../params/hero'
import { ICON_NAMES } from '../params/icon'
import { validateSceneParams } from '../params/index'
import { KINETIC_MAX_REST_SEC, KINETIC_TIMING } from '../params/kinetic-text'
import { LINE_ART_NAMES } from '../params/line-art'
import { defaultTransitionDuration, TRANSITION_IDS, type TransitionId } from '../params/transitions'
import { PRIMITIVE_IDS } from '../primitive-ids'
import { rng } from '../rng'
import { LOOK_IDS, parseStoryboard, type LookId, type Storyboard } from '../storyboard'
import { styleTargets } from '../style'
import { kashidaSlots, splitWords } from '../text'
import { normalizeAr, spelledNumberAt, transcriptHash, type TranscriptWord } from '../transcript'
import { FORMAT_SIZE, FORMATS, SAFE_AREA, type Format } from '../types'
import { ACCENT_DRAW_IN, EVENT_APART, parseBrief, PLAN_BIAS, PLAN_MAX_GAP, plannedPace, screenPath, type Brief, type ExplainInput } from './explain'
import { directBeats, IDEA_IDS, IDEAS, ideaFits, isNegation, mainWord, stretchableWord, type BeatInfo, type DirectorCtx, type IdeaId } from './ideas'
import { BRIEF_TYPES, HOOK_FAMILIES_AR, signatureMinOf, TYPE_PRESETS, type BriefType, type HookFamily, type HookTreatment, type TypePreset } from './types'
import { composeSignature, conceptSchema, planSignature, signatureMoments, visualChoiceSchema } from './signature'

/**
 * Plan 2a+ Task 9: the explainer's plan (`plan.json`) and its compilation into a storyboard.
 *
 * `planExplainer` reads the transcript like V1 (`context`: beats split at pauses, silences and
 * sections; claims: checklists, counters, screens; spans: short kinetic stacks) and lets the
 * creative director (`ideas.ts`, `directBeats`) give beats editorial ideas: a stretched or giant
 * stressed word, section numbers with a colour-world flip per section, struck numbers, UI shape
 * states, a recurring hero landing on words, a camera push, a flood cut, a word wall. The plan is
 * plain JSON a person may edit; `compilePlan` turns it (with the same input) into `edit.json`
 * content: V1's composition (anchors, Pro Pace steering, fillers, hooks, audio) plus the ideas.
 * Pure and deterministic. Warnings are Arabic first.
 */

// ---------------------------------------------------------------------------------------------
// Constants

/** An unmarked silence at least this long splits beats (s). */
export const SILENCE_SPLIT = 0.45
/** A pause at least this long gets a transition (a hard cut where the type hits on pauses) (s). */
export const HIT_PAUSE = 0.4
/** The hook is read for at least this long before the voice's words take over (s). */
const HOOK_MIN: Record<HookTreatment, number> = { text: 1.5, question: 1.5, stamp: 1.5, hud: 1.5, counter: 1.6, 'before-after': 1.6 }
/** Without a title, the hook is at most this many spoken words (fix round 1, I1). */
const HOOK_SPEECH_WORDS = 3
/** Hook words are all in by this local time (s). */
const HOOK_IN = 0.3
/** A one-word hook gets an underline accent here (s): a visual change by 0.5 s (I5). */
const HOOK_ACCENT_AT = 0.3
/** …and keeps it this long (s). */
const HOOK_ACCENT_SEC = 0.5
/** قبل/بعد: the split wipe (s). */
const SPLIT_AT = 1.0
/** نتيجة/رقم: the counter takes over (s). */
const HOOK_COUNTER_AT = 0.5
/**
 * Most words in one kinetic-text scene. Short stacks: a word entering a stack registers as a
 * motion event in the review; one entering a long `line` does not (fix round 1 probe).
 */
const MAX_SEG_WORDS = 3
/** Longest kinetic-text scene the recipe makes (s), under KINETIC_MAX_REST_SEC. */
const MAX_KINETIC_SEC = KINETIC_MAX_REST_SEC - 0.5
/**
 * A number said in words becomes a counter only from this value up (fix wave I2): «ثلاثمائة ساعة»
 * is a figure worth rolling; «ثلاث خطوات» or «ست» (also "a lady") are words.
 */
const NUMBER_WORD_MIN = 100
/** A counter holds the screen at least this long before the next words (s). */
const COUNTER_HOLD = 1.4
/** A screen (phone / app window) is shown at most about this long (s). */
const SCREEN_MAX_SEC = 4
/** A screenshot this much wider than tall goes in an app window. */
const LANDSCAPE = 1.15
/** A keyword visual stays at most this long (s), and is dropped below `VISUAL_MIN`. */
const VISUAL_MAX = 3
const VISUAL_MIN = 0.5
/** Motion: no cut on a stressed word less than this after the scene start (s). */
const STRESS_CUT_MIN = 1
/** A checklist row is in and ticked this long after its `at` (CHECKLIST_TIMING rowIn + checkIn) (s). */
const CHECK_IN_SEC = 0.55
/** A checklist ends about this long after its last row's word (s). */
const CHECK_TAIL = 1.2
/**
 * Longest checklist row the recipe writes (characters, whole words). A 20-character row is set at
 * about 64 px at 1080 w (≥ 60 px), a 23-character one at the 57 px floor (fix rounds 2–3).
 */
const CHECK_ITEM_CHARS = 20
/** Words a row never ends on (a dangling particle reads as a cut sentence), normalized. */
const PARTICLES: ReadonlySet<string> = new Set(['في', 'من', 'على', 'الي', 'الى', 'عن', 'مع', 'او', 'ثم', 'لكن', 'و', 'ف', 'ب', 'ل', 'ك', 'ان', 'لا', 'ما', 'قد', 'هل', 'يا', 'الذي', 'التي', 'حتي', 'لان', 'كل', 'بعد', 'قبل'])

/** A stressed word is underlined only when its scene shows it at least this long (s). */
const STRESS_MARK_MIN = 0.5
/** Fix wave I4: a word a chunk, line or row never ends on (PARTICLES). */
const isParticle = (w: string): boolean => PARTICLES.has(normalizeAr(w))

/**
 * A checklist row from spoken words (fix round 3): the ordinal word is dropped (the check box
 * already numbers the row), then whole words up to CHECK_ITEM_CHARS, never ending on a particle.
 * The first word is kept even when longer (cut).
 */
export function rowText(words: readonly string[]): string {
  let ws = words.map((w) => w.replace(/\*/g, '').trim()).filter((w) => normalizeAr(w))
  if (ws.length > 1 && ordinalOf(ws[0]!) >= 0) ws = ws.slice(1)
  const out: string[] = []
  for (const w of ws) {
    if ([...[...out, w].join(' ')].length > CHECK_ITEM_CHARS) break
    out.push(w)
  }
  while (out.length > 1 && PARTICLES.has(normalizeAr(out.at(-1)!))) out.pop()
  return out.length ? out.join(' ') : [...(ws[0] ?? '…')].slice(0, CHECK_ITEM_CHARS).join('')
}
/** R22: a hit-list checklist needs this many distinct visuals over this many words and seconds. */
const HIT_LIST = { visuals: 3, words: 6, sec: 2, afterList: 1.5 } as const
/** Between the last word and the end card (s); the video tail without an end card (s). */
const CTA_GAP = 0.2
const TAIL = 0.5
/** End card lengths (s): comment-cta needs CTA_TIMING.dm[1] (2.05); a text CTA holds ≤ 2 s. */
const CTA_COMMENT_SEC = 2.5
const CTA_TEXT_SEC = 2
/** Pace fillers: a gap between planned events longer than this gets one (s), per intensity. */
const FILLER_SEC: Record<TypePreset['intensity'], number> = { 1: 1.6, 2: 1.3, 3: 0.9, 4: 0.9, 5: 0.8 }
/**
 * Plan 3 Task 7: the signature look's filler threshold (s), under PLAN_MAX_GAP: the review missed a
 * few short words of four-word headline lines in the first signature render (measured gaps 0.97 and
 * 1.0 s where 0.6–0.9 s were planned), so its planned gaps keep this margin.
 */
const SIGNATURE_FILLER_SEC = 0.8
/** A filler lasts at most this long and at least `FILLER_MIN` (its draw is 0.4 s) (s). */
const FILLER_MAX = 1.2
const FILLER_MIN = 0.3
/** Steering never spaces fillers closer than this (each needs FILLER_MIN to draw) (s). */
const MIN_FILLER_SEC = 0.6
/** Backdrop chapter change: the new tone fades in over this long, centred on the cut (s). */
const BG_FADE = 0.4
/** Ordinals that make an enumeration (normalized). */
const ORDINALS = ['اولا', 'ثانيا', 'ثالثا', 'رابعا', 'خامسا', 'سادسا', 'سابعا', 'ثامنا']
/** Words that point at the product on screen (product-launch places screens there first). */
const PRODUCT_STEMS = ['تطبيق', 'برنامج', 'موقع', 'منصه', 'اداه', 'شاشه', 'منتج', 'خدمه', 'لوحه']
/** Chapter colour worlds, in order (a warm, accent-tinted glow first would lower the contrast of the hook's accent strokes). */
const CHAPTER_TONES: readonly BackdropTone[] = ['cool', 'deep', 'warm', 'base']
/**
 * The hook's stamp, below the hook text (at the top it covered the first stacked word); with a
 * stamp the hook text is one line (`line` mode) so the stamp can be large (STAMP_SIZE). At the safe
 * bottom edge the drift fit shrank it to ~20 % of the safe width (fix round 2).
 */
const STAMP_AT = { x: 0.5, y: 0.78 }
const STAMP_SIZE = 0.45
/**
 * Keyword visuals above the text block (fix wave I4: the text now sits lower, centred near
 * TEXT_Y, so the visuals moved down from the top edge of the safe area to sit just above it).
 */
const VISUAL_AT = { x: 0.5, y: 0.23 }
/**
 * Fix wave I4 (critic: composition 6, top-heavy): kinetic text centred near this fraction of the
 * frame height. Rows that have not entered yet hold their place, so a stack is centred lower by
 * TEXT_Y_PER_ROW per extra row: its first word lands near TEXT_Y, the full stack stays centred.
 */
const TEXT_Y = 0.42
const TEXT_Y_PER_ROW = 0.04
/** Fix wave I4: unstressed-word entrances, rotated over the main line's kinetic scenes. */
const ENTERS = ['rise', 'mask', 'pop'] as const
/** Fix wave I4: checklist rows aim at this font size (px at 1080 w). */
const CHECK_ROW_PX = 100

const T_BG = 0
const T_MAIN = 1
const T_VIS = 2
const T_ACCENT = 3
/** Plan 2a+: the hero (under the camera); the HUD moved to 5 (fixed, `CAMERA.fixedTracks`). */
const T_HERO = 4
const T_HUD = 5

/** A section number shows at most this long at its section's first beat (s), near the top of the safe area. */
const SECTION_NUMBER_SEC = 1.6
const SECTION_NUMBER_AT = { x: 0.5, y: 0 }
const SECTION_NUMBER_SIZE = 0.3
/**
 * Ruling T9-c: a section number owns the top SECTION_BAND of the safe height (the primitive's
 * `band`, every format); while it shows, the main line's text sits centred in the rest of the safe
 * area, below a SECTION_GAP margin (the block's drift translate, 36 px at most, fits in it).
 */
export const SECTION_BAND = 0.3
const SECTION_GAP = 0.04
/** Tallest kinetic-text row (KINETIC.maxPx 180 × line-height 1.3, frame px): a planned stack's height. */
export const KINETIC_ROW_PX = 234
/** Shape states sit in the visuals band. */
const SHAPE_AT = { x: 0.5, y: 0.2 }
const SHAPE_SIZE = 0.5
const SHAPE_MAX_SEC = 2.4
/** Kashida: tatweels at the peak (6, or twice the slot count, at most 8) and the longest stretch (s). */
/** @internal (signature.ts) */
export const STRETCH_TO = 6
/** @internal (signature.ts) */
export const STRETCH_MAX = 8
/** @internal (signature.ts) */
export const STRETCH_SEC = 0.8
/** Echo copies behind an `echo-word`. */
/** @internal (signature.ts) */
export const ECHO_COPIES = 2
/** The hero: size (frame width), its rest point (safe fraction) and how long after its last handoff it goes back there (s). */
const HERO_SIZE = 0.04
const HERO_REST = { x: 0.5, y: 0.92 }
const HERO_REST_AFTER = 1
/** Camera: the push zoom, the world zooms per section, the world's push zoom (never above WORLD_MAX). */
const PUSH_ZOOM = 1.12
const WORLD_ZOOMS = [1.04, 1.08, 1.06] as const
const WORLD_PUSH_ZOOM = 1.16
const WORLD_MAX = 1.25
/** A beat is zoomed only when it is a short stack of words of at most this many characters (the zoomed rows stay in the safe area). */
const ZOOM_WORD_CHARS = 7
/** Word walls: alpha behind a beat; alpha and speed behind the comment card (before-E1b fix). */
const WALL_ALPHA = 0.14
const CTA_WALL_ALPHA = 0.1
const CTA_WALL_SPEED = 24
const CTA_WALL_IN = 0.85
/** Planned fillers, non-word transitions and hero rests move to a music beat this close (s). */
const BEAT_SNAP = 0.12
/** The hook family a plan names when the brief names none (a `text` treatment, like V1 without a family). */
const DEFAULT_FAMILY: HookFamily = 'فضول'
/** Section worlds cycle in this order from the look's own (paper) before the first section. */
const WORLD_CYCLE = ['paper', 'ink', 'accent'] as const
const PATTERN_CYCLE: readonly BackdropParams['pattern'][] = ['none', 'dots', 'ridges', 'stripes', 'shapes', 'blobs']
const HERO_SHAPES = ['dot', 'ball', 'square'] as const satisfies readonly HeroParams['shape'][]
const SPAN_KINDS = ['text', 'counter', 'checklist', 'phone', 'app-window'] as const

const DEFAULT_LOOK: Record<BriefType, LookId> = {
  educational: 'paper-editorial',
  informational: 'paper-editorial',
  explainer: 'paper-editorial',
  'product-launch': 'dark-tech',
  motion: 'dark-tech',
  corporate: 'light-editorial',
}
const DEFAULT_CAMERA: Record<BriefType, 'none' | 'push' | 'world'> = {
  corporate: 'none',
  educational: 'none',
  explainer: 'push',
  informational: 'push',
  'product-launch': 'world',
  motion: 'world',
}

/** A time point: what the storyboard says (an anchor or seconds) and what it resolves to (s, unsnapped). */
/** @internal (signature.ts) */
export interface Pt {
  a: Anchor | number
  t: number
}

/** @internal (signature.ts) */
export interface Scene {
  id: string
  type: string
  track: number
  start: Pt
  end: Pt
  params: Record<string, unknown>
  /** An idea set this kinetic scene's entrance (`stageText` keeps it). */
  fixedEnter?: boolean
  /** Plan 3 Task 7: parallax depth (the signature look; 2a+ never sets it). */
  depth?: number
}

/** @internal (signature.ts) */
export interface Trans {
  type: TransitionId
  track: number
  at: Pt
  hit: boolean
  key?: string
  /** Extra params (flood / iris origin and colour). */
  params?: Record<string, unknown>
}

/** A span of the main line over words [from, to). */
/** @internal (signature.ts) */
export interface Span {
  from: number
  to: number
  kind: (typeof SPAN_KINDS)[number]
  params?: Record<string, unknown>
  /** A cut made at a stressed word (motion): a hard cut. */
  stressCut?: boolean
  /** Plan 2a+: the beat's idea (every piece of a beat a giant word splits carries it). */
  idea?: IdeaId
  /** This piece is the beat's giant word. */
  giant?: boolean
  /** This piece starts its beat (a giant word's split pieces after the first do not). */
  head?: boolean
  /** The plan beat this span belongs to (`Beats.infos` index). */
  beat?: number
}

/** A kinetic word: its text, stress and (from the transcript) its index, plus idea effects (stretch, echo, box, strike, punch). */
type KWord = { text: string; stress: 0 | 1 | 2; word?: number; extra?: Record<string, unknown> }

/** Text of a spoken or brief word for kinetic text: stars and edge whitespace removed, ≤ 40 characters. */
/** @internal (signature.ts) */
export function cleanWord(w: string): string | undefined {
  const c = w.replace(/\*/g, '').trim()
  if (!normalizeAr(c)) return undefined
  return [...c].slice(0, 40).join('')
}

/** Words joined, dropping words from the end until it fits `max` characters (one word is cut). */
function fit(words: string[], max: number): string {
  const ws = words.map((w) => w.replace(/\*/g, '').trim()).filter(Boolean)
  while (ws.length > 1 && [...ws.join(' ')].length > max) ws.pop()
  return [...(ws.join(' ') || '…')].slice(0, max).join('')
}

const ordinalOf = (token: string) => {
  const c = stripClitics(token)
  return ORDINALS.findIndex((o) => c.includes(o))
}

const earliest = (...ps: Pt[]): Pt => ps.reduce((m, p) => (p.t < m.t ? p : m))
/** @internal (signature.ts) */
export const r3 = (t: number) => Math.round(t * 1000) / 1000
/** `p` plus `d` s, as the same kind of anchor (an offset on a word anchor, else seconds). */
const later = (p: Pt, d: number): Pt =>
  typeof p.a === 'number' ? { a: r3(p.a + d), t: p.t + d } : { a: { ...p.a, offset: r3(((p.a as { offset?: number }).offset ?? 0) + d) } as Anchor, t: p.t + d }

// ---------------------------------------------------------------------------------------------
// plan.json

const visualSchema = z.union([
  z.object({ type: z.literal('icon'), icon: z.enum(ICON_NAMES) }),
  z.object({ type: z.literal('line-art'), art: z.enum(LINE_ART_NAMES) }),
  z.object({ type: z.literal('counter') }),
  z.object({ type: z.literal('ui') }),
])
const HOOK_IDS = HOOK_FAMILIES_AR.map((h) => h.id) as [HookFamily, ...HookFamily[]]
const HOOK_TREATMENTS = ['counter', 'stamp', 'hud', 'question', 'before-after', 'text'] as const satisfies readonly HookTreatment[]

/** `plan.json`: what `mba explain --plan` writes and `mba explain` compiles (a person may edit it). */
export const planSchema = z.object({
  version: z.literal(1),
  /** sha1 of the `transcript.json` bytes the plan was made for (`mba explain` refuses a stale plan). */
  transcriptHash: z.string().min(1),
  type: z.enum(BRIEF_TYPES),
  format: z.enum(FORMATS),
  look: z.enum(LOOK_IDS),
  seed: z.number().int(),
  hook: z.object({ family: z.enum(HOOK_IDS), text: z.string().trim().min(1).max(200), treatment: z.enum(HOOK_TREATMENTS) }),
  /**
   * Plan 3 Task 7, the `signature` look (concept first): the script's main idea, its central
   * metaphor and the story arc (one line per section) Claude writes before choosing any visual
   * (`engine/review/DIRECTOR.md`). `mba explain --plan` writes it empty; the beats' `visual`s follow from it.
   */
  concept: conceptSchema.optional(),
  sections: z.array(z.object({ title: z.string(), word: z.number().int().min(0), world: z.enum(BACKDROP_WORLDS), pattern: z.enum(BACKDROP_PATTERNS) })),
  beats: z.array(
    z.object({
      i: z.number().int().min(0),
      from: z.number().int().min(0),
      to: z.number().int().min(0),
      kind: z.enum(SPAN_KINDS),
      idea: z.enum(IDEA_IDS).optional(),
      /**
       * 2a+: the beat's keyword visual (`type`: icon / line-art / counter / ui; informational). Plan 3
       * Task 7, the `signature` look: the director's choice (`kind`: object / chase / wall / loop /
       * particles / none), compiled exactly as written; absent → the default director's.
       */
      // Picked by its key (`kind` → VisualChoice, else 2a+), so an error names the bad field, not "Invalid input".
      visual: z
        .unknown()
        .transform((v, ctx): z.output<typeof visualSchema> | z.output<typeof visualChoiceSchema> => {
          const r = (typeof v === 'object' && v !== null && 'kind' in v ? visualChoiceSchema : visualSchema).safeParse(v)
          if (r.success) return r.data
          for (const issue of r.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path as (string | number)[] })
          return z.NEVER
        })
        .optional(),
      words: z.array(z.string()),
    }),
  ),
  hero: z.object({ shape: z.enum(HERO_SHAPES), handoffBeats: z.array(z.number().int().min(0)), loop: z.boolean() }).optional(),
  camera: z.enum(['none', 'push', 'world']),
  transitions: z.array(z.enum(TRANSITION_IDS)),
  signature: z.array(z.enum(IDEA_IDS)),
  wordsPerShot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  punchScale: z.number().min(1.1).max(1.5),
  beat: z.object({ bpm: z.number().min(40).max(220), offset: z.number().min(0) }).optional(),
  warnings: z.array(z.string()),
})

export type ExplainPlan = z.output<typeof planSchema>

/** Validates a plan (Arabic-first errors); idempotent on a parsed plan. */
export function parsePlan(json: unknown): ExplainPlan {
  const r = planSchema.safeParse(json)
  if (!r.success) {
    const issue = r.error.issues[0]!
    throw new Error(`ملف الخطة غير صالح — Invalid plan.json: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  return r.data
}

const EMPTY_TRANSCRIPT = 'التفريغ لا يحتوي على كلمات؛ لا يمكن بناء الفيديو — the transcript has no words; there is nothing to explain'

/** Per beat (0 = the hook, then every main-line span): what the director reads. */
/** @internal (signature.ts) */
export interface Beats {
  infos: BeatInfo[]
  kinds: Span['kind'][]
  /** Length (s). */
  secs: number[]
  cuts: ('none' | 'cut' | 'hit' | 'section')[]
  /** A short stack of short words: safe under a camera zoom. */
  zoomSafe: boolean[]
}

/** @internal (signature.ts) */
export function beatsOf(c: Ctx, hook: Hook, spans: Span[]): Beats {
  const hits = matchKeywords(c.W).filter((h) => h.visual.type !== 'counter')
  const ranges: { from: number; to: number; kind: Span['kind']; stressCut?: boolean }[] = [{ from: 0, to: hook.end, kind: 'text' }, ...spans]
  const infos = ranges.map((r, x): BeatInfo => {
    const ks = Array.from({ length: Math.max(0, r.to - r.from) }, (_, q) => r.from + q)
    const ui = ks.filter((k) => isUiWord(c.W[k]!.text) && !hits.some((h) => h.word === k && h.visual.type === 'ui'))
    return {
      i: x,
      from: r.from,
      to: r.to,
      words: ks.map((k) => cleanWord(c.W[k]!.text) ?? c.W[k]!.text),
      stress: ks.filter((k) => c.stress.has(k)),
      numbers: ks.filter((k) => c.numberAt(k) !== null),
      keywords: [...hits.filter((h) => h.word >= r.from && h.word < r.to), ...ui.map((k) => ({ word: k, visual: { type: 'ui' } as Visual }))].sort((a, b) => a.word - b.word),
    }
  })
  c.sections.forEach((s, j) => {
    const b = infos.find((x) => x.from <= s.word && s.word < x.to) ?? infos.find((x) => x.from === s.word)
    if (b && b.section === undefined) Object.assign(b, { section: s.title, sectionIndex: j })
  })
  return {
    infos,
    kinds: ranges.map((r) => r.kind),
    secs: ranges.map((r, x) => r3((x === 0 ? hook.until.t : c.startOf(r.to).t - c.W[r.from]!.start) || 0)),
    cuts: ranges.map((r, x) => {
      if (x === 0) return 'none'
      const k = cutKind(c, r.from, r.stressCut === true)
      return c.sectionAt.has(r.from) ? 'section' : k.hit ? 'hit' : k.want ? 'cut' : 'none'
    }),
    zoomSafe: ranges.map((r, x) => x > 0 && r.kind === 'text' && r.to - r.from <= MAX_SEG_WORDS && infos[x]!.words.every((w) => [...w].length <= ZOOM_WORD_CHARS)),
  }
}

/** Section j's world and pattern: worlds cycle from the look's own (paper) before the first section, patterns from a seeded start. */
/** @internal (signature.ts) */
export function sectionLooks(c: Ctx, R: () => number): ExplainPlan['sections'] {
  const w0 = c.sections[0]?.word === 0 ? 0 : 1
  const p0 = Math.floor(R() * PATTERN_CYCLE.length)
  return c.sections.map((s, j) => ({ title: s.title, word: s.word, world: WORLD_CYCLE[(j + w0) % WORLD_CYCLE.length]!, pattern: PATTERN_CYCLE[(p0 + j) % PATTERN_CYCLE.length]! }))
}

/** Sections whose backdrop starts at a cut (V1's chapter rule): each flips the world. */
/** @internal (signature.ts) */
export const flipSections = (c: Ctx) => c.sections.map((s, j) => ({ s, j })).filter(({ s }) => s.word > 0 && c.W[s.word]!.start >= BG_FADE)

/** The signature moments of a plan in time order, with their Arabic labels (the CLI prints them). */
function signatureOf(c: Ctx, plan: Pick<ExplainPlan, 'beats' | 'sections' | 'hero'>, infos: BeatInfo[]): { id: IdeaId; label: string }[] {
  const out: { id: IdeaId; label: string }[] = []
  const flips = new Set(flipSections(c).map((f) => f.j))
  const firstHandoff = plan.hero?.handoffBeats.length ? Math.min(...plan.hero.handoffBeats) : -1
  const word = (k: number | undefined) => (k === undefined ? '' : ` «${cleanWord(c.W[k]!.text) ?? ''}»`)
  plan.beats.forEach((b, x) => {
    const info = infos[x]
    for (const [j, s] of c.sections.entries()) {
      if (flips.has(j) && info && info.from <= s.word && s.word < Math.max(info.to, info.from + 1)) out.push({ id: 'world-flip', label: `${IDEAS['world-flip'].ar} (${plan.sections[j]?.world ?? 'paper'})` })
    }
    const id = b.idea
    if (id && IDEAS[id].signature && info) {
      const label =
        id === 'kashida-stretch'
          ? `${IDEAS[id].ar}${word(stretchableWord(info))}`
          : id === 'section-number'
            ? `${IDEAS[id].ar} ${String((info.sectionIndex ?? 0) + 1).padStart(2, '0')}`
            : id === 'word-wall' || id === 'camera-push'
              ? `${IDEAS[id].ar}${word(mainWord(info))}`
              : IDEAS[id].ar
      out.push({ id, label })
    }
    if (x === firstHandoff) out.push({ id: 'hero-handoff', label: IDEAS['hero-handoff'].ar })
  })
  return out
}

/**
 * The plan of an explainer: V1's reading of the transcript (hook, claims, spans → beats) and the
 * creative director's ideas (`directBeats`), section worlds and patterns, the hero, the camera mode,
 * the transitions it may use, the style's words per shot and punch, and the signature moments
 * (warned about when fewer than the type's minimum).
 */
export function planExplainer(i: ExplainInput): ExplainPlan {
  const brief0 = parseBrief(i.brief)
  if (i.transcript.words.length === 0) throw new Error(EMPTY_TRANSCRIPT)
  const type = brief0.type
  const preset = TYPE_PRESETS[type]
  const targets = i.style ? styleTargets(i.style) : undefined
  const wordsPerShot = targets?.wordsPerShot ?? (preset.intensity <= 2 ? 2 : 3)
  const punchScale = targets?.punchScale ?? 1.3
  const camera = brief0.camera ?? DEFAULT_CAMERA[type]
  const family = brief0.hook?.family ?? DEFAULT_FAMILY
  const brief: Brief = { ...brief0, hook: { ...brief0.hook, family } }
  const warnings: string[] = []
  const c = context(i, brief, preset, warnings, wordsPerShot)
  if (type === 'product-launch') {
    if (!c.sections.length) {
      warnings.push('موجز إطلاق منتج بلا أقسام «# » في script.md: لا ضربات عند الفصول — product-launch brief without `# ` sections in script.md: no section hits (problem → chaos → ask → product → payoff)')
    }
    if (!brief.screens?.length) {
      warnings.push('موجز إطلاق منتج بلا لقطات شاشة (screens): المنتج لا يظهر وهو يعمل — product-launch brief without screens: the product is never shown at work')
    }
  }
  if ((brief.look ?? DEFAULT_LOOK[type]) === 'signature') return planSignature(i, brief, warnings, { type, camera, family, wordsPerShot, punchScale })
  const hook = planHook(c)
  const claims = planClaims(c, hook.end)
  const spans = planSpans(c, hook.end, claims)
  const B = beatsOf(c, hook, spans)
  const R = rng(i.seed)
  const sections = sectionLooks(c, R)
  const heroForced = brief.hero === true || typeof brief.hero === 'string'
  const dctx: DirectorCtx = {
    type,
    hero: heroForced,
    camera,
    heroAllowed: brief.hero !== false,
    signatureMin: signatureMinOf(preset, c.videoEnd.t),
    prefer: i.style?.signature ?? [],
    beatSec: B.secs,
    kinds: B.kinds,
    cuts: B.cuts,
    worldFlips: flipSections(c).length,
    zoomSafe: B.zoomSafe,
  }
  const dir = directBeats(B.infos, dctx, R)
  const handoffs = dir.flatMap((d, x) => (d.handoff ? [x] : []))
  B.infos.forEach((b, x) => {
    if (dir[x]!.idea === 'section-number' && b.sectionIndex !== undefined && numberBeat(B, dir.map((d) => d.idea), x) < 0) warnings.push(numberDropped(b.sectionIndex))
  })
  const hero = brief.hero !== false && handoffs.length ? { shape: typeof brief.hero === 'string' ? brief.hero : ('dot' as const), handoffBeats: handoffs, loop: brief.loop ?? false } : undefined
  if (heroForced && !hero) warnings.push('لا توجد كلمات يهبط عليها البطل؛ لا بطل في الفيديو — the hero has no words to land on (no kinetic-text beat): no hero')
  const visualOf = (b: BeatInfo) => b.keywords.find((h) => h.visual.type === 'icon' || h.visual.type === 'line-art')?.visual
  const beats: ExplainPlan['beats'] = B.infos.map((b, x) => {
    const idea = dir[x]!.idea
    const visual = visualOf(b)
    return { i: x, from: b.from, to: b.to, kind: B.kinds[x]!, ...(idea ? { idea } : {}), ...(visual ? { visual } : {}), words: b.words }
  })
  const transitions: TransitionId[] = [
    ...preset.transitions,
    ...(beats.some((b) => b.idea === 'flood') && !preset.transitions.includes('flood') ? (['flood'] as const) : []),
    ...(beats.some((b) => b.idea === 'iris-open') && !preset.transitions.includes('iris') ? (['iris'] as const) : []),
  ]
  const signature = signatureOf(c, { beats, sections, ...(hero ? { hero } : {}) }, B.infos).map((s) => s.id)
  const min = dctx.signatureMin!
  if (signature.length < min) {
    warnings.push(`لحظات مميزة أقل من الحد (${signature.length}/${min}) — fewer signature moments than the type's minimum (${signature.length}/${min})`)
  }
  return {
    version: 1,
    transcriptHash: i.transcriptSha1 ?? transcriptHash(i.transcript),
    type,
    format: brief.format ?? '9:16',
    look: brief.look ?? DEFAULT_LOOK[type],
    seed: i.seed,
    hook: { family, text: hook.words.map((w) => w.text).join(' '), treatment: hook.treatment },
    sections,
    beats,
    ...(hero ? { hero } : {}),
    camera,
    transitions,
    signature,
    wordsPerShot,
    punchScale,
    ...(brief.beat ? { beat: { bpm: brief.beat.bpm, offset: brief.beat.offset ?? 0 } } : {}),
    warnings,
  }
}

/** The brief a plan compiles with: the input's brief with the plan's type, format, look and hook. */
function planBrief(plan: ExplainPlan, i: ExplainInput): Brief {
  const brief0 = parseBrief(i.brief)
  const brief: Brief = { ...brief0, type: plan.type, format: plan.format, look: plan.look, hook: { family: plan.hook.family, ...(brief0.hook?.text ? { text: brief0.hook.text } : {}) } }
  // A hook text edited in plan.json wins over the brief's (or the spoken words).
  const shown = planHook(context(i, brief, TYPE_PRESETS[plan.type], [], plan.wordsPerShot)).words.map((w) => w.text).join(' ')
  return shown === plan.hook.text ? brief : { ...brief, hook: { family: plan.hook.family, text: plan.hook.text } }
}

/** The signature moments of a plan, as the CLI prints them («تمديد «المال»، رقم القسم 02، …»). */
export function signatureLabels(plan: ExplainPlan, i: ExplainInput): string[] {
  const p = parsePlan(plan)
  if (p.look === 'signature') return signatureMoments(p, i, planBrief(p, i))
  const c = context(i, planBrief(p, i), TYPE_PRESETS[p.type], [], p.wordsPerShot)
  const hook = planHook(c)
  const B = beatsOf(c, hook, planSpans(c, hook.end, planClaims(c, hook.end)))
  return signatureOf(c, p, B.infos).map((s) => s.label)
}

/**
 * The storyboard of a plan (`edit.json` content): V1's composition with the plan's ideas, steered
 * like V1 (word grouping when the planned median is too fast, denser pace fillers when too slow or
 * when a gap passes PLAN_MAX_GAP at intensity ≥ 3). An idea a beat cannot carry (a hand edit) is
 * dropped with a warning and the beat shows as its kind. Compile warnings go to `i.warnings`.
 */
export function compilePlan(p: ExplainPlan, i: ExplainInput): unknown {
  const plan = parsePlan(p)
  if (i.transcript.words.length === 0) throw new Error(EMPTY_TRANSCRIPT)
  const brief = planBrief(plan, i)
  const preset = TYPE_PRESETS[plan.type]
  const [lo, hi] = preset.medianGap
  let groupSec = preset.intensity <= 2 ? lo : 0
  // Plan 3 Task 7: the signature look composes its own storyboard (hero objects, headlines on the
  // fixed track, reveals) and is steered on the longest gap only: its fillers (underlines of the word
  // just spoken, on that track) go where a gap passes SIGNATURE_FILLER_SEC. The planned median leaves out the
  // objects' own motion (measured on the approved voice-1 render t6b-v1: median 0.4 s with no
  // filler at all), so it neither steers nor warns there.
  const sig = plan.look === 'signature'
  let fillerSec = sig ? SIGNATURE_FILLER_SEC : FILLER_SEC[preset.intensity]
  let best: { json: unknown; sb: Storyboard; warnings: string[] } | undefined
  for (let iter = 0; iter < 12; iter++) {
    const warnings: string[] = []
    const draft = sig ? composeSignature(i, brief, preset, plan, warnings) : compose(i, brief, preset, plan, groupSec, warnings)
    best = { ...withFillers(draft, i, fillerSec, draft.snap), warnings }
    if (sig) break
    const pace = plannedPace(best.sb)
    const m = pace.medianEventGap
    if (m < lo - 1e-9 && groupSec < 1.2) groupSec = r3(groupSec + 0.08)
    else if (m > hi - PLAN_BIAS + 1e-9 && fillerSec > MIN_FILLER_SEC + 1e-9) fillerSec = r3(Math.max(MIN_FILLER_SEC, fillerSec - 0.1))
    else if (preset.intensity >= 3 && pace.maxEventGap > PLAN_MAX_GAP + 1e-9 && fillerSec > MIN_FILLER_SEC + 1e-9) fillerSec = r3(Math.max(MIN_FILLER_SEC, fillerSec - 0.1))
    else break
  }
  const m = plannedPace(best!.sb).medianEventGap
  if (!sig && (m < lo - 1e-9 || m > hi - PLAN_BIAS + 1e-9)) {
    best!.warnings.push(
      `الإيقاع المخطط (${m} ث) لا يضمن نطاق نوع «${brief.type}» (${lo}–${hi} ث) — planned median event gap ${m} s may fall outside the ${brief.type} range ${lo}–${hi} s ` +
        `(the review measures about ${PLAN_BIAS} s slower); the voice's pace decides, check mba review`,
    )
  }
  i.warnings?.push(...best!.warnings)
  return best!.json
}

// ---------------------------------------------------------------------------------------------
// Composition

/** Everything the composition steps share. */
/** @internal (signature.ts) */
export interface Ctx {
  i: ExplainInput
  brief: Brief
  preset: TypePreset
  warnings: string[]
  /**
   * Transcript words with the text shown on screen: the script's spelling where `marks.display`
   * has one (fix wave I2: «علّق», not whisper's «علك»), else whisper's. Times are the transcript's.
   */
  W: readonly TranscriptWord[]
  /** The transcript's own words (whisper's text: counters read their digits here). */
  raw: readonly TranscriptWord[]
  /** Words that end a sentence (`marks.stops`): a chunk never runs past one (critic round 2). */
  stops: ReadonlySet<number>
  n: number
  stress: ReadonlySet<number>
  sections: { title: string; word: number }[]
  sectionAt: ReadonlyMap<number, string>
  pauseBefore: ReadonlyMap<number, number>
  beatStarts: ReadonlySet<number>
  starts: number[]
  speechEnd: Pt
  videoEnd: Pt
  ctaKind: 'comment' | 'text' | undefined
  wStart(k: number): Pt
  wEnd(k: number, off: number): Pt
  startOf(k: number): Pt
  beatOf(k: number): number
  beatEnd(k: number): number
  valueOf(token: string): number | null
  /**
   * The number spoken as word k: whisper's digits first (counters keep them), then the shown text,
   * then a spelled-out number of at least NUMBER_WORD_MIN («ثلاثمائة» when whisper writes words),
   * composed over the words it spans (R28: «ألف وخمسمية» = 1500 over 2 words; a bare «مية» only
   * before a unit noun). `count` = words the number covers.
   */
  numberAt(k: number): { value: number; count: number } | null
  id(prefix: string): string
  /** Most words in one kinetic chunk (Plan 2a+: the style's words per shot; V1: MAX_SEG_WORDS). */
  segWords: number
  /** Snaps a planned (not word-anchored) time to the music's beat (identity by default). */
  snap: (t: number) => number
}

/** @internal (signature.ts) */
export const AT0: Pt = { a: 0, t: 0 }
/** @internal (signature.ts) */
export const sec = (t: number): Pt => ({ a: r3(t), t: r3(t) })

/** @internal (signature.ts) */
export function context(i: ExplainInput, brief: Brief, preset: TypePreset, warnings: string[], segWords: number = MAX_SEG_WORDS): Ctx {
  const raw = i.transcript.words
  const shown = new Map((i.marks.display ?? []).map((d) => [d.word, d.text]))
  const W = raw.map((w, k) => {
    const text = shown.get(k)
    return text !== undefined && cleanWord(text) !== undefined ? { ...w, text } : w
  })
  const n = W.length
  const sections = (i.marks.sections ?? []).filter((s) => s.word < n)
  const wStart = (k: number): Pt => ({ a: { word: k }, t: W[k]!.start })
  const wEnd = (k: number, off: number): Pt => ({ a: { word: k, edge: 'end', offset: r3(off) }, t: W[k]!.end + r3(off) })
  const ctaKind = brief.cta?.keyword ? 'comment' : brief.cta?.text ? 'text' : undefined
  const speechEnd = wEnd(n - 1, ctaKind ? CTA_GAP : TAIL)
  const videoEnd = ctaKind ? wEnd(n - 1, CTA_GAP + (ctaKind === 'comment' ? CTA_COMMENT_SEC : CTA_TEXT_SEC)) : speechEnd
  const pauseBefore = new Map<number, number>()
  for (const p of i.marks.pauses) if (p.after + 1 < n) pauseBefore.set(p.after + 1, p.gap)
  const beatStarts = new Set<number>([0, ...pauseBefore.keys(), ...sections.map((s) => s.word)])
  for (let k = 1; k < n; k++) if (W[k]!.start - W[k - 1]!.end >= SILENCE_SPLIT - 1e-9) beatStarts.add(k)
  const starts = [...beatStarts].filter((k) => k < n).sort((a, b) => a - b)
  const numberKeys = Object.entries(brief.numbers ?? {}).map(([k, v]) => [normalizeAr(k), v] as const)
  let sid = 0
  const valueOf = (token: string) => {
    const cands = new Set([normalizeAr(token), ...stripClitics(token)])
    const named = numberKeys.find(([k]) => cands.has(k))
    return named ? named[1] : numberValue(token)
  }
  return {
    i,
    brief,
    preset,
    warnings,
    W,
    raw,
    stops: new Set(i.marks.stops ?? []),
    n,
    stress: new Set(i.marks.stress),
    sections,
    sectionAt: new Map(sections.map((s) => [s.word, s.title])),
    pauseBefore,
    beatStarts,
    starts,
    speechEnd,
    videoEnd,
    ctaKind,
    wStart,
    wEnd,
    startOf: (k) => (k < n ? wStart(k) : speechEnd),
    beatOf: (k) => {
      let b = 0
      starts.forEach((s, j) => {
        if (s <= k) b = j
      })
      return b
    },
    beatEnd: (k) => starts.find((s) => s > k) ?? n,
    valueOf,
    numberAt: (k) => {
      const v = valueOf(raw[k]!.text) ?? valueOf(W[k]!.text)
      if (v !== null) return { value: v, count: 1 }
      return (
        spelledNumberAt(
          raw.map((w) => w.text),
          k,
          NUMBER_WORD_MIN,
        ) ??
        spelledNumberAt(
          W.map((w) => w.text),
          k,
          NUMBER_WORD_MIN,
        )
      )
    },
    id: (p) => `${p}${++sid}`,
    segWords,
    snap: (t) => t,
  }
}

/** @internal (signature.ts) */
export interface Draft {
  head: Record<string, unknown>
  scenes: Scene[]
  transitions: Trans[]
  tail: Record<string, unknown>
  /** The storyboard's camera (JSON), when the plan moves it. */
  camera?: Record<string, unknown>
  /** Snaps a planned time to the music's beat (identity without `plan.beat`). */
  snap: (t: number) => number
  /**
   * Plan 3 Task 7: where pace fillers go (default: hosts on T_MAIN, highlights on T_ACCENT, the
   * host's key); the signature look underlines the word just spoken on its own fixed headline track
   * (`host` / `target` get the host scene and the scene-local time).
   */
  fill?: { hostTrack: number; track: number; host?: (s: Scene, t: number) => boolean; target?: (s: Scene, t: number) => string | undefined }
}

/** The plan's ideas per beat, each checked against the beat it names (`ideaFits`); a misfit is warned about and dropped. */
/** @internal (signature.ts) */
export function ideasOf(plan: ExplainPlan, B: Beats, ctx: DirectorCtx, warnings: string[]): (IdeaId | undefined)[] {
  const out: (IdeaId | undefined)[] = B.infos.map(() => undefined)
  for (const pb of plan.beats) {
    if (!pb.idea) continue
    const x = B.infos.findIndex((b) => b.from === pb.from && b.to === pb.to)
    const text = pb.words.join(' ')
    if (x < 0) {
      warnings.push(`المقطع ${pb.i} («${text}») لا يطابق مقاطع التفريغ؛ تُتجاهل فكرته — plan beat ${pb.i} (words ${pb.from}–${pb.to}) matches no beat of the transcript; its idea "${pb.idea}" is ignored`)
      continue
    }
    if (!ideaFits(pb.idea, B.infos[x]!, B.kinds[x]!, ctx)) {
      warnings.push(
        `الفكرة «${IDEAS[pb.idea].ar}» لا تناسب المقطع ${x} («${text}»)؛ يُعرض كما هو — idea "${pb.idea}" does not fit beat ${x} ("${text}"): it shows as its kind (${B.kinds[x]})`,
      )
      continue
    }
    out[x] = pb.idea
  }
  return out
}

/** Beat time points: start, end (the next beat's start). */
function beatPts(c: Ctx, hook: Hook, b: BeatInfo): { start: Pt; end: Pt } {
  return b.i === 0 ? { start: AT0, end: hook.until } : { start: c.wStart(b.from), end: c.startOf(b.to) }
}

/**
 * V1's composition (Task 10) with the plan's ideas: the spans of a `giant-word` beat split around
 * its giant word; kinetic words carry `word`/`key` and their beat's word effects (stretch, echo,
 * box, strike, punch); section numbers, shape states, word walls, the hero, flood / iris cuts, the
 * section worlds and the camera.
 */
function compose(i: ExplainInput, brief: Brief, preset: TypePreset, plan: ExplainPlan, groupSec: number, warnings: string[]): Draft {
  const c = context(i, brief, preset, [], plan.wordsPerShot)
  const snap = (t: number): number => {
    if (!plan.beat) return t
    const period = 60 / plan.beat.bpm
    const b = plan.beat.offset + Math.round((t - plan.beat.offset) / period) * period
    return Math.abs(b - t) <= BEAT_SNAP + 1e-9 && b >= 0 ? r3(b) : t
  }
  c.snap = snap
  const hook = planHook(c)
  const claims = planClaims(c, hook.end)
  const spans0 = planSpans(c, hook.end, claims)
  const B = beatsOf(c, hook, spans0)
  const dctx: DirectorCtx = { type: plan.type, hero: plan.hero !== undefined, camera: plan.camera }
  const ideas = ideasOf(plan, B, dctx, warnings)

  // A giant word stands alone: its beat splits around it.
  const spans: Span[] = []
  spans0.forEach((s, j) => {
    const x = j + 1
    const idea = ideas[x]
    const k = idea === 'giant-word' ? mainWord(B.infos[x]!) : undefined
    if (k === undefined) {
      spans.push({ ...s, ...(idea ? { idea } : {}), beat: x })
      return
    }
    const pieces = [
      { from: s.from, to: k },
      { from: k, to: k + 1, giant: true },
      { from: k + 1, to: s.to },
    ].filter((q) => q.to > q.from)
    pieces.forEach((q, n) => spans.push({ ...(n === 0 ? s : { kind: 'text' as const }), from: q.from, to: q.to, idea: 'giant-word', beat: x, ...(q.giant ? { giant: true } : {}), ...(n > 0 ? { head: false } : {}) }))
  })
  const lead = wordGroups(c, spans, groupSec)
  const R = rng(i.seed)
  const nonMorph = plan.transitions.filter((t) => t !== 'morph' && t !== 'flood' && t !== 'iris')
  // Critic round 2: the cuts rotate through the type's transitions (seeded start), never the same
  // one twice in a row (zoom-through came back at both section cuts).
  let tn = Math.floor(R() * Math.max(1, nonMorph.length))
  const pick = (): TransitionId => nonMorph[tn++ % Math.max(1, nonMorph.length)] ?? 'color-wipe'

  const hookPart = hookScenes(c, hook, claims)
  const spanScene = new Map<Span, Scene>()
  const marked = new Set(visualHits(c, hook.end, claims).filter((h) => isMark(h.visual)).map((h) => h.word))
  for (const s of spans) spanScene.set(s, spanToScene(c, s, lead, marked, plan, B.infos[s.beat!]!, warnings))
  const main = [...hookPart.main, ...spans.map((s) => spanScene.get(s)!), ...ctaScenes(c)]
  stageText(main, R)

  // The hero, before the cuts: a flood or iris opens where it is.
  const handoff = new Set<number>()
  for (const h of plan.hero?.handoffBeats ?? []) {
    const pb = plan.beats[h]
    const x = pb ? B.infos.findIndex((b) => b.from === pb.from && b.to === pb.to) : -1
    if (x > 0 && B.kinds[x] === 'text') handoff.add(x)
  }
  ideas.forEach((id, x) => id === 'hero-handoff' && handoff.add(x))
  const hero = plan.hero ? heroScene(c, plan, B, [...handoff].sort((a, b) => a - b), snap) : undefined
  if (plan.hero && !hero) warnings.push('لا توجد كلمات يهبط عليها البطل؛ لا بطل في الفيديو — the hero has no words to land on: no hero')

  const morphN = { n: 0 }
  const transitions = [...hookPart.transitions, ...mainCuts(c, spans, spanScene, pick, morphN, hero?.origin)]
  const vis = keywordVisuals(c, hook.end, claims, lead, morphN)
  transitions.push(...vis.transitions)

  // Idea overlays: section numbers and shape states in the visuals band, word walls behind the main line.
  const band: Scene[] = []
  const walls: Scene[] = []
  B.infos.forEach((b, x) => {
    const id = ideas[x]
    const { start, end } = beatPts(c, hook, b)
    if (id === 'section-number' && b.sectionIndex !== undefined) {
      // Ruling T9-c: the number shows over a plain text beat of its section (a hook section: after the
      // hook; never over a giant or stretched word, a counter or a screen), for at most SECTION_NUMBER_SEC.
      const y = numberBeat(B, ideas, x)
      if (y < 0) {
        const w = numberDropped(b.sectionIndex)
        if (!plan.warnings.includes(w)) warnings.push(w)
      } else {
        const at = beatPts(c, hook, B.infos[y]!)
        const stop = earliest(at.end, later(at.start, SECTION_NUMBER_SEC))
        const title = fit(splitWords(plan.sections[b.sectionIndex]?.title ?? b.section ?? ''), 40)
        band.push({ id: c.id('n'), type: 'section-number', track: T_VIS, start: at.start, end: stop, params: { number: Math.min(99, b.sectionIndex + 1), title, at: SECTION_NUMBER_AT, size: SECTION_NUMBER_SIZE, band: SECTION_BAND, enter: 'mask-line' } })
      }
    }
    if (id === 'shape-states') {
      // The shape outlives its (short) chunk: until the end of its text run, at most SHAPE_MAX_SEC.
      const runTo = Math.min(c.beatEnd(b.from), ...claims.filter((x) => x.from > b.from).map((x) => x.from))
      const stop = earliest(c.startOf(runTo), { a: { word: b.from, offset: SHAPE_MAX_SEC }, t: c.W[b.from]!.start + SHAPE_MAX_SEC })
      const sc = shapeStates(c, b.from, runTo, start, stop.t > end.t ? stop : end)
      if (sc) band.push(sc)
      else warnings.push(`لا وقت لحالات الشكل في المقطع ${x} — beat ${x} is too short for shape-states; it shows as its kind`)
    }
    if (id === 'word-wall') {
      const k = mainWord(b)
      const text = k === undefined ? undefined : cleanWord(c.W[k]!.text)
      if (text) walls.push({ id: c.id('ww'), type: 'word-wall', track: T_BG, start, end, params: { text: [...text].slice(0, 24).join(''), rows: 6, cols: 2, alpha: WALL_ALPHA } })
    }
  })
  belowBand(plan.format, main, band)
  // Before-E1b: the comment card's sparse stretch gets its keyword as a moving wall behind it. It
  // comes in CTA_WALL_IN s into the card, between the keyword wipe and the post (measured: that
  // entrance registers as an event in dark-tech and paper-editorial; a wall from the card's start
  // left a 1.0 s gap in dark-tech).
  if (c.ctaKind === 'comment') {
    walls.push({ id: 'cta-wall', type: 'word-wall', track: T_BG, start: later(c.speechEnd, CTA_WALL_IN), end: c.videoEnd, params: { text: c.brief.cta!.keyword!, rows: 6, cols: 2, speed: CTA_WALL_SPEED, alpha: CTA_WALL_ALPHA } })
  }
  // Keyword visuals give way to the band ideas and to giant words.
  const busy = [...band, ...spans.filter((s) => s.giant).map((s) => spanScene.get(s)!)].map((s) => [s.start.t, s.end.t] as const)
  const visScenes = vis.scenes.filter((v) => !busy.some(([a, b]) => v.start.t < b - 1e-9 && a < v.end.t - 1e-9))

  const accents = [...hookPart.accents, ...stressHighlights(c, spans, spanScene, lead)]
  const huds = hudScenes(c, hook, claims)
  const halftone = new Set(B.infos.flatMap((b, x) => (ideas[x] === 'halftone-react' ? [sectionIndexAt(c, b.from)] : [])))
  const backdrops = backdropScenes(c, plan, hero ? 'hero' : undefined, halftone)
  const numbered = new Set(band.filter((s) => s.type === 'section-number').flatMap((n) => B.infos.flatMap((b, x) => (x > 0 && Math.abs(c.W[b.from]!.start - n.start.t) < 1e-9 ? [x] : []))))
  const camera = cameraOf(c, plan, B, ideas, numbered)

  // I3: the transcript the word anchors are written for (`loadStoryboardFile` warns on another one).
  const head = {
    version: 1,
    format: plan.format,
    fps: i.fps,
    look: plan.look,
    dir: 'rtl',
    seed: i.seed,
    transcript: { sourceHash: i.transcript.sourceHash, words: i.transcript.words.length, hash: transcriptHash(i.transcript) },
  }
  const audio: Record<string, unknown>[] = [{ kind: 'voice', media: i.voiceMedia }]
  if (brief.musicMedia) audio.push({ kind: 'music', media: brief.musicMedia, in: brief.musicFrom ?? 0 })
  const tail: Record<string, unknown> = { audio, ...(preset.sfxOffsetDb !== 0 ? { sfxGainDb: preset.sfxOffsetDb } : {}) }
  const overlays = [...hookPart.overlays, ...band, ...visScenes]
  for (const a of accents) if (a.type === 'highlight') Object.assign(a.params, markColour(backdrops, a.start.t))
  const kept = validTransitions(transitions, [...main, ...overlays], i.fps)
  for (const tr of transitions) {
    if ((tr.type === 'flood' || tr.type === 'iris') && !kept.some((k) => k.type === tr.type && Math.abs(k.at.t - tr.at.t) < 1e-9)) {
      warnings.push(`لا مكان لانتقال ${tr.type} عند ${r3(tr.at.t)} ث — no room for the ${tr.type} cut at ${r3(tr.at.t)} s (the scenes around it are too short)`)
    }
  }
  return {
    head,
    scenes: [...backdrops, ...walls, ...main, ...overlays, ...accents, ...(hero ? [hero.scene] : []), ...huds],
    transitions: kept,
    tail,
    ...(camera ? { camera } : {}),
    snap,
  }
}

/**
 * A mark drawn at `t` outside the paper world strokes in the world's fg: the accent on ink (or the
 * look's fg on the accent) is too faint to register as an event (measured: an underline under a
 * counter in the ink world did not; e2e maxEventGap 1.033 s). In the paper world: the accent (V1).
 */
function markColour(scenes: readonly Scene[], t: number): { color?: string } {
  const bg = scenes.filter((s) => s.type === 'backdrop' && s.start.t <= t + 1e-9).at(-1)
  return bg && bg.params.world !== undefined && bg.params.world !== 'paper' ? { color: 'var(--mba-fg)' } : {}
}

/** Index of the section word `k` is in (−1 before the first). */
function sectionIndexAt(c: Ctx, k: number): number {
  let j = -1
  c.sections.forEach((s, q) => {
    if (s.word <= k) j = q
  })
  return j
}

/** A frame-fraction point of a safe-area point (`format`'s safe area). */
function framePoint(format: Format, p: { x: number; y: number }): { x: number; y: number } {
  const a = SAFE_AREA[format]
  return { x: a.left + p.x * (1 - a.left - a.right), y: a.top + p.y * (1 - a.top - a.bottom) }
}

/**
 * The hero: one scene on T_HERO over the whole video, resting low in the safe area, landing (with
 * a squash) on the main word of each handoff beat as it is spoken (`target: w<k>`), back to rest
 * HERO_REST_AFTER s after the last (snapped to the beat). `origin(t)`: where it is at t, as a frame
 * fraction (a target counts as the text block's centre), for flood / iris cuts.
 */
function heroScene(c: Ctx, plan: ExplainPlan, B: Beats, xs: number[], snap: (t: number) => number): { scene: Scene; origin: (t: number) => { x: number; y: number } } | undefined {
  const ks = [...new Set(xs.map((x) => mainWord(B.infos[x]!)).filter((k): k is number => k !== undefined && cleanWord(c.W[k]!.text) !== undefined))].sort((a, b) => a - b)
  if (!ks.length) return undefined
  const path: Record<string, unknown>[] = [{ at: 0, ...HERO_REST }]
  const times = [0]
  const pts = [framePoint(plan.format, HERO_REST)]
  for (const k of ks) {
    path.push({ at: { word: k }, target: `w${k}`, squash: true })
    times.push(c.W[k]!.start)
    pts.push({ x: framePoint(plan.format, { x: 0.5, y: 0 }).x, y: TEXT_Y })
  }
  const last = ks.at(-1)!
  const rest = snap(c.W[last]!.start + HERO_REST_AFTER)
  if (rest < c.videoEnd.t - 0.2 && rest > c.W[last]!.start + 0.1) {
    path.push({ at: { word: last, offset: r3(rest - c.W[last]!.start) }, ...HERO_REST })
    times.push(rest)
    pts.push(framePoint(plan.format, HERO_REST))
  }
  const params = { shape: plan.hero!.shape, size: HERO_SIZE, color: 'accent', path, spring: 'snappy', trail: true, loop: plan.hero!.loop }
  const numeric = heroParams.parse({ ...params, path: path.map((p, q) => ({ ...p, at: times[q] })) })
  const origin = (t: number) => {
    const h = heroAt(numeric, pts, t, c.videoEnd.t)
    return { x: r3(Math.min(1, Math.max(0, h.x))), y: r3(Math.min(1, Math.max(0, h.y))) }
  }
  return { scene: { id: 'hero', type: 'hero', track: T_HERO, start: AT0, end: c.videoEnd, params }, origin }
}

/**
 * Shape states for UI words [from, to): a button labelled with the first UI word once the shape is
 * in, a pill per further UI word as it is spoken, then a check; undefined when [start, end) is too short.
 */
function shapeStates(c: Ctx, from: number, to: number, start: Pt, end: Pt): Scene | undefined {
  const ks = Array.from({ length: to - from }, (_, q) => from + q).filter((k) => isUiWord(c.W[k]!.text) && c.W[k]!.start < end.t)
  if (!ks.length) return undefined
  const label = (k: number) => [...(cleanWord(c.W[k]!.text) ?? '…')].slice(0, 24).join('')
  const len = end.t - start.t
  const states: Record<string, unknown>[] = []
  let prev = -Infinity
  const at = (k: number, t: number) => ({ word: k, offset: r3(t - c.W[k]!.start) })
  for (const [q, k] of ks.entries()) {
    const t = Math.max(c.W[k]!.start, start.t + 0.3, prev + 0.4)
    if (t - start.t > len - 0.35) break
    states.push({ at: at(k, t), kind: q === 0 ? 'button' : 'pill', label: label(k) })
    prev = t
  }
  const k = ks[0]!
  if (states.length && prev + 0.5 - start.t <= len - 0.25) states.push({ at: at(k, prev + 0.5), kind: 'check' })
  if (states.length < 2) return undefined
  return { id: c.id('ui'), type: 'shape-states', track: T_VIS, start, end, params: { states, at: SHAPE_AT, size: SHAPE_SIZE } }
}

/**
 * The camera (Task 6) per plan mode. `push`: each `camera-push` beat eases from zoom 1 to PUSH_ZOOM
 * on the text block over the beat, then cuts back at its end. `world`: each section has its own
 * framing (WORLD_ZOOMS, a vertical offset), held over its short-stack beats (zoom-safe) and cut back
 * to zoom 1 for everything wider (screens, lists, counters, giant words, section numbers); a
 * `camera-push` beat eases to WORLD_PUSH_ZOOM. The centre is clamped so the zoomed world always
 * covers the frame; zoom stays within 1 … WORLD_MAX (1.6 at most). Undefined when nothing moves.
 */
function cameraOf(c: Ctx, plan: ExplainPlan, B: Beats, ideas: (IdeaId | undefined)[], numbered: ReadonlySet<number>): Record<string, unknown> | undefined {
  if (plan.camera === 'none') return undefined
  type Pose = { x: number; y: number; zoom: number }
  const centre = (v: number, z: number) => r3(Math.min(1 - 1 / (2 * z), Math.max(1 / (2 * z), v)))
  // Centred on the beat's text block (a stack sits TEXT_Y_PER_ROW lower per extra row, `stageText`), so
  // the zoom grows it evenly around its middle (measured: zooming on TEXT_Y pushed a 3-row stack's
  // last row 34 px below the safe area).
  const pose = (zoom: number, rows: number, dy = 0): Pose => ({ x: centre(0.5, zoom), y: centre(TEXT_Y + TEXT_Y_PER_ROW * (rows - 1) + dy, zoom), zoom: r3(Math.min(WORLD_MAX, zoom)) })
  const ID: Pose = { x: 0.5, y: 0.5, zoom: 1 }
  const keys: { at: Anchor | number; t: number; p: Pose }[] = [{ at: 0, t: 0, p: ID }]
  const key = (pt: Pt, p: Pose) => {
    const l = keys.at(-1)!
    if (Math.abs(l.t - pt.t) < 1e-9 && l.p.x === p.x && l.p.y === p.y && l.p.zoom === p.zoom) return
    keys.push({ at: pt.a, t: pt.t, p })
  }
  const OFFSETS = [0, 0.03, -0.02]
  const wide: ReadonlySet<IdeaId> = new Set(['giant-word', 'section-number', 'shape-states', 'word-wall', 'kashida-stretch'])
  let moved = false
  B.infos.forEach((b, x) => {
    if (x === 0) return
    const start = c.wStart(b.from)
    const end = c.startOf(b.to)
    const id = ideas[x]
    const rows = Math.max(1, Math.min(MAX_SEG_WORDS, b.to - b.from))
    let base = ID
    if (plan.camera === 'world' && B.zoomSafe[x] && !(id && wide.has(id)) && !numbered.has(x)) {
      const j = Math.max(0, sectionIndexAt(c, b.from))
      base = pose(WORLD_ZOOMS[j % WORLD_ZOOMS.length]!, rows, OFFSETS[j % OFFSETS.length]!)
    }
    const push = id === 'camera-push' && !numbered.has(x) ? pose(plan.camera === 'world' ? WORLD_PUSH_ZOOM : PUSH_ZOOM, rows) : base
    if (base !== ID || push !== ID) moved = true
    key(start, base)
    key(end, push)
    if (push !== ID && x === B.infos.length - 1) key(end, ID)
  })
  // Back to zoom 1 for the end card.
  key(c.speechEnd, ID)
  if (!moved) return undefined
  // Only the keys where the pose changes (a run of one pose keeps its two ends).
  const same = (a: Pose, b: Pose) => a.x === b.x && a.y === b.y && a.zoom === b.zoom
  const kept = keys.filter((k, q) => q === 0 || q === keys.length - 1 || !same(k.p, keys[q - 1]!.p) || !same(k.p, keys[q + 1]!.p))
  return { keys: kept.map((k) => ({ at: k.at, x: k.p.x, y: k.p.y, zoom: k.p.zoom })) }
}

/**
 * Fix wave I4: the main line's kinetic text is centred near TEXT_Y (a stack lower by
 * TEXT_Y_PER_ROW per extra row) and its scenes rotate their word entrances (ENTERS, from a seeded
 * start) so no two consecutive kinetic scenes enter the same way. A scene whose entrance an idea
 * set (`fixedEnter`) keeps it and does not take a turn of the rotation.
 */
function stageText(main: Scene[], R: () => number): void {
  let e = Math.floor(R() * ENTERS.length)
  for (const sc of main) {
    // Critic round 2: a checklist is centred the same way (its first row near TEXT_Y, not high up).
    if (sc.type === 'checklist') sc.params.y = r3(TEXT_Y + TEXT_Y_PER_ROW * ((sc.params.items as unknown[]).length - 1))
    if (sc.type !== 'kinetic-text') continue
    const rows = (sc.params.mode ?? 'stack') === 'stack' ? (sc.params.words as unknown[]).length : 1
    sc.params.y = r3(TEXT_Y + TEXT_Y_PER_ROW * (rows - 1))
    if (!sc.fixedEnter) sc.params.enter = ENTERS[e++ % ENTERS.length]
  }
}

/** Ideas whose word fills the frame: a section number never shows over them. */
const LOUD_IDEAS: ReadonlySet<IdeaId> = new Set(['giant-word', 'kashida-stretch'])

/**
 * Ruling T9-c: the beat a section number shows over, for the section that starts on beat `x`: `x`
 * itself (the first beat after the hook for a section on the hook), or the next beats of the same
 * section while that one is a giant or stretched word, a counter, a screen or a checklist start
 * shorter than VISUAL_MIN; −1 when none of the section's beats can carry it.
 */
function numberBeat(B: Beats, ideas: readonly (IdeaId | undefined)[], x: number): number {
  for (let y = Math.max(1, x); y < B.infos.length; y++) {
    if (y > x && B.infos[y]!.sectionIndex !== undefined) break
    const id = ideas[y]
    const kind = B.kinds[y]
    if ((id && LOUD_IDEAS.has(id)) || (kind !== 'text' && kind !== 'checklist') || B.secs[y]! < VISUAL_MIN) continue
    return y
  }
  return -1
}

const numberDropped = (j: number) =>
  `لا مكان لرقم القسم ${j + 1}: كل مقاطع القسم كلمات كبيرة أو أرقام أو شاشات؛ حُذف — no room for section number ${j + 1}: every beat of its section is a giant or stretched word, a counter or a screen; dropped`

/**
 * Ruling T9-c: the safe-area band below a section number (frame fractions), where the main line's
 * text goes while the number shows.
 */
export function textBand(format: Format): { top: number; bottom: number } {
  const a = SAFE_AREA[format]
  const h = 1 - a.top - a.bottom
  // The same margin at the bottom: glyph boxes reach below their rows (measured: «يخسرون», the
  // last of three rows, 3 px past the safe bottom without it).
  return { top: a.top + h * (SECTION_BAND + SECTION_GAP), bottom: 1 - a.bottom - h * SECTION_GAP }
}

/**
 * Ruling T9-c: every kinetic text or checklist shown while a section number is on screen is centred
 * in `textBand` instead of near TEXT_Y. A stack whose planned height (KINETIC_ROW_PX a row) does not
 * fit there becomes one line. Word anchors stay on the voice: only placement changes.
 */
function belowBand(format: Format, main: Scene[], band: Scene[]): void {
  const nums = band.filter((s) => s.type === 'section-number')
  if (nums.length === 0) return
  const tb = textBand(format)
  const fit = (tb.bottom - tb.top) * FORMAT_SIZE[format].h
  const y = r3((tb.top + tb.bottom) / 2)
  for (const sc of main) {
    if (sc.type !== 'kinetic-text' && sc.type !== 'checklist') continue
    if (!nums.some((n) => sc.start.t < n.end.t - 1e-9 && n.start.t < sc.end.t - 1e-9)) continue
    sc.params.y = y
    if (sc.type === 'kinetic-text' && (sc.params.mode ?? 'stack') === 'stack' && (sc.params.words as unknown[]).length * KINETIC_ROW_PX > fit) sc.params.mode = 'line'
  }
}

// --- Hook ---------------------------------------------------------------------------------------

/** @internal (signature.ts) */
export interface Hook {
  treatment: HookTreatment
  words: KWord[]
  /** First spoken word after the hook (the main line starts there). */
  end: number
  /** Where the hook's main-line scenes end; `stop` caps a text scene at MAX_KINETIC_SEC. */
  until: Pt
  stop: Pt
}

/**
 * The hook text (hook.text, title, or the first spoken words) and how long it holds. With a text
 * from the brief, until the first word at or after HOOK_MIN; from speech, at most
 * HOOK_SPEECH_WORDS words and never past HOOK_MIN, so the beat's own visuals keep their words (I1).
 */
/** @internal (signature.ts) */
export function planHook(c: Ctx): Hook {
  const { W, n, brief } = c
  const family = HOOK_FAMILIES_AR.find((h) => h.id === brief.hook?.family)
  const treatment: HookTreatment = family?.treatment ?? 'text'
  const hookText = brief.hook?.text ?? brief.title
  const minT = HOOK_MIN[treatment]
  const firstLate = W.findIndex((w, k) => k >= 1 && w.start >= minT)
  let end: number
  let words: KWord[]
  if (hookText) {
    words = splitWords(hookText)
      .map(cleanWord)
      .filter((w): w is string => w !== undefined)
      .slice(0, 16)
      .map((text) => ({ text, stress: 0 as const }))
    end = W[0]!.start >= minT ? 0 : firstLate < 0 ? n : firstLate
  } else {
    end = Math.max(1, Math.min(HOOK_SPEECH_WORDS, firstLate < 0 ? n : firstLate, c.beatEnd(0)))
    // Critic round 2: nor runs past a sentence end.
    for (let k = 0; k + 1 < end; k++) if (c.stops.has(k)) end = k + 1
    // I4: the hook never ends on a particle («تضيّع ساعات في»): it goes to the next chunk.
    while (end > 1 && isParticle(W[end - 1]!.text)) end--
    words = []
    for (let k = 0; k < end; k++) {
      const t = cleanWord(W[k]!.text)
      if (t) words.push({ text: t, stress: c.stress.has(k) ? 2 : 0, word: k })
    }
  }
  if (words.length === 0) words = [{ text: '…', stress: 0 }]
  if (treatment === 'question') words[words.length - 1]!.stress = 2
  const until = c.startOf(end)
  return { treatment, words, end, until, stop: until.t > MAX_KINETIC_SEC ? sec(MAX_KINETIC_SEC) : until }
}

function kineticParams(words: (KWord & { at: Anchor | number })[], key?: string, mode?: 'stack' | 'line' | 'giant'): Record<string, unknown> {
  return {
    // Plan 2a+: a word from the transcript carries its index and the key `w<index>` (hero targets, word highlights).
    words: words.map((w) => ({ text: w.text, at: w.at, stress: w.stress, ...(w.word !== undefined ? { word: w.word, key: `w${w.word}` } : {}), ...w.extra })),
    mode: mode ?? (words.length <= MAX_SEG_WORDS ? 'stack' : 'line'),
    ...(key ? { key } : {}),
  }
}

/** Hook words at 0 … HOOK_IN (the first on frame 0, R17). */
function hookKinetic(ws: KWord[], key?: string, mode?: 'stack' | 'line'): Record<string, unknown> {
  const ats = ws.length <= 1 ? [0] : ws.map((_, j) => r3((j * HOOK_IN) / (ws.length - 1)))
  return kineticParams(
    ws.map((w, j) => ({ ...w, at: ats[j]! })),
    key,
    mode,
  )
}

/** The hook's scenes per family treatment (main line, stamp overlay, one-word accent, split wipe). */
function hookScenes(c: Ctx, h: Hook, claims: Span[]): { main: Scene[]; overlays: Scene[]; accents: Scene[]; transitions: Trans[] } {
  const main: Scene[] = []
  const overlays: Scene[] = []
  const accents: Scene[] = []
  const transitions: Trans[] = []
  let treatment = h.treatment
  const number = (() => {
    for (const [j, w] of h.words.entries()) {
      const v = c.valueOf(w.text)
      if (v === null) continue
      const next = h.words[j + 1]?.text
      return { v, suffix: next && [...next].length <= 12 && c.valueOf(next) === null ? next : undefined }
    }
    const first = claims.find((x) => x.kind === 'counter')
    return first ? { v: first.params!.to as number, suffix: first.params!.suffix as string | undefined } : undefined
  })()
  if (treatment === 'counter' && !(number && h.until.t - HOOK_COUNTER_AT >= 1)) treatment = 'text'
  const splitAt = c.snap(SPLIT_AT)
  if (treatment === 'before-after' && !(h.words.length >= 2 && h.until.t - splitAt >= 0.4)) treatment = 'text'
  const KEY = 'k-hook'
  if (treatment === 'counter') {
    main.push({ id: 'hook', type: 'kinetic-text', track: T_MAIN, start: AT0, end: sec(HOOK_COUNTER_AT), params: hookKinetic(h.words) })
    main.push({
      id: 'hook-count',
      type: 'counter',
      track: T_MAIN,
      start: sec(HOOK_COUNTER_AT),
      end: h.until,
      params: { from: 0, to: number!.v, roll: r3(Math.min(1.2, (h.until.t - HOOK_COUNTER_AT) * 0.7)), ...(number!.suffix ? { suffix: number!.suffix } : {}) },
    })
  } else if (treatment === 'before-after') {
    const split = h.words.findIndex((w, j) => j > 0 && normalizeAr(w.text) === 'بعد')
    const cut = split > 0 ? split : Math.ceil(h.words.length / 2)
    main.push({ id: 'hook', type: 'kinetic-text', track: T_MAIN, start: AT0, end: sec(splitAt), params: hookKinetic(h.words.slice(0, cut)) })
    main.push({ id: 'hook-after', type: 'kinetic-text', track: T_MAIN, start: sec(splitAt), end: h.stop, params: hookKinetic(h.words.slice(cut)) })
    transitions.push({ type: 'color-wipe', track: T_MAIN, at: sec(splitAt), hit: false })
  } else {
    // I5: a hook whose own words make no registered change by 0.5 s (one word, or a line longer
    // than a stack) gets an underline at HOOK_ACCENT_AT.
    const mode = treatment === 'stamp' ? 'line' : undefined
    const accent = (h.words.length === 1 || h.words.length > MAX_SEG_WORDS || mode === 'line') && h.stop.t - HOOK_ACCENT_AT >= FILLER_MIN
    main.push({ id: 'hook', type: 'kinetic-text', track: T_MAIN, start: AT0, end: h.stop, params: hookKinetic(h.words, accent ? KEY : undefined, mode) })
    if (accent) {
      // It leaves before a pace filler can draw the same underline again (no change, no event).
      accents.push({ id: 'hook-accent', type: 'highlight', track: T_ACCENT, start: sec(HOOK_ACCENT_AT), end: earliest(h.stop, sec(HOOK_ACCENT_AT + HOOK_ACCENT_SEC)), params: { kind: 'underline', target: KEY, drawIn: ACCENT_DRAW_IN } })
    }
  }
  if (treatment === 'stamp') {
    overlays.push({ id: 'hook-stamp', type: 'stamp', track: T_VIS, start: AT0, end: h.stop, params: { text: 'انتبه!', at: STAMP_AT, size: STAMP_SIZE } })
  }
  return { main, overlays, accents, transitions }
}

// --- Claims: checklists, counters, screens -------------------------------------------------------

function planClaims(c: Ctx, hookEnd: number): Span[] {
  const { W, n } = c
  const claims: Span[] = []
  const free = (a: number, b: number) => a >= hookEnd && b <= n && claims.every((x) => b <= x.from || a >= x.to)
  /** Extends `to` until the scene from `from` lasts `need` s past `lastAt` (or fails). */
  const longEnough = (from: number, to: number, lastAt: number, need: number): number | undefined => {
    let e = to
    while (c.startOf(e).t - lastAt < need && e < n && free(from, e + 1)) e++
    return c.startOf(e).t - lastAt >= need ? e : undefined
  }
  const CHECK_NEED = 0.25 + 0.3 + 0.1 // row in + check draw + margin (CHECKLIST_TIMING)
  // Short rows read large (rowText).
  const itemText = (from: number, stop: number) => rowText(W.slice(from, Math.max(stop, from + 1)).map((w) => w.text))

  // Ordinal enumerations: أولاً … ثانياً … ثالثاً.
  for (let k = hookEnd; k < n; k++) {
    if (ordinalOf(W[k]!.text) !== 0) continue
    const marksAt = [k]
    for (let j = k + 1; j < n && marksAt.length < 8; j++) {
      if (W[j]!.start - W[marksAt.at(-1)!]!.start > 8) break
      const o = ordinalOf(W[j]!.text)
      if (o === marksAt.length) marksAt.push(j)
      else if (o >= 0) break
    }
    if (marksAt.length < 2) continue
    const last = marksAt.at(-1)!
    // The list ends CHECK_TAIL after its last row (the rest of the sentence goes to kinetic text):
    // a long hold after the last tick is a gap with no event.
    let lastTo = Math.min(last + 4, c.beatEnd(last), n)
    while (lastTo > last + 1 && W[lastTo - 1]!.start - W[last]!.start >= CHECK_TAIL) lastTo--
    const items = marksAt.map((m, x) => ({ text: itemText(m, Math.min(x + 1 < marksAt.length ? marksAt[x + 1]! : lastTo, m + 4)), at: { word: m } }))
    const to = longEnough(k, lastTo, W[last]!.start, CHECK_NEED)
    if (to === undefined || !free(k, to)) continue
    claims.push({ from: k, to, kind: 'checklist', params: { items, rowPx: CHECK_ROW_PX, pulse: true } })
    k = to - 1
  }
  // R22: a list of keyword hits — 3+ distinct visuals over ≥ 6 words and ≥ 2 s in one beat, not
  // right after another checklist; items are the hit word and the words after it.
  const hits = matchKeywords(W).filter((h) => h.visual.type !== 'counter' && h.visual.type !== 'ui' && h.word >= hookEnd)
  for (const s of c.starts) {
    const e = c.beatEnd(s)
    const inBeat = hits.filter((h) => h.word >= s && h.word < e).slice(0, 8)
    if (new Set(inBeat.map((h) => JSON.stringify(h.visual))).size < HIT_LIST.visuals) continue
    const first = inBeat[0]!.word
    const last = inBeat.at(-1)!.word
    if (last - first + 1 < HIT_LIST.words || W[last]!.start - W[first]!.start < HIT_LIST.sec) continue
    const before = claims.filter((x) => x.kind === 'checklist' && x.to <= first)
    if (before.some((x) => W[first]!.start - c.startOf(x.to).t < HIT_LIST.afterList)) continue
    const lastTo = Math.min(last + 3, e)
    const items = inBeat.map((h, x) => ({ text: itemText(h.word, Math.min(inBeat[x + 1]?.word ?? lastTo, h.word + 3)), at: { word: h.word } }))
    const to = longEnough(first, lastTo, W[last]!.start, CHECK_NEED)
    if (to === undefined || !free(first, to)) continue
    claims.push({ from: first, to, kind: 'checklist', params: { items, rowPx: CHECK_ROW_PX, pulse: true } })
  }
  // Numbers: brief.numbers (by spoken word) or digits.
  for (let k = hookEnd; k < n; k++) {
    const num = c.numberAt(k)
    if (num === null) continue
    const v = num.value
    // R28: the number may span several spoken words («ألف وخمسمية»); the suffix follows the last.
    const lastK = k + num.count - 1
    const end = c.beatEnd(k)
    const nextText = lastK + 1 < end ? cleanWord(W[lastK + 1]!.text) : undefined
    const suffix = nextText && [...nextText].length <= 12 && c.valueOf(nextText) === null && ordinalOf(nextText) < 0 ? nextText : undefined
    let to = lastK + 1 + (suffix ? 1 : 0)
    while (to < end && W[to]!.start - W[k]!.start < COUNTER_HOLD) to++
    if (!free(k, to)) continue
    // I4: a particle right before the number («من ٣٠٠») is the counter's prefix, so the text
    // before it does not end on it.
    const pre = k - 1 >= hookEnd && !c.beatStarts.has(k) && free(k - 1, to) && isParticle(W[k - 1]!.text) ? cleanWord(W[k - 1]!.text) : undefined
    const from = pre ? k - 1 : k
    const dur = c.startOf(to).t - W[from]!.start
    claims.push({
      from,
      to,
      kind: 'counter',
      params: { from: 0, to: v, roll: r3(Math.max(0.3, Math.min(1.2, dur * 0.7))), ...(pre ? { prefix: pre } : {}), ...(suffix ? { suffix } : {}) },
    })
    k = to - 1
  }
  claims.sort((a, b) => a.from - b.from)
  claims.push(...planScreens(c, hookEnd, claims))
  return claims.sort((a, b) => a.from - b.from)
}

/**
 * The user's screenshots on free stretches (product words first, then from 40 % of the speech
 * on), at most SCREEN_MAX_SEC each: a phone, or an app window for a landscape one. A screen that
 * finds no stretch is reported.
 */
function planScreens(c: Ctx, hookEnd: number, claims: Span[]): Span[] {
  const { W, n, brief } = c
  if (!brief.screens?.length) return []
  const ranges: { from: number; to: number; product: boolean }[] = []
  let k = hookEnd
  while (k < n) {
    const cl = claims.find((x) => x.from <= k && k < x.to)
    if (cl) {
      k = cl.to
      continue
    }
    const e = Math.min(c.beatEnd(k), ...claims.filter((x) => x.from > k).map((x) => x.from))
    if (e - k >= 2) {
      const product = W.slice(k, e).some((w) => stripClitics(w.text).some((x) => PRODUCT_STEMS.some((p) => x === p || x.startsWith(p))))
      ranges.push({ from: k, to: e, product })
    }
    k = Math.max(e, k + 1)
  }
  const midT = W[0]!.start + 0.4 * (W[n - 1]!.end - W[0]!.start)
  const chosen = [...ranges]
    .sort((a, b) => Number(b.product) - Number(a.product) || Number(W[b.from]!.start >= midT) - Number(W[a.from]!.start >= midT) || a.from - b.from)
    .slice(0, brief.screens.length)
    .sort((a, b) => a.from - b.from)
  if (chosen.length < brief.screens.length) {
    const dropped = brief.screens.slice(chosen.length)
    c.warnings.push(
      `لا مكان في الصوت لعرض ${dropped.length} من لقطات الشاشة: ${dropped.join('، ')} — no free stretch of speech left for ${dropped.length} screen(s), not shown: ${dropped.join(', ')}`,
    )
  }
  return chosen.map((r, x) => {
    let to = r.to
    while (to > r.from + 2 && c.startOf(to).t - W[r.from]!.start > SCREEN_MAX_SEC) to--
    const name = brief.screens![x]!
    const size = c.i.screenSizes?.[name]
    const image = screenPath(name)
    return size && size.w > size.h * LANDSCAPE
      ? { from: r.from, to, kind: 'app-window' as const, params: { mode: 'app', image } }
      : { from: r.from, to, kind: 'phone' as const, params: { screen: { image } } }
  })
}

// --- Spans of the main line --------------------------------------------------------------------

/** Claims, and kinetic text between them: short stacks split at beats, MAX_SEG_WORDS, MAX_KINETIC_SEC and (motion) stressed words. */
/** @internal (signature.ts) */
export function planSpans(c: Ctx, hookEnd: number, claims: Span[]): Span[] {
  const { W, n, stress, beatStarts, preset, stops } = c
  const spans: Span[] = []
  const pushText = (a: number, b: number) => {
    let s = a
    for (let k = a + 1; k < b; k++) {
      const stressCut = preset.intensity >= 5 && stress.has(k) && !beatStarts.has(k) && W[k]!.start - W[s]!.start >= STRESS_CUT_MIN
      // Critic round 2: a sentence end in the script always closes the chunk («مكرر.» | «والوقت هذا»).
      const cut = beatStarts.has(k) || stops.has(k - 1) || k - s >= c.segWords || W[k]!.end - W[s]!.start > MAX_KINETIC_SEC - 1 || stressCut
      if (!cut) continue
      // I4: a chunk never ends on a particle; it opens the next chunk instead (not across a beat).
      let at = k
      if (!beatStarts.has(k) && !stops.has(k - 1)) while (at - 1 > s && isParticle(W[at - 1]!.text) && !beatStarts.has(at - 1) && !stops.has(at - 2)) at--
      // …unless that leaves a stressed word too little time to be marked: then the next word joins
      // this chunk instead (one row more).
      const squeezed = at < k && [...Array(at - s).keys()].some((q) => stress.has(s + q) && W[at]!.start - W[s + q]!.start < STRESS_MARK_MIN)
      if (squeezed) {
        const forward = k + 1 <= b && !beatStarts.has(k) && !stops.has(k - 1) && !isParticle(W[k]!.text)
        at = forward ? k + 1 : k
        k = at // the loop goes on after the word that joined
      }
      spans.push({ from: s, to: at, kind: 'text' })
      s = at
      if (stressCut) spans.push({ from: -1, to: -1, kind: 'text', stressCut: true }) // marker, folded below
    }
    if (s < b) spans.push({ from: s, to: b, kind: 'text' })
  }
  let k0 = hookEnd
  for (const cl of claims) {
    if (cl.from > k0) pushText(k0, cl.from)
    spans.push(cl)
    k0 = cl.to
  }
  if (k0 < n) pushText(k0, n)
  // Fold the stress markers into the span that follows them.
  const out: Span[] = []
  let mark = false
  for (const s of spans) {
    if (s.from < 0) {
      mark = true
      continue
    }
    out.push(mark ? { ...s, stressCut: true } : s)
    mark = false
  }
  return out
}

/** Word groups (calm types: words closer than `groupSec` appear together): word → its group's first word. */
function wordGroups(c: Ctx, spans: Span[], groupSec: number): (k: number) => number {
  const leader = new Map<number, number>()
  for (const s of spans) {
    let g = s.from
    for (let k = s.from; k < s.to; k++) {
      if (c.W[k]!.start - c.W[g]!.start >= groupSec - 1e-9) g = k
      leader.set(k, g)
    }
  }
  return (k) => leader.get(k) ?? k
}

/**
 * The scene of a main-line span. Plan 2a+: every kinetic word carries `word` / `key` (`w<index>`),
 * a stressed word the plan's `punchScale`, and the beat's idea acts on its words: `kashida-stretch`
 * stretches the stretchable stressed (or keyword) word from its start, `echo-word` echoes the
 * stressed word, `keyword-box` boxes the keyword, `strike` strikes the word after a negation (or a
 * number) at the next word's start (a counter: its number once rolled), `giant-word` shows its word
 * alone in `giant` mode (`mask-line`), `rise-words` / `mask-line` set the entrance.
 */
function spanToScene(c: Ctx, s: Span, lead: (k: number) => number, marked: ReadonlySet<number>, plan: ExplainPlan, b: BeatInfo, warnings: string[]): Scene {
  const start = c.wStart(s.from)
  const end = c.startOf(s.to)
  if (s.kind === 'checklist') {
    // I4: each row keyed, so a pace filler can underline the row just ticked (not the whole list).
    const id = c.id('s')
    const items = (s.params!.items as Record<string, unknown>[]).map((it, x) => ({ ...it, key: `${id}-r${x + 1}` }))
    return { id, type: s.kind, track: T_MAIN, start, end, params: { ...s.params, items } }
  }
  if (s.kind === 'counter' && s.idea === 'strike') {
    const params: Record<string, unknown> = { ...s.params }
    const k = b.numbers[0]!
    let j = k + 1
    while (j < s.to && b.numbers.includes(j)) j++
    const len = end.t - start.t
    const at = r3(Math.max(Number(params.roll ?? 0), j < s.to ? c.W[j]!.start - start.t : len - 0.3))
    if (at < len - 0.1) params.strike = { at }
    else warnings.push(`لا وقت لشطب الرقم في المقطع ${b.i} — no time to strike the number of beat ${b.i} after its roll; not struck`)
    return { id: c.id('s'), type: s.kind, track: T_MAIN, start, end, params }
  }
  if (s.kind !== 'text') return { id: c.id('s'), type: s.kind, track: T_MAIN, start, end, params: { ...s.params } }
  const idea = s.idea
  const effect = new Map<number, Record<string, unknown>>()
  const add = (k: number | undefined, e: Record<string, unknown>) => {
    if (k !== undefined && k >= s.from && k < s.to) effect.set(k, { ...effect.get(k), ...e })
  }
  if (idea === 'kashida-stretch') {
    const k = stretchableWord(b)
    if (k !== undefined) {
      const slots = kashidaSlots(cleanWord(c.W[k]!.text) ?? '').length
      add(k, { stretch: { to: Math.min(STRETCH_MAX, Math.max(STRETCH_TO, 2 * slots)), at: { word: k }, duration: r3(Math.max(0.1, Math.min(STRETCH_SEC, c.W[k]!.end - c.W[k]!.start))) } })
    }
  }
  if (idea === 'echo-word') add(b.stress[0], { echo: ECHO_COPIES })
  if (idea === 'keyword-box') add(b.keywords.find((h) => h.visual.type === 'icon' || h.visual.type === 'line-art')?.word, { box: true })
  if (idea === 'strike') {
    for (let k = b.from; k + 1 < b.to; k++) {
      if (!isNegation(c.W[k]!.text) && !b.numbers.includes(k)) continue
      const struck = isNegation(c.W[k]!.text) ? k + 1 : k
      add(struck, { strike: { at: struck + 1 < s.to ? { word: struck + 1 } : { word: struck, offset: 0.15 } } })
      break
    }
  }
  const words: (KWord & { at: Anchor })[] = []
  for (let k = s.from; k < s.to; k++) {
    const t = cleanWord(c.W[k]!.text)
    if (!t) continue
    const stress = c.stress.has(k) ? 2 : marked.has(k) ? 1 : 0
    const extra = { ...(stress === 2 && plan.punchScale !== KINETIC_TIMING.punch[2] ? { punch: plan.punchScale } : {}), ...effect.get(k) }
    words.push({ text: t, stress, word: k, at: { word: lead(k) }, ...(Object.keys(extra).length ? { extra } : {}) })
  }
  if (!words.length) words.push({ text: '…', stress: 0, at: { word: s.from } })
  const sc: Scene = { id: c.id('s'), type: 'kinetic-text', track: T_MAIN, start, end, params: kineticParams(words, undefined, s.giant ? 'giant' : undefined) }
  const enter = s.giant || idea === 'mask-line' ? 'mask-line' : idea === 'rise-words' ? 'rise' : undefined
  if (enter) {
    sc.params.enter = enter
    sc.fixedEnter = true
  }
  // A kinetic scene can not outlast KINETIC_MAX_REST_SEC: end it after its last word instead.
  if (end.t - start.t > MAX_KINETIC_SEC) {
    sc.end = c.wEnd(s.to - 1, Math.max(0.1, Math.min(1, MAX_KINETIC_SEC - (c.W[s.to - 1]!.end - start.t))))
  }
  return sc
}

/** The end card: a comment-cta (keyword) or a kinetic-text CTA held ≤ 2 s. */
function ctaScenes(c: Ctx): Scene[] {
  const cta = c.brief.cta
  if (c.ctaKind === 'comment') {
    const body = cta!.text && [...cta!.text].length <= 40 && !/[\r\n]/.test(cta!.text) ? { dmBody: cta!.text } : {}
    return [{ id: 'cta', type: 'comment-cta', track: T_MAIN, start: c.speechEnd, end: c.videoEnd, params: { keyword: cta!.keyword!, ...body } }]
  }
  if (c.ctaKind !== 'text') return []
  const ws = splitWords(cta!.text!)
    .map(cleanWord)
    .filter((w): w is string => w !== undefined)
    .slice(0, 16)
  const step = ws.length > 1 ? Math.min(0.3, 0.9 / (ws.length - 1)) : 0
  const words = ws.map((t, j) => ({ text: t, stress: (j === ws.length - 1 ? 1 : 0) as 0 | 1, at: r3(j * step) }))
  return [{ id: 'cta', type: 'kinetic-text', track: T_MAIN, start: c.speechEnd, end: c.videoEnd, params: kineticParams(words) }]
}

// --- Cuts ----------------------------------------------------------------------------------------

/**
 * The cut into the main-line span starting at word `k`, after a span of kind `prev` ('hook' for
 * the hook): a pause ≥ HIT_PAUSE or a section start makes a transition (a hard cut per the type's
 * `hitCuts`; a stressed-word cut is hard at intensity 5); a shorter pause is a breath (none).
 */
function cutKind(c: Ctx, k: number, stressCut: boolean): { want: boolean; hit: boolean; breath: boolean } {
  const gap = c.pauseBefore.get(k)
  const isSection = c.sectionAt.has(k)
  const long = gap !== undefined && gap >= HIT_PAUSE - 1e-9
  const hit = (c.preset.hitCuts === 'pauses' && long) || (c.preset.hitCuts === 'sections' && isSection) || (stressCut && c.preset.intensity >= 5)
  const breath = gap !== undefined && !long
  // I4: every beat break (an unmarked silence) gets a transition too where the type keeps a pace
  // (intensity ≥ 3); a short marked pause stays a breath.
  const beat = c.beatStarts.has(k) && !breath && c.preset.intensity >= 3
  return { want: hit || isSection || long || beat, hit, breath }
}

const MORPHABLE: ReadonlySet<string> = new Set(['counter', 'checklist', 'phone', 'app-window'])

function mainCuts(
  c: Ctx,
  spans: Span[],
  spanScene: Map<Span, Scene>,
  pick: () => TransitionId,
  morphN: { n: number },
  heroAt?: (t: number) => { x: number; y: number },
): Trans[] {
  const out: Trans[] = []
  spans.forEach((b, j) => {
    const a = spans[j - 1]
    const k = b.from
    // Plan 2a+: no cut inside a beat a giant word splits.
    if (b.head === false) return
    const cut = cutKind(c, k, b.stressCut === true)
    // A flood or an iris at the beat's cut opens from the hero (else the safe centre).
    if (j > 0 && (b.idea === 'flood' || b.idea === 'iris-open')) {
      const t = c.W[k]!.start
      const origin = heroAt ? heroAt(t) : framePoint(c.brief.format ?? '9:16', { x: 0.5, y: 0.5 })
      const params = b.idea === 'flood' ? { shape: 'circle', origin, color: 'accent' } : { origin, color: 'bg', direction: 'open' }
      out.push({ type: b.idea === 'flood' ? 'flood' : 'iris', track: T_MAIN, at: c.wStart(k), hit: cut.hit, params })
      return
    }
    const morph =
      a !== undefined &&
      !cut.breath &&
      a.kind === b.kind &&
      MORPHABLE.has(a.kind) &&
      c.beatOf(b.from) === c.beatOf(a.from) + 1 &&
      c.preset.transitions.includes('morph')
    if (!cut.want && !morph) return
    if (morph) {
      const key = `m${++morphN.n}`
      spanScene.get(a!)!.params.key = key
      spanScene.get(b)!.params.key = key
      out.push({ type: 'morph', track: T_MAIN, at: c.wStart(k), hit: cut.hit, key })
    } else out.push({ type: pick(), track: T_MAIN, at: c.wStart(k), hit: cut.hit })
  })
  return out
}

// --- Keyword visuals and accents -----------------------------------------------------------------

/** Line arts that mark a word (circle, underline, bracket): drawn in the top band they mark nothing. */
const MARK_ARTS: ReadonlySet<string> = new Set(['circle-mark', 'underline', 'bracket'])
const isMark = (v: Visual) => v.type === 'line-art' && MARK_ARTS.has(v.art)

/**
 * Keyword hits outside the hook and the claimed spans, matched with those words blanked so a word
 * swallowed by a counter (its unit, e.g. «ساعة») does not suppress the same visual 3 s later.
 * A mark-type hit (MARK_ARTS) becomes a stress-1 punch on its kinetic word instead of an overlay
 * (fix round 2: a circle-mark in the top band sat above «والنتيجة», around nothing).
 */
function visualHits(c: Ctx, hookEnd: number, claims: Span[]): { word: number; visual: Visual }[] {
  const inClaim = (k: number) => claims.some((x) => x.from <= k && k < x.to)
  const shown = c.W.map((w, k) => (k < hookEnd || inClaim(k) ? { ...w, text: '…' } : w))
  return matchKeywords(shown).filter((h) => h.visual.type !== 'counter' && h.visual.type !== 'ui')
}

/**
 * Icons (popping in: a drawn icon does not register as an event) and line art on track 2 at their
 * word, until the next visual, the end of their text run (beat end or next claim) or VISUAL_MAX.
 * Matched with the hook and the claimed words blanked, so a word swallowed by a counter (its
 * unit, e.g. «ساعة») does not suppress the same visual 3 s later. Consecutive beats sharing a
 * visual kind morph (not across a breath).
 */
function keywordVisuals(c: Ctx, hookEnd: number, claims: Span[], lead: (k: number) => number, morphN: { n: number }): { scenes: Scene[]; transitions: Trans[] } {
  const { W } = c
  const hits = visualHits(c, hookEnd, claims).filter((h) => !isMark(h.visual))
  const runEnd = (k: number) => c.startOf(Math.min(c.beatEnd(k), ...claims.filter((x) => x.from > k).map((x) => x.from)))
  const pending: { k: number; visual: Visual; start: Pt; end: Pt }[] = []
  hits.forEach((h, x) => {
    const g = lead(h.word)
    const start = c.wStart(g)
    const next = hits[x + 1]
    const end = earliest(runEnd(h.word), { a: { word: g, offset: VISUAL_MAX }, t: W[g]!.start + VISUAL_MAX }, ...(next ? [c.wStart(lead(next.word))] : []))
    if (end.t - start.t >= VISUAL_MIN) pending.push({ k: h.word, visual: h.visual, start, end })
  })
  const scenes: Scene[] = pending.map((v) => ({
    id: c.id('v'),
    type: v.visual.type,
    track: T_VIS,
    start: v.start,
    end: v.end,
    params:
      v.visual.type === 'icon'
        ? { icon: v.visual.icon, at: VISUAL_AT, size: 0.26, enter: 'pop' }
        : { art: (v.visual as { art: string }).art, at: VISUAL_AT, size: 0.42, drawIn: 0.6 },
  }))
  const transitions: Trans[] = []
  for (let x = 0; x + 1 < pending.length; x++) {
    const a = pending[x]!
    const b = pending[x + 1]!
    if (JSON.stringify(a.end.a) !== JSON.stringify(b.start.a)) continue
    if (a.visual.type !== b.visual.type || c.beatOf(b.k) !== c.beatOf(a.k) + 1 || !c.preset.transitions.includes('morph')) continue
    if (cutKind(c, b.k, false).breath) continue
    const key = `m${++morphN.n}`
    scenes[x]!.params.key = key
    scenes[x + 1]!.params.key = key
    transitions.push({ type: 'morph', track: T_VIS, at: b.start, hit: false, key })
  }
  return { scenes, transitions }
}

/**
 * Intensity 5: an underline under each stressed word. The target is a key on that word alone (fix
 * round 2: a block key circled the whole stack). Fix round 3: an underline, not a circle — in a
 * stack a circle around one word cuts through the rows above and below; the underline is drawn
 * under the word's ink and inside its own row box, so it never touches a neighbouring row.
 */
function stressHighlights(c: Ctx, spans: Span[], spanScene: Map<Span, Scene>, lead: (k: number) => number): Scene[] {
  if (c.preset.intensity < 5) return []
  const out: Scene[] = []
  for (const s of spans) {
    if (s.kind !== 'text') continue
    const sc = spanScene.get(s)!
    const words = sc.params.words as { text: string; at: Anchor | number; key?: string }[]
    for (let k = s.from; k < s.to; k++) {
      if (!c.stress.has(k)) continue
      const g = lead(k)
      const start = c.wStart(g)
      const end = earliest(sc.end, { a: { word: g, offset: 1.2 }, t: c.W[g]!.start + 1.2 })
      if (end.t - start.t < STRESS_MARK_MIN) continue
      const text = cleanWord(c.W[k]!.text)
      const w = words.find((x) => x.text === text && JSON.stringify(x.at) === JSON.stringify({ word: g }))
      if (!w) continue
      w.key ??= `w-${k}`
      out.push({ id: c.id('x'), type: 'highlight', track: T_ACCENT, start, end, params: { kind: 'underline', target: w.key, drawIn: ACCENT_DRAW_IN } })
    }
  }
  return out
}

// --- HUD and backdrop ------------------------------------------------------------------------------

/** The script's sections (or, for the «وعد بقائمة» hook, the promised list) on a top HUD. */
function hudScenes(c: Ctx, h: Hook, claims: Span[]): Scene[] {
  const { W } = c
  let secs: { label: string; at: Anchor | number; t: number }[] = []
  if (c.sections.length && (c.preset.hud || h.treatment === 'hud')) {
    secs = c.sections.map((s) => ({ label: fit(splitWords(s.title), 30), at: { word: s.word }, t: W[s.word]!.start }))
  } else if (h.treatment === 'hud') {
    const items = (claims.find((x) => x.kind === 'checklist')?.params?.items ?? []) as { text: string; at: { word: number } }[]
    secs = items.length
      ? items.map((it) => ({ label: fit(splitWords(it.text), 30), at: it.at, t: W[it.at.word]!.start }))
      : [{ label: fit(h.words.map((w) => w.text), 30), at: 0, t: 0 }]
  }
  secs = secs.filter((s, x) => x === 0 || s.t > secs[x - 1]!.t + 1e-9).slice(0, 8)
  if (!secs.length) return []
  return [{ id: 'hud', type: 'hud', track: T_HUD, start: AT0, end: c.videoEnd, params: { sections: secs.map((s) => ({ label: s.label, at: s.at })), progress: 'pips' } }]
}

/**
 * One colour world per section on track 0 (Plan 2a+: the plan's `sections[j].world` / `pattern`;
 * before the first section, or without sections, the look's own). Where the world changes the new
 * backdrop starts exactly on its section word: an instant flip at the cut, never a cross-fade of the
 * text colour. Where it does not (V1, or a hand-edited plan), the new chapter's backdrop starts
 * BG_FADE/2 before its section word and fades in over BG_FADE on top of the previous one, which ends
 * BG_FADE/2 after it (a glow cross-fade centred on the cut). The comment card is never shown in the
 * accent world (measured: its comment post does not register as an event there): the frame flips
 * back to paper as the card comes in. A `dots` pattern reacts to the hero.
 */
function backdropScenes(c: Ctx, plan: ExplainPlan, heroId: string | undefined, halftone: ReadonlySet<number>): Scene[] {
  const { W } = c
  const flips = flipSections(c)
  const tone = (x: number): BackdropTone => (flips.length === 0 ? 'cool' : CHAPTER_TONES[x % CHAPTER_TONES.length]!)
  const half = BG_FADE / 2
  const lookOf = (j: number): { world: BackdropParams['world']; pattern: BackdropParams['pattern'] } => {
    const s = plan.sections[j]
    return { world: s?.world ?? 'paper', pattern: halftone.has(j) && heroId ? 'dots' : (s?.pattern ?? 'none') }
  }
  type Seg = { at: Pt; word?: number; world: BackdropParams['world']; pattern: BackdropParams['pattern'] }
  const segs: Seg[] = [{ at: AT0, ...lookOf(c.sections[0]?.word === 0 ? 0 : -1) }, ...flips.map((f) => ({ at: c.wStart(f.s.word), word: f.s.word, ...lookOf(f.j) }))]
  if (c.ctaKind === 'comment' && segs.at(-1)!.world === 'accent') segs.push({ at: c.speechEnd, world: 'paper', pattern: segs.at(-1)!.pattern })
  const flipAt = (x: number) => x > 0 && segs[x]!.world !== segs[x - 1]!.world
  const shifted = (g: Seg, off: number): Pt => (g.word === undefined ? g.at : { a: { word: g.word, offset: off }, t: W[g.word]!.start + off })
  return segs.map((g, x) => {
    const next = segs[x + 1]
    const react = heroId && g.pattern === 'dots' ? { react: { hero: heroId } } : {}
    return {
      id: `bg${x + 1}`,
      type: 'backdrop',
      track: T_BG,
      start: x === 0 ? AT0 : flipAt(x) ? g.at : shifted(g, -half),
      end: next === undefined ? c.videoEnd : flipAt(x + 1) ? next.at : shifted(next, half),
      params: {
        tone: tone(Math.min(x, flips.length)),
        ...(x > 0 && !flipAt(x) ? { fadeIn: BG_FADE } : {}),
        world: g.world,
        ...(g.pattern !== 'none' ? { pattern: g.pattern } : {}),
        ...react,
      },
    }
  })
}

// --- Validation, JSON, fillers -------------------------------------------------------------------

/**
 * Keeps the transitions that fit (per track, in time order): a window of the type's default
 * length (else 0.3, else 0.2 s) whose half fits both scenes it joins and that does not overlap the
 * previous kept window. A morph that does not fit is dropped (its keys stay, unused).
 */
/** @internal (signature.ts) */
export function validTransitions(trs: Trans[], scenes: Scene[], fps: number): (Trans & { duration: number })[] {
  const snap = (t: number) => Math.round(t * fps) / fps
  const out: (Trans & { duration: number })[] = []
  const lastEnd = new Map<number, number>()
  for (const tr of [...trs].sort((a, b) => a.at.t - b.at.t || a.track - b.track)) {
    const at = snap(tr.at.t)
    const onTrack = scenes.filter((s) => s.track === tr.track)
    const outs = onTrack.filter((s) => Math.abs(snap(s.end.t) - at) < 1e-6)
    const ins = onTrack.filter((s) => Math.abs(snap(s.start.t) - at) < 1e-6)
    if (outs.length !== 1 || ins.length !== 1) continue
    const room = Math.min(snap(outs[0]!.end.t) - snap(outs[0]!.start.t), snap(ins[0]!.end.t) - snap(ins[0]!.start.t))
    const before = lastEnd.get(tr.track) ?? -Infinity
    const d = [defaultTransitionDuration(tr.type), 0.3, 0.2].find((x) => x / 2 <= room + 1e-9 && at - x / 2 >= before + 1 / fps - 1e-9)
    if (d === undefined) continue
    out.push({ ...tr, duration: d })
    lastEnd.set(tr.track, at + d / 2)
  }
  return out
}

function sceneJson(s: Scene): Record<string, unknown> {
  return { id: s.id, type: s.type, track: s.track, ...(s.depth !== undefined ? { depth: s.depth } : {}), start: s.start.a, duration: { until: s.end.a }, params: s.params }
}

function transitionJson(t: Trans & { duration?: number }): Record<string, unknown> {
  const d = t.duration !== undefined && Math.abs(t.duration - defaultTransitionDuration(t.type)) > 1e-9 ? { duration: t.duration } : {}
  const params = t.type === 'morph' ? { key: t.key!, ...(t.hit ? { hit: true } : {}) } : { ...(t.hit ? { hit: true } : {}), ...t.params }
  return { type: t.type, track: t.track, at: t.at.a, ...d, params }
}

function toJson(d: Draft, extra: Scene[] = []): Record<string, unknown> {
  return { ...d.head, scenes: [...d.scenes, ...extra].map(sceneJson), transitions: d.transitions.map(transitionJson), ...d.tail, ...(d.camera ? { camera: d.camera } : {}) }
}

/** Resolves and checks a recipe output exactly like `loadStoryboardFile` + `validateSceneParams`. */
function check(json: unknown, i: ExplainInput): Storyboard {
  try {
    const sb = parseStoryboard(resolveAnchors(json, { transcript: i.transcript, marks: i.marks, fps: i.fps }).json, [...PRIMITIVE_IDS])
    validateSceneParams(sb)
    return sb
  } catch (e) {
    throw new Error(`خلل داخلي في وصفة الشرح — explain recipe produced an invalid storyboard: ${(e as Error).message}`)
  }
}

/**
 * Filler accent per main-line host: an underline under kinetic text, a counter or a screen (a
 * circle around a wide number ran off the frame). Under a checklist (fix wave I4: no more check
 * icons popping above a list that already ticks), an underline under the row ticked last, by its
 * row key; none before the first row is in.
 */
const FILLER_KIND: Record<string, 'underline' | undefined> = {
  'kinetic-text': 'underline',
  counter: 'underline',
  phone: 'underline',
  'app-window': 'underline',
  checklist: 'underline',
}

/**
 * Pace fillers (I2): every gap between planned events longer than `fillerSec` gets evenly spaced
 * highlights on what the main line shows then (FILLER_KIND; target = that scene's key, which covers
 * the filler), drawn in ACCENT_DRAW_IN so the review registers them. Each filler
 * ends at the next one, its host's end or after FILLER_MAX, so fillers never overlap. Nothing over
 * the end card or where the main line is empty.
 */
function withFillers(d: Draft, i: ExplainInput, fillerSec: number, snap: (t: number) => number = (t) => t): { json: unknown; sb: Storyboard } {
  const W = i.transcript.words
  const json0 = toJson(d)
  const sb0 = check(json0, i)
  const p = plannedPace(sb0)
  const end = sb0.scenes.reduce((m, s) => Math.max(m, s.start + s.duration), 0)
  const bounds = [0, ...p.events, end]
  const times: number[] = []
  for (let x = 0; x + 1 < bounds.length; x++) {
    const gap = bounds[x + 1]! - bounds[x]!
    if (gap <= fillerSec + 1e-9) continue
    const m = Math.ceil(gap / fillerSec - 1e-9) - 1
    // Plan 2a+: a filler near a music beat lands on it.
    for (let j = 1; j <= m; j++) times.push(r3(snap(bounds[x]! + (j * gap) / (m + 1))))
  }
  const hostTrack = d.fill?.hostTrack ?? T_MAIN
  const fillTrack = d.fill?.track ?? T_ACCENT
  const byId = new Map(d.scenes.map((s) => [s.id, s]))
  const main = sb0.scenes.filter((s) => (s.track ?? 0) === hostTrack)
  const fillers: Scene[] = []
  const snapDown = (len: number) => Math.floor(len * i.fps + 1e-6) / i.fps
  /** A filler at `t` ending by `limit` (the next filler), or undefined where none can go. */
  const fillerAt = (t: number, limit: number): Scene | undefined => {
    const host = main.find((s) => s.start <= t + 1e-9 && t < s.start + s.duration - 1e-9 && (!d.fill?.host || d.fill.host(byId.get(s.id)!, t - s.start)))
    const kind = host ? FILLER_KIND[host.type] : undefined
    if (!host || !kind) return undefined
    const stop = Math.min(t + FILLER_MAX, host.start + host.duration, limit, end)
    const len = snapDown(stop - t)
    if (len < FILLER_MIN) return undefined
    const scene = byId.get(host.id)!
    // Task 12: a filler that runs to its host's end ends on the host's own end anchor, so a new
    // transcript that moves a word cannot push it past the host (a highlight must stay covered).
    // Both ends are then anchors (frame-snapped), so the length stays a whole number of frames.
    const flush = Math.abs(stop - (host.start + host.duration)) < 1e-6 && typeof scene.end.a !== 'number' && W.length > 0
    let k = flush ? 0 : -1
    for (let q = 0; q < W.length && W[q]!.start <= t + 1e-9; q++) k = q
    const at = (off: number): Pt => (k >= 0 ? { a: { word: k, offset: r3(t - W[k]!.start + off) }, t: t + off } : { a: r3(t + off), t: t + off })
    const id = `f${fillers.length + 1}`
    const fEnd = flush ? scene.end : at(len)
    let target: string
    if (host.type === 'checklist') {
      // The last row fully in (slid in and ticked) by t.
      const items = host.params.items as { at: number }[]
      const keys = (scene.params.items as { key?: string }[]).map((it) => it.key)
      const done = items.map((it, q) => (host.start + it.at + CHECK_IN_SEC <= t + 1e-9 ? q : -1)).filter((q) => q >= 0)
      const q = done.at(-1)
      if (q === undefined || !keys[q]) return undefined
      target = keys[q]!
    } else {
      const own = d.fill?.target?.(scene, t - host.start)
      if (own) target = own
      else {
        scene.params.key ??= `k-${scene.id}`
        target = scene.params.key as string
      }
    }
    return { id, type: 'highlight', track: fillTrack, start: at(0), end: fEnd, params: { kind, target, drawIn: ACCENT_DRAW_IN, ...markColour(d.scenes, t) } }
  }
  times.forEach((t, x) => {
    const f = fillerAt(t, times[x + 1] ?? Infinity)
    if (f) fillers.push(f)
  })
  let json = fillers.length ? toJson(d, fillers) : json0
  let sb = fillers.length ? check(json, i) : sb0
  // Plan 2a+ (Pro Pace binds every type): a gap still above PLAN_MAX_GAP — evenly spaced fillers
  // found no host there, e.g. before a checklist's first row is in — gets a filler at the feasible
  // time nearest its middle (frame steps), if any; a few passes.
  for (let pass = 0; pass < 4; pass++) {
    const ev = [0, ...plannedPace(sb).events, end]
    let added = false
    for (let x = 0; x + 1 < ev.length; x++) {
      const [a, b] = [ev[x]!, ev[x + 1]!]
      if (b - a <= PLAN_MAX_GAP + 1e-9) continue
      const mid = (a + b) / 2
      const cands: number[] = []
      for (let t = a + EVENT_APART; t <= b - EVENT_APART + 1e-9; t += 1 / i.fps) cands.push(r3(t))
      cands.sort((u, v) => Math.abs(u - mid) - Math.abs(v - mid))
      for (const t of cands) {
        // Inside a long filler: it is cut short at t (keeping FILLER_MIN) so a new one can start there.
        const cover = fillers.find((f) => f.start.t <= t + 1e-9 && t < f.end.t - 1e-9)
        if (cover && snapDown(t - cover.start.t) < FILLER_MIN) continue
        const next = Math.min(Infinity, ...fillers.filter((f) => f.start.t > t + 1e-9).map((f) => f.start.t))
        const f = fillerAt(t, next)
        if (!f) continue
        if (cover) cover.end = later(cover.start, snapDown(t - cover.start.t))
        f.id = `f${fillers.length + 1}`
        fillers.push(f)
        added = true
        break
      }
    }
    if (!added) break
    fillers.sort((u, v) => u.start.t - v.start.t)
    json = toJson(d, fillers)
    sb = check(json, i)
  }
  return { json, sb }
}
