import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { openStoryboard, freshFrameAt } from './helpers'
import type {} from '../../src/runtime/mba-api'

// Stage 1B `numbered-slots`: three cards, slot «١» rightmost; slot 3 locked and opened at 1.6 s;
// slot 3 then made active at 2.5 s.
const sbOf = (params: Record<string, unknown>, look = 'signature') => ({
  version: 1,
  format: '9:16',
  look,
  seed: 3,
  scenes: [
    { id: 'b', type: 'backdrop', track: 0, start: 0, duration: 3.5, params: { world: 'paper' } },
    { id: 'n', type: 'numbered-slots', track: 1, start: 0, duration: 3.5, params },
  ],
})
const main = { count: 3, labels: ['المخطط', 'الكلفة', 'الشمس'], locked: 2, unlockAt: 1.6, active: [{ at: 2.5, index: 2 }] }

const seek = (page: Page, t: number) => page.evaluate((tt) => window.__mba.seek(tt), t)
const slotsAt = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-mba-part="numbered-slot"]')].map((el) => {
      const r = el.getBoundingClientRect()
      const card = el.firstElementChild as HTMLElement
      return {
        i: Number(el.dataset.i),
        shown: getComputedStyle(el).display !== 'none',
        x: r.left + r.width / 2,
        numeral: el.querySelector('[data-mba-text]')!.textContent,
        bg: getComputedStyle(card).backgroundColor,
        opacity: Number(getComputedStyle(el).opacity),
        lock: el.querySelector('svg') ? getComputedStyle(el.querySelector('svg')!.parentElement!).display : 'none',
      }
    }),
  )

/** Mean RGB of a w×h patch of a PNG at (x, y). */
function patch(png: Buffer, x: number, y: number, w = 8, h = 8): [number, number, number] {
  const img = PNG.sync.read(png)
  const s = [0, 0, 0]
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const o = ((Math.round(y) + j) * img.width + Math.round(x) + i) * 4
      for (let c = 0; c < 3; c++) s[c]! += img.data[o + c]!
    }
  return s.map((v) => v / (w * h)) as [number, number, number]
}

test('RTL order (slot ١ rightmost), Arabic numerals and labels as DOM units; staggered pops; audit clean throughout', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await seek(page, 0.05)
  const early = await slotsAt(page)
  expect(early.map((s) => s.shown)).toEqual([true, false, false])
  await seek(page, 1.0)
  const s = await slotsAt(page)
  expect(s.map((x) => x.numeral)).toEqual(['١', '٢', '٣'])
  expect(s.every((x) => x.shown)).toBe(true)
  expect(s[0]!.x).toBeGreaterThan(s[1]!.x)
  expect(s[1]!.x).toBeGreaterThan(s[2]!.x)
  // Centred on the safe area's centre (x 64.8 + 0.5 × 885.6).
  expect((s[0]!.x + s[2]!.x) / 2).toBeCloseTo(64.8 + 0.5 * 885.6, 0)
  for (const t of [0.6, 1.0, 1.7, 2.2, 2.6, 3.4]) {
    await seek(page, t)
    expect(await page.evaluate(() => window.__mba.audit()), `audit at ${t}`).toEqual([])
  }
  // Not vacuous: at 2.2 the three numerals and three labels are measured.
  await seek(page, 2.2)
  expect(await page.evaluate(() => window.__mba.auditStats().checkedGeometric)).toBe(6)
  // Latin digits on request.
  await openStoryboard(page, sbOf({ count: 4, digits: 'latin' }))
  await seek(page, 1)
  expect((await slotsAt(page)).map((x) => x.numeral)).toEqual(['1', '2', '3', '4'])
  expect(await page.evaluate(() => window.__mba.audit())).toEqual([])
})

test('locked → unlock → active: dark card with a padlock, accent flash, numeral shows, the lock falls away; active slot highlighted, others dimmed', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  const cardPt = async () => {
    const r = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-mba-part="numbered-slot"][data-i="2"]')!.firstElementChild!.getBoundingClientRect()
      return { x: el.left + 6, y: el.top + el.height * 0.5 }
    })
    return r
  }
  await seek(page, 1.2)
  let s = await slotsAt(page)
  expect(s[2]!.lock).toBe('block')
  const lockedPx = patch(await freshFrameAt(page, 1.2), (await cardPt()).x, (await cardPt()).y)
  expect(Math.max(...lockedPx)).toBeLessThan(60) // the dark locked card
  // Mid-flash: the card is accent-tinted (signature accent #ff5a1f: red high, blue low).
  const flash = patch(await freshFrameAt(page, 1.72), (await cardPt()).x, (await cardPt()).y)
  expect(flash[0]).toBeGreaterThan(170)
  expect(flash[0] - flash[2]).toBeGreaterThan(90)
  await seek(page, 2.3)
  s = await slotsAt(page)
  expect(s[2]!.lock).toBe('none')
  expect(s.map((x) => x.opacity)).toEqual([1, 1, 1])
  const open = patch(await freshFrameAt(page, 2.3), (await cardPt()).x, (await cardPt()).y)
  expect(Math.min(...open)).toBeGreaterThan(200) // back to the light surface
  await seek(page, 3.2)
  s = await slotsAt(page)
  expect(s[0]!.opacity).toBeCloseTo(0.45, 3)
  expect(s[1]!.opacity).toBeCloseTo(0.45, 3)
  expect(s[2]!.opacity).toBe(1)
  const act = patch(await freshFrameAt(page, 3.2), (await cardPt()).x, (await cardPt()).y)
  expect(act[0]).toBeGreaterThan(220)
  expect(act[2]).toBeLessThan(80)
})

test('cold vs warm seeks are identical: mid-pop, locked, mid-unlock, mid-drop, mid-active', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  const times = [0.1, 0.3, 1.2, 1.66, 1.85, 2.6]
  const cold: Buffer[] = []
  for (const t of times) {
    await page.reload()
    await page.evaluate(() => window.__mba.ready)
    cold.push(await freshFrameAt(page, t))
  }
  await page.reload()
  await page.evaluate(() => window.__mba.ready)
  for (const t of [3.4, 0.05, 2.0, 1.7]) await seek(page, t)
  for (const [i, t] of times.entries()) {
    await seek(page, 3.4 - i * 0.4)
    expect(Buffer.compare(cold[i]!, await freshFrameAt(page, t)), `cold / warm at ${t}`).toBe(0)
  }
})

test('a label wider than its slot is refused at build, Arabic first; the dark-tech look keeps contrast', async ({ page }) => {
  await openStoryboard(page, sbOf({ count: 5, width: 0.3, labels: ['المخطط المعماري', 'ب', 'ج', 'د', 'ه'].map((l) => l.slice(0, 14)) }))
  expect(await page.evaluate(() => window.__mba.error)).toMatch(/[؀-ۿ][^]*numbered-slots/)
  await openStoryboard(page, sbOf(main, 'dark-tech'))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  for (const t of [1.0, 2.2, 3.2]) {
    await seek(page, t)
    expect(await page.evaluate(() => window.__mba.audit()), `audit at ${t}`).toEqual([])
  }
})
