import { z } from 'zod'

/**
 * The Arabic transcript of the voice (V1) and the script markup aligned to it. Pure (no Node, no
 * DOM): whisper.cpp output → `Transcript`; `script.md` → stress and pause `Marks` on its words.
 */

/** One spoken word: `i` = 0-based index, times in seconds, `p` = mean token probability. */
export interface TranscriptWord {
  i: number
  text: string
  start: number
  end: number
  p: number
}

export interface Transcript {
  version: 1
  media: string
  /** sha1 of the audio that was transcribed. */
  sourceHash: string
  /** Model file name, e.g. `ggml-large-v3-turbo-q5_0.bin`. */
  model: string
  language: 'ar'
  words: TranscriptWord[]
}

const wordSchema = z
  .object({
    // Re-assigned from the sorted order; any input value is accepted.
    i: z.number().int().nonnegative().optional(),
    text: z.string().min(1),
    start: z.number().finite().nonnegative(),
    end: z.number().finite(),
    p: z.number().min(0).max(1),
  })
  .refine((w) => w.start < w.end, { message: 'start must be before end' })

const transcriptSchema = z.object({
  version: z.literal(1),
  media: z.string().min(1),
  sourceHash: z.string(),
  model: z.string().min(1),
  language: z.literal('ar'),
  words: z.array(wordSchema),
})

/** Seconds rounded to the millisecond. */
const ms = (t: number) => Math.round(t * 1000) / 1000

/** Shortest word kept when clamping pushes a word's start onto its end. */
const MIN_WORD_SEC = 0.01

/**
 * Validates a transcript (Arabic-first errors), sorts words by start (then end), re-indexes them
 * and clamps overlaps: a word that overlaps the next one ends where the next starts; a word that
 * starts together with (or before) the previous one is pushed after it.
 */
