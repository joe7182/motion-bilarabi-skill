import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshFrameAt, openStoryboard } from './helpers'
import { resolveAnchors } from '../../src/core/anchors'
import { verifyDeterminism } from '../../src/node/verify'
import type { Transcript } from '../../src/core/transcript'

// Plan 2a+ Task 6: the one-world camera (fixed tracks 0 and 5 stay put) and the hero element.

/** `_still`: one Arabic word unit at a fixed spot (no drift, no entrance), keyed `still`. */
const STILL = `() => [{
  id: '_still',
  build(ctx) {
    const word = document.createElement('span')
    word.dataset.mbaText = 'word'
    word.dataset.mbaKey = 'still'
    word.dir = 'rtl'
    word.lang = 'ar'
    Object.assign(word.style, { position: 'absolute', left: '400px', top: '900px', fontSize: '96px', fontFamily: ctx.look.fontDisplay, color: ctx.look.vars.fg, lineHeight: '1.3' })
    word.textContent = 'كلمة'
    ctx.layer.append(word)
    return {}
  },
}]`

const seek = (page: Page, t: number) => page.evaluate((tt) => window.__mba.seek(tt), t)

/** Union of the Range client rects of the text under `selector` (the audit's glyph boxes), in frame px. */
const glyphBox = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) throw new Error(`no element ${sel}`)
    const F = document.getElementById('frame')!.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(el)
    const rs = [...range.getClientRects()].filter((r) => r.width > 0)
    const x0 = Math.min(...rs.map((r) => r.left)) - F.left
    const y0 = Math.min(...rs.map((r) => r.top)) - F.top
    const x1 = Math.max(...rs.map((r) => r.right)) - F.left
    const y1 = Math.max(...rs.map((r) => r.bottom)) - F.top
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }
  }, selector)

const centreOf = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) throw new Error(`no element ${sel}`)
    const F = document.getElementById('frame')!.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return { x: (r.left + r.right) / 2 - F.left, y: (r.top + r.bottom) / 2 - F.top }
  }, selector)

const heroBoard = (extra: Record<string, unknown> = {}) => ({
  version: 1,
  scenes: [
    { id: 'bg', type: 'backdrop', start: 0, duration: 4, params: { pattern: 'dots', patternAlpha: 0.3, react: { hero: 'hero' } } },
    { id: 'kt', type: 'kinetic-text', track: 1, start: 1.5, duration: 2.5, params: { words: [{ text: 'مرحبا', at: 0, key: 'w' }] } },
    { id: 'hero', type: 'hero', track: 4, start: 0, duration: 4, params: { path: [{ at: 0, x: 0.2, y: 0.5 }, { at: 2, target: 'w' }] } },
  ],
  ...extra,
})

test.describe('hero', () => {
  test('a target point lands the hero on the keyed word at its at (within 4 px)', async ({ page }) => {
    await openStoryboard(page, heroBoard())
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    await seek(page, 2)
    const word = await glyphBox(page, '#frame [data-mba-key="w"]')
    const hero = await centreOf(page, '#frame [data-mba-scene="hero"] [data-mba-part="hero"]')
    expect(Math.abs(hero.x - word.cx), JSON.stringify({ hero, word })).toBeLessThan(4)
    expect(Math.abs(hero.y - word.cy), JSON.stringify({ hero, word })).toBeLessThan(4)
    // Before its first at + lead, the hero sits on the first point (0.2, 0.5 of the safe area).
    await seek(page, 0.5)
    const start = await centreOf(page, '#frame [data-mba-scene="hero"] [data-mba-part="hero"]')
    const safe = { x: 64.8, y: 268.8, w: 885.6, h: 1228.8 }
    expect(Math.abs(start.x - (safe.x + 0.2 * safe.w))).toBeLessThan(1)
    expect(Math.abs(start.y - (safe.y + 0.5 * safe.h))).toBeLessThan(1)
  })

  test('backdrop dots with react.hero: the dot nearest the hero is more than twice a far dot', async ({ page }) => {
    await openStoryboard(page, heroBoard())
    await seek(page, 2)
    const hero = await centreOf(page, '#frame [data-mba-scene="hero"] [data-mba-part="hero"]')
    const dots = await page.evaluate(() =>
      [...document.querySelectorAll('#frame [data-mba-part="pattern-dots"] circle')].map((c) => ({
        x: Number(c.getAttribute('cx')),
        y: Number(c.getAttribute('cy')),
        r: Number(c.getAttribute('r')),
      })),
    )
    expect(dots.length).toBeGreaterThan(100)
    const d = (p: { x: number; y: number }) => Math.hypot(p.x - hero.x, p.y - hero.y)
    const byDist = [...dots].sort((a, b) => d(a) - d(b))
    const near = byDist[0]!
    const far = byDist.at(-1)!
    expect(near.r, JSON.stringify({ near, far, hero })).toBeGreaterThan(2 * far.r)
    // Without react the field only breathes: the near dot is no outlier.
    const plain = heroBoard()
    ;(plain.scenes[0]!.params as Record<string, unknown>).react = undefined
    await openStoryboard(page, plain)
    await seek(page, 2)
    const rs = await page.evaluate(() => [...document.querySelectorAll('#frame [data-mba-part="pattern-dots"] circle')].map((c) => Number(c.getAttribute('r'))))
    // Breathing alone spans 0.4..1.6 of the base radius.
    expect(Math.max(...rs) / Math.min(...rs)).toBeLessThanOrEqual(4.01)
  })
})

