import { test, expect, type Page } from '@playwright/test'
import { openStoryboard, frameAt, isEmptyFrame, unsanctionedArabicText } from './helpers'
import { CHECKLIST_TIMING } from '../../src/core/params/checklist'

const storyboard = (type: string, params: Record<string, unknown>, duration = 3) => ({
  version: 1,
  format: '9:16',
  look: 'dark-tech',
  seed: 7,
  scenes: [{ id: 's', type, start: 0, duration, params }],
})

async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate((tt) => window.__mba.seek(tt), t)
}

async function noError(page: Page): Promise<void> {
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
}

async function auditClean(page: Page): Promise<void> {
  expect(await unsanctionedArabicText(page)).toEqual([])
  const issues = await page.evaluate(() => window.__mba.audit())
  expect(issues, JSON.stringify(issues)).toEqual([])
}

test.describe('kinetic-text', () => {
  const words = [
    { text: 'المال', at: 0 },
    { text: 'هو', at: 0.4, stress: 1 },
    { text: 'وقت', at: 0.8, stress: 2 },
  ]

  test('every word is a single [data-mba-text] element (never split)', async ({ page }) => {
    await openStoryboard(page, storyboard('kinetic-text', { words }))
    await noError(page)
    await seek(page, 2)
    const units = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#frame [data-mba-text]')].map((el) => ({ text: el.textContent, kind: el.dataset.mbaText, kids: el.children.length })),
    )
    expect(units).toEqual(words.map((w) => ({ text: w.text, kind: 'word', kids: 0 })))
    await auditClean(page)
  })

  test('stress 2 punches past 1.2 at at + 0.1, in the accent colour; stress 0 is at rest by then', async ({ page }) => {
    await openStoryboard(page, storyboard('kinetic-text', { words }))
    await noError(page)
    const look = (i: number) =>
      page.evaluate((k) => {
        const el = document.querySelectorAll<HTMLElement>('#frame [data-mba-text]')[k]!
        const cs = getComputedStyle(el)
        return { scale: new DOMMatrix(cs.transform).a, color: cs.color }
      }, i)
    await seek(page, 0.9)
    const w2 = await look(2)
    expect(w2.scale).toBeGreaterThan(1.2)
    expect(w2.color).toBe('rgb(255, 90, 31)') // dark-tech accent #ff5a1f
    expect((await look(0)).scale).toBeCloseTo(1, 6)
    expect((await look(0)).color).not.toBe('rgb(255, 90, 31)')
    await seek(page, 1.6)
    expect((await look(2)).scale).toBeCloseTo(1, 6)
  })

  test('shake is seeded: the same t gives identical pixels across two seeks; frames keep moving (drift)', async ({ page }) => {
    await openStoryboard(page, storyboard('kinetic-text', { words }))
    await noError(page)
    const a = await frameAt(page, 0.85)
    await frameAt(page, 0.3)
    const b = await frameAt(page, 0.85)
    expect(b.equals(a)).toBe(true)
    // At rest, frames 1 s apart still differ: the ≥ 1 %/s drift.
    const r1 = await frameAt(page, 1.8)
    const r2 = await frameAt(page, 2.8)
    expect(r2.equals(r1)).toBe(false)
  })

  test('the stress-2 word shakes the camera for 0.12 s, then it is still', async ({ page }) => {
    await openStoryboard(page, storyboard('kinetic-text', { words }))
    await noError(page)
    const cam = () =>
      page.evaluate(() => {
        const m = new DOMMatrix(getComputedStyle(document.querySelector('#frame [data-mba-part=camera]')!).transform)
        return Math.hypot(m.e, m.f)
      })
    await seek(page, 0.84)
    expect(await cam()).toBeGreaterThan(0.5)
    await seek(page, 0.95)
    expect(await cam()).toBe(0)
  })

  test('line mode lays the words on one line and passes the audit', async ({ page }) => {
    await openStoryboard(page, storyboard('kinetic-text', { words, mode: 'line' }))
    await noError(page)
    await seek(page, 2)
    const tops = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#frame [data-mba-text]')].map((el) => Math.round(el.getBoundingClientRect().top)),
    )
    expect(new Set(tops).size).toBe(1)
    await auditClean(page)
  })

  test('line mode wraps a line too long for one line at minPx, words intact, audit clean', async ({ page }) => {
    const many = 'هذه جملة طويلة جدا تحتاج إلى أكثر من سطر واحد حتى تظهر كاملة على الشاشة'.split(' ').map((text, i) => ({ text, at: i * 0.1 }))
    await openStoryboard(page, storyboard('kinetic-text', { words: many, mode: 'line' }))
    await noError(page)
    await seek(page, 2.5)
    const units = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#frame [data-mba-text]')].map((el) => ({ text: el.textContent, top: Math.round(el.getBoundingClientRect().top) })),
    )
    expect(units.map((u) => u.text)).toEqual(many.map((w) => w.text))
    expect(new Set(units.map((u) => u.top)).size).toBeGreaterThan(1)
    await auditClean(page)
  })

  test('16:9: a 16-word stack that cannot fit falls back to line mode and stays in the safe area', async ({ page }) => {
    const many = Array.from({ length: 16 }, (_, i) => ({ text: ['المال', 'وقت', 'نمو', 'فكرة'][i % 4]!, at: i * 0.1 }))
    await openStoryboard(page, { ...storyboard('kinetic-text', { words: many }), format: '16:9' })
    await noError(page)
    await seek(page, 2.5)
    expect(await page.evaluate(() => document.querySelector<HTMLElement>('#frame [data-mba-part=kinetic-text]')!.dataset.mbaMode)).toBe('line')
    expect(await page.evaluate(() => document.querySelectorAll('#frame [data-mba-text]').length)).toBe(16)
    await auditClean(page)
  })

  test('a stack that fits keeps stack mode', async ({ page }) => {
    await openStoryboard(page, storyboard('kinetic-text', { words }))
    await noError(page)
    expect(await page.evaluate(() => document.querySelector<HTMLElement>('#frame [data-mba-part=kinetic-text]')!.dataset.mbaMode)).toBe('stack')
  })
})

