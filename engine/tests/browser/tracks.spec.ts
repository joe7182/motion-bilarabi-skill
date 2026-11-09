import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStoryboard, freshFrameAt } from './helpers'
import { defaultExtraTimes, verifyDeterminism } from '../../src/node/verify'
import { parseStoryboard, type Storyboard } from '../../src/core/storyboard'

const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const FIXTURES = join(ENGINE, 'tests/fixtures')
const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

// tracks.json: track 0 hook | reveal with a color-wipe at 2.0 (d = 0.4); track 2 captions cap1 | cap2
// changing on the same jump cut (both prerolled 1 s, so cap2 is fully in at its first frame).
const AT = 2.0
const FRAME = 1 / 30
const ACCENT = [0xff, 0x5a, 0x1f] // dark-tech accent: the color-wipe panel
const FG = [0xf2, 0xec, 0xe2] // dark-tech fg: the slam headline colour

const seek = (page: Page, t: number) => page.evaluate((tt) => window.__mba.seek(tt), t)
/** `#frame` children in DOM order: scene ids, or `tr:<type>` for a transition overlay. */
const domOrder = (page: Page) =>
  page.evaluate(() =>
    [...document.getElementById('frame')!.children].map((el) => {
      const h = el as HTMLElement
      return h.dataset.mbaScene ?? `tr:${h.dataset.mbaTrOverlay}`
    }),
  )
const shown = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')].filter((l) => l.style.visibility === 'visible').map((l) => l.dataset.mbaScene),
  )

