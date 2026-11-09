import type { Visual } from '../keywords-ar'
import { isStretchable } from '../text'
import { normalizeAr } from '../transcript'
import type { BriefType } from './types'

/**
 * The creative director's vocabulary (Plan 2a+ Task 9, §17.13–17.15): the editorial ideas a beat of
 * an explainer can carry, what each needs from the beat, and the default director that assigns
 * them. Pure and deterministic. The wording is our own; nothing here is copied from a reference.
 */
export const IDEA_IDS = [
  'giant-word',
  'kashida-stretch',
  'echo-word',
  'strike',
  'section-number',
  'word-wall',
  'world-flip',
  'keyword-box',
  'hero-handoff',
  'shape-states',
  'iris-open',
  'flood',
  'camera-push',
  'mask-line',
  'rise-words',
  'halftone-react',
] as const
export type IdeaId = (typeof IDEA_IDS)[number]

/** One beat of the plan (a main-line span; beat 0 is the hook). Every word index is a transcript index. */
export interface BeatInfo {
  i: number
  /** Transcript words [from, to). */
  from: number
  to: number
  /** The shown text of words from … to − 1. */
  words: string[]
  /** Stressed words (`*…*` in script.md). */
  stress: number[]
  /** The section title when a section starts on this beat (or, for beat 0, inside the hook). */
  section?: string
  sectionIndex?: number
  /** Words that are numbers (digits, a brief number or a spelled one ≥ 100). */
  numbers: number[]
  keywords: { word: number; visual: Visual }[]
}

/** What the director knows besides the beats. The optional fields are only read by `directBeats`. */
export interface DirectorCtx {
  type: BriefType
  /** The plan has a hero (`plan.hero`). */
  hero: boolean
  camera: 'none' | 'push' | 'world'
  /** The director may turn the hero on (brief.hero is not false). */
  heroAllowed?: boolean
  /** Signature moments the plan needs (`signatureMinOf`). */
  signatureMin?: number
  /** `style.signature`: tried first. */
  prefer?: readonly IdeaId[]
  /** Per beat: its length (s), its kind and the cut into it. */
  beatSec?: readonly number[]
  kinds?: readonly string[]
  cuts?: readonly ('none' | 'cut' | 'hit' | 'section')[]
  /** World flips the sections already give (signature moments outside the beats). */
  worldFlips?: number
  /** Per beat: a short stack of short words, safe to zoom on (camera-push candidates). */
  zoomSafe?: readonly boolean[]
}

/** Negations a struck word follows (normalized; a leading و / ف is allowed). */
export const NEGATIONS: readonly string[] = ['لا', 'بدون', 'مش', 'ما', 'غير']

const clean = (w: string) => normalizeAr(w.replace(/\*/g, '').trim())
export function isNegation(token: string): boolean {
  const t = clean(token)
  return NEGATIONS.includes(t) || (/^[وف]/.test(t) && NEGATIONS.includes(t.slice(1)))
}

const wordAt = (b: BeatInfo, k: number) => b.words[k - b.from] ?? ''
const shownKeywords = (b: BeatInfo) => b.keywords.filter((h) => h.visual.type === 'icon' || h.visual.type === 'line-art')

/** The beat's main word: its first stressed word, else its first keyword, else its longest word (transcript index). */
export function mainWord(b: BeatInfo): number | undefined {
  if (b.stress.length) return b.stress[0]
  const kw = shownKeywords(b)[0]
  if (kw) return kw.word
  let best: number | undefined
  for (let k = b.from; k < b.to; k++) if (clean(wordAt(b, k)) && (best === undefined || [...wordAt(b, k)].length > [...wordAt(b, best)].length)) best = k
  return best
}

/** The first stressed or keyword word of the beat that has a kashida slot. */
export function stretchableWord(b: BeatInfo): number | undefined {
  return [...b.stress, ...shownKeywords(b).map((h) => h.word)].find((k) => isStretchable(wordAt(b, k).replace(/\*/g, '').trim()))
}

export interface Idea {
  /** Arabic name (CLI, plan.json readers). */
  ar: string
  /** True when the beat has what the idea needs. */
  needs: (b: BeatInfo, ctx: DirectorCtx) => boolean
  /** A signature moment (counted against the type's `signatureMin`). */
  signature: boolean
}

