import { test, expect } from '@playwright/test'
import { startRuntimeServer } from '../../src/node/render'

const FIXTURE = new URL('../fixtures/slam.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

test('preview: ?sb and ?t load the storyboard, "." steps one frame, "h" hides the UI', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/?sb=/examples/demo-ar.json&t=2')
  await page.waitForFunction(() => typeof window.__mba === 'object')
  await page.evaluate(() => window.__mba.ready)
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  expect(await page.evaluate(() => window.__mba.duration)).toBe(8)

  const time = page.locator('#time')
  await expect(time).toHaveText('2.00')
  await page.keyboard.press('.')
  await expect(time).toHaveText('2.03')
  await page.keyboard.press(',')
  await expect(time).toHaveText('2.00')

  await page.keyboard.press('ArrowRight')
  await expect(time).toHaveText('3.00')
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(time).toHaveText('0.00')

  // The frame keeps its internal size; only the wrapper scales it to fit the window.
  const style = await page.locator('#frame').evaluate((el) => ({ w: (el as HTMLElement).style.width, h: (el as HTMLElement).style.height, t: (el as HTMLElement).style.transform }))
  expect(style).toEqual({ w: '1080px', h: '1920px', t: '' })
  const box = await page.locator('#frame').boundingBox()
  expect(box!.height).toBeLessThanOrEqual(800)

  const controls = page.locator('#mba-controls')
  await expect(controls).toBeVisible()
  await page.keyboard.press('h')
  await expect(controls).toBeHidden()
  await page.keyboard.press('h')
  await expect(controls).toBeVisible()
})

test('preview: space plays from the wall clock and pauses', async ({ page }) => {
  await page.goto('/?sb=/examples/demo-ar.json&t=1')
  await page.evaluate(() => window.__mba.ready)
  const time = page.locator('#time')
  await expect(time).toHaveText('1.00')
  await page.keyboard.press(' ')
  await expect(time).not.toHaveText('1.00')
  await page.keyboard.press(' ')
  const paused = await time.textContent()
  await page.waitForTimeout(200)
  await expect(time).toHaveText(paused!)
  expect(Number(paused)).toBeGreaterThan(1)
})

test('render mode: no controls, #frame stays at (0,0) with its exact format size and no transform', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 })
  await page.addInitScript((sb) => {
    window.__MBA_STORYBOARD__ = sb
  }, { version: 1, scenes: [{ id: 'a', type: 'slam', start: 0, duration: 2, params: { text: 'جديد' } }] })
  await page.goto('/')
  await page.evaluate(() => window.__mba.ready)
  expect(await page.locator('#frame').boundingBox()).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
  expect(await page.locator('#mba-controls').count()).toBe(0)
  expect(await page.locator('#mba-fit').count()).toBe(0)
})

test('mba preview server serves the storyboard at /__sb.json and the page plays it', async ({ page }) => {
  const { server, url } = await startRuntimeServer(0, decodeURIComponent(FIXTURE))
  try {
    const res = await fetch(`${url}__sb.json`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { scenes: unknown[] }).scenes.length).toBeGreaterThan(0)
    await page.goto(`${url}?sb=/__sb.json&t=0.5`)
    await page.evaluate(() => window.__mba.ready)
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    await expect(page.locator('#time')).toHaveText('0.50')
  } finally {
    await server.close()
  }
})

test('preview: a bad storyboard shows its error on the page instead of a blank page', async ({ page }) => {
  const bad = { version: 1, scenes: [{ id: 'w', type: 'wipe-reveal', start: 0, duration: 2, params: { title: 'ا'.repeat(41) } }] }
  await page.route((url) => url.pathname === '/bad-sb.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(bad) }))
  await page.goto('/?sb=/bad-sb.json')
  await page.waitForFunction(() => typeof window.__mba === 'object')
  await page.evaluate(() => window.__mba.ready)
  expect(await page.evaluate(() => window.__mba.error)).toContain('scenes[0].params.title')
  const box = page.locator('#mba-error')
  await expect(box).toBeVisible()
  expect(await box.getAttribute('dir')).toBe('auto')
  const lines = await box.locator(':scope > *').allTextContents()
  expect(lines[0]).toMatch(/[؀-ۿ]/)
  expect(lines[1]).toContain('scenes[0].params.title')
})

test('render mode: a bad storyboard sets __mba.error and draws nothing extra', async ({ page }) => {
  await page.addInitScript((sb) => {
    window.__MBA_STORYBOARD__ = sb
  }, { version: 1, scenes: [{ id: 'w', type: 'wipe-reveal', start: 0, duration: 2, params: { title: 'ا'.repeat(41) } }] })
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__mba === 'object')
  await page.evaluate(() => window.__mba.ready)
  expect(await page.evaluate(() => window.__mba.error)).toContain('scenes[0].params.title')
  expect(await page.locator('#mba-error').count()).toBe(0)
})

test('mba preview server: a storyboard that becomes invalid shows its field path on the page', async ({ page }) => {
  const bad = new URL('../fixtures/wipe-long-title.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const { server, url } = await startRuntimeServer(0, decodeURIComponent(bad))
  try {
    await page.goto(`${url}?sb=/__sb.json`)
    await page.waitForFunction(() => typeof window.__mba === 'object')
    await page.evaluate(() => window.__mba.ready)
    await expect(page.locator('#mba-error')).toContainText('scenes[0].params.title')
  } finally {
    await server.close()
  }
})
