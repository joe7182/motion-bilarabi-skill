import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { openStoryboard, frameAt, freshFrameAt } from './helpers'

// 9:16 safe area (SAFE_AREA): x 64.8, y 268.8, w 885.6, h 1228.8. Every state sits at safe (0.5, 0.5).
const SAFE_W = 885.6
const CX = 64.8 + 0.5 * SAFE_W
const CY = 268.8 + 0.5 * 1228.8
const DOT_D = 0.04 * SAFE_W
const COIN_D = 0.38 * SAFE_W
/** Task 6b: the timeline's video track centre, in units of the state size below the window centre. */
const TL_VIDEO_MID = -0.1

const dot = { at: 0, object: 'dot', x: 0.5, y: 0.5, size: 0.04 }
const coin = { at: 1.0, object: 'coin', x: 0.5, y: 0.5, size: 0.38, spin: 1 }

const sbOf = (params: Record<string, unknown>, extra: unknown[] = []) => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 7,
  scenes: [
    { id: 'b', type: 'backdrop', track: 0, start: 0, duration: 3, params: { world: 'paper' } },
    { id: 'm', type: 'morph-object', track: 1, start: 0, duration: 3, params },
    ...extra,
  ],
})

const noError = async (page: Page) => expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()

type Img = { width: number; height: number; data: Buffer }
const read = (png: Buffer): Img => PNG.sync.read(png)
const px = (img: Img, x: number, y: number): [number, number, number] => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]
}
const diff = (a: [number, number, number], b: [number, number, number]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))

/**
 * The drawn shape's box around (CX, CY) on a 64 px coverage thumbnail: a square of side `side`
 * centred on the object is cut into 64 × 64 cells, each counting its pixels that differ from the
 * background; a row of cells covers `rows[r]` pixel rows, so width = the widest thumbnail row
 * (Σ hits / rows[r], its mean chord), height = the tallest column likewise. Anti-aliased edges
 * count by their share, so the box is accurate to a pixel or so.
 */
function shapeBox(png: Buffer, side: number): { w: number; h: number } {
  const img = read(png)
  const bg = px(img, 20, 20)
  const N = 64
  const cell = side / N
  const hit: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0))
  const rows = new Array<number>(N).fill(0)
  const cols = new Array<number>(N).fill(0)
  const x0 = CX - side / 2
  const y0 = CY - side / 2
  const xs = [Math.max(0, Math.ceil(x0)), Math.min(img.width, Math.ceil(x0 + side))] as const
  const ys = [Math.max(0, Math.ceil(y0)), Math.min(img.height, Math.ceil(y0 + side))] as const
  const band = (v: number, o: number) => Math.min(N - 1, Math.floor((v - o) / cell))
  for (let y = ys[0]; y < ys[1]; y++) rows[band(y, y0)]!++
  for (let x = xs[0]; x < xs[1]; x++) cols[band(x, x0)]!++
  for (let y = ys[0]; y < ys[1]; y++)
    for (let x = xs[0]; x < xs[1]; x++) if (diff(px(img, x, y), bg) > 24) hit[band(y, y0)]![band(x, x0)]!++
  let w = 0
  let h = 0
  for (let r = 0; r < N; r++) if (rows[r]) w = Math.max(w, hit[r]!.reduce((s, v) => s + v, 0) / rows[r]!)
  for (let c = 0; c < N; c++) if (cols[c]) h = Math.max(h, hit.reduce((s, row) => s + row[c]!, 0) / cols[c]!)
  return { w, h }
}

test('dot → coin: at the state time the box is the coin (±4 %); mid-move it is strictly between dot and coin', async ({ page }) => {
  await openStoryboard(page, sbOf({ states: [dot, coin], glow: false }))
  await noError(page)
  const side = COIN_D * 2
  const atCoin = shapeBox(await frameAt(page, 1.0), side)
  expect(Math.abs(atCoin.w - COIN_D) / COIN_D, `coin box ${atCoin.w.toFixed(1)} × ${atCoin.h.toFixed(1)} vs ${COIN_D}`).toBeLessThanOrEqual(0.04)
  expect(Math.abs(atCoin.h - COIN_D) / COIN_D).toBeLessThanOrEqual(0.04)
  const atDot = shapeBox(await frameAt(page, 0.3), side)
  expect(Math.abs(atDot.w - DOT_D) / DOT_D, `dot box ${atDot.w.toFixed(1)}`).toBeLessThanOrEqual(0.15)
  // The move starts at at − 0.35 (0.65) on the soft spring: 0.7 is mid-morph.
  const mid = shapeBox(await frameAt(page, 0.7), side)
  expect(mid.w, `mid box ${mid.w.toFixed(1)}`).toBeGreaterThan(DOT_D * 1.2)
  expect(mid.w).toBeLessThan(COIN_D * 0.9)
})

