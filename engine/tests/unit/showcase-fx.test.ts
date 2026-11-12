import { describe, expect, it } from 'vitest'
import { AR_KEYS, glassCardParams, orderStepsParams, pageFlyoverParams, phoneReplyParams } from '../../src/core/params/showcase-fx'

describe('showcase effects: params', () => {
  it('page-flyover needs an image and takes up to eight lifting pieces', () => {
    expect(pageFlyoverParams.safeParse({}).success).toBe(false)
    const p = pageFlyoverParams.parse({ image: 'page.png', layers: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.2 }] })
    expect(p.layers[0]!.lift).toBe(0.1)
    expect(p.tilt).toBe(56)
    expect(pageFlyoverParams.safeParse({ image: 'p.png', layers: Array.from({ length: 9 }, () => ({ x: 0, y: 0, w: 0.1, h: 0.1 })) }).success).toBe(false)
  })
  it('phone-reply: the reply is typed after the messages and sent after it is typed', () => {
    const ok = { messages: [{ text: 'وصل الطلب؟', at: 0.4 }], reply: 'وصل اليوم', typeAt: 1.5, sendAt: 2.6 }
    expect(phoneReplyParams.safeParse(ok).success).toBe(true)
    expect(phoneReplyParams.safeParse({ ...ok, sendAt: 1.6 }).success).toBe(false)
    expect(phoneReplyParams.safeParse({ ...ok, typeAt: 0.2 }).success).toBe(false)
  })
  it('the keyboard has every plain Arabic letter once', () => {
    const all = AR_KEYS.join('')
    expect(new Set(all).size).toBe(all.length)
    for (const ch of 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي') expect(all, ch).toContain(ch)
  })
  it('order-steps: two to five steps, in rising time', () => {
    const steps = [{ label: 'تم الطلب', at: 0.5 }, { label: 'وصل', at: 1.5 }]
    expect(orderStepsParams.safeParse({ steps }).success).toBe(true)
    expect(orderStepsParams.safeParse({ steps: [steps[1], steps[0]] }).success).toBe(false)
    expect(orderStepsParams.safeParse({ steps: [steps[0]] }).success).toBe(false)
  })
  it('glass-card: a title, up to three lines and four chips', () => {
    expect(glassCardParams.parse({ title: 'عنوان' }).tint).toBe('dark')
    expect(glassCardParams.safeParse({ title: 'عنوان', lines: ['١', '٢', '٣', '٤'] }).success).toBe(false)
  })
})