test.describe('counter', () => {
  /** Arabic-Indic / Latin counter text → number (sign marks, group and decimal separators handled). */
  const toNum = (s: string) =>
    Number(
      [...s]
        .filter((c) => !'\u061C\u200E\u200F\u066C,'.includes(c))
        .map((c) => ('٠١٢٣٤٥٦٧٨٩'.includes(c) ? String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)) : c === '٫' ? '.' : c))
        .join(''),
    )

  /**
   * Seeks every frame of the roll (plus a little): the value is monotonic from `from` to `to` and the
   * text box's layout width (the drift is a uniform scale on the holder, not on the box) stays within 1 px.
   */
  async function rolls(page: Page, from: number, to: number, roll: number): Promise<string[]> {
    const text = () => page.evaluate(() => document.querySelector<HTMLElement>('#frame [data-mba-text]')!.textContent!)
    const width = () => page.evaluate(() => document.querySelector<HTMLElement>('#frame [data-mba-text]')!.offsetWidth)
    await seek(page, 0)
    const w0 = await width()
    const seen: string[] = []
    let last = -Infinity
    for (let f = 0; f <= Math.round(roll * 30) + 6; f++) {
      await seek(page, f / 30)
      const s = await text()
      seen.push(s)
      const v = toNum(s)
      expect(Number.isFinite(v), s).toBe(true)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
      expect(Math.abs((await width()) - w0)).toBeLessThanOrEqual(1)
    }
    expect(toNum(seen[0]!)).toBe(from)
    expect(toNum(seen[seen.length - 1]!)).toBe(to)
    return seen
  }

  test('0 → 300 over 1.2 s: ٠ at 0, ٣٠٠ from 1.2, monotonic, constant box width; drifts at rest', async ({ page }) => {
    await openStoryboard(page, storyboard('counter', { from: 0, to: 300, roll: 1.2 }))
    await noError(page)
    const seen = await rolls(page, 0, 300, 1.2)
    expect(seen[0]).toBe('٠')
    for (const s of seen) expect(s).toMatch(/^[٠-٩]+$/)
    for (const t of [1.2, 2]) {
      await seek(page, t)
      expect(await page.evaluate(() => document.querySelector('#frame [data-mba-text]')!.textContent)).toBe('٣٠٠')
    }
    await auditClean(page)
    expect((await frameAt(page, 2.8)).equals(await frameAt(page, 1.8))).toBe(false)
  })

  test('sign change −50 → 50: monotonic through zero, width locked to the widest (signed) value', async ({ page }) => {
    await openStoryboard(page, storyboard('counter', { from: -50, to: 50, roll: 1.2 }))
    await noError(page)
    const seen = await rolls(page, -50, 50, 1.2)
    expect(seen.some((s) => toNum(s) < 0)).toBe(true)
    expect(seen.some((s) => toNum(s) > 0 && toNum(s) < 10)).toBe(true)
    await auditClean(page)
  })

  test('decimals 0 → 2.5: one decimal throughout (٫), width locked', async ({ page }) => {
    await openStoryboard(page, storyboard('counter', { from: 0, to: 2.5, roll: 1.2 }))
    await noError(page)
    const seen = await rolls(page, 0, 2.5, 1.2)
    expect(seen[0]).toBe('٠٫٠')
    expect(seen[seen.length - 1]).toBe('٢٫٥')
    for (const s of seen) expect(s).toMatch(/^[٠-٩]٫[٠-٩]$/)
    await auditClean(page)
  })
})