test('the coin carries the currency sign: AED and USD differ in the sign region; cold / warm frames are identical', async ({ page }) => {
  const r = COIN_D / 2
  const region = async (currency: string) => {
    await openStoryboard(page, sbOf({ states: [dot, coin], glow: false, currency }))
    await noError(page)
    return read(await frameAt(page, 1.6))
  }
  const aed = await region('AED')
  const usd = await region('USD')
  let differing = 0
  for (let y = CY - 0.45 * r; y <= CY + 0.45 * r; y++)
    for (let x = CX - 0.45 * r; x <= CX + 0.45 * r; x++) if (diff(px(aed, x, y), px(usd, x, y)) > 30) differing++
  expect(differing, 'pixels that differ between the AED and USD signs').toBeGreaterThan(300)
  // Cold / warm: the same time gives the same pixels whatever was seeked before.
  await openStoryboard(page, sbOf({ states: [dot, coin], rings: [0.2] }))
  const cold = await freshFrameAt(page, 0.83)
  await freshFrameAt(page, 2.4)
  await freshFrameAt(page, 0.1)
  await freshFrameAt(page, 1.3)
  expect(Buffer.compare(cold, await freshFrameAt(page, 0.83))).toBe(0)
})

test('rings: a thin accent ring ~160 px from the centre at 0.5, gone by 1.5', async ({ page }) => {
  await openStoryboard(page, sbOf({ states: [dot], rings: [0.2], glow: false }))
  await noError(page)
  /** How many of 16 rays from the centre cross a non-background pixel between radii r0 and r1. */
  const raysHit = (img: Img, r0: number, r1: number) => {
    const bg = px(img, 20, 20)
    let hits = 0
    for (let k = 0; k < 16; k++) {
      const a = (2 * Math.PI * k) / 16
      for (let rr = r0; rr <= r1; rr += 0.5) {
        if (diff(px(img, CX + rr * Math.cos(a), CY + rr * Math.sin(a)), bg) > 12) {
          hits++
          break
        }
      }
    }
    return hits
  }
  const early = read(await frameAt(page, 0.5))
  expect(raysHit(early, 135, 195)).toBeGreaterThanOrEqual(14)
  // Not a filled disc: the ring is thin (inside it, near the dot, the paper shows).
  expect(raysHit(early, 40, 110)).toBe(0)
  expect(raysHit(read(await frameAt(page, 1.5)), 40, 330)).toBe(0)
})

test('glow: true paints accent-tinted pixels outside the coin rim; glow: false leaves the paper there', async ({ page }) => {
  const at = { x: CX, y: CY - 1.3 * (COIN_D / 2) }
  await openStoryboard(page, sbOf({ states: [dot, coin], glow: false }))
  const plain = read(await frameAt(page, 1.6))
  const bg = px(plain, 20, 20)
  expect(diff(px(plain, at.x, at.y), bg)).toBeLessThanOrEqual(2)
  await openStoryboard(page, sbOf({ states: [dot, coin] }))
  await noError(page)
  const lit = px(read(await frameAt(page, 1.6)), at.x, at.y)
  // Towards the accent (#ff5a1f): green and blue drop, red holds.
  expect(bg[1] - lit[1], `${lit} vs paper ${bg}`).toBeGreaterThan(6)
  expect(bg[2] - lit[2]).toBeGreaterThan(6)
  expect(lit[0]).toBeGreaterThanOrEqual(bg[0] - 3)
})

test('a canvas only (aria-hidden, no DOM text): the audit is clean; exports().at gives the object in frame px', async ({ page }) => {
  const peek = `() => [{
    id: '_peek',
    build(ctx) {
      const info = ctx.sceneParams('m')
      return { update(t) { const ex = info && info.exports(); window.__peek = ex && ex.at(t) } }
    },
  }]`
  await openStoryboard(
    page,
    sbOf({ states: [dot, { ...coin, at: 1.0, x: 0.25, y: 0.75 }, { at: 2.0, object: 'clock', x: 0.5, y: 0.5, size: 0.3 }], key: 'hero-object' }, [
      { id: 'p', type: '_peek', track: 2, start: 0, duration: 3, params: {} },
    ]),
    { testPrimitives: peek },
  )
  await noError(page)
  const part = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#frame [data-mba-part="morph-object"]')]
    return els.map((e) => ({ tag: e.tagName, aria: e.getAttribute('aria-hidden'), key: (e as HTMLElement).dataset.mbaKey, text: e.textContent }))
  })
  expect(part).toEqual([{ tag: 'CANVAS', aria: 'true', key: 'hero-object', text: '' }])
  for (const t of [0.5, 1.0, 1.6, 2.2, 2.9]) {
    await frameAt(page, t)
    expect(await page.evaluate(() => window.__mba.audit()), `audit at ${t}`).toEqual([])
  }
  await frameAt(page, 1.0)
  const at1 = await page.evaluate(() => (window as unknown as { __peek: { x: number; y: number; r: number } }).__peek)
  expect(at1.x).toBeCloseTo(64.8 + 0.25 * SAFE_W, 3)
  expect(at1.y).toBeCloseTo(268.8 + 0.75 * 1228.8, 3)
  expect(at1.r).toBeCloseTo(COIN_D / 2, 3)
})

// ------------------------------------------------------------------ Task 6b: meaningful objects

/** Pixels of `img` in the box that differ from `ref` by more than `thr` (per channel max). */
const countDiff = (img: Img, ref: [number, number, number], x0: number, x1: number, y0: number, y1: number, thr: number) => {
  let n = 0
  for (let y = Math.ceil(y0); y < y1; y++) for (let x = Math.ceil(x0); x < x1; x++) if (diff(px(img, x, y), ref) > thr) n++
  return n
}

