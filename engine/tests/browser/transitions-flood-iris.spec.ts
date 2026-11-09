import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { openStoryboard, freshFrameAt, isEmptyFrame } from './helpers'
import { DETAIL_BLANK, emptyFrames, hexToRgb, nearBlank } from '../../src/node/metrics'
import { contrastRatio } from '../../src/core/palette'
import { planSfx } from '../../src/core/audio-plan'
import { parseStoryboard } from '../../src/core/storyboard'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'

// dark-tech tokens (src/runtime/looks.ts)
const BG = '#0e0d0c'
const FG = '#f2ece2'
const ACCENT = '#ff5a1f'
const TOL = 8
const AT = 2.0

const kin = (id: string, start: number, text: string) => ({
  id,
  type: 'kinetic-text',
  start,
  duration: 2,
  params: { words: [{ text, at: 0 }] },
})
const sbOf = (type: string, params: Record<string, unknown>, duration?: number) => ({
  version: 1,
  format: '9:16',
  look: 'dark-tech',
  seed: 5,
  scenes: [kin('a', 0, 'المال'), kin('b', 2, 'الوقت')],
  transitions: [{ type, at: AT, ...(duration ? { duration } : {}), params }],
})
/** Time of progress p in a window of length d centred on the cut. */
const tAt = (p: number, d: number) => AT - d / 2 + p * d

const px = (png: Buffer, x: number, y: number): [number, number, number] => {
  const img = PNG.sync.read(png)
  const i = (Math.round(y) * img.width + Math.round(x)) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]
}
const near = (got: [number, number, number], hex: string, why = '') => {
  const want = hexToRgb(hex)
  got.forEach((v, i) => expect(Math.abs(v - want[i]!), `${why} ${got} vs ${hex}`).toBeLessThanOrEqual(TOL))
}
/** Mean colour of a (2r+1)^2 block: robust against antialiasing at an edge. */
const blockMean = (png: Buffer, x: number, y: number, r = 6): [number, number, number] => {
  const img = PNG.sync.read(png)
  let a = 0, b = 0, c = 0, k = 0
  for (let yy = Math.round(y) - r; yy <= Math.round(y) + r; yy++)
    for (let xx = Math.round(x) - r; xx <= Math.round(x) + r; xx++) {
      const i = (yy * img.width + xx) * 4
      a += img.data[i]!; b += img.data[i + 1]!; c += img.data[i + 2]!; k++
    }
  return [a / k, b / k, c / k]
}
const dist = (a: [number, number, number], b: [number, number, number]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))
/** Cells of a 64-px-wide sampling grid within a small distance of `hex`. */
const covered = (png: Buffer, hex: string): number => {
  const img = PNG.sync.read(png)
  const want = hexToRgb(hex)
  const cols = 64
  const rows = Math.round((64 * img.height) / img.width)
  let n = 0
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = Math.min(img.width - 1, Math.floor(((c + 0.5) * img.width) / cols))
      const y = Math.min(img.height - 1, Math.floor(((r + 0.5) * img.height) / rows))
      const i = (y * img.width + x) * 4
      if ([0, 1, 2].every((k) => Math.abs(img.data[i + k]! - want[k]!) <= 4)) n++
    }
  return n
}
const seek = (page: Page, t: number) => page.evaluate((tt) => window.__mba.seek(tt), t)

