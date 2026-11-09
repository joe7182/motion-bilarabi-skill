import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { openStoryboard, frameAt, freshFrameAt } from './helpers'

const sbOf = (params: Record<string, unknown>, world: 'paper' | 'ink' = 'paper', duration = 4) => ({
  version: 1,
  format: '9:16',
  look: 'signature',
  seed: 7,
  scenes: [
    { id: 'b', type: 'backdrop', track: 0, start: 0, duration, params: { world } },
    { id: 'n', type: 'build-number', track: 1, start: 0, duration, params },
  ],
})

const noError = async (page: Page) => expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()

const domState = (page: Page) =>
  page.evaluate(() => {
    const g = document.querySelector('#frame [data-mba-part="build-number"]') as HTMLElement | null
    const units = [...document.querySelectorAll('#frame [data-mba-part="build-number"] [data-mba-text]')] as HTMLElement[]
    const shown = (el: HTMLElement | null): boolean => !!el && getComputedStyle(el).display !== 'none' && (el.parentElement ? shown(el.parentElement) || el.parentElement.id === 'frame' : true)
    return {
      group: g ? getComputedStyle(g).display : 'missing',
      texts: units.map((u) => ({ text: u.textContent, dir: u.dir, visible: u.offsetParent !== null })),
    }
  })

test('build-number (bricks): cold / warm identical mid-fall and mid-morph; the number is hidden (display:none) until the morph, then DOM text, audit clean', async ({ page }) => {
  test.setTimeout(120_000)
  const params = { value: '37,658', item: 'brick', fallFrom: 0.2, buildSec: 1.3, morphAt: 2.0, label: 'طابوقة' }
  for (const world of ['paper', 'ink'] as const) {
    await openStoryboard(page, sbOf(params, world))
    await noError(page)
    for (const t of [0.5, 0.9, 1.3, 2.1, 2.25, 2.6, 3.5]) {
      const cold = await freshFrameAt(page, t)
      await freshFrameAt(page, 3.9)
      await freshFrameAt(page, 0.05)
      await freshFrameAt(page, t - 0.37)
      expect(Buffer.compare(cold, await freshFrameAt(page, t)), `${world}: cold / warm at ${t}`).toBe(0)
      expect(await page.evaluate(() => window.__mba.audit()), `${world}: audit at ${t}`).toEqual([])
    }
  }
  await frameAt(page, 1.0)
  let s = await domState(page)
  expect(s.group, 'hidden mid-fall').toBe('none')
  await frameAt(page, 3.5)
  s = await domState(page)
  expect(s.group).not.toBe('none')
  expect(s.texts.map((x) => x.text)).toEqual(['37,658', 'طابوقة'])
  expect(s.texts[0]!.dir).toBe('ltr')
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('#frame [data-mba-part="build-number-items"]')!
    return { tag: c.tagName, aria: c.getAttribute('aria-hidden'), text: c.textContent }
  })
  expect(canvas).toEqual({ tag: 'CANVAS', aria: 'true', text: '' })
})

test('build-number: bills flutter into a big «؟» (determinism mid-flutter), the stacked question mark becomes the DOM «؟»; a burst from a point into scrambled ؟؟٬؟؟؟٬؟؟؟ rolls', async ({ page }) => {
  test.setTimeout(120_000)
  await openStoryboard(page, sbOf({ value: '؟', item: 'banknote', entry: 'flutter', buildSec: 1.4, morphAt: 2.0 }, 'ink'))
  await noError(page)
  for (const t of [0.4, 0.9, 1.3, 2.2]) {
    const cold = await freshFrameAt(page, t)
    await freshFrameAt(page, 3.9)
    await freshFrameAt(page, t - 0.37)
    expect(Buffer.compare(cold, await freshFrameAt(page, t)), `flutter cold / warm at ${t}`).toBe(0)
    expect(await page.evaluate(() => window.__mba.audit()), `audit at ${t}`).toEqual([])
  }
  await frameAt(page, 3.0)
  const s = await domState(page)
  expect(s.texts.map((x) => x.text)).toEqual(['؟'])
  expect(s.texts[0]!.dir).toBe('rtl')

  await openStoryboard(page, sbOf({ value: '؟؟٬؟؟؟٬؟؟؟', item: 'banknote', entry: 'flutter', from: { x: 0.5, y: 0.8 }, scramble: true, buildSec: 1.3, morphAt: 1.8 }, 'paper'))
  await noError(page)
  for (const t of [0.6, 1.9, 2.5]) {
    const cold = await freshFrameAt(page, t)
    await freshFrameAt(page, 3.9)
    await freshFrameAt(page, t - 0.37)
    expect(Buffer.compare(cold, await freshFrameAt(page, t)), `burst cold / warm at ${t}`).toBe(0)
    expect(await page.evaluate(() => window.__mba.audit()), `audit at ${t}`).toEqual([])
  }
  await frameAt(page, 2.5)
  const a = (await domState(page)).texts[0]!.text!
  await frameAt(page, 2.6)
  const b = (await domState(page)).texts[0]!.text!
  expect(a).toMatch(/^\d\d٬\d\d\d٬\d\d\d$/)
  expect(a, 'the digits roll').not.toBe(b)
})

test('build-number stills: bricks, cement sacks and bills mid-fall, stacked and morphed (engine/out/stage2-stills)', async ({ page }) => {
  test.setTimeout(240_000)
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const dir = 'out/stage2-stills'
  mkdirSync(dir, { recursive: true })
  const runs: [string, Record<string, unknown>, [string, number][]][] = [
    ['bricks', { value: '37,658', item: 'brick', fallFrom: 0.2, buildSec: 1.3, morphAt: 2.0, label: 'طابوقة' }, [['falling', 0.9], ['stacked', 1.75], ['morph', 2.2], ['number', 3.0]]],
    ['cement', { value: '456', item: 'cement-bag', fallFrom: 0.2, buildSec: 1.2, morphAt: 1.9, label: 'كيس سمنت' }, [['falling', 0.8], ['stacked', 1.6], ['number', 3.0]]],
    ['bills-flutter', { value: '؟', item: 'banknote', entry: 'flutter', buildSec: 1.4, morphAt: 2.0 }, [['flutter', 0.8], ['stacked', 1.7], ['morph', 2.2], ['number', 3.0]]],
    ['bills-burst', { value: '؟؟٬؟؟؟٬؟؟؟', item: 'banknote', entry: 'flutter', from: { x: 0.5, y: 0.85 }, scramble: true, buildSec: 1.3, morphAt: 1.8 }, [['burst', 0.6], ['stacked', 1.6], ['number', 2.6]]],
  ]
  for (const world of ['paper', 'ink'] as const) {
    for (const [name, params, times] of runs) {
      await openStoryboard(page, sbOf(params, world))
      await noError(page)
      for (const [label, t] of times) {
        const png = await frameAt(page, t)
        const img = PNG.sync.read(png)
        // half-size frame
        const out = new PNG({ width: img.width / 2, height: img.height / 2 })
        for (let y = 0; y < out.height; y++)
          for (let x = 0; x < out.width; x++) {
            const i = (y * 2 * img.width + x * 2) * 4
            const o = (y * out.width + x) * 4
            for (let k = 0; k < 4; k++) out.data[o + k] = img.data[i + k]!
          }
        writeFileSync(`${dir}/${world}-build-number-${name}-${label}.png`, PNG.sync.write(out))
      }
    }
  }
})
