import { z } from 'zod'
import { parseCurrency } from '../currency'
import { stemVisualOf, stripClitics } from '../keywords-ar'
import { OBJECT_GEOMETRY, OBJECT_IDS, type ObjectId } from '../objects'
import { oneLine } from '../params/common'
import { KINETIC_MAX_REST_SEC, KINETIC_TIMING } from '../params/kinetic-text'
import { LEVELS_FPS, LEVELS_MAX, OBJECT_SIZE_CAP } from '../params/morph-object'
import { PARTICLE_WORD } from '../params/particle-word'
import { rng } from '../rng'
import { kashidaSlots } from '../text'
import { normalizeAr, transcriptHash } from '../transcript'
import { FORMAT_SIZE, SAFE_AREA, safeRect, type Format } from '../types'
import type { Brief, ExplainInput } from './explain'
import { IDEAS, isNegation, mainWord, stretchableWord, type BeatInfo, type DirectorCtx, type IdeaId } from './ideas'
import {
  AT0,
  beatsOf,
  cleanWord,
  context,
  ECHO_COPIES,
  flipSections,
  ideasOf,
  planHook,
  planSpans,
  r3,
  sec,
  sectionLooks,
  STRETCH_MAX,
  STRETCH_SEC,
  STRETCH_TO,
  validTransitions,
  type Beats,
  type Ctx,
  type Draft,
  type ExplainPlan,
  type Pt,
  type Scene,
  type Trans,
} from './plan'
import { signatureMinOf, TYPE_PRESETS, type TypePreset } from './types'

/**
 * Plan 3 Task 7: the `signature` look — the director spike. Concept first: Claude reads the whole
 * script, writes its idea, metaphor and arc into `plan.json` (`concept`) and a visual per beat
 * (`visual`, a `VisualChoice`; `engine/review/DIRECTOR.md`); this file compiles them exactly as
 * written. Without them the default director picks from each sentence's own words
 * (`stemVisualOf`, OBJECT_STEMS). The composition follows the hand-placed tests Yousif approved
 * (`out/snap8/engine/build-demos.ts` voice 1, `out/snap9/engine/build-v2b.ts` voice 2):
 *
 * - one paper / ink `backdrop` per section on track 0 (depth 0.3, printed `material`, halftone in
 *   the last), `reveal`s at the section cuts (circle → bands → panel) opening from the hero;
 * - headlines: one short line at a time on fixed track 5 near the top of the safe area (the
 *   headline zone), `rise` (long lines) or `mask`; a punch only on a one-word line (R33), a
 *   stressed word inside a shared line in the accent colour (R20);
 * - the hero: `morph-object` on track 4 (depth 1.35) resting as a dot in the object zone and
 *   becoming each beat's object at its word; split around the `particle-word` (R23): the dot
 *   bursts into the CTA keyword's letters and the hero comes back 0.3 s after the land;
 * - chase / word wall / repeat loop on track 2 while the hero waits as a small dot at the bottom;
 * - the camera: handheld, shakes on stressed words and object lands, short pushes on objects;
 * - the comment card on track 2 with the hero as a small dot below it.
 *
 * Pure and deterministic.
 */

// ---------------------------------------------------------------------------------------------
// plan.json: concept and visual choices

const word = z.number().int().min(0)

/** A beat's visual as Claude (or the default director) chose it; `word` is a transcript index inside the beat. */
export const visualChoiceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('object'),
      object: z.enum(OBJECT_IDS, {
        error: (iss) => `شكل غير معروف «${String(iss.input)}»، المتاح: ${OBJECT_IDS.join('، ')} — unknown object "${String(iss.input)}"; known: ${OBJECT_IDS.join(', ')}`,
      }),
      /** Document: the line it writes first (decoration; the readable word is the headline). */
      text: oneLine(40).optional(),
      /** Calendar: seconds per month page. */
      flipSec: z.number().positive().max(10).optional(),
      /** Phone app: seconds after arrival when the notification becomes the paid check (house, blueprint, eye, chat: their second beat). */
      checkAt: z.number().positive().max(30).optional(),
      /** Coin: turns of the flip (default 1). */
      spin: z.number().min(-8).max(8).optional(),
      /** Stage 2: the object's later moments, s after arrival (ascending; see `beats` on a morph state). */
      beats: z.array(z.number().min(0).max(30)).max(8).refine((b) => b.every((v, i) => i === 0 || v >= b[i - 1]!), { message: 'الإيقاعات مرتبة تصاعديًا — beats must be in ascending order' }).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('chase'), customers: z.number().int().min(3).max(7).optional() }).strict(),
  z.object({ kind: z.literal('wall'), word }).strict(),
  z.object({ kind: z.literal('loop'), word }).strict(),
  z.object({ kind: z.literal('particles'), word }).strict(),
  z.object({ kind: z.literal('none') }).strict(),
])
export type VisualChoice = z.output<typeof visualChoiceSchema>

/** The concept Claude writes before any visual: the idea, one central metaphor, one arc line per section. */
export const conceptSchema = z
  .object({
    idea: z.string().max(400),
    metaphor: z.string().max(200),
    arc: z.array(z.string().max(200)).max(12),
  })
  .strict()

// ---------------------------------------------------------------------------------------------
// Constants (safe-area fractions unless noted)

export const SIGNATURE = {
  /** Most words in one headline line. */
  lineWords: 3,
  /** Headline: the zone is the top `zone` of the safe height; the line centre sits at `y` of it. */
  headline: { zone: 0.36, y: 0.2 },
  /** The object zone (safe height) and the hero's rest point. */
  objectZone: [0.42, 0.85] as const,
  rest: { x: 0.5, y: 0.62 },
  /** Dot sizes: resting, out of the way (a chase / wall / loop), under the end card. */
  dot: 0.07,
  away: { size: 0.04, y: 0.97 },
  cta: { size: 0.05, y: 0.97 },
  /** Parallax depths (R3, R4). */
  depth: { backdrop: 0.3, hero: 1.35, scene: 1 },
  /** States closer than this (s) replace each other. */
  minGap: 0.12,
  /** A section's first object this close to the cut (s) replaces the rest dot there. */
  sectionLead: 0.5,
  /** The particle word: burst this long after the line starts, a flight of at least `flight`, the hero back `back` s after the land. */
  particles: { burst: 0.05, flight: 0.45, back: 0.3, minStart: 1, restBefore: 0.25 },
  /** Camera: push ramp (s), the way back (s), handheld amplitude, shake amplitudes (px) and their spacing (s), pan limit (frame). */
  camera: { ramp: 0.55, back: 0.35, handheld: 1, shakeStress: 15, shakeLand: 9, shakeApart: 0.3, pan: 0.06 },
  /** Lines of at most this many characters wipe in (`mask`); longer ones `rise` (R33). */
  maskChars: 9,
  /** Repeat loop at the object-zone centre (R32). */
  loop: { at: { x: 0.5, y: 0.635 }, size: 0.36, copies: 5 },
  /** The wall stays texture under its headline (alpha 0.14, the 2a+ wall behind text): at 0.3 its copies crowded the line. */
  wall: { rows: 7, cols: 3, highlight: 10, speed: 45, alpha: 0.14 },
  /** The default director keeps an object at least this long (s) before the next object replaces it. */
  objectHold: 1,
  chase: { customers: 5, size: 0.62, lapsPerSec: 0.64 },
  /** A chase / wall / loop shows at least this long (s); a shorter beat lends it the beat around it that shows nothing (up to `sceneSpan` s). */
  sceneMin: 0.6,
  sceneSpan: 1.6,
  /** The end card's keyword as a slow wall behind it, `in` s into the card (the 2a+ measured event). */
  ctaWall: { in: 0.85, rows: 6, cols: 2, speed: 24, alpha: 0.1 },
  /** Rings under the end card: this long after it starts, then every `every` s. */
  ctaRings: { first: 0.8, every: 1.1 },
  /** Most states in one hero scene (`morphObjectParams`) and rings. */
  maxStates: 12,
  maxRings: 32,
} as const

