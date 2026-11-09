import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { openStoryboard } from './helpers'
import type { AuditIssue } from '../../src/runtime/audit'

const fixtureUrl = (path: string) => new URL(`../${path}`, import.meta.url)
const load = (path: string): Record<string, unknown> => JSON.parse(readFileSync(fixtureUrl(path), 'utf8'))

async function testPrimitivesSource(): Promise<string> {
  const mod = (await import(fixtureUrl('fixtures/test-primitives.js').href)) as { default: string }
  return mod.default
}

async function auditAt(page: Page, t: number): Promise<AuditIssue[]> {
  return page.evaluate(async (tt) => {
    await window.__mba.seek(tt)
    return window.__mba.audit()
  }, t)
}

test.describe('text audit: _badtext breaks every rule', () => {
  test('each offender reported exactly once (two unsanctioned offenders), with the containing scene id', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-bad.json'), { testPrimitives: await testPrimitivesSource() })
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    const issues = await auditAt(page, 3)
    const counts: Record<string, number> = {}
    for (const i of issues) counts[i.rule] = (counts[i.rule] ?? 0) + 1
    expect(counts, JSON.stringify(issues, null, 1)).toEqual({
      'clipped-by-frame': 1,
      'outside-safe': 1,
      'too-small': 1,
      'unsanctioned-arabic': 2,
      'wrong-direction': 1,
    })
    for (const i of issues) expect(i.sceneId, i.rule).toBe('bad')
    const text = (rule: string) => issues.filter((i) => i.rule === rule).map((i) => i.text).sort()
    expect(text('outside-safe')).toEqual(['TOP'])
    expect(text('too-small')).toEqual(['tiny'])
    expect(text('clipped-by-frame')).toEqual(['EDGE'])
    expect(text('wrong-direction')).toEqual(['مرحبا'])
    // The bare node, and the letter-split word unit reported once as a unit.
    expect(text('unsanctioned-arabic')).toEqual(['سلام', 'كلمة'])
    for (const i of issues) expect(i.detail.length, i.rule).toBeGreaterThan(0)
  })

  test('structural rules are unconditional: reported while their scene is hidden too (R16)', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-bad.json'), { testPrimitives: await testPrimitivesSource() })
    // t = 1: the slam ("hook") is at rest and clean; "bad" is hidden, so only its structural issues show.
    const issues = await auditAt(page, 1)
    expect(issues.map((i) => `${i.rule}@${i.sceneId}`).sort()).toEqual([
      'unsanctioned-arabic@bad',
      'unsanctioned-arabic@bad',
      'wrong-direction@bad',
    ])
  })

  test('outside-safe and clipped-by-frame are skipped inside a transition window (R3)', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-bad.json'), { testPrimitives: await testPrimitivesSource() })
    const rules = await page.evaluate(async () => {
      await window.__mba.seek(3)
      document.getElementById('frame')!.dataset.mbaTr = '1'
      return window.__mba.audit().map((i) => i.rule).sort()
    })
    expect(rules).toEqual(['too-small', 'unsanctioned-arabic', 'unsanctioned-arabic', 'wrong-direction'])
  })

  test('the transition skip is track-scoped: a track-0 window does not hide clipped text on track 2 (Task 8)', async ({ page }) => {
    // Track 0: hook → bad0 with a color-wipe at 2 (window 1.8–2.2). Track 2: bad2 over 1–3.
    const sb = {
      version: 1,
      format: '9:16',
      look: 'dark-tech',
      seed: 4,
      scenes: [
        { id: 'hook', type: 'slam', start: 0, duration: 2, params: { text: 'Claude أصبح أذكى' } },
        { id: 'bad0', type: '_badtext', start: 2, duration: 2, params: {} },
        { id: 'bad2', type: '_badtext', start: 1, duration: 2, track: 2, params: {} },
      ],
      transitions: [{ type: 'color-wipe', at: 2 }],
    }
    await openStoryboard(page, sb, { testPrimitives: await testPrimitivesSource() })
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    const geometric = (issues: AuditIssue[]) =>
      issues
        .filter((i) => i.rule === 'clipped-by-frame' || i.rule === 'outside-safe')
        .map((i) => `${i.rule}@${i.sceneId}`)
        .sort()
    // In the window: track 0 (bad0) is skipped, track 2 (bad2) is still audited.
    expect(geometric(await auditAt(page, 2.1))).toEqual(['clipped-by-frame@bad2', 'outside-safe@bad2'])
    // Outside it both are audited.
    expect(geometric(await auditAt(page, 2.5))).toEqual(['clipped-by-frame@bad0', 'clipped-by-frame@bad2', 'outside-safe@bad0', 'outside-safe@bad2'])
  })

  test('audit rejects before the stage is ready', async ({ page }) => {
    await openStoryboard(page, { version: 1, format: '9:16', scenes: [{ id: 'x', type: 'nope', start: 0, duration: 1, params: {} }] })
    const msg = await page.evaluate(() => {
      try {
        window.__mba.audit()
        return 'no throw'
      } catch (e) {
        return (e as Error).message
      }
    })
    expect(msg).toMatch(/stage/)
  })
})