test('document: the lines write themselves (fewer line pixels at 1.2 than at 1.5); at 1.6 six line bars are on the page', async ({ page }) => {
  const size = 0.5
  const w = size * SAFE_W
  const h = 1.26 * w
  const doc = { at: 1.0, object: 'document', x: 0.5, y: 0.5, size }
  await openStoryboard(page, sbOf({ states: [dot, doc], glow: false }))
  await noError(page)
  const left = CX - w / 2
  const top = CY - h / 2
  // the text column: inside the margins, below the fold
  const box = [left + 0.05 * w, CX + w / 2 - 0.05 * w, top + 0.2 * w, top + h - 0.04 * w] as const
  const linePixels = (img: Img) => countDiff(img, px(img, left + 0.04 * w, CY), ...box, 60)
  const at12 = read(await frameAt(page, 1.2))
  const at15 = read(await frameAt(page, 1.5))
  expect(linePixels(at12), 'line pixels at 1.2').toBeGreaterThan(0)
  expect(linePixels(at12), 'line pixels at 1.2 vs 1.5').toBeLessThan(linePixels(at15) * 0.8)
  // bands of rows holding line pixels = the line bars
  const bands = (img: Img) => {
    const paper = px(img, left + 0.04 * w, CY)
    let n = 0
    let inBand = false
    for (let y = Math.ceil(box[2]); y < box[3]; y++) {
      let hit = false
      for (let x = Math.ceil(box[0]); x < box[1] && !hit; x++) hit = diff(px(img, x, y), paper) > 60
      if (hit && !inBand) n++
      inBand = hit
    }
    return n
  }
  expect(bands(read(await frameAt(page, 1.6))), 'line bars at 1.6').toBe(6)
  expect(bands(at12), 'line bars at 1.2').toBeLessThan(6)
})

test('microphone: the level bars follow the voice — levels rising 0 → 1 give > 3× the bar height at the end', async ({ page }) => {
  const size = 0.4
  const H = size * SAFE_W
  const levels = Array.from({ length: 60 }, (_, i) => i / 59)
  const mic = { at: 1.0, object: 'microphone', x: 0.5, y: 0.5, size, levels }
  await openStoryboard(page, sbOf({ states: [dot, mic], glow: false }))
  await noError(page)
  const bars = (img: Img) => {
    const bg = px(img, 20, 20)
    return (
      countDiff(img, bg, CX - 1.1 * H, CX - 0.47 * H, CY - 0.5 * H, CY + 0.5 * H, 40) +
      countDiff(img, bg, CX + 0.47 * H, CX + 1.1 * H, CY - 0.5 * H, CY + 0.5 * H, 40)
    )
  }
  const start = bars(read(await frameAt(page, 1.4)))
  const end = bars(read(await frameAt(page, 2.9)))
  expect(start, 'bar pixels at 1.4').toBeGreaterThan(0)
  expect(end / start, `bar pixels ${start} → ${end}`).toBeGreaterThan(3)
  // without levels the bars still move (seeded idle motion), pure in t
  await openStoryboard(page, sbOf({ states: [dot, { ...mic, levels: undefined }], glow: false }))
  await noError(page)
  const a = bars(read(await frameAt(page, 1.6)))
  const b = bars(read(await frameAt(page, 2.2)))
  expect(a).toBeGreaterThan(0)
  expect(a).not.toBe(b)
})

test('timeline: at its build end the playhead is further left than 0.2 s earlier, and a clip has a cut gap', async ({ page }) => {
  const size = 0.4
  const S = size * SAFE_W
  const tl = { at: 1.0, object: 'timeline', x: 0.5, y: 0.5, size }
  await openStoryboard(page, sbOf({ states: [dot, tl], glow: false }))
  await noError(page)
  const buildEnd = 1.0 + 0.6
  /** Mean x of accent pixels in the ruler band (only the playhead head is accent there). */
  const playheadX = (img: Img) => {
    let sum = 0
    let n = 0
    for (let y = Math.ceil(CY - 0.305 * S); y < CY - 0.255 * S; y++)
      for (let x = Math.ceil(CX - 0.75 * S); x < CX + 0.75 * S; x++) {
        const [r, g, b] = px(img, x, y)
        if (r > 200 && g < 150 && b < 110) {
          sum += x
          n++
        }
      }
    return n ? sum / n : NaN
  }
  const before = read(await frameAt(page, buildEnd - 0.2))
  const end = read(await frameAt(page, buildEnd))
  const x0 = playheadX(before)
  const x1 = playheadX(end)
  expect(Number.isFinite(x0) && Number.isFinite(x1), `playhead found: ${x0}, ${x1}`).toBe(true)
  expect(x1, 'the playhead sweeps right → left').toBeLessThan(x0 - 2)
  // the video track's middle row: runs of window colour between clip pixels are cut gaps
  const y = CY + TL_VIDEO_MID * S
  const win = px(end, CX, CY + 0.42 * S)
  const clip: boolean[] = []
  for (let x = Math.ceil(CX - 0.75 * S); x < CX + 0.75 * S; x++) clip.push(diff(px(end, x, y), win) > 40)
  const first = clip.indexOf(true)
  const last = clip.lastIndexOf(true)
  let gaps = 0
  let run = 0
  for (let i = first; i <= last; i++) {
    if (!clip[i]) run++
    else {
      if (run >= 2) gaps++
      run = 0
    }
  }
  expect(first, 'video clips on the track').toBeGreaterThanOrEqual(0)
  expect(gaps, 'cut gaps in the video track').toBeGreaterThanOrEqual(1)
})