test.describe('checklist', () => {
  const items = [
    { text: 'خطة واضحة', at: 0 },
    { text: 'وقت محدد', at: 1 },
    { text: 'نتيجة', at: 2 },
  ]
  /** Per check stroke: [drawn fully, visible at all]. */
  const checks = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll<SVGGeometryElement>('#frame [data-mba-part=check]')].map((el) => ({
        drawn: parseFloat(el.getAttribute('stroke-dashoffset') ?? 'NaN') === 0,
        shown: el.getAttribute('opacity') !== '0',
      })),
    )

  test('just before item 2 enters only one check is drawn; checks self-draw after each row enters', async ({ page }) => {
    await openStoryboard(page, storyboard('checklist', { items }, 4))
    await noError(page)
    await seek(page, 1 - 1 / 30)
    const before = await checks(page)
    expect(before).toHaveLength(3)
    expect(before.filter((c) => c.drawn)).toHaveLength(1)
    expect(before.filter((c) => c.shown)).toHaveLength(1)
    // Mid-draw of item 2's check: shown, not finished.
    await seek(page, 1 + CHECKLIST_TIMING.rowIn + CHECKLIST_TIMING.checkIn / 2)
    const mid = await checks(page)
    expect(mid[1]).toEqual({ drawn: false, shown: true })
  })

  test('audit clean at rest, rows are line units', async ({ page }) => {
    await openStoryboard(page, storyboard('checklist', { items }, 4))
    await noError(page)
    await seek(page, 3.5)
    expect((await checks(page)).every((c) => c.drawn)).toBe(true)
    const texts = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#frame [data-mba-text]')].map((el) => [el.dataset.mbaText, el.textContent]))
    expect(texts).toEqual(items.map((i) => ['line', i.text]))
    await auditClean(page)
  })

  test('drifts after the last check (never static)', async ({ page }) => {
    await openStoryboard(page, storyboard('checklist', { items }, 4))
    await noError(page)
    expect((await frameAt(page, 3.8)).equals(await frameAt(page, 2.8))).toBe(false)
  })
})

