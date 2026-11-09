import type { ObjectId } from './objects'
import type { IconName } from './params/icon'
import type { LineArtName } from './params/line-art'
import { normalizeAr, type TranscriptWord } from './transcript'

/**
 * The Arabic keyword → visual map of the explainer recipe (§17.9, Task 10). Pure (no Node, no
 * DOM). Our own word list: stems are written already normalized (`normalizeAr`: ة→ه, أإآ→ا, ى→ي),
 * a multi-word stem is space-separated and matches consecutive spoken words. Ambiguous words are
 * left out or kept only with the article (`الحل`: «حل» alone is also the verb «solved»; دول, دخل,
 * ابدا and ثانيه («مرة ثانية») have common non-visual meanings).
 */
export type Visual = { type: 'icon'; icon: IconName } | { type: 'line-art'; art: LineArtName } | { type: 'counter' } | { type: 'ui' }

/**
 * Plan 2a+ Task 9: words that name an interface element (normalized stems). A `{ type: 'ui' }` hit
 * draws nothing by itself; the creative director turns it into `shape-states`. «تطبيق» and «اشعار»
 * keep their icons in `matchKeywords` (earlier entries win), so `isUiWord` matches these stems directly.
 */
export const UI_STEMS: readonly string[] = ['زر', 'ازرار', 'تطبيق', 'اعدادات', 'اشعار', 'اشعارات', 'تفعيل']

const icon = (name: IconName): Visual => ({ type: 'icon', icon: name })
const art = (name: LineArtName): Visual => ({ type: 'line-art', art: name })

export const KEYWORDS_AR: readonly { stems: string[]; visual: Visual }[] = [
  { stems: ['مال', 'فلوس', 'ربح', 'ارباح', 'راتب'], visual: icon('banknote') },
  { stems: ['سعر', 'تكلفه', 'ميزانيه', 'توفير'], visual: icon('coins') },
  { stems: ['وقت', 'ساعه', 'دقيقه', 'ثواني', 'اوقات'], visual: icon('clock') },
  { stems: ['نمو', 'زياده', 'ارتفاع', 'تضاعف'], visual: art('chart-up') },
  { stems: ['مبيعات', 'نتائج', 'ارقام', 'احصائيات'], visual: icon('chart-line') },
  { stems: ['امان', 'حمايه', 'خصوصيه', 'سري'], visual: icon('lock') },
  { stems: ['ثقه', 'ضمان', 'موثوق'], visual: icon('shield-check') },
  { stems: ['سرعه', 'سريع', 'فورا', 'بسرعه'], visual: art('speed-lines') },
  { stems: ['طاقه', 'قوه', 'اقوي'], visual: icon('zap') },
  { stems: ['فكره', 'افكار', 'ابداع'], visual: icon('lightbulb') },
  { stems: ['هدف', 'اهداف', 'غايه'], visual: icon('target') },
  { stems: ['بيانات', 'معلومات', 'قاعده بيانات'], visual: icon('database') },
  { stems: ['ذكاء اصطناعي', 'ذكاء', 'سحر'], visual: icon('sparkles') },
  { stems: ['هاتف', 'جوال', 'موبايل', 'تطبيق'], visual: icon('smartphone') },
  { stems: ['رساله', 'رسايل', 'محادثه', 'تعليق'], visual: icon('message-circle') },
  { stems: ['عالم', 'انترنت'], visual: icon('globe') },
  { stems: ['مشكله', 'مشاكل', 'خطا', 'خطر', 'تحذير'], visual: icon('triangle-alert') },
  { stems: ['الحل', 'حلول', 'جاهز'], visual: icon('check-circle') },
  { stems: ['ناس', 'مستخدم', 'عملاء', 'جمهور', 'متابعين'], visual: icon('users') },
  { stems: ['اطلاق', 'انطلاق'], visual: icon('rocket') },
  { stems: ['نتيجه', 'خلاصه'], visual: art('circle-mark') },
  { stems: ['طريقه', 'خطوه', 'خطوات'], visual: art('arrow-curve') },
  { stems: ['مهم', 'انتبه', 'اهم'], visual: art('underline') },
  { stems: ['ملخص', 'مجموعه'], visual: art('bracket') },
  { stems: ['مستقبل', 'طموح'], visual: icon('rocket') },
  { stems: ['نجاح', 'انجاز'], visual: icon('check-circle') },
  { stems: ['تعلم', 'تعليم', 'درس', 'معرفه'], visual: icon('lightbulb') },
  { stems: ['سوق', 'منافسه', 'منافس'], visual: icon('chart-line') },
  { stems: ['بريد', 'ايميل', 'اشعار'], visual: icon('message-circle') },
  { stems: ['كهرباء', 'شحن', 'بطاريه'], visual: icon('zap') },
  { stems: [...UI_STEMS], visual: { type: 'ui' } },
]

/** One-letter proclitics: conjunctions (و ف) then prepositions (ب ل ك). */
const CONJ = ['و', 'ف']
const PREP = ['ب', 'ل', 'ك']