test('document, microphone and timeline: cold / warm frames are identical; the audit stays clean (decorative canvas text)', async ({ page }) => {
  const levels = Array.from({ length: 30 }, (_, i) => (i % 7) / 6)
  await openStoryboard(page, {
    ...sbOf({}),
    scenes: [
      { id: 'b', type: 'backdrop', track: 0, start: 0, duration: 4.5, params: { world: 'ink' } },
      {
        id: 'm',
        type: 'morph-object',
        track: 1,
        start: 0,
        duration: 4.5,
        params: {
          glow: false,
          states: [
            dot,
            { at: 1.0, object: 'document', x: 0.5, y: 0.5, size: 0.5, text: 'السكربت' },
            { at: 2.0, object: 'microphone', x: 0.5, y: 0.5, size: 0.4, levels },
            { at: 3.0, object: 'timeline', x: 0.5, y: 0.5, size: 0.4, text: 'تحرّك', levels },
          ],
        },
      },
    ],
  })
  await noError(page)
  for (const t of [1.3, 2.3, 3.4]) {
    const cold = await freshFrameAt(page, t)
    await freshFrameAt(page, 4.2)
    await freshFrameAt(page, 0.1)
    await freshFrameAt(page, t - 0.37)
    expect(Buffer.compare(cold, await freshFrameAt(page, t)), `cold / warm at ${t}`).toBe(0)
    expect(await page.evaluate(() => window.__mba.audit()), `audit at ${t}`).toEqual([])
  }
})

// ------------------------------------------------------------------ Task 6c: script objects

/** Accent-coloured pixels (the signature accent #ff5a1f and its light/dark shading). */
const isAccent = ([r, g, b]: [number, number, number]) => r > 200 && g < 150 && b < 110
const countAccent = (img: Img, x0: number, x1: number, y0: number, y1: number) => {
  let n = 0
  for (let y = Math.ceil(y0); y < y1; y++) for (let x = Math.ceil(x0); x < x1; x++) if (isAccent(px(img, x, y))) n++
  return n
}

test('calendar: every flipSec the page flips (the header changes); X marks cross the days off', async ({ page }) => {
  const size = 0.45
  const S = size * SAFE_W
  const cal = { at: 1.0, object: 'calendar', x: 0.5, y: 0.5, size }
  await openStoryboard(page, { ...sbOf({}), scenes: [{ id: 'b', type: 'backdrop', track: 0, start: 0, duration: 3.5, params: { world: 'paper' } }, { id: 'm', type: 'morph-object', track: 1, start: 0, duration: 3.5, params: { states: [dot, cal], glow: false } }] })
  await noError(page)
  const top = CY - 0.55 * S
  const idle = 1.0 + 0.6
  const t = idle + 0.05
  const a = read(await frameAt(page, t))
  const b = read(await frameAt(page, t + 0.45))
  // the header band (the month name on the accent bar) differs after one flip
  let differing = 0
  for (let y = Math.ceil(top + 0.04 * S); y < top + 0.22 * S; y++)
    for (let x = Math.ceil(CX - 0.42 * S); x < CX + 0.42 * S; x++) if (diff(px(a, x, y), px(b, x, y)) > 40) differing++
  expect(differing, 'header pixels that change over one flipSec').toBeGreaterThan(150)
  expect(countAccent(a, CX - 0.4 * S, CX + 0.4 * S, top + 0.05 * S, top + 0.2 * S), 'the accent header bar').toBeGreaterThan(0.3 * 0.8 * S * 0.15 * S)
  // X marks (accent strokes) in the day grid: more of them over 1 s, and more later in a page than early
  const grid = (img: Img) => countAccent(img, CX - 0.45 * S, CX + 0.45 * S, top + 0.36 * S, top + 1.07 * S)
  const x0 = grid(a)
  const x1 = grid(read(await frameAt(page, t + 1.0)))
  expect(x1, `X pixels ${x0} → ${x1} over 1 s`).toBeGreaterThan(x0 * 1.5 + 200)
  expect(grid(read(await frameAt(page, idle + 0.2)))).toBeGreaterThan(grid(read(await frameAt(page, idle + 0.08))))
})