test.describe('flood', () => {
  const D = 0.5
  const origin = { x: 0.2, y: 0.8 }

  test('loads without error', async ({ page }) => {
    await openStoryboard(page, sbOf('flood', { origin }))
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  })

  test('frame centre: outgoing bg at p=0, flood colour at the cut, incoming bg at p=1', async ({ page }) => {
    await openStoryboard(page, sbOf('flood', { origin }))
    near(px(await freshFrameAt(page, tAt(0, D)), 540, 960), BG, 'p=0')
    near(px(await freshFrameAt(page, AT), 540, 960), FG, 'p=0.5')
    near(px(await freshFrameAt(page, tAt(1, D)), 540, 960), BG, 'p=1')
  })

  test('colour accent covers the whole frame at the cut', async ({ page }) => {
    await openStoryboard(page, sbOf('flood', { origin, color: 'accent', shape: 'square' }))
    const png = await freshFrameAt(page, AT)
    for (const [x, y] of [[2, 2], [1077, 2], [2, 1917], [1077, 1917], [540, 960]]) near(px(png, x!, y!), ACCENT, `(${x},${y})`)
  })

  test('covered area grows over [0, 0.5] and shrinks over [0.5, 1]', async ({ page }) => {
    for (const shape of ['circle', 'square'] as const) {
      await openStoryboard(page, sbOf('flood', { origin, color: 'accent', shape }))
      const up: number[] = []
      for (const p of [0.1, 0.2, 0.3, 0.4, 0.5]) up.push(covered(await freshFrameAt(page, tAt(p, D)), ACCENT))
      for (let i = 1; i < up.length; i++) expect(up[i]!, `${shape} grow ${up}`).toBeGreaterThanOrEqual(up[i - 1]!)
      expect(up[0]!).toBeLessThan(up[4]! / 4)
      const down: number[] = []
      for (const p of [0.5, 0.6, 0.7, 0.8, 0.9]) down.push(covered(await freshFrameAt(page, tAt(p, D)), ACCENT))
      for (let i = 1; i < down.length; i++) expect(down[i]!, `${shape} shrink ${down}`).toBeLessThanOrEqual(down[i - 1]!)
      expect(down[4]!).toBeLessThan(down[0]! / 4)
    }
  })

  test('grows from the origin: the origin is covered before the far corner', async ({ page }) => {
    await openStoryboard(page, sbOf('flood', { origin, color: 'accent' }))
    const png = await freshFrameAt(page, tAt(0.35, D))
    near(blockMean(png, 0.2 * 1080, 0.8 * 1920), ACCENT, 'origin')
    near(blockMean(png, 1070, 10), BG, 'far corner')
  })

  test('no frame is empty (the cover is content)', async ({ page }) => {
    await openStoryboard(page, sbOf('flood', { origin }))
    for (const p of [0, 0.25, 0.5, 0.75, 1]) expect(isEmptyFrame(await freshFrameAt(page, tAt(p, D)), BG), `p=${p}`).toBe(false)
  })

  test('hit: true plans a riser and an impact at 2.0', () => {
    const plan = planSfx(parseStoryboard(sbOf('flood', { origin, hit: true }), [...PRIMITIVE_IDS]), { fps: 30 })
    const fx = plan.filter((c) => c.kind === 'sfx')
    expect(fx.find((c) => c.sfx === 'impact')?.at).toBe(AT)
    const riser = fx.find((c) => c.sfx === 'riser')!
    expect(Math.abs(riser.at + riser.duration! - AT)).toBeLessThan(1e-6)
  })

  test('Review Focus 2: world flip at the cut under a flood stays readable and not blank', async ({ page }) => {
    const sb = {
      version: 1,
      format: '9:16',
      look: 'paper-editorial',
      seed: 3,
      scenes: [
        { id: 'b1', type: 'backdrop', track: 0, start: 0, duration: 2, params: { world: 'paper' } },
        { id: 'b2', type: 'backdrop', track: 0, start: 2, duration: 2, params: { world: 'ink' } },
        { id: 'w', type: 'kinetic-text', track: 1, start: 0, duration: 4, params: { words: [{ text: 'المال', at: 0 }] } },
      ],
      transitions: [{ type: 'flood', at: AT, duration: 0.5, params: { color: 'accent' } }],
    }
    await openStoryboard(page, sb)
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    const parse = (css: string): [number, number, number] => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css)!
      return [Number(m[1]), Number(m[2]), Number(m[3])]
    }
    const hex = (c: [number, number, number]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
    const gray = (png: Buffer) => {
      const img = PNG.sync.read(png)
      const g = new Uint8Array(img.width * img.height)
      for (let i = 0; i < g.length; i++) g[i] = Math.round(0.2126 * img.data[i * 4]! + 0.7152 * img.data[i * 4 + 1]! + 0.0722 * img.data[i * 4 + 2]!)
      return { g, w: img.width }
    }
    const shots: Buffer[] = []
    for (const t of [1.967, 2.0, 2.033]) {
      shots.push(await freshFrameAt(page, t))
      const c = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('#frame [data-mba-text="word"]')!
        return { color: getComputedStyle(el).color, bg: getComputedStyle(document.getElementById('frame')!).backgroundColor }
      })
      expect(contrastRatio(hex(parse(c.color)), hex(parse(c.bg))), `t=${t}`).toBeGreaterThanOrEqual(4.5)
    }
    const grays = shots.map(gray)
    const flat = nearBlank(grays.map((x) => x.g), 30, DETAIL_BLANK, grays[0]!.w)
    const colours = shots.map((s) => {
      const img = PNG.sync.read(s)
      let r = 0, g = 0, b = 0
      for (let i = 0; i < img.data.length; i += 4) { r += img.data[i]!; g += img.data[i + 1]!; b += img.data[i + 2]! }
      const n = img.data.length / 4
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)] as [number, number, number]
    })
    expect(emptyFrames(flat, 30, colours, [hexToRgb('#f3eadb'), hexToRgb('#141210')])).toEqual([])
  })

  test('pure in t and nothing outlives the window', async ({ page }) => {
    await openStoryboard(page, sbOf('flood', { origin }))
    const a = await freshFrameAt(page, tAt(0.3, D))
    await freshFrameAt(page, 3)
    expect(Buffer.compare(a, await freshFrameAt(page, tAt(0.3, D)))).toBe(0)
    await seek(page, 0.5)
    const shown = await page.evaluate(
      () => [...document.querySelectorAll<HTMLElement>('#frame [data-mba-tr-overlay]')].filter((o) => o.style.visibility !== 'hidden').length,
    )
    expect(shown).toBe(0)
  })
})

