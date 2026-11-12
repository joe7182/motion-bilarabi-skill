import { describe, expect, it } from 'vitest'
import { OBJECT_STEMS } from '../../src/core/keywords-ar'
import { OBJECT_GEOMETRY, OBJECT_IDS, objectOutline } from '../../src/core/objects'
import { EVERYDAY_GEOMETRY, EVERYDAY_IDS } from '../../src/core/objects-everyday'
import { morphObjectParams, beatCuesOf } from '../../src/core/params/morph-object'

const bbox = (pts: [number, number][]) => ({ w: Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), h: Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])), cx: (Math.max(...pts.map((p) => p[0])) + Math.min(...pts.map((p) => p[0]))) / 2 })
/** Twice the signed area: positive when the points run clockwise on screen (y down). */
const turn = (pts: [number, number][]) => pts.reduce((a, p, i) => a + (p[0] * pts[(i + 1) % pts.length]![1] - pts[(i + 1) % pts.length]![0] * p[1]), 0)

describe('everyday objects', () => {
  it('are known objects with a 240-point outline that fits its box, is centred, and runs clockwise from the top', () => {
    for (const id of EVERYDAY_IDS) {
      expect(OBJECT_IDS as readonly string[]).toContain(id)
      const o = objectOutline(id, 200)
      expect(o, id).toHaveLength(240)
      const b = bbox(o)
      const g = EVERYDAY_GEOMETRY[id]
      expect(b.w / 200, `${id} width`).toBeGreaterThan(g.w * 0.93)
      expect(b.w / 200, `${id} width`).toBeLessThan(g.w * 1.03)
      expect(b.h / 200, `${id} height`).toBeGreaterThan(g.h * 0.9)
      expect(b.h / 200, `${id} height`).toBeLessThan(g.h * 1.1)
      expect(Math.abs(b.cx), `${id} centred`).toBeLessThan(3)
      expect(turn(o), `${id} clockwise`).toBeGreaterThan(0)
      expect(Math.abs(o[0]![0]), `${id} starts at the top centre`).toBeLessThan(200 * 0.03)
      expect((OBJECT_GEOMETRY as Record<string, { w: number }>)[id]!.w).toBe(g.w)
    }
  })
  it('work as morph states and make one sound at their moment', () => {
    for (const id of EVERYDAY_IDS) {
      const p = morphObjectParams.parse({ states: [{ at: 0.1, object: id, x: 0.5, y: 0.5, size: 0.5 }] })
      const cues = beatCuesOf(p, 0, 3)
      expect(cues, id).toHaveLength(1)
      expect(cues[0]!.t).toBeCloseTo(0.6, 5)
    }
  })
  it('each has spoken words that call it', () => {
    for (const id of EVERYDAY_IDS) expect(OBJECT_STEMS.some((s) => s.object === id), id).toBe(true)
  })
})