export function parseTranscript(json: unknown): Transcript {
  const r = transcriptSchema.safeParse(json)
  if (!r.success) {
    const issue = r.error.issues[0]!
    throw new Error(`ملف التفريغ غير صالح — Invalid transcript: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  const sorted = r.data.words.map((w) => ({ ...w })).sort((a, b) => a.start - b.start || a.end - b.end)
  const words: TranscriptWord[] = []
  for (const w of sorted) {
    const prev = words.at(-1)
    // Compared after rounding, so rounding can never re-create an overlap.
    let start = ms(w.start)
    let end = ms(w.end)
    if (prev && start < prev.end) {
      if (start > prev.start) prev.end = start
      else start = prev.end
    }
    if (end <= start) end = ms(start + MIN_WORD_SEC)
    words.push({ i: words.length, text: w.text, start, end, p: w.p })
  }
  return { ...r.data, words }
}

// ---------------------------------------------------------------------------------------------
// whisper.cpp `--output-json-full` (with `--max-len 1 --split-on-word`: one word per segment)

interface WhisperToken {
  text?: string
  p?: number
}
interface WhisperSegment {
  offsets?: { from?: number; to?: number }
  text?: string
  tokens?: WhisperToken[]
}

/** Special tokens: `[_BEG_]`, `[_TT_123]`, `[_SOT_]`, `<|endoftext|>`, … */
const SPECIAL = /\[_[A-Z]+_?\d*\]|<\|[^|]*\|>/g
const SPECIAL_ONLY = /^\s*(?:\[_[A-Z]+_?\d*\]|<\|[^|]*\|>)\s*$/

/**
 * Words from whisper.cpp JSON: one per segment (text trimmed, special tokens removed; the segment
 * text is used because a token can hold half a UTF-8 sequence), times from `offsets` (ms → s),
 * `p` = mean probability of the non-special tokens. Segments with no letters or digits are skipped.
 */
export function wordsFromWhisper(json: unknown): TranscriptWord[] {
  const segs = (json as { transcription?: unknown })?.transcription
  if (!Array.isArray(segs)) {
    throw new Error('مخرجات whisper.cpp غير صالحة — whisper.cpp output has no transcription[] array')
  }
  const words: TranscriptWord[] = []
  for (const s of segs as WhisperSegment[]) {
    const text = (s.text ?? '').replace(SPECIAL, '').trim()
    // Punctuation-only segments (whisper sometimes emits a lone `.` or `،`) are not words.
    if (!normalizeAr(text)) continue
    const from = Number(s.offsets?.from)
    const to = Number(s.offsets?.to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    const ps = (s.tokens ?? [])
      .filter((t) => !SPECIAL_ONLY.test(t.text ?? ''))
      .map((t) => t.p)
      .filter((p): p is number => typeof p === 'number' && Number.isFinite(p))
    const p = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0
    const start = from / 1000
    const end = Math.max(to / 1000, start + MIN_WORD_SEC)
    words.push({ i: words.length, text, start: ms(start), end: ms(end), p: Math.min(1, Math.max(0, p)) })
  }
  return words
}

/** A validated `Transcript` from whisper.cpp JSON. */
export function transcriptFromWhisper(json: unknown, meta: { media: string; sourceHash: string; model: string }): Transcript {
  return parseTranscript({ version: 1, ...meta, language: 'ar', words: wordsFromWhisper(json) })
}

// ---------------------------------------------------------------------------------------------
// Normalization

const HARAKAT = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g

/** Unicode format characters (RLM, LRM, ALM, ZWNJ, ZWJ, …): invisible, never part of a word. */
const FORMAT = /\p{Cf}/gu

/**
 * Arabic text for comparison: format characters, harakat, Quranic marks and tatweel removed;
 * أإآٱ→ا, ى→ي, ة→ه, ؤ→و, ئ→ي; a hamza ending a word dropped (شيء→شي, fix wave I2); Arabic-Indic
 * digits → ASCII; punctuation and symbols removed; spaces collapsed.
 */
export function normalizeAr(s: string): string {
  return s
    .normalize('NFC')
    .replace(FORMAT, '')
    .replace(HARAKAT, '')
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064A')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/\u0621(?= |$)/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Number words (normalized, `normalizeAr`) → their value (fix wave I2): the script says
 * «ثلاثمية» where whisper writes 300. Units, tens, hundreds (مية/مئة, ميتين, ثلاثمية … تسعمية),
 * thousands (ألف, ألفين), with and without the article.
 */
const NUMBER_WORDS: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>()
  const add = (v: number, ...ws: string[]) => {
    for (const w of ws) {
      const n = normalizeAr(w)
      m.set(n, v)
      m.set(`ال${n}`, v)
    }
  }
  add(0, 'صفر')
  add(1, 'واحد', 'واحدة')
  add(2, 'اثنين', 'اثنان', 'اتنين', 'ثنين', 'تنين')
  add(3, 'ثلاث', 'ثلاثة', 'تلات', 'تلاتة')
  add(4, 'أربع', 'أربعة')
  add(5, 'خمس', 'خمسة')
  add(6, 'ست', 'ستة')
  add(7, 'سبع', 'سبعة')
  add(8, 'ثمان', 'ثماني', 'ثمانية', 'تمن', 'تمانية')
  add(9, 'تسع', 'تسعة')
  add(10, 'عشر', 'عشرة')
  add(20, 'عشرين', 'عشرون')
  add(30, 'ثلاثين', 'ثلاثون', 'تلاتين')
  add(40, 'أربعين', 'أربعون')
  add(50, 'خمسين', 'خمسون')
  add(60, 'ستين', 'ستون')
  add(70, 'سبعين', 'سبعون')
  add(80, 'ثمانين', 'ثمانون', 'تمانين')
  add(90, 'تسعين', 'تسعون')
  add(100, 'مية', 'مئة', 'مائة', 'ميه')
  add(200, 'ميتين', 'مئتين', 'مئتان', 'مائتين', 'مائتان')
  const hundreds: [number, string[]][] = [
    [300, ['ثلاثمية', 'ثلاثمئة', 'ثلاثمائة', 'تلتمية']],
    [400, ['أربعمية', 'أربعمئة', 'أربعمائة', 'ربعمية']],
    [500, ['خمسمية', 'خمسمئة', 'خمسمائة']],
    [600, ['ستمية', 'ستمئة', 'ستمائة']],
    [700, ['سبعمية', 'سبعمئة', 'سبعمائة']],
    [800, ['ثمانمية', 'ثمانمئة', 'ثمانمائة', 'تمنمية']],
    [900, ['تسعمية', 'تسعمئة', 'تسعمائة']],
  ]
  for (const [v, ws] of hundreds) add(v, ...ws)
  add(1000, 'ألف')
  add(2000, 'ألفين', 'ألفان')
  return m
})()

/** The value of one spoken number word (any spelling in NUMBER_WORDS), or null. */
export function numberWordValue(token: string): number | null {
  return NUMBER_WORDS.get(normalizeAr(token)) ?? null
}

/** A word's key for alignment: its normalized text, a number word as its digits (ثلاثمية ↔ 300). */
function alignKey(token: string): string {
  const n = normalizeAr(token)
  const v = NUMBER_WORDS.get(n)
  return v !== undefined ? String(v) : n
}

// ---------------------------------------------------------------------------------------------
// Script markup

/**
 * A spoken word, a pause, or (R11) a `# ` section title (not spoken). `stop` (critic round 2): the
 * word ends a sentence in the script (`.` `؟` `?` `!` `؛` after it).
 */
export type ScriptToken = { text: string; stress: boolean; stop?: true } | { pause: true } | { section: string }

/** Punctuation after a word that ends a sentence. */
const SENTENCE_END = /[.!?؟؛]["'»”)\]]*$/u

/** A section title line: `# ` then the title (Markdown level-1 heading). */
const SECTION_LINE = /^\s*#\s+(.*\S)\s*$/

const PAUSE = '\u0000P'
const EDGE_PUNCT = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu

const OPEN = String.fromCharCode(0) + 'O'
const CLOSE = String.fromCharCode(0) + 'C'

/**
 * Tokens of a script, line by line:
 * - `*…*` or `**…**` stresses every word inside. A star run opens a span only when a non-space
 *   follows it and closes one only when a non-space precedes it; other stars are ignored. A span
 *   never crosses a line end: an unclosed span ends there and a warning (Arabic first) is pushed to
 *   `o.warnings`.
 * - A bullet marker at the start of a line (`* `, `- `, `+ `) is ignored.
 * - `«...»`, `...` (three or more dots) and `…` are pauses (repeats collapse into one).
 * - R11: a line starting with `# ` is a section title, not spoken: one `{ section }` token (its
 *   text with format characters and stars removed); `alignScript` aligns it to the next spoken word.
 * Punctuation around a word and format characters are removed (harakat are kept); tokens that are
 * only punctuation (Markdown `#`, `-`) are skipped.
 */
export function parseScript(text: string, o: { warnings?: string[] } = {}): ScriptToken[] {
  const out: ScriptToken[] = []
  text.split(/\r?\n/).forEach((rawLine, n) => {
    const heading = SECTION_LINE.exec(rawLine.replace(FORMAT, ''))
    if (heading) {
      const title = heading[1]!.replace(/\*+/g, '').replace(/\s+/g, ' ').trim()
      if (normalizeAr(title)) out.push({ section: title })
      return
    }
    const line = rawLine.replace(FORMAT, '').replace(/^\s*[*+-]\s+/, '')
    let marked = ''
    let open = false
    let last = 0
    for (const m of line.matchAll(/\*+/g)) {
      const i = m.index
      const before = line[i - 1]
      const after = line[i + m[0].length]
      marked += line.slice(last, i)
      last = i + m[0].length
      if (!open && after !== undefined && !/\s/.test(after)) {
        marked += ` ${OPEN} `
        open = true
      } else if (open && before !== undefined && !/\s/.test(before)) {
        marked += ` ${CLOSE} `
        open = false
      } else {
        marked += ' '
      }
    }
    marked += line.slice(last)
    if (open) {
      o.warnings?.push(`علامة التشديد * غير مغلقة في السطر ${n + 1} — Unclosed * stress on line ${n + 1} (ends at the line end): ${rawLine.trim()}`)
    }
    marked = marked.replace(/«\s*(?:\.{2,}|…)+\s*»/g, ` ${PAUSE} `).replace(/\.{3,}|…/g, ` ${PAUSE} `)
    let stress = false
    for (const raw of marked.split(/\s+/)) {
      if (!raw) continue
      if (raw === OPEN || raw === CLOSE) {
        stress = raw === OPEN
        continue
      }
      if (raw === PAUSE) {
        const prev = out.at(-1)
        if (!prev || !('pause' in prev)) out.push({ pause: true })
        continue
      }
      if (!normalizeAr(raw)) {
        // A full stop split from its word (`*فلوس*.`) still ends that word's sentence.
        const prev = out.at(-1)
        if (prev && 'text' in prev && SENTENCE_END.test(raw)) prev.stop = true
        continue
      }
      out.push({ text: raw.replace(EDGE_PUNCT, ''), stress, ...(SENTENCE_END.test(raw) ? { stop: true as const } : {}) })
    }
  })
  return out
}

/** Longest `--prompt` given to whisper.cpp (characters): its prompt holds about 224 tokens. */
export const PROMPT_MAX_CHARS = 400

/**
 * Fix wave M3: the spoken words of a script (section titles, stars and pause marks removed) as one
 * line for whisper.cpp's `--prompt`, cut at a word to PROMPT_MAX_CHARS.
 */
export function scriptPrompt(text: string): string {
  let out = ''
  for (const t of parseScript(text)) {
    if (!('text' in t)) continue
    const next = out ? `${out} ${t.text}` : t.text
    if ([...next].length > PROMPT_MAX_CHARS) break
    out = next
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Alignment

export interface Marks {
  /** Transcript indices of stressed words, ascending. */
  stress: number[]
  /** `after` = transcript index of the word before the pause, `at` = its end, `gap` = silence until the next word (0 after the last). */
  pauses: { after: number; at: number; gap: number }[]
  /** Script words that were not found in the transcript, in script order. */
  unmatched: string[]
  /**
   * R11: `# ` section titles of the script, each at the transcript index of the next matched
   * spoken word (ascending; a title with no matched word after it is dropped). Absent in marks
   * written before Task 10 (`parseMarks` fills `[]`).
   */
  sections?: { title: string; word: number }[]
  /**
   * Fix wave I2: the script's spelling of transcript words, by transcript index (ascending): every
   * aligned word, and inside an unaligned stretch with as many script words as transcript words,
   * each in turn (whisper heard «علك» for «علّق»). The recipe shows these instead of what whisper
   * wrote. Absent in marks written before the fix wave (`parseMarks` fills `[]`).
   */
  display?: { word: number; text: string }[]
  /**
   * Critic round 2: transcript indices of matched words that end a sentence in the script, so the
   * recipe never runs one on-screen chunk across a full stop. Absent before (`parseMarks` fills []).
   */
  stops?: number[]
}

/** Levenshtein distance on code points. */
function editDistance(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  let row = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const next = [i]
    for (let j = 1; j <= y.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1))
    }
    row = next
  }
  return row[y.length]!
}

/** 2 = equal, 1 = edit distance ≤ 1 with both at least 4 letters, 0 = no match. */
function matchScore(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 2
  if ([...a].length >= 4 && [...b].length >= 4 && editDistance(a, b) <= 1) return 1
  return 0
}

const GAP = -1

/**
 * Global (Needleman–Wunsch) alignment of the script's words to the transcript's words on
 * `normalizeAr` text (number words as digits). A pair aligns only when it matches (equal, or one
 * edit apart for words of four letters or more); anything else is a gap. An unaligned stretch with
 * as many words on both sides is paired word by word (I2). Stressed script words give their
 * transcript index; a pause attaches to the last matched word before it; script words left
 * unmatched are listed; `display` gives the script's spelling of every matched transcript word.
 */
export function alignScript(script: ScriptToken[], words: TranscriptWord[]): Marks {
  const sw = script.flatMap((t, k) => ('text' in t ? [{ k, text: t.text, stress: t.stress, n: alignKey(t.text) }] : []))
  const tw = words.map((w) => alignKey(w.text))
  const R = sw.length
  const C = tw.length
  // score[i][j]: best alignment of sw[0..i) and tw[0..j).
  const score: number[][] = Array.from({ length: R + 1 }, () => new Array<number>(C + 1).fill(0))
  for (let i = 1; i <= R; i++) score[i]![0] = i * GAP
  for (let j = 1; j <= C; j++) score[0]![j] = j * GAP
  for (let i = 1; i <= R; i++) {
    for (let j = 1; j <= C; j++) {
      const m = matchScore(sw[i - 1]!.n, tw[j - 1]!)
      const diag = m > 0 ? score[i - 1]![j - 1]! + m : -Infinity
      score[i]![j] = Math.max(diag, score[i - 1]![j]! + GAP, score[i]![j - 1]! + GAP)
    }
  }
  // Traceback: script word index → transcript index (or -1).
  const map = new Array<number>(R).fill(-1)
  for (let i = R, j = C; i > 0 || j > 0; ) {
    if (i > 0 && j > 0) {
      const m = matchScore(sw[i - 1]!.n, tw[j - 1]!)
      if (m > 0 && score[i]![j] === score[i - 1]![j - 1]! + m) {
        map[i - 1] = j - 1
        i--
        j--
        continue
      }
    }
    if (i > 0 && score[i]![j] === score[i - 1]![j]! + GAP) i--
    else j--
  }

  // I2: an unaligned stretch between two aligned pairs (or an end) with as many script words as
  // transcript words: the same words, misheard; pair them in order.
  for (let x = 0; x < R; ) {
    if (map[x]! >= 0) {
      x++
      continue
    }
    let y = x
    while (y < R && map[y]! < 0) y++
    const jFrom = x > 0 ? map[x - 1]! + 1 : 0
    const jTo = y < R ? map[y]! : C
    if (jTo - jFrom === y - x) for (let q = 0; q < y - x; q++) map[x + q] = jFrom + q
    x = y
  }

  const display: NonNullable<Marks['display']> = []
  sw.forEach((w, x) => {
    if (map[x]! >= 0) display.push({ word: map[x]!, text: w.text })
  })
  display.sort((a, b) => a.word - b.word)

  const byToken = new Map<number, number>()
  sw.forEach((w, x) => byToken.set(w.k, map[x]!))
  const stress = new Set<number>()
  const unmatched: string[] = []
  const pauses: Marks['pauses'] = []
  const sections: NonNullable<Marks['sections']> = []
  let pendingSections: string[] = []
  let lastMatched = -1
  for (let k = 0; k < script.length; k++) {
    const t = script[k]!
    if ('section' in t) {
      pendingSections.push(t.section)
      continue
    }
    if ('pause' in t) {
      if (lastMatched < 0 || pauses.at(-1)?.after === lastMatched) continue
      const at = words[lastMatched]!.end
      const next = words[lastMatched + 1]
      pauses.push({ after: lastMatched, at, gap: next ? ms(Math.max(0, next.start - at)) : 0 })
      continue
    }
    const idx = byToken.get(k)!
    if (idx < 0) {
      unmatched.push(t.text)
      continue
    }
    lastMatched = idx
    if (t.stress) stress.add(idx)
    // Titles waiting for a word: the last one wins when several land on the same word.
    if (pendingSections.length) {
      const title = pendingSections.at(-1)!
      if (sections.at(-1)?.word === idx) sections[sections.length - 1] = { title, word: idx }
      else if (!(idx < (sections.at(-1)?.word ?? -1))) sections.push({ title, word: idx })
      pendingSections = []
    }
  }
  const stops = [...new Set(script.flatMap((t, k) => ('text' in t && t.stop && byToken.get(k)! >= 0 ? [byToken.get(k)!] : [])))].sort((a, b) => a - b)
  return { stress: [...stress].sort((a, b) => a - b), pauses, unmatched, sections, display, stops }
}

/**
 * Re-review of the final fix wave (I3): the identity of a transcript's WORDS (index, text, start,
 * end), independent of the audio's `sourceHash`. Re-transcribing the same audio (another model, a
 * `--prompt`) keeps `sourceHash` and often the word count, yet moves words or changes spellings;
 * `edit.json` records this hash so `transcriptWarnings` can tell. FNV-1a (two 32-bit lanes with
 * different offsets) over the words: pure, DOM-free, the same in Node and the page.
 */
export function transcriptHash(t: Pick<Transcript, 'words'>): string {
  const lanes = [0x811c9dc5, 0x01000193 ^ 0x811c9dc5]
  const text = t.words.map((w) => `${w.i}\u0001${w.text}\u0001${w.start}\u0001${w.end}`).join('\u0002')
  const out: string[] = []
  for (const seed of lanes) {
    let h = seed >>> 0
    for (let k = 0; k < text.length; k++) {
      h ^= text.charCodeAt(k)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    out.push(h.toString(16).padStart(8, '0'))
  }
  return out.join('')
}

/** Spellings of 100 that also mean water («مية» / «ميه»): a number only in a counting context (R28). */
const AMBIGUOUS_HUNDRED: ReadonlySet<string> = new Set(['مية', 'ميه'])
/**
 * Stems of nouns a spoken number counts (normalized, article stripped): «مية ساعة» is a number,
 * «تشرب مية» is water. Our own list; extend as real scripts show more.
 */
export const UNIT_STEMS: readonly string[] = [
  'ساع', 'يوم', 'سنه', 'شهر', 'دقيق', 'ثاني', 'اسبوع', 'ريال', 'دولار', 'دينار', 'درهم', 'جنيه', 'مره', 'شخص', 'نسخ', 'فيديو',
  'كلم', 'الف', 'مليون', 'بالمي', 'متابع', 'مشاهد', 'عميل', 'درج', 'خطو', 'مشروع', 'طلب', 'صفح', 'منشور', 'رسال', 'مقطع', 'صور',
]
const MARKS_ONLY = /[ً-ْٰـ]/gu
const ARTICLE = /^(?:ال|لل|بال|وال|كال|فال)/u

function isUnitNoun(word: string): boolean {
  const n = normalizeAr(word).replace(ARTICLE, '')
  return UNIT_STEMS.some((s) => n.startsWith(s))
}

/**
 * R28: a spelled number starting at `words[k]`: the first number word (value ≥ `min`) plus any
 * following words «و» + number word of a strictly smaller magnitude («ألف وخمسمية وخمسين» = 1550,
 * count 3; «خمسمية وألف» stops at 500). A bare «مية» / «ميه» counts only before a unit noun or
 * another number word, so «تشرب مية كثير» is water, not 100. Digits are not its business (null).
 */
export function spelledNumberAt(words: readonly string[], k: number, min: number = 100): { value: number; count: number } | null {
  const first = words[k]
  if (first === undefined) return null
  const v0 = numberWordValue(first)
  if (v0 === null || v0 < min) return null
  const mag = (v: number) => Math.floor(Math.log10(v))
  let value = v0
  let last = v0
  let count = 1
  for (let j = k + 1; j < words.length; j++) {
    const n = normalizeAr(words[j]!)
    if (n.length < 2 || !n.startsWith('و')) break
    const v = NUMBER_WORDS.get(n.slice(1))
    if (v === undefined || mag(v) >= mag(last)) break
    value += v
    last = v
    count++
  }
  const bare = first.replace(MARKS_ONLY, '').replace(ARTICLE, '')
  if (count === 1 && AMBIGUOUS_HUNDRED.has(bare)) {
    const next = words[k + 1]
    if (next === undefined || !isUnitNoun(next)) return null
  }
  return { value, count }
}
