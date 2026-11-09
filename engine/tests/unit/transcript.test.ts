import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  alignScript,
  normalizeAr,
  numberWordValue,
  parseScript,
  parseTranscript,
  transcriptFromWhisper,
  wordsFromWhisper,
  type TranscriptWord,
} from '../../src/core/transcript'

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/whisper-ar.json', import.meta.url)), 'utf8'))
const META = { media: 'm1', sourceHash: 'a'.repeat(40), model: 'ggml-large-v3-turbo-q5_0.bin' }

/** Transcript words from plain texts: 0.5 s each, back to back. */
const spoken = (texts: string[], gaps: Record<number, number> = {}): TranscriptWord[] => {
  let t = 0
  return texts.map((text, i) => {
    const w = { i, text, start: t, end: t + 0.5, p: 0.9 }
    t += 0.5 + (gaps[i] ?? 0)
    return w
  })
}

describe('normalizeAr', () => {
  it('strips harakat and unifies alef forms', () => {
    expect(normalizeAr('إِسْتِثْمَارٌ')).toBe(normalizeAr('استثمار'))
    expect(normalizeAr('إِسْتِثْمَارٌ')).toBe('استثمار')
  })
  it('maps Arabic-Indic digits to ASCII and strips punctuation', () => {
    expect(normalizeAr('٣٠٪')).toBe('30')
    expect(normalizeAr('۱۲')).toBe('12')
    expect(normalizeAr('الذكي،')).toBe('الذكي')
  })
  it('unifies taa marbuta, alef maqsura, hamza seats and tatweel', () => {
    expect(normalizeAr('مدرسة')).toBe(normalizeAr('مدرسه'))
    expect(normalizeAr('على')).toBe('علي')
    expect(normalizeAr('مؤمن')).toBe('مومن')
    expect(normalizeAr('رئيس')).toBe('رييس')
    expect(normalizeAr('جمـــيل')).toBe('جميل')
    expect(normalizeAr('ٱلله')).toBe(normalizeAr('الله'))
    expect(normalizeAr('آمن')).toBe('امن')
  })
  it('I2: drops a hamza that ends a word (شيء = شي), not one inside it', () => {
    expect(normalizeAr('شيء')).toBe('شي')
    expect(normalizeAr('كل شيء؟ جميل')).toBe('كل شي جميل')
    expect(normalizeAr('سماء')).toBe('سما')
    expect(normalizeAr('مساءلة')).toBe('مساءله')
  })
  it('I2: number words have a value (ثلاثمية = ثلاثمئة = 300)', () => {
    expect(numberWordValue('ثلاثمية')).toBe(300)
    expect(numberWordValue('ثلاثمئة')).toBe(300)
    expect(numberWordValue('الألف')).toBe(1000)
    expect(numberWordValue('عشرين')).toBe(20)
    expect(numberWordValue('ساعة')).toBeNull()
  })
})

describe('alignScript on the real v1-voice recording (fix wave I2)', () => {
  const dir = new URL('../fixtures/v1-voice/', import.meta.url)
  const t = parseTranscript(JSON.parse(readFileSync(fileURLToPath(new URL('transcript.json', dir)), 'utf8')))
  const marks = alignScript(parseScript(readFileSync(fileURLToPath(new URL('script.md', dir)), 'utf8')), t.words)
  const shown = (k: number) => marks.display!.find((d) => d.word === k)?.text

  it('every script word is matched or paired: ثلاثمية ↔ 300, شي ↔ شيء, علّق ↔ علك', () => {
    expect(marks.unmatched).toEqual([])
    expect(t.words[11]!.text).toBe('300')
    expect(shown(11)).toBe('ثلاثمية')
    expect(t.words[38]!.text).toBe('شيء')
    expect(shown(38)).toBe('شي')
    expect(t.words[43]!.text).toBe('علك')
    expect(shown(43)).toBe('علّق')
  })
  it('critic round 2: sentence ends of the script are marked on the transcript (stops)', () => {
    // «أسبوع؟» 5, «مكرر.» 17, «فلوس.» 20, «بالعربي،» no, «بسيط.» 26, «السكربت.» 29, «صوتك.» 32, «وبسرعة.» 40, «تجربها؟» 42, «لك.» 47
    expect(marks.stops).toEqual([5, 17, 20, 26, 29, 32, 40, 42, 47])
  })
  it('the script spelling replaces whisper’s: السكربت, سجّل, تحرّك, تضيّع', () => {
    expect(shown(29)).toBe('السكربت')
    expect(shown(31)).toBe('سجّل')
    expect(shown(36)).toBe('تحرّك')
    expect(shown(0)).toBe('تضيّع')
    expect(marks.display).toHaveLength(t.words.length)
    expect(marks.stress).toEqual([1, 20, 45])
  })
})

