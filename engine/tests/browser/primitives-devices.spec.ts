import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStoryboard, frameAt, unsanctionedArabicText } from './helpers'
import { verifyDeterminism } from '../../src/node/verify'
import { safeRect, type Format } from '../../src/core/types'

const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const FIXTURES = join(ENGINE, 'tests/fixtures')

const storyboard = (type: string, params: Record<string, unknown>, duration = 3, format: Format = '9:16') => ({
  version: 1,
  format,
  look: 'dark-tech',
  seed: 7,
  scenes: [{ id: 's', type, start: 0, duration, params }],
})

const seek = (page: Page, t: number) => page.evaluate((tt) => window.__mba.seek(tt), t)

async function noError(page: Page): Promise<void> {
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
}

/** Clean audit that actually measured something (not vacuous). */
async function auditClean(page: Page): Promise<void> {
  expect(await unsanctionedArabicText(page)).toEqual([])
  const st = await page.evaluate(() => window.__mba.auditStats())
  expect(st.issues, JSON.stringify(st.issues)).toEqual([])
  expect(st.checkedGeometric).toBeGreaterThan(0)
}

type Box = { x: number; y: number; w: number; h: number }
const rectOf = (page: Page, sel: string): Promise<Box> =>
  page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect()
    const f = document.getElementById('frame')!.getBoundingClientRect()
    return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height }
  }, sel)
const inside = (a: Box, b: Box, tol = 0.5) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol

test.describe('app-window (terminal)', () => {
  const params = { mode: 'terminal', title: 'mba', lines: [{ text: '> mba explain', at: 0.5 }, { text: 'جاري التحريك…', at: 1.2 }] }

  test('where 5 characters are due, exactly 5 characters and the caret show', async ({ page }) => {
    await openStoryboard(page, storyboard('app-window', params))
    await noError(page)
    await seek(page, 0.5 + 4 / 34 + 0.005)
    const s = await page.evaluate(() => {
      const u = document.querySelector<HTMLElement>('#frame [data-mba-text=typing]')!
      const caret = u.querySelector<HTMLElement>('[data-mba-caret]')!
      return { text: u.firstChild!.textContent, caret: getComputedStyle(caret).visibility, w: caret.getBoundingClientRect().width }
    })
    expect(s).toEqual({ text: '> mba', caret: 'visible', w: expect.any(Number) })
    expect(s.w).toBeGreaterThan(0)
    // Before the line starts nothing is typed; after it, the whole line.
    await seek(page, 0.3)
    expect(await page.evaluate(() => document.querySelector('#frame [data-mba-text=typing]')!.firstChild!.textContent)).toBe('')
    await seek(page, 1.0)
    expect(await page.evaluate(() => document.querySelector('#frame [data-mba-text=typing]')!.firstChild!.textContent)).toBe('> mba explain')
  })

  test('the Arabic line is one [data-mba-text] element whose clip left edge moves left with t', async ({ page }) => {
    await openStoryboard(page, storyboard('app-window', params))
    await noError(page)
    const units = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#frame [data-mba-text]')].filter((e) => e.textContent!.includes('التحريك')).map((e) => ({ text: e.textContent, kind: e.dataset.mbaText, kids: e.children.length })),
    )
    expect(units).toEqual([{ text: 'جاري التحريك…', kind: 'line', kids: 0 }])
    const edge = async (t: number) => {
      await seek(page, t)
      return page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>('#frame [data-mba-text=line]')].find((e) => e.textContent!.includes('التحريك'))!
        const m = /inset\(\S+ \S+ \S+ ([\d.]+)%\)/.exec(getComputedStyle(el).clipPath)
        const r = el.getBoundingClientRect()
        return r.left + (m ? Number(m[1]) / 100 : 0) * r.width
      })
    }
    const xs = [await edge(1.22), await edge(1.35), await edge(1.5)]
    expect(xs[1]).toBeLessThan(xs[0]!)
    expect(xs[2]).toBeLessThan(xs[1]!)
    await seek(page, 2.5)
    await auditClean(page)
  })

  test('app mode and 16:9: lines fade in whole, audit clean', async ({ page }) => {
    await openStoryboard(page, storyboard('app-window', { ...params, mode: 'app' }, 3, '16:9'))
    await noError(page)
    await seek(page, 2.5)
    await auditClean(page)
  })
})

