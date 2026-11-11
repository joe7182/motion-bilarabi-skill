import { z } from 'zod'
import { OBJECT_IDS } from '../objects'
import { LOOK_IDS } from '../storyboard'
import { PACK_IDS } from '../pack-ids'
import { isStretchable, splitWords } from '../text'
import { normalizeAr, type Transcript } from '../transcript'
import { lettersOf } from '../params/letters-join'
import { CTA_MIN_SEC } from '../params/comment-cta'
import { CAPTION_SKINS, groupCaptions } from '../params/captions'

/**
 * Presets (stage 2, docs/superpowers/specs/2026-11-08-presets-design.md): a proven reel structure
 * filled from `preset.json`. Every slot names a phrase it is spoken on (`say`); the phrase anchors to
 * the transcript, so the scenes land on the words. One compiler, small templates per preset:
 * each template turns its slots into generic sections (headline, badge, show, world), and
 * `sectionScenes` lays every section out the same way. Pure and deterministic.
 */

// ---------------------------------------------------------------------------------------------
// Schema

const txt = (max: number) => z.string().trim().min(1).max(max)
const unit = z.number().min(0).max(1)

/** What a section shows under its headline. */
export const showSchema = z.discriminatedUnion('kind', [
  /** The section's spoken words as kinetic text (default). */
  z.object({ kind: z.literal('words') }),
  z.object({ kind: z.literal('stretch'), word: txt(24).refine(isStretchable, { message: 'الكلمة لا تقبل التطويل — word has no kashida slot' }) }),
  z.object({ kind: z.literal('join'), word: txt(14).refine((w) => lettersOf(w).length >= 2 && lettersOf(w).length <= 10, { message: 'من ٢ إلى ١٠ حروف — 2..10 letters' }), reverse: z.boolean().optional() }),
  /** One drawn object, or several in turn (a morph on the spoken words). */
  z.object({ kind: z.literal('object'), objects: z.array(z.enum(OBJECT_IDS)).min(1).max(4) }),
  /** The wrong word struck through, then the right one (a mistake). */
  z.object({
    kind: z.literal('strike'),
    wrong: txt(20).refine((w) => splitWords(w).length === 1, { message: 'كلمة واحدة فقط (الكلمة الغلط) — wrong must be one word' }),
    right: txt(20).refine((w) => splitWords(w).length === 1, { message: 'كلمة واحدة فقط (الكلمة الصح) — right must be one word' }),
  }),
  /** A real recording or screenshot (project media) in a floating window, with an optional zoom, mark and label. */
  z.object({
    kind: z.literal('clip'),
    media: txt(12),
    in: z.number().min(0).default(0),
    still: z.boolean().optional(),
    url: txt(40).optional(),
    zoom: z.object({ x: unit, y: unit, scale: z.number().min(1).max(6) }).optional(),
    mark: z.object({ x: unit, y: unit, w: unit, h: unit }).optional(),
    label: z.object({ x: unit, y: unit, text: txt(18) }).optional(),
    /** No window chrome and no entrance: the clip simply is there (a figure that flew in becomes it). */
    bare: z.boolean().optional(),
    /** Seen through a microscope: the lens focuses in, with an optional slide label. */
    lens: z.object({ label: txt(20).optional() }).optional(),
  }),
  /** A search bar typing the text (the loop guide's opening and closing frame). */
  z.object({ kind: z.literal('search'), text: txt(26) }),
  /** A stack of layers lighting up in turn (each on its spoken phrase, when given). */
  z.object({ kind: z.literal('layers'), layers: z.array(z.object({ title: txt(20), subtitle: txt(28).optional(), say: txt(80).optional() })).min(2).max(5) }),
  /** A flow of nodes wired in order (a system, an automation). */
  z.object({
    kind: z.literal('graph'),
    title: txt(30).optional(),
    nodes: z.array(z.object({ id: txt(16), label: txt(18), sub: txt(22).optional(), kind: z.enum(['trigger', 'step', 'agent', 'slot']).optional() })).min(2).max(6),
  }),
  /** Real logos popping in a row (image paths relative to the project). */
  z.object({ kind: z.literal('logos'), items: z.array(z.object({ image: txt(200), label: txt(18).optional() })).min(1).max(6) }),
  z.object({ kind: z.literal('stamp'), text: txt(24) }),
  /**
   * A textbook: pages flip fast and stop on a printed figure (image: a still of the real scene);
   * at the end of the part the figure lifts off the page into the next part's clip window (make
   * that clip bare), so the printed picture comes alive.
   */
  z.object({ kind: z.literal('book'), image: txt(300), title: txt(30).optional(), flips: z.number().int().min(2).max(14).optional(), aspect: z.number().min(0.3).max(4).default(1.44) }),
  /**
   * A heart-monitor line: each beat spikes on its spoken word (say, else the word itself) with the
   * word on the peak; flat: the line goes flat as the part ends. It replaces the headline.
   */
  z.object({
    kind: z.literal('ecg'),
    beats: z
      .array(z.object({ say: txt(80).optional(), word: txt(16).refine((w) => splitWords(w).length === 1, { message: 'كلمة واحدة — one word' }), box: z.boolean().optional(), size: z.number().min(0.5).max(1.6).optional() }))
      .min(1)
      .max(6),
    flat: z.boolean().optional(),
  }),
  /**
   * Kinetic typography: the part's own words in beats, each beat landing on its phrase (say, else
   * the beat's first word) in its own style: line (one row lifted from under its line), stack (one
   * word per row), giant (one word, as big as the frame allows). It replaces the headline.
   */
  z.object({
    kind: z.literal('kinetic'),
    beats: z
      .array(
        z
          .object({
            say: txt(80).optional(),
            text: txt(40),
            style: z.enum(['line', 'stack', 'giant']).default('line'),
            box: txt(20).optional(),
            stretch: txt(20).refine(isStretchable, { message: 'الكلمة لا تقبل التطويل — word has no kashida slot' }).optional(),
            echo: z.boolean().optional(),
          })
          .refine((b) => b.style !== 'giant' || splitWords(b.text).length === 1, { message: 'giant: كلمة واحدة — giant takes one word', path: ['text'] }),
      )
      .min(1)
      .max(6),
  }),
  /** The creator's own profile card (from brand.json: avatar, name; stats roll up; the follow button is pressed). */
  z.object({
    kind: z.literal('profile'),
    avatar: txt(300),
    name: txt(40),
    stats: z.array(z.object({ value: z.number().int().min(0), label: txt(16) })).min(1).max(3),
    button: txt(16).optional(),
    followed: txt(16).optional(),
  }),
  /** A word that gets heavy (weight climbs, arrows press it, its line sags). */
  z.object({ kind: z.literal('heavy'), word: txt(16).refine((w) => splitWords(w).length === 1, { message: 'كلمة واحدة — one word' }) }),
  /** What was said against what got written («قلنا / كتبها»). */
  z.object({ kind: z.literal('said'), said: txt(20), written: txt(20) }),
  /** An editor timeline cutting exactly on the word. */
  z.object({ kind: z.literal('cut'), word: txt(20).refine((w) => splitWords(w).length === 1, { message: 'كلمة واحدة — one word' }) }),
  /** Particles gathering into the brand word (the teaser's reveal). */
  z.object({ kind: z.literal('brand'), word: txt(20).refine((w) => splitWords(w).length === 1, { message: 'كلمة واحدة — one word' }) }),
])
export type Show = z.infer<typeof showSchema>

