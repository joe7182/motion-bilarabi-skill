import { test, expect, type Page } from '@playwright/test'
import { openStoryboard } from './helpers'
import { KINETIC_TIMING } from '../../src/core/params/kinetic-text'
import { CHECKLIST_TIMING } from '../../src/core/params/checklist'

// Fix wave I4 (critic: composition 6, variety 6): kinetic text placed by `y`, rotating word
// entrances (`enter`: rise / mask / pop), a larger checklist (`rowPx`) with per-row keys.

const sb = (scenes: unknown[]) => ({ version: 1, format: '9:16', fps: 30, look: 'dark-tech', dir: 'rtl', seed: 3, scenes })
const kinetic = (params: Record<string, unknown>, duration = 3) => ({ id: 'k', type: 'kinetic-text', start: 0, duration, params })

async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate((tt) => window.__mba.seek(tt), t)
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
}

const wordBox = (page: Page, text: string) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll<HTMLElement>('#frame [data-mba-text=word]')].find((e) => e.textContent === t)!
    const r = el.getBoundingClientRect()
    return { cy: r.top + r.height / 2, clip: el.style.clipPath, opacity: el.style.opacity, transform: el.style.transform }
  }, text)

test('kinetic-text y: a one-word block is centred at y of the frame height; without y at the safe-area centre', async ({ page }) => {
  await openStoryboard(page, sb([kinetic({ words: [{ text: 'الوقت', at: 0 }], y: 0.42 })]))
  await seek(page, 1)
  expect(Math.abs((await wordBox(page, 'الوقت')).cy - 0.42 * 1920)).toBeLessThan(0.02 * 1920)
  await openStoryboard(page, sb([kinetic({ words: [{ text: 'الوقت', at: 0 }] })]))
  await seek(page, 1)
  // 9:16 safe area: top 14 %, bottom 22 % → centre at 46 %.
  expect(Math.abs((await wordBox(page, 'الوقت')).cy - 0.46 * 1920)).toBeLessThan(0.02 * 1920)
})

test('kinetic-text y is clamped: a block never leaves the safe area', async ({ page }) => {
  await openStoryboard(page, sb([kinetic({ words: [{ text: 'أ', at: 0 }, { text: 'ب', at: 0 }, { text: 'ج', at: 0 }], y: 0.95 })]))
  await seek(page, 1)
  const issues = await page.evaluate(() => window.__mba.audit())
  expect(issues.filter((i: { rule: string }) => i.rule === 'outside-safe' || i.rule === 'clipped-by-frame')).toEqual([])
})

test('enter mask: the word is wiped in from the right (clip, no fade), then rests unclipped', async ({ page }) => {
  await openStoryboard(page, sb([kinetic({ words: [{ text: 'ساعات', at: 0.5 }], enter: 'mask' })]))
  await seek(page, 0.5 + KINETIC_TIMING.slideIn / 2)
  const mid = await wordBox(page, 'ساعات')
  expect(mid.clip).toMatch(/^inset\(-20% 0(px)? -20% [\d.]+%\)$/)
  expect(mid.opacity).toBe('')
  await seek(page, 0.5 + KINETIC_TIMING.slideIn + 0.05)
  const rest = await wordBox(page, 'ساعات')
  expect(rest.clip).toBe('')
  expect(rest.transform).toBe('')
})

test('enter pop: the word scales up from below 1, then rests at scale 1', async ({ page }) => {
  await openStoryboard(page, sb([kinetic({ words: [{ text: 'ساعات', at: 0.5 }], enter: 'pop' })]))
  await seek(page, 0.55)
  const early = await wordBox(page, 'ساعات')
  const s = Number(/scale\(([\d.]+)\)/.exec(early.transform)?.[1])
  expect(s).toBeGreaterThan(0.55)
  expect(s).toBeLessThan(0.95)
  await seek(page, 0.5 + KINETIC_TIMING.slideIn + 0.05)
  expect((await wordBox(page, 'ساعات')).transform).toBe('')
})

