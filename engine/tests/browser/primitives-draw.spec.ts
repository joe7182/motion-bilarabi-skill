import { test, expect, type Page } from '@playwright/test'
import { openStoryboard, frameAt, unsanctionedArabicText } from './helpers'
import { LINE_ART_TIMING } from '../../src/core/params/line-art'

const GOLDEN = { maxDiffPixelRatio: 0.002 }

const storyboard = (type: string, params: Record<string, unknown>, duration = 2.5) => ({
  version: 1,
  format: '9:16',
  look: 'dark-tech',
  seed: 6,
  scenes: [{ id: 's', type, start: 0, duration, params }],
})

async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate((tt) => window.__mba.seek(tt), t)
}

async function noError(page: Page): Promise<void> {
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
}

/** [dashoffset, total length] of every stroked element of the line art. */
const dashes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<SVGGeometryElement>('#frame [data-mba-part=line-art] path')].map((el) => [
      parseFloat(el.getAttribute('stroke-dashoffset') ?? 'NaN'),
      el.getTotalLength(),
    ]),
  )

test.describe('line-art', () => {
  test('chart-up draws by dashoffset: length at 0, strictly between at 0.4, 0 once every path is done', async ({ page }) => {
    await openStoryboard(page, storyboard('line-art', { art: 'chart-up', drawIn: 0.8 }))
    await noError(page)
    await seek(page, 0)
    const at0 = await dashes(page)
    expect(at0.length).toBeGreaterThan(0)
    for (const [off, len] of at0) expect(off).toBeCloseTo(len!, 2)
    await seek(page, 0.4)
    for (const [off, len] of await dashes(page)) {
      expect(off).toBeGreaterThan(0)
      expect(off).toBeLessThan(len!)
    }
    const end = 0.8 + (at0.length - 1) * LINE_ART_TIMING.stagger
    for (const t of [end, end + 0.3]) {
      await seek(page, t)
      for (const [off] of await dashes(page)) expect(off).toBe(0)
    }
  })

  test('pure in t: seeking 0.6 → 0.2 → 0.6 gives identical pixels', async ({ page }) => {
    await openStoryboard(page, storyboard('line-art', { art: 'chart-up', drawIn: 0.8 }))
    await noError(page)
    const a = await frameAt(page, 0.6)
    const mid = await frameAt(page, 0.2)
    const b = await frameAt(page, 0.6)
    expect(mid.equals(a)).toBe(false)
    expect(b.equals(a)).toBe(true)
  })

  test('every line art builds without error', async ({ page }) => {
    const names = ['chart-up', 'speed-lines', 'arrow-curve', 'underline', 'circle-mark', 'bracket']
    await openStoryboard(page, {
      ...storyboard('line-art', {}),
      scenes: names.map((art, i) => ({ id: art, type: 'line-art', start: i, duration: 1, params: { art } })),
    })
    await noError(page)
  })
})

test.describe('icon', () => {
  test('label passes the text audit (sanctioned unit, rtl)', async ({ page }) => {
    await openStoryboard(page, storyboard('icon', { icon: 'lock', label: 'الأمان' }))
    await noError(page)
    await seek(page, 1)
    expect(await unsanctionedArabicText(page)).toEqual([])
    const issues = await page.evaluate(() => window.__mba.audit())
    expect(issues, JSON.stringify(issues)).toEqual([])
    const label = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('#frame [data-mba-text]')!
      return { text: el.textContent, dir: el.dir, lang: el.lang }
    })
    expect(label).toEqual({ text: 'الأمان', dir: 'rtl', lang: 'ar' })
  })

  test('draw: strokes self-draw, then settle', async ({ page }) => {
    await openStoryboard(page, storyboard('icon', { icon: 'lock' }))
    await noError(page)
    const offsets = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#frame [data-mba-part=icon] svg > *')].map((el) =>
          parseFloat(el.getAttribute('stroke-dashoffset') ?? 'NaN'),
        ),
      )
    await seek(page, 0)
    expect((await offsets()).every((o) => o > 0)).toBe(true)
    await seek(page, 2)
    expect((await offsets()).every((o) => o === 0)).toBe(true)
  })

  test('pop: scales 0 → 1 on a spring, strokes fully drawn', async ({ page }) => {
    await openStoryboard(page, storyboard('icon', { icon: 'rocket', enter: 'pop' }))
    await noError(page)
    const scale = () =>
      page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#frame [data-mba-part=icon-box]')!).transform).a)
    await seek(page, 0)
    expect(await scale()).toBeCloseTo(0, 3)
    await seek(page, 2)
    expect(await scale()).toBeCloseTo(1, 2)
  })

  test('lock at t = 1.0 matches the golden', async ({ page }) => {
    await openStoryboard(page, storyboard('icon', { icon: 'lock', label: 'الأمان' }))
    await noError(page)
    await frameAt(page, 1)
    await expect(page.locator('#frame')).toHaveScreenshot('icon-lock.png', GOLDEN)
  })
})