/**
 * Rest windows (global seconds) where every text element of the fixture is at its rest pose.
 * Local times below are the primitive's own (they include a scene's preroll: global = start −
 * preroll + local, and the primitive's duration is duration + preroll).
 * - slam: words have landed and the shake is over (intro 0.55 + shake 0.2) until the exit
 *   (duration − 0.25); phases scale by k = min(1, duration / 0.8).
 * - wipe-reveal: the subtitle has landed (subAt 0.6 + sub 0.4) until the exit (duration − 0.3),
 *   scaled by k = min(1, duration / 1.3).
 * - search-typing: the camera pull-back has ended (intro 0.5 + typing + hold 0.4 + pullback 0.45)
 *   until the end. search-latin: 22 slots / 14 cps = 1.571 s, so 2.921 s.
 * - demo-ar (8 s): search 0–3.9 with preroll 0.5 (duration 4.4, typing squeezed to 2.45 s, rest
 *   from local 3.80 = global 3.30); slam 3.9–5.75 with preroll 0.15 (duration 2.0, rest local
 *   0.75–1.75 = global 4.5–5.5); wipe-reveal 5.75–8 (k = 1, rest 6.75–7.70). Transition windows
 *   (whip-pan 3.7–4.1, color-wipe 5.5–6.0) move the layers, so they are not rest and are excluded.
 */
const REST: Record<string, [number, number][]> = {
  'examples/demo-ar.json': [
    [3.31, 3.69],
    [4.51, 5.49],
    [6.76, 7.69],
  ],
  'tests/fixtures/slam-long.json': [[0.76, 2.24]],
  'tests/fixtures/wipe-long-ar.json': [[1.01, 2.19]],
  'tests/fixtures/wipe-long-latin.json': [[1.01, 2.19]],
  'tests/fixtures/search-latin.json': [[2.95, 5]],
}

/** `n` times spread over the windows in proportion to their length, at least one per window. */
function restTimes(windows: [number, number][], n = 10): number[] {
  const len = windows.map(([a, b]) => b - a)
  const total = len.reduce((s, l) => s + l, 0)
  const counts = len.map((l) => Math.max(1, Math.round((n * l) / total)))
  const sum = () => counts.reduce((s, c) => s + c, 0)
  while (sum() > n) counts[counts.indexOf(Math.max(...counts))]! -= 1
  while (sum() < n) counts[counts.indexOf(Math.max(...counts))]! += 1
  return windows.flatMap(([a, b], w) => Array.from({ length: counts[w]! }, (_, i) => a + ((i + 0.5) * (b - a)) / counts[w]!))
}