test.describe('R16 translate drift: still inside the safe area at the scene end', () => {
  for (const [type, params] of [
    ['counter', { from: 0, to: 300 }],
    ['checklist', { items: [{ text: 'خطة واضحة', at: 0 }, { text: 'وقت محدد', at: 1 }, { text: 'نتيجة', at: 2 }] }],
  ] as const) {
    for (const [format, duration] of [['9:16', 3], ['9:16', 10], ['16:9', 10]] as const) {
      test(`${type} ${format} ${duration} s: moves (translate) and the last frame passes the audit`, async ({ page }) => {
        await openStoryboard(page, { ...storyboard(type, params, duration), format })
        await noError(page)
        const box = () =>
          page.evaluate((t) => {
            const r = document.querySelector<HTMLElement>(`#frame [data-mba-part=${t}] > *`)!.getBoundingClientRect()
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
          }, type)
        // ~12 px/s at 1080 px; past DRIFT_MAX_PX (3 s) it turns back, so check every step moves.
        const pts: { x: number; y: number }[] = []
        for (const t of [duration - 2, duration - 1.5, duration - 1, duration - 0.5, duration - 1 / 30]) {
          await seek(page, t)
          pts.push(await box())
        }
        for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)).toBeGreaterThan(1)
        expect(Math.max(...pts.map((p) => Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y)))).toBeGreaterThan(5)
        await auditClean(page)
      })
    }
  }
})

test.describe('R17 frame 0', () => {
  test('kinetic-text with a first word at 0 and stress 0 is not blank on frame 0 (the word is fully in)', async ({ page }) => {
    await openStoryboard(page, storyboard('kinetic-text', { words: [{ text: 'المال', at: 0 }, { text: 'وقت', at: 0.6 }] }))
    await noError(page)
    const png = await frameAt(page, 0)
    expect(isEmptyFrame(png, '#0e0d0c')).toBe(false)
    const first = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('#frame [data-mba-text]')!
      const cs = getComputedStyle(el)
      return { opacity: cs.opacity, transform: cs.transform }
    })
    expect(first).toEqual({ opacity: '1', transform: 'none' })
    await auditClean(page)
  })

  test('a word at 0.1 (earlier than its 0.25 s slide) is fully in at 0.1, half-way before', async ({ page }) => {
    await openStoryboard(page, storyboard('kinetic-text', { words: [{ text: 'المال', at: 0.1 }] }))
    await noError(page)
    const opacity = () => page.evaluate(() => Number(getComputedStyle(document.querySelector('#frame [data-mba-text]')!).opacity))
    await seek(page, 0)
    expect(await opacity()).toBeGreaterThan(0)
    expect(await opacity()).toBeLessThan(1)
    await seek(page, 0.1)
    expect(await opacity()).toBe(1)
  })

  test('a checklist row at 0 is fully in on frame 0; the counter shows its start value on frame 0', async ({ page }) => {
    await openStoryboard(page, storyboard('checklist', { items: [{ text: 'خطة واضحة', at: 0 }, { text: 'نتيجة', at: 1 }] }))
    await noError(page)
    await seek(page, 0)
    const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#frame [data-mba-part=row]')].map((r) => getComputedStyle(r).opacity))
    expect(rows).toEqual(['1', '0'])
    await openStoryboard(page, storyboard('counter', { from: 7, to: 300 }))
    await noError(page)
    const png = await frameAt(page, 0)
    expect(isEmptyFrame(png, '#0e0d0c')).toBe(false)
    expect(await page.evaluate(() => document.querySelector('#frame [data-mba-text]')!.textContent)).toBe('٧')
  })
})

