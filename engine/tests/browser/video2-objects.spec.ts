import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { openStoryboard, frameAt, freshFrameAt } from './helpers'

// 9:16 safe area (SAFE_AREA): x 64.8, y 268.8, w 885.6, h 1228.8. Every state sits at safe (0.5, 0.5).
const SAFE_W = 885.6
const CX = 64.8 + 0.5 * SAFE_W
const CY = 268.8 + 0.5 * 1228.8

const dot = { at: 0, object: 'dot', x: 0.5, y: 0.5, size: 0.04 }
const st = (at: number, object: string, size: number, extra: Record<string, unknown> = {}) => ({ at, object, x: 0.5, y: 0.5, size, ...extra })

const sbOf = (states: unknown[], world: 'paper' | 'ink', duration: number) => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 7,
  scenes: [
    { id: 'b', type: 'backdrop', track: 0, start: 0, duration, params: { world } },
    { id: 'm', type: 'morph-object', track: 1, start: 0, duration, params: { states, glow: false } },
  ],
})

const noError = async (page: Page) => expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()

type Img = { width: number; height: number; data: Buffer }
const read = (png: Buffer): Img => PNG.sync.read(png)
const px = (img: Img, x: number, y: number): [number, number, number] => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]
}
/** Share of pixels in a box (frame px) that look like the signature accent (#FF5A1F-ish). */
const accentShare = (img: Img, x0: number, y0: number, x1: number, y1: number): number => {
  let n = 0
  let hit = 0
  for (let y = Math.round(y0); y < y1; y += 2)
    for (let x = Math.round(x0); x < x1; x += 2) {
      const [r, g, b] = px(img, x, y)
      n++
      if (r > 200 && g > 50 && g < 140 && b < 90) hit++
    }
  return hit / Math.max(1, n)
}
const meanLum = (img: Img, x0: number, y0: number, x1: number, y1: number): number => {
  let n = 0
  let sum = 0
  for (let y = Math.round(y0); y < y1; y += 2)
    for (let x = Math.round(x0); x < x1; x += 2) {
      const [r, g, b] = px(img, x, y)
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b
      n++
    }
  return sum / Math.max(1, n)
}

/** Crops a square of side `side` centred on (CX, cy) out of a frame. */
const crop = (img: Img, cy: number, side: number): PNG => {
  const out = new PNG({ width: side, height: side })
  const x0 = Math.round(CX - side / 2)
  const y0 = Math.round(cy - side / 2)
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const sx = Math.min(img.width - 1, Math.max(0, x0 + x))
      const sy = Math.min(img.height - 1, Math.max(0, y0 + y))
      const i = (sy * img.width + sx) * 4
      const o = (y * side + x) * 4
      for (let k = 0; k < 4; k++) out.data[o + k] = img.data[i + k]!
    }
  return out
}

/** Tiles PNGs (all `side` square) into rows of `cols`. */
const sheet = (tiles: PNG[], side: number, cols: number): PNG => {
  const rows = Math.ceil(tiles.length / cols)
  const out = new PNG({ width: cols * side, height: rows * side })
  out.data.fill(128)
  tiles.forEach((t, n) => {
    const ox = (n % cols) * side
    const oy = Math.floor(n / cols) * side
    for (let y = 0; y < side; y++) t.data.copy(out.data, ((oy + y) * out.width + ox) * 4, y * side * 4, (y + 1) * side * 4)
  })
  return out
}

test('Video 2 objects: dot → hard-hat → bulb → ai-chip → tool → magnifier → follow → compass → receipt: cold / warm identical mid-beat; the audit stays clean', async ({ page }) => {
  test.setTimeout(300_000)
  const states = [
    dot,
    st(1.0, 'hard-hat', 0.6),
    st(3.0, 'bulb', 0.4),
    st(4.6, 'ai-chip', 0.46),
    st(6.4, 'tool', 0.46),
    st(8.0, 'magnifier', 0.6),
    st(10.4, 'follow', 0.62),
    st(12.2, 'compass', 0.46),
    st(13.8, 'receipt', 0.4),
  ]
  // the heads popping, upset, the steam and the hat jump; the bulb's stutter and flicker; the
  // traces drawing and the pulses; the gear turning and the wrench's overshoot; the glass gliding,
  // the lens over a row, the check and its ring; the button pressed, confetti and «+1»; the needle
  // swinging and «ش» lighting; the slip printing, the strike and the stamp slamming
  const times = [1.2, 1.6, 2.25, 2.5, 3.32, 3.9, 4.95, 5.3, 6.82, 7.2, 8.9, 9.6, 10.86, 11.1, 12.6, 13.25, 14.0, 14.4, 14.75]
  const end = 15.5
  for (const world of ['paper', 'ink'] as const) {
    await openStoryboard(page, sbOf(states, world, end))
    await noError(page)
    for (const t of times) {
      const cold = await freshFrameAt(page, t)
      await freshFrameAt(page, end - 0.1)
      await freshFrameAt(page, 0.1)
      await freshFrameAt(page, t - 0.37)
      expect(Buffer.compare(cold, await freshFrameAt(page, t)), `${world}: cold / warm at ${t}`).toBe(0)
      expect(await page.evaluate(() => window.__mba.audit()), `${world}: audit at ${t}`).toEqual([])
    }
  }
  const part = await page.evaluate(() => [...document.querySelectorAll('#frame [data-mba-part="morph-object"]')].map((e) => ({ tag: e.tagName, aria: e.getAttribute('aria-hidden'), text: e.textContent })))
  expect(part).toEqual([{ tag: 'CANVAS', aria: 'true', text: '' }])
})

