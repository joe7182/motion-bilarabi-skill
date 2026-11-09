import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { openStoryboard, frameAt, unsanctionedArabicText } from './helpers'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { parseStoryboard } from '../../src/core/storyboard'

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'))
const probe = fixture('probe.json')

test('ready resolves and fonts are loaded', async ({ page }) => {
  await openStoryboard(page, probe)
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  expect(await page.evaluate(() => document.fonts.check('900 40px Cairo'))).toBe(true)
  expect(await page.evaluate(() => document.fonts.check('700 40px Tajawal'))).toBe(true)
  expect(await page.evaluate(() => window.__mba.duration)).toBe(2.5)
})

test('every bundled @font-face is loaded before ready', async ({ page }) => {
  await openStoryboard(page, probe)
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  const faces = await page.evaluate(() => [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`).sort())
  expect(faces).toEqual([
    'Cairo 200 1000 loaded',
    'JetBrains Mono 400 loaded',
    'Tajawal 400 loaded',
    'Tajawal 700 loaded',
    'Tajawal 900 loaded',
  ])
})

test('missing bundled fonts surface as an error instead of rendering with a fallback', async ({ page }) => {
  await page.route('**/fonts/**', (route) => route.abort())
  await openStoryboard(page, probe)
  expect(await page.evaluate(() => window.__mba.error)).toMatch(/font|network/i)
  expect(await page.evaluate(() => window.__mba.duration)).toBe(0)
})

test('#frame has exactly the format size and the look background', async ({ page }) => {
  await openStoryboard(page, probe)
  expect(await page.locator('#frame').boundingBox()).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
  expect(await page.locator('#frame').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(14, 13, 12)')
})

test('seek is order-independent', async ({ page }) => {
  await openStoryboard(page, probe)
  const fresh = await frameAt(page, 1.2)
  await frameAt(page, 0.3)
  const again = await frameAt(page, 1.2)
  expect(again.equals(fresh)).toBe(true)
  const other = await frameAt(page, 1.7)
  expect(other.equals(fresh)).toBe(false)
})

test('seek from the end back to 1.2 equals a fresh seek to 1.2', async ({ page }) => {
  await openStoryboard(page, probe)
  const fresh = await frameAt(page, 1.2)
  await frameAt(page, 2.5)
  expect((await frameAt(page, 1.2)).equals(fresh)).toBe(true)
})

test('timeline callbacks never fire during seek, so frames do not depend on seek history', async ({ page }) => {
  await openStoryboard(page, probe)
  const r = await page.evaluate(async () => {
    const reg = await import('/primitives/registry.ts' as string)
    const st = await import('/stage.ts' as string)
    const w = window as unknown as { __cbFired: number }
    w.__cbFired = 0
    if (!reg.hasPrimitive('_cb-test')) {
      // Test-only primitive: reuses _probe's paused GSAP timeline (same gsap instance as the stage)
      // and adds a .call() that mutates the DOM at localT = 0.5.
      const probePrim = reg.getPrimitive('_probe')
      reg.registerPrimitive({
        id: '_cb-test',
        params: probePrim.params,
        build(ctx: { layer: HTMLElement }, p: unknown) {
          const built = probePrim.build(ctx, p)
          built.timeline.call(
            () => {
              w.__cbFired++
              ctx.layer.style.background = 'red'
            },
            [],
            0.5,
          )
          return built
        },
      })
    }
    const root = document.createElement('div')
    document.body.append(root)
    const stage = await st.createStage(root, {
      version: 1, format: '9:16', fps: 30, look: 'dark-tech', dir: 'rtl', seed: 1,
      scenes: [{ id: 'cb', type: '_cb-test', start: 0, duration: 2, params: { text: 'نص' } }],
    })
    await stage.seek(1.0)
    const fresh = root.innerHTML
    await stage.seek(1.5)
    await stage.seek(0.2)
    await stage.seek(1.0)
    const after = root.innerHTML
    root.remove()
    return { fired: w.__cbFired, same: fresh === after }
  })
  expect(r).toEqual({ fired: 0, same: true })
})

test('scene visibility', async ({ page }) => {
  await openStoryboard(page, probe)
  const visible = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#frame > [data-mba-scene]')].map((l) => l.style.visibility === 'visible'),
    )
  await page.evaluate(() => window.__mba.seek(0.5))
  expect(await visible()).toEqual([true, false])
  await page.evaluate(() => window.__mba.seek(window.__mba.duration))
  expect(await visible()).toEqual([false, true])
})

test('bad params surface with path', async ({ page }) => {
  const bad = structuredClone(probe) as { scenes: { params: Record<string, unknown> }[] }
  bad.scenes[0]!.params = { text: 5 }
  await openStoryboard(page, bad)
  expect(await page.evaluate(() => window.__mba.error)).toContain('scenes[0].params.text')
})

test('a known type with no registered primitive fails at scenes[i].type', async ({ page }) => {
  // Every PRIMITIVE_IDS type is registered now, so the stage is driven directly with a test-only
  // type `_known-unregistered`: one that parseStoryboard accepts when it is listed in knownTypes,
  // but that has no registered primitive.
  await openStoryboard(page, probe)
  const r = await page.evaluate(async () => {
    const st = await import('/stage.ts' as string)
    const reg = await import('/primitives/registry.ts' as string)
    const root = document.createElement('div')
    document.body.append(root)
    try {
      await st.createStage(root, {
        version: 1, format: '9:16', fps: 30, look: 'dark-tech', dir: 'rtl', seed: 1,
        scenes: [{ id: 'x', type: '_known-unregistered', start: 0, duration: 1, params: {} }],
      })
      return { registered: reg.hasPrimitive('_known-unregistered'), name: 'none', path: '', children: root.childElementCount }
    } catch (e) {
      const err = e as { name: string; path: string }
      return { registered: reg.hasPrimitive('_known-unregistered'), name: err.name, path: err.path, children: root.childElementCount }
    } finally {
      root.remove()
    }
  })
  expect(r).toEqual({ registered: false, name: 'StoryboardError', path: 'scenes[0].type', children: 0 })
})

test('parseStoryboard accepts the test-only type when listed, so the stage check above is the one that fires', async () => {
  const sb = parseStoryboard(
    { version: 1, scenes: [{ id: 'x', type: '_known-unregistered', start: 0, duration: 1 }] },
    [...PRIMITIVE_IDS, '_known-unregistered'],
  )
  expect(sb.scenes[0]!.type).toBe('_known-unregistered')
})

test('registered primitive ids equal PRIMITIVE_IDS', async ({ page }) => {
  await openStoryboard(page, probe)
  const ids: string[] = await page.evaluate(async () => {
    const url = '/primitives/registry.ts'
    const mod = await import(url)
    return mod.primitiveIds()
  })
  expect(ids).toEqual([...PRIMITIVE_IDS].sort())
})

test('only sanctioned text', async ({ page }) => {
  await openStoryboard(page, probe)
  await page.evaluate(() => window.__mba.seek(1))
  expect(await page.locator('#frame [data-mba-text]').count()).toBeGreaterThan(0)
  expect(await unsanctionedArabicText(page)).toEqual([])
})

test('text units: typing writes one text node, fitText respects bounds', async ({ page }) => {
  await openStoryboard(page, probe)
  const r = await page.evaluate(async () => {
    const url = '/text/units.ts'
    const u = await import(url)
    const host = document.createElement('div')
    host.style.font = "900 40px 'Cairo'"
    document.body.append(host)
    const typing = u.typingUnit(host, 'كيف أصمم')
    typing.setProgress(3)
    const nodes = [...typing.el.childNodes]
      .filter((n: Node) => n.nodeType === Node.TEXT_NODE)
      .map((n: Node) => n.nodeValue)
    const words = u.wordUnits(host, 'مرحبا  بالعالم')
    const line = u.lineUnit(host, 'سطر واحد طويل جدا')
    const px = u.fitText(line, { w: 200, h: 100 }, 300, 10)
    const w = line.offsetWidth
    host.remove()
    return {
      nodes,
      typingKind: typing.el.dataset.mbaText,
      lang: typing.el.lang,
      dir: typing.el.dir,
      words: words.map((s: HTMLElement) => [s.textContent, s.dataset.mbaText]),
      lineKind: line.dataset.mbaText,
      px,
      w,
    }
  })
  expect(r.nodes).toEqual(['كيف'])
  expect(r).toMatchObject({ typingKind: 'typing', lang: 'ar', dir: 'rtl', lineKind: 'line' })
  expect(r.words).toEqual([
    ['مرحبا', 'word'],
    ['بالعالم', 'word'],
  ])
  expect(r.px).toBeGreaterThanOrEqual(10)
  expect(r.px).toBeLessThan(300)
  expect(r.w).toBeLessThanOrEqual(200)
})

/**
 * Test-only primitives (source evaluated in the page; `?test=1` registers them). They style only
 * children of their layer, never the layer itself.
 * - `_async-flag`: `update` resolves after a microtask chain, then sets `data-done` on a child.
 * - `_async-box`: async `build`; `update` takes MORE microtask hops for EARLIER times, so a burst of
 *   unserialized seeks would end on a stale frame.
 */
const ASYNC_PRIMS = `() => [
  {
    id: '_async-flag',
    build(ctx) {
      const el = document.createElement('div')
      el.id = 'async-flag'
      ctx.layer.append(el)
      return {
        update: async (localT) => {
          for (let i = 0; i < 5; i++) await Promise.resolve()
          el.dataset.done = String(localT)
        },
      }
    },
  },
  {
    id: '_async-box',
    async build(ctx) {
      await Promise.resolve()
      const box = document.createElement('div')
      box.id = 'async-box'
      Object.assign(box.style, { position: 'absolute', left: '100px', top: '400px', width: '120px', height: '120px', background: '#ff5a1f' })
      ctx.layer.append(box)
      return {
        update: async (localT) => {
          const hops = Math.round((2.2 - localT) * 20)
          for (let i = 0; i < hops; i++) await Promise.resolve()
          box.style.transform = 'translateX(' + localT * 300 + 'px)'
          box.dataset.t = String(localT)
        },
      }
    },
  },
]`

const asyncSb = (types: string[]) => ({
  version: 1,
  format: '9:16',
  seed: 1,
  scenes: [
    { id: 'p', type: '_probe', start: 0, duration: 2.5, params: { text: 'مرحبا بالعالم' } },
    ...types.map((type) => ({ id: type, type, start: 0, duration: 2.5, params: {} })),
  ],
})

test('async update is awaited', async ({ page }) => {
  await openStoryboard(page, asyncSb(['_async-flag']), { testPrimitives: ASYNC_PRIMS })
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  const done = await page.evaluate(async () => {
    await window.__mba.seek(1)
    return document.getElementById('async-flag')?.dataset.done
  })
  expect(done).toBe('1')
})

test('seek race, latest wins', async ({ page, context }) => {
  const sb = asyncSb(['_async-box'])
  await openStoryboard(page, sb, { testPrimitives: ASYNC_PRIMS })
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  const r = await page.evaluate(async () => {
    const ps: Promise<void>[] = []
    for (let i = 1; i <= 20; i++) ps.push(window.__mba.seek(i / 10))
    await ps[ps.length - 1]
    const t = document.getElementById('async-box')?.dataset.t
    await Promise.all(ps)
    return t
  })
  expect(r).toBe('2')
  const raced = await page.locator('#frame').screenshot({ caret: 'hide' })

  const cold = await context.newPage()
  await openStoryboard(cold, sb, { testPrimitives: ASYNC_PRIMS })
  const fresh = await frameAt(cold, 2.0)
  expect(raced.equals(fresh)).toBe(true)
})

test('test primitives are ignored without ?test=1', async ({ page }) => {
  await openStoryboard(page, asyncSb(['_async-flag']), { testPrimitives: ASYNC_PRIMS, test: false })
  expect(await page.evaluate(() => window.__mba.error)).toContain('unknown scene type "_async-flag"')
  expect(await page.evaluate(async () => (await import('/primitives/registry.ts' as string)).hasPrimitive('_async-flag'))).toBe(false)
})

test('test primitive ids must start with _', async ({ page }) => {
  await openStoryboard(page, asyncSb([]), { testPrimitives: `() => [{ id: 'bad', build: () => ({}) }]` })
  expect(await page.evaluate(() => window.__mba.error)).toContain('"bad"')
})

test('seek rejects a non-finite time', async ({ page }) => {
  await openStoryboard(page, probe)
  const msg = await page.evaluate(() => window.__mba.seek(Number.NaN).then(() => 'resolved', (e: Error) => e.message))
  expect(msg).toMatch(/finite/)
})
