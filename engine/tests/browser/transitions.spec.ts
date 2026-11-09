import { test, expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { PNG } from 'pngjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStoryboard, frameAt, freshFrameAt, isEmptyFrame, frameStats, unsanctionedArabicText } from './helpers'
import { diffPngs } from '../../src/node/png-diff'
import { sceneAt, verifyDeterminism } from '../../src/node/verify'
import { parseStoryboard } from '../../src/core/storyboard'

const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const FIXTURES = join(ENGINE, 'tests/fixtures')
type Fixture = {
  scenes: { params: Record<string, unknown> }[]
  transitions: { type: string; at: number; duration?: number; params?: Record<string, unknown> }[]
} & Record<string, unknown>
const fixture = (name: string): Fixture => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

const GOLDEN = { maxDiffPixelRatio: 0.002 }
const BG = '#0e0d0c' // dark-tech look.bg
const IDS = ['color-wipe', 'whip-pan', 'zoom-through', 'glitch-cut'] as const
const AT = 2.0
const D = 0.4 // default duration
const FRAME = 1 / 30

/** Every scene layer's four transition-owned style properties. */
const layerStyles = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')].map((l) => ({
      id: l.dataset.mbaScene,
      transform: l.style.transform,
      filter: l.style.filter,
      clipPath: l.style.clipPath,
      opacity: l.style.opacity,
    })),
  )
const trFlag = (page: Page) => page.evaluate(() => document.getElementById('frame')!.getAttribute('data-mba-tr'))
const seek = (page: Page, t: number) => page.evaluate((tt) => window.__mba.seek(tt), t)

for (const id of IDS) {
  test.describe(`transition ${id}`, () => {
    const sb = fixture(`tr-${id}.json`)

    test('loads without error', async ({ page }) => {
      await openStoryboard(page, sb)
      expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    })

    test('boundary frames not empty', async ({ page, browser }) => {
      await openStoryboard(page, sb)
      // at ± 1 frame: strictly not empty.
      for (const t of [AT - FRAME, AT + FRAME]) {
        const png = await freshFrameAt(page, t)
        expect(isEmptyFrame(png, BG), `t=${t} lumVariance=${frameStats(png).lumVariance.toFixed(1)}`).toBe(false)
      }
      // At the cut (R14): the transition adds no emptiness. The frame may be empty only if the same
      // storyboard without transitions is empty there too (intro primitives start empty at local 0).
      const atPng = await freshFrameAt(page, AT)
      const base = await browser.newPage()
      await openStoryboard(base, { ...sb, transitions: undefined })
      const baseEmpty = isEmptyFrame(await freshFrameAt(base, AT), BG)
      await base.close()
      if (!baseEmpty) expect(isEmptyFrame(atPng, BG), `t=${AT}`).toBe(false)
    })

    test('no leakage: frames after the window equal cold frames', async ({ page, browser }) => {
      await openStoryboard(page, sb)
      for (const after of [0.5, AT + 1.0]) {
        await freshFrameAt(page, AT)
        const warm = await freshFrameAt(page, after)
        const coldPage = await browser.newPage()
        await openStoryboard(coldPage, sb)
        const cold = await freshFrameAt(coldPage, after)
        await coldPage.close()
        expect(diffPngs(warm, cold).diffPixels, `t=${after}`).toBe(0)
      }
    })

    test('layers untouched and flag cleared outside the window', async ({ page }) => {
      await openStoryboard(page, sb)
      await seek(page, AT - D / 4)
      expect(await trFlag(page)).toBe('1')
      await seek(page, AT + D / 4)
      expect(await trFlag(page)).toBe('1')
      for (const t of [0.5, AT + 1.0, AT - D / 2 - 0.01, AT + D / 2 + 0.01]) {
        await seek(page, t)
        expect(await trFlag(page), `t=${t}`).toBeNull()
        for (const l of await layerStyles(page)) {
          expect(l, `t=${t}`).toEqual({ id: l.id, transform: '', filter: '', clipPath: '', opacity: '' })
        }
        const overlaysShown = await page.evaluate(
          () => [...document.querySelectorAll<HTMLElement>('#frame [data-mba-tr-overlay]')].filter((o) => o.style.visibility !== 'hidden').length,
        )
        expect(overlaysShown, `t=${t}`).toBe(0)
      }
    })

    test('only 2D transforms on layers, Arabic stays sanctioned', async ({ page }) => {
      await openStoryboard(page, sb)
      for (let k = 0; k <= 8; k++) {
        await seek(page, AT - D / 2 + (k * D) / 8)
        for (const l of await layerStyles(page)) expect(l.transform).not.toMatch(/3d|perspective|rotate[XY]|translateZ/)
        expect(await unsanctionedArabicText(page)).toEqual([])
      }
    })

    test('goldens at at − d/4 and at + d/4', async ({ page }) => {
      await openStoryboard(page, sb)
      await frameAt(page, AT - D / 4)
      await expect(page.locator('#frame')).toHaveScreenshot(`tr-${id}-pre.png`, GOLDEN)
      await frameAt(page, AT + D / 4)
      await expect(page.locator('#frame')).toHaveScreenshot(`tr-${id}-post.png`, GOLDEN)
    })
  })
}

