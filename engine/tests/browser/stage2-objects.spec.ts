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
    { id: 'm', type: 'morph-object', track: 1, start: 0, duration, params: { states, glow: false, currency: 'IQD' } },
  ],
})

const noError = async (page: Page) => expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()

type Img = { width: number; height: number; data: Buffer }
const read = (png: Buffer): Img => PNG.sync.read(png)
const px = (img: Img, x: number, y: number): [number, number, number] => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]
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

test('Stage 2 objects: dot → scale → materials → sun → room → pin → window (rays, glass, zero) → sun-path → file → bricks (iraqi → gulf → thermostone → measure): cold / warm identical mid-beat; the audit stays clean', async ({ page }) => {
  test.setTimeout(300_000)
  // two storyboards (a morph scene holds at most 12 states)
  const runs: { states: unknown[]; times: number[]; end: number }[] = [
    {
      states: [
        dot,
        st(1.0, 'scale', 0.56, { text: '٩٥٬٠٠٠٬٠٠٠ د.ع' }),
        st(3.2, 'materials', 0.6),
        st(6.0, 'sun', 0.42),
        st(7.6, 'room', 0.58),
        st(10.0, 'pin', 0.55, { text: 'بغداد' }),
        st(11.4, 'window', 0.46),
        st(13.4, 'window', 0.46, { text: 'glass', beats: [1.2] }),
        st(16.0, 'window', 0.46, { text: 'zero' }),
      ],
      // the bills dropping and the beam swinging, the «؟» card fading in, a material bouncing, the
      // floors splitting, the sun rising and its rays growing, summer and winter coming in, the pin
      // landing, the meter counting, the double pane sliding, the low sun crossing and the pulse
      times: [1.45, 1.75, 2.3, 3.7, 5.0, 6.35, 6.7, 8.15, 9.2, 10.27, 11.9, 14.8, 15.0, 16.6, 17.1],
      end: 18,
    },
    {
      states: [
        dot,
        st(1.0, 'sun-path', 0.62),
        st(4.2, 'file', 0.36, { text: 'مخطط-بيتك.html' }),
        st(7.0, 'brick', 0.42),
        st(7.8, 'brick', 0.42, { text: 'gulf' }),
        st(8.6, 'brick', 0.42, { text: 'thermostone' }),
        st(9.4, 'brick', 0.42, { text: 'measure' }),
      ],
      // the summer and winter suns travelling, the stamp slamming, the tiles fanning and struck,
      // the brick → brick crossfades and the dimensions drawing
      times: [1.7, 2.9, 4.5, 5.7, 7.6, 7.65, 8.45, 9.25, 9.8],
      end: 10.5,
    },
  ]
  for (const run of runs)
    for (const world of ['paper', 'ink'] as const) {
      await openStoryboard(page, sbOf(run.states, world, run.end))
      await noError(page)
      for (const t of run.times) {
        const cold = await freshFrameAt(page, t)
        await freshFrameAt(page, run.end - 0.1)
        await freshFrameAt(page, 0.1)
        await freshFrameAt(page, t - 0.37)
        expect(Buffer.compare(cold, await freshFrameAt(page, t)), `${world}: cold / warm at ${t}`).toBe(0)
        expect(await page.evaluate(() => window.__mba.audit()), `${world}: audit at ${t}`).toEqual([])
      }
    }
  const part = await page.evaluate(() => [...document.querySelectorAll('#frame [data-mba-part="morph-object"]')].map((e) => ({ tag: e.tagName, aria: e.getAttribute('aria-hidden'), text: e.textContent })))
  expect(part).toEqual([{ tag: 'CANVAS', aria: 'true', text: '' }])
})

