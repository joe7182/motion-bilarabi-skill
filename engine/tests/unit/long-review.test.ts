import { describe, it, expect } from 'vitest'
import type { Storyboard } from '../../src/core/storyboard'
import { FrameSlicer, buildStillsArgs } from '../../src/node/frames'
import { SHEET_PAGE_TILES, paginate, sheetPageName } from '../../src/node/sheets'
import { REVIEW_METRIC_KEYS } from '../../src/node/review'
import { DEFAULT_PROBE_BUDGET, allocateSamples, planProbes, verifyProbes, extraProbes, defaultExtraTimes, defaultExtraUnits, selectUnits } from '../../src/node/verify'
import { rng } from '../../src/core/rng'
import { MAX_RUNS_PER_CALL, extractGroups, toRuns } from '../../src/node/framesrv'

/** The old implementation: join every chunk, then slice whole frames. */
function concatSlices(chunks: Buffer[], n: number): Uint8Array[] {
  const all = Buffer.concat(chunks)
  const out: Uint8Array[] = []
  for (let off = 0; off + n <= all.length; off += n) out.push(new Uint8Array(all.buffer, all.byteOffset + off, n).slice())
  return out
}

describe('FrameSlicer (streamed decode)', () => {
  it('gives the same frames as concatenating stdout, for any chunk boundaries', () => {
    const rand = rng(7)
    for (const frameBytes of [1, 7, 9216]) {
      const total = frameBytes * 23 + Math.floor(frameBytes / 2) // a trailing partial frame is dropped
      const data = Buffer.alloc(total)
      for (let i = 0; i < total; i++) data[i] = Math.floor(rand() * 256)
      const chunks: Buffer[] = []
      for (let off = 0; off < total; ) {
        const len = Math.min(total - off, 1 + Math.floor(rand() * frameBytes * 2.5))
        chunks.push(data.subarray(off, off + len))
        off += len
      }
      const s = new FrameSlicer(frameBytes)
      const got: Uint8Array[] = []
      for (const c of chunks) got.push(...s.push(c))
      const want = concatSlices(chunks, frameBytes)
      expect(got.length).toBe(23)
      expect(got).toEqual(want)
      expect(s.remainder).toBe(total - 23 * frameBytes)
    }
  })

  it('frames it returns are copies (a reused stdout buffer cannot change them)', () => {
    const s = new FrameSlicer(4)
    const buf = Buffer.from([1, 2, 3, 4, 5, 6])
    const [f] = s.push(buf)
    buf.fill(0)
    expect([...f!]).toEqual([1, 2, 3, 4])
    const [g] = s.push(Buffer.from([7, 8]))
    expect([...g!]).toEqual([5, 6, 7, 8])
  })
})

describe('buildStillsArgs (seek per chunk)', () => {
  it('seeks half a frame before the chunk\'s first frame and selects indices relative to it', () => {
    const a = buildStillsArgs('C:/in 100%/v.mp4', [300, 301, 330, 359], 30, 360, 'out/s%05d.png')
    const i = a.indexOf('-i')
    expect(a.slice(i - 2, i)).toEqual(['-ss', String(299.5 / 30)])
    expect(a[i + 1]).toBe('C:/in 100%/v.mp4')
    const vf = a[a.indexOf('-vf') + 1]!
    expect(vf).toBe("select='eq(n\\,0)+eq(n\\,1)+eq(n\\,30)+eq(n\\,59)',scale=360:-2:flags=lanczos")
    expect(a).toContain('-frames:v')
    expect(a[a.indexOf('-frames:v') + 1]).toBe('4')
    expect(a.at(-1)).toBe('out/s%05d.png')
  })
  it('no -ss for a chunk that starts at frame 0; no scale without a width', () => {
    const a = buildStillsArgs('v.mp4', [0, 5], 30, undefined, 'p.png')
    expect(a).not.toContain('-ss')
    expect(a[a.indexOf('-vf') + 1]).toBe("select='eq(n\\,0)+eq(n\\,5)'")
  })
})

describe('frame server: a sparse set is extracted in groups of at most MAX_RUNS_PER_CALL runs', () => {
  it('340 audit frames 15 apart (one review of 170 s) → 9 calls of <= 40 runs, in order, nothing lost', () => {
    const sparse = Array.from({ length: 340 }, (_, k) => 15 * k)
    const g = extractGroups(sparse)
    expect(MAX_RUNS_PER_CALL).toBe(40)
    expect(g.map((x) => x.length)).toEqual([40, 40, 40, 40, 40, 40, 40, 40, 20])
    expect(g.flat()).toEqual(sparse)
  })
  it('contiguous runs never split; a dense chunk is one call', () => {
    const dense = Array.from({ length: 300 }, (_, k) => 600 + k)
    expect(extractGroups(dense)).toEqual([dense])
    const mixed = [0, 1, 2, 10, 11, 20, 30, 31, 32]
    const g = extractGroups(mixed, 2)
    expect(g).toEqual([[0, 1, 2, 10, 11], [20, 30, 31, 32]])
    for (const x of g) expect(toRuns(x).length).toBeLessThanOrEqual(2)
    expect(extractGroups([])).toEqual([])
  })
})