test.describe('transition specifics', () => {
  test('color-wipe covers the frame fully at the cut (accent, and fg going up)', async ({ page, browser }) => {
    await openStoryboard(page, fixture('tr-color-wipe.json'))
    const st = frameStats(await freshFrameAt(page, AT))
    expect(st.lumVariance).toBeLessThan(0.5)
    st.mean.forEach((c, i) => expect(Math.abs(c - [0xff, 0x5a, 0x1f][i]!)).toBeLessThan(1))
    const up = await browser.newPage()
    await openStoryboard(up, fixture('tr-color-wipe-up.json'))
    const su = frameStats(await freshFrameAt(up, AT))
    expect(su.lumVariance).toBeLessThan(0.5)
    su.mean.forEach((c, i) => expect(Math.abs(c - [0xf2, 0xec, 0xe2][i]!)).toBeLessThan(1))
    await up.close()
  })

  test('color-wipe rtl enters from the right edge; up enters from the bottom', async ({ page, browser }) => {
    // At p = 0.3 (t = 1.92) the panel covers part of the frame: check which edge has it.
    const t = AT - D / 2 + 0.3 * D
    const edge = async (p: Page) =>
      p.evaluate(() => {
        const ov = document.querySelector<HTMLElement>('#frame [data-mba-tr-overlay]')!
        return getComputedStyle(ov.firstElementChild as HTMLElement).clipPath
      })
    await openStoryboard(page, fixture('tr-color-wipe.json'))
    await seek(page, t)
    const rtl = await edge(page)
    // inset(top right bottom left): only the left inset is non-zero (the panel hugs the right edge)
    const v = /inset\(([^)]*)\)/.exec(rtl)![1]!.split(/\s+/).map(parseFloat)
    expect(v[3]! > 0 && v[1] === 0).toBe(true)
    const up = await browser.newPage()
    await openStoryboard(up, fixture('tr-color-wipe-up.json'))
    await seek(up, t)
    const u = /inset\(([^)]*)\)/.exec(await edge(up))![1]!.split(/\s+/).map(parseFloat)
    expect(u[0]! > 0).toBe(true) // top inset: the panel hugs the bottom edge
    await up.close()
  })

  test('whip-pan: outgoing moves left, incoming arrives from +0.8 W, backing fills only the gap', async ({ page }) => {
    await openStoryboard(page, fixture('tr-whip-pan.json'))
    const read = (t: number) =>
      page.evaluate(async (tt) => {
        await window.__mba.seek(tt)
        const vis = [...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')].find((l) => l.style.visibility === 'visible')!
        const ov = document.querySelector<HTMLElement>('#frame [data-mba-tr-overlay]')!.firstElementChild as HTMLElement
        return {
          scene: vis.dataset.mbaScene,
          x: new DOMMatrix(getComputedStyle(vis).transform === 'none' ? '' : getComputedStyle(vis).transform).m41,
          filter: vis.style.filter,
          clip: ov.style.clipPath,
          bg: getComputedStyle(ov).backgroundColor,
        }
      }, t)
    const pre = await read(AT - FRAME)
    expect(pre.scene).toBe('hook')
    expect(pre.x).toBeLessThan(-100)
    expect(pre.filter).toMatch(/blur\(/)
    expect(pre.bg).toBe('rgb(14, 13, 12)')
    // gap strip = right of the moved layer: inset(0 0 0 W+x)
    const ins = (c: string) => /inset\(([^)]*)\)/.exec(c)![1]!.split(/\s+/).map(parseFloat)
    const pi = ins(pre.clip)
    expect(pi.slice(0, 3)).toEqual([0, 0, 0])
    expect(pi[3]!).toBeCloseTo(1080 + pre.x, 1)
    const cut = await read(AT)
    expect(cut.scene).toBe('reveal')
    expect(cut.x).toBeCloseTo(0.8 * 1080, 1)
    const ci = ins(cut.clip)
    expect(ci[1]!).toBeCloseTo(1080 - cut.x, 1)
    expect([ci[0], ci[2], ci[3]]).toEqual([0, 0, 0])
    const post = await read(AT + D / 2 - 0.001)
    expect(Math.abs(post.x)).toBeLessThan(5)
  })

  test('zoom-through: incoming starts at opacity 0.3, scale 0.7, centred origin', async ({ page }) => {
    await openStoryboard(page, fixture('tr-zoom-through.json'))
    await seek(page, AT)
    const st = await page.evaluate(() => {
      const l = document.querySelector<HTMLElement>('#frame [data-mba-scene=reveal]')!
      return { opacity: l.style.opacity, transform: l.style.transform, origin: l.style.transformOrigin }
    })
    expect(Number(st.opacity)).toBeCloseTo(0.3, 5)
    expect(st.transform).toBe('scale(0.7)')
    expect(st.origin).toBe('50% 50%')
    await seek(page, AT - 0.05) // p = 0.375: before the fade, already scaled
    const out = await page.evaluate(() => document.querySelector<HTMLElement>('#frame [data-mba-scene=hook]')!.style.opacity)
    expect(out).toBe('1')
  })

  test('glitch-cut: the SVG filter visibly applies and its offsets change per step', async ({ page }) => {
    await openStoryboard(page, fixture('tr-glitch-cut.json'))
    const t = AT + 0.12 // p = 0.8, incoming affected
    const filtered = await freshFrameAt(page, t)
    const info = await page.evaluate(() => {
      const l = document.querySelector<HTMLElement>('#frame [data-mba-scene=reveal]')!
      const id = /url\("?#([^")]+)"?\)/.exec(l.style.filter)?.[1]
      return { id, filterInDoc: !!(id && document.getElementById(id)), dx: [...document.querySelectorAll(`#${id} feOffset`)].map((o) => o.getAttribute('dx')) }
    })
    expect(info.id).toMatch(/^mba-glitch-\d+$/)
    expect(info.filterInDoc).toBe(true)
    // Same frame with only the filter removed: pixels must differ, so the filter really applies.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#frame [data-mba-scene=reveal]')!.style.filter = 'none'
    })
    const plain = await page.locator('#frame').screenshot({ caret: 'hide' })
    expect(diffPngs(filtered, plain).diffPixels).toBeGreaterThan(200)
    await seek(page, AT + 0.165) // next step
    const dx2 = await page.evaluate((id) => [...document.querySelectorAll(`#${id} feOffset`)].map((o) => o.getAttribute('dx')), info.id!)
    expect(dx2).not.toEqual(info.dx)
  })

  test('bad transition params are reported in the browser at transitions[0].params.direction', async ({ page }) => {
    const sb = fixture('tr-color-wipe.json')
    sb.transitions[0]!.params = { direction: 'sideways' }
    await openStoryboard(page, sb)
    expect(await page.evaluate(() => window.__mba.error)).toContain('transitions[0].params.direction')
  })

  test('a transition not on a cut is reported in the browser at transitions[0].at', async ({ page }) => {
    const sb = fixture('tr-whip-pan.json')
    sb.transitions[0]!.at = 1.0
    await openStoryboard(page, sb)
    expect(await page.evaluate(() => window.__mba.error)).toContain('transitions[0].at')
  })
})