test('Stage 2 beats: the beam tips toward the bills, the room tints hot then cold, the window zero mode lets no light into the gap', async ({ page }) => {
  // the scale: the right pan hangs lower after the bills land than before
  await openStoryboard(page, sbOf([dot, st(1.0, 'scale', 0.56)], 'paper', 4))
  await noError(page)
  const S = 0.56 * SAFE_W
  const brassRows = (img: Img, x: number) => {
    // the lowest brass pixel row in a column (the pan's bottom)
    for (let y = Math.round(CY + 0.5 * S); y > CY - 0.5 * S; y--) {
      const [r, g, b] = px(img, x, y)
      if (r > 150 && g > 100 && b < 110 && r - b > 70) return y
    }
    return -1
  }
  const before = read(await frameAt(page, 1.0 + 0.45))
  const after = read(await frameAt(page, 1.0 + 1.8))
  const rightBefore = brassRows(before, CX + 0.42 * S)
  const rightAfter = brassRows(after, CX + 0.42 * S)
  const leftAfter = brassRows(after, CX - 0.42 * S)
  expect(rightAfter - rightBefore, `right pan ${rightBefore} → ${rightAfter}`).toBeGreaterThan(0.04 * S)
  expect(rightAfter - leftAfter, 'the right pan is below the left').toBeGreaterThan(0.08 * S)
  // the room: hotter (more red than blue) in summer, bluer in winter
  await openStoryboard(page, sbOf([dot, st(1.0, 'room', 0.58)], 'paper', 4))
  await noError(page)
  const R = 0.58 * SAFE_W
  const tint = (img: Img) => {
    let rb = 0
    let n = 0
    for (let y = CY - 0.3 * R; y < CY + 0.3 * R; y += 6) for (let x = CX - 0.45 * R; x < CX + 0.45 * R; x += 6) {
      const [r, , b] = px(img, x, y)
      rb += r - b
      n++
    }
    return rb / n
  }
  const neutral = tint(read(await frameAt(page, 1.0 + 0.35)))
  const summer = tint(read(await frameAt(page, 1.0 + 1.0)))
  const winter = tint(read(await frameAt(page, 1.0 + 2.4)))
  expect(summer, `summer ${summer.toFixed(1)} vs neutral ${neutral.toFixed(1)}`).toBeGreaterThan(neutral + 15)
  expect(winter, `winter ${winter.toFixed(1)}`).toBeLessThan(neutral - 15)
  // the window, zero mode: the gap below the neighbour's wall top stays dark while the sun crosses
  await openStoryboard(page, sbOf([dot, st(1.0, 'window', 0.46, { text: 'zero' })], 'paper', 4))
  await noError(page)
  const W = 0.46 * SAFE_W
  const img = read(await frameAt(page, 1.0 + 1.0))
  for (const fy of [-0.2, 0.0, 0.2]) {
    const [r, g, b] = px(img, CX, CY + fy * W)
    expect(Math.max(r, g, b), `gap at ${fy} is in shadow`).toBeLessThan(120)
  }
})

test('Stage 2 stills: every new object fully built and at each beat, paper and ink (engine/out/stage2-stills)', async ({ page }) => {
  test.setTimeout(400_000)
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const dir = 'out/stage2-stills'
  mkdirSync(dir, { recursive: true })
  const SIDE = 720
  const only = process.env.STILLS_ONLY?.split(',')
  /** name, states after the dot (at 1.0), [label, seconds after 1.0][] */
  const shots: [string, unknown[], [string, number][]][] = [
    ['scale', [st(1.0, 'scale', 0.56)], [['build', 0.35], ['drop', 0.5], ['tipped', 1.1], ['card', 2.2]]],
    ['materials', [st(1.0, 'materials', 0.6)], [['one', 0.3], ['grid', 1.3], ['split', 1.85], ['floors', 2.6]]],
    ['sun', [st(1.0, 'sun', 0.42)], [['rising', 0.3], ['rays', 0.65], ['full', 1.6]]],
    ['room', [st(1.0, 'room', 0.58)], [['built', 0.35], ['summer', 1.0], ['winter', 2.6]]],
    ['pin', [st(1.0, 'pin', 0.55)], [['map', 0.15], ['landing', 0.3], ['label', 0.9]]],
    ['window-rays', [st(1.0, 'window', 0.46)], [['counting', 0.7], ['rays', 1.6]]],
    ['window-glass', [st(1.0, 'window', 0.46, { text: 'glass' })], [['before', 1.3], ['pane', 1.75], ['down', 2.6]]],
    ['window-zero', [st(1.0, 'window', 0.46, { text: 'zero' })], [['crossing', 0.8], ['pulse', 1.2], ['after', 2.0]]],
    ['sun-path', [st(1.0, 'sun-path', 0.62)], [['arcs', 0.45], ['summer', 1.0], ['summer-end', 1.6], ['winter', 2.3], ['done', 3.0]]],
    ['file', [st(1.0, 'file', 0.36)], [['built', 0.35], ['stamp', 0.6], ['tiles', 1.6], ['struck', 2.3]]],
    ['brick-gulf', [st(1.0, 'brick', 0.42, { text: 'gulf' })], [['built', 0.7]]],
    ['brick-thermostone', [st(1.0, 'brick', 0.42, { text: 'thermostone' })], [['built', 0.7]]],
    ['brick-measure', [st(1.0, 'brick', 0.42, { text: 'measure' })], [['built', 1.0]]],
    ['brick-cross', [st(1.0, 'brick', 0.42), st(2.0, 'brick', 0.42, { text: 'thermostone' })], [['mid', 0.85], ['done', 1.3]]],
  ]
  for (const world of ['paper', 'ink'] as const) {
    const tiles: PNG[] = []
    for (const [name, states, times] of shots) {
      if (only && !only.includes(name)) continue
      await openStoryboard(page, sbOf([dot, ...states], world, 5))
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
