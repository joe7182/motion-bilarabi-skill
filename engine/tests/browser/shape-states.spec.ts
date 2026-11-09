import { test, expect, type Page } from '@playwright/test'
import { openStoryboard, freshFrameAt } from './helpers'
import { safeRect } from '../../src/core/types'
import { cuesOfShapeStates, shapeStatesParams, STATE_GEOMETRY } from '../../src/core/params/shape-states'

// Plan 2a+ Task 7: one shape springing through UI states.

const SAFE = safeRect('9:16')
const U = 0.6 * SAFE.w
const states = [
  { at: 0, kind: 'button', label: 'ابدأ' },
  { at: 1.5, kind: 'card', label: 'الخطة' },
  { at: 3, kind: 'toggle', on: true },
]
const sb = (params: Record<string, unknown> = {}) => ({
  version: 1,
  format: '9:16',
  fps: 30,
  look: 'dark-tech',
  dir: 'rtl',
  seed: 3,
  scenes: [{ id: 's', type: 'shape-states', start: 0, duration: 4, params: { states, ...params } }],
})

async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate((tt) => window.__mba.seek(tt), t)
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
}

const shapeBox = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('#frame [data-mba-part=shape]')!
    return { w: el.offsetWidth, h: el.offsetHeight }
  })

const labels = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#frame [data-mba-part=shape] [data-mba-text]')].map((e) => ({
      text: e.textContent,
      kind: e.dataset.mbaText,
      opacity: Number(getComputedStyle(e).opacity),
      shown: getComputedStyle(e).display !== 'none',
    })),
  )

const cursorShown = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector<HTMLElement>('#frame [data-mba-part=cursor]')!
    const cs = getComputedStyle(c)
    return cs.display !== 'none' && Number(cs.opacity) > 0
  })

test('button rests at its geometry; card within 2 % at 1.5; mid-spring strictly between', async ({ page }) => {
  await openStoryboard(page, sb())
  await seek(page, 0.9)
  const b = await shapeBox(page)
  expect(b.w).toBeCloseTo(STATE_GEOMETRY.button.w * U, 0)
  expect(b.h).toBeCloseTo(STATE_GEOMETRY.button.h * U, 0)
  await seek(page, 1.35)
  const m = await shapeBox(page)
  expect(m.w).toBeGreaterThan(b.w + 5)
  expect(m.w).toBeLessThan(STATE_GEOMETRY.card.w * U - 5)
  await seek(page, 1.5)
  const c = await shapeBox(page)
  expect(Math.abs(c.w / (STATE_GEOMETRY.card.w * U) - 1)).toBeLessThan(0.02)
  expect(Math.abs(c.h / (STATE_GEOMETRY.card.h * U) - 1)).toBeLessThan(0.02)
})

test('labels: whole-word units, the card label at 1.5, a cross-fade (both < 1) while it swaps', async ({ page }) => {
  await openStoryboard(page, sb())
  await seek(page, 1.5)
  const at15 = (await labels(page)).filter((l) => l.shown && l.opacity > 0)
  expect(at15.map((l) => [l.text, l.kind, l.opacity])).toEqual([['الخطة', 'line', 1]])
  await seek(page, 1.44)
  const mid = (await labels(page)).filter((l) => l.shown)
  expect(mid.map((l) => l.text).sort()).toEqual(['ابدأ', 'الخطة'].sort())
  for (const l of mid) {
    expect(l.opacity).toBeLessThan(1)
    expect(l.opacity).toBeGreaterThan(0)
    expect(l.kind).toBe('line')
  }
  expect(await page.evaluate(() => window.__mba.audit())).toEqual([])
})

test('toggle on: the knob sits at the left end at 3.0 (RTL), at the right end while off', async ({ page }) => {
  await openStoryboard(page, sb())
  const knobSide = () =>
    page.evaluate(() => {
      const s = document.querySelector<HTMLElement>('#frame [data-mba-part=shape]')!.getBoundingClientRect()
      const k = document.querySelector<HTMLElement>('#frame [data-mba-part=knob]')!.getBoundingClientRect()
      return { left: (k.left - s.left) / s.width, right: (s.right - k.right) / s.width, opacity: Number(getComputedStyle(document.querySelector('#frame [data-mba-part=knob]')!).opacity) }
    })
  await seek(page, 3.0)
  const on = await knobSide()
  expect(on.opacity).toBe(1)
  expect(on.left).toBeLessThan(0.1)
  expect(on.right).toBeGreaterThan(0.4)
  expect(await page.evaluate(() => window.__mba.audit())).toEqual([])

  await openStoryboard(page, sb({ states: [states[0], { at: 1.5, kind: 'toggle', on: false }] }))
  await seek(page, 2.5)
  const off = await knobSide()
  expect(off.right).toBeLessThan(0.1)
  expect(off.left).toBeGreaterThan(0.4)
})

test('cursor: visible just before the card change, hidden at 2.0; none before the first click', async ({ page }) => {
  await openStoryboard(page, sb())
  await seek(page, 0.5)
  expect(await cursorShown(page)).toBe(false)
  await seek(page, 1.35)
  expect(await cursorShown(page)).toBe(true)
  await seek(page, 2.0)
  expect(await cursorShown(page)).toBe(false)
  await openStoryboard(page, sb({ cursor: false }))
  await seek(page, 1.35)
  expect(await page.locator('#frame [data-mba-part=cursor]').count()).toBe(0)
})

test('cues: a tap on each state change; audit clean at 1.5 and 3.0', async ({ page }) => {
  expect(cuesOfShapeStates(shapeStatesParams.parse({ states }), { duration: 4 })).toEqual([
    { t: 1.5, kind: 'action' },
    { t: 3, kind: 'action' },
  ])
  await openStoryboard(page, sb())
  for (const t of [1.5, 3.0]) {
    await seek(page, t)
    expect(await page.evaluate(() => window.__mba.audit())).toEqual([])
  }
})

test('window, check and soft spring render clean; every kind passes the audit at rest', async ({ page }) => {
  const kinds = [
    { at: 0, kind: 'pill', label: 'اشترك' },
    { at: 1, kind: 'chip', label: 'ذكاء' },
    { at: 2, kind: 'window', label: 'الإعدادات' },
    { at: 3, kind: 'check' },
  ]
  await openStoryboard(page, sb({ states: kinds, spring: 'soft', size: 0.9 }))
  for (const t of [0.5, 1.8, 2.8, 3.8]) {
    await seek(page, t)
    expect(await page.evaluate(() => window.__mba.audit())).toEqual([])
  }
})

test('pixel-identical when rendered twice at t = 0.9 and mid-spring 1.35', async ({ page }) => {
  await openStoryboard(page, sb())
  for (const t of [0.9, 1.35]) {
    const a = await freshFrameAt(page, t)
    await freshFrameAt(page, 2.2)
    const b = await freshFrameAt(page, t)
    expect(a.equals(b)).toBe(true)
  }
})