/** Object sizes (fraction of the safe width) before the format and object caps; from the approved tests. */
const OBJECT_SIZE: Record<ObjectId, number> = {
  dot: 0.07,
  ring: 0.3,
  bar: 0.4,
  clock: 0.4,
  coin: 0.42,
  document: 0.42,
  microphone: 0.4,
  timeline: 0.44,
  calendar: 0.42,
  envelope: 0.4,
  bell: 0.42,
  'voice-note': 0.55,
  'phone-app': 0.44,
  brick: 0.42,
  house: 0.5,
  blueprint: 0.38,
  eye: 0.5,
  photo: 0.42,
  chat: 0.6,
  banknote: 0.5,
  scale: 0.56,
  materials: 0.6,
  sun: 0.42,
  room: 0.58,
  pin: 0.55,
  window: 0.46,
  'sun-path': 0.62,
  file: 0.36,
  'hard-hat': 0.62,
  bulb: 0.4,
  'ai-chip': 0.46,
  tool: 0.46,
  magnifier: 0.6,
  follow: 0.62,
  compass: 0.46,
  receipt: 0.4,
  camera: 0.5,
  heart: 0.42,
  star: 0.44,
  play: 0.62,
  cart: 0.5,
  book: 0.6,
  megaphone: 0.54,
  rocket: 0.5,
}
/** The envelope sits lower: its invoices fan out above it. */
const OBJECT_Y: Partial<Record<ObjectId, number>> = { envelope: 0.7 }
/** Camera push zoom per object (≤ 1.15; big objects less). */
const PUSH_ZOOM: Partial<Record<ObjectId, number>> = {
  coin: 1.15,
  clock: 1.12,
  calendar: 1.1,
  envelope: 1.1,
  bell: 1.1,
  document: 1.08,
  microphone: 1.08,
  'phone-app': 1.08,
  'voice-note': 1.06,
  timeline: 1.06,
}
/** Objects that follow the voice (`levels`). */
const LEVEL_OBJECTS: ReadonlySet<ObjectId> = new Set(['microphone', 'voice-note', 'timeline'])
/** Abstract shapes: bridges between ideas, never pushed on. */
const ABSTRACT: ReadonlySet<ObjectId> = new Set(['dot', 'ring', 'bar'])
const REVEAL_SHAPES = ['circle', 'bands', 'panel'] as const
/** 2a+ ideas the signature headline can carry (word effects; a giant word stands alone on its line). */
const SIGNATURE_IDEAS: ReadonlySet<IdeaId> = new Set(['giant-word', 'kashida-stretch', 'echo-word', 'strike'])

const OBJECT_AR: Record<ObjectId, string> = {
  dot: 'نقطة',
  ring: 'حلقة',
  bar: 'شريط',
  clock: 'ساعة',
  coin: 'عملة',
  document: 'ورقة تُكتب',
  microphone: 'مايكروفون',
  timeline: 'خط المونتاج',
  calendar: 'تقويم',
  envelope: 'ظرف الفواتير',
  bell: 'جرس التذكير',
  'voice-note': 'رسالة صوتية',
  'phone-app': 'تطبيق الجوال',
  brick: 'طابوقة',
  house: 'بيت',
  blueprint: 'خريطة البيت',
  eye: 'عين',
  photo: 'صورة المخطط',
  chat: 'محادثة',
  banknote: 'ورقة نقدية',
  scale: 'ميزان',
  materials: 'مواد البناء',
  sun: 'شمس',
  room: 'غرفة النوم',
  pin: 'موقعك على الخريطة',
  window: 'شبّاك',
  'sun-path': 'مسار الشمس',
  file: 'ملف واحد',
  'hard-hat': 'مهندسين زعلانين',
  bulb: 'فكرة',
  'ai-chip': 'الذكاء الاصطناعي',
  tool: 'أداة مفيدة',
  magnifier: 'نتحقّق من النتائج',
  follow: 'تابعني',
  compass: 'بوصلة',
  receipt: 'طلبية شراء',
  camera: 'كاميرا',
  heart: 'قلب',
  star: 'نجمة',
  play: 'فيديو',
  cart: 'سلة التسوّق',
  book: 'كتاب',
  megaphone: 'إعلان',
  rocket: 'انطلاق',
}

const T_BG = 0
const T_SCENE = 2
const T_HERO = 4
const T_HEAD = 5

// ---------------------------------------------------------------------------------------------
// Beats and the default director

interface SigBeats {
  c: Ctx
  B: Beats
  /** Transcript indices of the CTA keyword's occurrences. */
  cta: ReadonlySet<number>
}

function sigBeats(i: ExplainInput, brief: Brief, preset: TypePreset): SigBeats {
  const c = context(i, brief, preset, [], SIGNATURE.lineWords)
  const hook = planHook(c)
  const B = beatsOf(c, hook, planSpans(c, hook.end, []))
  const kw = brief.cta?.keyword ? normalizeAr(brief.cta.keyword) : undefined
  const cta = new Set<number>()
  if (kw) c.W.forEach((w, k) => stripClitics(w.text).includes(kw) && cta.add(k))
  return { c, B, cta }
}

/** The beat's stem hit (words relative to the beat), the CTA keyword blanked. */
const hitOf = (s: SigBeats, b: BeatInfo) => stemVisualOf(b.words, (q) => s.cta.has(b.from + q))