test('envelope: the flap opens, then invoices slide up out of it (more invoice pixels above the envelope at +1.2 s)', async ({ page }) => {
  const size = 0.4
  const S = size * SAFE_W
  const env = { at: 1.0, object: 'envelope', x: 0.5, y: 0.5, size }
  await openStoryboard(page, sbOf({ states: [dot, env], glow: false }))
  await noError(page)
  const buildEnd = 1.0 + 0.5
  /** Invoice-page pixels (white, lighter than the paper world and the envelope) above the envelope's top edge. */
  const above = (img: Img) => {
    let n = 0
    for (let y = Math.ceil(CY - 1.05 * S); y < CY - 0.47 * S; y++)
      for (let x = Math.ceil(CX - 0.7 * S); x < CX + 0.7 * S; x++) if (Math.min(...px(img, x, y)) >= 252) n++
    return n
  }
  const atEnd = above(read(await frameAt(page, buildEnd)))
  const later = above(read(await frameAt(page, buildEnd + 1.2)))
  expect(later, `invoice pixels above the envelope ${atEnd} → ${later}`).toBeGreaterThan(atEnd + 0.4 * S * 0.3 * S)
  // the invoices carry accent totals
  expect(countAccent(read(await frameAt(page, buildEnd + 1.2)), CX - 0.7 * S, CX + 0.7 * S, CY - 1.05 * S, CY - 0.2 * S)).toBeGreaterThan(80)
  // closed at arrival: nothing above the envelope top
  const closed = read(await frameAt(page, 1.0))
  expect(countDiff(closed, px(closed, 20, 20), CX - 0.7 * S, CX + 0.7 * S, CY - 1.05 * S, CY - 0.5 * S, 30)).toBeLessThan(0.02 * S * S)
})

test('bell: it swings (the bell shifts sideways between two times 0.3 s apart) and sticky notes pop in around it', async ({ page }) => {
  const size = 0.45
  const S = size * SAFE_W
  const bell = { at: 1.0, object: 'bell', x: 0.5, y: 0.5, size }
  await openStoryboard(page, sbOf({ states: [dot, bell], glow: false }))
  await noError(page)
  const strike = 1.0 + 0.4
  const centroidX = (img: Img) => {
    let sx = 0
    let n = 0
    for (let y = Math.ceil(CY - 0.3 * S); y < CY + 0.36 * S; y++)
      for (let x = Math.ceil(CX - 0.5 * S); x < CX + 0.5 * S; x++)
        if (isAccent(px(img, x, y))) {
          sx += x
          n++
        }
    return n ? sx / n : NaN
  }
  const a = read(await frameAt(page, strike + 0.1))
  const b = read(await frameAt(page, strike + 0.4))
  const xa = centroidX(a)
  const xb = centroidX(b)
  expect(Number.isFinite(xa) && Number.isFinite(xb), `bell found: ${xa}, ${xb}`).toBe(true)
  expect(Math.abs(xa - xb), `bell centroid ${xa.toFixed(1)} vs ${xb.toFixed(1)}`).toBeGreaterThan(8)
  // notes: pixels around the bell, outside its swing zone
  const notes = (img: Img) => {
    const bg = px(img, 20, 20)
    let n = 0
    for (let y = Math.ceil(CY - 0.95 * S); y < CY + 0.95 * S; y++)
      for (let x = Math.ceil(CX - 0.95 * S); x < CX + 0.95 * S; x++) {
        if (Math.abs(x - CX) < 0.62 * S && Math.abs(y - CY) < 0.5 * S) continue
        if (diff(px(img, x, y), bg) > 30) n++
      }
    return n
  }
  const early = notes(read(await frameAt(page, strike + 0.05)))
  const late = notes(read(await frameAt(page, strike + 1.5)))
  expect(late, `note pixels ${early} → ${late}`).toBeGreaterThan(early + 4 * (0.22 * S) ** 2 * 0.5)
})

test('voice-note: the waveform follows the voice — levels rising 0 → 1 give > 3× the bar pixels at the end', async ({ page }) => {
  const size = 0.5
  const S = size * SAFE_W
  const levels = Array.from({ length: 60 }, (_, i) => i / 59)
  const vn = { at: 1.0, object: 'voice-note', x: 0.5, y: 0.5, size, levels }
  await openStoryboard(page, { ...sbOf({}), scenes: [{ id: 'b', type: 'backdrop', track: 0, start: 0, duration: 3.5, params: { world: 'paper' } }, { id: 'm', type: 'morph-object', track: 1, start: 0, duration: 3.5, params: { states: [dot, vn], glow: false } }] })
  await noError(page)
  const sweep = 1.0 + 0.5
  const bars = (img: Img) => countDiff(img, px(img, CX, CY + 0.16 * S), CX - 0.62 * S, CX + 0.3 * S, CY - 0.1 * S, CY + 0.08 * S, 40)
  const start = bars(read(await frameAt(page, sweep + 0.15)))
  const end = bars(read(await frameAt(page, sweep + 1.55)))
  expect(start, 'bar pixels just after the sweep starts').toBeGreaterThan(0)
  expect(end / start, `bar pixels ${start} → ${end}`).toBeGreaterThan(3)
  // the play button sits on the right (RTL): accent there, none at the left end
  const img = read(await frameAt(page, sweep + 1.55))
  expect(countAccent(img, CX + 0.36 * S, CX + 0.58 * S, CY - 0.11 * S, CY + 0.11 * S)).toBeGreaterThan(0.5 * Math.PI * (0.11 * S) ** 2)
})