const slot = z.object({
  /** The phrase from the script this slot is spoken on. */
  say: txt(80),
  /** The headline (≤ 4 words; default: the phrase). */
  text: txt(60).optional(),
  /** One word of the headline drawn in the red box. */
  box: txt(20).optional(),
  show: showSchema.optional(),
  /** A camera REC frame over this part (behind the scenes, «we're filming»). */
  rec: z.boolean().optional(),
})

const item = slot.extend({ title: txt(40) })

export const presetSchema = z.discriminatedUnion('preset', [
  z.object({
    preset: z.literal('list'),
    look: z.enum(LOOK_IDS).default('swiss-red'),
    /** A style pack (src/packs): layout, marks, background, transitions and motion; absent: the classic layout. */
    pack: z.enum(PACK_IDS).optional(),
    /** «حركة», «غلطة», «نصيحة»: the label word of the chapter bar. */
    label: txt(16).default('حركة'),
    hook: slot,
    items: z.array(item).min(2).max(8),
    cta: slot.extend({ keyword: txt(20) }),
    /** The music's beat: show events and the badge snap to it (offset + n · 60 / bpm). */
    beat: z.object({ bpm: z.number().min(40).max(220), offset: z.number().min(0).default(0) }).optional(),
    /** `easy`: easy ease, eased in and out (default); `snappy`: fast start, soft stop (ease-out). See EASE_WORDS. */
    motion: z.enum(['easy', 'snappy']).default('easy'),
    /** Captions of the spoken words (absent: none): the skin and presentation. */
    captions: z.object({ skin: z.enum(CAPTION_SKINS).default('spoken-box'), presentation: z.enum(['pill', 'minimal', 'strip']).default('pill'), y: z.number().min(0.5).max(0.9).optional() }).optional(),
  }),
  z.object({
    preset: z.literal('problem'),
    look: z.enum(LOOK_IDS).default('signature'),
    /** A style pack (src/packs): layout, marks, background, transitions and motion; absent: the classic layout. */
    pack: z.enum(PACK_IDS).optional(),
    hook: slot,
    /** The pains (ink world), each with its object or words. */
    pains: z.array(slot).min(1).max(4),
    /** The cost («فلوسك»… «والنتيجة؟»); default show: the coin. */
    cost: slot,
    /** The solution steps (paper world), each with a number badge. */
    steps: z.array(item).min(2).max(4),
    cta: slot.extend({ keyword: txt(20) }),
    /** The music's beat: show events and the badge snap to it (offset + n · 60 / bpm). */
    beat: z.object({ bpm: z.number().min(40).max(220), offset: z.number().min(0).default(0) }).optional(),
    /** `easy`: easy ease, eased in and out (default); `snappy`: fast start, soft stop (ease-out). See EASE_WORDS. */
    motion: z.enum(['easy', 'snappy']).default('easy'),
    /** Captions of the spoken words (absent: none): the skin and presentation. */
    captions: z.object({ skin: z.enum(CAPTION_SKINS).default('spoken-box'), presentation: z.enum(['pill', 'minimal', 'strip']).default('pill'), y: z.number().min(0.5).max(0.9).optional() }).optional(),
  }),
  z.object({
    preset: z.literal('steps'),
    look: z.enum(LOOK_IDS).default('swiss-red'),
    /** A style pack (src/packs): layout, marks, background, transitions and motion; absent: the classic layout. */
    pack: z.enum(PACK_IDS).optional(),
    label: txt(16).default('خطوة'),
    hook: slot,
    audience: slot.optional(),
    steps: z.array(item).min(2).max(5),
    promise: slot.optional(),
    cta: slot.extend({ keyword: txt(20) }),
    /** The music's beat: show events and the badge snap to it (offset + n · 60 / bpm). */
    beat: z.object({ bpm: z.number().min(40).max(220), offset: z.number().min(0).default(0) }).optional(),
    /** `easy`: easy ease, eased in and out (default); `snappy`: fast start, soft stop (ease-out). See EASE_WORDS. */
    motion: z.enum(['easy', 'snappy']).default('easy'),
    /** Captions of the spoken words (absent: none): the skin and presentation. */
    captions: z.object({ skin: z.enum(CAPTION_SKINS).default('spoken-box'), presentation: z.enum(['pill', 'minimal', 'strip']).default('pill'), y: z.number().min(0.5).max(0.9).optional() }).optional(),
  }),
  z.object({
    preset: z.literal('asked'),
    look: z.enum(LOOK_IDS).default('swiss-red'),
    /** A style pack (src/packs): layout, marks, background, transitions and motion; absent: the classic layout. */
    pack: z.enum(PACK_IDS).optional(),
    label: txt(16).default('خطوة'),
    /** The headline over the comment stickers. */
    title: txt(40).default('سألتوني'),
    /** Followers' questions: each pops as a comment sticker when it is said. */
    questions: z.array(slot.pick({ say: true, text: true })).min(1).max(6),
    steps: z.array(item).min(1).max(5),
    cta: slot.extend({ keyword: txt(20) }),
    /** The music's beat: show events and the badge snap to it (offset + n · 60 / bpm). */
    beat: z.object({ bpm: z.number().min(40).max(220), offset: z.number().min(0).default(0) }).optional(),
    /** `easy`: easy ease, eased in and out (default); `snappy`: fast start, soft stop (ease-out). See EASE_WORDS. */
    motion: z.enum(['easy', 'snappy']).default('easy'),
    /** Captions of the spoken words (absent: none): the skin and presentation. */
    captions: z.object({ skin: z.enum(CAPTION_SKINS).default('spoken-box'), presentation: z.enum(['pill', 'minimal', 'strip']).default('pill'), y: z.number().min(0.5).max(0.9).optional() }).optional(),
  }),
  z.object({
    preset: z.literal('tool'),
    look: z.enum(LOOK_IDS).default('signature'),
    /** A style pack (src/packs): layout, marks, background, transitions and motion; absent: the classic layout. */
    pack: z.enum(PACK_IDS).optional(),
    hook: slot,
    intro: slot.optional(),
    /** The real recording moments: each slot's show is usually a `clip`. */
    demos: z.array(slot).min(1).max(16),
    result: slot.optional(),
    cta: slot.extend({ keyword: txt(20) }),
    /** The music's beat: show events and the badge snap to it (offset + n · 60 / bpm). */
    beat: z.object({ bpm: z.number().min(40).max(220), offset: z.number().min(0).default(0) }).optional(),
    /** `easy`: easy ease, eased in and out (default); `snappy`: fast start, soft stop (ease-out). See EASE_WORDS. */
    motion: z.enum(['easy', 'snappy']).default('easy'),
    /** Captions of the spoken words (absent: none): the skin and presentation. */
    captions: z.object({ skin: z.enum(CAPTION_SKINS).default('spoken-box'), presentation: z.enum(['pill', 'minimal', 'strip']).default('pill'), y: z.number().min(0.5).max(0.9).optional() }).optional(),
  }),
  z.object({
    preset: z.literal('loop'),
    look: z.enum(LOOK_IDS).default('signature'),
    /** A style pack (src/packs): layout, marks, background, transitions and motion; absent: the classic layout. */
    pack: z.enum(PACK_IDS).optional(),
    label: txt(16).default('نصيحة'),
    /** The search bar text that opens and closes the loop (frame 0 = the last frame). */
    topic: txt(26),
    open: slot,
    tips: z.array(item).min(2).max(6),
    /** The last sentence, which runs into the first one. */
    close: slot,
    /** The music's beat: show events and the badge snap to it (offset + n · 60 / bpm). */
    beat: z.object({ bpm: z.number().min(40).max(220), offset: z.number().min(0).default(0) }).optional(),
    /** `easy`: easy ease, eased in and out (default); `snappy`: fast start, soft stop (ease-out). See EASE_WORDS. */
    motion: z.enum(['easy', 'snappy']).default('easy'),
    /** Captions of the spoken words (absent: none): the skin and presentation. */
    captions: z.object({ skin: z.enum(CAPTION_SKINS).default('spoken-box'), presentation: z.enum(['pill', 'minimal', 'strip']).default('pill'), y: z.number().min(0.5).max(0.9).optional() }).optional(),
  }),
  z.object({
    preset: z.literal('system'),
    look: z.enum(LOOK_IDS).default('signature'),
    /** A style pack (src/packs): layout, marks, background, transitions and motion; absent: the classic layout. */
    pack: z.enum(PACK_IDS).optional(),
    hook: slot,
    /** Each part of the system with its show (layers, graph, logos, objects…). */
    parts: z.array(slot).min(2).max(6),
    cta: slot.extend({ keyword: txt(20) }),
    /** The music's beat: show events and the badge snap to it (offset + n · 60 / bpm). */
    beat: z.object({ bpm: z.number().min(40).max(220), offset: z.number().min(0).default(0) }).optional(),
    /** `easy`: easy ease, eased in and out (default); `snappy`: fast start, soft stop (ease-out). See EASE_WORDS. */
    motion: z.enum(['easy', 'snappy']).default('easy'),
    /** Captions of the spoken words (absent: none): the skin and presentation. */
    captions: z.object({ skin: z.enum(CAPTION_SKINS).default('spoken-box'), presentation: z.enum(['pill', 'minimal', 'strip']).default('pill'), y: z.number().min(0.5).max(0.9).optional() }).optional(),
  }),
  z.object({
    preset: z.literal('teaser'),
    look: z.enum(LOOK_IDS).default('signature'),
    /** A style pack (src/packs): layout, marks, background, transitions and motion; absent: the classic layout. */
    pack: z.enum(PACK_IDS).optional(),
    /** One line per idea; the hero object morphs into each line's object. */
    lines: z.array(slot.extend({ object: z.enum(OBJECT_IDS) })).min(2).max(6),
    brand: slot.extend({ word: txt(20) }),
    soon: slot.extend({ stamp: txt(24).default('قريباً') }),
    /** The music's beat: show events and the badge snap to it (offset + n · 60 / bpm). */
    beat: z.object({ bpm: z.number().min(40).max(220), offset: z.number().min(0).default(0) }).optional(),
    /** `easy`: easy ease, eased in and out (default); `snappy`: fast start, soft stop (ease-out). See EASE_WORDS. */
    motion: z.enum(['easy', 'snappy']).default('easy'),
    /** Captions of the spoken words (absent: none): the skin and presentation. */
    captions: z.object({ skin: z.enum(CAPTION_SKINS).default('spoken-box'), presentation: z.enum(['pill', 'minimal', 'strip']).default('pill'), y: z.number().min(0.5).max(0.9).optional() }).optional(),
  }),
])
export type Preset = z.output<typeof presetSchema>