test('Video 2 beats: the bulb lights, the follow button fills accent, the check lands on the card, the receipt prints top-down and is stamped', async ({ page }) => {
  // the bulb: the globe is brighter / warmer once it is on
  await openStoryboard(page, sbOf([dot, st(1.0, 'bulb', 0.4)], 'ink', 3))
  await noError(page)
  const S = 0.4 * SAFE_W
  const globe = (img: Img) => meanLum(img, CX - 0.12 * S, CY - 0.3 * S, CX + 0.12 * S, CY - 0.08 * S)
  const off = globe(read(await frameAt(page, 1.0 + 0.25)))
  const on = globe(read(await frameAt(page, 1.0 + 0.9)))
  expect(on - off, `bulb ${off.toFixed(0)} → ${on.toFixed(0)}`).toBeGreaterThan(60)
  // the follow button: no accent before the press, accent after
  await openStoryboard(page, sbOf([dot, st(1.0, 'follow', 0.62)], 'paper', 3))
  await noError(page)
  const F = 0.62 * SAFE_W
  const btn = (img: Img) => accentShare(img, CX + (-0.09 - 0.15) * F, CY + (0.16 - 0.05) * F, CX + (-0.09 + 0.15) * F, CY + (0.16 + 0.05) * F)
  expect(btn(read(await frameAt(page, 1.0 + 0.35)))).toBeLessThan(0.02)
  expect(btn(read(await frameAt(page, 1.0 + 1.4)))).toBeGreaterThan(0.4)
  // the magnifier: the check mark's accent shows only after beats[0]
  await openStoryboard(page, sbOf([dot, st(1.0, 'magnifier', 0.6)], 'paper', 4))
  await noError(page)
  const M = 0.6 * SAFE_W
  const chk = (img: Img) => accentShare(img, CX + 0.05 * M, CY - 0.18 * M, CX + 0.46 * M, CY + 0.17 * M)
  expect(chk(read(await frameAt(page, 1.0 + 1.3)))).toBeLessThan(0.01)
  expect(chk(read(await frameAt(page, 1.0 + 2.3)))).toBeGreaterThan(0.04)
  // the receipt: half printed, its lower half is still empty; then struck and stamped (accent)
  await openStoryboard(page, sbOf([dot, st(1.0, 'receipt', 0.4)], 'ink', 3))
  await noError(page)
  const R = 0.4 * SAFE_W
  const lower = (img: Img) => meanLum(img, CX - 0.3 * R, CY + 0.25 * R, CX + 0.3 * R, CY + 0.45 * R)
  const half = read(await frameAt(page, 1.0 + 0.2))
  const full = read(await frameAt(page, 1.0 + 0.45))
  expect(lower(full) - lower(half), 'the bottom prints last').toBeGreaterThan(80)
  expect(accentShare(read(await frameAt(page, 1.0 + 1.6)), CX - 0.35 * R, CY - 0.2 * R, CX + 0.35 * R, CY + 0.2 * R)).toBeGreaterThan(0.05)
})

test('Video 2 stills: every new object fully built and at each beat, paper and ink (engine/out/video2-stills)', async ({ page }) => {
  test.setTimeout(400_000)
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const dir = 'out/video2-stills'
  mkdirSync(dir, { recursive: true })
  const SIDE = 720
  const only = process.env.STILLS_ONLY?.split(',')
  /** name, states after the dot (at 1.0), [label, seconds after 1.0][] */
  const shots: [string, unknown[], [string, number][]][] = [
    ['hard-hat', [st(1.0, 'hard-hat', 0.6)], [['pop', 0.3], ['built', 0.48], ['upset', 0.9], ['steam', 1.3], ['huff', 1.55]]],
    ['bulb', [st(1.0, 'bulb', 0.4)], [['off', 0.29], ['on', 0.55], ['lit', 1.4]]],
    ['ai-chip', [st(1.0, 'ai-chip', 0.46)], [['tracing', 0.35], ['built', 0.55], ['pulses', 1.3], ['glow', 2.2]]],
    ['tool', [st(1.0, 'tool', 0.46)], [['built', 0.39], ['turn', 0.6], ['sparkle', 0.75], ['spun', 1.6]]],
    ['magnifier', [st(1.0, 'magnifier', 0.6)], [['built', 0.45], ['glide', 0.95], ['stopped', 1.65], ['check', 2.1]]],
    ['follow', [st(1.0, 'follow', 0.62)], [['built', 0.39], ['press', 0.5], ['burst', 0.75], ['following', 1.6]]],
    ['compass', [st(1.0, 'compass', 0.46)], [['swing', 0.35], ['settling', 0.7], ['north', 1.3]]],
    ['receipt', [st(1.0, 'receipt', 0.4)], [['printing', 0.2], ['built', 0.45], ['strike', 0.68], ['stamp', 0.99], ['done', 1.6]]],
  ]
  for (const world of ['paper', 'ink'] as const) {
    const tiles: PNG[] = []
    for (const [name, states, times] of shots) {
      if (only && !only.includes(name)) continue
      await openStoryboard(page, sbOf([dot, ...states], world, 4))
      await noError(page)
      for (const [label, dt] of times) {
        const img = read(await frameAt(page, 1.0 + dt))
        const c = crop(img, CY, SIDE)
        writeFileSync(`${dir}/${world}-${name}-${label}.png`, PNG.sync.write(c))
        tiles.push(c)
      }
    }
    if (!only) writeFileSync(`${dir}/${world}-sheet.png`, PNG.sync.write(sheet(tiles, SIDE, 6)))
  }
})
