import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { openStoryboard, frameAt, freshFrameAt } from './helpers'

// 9:16 safe area (SAFE_AREA): x 64.8, y 268.8, w 885.6, h 1228.8.
const SAFE = { x: 64.8, y: 268.8, w: 885.6, h: 1228.8 }

type Box = { x0: number; y0: number; x1: number; y1: number }

const kinetic = (words: unknown[], mode: string, extra: Record<string, unknown> = {}) => ({
  id: 'k',
  type: 'kinetic-text',
  track: 3,
  start: 0,
  duration: 3,
  params: { words, mode, ...extra },
})

const sbOf = (scenes: unknown[]) => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 11,
  scenes: [{ id: 'b', type: 'backdrop', track: 0, start: 0, duration: 3, params: { world: 'paper' } }, ...scenes],
})

const moshn = (params: Record<string, unknown> = {}) =>
  sbOf([
    kinetic([{ text: 'موشن', at: 1.2, key: 'w-moshn' }], 'giant'),
    { id: 'p', type: 'particle-word', track: 4, start: 0, duration: 3, params: { target: 'w-moshn', from: { x: 0.5, y: 0.5 }, burst: 0.2, land: 1.2, ...params } },
  ])

const noError = async (page: Page) => expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()

type Img = { width: number; height: number; data: Buffer }
const read = (png: Buffer): Img => PNG.sync.read(png)

/** Accent-coloured pixels (the particles: #ff5a1f on the paper, anti-aliased edges included). */
function accentPixels(img: Img): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4
      const r = img.data[i]!, g = img.data[i + 1]!, b = img.data[i + 2]!
      if (r > 200 && r - g > 70 && r - b > 100) out.push({ x, y })
    }
  return out
}

const inside = (p: { x: number; y: number }, b: Box, pad: number) => p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad

/**
 * The keyed DOM word's glyph box in frame px (the frame is the viewport) at rest, i.e. after its
 * entrance (seek to `restT` first): horizontally its text run's Range rect, vertically the font's
 * ink above / below the baseline (canvas measureText), the same measure the highlight mark uses.
 */
async function glyphBox(page: Page, key: string, restT = 1.6): Promise<Box> {
  await frameAt(page, restT)
  return page.evaluate((k) => {
    const el = document.querySelector(`#frame [data-mba-key="${k}"]`)!
    const F = document.getElementById('frame')!.getBoundingClientRect()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const g = document.createElement('canvas').getContext('2d')!
    let box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? ''
      if (!text.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      const r = range.getBoundingClientRect()
      const cs = getComputedStyle(n.parentElement!)
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const m = g.measureText(text)
      const s = r.height / (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)
      const base = r.top + m.fontBoundingBoxAscent * s
      box = {
        x0: Math.min(box.x0, r.left - F.left),
        x1: Math.max(box.x1, r.right - F.left),
        y0: Math.min(box.y0, base - m.actualBoundingBoxAscent * s - F.top),
        y1: Math.max(box.y1, base + m.actualBoundingBoxDescent * s - F.top),
      }
    }
    return box
  }, key)
}

test('«موشن»: nothing before the burst; in flight outside the word at 0.7; ≥ 85 % inside the glyph box at land; DOM word opaque and audit clean at 1.6', async ({ page }) => {
  await openStoryboard(page, moshn())
  await noError(page)
  const canvas = await page.evaluate(() => {
    const el = document.querySelector('#frame [data-mba-part="particle-word"]') as HTMLCanvasElement | null
    return el && { tag: el.tagName, aria: el.getAttribute('aria-hidden'), n: Number(el.dataset.mbaParticles), text: el.textContent }
  })
  expect(canvas).toMatchObject({ tag: 'CANVAS', aria: 'true', text: '' })
  expect(canvas!.n).toBeGreaterThan(1000)
  expect(canvas!.n).toBeLessThanOrEqual(6000)

  expect(accentPixels(read(await frameAt(page, 0.1))), 'particle pixels before the burst').toHaveLength(0)

  const box = await glyphBox(page, 'w-moshn')
  expect(box.x1 - box.x0).toBeGreaterThan(300)
  const flying = accentPixels(read(await frameAt(page, 0.7)))
  expect(flying.filter((p) => !inside(p, box, 4)).length, 'accent pixels outside the word box at 0.7').toBeGreaterThan(500)

  const landed = accentPixels(read(await frameAt(page, 1.2)))
  expect(landed.length).toBeGreaterThan(5000)
  const share = landed.filter((p) => inside(p, box, 4)).length / landed.length
  expect(share, `share inside the glyph box at land (${landed.length} px)`).toBeGreaterThanOrEqual(0.85)

  await frameAt(page, 1.6)
  const opacity = await page.evaluate(() => {
    let el: Element | null = document.querySelector('#frame [data-mba-key="w-moshn"]')
    let o = 1
    for (; el && el.id !== 'frame'; el = el.parentElement) o *= Number(getComputedStyle(el).opacity)
    return o
  })
  expect(opacity).toBe(1)
  expect(accentPixels(read(await frameAt(page, 1.6))), 'particles gone after the hand-over').toHaveLength(0)
  expect(await page.evaluate(() => window.__mba.audit())).toEqual([])
})

