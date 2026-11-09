import { describe, it, expect } from 'vitest'
import { KEYWORDS_AR, matchKeywords, numberValue, stripClitics } from '../../src/core/keywords-ar'
import { ICON_NAMES, type IconName } from '../../src/core/params/icon'
import { LINE_ART_NAMES } from '../../src/core/params/line-art'
import type { TranscriptWord } from '../../src/core/transcript'

/** Words 0.4 s apart (or at the given starts). */
const said = (texts: string[], starts?: number[]): TranscriptWord[] =>
  texts.map((text, i) => {
    const start = starts?.[i] ?? i * 0.4
    return { i, text, start, end: start + 0.3, p: 0.9 }
  })

describe('stripClitics', () => {
  it('lists the token and its clitic-free forms, longest first, never below 2 letters', () => {
    expect(stripClitics('والمال')).toEqual(['والمال', 'المال', 'مال'])
    expect(stripClitics('للوقت')).toContain('وقت')
    expect(stripClitics('بالذكاء')[0]).toBe('بالذكا') // I2: a final hamza is dropped
    expect(stripClitics('بالذكاء')).toContain('ذكا')
    for (const c of stripClitics('وقت')) expect([...c].length).toBeGreaterThanOrEqual(2)
    expect(stripClitics('بل')).toEqual(['بل'])
  })
  it('normalizes first (harakat, taa marbuta, hamza forms)', () => {
    expect(stripClitics('السُّرعة')).toContain('سرعه')
    expect(stripClitics('فالأمان')).toContain('امان')
  })
})

describe('matchKeywords', () => {
  it('والمال → banknote', () => {
    expect(matchKeywords(said(['هذا', 'والمال']))).toEqual([{ word: 1, visual: { type: 'icon', icon: 'banknote' } }])
  })
  it('بالذكاء الاصطناعي → one hit on the first word, sparkles', () => {
    expect(matchKeywords(said(['نشتغل', 'بالذكاء', 'الاصطناعي', 'اليوم']))).toEqual([{ word: 1, visual: { type: 'icon', icon: 'sparkles' } }])
  })
  it('a stem of 3+ letters matches with a suffix: ساعتين → clock', () => {
    expect(matchKeywords(said(['ساعتين']))).toEqual([{ word: 0, visual: { type: 'icon', icon: 'clock' } }])
  })
  it('a number token → counter (Arabic-Indic or Latin digits)', () => {
    expect(matchKeywords(said(['٣٠٠']))).toEqual([{ word: 0, visual: { type: 'counter' } }])
    expect(matchKeywords(said(['1,500']))).toEqual([{ word: 0, visual: { type: 'counter' } }])
  })
  it('the same visual again within 3 s is dropped: وقت at 1.0 s and 2.5 s → one hit', () => {
    expect(matchKeywords(said(['وقت', 'ثم', 'وقت'], [1.0, 1.8, 2.5]))).toEqual([{ word: 0, visual: { type: 'icon', icon: 'clock' } }])
    // 3 s or more apart: both kept.
    expect(matchKeywords(said(['وقت', 'ثم', 'وقت'], [1.0, 2.0, 4.0]))).toHaveLength(2)
  })
  it('different numbers are different counters (never deduplicated)', () => {
    expect(matchKeywords(said(['٣', 'و', '٥']))).toHaveLength(2)
  })
  it('chart-up (line art) for growth, speed-lines for speed', () => {
    expect(matchKeywords(said(['النمو']))[0]!.visual).toEqual({ type: 'line-art', art: 'chart-up' })
    expect(matchKeywords(said(['بسرعة']))[0]!.visual).toEqual({ type: 'line-art', art: 'speed-lines' })
  })
  it('R: no hit on ambiguous words (verb حل, دول, دخل, ابدا, ثانية)', () => {
    expect(matchKeywords(said(['حل', 'الواجب']))).toEqual([])
    for (const w of ['دول', 'دخل', 'ابدا', 'أبداً', 'ثانية']) expect(matchKeywords(said([w])), w).toEqual([])
    expect(matchKeywords(said(['والحل']))[0]?.visual).toEqual({ type: 'icon', icon: 'check-circle' })
  })
  it('no false hit on unrelated words', () => {
    expect(matchKeywords(said(['كتب', 'الولد', 'بيته']))).toEqual([])
  })
})

describe('KEYWORDS_AR', () => {
  it('has about 30 entries, all with icons in ICON_NAMES and line art in LINE_ART_NAMES', () => {
    expect(KEYWORDS_AR.length).toBeGreaterThanOrEqual(25)
    for (const k of KEYWORDS_AR) {
      expect(k.stems.length).toBeGreaterThan(0)
      if (k.visual.type === 'icon') expect(ICON_NAMES).toContain(k.visual.icon as IconName)
      if (k.visual.type === 'line-art') expect(LINE_ART_NAMES).toContain(k.visual.art)
    }
  })
  it('covers the required words', () => {
    const v = (w: string) => matchKeywords(said([w]))[0]?.visual
    const icon = (icon: string) => ({ type: 'icon', icon })
    expect(v('فلوس')).toEqual(icon('banknote'))
    expect(v('ربح')).toEqual(icon('banknote'))
    expect(v('دقيقة')).toEqual(icon('clock'))
    expect(v('زيادة')).toEqual({ type: 'line-art', art: 'chart-up' })
    expect(v('ارتفاع')).toEqual({ type: 'line-art', art: 'chart-up' })
    expect(v('حماية')).toEqual(icon('lock'))
    expect(v('الخصوصية')).toEqual(icon('lock'))
    expect(v('سريع')).toEqual({ type: 'line-art', art: 'speed-lines' })
    expect(v('فكرة')).toEqual(icon('lightbulb'))
    expect(v('هدفك')).toEqual(icon('target'))
    expect(v('البيانات')).toEqual(icon('database'))
    expect(v('هاتفك')).toEqual(icon('smartphone'))
    expect(v('جوال')).toEqual(icon('smartphone'))
    expect(v('رسالة')).toEqual(icon('message-circle'))
    expect(v('العالم')).toEqual(icon('globe'))
    expect(v('المشكلة')).toEqual(icon('triangle-alert'))
    expect(v('الحل')).toEqual(icon('check-circle'))
    expect(v('الناس')).toEqual(icon('users'))
    expect(v('المستخدمين')).toEqual(icon('users'))
  })
})

describe('numberValue', () => {
  it('parses Arabic-Indic and Latin digits, thousands separators and decimals', () => {
    expect(numberValue('٣٠٠')).toBe(300)
    expect(numberValue('1,500')).toBe(1500)
    expect(numberValue('٢٫٥')).toBe(2.5)
    expect(numberValue('٪٤٠')).toBe(40)
    expect(numberValue('ساعة')).toBeNull()
  })
})
