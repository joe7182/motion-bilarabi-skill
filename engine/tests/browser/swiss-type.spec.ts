import { test, expect, type Page } from '@playwright/test'
import { openStoryboard } from './helpers'
import { expectAuditClean, expectColdWarm, seek } from './layers-kit'
import type {} from '../../src/runtime/mba-api'

// Stage 1 of the presets: the swiss-red look's type tricks — type-stretch, letters-join, chapter-bar.
const sbOf = (scenes: Record<string, unknown>[], world = 'paper') => ({
  version: 1,
  format: '9:16',
  look: 'swiss-red',
  seed: 3,
  scenes: [{ id: 'b', type: 'backdrop', track: 0, start: 0, duration: 4, params: { world } }, ...scenes],
})
const one = (type: string, params: Record<string, unknown>, track = 1) => ({ id: 'x', type, track, start: 0, duration: 4, params })

const stretchState = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-mba-part="type-stretch"]')!
    const unit = root.querySelector<HTMLElement>('[data-mba-text]')!
    const ruler = root.querySelector<HTMLElement>('[data-mba-part="type-stretch-ruler"]')!
    return { text: unit.textContent!, w: unit.getBoundingClientRect().width, ruler: Number(ruler.style.opacity), label: ruler.nextElementSibling!.textContent! }
  })

test('type-stretch: plain before `at`, grows continuously with the ruler counting, one joined unit; audit clean', async ({ page }) => {
  await openStoryboard(page, sbOf([one('type-stretch', { word: 'تتمدد', at: 1, to: 8, duration: 1.2 })]))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await seek(page, 0.6)
  const before = await stretchState(page)
  expect(before.text).toBe('تتمدد')
  expect(before.label).toBe('+0px')
  const widths: number[] = []
  for (const t of [1.05, 1.15, 1.3, 1.6, 2.4]) {
    await seek(page, t)
    widths.push((await stretchState(page)).w)
  }
  // Monotonic and without a jump bigger than a quarter of the whole growth between close samples.
  for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThanOrEqual(widths[i - 1]! - 0.5)
  const after = await stretchState(page)
  expect(after.text).toContain('ـ')
  expect(after.ruler).toBe(1)
  expect(Number(after.label.replace(/[^0-9]/g, ''))).toBeGreaterThan(100)
  await expectAuditClean(page, [0.6, 3.5], 1)
})

test('type-stretch: cold and warm seeks match; a word with no kashida slot is refused Arabic first', async ({ page }) => {
  await openStoryboard(page, sbOf([one('type-stretch', { word: 'تتمدد', at: 1 })]))
  await expectColdWarm(page, [0.2, 1.2, 1.5, 3.0], 4)
  await openStoryboard(page, sbOf([one('type-stretch', { word: 'ورد' })]))
  expect(await page.evaluate(() => window.__mba.error)).toMatch(/^[^]*[؀-ۿ][^]*kashida/)
})

const joinState = (page: Page) =>
  page.evaluate(() => {
    const letters = [...document.querySelectorAll<HTMLElement>('[data-mba-part="letter"]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { ch: el.textContent!, x: r.left + r.width / 2, o: Number(getComputedStyle(el).opacity) }
    })
    const j = document.querySelector<HTMLElement>('[data-mba-part="joined"]')!
    return { letters, joined: Number(getComputedStyle(j).opacity), joinedText: j.textContent! }
  })

test('letters-join: letters apart in reading order, slide in and hand over to the joined word; audit clean', async ({ page }) => {
  await openStoryboard(page, sbOf([one('letters-join', { word: 'العربي', at: 1.2, duration: 0.8 })]))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await seek(page, 0.9)
  const apart = await joinState(page)
  expect(apart.letters.map((l) => l.ch)).toEqual(['ا', 'ل', 'ع', 'ر', 'ب', 'ي'])
  // RTL: the first letter is the rightmost.
  for (let i = 1; i < apart.letters.length; i++) expect(apart.letters[i - 1]!.x).toBeGreaterThan(apart.letters[i]!.x)
  expect(apart.letters.every((l) => l.o === 1)).toBe(true)
  expect(apart.joined).toBe(0)
  await seek(page, 1.6)
  const mid = await joinState(page)
  // Halfway the row is narrower than apart.
  expect(mid.letters[0]!.x - mid.letters[5]!.x).toBeLessThan(apart.letters[0]!.x - apart.letters[5]!.x)
  await seek(page, 3)
  const done = await joinState(page)
  expect(done.joined).toBe(1)
  expect(done.joinedText).toBe('العربي')
  expect(done.letters.every((l) => l.o === 0)).toBe(true)
  await expectAuditClean(page, [0.9, 3.0], 1)
})

