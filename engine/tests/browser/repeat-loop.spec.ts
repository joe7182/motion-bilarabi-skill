import { test, expect, type Page } from '@playwright/test'
import { openStoryboard, frameAt, freshFrameAt, unsanctionedArabicText } from './helpers'

const sbOf = (params: Record<string, unknown>, world = 'ink') => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 7,
  scenes: [
    { id: 'b', type: 'backdrop', track: 0, start: 0, duration: 3, params: { world } },
    { id: 'r', type: 'repeat-loop', track: 1, start: 0, duration: 3, params },
  ],
})

const noError = async (page: Page) => expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()

/** Every copy of the word: text, unit kind, aria-hidden, and its box top/left in frame px. */
const copies = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#frame [data-mba-part="repeat-loop"] [data-mba-text]')].map((e) => {
      const r = e.getBoundingClientRect()
      return { text: e.textContent, kind: e.dataset.mbaText, hidden: e.getAttribute('aria-hidden') === 'true', top: r.top, left: r.left, opacity: getComputedStyle(e).opacity }
    }),
  )

test('repeat-loop «مكرر» (stack, 7 copies): 7 whole-word units, exactly 1 readable; the stack moves between 0.5 and 1.5; audit 0', async ({ page }) => {
  await openStoryboard(page, sbOf({ text: 'مكرر', copies: 7 }))
  await noError(page)
  await frameAt(page, 0.5)
  const a = await copies(page)
  expect(a).toHaveLength(7)
  for (const c of a) {
    expect(c.text).toBe('مكرر')
    expect(c.kind).toBe('line')
  }
  expect(a.filter((c) => !c.hidden)).toHaveLength(1)
  expect(await unsanctionedArabicText(page)).toEqual([])
  await frameAt(page, 1.5)
  const b = await copies(page)
  const moved = a.filter((c, i) => c.hidden && Math.abs(c.top - b[i]!.top) > 4).length
  expect(moved, 'hidden copies that moved between 0.5 and 1.5').toBeGreaterThanOrEqual(4)
  // the readable copy is in the accent world colour at full opacity
  expect(b.find((c) => !c.hidden)!.opacity).toBe('1')
  for (const t of [0.05, 0.3, 0.5, 1.0, 1.5, 2.2, 2.9]) {
    await frameAt(page, t)
    expect(await page.evaluate(() => window.__mba.audit()), `audit at ${t}`).toEqual([])
  }
  // the moving frames differ
  expect(Buffer.compare(await frameAt(page, 0.5), await frameAt(page, 1.5))).not.toBe(0)
})

test('repeat-loop: cold / warm frames are identical (stack and orbit); orbit also moves and stays clean', async ({ page }) => {
  for (const mode of ['stack', 'orbit']) {
    await openStoryboard(page, sbOf({ text: 'مكرر', copies: 7, mode }, 'paper'))
    await noError(page)
    const cold = await freshFrameAt(page, 1.13)
    await freshFrameAt(page, 2.7)
    await freshFrameAt(page, 0.2)
    await freshFrameAt(page, 1.9)
    expect(Buffer.compare(cold, await freshFrameAt(page, 1.13)), `${mode} cold / warm`).toBe(0)
    const a = await copies(page)
    await frameAt(page, 2.4)
    const b = await copies(page)
    expect(a.some((c, i) => c.hidden && (Math.abs(c.top - b[i]!.top) > 4 || Math.abs(c.left - b[i]!.left) > 4)), `${mode} moves`).toBe(true)
    expect(await page.evaluate(() => window.__mba.audit()), `${mode} audit`).toEqual([])
  }
})

test('R32 (Task 7): the stack mask box is clamped to the safe area, also for a loop placed near the top or the bottom', async ({ page }) => {
  // 9:16 safe area: x 64.8 … 950.4, y 268.8 … 1497.6 (frame px).
  const safe = { x: 1080 * 0.06, y: 1920 * 0.14, r: 1080 * 0.88, b: 1920 * 0.78 }
  for (const y of [0.05, 0.5, 0.95]) {
    await openStoryboard(page, sbOf({ text: 'مكرر', copies: 9, size: 0.8, at: { x: 0.5, y } }))
    await noError(page)
    await frameAt(page, 1)
    const box = await page.evaluate(() => {
      const f = document.getElementById('frame')!.getBoundingClientRect()
      const r = document.querySelector<HTMLElement>('#frame [data-mba-part="repeat-loop"]')!.getBoundingClientRect()
      return { top: r.top - f.top, bottom: r.bottom - f.top, left: r.left - f.left, right: r.right - f.left }
    })
    expect(box.top, `y ${y}`).toBeGreaterThanOrEqual(safe.y - 0.5)
    expect(box.bottom, `y ${y}`).toBeLessThanOrEqual(safe.b + 0.5)
    expect(box.left).toBeGreaterThanOrEqual(safe.x - 0.5)
    expect(box.right).toBeLessThanOrEqual(safe.r + 0.5)
    expect(await page.evaluate(() => window.__mba.audit()), `audit y ${y}`).toEqual([])
  }
})
