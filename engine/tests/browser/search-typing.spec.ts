import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { openStoryboard, frameAt, unsanctionedArabicText, charBoxes, readsLeftToRight } from './helpers'

type Fixture = { scenes: { duration: number; params: Record<string, unknown> }[] } & Record<string, unknown>
const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'))

const GOLDEN = { maxDiffPixelRatio: 0.002 }
const search = fixture('search.json')
const TEXT = search.scenes[0]!.params.text as string
const CPS = 14
/** Typing phase length per the brief: one per-char time per character, two for a space. */
const typingDuration = (text: string, cps: number) => [...text].reduce((s, ch) => s + (ch === ' ' ? 2 : 1), 0) / cps
/** Local time of the fixture's results phase: rows have finished staggering in. */
const RESULTS_T = 5.5

async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate((tt) => window.__mba.seek(tt), t)
}

async function noError(page: Page): Promise<void> {
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
}

/** The typing unit's text nodes (there must be exactly one). */
const typedNodes = (page: Page) =>
  page.evaluate(() => {
    const els = document.querySelectorAll('#frame [data-mba-text=typing]')
    if (els.length !== 1) return { count: els.length, texts: [] as string[] }
    const texts = [...els[0]!.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.nodeValue ?? '')
    return { count: 1, texts }
  })

