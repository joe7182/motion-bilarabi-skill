import { test, expect, type Page } from '@playwright/test'
import { openStoryboard } from './helpers'
import { expectAuditClean, expectColdWarm, expectNoReflow, seek, tile } from './layers-kit'
import type {} from '../../src/runtime/mba-api'

// `logo-row`: three logos (index 0 rightmost), focus on 0 at 1.6, strike on 1 at 2.4, out at 3.6.
const sbOf = (params: Record<string, unknown>, world = 'paper') => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 3,
  scenes: [
    { id: 'b', type: 'backdrop', track: 0, start: 0, duration: 4.2, params: { world } },
    { id: 'l', type: 'logo-row', track: 1, start: 0, duration: 4.2, params },
  ],
})
const items = [
  { image: tile('#d97757', 'star'), label: 'Claude', at: 0.1 },
  { image: tile('#10a37f', 'dot'), label: 'ChatGPT', at: 0.3 },
  { image: tile('#8e75b2', 'bars'), label: 'جيميناي', at: 0.5 },
]
const main = { items, focus: [{ at: 1.6, index: 0 }], strike: [{ at: 2.4, index: 1 }], out: 3.6 }

const tilesAt = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-mba-part="logo-tile"]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { shown: getComputedStyle(el).display !== 'none', x: r.left + r.width / 2, w: r.width, opacity: Number(getComputedStyle(el).opacity) }
    }),
  )

test('staggered pops, RTL order (index 0 rightmost), focus grows one and dims the rest, strike draws, out fades; audit clean', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await seek(page, 0.2)
  expect((await tilesAt(page)).map((t) => t.shown)).toEqual([true, false, false])
  await seek(page, 1.2)
  const rest = await tilesAt(page)
  expect(rest.every((t) => t.shown && t.opacity === 1)).toBe(true)
  expect(rest[0]!.x).toBeGreaterThan(rest[1]!.x)
  expect(rest[1]!.x).toBeGreaterThan(rest[2]!.x)
  expect((rest[0]!.x + rest[2]!.x) / 2).toBeCloseTo(64.8 + 0.5 * 885.6, 0)
  await seek(page, 2.2)
  const f = await tilesAt(page)
  expect(f[0]!.w / rest[0]!.w).toBeCloseTo(1.15, 2)
  expect(f[1]!.opacity).toBeCloseTo(0.35, 3)
  expect(f[2]!.opacity).toBeCloseTo(0.35, 3)
  await seek(page, 3.0)
  const off = await page.evaluate(() => document.querySelectorAll<SVGPathElement>('[data-mba-part="logo-tile"][data-i="1"] path')[1]!.getAttribute('stroke-dashoffset'))
  expect(Number(off)).toBeCloseTo(0, 3)
  await seek(page, 4.1)
  expect((await tilesAt(page)).every((t) => !t.shown)).toBe(true)
  await expectAuditClean(page, [2.0, 2.5, 3.3, 0.9, 1.4], 3)
})

test('no reflow: every label keeps its layout box from its entrance to the out', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  await expectNoReflow(page, [0.9, 1.7, 2.5, 3.5])
})

test('cold vs warm seeks are identical: mid-pop, mid-focus, mid-strike, mid-out, after', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  await expectColdWarm(page, [0.2, 0.45, 1.7, 2.5, 3.75, 4.15], 4.2)
})

test('grid of 3 per row in the ink world, and a label too wide for its tile is refused Arabic first', async ({ page }) => {
  const six = [...items, ...items].map((it, i) => ({ ...it, at: 0.1 * i }))
  await openStoryboard(page, sbOf({ items: six, layout: 'grid' }, 'ink'))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await seek(page, 1.2)
  const t = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-mba-part="logo-tile"]')].map((el) => Math.round(el.getBoundingClientRect().top)))
  expect(new Set(t).size).toBe(2)
  expect(await page.evaluate(() => window.__mba.audit())).toEqual([])
  await openStoryboard(page, sbOf({ items: [{ ...items[0], label: 'اسم طويل للشعار' }], size: 0.08 }))
  expect(await page.evaluate(() => window.__mba.error)).toMatch(/^[^]*[؀-ۿ][^]*logo-row: label/)
})