test('phone-app: a notification card slides into the top third at +0.6 s; the paid check is there at checkAt + 0.3 s', async ({ page }) => {
  const size = 0.45
  const S = size * SAFE_W
  const ph = { at: 1.0, object: 'phone-app', x: 0.5, y: 0.5, size }
  await openStoryboard(page, sbOf({ states: [dot, ph], glow: false }))
  await noError(page)
  const screenTop = CY - 0.52 * S
  const third = (img: Img) => countAccent(img, CX - 0.25 * S, CX + 0.25 * S, screenTop, screenTop + 0.347 * S)
  expect(third(read(await frameAt(page, 1.3))), 'no accent in the top third before the notification').toBeLessThan(20)
  expect(third(read(await frameAt(page, 1.6))), 'the notification card (its accent bell) in the top third').toBeGreaterThan(150)
  const disc = (img: Img) => {
    let n = 0
    let all = 0
    const r = 0.1 * S
    for (let y = Math.ceil(CY - r); y < CY + r; y++)
      for (let x = Math.ceil(CX - r); x < CX + r; x++) {
        if (Math.hypot(x - CX, y - CY) > r) continue
        all++
        if (isAccent(px(img, x, y))) n++
      }
    return n / all
  }
  expect(disc(read(await frameAt(page, 1.0 + 1.2 - 0.1))), 'no check before checkAt').toBeLessThan(0.05)
  const check = read(await frameAt(page, 1.0 + 1.2 + 0.3))
  expect(disc(check), 'the accent check disc at the screen centre').toBeGreaterThan(0.55)
  // the ✓ itself: light pixels inside the disc
  let light = 0
  for (let y = Math.ceil(CY - 0.08 * S); y < CY + 0.08 * S; y++) for (let x = Math.ceil(CX - 0.08 * S); x < CX + 0.08 * S; x++) if (px(check, x, y)[1] > 200) light++
  expect(light, 'check-mark pixels').toBeGreaterThan(40)
  // a later checkAt moves the check
  await openStoryboard(page, sbOf({ states: [dot, { ...ph, checkAt: 1.6 }], glow: false }))
  expect(disc(read(await frameAt(page, 1.0 + 1.2 + 0.3))), 'checkAt 1.6: no check yet at +1.5').toBeLessThan(0.05)
})

test('calendar, envelope, bell, voice-note and phone-app: cold / warm frames are identical; the audit stays clean (decorative canvas text)', async ({ page }) => {
  const levels = Array.from({ length: 45 }, (_, i) => (i % 9) / 8)
  await openStoryboard(page, {
    ...sbOf({}),
    scenes: [
      { id: 'b', type: 'backdrop', track: 0, start: 0, duration: 9, params: { world: 'ink' } },
      {
        id: 'm',
        type: 'morph-object',
        track: 1,
        start: 0,
        duration: 9,
        params: {
          glow: false,
          currency: 'SAR',
          states: [
            dot,
            { at: 1.0, object: 'calendar', x: 0.5, y: 0.5, size: 0.45, flipSec: 0.5 },
            { at: 2.6, object: 'envelope', x: 0.5, y: 0.5, size: 0.4 },
            { at: 4.0, object: 'bell', x: 0.5, y: 0.5, size: 0.45 },
            { at: 5.4, object: 'voice-note', x: 0.5, y: 0.5, size: 0.5, levels },
            { at: 7.0, object: 'phone-app', x: 0.5, y: 0.5, size: 0.45, checkAt: 1.0 },
          ],
        },
      },
    ],
  })
  await noError(page)
  for (const t of [1.9, 3.4, 4.8, 6.3, 8.5]) {
    const cold = await freshFrameAt(page, t)
    await freshFrameAt(page, 8.9)
    await freshFrameAt(page, 0.1)
    await freshFrameAt(page, t - 0.37)
    expect(Buffer.compare(cold, await freshFrameAt(page, t)), `cold / warm at ${t}`).toBe(0)
    expect(await page.evaluate(() => window.__mba.audit()), `audit at ${t}`).toEqual([])
  }
  const part = await page.evaluate(() => [...document.querySelectorAll('#frame [data-mba-part="morph-object"]')].map((e) => ({ tag: e.tagName, aria: e.getAttribute('aria-hidden'), text: e.textContent })))
  expect(part).toEqual([{ tag: 'CANVAS', aria: 'true', text: '' }])
})

test('lift shadow is history-free: clock → document mid-move on paper is identical cold and after a glow frame (Task 7 verify)', async ({ page }) => {
  const states = [
    { at: 0, object: 'dot', x: 0.5, y: 0.62, size: 0.07 },
    { at: 0.333, object: 'clock', x: 0.5, y: 0.62, size: 0.4 },
    { at: 0.867, object: 'document', x: 0.5, y: 0.62, size: 0.4 },
  ]
  const sb = { ...sbOf({ states }), scenes: [{ id: 'b', type: 'backdrop', track: 0, start: 0, duration: 4, params: { world: 'paper' } }, { id: 'm', type: 'morph-object', track: 1, start: 0, duration: 4, params: { states } }] }
  await openStoryboard(page, sb)
  await noError(page)
  const cold = await freshFrameAt(page, 0.733)
  // A frame with the clock's glow (a radial gradient) drawn before: it used to change the blurred shadow.
  await frameAt(page, 0.2)
  expect(Buffer.compare(cold, await freshFrameAt(page, 0.733))).toBe(0)
  // The page still casts a soft shadow below it on paper (darker than the paper beside it).
  const img = PNG.sync.read(await freshFrameAt(page, 2))
  const lum = (x: number, y: number) => {
    const i = (y * img.width + x) * 4
    return img.data[i]! + img.data[i + 1]! + img.data[i + 2]!
  }
  const below = 268.8 + 0.62 * 1228.8 + (1.26 * 0.4 * 885.6) / 2 + 0.06 * 0.8 * 885.6 * 0.5
  expect(lum(Math.round(CX), Math.round(below))).toBeLessThan(lum(Math.round(CX), Math.round(below + 120)) - 3)
})