test.describe('tracks', () => {
  test('layer DOM order is (track, storyboard index); the overlay sits right above its track', async ({ page, browser }) => {
    await openStoryboard(page, fixture('tracks.json'))
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    expect(await domOrder(page)).toEqual(['hook', 'reveal', 'tr:color-wipe', 'cap1', 'cap2'])
    // Tracks 0, 1, 3 with a transition on track 1: above tracks 0 and 1, below track 3.
    const sc = (id: string, track: number, start: number, extra: Record<string, unknown> = {}) => ({
      id, type: 'slam', track, start, duration: 2, params: { text: 'نص' }, ...extra,
    })
    const multi = await browser.newPage()
    await openStoryboard(multi, {
      version: 1,
      scenes: [sc('t3', 3, 0), sc('t1a', 1, 0), sc('t0', 0, 0), sc('t1b', 1, 2), sc('t0b', 0, 2), sc('t3b', 3, 2)],
      transitions: [{ type: 'glitch-cut', at: 2, track: 1 }, { type: 'color-wipe', at: 2, track: 0 }],
    })
    expect(await multi.evaluate(() => window.__mba.error)).toBeUndefined()
    expect(await domOrder(multi)).toEqual(['t0', 't0b', 'tr:color-wipe', 't1a', 't1b', 'tr:glitch-cut', 't3', 't3b'])
    await multi.close()
  })

  test('a track-0 color-wipe never covers the track-2 caption; the captions change on the same cut', async ({ page }) => {
    await openStoryboard(page, fixture('tracks.json'))
    // Visibility: each track switches on its own; the wipe's p decides only for hook / reveal.
    await seek(page, AT - FRAME)
    expect((await shown(page)).sort()).toEqual(['cap1', 'hook'])
    await seek(page, AT + FRAME)
    expect((await shown(page)).sort()).toEqual(['cap2', 'reveal'])

    // p = 0.5: the panel covers the whole frame, the caption is drawn on top of it, fully opaque.
    const png = PNG.sync.read(await freshFrameAt(page, AT))
    expect((await shown(page)).sort()).toEqual(['cap2', 'reveal'])
    const cap = await page.evaluate(() => {
      const l = document.querySelector<HTMLElement>('#frame [data-mba-scene=cap2]')!
      const head = l.querySelector<HTMLElement>('[data-mba-part=headline]')!
      const r = head.getBoundingClientRect()
      const st = l.style
      return {
        opacity: getComputedStyle(l).opacity,
        fx: [st.transform, st.filter, st.clipPath, st.opacity],
        box: { x0: Math.floor(r.left), y0: Math.floor(r.top), x1: Math.ceil(r.right), y1: Math.ceil(r.bottom) },
      }
    })
    expect(cap.opacity).toBe('1')
    expect(cap.fx).toEqual(['', '', '', ''])
    const px = (x: number, y: number) => {
      const i = (y * png.width + x) * 4
      return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!]
    }
    const near = (c: number[], want: number[], tol: number) => c.every((v, k) => Math.abs(v - want[k]!) <= tol)
    let fgIn = 0
    let accentOut = 0
    let out = 0
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const c = px(x, y)
        const inside = x >= cap.box.x0 && x < cap.box.x1 && y >= cap.box.y0 && y < cap.box.y1
        if (inside) {
          if (near(c, FG, 2)) fgIn++
        } else {
          out++
          if (near(c, ACCENT, 1)) accentOut++
        }
      }
    }
    // Pure fg caption pixels (not blended with the panel): the caption is above the cover.
    expect(fgIn).toBeGreaterThan(500)
    // Everything outside the caption is the panel: the track-0 layers are covered.
    expect(accentOut / out).toBeGreaterThan(0.999)
  })

  test('defaultExtraTimes derives hard cuts per track', async () => {
    const sb = parseStoryboard(fixture('tracks.json'), ['slam', 'wipe-reveal'])
    // Track 0: the color-wipe probes. Track 2: a hard cut at 2.0 (cut − 1/fps and cut, both already there).
    const want = [1.9, AT - FRAME, AT, AT + FRAME, 2.1]
    const got = defaultExtraTimes(sb)
    expect(got).toHaveLength(want.length)
    want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 9))
    // A hard cut on track 2 at 1.0 is probed even though no track-0 scene changes there; a track-0
    // scene ending at 1.0 does not make a cut with a track-2 scene starting at 1.0.
    const sc = (id: string, start: number, duration: number, track = 0) => ({ id, type: 'slam', start, duration, preroll: 0, track, params: {} })
    const base = { version: 1, format: '9:16', look: 'dark-tech', dir: 'rtl', seed: 1, fps: 30 } as const
    const perTrack = defaultExtraTimes({
      ...base,
      scenes: [sc('a', 0, 3), sc('c1', 0, 1, 2), sc('c2', 1, 2, 2), sc('x', 0, 1.5, 1), sc('y', 1.5, 1.5, 2)],
    } as Storyboard)
    // c1 | c2 at 1.0 (track 2). x (track 1) ends at 1.5 where y (track 2) starts: not a cut.
    const wantPer = [1 - FRAME, 1]
    expect(perTrack).toHaveLength(wantPer.length)
    wantPer.forEach((w, i) => expect(perTrack[i]).toBeCloseTo(w, 9))
    // A transition on track 0 and a hard cut on track 2 both get their probes.
    const mixed = defaultExtraTimes({
      ...base,
      scenes: [sc('a', 0, 2), sc('b', 2, 2), sc('c1', 0, 1, 2), sc('c2', 1, 3, 2)],
      transitions: [{ type: 'color-wipe', at: 2, duration: 0.4, track: 0, params: {} }],
    } as Storyboard)
    const wantMixed = [1 - FRAME, 1, 1.9, AT - FRAME, AT, AT + FRAME, 2.1]
    expect(mixed).toHaveLength(wantMixed.length)
    wantMixed.forEach((w, i) => expect(mixed[i]).toBeCloseTo(w, 9))
  })

  test('verify is clean on tracks.json', async () => {
    test.setTimeout(240_000)
    const r = await verifyDeterminism({ storyboardPath: join(FIXTURES, 'tracks.json'), samplesPerScene: 5 })
    expect(r.pageErrors).toEqual([])
    expect(r.mismatches).toEqual([])
  })
})