describe('sheet pagination', () => {
  it('at most 60 tiles per page; contact.jpg, contact-2.jpg, …', () => {
    expect(SHEET_PAGE_TILES).toBe(60)
    expect(paginate([], 60)).toEqual([])
    expect(paginate([1, 2, 3], 60)).toEqual([[1, 2, 3]])
    const pages = paginate(Array.from({ length: 341 }, (_, k) => k), 60)
    expect(pages.map((p) => p.length)).toEqual([60, 60, 60, 60, 60, 41])
    expect(pages.flat()).toEqual(Array.from({ length: 341 }, (_, k) => k))
    expect(sheetPageName('contact', 1)).toBe('contact.jpg')
    expect(sheetPageName('contact', 2)).toBe('contact-2.jpg')
    expect(sheetPageName('phone', 3)).toBe('phone-3.jpg')
  })
  it('metrics.json lists the sheets', () => {
    expect(REVIEW_METRIC_KEYS).toContain('sheets')
  })
})

const sc = (id: string, start: number, duration: number, track = 0) => ({ id, type: 'slam', start, duration, preroll: 0, track, params: {} })
const base = { version: 1, format: '9:16', look: 'dark-tech', dir: 'rtl', seed: 1, fps: 30 } as const
const sbOf = (scenes: ReturnType<typeof sc>[]) => ({ ...base, scenes }) as unknown as Storyboard