test.describe('text audit: micro-motion counts as rest (R31)', () => {
  const statsAt = (page: Page, t: number) =>
    page.evaluate(async (tt) => {
      await window.__mba.seek(tt)
      return window.__mba.auditStats()
    }, t)

  test('a punched-in, drifting caption (scale 1.08 + translateX) is measured and clean', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-micro.json'), { testPrimitives: await testPrimitivesSource() })
    const st = await statsAt(page, 1)
    expect(st.checkedGeometric).toBeGreaterThan(0)
    expect(st.issues).toEqual([])
  })

  test('the same transform with the caption above the safe area is reported outside-safe', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-micro.json'), { testPrimitives: await testPrimitivesSource() })
    const st = await statsAt(page, 3)
    expect(st.checkedGeometric).toBeGreaterThan(0)
    expect(st.issues.map((i) => `${i.rule}:${i.text}`)).toEqual(['outside-safe:DRIFT'])
  })

  test('scale(1.5) and rotate(5deg) containers are still skipped', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-micro.json'), { testPrimitives: await testPrimitivesSource() })
    for (const t of [5, 7]) {
      const st = await statsAt(page, t)
      expect(st.checkedGeometric, `t=${t}`).toBe(0)
      expect(st.issues, `t=${t}`).toEqual([])
    }
  })

  test('the scale limit is cumulative: one scale(1.1) is measured, two stacked ones (1.21) are skipped', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-micro.json'), { testPrimitives: await testPrimitivesSource() })
    const single = await statsAt(page, 9)
    expect(single.checkedGeometric).toBeGreaterThan(0)
    expect(single.issues).toEqual([])
    const stacked = await statsAt(page, 11)
    expect(stacked.checkedGeometric).toBe(0)
    expect(stacked.issues).toEqual([])
  })

  test('isRestTransform: scale boundaries, skew, rotation and 3D', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-micro.json'), { testPrimitives: await testPrimitivesSource() })
    const r = await page.evaluate(async () => {
      const mod = (await import(/* @vite-ignore */ '/audit.ts' as string)) as { isRestTransform: (m: DOMMatrixReadOnly) => boolean }
      const t = (v: string) => mod.isRestTransform(new DOMMatrixReadOnly(v))
      return {
        s085: t('scale(0.85)'),
        s115: t('scale(1.15)'),
        s116: t('scale(1.16)'),
        translate: t('translate(300px, -200px) scale(1.05)'),
        skew: t('skewX(3deg) scale(1.05)'),
        rot: t('rotate(5deg)'),
        rotY: t('rotateY(10deg)'),
        m3d: t('matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0.002,1)'),
      }
    })
    expect(r).toEqual({ s085: true, s115: true, s116: false, translate: true, skew: false, rot: false, rotY: false, m3d: false })
  })
})

test.describe('text audit: transformed text and tatweel (Plan 2a+ Task 1)', () => {
  test('a scaled word (1.3) 20 px past the right frame edge is reported clipped-by-frame', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-scaled.json'), { testPrimitives: await testPrimitivesSource() })
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    const issues = await auditAt(page, 1)
    expect(issues.map((i) => `${i.rule}:${i.text}`)).toEqual(['clipped-by-frame:DRIFT'])
  })

  test('the same scale inside the frame but 10 px past the safe area has no outside-safe (rest-only rule)', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-scaled.json'), { testPrimitives: await testPrimitivesSource() })
    expect(await auditAt(page, 3)).toEqual([])
  })

  test('a word unit starting with a tatweel is reported tatweel-split', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-tatweel.json'), { testPrimitives: await testPrimitivesSource() })
    const issues = await auditAt(page, 1)
    expect(issues.map((i) => i.rule)).toEqual(['tatweel-split'])
    expect(issues[0]!.text).toBe('ـتمدد')
  })

  test('a tatweel ending a unit is reported, a tatweel inside a word is not', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-scaled.json'), { testPrimitives: await testPrimitivesSource() })
    const r = await page.evaluate(async () => {
      const units = (await import(/* @vite-ignore */ '/text/units.ts' as string)) as typeof import('../../src/runtime/text/units')
      await window.__mba.seek(1)
      const host = document.querySelector<HTMLElement>('#frame [data-mba-scene]')!
      const split = () => window.__mba.audit().filter((i) => i.rule === 'tatweel-split').map((i) => i.text)
      const inside = document.createElement('div')
      host.append(inside)
      units.wordUnits(inside, 'تـمــدد')
      const clean = split()
      units.wordUnits(inside, 'تمـ')
      return { clean, ending: split() }
    })
    expect(r.clean).toEqual([])
    expect(r.ending).toEqual(['تمـ'])
  })

  test('wordUnits and lineUnit tag units with data-mba-word', async ({ page }) => {
    await openStoryboard(page, load('fixtures/audit-scaled.json'), { testPrimitives: await testPrimitivesSource() })
    const r = await page.evaluate(async () => {
      const units = (await import(/* @vite-ignore */ '/text/units.ts' as string)) as typeof import('../../src/runtime/text/units')
      const p = document.createElement('div')
      const spans = units.wordUnits(p, 'أهلاً بكم', undefined, [3, 4])
      const plain = units.wordUnits(p, 'بدون')
      const line = units.lineUnit(p, 'سطر كامل', undefined, 7)
      return { words: spans.map((s) => s.dataset.mbaWord), plain: plain[0]!.dataset.mbaWord ?? null, line: line.dataset.mbaWord }
    })
    expect(r).toEqual({ words: ['3', '4'], plain: null, line: '7' })
  })
})