describe('parseScript', () => {
  it('stars stress every word inside; «...» is one pause', () => {
    expect(parseScript('هذا *مهم جداً* «...» ثم')).toEqual([
      { text: 'هذا', stress: false },
      { text: 'مهم', stress: true },
      { text: 'جداً', stress: true },
      { pause: true },
      { text: 'ثم', stress: false },
    ])
  })
  it('... and … are pauses, also when attached to a word', () => {
    expect(parseScript('أولًا... ثانيًا… ثالثًا')).toEqual([
      { text: 'أولًا', stress: false },
      { pause: true },
      { text: 'ثانيًا', stress: false },
      { pause: true },
      { text: 'ثالثًا', stress: false },
    ])
  })
  it('skips punctuation-only tokens and trims punctuation around words', () => {
    expect(parseScript('#عنوان\n\nكلمة، - أخرى.')).toEqual([
      { text: 'عنوان', stress: false },
      { text: 'كلمة', stress: false },
      { text: 'أخرى', stress: false, stop: true },
    ])
  })
  it('critic round 2: a word followed by . ؟ ? ! ؛ ends a sentence (stop); a comma does not', () => {
    const ts = parseScript('مكرر. والوقت هذا ... *فلوس*.\nتبي تجربها؟ علّق، كلمة!')
    expect(ts.filter((t) => 'text' in t && t.stop).map((t) => ('text' in t ? t.text : ''))).toEqual(['مكرر', 'فلوس', 'تجربها', 'كلمة'])
  })
})