test.describe('iris', () => {
  const D = 0.45
  const origin = { x: 0.5, y: 0.5 }

  test('loads without error', async ({ page }) => {
    await openStoryboard(page, sbOf('iris', { origin }))
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  })

  test('open: at p=0.3 the origin shows the incoming scene and a corner shows the cover; at p=1 no cover remains', async ({ page }) => {
    await openStoryboard(page, sbOf('iris', { origin, color: 'accent' }))
    const out0 = blockMean(await freshFrameAt(page, tAt(0, D)), 540, 960, 20)
    const mid = await freshFrameAt(page, tAt(0.3, D))
    const hole = blockMean(mid, 540, 960, 20)
    // The hole shows the incoming scene: not the cover, and not what the outgoing scene drew there.
    expect(dist(hole, hexToRgb(ACCENT)), `hole ${hole}`).toBeGreaterThan(100)
    expect(dist(hole, out0), `hole ${hole} vs outgoing ${out0}`).toBeGreaterThan(3)
    near(blockMean(mid, 10, 10), ACCENT, 'corner at 0.3')
    near(blockMean(mid, 1070, 1910), ACCENT, 'far corner at 0.3')
    const end = await freshFrameAt(page, tAt(1, D))
    expect(covered(end, ACCENT)).toBe(0)
    near(blockMean(end, 10, 10), BG, 'corner at 1')
    near(blockMean(end, 1070, 1910), BG, 'far corner at 1')
  })

  test('open: no cover at p=0, full cover at p=0.2', async ({ page }) => {
    await openStoryboard(page, sbOf('iris', { origin, color: 'accent' }))
    expect(covered(await freshFrameAt(page, tAt(0, D)), ACCENT)).toBe(0)
    const full = await freshFrameAt(page, tAt(0.2, D))
    near(blockMean(full, 540, 960, 20), ACCENT, 'centre at 0.2')
    near(blockMean(full, 10, 10), ACCENT, 'corner at 0.2')
  })

  test('close mirrors open: hole shrinks onto the origin, cover gone at the end', async ({ page }) => {
    await openStoryboard(page, sbOf('iris', { origin, color: 'accent', direction: 'close' }))
    const start = await freshFrameAt(page, tAt(0, D))
    expect(covered(start, ACCENT)).toBe(0)
    const mid = await freshFrameAt(page, tAt(0.7, D))
    near(blockMean(mid, 10, 10), ACCENT, 'corner at 0.7')
    // The hole still shows the outgoing scene (the same picture as at p = 0, give or take drift).
    expect(dist(blockMean(mid, 540, 960, 20), blockMean(start, 540, 960, 20))).toBeLessThan(25)
    near(blockMean(await freshFrameAt(page, tAt(0.8, D)), 540, 960, 20), ACCENT, 'closed at 0.8')
    expect(covered(await freshFrameAt(page, tAt(1, D)), ACCENT)).toBe(0)
  })

  test('no frame is empty and an off-centre origin is honoured', async ({ page }) => {
    await openStoryboard(page, sbOf('iris', { origin: { x: 0.2, y: 0.8 }, color: 'accent' }))
    for (const p of [0, 0.1, 0.2, 0.5, 0.8, 1]) expect(isEmptyFrame(await freshFrameAt(page, tAt(p, D)), BG), `p=${p}`).toBe(false)
    const png = await freshFrameAt(page, tAt(0.3, D))
    near(blockMean(png, 0.2 * 1080, 0.8 * 1920, 10), BG, 'hole at origin')
    near(blockMean(png, 1070, 10), ACCENT, 'far corner covered')
  })
})