/** A document writes the word after «اكتب» (its object), else the stem word itself. */
function documentText(s: SigBeats, b: BeatInfo): string | undefined {
  const h = hitOf(s, b)
  if (!h) return undefined
  const w = b.words[h.word] ?? ''
  const verb = stripClitics(w).some((x) => x === 'اكتب' || x.startsWith('كتاب'))
  const text = cleanWord(verb && h.word + 1 < b.words.length ? b.words[h.word + 1]! : w)
  return text && [...text].length <= 24 ? text : undefined
}

/**
 * The default director (the fallback when plan.json has no visuals): the first beat with the CTA
 * keyword (not the hook) → `particles`; every other beat → the object (or chase / wall / loop) its
 * own words call for, else `none`; a section left without any object gets a `ring` bridge on its
 * first stressed (else longest) beat — except the end card's section.
 */
function defaultVisuals(s: SigBeats): VisualChoice[] {
  const { c, B } = s
  const out: VisualChoice[] = B.infos.map((b): VisualChoice => {
    const h = hitOf(s, b)
    if (!h) return { kind: 'none' }
    if (h.kind === 'chase') return { kind: 'chase' }
    if (h.kind === 'wall' || h.kind === 'loop') return { kind: h.kind, word: b.from + h.word }
    const text = h.kind === 'document' ? documentText(s, b) : undefined
    return { kind: 'object', object: h.kind, ...(text ? { text } : {}) }
  })
  // An object holds at least SIGNATURE.objectHold before the next one (in its section) replaces it.
  let last: { t: number; j: number } | undefined
  B.infos.forEach((b, x) => {
    const v = out[x]!
    if (v.kind !== 'object') return
    const h = hitOf(s, b)
    const t = c.W[b.from + (h && h.first >= 0 ? h.first : 0)]!.start
    const j = c.sections.filter((sct) => sct.word <= b.from).length
    if (last && last.j === j && t - last.t < SIGNATURE.objectHold) out[x] = { kind: 'none' }
    else last = { t, j }
  })
  const k = [...s.cta].sort((a, b) => a - b).find((q) => c.W[q]!.start >= SIGNATURE.particles.minStart)
  const x = k === undefined ? -1 : B.infos.findIndex((b) => b.from <= k && k < b.to)
  if (x > 0) out[x] = { kind: 'particles', word: k! }
  // Ring bridges.
  const sections = new Map<number, number[]>()
  B.infos.forEach((b, q) => {
    let j = -1
    c.sections.forEach((sct, n) => sct.word <= b.from && (j = n))
    sections.set(j, [...(sections.get(j) ?? []), q])
  })
  for (const xs of sections.values()) {
    if (xs.some((q) => out[q]!.kind === 'object')) continue
    if (xs.some((q) => [...s.cta].some((w) => B.infos[q]!.from <= w && w < B.infos[q]!.to))) continue
    const free = xs.filter((q) => out[q]!.kind === 'none')
    const pick = free.find((q) => B.infos[q]!.stress.length > 0) ?? [...free].sort((a, b) => B.secs[b]! - B.secs[a]! || a - b)[0]
    if (pick !== undefined) out[pick] = { kind: 'object', object: 'ring' }
  }
  return out
}

/** The signature director's ideas: the earliest stressed word of a beat showing no object (not the hook) is stretched, or stands alone. */
function defaultIdeas(B: Beats, visuals: readonly VisualChoice[]): (IdeaId | undefined)[] {
  const out: (IdeaId | undefined)[] = B.infos.map(() => undefined)
  for (const b of B.infos) {
    if (b.i === 0 || !b.stress.length || visuals[b.i]!.kind === 'object') continue
    out[b.i] = stretchableWord({ ...b, keywords: [] }) !== undefined ? 'kashida-stretch' : 'giant-word'
    break
  }
  return out
}

/**
 * The plan of a `signature` video (`planExplainer` with `look: 'signature'`): beats are the
 * headline lines (no checklists, counters or screens), sections alternate paper / ink, every beat
 * carries the default director's `visual`, and `concept` is written empty for Claude to fill.
 */
export function planSignature(
  i: ExplainInput,
  brief: Brief,
  warnings: string[],
  base: { type: ExplainPlan['type']; camera: ExplainPlan['camera']; family: ExplainPlan['hook']['family']; wordsPerShot: ExplainPlan['wordsPerShot']; punchScale: number },
): ExplainPlan {
  const preset = TYPE_PRESETS[base.type]
  const s = sigBeats(i, brief, preset)
  const { c, B } = s
  const hook = planHook(c)
  const visuals = defaultVisuals(s)
  const ideas = defaultIdeas(B, visuals)
  const R = rng(i.seed)
  const w0 = c.sections[0]?.word === 0 ? 0 : 1
  const sections = sectionLooks(c, R).map((x, j) => ({ ...x, world: (j + w0) % 2 === 0 ? ('paper' as const) : ('ink' as const), pattern: 'none' as const }))
  const beats: ExplainPlan['beats'] = B.infos.map((b, x) => ({ i: x, from: b.from, to: b.to, kind: 'text', ...(ideas[x] ? { idea: ideas[x] } : {}), visual: visuals[x]!, words: b.words }))
  const plan: ExplainPlan = {
    version: 1,
    transcriptHash: i.transcriptSha1 ?? transcriptHash(i.transcript),
    type: base.type,
    format: brief.format ?? '9:16',
    look: 'signature',
    seed: i.seed,
    hook: { family: base.family, text: hook.words.map((w) => w.text).join(' '), treatment: hook.treatment },
    concept: { idea: '', metaphor: '', arc: [] },
    sections,
    beats,
    camera: base.camera,
    transitions: ['reveal'],
    signature: [],
    wordsPerShot: base.wordsPerShot,
    punchScale: base.punchScale,
    ...(brief.beat ? { beat: { bpm: brief.beat.bpm, offset: brief.beat.offset ?? 0 } } : {}),
    warnings,
  }
  plan.signature = momentsOf(plan, s).map((m) => m.id)
  const min = signatureMinOf(preset, c.videoEnd.t)
  if (plan.signature.length < min) {
    warnings.push(`لحظات مميزة أقل من الحد (${plan.signature.length}/${min}) — fewer signature moments than the type's minimum (${plan.signature.length}/${min})`)
  }
  return plan
}

