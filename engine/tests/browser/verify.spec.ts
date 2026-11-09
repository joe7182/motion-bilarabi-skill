import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defaultExtraTimes, verifyDeterminism } from '../../src/node/verify'
import { loadStoryboardFile } from '../../src/node/render'
import { diffPngs } from '../../src/node/png-diff'
import { openStoryboard } from './helpers'

// Node-side: verify starts its own Vite on a free port and its own Chromium. Slow (R5).
const ENGINE = fileURLToPath(new URL('../..', import.meta.url))
const FIXTURES = join(ENGINE, 'tests/fixtures')
const NONDET = join(FIXTURES, 'nondeterministic.json')
const TEST_PRIMS = join(FIXTURES, 'test-primitives.js')
const PAGEERROR = join(FIXTURES, 'pageerror.json')

test.describe.configure({ mode: 'serial', timeout: 180_000 })

async function testPrimitivesSource(): Promise<string> {
  const mod = (await import(pathToFileURL(TEST_PRIMS).href)) as { default: string }
  return mod.default
}

/** Runs the CLI with node + tsx directly (no shell), so Arabic/space paths pass through untouched. */
function cli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: ENGINE, encoding: 'utf8' })
}

const PASSING = {
  demo: join(ENGINE, 'examples/demo-ar.json'),
  slam: join(FIXTURES, 'slam.json'),
  wipe: join(FIXTURES, 'wipe.json'),
  search: join(FIXTURES, 'search.json'),
  mixed: join(FIXTURES, 'mixed.json'),
}

for (const [name, path] of Object.entries(PASSING)) {
  test(`verify passes on demo and every primitive fixture: ${name}`, async () => {
    const progress: [number, number][] = []
    const r = await verifyDeterminism({ storyboardPath: path, onProgress: (d, t) => progress.push([d, t]) })
    const sb = JSON.parse(await readFile(path, 'utf8')) as { scenes: unknown[] }
    // Scene samples plus the probes derived from the storyboard's transitions and hard cuts.
    const derived = defaultExtraTimes((await loadStoryboardFile(path)).sb)
    expect(r.probes).toHaveLength(sb.scenes.length * 5 + derived.length)
    expect(r.pageErrors).toEqual([])
    expect(r.mismatches).toEqual([])
    // Progress counts cold and warm probes.
    expect(progress.at(-1)).toEqual([r.probes.length * 2, r.probes.length * 2])
  })
}

test('probe times are start + f·duration for the first samplesPerScene fractions, then the hard-cut probes', async () => {
  const r = await verifyDeterminism({ storyboardPath: join(FIXTURES, 'probe.json'), samplesPerScene: 2 })
  // probe.json: a 0..1, b 1..2.5 (hard cut at 1, 30 fps); fractions 0.08, 0.3; then cut − 1/fps and cut.
  expect(r.probes.map((p) => p.sceneId)).toEqual(['a', 'a', 'b', 'b', 'a', 'b'])
  const ts = r.probes.map((p) => p.t)
  ;[0.08, 0.3, 1.12, 1.45, 1 - 1 / 30, 1].forEach((want, i) => expect(ts[i]).toBeCloseTo(want, 9))
  expect(r.mismatches).toEqual([])
})

test('explicit extraTimes replace the derived ones ([] = scene samples only)', async () => {
  const r = await verifyDeterminism({ storyboardPath: join(FIXTURES, 'probe.json'), samplesPerScene: 1, extraTimes: [] })
  expect(r.probes.map((p) => p.sceneId)).toEqual(['a', 'b'])
})