/** Validates `preset.json` (Arabic-first errors). */
export function parsePreset(json: unknown): Preset {
  const r = presetSchema.safeParse(json)
  if (!r.success) {
    const issue = r.error.issues[0]!
    const path = issue.path.join('.') || '(root)'
    throw new Error(/[؀-ۿ]/.test(issue.message) ? `${issue.message} (preset.${path})` : `ملف القالب غير صالح — Invalid preset.json: ${path}: ${issue.message}`)
  }
  return r.data
}

// ---------------------------------------------------------------------------------------------
// Anchoring

const r3 = (n: number) => +n.toFixed(3)
const norm = (s: string) => normalizeAr(s).replace(/^و(?=..)/, '')

/** True when transcript word `w` says token `t` (equal, or one holds the other, both ≥ 3 letters). */
function same(w: string, t: string): boolean {
  const a = norm(w)
  const b = norm(t)
  if (!a || !b) return false
  return a === b || (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)))
}

/** Index of the first transcript word of `say` at or after word `from`; throws Arabic-first when absent. */
export function findPhrase(tr: Transcript, say: string, from: number, slotName: string): number {
  const toks = splitWords(say).filter((t) => norm(t))
  for (let i = from; i < tr.words.length; i++) {
    if (toks.every((t, k) => i + k < tr.words.length && same(tr.words[i + k]!.text, t))) return i
  }
  // Fall back to the first token alone (whisper may split or merge words).
  for (let i = from; i < tr.words.length; i++) if (same(tr.words[i]!.text, toks[0]!)) return i
  throw new Error(`لم أجد «${say}» في التفريغ بعد الكلمة ${from} (${slotName}) — phrase "${say}" not found in the transcript after word ${from} (${slotName})`)
}

// ---------------------------------------------------------------------------------------------
// Sections → scenes