const hasWords = (b: BeatInfo) => b.words.some((w) => clean(w))

export const IDEAS: Record<IdeaId, Idea> = {
  'giant-word': { ar: 'كلمة عملاقة', signature: false, needs: (b) => mainWord(b) !== undefined },
  'kashida-stretch': { ar: 'تمديد', signature: true, needs: (b) => stretchableWord(b) !== undefined },
  'echo-word': { ar: 'صدى الكلمة', signature: false, needs: (b) => b.stress.length > 0 },
  strike: {
    ar: 'شطب',
    signature: false,
    needs: (b) => {
      for (let k = b.from; k + 1 < b.to; k++) if (isNegation(wordAt(b, k)) || b.numbers.includes(k)) return true
      return false
    },
  },
  'section-number': { ar: 'رقم القسم', signature: true, needs: (b) => b.section !== undefined },
  'word-wall': { ar: 'جدار الكلمات', signature: true, needs: hasWords },
  'world-flip': { ar: 'قلب الألوان', signature: true, needs: (b) => b.section !== undefined && (b.sectionIndex ?? 0) > 0 },
  'keyword-box': { ar: 'إطار الكلمة', signature: false, needs: (b) => shownKeywords(b).length > 0 },
  'hero-handoff': { ar: 'تسليم البطل', signature: true, needs: (_b, c) => c.hero },
  'shape-states': {
    ar: 'حالات الشكل',
    signature: true,
    needs: (b, c) => (c.type === 'product-launch' || c.type === 'explainer') && b.keywords.some((h) => h.visual.type === 'ui'),
  },
  'iris-open': { ar: 'فتحة دائرية', signature: false, needs: (b) => b.i > 0 },
  flood: { ar: 'فيضان اللون', signature: true, needs: (b) => b.i > 0 },
  'camera-push': { ar: 'دفع الكاميرا', signature: true, needs: (b, c) => c.camera !== 'none' && hasWords(b) },
  'mask-line': { ar: 'دخول من تحت السطر', signature: false, needs: hasWords },
  'rise-words': { ar: 'صعود الكلمات', signature: false, needs: hasWords },
  'halftone-react': { ar: 'نقاط تتفاعل', signature: false, needs: (_b, c) => c.hero },
}

/** Ideas that act on the beat's kinetic text: only a `text` beat after the hook takes them. */
export const TEXT_IDEAS: ReadonlySet<IdeaId> = new Set(['giant-word', 'kashida-stretch', 'echo-word', 'keyword-box', 'camera-push', 'mask-line', 'rise-words', 'word-wall'])
/** Ideas the hook (beat 0) can take. */
export const HOOK_IDEAS: ReadonlySet<IdeaId> = new Set(['section-number', 'world-flip', 'halftone-react'])

/** True when beat `b` (of `kind`) can carry `id` at all (kind, hook and `needs`). */
export function ideaFits(id: IdeaId, b: BeatInfo, kind: string, ctx: DirectorCtx): boolean {
  if (b.i === 0 && !HOOK_IDEAS.has(id)) return false
  if (TEXT_IDEAS.has(id) && kind !== 'text') return false
  if (id === 'strike' && kind !== 'text' && kind !== 'counter') return false
  return IDEAS[id].needs(b, ctx)
}

/** The ideas the default director falls back on, in order, to reach the signature minimum. */
export const FILL_ORDER: readonly IdeaId[] = ['hero-handoff', 'flood', 'camera-push', 'word-wall']

/** Longest stretches of a hero (handoff beats). */
const HANDOFFS = 3

/**
 * The default creative director. Per beat at most one idea, never the same on two consecutive
 * beats: (1) the earliest stressed word → `kashida-stretch` when it has a kashida slot, else
 * `giant-word`; (2) every section start → `section-number` (its world flip is the plan's
 * `sections`); (3) a number after a negation → `strike`; (4) explainer / product-launch with a UI
 * word → `shape-states` once; a camera mode → `camera-push` on the longest text beat; (5)
 * `style.signature` ideas first, then `FILL_ORDER` until `signatureMin` signature moments (world
 * flips and a hero count once each): the hero (handoffs at the three longest text beats), a
 * `flood` at a section cut (else a hit cut), another `camera-push`, a `word-wall` on the last beat.
 * Returns, per beat, its idea and whether the hero lands on it (`handoff`).
 */