/** The signature moments of a signature plan in time order: world flips, the hero's objects, the particle word, scenes, stretched words. */
function momentsOf(plan: ExplainPlan, s: SigBeats): { id: IdeaId; label: string }[] {
  const { c, B } = s
  const out: { id: IdeaId; label: string }[] = []
  const flips = new Set(flipSections(c).map((f) => f.j))
  const w = (k: number) => `«${cleanWord(c.W[k]!.text) ?? ''}»`
  const visuals = visualsOf(plan, s, [])
  B.infos.forEach((b, x) => {
    for (const [j, sct] of c.sections.entries()) {
      if (flips.has(j) && b.from <= sct.word && sct.word < Math.max(b.to, b.from + 1)) out.push({ id: 'world-flip', label: `${IDEAS['world-flip'].ar} (${plan.sections[j]?.world ?? 'paper'})` })
    }
    const v = visuals[x]!
    if (v.kind === 'object' && !ABSTRACT.has(v.object)) {
      const h = hitOf(s, b)
      out.push({ id: 'hero-handoff', label: `${OBJECT_AR[v.object]} ${w(h && h.first >= 0 ? b.from + h.first : (b.stress[0] ?? b.from))}` })
    }
    if (v.kind === 'particles') out.push({ id: 'hero-handoff', label: `كلمة من جسيمات ${w(v.word)}` })
    if (v.kind === 'wall') out.push({ id: 'word-wall', label: `${IDEAS['word-wall'].ar} ${w(v.word)}` })
    if (v.kind === 'loop') out.push({ id: 'word-wall', label: `حلقة التكرار ${w(v.word)}` })
    if (v.kind === 'chase') out.push({ id: 'hero-handoff', label: 'مطاردة العملاء' })
    const id = plan.beats.find((p) => p.from === b.from && p.to === b.to)?.idea
    if (id === 'kashida-stretch') {
      const k = stretchableWord(b)
      out.push({ id, label: `${IDEAS[id].ar}${k === undefined ? '' : ` ${w(k)}`}` })
    }
  })
  return out
}

/** The CLI's signature labels of a signature plan. */
export function signatureMoments(plan: ExplainPlan, i: ExplainInput, brief: Brief): string[] {
  return momentsOf(plan, sigBeats(i, brief, TYPE_PRESETS[plan.type])).map((m) => m.label)
}

const visualError = (x: number, text: string, ar: string, en: string) => new Error(`المقطع ${x} («${text}»): ${ar} — plan beat ${x}: ${en}`)

/**
 * Per compiled beat, the plan's visual (`kind`) when the plan has one for the same words, else
 * the default director's. A word outside its beat is an error (Arabic first); a second
 * `particles` is warned about and shows nothing.
 */
function visualsOf(plan: ExplainPlan, s: SigBeats, warnings: string[]): VisualChoice[] {
  const dflt = defaultVisuals(s)
  const out = s.B.infos.map((b, x): VisualChoice => {
    const pb = plan.beats.find((p) => p.from === b.from && p.to === b.to)
    const v = pb?.visual && 'kind' in pb.visual ? pb.visual : undefined
    if (!v) return dflt[x]!
    if ('word' in v && !(v.word >= b.from && v.word < b.to)) {
      throw visualError(pb!.i, b.words.join(' '), `الكلمة ${v.word} خارج كلمات المقطع (${b.from}–${b.to - 1})`, `visual word ${v.word} is outside the beat's words ${b.from}–${b.to - 1}`)
    }
    if ((v.kind === 'wall' || v.kind === 'loop' || v.kind === 'particles') && cleanWord(s.c.W[v.word]!.text) === undefined) {
      throw visualError(pb!.i, b.words.join(' '), `الكلمة ${v.word} ليست كلمة تُعرض`, `visual word ${v.word} has no text to show`)
    }
    return v
  })
  for (const pb of plan.beats) {
    if (pb.visual && 'kind' in pb.visual && !s.B.infos.some((b) => b.from === pb.from && b.to === pb.to)) {
      warnings.push(`المقطع ${pb.i} («${pb.words.join(' ')}») لا يطابق مقاطع التفريغ؛ يُتجاهل اختياره — plan beat ${pb.i} (words ${pb.from}–${pb.to}) matches no beat of the transcript; its visual "${pb.visual.kind}" is ignored`)
    }
  }
  // Only a kept particles beat counts: one dropped from the hook leaves a later one in place.
  let seen = false
  out.forEach((v, x) => {
    if (v.kind !== 'particles') return
    if (seen || x === 0) {
      warnings.push(`كلمة الجسيمات مرة واحدة فقط وليست في الافتتاحية؛ المقطع ${x} بلا جسيمات — only one particle word per video, never in the hook: beat ${x} shows none`)
      out[x] = { kind: 'none' }
      return
    }
    seen = true
  })
  return out
}

// ---------------------------------------------------------------------------------------------
// Composition

interface Line {
  from: number
  to: number
  beat: number
  giant: boolean
  start: Pt
  end: Pt
  /** Brief hook words (no transcript index) for a hook with its own text. */
  hookWords?: string[]
}

interface HeroState {
  at: number
  object: ObjectId
  size: number
  x: number
  y: number
  role: 'rest' | 'away' | 'cta' | 'object'
  land?: boolean
  spin?: number
  text?: string
  flipSec?: number
  checkAt?: number
  beats?: number[]
}

/** A seconds point on the frame grid. */
const snapper = (fps: number) => (t: number) => Math.round(t * fps) / fps

/** The size of `o` in `format`: its approved size, capped so its drawn box stays in the object zone and the safe width (R7). */
function objectSize(o: ObjectId, format: Format): number {
  const s = safeRect(format)
  const g = (OBJECT_GEOMETRY as Partial<Record<ObjectId, { w: number; h: number }>>)[o] ?? { w: 1, h: 1 }
  const zoneH = SIGNATURE.objectZone[1] - SIGNATURE.objectZone[0]
  // Round objects: R7's 0.42 × safeH / safeW; taller / wider ones scaled by their geometry.
  return r3(Math.min(OBJECT_SIZE[o], ((0.42 * s.h) / s.w) / Math.max(1, g.h), 0.96 / Math.max(1, g.w), (zoneH * s.h) / s.w, OBJECT_SIZE_CAP[o] ?? Infinity))
}

/** Levels of the voice over [from, to) s, normalised by their 95th percentile like `voiceLevels`. */
function levelsOf(all: readonly number[] | undefined, from: number, to: number): number[] | undefined {
  if (!all?.length) return undefined
  const a = Math.max(0, Math.round(from * LEVELS_FPS))
  const b = Math.min(all.length, Math.round(to * LEVELS_FPS), a + LEVELS_MAX)
  if (b - a < 2) return undefined
  const xs = all.slice(a, b)
  const sorted = [...xs].sort((u, v) => u - v)
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0
  if (!(p95 > 1e-6)) return xs.map(() => 0)
  return xs.map((v) => r3(Math.min(1, Math.max(0, v / p95))))
}

/**
 * The signature storyboard draft of a plan (see the file comment). Visual times: an object or a
 * chase at the beat's first stem word (else its first stressed word, else its start); a wall or a
 * loop at the beat's start.
 */