export interface Section {
  id: string
  /** First transcript word and the absolute span (s). */
  word: number
  start: number
  end: number
  world: 'paper' | 'ink'
  /** Headline words (each one word), with the boxed one. */
  headline: string[]
  box?: string
  /** A giant number + title opening the section (list items, steps). */
  badge?: { number: number; title: string }
  bar?: { count: number; index: number; label: string }
  show?: Show
  /** A comment card closing the video. */
  cta?: { keyword: string }
  /** Comment stickers popping at absolute times. */
  stickers?: { text: string; at: number }[]
  /** A hero object (a scene of the template) sits under the headline: keep the headline on top. */
  heroBelow?: boolean
  /** The opening search bar: shown typed on frame 0 (the loop's first frame). */
  pretyped?: boolean
  /** The brand particles burst out of the template's hero scene (`hero`) right at the cut. */
  fromHero?: boolean
  /** A camera REC frame over the section. */
  rec?: boolean
}

export const PRESET_LAYOUT = {
  /** Headline centre (fraction of the frame height). */
  headlineY: 0.25,
  /** The badge holds this long (s) when the section has room for it (≥ badgeMinSection). */
  badge: 1.0,
  badgeMinSection: 2.2,
  /** Show visuals centre (fraction of the safe area). */
  showY: 0.55,
  /** Words per kinetic chunk of a `words` show. */
  chunk: 3,
  /** The video runs this long (s) after the last word. */
  tail: 0.8,
} as const

/** Times (absolute s) the words of `headline` are said inside [start, end); unsaid words follow the last said one. */
function wordTimes(tr: Transcript, words: string[], from: number, start: number, end: number): number[] {
  let cursor = from
  let last = start
  return words.map((w, i) => {
    for (let k = cursor; k < tr.words.length && tr.words[k]!.start < end; k++) {
      if (same(tr.words[k]!.text, w)) {
        cursor = k + 1
        last = Math.max(start, tr.words[k]!.start)
        return last
      }
    }
    last = Math.min(end - 0.3, (i === 0 ? start : last) + (i === 0 ? 0.05 : 0.18))
    return Math.max(start, last)
  })
}

const kinetic = (id: string, track: number, s: number, e: number, words: { text: string; at: number; box?: boolean; strike?: number; accent?: boolean }[], y: number, more: Record<string, unknown> = {}) => ({
  id, type: 'kinetic-text', track, start: r3(s), duration: r3(e - s),
  params: {
    mode: 'line', enter: 'mask', y,
    words: words.map((w) => ({
      text: w.text, at: r3(Math.max(0, w.at - s)),
      ...(w.box ? { box: true } : {}),
      ...(w.accent ? { color: 'accent' } : {}),
      ...(w.strike !== undefined ? { strike: { at: r3(w.strike - s) } } : {}),
    })),
    ...more,
  },
})

