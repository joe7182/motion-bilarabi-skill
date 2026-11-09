import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDeterminism } from '../../src/node/verify'
import { loadStoryboardFile, openRenderPage } from '../../src/node/render'
import { diffPngs } from '../../src/node/png-diff'
import { buildReviewKit } from '../../src/node/review'

// The Arabic demo is what the product owner watches: it must pass our own quality tools.
// Node-side (own Vite + Chromium, ffmpeg). Slow (R5).
const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const DEMOS = {
  '9:16': join(ENGINE, 'examples/demo-ar.json'),
  '1:1': join(ENGINE, 'examples/demo-ar-1x1.json'),
} as const
const CUTS = [3.9, 5.75]
const FRAME = 1 / 30

test.describe.configure({ mode: 'serial', timeout: 180_000 })

let root: string
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-'))
})
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

test('both demos have the same content; only the format differs', async () => {
  const a = JSON.parse(await readFile(DEMOS['9:16'], 'utf8'))
  const b = JSON.parse(await readFile(DEMOS['1:1'], 'utf8'))
  expect(a.format).toBe('9:16')
  expect(b.format).toBe('1:1')
  expect({ ...b, format: '9:16' }).toEqual(a)
  expect(a.transitions.map((t: { type: string; at: number }) => [t.type, t.at])).toEqual([
    ['whip-pan', 3.9],
    ['color-wipe', 5.75],
  ])
})

for (const [format, path] of Object.entries(DEMOS)) {
  test(`demo ${format}: verify has 0 mismatches (incl. both transition windows)`, async () => {
    const extraTimes = CUTS.flatMap((c) => [c - 0.15, c - FRAME, c, c + FRAME, c + 0.15])
    const r = await verifyDeterminism({ storyboardPath: path, extraTimes })
    expect(r.probes.length).toBe(3 * 5 + extraTimes.length)
    expect(r.mismatches).toEqual([])
  })

  test(`demo ${format}: review — no audit issues, frame 0 not blank, no near-blank frames`, async () => {
    const m = await buildReviewKit({ storyboardPath: path, outDir: join(root, 'مخرجات مراجعة', format.replace(':', 'x')) })
    expect(m.format).toBe(format)
    expect(m.duration).toBeCloseTo(8, 6)
    expect(m.audit).not.toBeNull()
    expect(m.audit!.length).toBe(16) // 0, 0.5, ..., 7.5
    expect(m.audit!.flatMap((a) => a.issues.map((i) => `${a.t}: ${i.rule} ${i.text}`))).toEqual([])
    expect(m.frame0Blank).toBe(false)
    expect(m.nearBlankTimes).toEqual([])
  })
}

// Task 7 fix round 4: a hidden scene layer keeps what its primitive last wrote (search-typing's
// camera zoom after any seek into 2.0-3.75 s). While hidden layers stayed in layout and paint
// (visibility only), that stale state changed later frames of other scenes by 1-4 px (outro
// underline, slam): `mba verify` cold != warm. Hidden layers are now display: none.
test('demo 1:1: a frame after a seek into search-typing equals the cold frame (hidden layers are out of paint)', async () => {
  const loaded = await loadStoryboardFile(DEMOS['1:1'])
  const rp = await openRenderPage(loaded)
  try {
    const shot = () => rp.page.screenshot({ clip: { x: 0, y: 0, width: rp.size.w, height: rp.size.h }, type: 'png' })
    // Frames that differed before the fix (4.333/5.633 slam, 6.467/6.633/7.767 outro) and the probe
    // that failed in fix round 3 (7.82).
    const probes = [4.333333333333333, 5.633333333333334, 6.466666666666667, 6.633333333333334, 7.766666666666667, 7.82]
    const diffs: string[] = []
    const displays = new Set<string>()
    for (const t of probes) {
      await rp.reload()
      await rp.seek(t)
      const cold = await shot()
      await rp.reload()
      await rp.seek(2.5) // search-typing mid-zoom
      await rp.seek(t)
      const d = diffPngs(cold, await shot()).diffPixels
      if (d) diffs.push(`${t.toFixed(3)}: ${d} px`)
      const hidden = await rp.page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('#frame > [data-mba-scene], #frame > [data-mba-tr-overlay]')]
          .filter((el) => el.style.visibility === 'hidden')
          .map((el) => getComputedStyle(el).display),
      )
      expect(hidden.length).toBeGreaterThan(0)
      for (const d of hidden) displays.add(d)
    }
    expect(diffs).toEqual([])
    expect([...displays]).toEqual(['none'])
  } finally {
    await rp.close()
  }
})