// ------------------------------------------------------------------ Stage 1A: the house reel's objects

test('Stage 1A: dot → brick → house → blueprint → eye → photo → chat → coin (IQD): cold / warm frames identical, mid-scramble and mid-beat included; the audit stays clean', async ({ page }) => {
  test.setTimeout(180_000)
  const st = (at: number, object: string, size: number, extra: Record<string, unknown> = {}) => ({ at, object, x: 0.5, y: 0.5, size, ...extra })
  for (const world of ['paper', 'ink'] as const) {
    await openStoryboard(page, {
      ...sbOf({}),
      scenes: [
        { id: 'b', type: 'backdrop', track: 0, start: 0, duration: 14.5, params: { world } },
        {
          id: 'm',
          type: 'morph-object',
          track: 1,
          start: 0,
          duration: 14.5,
          params: {
            glow: false,
            currency: 'IQD',
            states: [
              dot,
              st(1.0, 'brick', 0.45),
              st(1.6, 'brick', 0.45, { y: 0.6, text: 'fall', land: true }),
              st(2.2, 'house', 0.5),
              st(4.4, 'blueprint', 0.4),
              st(7.2, 'eye', 0.5),
              st(8.8, 'photo', 0.45),
              st(10.0, 'chat', 0.5),
              st(13.4, 'coin', 0.4, { spin: 1 }),
            ],
          },
        },
      ],
    })
    await noError(page)
    // brick build, falling streaks, house pen / lights, mid-scramble, mid-signature, eye closing,
    // the photo flash, chat send / typing / reply drawing, chat → coin mid-morph, the coin
    for (const t of [1.3, 1.65, 2.9, 3.3, 5.75, 6.3, 7.9, 9.1, 10.6, 11.6, 12.5, 13.2, 13.9]) {
      const cold = await freshFrameAt(page, t)
      await freshFrameAt(page, 14.4)
      await freshFrameAt(page, 0.1)
      await freshFrameAt(page, t - 0.37)
      expect(Buffer.compare(cold, await freshFrameAt(page, t)), `${world}: cold / warm at ${t}`).toBe(0)
      expect(await page.evaluate(() => window.__mba.audit()), `${world}: audit at ${t}`).toEqual([])
    }
  }
  const part = await page.evaluate(() => [...document.querySelectorAll('#frame [data-mba-part="morph-object"]')].map((e) => ({ tag: e.tagName, aria: e.getAttribute('aria-hidden'), text: e.textContent })))
  expect(part).toEqual([{ tag: 'CANVAS', aria: 'true', text: '' }])
})