/** The scenes of one section. */
export function sectionScenes(tr: Transcript, sec: Section, beat?: { bpm: number; offset: number }): Record<string, unknown>[] {
  const L = PRESET_LAYOUT
  const B = beat ? 60 / beat.bpm : undefined
  /** An absolute time on the beat grid (the nearest beat at or after `t`); unchanged without a beat. */
  const onBeat = (t: number) => (B === undefined ? t : beat!.offset + Math.ceil((t - beat!.offset) / B - 1e-6) * B)
  /** `n` beats in seconds, or `sec` without a beat. */
  const beats = (n: number, sec: number) => (B === undefined ? sec : n * B)
  const out: Record<string, unknown>[] = []
  out.push({ id: `${sec.id}-bg`, type: 'backdrop', track: 0, start: r3(sec.start), duration: r3(sec.end - sec.start), params: { world: sec.world } })
  if (sec.rec) out.push({ id: `${sec.id}-rec`, type: 'viewfinder', track: 4, start: r3(sec.start), duration: r3(sec.end - sec.start), params: {} })
  if (sec.bar) {
    out.push({ id: `${sec.id}-bar`, type: 'chapter-bar', track: 5, start: r3(sec.start), duration: r3(sec.end - sec.start), params: { count: sec.bar.count, index: sec.bar.index, label: sec.bar.label, at: 0.05, fill: Math.min(1, Math.max(0.3, (sec.end - sec.start) * 0.4)) } })
  }
  let showStart = sec.start
  if (sec.badge && sec.end - sec.start >= L.badgeMinSection) {
    showStart = sec.start + beats(2, L.badge)
    out.push({ id: `${sec.id}-num`, type: 'section-number', track: 3, start: r3(sec.start), duration: r3(showStart - sec.start), params: { number: sec.badge.number, title: sec.badge.title, digits: 'arabic', at: { x: 0.5, y: 0.42 }, size: 0.55 } })
  }
  const span = sec.end - showStart
  // Headline on the fixed top track (the hook's sits in the middle when it has no show).
  const centred = !sec.show && !sec.cta && !sec.stickers && !sec.heroBelow
  const hw = sec.headline.slice(0, 4)
  const times = wordTimes(tr, hw, sec.word, showStart, sec.end)
  // The first headline word is up as the section starts (frame 0 of the hook is never empty).
  times[0] = showStart
  const repeatsStamp = sec.show?.kind === 'stamp' && norm(hw.join(' ')) === norm(sec.show.text)
  if (sec.show?.kind !== 'brand' && sec.show?.kind !== 'kinetic' && sec.show?.kind !== 'ecg' && !repeatsStamp) out.push(kinetic(`${sec.id}-h`, 5, showStart, sec.end, hw.map((text, i) => ({ text, at: times[i]!, box: sec.box !== undefined && norm(text) === norm(sec.box) })), centred ? 0.45 : L.headlineY))

  const show = sec.show
  if (sec.stickers) {
    out.push({ id: `${sec.id}-stickers`, type: 'comment-stickers', track: 3, start: r3(showStart), duration: r3(span), params: { items: sec.stickers.map((st) => ({ text: st.text, at: r3(Math.max(0, st.at - showStart)) })) } })
  } else if (sec.cta) {
    const s = Math.min(showStart, sec.end - CTA_MIN_SEC)
    out.push({ id: `${sec.id}-cta`, type: 'comment-cta', track: 3, start: r3(s), duration: r3(sec.end - s), params: { keyword: sec.cta.keyword, at: { x: 0.5, y: 0.6 } } })
  } else if (show?.kind === 'stretch') {
    out.push({ id: `${sec.id}-show`, type: 'type-stretch', track: 3, start: r3(showStart), duration: r3(span), params: { word: show.word, at: r3(onBeat(showStart + Math.min(0.5, span * 0.25)) - showStart), duration: r3(beats(2, Math.min(1.1, span * 0.5))), place: { x: 0.5, y: L.showY } } })
  } else if (show?.kind === 'join') {
    out.push({ id: `${sec.id}-show`, type: 'letters-join', track: 3, start: r3(showStart), duration: r3(span), params: { word: show.word, at: r3(onBeat(showStart + Math.min(0.7, span * 0.3)) - showStart), duration: r3(beats(2, Math.min(0.9, span * 0.4))), reverse: show.reverse ?? false, place: { x: 0.5, y: L.showY } } })
  } else if (show?.kind === 'object') {
    const n = show.objects.length
    out.push({
      id: `${sec.id}-show`, type: 'morph-object', track: 3, start: r3(showStart), duration: r3(span),
      params: { states: show.objects.map((object, k) => ({ at: r3(k === 0 ? 0.1 : onBeat(showStart + (k * (span - 0.4)) / n) - showStart), object, x: 0.5, y: 0.62, size: 0.42 })) },
    })
  } else if (show?.kind === 'strike') {
    // A short show (a fast beat) is not snapped to the beat — a snap can push the right word past the
    // end — and the right word lands 0.75 s before the end at the latest, so it finishes typing in.
    const snap = span >= 2.5 ? onBeat : (t: number) => t
    const a = snap(showStart + Math.min(0.15, span * 0.1))
    const rightAt = Math.max(a + 0.3, Math.min(snap(a + Math.min(1.1, span * 0.5)), sec.end - 0.75))
    const strikeAt = Math.max(a + 0.15, Math.min(snap(a + Math.min(0.7, span * 0.3)), rightAt - 0.2))
    out.push(kinetic(`${sec.id}-show`, 3, showStart, sec.end, [
      { text: show.wrong, at: a, strike: strikeAt },
      { text: show.right, at: rightAt, accent: true },
    ], 0.55, { mode: 'stack' }))
  } else if (show?.kind === 'clip') {
    const t1 = r3(onBeat(showStart + Math.min(1, span * 0.3)) - showStart)
    const t2 = r3(onBeat(showStart + Math.min(1.5, span * 0.5)) - showStart)
    out.push({
      id: `${sec.id}-show`, type: 'screen-clip', track: 3, start: r3(showStart), duration: r3(span),
      params: {
        media: show.media, in: show.in, ...(show.still ? { still: true } : {}), at: { x: 0.5, y: 0.6 }, width: 0.92,
        chrome: show.lens || show.bare ? false : show.url ? { url: show.url } : {},
        ...(show.bare ? { enter: 'none' } : {}),
        ...(show.zoom ? { focus: [{ t: t1, ...show.zoom }] } : {}),
        ...(show.mark ? { marks: [{ at: t2, ...show.mark }] } : {}),
        ...(show.label ? { callouts: [{ at: t2, x: show.label.x, y: show.label.y, label: show.label.text }] } : {}),
      },
    })
    if (show.lens) {
      out.push({ id: `${sec.id}-lens`, type: 'microscope', track: 4, start: r3(showStart), duration: r3(span), params: { at: { x: 0.5, y: 0.6 }, radius: 0.42, focusSec: r3(Math.min(1.2, span * 0.35)), openAt: r3(Math.min(span - 0.7, Math.min(1.2, span * 0.35) + 0.7)), ...(show.lens.label ? { label: show.lens.label } : {}) } })
    }
  } else if (show?.kind === 'search') {
    const units = [...show.text].reduce((a, c) => a + (c === ' ' ? 2 : 1), 0)
    // Pretyped (the loop's first frame): a 1 s preroll covers the bar's intro and a typing fast enough to end before frame 0.
    const pre = sec.pretyped ? Math.min(1, span) : 0
    const cps = sec.pretyped ? Math.min(60, Math.max(14, Math.ceil(units / Math.max(0.1, pre - 0.55)))) : 14
    out.push({ id: `${sec.id}-show`, type: 'search-typing', track: 3, start: r3(showStart), duration: r3(span), ...(pre ? { preroll: r3(pre) } : {}), params: { text: show.text, results: 0, zoom: 1, cps } })
  } else if (show?.kind === 'layers') {
    const ats = show.layers.map((l, k) => {
      let a = showStart + 0.1 + k * beats(2, 0.9)
      if (l.say) {
        try {
          a = Math.max(showStart, tr.words[findPhrase(tr, l.say, sec.word, `layers[${k}]`)]!.start)
        } catch { /* not said: keep the stagger */ }
      }
      return r3(Math.min(sec.end - 0.3, onBeat(a)) - showStart)
    })
    out.push({
      id: `${sec.id}-show`, type: 'layer-stack', track: 3, start: r3(showStart), duration: r3(span),
      params: { layers: show.layers.map((l, k) => ({ title: l.title, ...(l.subtitle ? { subtitle: l.subtitle } : {}), at: ats[k] })), active: ats.map((at, index) => ({ at, index })), at: { x: 0.5, y: 0.62 }, width: 0.86 },
    })
  } else if (show?.kind === 'graph') {
    const n = show.nodes.length
    const step = Math.min(beats(1, 0.45), Math.max(0.15, (span - 1) / (n + 1)))
    const ats = show.nodes.map((_, k) => r3(onBeat(showStart + 0.1 + k * step) - showStart))
    out.push({
      id: `${sec.id}-show`, type: 'node-graph', track: 3, start: r3(showStart), duration: r3(span),
      params: {
        nodes: show.nodes.map((nd, k) => ({ id: nd.id, label: nd.label, ...(nd.sub ? { sub: nd.sub } : {}), kind: nd.kind ?? (k === 0 ? 'trigger' : 'step'), x: 0.5, y: r3((k + 0.5) / n), at: ats[k] })),
        edges: show.nodes.slice(1).map((nd, k) => ({ from: show.nodes[k]!.id, to: nd.id, at: ats[k + 1] })),
        flowAt: r3(Math.min(span - 0.3, ats[n - 1]! + 0.4)),
        ...(show.title ? { panel: { title: show.title } } : {}),
        at: { x: 0.5, y: 0.62 }, width: 0.9, aspect: 0.9,
      },
    })
  } else if (show?.kind === 'logos') {
    out.push({
      id: `${sec.id}-show`, type: 'logo-row', track: 3, start: r3(showStart), duration: r3(span),
      params: { items: show.items.map((it, k) => ({ image: it.image, ...(it.label ? { label: it.label } : {}), at: r3(onBeat(showStart + 0.1 + k * beats(1, 0.25)) - showStart) })), layout: show.items.length > 4 ? 'grid' : 'row', size: show.items.length > 3 ? 0.2 : 0.26, at: { x: 0.5, y: 0.6 } },
    })
  } else if (show?.kind === 'ecg') {
    let cur = sec.word
    const beats = show.beats.map((b, k) => {
      let at = showStart + 0.3 + (k * span) / (show.beats.length + 1)
      try {
        const w = findPhrase(tr, b.say ?? b.word, cur, `ecg.beats[${k}]`)
        cur = w + 1
        at = Math.max(showStart + 0.15, Math.min(sec.end - 0.5, tr.words[w]!.start))
      } catch { /* not said: spread evenly */ }
      return { at: r3(at - showStart), word: b.word, ...(b.box ? { box: true } : {}), ...(b.size ? { size: b.size } : {}) }
    })
    for (let k = 1; k < beats.length; k++) if (beats[k]!.at <= beats[k - 1]!.at) beats[k]!.at = r3(beats[k - 1]!.at + 0.3)
    out.push({
      id: `${sec.id}-ecg`, type: 'ecg-line', track: 3, start: r3(showStart), duration: r3(span),
      params: { beats, ...(show.flat ? { flatAt: r3(Math.max(beats.at(-1)!.at + 0.35, span - 0.45)) } : {}), y: 0.62 },
    })
  } else if (show?.kind === 'kinetic') {
    // Each beat from its phrase to the next beat's; the first beat is up as the part starts.
    // Beats anchor in order: each search starts after the previous beat's phrase.
    let kc = sec.word
    const starts = show.beats.map((b, k) => {
      if (k === 0) return { t: showStart, w: sec.word }
      try {
        const w = findPhrase(tr, b.say ?? splitWords(b.text)[0]!, kc, `kinetic.beats[${k}]`)
        kc = w + 1
        return { t: Math.max(showStart, Math.min(sec.end - 0.4, tr.words[w]!.start)), w }
      } catch {
        return { t: showStart + (k * span) / show.beats.length, w: sec.word }
      }
    })
    show.beats.forEach((b, k) => {
      const s = starts[k]!.t
      const e = k + 1 < starts.length ? starts[k + 1]!.t : sec.end
      if (e - s < 0.2) return
      const ws = splitWords(b.text)
      const ts = wordTimes(tr, ws, starts[k]!.w, s, e)
      ts[0] = s
      out.push({
        id: `${sec.id}-k${k}`, type: 'kinetic-text', track: 3, start: r3(s), duration: r3(e - s),
        params: {
          mode: b.style, enter: b.style === 'giant' ? 'rise' : 'mask-line', y: 0.45, ...(b.style === 'giant' ? {} : { maxPx: 330 }),
          words: ws.map((text, i) => ({
            text, at: r3(Math.max(0, ts[i]! - s)),
            ...(b.box && norm(text) === norm(b.box) ? { box: true, stress: 1 } : {}),
            ...(b.stretch && norm(text) === norm(b.stretch) ? { stress: 1 } : {}),
            ...(b.echo ? { echo: 2 } : {}),
            ...(b.stretch && norm(text) === norm(b.stretch) ? { stretch: { to: 5, at: r3(Math.max(0, ts[i]! - s) + 0.2), duration: r3(Math.max(0.3, Math.min(0.9, (e - ts[i]!) * 0.5))) } } : {}),
          })),
        },
      })
    })
  } else if (show?.kind === 'profile') {
    out.push({
      id: `${sec.id}-show`, type: 'profile-card', track: 3, start: r3(showStart), duration: r3(span),
      params: { avatar: show.avatar, name: show.name, stats: show.stats, ...(show.button ? { button: show.button } : {}), ...(show.followed ? { followed: show.followed } : {}), pressAt: r3(Math.max(0.9, onBeat(showStart + span * 0.7) - showStart)), at: { x: 0.5, y: 0.6 }, size: 0.98 },
    })
  } else if (show?.kind === 'heavy') {
    out.push({ id: `${sec.id}-show`, type: 'heavy-word', track: 3, start: r3(showStart), duration: r3(span), params: { word: show.word, at: r3(onBeat(showStart + Math.min(0.5, span * 0.25)) - showStart), duration: r3(beats(2, Math.min(0.9, span * 0.4))), place: { x: 0.5, y: L.showY } } })
  } else if (show?.kind === 'said') {
    const a = r3(onBeat(showStart + Math.min(0.2, span * 0.1)) - showStart)
    out.push({ id: `${sec.id}-show`, type: 'said-written', track: 3, start: r3(showStart), duration: r3(span), params: { said: show.said, written: show.written, saidAt: a, writtenAt: r3(Math.min(span - 0.4, onBeat(showStart + a + beats(2, 0.8)) - showStart)), place: { x: 0.5, y: L.showY } } })
  } else if (show?.kind === 'cut') {
    out.push({ id: `${sec.id}-show`, type: 'word-cut', track: 3, start: r3(showStart), duration: r3(span), params: { word: show.word, at: r3(Math.max(0.3, Math.min(span - 0.3, onBeat(showStart + Math.min(1.2, span * 0.45)) - showStart))), place: { x: 0.5, y: L.showY } } })
  } else if (show?.kind === 'book') {
    out.push({
      id: `${sec.id}-show`, type: 'book-flip', track: 3, start: r3(showStart), duration: r3(span),
      params: {
        image: show.image, ...(show.title ? { title: show.title } : {}), ...(show.flips ? { flips: show.flips } : {}),
        at: r3(Math.min(0.4, span * 0.1)), flipSec: r3(Math.max(0.6, Math.min(1.6, span * 0.4))),
        liftAt: r3(Math.max(span * 0.6, span - 0.65)), target: { at: { x: 0.5, y: 0.6 }, width: 0.92, aspect: show.aspect },
      },
    })
  } else if (show?.kind === 'stamp') {
    out.push({ id: `${sec.id}-show`, type: 'stamp', track: 3, start: r3(showStart), duration: r3(span), params: { text: show.text, at: { x: 0.5, y: 0.55 }, size: 0.7 } })
  } else if (show?.kind === 'brand') {
    const burst = sec.fromHero ? 0.05 : r3(onBeat(showStart + Math.min(0.3, span * 0.15)) - showStart)
    const land = r3(Math.min(span - 0.2, burst + beats(2, 1.0)))
    out.push({ id: `${sec.id}-word`, type: 'kinetic-text', track: 3, start: r3(showStart), duration: r3(span), params: { mode: 'giant', enter: 'fade', words: [{ text: show.word, at: land, key: `${sec.id}-brand` }] } })
    out.push({ id: `${sec.id}-show`, type: 'particle-word', track: 4, start: r3(showStart), duration: r3(span), params: { target: `${sec.id}-brand`, from: sec.fromHero ? { scene: 'hero' } : { x: 0.5, y: 0.45 }, burst, land } })
  } else if (show?.kind === 'words') {
    // The spoken words of the section, a few at a time.
    const ws = tr.words.filter((w) => w.start >= showStart - 0.05 && w.start < sec.end)
    for (let k = 0; k < ws.length; k += L.chunk) {
      const g = ws.slice(k, k + L.chunk)
      const s = k === 0 ? showStart : g[0]!.start
      const e = k + L.chunk < ws.length ? ws[k + L.chunk]!.start : sec.end
      if (e - s < 0.25) continue
      out.push(kinetic(`${sec.id}-w${k / L.chunk}`, 3, s, e, g.map((w) => ({ text: w.text.replace(/\s+/g, ''), at: Math.max(s, w.start) })).filter((w) => w.text), 0.55, { mode: 'stack' }))
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Templates

/** Splits a headline into words (punctuation kept on its word). */
const headWords = (s: string) => splitWords(s).slice(0, 4)

type Slot = { say: string; text?: string | undefined; box?: string | undefined; show?: Show | undefined; rec?: boolean | undefined }
type Item = Slot & { title: string }

/** One part of a template, before anchoring. */
interface Part {
  id: string
  name: string
  slot: Slot
  world: 'paper' | 'ink'
  /** The headline when the slot gives no `text`. */
  head?: string
  /** Box the last headline word when the slot names none. */
  boxLast?: boolean
  badge?: { number: number; title: string }
  bar?: { count: number; index: number; label: string }
  show?: Show
  cta?: { keyword: string }
  heroBelow?: boolean
  pretyped?: boolean
  fromHero?: boolean
  /** Phrases said inside this part, each becoming a sticker. */
  stickers?: { say: string; text: string }[]
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const two = (n: number) => String(n).padStart(2, '0').replace(/\d/g, (d) => AR_DIGITS[Number(d)]!)

/** Anchors every part (in order) and turns them into back-to-back sections; the first starts at 0. */
function sectionsOf(tr: Transcript, parts: Part[]): Section[] {
  const end = tr.words[tr.words.length - 1]!.end + PRESET_LAYOUT.tail
  let cur = 0
  const anchored = parts.map((pt) => {
    const w = findPhrase(tr, pt.slot.say, cur, pt.name)
    cur = w + 1
    const stickers = (pt.stickers ?? []).map((st, k) => {
      const sw = findPhrase(tr, st.say, k === 0 ? w : cur, `questions[${k}]`)
      cur = sw + 1
      return { text: st.text, at: tr.words[sw]!.start }
    })
    return { pt, w, stickers }
  })
  const starts = anchored.map((a, i) => (i === 0 ? 0 : tr.words[a.w]!.start))
  const last = anchored.at(-1)!
  const ends = [...starts.slice(1), Math.max(end, tr.words[last.w]!.start + (last.pt.cta ? CTA_MIN_SEC + 0.4 : 1))]
  return anchored.map(({ pt, w, stickers }, i): Section => {
    const headline = headWords(pt.slot.text ?? pt.head ?? pt.slot.say)
    const box = pt.slot.box ?? (pt.boxLast ? headline.at(-1) : undefined)
    const show = pt.slot.show ?? pt.show
    return {
      id: pt.id, word: w, start: starts[i]!, end: ends[i]!, world: pt.world, headline,
      ...(box ? { box } : {}), ...(pt.badge ? { badge: pt.badge } : {}), ...(pt.bar ? { bar: pt.bar } : {}),
      ...(show ? { show } : {}), ...(pt.cta ? { cta: pt.cta } : {}), ...(stickers.length ? { stickers } : {}),
      ...(pt.slot.rec ? { rec: true } : {}),
      ...(pt.heroBelow ? { heroBelow: true } : {}), ...(pt.pretyped ? { pretyped: true } : {}), ...(pt.fromHero ? { fromHero: true } : {}),
    }
  })
}

const ctaPart = (cta: Slot & { keyword: string }): Part => ({ id: 'cta', name: 'cta', slot: cta, world: 'ink', boxLast: true, cta: { keyword: cta.keyword } })

/** Numbered items: badge, chapter bar (`label · ٠٣`), boxed headline, a show (default: the spoken words). */
const itemParts = (items: Item[], id: string, label: string, world: (i: number) => 'paper' | 'ink', bar = true): Part[] =>
  items.map((it, i) => ({
    id: `${id}${i + 1}`, name: `${id}s[${i}]`, slot: it, world: world(i), head: it.title, boxLast: true,
    badge: { number: i + 1, title: it.title },
    ...(bar ? { bar: { count: items.length, index: i + 1, label: `${label} · ${two(i + 1)}` } } : {}),
    show: { kind: 'words' },
  }))

/** The parts of each preset. */
function partsOf(p: Preset): Part[] {
  switch (p.preset) {
    case 'list':
      // 1: hook → numbered items (worlds alternate) → CTA.
      return [{ id: 'hook', name: 'hook', slot: p.hook, world: 'ink' }, ...itemParts(p.items, 'item', p.label, (i) => (i % 2 === 0 ? 'paper' : 'ink')), ctaPart(p.cta)]
    case 'problem':
      // 6: the problem lives in the ink world, the solution on paper.
      return [
        { id: 'hook', name: 'hook', slot: p.hook, world: 'ink' },
        ...p.pains.map((s, i): Part => ({ id: `pain${i + 1}`, name: `pains[${i}]`, slot: s, world: 'ink', show: { kind: 'words' } })),
        { id: 'cost', name: 'cost', slot: p.cost, world: 'ink', boxLast: true, show: { kind: 'object', objects: ['coin'] } },
        ...itemParts(p.steps, 'step', '', () => 'paper', false),
        ctaPart(p.cta),
      ]
    case 'steps':
      // 7: hook → who it is for → steps with the lit stepper → the promise → CTA.
      return [
        { id: 'hook', name: 'hook', slot: p.hook, world: 'ink' },
        ...(p.audience ? [{ id: 'audience', name: 'audience', slot: p.audience, world: 'ink' as const, boxLast: true }] : []),
        ...itemParts(p.steps, 'step', p.label, () => 'paper'),
        ...(p.promise ? [{ id: 'promise', name: 'promise', slot: p.promise, world: 'ink' as const, boxLast: true }] : []),
        ctaPart(p.cta),
      ]
    case 'asked':
      // 9: the questions pop as comment stickers → the answer in steps → CTA.
      return [
        { id: 'asked', name: 'questions[0]', slot: { say: p.questions[0]!.say, text: p.title }, world: 'paper', boxLast: true, stickers: p.questions.map((q) => ({ say: q.say, text: q.text ?? q.say })) },
        ...itemParts(p.steps, 'step', p.label, (i) => (i % 2 === 0 ? 'ink' : 'paper')),
        ctaPart(p.cta),
      ]
    case 'tool':
      // 2: hook → what it is → the real recording moments (paper) → the result → CTA.
      return [
        { id: 'hook', name: 'hook', slot: p.hook, world: 'ink' },
        ...(p.intro ? [{ id: 'intro', name: 'intro', slot: p.intro, world: 'ink' as const, boxLast: true, show: { kind: 'words' } as Show }] : []),
        ...p.demos.map((s, i): Part => ({ id: `demo${i + 1}`, name: `demos[${i}]`, slot: s, world: 'paper', boxLast: true, show: { kind: 'words' } })),
        ...(p.result ? [{ id: 'result', name: 'result', slot: p.result, world: 'ink' as const, boxLast: true, show: { kind: 'words' } as Show }] : []),
        ctaPart(p.cta),
      ]
    case 'loop':
      // 3: the search bar opens (typed on frame 0) and closes the video, so the last frame runs into the first.
      return [
        { id: 'open', name: 'open', slot: p.open, world: 'paper', show: { kind: 'search', text: p.topic }, pretyped: true },
        ...itemParts(p.tips, 'tip', p.label, (i) => (i % 2 === 0 ? 'ink' : 'paper')),
        { id: 'close', name: 'close', slot: p.close, world: 'paper', show: { kind: 'search', text: p.topic } },
      ]
    case 'system':
      // 4: hook → each part of the system with its diagram → CTA (worlds alternate).
      return [
        { id: 'hook', name: 'hook', slot: p.hook, world: 'ink' },
        ...p.parts.map((s, i): Part => ({ id: `part${i + 1}`, name: `parts[${i}]`, slot: s, world: i % 2 === 0 ? 'paper' : 'ink', boxLast: true, show: { kind: 'words' } })),
        ctaPart(p.cta),
      ]
    case 'teaser':
      // 5: one hero morphs through the lines → particles become the brand word → «قريباً».
      return [
        ...p.lines.map((s, i): Part => ({ id: `line${i + 1}`, name: `lines[${i}]`, slot: s, world: i % 2 === 0 ? 'paper' : 'ink', heroBelow: true })),
        { id: 'brand', name: 'brand', slot: p.brand, world: 'ink', show: { kind: 'brand', word: p.brand.word }, fromHero: true },
        { id: 'soon', name: 'soon', slot: p.soon, world: 'paper', boxLast: true, show: { kind: 'stamp', text: p.soon.stamp } },
      ]
  }
}

/** Scenes a template adds over its sections: the teaser's hero, one morph-object across every line. */
function extrasOf(p: Preset, secs: Section[]): Record<string, unknown>[] {
  if (p.preset !== 'teaser') return []
  const lines = secs.filter((s) => s.id.startsWith('line'))
  const s0 = lines[0]!.start
  // The hero lives on into the brand section, where it bursts into the particles.
  const end = lines.at(-1)!.end + 0.1
  return [{
    id: 'hero', type: 'morph-object', track: 4, start: r3(s0), duration: r3(end - s0),
    params: { states: p.lines.map((l, i) => ({ at: r3(i === 0 ? 0.1 : lines[i]!.start - s0), object: l.object, x: 0.5, y: 0.6, size: 0.42 })) },
  }]
}

/** Scene types whose entrances follow the preset's `motion`. */
const EASED: ReadonlySet<string> = new Set(['book-flip', 'ecg-line', 'microscope', 'kinetic-text', 'section-number', 'type-stretch', 'letters-join', 'chapter-bar', 'comment-stickers', 'heavy-word', 'said-written', 'word-cut', 'viewfinder'])

/**
 * How the skill reads the user's words for `motion` (checked in this order; nothing said → `easy`).
 * Snappy wins when both appear («بدون ease» names ease but asks for none).
 */
export const EASE_WORDS = {
  snappy: ['snappy', 'سريع', 'سريعة', 'حاد', 'حادة', 'قوي', 'بدون ease', 'بلا ease', 'no ease', 'linear', 'punchy', 'ضربة'],
  easy: ['easy ease', 'ease in', 'ease out', 'ناعم', 'ناعمة', 'سلس', 'سلسة', 'هادي', 'هادئ', 'smooth', 'soft'],
} as const

/** The `motion` the user's words ask for, or undefined when they say nothing about it. */
export function motionFromWords(text: string): 'easy' | 'snappy' | undefined {
  const t = text.toLowerCase()
  if (EASE_WORDS.snappy.some((w) => t.includes(w))) return 'snappy'
  if (EASE_WORDS.easy.some((w) => t.includes(w))) return 'easy'
  return undefined
}

/**
 * A transcript for a video with no voice: the script's words land one per beat (a sentence end
 * rests one more beat), so a preset can be laid out on the music's tempo alone.
 */
export function beatTranscript(script: string, bpm: number): Transcript {
  const B = 60 / bpm
  let beat = 1
  const words = splitWords(script.replace(/\s+/g, ' ').trim()).map((raw, i) => {
    const t = beat * B
    beat += 1 + (/[.؟?!]$/.test(raw) ? 1 : 0)
    return { i, text: raw.replace(/[.،؟?!,:]/g, ''), start: +t.toFixed(3), end: +(t + 0.8 * B).toFixed(3), p: 1 }
  }).filter((w) => w.text)
  return { version: 1, media: 'beat', sourceHash: 'beat', model: `beat-${bpm}`, language: 'ar', words: words.map((w, i) => ({ ...w, i })) } as Transcript
}

/** One captions scene over the whole video, cues grouped from the transcript (none without `captions`). */
function captionScenes(p: Preset, tr: Transcript, secs: Section[]): Record<string, unknown>[] {
  if (!p.captions) return []
  const end = secs.at(-1)!.end
  const cues = groupCaptions(tr.words.map((w) => ({ text: w.text, at: w.start, end: w.end })))
  if (cues.length === 0) return []
  return [{
    id: 'captions', type: 'captions', track: 5, start: 0, duration: r3(end),
    params: { skin: p.captions.skin, presentation: p.captions.presentation, ...(p.captions.y ? { y: p.captions.y } : {}), cues: cues.map((c) => ({ at: r3(c.at), end: r3(Math.min(end, c.end)), words: c.words.map((w) => ({ text: w.text, at: r3(w.at), end: r3(w.end) })) })) },
  }]
}

export interface PresetInput {
  preset: Preset
  transcript: Transcript
  fps: number
  seed: number
}

/** `preset.json` + transcript → storyboard JSON (`edit.json`). */
export function presetStoryboard(i: PresetInput): Record<string, unknown> {
  const p = i.preset
  const tr = i.transcript
  if (tr.words.length === 0) throw new Error('التفريغ فارغ — the transcript has no words')
  const secs = sectionsOf(tr, partsOf(p))
  return {
    version: 1,
    format: '9:16',
    fps: i.fps,
    look: p.look,
    dir: 'rtl',
    seed: i.seed,
    autoSfx: false,
    camera: { fixedTracks: [5], keys: [{ at: 0, x: 0.5, y: 0.5, zoom: 1 }] },
    ...(tr.media === 'beat' ? {} : { audio: [{ kind: 'voice', media: tr.media }] }),
    scenes: [...secs.flatMap((s) => sectionScenes(tr, s, p.beat)), ...extrasOf(p, secs), ...captionScenes(p, tr, secs)].map((sc) => (EASED.has(sc.type as string) ? { ...sc, params: { ...(sc.params as object), ease: p.motion === 'easy' ? 'easy' : 'out' } } : sc)),
  }
}
