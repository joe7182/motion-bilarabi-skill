import { test, expect, type Page } from '@playwright/test'
import { openStoryboard } from './helpers'
import { expectAuditClean, expectColdWarm, expectNoReflow, seek, tile } from './layers-kit'
import type {} from '../../src/runtime/mba-api'

// `layer-stack`: three slabs listed top → bottom, landing bottom first (0.6, 1.1, 1.6); flow from
// 2.4; the middle slab active at 3.2.
const sbOf = (params: Record<string, unknown>, world = 'paper') => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 5,
  scenes: [
    { id: 'b', type: 'backdrop', track: 0, start: 0, duration: 4.5, params: { world } },
    { id: 's', type: 'layer-stack', track: 1, start: 0, duration: 4.5, params },
  ],
})
const main = {
  layers: [
    { title: 'القناة', subtitle: 'واتساب، موقعك، إنستغرام', icons: [tile('#25d366')], at: 1.6 },
    { title: 'التنسيق', subtitle: 'n8n أو Zapier', icons: [tile('#ea4b71', 'bars'), tile('#ff4f00', 'dot')], at: 1.1 },
    { title: 'النموذج', subtitle: 'العقل الذي يفكر', icons: [tile('#d97757', 'star'), tile('#10a37f'), tile('#8e75b2', 'star')], at: 0.6 },
  ],
  flowAt: 2.4,
  active: [{ at: 3.2, index: 1 }],
}

const slabsAt = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-mba-part="layer-slab"]')]
      .sort((a, b) => Number(a.dataset.i) - Number(b.dataset.i))
      .map((el) => {
        const svg = el.querySelector('svg')!.getBoundingClientRect()
        const veil = el.querySelectorAll('svg')[1] as SVGSVGElement
        return { shown: getComputedStyle(el).display !== 'none', top: svg.top, cx: svg.left + svg.width / 2, veil: veil.style.display === 'none' ? 0 : Number(veil.style.opacity) }
      }),
  )

test('slabs land bottom first and stack top → bottom; badges number 1 = the bottom slab; active lifts one and veils the rest; audit clean', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await seek(page, 0.3)
  expect((await slabsAt(page)).map((s) => s.shown)).toEqual([false, false, true])
  await seek(page, 2.6)
  const s = await slabsAt(page)
  expect(s.every((x) => x.shown)).toBe(true)
  expect(s[0]!.top).toBeLessThan(s[1]!.top)
  expect(s[1]!.top).toBeLessThan(s[2]!.top)
  const badges = await page.evaluate(() => [...document.querySelectorAll('[data-mba-part="layer-badge"]')].map((b) => b.textContent))
  expect(badges).toEqual(['٣', '٢', '١']) // listed top → bottom: 1 is the bottom slab
  // Pulses climb from flowAt.
  const pulses = await page.evaluate(() => [...document.querySelectorAll<SVGGElement>('[data-mba-part="layer-stack"] g')].filter((g) => g.getAttribute('transform')?.startsWith('translate') && g.style.display !== 'none').length)
  expect(pulses).toBeGreaterThan(0)
  await seek(page, 4.0)
  const a = await slabsAt(page)
  expect(s[1]!.top - a[1]!.top).toBeGreaterThan(8) // lifted (4 % of the slab width)
  expect(a[0]!.top).toBeCloseTo(s[0]!.top, 3)
  expect(a[0]!.veil).toBeCloseTo(0.55, 3)
  expect(a[1]!.veil).toBe(0)
  await expectAuditClean(page, [1.0, 2.0, 3.4, 4.0, 2.6], 9)
})

test('no reflow: titles, subtitles and badges keep their layout boxes through landing, flow and active', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  await expectNoReflow(page, [2.4, 3.0, 3.35, 4.4])
})

test('cold vs warm seeks are identical: mid-landing, mid-label, mid-flow, mid-active, after', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  await expectColdWarm(page, [0.35, 1.3, 1.85, 2.9, 3.35, 4.45], 4.5)
})

test('ink world and four slabs without numbers stay audit clean; a subtitle that needs three lines is refused Arabic first', async ({ page }) => {
  const four = { layers: [...main.layers, { title: 'البيانات', at: 0.2 }], number: false }
  await openStoryboard(page, sbOf(four, 'ink'))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  expect(await page.evaluate(() => document.querySelectorAll('[data-mba-part="layer-badge"]').length)).toBe(0)
  await expectAuditClean(page, [2.6, 4.0], 4)
  await openStoryboard(page, sbOf({ layers: [{ title: 'أ', subtitle: 'كلمات كثيرة هنا وهناك أيضا', at: 0.5 }, { title: 'ب', at: 0.6 }], width: 0.5 }))
  expect(await page.evaluate(() => window.__mba.error)).toMatch(/[؀-ۿ][^]*layer-stack: subtitle/)
})
