import { describe, it, expect } from 'vitest'
import { frameCount, frameToTime } from '../../src/core/clock'
import { rng } from '../../src/core/rng'
import { splitWords, hasArabic } from '../../src/core/text'
import { FORMAT_SIZE, SAFE_AREA } from '../../src/core/types'

describe('core', () => {
  it('clock', () => {
    expect(frameCount(1.5, 30)).toBe(45)
    expect(frameToTime(45, 30)).toBeCloseTo(1.5)
  })
  it('rng is deterministic and in [0,1)', () => {
    const a = rng(7), b = rng(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    const c = rng(1)
    for (let i = 0; i < 1000; i++) { const v = c(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
  it('splitWords', () => {
    expect(splitWords('كيف أصمم موشن جرافيك بالذكاء الاصطناعي؟'))
      .toEqual(['كيف', 'أصمم', 'موشن', 'جرافيك', 'بالذكاء', 'الاصطناعي؟'])
    expect(splitWords('تحديث جديد من Gemini 3 اليوم'))
      .toEqual(['تحديث', 'جديد', 'من', 'Gemini', '3', 'اليوم'])
    expect(splitWords('مُحَمَّد  لا\nتفوّت')).toEqual(['مُحَمَّد', 'لا', 'تفوّت'])
    expect(splitWords('   ')).toEqual([])
  })
  it('hasArabic', () => {
    expect(hasArabic('Gemini')).toBe(false)
    expect(hasArabic('تحديث Gemini')).toBe(true)
  })
  it('format constants', () => {
    expect(FORMAT_SIZE['9:16']).toEqual({ w: 1080, h: 1920 })
    expect(FORMAT_SIZE['16:9']).toEqual({ w: 1920, h: 1080 })
    expect(FORMAT_SIZE['1:1']).toEqual({ w: 1080, h: 1080 })
    expect(FORMAT_SIZE['4:5']).toEqual({ w: 1080, h: 1350 })
    expect(SAFE_AREA['9:16']).toEqual({ top: 0.14, bottom: 0.22, left: 0.06, right: 0.12 })
    expect(SAFE_AREA['16:9']).toEqual({ top: 0.06, bottom: 0.08, left: 0.05, right: 0.05 })
    expect(SAFE_AREA['1:1']).toEqual({ top: 0.06, bottom: 0.08, left: 0.06, right: 0.06 })
    expect(SAFE_AREA['4:5']).toEqual({ top: 0.06, bottom: 0.08, left: 0.06, right: 0.06 })
  })
})
