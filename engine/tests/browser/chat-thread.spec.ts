import { test, expect, type Page } from '@playwright/test'
import { openStoryboard } from './helpers'
import { expectAuditClean, expectColdWarm, expectNoReflow, seek, tile } from './layers-kit'
import type {} from '../../src/runtime/mba-api'

// `chat-thread`: six messages (customer RIGHT, business LEFT), a booking card at 2.9; the thread
// scrolls once the messages overflow.
const sbOf = (params: Record<string, unknown>, world = 'paper') => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 4,
  scenes: [
    { id: 'b', type: 'backdrop', track: 0, start: 0, duration: 5.5, params: { world } },
    { id: 'c', type: 'chat-thread', track: 1, start: 0, duration: 5.5, params },
  ],
})
const main = {
  avatar: tile('#c8644a'),
  name: 'صالون ريم',
  status: 'متصل الآن',
  accent: '#25D366',
  messages: [
    { side: 'in', text: 'مرحبا، أبغى موعد قص شعر بكرة', at: 0.4, time: '9:12' },
    { side: 'out', text: 'أهلاً! عندنا الساعة ٤ أو ٦ مساءً، أيهما يناسبك؟', at: 1.3, time: '9:12' },
    { side: 'in', text: 'الساعة ٦ ممتاز', at: 2.0, time: '9:13' },
    { side: 'out', kind: 'card', text: 'تم الحجز', rows: [['الخدمة', 'قص شعر'], ['الموعد', 'الخميس ٦:٠٠ م'], ['الفرع', 'العليا']], at: 2.9, time: '9:13' },
    { side: 'in', text: 'شكراً جزيلاً', at: 3.6, time: '9:13' },
    { side: 'out', text: 'بانتظارك! نرسل لك تذكير قبل الموعد بساعة', at: 4.4, time: '9:14' },
  ],
}

const bubblesAt = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-mba-part="chat-thread"]')!.getBoundingClientRect()
    return [...document.querySelectorAll<HTMLElement>('[data-mba-part="chat-bubble"]')].map((el) => {
      const r = el.getBoundingClientRect()
      const typing = el.parentElement!.querySelector<HTMLElement>('[data-mba-part="chat-typing"]')
      return {
        side: el.dataset.side,
        shown: getComputedStyle(el).display !== 'none' && el.parentElement!.style.display !== 'none',
        left: r.left - panel.left,
        right: panel.right - r.right,
        top: r.top,
        typing: typing ? getComputedStyle(typing).display !== 'none' : false,
      }
    })
  })

test('WhatsApp-Arabic sides (business left, customer right), typing dots before each business message, the thread scrolls; audit clean', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await seek(page, 1.0)
  let b = await bubblesAt(page)
  expect(b[0]!.shown).toBe(true)
  expect(b[1]!.shown).toBe(false)
  expect(b[1]!.typing).toBe(true) // 0.6 s of typing before 1.3
  await seek(page, 1.8)
  b = await bubblesAt(page)
  expect(b[1]!.shown && !b[1]!.typing).toBe(true)
  expect(b[0]!.right).toBeLessThan(b[0]!.left) // customer: right
  expect(b[1]!.left).toBeLessThan(b[1]!.right) // business: left
  const top1 = b[1]!.top
  await seek(page, 5.4)
  b = await bubblesAt(page)
  expect(b.every((x) => x.shown || x.top < top1)).toBe(true)
  expect(b[1]!.top).toBeLessThan(top1 - 50) // scrolled up
  await expectAuditClean(page, [0.9, 1.5, 2.6, 3.2, 4.2, 4.6, 5.4], 10)
})

test('no reflow: each message keeps its layout box from typing to the end, scroll included (translate only)', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  await expectNoReflow(page, [4.5, 4.75, 5.0, 5.45])
  // A slot is reserved at build: the business message's slot is the same while typing and once shown.
  const box = () => page.evaluate(() => {
    const el = document.querySelectorAll<HTMLElement>('[data-mba-part="chat-slot"]')[5]!
    return [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight]
  })
  await seek(page, 4.0)
  const typing = await box()
  await seek(page, 5.0)
  expect(await box()).toEqual(typing)
})

test('cold vs warm seeks are identical: typing, mid-pop, mid-scroll, card, after', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  await expectColdWarm(page, [0.2, 1.0, 1.4, 2.95, 3.1, 4.55, 5.45], 5.5)
})

test('ink world stays audit clean; an out message with no time to type after the previous one is refused Arabic first', async ({ page }) => {
  await openStoryboard(page, sbOf(main, 'ink'))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await expectAuditClean(page, [2.6, 5.4], 6)
  const bad = { ...main, messages: [main.messages[0], { ...main.messages[1], at: 0.7 }] }
  await openStoryboard(page, sbOf(bad))
  expect(await page.evaluate(() => window.__mba.error)).toMatch(/messages\[1\]\.at: [؀-ۿ][^]*0\.6 s of typing/)
})