export function directBeats(beats: readonly BeatInfo[], ctx: DirectorCtx, _rng: () => number): { idea?: IdeaId; handoff?: boolean }[] {
  const c: DirectorCtx = { ...ctx }
  const out: { idea?: IdeaId; handoff?: boolean }[] = beats.map(() => ({}))
  const kind = (x: number) => c.kinds?.[x] ?? 'text'
  const sec = (x: number) => c.beatSec?.[x] ?? 0
  const can = (x: number, id: IdeaId) =>
    x >= 0 && x < beats.length && out[x]!.idea === undefined && out[x - 1]?.idea !== id && out[x + 1]?.idea !== id && ideaFits(id, beats[x]!, kind(x), c)
  const put = (x: number, id: IdeaId) => (out[x]!.idea = id)
  const first = (id: IdeaId, xs: readonly number[]) => xs.find((x) => can(x, id))
  const all = beats.map((_, x) => x)
  const textByLength = all.filter((x) => x > 0 && kind(x) === 'text').sort((a, b) => sec(b) - sec(a) || a - b)
  const pushable = textByLength.filter((x) => c.zoomSafe?.[x] ?? true)

  // (1) The earliest stressed word.
  for (const b of beats) {
    if (b.i === 0 || !b.stress.length || kind(b.i) !== 'text') continue
    const id: IdeaId = stretchableWord({ ...b, keywords: [] }) !== undefined ? 'kashida-stretch' : 'giant-word'
    if (can(b.i, id)) put(b.i, id)
    break
  }
  // (2) Section starts.
  for (const b of beats) if (b.section !== undefined && can(b.i, 'section-number')) put(b.i, 'section-number')
  // (3) A number after a negation.
  for (const b of beats) {
    if (kind(b.i) !== 'counter' || !b.numbers.length) continue
    const before = [...b.words.slice(0, b.numbers[0]! - b.from), beats[b.i - 1]?.words.at(-1) ?? '']
    if (before.some(isNegation) && can(b.i, 'strike')) put(b.i, 'strike')
  }
  // (4) UI words → shape states, once; the camera mode's push.
  const ui = first('shape-states', all)
  if (ui !== undefined) put(ui, 'shape-states')
  if (c.camera !== 'none') {
    const x = first('camera-push', pushable)
    if (x !== undefined) put(x, 'camera-push')
  }

  // (5) Signature minimum.
  const count = () => out.filter((o) => o.idea && IDEAS[o.idea].signature).length + (c.worldFlips ?? 0) + (c.hero ? 1 : 0)
  const heroOn = (): boolean => {
    if (c.hero || c.heroAllowed === false) return c.hero
    const xs = textByLength.slice(0, HANDOFFS).sort((a, b) => a - b)
    if (!xs.length) return false
    for (const x of xs) out[x]!.handoff = true
    c.hero = true
    return true
  }
  const tryIdea = (id: IdeaId): boolean => {
    if (id === 'hero-handoff') return !c.hero && heroOn()
    if (id === 'world-flip') return false // the sections decide
    const xs =
      id === 'flood'
        ? (['section', 'hit', 'cut'] as const).flatMap((k) => all.filter((x) => c.cuts?.[x] === k))
        : id === 'camera-push'
          ? pushable
          : id === 'word-wall'
            ? [...all].reverse()
            : all
    const x = first(id, xs)
    if (x === undefined) return false
    put(x, id)
    return true
  }
  for (const id of c.prefer ?? []) tryIdea(id)
  const min = c.signatureMin ?? 0
  for (const id of FILL_ORDER) {
    if (count() >= min) break
    tryIdea(id)
  }
  // The brief forced the hero on: its handoffs still land on the longest text beats.
  if (c.hero && !out.some((o) => o.handoff)) for (const x of textByLength.slice(0, HANDOFFS)) out[x]!.handoff = true
  return out
}