test('letters-join reverse: starts joined and breaks into letters; cold and warm match', async ({ page }) => {
  await openStoryboard(page, sbOf([one('letters-join', { word: 'موشن', at: 1, reverse: true })], 'ink'))
  await seek(page, 0.6)
  const a = await joinState(page)
  expect(a.joined).toBe(1)
  expect(a.letters.every((l) => l.o === 0)).toBe(true)
  await seek(page, 3)
  const b = await joinState(page)
  expect(b.joined).toBe(0)
  expect(b.letters.every((l) => l.o === 1)).toBe(true)
  await expectAuditClean(page, [0.6, 3.0], 1)
  await expectColdWarm(page, [0.3, 1.4, 1.7, 3.2], 4)
})

test('chapter-bar: count dashes, the ones before index solid, the current fills from the reading side; label shown', async ({ page }) => {
  await openStoryboard(page, sbOf([one('chapter-bar', { count: 6, index: 3, label: 'حركة · ٠٣', at: 0.2, fill: 0.5 }, 5)]))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  const dashes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-mba-part="chapter-dash"]')].map((d) => ({
        x: d.getBoundingClientRect().left,
        back: Number((d.firstElementChild as HTMLElement).style.opacity),
        fill: d.children[1] ? (d.children[1] as HTMLElement).getBoundingClientRect().width / d.getBoundingClientRect().width : undefined,
      })),
    )
  await seek(page, 0.1)
  const a = await dashes()
  expect(a.length).toBe(6)
  expect(a[0]!.x).toBeGreaterThan(a[1]!.x)
  expect(a.map((d) => d.back)).toEqual([1, 1, 0.22, 0.22, 0.22, 0.22])
  expect(a[2]!.fill).toBeCloseTo(0, 3)
  await seek(page, 1)
  expect((await dashes())[2]!.fill).toBeCloseTo(1, 3)
  await expectAuditClean(page, [1], 1)
  await openStoryboard(page, sbOf([one('chapter-bar', { count: 3, index: 4 }, 5)]))
  expect(await page.evaluate(() => window.__mba.error)).toMatch(/^[^]*[؀-ۿ][^]*index/)
})

test('comment-stickers: each comment pops at its time, tilted, alternating sides; audit clean', async ({ page }) => {
  const items = [{ text: 'شلون سويته؟', at: 0.2 }, { text: 'بأي برنامج؟', at: 0.9 }, { text: 'كم أخذ وقت؟', at: 1.6 }]
  await openStoryboard(page, sbOf([one('comment-stickers', { items })]))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  const cards = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-mba-part="comment-sticker"]')].map((c) => {
        const r = c.getBoundingClientRect()
        return { o: Number(getComputedStyle(c).opacity), x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }),
    )
  await seek(page, 1.0)
  expect((await cards()).map((c) => c.o > 0)).toEqual([true, true, false])
  await seek(page, 3)
  const all = await cards()
  expect(all.every((c) => c.o === 1)).toBe(true)
  expect(all[0]!.x).toBeGreaterThan(all[1]!.x)
  expect(all[1]!.y).toBeGreaterThan(all[0]!.y)
  await expectColdWarm(page, [0.3, 1.0, 2.5], 4)
})