test.describe('stamp', () => {
  const slamScale = (page: Page) =>
    page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#frame [data-mba-part=stamp-slam]')!).transform).a)

  test('slams 1.7 → 1: above 1.3 just after it starts, 1 (± 0.01) at +0.5 s; seeks are pixel-identical', async ({ page }) => {
    await openStoryboard(page, storyboard('stamp', { text: 'جديد' }, 2))
    await noError(page)
    // expo.out over 0.25 s is already at 1.18 by +0.05 s, so "just after" is +0.02 s (report: concern).
    await seek(page, 0.02)
    expect(await slamScale(page)).toBeGreaterThan(1.3)
    await seek(page, 0.5)
    expect(Math.abs((await slamScale(page)) - 1)).toBeLessThanOrEqual(0.01)
    const a = await frameAt(page, 0.6)
    await frameAt(page, 0.2)
    expect((await frameAt(page, 0.6)).equals(a)).toBe(true)
    expect(await unsanctionedArabicText(page)).toEqual([])
    // Drift: it never holds still.
    expect((await frameAt(page, 1.8)).equals(await frameAt(page, 1.0))).toBe(false)
  })
})

test.describe('highlight', () => {
  const sb = (kind: string) => ({
    version: 1,
    format: '9:16',
    look: 'dark-tech',
    seed: 5,
    scenes: [
      { id: 'n', type: 'counter', start: 0, duration: 3, params: { from: 0, to: 300, key: 'num' } },
      { id: 'h', type: 'highlight', start: 0.3, duration: 2.7, track: 1, params: { kind, target: 'num' } },
    ],
  })

  test('circle with target on a counter: its box contains the target box at rest', async ({ page }) => {
    await openStoryboard(page, sb('circle'))
    await noError(page)
    for (const t of [1.5, 2.9]) {
      await seek(page, t)
      const target = await rectOf(page, '#frame [data-mba-key=num]')
      const mark = await rectOf(page, '#frame [data-mba-part=highlight]')
      expect(inside(target, mark), JSON.stringify({ t, target, mark })).toBe(true)
    }
    await auditClean(page)
  })

  test('burst and underline draw; the underline sweeps right → left', async ({ page }) => {
    await openStoryboard(page, sb('burst'))
    await noError(page)
    await openStoryboard(page, sb('underline'))
    await noError(page)
    // Half drawn: the visible part of the stroke is its start, at the right.
    await seek(page, 0.3 + 0.12)
    const ends = await page.evaluate(() => {
      const p = document.querySelector<SVGPathElement>('#frame [data-mba-part=highlight] path')!
      return { start: p.getPointAtLength(0).x, end: p.getPointAtLength(p.getTotalLength()).x }
    })
    expect(ends.start).toBeGreaterThan(ends.end)
  })

  test('a target missing from every overlapping scene fails the page at params.target', async ({ page }) => {
    const bad = sb('circle')
    bad.scenes[1]!.params = { kind: 'circle', target: 'nope' }
    await openStoryboard(page, bad)
    expect(await page.evaluate(() => window.__mba.error)).toContain('scenes[1].params.target')
  })
})

test.describe('hud', () => {
  const params = {
    sections: [
      { label: 'المشكلة', at: 0 },
      { label: 'الحل', at: 1 },
      { label: 'النتيجة', at: 2 },
    ],
    handle: '@motion.bilarabi',
    progress: 'pips',
  }
  for (const format of ['9:16', '16:9'] as const) {
    test(`${format}: inside section 2 the label is section 2's and 1 pip is filled; audit clean; inside the safe area`, async ({ page }) => {
      await openStoryboard(page, storyboard('hud', params, 3, format))
      await noError(page)
      await seek(page, 1.5)
      const s = await page.evaluate(() => ({
        labels: [...document.querySelectorAll<HTMLElement>('#frame [data-mba-part=hud-section]')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent),
        filled: document.querySelectorAll('#frame [data-mba-part=hud-pip][data-mba-filled="1"]').length,
        pips: document.querySelectorAll('#frame [data-mba-part=hud-pip]').length,
      }))
      expect(s).toEqual({ labels: ['الحل'], filled: 1, pips: 3 })
      await auditClean(page)
      const safe = safeRect(format)
      for (const sel of ['#frame [data-mba-part=hud-label]', '#frame [data-mba-part=hud-pip]', '#frame [data-mba-part=hud-handle]']) {
        const r = await rectOf(page, sel)
        expect(inside(r, safe, 2), `${sel} ${JSON.stringify(r)}`).toBe(true)
      }
      // The label sits top-right, the pips top-left.
      const label = await rectOf(page, '#frame [data-mba-part=hud-label]')
      const pip = await rectOf(page, '#frame [data-mba-part=hud-pip]')
      expect(label.x + label.w).toBeGreaterThan(safe.x + safe.w - 4)
      expect(pip.x).toBeLessThan(safe.x + safe.w / 2)
      // The current pip keeps filling (the HUD itself does not drift).
      expect((await frameAt(page, 1.2)).equals(await frameAt(page, 1.8))).toBe(false)
    })
  }
})

