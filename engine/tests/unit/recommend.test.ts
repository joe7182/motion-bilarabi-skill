import { describe, expect, it } from 'vitest'
import { CONCEPTS, featuresOf, recommend, sentenceOf } from '../../src/library/concepts'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'

const top = (text: string, seconds = 3) => recommend(sentenceOf(text, 0, seconds), 3).map((r) => r.id)

describe('concept recommender', () => {
  it('reads the features of a sentence', () => {
    const f = featuresOf(sentenceOf('المبيعات زادت ٤٠٪'))
    expect(f.numbers).toEqual([40])
    expect(f.percent).toBe(true)
    expect(f.growth).toBe(true)
    expect(featuresOf(sentenceOf('هذا مو تصميم')).negation).toBe(true)
    expect(featuresOf(sentenceOf('بعد ما سويت العرض')).negation).toBe(false)
  })
  it('picks the concept that carries the sentence', () => {
    expect(top('المبيعات زادت ٤٠٪ هذا الشهر')[0]).toBe('growth-graph')
    expect(top('قبل كان يدوي وبعد صار تلقائي')).toContain('before-after-slider')
    expect(top('تختار بس الأفكار اللي تستاهل', 4)[0]).toBe('shortlist-funnel')
    expect(top('طلب واحد يطلع منه كثير محتوى', 4)[0]).toBe('one-to-many')
    expect(top('اضغط على الزر بالتطبيق', 4)[0]).toBe('ui-chain')
    expect(top('هذا مو تصميم هذا فن', 3)[0]).toBe('strike-and-replace')
    expect(top('الفكرة تتحول لمنتج', 3)[0]).toBe('object-chain')
    expect(top('شلون تعرف إذا أحد وقف؟', 3)).toContain('question-pulse')
  })
  it('always offers the karaoke ball for a short sentence, with rising landings', () => {
    const r = recommend(sentenceOf('كل كلمة لها حركة', 0, 2.4), 9).find((x) => x.id === 'karaoke-ball')!
    const ats = (r.scenes[0]!.params.words as { at: number }[]).map((w) => w.at)
    expect(ats.every((a, i) => i === 0 || a > ats[i - 1]!)).toBe(true)
    expect(ats[0]).toBeGreaterThanOrEqual(0.42)
  })
  it('only builds scene types the engine has', () => {
    const s = sentenceOf('قبل كان يدوي وبعد صار تلقائي بنسبة ٣٠٪ وتختار الأفضل وتضغط الزر وتتحول كثير', 0, 4)
    for (const c of CONCEPTS) for (const sc of c.build(s, c.id)) expect(PRIMITIVE_IDS as readonly string[]).toContain(sc.type)
  })
})

import { PARAMS } from '../../src/core/params/index'

describe('concept scenes are valid', () => {
  it('every built scene passes its type schema', () => {
    const texts = ['المبيعات زادت ٤٠٪ هذا الشهر', 'قبل كان يدوي وبعد صار تلقائي', 'تختار بس الأفكار اللي تستاهل', 'طلب واحد يطلع منه كثير محتوى', 'اضغط على الزر بالتطبيق', 'هذا مو تصميم هذا فن', 'الفكرة تتحول لمنتج', 'شلون تعرف إذا أحد وقف؟']
    for (const t of texts) {
      for (const c of CONCEPTS) {
        for (const sc of c.build(sentenceOf(t, 2, 6), c.id)) {
          const schema = (PARAMS as Record<string, { safeParse: (x: unknown) => { success: boolean; error?: unknown } }>)[sc.type]!
          const r = schema.safeParse(sc.params)
          expect(r.success, `${c.id} on «${t}»: ${JSON.stringify(r.error)}`.slice(0, 400)).toBe(true)
        }
      }
    }
  })
})