test('Stage 1A beats: the house lights up, the blueprint numbers scramble, the eye is struck through, the photo flashes, the chat sends', async ({ page }) => {
  const open1 = async (object: string, size: number, world: 'paper' | 'ink' = 'paper') => {
    await openStoryboard(page, { ...sbOf({}), scenes: [{ id: 'b', type: 'backdrop', track: 0, start: 0, duration: 5, params: { world } }, { id: 'm', type: 'morph-object', track: 1, start: 0, duration: 5, params: { states: [dot, { at: 1.0, object, x: 0.5, y: 0.5, size }], glow: false } }] })
    await noError(page)
    return size * SAFE_W
  }
  /** Warm pixels (the lit windows: strong red, mid green, low blue). */
  const warm = (img: Img, x0: number, x1: number, y0: number, y1: number) => {
    let n = 0
    for (let y = Math.ceil(y0); y < y1; y++) for (let x = Math.ceil(x0); x < x1; x++) {
      const [r, g, b] = px(img, x, y)
      if (r > 220 && g > 120 && b < 140 && r - b > 100) n++
    }
    return n
  }
  // house: dark windows at its build end, lit by checkAt (0.9) + 5 × 0.12 + 0.25
  let S = await open1('house', 0.5)
  const before = warm(read(await frameAt(page, 1.0 + 0.85)), CX - 0.5 * S, CX + 0.5 * S, CY - 0.45 * S, CY + 0.45 * S)
  const lit = warm(read(await frameAt(page, 1.0 + 1.9)), CX - 0.5 * S, CX + 0.5 * S, CY - 0.45 * S, CY + 0.45 * S)
  expect(lit, `warm window pixels ${before} → ${lit}`).toBeGreaterThan(before + 0.02 * S * S)
  // blueprint: the dimension labels change every 0.09 s after the build (1.2 s), not before
  S = await open1('blueprint', 0.4)
  const band = (a: Img, b: Img) => {
    let n = 0
    for (let y = Math.ceil(CY - 0.56 * S); y < CY - 0.46 * S; y++) for (let x = Math.ceil(CX - 0.3 * S); x < CX + 0.45 * S; x++) if (diff(px(a, x, y), px(b, x, y)) > 40) n++
    return n
  }
  expect(band(read(await frameAt(page, 1.0 + 1.3)), read(await frameAt(page, 1.0 + 1.4))), 'labels scramble after the build').toBeGreaterThan(20)
  // eye: after the close and the slash, accent pixels run along the diagonal (top-left → bottom-right)
  S = await open1('eye', 0.5)
  const slashed = read(await frameAt(page, 1.0 + 1.2))
  const onDiag = [-0.4, -0.2, 0.2, 0.4].filter((f) => isAccent(px(slashed, CX + f * S, CY + f * S * (0.34 / 0.58)))).length
  expect(onDiag, 'accent slash across the eye').toBe(4)
  expect(isAccent(px(read(await frameAt(page, 1.0 + 0.5)), CX - 0.4 * S, CY - 0.4 * S * (0.34 / 0.58))), 'no slash before the beat').toBe(false)
  // photo: the flash whitens the image (mean channel ≥ 235 just after the shot), then it develops
  S = await open1('photo', 0.45)
  const mean = (img: Img) => {
    let sum = 0
    let n = 0
    for (let y = Math.ceil(CY - 0.4 * S); y < CY + 0.25 * S; y += 3) for (let x = Math.ceil(CX - 0.3 * S); x < CX + 0.3 * S; x += 3) {
      sum += Math.min(...px(img, x, y))
      n++
    }
    return sum / n
  }
  expect(mean(read(await frameAt(page, 1.0 + 0.22))), 'flash').toBeGreaterThan(235)
  expect(mean(read(await frameAt(page, 1.0 + 0.9))), 'developed').toBeLessThan(170)
  // chat: the photo flies from the composer up into the sent bubble on the right
  S = await open1('chat', 0.45)
  const thumb = (img: Img, y0: number, y1: number) => countDiff(img, px(img, CX, CY), CX + 0.2 * S, CX + 0.62 * S, CY + y0 * S, CY + y1 * S, 90)
  const pre = read(await frameAt(page, 1.0 + 0.45))
  const post = read(await frameAt(page, 1.0 + 1.0))
  expect(thumb(pre, -0.3, -0.06), 'nothing sent before the beat').toBeLessThan(20)
  expect(thumb(post, -0.3, -0.06), 'the photo in the sent bubble').toBeGreaterThan(0.02 * S * S)
})

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

test('Stage 1A stills: every new object at full build and at its second beat, paper and ink (engine/out/stage1a-stills)', async ({ page }) => {
  test.setTimeout(240_000)
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const dir = 'out/stage1a-stills'
  mkdirSync(dir, { recursive: true })
  const SIDE = 640
  /** object, size, extra state fields, [label, seconds after at][] */
  const shots: [string, number, Record<string, unknown>, [string, number][]][] = [
    ['brick', 0.5, {}, [['build', 0.6]]],
    ['brick', 0.5, { fall: true }, [['fall', 1.08]]],
    ['house', 0.55, { checkAt: 9 }, [['build', 1.1]]],
    ['house', 0.55, {}, [['lit', 2.0]]],
    ['blueprint', 0.42, { checkAt: 9 }, [['build', 1.3]]],
    ['blueprint', 0.42, {}, [['signed', 2.5]]],
    ['eye', 0.55, { checkAt: 9 }, [['open', 0.5], ['look', 1.4]]],
    ['eye', 0.55, {}, [['closing', 0.7], ['slashed', 1.2]]],
    ['photo', 0.5, {}, [['frame', 0.12], ['flash', 0.3], ['developed', 0.9]]],
    ['chat', 0.45, { checkAt: 9 }, [['build', 0.5]]],
    ['chat', 0.45, {}, [['sending', 0.75], ['typing', 1.5], ['reply', 2.6], ['drawn', 3.4]]],
    ['coin', 0.42, { spin: 0 }, [['iqd', 0.6]]],
  ]
  for (const world of ['paper', 'ink'] as const) {
    const tiles: PNG[] = []
    for (const [object, size, extra, times] of shots) {
      const { fall, ...rest } = extra
      const st = { at: 1.0, object, x: 0.5, y: 0.5, size, ...rest }
      // a falling brick: brick → the same brick lower, arriving with text 'fall' and a landing squash
      const states = fall ? [dot, { ...st, y: 0.3 }, { ...st, at: 2.0, text: 'fall', land: true }] : [dot, st]
      await openStoryboard(page, {
        ...sbOf({}),
        scenes: [
          { id: 'b', type: 'backdrop', track: 0, start: 0, duration: 5, params: { world } },
          { id: 'm', type: 'morph-object', track: 1, start: 0, duration: 5, params: { states, glow: false, currency: 'IQD' } },
        ],
      })
      await noError(page)
      for (const [label, dt] of times) {
        const img = read(await frameAt(page, 1.0 + dt))
        const c = crop(img, CY, SIDE)
        writeFileSync(`${dir}/${world}-${object}-${label}.png`, PNG.sync.write(c))
        tiles.push(c)
      }
    }
    writeFileSync(`${dir}/${world}-sheet.png`, PNG.sync.write(sheet(tiles, SIDE, 5)))
  }
})
