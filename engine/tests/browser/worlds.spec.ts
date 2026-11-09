import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildReviewKit } from '../../src/node/review'
import { openStoryboard, frameAt, freshFrameAt } from './helpers'
import { DETAIL_BLANK, emptyFrames, frameDetail, hexToRgb, nearBlank } from '../../src/node/metrics'
import { contrastRatio } from '../../src/core/palette'

// paper-editorial tokens (src/runtime/looks.ts)
const CREAM = '#f3eadb'
const INK = '#141210'
const TOL = 6

const word = { id: 'w', type: 'kinetic-text', track: 1, start: 0, duration: 4, params: { words: [{ text: 'المال', at: 0 }] } }
const backdrops = (extra: Record<string, unknown> = {}) => [
  { id: 'b1', type: 'backdrop', track: 0, start: 0, duration: 2, params: { world: 'paper', ...extra } },
  { id: 'b2', type: 'backdrop', track: 0, start: 2, duration: 2, params: { world: 'ink', ...extra } },
]
const sbOf = (scenes: unknown[], transitions?: unknown[]) => ({
  version: 1,
  format: '9:16',
  look: 'paper-editorial',
  seed: 3,
  scenes,
  ...(transitions ? { transitions } : {}),
})

const rgbAt = (png: Buffer, x: number, y: number): [number, number, number] => {
  const img = PNG.sync.read(png)
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]
}
const near = (got: [number, number, number], hex: string) => {
  const want = hexToRgb(hex)
  got.forEach((v, i) => expect(Math.abs(v - want[i]!), `${got} vs ${hex}`).toBeLessThanOrEqual(TOL))
}
const seek = (page: Page, t: number) => page.evaluate((tt) => window.__mba.seek(tt), t)
const wordColours = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('#frame [data-mba-text="word"]')!
    return { color: getComputedStyle(el).color, bg: getComputedStyle(document.getElementById('frame')!).backgroundColor }
  })
const parseRgb = (css: string): [number, number, number] => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css)!
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
const hexOf = (c: [number, number, number]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
const gray = (png: Buffer) => {
  const img = PNG.sync.read(png)
  const g = new Uint8Array(img.width * img.height)
  for (let i = 0; i < g.length; i++) g[i] = Math.round(0.2126 * img.data[i * 4]! + 0.7152 * img.data[i * 4 + 1]! + 0.0722 * img.data[i * 4 + 2]!)
  return { g, w: img.width }
}

test('paper then ink backdrop: a hard flip at 2.0, the word follows the world, no audit issues', async ({ page }) => {
  await openStoryboard(page, sbOf([...backdrops(), word]))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  near(rgbAt(await frameAt(page, 1.9), 540, 100), CREAM)
  near(rgbAt(await frameAt(page, 2.0), 540, 100), INK)
  // The word's colour is the world's fg: cream on ink at 2.0, ink on cream before.
  const after = await wordColours(page)
  near(parseRgb(after.color), CREAM)
  near(parseRgb(after.bg), INK)
  const stats = await page.evaluate(() => window.__mba.auditStats())
  expect(stats.issues, JSON.stringify(stats.issues)).toEqual([])
  await seek(page, 1.9)
  near(parseRgb((await wordColours(page)).color), INK)
  // Pure in t: going back and forth lands on the same colours.
  near(rgbAt(await frameAt(page, 2.0), 540, 100), INK)
  near(rgbAt(await frameAt(page, 0.5), 540, 100), CREAM)
})

test('without a backdrop the root keeps the look colours at every time', async ({ page }) => {
  await openStoryboard(page, sbOf([word]))
  near(rgbAt(await frameAt(page, 1), 540, 100), CREAM)
})

test('pattern dots at alpha 0.12 moves between t = 0 and t = 3 and is not blank', async ({ page }) => {
  const sb = sbOf([{ id: 'b', type: 'backdrop', track: 0, start: 0, duration: 4, params: { world: 'paper', pattern: 'dots', patternAlpha: 0.12 } }])
  await openStoryboard(page, sb)
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  const a = await frameAt(page, 0)
  const b = await frameAt(page, 3)
  expect(Buffer.compare(a, b)).not.toBe(0)
  const { g, w } = gray(a)
  expect(frameDetail(g, w)).toBeGreaterThan(DETAIL_BLANK)
})

for (const pattern of ['stripes', 'ridges', 'shapes', 'blobs'] as const) {
  test(`pattern ${pattern} draws, moves and is not blank`, async ({ page }) => {
    const sb = sbOf([{ id: 'b', type: 'backdrop', track: 0, start: 0, duration: 4, params: { world: 'ink', pattern, patternAlpha: 0.3 } }])
    await openStoryboard(page, sb)
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    const a = await frameAt(page, 0.5)
    const b = await frameAt(page, 2.5)
    expect(Buffer.compare(a, b)).not.toBe(0)
    const { g, w } = gray(a)
    expect(frameDetail(g, w)).toBeGreaterThan(DETAIL_BLANK)
  })
}

test('the same time gives the same pixels whatever was seeked before (patterns are pure in t)', async ({ page }) => {
  const sb = sbOf([{ id: 'b', type: 'backdrop', track: 0, start: 0, duration: 4, params: { pattern: 'blobs', patternAlpha: 0.3 } }])
  await openStoryboard(page, sb)
  const first = await freshFrameAt(page, 1.7)
  await freshFrameAt(page, 3.3)
  expect(Buffer.compare(first, await freshFrameAt(page, 1.7))).toBe(0)
})

test('colour-wipe at the flip: no empty frame around the cut and the word stays readable (>= 4.5)', async ({ page }) => {
  const sb = sbOf([...backdrops(), word], [{ type: 'color-wipe', at: 2.0, duration: 0.4 }])
  await openStoryboard(page, sb)
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  const times = [1.967, 2.0, 2.033]
  const shots: Buffer[] = []
  for (const t of times) {
    shots.push(await frameAt(page, t))
    const c = await wordColours(page)
    expect(contrastRatio(hexOf(parseRgb(c.color)), hexOf(parseRgb(c.bg))), `t=${t}`).toBeGreaterThanOrEqual(4.5)
  }
  const grays = shots.map(gray)
  const flat = nearBlank(grays.map((x) => x.g), 30, DETAIL_BLANK, grays[0]!.w)
  const colours = shots.map((s) => {
    const img = PNG.sync.read(s)
    let r = 0, gg = 0, b = 0
    for (let i = 0; i < img.data.length; i += 4) { r += img.data[i]!; gg += img.data[i + 1]!; b += img.data[i + 2]! }
    const n = img.data.length / 4
    return [Math.round(r / n), Math.round(gg / n), Math.round(b / n)] as [number, number, number]
  })
  expect(emptyFrames(flat, 30, colours, [hexToRgb(CREAM), hexToRgb(INK)])).toEqual([])
})

test('mba review of the rendered paper/ink storyboard reports no blank frames (the ink frames are not empty)', async () => {
  test.setTimeout(180_000)
  const dir = await mkdtemp(join(tmpdir(), 'mba-worlds-'))
  try {
    const file = join(dir, 'worlds.json')
    await writeFile(file, JSON.stringify(sbOf([...backdrops(), word])))
    const m = await buildReviewKit({ storyboardPath: file, outDir: join(dir, 'out') })
    expect(m.nearBlankTimes).toEqual([])
    expect(m.frame0Blank).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