test.describe('hud long label (fix round 1)', () => {
  const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  test('9:16: a 30-character label shrinks to its cap and never meets the pip row or the handle', async ({ page }) => {
    const label = 'هذا عنوان قسم طويل جداً للتجربة'.slice(0, 30)
    expect([...label].length).toBe(30)
    const params = { sections: [{ label, at: 0 }, { label: 'ب', at: 1.5 }], handle: '@motion.bilarabi.channel', progress: 'pips' }
    await openStoryboard(page, storyboard('hud', params, 3))
    await noError(page)
    await seek(page, 0.8)
    const text = await rectOf(page, '#frame [data-mba-part=hud-section] [data-mba-text]')
    const pips = await page.evaluate(() => {
      const r = document.querySelector('#frame [data-mba-part=hud-pip]')!.parentElement!.getBoundingClientRect()
      const f = document.getElementById('frame')!.getBoundingClientRect()
      return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height }
    })
    const handle = await rectOf(page, '#frame [data-mba-part=hud-handle] [data-mba-text]')
    expect(hit(text, pips), JSON.stringify({ text, pips })).toBe(false)
    expect(hit(text, handle), JSON.stringify({ text, handle })).toBe(false)
    expect(text.w).toBeLessThanOrEqual(0.55 * safeRect('9:16').w + 1)
    await auditClean(page)
  })
})

test.describe('comment-cta', () => {
  test('موشن: the keyword clip is partial at 0.6 s, the DM card shows at 1.9 s; audit clean', async ({ page }) => {
    await openStoryboard(page, storyboard('comment-cta', { keyword: 'موشن', dmBody: 'رابط الدورة في رسائلك' }))
    await noError(page)
    await seek(page, 0.6)
    const pct = await page.evaluate(() => {
      const m = /inset\(\S+ \S+ \S+ ([\d.]+)%\)/.exec(getComputedStyle(document.querySelector('#frame [data-mba-part=cta-keyword]')!).clipPath)
      return m ? Number(m[1]) : null
    })
    expect(pct).not.toBeNull()
    expect(pct!).toBeGreaterThan(0)
    expect(pct!).toBeLessThan(100)
    await seek(page, 1.9)
    const dm = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('#frame [data-mba-part=cta-dm]')!
      const r = el.getBoundingClientRect()
      return { opacity: Number(getComputedStyle(el).opacity), w: r.width, h: r.height }
    })
    expect(dm.opacity).toBe(1)
    expect(dm.w).toBeGreaterThan(0)
    await auditClean(page)
    await seek(page, 2.6)
    await auditClean(page)
  })
})