test('defaultExtraTimes: transition windows, hard cuts, clamped and deduped', async () => {
  const tr = (await loadStoryboardFile(join(FIXTURES, 'tr-color-wipe.json'))).sb
  // color-wipe at 2.0, default duration 0.4, 30 fps: at − d/4, at − 1/fps, at, at + 1/fps, at + d/4.
  const want = [1.9, 2 - 1 / 30, 2, 2 + 1 / 30, 2.1]
  const got = defaultExtraTimes(tr)
  expect(got).toHaveLength(want.length)
  want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 9))
  // Hard cuts (no transition): cut − 1/fps and cut; overlapping scenes are not cuts; clamped to [0, end].
  const sc = (id: string, start: number, duration: number) => ({ id, type: 'slam', start, duration, preroll: 0, params: {} })
  const base = { version: 1, format: '9:16', look: 'dark-tech', dir: 'rtl', seed: 1 } as const
  const cuts = defaultExtraTimes({ ...base, fps: 60, scenes: [sc('a', 0, 1), sc('b', 1, 1), sc('c', 2, 1), sc('d', 2.5, 0.5)] })
  const wantCuts = [1 - 1 / 60, 1, 2 - 1 / 60, 2]
  expect(cuts).toHaveLength(wantCuts.length)
  wantCuts.forEach((w, i) => expect(cuts[i]).toBeCloseTo(w, 9))
  // A transition window at the very start is clamped at 0 and deduped.
  const early = defaultExtraTimes({
    ...base,
    fps: 30,
    scenes: [sc('a', 0, 0.02), sc('b', 0.02, 1)],
    transitions: [{ type: 'color-wipe', at: 0.02, duration: 0.1, params: {} }],
  })
  // at − d/4 and at − 1/fps both clamp to 0 and collapse into one probe.
  const wantEarly = [0, 0.02, 0.045, 0.02 + 1 / 30]
  expect(early).toHaveLength(wantEarly.length)
  wantEarly.forEach((w, i) => expect(early[i]).toBeCloseTo(w, 9))
  // One scene: nothing to derive.
  expect(defaultExtraTimes((await loadStoryboardFile(join(FIXTURES, 'slam.json'))).sb)).toEqual([])
})

test('verify fails when the page logged errors while probing', async () => {
  const r = await verifyDeterminism({ storyboardPath: PAGEERROR, samplesPerScene: 5, testPrimitivesSource: await testPrimitivesSource() })
  expect(r.mismatches).toEqual([])
  expect(r.pageErrors.length).toBeGreaterThan(0)
  expect(r.pageErrors.join(' | ')).toContain('_pageerror boom')
})

test('the _nondet fixture really changes with seek history (guards the next test)', async ({ page }) => {
  const sb = JSON.parse(await readFile(NONDET, 'utf8'))
  await openStoryboard(page, sb, { testPrimitives: await testPrimitivesSource() })
  const countAt = (t: number) =>
    page.evaluate(async (tt) => {
      await window.__mba.seek(tt)
      return document.getElementById('nondet-count')?.textContent
    }, t)
  const first = await countAt(1.5)
  const second = await countAt(1.5)
  expect(first).not.toBe(second)
})

