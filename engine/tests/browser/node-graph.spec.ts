import { test, expect, type Page } from '@playwright/test'
import { openStoryboard } from './helpers'
import { expectAuditClean, expectColdWarm, expectNoReflow, seek, tile } from './layers-kit'
import type {} from '../../src/runtime/mba-api'

// `node-graph`: trigger → agent → step, a model slot under the agent filled at 2.4; flow from 3.0.
const sbOf = (params: Record<string, unknown>, world = 'paper') => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 9,
  scenes: [
    { id: 'b', type: 'backdrop', track: 0, start: 0, duration: 4.5, params: { world } },
    { id: 'g', type: 'node-graph', track: 1, start: 0, duration: 4.5, params },
  ],
})
const main = {
  panel: { title: 'حجز موعد — سير العمل' },
  nodes: [
    { id: 'wa', kind: 'trigger', label: 'رسالة واتساب', sub: 'عند وصول رسالة', icon: tile('#25d366'), x: 0, y: 0.2, at: 0.3 },
    { id: 'ag', kind: 'agent', label: 'وكيل الذكاء', sub: 'يفهم ويرد', x: 0.5, y: 0.2, at: 0.6 },
    { id: 'rep', label: 'إرسال الرد', icon: tile('#25d366', 'bars'), x: 1, y: 0.2, at: 0.9 },
    { id: 'm', kind: 'slot', label: 'النموذج', icon: tile('#d97757', 'star'), x: 0.5, y: 0.85, at: 1.0, fillAt: 2.4 },
  ],
  edges: [
    { from: 'wa', to: 'ag', at: 1.2 },
    { from: 'ag', to: 'rep', at: 1.5 },
    { from: 'ag', to: 'm', at: 1.8, kind: 'sub' },
  ],
  flowAt: 3.0,
  focus: [{ at: 2.0, id: 'm' }, { at: 3.6, id: 'ag' }],
}

const nodesAt = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-mba-part="graph-node"]')].map((el) => {
        const r = el.getBoundingClientRect()
        return [el.dataset.id!, { shown: getComputedStyle(el).display !== 'none', cx: r.left + r.width / 2, cy: r.top + r.height / 2 }]
      }),
    ),
  )

test('nodes pop in place, data flows left → right, the slot fills, wires draw and pulse; audit clean', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await seek(page, 0.5)
  let n = await nodesAt(page)
  expect([n.wa!.shown, n.ag!.shown, n.rep!.shown, n.m!.shown]).toEqual([true, false, false, false])
  await seek(page, 2.0)
  n = await nodesAt(page)
  expect(n.wa!.cx).toBeLessThan(n.ag!.cx)
  expect(n.ag!.cx).toBeLessThan(n.rep!.cx)
  expect(n.m!.cy).toBeGreaterThan(n.ag!.cy)
  // Before the fill the slot is a dashed socket with a plus; after it, a filled node.
  const slot = () => page.evaluate(() => {
    const box = document.querySelector<HTMLElement>('[data-mba-part="graph-node"][data-id="m"]')!.firstElementChild as HTMLElement
    const kids = [...box.children] as HTMLElement[]
    return kids.map((k) => getComputedStyle(k).display)
  })
  expect((await slot()).slice(1, 3)).toEqual(['block', 'none'])
  await seek(page, 3.0)
  expect((await slot()).slice(1, 4)).toEqual(['none', 'flex', 'none'])
  // Pulses run from 3.0 on every drawn wire.
  await seek(page, 3.5)
  const pulses = await page.evaluate(() => [...document.querySelectorAll<SVGGElement>('[data-mba-part="node-graph"] svg > g')].filter((g) => g.style.display !== 'none').length)
  expect(pulses).toBe(3)
  await expectAuditClean(page, [1.0, 2.2, 3.2, 4.4, 2.8], 7) // toolbar title + 4 labels + 2 subs
})

test('no reflow: every label keeps its layout box through the pops, the fill, the flow and the focus changes', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  await expectNoReflow(page, [1.5, 2.6, 3.4, 4.4])
})

test('cold vs warm seeks are identical: mid-pop, mid-draw, mid-fill, mid-flow, mid-focus, after', async ({ page }) => {
  await openStoryboard(page, sbOf(main))
  await expectColdWarm(page, [0.45, 1.35, 1.95, 2.6, 3.4, 3.7, 4.45], 4.5)
})

test('ink world stays audit clean; an edge to an unknown node is refused at its path, Arabic first', async ({ page }) => {
  await openStoryboard(page, sbOf(main, 'ink'))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await expectAuditClean(page, [3.2, 4.4], 6)
  await openStoryboard(page, sbOf({ ...main, edges: [{ from: 'wa', to: 'zz', at: 1.2 }] }))
  expect(await page.evaluate(() => window.__mba.error)).toMatch(/edges\[0\]\.to: [؀-ۿ][^]*no node with id "zz"/)
})