test.describe('fix round 3 (demo findings)', () => {
  test('counter with a word suffix: spaced, never wider than its locked box, audit clean on every frame', async ({ page }) => {
    await openStoryboard(page, storyboard('counter', { from: 0, to: 300, suffix: 'ساعة', roll: 1.2 }, 2))
    await noError(page)
    for (let f = 0; f < 60; f += 3) {
      await seek(page, f / 30)
      const m = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('#frame [data-mba-text]')!
        return { text: el.textContent!, w: el.offsetWidth, sw: el.scrollWidth }
      })
      expect(m.text).toMatch(/^[٠-٩]+ ساعة$/)
      expect(m.sw, m.text).toBeLessThanOrEqual(m.w)
      await auditClean(page)
    }
  })

  test('checklist fills ~70–80 % of the safe width at ≥ 56 px, centred vertically, rows on the right (RTL start)', async ({ page }) => {
    const items = [{ text: 'اكتب السكربت', at: 0 }, { text: 'سجّل صوتك', at: 0.7 }, { text: 'والباقي علينا', at: 1.4 }]
    await openStoryboard(page, storyboard('checklist', { items }, 3))
    await noError(page)
    await seek(page, 2.5)
    const m = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('#frame [data-mba-part=checklist]')!
      const list = root.firstElementChild as HTMLElement
      const rows = [...list.querySelectorAll<HTMLElement>('[data-mba-part=row]')]
      return {
        ratio: list.offsetWidth / root.offsetWidth,
        px: parseFloat(getComputedStyle(list).fontSize),
        centreDy: list.offsetTop + list.offsetHeight / 2 - root.offsetHeight / 2,
        listRight: list.offsetWidth,
        rowRights: rows.map((r) => r.offsetLeft + r.offsetWidth),
      }
    })
    expect(m.ratio).toBeGreaterThanOrEqual(0.7)
    expect(m.ratio).toBeLessThanOrEqual(0.8)
    expect(m.px).toBeGreaterThanOrEqual(56)
    expect(Math.abs(m.centreDy)).toBeLessThanOrEqual(2)
    for (const r of m.rowRights) expect(Math.abs(r - m.listRight)).toBeLessThanOrEqual(1)
    await auditClean(page)
  })

  for (const [type, params, settled] of [
    ['icon', { icon: 'clock', label: 'الوقت يروح' }, 1.2],
    ['icon', { icon: 'rocket', label: 'ابدأ الحين', enter: 'pop' }, 1.2],
    ['line-art', { art: 'chart-up', drawIn: 0.8 }, 1.3],
    ['wipe-reveal', { title: 'يوسف', subtitle: '@yousif_aljbouri' }, 1.1],
  ] as const) {
    test(`${type} ${JSON.stringify(params).slice(0, 30)}: keeps moving after its entrance (shared drift), audit clean`, async ({ page }) => {
      await openStoryboard(page, storyboard(type, params, 3))
      await noError(page)
      const a = await frameAt(page, settled)
      const b = await frameAt(page, settled + 0.5)
      expect(b.equals(a)).toBe(false)
      await seek(page, 2.6)
      await auditClean(page)
    })
  }

  test('icon: default size 0.55 of the safe width (less the drift room), label ≥ 48 px', async ({ page }) => {
    await openStoryboard(page, storyboard('icon', { icon: 'clock', label: 'الوقت يروح' }, 1.8))
    await noError(page)
    await seek(page, 1.5)
    const m = await page.evaluate(() => {
      const box = document.querySelector<HTMLElement>('#frame [data-mba-part=icon-box]')!
      const label = document.querySelector<HTMLElement>('#frame [data-mba-part=label]')!
      return { side: box.offsetWidth, px: parseFloat(getComputedStyle(label).fontSize) }
    })
    const safeW = 1080 * 0.82
    expect(m.side).toBeGreaterThan(0.5 * safeW)
    expect(m.side).toBeLessThanOrEqual(0.55 * safeW)
    expect(m.px).toBeGreaterThanOrEqual(48)
  })
})