test.describe('morph (Task 8)', () => {
  // coin-a: an icon (key coin) top-left; coin-b: a counter (key coin) centred. Window [1.7, 2.3].
  const sb = fixture('tr-morph.json')
  const MD = 0.6
  const A = AT - MD / 2
  const B = AT + MD / 2
  type Box = { x: number; y: number; w: number; h: number }
  /** Frame-px box of the selector (null when absent or not rendered). */
  const box = (page: Page, sel: string) =>
    page.evaluate((s) => {
      const el = document.querySelector<HTMLElement>(s)
      const f = document.getElementById('frame')!.getBoundingClientRect()
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return null
      return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height }
    }, sel)
  const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
  /** Position of `q` along the segment a → b (0 at a, 1 at b). */
  const along = (q: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
  const CLONE = '#frame [data-mba-morph-clone]'
  const KEY_A = '#frame [data-mba-scene="coin-a"] [data-mba-key="coin"]'
  const KEY_B = '#frame [data-mba-scene="coin-b"] [data-mba-key="coin"]'
  /** Effective opacity of the selector's element up to #frame; 0 when absent or hidden by display/visibility. */
  const shown = (page: Page, sel: string) =>
    page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return 0
      let o = 1
      for (let e: Element | null = el; e && e.id !== 'frame'; e = e.parentElement) {
        const cs = getComputedStyle(e)
        if (cs.display === 'none' || cs.visibility === 'hidden') return 0
        o *= parseFloat(cs.opacity)
      }
      return o
    }, sel)

  test('loads without error; default duration 0.6', async ({ page }) => {
    await openStoryboard(page, sb)
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    await seek(page, A + 0.01)
    expect(await trFlag(page)).toBe('1')
    await seek(page, B - 0.01)
    expect(await trFlag(page)).toBe('1')
    await seek(page, B + 0.01)
    expect(await trFlag(page)).toBeNull()
  })

  test('the clone flies from the outgoing keyed rect to the incoming one (FLIP, power3.inOut)', async ({ page }) => {
    await openStoryboard(page, sb)
    // The keyed originals at rest just outside the window.
    await seek(page, A - 0.001)
    const ca = centre((await box(page, KEY_A))!)
    await seek(page, B + 0.001)
    const cb = centre((await box(page, KEY_B))!)
    expect(Math.hypot(cb.x - ca.x, cb.y - ca.y)).toBeGreaterThan(200)
    // Mid window: the centre within 2 px of the linear midpoint (power3.inOut(0.5) = 0.5).
    await seek(page, AT)
    const mid = centre((await box(page, CLONE))!)
    expect(Math.abs(mid.x - (ca.x + cb.x) / 2)).toBeLessThan(2)
    expect(Math.abs(mid.y - (ca.y + cb.y) / 2)).toBeLessThan(2)
    // Eased: strictly between the ends, slow near both (power3.inOut(0.25) = 0.0625, (0.75) = 0.9375).
    await seek(page, A + 0.25 * MD)
    const q1 = along(centre((await box(page, CLONE))!), ca, cb)
    expect(q1).toBeGreaterThan(0)
    expect(q1).toBeLessThan(0.25)
    await seek(page, A + 0.75 * MD)
    const q3 = along(centre((await box(page, CLONE))!), ca, cb)
    expect(q3).toBeGreaterThan(0.75)
    expect(q3).toBeLessThan(1)
  })

  test('no jump at the window edges: the clone starts and lands on the drifting originals', async ({ page }) => {
    await openStoryboard(page, sb)
    await seek(page, A - 0.001)
    const ra = (await box(page, KEY_A))!
    await seek(page, A)
    const c0 = (await box(page, CLONE))!
    await seek(page, B - 0.001)
    const c1 = (await box(page, CLONE))!
    await seek(page, B)
    const rb = (await box(page, KEY_B))!
    for (const [c, r] of [
      [c0, ra],
      [c1, rb],
    ] as const) {
      expect(Math.abs(c.x - r.x)).toBeLessThan(0.5)
      expect(Math.abs(c.y - r.y)).toBeLessThan(0.5)
      expect(Math.abs(c.w - r.w)).toBeLessThan(0.5)
      expect(Math.abs(c.h - r.h)).toBeLessThan(0.5)
    }
  })

  test('both scenes visible over the window; out fades by 0.5, in from 0.5; originals hidden while the clone flies', async ({ page }) => {
    await openStoryboard(page, sb)
    const layerOpacity = (id: string) => shown(page, `#frame [data-mba-scene="${id}"]`)
    for (const p of [0, 0.25, 0.5, 0.75, 0.99]) {
      await seek(page, A + p * MD)
      const display = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')].map((l) => getComputedStyle(l).display),
      )
      expect(display, `p=${p}`).not.toContain('none')
      expect(await layerOpacity('coin-a'), `p=${p}`).toBeCloseTo(Math.max(0, 1 - p / 0.5), 2)
      expect(await layerOpacity('coin-b'), `p=${p}`).toBeCloseTo(Math.max(0, (p - 0.5) / 0.5), 2)
      expect(await shown(page, KEY_A), `p=${p}`).toBe(0)
      expect(await shown(page, KEY_B), `p=${p}`).toBe(0)
      expect(await shown(page, CLONE), `p=${p}`).toBeGreaterThan(0)
    }
    // Window end: the clone is gone and B's keyed element shows.
    await seek(page, B)
    expect(await shown(page, CLONE)).toBe(0)
    expect(await shown(page, KEY_B)).toBeGreaterThan(0.5)
    // Outside the window: no clone, layers untouched, originals back.
    for (const t of [A - 0.01, B + 0.01, 3.5]) {
      await seek(page, t)
      expect(await shown(page, CLONE), `t=${t}`).toBe(0)
      for (const l of await layerStyles(page)) expect(l, `t=${t}`).toEqual({ id: l.id, transform: '', filter: '', clipPath: '', opacity: '' })
    }
    await seek(page, A - 0.01)
    expect(await shown(page, KEY_A)).toBeGreaterThan(0.5)
  })

  test('seeking mid → end → mid is pixel-identical, and equals a cold page', async ({ page, browser }) => {
    await openStoryboard(page, sb)
    const mid1 = await freshFrameAt(page, AT)
    await freshFrameAt(page, B)
    const mid2 = await freshFrameAt(page, AT)
    expect(diffPngs(mid1, mid2).diffPixels).toBe(0)
    expect(isEmptyFrame(mid1, BG)).toBe(false)
    const late = await freshFrameAt(page, 3.5)
    const cold = await browser.newPage()
    await openStoryboard(cold, sb)
    expect(diffPngs(mid1, await freshFrameAt(cold, AT)).diffPixels).toBe(0)
    const cold2 = await browser.newPage()
    await openStoryboard(cold2, sb)
    expect(diffPngs(late, await freshFrameAt(cold2, 3.5)).diffPixels).toBe(0)
    await cold.close()
    await cold2.close()
  })

  test('a missing key is a page error at transitions[0].params.key (Arabic first)', async ({ page }) => {
    const bad = fixture('tr-morph.json')
    delete bad.scenes[1]!.params.key
    await openStoryboard(page, bad)
    const err = await page.evaluate(() => window.__mba.error)
    expect(err).toContain('transitions[0].params.key: لم يُعثر على العنصر')
    expect(err).toContain('element with key "coin" not found in scene "coin-b"')
  })
})

