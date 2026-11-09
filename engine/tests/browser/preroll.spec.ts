import { test, expect, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStoryboard, freshFrameAt, isEmptyFrame, frameStats } from './helpers'
import { diffPngs } from '../../src/node/png-diff'
import { verifyDeterminism } from '../../src/node/verify'

// R27: a scene's `preroll` starts its animation `preroll` seconds before the scene appears.
const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const PREROLL = join(ENGINE, 'tests/fixtures/preroll.json')
const BG = '#0e0d0c' // dark-tech look.bg

type Scene = { id: string; type: string; start: number; duration: number; preroll?: number; params: Record<string, unknown> }
const sb = (scenes: Scene[], extra: Record<string, unknown> = {}) => ({ version: 1, format: '9:16', look: 'dark-tech', seed: 3, scenes, ...extra })

const SLAM = { text: 'Claude أصبح أذكى', accent: 'أذكى', tag: 'تحديث جديد' }
const SEARCH = { text: 'ما هو الموشن؟', results: 2 }
const WIPE = { title: 'يوسف', subtitle: '@yousif_aljbouri' }

async function open(browser: Browser, json: unknown): Promise<Page> {
  const page = await browser.newPage()
  await openStoryboard(page, json)
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  return page
}

/** Each pair [ta, tb]: the frame of `pre` at ta is byte-equal to the frame of `ref` at tb. */
async function expectShifted(browser: Browser, pre: unknown, ref: unknown, pairs: [number, number][]) {
  const a = await open(browser, pre)
  const b = await open(browser, ref)
  try {
    for (const [ta, tb] of pairs) {
      const d = diffPngs(await freshFrameAt(a, ta), await freshFrameAt(b, tb))
      expect(d.diffPixels, `preroll t=${ta} vs reference t=${tb} (max Δ ${d.maxChannelDelta})`).toBe(0)
    }
  } finally {
    await a.close()
    await b.close()
  }
}

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test('slam at start 0 with preroll 0.3 shows at t the frame the un-prerolled scene shows at t + 0.3', async ({ browser }) => {
  const pre = sb([{ id: 'h', type: 'slam', start: 0, duration: 2, preroll: 0.3, params: SLAM }])
  const ref = sb([{ id: 'h', type: 'slam', start: 0, duration: 2.3, params: SLAM }])
  // 0: the cut frame; 0.3: mid-shake; 1.2: rest; 1.9: mid-exit; 2: the last frame (exit done at the end).
  await expectShifted(browser, pre, ref, [0, 0.3, 1.2, 1.9, 2].map((t) => [t, t + 0.3]))
})

test('search-typing (update-driven) with preroll at start 0 matches the shifted reference', async ({ browser }) => {
  const pre = sb([{ id: 's', type: 'search-typing', start: 0, duration: 2.6, preroll: 0.2, params: SEARCH }])
  const ref = sb([{ id: 's', type: 'search-typing', start: 0, duration: 2.8, params: SEARCH }])
  await expectShifted(browser, pre, ref, [0, 0.5, 1.1, 2.0, 2.55].map((t) => [t, t + 0.2]))
})

test('a prerolled scene after another scene: same frames as its reference, and never shown before start', async ({ browser }) => {
  // Same scene index (1) in both, so the per-scene rng seed is the same.
  const first: Scene = { id: 'a', type: 'wipe-reveal', start: 0, duration: 1.5, params: WIPE }
  const pre = sb([first, { id: 'h', type: 'slam', start: 1.5, duration: 1.5, preroll: 0.4, params: SLAM }])
  const ref = sb([first, { id: 'h', type: 'slam', start: 1.1, duration: 1.9, params: SLAM }])
  await expectShifted(browser, pre, ref, [1.5, 1.7, 2.4, 2.9, 3].map((t) => [t, t]))

  const page = await open(browser, pre)
  try {
    const vis = (t: number) =>
      page.evaluate(async (tt) => {
        await window.__mba.seek(tt)
        return [...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')].map((l) => l.style.visibility)
      }, t)
    // The preroll window [1.1, 1.5) belongs to scene a: the slam layer stays hidden until its start.
    expect(await vis(1.2)).toEqual(['visible', 'hidden'])
    expect(await vis(1.5 - 1e-6)).toEqual(['visible', 'hidden'])
    expect(await vis(1.5)).toEqual(['hidden', 'visible'])
    // The cut frame is not empty: the slam has already played 0.4 s.
    expect(isEmptyFrame(await freshFrameAt(page, 1.5), BG)).toBe(false)
  } finally {
    await page.close()
  }
})

test('transition at a cut into a prerolled scene: p-driven visibility, no empty cut frame, no leakage', async ({ browser }) => {
  const json = JSON.parse(readFileSync(PREROLL, 'utf8'))
  const page = await open(browser, json)
  const plain = await open(browser, { ...json, transitions: [] })
  try {
    const state = (t: number) =>
      page.evaluate(async (tt) => {
        await window.__mba.seek(tt)
        return {
          vis: [...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')].map((l) => l.style.visibility),
          tf: [...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene]')].map((l) => l.style.transform),
          flag: document.getElementById('frame')!.getAttribute('data-mba-tr'),
        }
      }, t)
    const before = await state(2.6 - 1 / 30)
    expect(before.vis).toEqual(['visible', 'hidden'])
    expect(before.tf[0]).toMatch(/translateX\(-/)
    expect(before.flag).toBe('1')
    const cut = await state(2.6)
    expect(cut.vis).toEqual(['hidden', 'visible'])
    expect(cut.tf[1]).toMatch(/translateX\(864px\)/) // incoming at +0.8·W
    // Strictly not empty at the cut and one frame either side: the slam is 0.25 s into its intro.
    for (const t of [2.6 - 1 / 30, 2.6, 2.6 + 1 / 30]) {
      const png = await freshFrameAt(page, t)
      expect(isEmptyFrame(png, BG), `t=${t} lumVariance=${frameStats(png).lumVariance.toFixed(1)}`).toBe(false)
    }
    // Outside the window the transition leaves nothing behind.
    for (const t of [2.3, 2.85, 3.5]) {
      const st = await state(t)
      expect(st.tf, `t=${t}`).toEqual(['', ''])
      expect(st.flag, `t=${t}`).toBeNull()
      const d = diffPngs(await freshFrameAt(page, t), await freshFrameAt(plain, t))
      expect(d.diffPixels, `t=${t}`).toBe(0)
    }
  } finally {
    await page.close()
    await plain.close()
  }
})

test('verify is clean on the preroll fixture, densely around the cut', async () => {
  const r = await verifyDeterminism({ storyboardPath: PREROLL, extraTimes: [0, 2.4, 2.5, 2.6 - 1 / 30, 2.6, 2.6 + 1 / 30, 2.7, 2.8] })
  expect(r.probes.length).toBe(2 * 5 + 8)
  expect(r.mismatches).toEqual([])
})
