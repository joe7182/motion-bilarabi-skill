import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { openStoryboard, frameAt, freshFrameAt } from './helpers'

// 9:16 safe area (SAFE_AREA): x 64.8, y 268.8, w 885.6, h 1228.8.
const SAFE_W = 885.6

type Pose = { pursuer: { x: number; y: number }; figures: { x: number; y: number }[] }

const sbOf = (params: Record<string, unknown>, world = 'paper', duration = 3) => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 7,
  scenes: [
    { id: 'b', type: 'backdrop', track: 0, start: 0, duration, params: { world } },
    { id: 'c', type: 'chase', track: 1, start: 0, duration, params },
    { id: 'p', type: '_peek', track: 2, start: 0, duration, params: {} },
  ],
})

/** A test primitive that keeps the chase scene's info on window, so its exports can be read at any t. */
const peek = `() => [{
  id: '_peek',
  build(ctx) {
    window.__chase = ctx.sceneParams('c')
    return { update() {} }
  },
}]`

const open = (page: Page, params: Record<string, unknown>, world?: string, duration?: number) => openStoryboard(page, sbOf(params, world, duration), { testPrimitives: peek })
const noError = async (page: Page) => expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
const poses = (page: Page, ts: number[]): Promise<Pose[]> =>
  page.evaluate((tt) => {
    const ex = (window as unknown as { __chase: { exports(): { kind: string; at(t: number): Pose } } }).__chase.exports()
    return tt.map((t) => ex.at(t))
  }, ts)

type Img = { width: number; height: number; data: Buffer }
const read = (png: Buffer): Img => PNG.sync.read(png)
const px = (img: Img, x: number, y: number): [number, number, number] => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]
}
const diff = (a: [number, number, number], b: [number, number, number]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))

test('chase: customer figures run ahead of the accent pursuer; they move; it never comes within 0.05 safe widths', async ({ page }) => {
  await open(page, {})
  await noError(page)
  await frameAt(page, 0.5)
  const ts = Array.from({ length: 91 }, (_, i) => i / 30)
  const all = await poses(page, ts)
  for (const [i, p] of all.entries()) {
    expect(p.figures, `t ${ts[i]}`).toHaveLength(4)
    const d = Math.min(...p.figures.map((f) => Math.hypot(f.x - p.pursuer.x, f.y - p.pursuer.y)))
    expect(d / SAFE_W, `pursuer to the nearest figure at ${ts[i]!.toFixed(2)}`).toBeGreaterThanOrEqual(0.05)
  }
  // two times 0.5 s apart: every figure moved, and so did the pixels
  const [a, b] = await poses(page, [1.0, 1.5])
  a!.figures.forEach((f, i) => expect(Math.hypot(f.x - b!.figures[i]!.x, f.y - b!.figures[i]!.y), `figure ${i}`).toBeGreaterThan(20))
  const fa = read(await frameAt(page, 1.0))
  const fb = read(await frameAt(page, 1.5))
  // figures are drawn in the fg colour where the exports say; the pursuer in the accent
  const near = (img: Img, at: { x: number; y: number }, r: number, test: (c: [number, number, number]) => boolean) => {
    let n = 0
    for (let y = Math.ceil(at.y - r); y < at.y + r; y++) for (let x = Math.ceil(at.x - r); x < at.x + r; x++) if (test(px(img, x, y))) n++
    return n
  }
  const dark = (c: [number, number, number]) => c[0] < 90 && c[1] < 90 && c[2] < 90
  const accent = ([r, g, bl]: [number, number, number]) => r > 200 && g < 150 && bl < 110
  for (const f of a!.figures) expect(near(fa, { x: f.x, y: f.y - 0.04 * SAFE_W }, 0.05 * SAFE_W, dark), 'figure pixels').toBeGreaterThan(60)
  expect(near(fa, a!.pursuer, 0.03 * SAFE_W, accent), 'pursuer pixels').toBeGreaterThan(200)
  let moved = 0
  for (let y = 300; y < 1480; y += 2) for (let x = 80; x < 1000; x += 2) if (diff(px(fa, x, y), px(fb, x, y)) > 40) moved++
  expect(moved, 'pixels that change between 1.0 and 1.5').toBeGreaterThan(500)
})

test('chase: a canvas only (aria-hidden, no DOM text), audit clean; cold / warm identical; 7 customers on ink', async ({ page }) => {
  await open(page, { customers: 7, size: 0.5, laps: 1.6, key: 'chase' }, 'ink')
  await noError(page)
  const part = await page.evaluate(() =>
    [...document.querySelectorAll('#frame [data-mba-part="chase"]')].map((e) => ({ tag: e.tagName, aria: e.getAttribute('aria-hidden'), key: (e as HTMLElement).dataset.mbaKey, text: e.textContent })),
  )
  expect(part).toEqual([{ tag: 'CANVAS', aria: 'true', key: 'chase', text: '' }])
  for (const t of [0.1, 0.6, 1.4, 2.2, 2.9]) {
    await frameAt(page, t)
    expect(await page.evaluate(() => window.__mba.audit()), `audit at ${t}`).toEqual([])
  }
  const [p] = await poses(page, [1.2])
  expect(p!.figures).toHaveLength(7)
  for (const t of [0.4, 1.3, 2.6]) {
    const cold = await freshFrameAt(page, t)
    await freshFrameAt(page, 2.9)
    await freshFrameAt(page, 0.05)
    await freshFrameAt(page, t - 0.37)
    expect(Buffer.compare(cold, await freshFrameAt(page, t)), `cold / warm at ${t}`).toBe(0)
  }
})