describe('verify probe budget', () => {
  it('default budget is 60', () => {
    expect(DEFAULT_PROBE_BUDGET).toBe(60)
  })

  it('under budget: exactly the old probes (scene samples, then cut/transition probes)', () => {
    const sb = sbOf([sc('a', 0, 1), sc('b', 1, 1.5)])
    const old = [...verifyProbes(sb, 5), ...extraProbes(sb, defaultExtraTimes(sb))]
    expect(planProbes(sb, {})).toEqual(old)
    expect(planProbes(sb, { samplesPerScene: 2, extraTimes: [] })).toEqual(verifyProbes(sb, 2))
  })

  it('allocateSamples: proportional to duration (D\'Hondt), at least 1 each when the budget allows, capped', () => {
    expect(allocateSamples([10, 10, 10], 5, 15)).toEqual([5, 5, 5])
    expect(allocateSamples([10, 10, 10], 5, 100)).toEqual([5, 5, 5])
    expect(allocateSamples([1, 1, 18], 5, 7)).toEqual([1, 1, 5])
    expect(allocateSamples([2, 2, 16], 5, 6)).toEqual([1, 1, 4])
    expect(allocateSamples([3, 1, 2], 5, 2)).toEqual([1, 0, 1]) // fewer than scenes: the longest
    expect(allocateSamples([3, 3], 5, 0)).toEqual([0, 0])
    for (const budget of [0, 1, 5, 26, 28, 40, 130, 200]) {
      const d = Array.from({ length: 26 }, (_, k) => (k < 17 ? 10 : 2.5))
      const a = allocateSamples(d, 5, budget)
      expect(a.reduce((x, y) => x + y, 0)).toBe(Math.min(budget, 130))
      for (const x of a) expect(x).toBeLessThanOrEqual(5)
    }
  })

  it('over budget: cut probes first, then scene samples proportional to duration; total <= budget', () => {
    // 17 back-to-back 10 s scenes (16 hard cuts) + 9 short scenes on track 1.
    const scenes = [
      ...Array.from({ length: 17 }, (_, k) => sc(`v${k}`, k * 10, 10)),
      ...Array.from({ length: 9 }, (_, k) => sc(`s${k}`, k * 20, 2.5, 1)),
    ]
    const sb = sbOf(scenes)
    // Every cut is on track 0, so its probes name the track-0 scene (Task 8), not a caption above it.
    const extras = extraProbes(sb, defaultExtraTimes(sb), () => 0)
    expect(extras).toHaveLength(32)
    expect(extras).toContainEqual({ sceneId: 'v2', t: 20 })
    expect(extraProbes(sb, [20])).toEqual([{ sceneId: 's1', t: 20 }])
    const p = planProbes(sb, {})
    expect(p.length).toBe(60)
    // Every cut probe is kept.
    for (const e of extras) expect(p).toContainEqual(e)
    // Every scene is visited at least once; long scenes get at least as many as short ones.
    const per = new Map<string, number>()
    for (const x of p.slice(0, 60 - 32)) per.set(x.sceneId, (per.get(x.sceneId) ?? 0) + 1)
    for (const s of scenes) expect(per.get(s.id) ?? 0, s.id).toBeGreaterThanOrEqual(1)
    expect(Math.min(...scenes.filter((s) => s.duration === 10).map((s) => per.get(s.id)!))).toBeGreaterThanOrEqual(
      Math.max(...scenes.filter((s) => s.duration === 2.5).map((s) => per.get(s.id)!)),
    )
    expect(planProbes(sb, { probeBudget: 200 }).length).toBe(17 * 5 + 9 * 5 + 32)
  })

  it('R9: 30 hard cuts at budget 60 — whole cut pairs, spread over the video, scenes still sampled', () => {
    // 31 scenes of 6 s (186 s), 30 hard cuts = 60 cut probes: alone they would fill the budget.
    const sb = sbOf(Array.from({ length: 31 }, (_, k) => sc(`v${k}`, k * 6, 6)))
    const units = defaultExtraUnits(sb)
    expect(units).toHaveLength(30)
    const p = planProbes(sb, {})
    expect(p).toHaveLength(60)
    const cutTimes = new Set(units.flat().map((t) => Math.round(t * 1e6)))
    const cutProbes = p.filter((x) => cutTimes.has(Math.round(x.t * 1e6)))
    const samples = p.filter((x) => !cutTimes.has(Math.round(x.t * 1e6)))
    // Scene floor: min(31 scenes, 20 % of 60) = 12 reserved, so 24 whole cut units fit.
    expect(samples.length).toBeGreaterThanOrEqual(12)
    expect(cutProbes.length).toBe(48)
    // Every chosen cut keeps BOTH its probes (cut − 1/fps and cut).
    const cuts = [...new Set(cutProbes.map((x) => Math.round(x.t / 6) * 6))] // the cut each probe belongs to
    for (const c of cuts) {
      expect(cutProbes.some((x) => Math.abs(x.t - c) < 1e-9), `cut ${c}`).toBe(true)
      expect(cutProbes.some((x) => Math.abs(x.t - (c - 1 / 30)) < 1e-9), `cut ${c} − 1/fps`).toBe(true)
    }
    expect(cuts).toHaveLength(24)
    // Spread over the whole duration: first and last cut kept, no gap more than twice the average.
    const sorted = [...cuts].sort((x, y) => x - y)
    expect(sorted[0]).toBeCloseTo(6, 9)
    expect(sorted.at(-1)).toBeCloseTo(180, 9)
    const avg = (sorted.at(-1)! - sorted[0]!) / (sorted.length - 1)
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeLessThanOrEqual(2 * avg + 1e-9)
    // Budget-limited scenes use the midpoint first.
    for (const x of samples) {
      const s = Math.floor(x.t / 6) * 6
      expect((x.t - s) / 6).toBeCloseTo(0.5, 9)
    }
  })

  it('R9: a transition keeps its whole window of 5', () => {
    const scenes = Array.from({ length: 20 }, (_, k) => sc(`v${k}`, k * 5, 5))
    const sb = { ...sbOf(scenes), transitions: Array.from({ length: 19 }, (_, k) => ({ type: 'color-wipe', at: (k + 1) * 5, duration: 0.4, params: {} })) } as unknown as Storyboard
    const units = defaultExtraUnits(sb)
    expect(units).toHaveLength(19)
    expect(units.every((u) => u.length === 5)).toBe(true)
    const p = planProbes(sb, { probeBudget: 30 })
    expect(p.length).toBeLessThanOrEqual(30)
    const kept = units.filter((u) => u.some((t) => p.some((x) => Math.abs(x.t - t) < 1e-9)))
    for (const u of kept) for (const t of u) expect(p.some((x) => Math.abs(x.t - t) < 1e-9), `window time ${t}`).toBe(true)
    expect(kept.length).toBe(4) // floor 6 (20 % of 30) → 24 left → 4 windows of 5
    expect(p.length - kept.length * 5).toBeGreaterThanOrEqual(6)
  })

  it('selectUnits: evenly spaced whole units within the capacity', () => {
    const units = Array.from({ length: 10 }, (_, k) => [k, k + 0.1])
    expect(selectUnits(units, 100)).toHaveLength(10)
    const pick = selectUnits(units, 8)
    expect(pick.map((u) => u[0])).toEqual([0, 3, 6, 9])
    expect(selectUnits(units, 1)).toEqual([])
  })

  it('rejects a budget below 1', () => {
    expect(() => planProbes(sbOf([sc('a', 0, 1)]), { probeBudget: 0 })).toThrow(/probeBudget/)
  })
})
