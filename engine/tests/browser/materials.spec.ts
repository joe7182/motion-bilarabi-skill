import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { openStoryboard, frameAt, freshFrameAt } from './helpers'
import { hexToRgb } from '../../src/node/metrics'

// signature look tokens (src/runtime/looks.ts, Global Constraints)
const CREAM = '#f3efe7'
const INK = '#16130f'
const TOL = 12

const sbOf = (params: Record<string, unknown>, extra: unknown[] = []) => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 7,
  scenes: [{ id: 'b', type: 'backdrop', track: 0, start: 0, duration: 2, params }, ...extra],
})

/** Mean RGB over the (2r+1)² patch centred at (cx, cy). */
const patchMean = (png: Buffer, cx: number, cy: number, r = 10): [number, number, number] => {
  const img = PNG.sync.read(png)
  let R = 0, G = 0, B = 0, n = 0
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      const i = (y * img.width + x) * 4
      R += img.data[i]!
      G += img.data[i + 1]!
      B += img.data[i + 2]!
      n++
    }
  return [R / n, G / n, B / n]
}
const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const near = (got: [number, number, number], hex: string) => {
  const want = hexToRgb(hex)
  got.forEach((v, i) => expect(Math.abs(v - want[i]!), `${got.map((x) => x.toFixed(1))} vs ${hex}`).toBeLessThanOrEqual(TOL))
}
const noError = async (page: Page) => expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()

test('signature paper material: the centre reads as the cream token, the corners are vignetted', async ({ page }) => {
  await openStoryboard(page, sbOf({ world: 'paper', material: {} }))
  await noError(page)
  const png = await frameAt(page, 1.0)
  near(patchMean(png, 540, 960), CREAM)
  // Vignette (radial, centre at 0.47 H): a corner is clearly darker than the centre.
  expect(lum(patchMean(png, 30, 30))).toBeLessThan(lum(patchMean(png, 540, 902)) - 8)
  // The material is a canvas with 64 px of bleed on every side, hidden from assistive tech.
  const box = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#frame [data-mba-part="backdrop-material"]')!
    const r = c.getBoundingClientRect()
    const f = document.getElementById('frame')!.getBoundingClientRect()
    return { w: c.width, h: c.height, x: r.left - f.left, y: r.top - f.top, aria: c.getAttribute('aria-hidden') }
  })
  expect(box).toEqual({ w: 1080 + 128, h: 1920 + 128, x: -64, y: -64, aria: 'true' })
})

test('grain moves every frame; the same time gives the same pixels whatever was seeked before (cold / warm)', async ({ page }) => {
  await openStoryboard(page, sbOf({ world: 'paper', material: {} }))
  await noError(page)
  const cold = await freshFrameAt(page, 1.0)
  const next = await freshFrameAt(page, 1.0333)
  expect(Buffer.compare(cold, next)).not.toBe(0)
  await freshFrameAt(page, 0.2)
  await freshFrameAt(page, 1.9)
  const warm = await freshFrameAt(page, 1.0)
  expect(Buffer.compare(cold, warm)).toBe(0)
})

test('signature ink material renders near the ink token at the centre', async ({ page }) => {
  await openStoryboard(page, sbOf({ world: 'ink', material: {} }))
  await noError(page)
  near(patchMean(await frameAt(page, 1.0), 540, 960), INK)
})

test('halftone darkens the bottom-left corner of the paper world (dot field from that corner)', async ({ page }) => {
  await openStoryboard(page, sbOf({ world: 'paper', material: { grain: 0, halftone: false } }))
  const off = lum(patchMean(await frameAt(page, 1.0), 60, 1860, 40))
  await openStoryboard(page, sbOf({ world: 'paper', material: { grain: 0, halftone: true } }))
  await noError(page)
  const png = await frameAt(page, 1.0)
  expect(lum(patchMean(png, 60, 1860, 40))).toBeLessThan(off - 1.5)
  // Far from the corner (top right) the field has faded out.
  const top = lum(patchMean(png, 1000, 80, 20))
  await openStoryboard(page, sbOf({ world: 'paper', material: { grain: 0, halftone: false } }))
  expect(Math.abs(lum(patchMean(await frameAt(page, 1.0), 1000, 80, 20)) - top)).toBeLessThan(0.5)
})

test('without material the backdrop has no canvas (the old backdrop)', async ({ page }) => {
  await openStoryboard(page, sbOf({ world: 'paper' }))
  await noError(page)
  expect(await page.evaluate(() => document.querySelectorAll('#frame canvas').length)).toBe(0)
  near(patchMean(await frameAt(page, 1.0), 540, 960), CREAM)
})

test('resolvedWorld reads the inherited --mba-* values of the element as hex; sceneCanvas bleeds and pre-translates', async ({ page }) => {
  await openStoryboard(page, sbOf({ world: 'paper' }))
  const r = await page.evaluate(async () => {
    const { resolvedWorld, sceneCanvas } = await import('/canvas.ts' as string)
    const outer = document.createElement('div')
    outer.style.setProperty('--mba-bg', '#ABCDEF')
    outer.style.setProperty('--mba-fg', 'rgb(1, 2, 3)')
    outer.style.setProperty('--mba-accent', '#ff5a1f')
    const inner = document.createElement('div')
    outer.append(inner)
    document.body.append(outer)
    const world = resolvedWorld(inner)
    inner.style.setProperty('--mba-bg', '#16130F')
    const overridden = resolvedWorld(inner).bg
    const layer = document.createElement('div')
    inner.append(layer)
    const plain = sceneCanvas({ layer, size: { w: 100, h: 50 } })
    const bled = sceneCanvas({ layer, size: { w: 100, h: 50 } }, { bleed: 8 })
    bled.g.fillStyle = '#ff0000'
    bled.g.fillRect(0, 0, 1, 1)
    const px = Array.from(bled.g.getImageData(8, 8, 1, 1).data)
    const t = plain.g.getTransform()
    outer.remove()
    return {
      world,
      overridden,
      plain: { w: plain.el.width, h: plain.el.height, left: plain.el.style.left, bleed: plain.bleed, e: t.e, f: t.f },
      bled: { w: bled.el.width, h: bled.el.height, left: bled.el.style.left, top: bled.el.style.top, bleed: bled.bleed, px },
    }
  })
  expect(r.world).toEqual({ bg: '#abcdef', fg: '#010203', accent: '#ff5a1f' })
  expect(r.overridden).toBe('#16130f')
  expect(r.plain).toEqual({ w: 100, h: 50, left: '0px', bleed: 0, e: 0, f: 0 })
  expect(r.bled).toEqual({ w: 116, h: 66, left: '-8px', top: '-8px', bleed: 8, px: [255, 0, 0, 255] })
})
