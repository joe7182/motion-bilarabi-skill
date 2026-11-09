import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { openStoryboard, frameAt, unsanctionedArabicText, charBoxes, readsLeftToRight } from './helpers'
import { splitWords } from '../../src/core/text'
import { FORMAT_SIZE, SAFE_AREA } from '../../src/core/types'

type Fixture = { scenes: { params: Record<string, unknown> }[] } & Record<string, unknown>
const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'))

const GOLDEN = { maxDiffPixelRatio: 0.002 }

/** Left inset (%) of a CSS `inset(...)` clip-path, honouring the 1-4 value shorthand. '' = no clip = 0. */
function insetLeft(clip: string): number {
  if (!clip) return 0
  const v = (/inset\(([^)]*)\)/.exec(clip)?.[1] ?? '').trim().split(/\s+/).map(parseFloat)
  return v[3] ?? v[1] ?? v[0]!
}

async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate((tt) => window.__mba.seek(tt), t)
}

async function noError(page: Page): Promise<void> {
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
}

const wordTexts = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('#frame [data-mba-text=word]')].map((el) => el.textContent))

test.describe('slam', () => {
  test('slam keeps Arabic words whole', async ({ page }) => {
    const sb = fixture('slam.json')
    await openStoryboard(page, sb)
    await noError(page)
    await seek(page, 1)
    // Headline words first (tag is a single line unit), in logical order.
    expect(await wordTexts(page)).toEqual(splitWords(sb.scenes[0]!.params.text as string))
  })

  test('mixed Arabic/English words stay whole and in logical order', async ({ page }) => {
    const sb = fixture('mixed.json')
    await openStoryboard(page, sb)
    await noError(page)
    await seek(page, 1)
    expect(await wordTexts(page)).toEqual(splitWords(sb.scenes[0]!.params.text as string))
    // "Gemini 3" keeps its left-to-right order inside the RTL line: Gemini sits left of 3.
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#frame [data-mba-text=word]')].map((e) => {
        const r = e.getBoundingClientRect()
        return { text: e.textContent!, left: r.left, right: r.right, top: Math.round(r.top) }
      }),
    )
    const box = (t: string) => boxes.find((b) => b.text === t)!
    expect(box('Gemini').top).toBe(box('3').top)
    expect(box('Gemini').right).toBeLessThan(box('3').left)
    // Logical order reads right to left (and top to bottom across wrapped lines).
    for (let i = 1; i < boxes.length; i++) {
      const [prev, cur] = [boxes[i - 1]!, boxes[i]!]
      if (prev.text === 'Gemini' && cur.text === '3') continue // the LTR run inside the line
      if (cur.top === prev.top) expect(cur.right, `${prev.text} -> ${cur.text}`).toBeLessThanOrEqual(prev.left + 0.5)
      else expect(cur.top, `${prev.text} -> ${cur.text}`).toBeGreaterThan(prev.top)
    }
  })

  test('long headline stays in safe area', async ({ page }) => {
    const sb = fixture('slam-long.json')
    expect((sb.scenes[0]!.params.text as string).length).toBe(80)
    await openStoryboard(page, sb)
    await noError(page)
    await seek(page, 1)
    const size = FORMAT_SIZE['9:16']
    const a = SAFE_AREA['9:16']
    const safe = {
      left: size.w * a.left,
      top: size.h * a.top,
      right: size.w * (1 - a.right),
      bottom: size.h * (1 - a.bottom),
    }
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#frame [data-mba-text]')].map((el) => {
        const r = el.getBoundingClientRect()
        return { text: el.textContent, left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      }),
    )
    expect(boxes.length).toBe(splitWords(sb.scenes[0]!.params.text as string).length + 1) // words + tag
    for (const b of boxes) {
      expect(b.left, b.text!).toBeGreaterThanOrEqual(safe.left - 0.5)
      expect(b.right, b.text!).toBeLessThanOrEqual(safe.right + 0.5)
      expect(b.top, b.text!).toBeGreaterThanOrEqual(safe.top - 0.5)
      expect(b.bottom, b.text!).toBeLessThanOrEqual(safe.bottom + 0.5)
    }
  })

  test('accent word coloured', async ({ page }) => {
    const sb = fixture('slam.json')
    await openStoryboard(page, sb)
    await seek(page, 1)
    const colours = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('#frame [data-mba-text=word]')].map((el) => [
          el.textContent,
          getComputedStyle(el).color,
        ]),
      ),
    )
    expect(colours['أذكى']).toBe('rgb(255, 90, 31)') // dark-tech accent #ff5a1f
    expect(colours['أصبح']).toBe('rgb(242, 236, 226)') // fg #f2ece2
  })

  test('accent that is not one of the words is reported at params.accent', async ({ page }) => {
    const sb = fixture('slam.json')
    sb.scenes[0]!.params.accent = 'غير موجود'
    await openStoryboard(page, sb)
    expect(await page.evaluate(() => window.__mba.error)).toContain('scenes[0].params.accent')
  })

  test('text longer than 80 chars is reported at params.text', async ({ page }) => {
    const sb = fixture('slam.json')
    sb.scenes[0]!.params = { text: 'ا'.repeat(81) }
    await openStoryboard(page, sb)
    expect(await page.evaluate(() => window.__mba.error)).toContain('scenes[0].params.text')
  })

  test('only sanctioned text (slam)', async ({ page }) => {
    await openStoryboard(page, fixture('slam.json'))
    await seek(page, 0.3)
    expect(await unsanctionedArabicText(page)).toEqual([])
    await seek(page, 1.2)
    expect(await unsanctionedArabicText(page)).toEqual([])
  })

  test('slam seek is order-independent across intro, shake and exit', async ({ page }) => {
    await openStoryboard(page, fixture('slam.json'))
    for (const t of [0.2, 0.62, 2.4]) {
      const fresh = await frameAt(page, t)
      await frameAt(page, 2.5)
      await frameAt(page, 0)
      expect((await frameAt(page, t)).equals(fresh), `t=${t}`).toBe(true)
    }
  })

  test('a scene shorter than intro + exit is compressed: words land, then fade out by the end', async ({ page }) => {
    const sb = fixture('slam.json') as Fixture & { scenes: { duration: number }[] }
    sb.scenes[0]!.duration = 0.4
    await openStoryboard(page, sb)
    await noError(page)
    const opacities = async (t: number) => {
      await seek(page, t)
      return page.evaluate(() => ({
        words: [...document.querySelectorAll<HTMLElement>('#frame [data-mba-text=word]')].map((e) => Number(e.style.opacity)),
        content: Number(document.querySelector<HTMLElement>('#frame [data-mba-part=camera] > div')!.style.opacity || 1),
      }))
    }
    // intro compressed to 0.55 * 0.4/0.8 = 0.275 s, exit starts at 0.4 - 0.125 = 0.275 s
    const landed = await opacities(0.275)
    expect(landed.words.every((o) => o > 0.99)).toBe(true)
    expect(landed.content).toBeCloseTo(1, 3)
    expect((await opacities(0.4)).content).toBeCloseTo(0, 3)
  })

  test('a Latin-only tag reads left to right (#AI! not !AI#)', async ({ page }) => {
    await openStoryboard(page, fixture('slam-latin-tag.json'))
    await noError(page)
    await seek(page, 1)
    const tag = '#frame [data-mba-part=tag] [data-mba-text=line]'
    expect(await page.locator(tag).getAttribute('dir')).toBe('ltr')
    const boxes = await charBoxes(page, tag)
    expect(boxes.map((b) => b.ch).join('')).toBe('#AI!')
    expect(readsLeftToRight(boxes), JSON.stringify(boxes)).toBe(true)
    // The Latin headline word keeps its trailing "!" on the right too.
    const word = await charBoxes(page, '#frame [data-mba-part=headline] [data-mba-bidi=ltr] [data-mba-text=word]')
    expect(word.map((b) => b.ch).join('')).toBe('AI!')
    expect(readsLeftToRight(word), JSON.stringify(word)).toBe(true)
  })

  test('Latin tag golden', async ({ page }) => {
    await openStoryboard(page, fixture('slam-latin-tag.json'))
    await seek(page, 1)
    await expect(page.locator('#frame')).toHaveScreenshot('slam-latin-tag.png', GOLDEN)
  })

  test('mixed text golden', async ({ page }) => {
    await openStoryboard(page, fixture('mixed.json'))
    await seek(page, 1)
    await expect(page.locator('#frame')).toHaveScreenshot('slam-mixed.png', GOLDEN)
  })

  test('slam golden at impact', async ({ page }) => {
    await openStoryboard(page, fixture('slam.json'))
    await seek(page, 0.55)
    await expect(page.locator('#frame')).toHaveScreenshot('slam-impact.png', GOLDEN)
  })
})