/**
 * Test primitive `_card` (needs ?test=1): a full-width 1080×600 band, accent (or fg with
 * `color: 'fg'`), fully drawn from local t = 0, like a picture scene: never empty at the cut.
 * Full width matters for whip-pan: at the cut the incoming layer sits at +0.8 W, so only its
 * leading 20% is on screen (centred content narrower than that stays off screen; see the report).
 */
const CARD_SRC = `() => [{
  id: '_card',
  build(ctx, p) {
    const d = document.createElement('div')
    Object.assign(d.style, { position: 'absolute', left: '0px', top: '660px', width: '1080px', height: '600px',
      background: p && p.color === 'fg' ? ctx.look.fg : ctx.look.accent })
    ctx.layer.append(d)
    return {}
  },
}]`
const card = (id: string, start: number, duration: number, color = 'accent') => ({ id, type: '_card', start, duration, params: { color } })
/** Pixels whose RGB is within 8 of `rgb`. */
function countColour(png: Buffer, rgb: [number, number, number]): number {
  const img = PNG.sync.read(png)
  let c = 0
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.abs(img.data[i]! - rgb[0]) <= 8 && Math.abs(img.data[i + 1]! - rgb[1]) <= 8 && Math.abs(img.data[i + 2]! - rgb[2]) <= 8) c++
  }
  return c
}
const FG: [number, number, number] = [0xf2, 0xec, 0xe2]