test.describe('hero under the camera (fix round 1)', () => {
  test('dots on fixed track 0 swell where the hero shows ON SCREEN (zoom 1.4 at x 0.3); the frame is pixel-identical twice', async ({ page }) => {
    await openStoryboard(page, heroBoard({ camera: { keys: [{ at: 0, x: 0.3, y: 0.5, zoom: 1.4 }] } }))
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    await seek(page, 2)
    // On-screen centre (client rects include the world transform); the world point is the untransformed layout.
    const screen = await centreOf(page, '#frame [data-mba-scene="hero"] [data-mba-part="hero"]')
    const world = await page.evaluate(() => {
      const w = document.getElementById('mba-world')!
      const prev = w.style.transform
      w.style.transform = ''
      const F = document.getElementById('frame')!.getBoundingClientRect()
      const r = document.querySelector('#frame [data-mba-scene="hero"] [data-mba-part="hero"]')!.getBoundingClientRect()
      w.style.transform = prev
      return { x: (r.left + r.right) / 2 - F.left, y: (r.top + r.bottom) / 2 - F.top }
    })
    // The camera really moves the hero on screen (else this test proves nothing).
    expect(Math.hypot(screen.x - world.x, screen.y - world.y)).toBeGreaterThan(150)
    const dots = await page.evaluate(() =>
      [...document.querySelectorAll('#frame [data-mba-part="pattern-dots"] circle')].map((c) => ({
        x: Number(c.getAttribute('cx')),
        y: Number(c.getAttribute('cy')),
        r: Number(c.getAttribute('r')),
      })),
    )
    const nearest = (p: { x: number; y: number }) => [...dots].sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))
    const byScreen = nearest(screen)
    const far = byScreen.at(-1)!
    expect(byScreen[0]!.r, JSON.stringify({ near: byScreen[0], far, screen })).toBeGreaterThan(2 * far.r)
    // The dot under the hero's world point (far from the screen point) is not swollen.
    expect(nearest(world)[0]!.r).toBeLessThan(byScreen[0]!.r / 2)
    const a = await freshFrameAt(page, 2)
    await seek(page, 0.7)
    const b = await freshFrameAt(page, 2)
    expect(a.equals(b)).toBe(true)
  })
})

