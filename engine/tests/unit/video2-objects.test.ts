import { describe, it, expect } from 'vitest'
import type { Pt } from '../../src/core/morph'
import { hardHatTop, OBJECT_GEOMETRY, OBJECT_IDS, objectOutline, type ObjectId } from '../../src/core/objects'
import {
  AI_CHIP,
  beatCuesOf,
  buildSecOf,
  BULB,
  COMPASS,
  FOLLOW,
  HARD_HAT,
  MAGNIFIER,
  morphObjectParams,
  OBJECT_SIZE_CAP,
  RECEIPT,
  TOOL,
} from '../../src/core/params/morph-object'

const at = (a: readonly Pt[], i: number): Pt => a[i] as Pt
const bbox = (pts: Pt[]) => {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}
const area = (o: Pt[]) => o.reduce((a, p, i) => a + p[0] * at(o, (i + 1) % o.length)[1] - at(o, (i + 1) % o.length)[0] * p[1], 0) / 2

const NEW = ['hard-hat', 'bulb', 'ai-chip', 'tool', 'magnifier', 'follow', 'compass', 'receipt'] as const
const BOX: Record<(typeof NEW)[number], [number, number]> = {
  'hard-hat': [1.3, 1],
  bulb: [0.62, 1],
  'ai-chip': [1, 1],
  tool: [1, 1],
  magnifier: [1.2, 1],
  follow: [1.3, 0.8],
  compass: [1, 1],
  receipt: [0.75, 1.1],
}