export function composeSignature(i: ExplainInput, brief: Brief, preset: TypePreset, plan: ExplainPlan, warnings: string[]): Draft {
  const s = sigBeats(i, brief, preset)
  const { c, B } = s
  const fps = i.fps
  const snap = snapper(fps)
  const format = plan.format
  const safe = safeRect(format)
  const area = SAFE_AREA[format]
  const safeHf = 1 - area.top - area.bottom
  const hook = planHook(c)
  const visuals = visualsOf(plan, s, warnings)

  // Ideas: the plan's, checked like 2a+ (`ideaFits`), and only the headline ones.
  const ideas = ideasOf(plan, B, { type: plan.type, hero: false, camera: plan.camera } satisfies DirectorCtx, warnings).map((id, x) => {
    if (id && !SIGNATURE_IDEAS.has(id)) {
      warnings.push(`الفكرة «${IDEAS[id].ar}» لا تُستخدم في مظهر signature؛ المقطع ${x} بدونها — idea "${id}" is not used by the signature look: beat ${x} shows without it`)
      return undefined
    }
    return id
  })
  if (brief.screens?.length) warnings.push('مظهر signature لا يعرض لقطات الشاشة بعد — the signature look does not show brief.screens yet; they are left out')
  const cur = parseCurrency(brief.currency)
  if (cur.unknown) warnings.push(`عملة غير معروفة «${cur.unknown}» (brief.currency)؛ تُرسم علامة الدرهم — unknown currency "${cur.unknown}" (brief.currency), the coin shows AED`)

  // --- Lines (headlines): a beat per line; a giant word stands alone between its neighbours.
  const lines: Line[] = []
  B.infos.forEach((b, x) => {
    const k = ideas[x] === 'giant-word' ? mainWord(b) : undefined
    const pieces = k === undefined ? [{ from: b.from, to: b.to, giant: false }] : [{ from: b.from, to: k, giant: false }, { from: k, to: k + 1, giant: true }, { from: k + 1, to: b.to, giant: false }]
    for (const p of pieces.filter((q) => q.to > q.from)) lines.push({ ...p, beat: x, start: lines.length === 0 ? AT0 : c.wStart(p.from), end: AT0 })
  })
  if (hook.words.some((w) => w.word === undefined) && lines[0]) {
    // A hook with its own text (brief.hook.text / title): its line shows that text until the spoken words take over.
    lines[0] = { ...lines[0], hookWords: hook.words.map((w) => w.text) }
  }
  lines.forEach((l, q) => (l.end = lines[q + 1]?.start ?? c.speechEnd))
  const lineOfWord = (k: number) => lines.find((l) => l.from <= k && k < l.to)
  const beatStart = (x: number) => snap(x === 0 ? 0 : c.W[B.infos[x]!.from]!.start)
  const beatEnd = (x: number) => snap(lines.filter((l) => l.beat === x).at(-1)!.end.t)

  // --- The particle word (amendment C, R19, R20, R23).
  let pw: { k: number; line: Line; startAbs: number; burst: number; land: number } | undefined
  const px = visuals.findIndex((v) => v.kind === 'particles')
  if (px > 0) {
    const k = (visuals[px] as { word: number }).word
    const line = lineOfWord(k)!
    const startAbs = snap(line.start.t)
    const burst = snap(startAbs + SIGNATURE.particles.burst)
    const land = snap(Math.max(c.W[k]!.start, burst + SIGNATURE.particles.flight))
    const len = snap(line.end.t) - startAbs
    if (land - startAbs + PARTICLE_WORD.fade + 0.05 <= len && line.hookWords === undefined) pw = { k, line, startAbs, burst, land }
    else {
      warnings.push(`لا وقت لكلمة الجسيمات «${cleanWord(c.W[k]!.text) ?? ''}» في سطرها — no time for the particle word "${cleanWord(c.W[k]!.text) ?? ''}" in its line; not shown`)
      visuals[px] = { kind: 'none' }
    }
  }

  // --- Headline scenes.
  const headY = r3(area.top + SIGNATURE.headline.y * safeHf)
  const heads: Scene[] = []
  for (const [q, l] of lines.entries()) {
    const b = B.infos[l.beat]!
    const idea = ideas[l.beat]
    const ks = Array.from({ length: l.to - l.from }, (_, n) => l.from + n).filter((k) => cleanWord(c.W[k]!.text) !== undefined)
    const effect = new Map<number, Record<string, unknown>>()
    const add = (k: number | undefined, e: Record<string, unknown>) => k !== undefined && k >= l.from && k < l.to && effect.set(k, { ...effect.get(k), ...e })
    if (idea === 'kashida-stretch') {
      const k = stretchableWord(b)
      if (k !== undefined) {
        const slots = kashidaSlots(cleanWord(c.W[k]!.text) ?? '').length
        add(k, { stretch: { to: Math.min(STRETCH_MAX, Math.max(STRETCH_TO, 2 * slots)), at: { word: k }, duration: r3(Math.max(0.1, Math.min(STRETCH_SEC, c.W[k]!.end - c.W[k]!.start))) } })
      }
    }
    if (idea === 'echo-word') add(b.stress[0], { echo: ECHO_COPIES })
    if (idea === 'strike') {
      for (let k = b.from; k + 1 < b.to; k++) {
        if (!isNegation(c.W[k]!.text) && !b.numbers.includes(k)) continue
        const struck = isNegation(c.W[k]!.text) ? k + 1 : k
        add(struck, { strike: { at: struck + 1 < l.to ? { word: struck + 1 } : { word: struck, offset: 0.15 } } })
        break
      }
    }
    let words: Record<string, unknown>[]
    if (l.hookWords) {
      const n = l.hookWords.length
      words = l.hookWords.map((text, j) => ({ text, at: n <= 1 ? 0 : r3((j * 0.3) / (n - 1)), stress: 0 }))
    } else {
      const single = ks.length === 1
      words = ks.map((k) => {
        const stressed = c.stress.has(k)
        const stress = single && (stressed || l.giant) ? 2 : 0
        const target = pw?.k === k
        return {
          text: cleanWord(c.W[k]!.text)!,
          at: target ? r3(pw!.land - pw!.startAbs) : { word: k },
          stress,
          word: k,
          key: `w${k}`,
          ...(stress === 2 && plan.punchScale !== KINETIC_TIMING.punch[2] ? { punch: plan.punchScale } : {}),
          ...((stressed && !single) || target ? { color: 'accent' } : {}),
          ...effect.get(k),
        }
      })
    }
    if (!words.length) words = [{ text: '…', at: 0, stress: 0 }]
    const chars = [...words.map((w) => w.text as string).join(' ')].length
    const enter = pw?.line === l ? 'fade' : chars <= SIGNATURE.maskChars ? 'mask' : 'rise'
    const sc: Scene = { id: `h${q + 1}`, type: 'kinetic-text', track: T_HEAD, start: l.start, end: l.end, params: { words, mode: 'line', enter, y: headY } }
    // A kinetic scene can not outlast KINETIC_MAX_REST_SEC: end it after its last word instead.
    const maxSec = KINETIC_MAX_REST_SEC - 0.5
    if (l.end.t - l.start.t > maxSec && ks.length) sc.end = c.wEnd(ks.at(-1)!, Math.max(0.1, Math.min(1, maxSec - (c.W[ks.at(-1)!]!.end - l.start.t))))
    heads.push(sc)
  }
  const pwLine = pw ? heads[lines.indexOf(pw.line)] : undefined

  // --- The hero's states (absolute s) and the scenes it gives way to.
  const sceneAway: Scene[] = []
  const rest = (at: number): HeroState => ({ at, object: 'dot', size: SIGNATURE.dot, ...SIGNATURE.rest, role: 'rest' })
  const away = (at: number): HeroState => ({ at, object: 'dot', size: SIGNATURE.away.size, x: 0.5, y: SIGNATURE.away.y, role: 'away' })
  const states: HeroState[] = [rest(0)]
  const samePose = (a: HeroState, b: HeroState) => a.object === b.object && a.size === b.size && a.x === b.x && a.y === b.y
  const put = (st: HeroState) => {
    const last = states.at(-1)!
    if (samePose(last, st) && !st.land) return
    if (st.at <= last.at + SIGNATURE.minGap) {
      if (last.role === 'object' && st.role !== 'object' && states.length > 1) return
      const prev = states.at(-2)
      states[states.length - 1] = { ...st, at: prev ? Math.max(st.at, snap(prev.at + SIGNATURE.minGap)) : st.at }
      return
    }
    states.push(st)
  }
  const visualTime = (x: number, v: VisualChoice): number => {
    const b = B.infos[x]!
    if (v.kind === 'object' || v.kind === 'chase') {
      const h = hitOf(s, b)
      if (h && h.first >= 0) return snap(c.W[b.from + h.first]!.start)
      if (b.stress[0] !== undefined) return snap(c.W[b.stress[0]]!.start)
    }
    return beatStart(x)
  }
  let firstInSection = true
  let awayUntil = -1
  const resumeAt = pw ? snap(pw.land + SIGNATURE.particles.back) : Infinity
  B.infos.forEach((b, x) => {
    const v = visuals[x]!
    const t0 = beatStart(x)
    const t1 = beatEnd(x)
    let tv = visualTime(x, v)
    // Nothing new while the particles fly: a visual due then waits for the hero to come back.
    if (pw && x !== px && tv > pw.burst - 1e-9 && tv < resumeAt + 0.05) tv = snap(resumeAt + 0.05)
    if (x > 0 && c.sectionAt.has(b.from)) {
      firstInSection = true
      const objectNext = v.kind === 'object' && tv - t0 <= SIGNATURE.sectionLead
      if (!objectNext && states.at(-1)!.role !== 'rest' && !(pw && t0 > pw.burst - 1e-9 && t0 < resumeAt)) put(rest(t0))
    }
    const scenic = v.kind === 'chase' || v.kind === 'wall' || v.kind === 'loop'
    if (awayUntil >= 0 && !scenic) {
      if (!(v.kind === 'object' && tv - t0 <= 0.3)) put(rest(Math.max(t0, awayUntil)))
      awayUntil = -1
    }
    if (v.kind === 'object') {
      const last = states.at(-1)!
      const again = last.role === 'object' && last.object === v.object
      // The same object again re-lands a little larger (the approved test's «٣٠٠ ساعة»).
      const base = objectSize(v.object, format)
      const size = again ? r3(Math.min(last.size * 1.12, base * 1.15, OBJECT_SIZE_CAP[v.object] ?? Infinity)) : base
      const text = v.text ?? (v.object === 'document' ? documentText(s, b) : undefined)
      const spin = v.object === 'coin' ? (v.spin ?? 1) : v.spin
      put({
        at: tv,
        object: v.object,
        size: Math.min(size, safeCap(v.object, format)),
        x: 0.5,
        y: OBJECT_Y[v.object] ?? SIGNATURE.rest.y,
        role: 'object',
        ...(firstInSection || again ? { land: true } : {}),
        ...(spin !== undefined ? { spin } : {}),
        ...(text ? { text } : {}),
        ...(v.flipSec !== undefined ? { flipSec: v.flipSec } : {}),
        ...(v.checkAt !== undefined ? { checkAt: v.checkAt } : {}),
        ...(v.beats !== undefined ? { beats: v.beats } : {}),
      })
      firstInSection = false
    } else if (scenic) {
      // A short beat borrows the neighbouring beat that shows nothing, in its section (the approved
      // test's loop covered «على شغل مكرر»).
      const sectionOf = (q: number) => c.sections.filter((x2) => x2.word <= B.infos[q]!.from).length
      const free = (q: number) => q > 0 && q < B.infos.length && visuals[q]!.kind === 'none' && sectionOf(q) === sectionOf(x) && q !== px
      let start = tv
      let until = t1
      if (t1 - tv < 1 && free(x - 1) && tv - beatStart(x - 1) <= SIGNATURE.sceneSpan) start = beatStart(x - 1)
      if (until - start < 1 && free(x + 1)) until = Math.min(beatEnd(x + 1), start + SIGNATURE.sceneSpan)
      if (states.at(-1)!.at >= start - SIGNATURE.minGap && states.at(-1)!.role === 'object') start = Math.max(tv, snap(states.at(-1)!.at + 0.6))
      const next = c.sections.map((x2) => snap(c.W[x2.word]!.start)).filter((t) => t > start + 1e-9)
      const end = Math.min(Math.max(until, start + SIGNATURE.sceneMin), ...next, snap(c.videoEnd.t))
      if (end - start < SIGNATURE.sceneMin - 1e-9) {
        warnings.push(`لا وقت للمشهد «${v.kind}» في المقطع ${x} — no time for the ${v.kind} scene of beat ${x}; not shown`)
        return
      }
      put(away(start))
      awayUntil = end
      const id = `${v.kind}${sceneAway.length + 1}`
      const common = { id, track: T_SCENE, start: sec(start), end: sec(end), depth: SIGNATURE.depth.scene }
      if (v.kind === 'chase') {
        const size = r3(Math.min(SIGNATURE.chase.size, ((SIGNATURE.objectZone[1] - SIGNATURE.objectZone[0]) * safe.h) / (0.72 * safe.w)))
        sceneAway.push({ ...common, type: 'chase', params: { customers: v.customers ?? SIGNATURE.chase.customers, at: { ...SIGNATURE.rest }, size: Math.max(0.3, size), laps: r3(Math.min(8, Math.max(0.1, (end - start) * SIGNATURE.chase.lapsPerSec))) } })
      } else {
        const text = [...cleanWord(c.W[v.word]!.text)!].slice(0, 24).join('')
        if (v.kind === 'wall') sceneAway.push({ ...common, type: 'word-wall', params: { text, ...SIGNATURE.wall } })
        else sceneAway.push({ ...common, type: 'repeat-loop', params: { text, at: { ...SIGNATURE.loop.at }, size: SIGNATURE.loop.size, copies: SIGNATURE.loop.copies } })
      }
    } else if (v.kind === 'particles' && pw) {
      // The dot rests in the object zone just before it bursts.
      const last = states.at(-1)!
      if (last.role !== 'rest') {
        const at = snap(Math.max(last.at + SIGNATURE.minGap, pw.burst - SIGNATURE.particles.restBefore))
        if (at < pw.burst - 0.05) states.push(rest(at))
        else states[states.length - 1] = rest(last.at)
      }
    }
  })
  if (c.ctaKind === 'comment') put({ at: snap(c.speechEnd.t), object: 'dot', size: SIGNATURE.cta.size, x: 0.5, y: SIGNATURE.cta.y, role: 'cta' })

  // --- Hero scenes: split at the burst (R23) and every SIGNATURE.maxStates states.
  const videoEnd = snap(c.videoEnd.t)
  const spans: { start: number; end: number; states: HeroState[] }[] = []
  if (pw) {
    spans.push({ start: 0, end: pw.burst, states: states.filter((x) => x.at < pw!.burst - 1e-9) })
    spans.push({ start: resumeAt, end: videoEnd, states: [rest(resumeAt), ...states.filter((x) => x.at > resumeAt + 1e-9)] })
  } else spans.push({ start: 0, end: videoEnd, states })
  const chunks: { start: number; end: number; states: HeroState[] }[] = []
  // The chunk that ends the first span ends at the burst: the particles start from it (by construction, not by matching times).
  let burstChunk = -1
  for (const [n, sp] of spans.entries()) {
    let rest0 = sp.states
    let start = sp.start
    while (rest0.length > SIGNATURE.maxStates) {
      let q = -1
      for (let n = SIGNATURE.maxStates - 1; n >= 2; n--) if (rest0[n]!.role === 'rest') { q = n; break }
      if (q < 0) q = SIGNATURE.maxStates - 1
      chunks.push({ start, end: rest0[q]!.at, states: rest0.slice(0, q + 1) })
      start = rest0[q]!.at
      rest0 = rest0.slice(q)
    }
    chunks.push({ start, end: sp.end, states: rest0 })
    if (pw && n === 0) burstChunk = chunks.length - 1
  }
  const ringTimes = [
    ...[...c.stress].map((k) => snap(c.W[k]!.start)),
    ...states.filter((x) => x.land).map((x) => x.at),
    ...(c.ctaKind === 'comment' ? Array.from({ length: 8 }, (_, n) => snap(c.speechEnd.t + SIGNATURE.ctaRings.first + n * SIGNATURE.ctaRings.every)).filter((t) => t < videoEnd - 0.3) : []),
  ].sort((a, b) => a - b)
  const heroes: Scene[] = chunks.map((ch, n) => {
    const local = (t: number) => r3(Math.max(0, t - ch.start))
    const sts = ch.states.map((x, q) => {
      const end = ch.states[q + 1]?.at ?? ch.end
      const lv = LEVEL_OBJECTS.has(x.object) ? levelsOf(i.voiceLevels, x.at, end) : undefined
      const { role: _r, at, ...rest1 } = x
      return { at: local(at), ...rest1, ...(lv ? { levels: lv } : {}) }
    })
    // States after the first are strictly later (`morphObjectParams`).
    for (let q = 1; q < sts.length; q++) if (!(sts[q]!.at > sts[q - 1]!.at)) sts[q]!.at = r3(sts[q - 1]!.at + 1 / fps)
    const rings: number[] = []
    for (const t of ringTimes) if (t >= ch.start && t < ch.end - 0.05 && (!rings.length || local(t) - rings.at(-1)! >= 0.2)) rings.push(local(t))
    return {
      id: `hero${n + 1}`,
      type: 'morph-object',
      track: T_HERO,
      depth: SIGNATURE.depth.hero,
      start: sec(ch.start),
      end: sec(ch.end),
      params: { states: sts, currency: cur.currency, rings: rings.slice(0, SIGNATURE.maxRings) },
    }
  })
  const pwScene: Scene[] =
    pw && pwLine
      ? [
          {
            id: 'pw',
            type: 'particle-word',
            track: T_HERO,
            depth: SIGNATURE.depth.hero,
            start: pwLine.start,
            end: pwLine.end,
            params: { target: `w${pw.k}`, from: { scene: heroes[burstChunk]!.id }, burst: r3(pw.burst - pw.startAbs), land: r3(pw.land - pw.startAbs) },
          },
        ]
      : []

  // Where the hero is at t (frame fractions): the last state that has arrived.
  const heroAt = (t: number) => {
    const st = [...states].reverse().find((x) => x.at <= t + 1e-6) ?? states[0]!
    return { x: r3(area.left + st.x * (1 - area.left - area.right)), y: r3(area.top + st.y * safeHf) }
  }

  // --- Worlds and reveals.
  const cuts = c.sections.map((x, j) => ({ x, j })).filter(({ x }) => x.word > 0)
  const segs = [{ at: AT0, j: c.sections[0]?.word === 0 ? 0 : -1 }, ...cuts.map(({ x, j }) => ({ at: c.wStart(x.word), j }))]
  const backdrops: Scene[] = segs.map((g, n) => ({
    id: `bg${n + 1}`,
    type: 'backdrop',
    track: T_BG,
    depth: SIGNATURE.depth.backdrop,
    start: g.at,
    end: segs[n + 1]?.at ?? c.videoEnd,
    params: { world: g.j < 0 ? 'paper' : (plan.sections[g.j]?.world ?? 'paper'), material: segs.length > 1 && n === segs.length - 1 ? { halftone: true } : {} },
  }))
  const reveals: Trans[] = segs.slice(1).map((g, n) => ({ type: 'reveal', track: T_BG, at: g.at, hit: false, params: { shape: REVEAL_SHAPES[n % REVEAL_SHAPES.length], origin: heroAt(snap(g.at.t)) } }))
  const kept = validTransitions(reveals, backdrops, fps)
  if (kept.length < reveals.length) warnings.push('بعض الأقسام أقصر من انتقال الكشف؛ حُذف انتقالها — some sections are shorter than a reveal: their reveal is left out')

  // --- The camera: handheld, shakes, pushes on objects (R17).
  const C = SIGNATURE.camera
  const shakes: { at: number; amp: number }[] = []
  for (const sh of [...[...c.stress].map((k) => ({ at: snap(c.W[k]!.start), amp: C.shakeStress })), ...states.filter((x) => x.land).map((x) => ({ at: x.at, amp: C.shakeLand }))].sort((a, b) => a.at - b.at)) {
    const last = shakes.at(-1)
    if (last && sh.at - last.at < C.shakeApart - 1e-9) {
      if (sh.amp > last.amp) last.amp = sh.amp
      continue
    }
    shakes.push({ ...sh })
  }
  const keys: { at: number; x: number; y: number; zoom: number }[] = [{ at: 0, x: 0.5, y: 0.5, zoom: 1 }]
  const ends = [...chunks.map((ch) => ch.end)]
  states.forEach((st, q) => {
    if (st.role !== 'object' || ABSTRACT.has(st.object)) return
    const end = Math.min(states[q + 1]?.at ?? Infinity, ...ends.filter((e) => e > st.at + 1e-9))
    const ramp = Math.min(C.ramp, end - st.at - C.back)
    if (!(ramp >= 0.25 - 1e-9) || !Number.isFinite(end)) return
    const f = heroAt(st.at)
    const cx = r3(Math.min(0.5 + C.pan, Math.max(0.5 - C.pan, f.x)))
    const cy = r3(Math.min(0.5 + C.pan, Math.max(0.5 - C.pan, f.y)))
    // The zoomed object (at the hero's depth) never climbs into the headline zone (fixed track 5).
    const H = FORMAT_SIZE[format].h
    const g = (OBJECT_GEOMETRY as Partial<Record<ObjectId, { h: number }>>)[st.object]?.h ?? 1
    // The calendar's ring tabs stand above its outline.
    const top = f.y * H - ((Math.max(1, g) + (st.object === 'calendar' ? 0.2 : 0)) * st.size * safe.w) / 2
    const zoneBottom = safe.y + SIGNATURE.headline.zone * safe.h
    // `cameraTransform` at the hero's depth (`poseAtDepth`): screen y = H/2 + (y − y_d·H)·z_d.
    const d = SIGNATURE.depth.hero
    const screenTop = (zz: number) => H / 2 + (top - (0.5 + (cy - 0.5) * d) * H) * (1 + (zz - 1) * d)
    let z = PUSH_ZOOM[st.object] ?? 1.08
    while (z > 1 && screenTop(z) < zoneBottom + 8) z = r3(z - 0.01)
    if (!(z >= 1.02)) return
    const reach = r3(st.at + ramp)
    const hold = r3(Math.max(reach, end - C.back))
    if (keys.at(-1)!.at > st.at + 1e-9) return
    keys.push({ at: r3(st.at), x: 0.5, y: 0.5, zoom: 1 }, { at: reach, x: cx, y: cy, zoom: z }, ...(hold > reach + 1e-9 ? [{ at: hold, x: cx, y: cy, zoom: z }] : []), { at: r3(hold + C.back), x: 0.5, y: 0.5, zoom: 1 })
  })
  const dedup = keys.filter((k, q) => q === 0 || !(k.at === keys[q - 1]!.at && k.zoom === keys[q - 1]!.zoom && k.x === keys[q - 1]!.x && k.y === keys[q - 1]!.y))
  const camera = { keys: dedup, fixedTracks: [T_HEAD], handheld: { amp: C.handheld }, ...(shakes.length ? { shakes } : {}) }

  // --- The end card.
  const cta: Scene[] = []
  if (c.ctaKind === 'comment') {
    // Behind the card, its keyword as a slow wall (track 1: under the card, above the world).
    const W0 = SIGNATURE.ctaWall
    cta.push({ id: 'cta-wall', type: 'word-wall', track: 1, depth: SIGNATURE.depth.scene, start: sec(snap(c.speechEnd.t + W0.in)), end: c.videoEnd, params: { text: [...brief.cta!.keyword!].slice(0, 24).join(''), rows: W0.rows, cols: W0.cols, speed: W0.speed, alpha: W0.alpha } })
    const t = brief.cta!.text
    cta.push({ id: 'cta', type: 'comment-cta', track: T_SCENE, start: c.speechEnd, end: c.videoEnd, params: { keyword: brief.cta!.keyword!, ...(t && [...t].length <= 40 && !/[\r\n]/.test(t) ? { dmBody: t } : {}) } })
  } else if (c.ctaKind === 'text') {
    const ws = brief.cta!.text!.split(/\s+/).map(cleanWord).filter((w): w is string => w !== undefined).slice(0, 16)
    const step = ws.length > 1 ? Math.min(0.3, 0.9 / (ws.length - 1)) : 0
    cta.push({ id: 'cta', type: 'kinetic-text', track: T_HEAD, start: c.speechEnd, end: c.videoEnd, params: { words: ws.map((text, j) => ({ text, at: r3(j * step), stress: 0 })), mode: 'line', enter: 'rise', y: headY } })
  }

  const head = {
    version: 1,
    format: plan.format,
    fps,
    look: 'signature',
    dir: 'rtl',
    seed: i.seed,
    transcript: { sourceHash: i.transcript.sourceHash, words: i.transcript.words.length, hash: transcriptHash(i.transcript) },
  }
  const audio: Record<string, unknown>[] = [{ kind: 'voice', media: i.voiceMedia }]
  if (brief.musicMedia) audio.push({ kind: 'music', media: brief.musicMedia, in: brief.musicFrom ?? 0 })
  const tail: Record<string, unknown> = { audio, ...(preset.sfxOffsetDb !== 0 ? { sfxGainDb: preset.sfxOffsetDb } : {}) }
  return {
    head,
    scenes: [...backdrops, ...sceneAway, ...heads, ...heroes, ...pwScene, ...cta],
    transitions: kept,
    tail,
    camera,
    snap: (t) => t,
    // A line that fades in hosts an underline only once its particle word is whole.
    fill: {
      hostTrack: T_HEAD,
      track: T_HEAD,
      host: (sc, local) => sc.type === 'kinetic-text' && (sc.params.enter !== 'fade' || (pw !== undefined && local >= pw.land - pw.startAbs + PARTICLE_WORD.fade)),
      // The word just spoken (its key hugs the ink; the line block runs well below the glyphs).
      target: (sc, local) => {
        const ws = sc.params.words as { key?: string; word?: number; at: unknown }[]
        const due = (w: { word?: number; at: unknown }) => (typeof w.at === 'number' ? w.at : w.word !== undefined ? c.W[w.word]!.start - snap(sc.start.t) : Infinity)
        return [...ws].reverse().find((w) => w.key && due(w) <= local - 0.2)?.key
      },
    },
  }
}

/** The largest size of `o` whose square box (± size / 2 of the safe width) clears the headline zone from its centre. */
function safeCap(o: ObjectId, format: Format): number {
  const s = safeRect(format)
  const y = OBJECT_Y[o] ?? SIGNATURE.rest.y
  const room = Math.min(y - SIGNATURE.headline.zone, 1 - y)
  return r3((2 * room * s.h) / s.w - 1e-3)
}