test.describe('text audit: real primitives are clean at rest', () => {
  for (const [path, windows] of Object.entries(REST)) {
    test(`audit() is [] at 10 rest times of ${path}`, async ({ page }) => {
      await openStoryboard(page, load(`../${path}`))
      expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
      const times = restTimes(windows)
      expect(times.length).toBe(10)
      for (const t of times) {
        const st = await page.evaluate(async (tt) => {
          await window.__mba.seek(tt)
          return window.__mba.auditStats()
        }, t)
        expect(st.issues, `t=${t.toFixed(3)}`).toEqual([])
        // Non-vacuous: some text was visible at rest and actually measured.
        expect(st.checkedGeometric, `t=${t.toFixed(3)}`).toBeGreaterThan(0)
      }
    })
  }
})

test('mid-animation poses: search-typing mid-zoom has no clipped-by-frame or too-small (R17)', async ({ page }) => {
  // demo-ar's Arabic query, zoomed to 1.9 on the caret while typing: the camera clamps its pan
  // (and eases the zoom as the typed span grows) so the text stays inside the frame.
  await openStoryboard(page, load('../examples/demo-ar.json'))
  for (const t of [1.2, 1.8, 2.4]) {
    expect(await auditAt(page, t), `t=${t}`).toEqual([])
  }
})

test('search-typing: the full demo query at zoom 1.9 is never clipped by the frame (every 0.1 s of the scene)', async ({ page }) => {
  const sb = load('../examples/demo-ar.json') as { scenes: { id: string; params: Record<string, unknown> }[] }
  expect(sb.scenes[0]!.params.zoom ?? 1.9).toBe(1.9)
  await openStoryboard(page, sb)
  for (let i = 0; i <= 39; i++) {
    const t = i / 10
    const issues = await auditAt(page, t)
    expect(issues.filter((x) => x.rule === 'clipped-by-frame'), `t=${t}`).toEqual([])
  }
})

test('real units own their Arabic text directly: bidi isolates and the typing caret pass', async ({ page }) => {
  // mixed.json: Arabic + "Gemini 3" (an LTR isolate holding word units); demo-ar: typing + caret.
  for (const [path, t] of [['fixtures/mixed.json', 1], ['../examples/demo-ar.json', 2.5]] as const) {
    await openStoryboard(page, load(path))
    const issues = await auditAt(page, t)
    expect(issues.filter((i) => i.rule === 'unsanctioned-arabic'), path).toEqual([])
    expect(await page.locator('#frame [data-mba-text]').count(), path).toBeGreaterThan(0)
  }
})

test('typing units carry their full text in data-mba-full', async ({ page }) => {
  const sb = load('fixtures/search-latin.json')
  await openStoryboard(page, sb)
  const r = await page.evaluate(async () => {
    await window.__mba.seek(0.8)
    const el = document.querySelector<HTMLElement>('#frame [data-mba-text=typing]')!
    return { full: el.dataset.mbaFull, shown: el.textContent }
  })
  expect(r.full).toBe('how to use ChatGPT?')
  expect(r.shown!.length).toBeLessThan(r.full!.length)
})

test.describe('text audit under the one-world camera (Plan 2a+ Task 6)', () => {
  // A wide kinetic line (rest pose) on track 1; the camera holds zoom 2 on the frame centre.
  const wide = (camera?: unknown) => ({
    version: 1,
    scenes: [
      {
        id: 'line',
        type: 'kinetic-text',
        track: 1,
        start: 0,
        duration: 3,
        params: { mode: 'line', words: ['هذا', 'سطر', 'عريض', 'جدا', 'هنا'].map((text) => ({ text, at: 0 })) },
      },
    ],
    ...(camera ? { camera } : {}),
  })

  test('without the camera the wide line is clean; at zoom 2 its glyph boxes cross the frame: clipped-by-frame', async ({ page }) => {
    await openStoryboard(page, wide())
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    const plain = await page.evaluate(async () => {
      await window.__mba.seek(1)
      return window.__mba.auditStats()
    })
    expect(plain.issues).toEqual([])
    expect(plain.checkedGeometric).toBeGreaterThan(0)

    await openStoryboard(page, wide({ keys: [{ at: 0, zoom: 2 }] }))
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    const zoomed = await page.evaluate(async () => {
      await window.__mba.seek(1)
      return window.__mba.auditStats()
    })
    expect(zoomed.issues.some((i) => i.rule === 'clipped-by-frame' && i.sceneId === 'line'), JSON.stringify(zoomed.issues)).toBe(true)
    // The camera wrapper is not part of the rest walk: the zoomed text still counts as at rest.
    expect(zoomed.checkedGeometric).toBeGreaterThan(0)
  })
})