test.describe('cut frame with a non-empty incoming scene (R14 strict)', () => {
  for (const id of ['whip-pan', 'zoom-through', 'glitch-cut'] as const) {
    test(`${id}: the frame at the cut is strictly not empty`, async ({ page }) => {
      const sb = { ...fixture(`tr-${id}.json`) }
      sb.scenes = [sb.scenes[0]!, card('reveal', AT, 2) as never]
      await openStoryboard(page, sb, { testPrimitives: CARD_SRC })
      expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
      for (const t of [AT - FRAME, AT, AT + FRAME]) {
        const png = await freshFrameAt(page, t)
        expect(isEmptyFrame(png, BG), `t=${t}`).toBe(false)
      }
    })
  }
})

test.describe('cut drift within CUT_TOLERANCE (0.1 + 0.2 vs 0.3)', () => {
  // A = fg card, B = accent card. A.end = 0.1 + 0.2 = 0.30000000000000004 overshoots the cut at 0.3.
  const drift = (type: string, aEnd: 'over' | 'under') => ({
    version: 1,
    seed: 3,
    scenes: aEnd === 'over' ? [card('A', 0.1, 0.2, 'fg'), card('B', 0.3, 1)] : [card('A', 0, 0.2999, 'fg'), card('B', 0.3, 1)],
    transitions: [{ type, at: 0.3 }],
  })
  const vis = (page: Page) =>
    page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')].map((l) => [l.dataset.mbaScene, l.style.visibility])))

  for (const type of ['whip-pan', 'zoom-through', 'glitch-cut']) {
    test(`${type}: at the cut only the incoming layer shows (outgoing end overshoots)`, async ({ page }) => {
      const sb = drift(type, 'over')
      expect(0.1 + 0.2 > 0.3).toBe(true)
      await openStoryboard(page, sb, { testPrimitives: CARD_SRC })
      expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
      const png = await freshFrameAt(page, 0.3) // p = 0.5: the incoming branch
      expect(await vis(page)).toEqual({ A: 'hidden', B: 'visible' })
      expect(countColour(png, FG), 'no outgoing (fg) pixels at the cut').toBe(0)
      expect(isEmptyFrame(png, BG)).toBe(false)
      // and every frame from the cut to the window end: never the outgoing layer
      for (const t of [0.3 + 1e-9, 0.31, 0.4, 0.49]) {
        await freshFrameAt(page, t)
        expect((await vis(page)).A, `t=${t}`).toBe('hidden')
      }
      // before the cut the outgoing shows, the incoming does not
      await freshFrameAt(page, 0.3 - 1 / 60)
      expect(await vis(page)).toEqual({ A: 'visible', B: 'hidden' })
    })
  }

  for (const type of ['whip-pan', 'zoom-through']) {
    test(`${type}: no empty gap when the outgoing end falls just short of the cut`, async ({ page }) => {
      await openStoryboard(page, drift(type, 'under'), { testPrimitives: CARD_SRC })
      expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
      // After A.end (0.2999), before the cut (p just under 0.5): the stage keeps A shown and the
      // transition drives it (by design A is then almost gone: off screen / transparent).
      await freshFrameAt(page, 0.29995)
      expect(await vis(page)).toEqual({ A: 'visible', B: 'hidden' })
      const st = await page.evaluate(() => document.querySelector<HTMLElement>('#frame [data-mba-scene=A]')!.style.transform)
      expect(st).not.toBe('')
      // Earlier in the window A is plainly on screen.
      expect(isEmptyFrame(await freshFrameAt(page, 0.2), BG)).toBe(false)
    })
  }

  test('sceneAt attributes times as the stage shows them', () => {
    const over = parseStoryboard(drift('whip-pan', 'over'), ['_card'])
    expect(sceneAt(over, 0.29)).toBe('A')
    expect(sceneAt(over, 0.3)).toBe('B')
    expect(sceneAt(over, 0.3 + 1e-17)).toBe('B')
    const under = parseStoryboard(drift('whip-pan', 'under'), ['_card'])
    expect(sceneAt(under, 0.29995)).toBe('A')
    expect(sceneAt(under, 0.3)).toBe('B')
    const plain = parseStoryboard(fixture('tr-whip-pan.json'), ['slam', 'wipe-reveal'])
    expect(sceneAt(plain, AT)).toBe('reveal')
    expect(sceneAt(plain, AT - 1e-9)).toBe('hook')
    expect(sceneAt(plain, 4)).toBe('reveal')
  })
})