test.describe('camera', () => {
  const transcript: Transcript = {
    version: 1,
    media: 'm1',
    sourceHash: 'x',
    model: 'ggml-small.bin',
    language: 'ar',
    words: [
      { i: 0, text: 'أ', start: 0.2, end: 0.5, p: 0.9 },
      { i: 1, text: 'ب', start: 0.8, end: 1.2, p: 0.9 },
      { i: 2, text: 'ج', start: 2.0, end: 2.4, p: 0.9 },
    ],
  }
  const cameraBoard = () =>
    resolveAnchors(
      {
        version: 1,
        scenes: [
          { id: 'bg', type: 'backdrop', start: 0, duration: 4, params: {} },
          { id: 'main', type: '_still', track: 1, start: 0, duration: 4, params: {} },
          { id: 'hud', type: 'hud', track: 5, start: 0, duration: 4, params: { sections: [{ label: 'الفصل الأول', at: 0 }], progress: 'none' } },
        ],
        camera: { keys: [{ at: 0, zoom: 1 }, { at: { word: 2 }, x: 0.5, y: 0.4, zoom: 1.4 }] },
      },
      { transcript, fps: 30 },
    ).json

  test('the world zooms 1.4× by the anchored key; the HUD on track 5 and the backdrop stay fixed', async ({ page }) => {
    await openStoryboard(page, cameraBoard(), { testPrimitives: STILL })
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    // Layers of tracks 1..4 sit inside #mba-world; 0 and 5 do not.
    const parents = await page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')].map((l) => [l.dataset.mbaScene, l.parentElement!.id])),
    )
    expect(parents).toEqual({ bg: 'frame', main: 'mba-world', hud: 'frame' })
    await seek(page, 0)
    const hud0 = await glyphBox(page, '#frame [data-mba-scene="hud"] [data-mba-text]')
    const main0 = await glyphBox(page, '#frame [data-mba-key="still"]')
    await seek(page, 3)
    const hud3 = await glyphBox(page, '#frame [data-mba-scene="hud"] [data-mba-text]')
    const main3 = await glyphBox(page, '#frame [data-mba-key="still"]')
    expect(hud3).toEqual(hud0)
    expect(main3.w / main0.w).toBeGreaterThan(1.4 * 0.98)
    expect(main3.w / main0.w).toBeLessThan(1.4 * 1.02)
    expect(main3.h / main0.h).toBeGreaterThan(1.4 * 0.98)
    expect(main3.h / main0.h).toBeLessThan(1.4 * 1.02)
    expect(await page.evaluate(() => document.getElementById('mba-world')!.style.transform)).toBe('translate(-216px, -115.2px) scale(1.4)')
  })

  test('no camera: no world wrapper, layers stay direct children of the frame', async ({ page }) => {
    const sb = cameraBoard() as Record<string, unknown>
    delete sb.camera
    await openStoryboard(page, sb, { testPrimitives: STILL })
    await seek(page, 3)
    expect(await page.evaluate(() => document.getElementById('mba-world'))).toBeNull()
    expect(await page.evaluate(() => [...document.getElementById('frame')!.children].map((c) => (c as HTMLElement).dataset.mbaScene))).toEqual(['bg', 'main', 'hud'])
  })

  test('determinism: the camera frame at 1.37 s renders identically cold and warm', async () => {
    test.setTimeout(240_000)
    const dir = await mkdtemp(join(tmpdir(), 'mba-camera-'))
    try {
      const path = join(dir, 'camera.json')
      await writeFile(path, JSON.stringify(heroBoard({ camera: { keys: [{ at: 0, zoom: 1 }, { at: 3, x: 0.45, y: 0.4, zoom: 1.5 }] } })))
      const r = await verifyDeterminism({ storyboardPath: path, samplesPerScene: 1, extraTimes: [1.37], mismatchDir: join(dir, 'verify') })
      expect(r.probes.map((p) => p.t)).toContain(1.37)
      expect(r.pageErrors).toEqual([])
      expect(r.mismatches).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// Plan 3 Task 4: the living camera — handheld drift, hit shakes and per-scene depth (parallax).

/**
 * `_spot`: one Arabic word at a fixed spot (keyed with its scene id) and a 0×0 pin at its layer
 * point (400, 900). `_mapper`: on update, maps the point (400, 900) of scene `deep` into its own
 * layer space (`toThisSpace`) and writes it to `data-x` / `data-y`.
 */
const SPOT = `() => [{
  id: '_spot',
  build(ctx) {
    const id = ctx.layer.dataset.mbaScene
    const word = document.createElement('span')
    word.dataset.mbaText = 'word'
    word.dataset.mbaKey = id
    word.dir = 'rtl'
    word.lang = 'ar'
    Object.assign(word.style, { position: 'absolute', left: '400px', top: '900px', fontSize: '96px', fontFamily: ctx.look.fontDisplay, color: ctx.look.vars.fg, lineHeight: '1.3' })
    word.textContent = 'كلمة'
    const pin = document.createElement('i')
    pin.dataset.mbaPart = 'pin'
    Object.assign(pin.style, { position: 'absolute', left: '400px', top: '900px', width: '0', height: '0' })
    ctx.layer.append(word, pin)
    return {}
  },
}, {
  id: '_mapper',
  build(ctx) {
    const info = ctx.sceneParams('deep')
    const out = document.createElement('i')
    out.dataset.mbaPart = 'probe'
    ctx.layer.append(out)
    return {
      update(localT) {
        const p = info.toThisSpace({ x: 400, y: 900 }, localT)
        out.dataset.x = String(p.x)
        out.dataset.y = String(p.y)
      },
    }
  },
}]`

test.describe('living camera (Plan 3 Task 4)', () => {
  const words = (id: string, text: string, depth: number, track: number) => ({
    id,
    type: 'kinetic-text',
    track,
    depth,
    start: 0,
    duration: 3,
    params: { words: [{ text, at: 0, key: id }] },
  })

  test('parallax: zoom 1 → 1.3 over 0–2 s grows a depth-2 word ≥ 1.5× and a depth-0.3 word ≤ 1.12×', async ({ page }) => {
    await openStoryboard(page, {
      version: 1,
      scenes: [words('far', 'بعيد', 0.3, 1), words('near', 'قريب', 2, 2)],
      camera: { keys: [{ at: 0, zoom: 1 }, { at: 2, zoom: 1.3 }] },
    })
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    // Depth ≠ 1: each in its own wrapper (no #mba-world: no depth-1 layer), with data-mba-depth.
    const wrap = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')].map((l) => [l.dataset.mbaScene, [l.parentElement!.parentElement!.id, l.parentElement!.dataset.mbaDepth]]),
      ),
    )
    expect(wrap).toEqual({ far: ['frame', '0.3'], near: ['frame', '2'] })
    await seek(page, 0)
    const far0 = await glyphBox(page, '#frame [data-mba-key="far"]')
    const near0 = await glyphBox(page, '#frame [data-mba-key="near"]')
    await seek(page, 2)
    const far2 = await glyphBox(page, '#frame [data-mba-key="far"]')
    const near2 = await glyphBox(page, '#frame [data-mba-key="near"]')
    expect(near2.w / near0.w, JSON.stringify({ near0, near2 })).toBeGreaterThanOrEqual(1.5)
    expect(far2.w / far0.w, JSON.stringify({ far0, far2 })).toBeLessThanOrEqual(1.12)
    expect(far2.w / far0.w).toBeGreaterThan(1.05)
    // The same frame without the wrappers' transforms: the camera alone scales 1 + 0.3·d.
    const bare = await page.evaluate(() => {
      const ws = [...document.querySelectorAll<HTMLElement>('#frame [data-mba-world]')]
      const prev = ws.map((w) => w.style.transform)
      ws.forEach((w) => (w.style.transform = ''))
      const width = (k: string) => {
        const r = document.createRange()
        r.selectNodeContents(document.querySelector(`#frame [data-mba-key="${k}"]`)!)
        const rs = [...r.getClientRects()].filter((x) => x.width > 0)
        return Math.max(...rs.map((x) => x.right)) - Math.min(...rs.map((x) => x.left))
      }
      const out = { far: width('far'), near: width('near') }
      ws.forEach((w, i) => (w.style.transform = prev[i]!))
      return out
    })
    expect(near2.w / bare.near).toBeCloseTo(1.6, 2)
    expect(far2.w / bare.far).toBeCloseTo(1.09, 2)
  })

  test('handheld: a still word under the camera moves ≥ 1 px between 2.0 and 2.5 s; a word on fixed track 5 does not', async ({ page }) => {
    await openStoryboard(
      page,
      {
        version: 1,
        scenes: [
          { id: 'w', type: '_spot', track: 1, start: 0, duration: 4, params: {} },
          { id: 'hud', type: '_spot', track: 5, start: 0, duration: 4, params: {} },
        ],
        camera: { keys: [{ at: 0, zoom: 1 }], handheld: {} },
      },
      { testPrimitives: SPOT },
    )
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    await seek(page, 2)
    const w0 = await glyphBox(page, '#frame [data-mba-key="w"]')
    const h0 = await glyphBox(page, '#frame [data-mba-key="hud"]')
    await seek(page, 2.5)
    const w1 = await glyphBox(page, '#frame [data-mba-key="w"]')
    const h1 = await glyphBox(page, '#frame [data-mba-key="hud"]')
    expect(Math.max(Math.abs(w1.cx - w0.cx), Math.abs(w1.cy - w0.cy)), JSON.stringify({ w0, w1 })).toBeGreaterThanOrEqual(1)
    expect(h1).toEqual(h0)
    // Depth 1 keeps the shared #mba-world (the jitter is applied there, with a rotation).
    expect(await page.evaluate(() => document.querySelector('#frame [data-mba-scene="w"]')!.parentElement!.id)).toBe('mba-world')
    expect(await page.evaluate(() => document.getElementById('mba-world')!.style.transform)).toMatch(/rotate\(/)
  })

  test('toThisSpace from a depth-2 layer under a panning, shaking camera lands on the point as drawn (within 0.5 px)', async ({ page }) => {
    await openStoryboard(
      page,
      {
        version: 1,
        scenes: [
          { id: 'deep', type: '_spot', track: 2, depth: 2, start: 0, duration: 3, params: {} },
          { id: 'probe', type: '_mapper', track: 5, start: 0, duration: 3, params: {} },
        ],
        camera: { keys: [{ at: 0, zoom: 1 }, { at: 2, x: 0.58, y: 0.46, zoom: 1.3 }], fixedTracks: [5], handheld: { amp: 2 }, shakes: [{ at: 1, amp: 25 }] },
      },
      { testPrimitives: SPOT },
    )
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    for (const t of [0.5, 1.04, 1.9]) {
      await seek(page, t)
      const got = await page.evaluate(() => {
        const F = document.getElementById('frame')!.getBoundingClientRect()
        const pin = document.querySelector('#frame [data-mba-scene="deep"] [data-mba-part="pin"]')!.getBoundingClientRect()
        const probe = document.querySelector<HTMLElement>('#frame [data-mba-part="probe"]')!
        return { pin: { x: pin.left - F.left, y: pin.top - F.top }, probe: { x: Number(probe.dataset.x), y: Number(probe.dataset.y) } }
      })
      // The camera really moves the point (else this proves nothing).
      expect(Math.hypot(got.pin.x - 400, got.pin.y - 900)).toBeGreaterThan(5)
      expect(Math.abs(got.probe.x - got.pin.x), `${t}: ${JSON.stringify(got)}`).toBeLessThan(0.5)
      expect(Math.abs(got.probe.y - got.pin.y), `${t}: ${JSON.stringify(got)}`).toBeLessThan(0.5)
    }
  })

  test('a depth-0.3 material backdrop under the camera (fixedTracks [5]) never shows an edge under handheld, a hard shake and the zoom', async ({ page }) => {
    await openStoryboard(page, {
      version: 1,
      look: 'signature',
      seed: 7,
      scenes: [
        { id: 'bg', type: 'backdrop', track: 0, depth: 0.3, start: 0, duration: 3, params: { world: 'paper', material: {} } },
        words('mid', 'وسط', 1, 1),
      ],
      camera: { keys: [{ at: 0, zoom: 1 }, { at: 2, zoom: 1.3 }], fixedTracks: [5], handheld: { amp: 3 }, shakes: [{ at: 1, amp: 30 }] },
    })
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    expect(await page.evaluate(() => document.querySelector<HTMLElement>('#frame [data-mba-scene="bg"]')!.parentElement!.dataset.mbaDepth)).toBe('0.3')
    // Anything the backdrop does not cover shows this green.
    await page.evaluate(() => (document.getElementById('frame')!.style.background = '#00ff00'))
    for (const t of [0, 1 + 1 / 30, 1.1, 2, 2.9]) {
      const png = PNG.sync.read(await freshFrameAt(page, t))
      // The wrapper really moves at the hit (else this proves nothing): its jitter is ≥ 3 px.
      if (t === 1 + 1 / 30) {
        const tf = await page.evaluate(() => document.querySelector<HTMLElement>('#frame [data-mba-scene="bg"]')!.parentElement!.style.transform)
        const m = /^translate\(([-\d.]+)px, ([-\d.]+)px\) rotate/.exec(tf)
        expect(m, tf).not.toBeNull()
        expect(Math.hypot(Number(m![1]) - 540, Number(m![2]) - 960), tf).toBeGreaterThanOrEqual(3)
      }
      let green = 0
      const at = (x: number, y: number) => {
        const i = (y * png.width + x) * 4
        if (png.data[i + 1]! > 200 && png.data[i]! < 100 && png.data[i + 2]! < 100) green++
      }
      for (let x = 0; x < png.width; x++) for (const y of [0, 1, png.height - 2, png.height - 1]) at(x, y)
      for (let y = 0; y < png.height; y++) for (const x of [0, 1, png.width - 2, png.width - 1]) at(x, y)
      expect(green, `t = ${t}`).toBe(0)
    }
  })

  test('determinism: handheld, a shake and depth layers render identically cold and warm', async () => {
    test.setTimeout(240_000)
    const dir = await mkdtemp(join(tmpdir(), 'mba-living-camera-'))
    try {
      const path = join(dir, 'living.json')
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          look: 'signature',
          scenes: [
            { id: 'bg', type: 'backdrop', track: 0, depth: 0.3, start: 0, duration: 3, params: { world: 'paper', material: {} } },
            words('mid', 'وسط', 1, 1),
            words('near', 'قريب', 2, 2),
          ],
          camera: { keys: [{ at: 0, zoom: 1 }, { at: 2, x: 0.55, y: 0.45, zoom: 1.3 }], fixedTracks: [5], handheld: {}, shakes: [{ at: 1, amp: 20 }] },
        }),
      )
      const r = await verifyDeterminism({ storyboardPath: path, samplesPerScene: 1, extraTimes: [1.05, 1.37], mismatchDir: join(dir, 'verify') })
      expect(r.probes.map((p) => p.t)).toContain(1.05)
      expect(r.pageErrors).toEqual([])
      expect(r.mismatches).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