test.describe('search-typing', () => {
  test('typed text is always a prefix in one node', async ({ page }) => {
    await openStoryboard(page, search)
    await noError(page)
    const full = [...TEXT]
    let grew = 0
    for (const t of [0.6, 1.0, 1.6, 2.4]) {
      await seek(page, t)
      const r = await typedNodes(page)
      expect(r.count, `t=${t}`).toBe(1)
      expect(r.texts.length, `t=${t}`).toBe(1)
      const typed = [...r.texts[0]!]
      expect(typed.length, `t=${t}`).toBeGreaterThan(grew)
      expect(typed, `t=${t}`).toEqual(full.slice(0, typed.length))
      grew = typed.length
    }
  })

  test('fully typed by end of typing phase', async ({ page }) => {
    await openStoryboard(page, search)
    await seek(page, 0.5 + typingDuration(TEXT, CPS) + 0.01)
    expect((await typedNodes(page)).texts).toEqual([TEXT])
  })

  test('nothing is typed before the typing phase', async ({ page }) => {
    await openStoryboard(page, search)
    await seek(page, 0.3)
    expect((await typedNodes(page)).texts).toEqual([''])
  })

  test('camera keeps caret near target while the typed span fits (short query)', async ({ page }) => {
    const short = structuredClone(search)
    short.scenes[0]!.params.text = 'كيف'
    await openStoryboard(page, short)
    for (const t of [0.9, 1.0]) {
      await seek(page, t)
      const c = await page.locator('#frame [data-mba-caret]').evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
      expect(Math.hypot(c.x - 540, c.y - 806), `t=${t} caret at ${c.x.toFixed(1)},${c.y.toFixed(1)}`).toBeLessThanOrEqual(40)
    }
  })

  test('a long query: the clamp binds, the caret stays in the frame and the text start edge stays inside it', async ({ page }) => {
    await openStoryboard(page, search)
    for (const t of [1.6, 2.4]) {
      await seek(page, t)
      const r = await page.evaluate(() => {
        const el = document.querySelector('#frame [data-mba-text=typing]')!
        const range = document.createRange()
        range.selectNodeContents(el.firstChild!)
        const text = range.getBoundingClientRect()
        const caret = el.querySelector('[data-mba-caret]')!.getBoundingClientRect()
        return { left: Math.min(text.left, caret.left), right: Math.max(text.right, caret.right) }
      })
      expect(r.left, `t=${t}`).toBeGreaterThanOrEqual(0)
      expect(r.right, `t=${t}`).toBeLessThanOrEqual(1080)
    }
  })

  test('caret sits at the leading (left) edge of the typed text', async ({ page }) => {
    await openStoryboard(page, search)
    await seek(page, 2.4)
    const r = await page.evaluate(() => {
      const el = document.querySelector('#frame [data-mba-text=typing]')!
      const range = document.createRange()
      range.selectNodeContents(el.firstChild!)
      const text = range.getBoundingClientRect()
      const caret = el.querySelector('[data-mba-caret]')!.getBoundingClientRect()
      return { textLeft: text.left, textRight: text.right, caretLeft: caret.left, caretRight: caret.right }
    })
    expect(r.caretRight).toBeLessThanOrEqual(r.textLeft + 1)
    expect(r.textLeft - r.caretRight).toBeLessThan(30)
  })

  test('camera is back to identity in the results phase and rows are in', async ({ page }) => {
    await openStoryboard(page, search)
    await seek(page, RESULTS_T)
    const r = await page.evaluate(() => {
      const cam = document.querySelector<HTMLElement>('#frame .cam')!
      const rows = [...document.querySelectorAll<HTMLElement>('#frame [data-mba-part=result]')]
      return {
        transform: getComputedStyle(cam).transform,
        rows: rows.length,
        opacity: rows.map((e) => Number(getComputedStyle(e).opacity)),
        first: getComputedStyle(rows[0]!.firstElementChild as HTMLElement).backgroundColor,
        text: rows.map((e) => e.textContent).join(''),
      }
    })
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(r.transform)
    expect(r.rows).toBe(4)
    expect(r.opacity).toEqual([1, 1, 1, 1])
    expect(r.first).toBe('rgb(255, 90, 31)')
    expect(r.text).toBe('')
  })

  test('result rows stagger in after the pullback', async ({ page }) => {
    await openStoryboard(page, search)
    await seek(page, 3.0)
    const op = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('#frame [data-mba-part=result]')].map((e) => Number(getComputedStyle(e).opacity)),
      )
    expect(await op()).toEqual([0, 0, 0, 0])
    // Pullback ends at 0.5 + typing + 0.4 + 0.45; shortly after, earlier rows are further in than later ones.
    await seek(page, 0.5 + typingDuration(TEXT, CPS) + 0.85 + 0.2)
    const o = await op()
    expect(o[0]!).toBeGreaterThan(o[3]!)
  })

  test('only sanctioned text mid-typing', async ({ page }) => {
    await openStoryboard(page, search)
    for (const t of [1.2, 2.0, RESULTS_T]) {
      await seek(page, t)
      expect(await unsanctionedArabicText(page), `t=${t}`).toEqual([])
    }
  })

  test('pure update: frame does not depend on seek history', async ({ page }) => {
    await openStoryboard(page, search)
    const fresh = await frameAt(page, 1.6)
    await frameAt(page, 2.4)
    await frameAt(page, 0.7)
    expect((await frameAt(page, 1.6)).equals(fresh)).toBe(true)
  })

  test('short scene compresses typing instead of cutting the text', async ({ page }) => {
    const sb = structuredClone(search)
    sb.scenes[0]!.duration = 2.5
    await openStoryboard(page, sb)
    await noError(page)
    await seek(page, 1.5)
    expect((await typedNodes(page)).texts).toEqual([TEXT])
  })

  test('bad params report a path', async ({ page }) => {
    await openStoryboard(page, fixture('search-bad-params.json'))
    expect(await page.evaluate(() => window.__mba.error)).toContain('scenes[0].params.text')
    const long = structuredClone(search)
    long.scenes[0]!.params.text = 'ا'.repeat(61)
    await openStoryboard(page, long)
    expect(await page.evaluate(() => window.__mba.error)).toContain('scenes[0].params.text')
  })

  test('a Latin query types left to right with the caret on the right', async ({ page }) => {
    const latin = fixture('search-latin.json')
    const Q = latin.scenes[0]!.params.text as string
    await openStoryboard(page, latin)
    await noError(page)
    const typing = '#frame [data-mba-text=typing]'
    expect(await page.locator(typing).getAttribute('dir')).toBe('ltr')
    for (const t of [0.9, 1.4, 0.5 + typingDuration(Q, CPS) + 0.01]) {
      await seek(page, t)
      // Direction is decided once from the full text, never flipped mid-typing.
      expect(await page.locator(typing).getAttribute('dir'), `t=${t}`).toBe('ltr')
      const boxes = await charBoxes(page, typing)
      expect(boxes.length, `t=${t}`).toBeGreaterThan(0)
      expect(boxes.map((b) => b.ch).join(''), `t=${t}`).toBe([...Q].slice(0, boxes.length).join(''))
      expect(readsLeftToRight(boxes), `t=${t} ${JSON.stringify(boxes)}`).toBe(true)
      const caret = await page.locator('#frame [data-mba-caret]').evaluate((el) => el.getBoundingClientRect().left)
      const textRight = Math.max(...boxes.map((b) => b.right))
      expect(caret, `t=${t}`).toBeGreaterThanOrEqual(textRight - 1)
      expect(caret - textRight, `t=${t}`).toBeLessThan(30)
    }
    // Fully typed: "?" is the rightmost glyph.
    const boxes = await charBoxes(page, typing)
    expect(boxes.map((b) => b.ch).join('')).toBe(Q)
    expect(boxes.at(-1)!.left).toBeGreaterThanOrEqual(Math.max(...boxes.slice(0, -1).map((b) => b.right)) - 0.5)
  })

  test('Latin query golden mid-typing', async ({ page }) => {
    await openStoryboard(page, fixture('search-latin.json'))
    await seek(page, 1.4)
    await expect(page.locator('#frame')).toHaveScreenshot('search-latin-mid.png', GOLDEN)
  })

  test('golden at 1.2s', async ({ page }) => {
    await openStoryboard(page, search)
    await seek(page, 1.2)
    await expect(page.locator('#frame')).toHaveScreenshot('search-typing-mid.png', GOLDEN)
  })

  test('golden in the results phase', async ({ page }) => {
    await openStoryboard(page, search)
    await seek(page, RESULTS_T)
    await expect(page.locator('#frame')).toHaveScreenshot('search-results.png', GOLDEN)
  })
})