describe('parseScript: Markdown-safe stress', () => {
  const RLM = String.fromCharCode(0x200f)
  const words = (ts: ReturnType<typeof parseScript>) => ts.flatMap((t) => ('text' in t ? [[t.text, t.stress]] : []))

  it('bullet markers are ignored, never stress', () => {
    const warnings: string[] = []
    expect(words(parseScript('* أولا\n* ثانيا\n* ثالثا\n- رابعا\n+ خامسا', { warnings }))).toEqual([
      ['أولا', false],
      ['ثانيا', false],
      ['ثالثا', false],
      ['رابعا', false],
      ['خامسا', false],
    ])
    expect(warnings).toEqual([])
  })
  it('**bold** stresses like *…*', () => {
    expect(words(parseScript('**مهم** ثم *جدا* و'))).toEqual([
      ['مهم', true],
      ['ثم', false],
      ['جدا', true],
      ['و', false],
    ])
  })
  it('a star between spaces is ignored', () => {
    expect(words(parseScript('ثلاثة * أربعة'))).toEqual([
      ['ثلاثة', false],
      ['أربعة', false],
    ])
  })
  it('an unclosed span ends at the line end and is reported, Arabic first', () => {
    const warnings: string[] = []
    expect(words(parseScript('أ *مهم جدا\nثم', { warnings }))).toEqual([
      ['أ', false],
      ['مهم', true],
      ['جدا', true],
      ['ثم', false],
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^[\u0600-\u06FF]/)
    expect(warnings[0]).toMatch(/line 1/)
  })
  it('a span never crosses a newline', () => {
    const warnings: string[] = []
    expect(words(parseScript('*مهم\nجدا* ثم', { warnings }))).toEqual([
      ['مهم', true],
      ['جدا', false],
      ['ثم', false],
    ])
    expect(warnings).toHaveLength(1)
  })
  it('format characters (RLM) are stripped: *عن‏* still matches and stays stressed', () => {
    expect(normalizeAr(`عن${RLM}`)).toBe('عن')
    const script = parseScript(`اليوم سنتكلم *عن${RLM}* الاستثمار`)
    expect(script[2]).toEqual({ text: 'عن', stress: true })
    const marks = alignScript(script, spoken(['اليوم', 'سنتكلم', 'عن', 'الاستثمار']))
    expect(marks.stress).toEqual([2])
    expect(marks.unmatched).toEqual([])
  })
})

describe('parseScript: # section titles (R11)', () => {
  it('a `# ` line is one section token, not spoken words; stars and edge spaces dropped', () => {
    expect(parseScript('# المقدمة\nاليوم نتكلم\n  #  *الخطوة* الأولى  \nأولا')).toEqual([
      { section: 'المقدمة' },
      { text: 'اليوم', stress: false },
      { text: 'نتكلم', stress: false },
      { section: 'الخطوة الأولى' },
      { text: 'أولا', stress: false },
    ])
  })
  it('`##` and `#word` are not section lines; a bare `#` is skipped', () => {
    expect(parseScript('## فرعي\n#\nكلمة')).toEqual([
      { text: 'فرعي', stress: false },
      { text: 'كلمة', stress: false },
    ])
  })
  it('alignScript aligns each title to the next matched spoken word', () => {
    const words = spoken(['اليوم', 'سنتكلم', 'عن', 'الاستثمار', 'الذكي'])
    const marks = alignScript(parseScript('# البداية\nاليوم سنتكلم\n# الموضوع\nكلمةغائبة عن الاستثمار\n# النهاية'), words)
    expect(marks.sections).toEqual([
      { title: 'البداية', word: 0 },
      { title: 'الموضوع', word: 2 },
    ])
    expect(marks.unmatched).toEqual(['كلمةغائبة'])
  })
  it('two titles before the same word: the last one wins', () => {
    const marks = alignScript(parseScript('# أ\n# ب\nاليوم'), spoken(['اليوم']))
    expect(marks.sections).toEqual([{ title: 'ب', word: 0 }])
  })
})

describe('alignScript', () => {
  const words = spoken(['اليوم', 'سنتكلم', 'عن', 'الاستثمار', 'الذكي'], { 3: 0.4 })

  it('maps stress and pauses to transcript indices (fuzzy and normalized matches)', () => {
    const marks = alignScript(parseScript('اليوم نتكلم عن *الإستثمار* «...» الذكي'), words)
    expect(marks.stress).toEqual([3])
    expect(marks.pauses).toHaveLength(1)
    expect(marks.pauses[0]!.after).toBe(3)
    expect(marks.pauses[0]!.at).toBeCloseTo(words[3]!.end)
    expect(marks.pauses[0]!.gap).toBeCloseTo(0.4)
    expect(marks.unmatched).toEqual([])
  })
  it('reports a script word that was not spoken', () => {
    const marks = alignScript(parseScript('اليوم نتكلم عن *الإستثمار* جدا «...» الذكي'), words)
    expect(marks.unmatched).toEqual(['جدا'])
    expect(marks.stress).toEqual([3])
    expect(marks.pauses[0]!.after).toBe(3)
  })
  it('keeps transcript indices when a spoken word is missing from the script', () => {
    const marks = alignScript(parseScript('اليوم نتكلم *الإستثمار* «...» الذكي'), words)
    expect(marks.stress).toEqual([3])
    expect(marks.pauses[0]!.after).toBe(3)
    expect(marks.unmatched).toEqual([])
  })
  it('does not fuzzy-match short words', () => {
    // Two script words against one spoken word: no 1:1 pairing either (I2).
    const marks = alignScript(parseScript('اليوم سنتكلم من جدا الاستثمار الذكي'), words)
    expect(marks.unmatched).toEqual(['من', 'جدا'])
    expect(marks.display!.map((d) => d.word)).toEqual([0, 1, 3, 4])
  })
  it('I2: an unmatched stretch with as many words on both sides is paired 1:1 and shown as the script spells it', () => {
    const marks = alignScript(parseScript('اليوم سنتكلم *من* الاستثمار الذكي'), words)
    expect(marks.unmatched).toEqual([])
    expect(marks.stress).toEqual([2])
    expect(marks.display).toEqual([
      { word: 0, text: 'اليوم' },
      { word: 1, text: 'سنتكلم' },
      { word: 2, text: 'من' },
      { word: 3, text: 'الاستثمار' },
      { word: 4, text: 'الذكي' },
    ])
  })
  it('a pause after the last word has gap 0; a pause before any match is dropped', () => {
    const marks = alignScript(parseScript('«...» اليوم سنتكلم عن الاستثمار الذكي…'), words)
    expect(marks.pauses).toEqual([{ after: 4, at: words[4]!.end, gap: 0 }])
  })
})

describe('whisper.cpp output', () => {
  it('reads one word per segment, dropping special tokens', () => {
    const w = wordsFromWhisper(FIXTURE)
    expect(w).toHaveLength(12)
    expect(w[0]).toMatchObject({ text: 'اليوم', start: 0, end: 0.52 })
    // [_BEG_] is not counted in the mean probability.
    expect(w[0]!.p).toBeCloseTo((0.97 + 0.99) / 2)
    expect(w.map((x) => x.text).join(' ')).toBe('اليوم سنتكلم عن الاستثمار الذكي، وكيف يغيّر حياتك تمامًا في 30 يومًا.')
  })
  it('skips punctuation-only segments', () => {
    const seg = (text: string, from: number, to: number) => ({ offsets: { from, to }, text, tokens: [{ text, p: 0.9 }] })
    const w = wordsFromWhisper({ transcription: [seg(' كلمة', 0, 400), seg(' .', 400, 450), seg(' ،', 450, 500), seg(' ثانية', 500, 900)] })
    expect(w.map((x) => [x.i, x.text])).toEqual([[0, 'كلمة'], [1, 'ثانية']])
  })
  it('parseTranscript of the fake output: 12 words, monotonic, overlap clamped', () => {
    const t = transcriptFromWhisper(FIXTURE, META)
    expect(t).toMatchObject({ version: 1, media: 'm1', language: 'ar', model: META.model })
    expect(t.words).toHaveLength(12)
    t.words.forEach((w, i) => {
      expect(w.i).toBe(i)
      expect(w.start).toBeLessThan(w.end)
      if (i > 0) expect(w.start).toBeGreaterThanOrEqual(t.words[i - 1]!.end)
    })
    // حياتك (3.86–4.42) overlapped تمامًا (from 4.34): its end is clamped to 4.34.
    expect(t.words[7]!.end).toBe(4.34)
    expect(t.words[8]!.start).toBe(4.34)
  })
})

describe('parseTranscript', () => {
  const base = { version: 1, language: 'ar', ...META }
  it('sorts, re-indexes and clamps overlaps', () => {
    const t = parseTranscript({
      ...base,
      words: [
        { i: 5, text: 'ب', start: 1, end: 2, p: 1 },
        { i: 9, text: 'أ', start: 0, end: 1.2, p: 1 },
        { i: 2, text: 'ج', start: 1, end: 1.5, p: 1 },
      ],
    })
    // By start, then end; a word starting with the previous one is pushed after it.
    expect(t.words.map((w) => [w.i, w.text])).toEqual([[0, 'أ'], [1, 'ج'], [2, 'ب']])
    expect(t.words[0]!.end).toBe(1)
    expect(t.words[2]).toMatchObject({ start: 1.5, end: 2 })
    for (let i = 1; i < 3; i++) {
      expect(t.words[i]!.start).toBeGreaterThanOrEqual(t.words[i - 1]!.end)
      expect(t.words[i]!.start).toBeLessThan(t.words[i]!.end)
    }
  })
  it('clamps after rounding to the millisecond', () => {
    const t = parseTranscript({
      ...base,
      words: [
        { i: 0, text: 'أ', start: 0, end: 2, p: 1 },
        { i: 1, text: 'ب', start: 1.2344, end: 3, p: 1 },
      ],
    })
    expect(t.words[0]).toMatchObject({ start: 0, end: 1.234 })
    expect(t.words[1]).toMatchObject({ start: 1.234, end: 3 })
    expect(t.words[1]!.start).toBeGreaterThanOrEqual(t.words[0]!.end)
  })
  it('refuses a word with start >= end, Arabic first', () => {
    expect(() => parseTranscript({ ...base, words: [{ i: 0, text: 'أ', start: 1, end: 1, p: 1 }] })).toThrow(/^[\u0600-\u06FF]/)
  })
  it('refuses a language other than ar', () => {
    expect(() => parseTranscript({ ...base, language: 'en', words: [] })).toThrow()
  })
})

import { spelledNumberAt } from '../../src/core/transcript'

describe('R28: spelled numbers across words, and «مية» that means water', () => {
  const at = (words: string, k = 0) => spelledNumberAt(words.split(' '), k)
  it('composes number words joined by و, in decreasing magnitude', () => {
    expect(at('ألف وخمسمية ريال')).toEqual({ value: 1500, count: 2 })
    expect(at('ثلاثمية وخمسين ساعة')).toEqual({ value: 350, count: 2 })
    expect(at('ألف وخمسمية وخمسين')).toEqual({ value: 1550, count: 3 })
    expect(at('ثلاثمية ساعة')).toEqual({ value: 300, count: 1 })
  })
  it('a rising magnitude or a non-number word ends the number', () => {
    expect(at('خمسمية وألف')).toEqual({ value: 500, count: 1 })
    expect(at('ثلاثمية في السنة')).toEqual({ value: 300, count: 1 })
  })
  it('bare «مية» / «ميه» (water) is a number only before a unit noun or another number word', () => {
    expect(at('تشرب مية كثير', 1)).toBeNull()
    expect(at('مية ساعة')).toEqual({ value: 100, count: 1 })
    expect(at('مية ريال')).toEqual({ value: 100, count: 1 })
    expect(at('مية وخمسين')).toEqual({ value: 150, count: 2 })
    expect(at('مئة كلمة')).toEqual({ value: 100, count: 1 })
    expect(at('ميه')).toBeNull()
  })
  it('below the counter floor and digits are not its business', () => {
    expect(at('عشرين ريال')).toBeNull()
    expect(at('300 ساعة')).toBeNull()
  })
})