test.describe('transitions: verify and CLI (slow)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })

  for (const id of IDS) {
    test(`verify clean across the window: ${id}`, async () => {
      const extraTimes = [AT - D / 2 + 0.01, AT - D / 4, AT - FRAME, AT, AT + FRAME, AT + D / 4, AT + D / 2 - 0.01]
      const r = await verifyDeterminism({ storyboardPath: join(FIXTURES, `tr-${id}.json`), samplesPerScene: 5, extraTimes })
      expect(r.probes).toHaveLength(10 + extraTimes.length)
      // extra probes are attributed to the scene the stage shows; the cut itself shows the incoming one
      expect(r.probes.filter((p) => p.t < AT && p.t > 1.7).every((p) => p.sceneId === 'hook')).toBe(true)
      expect(r.probes.filter((p) => p.t >= AT && p.t < 2.3).every((p) => p.sceneId === 'reveal')).toBe(true)
      expect(r.mismatches).toEqual([])
    })
  }

  test('verify clean across the window: morph', async () => {
    const extraTimes = [AT - 0.29, AT - 0.15, AT - FRAME, AT, AT + FRAME, AT + 0.15, AT + 0.29]
    const r = await verifyDeterminism({ storyboardPath: join(FIXTURES, 'tr-morph.json'), samplesPerScene: 5, extraTimes })
    expect(r.pageErrors).toEqual([])
    expect(r.mismatches).toEqual([])
  })

  test('mba validate reports transition errors at their path', () => {
    const cli = (args: string[]) =>
      spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, encoding: 'utf8' })
    const ok = cli(['validate', join(FIXTURES, 'tr-glitch-cut.json')])
    expect(ok.status).toBe(0)
    expect(ok.stdout.trim()).toBe('OK')
    const bad = cli(['validate', join(FIXTURES, 'tr-bad.json')])
    expect(bad.status).toBe(1)
    expect(bad.stdout).toContain('transitions[0].duration')
  })
})
