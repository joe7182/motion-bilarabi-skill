import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { openStoryboard, freshFrameAt } from './helpers'
import { hexToRgb } from '../../src/node/metrics'
import { contrastRatio } from '../../src/core/palette'

// signature tokens (src/runtime/looks.ts): paper = cream / ink, the ink world swaps them.
const CREAM = '#f3efe7'
const INK = '#16130f'
const ACCENT = '#ff5a1f'
const TOL = 6
const AT = 2.0
const D = 0.42
/** Time of progress p in the reveal window (1.79–2.21). */
const tAt = (p: number) => AT - D / 2 + p * D
const W = 1080
const H = 1920
const ORIGIN = { x: 0.5 * W, y: 0.45 * H }

interface Opts {
  outY?: number
  inY?: number
  material?: Record<string, unknown>
}
/** Paper backdrop + word (0–2 s), ink backdrop + word (2–4 s); the reveal joins the words on track 1. */
const sbOf = (params: Record<string, unknown>, o: Opts = {}) => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 7,
  scenes: [
    { id: 'b1', type: 'backdrop', track: 0, start: 0, duration: 2, params: { world: 'paper', ...(o.material ? { material: o.material } : {}) } },
    { id: 'b2', type: 'backdrop', track: 0, start: 2, duration: 2, params: { world: 'ink', ...(o.material ? { material: o.material } : {}) } },
    { id: 'w1', type: 'kinetic-text', track: 1, start: 0, duration: 2, params: { y: o.outY ?? 0.15, words: [{ text: 'المال', at: 0 }] } },
    { id: 'w2', type: 'kinetic-text', track: 1, start: 2, duration: 2, params: { y: o.inY ?? 0.45, words: [{ text: 'الوقت', at: 0 }] } },
  ],
  transitions: [{ type: 'reveal', track: 1, at: AT, params }],
})

/** Decoded once per screenshot (the edge scans read thousands of pixels). */
const decoded = new WeakMap<Buffer, PNG>()
const img = (png: Buffer): PNG => {
  let m = decoded.get(png)
  if (!m) decoded.set(png, (m = PNG.sync.read(png)))
  return m
}
const px = (png: Buffer, x: number, y: number): [number, number, number] => {
  const m = img(png)
  const i = (Math.round(y) * m.width + Math.round(x)) * 4
  return [m.data[i]!, m.data[i + 1]!, m.data[i + 2]!]
}
const near = (got: [number, number, number], hex: string, why = '') => {
  const want = hexToRgb(hex)
  got.forEach((v, i) => expect(Math.abs(v - want[i]!), `${why} ${got} vs ${hex}`).toBeLessThanOrEqual(TOL))
}
const isNear = (got: [number, number, number], hex: string, tol = TOL) => {
  const want = hexToRgb(hex)
  return got.every((v, i) => Math.abs(v - want[i]!) <= tol)
}
const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const seek = (page: Page, t: number) => page.evaluate((tt) => window.__mba.seek(tt), t)
const hexOf = (css: string) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css)!
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')
}