test.describe('wipe-reveal', () => {
  test('only sanctioned text (wipe)', async ({ page }) => {
    await openStoryboard(page, fixture('wipe.json'))
    await noError(page)
    await seek(page, 0.3)
    expect(await unsanctionedArabicText(page)).toEqual([])
    await seek(page, 1.2)
    expect(await unsanctionedArabicText(page)).toEqual([])
  })

  test('wipe reveals from the right edge leftward', async ({ page }) => {
    await openStoryboard(page, fixture('wipe.json'))
    const clipAt = async (t: number) => {
      await seek(page, t)
      return page.evaluate(() => document.querySelector<HTMLElement>('#frame [data-mba-wipe=title]')!.style.clipPath)
    }
    // inset(top right bottom LEFT): the left inset shrinks from 100% to 0%, so the visible
    // region grows from the right edge towards the left.
    expect(insetLeft(await clipAt(0))).toBeCloseTo(100, 3)
    const mid = insetLeft(await clipAt(0.3))
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(100)
    expect(insetLeft(await clipAt(1.5))).toBeCloseTo(0, 3)
  })

  test('wipe exit is a reverse wipe in the last 0.3 s', async ({ page }) => {
    await openStoryboard(page, fixture('wipe.json'))
    const exitLeft = async (t: number) => {
      await seek(page, t)
      const clip = await page.evaluate(
        () => document.querySelector<HTMLElement>('#frame [data-mba-wipe=exit]')!.style.clipPath,
      )
      return insetLeft(clip)
    }
    expect(await exitLeft(2.15)).toBeCloseTo(0, 3)
    const mid = await exitLeft(2.35)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(100)
    expect(await exitLeft(2.5)).toBeCloseTo(100, 3)
  })

  test('wipe seek is order-independent', async ({ page }) => {
    await openStoryboard(page, fixture('wipe.json'))
    for (const t of [0.3, 1.5, 2.4]) {
      const fresh = await frameAt(page, t)
      await frameAt(page, 2.5)
      await frameAt(page, 0)
      expect((await frameAt(page, t)).equals(fresh), `t=${t}`).toBe(true)
    }
  })

  for (const name of ['wipe-long-ar.json', 'wipe-long-latin.json']) {
    test(`long title stays in safe area (${name})`, async ({ page }) => {
      const sb = fixture(name)
      expect((sb.scenes[0]!.params.title as string).length).toBe(40)
      await openStoryboard(page, sb)
      await noError(page)
      await seek(page, 1.5)
      const size = FORMAT_SIZE['9:16']
      const a = SAFE_AREA['9:16']
      const safe = { left: size.w * a.left, top: size.h * a.top, right: size.w * (1 - a.right), bottom: size.h * (1 - a.bottom) }
      // Every glyph box of the title (and subtitle), measured per code point with a Range.
      const r = await page.evaluate(() => {
        const glyphs: { ch: string; left: number; top: number; right: number; bottom: number }[] = []
        const range = document.createRange()
        for (const el of document.querySelectorAll('#frame [data-mba-text]')) {
          for (const node of el.childNodes) {
            if (node.nodeType !== Node.TEXT_NODE) continue
            const data = (node as Text).data
            let i = 0
            for (const ch of data) {
              range.setStart(node, i)
              range.setEnd(node, i + ch.length)
              i += ch.length
              if (!ch.trim()) continue
              const b = range.getBoundingClientRect()
              glyphs.push({ ch, left: b.left, top: b.top, right: b.right, bottom: b.bottom })
            }
          }
        }
        const title = document.querySelector<HTMLElement>('#frame [data-mba-wipe=title]')!
        const line = document.querySelector<HTMLElement>('#frame [data-mba-wipe=line]')!.getBoundingClientRect()
        const units = [...title.querySelectorAll<HTMLElement>('[data-mba-text]')]
        const tops = new Set(units.map((u) => Math.round(u.getBoundingClientRect().top)))
        const textRight = Math.max(...units.map((u) => u.getBoundingClientRect().right))
        return {
          glyphs,
          titleText: units.map((u) => u.textContent).join(' '),
          fontPx: parseFloat(getComputedStyle(title).fontSize),
          lines: tops.size,
          line: { left: line.left, right: line.right, top: line.top, bottom: line.bottom },
          textRight,
        }
      })
      expect(r.titleText).toBe(sb.scenes[0]!.params.title)
      expect(r.glyphs.length).toBeGreaterThan(40)
      for (const g of r.glyphs) {
        expect(g.left, g.ch).toBeGreaterThanOrEqual(safe.left - 0.5)
        expect(g.right, g.ch).toBeLessThanOrEqual(safe.right + 0.5)
        expect(g.top, g.ch).toBeGreaterThanOrEqual(safe.top - 0.5)
        expect(g.bottom, g.ch).toBeLessThanOrEqual(safe.bottom + 0.5)
      }
      // Legible: a title too wide for one line wraps onto two lines instead of shrinking below the
      // 40 px floor (the 40-char Arabic title still fits on one line; the wide Latin one wraps).
      expect(r.lines).toBe(name === 'wipe-long-latin.json' ? 2 : 1)
      expect(r.fontPx).toBeGreaterThanOrEqual(40)
      // The underline stays in the safe area and hangs from the title's right edge.
      expect(r.line.left).toBeGreaterThanOrEqual(safe.left - 0.5)
      expect(r.line.right).toBeLessThanOrEqual(safe.right + 0.5)
      expect(Math.abs(r.line.right - r.textRight)).toBeLessThan(r.fontPx * 0.25)
    })
  }

  test('long title goldens (Arabic one line, wide Latin two lines)', async ({ page }) => {
    await openStoryboard(page, fixture('wipe-long-ar.json'))
    await seek(page, 1.5)
    await expect(page.locator('#frame')).toHaveScreenshot('wipe-long-ar.png', GOLDEN)
    await openStoryboard(page, fixture('wipe-long-latin.json'))
    await seek(page, 1.5)
    await expect(page.locator('#frame')).toHaveScreenshot('wipe-long-latin.png', GOLDEN)
    await seek(page, 0.3)
    await expect(page.locator('#frame')).toHaveScreenshot('wipe-long-latin-mid.png', GOLDEN)
  })

  test('wipe golden at mid and end', async ({ page }) => {
    await openStoryboard(page, fixture('wipe.json'))
    await seek(page, 0.3)
    await expect(page.locator('#frame')).toHaveScreenshot('wipe-mid.png', GOLDEN)
    await seek(page, 1.5)
    await expect(page.locator('#frame')).toHaveScreenshot('wipe-end.png', GOLDEN)
  })
})