test('type tricks: heavy-word gets heavier, said-written shows both rows, word-cut shows the word only from the cut, viewfinder stays in the safe area; audit clean', async ({ page }) => {
  await openStoryboard(page, sbOf([one('heavy-word', { word: 'ثقيلة', at: 0.5, duration: 0.8 })]))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  const weight = () => page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-mba-part="heavy-box"] [data-mba-text]')!).fontWeight))
  await seek(page, 0.3)
  const w0 = await weight()
  await seek(page, 2)
  expect(await weight()).toBeGreaterThan(w0 + 500)
  await expectAuditClean(page, [0.3, 2], 1)
  const inFrame = () => page.evaluate(() => { const r = document.querySelector('[data-mba-part="heavy-box"]')!.getBoundingClientRect(); const f = document.querySelector('#frame')!.getBoundingClientRect(); return r.left >= f.left && r.right <= f.right })
  expect(await inFrame()).toBe(true)

  await openStoryboard(page, sbOf([one('said-written', { said: 'علّق', written: 'عَلَط', saidAt: 0.2, writtenAt: 1 })]))
  await seek(page, 0.7)
  const rows = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-mba-part="said-row"]')].map((r) => Number(getComputedStyle(r).opacity)))
  expect((await rows()).map((o) => o > 0)).toEqual([true, false])
  await seek(page, 2.5)
  expect(await rows()).toEqual([1, 1])
  await expectAuditClean(page, [2.5], 1)

  await openStoryboard(page, sbOf([one('word-cut', { word: 'بالضبط', at: 1.5 })]))
  const vis = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-mba-part="cut-stage"] [data-mba-text]')!).visibility)
  await seek(page, 1.48)
  expect(await vis()).toBe('hidden')
  await seek(page, 1.5)
  expect(await vis()).toBe('visible')
  await expectColdWarm(page, [0.5, 1.5, 3], 4)

  await openStoryboard(page, sbOf([one('viewfinder', {}, 5)]))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await seek(page, 1)
  expect(await page.evaluate(() => window.__mba.audit())).toEqual([])
})

test('ecg-line: words pop on their beats in reading order (RTL: right to left), never overlapping; goes flat; microscope focuses; audit clean', async ({ page }) => {
  await openStoryboard(page, sbOf([one('ecg-line', { beats: [{ at: 0.6, word: 'أحياء' }, { at: 0.9, word: 'طب', box: true }, { at: 1.2, word: 'أستاذ', size: 1.4 }], flatAt: 2.5 })], 'ink'))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  const words = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-mba-part="ecg-word"]')].map((w) => {
        const r = w.getBoundingClientRect()
        return { o: Number(getComputedStyle(w).opacity), l: r.left, r: r.right, t: r.top, b: r.bottom }
      }),
    )
  await seek(page, 0.5)
  expect((await words()).every((w) => w.o === 0)).toBe(true)
  await seek(page, 2)
  const ws = await words()
  expect(ws.every((w) => w.o === 1)).toBe(true)
  expect(ws[0]!.l).toBeGreaterThan(ws[1]!.l)
  expect(ws[1]!.l).toBeGreaterThan(ws[2]!.l)
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
    const a = ws[i]!, b = ws[j]!
    expect(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t, `words ${i} and ${j} overlap`).toBe(true)
  }
  await expectAuditClean(page, [2, 3.5], 1)
  await expectColdWarm(page, [0.3, 0.75, 1.5, 3], 4)

  await openStoryboard(page, sbOf([one('microscope', { label: 'عصبون', focusSec: 1 }, 4)]))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  const blur = () => page.evaluate(() => (document.querySelector('[data-mba-part="microscope"] > div:nth-child(2)') as HTMLElement).style.backdropFilter)
  await seek(page, 0.2)
  expect(await blur()).toMatch(/blur/)
  await seek(page, 2)
  expect(await blur()).toBe('')
  await expectAuditClean(page, [2], 1)
})