test.describe('reveal', () => {
  test('loads without error', async ({ page }) => {
    await openStoryboard(page, sbOf({}))
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  })

  test('circle: at 1.95 the origin shows the ink world and a corner still shows paper; at 2.2 no paper remains', async ({ page }) => {
    // The incoming word enters early (it is whole at 2.0), so it sits below the origin here.
    await openStoryboard(page, sbOf({}, { inY: 0.7 }))
    const early = await freshFrameAt(page, 1.95)
    near(px(early, ORIGIN.x, ORIGIN.y), INK, 'origin at 1.95')
    near(px(early, 8, 8), CREAM, 'corner at 1.95')
    near(px(early, W - 8, H - 8), CREAM, 'far corner at 1.95')
    // At 2.2 every pixel is the ink world, except the incoming word itself (drawn in the ink world's fg = cream).
    const late = await freshFrameAt(page, 2.2)
    const box = await page.evaluate(() => {
      const r = document.querySelector<HTMLElement>('#frame [data-mba-scene="w2"] [data-mba-text="word"]')!.getBoundingClientRect()
      return { l: r.left - 24, r: r.right + 24, t: r.top - 24, b: r.bottom + 24 }
    })
    const m = img(late)
    let paper = 0
    let accent = 0
    for (let y = 0; y < m.height; y += 8)
      for (let x = 0; x < m.width; x += 8) {
        if (x >= box.l && x <= box.r && y >= box.t && y <= box.b) continue
        const i = (y * m.width + x) * 4
        const c: [number, number, number] = [m.data[i]!, m.data[i + 1]!, m.data[i + 2]!]
        if (isNear(c, CREAM, 12)) paper++
        if (isNear(c, ACCENT, 30)) accent++
      }
    expect(paper, 'paper pixels at 2.2').toBe(0)
    expect(accent, 'ring pixels at 2.2').toBe(0)
  })

  test('circle: the accent ring hugs the opening while it grows', async ({ page }) => {
    await openStoryboard(page, sbOf({}))
    const png = await freshFrameAt(page, tAt(0.85))
    const m = img(png)
    let accent = 0
    for (let i = 0; i < m.data.length; i += 4 * 7) {
      if (isNear([m.data[i]!, m.data[i + 1]!, m.data[i + 2]!], ACCENT, 30)) accent++
    }
    expect(accent).toBeGreaterThan(100)
    await openStoryboard(page, sbOf({ ring: false }))
    const bare = img(await freshFrameAt(page, tAt(0.85)))
    let none = 0
    for (let i = 0; i < bare.data.length; i += 4 * 7) {
      if (isNear([bare.data[i]!, bare.data[i + 1]!, bare.data[i + 2]!], ACCENT, 30)) none++
    }
    expect(none).toBe(0)
  })

  test('both worlds live: outgoing word outside the circle, incoming word inside, each in its own colours', async ({ page }) => {
    await openStoryboard(page, sbOf({}))
    await seek(page, 2.1)
    const s = await page.evaluate(() => {
      const q = (id: string) => document.querySelector<HTMLElement>(`#frame [data-mba-scene="${id}"]`)!
      const word = (id: string) => q(id).querySelector<HTMLElement>('[data-mba-text="word"]')!
      const info = (id: string) => {
        const layer = q(id)
        const w = word(id)
        const r = w.getBoundingClientRect()
        const cx = (r.left + r.right) / 2
        const cy = (r.top + r.bottom) / 2
        const hit = document.elementFromPoint(cx, cy)
        return {
          display: getComputedStyle(layer).display,
          colour: getComputedStyle(w).color,
          bg: getComputedStyle(layer).getPropertyValue('--mba-bg').trim(),
          hitHere: hit !== null && layer.contains(hit),
          cx,
          cy,
        }
      }
      return { out: info('w1'), in: info('w2'), b1: getComputedStyle(q('b1')).display, b2: getComputedStyle(q('b2')).display }
    })
    expect(s.out.display).not.toBe('none')
    expect(s.in.display).not.toBe('none')
    expect(s.b1).not.toBe('none')
    expect(s.b2).not.toBe('none')
    // The incoming word sits at the origin (inside the circle), the outgoing one far above it.
    expect(Math.hypot(s.in.cx - ORIGIN.x, s.in.cy - ORIGIN.y)).toBeLessThan(60)
    expect(s.in.hitHere, 'incoming word is inside the opening').toBe(true)
    expect(s.out.hitHere, 'outgoing word is outside the opening').toBe(true)
    // Each word in its own world, readable on its own background.
    expect(hexOf(s.out.colour)).toBe(INK)
    expect(hexOf(s.in.colour)).toBe(CREAM)
    expect(contrastRatio(hexOf(s.out.colour), s.out.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(hexOf(s.in.colour), s.in.bg)).toBeGreaterThanOrEqual(4.5)
    expect(s.out.bg.toLowerCase()).toBe(CREAM)
    expect(s.in.bg.toLowerCase()).toBe(INK)
    // And on screen: ink inside the circle (below the word), paper outside it (bottom of the frame).
    const png = await freshFrameAt(page, 2.1)
    near(px(png, ORIGIN.x, ORIGIN.y + 280), INK, 'inside')
    near(px(png, ORIGIN.x, 1800), CREAM, 'outside')
  })

  test('bands: at p = 0.5 the centre band is further left than the top band', async ({ page }) => {
    await openStoryboard(page, sbOf({ shape: 'bands' }, { outY: 0.3, inY: 0.8 }))
    const png = await freshFrameAt(page, tAt(0.5))
    /** Leftmost x of the ink world on row y (the incoming side opens from the right). */
    const edge = (y: number) => {
      for (let x = 0; x < W; x++) if (isNear(px(png, x, y), INK)) return x
      return W
    }
    const top = edge(96)
    const centre = edge(ORIGIN.y)
    expect(centre, `centre ${centre} vs top ${top}`).toBeLessThan(top - 100)
    expect(top).toBeLessThan(W)
    // The band edges are accent while they move.
    const m = img(png)
    let accent = 0
    for (let i = 0; i < m.data.length; i += 4 * 5) if (isNear([m.data[i]!, m.data[i + 1]!, m.data[i + 2]!], ACCENT, 30)) accent++
    expect(accent).toBeGreaterThan(50)
    // At the window end the incoming world fills the frame.
    const end = await freshFrameAt(page, tAt(1))
    near(px(end, 8, 96), INK, 'top band done')
    near(px(end, 8, H - 8), INK, 'bottom band done')
  })

  test('panel: a diagonal edge sweeps right to left with an accent line', async ({ page }) => {
    await openStoryboard(page, sbOf({ shape: 'panel' }, { outY: 0.3, inY: 0.8 }))
    const png = await freshFrameAt(page, tAt(0.5))
    near(px(png, 1000, 1800), INK, 'right side')
    near(px(png, 60, 120), CREAM, 'left side')
    // The edge leans: on a top row the ink starts further right than on a bottom row.
    const edge = (y: number) => {
      for (let x = 0; x < W; x++) if (isNear(px(png, x, y), INK)) return x
      return W
    }
    expect(edge(60)).toBeGreaterThan(edge(H - 60) + 200)
    const m = img(png)
    let accent = 0
    for (let i = 0; i < m.data.length; i += 4 * 5) if (isNear([m.data[i]!, m.data[i + 1]!, m.data[i + 2]!], ACCENT, 30)) accent++
    expect(accent).toBeGreaterThan(50)
  })

  test('canvas materials paint each world inside / outside the shape (R1)', async ({ page }) => {
    await openStoryboard(page, sbOf({}, { material: { grain: 0, halftone: false } }))
    const png = await freshFrameAt(page, 2.1)
    expect(lum(px(png, ORIGIN.x, ORIGIN.y + 280)), 'ink material inside').toBeLessThan(70)
    expect(lum(px(png, ORIGIN.x, 1800)), 'paper material outside').toBeGreaterThan(150)
  })

  test('under a moving, shaking camera a depth-0.3 backdrop is clipped on the same screen circle as the word and the ring', async ({ page }) => {
    const base = sbOf({})
    const sb = {
      ...base,
      camera: { keys: [{ at: 0, zoom: 1 }, { at: 2, x: 0.55, y: 0.42, zoom: 1.3 }], fixedTracks: [5], handheld: { amp: 2 }, shakes: [{ at: 1.9, amp: 25 }] },
      scenes: base.scenes.map((sc) => (sc.type === 'backdrop' ? { ...sc, depth: 0.3 } : sc)),
    }
    await openStoryboard(page, sb)
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    await seek(page, 2.1)
    const got = await page.evaluate(() => {
      const wrap = (el: Element) => {
        const w = el.parentElement!
        return w.dataset.mbaWorld !== undefined && w.style.transform ? new DOMMatrix(w.style.transform) : new DOMMatrix()
      }
      const onScreen = (id: string) => {
        const layer = document.querySelector<HTMLElement>(`#frame [data-mba-scene="${id}"]`)!
        const m = /circle\(([\d.]+)px at ([\d.-]+)px ([\d.-]+)px\)/.exec(layer.style.clipPath)!
        const M = wrap(layer)
        const c = M.transformPoint(new DOMPoint(Number(m[2]), Number(m[3])))
        return { x: c.x, y: c.y, r: Number(m[1]) * Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)), depth: layer.parentElement!.dataset.mbaDepth ?? '1' }
      }
      const ov = document.querySelector<HTMLElement>('#frame [data-mba-tr-overlay="reveal"]')!
      const ring = ov.querySelector('circle')!
      const M = wrap(ov)
      const c = M.transformPoint(new DOMPoint(Number(ring.getAttribute('cx')), Number(ring.getAttribute('cy'))))
      return { b2: onScreen('b2'), w2: onScreen('w2'), ring: { x: c.x, y: c.y } }
    })
    expect(got.b2.depth).toBe('0.3')
    expect(got.w2.depth).toBe('1')
    // The two layers sit in different camera wrappers, yet their openings coincide on screen.
    expect(Math.abs(got.b2.x - got.w2.x) + Math.abs(got.b2.y - got.w2.y), JSON.stringify(got)).toBeLessThan(0.05)
    expect(Math.abs(got.b2.r - got.w2.r)).toBeLessThan(0.05)
    expect(Math.abs(got.ring.x - got.w2.x) + Math.abs(got.ring.y - got.w2.y)).toBeLessThan(0.05)
  })

  test('fix I1 (R28): paper → accent with both words at the origin — no outgoing ink inside the opening', async ({ page }) => {
    // The accent world's bg is the accent; its fg is ink, so the incoming word enters late (local 1 s)
    // and any ink inside the opening at 2.1 can only be the outgoing word showing through.
    const base = sbOf({}, { outY: 0.45, inY: 0.45 })
    const sb = {
      ...base,
      scenes: base.scenes.map((sc) =>
        sc.id === 'b2' ? { ...sc, params: { world: 'accent' } } : sc.id === 'w2' ? { ...sc, params: { ...sc.params, words: [{ text: 'الوقت', at: 1 }] } } : sc,
      ),
    }
    await openStoryboard(page, sb)
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    // Before the window the outgoing word is drawn in ink at the origin.
    const before = img(await freshFrameAt(page, 1.7))
    const inkNear = (m: PNG, R: number) => {
      let k = 0
      for (let y = Math.round(ORIGIN.y - R); y <= ORIGIN.y + R; y += 3)
        for (let x = Math.round(ORIGIN.x - R); x <= ORIGIN.x + R; x += 3) {
          if (Math.hypot(x - ORIGIN.x, y - ORIGIN.y) > R) continue
          const i = (y * m.width + x) * 4
          if (lum([m.data[i]!, m.data[i + 1]!, m.data[i + 2]!]) < 60) k++
        }
      return k
    }
    expect(inkNear(before, 380), 'the outgoing word is at the origin').toBeGreaterThan(200)
    // At 2.1 the opening's radius is ~414 px: inside it only the accent world shows.
    const mid = img(await freshFrameAt(page, 2.1))
    expect(inkNear(mid, 380), 'outgoing ink inside the opening').toBe(0)
    near(px(await freshFrameAt(page, 2.1), ORIGIN.x, ORIGIN.y), ACCENT, 'opening at the origin')
    // Outside the opening the outgoing world is untouched (paper at the bottom).
    near(px(await freshFrameAt(page, 2.1), ORIGIN.x, 1800), CREAM, 'outside')
  })

  test('fix I2: a canvas-style probe outside both sides reads paper at p 0.25 and ink at p 0.75', async ({ page }) => {
    const probe = `() => [{
      id: '_worldprobe',
      build(ctx) {
        const out = document.createElement('div')
        out.dataset.probe = ''
        ctx.layer.append(out)
        // Records the world in force at update time, as resolvedWorld(ctx.layer) would read it.
        return { update() { out.dataset.bg = getComputedStyle(ctx.layer).getPropertyValue('--mba-bg').trim().toLowerCase() } }
      },
    }]`
    const base = sbOf({})
    const sb = { ...base, scenes: [...base.scenes, { id: 'pr', type: '_worldprobe', track: 2, start: 0, duration: 4, params: {} }] }
    await openStoryboard(page, sb, { testPrimitives: probe })
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    const seen = async (t: number) => {
      await seek(page, t)
      return page.evaluate(() => document.querySelector<HTMLElement>('#frame [data-probe]')!.dataset.bg)
    }
    expect(await seen(tAt(0.25))).toBe(CREAM)
    expect(await seen(tAt(0.75))).toBe(INK)
    expect(await seen(tAt(0.25))).toBe(CREAM)
  })

  test('minor 3: the ring keeps the outgoing world accent across the cut (paper → accent)', async ({ page }) => {
    const base = sbOf({})
    const sb = { ...base, scenes: base.scenes.map((sc) => (sc.id === 'b2' ? { ...sc, params: { world: 'accent' } } : sc)) }
    await openStoryboard(page, sb)
    const stroke = async (t: number) => {
      await seek(page, t)
      return page.evaluate(() => getComputedStyle(document.querySelector('#frame [data-mba-tr-overlay="reveal"] circle')!).stroke)
    }
    expect(hexOf(await stroke(tAt(0.25)))).toBe(ACCENT)
    expect(hexOf(await stroke(tAt(0.75)))).toBe(ACCENT)
  })

  test('the accent edge overlay bleeds at least 64 px past the frame (R16)', async ({ page }) => {
    await openStoryboard(page, sbOf({}))
    await seek(page, tAt(0.5))
    const r = await page.evaluate(() => {
      const ov = document.querySelector<HTMLElement>('#frame [data-mba-tr-overlay="reveal"]')!
      const svg = ov.querySelector('svg')!.getBoundingClientRect()
      const f = document.getElementById('frame')!.getBoundingClientRect()
      return { l: svg.left - f.left, t: svg.top - f.top, r: svg.right - f.right, b: svg.bottom - f.bottom, overflow: getComputedStyle(ov).overflow }
    })
    expect(r.l).toBeLessThanOrEqual(-64)
    expect(r.t).toBeLessThanOrEqual(-64)
    expect(r.r).toBeGreaterThanOrEqual(64)
    expect(r.b).toBeGreaterThanOrEqual(64)
    expect(r.overflow).toBe('visible')
  })

  test('cold and warm frames are identical; nothing outlives the window', async ({ page }) => {
    for (const shape of ['circle', 'bands', 'panel']) {
      await openStoryboard(page, sbOf({ shape }))
      const ts = [1.95, tAt(0.5), 2.1]
      const cold: Buffer[] = []
      for (const t of ts) cold.push(await freshFrameAt(page, t))
      await freshFrameAt(page, 3.5)
      await freshFrameAt(page, 0.4)
      for (const [k, t] of [...ts.entries()].reverse()) expect(Buffer.compare(cold[k]!, await freshFrameAt(page, t)), `${shape} t=${t}`).toBe(0)
      await seek(page, 3)
      const after = await page.evaluate(() => {
        const layers = [...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')]
        return {
          clip: layers.map((l) => l.style.clipPath).filter(Boolean),
          vars: layers.map((l) => l.style.getPropertyValue('--mba-bg')).filter(Boolean),
          shown: layers.filter((l) => l.style.display !== 'none').map((l) => l.dataset.mbaScene),
          overlays: [...document.querySelectorAll<HTMLElement>('#frame [data-mba-tr-overlay]')].filter((o) => o.style.display !== 'none').length,
        }
      })
      expect(after).toEqual({ clip: [], vars: [], shown: ['b2', 'w2'], overlays: 0 })
    }
  })
})