test('checklist rowPx: short rows set at about 100 px at 1080 w; each row key marks its own label for a highlight', async ({ page }) => {
  const items = [
    { text: 'اكتب السكربت', at: 0, key: 'r1' },
    { text: 'سجّل صوتك', at: 0.6, key: 'r2' },
    { text: 'خل المهارة', at: 1.2, key: 'r3' },
  ]
  await openStoryboard(
    page,
    sb([
      { id: 'c', type: 'checklist', start: 0, duration: 4, track: 1, params: { items, rowPx: 100 } },
      { id: 'h', type: 'highlight', start: 2, duration: 1, track: 3, params: { kind: 'underline', target: 'r2', drawIn: 0.15 } },
    ]),
  )
  await seek(page, 3)
  const px = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector<HTMLElement>('#frame [data-mba-part=checklist] > div')!).fontSize))
  expect(px).toBeGreaterThanOrEqual(90)
  expect(px).toBeLessThanOrEqual(110)
  const keyed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#frame [data-mba-key^=r]')].map((e) => [e.dataset.mbaKey, e.textContent]))
  expect(keyed).toEqual([
    ['r1', 'اكتب السكربت'],
    ['r2', 'سجّل صوتك'],
    ['r3', 'خل المهارة'],
  ])
  const issues = await page.evaluate(() => window.__mba.audit())
  expect(issues).toEqual([])
})

test('checklist y: the list is centred at y of the frame height (critic round 2), never outside the safe area', async ({ page }) => {
  const items = [
    { text: 'اكتب السكربت', at: 0 },
    { text: 'سجّل صوتك', at: 0 },
    { text: 'خل المهارة', at: 0 },
  ]
  const centre = async (y?: number) => {
    await openStoryboard(page, sb([{ id: 'c', type: 'checklist', start: 0, duration: 4, params: { items, rowPx: 100, ...(y !== undefined ? { y } : {}) } }]))
    await seek(page, 0.5)
    return page.evaluate(() => {
      const r = document.querySelector<HTMLElement>('#frame [data-mba-part=checklist] > div')!.getBoundingClientRect()
      return r.top + r.height / 2
    })
  }
  expect(Math.abs((await centre(0.5)) - 0.5 * 1920)).toBeLessThan(0.02 * 1920)
  expect(Math.abs((await centre()) - 0.46 * 1920)).toBeLessThan(0.02 * 1920)
  await centre(0.98)
  const issues = await page.evaluate(() => window.__mba.audit())
  expect(issues.filter((i: { rule: string }) => i.rule === 'outside-safe' || i.rule === 'clipped-by-frame')).toEqual([])
})

test('checklist pulse: a ticked row swells once after its check is drawn, then rests; off by default', async ({ page }) => {
  const items = [{ text: 'اكتب السكربت', at: 0.5 }]
  const rowScale = () =>
    page.evaluate(() => {
      const t = document.querySelector<HTMLElement>('#frame [data-mba-part=row]')!.style.transform
      return Number(/scale\(([\d.]+)\)/.exec(t)?.[1] ?? 1)
    })
  const mid = 0.5 + CHECKLIST_TIMING.rowIn + CHECKLIST_TIMING.checkIn + CHECKLIST_TIMING.pulse / 2
  await openStoryboard(page, sb([{ id: 'c', type: 'checklist', start: 0, duration: 3, params: { items, pulse: true } }]))
  await seek(page, mid)
  expect(await rowScale()).toBeCloseTo(CHECKLIST_TIMING.pulseScale, 2)
  await seek(page, mid + CHECKLIST_TIMING.pulse)
  expect(await rowScale()).toBe(1)
  await openStoryboard(page, sb([{ id: 'c', type: 'checklist', start: 0, duration: 3, params: { items } }]))
  await seek(page, mid)
  expect(await rowScale()).toBe(1)
})

test('checklist pulse: a row that fills the safe width stays inside it at the pulse peak (re-review of the fix wave)', async ({ page }) => {
  // 20 characters at rowPx 100 fill the safe width; the 1.15 pulse is inside the audit's rest tolerance, so the fit must reserve it.
  const items = [{ text: 'خل المهارة تحرّك كل شي', at: 0.5 }]
  const peak = 0.5 + CHECKLIST_TIMING.rowIn + CHECKLIST_TIMING.checkIn + CHECKLIST_TIMING.pulse / 2
  await openStoryboard(page, sb([{ id: 'c', type: 'checklist', start: 0, duration: 3, params: { items, rowPx: 100, pulse: true } }]))
  await seek(page, peak)
  const box = await page.evaluate(() => {
    const r = document.querySelector<HTMLElement>('#frame [data-mba-part=row]')!.getBoundingClientRect()
    return { left: r.left, right: r.right, scale: r.width }
  })
  // 9:16 safe area: 6 % side margins of 1080 px.
  const safe = { left: 0.06 * 1080, right: 0.94 * 1080 }
  expect(box.left).toBeGreaterThanOrEqual(safe.left - 2)
  expect(box.right).toBeLessThanOrEqual(safe.right + 2)
  const issues = await page.evaluate(() => window.__mba.audit())
  expect(issues.filter((i: { rule: string }) => i.rule === 'outside-safe' || i.rule === 'clipped-by-frame')).toEqual([])
})
