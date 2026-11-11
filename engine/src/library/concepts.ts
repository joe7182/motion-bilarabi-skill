import { dressScene } from '../packs/dress'
import type { Pack } from '../packs/schema'
/**
 * The concept library (Plan 4 v2, Wave A): finished ideas a sentence can become. Each concept reads
 * the sentence (its words and, when known, their times), says how well it fits (`score`, with a
 * reason in Arabic and English) and builds ordinary storyboard scenes timed to the words (`build`).
 * `recommend` ranks them. Pure: no DOM, no files.
 */

export interface Word {
  text: string
  /** Seconds (absolute in the video). */
  start: number
  end: number
}
export interface Sentence {
  words: Word[]
  start: number
  end: number
  text: string
}
export interface Features {
  numbers: number[]
  percent: boolean
  beforeAfter: boolean
  filter: boolean
  many: boolean
  negation: boolean
  ui: boolean
  tool: boolean
  transform: boolean
  question: boolean
  growth: boolean
}
export interface Scene {
  id: string
  type: string
  track: number
  start: number
  duration: number
  params: Record<string, unknown>
}
export interface Concept {
  id: string
  ar: string
  /** What the viewer understands without words. */
  idea: string
  minSec: number
  maxSec: number
  /** 0 = does not fit; higher fits better. The reason is shown to the person choosing. */
  score(f: Features, s: Sentence): { score: number; why: string }
  build(s: Sentence, id: string): Scene[]
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const toLatin = (t: string) => t.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/٫/g, '.')
const has = (t: string, words: string[]) => words.some((w) => t.includes(w))
const strip = (t: string) => t.replace(/[ً-ْٰ«»"'.,،؛:!؟?…]/g, '')

/** What a sentence is about, from its words (Arabic and English cues). */
export function featuresOf(s: Sentence): Features {
  const t = strip(s.text)
  const numbers = (toLatin(s.text).match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
  return {
    numbers,
    percent: /[%٪]|بالمية|بالمئة|نسبة|percent/i.test(s.text),
    beforeAfter: has(t, ['قبل', 'بعد', 'الفرق', 'صار', 'كان', 'before', 'after']),
    filter: has(t, ['فلتر', 'تختار', 'اختار', 'بس اللي', 'أفضل', 'تستاهل', 'تفلتر', 'تصفية', 'filter', 'best', 'only']),
    many: has(t, ['كثير', 'عشرات', 'مئات', 'آلاف', 'كل', 'نسخ', 'many', 'every']),
    // Whole words only: «ما» and «لا» are too often not a negation to count.
    negation: has(` ${t} `, [' مو ', ' ليس ', ' مش ', ' بدل ', ' غلط ', ' not ', ' instead ', ' wrong ']),
    ui: has(t, ['زر', 'اضغط', 'إشعار', 'اشعار', 'واجهة', 'تطبيق', 'button', 'click', 'app', 'notification']),
    tool: has(t, ['أداة', 'اداة', 'موقع', 'برنامج', 'ترفع', 'tool', 'site', 'upload']),
    transform: has(t, ['يتحول', 'تتحول', 'يصير', 'تصير', 'تحول', 'becomes', 'turns']),
    question: /[؟?]/.test(s.text) || has(t, ['شلون', 'ليش', 'شنو', 'منو', 'how', 'why', 'what']),
    growth: has(t, ['نمو', 'زاد', 'زادت', 'تضاعف', 'ارتفع', 'يكبر', 'grow', 'growth', 'up']),
  }
}

let n = 0
const sid = (base: string) => `${base}-${++n}`
/** Words that carry meaning (the longest few), for headlines and labels. */
const keyWords = (s: Sentence, k: number) => [...s.words].filter((w) => strip(w.text).length > 2).sort((a, b) => strip(b.text).length - strip(a.text).length).slice(0, k)
const rel = (t: number, s: Sentence) => +Math.max(0, t - s.start).toFixed(3)
const dur = (s: Sentence) => +(s.end - s.start).toFixed(3)
const clean = (t: string) => strip(t).trim()

/** Landing times for the karaoke ball: each word's start, at least 0.42 s in (the ball falls in first), always rising. */
function landings(s: Sentence) {
  let prev = 0.3
  return s.words.slice(0, 8).map((w, i, all) => {
    const at = +Math.max(0.42, rel(w.start, s), prev + 0.14).toFixed(3)
    prev = at
    return { text: (clean(w.text) || w.text).slice(0, 18), at, key: i === all.length - 1 }
  })
}

export const CONCEPTS: Concept[] = [
  {
    id: 'karaoke-ball',
    ar: 'كرة تنط على الجملة',
    idea: 'a ball hops onto each word as it is said',
    minSec: 1.2,
    maxSec: 6,
    score: (_f, s) => (s.words.length >= 2 && s.words.length <= 8 ? { score: 1, why: 'تمشي ويا أي جملة قصيرة — fits any short sentence' } : { score: 0, why: '' }),
    build: (s, id) => [
      { id: sid(id), type: 'bounce-ball', track: 2, start: s.start, duration: dur(s), params: { words: landings(s), trail: true } },
    ],
  },
  {
    id: 'growth-graph',
    ar: 'نقطة ترسم النمو',
    idea: 'the hero dot draws a rising line and lands on the number',
    minSec: 2,
    maxSec: 6,
    score: (f) => (f.growth || f.percent ? { score: 4, why: 'فيها نمو أو نسبة — growth or a percentage' } : f.numbers.length ? { score: 2, why: 'فيها رقم — has a number' } : { score: 0, why: '' }),
    build: (s, id) => {
      const num = featuresOf(s).numbers[0]
      const callout = num !== undefined ? `+${String(num).replace(/\d/g, (d) => AR_DIGITS[+d]!)}${featuresOf(s).percent ? '٪' : ''}` : '+٢٢٪'
      return [{ id: sid(id), type: 'spring-graph', track: 2, start: s.start, duration: dur(s), params: { values: [10, 14, 12, 19, 17, 25, 32], at: 0.3, step: Math.max(0.15, Math.min(0.5, (dur(s) - 1) / 6)), callout } }]
    },
  },
  {
    id: 'before-after-slider',
    ar: 'قبل وبعد بفاصل',
    idea: 'a hand drags a divider and the new state takes the frame',
    minSec: 2,
    maxSec: 6,
    score: (f) => (f.beforeAfter ? { score: 4, why: 'تقارن حالتين — compares two states' } : { score: 0, why: '' }),
    build: (s, id) => {
      const kw = keyWords(s, 2)
      return [{ id: sid(id), type: 'before-after', track: 2, start: s.start, duration: dur(s), params: { before: { text: clean(kw[1]?.text ?? 'قبل'), label: 'قبل' }, after: { text: clean(kw[0]?.text ?? 'بعد'), label: 'بعد' }, at: Math.min(0.8, dur(s) * 0.25), dur: Math.max(0.6, Math.min(1.6, dur(s) * 0.5)) } }]
    },
  },
  {
    id: 'one-to-many',
    ar: 'وحدة تصير كثير',
    idea: 'one input card fans out into many results',
    minSec: 2,
    maxSec: 6,
    score: (f) => (f.many ? { score: 3, why: 'شي واحد يطلع منه كثير — one becomes many' } : { score: 0, why: '' }),
    build: (s, id) => {
      const kw = keyWords(s, 4)
      return [{ id: sid(id), type: 'fan-cards', track: 2, start: s.start, duration: dur(s), params: { input: s.words.slice(0, 4).map((w) => w.text).join(' ').slice(0, 30), at: 0.4, outputs: (kw.length >= 2 ? kw : [{ text: 'ريل' }, { text: 'بوست' }, { text: 'ستوري' }]).map((w) => ({ title: clean(w.text).slice(0, 18) || 'نتيجة' })) } }]
    },
  },
  {
    id: 'shortlist-funnel',
    ar: 'القمع',
    idea: 'many candidates pour in, only the best pass',
    minSec: 2.5,
    maxSec: 7,
    score: (f) => (f.filter ? { score: 4, why: 'فيها اختيار أو فلترة — choosing or filtering' } : { score: 0, why: '' }),
    build: (s, id) => [
      { id: sid(id), type: 'funnel', track: 2, start: s.start, duration: dur(s), params: { at: 0.3, dur: Math.max(0.8, Math.min(4, dur(s) - 0.8)), items: Array.from({ length: 8 }, (_, i) => ({ text: `فكرة ${AR_DIGITS[i + 1]}`, keep: i % 3 === 1 })), result: clean(keyWords(s, 1)[0]?.text ?? '').slice(0, 24) || undefined } },
    ],
  },
  {
    id: 'strike-and-replace',
    ar: 'شطب واستبدال',
    idea: 'the wrong word is struck and the right one takes its place',
    minSec: 1.2,
    maxSec: 5,
    score: (f) => (f.negation ? { score: 3, why: 'فيها نفي أو تصحيح — a negation or correction' } : { score: 0, why: '' }),
    build: (s, id) => {
      const kw = keyWords(s, 2)
      const wrong = clean(kw[1]?.text ?? s.words[0]!.text)
      const right = clean(kw[0]?.text ?? s.words[s.words.length - 1]!.text)
      return [{ id: sid(id), type: 'editorial-type', track: 2, start: s.start, duration: dur(s), params: { y: 0.45, size: 170, lines: [{ words: [{ text: wrong, at: 0.05, serif: true, accent: true }] }], select: { line: 0, word: 0, at: 0.3 }, swaps: [{ line: 0, word: 0, to: right, at: Math.max(0.6, dur(s) * 0.55) }] } }]
    },
  },
  {
    id: 'ui-chain',
    ar: 'واجهة تتحوّل',
    idea: 'a button is clicked, loads, succeeds and notifies',
    minSec: 2.5,
    maxSec: 8,
    score: (f) => (f.ui ? { score: 3, why: 'تتكلم عن واجهة أو ضغطة — an interface or a tap' } : { score: 0, why: '' }),
    build: (s, id) => {
      const D = dur(s)
      const label = clean(keyWords(s, 1)[0]?.text ?? 'ابدأ')
      return [{ id: sid(id), type: 'ui-morph', track: 2, start: s.start, duration: D, params: { states: [{ kind: 'button', at: 0.1, label }, { kind: 'loader', at: D * 0.3 }, { kind: 'check', at: D * 0.55 }, { kind: 'toast', at: D * 0.75, label: 'تم ✓' }] } }]
    },
  },
  {
    id: 'object-chain',
    ar: 'شي يتحوّل لشي',
    idea: 'one drawn object becomes the next',
    minSec: 2,
    maxSec: 6,
    score: (f) => (f.transform ? { score: 3, why: 'فيها تحوّل — something becomes something' } : { score: 0, why: '' }),
    build: (s, id) => {
      const D = dur(s)
      return [{ id: sid(id), type: 'morph-object', track: 2, start: s.start, duration: D, params: { states: [{ at: 0.1, object: 'bulb', x: 0.5, y: 0.45, size: 0.46 }, { at: D * 0.45, object: 'ai-chip', x: 0.5, y: 0.45, size: 0.46 }, { at: D * 0.8, object: 'document', x: 0.5, y: 0.45, size: 0.46 }] } }]
    },
  },
  {
    id: 'question-pulse',
    ar: 'سؤال ينبض',
    idea: 'the question glows word by word and the key word lights up',
    minSec: 1,
    maxSec: 5,
    score: (f) => (f.question ? { score: 2, why: 'سؤال — a question' } : { score: 0, why: '' }),
    build: (s, id) => {
      const longest = keyWords(s, 1)[0]
      return [{ id: sid(id), type: 'glow-words', track: 2, start: s.start, duration: dur(s), params: { y: 0.42, size: 96, words: s.words.slice(0, 16).map((w) => ({ text: w.text.slice(0, 18), at: rel(w.start, s), key: w === longest })) } }]
    },
  },
]

export interface Recommendation {
  id: string
  ar: string
  score: number
  why: string
  scenes: Scene[]
}

/** Ranked concepts for a sentence (best first), each with its scenes built on the sentence's words. */
export function recommend(s: Sentence, top = 3, pack?: Pack): Recommendation[] {
  const f = featuresOf(s)
  const len = s.end - s.start
  return CONCEPTS.map((c) => {
    const r = c.score(f, s)
    const fits = len >= c.minSec - 0.05 && len <= c.maxSec + 0.05
    return { c, score: fits ? r.score : r.score * 0.3, why: fits ? r.why : `${r.why} (المدة ${len.toFixed(1)} ث ما تناسب — length doesn't fit)` }
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
    .map((x) => ({ id: x.c.id, ar: x.c.ar, score: +x.score.toFixed(2), why: x.why, scenes: x.c.build(s, x.c.id).map((sc) => (pack ? dressScene(sc, pack) : sc)) }))
}

/** A sentence from plain text spread over [start, end] (no word times): even spacing. */
export function sentenceOf(text: string, start = 0, end = Math.max(1.5, text.split(/\s+/).length * 0.4)): Sentence {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  const step = (end - start) / Math.max(1, parts.length)
  return { text, start, end, words: parts.map((p, i) => ({ text: p, start: start + i * step, end: start + (i + 1) * step })) }
}