/** Pronoun / plural / dual endings a stem of 3+ letters may carry. */
const SUFFIXES = ['ين', 'ان', 'ات', 'ون', 'ه', 'ها', 'هم', 'هن', 'هما', 'ي', 'يه', 'يات', 'ك', 'كم', 'نا', 'ا']
/** Endings of a stem in ه (taa marbuta): its construct form in ت (ساعه → ساعتين, ساعات). */
const TAA_SUFFIXES = ['ات', 'تين', 'تان', 'تي', 'ته', 'تها', 'تهم', 'تك', 'تكم', 'تنا']

const letters = (s: string) => [...s].length

/**
 * Candidates of a spoken token after removing clitics: the normalized token, then every form with
 * a leading و/ف, then ب/ل/ك, then ال (or لل for ل+ال) removed, longest first, none shorter than 2
 * letters, without repeats.
 */
export function stripClitics(token: string): string[] {
  const n = normalizeAr(token).replace(/\s+/g, '')
  const out = new Set<string>()
  const add = (s: string) => {
    if (letters(s) >= 2) out.add(s)
  }
  const conj = [n, ...CONJ.filter((c) => n.startsWith(c)).map((c) => n.slice(c.length))]
  for (const a of conj) {
    add(a)
    const prep = [a, ...PREP.filter((p) => a.startsWith(p)).map((p) => a.slice(p.length))]
    for (const b of prep) {
      add(b)
      if (b.startsWith('ال')) add(b.slice(2))
    }
    if (a.startsWith('لل')) add(a.slice(2))
  }
  return [...out].sort((x, y) => letters(y) - letters(x))
}

/** True when a candidate is the stem, or (stems of 3+ letters) the stem with a known ending. */
function stemMatches(candidate: string, stem: string): boolean {
  if (candidate === stem) return true
  if (letters(stem) < 3) return false
  if (SUFFIXES.some((s) => candidate === stem + s)) return true
  if (stem.endsWith('ه')) {
    const root = stem.slice(0, -1)
    if (TAA_SUFFIXES.some((s) => candidate === root + s)) return true
  }
  return false
}

const wordMatches = (token: string, stem: string) => stripClitics(token).some((c) => stemMatches(c, stem))

/** True when a spoken token names an interface element (`UI_STEMS`, with clitics and endings). */
export const isUiWord = (token: string): boolean => UI_STEMS.some((stem) => wordMatches(token, stem))

const ARABIC_DIGITS = /[٠-٩]/g
const PERSIAN_DIGITS = /[۰-۹]/g

/**
 * The value of a number token (Arabic-Indic, Persian or Latin digits; `,` `٬` thousands
 * separators; `.` `٫` decimals; surrounding signs like ٪ % $ ignored), or null when the token has
 * no digits or anything but digits and separators between them.
 */
export function numberValue(token: string): number | null {
  const t = token
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫]/g, '.')
    .replace(/[,٬]/g, '')
  const m = /^[^\d\p{L}]*(\d+(?:\.\d+)?)[^\d\p{L}]*$/u.exec(t)
  if (!m) return null
  const v = Number(m[1])
  return Number.isFinite(v) ? v : null
}

/** Stems ordered so a multi-word stem is tried before the single words it contains. */
const ORDERED = KEYWORDS_AR.flatMap((k) => k.stems.map((stem) => ({ parts: normalizeAr(stem).split(' '), visual: k.visual }))).sort(
  (a, b) => b.parts.length - a.parts.length,
)

/** Seconds within which the same visual is not repeated. */
export const SAME_VISUAL_SEC = 3

/**
 * Keyword hits in spoken order: a number token → counter; otherwise the first stem (multi-word
 * stems first) whose parts match consecutive words (the hit is on the first word, the others are
 * consumed). One hit per word. A visual equal to one hit less than SAME_VISUAL_SEC earlier is
 * dropped; counters are never dropped (each shows its own number).
 */
export function matchKeywords(words: readonly TranscriptWord[]): { word: number; visual: Visual }[] {
  const hits: { word: number; visual: Visual }[] = []
  const lastAt = new Map<string, number>()
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    let visual: Visual | undefined
    let used = 1
    if (numberValue(w.text) !== null) visual = { type: 'counter' }
    else {
      for (const s of ORDERED) {
        if (i + s.parts.length > words.length) continue
        if (s.parts.every((p, k) => wordMatches(words[i + k]!.text, p))) {
          visual = s.visual
          used = s.parts.length
          break
        }
      }
    }
    if (!visual) continue
    const key = JSON.stringify(visual)
    const prev = lastAt.get(key)
    if (visual.type !== 'counter' && prev !== undefined && w.start - prev < SAME_VISUAL_SEC) continue
    lastAt.set(key, w.start)
    hits.push({ word: i, visual })
    i += used - 1
  }
  return hits
}

// ---------------------------------------------------------------------------------------------
// Plan 3 Task 7: the hero's meaningful objects (the `signature` look's default director)

/**
 * A word → object stem of the signature director (normalized like KEYWORDS_AR; a multi-word stem
 * matches consecutive words). `requires`: the stem counts only when one of these stems is also in
 * the sentence (beat); `unless`: it does not count when one of these is. Our own word list, from
 * the scripts Yousif tested (amendment B): every sentence with a hit shows its object, never an
 * abstract ring / bar / dot.
 */