test.describe('fix round 4 (natural-size fit, capped drift, long icon labels)', () => {
  const SAFE = { x: 1080 * 0.09, w: 1080 * 0.82 } // 9:16 safe area (x)
  const LABEL40 = 'الذكاء الاصطناعي يغير طريقة عملنا كل يوم' // 40 characters

  for (const duration of [3, 10]) {
    test(`icon 9:16 ${duration} s: a 40-character label shrinks below 48 px (not below 36) only because it would overflow; stays inside`, async ({ page }) => {
      expect(LABEL40.length).toBe(40)
      await openStoryboard(page, storyboard('icon', { icon: 'clock', label: LABEL40 }, duration))
      await noError(page)
      for (const t of [1.5, duration - 1 / 30]) {
        await seek(page, t)
        const m = await page.evaluate(() => {
          const label = document.querySelector<HTMLElement>('#frame [data-mba-part=label]')!
          const r = label.getBoundingClientRect()
          return { px: parseFloat(getComputedStyle(label).fontSize), left: r.left, right: r.right }
        })
        expect(m.px).toBeLessThan(48)
        expect(m.px).toBeGreaterThanOrEqual(36)
        expect(m.left).toBeGreaterThanOrEqual(SAFE.x - 0.5)
        expect(m.right).toBeLessThanOrEqual(SAFE.x + SAFE.w + 0.5)
      }
      await auditClean(page)
    })
  }

  /** Layout of a primitive at its settled time: font sizes and box sizes, transforms ignored. */
  const layoutOf = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#frame [data-mba-scene] *')].map((el) => `${el.offsetWidth}x${el.offsetHeight}@${el.offsetLeft},${el.offsetTop}/${getComputedStyle(el).fontSize}`),
    )

  for (const [type, params] of [
    ['wipe-reveal', { title: 'يوسف', subtitle: '@yousif_aljbouri' }],
    ['counter', { from: 0, to: 300 }],
    ['checklist', { items: [{ text: 'خطة واضحة', at: 0 }, { text: 'وقت محدد', at: 0.4 }, { text: 'نتيجة', at: 0.8 }] }],
    ['icon', { icon: 'clock', label: 'الوقت يروح' }],
    ['line-art', { art: 'chart-up', drawIn: 0.8 }],
  ] as const) {
    test(`${type} ${JSON.stringify(params).slice(0, 30)}: content that leaves room for the drift keeps its natural layout (1 s = 10 s), audit clean at 10 s`, async ({ page }) => {
      await openStoryboard(page, storyboard(type, params, 1))
      await noError(page)
      await seek(page, 0.5)
      const short = await layoutOf(page)
      await openStoryboard(page, storyboard(type, params, 10))
      await noError(page)
      await seek(page, 0.5)
      expect(await layoutOf(page)).toEqual(short)
      await seek(page, 10 - 0.35) // before the wipe-reveal exit
      await auditClean(page)
    })
  }

  for (const [type, params] of [
    ['wipe-reveal', { title: 'الذكاء الاصطناعي', subtitle: 'كيف يغير طريقة عملنا كل يوم في البيت والمكتب' }],
    ['counter', { from: 0, to: 300, suffix: 'ساعة' }],
  ] as const) {
    test(`${type} ${JSON.stringify(params).slice(0, 30)}: full-width content in a 3 s scene is shrunk as a whole, never rewrapped; inside the safe area`, async ({ page }) => {
      await openStoryboard(page, storyboard(type, params, 1))
      await noError(page)
      await seek(page, 0.5)
      const short = await layoutOf(page)
      await openStoryboard(page, storyboard(type, params, 3))
      await noError(page)
      await seek(page, 0.5)
      expect(await layoutOf(page)).toEqual(short)
      if (type === 'wipe-reveal') {
        // The subtitle keeps the full safe width (fix round 3 narrowed it and it rewrapped).
        const w = await page.evaluate(() => document.querySelector<HTMLElement>('#frame [data-mba-wipe=subtitle]')!.parentElement!.offsetWidth)
        expect(w).toBe(Math.floor(SAFE.w))
      }
      for (const t of [0.5, 2.6]) {
        await seek(page, t)
        await auditClean(page)
      }
    })
  }
})