test('a long word «بالعربي» at a smaller size: the particles land inside its glyph box (Review Focus 5)', async ({ page }) => {
  await openStoryboard(
    page,
    sbOf([
      kinetic([{ text: 'موشن', at: 0 }, { text: 'بالعربي', at: 1.2, key: 'w-arabi' }], 'line'),
      { id: 'p', type: 'particle-word', track: 4, start: 0, duration: 3, params: { target: 'w-arabi', from: { x: 0.3, y: 0.8 }, burst: 0.2, land: 1.2 } },
    ]),
  )
  await noError(page)
  const box = await glyphBox(page, 'w-arabi')
  // smaller than the giant word, still a real word
  expect(box.x1 - box.x0).toBeGreaterThan(150)
  expect(box.y1 - box.y0).toBeLessThan(260)
  const landed = accentPixels(read(await frameAt(page, 1.2)))
  expect(landed.length).toBeGreaterThan(800)
  const share = landed.filter((p) => inside(p, box, 4)).length / landed.length
  expect(share, `share inside «بالعربي»'s glyph box (${landed.length} px)`).toBeGreaterThanOrEqual(0.85)
  // the cloud covers the word end to end (both ends of a long word get particles)
  const xs = landed.filter((p) => inside(p, box, 4)).map((p) => p.x)
  expect(Math.min(...xs) - box.x0).toBeLessThan(0.08 * (box.x1 - box.x0))
  expect(box.x1 - Math.max(...xs)).toBeLessThan(0.08 * (box.x1 - box.x0))
  await frameAt(page, 1.6)
  expect(await page.evaluate(() => window.__mba.audit())).toEqual([])
})

test('from a morph-object scene: the burst starts at the dot', async ({ page }) => {
  const dot = { x: 0.3, y: 0.75 }
  await openStoryboard(
    page,
    sbOf([
      kinetic([{ text: 'موشن', at: 1.2, key: 'w-moshn' }], 'giant'),
      { id: 'h', type: 'morph-object', track: 4, start: 0, duration: 0.2, params: { states: [{ at: 0, object: 'dot', ...dot, size: 0.04 }], glow: false } },
      { id: 'p', type: 'particle-word', track: 4, start: 0, duration: 3, params: { target: 'w-moshn', from: { scene: 'h' }, burst: 0.2, land: 1.2 } },
    ]),
  )
  await noError(page)
  const early = accentPixels(read(await frameAt(page, 0.3)))
  expect(early.length).toBeGreaterThan(50)
  const cx = early.reduce((s, p) => s + p.x, 0) / early.length
  const cy = early.reduce((s, p) => s + p.y, 0) / early.length
  expect(Math.hypot(cx - (SAFE.x + dot.x * SAFE.w), cy - (SAFE.y + dot.y * SAFE.h)), `burst centre (${cx.toFixed(0)}, ${cy.toFixed(0)})`).toBeLessThan(60)
})

test('cold / warm: the same t gives the same pixels whatever was seeked before', async ({ page }) => {
  await openStoryboard(page, moshn())
  await noError(page)
  const cold = await freshFrameAt(page, 0.9)
  await freshFrameAt(page, 2.4)
  await freshFrameAt(page, 0.25)
  await freshFrameAt(page, 1.3)
  expect(Buffer.compare(cold, await freshFrameAt(page, 0.9))).toBe(0)
})