test('book-flip: leaves turn, the figure page is revealed, the figure flies into the target box in colour; microscope opens; audit clean', async ({ page }) => {
  const img = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="125" height="100"><rect width="125" height="100" fill="#c33"/></svg>').toString('base64')
  await openStoryboard(page, sbOf([one('book-flip', { image: img, title: 'الفصل ١٩ · القلب', at: 0.2, flips: 5, flipSec: 1, liftAt: 2.5, target: { at: { x: 0.5, y: 0.6 }, width: 0.92, aspect: 1.25 } })], 'ink'))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await seek(page, 2)
  await expectAuditClean(page, [2], 1)
  await seek(page, 3.5)
  const fly = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll<HTMLImageElement>('img')]
    const f = imgs.at(-1)!
    const r = f.getBoundingClientRect()
    const fr = document.querySelector('#frame')!.getBoundingClientRect()
    return { w: r.width / fr.width, filter: f.style.filter, book: Number(getComputedStyle(document.querySelector('[data-mba-part="book"]')!).opacity) }
  })
  expect(fly.w).toBeGreaterThan(0.7)
  expect(fly.filter.replace(/\s/g, '')).toMatch(/^grayscale\(0(\.0+)?\)$/)
  expect(fly.book).toBe(0)
  await expectColdWarm(page, [0.5, 1.1, 2.8, 3.5], 4)
  await openStoryboard(page, sbOf([one('microscope', { focusSec: 0.8, openAt: 1.5 }, 4)]))
  await seek(page, 2.5)
  expect(await page.evaluate(() => (document.querySelector('[data-mba-part="microscope"] svg') as SVGElement).style.opacity)).toBe('0')
})

test('captions: one cue at a time, the spoken word lit (spoken-box / karaoke), Arabic kept whole; audit clean', async ({ page }) => {
  const cues = [
    { at: 0.1, end: 1.2, words: [{ text: 'هسه', at: 0.1, end: 0.4 }, { text: 'شوفها', at: 0.45, end: 0.8 }, { text: 'Claude', at: 0.85, end: 1.1 }] },
    { at: 1.3, end: 2.5, words: [{ text: 'تتحكم', at: 1.3, end: 1.7 }, { text: 'بالنبض', at: 1.75, end: 2.2, emph: 'pop' }] },
  ]
  for (const skin of ['spoken-box', 'karaoke']) {
    await openStoryboard(page, sbOf([one('captions', { cues, skin }, 5)], 'ink'))
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    const shown = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-mba-part="caption"]')].map((c) => getComputedStyle(c).visibility === 'visible'))
    await seek(page, 0.6)
    expect(await shown()).toEqual([true, false])
    const lit = await page.evaluate((skin) => [...document.querySelectorAll<HTMLElement>('[data-mba-part="caption"]')][0]!.querySelectorAll<HTMLElement>('[data-mba-text]')[1]!.style[skin === 'karaoke' ? 'color' : 'background'], skin)
    expect(lit).not.toBe('')
    await seek(page, 2)
    expect(await shown()).toEqual([false, true])
    await expectAuditClean(page, [0.6, 2], 1)
  }
})

test('arabic-move: every move draws ink, and cold and warm seeks match', async ({ page }) => {
  const inked = () => page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-mba-part="arabic-move"]')!
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 16) if (d[i]! > 0) n++
    return n
  })
  for (const [move, extra] of [['dots-drop', {}], ['pen-write', {}], ['word-melt', { to: 'فيديو' }], ['unblur', {}], ['decrypt', {}], ['redacted-stamp', { stamp: 'مكشوف' }], ['letters-snap', {}], ['kufi-tiles', {}], ['echo-stack', {}]] as const) {
    await openStoryboard(page, { version: 1, format: '9:16', look: 'signature', seed: 3, scenes: [{ id: 'b', type: 'backdrop', track: 0, start: 0, duration: 6, params: { world: 'ink' } }, { id: 'x', type: 'arabic-move', track: 1, start: 0, duration: 6, params: { move, text: move === 'unblur' ? 'كل فكرة' : 'العربي', ...extra } }] })
    expect(await page.evaluate(() => window.__mba.error), move).toBeUndefined()
    await seek(page, 3.3)
    expect(await inked(), move).toBeGreaterThan(200)
  }
  await expectColdWarm(page, [0.6, 1.4, 3.3], 6)
})