export interface ObjectStem {
  stems: string[]
  object: ObjectId
  requires?: string[]
  unless?: string[]
}

export const OBJECT_STEMS: readonly ObjectStem[] = [
  { stems: ['ساعه', 'وقت', 'دقيقه', 'دقايق'], object: 'clock' },
  { stems: ['شهر', 'اسبوع', 'يوم', 'موعد'], object: 'calendar' },
  { stems: ['فلوس', 'مال', 'سعر', 'ريال', 'درهم', 'دولار', 'دفع'], object: 'coin' },
  { stems: ['اكتب', 'سكربت', 'سكريبت', 'نص', 'كتابه'], object: 'document' },
  { stems: ['فاتوره', 'فواتير'], object: 'document', unless: ['ايميل'] },
  { stems: ['ايميل', 'بريد'], object: 'envelope' },
  { stems: ['رساله', 'رسايل'], object: 'envelope', requires: ['ايميل'] },
  { stems: ['تذكير', 'يذكر', 'تنبيه', 'اشعار'], object: 'bell' },
  { stems: ['ملاحظه صوتيه', 'ملاحظه صوت', 'فويس'], object: 'voice-note' },
  { stems: ['صوت', 'سجل', 'تسجيل'], object: 'microphone' },
  { stems: ['مونتاج', 'مهاره', 'تحرك', 'حرك', 'فيديو', 'قص'], object: 'timeline' },
  { stems: ['تطبيق', 'جوال'], object: 'phone-app' },
]

/** Stems of the director's scene visuals: the customer chase, the word wall (repetition), the repeat loop (every day). */
export const SCENE_STEMS: readonly { stems: string[]; kind: 'chase' | 'wall' | 'loop'; requires?: string[] }[] = [
  { stems: ['تلاحق', 'الاحق', 'نلاحق', 'مطارده'], kind: 'chase' },
  { stems: ['عملاء'], kind: 'chase', requires: ['تلاحق'] },
  { stems: ['مكرر', 'تكرار', 'نفس شغل'], kind: 'wall' },
  { stems: ['كل يوم', 'دايما'], kind: 'loop' },
]

/** Whole tokens no stem matches (normalized): «اليوم» is "today", not a calendar day. */
const STEM_EXCLUDED: ReadonlySet<string> = new Set(['اليوم', 'واليوم', 'فاليوم'])

export type StemKind = ObjectId | 'chase' | 'wall' | 'loop'

type StemEntry = { parts: string[]; kind: StemKind; requires?: string[]; unless?: string[] }
const STEM_ENTRIES: readonly StemEntry[] = [
  ...OBJECT_STEMS.flatMap((o) => o.stems.map((st): StemEntry => ({ parts: normalizeAr(st).split(' '), kind: o.object, ...(o.requires ? { requires: o.requires } : {}), ...(o.unless ? { unless: o.unless } : {}) }))),
  ...SCENE_STEMS.flatMap((o) => o.stems.map((st): StemEntry => ({ parts: normalizeAr(st).split(' '), kind: o.kind, ...(o.requires ? { requires: o.requires } : {}) }))),
]

/**
 * The visual a sentence's own words call for (the signature director's fallback, amendment B):
 * every stem hit of OBJECT_STEMS / SCENE_STEMS whose `requires` / `unless` hold in `words`; the
 * most specific wins — more words, then a longer stem, then the earlier word. `word`: the winning
 * hit's first word; `first`: the earliest hit of any stem (conditions ignored), where the visual
 * comes in. `exclude(k)` blanks word k (the CTA keyword). Undefined without a hit.
 */
export function stemVisualOf(words: readonly string[], exclude: (k: number) => boolean = () => false): { kind: StemKind; word: number; first: number } | undefined {
  const usable = (k: number) => !exclude(k) && !STEM_EXCLUDED.has(normalizeAr(words[k] ?? ''))
  const at = (e: StemEntry, k: number) => k + e.parts.length <= words.length && e.parts.every((p, q) => usable(k + q) && wordMatches(words[k + q]!, p))
  const has = (stem: string) => words.some((_, k) => usable(k) && wordMatches(words[k]!, normalizeAr(stem)))
  let best: { e: StemEntry; k: number } | undefined
  let first = -1
  for (let k = 0; k < words.length; k++) {
    for (const e of STEM_ENTRIES) {
      if (!at(e, k)) continue
      if (first < 0) first = k
      if (e.requires && !e.requires.some(has)) continue
      if (e.unless?.some(has)) continue
      const score = (x: { e: StemEntry; k: number }) => [x.e.parts.length, letters(x.e.parts.join(''))]
      if (!best) {
        best = { e, k }
        continue
      }
      const [a1, a2] = score({ e, k })
      const [b1, b2] = score(best)
      if (a1! > b1! || (a1 === b1 && a2! > b2!)) best = { e, k }
    }
  }
  return best ? { kind: best.e.kind, word: best.k, first } : undefined
}