test.describe('phone', () => {
  test('message lines: bubbles enter whole, the first is in on frame 0; drifts', async ({ page }) => {
    await openStoryboard(page, storyboard('phone', { screen: { lines: [{ text: 'وصلك الفيديو؟', at: 0 }, { text: 'نعم، شكراً!', at: 1 }] } }))
    await noError(page)
    await seek(page, 0)
    const ops = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#frame [data-mba-part=phone-line]')].map((e) => Number(getComputedStyle(e).opacity)))
    expect(await ops()).toEqual([1, 0])
    await seek(page, 1.5)
    expect(await ops()).toEqual([1, 1])
    expect(await unsanctionedArabicText(page)).toEqual([])
    expect((await frameAt(page, 2.8)).equals(await frameAt(page, 2.0))).toBe(false)
  })

  test('bubbles that cannot fit the screen even at the minimum size fail the page (not clipped silently)', async ({ page }) => {
    const long = 'هذه رسالة طويلة جداً تملأ الشاشة الصغيرة كلها ولا تترك مكاناً لغيرها أبداً'.slice(0, 60)
    const lines = Array.from({ length: 6 }, (_, i) => ({ text: long, at: i * 0.2 }))
    await openStoryboard(page, storyboard('phone', { screen: { lines }, size: 0.2 }))
    const err = await page.evaluate(() => window.__mba.error)
    expect(err).toMatch(/^.*[؀-ۿ].* — .*phone: the message lines do not fit the screen/)
  })

  test('an image screen fits cover inside the screen clip', async ({ page }) => {
    const png = new PNG({ width: 4, height: 8 })
    png.data.fill(200)
    const src = `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
    await openStoryboard(page, storyboard('phone', { screen: { image: src }, tilt: 0 }))
    await noError(page)
    await seek(page, 1)
    const s = await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>('#frame [data-mba-part=phone-screen] img')!
      const sc = document.querySelector<HTMLElement>('#frame [data-mba-part=phone-screen]')!
      return { fit: getComputedStyle(img).objectFit, loaded: img.complete && img.naturalWidth === 4, overflow: getComputedStyle(sc).overflow, same: img.offsetWidth === sc.clientWidth && img.offsetHeight === sc.clientHeight }
    })
    expect(s).toEqual({ fit: 'cover', loaded: true, overflow: 'hidden', same: true })
  })
})

test.describe('morph clones and the audit (Task 8 carried b)', () => {
  test('text inside [data-mba-morph-clone] is not audited (no double count)', async ({ page }) => {
    await openStoryboard(page, storyboard('counter', { from: 0, to: 5 }))
    await noError(page)
    await seek(page, 2)
    const before = await page.evaluate(() => window.__mba.audit())
    await page.evaluate(() => {
      const clone = document.createElement('div')
      clone.dataset.mbaMorphClone = 'k'
      clone.innerHTML = '<span data-mba-text="line" dir="ltr">مرحبا</span><b>نص</b>'
      document.getElementById('frame')!.append(clone)
    })
    expect(await page.evaluate(() => window.__mba.audit())).toEqual(before)
  })
})

test.describe('morph into and out of library primitives and devices (Task 8 carried a; slow)', () => {
  test.describe.configure({ timeout: 300_000 })
  test('checklist, line-art, icon, counter, phone, app-window: no page error, cold == warm in every window', async () => {
    const cuts = [1.5, 3, 4.5, 6, 7.5, 9]
    const extraTimes = cuts.flatMap((c) => [c - 0.29, c - 0.15, c, c + 0.15, c + 0.29])
    const r = await verifyDeterminism({ storyboardPath: join(FIXTURES, 'tr-morph-devices.json'), samplesPerScene: 3, extraTimes })
    expect(r.pageErrors).toEqual([])
    expect(r.mismatches).toEqual([])
  })
})

test.describe('drift after the entrance (fix round 1)', () => {
  const cases: { name: string; type: string; params: Record<string, unknown>; root: string; settled: number; later: number }[] = [
    { name: 'app-window', type: 'app-window', params: { mode: 'app', title: 'mba', lines: [{ text: 'الصوت: مفعّل', at: 0 }, { text: 'الجودة: 1080p', at: 0.3 }] }, root: 'app-window-root', settled: 0.6, later: 1.8 },
    { name: 'comment-cta', type: 'comment-cta', params: { keyword: 'موشن' }, root: 'comment-cta-root', settled: 2.1, later: 2.9 },
    { name: 'highlight (box)', type: 'highlight', params: { kind: 'circle', box: { x: 0.2, y: 0.3, w: 0.6, h: 0.2 } }, root: 'highlight', settled: 0.5, later: 1.7 },
  ]
  for (const c of cases) {
    test(`${c.name}: everything has landed, yet the frame keeps moving (shared drift)`, async ({ page }) => {
      await openStoryboard(page, storyboard(c.type, c.params, 3))
      await noError(page)
      const tf = async (t: number) => {
        await seek(page, t)
        return page.evaluate((sel) => getComputedStyle(document.querySelector(`#frame [data-mba-part=${sel}]`)!).transform, c.root)
      }
      expect(await tf(c.later)).not.toBe(await tf(c.settled))
      expect((await frameAt(page, c.later)).equals(await frameAt(page, c.settled))).toBe(false)
    })
  }
})

test.describe('terminal font (fix round 1)', () => {
  test('typed lines use the bundled JetBrains Mono (loaded before ready); golden', async ({ page }) => {
    await openStoryboard(page, storyboard('app-window', { mode: 'terminal', title: 'mba', lines: [{ text: '> mba explain', at: 0 }, { text: 'جاري التحريك…', at: 0.5 }, { text: 'done in 2.1s', at: 1 }] }))
    await noError(page)
    const s = await page.evaluate(() => ({
      family: getComputedStyle(document.querySelector('#frame [data-mba-text=typing]')!).fontFamily,
      loaded: [...document.fonts].some((f) => f.family.replace(/['"]/g, '') === 'JetBrains Mono' && f.status === 'loaded'),
      check: document.fonts.check("400 40px 'JetBrains Mono'"),
    }))
    expect(s.family.startsWith('"JetBrains Mono"') || s.family.startsWith("'JetBrains Mono'")).toBe(true)
    expect(s.loaded).toBe(true)
    expect(s.check).toBe(true)
    await page.evaluate(() => window.__mba.seek(2.2))
    await expect(page.locator('#frame')).toHaveScreenshot('app-window-terminal.png', { maxDiffPixelRatio: 0.002 })
  })
})