test('verify catches nondeterminism; only the mismatches are written as PNGs (cold and warm)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'mba-'))
  const mismatchDir = join(tmp, 'فحص 100%')
  try {
    const r = await verifyDeterminism({ storyboardPath: NONDET, testPrimitivesSource: await testPrimitivesSource(), mismatchDir })
    // 2 scenes × 5 samples + the hard cut at 1 s (cut − 1/fps, cut).
    expect(r.probes).toHaveLength(12)
    expect(r.probeBudget).toBe(60)
    expect(r.wallSec).toBeGreaterThan(0)
    expect(r.mismatches.length).toBeGreaterThanOrEqual(1)
    expect(r.mismatchDir).toBe(mismatchDir)
    // Only the _nondet scene drifts; the deterministic _probe scene before it never does.
    for (const m of r.mismatches) {
      expect(m.sceneId).toBe('drifty')
      expect(m.diffPixels).toBeGreaterThan(0)
      expect(m.maxChannelDelta).toBeGreaterThan(0)
      expect(m.maxChannelDelta).toBeLessThanOrEqual(255)
      // The PNGs on disk are the two frames compared.
      const d = diffPngs(await readFile(m.coldPng), await readFile(m.warmPng))
      expect(d).toEqual({ diffPixels: m.diffPixels, maxChannelDelta: m.maxChannelDelta })
    }
    const files = (await readdir(mismatchDir)).sort()
    expect(files).toEqual(r.mismatches.flatMap((m) => [basename(m.coldPng), basename(m.warmPng)]).sort())
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('the probe budget caps a long storyboard: cut probes kept, scenes sampled by duration', async () => {
  const r = await verifyDeterminism({ storyboardPath: join(FIXTURES, 'probe.json'), probeBudget: 4 })
  // probe.json: a 0..1, b 1..2.5, hard cut at 1 (one unit of 2 probes, kept whole) → 2 left: one
  // sample per scene, at its midpoint (budget-limited scenes use the midpoint first).
  expect(r.probes.map((p) => p.sceneId)).toEqual(['a', 'b', 'a', 'b'])
  expect(r.probes[0]!.t).toBeCloseTo(0.5, 9)
  expect(r.probes[1]!.t).toBeCloseTo(1.75, 9)
  expect(r.probes[2]!.t).toBeCloseTo(1 - 1 / 30, 9)
  expect(r.probes[3]!.t).toBeCloseTo(1, 9)
  expect(r.mismatches).toEqual([])
})

test('verify without test primitives rejects a storyboard that uses one', async () => {
  await expect(verifyDeterminism({ storyboardPath: NONDET, samplesPerScene: 1 })).rejects.toThrow(/_nondet/)
})

test.describe('cli verify exit codes and Arabic path', () => {
  let tmp: string
  let dir: string
  test.beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'mba-'))
    dir = join(tmp, 'مخرجات مراجعة')
    await mkdir(dir, { recursive: true })
  })
  test.afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('exit 0 on the demo', async () => {
    const sb = join(dir, 'sb.json')
    await copyFile(PASSING.demo, sb)
    const r = cli(['verify', sb])
    expect(r.status, r.stderr + r.stdout).toBe(0)
    const lines = r.stdout.trim().split('\n')
    expect(lines[0]).toMatch(/^التحقق من الحتمية/)
    // 3 scenes × 5 samples + 2 transitions × 5 derived probes (no hard cuts in the demo).
    expect(r.stdout).toContain('OK — 25 probes identical (25 probes of a budget of 60, ')
    expect(r.stderr).toContain('[50/50]')
  })

  test('exit 1 with the mismatch line on nondeterministic.json', async () => {
    const sb = join(dir, 'sb.json')
    await copyFile(NONDET, sb)
    const r = cli(['verify', sb, '--samples', '3', '--test-primitives', 'tests/fixtures/test-primitives.js'])
    expect(r.status, r.stderr + r.stdout).toBe(1)
    expect(r.stdout).toMatch(/^التحقق من الحتمية/)
    expect(r.stdout).toMatch(/scene drifty @ \d+(\.\d+)?s: \d+ px differ \(max Δ \d+\)/)
    // The mismatch PNGs are written and their paths printed.
    const cold = /^  cold: (.+\.png)$/m.exec(r.stdout)?.[1]
    const warm = /^  warm: (.+\.png)$/m.exec(r.stdout)?.[1]
    expect(cold && existsSync(cold), r.stdout).toBe(true)
    expect(warm && existsSync(warm), r.stdout).toBe(true)
    expect(r.stdout).toMatch(/\(\d+ probes of a budget of 60, \d+\.\d s\)/)
    await rm(dirname(cold!), { recursive: true, force: true })
    expect(r.stdout).not.toMatch(/scene steady/)
  })

  test('cli verify on a transition fixture probes the transition window and reports identical', async () => {
    const sb = join(dir, 'tr.json')
    await copyFile(join(FIXTURES, 'tr-color-wipe.json'), sb)
    const r = cli(['verify', sb])
    expect(r.status, r.stderr + r.stdout).toBe(0)
    // 2 scenes × 5 samples + 5 probes across the color-wipe window.
    expect(r.stdout).toContain('OK — 15 probes identical')
    expect(r.stderr).toContain('[30/30]')
  })

  test('exit 1 when the page logged errors while probing', async () => {
    const sb = join(dir, 'sb.json')
    await copyFile(PAGEERROR, sb)
    const r = cli(['verify', sb, '--test-primitives', 'tests/fixtures/test-primitives.js'])
    expect(r.status, r.stderr + r.stdout).toBe(1)
    expect(r.stdout).toMatch(/^التحقق من الحتمية/)
    expect(r.stdout).toMatch(/page error/i)
    expect(r.stdout).toContain('_pageerror boom')
  })

  test('usage errors exit 2 (missing --test-primitives file, bad --samples)', async () => {
    const sb = join(dir, 'sb.json')
    await copyFile(NONDET, sb)
    const missing = cli(['verify', sb, '--test-primitives', join(dir, 'لا يوجد.js')])
    expect(missing.status).toBe(2)
    expect(missing.stderr).toMatch(/[؀-ۿ].*—.*not found/)
    const bad = cli(['verify', sb, '--samples', '0'])
    expect(bad.status).toBe(2)
    expect(bad.stderr).toContain('--samples')
    const wrongCmd = cli(['still', sb, '--t', '0', '--samples', '2'])
    expect(wrongCmd.status).toBe(2)
  })
})