describe('Video 2 outlines: hard-hat, bulb, ai-chip, tool, magnifier, follow, compass, receipt', () => {
  it('the new ids are appended to OBJECT_IDS in the brief order', () => {
    expect(OBJECT_IDS.slice(-8)).toEqual([...NEW])
  })

  it('each has 240 points, fits its geometry box (±2 %) and is centred', () => {
    for (const id of NEW) {
      const [w, h] = BOX[id]
      const o = objectOutline(id as ObjectId, 200)
      expect(o, id).toHaveLength(240)
      const b = bbox(o)
      expect(Math.abs((b.maxX - b.minX) / (200 * w) - 1), `${id} width`).toBeLessThanOrEqual(0.02)
      expect(Math.abs((b.maxY - b.minY) / (200 * h) - 1), `${id} height`).toBeLessThanOrEqual(0.02)
      expect(Math.abs((b.minX + b.maxX) / 2), `${id} centre x`).toBeLessThan(2)
      expect(Math.abs((b.minY + b.maxY) / 2), `${id} centre y`).toBeLessThan(2)
    }
  })

  it('each starts at top-centre (the box top at x = 0) and runs clockwise', () => {
    for (const id of NEW) {
      const [, h] = BOX[id]
      const o = objectOutline(id as ObjectId, 200)
      expect(at(o, 0)[0], id).toBeCloseTo(0, 6)
      expect(at(o, 0)[1], id).toBeCloseTo(-100 * h, 0)
      expect(at(o, 1)[0], id).toBeGreaterThan(at(o, 0)[0])
      expect(area(o), `${id} clockwise`).toBeGreaterThan(0)
    }
  })

  it('the engineers: the middle helmet is the highest, the side helmets lower, a flat bottom', () => {
    const g = OBJECT_GEOMETRY['hard-hat']
    expect(hardHatTop(0)).toBeCloseTo(-0.5, 6)
    const side = hardHatTop(g.heads[0]![0])
    expect(side).toBeGreaterThan(-0.35)
    expect(side).toBeLessThan(-0.2)
    expect(hardHatTop(0.65)).toBeGreaterThan(0.4)
    const o = objectOutline('hard-hat', 200)
    expect(o.filter(([, y]) => Math.abs(y - 100) < 0.5).length).toBeGreaterThan(30)
  })

  it('the bulb: a round globe on a narrow neck and base; the receipt has a zig-zag bottom', () => {
    const b = objectOutline('bulb', 200)
    const widthAt = (o: Pt[], y: number) => {
      const xs = o.filter(([, py]) => Math.abs(py - y) < 3).map(([x]) => x)
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(widthAt(b, -0.19 * 200)).toBeGreaterThan(0.6 * 200)
    expect(widthAt(b, 0.3 * 200)).toBeLessThan(0.32 * 200)
    const r = objectOutline('receipt', 200)
    const bottom = r.filter(([, y]) => y > 110 - OBJECT_GEOMETRY.receipt.tooth * 200 - 0.5)
    // the teeth: tips at the box bottom alternate with valleys
    expect(bottom.filter(([, y]) => y > 109).length).toBeGreaterThan(5)
    expect(bottom.filter(([, y]) => y < 110 - OBJECT_GEOMETRY.receipt.tooth * 200 + 1).length).toBeGreaterThan(5)
  })
})

describe('Video 2 timing and cues', () => {
  it('the brief defaults', () => {
    expect([...HARD_HAT.beats]).toEqual([0.5, 1.1])
    expect([...BULB.beats]).toEqual([0.3])
    expect([...AI_CHIP.beats]).toEqual([0.2])
    expect([...TOOL.beats]).toEqual([0.4])
    expect(TOOL.spinDeg).toBe(40)
    expect([...MAGNIFIER.beats]).toEqual([1.5])
    expect(MAGNIFIER.rowSec).toBe(0.35)
    expect(MAGNIFIER.zoom).toBe(1.6)
    expect(MAGNIFIER.checkSec).toBe(0.3)
    expect([...FOLLOW.beats]).toEqual([0.4])
    expect(FOLLOW.squash).toBe(0.9)
    expect([...COMPASS.beats]).toEqual([0.9])
    expect([...RECEIPT.beats]).toEqual([0.5])
    expect(RECEIPT.stampFrom).toBe(1.6)
    expect(buildSecOf('hard-hat')).toBe(0.5)
    expect(buildSecOf('ai-chip')).toBe(0.5)
    expect(buildSecOf('tool')).toBe(0.5)
    for (const id of ['bulb', 'magnifier', 'follow', 'compass', 'receipt'] as const) expect(buildSecOf(id), id).toBe(0.4)
    expect(OBJECT_SIZE_CAP['hard-hat']).toBeDefined()
    expect(OBJECT_SIZE_CAP.follow).toBeDefined()
  })

  it('the new objects parse in a morph state with beats', () => {
    const p = morphObjectParams.parse({ states: NEW.map((object, i) => ({ at: i, object, x: 0.5, y: 0.5, size: 0.4, beats: [0.3, 0.9] })) })
    expect(p.states.map((s) => s.object)).toEqual([...NEW])
  })

  it('cues: the huff pops, the bulb and the wrench tick, the check chimes, the follow pops, the stamp hits — only while the state shows', () => {
    const p = morphObjectParams.parse({
      states: [
        { at: 0, object: 'hard-hat', x: 0.5, y: 0.5, size: 0.5 },
        { at: 2, object: 'bulb', x: 0.5, y: 0.5, size: 0.4 },
        { at: 3, object: 'tool', x: 0.5, y: 0.5, size: 0.4 },
        { at: 4, object: 'magnifier', x: 0.5, y: 0.5, size: 0.5 },
        { at: 6.5, object: 'follow', x: 0.5, y: 0.5, size: 0.5 },
        { at: 7.5, object: 'compass', x: 0.5, y: 0.5, size: 0.4 },
        { at: 8.5, object: 'receipt', x: 0.5, y: 0.5, size: 0.4, beats: [0.2] },
      ],
    })
    expect(beatCuesOf(p, 0, 10)).toEqual([{ t: 1.1, kind: 'pop' }])
    expect(beatCuesOf(p, 1, 10)).toEqual([{ t: 2.3, kind: 'tick' }])
    expect(beatCuesOf(p, 2, 10)).toEqual([{ t: 3.4, kind: 'tick' }])
    expect(beatCuesOf(p, 3, 10)[0]!.t).toBeCloseTo(4 + 1.5 + MAGNIFIER.stopSec, 9)
    expect(beatCuesOf(p, 3, 10)[0]!.kind).toBe('final')
    expect(beatCuesOf(p, 4, 10)).toEqual([{ t: 6.9, kind: 'pop' }])
    expect(beatCuesOf(p, 5, 10)).toEqual([])
    expect(beatCuesOf(p, 6, 10)[0]!.t).toBeCloseTo(8.7 + RECEIPT.stampAfter + RECEIPT.stampSec, 9)
    // a beat after the next move starts is dropped
    const q = morphObjectParams.parse({ states: [{ at: 0, object: 'follow', x: 0.5, y: 0.5, size: 0.5, beats: [1] }, { at: 1.1, object: 'dot', x: 0.5, y: 0.5, size: 0.05 }] })
    expect(beatCuesOf(q, 0, 4)).toEqual([])
  })
})
