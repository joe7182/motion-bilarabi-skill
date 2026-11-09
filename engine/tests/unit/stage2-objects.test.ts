import { describe, it, expect } from 'vitest'
import type { Pt } from '../../src/core/morph'
import { BRICK_VARIANTS, brickVariantOf, OBJECT_GEOMETRY, OBJECT_IDS, objectOutline, type ObjectId } from '../../src/core/objects'
import {
  beatCuesOf,
  beatsOf,
  buildSecOf,
  cuesOfMorphObject,
  FILE,
  MATERIALS,
  morphObjectParams,
  OBJECT_SIZE_CAP,
  PIN,
  ROOM,
  SCALE,
  SUN_PATH,
  WINDOW,
  windowModeOf,
} from '../../src/core/params/morph-object'
import {
  BUILD_NUMBER,
  buildNumberLayout,
  buildNumberParams,
  buildNumberText,
  cuesOfBuildNumber,
  glyphBitmap,
  morphAtOf,
  timingIssueOfBuildNumber,
  travelSecOf,
} from '../../src/core/params/build-number'
import { validateSceneParams } from '../../src/core/params/index'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { parseStoryboard, StoryboardError } from '../../src/core/storyboard'
import { CUES } from '../../src/core/audio-plan'

const ARABIC_FIRST = /^[؀-ۿ]/
const at = (a: readonly Pt[], i: number): Pt => a[i] as Pt
const bbox = (pts: Pt[]) => {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}
const area = (o: Pt[]) => o.reduce((a, p, i) => a + p[0] * at(o, (i + 1) % o.length)[1] - at(o, (i + 1) % o.length)[0] * p[1], 0) / 2

describe('Stage 2 outlines: scale, materials, sun, room, pin, window, sun-path, file', () => {
  const BOX: Record<string, [number, number]> = { scale: [1.2, 1], materials: [1.1, 1], sun: [1, 1], room: [1.2, 0.9], pin: [1, 1], window: [0.9, 1.1], 'sun-path': [1.2, 1], file: [0.8, 1] }

  it('the new ids are appended to OBJECT_IDS in the brief order', () => {
    expect(OBJECT_IDS.slice(OBJECT_IDS.indexOf('scale'), OBJECT_IDS.indexOf('scale') + 8)).toEqual(['scale', 'materials', 'sun', 'room', 'pin', 'window', 'sun-path', 'file'])
  })

  it('each has 240 points, fits its geometry box (±2 %) and is centred', () => {
    for (const [id, [w, h]] of Object.entries(BOX)) {
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
    for (const [id, [, h]] of Object.entries(BOX)) {
      const o = objectOutline(id as ObjectId, 200)
      expect(at(o, 0)[0], id).toBeCloseTo(0, 6)
      expect(at(o, 0)[1], id).toBeCloseTo(-100 * h, 0)
      expect(at(o, 1)[0], id).toBeGreaterThan(at(o, 0)[0])
      expect(area(o), `${id} clockwise`).toBeGreaterThan(0)
    }
  })

  it('the scale is a beam with two hanging pans: wide at the pans, narrow at the post', () => {
    const o = objectOutline('scale', 200)
    const widthAt = (y: number) => {
      const xs = o.filter(([, py]) => Math.abs(py - y) < 3).map(([x]) => x)
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(widthAt(OBJECT_GEOMETRY.scale.pan.y * 200 + 2)).toBeGreaterThan(200)
    // the post alone between the pans and the base
    const mid = o.filter(([, y]) => Math.abs(y - 0.3 * 200) < 2).map(([x]) => x)
    expect(Math.max(...mid.map(Math.abs))).toBeLessThan(10)
  })

  it('the file folds its top-right corner; the sun-path dome is flat at the bottom', () => {
    const f = objectOutline('file', 200)
    expect(Math.min(...f.map(([x, y]) => Math.hypot(x - 80, y + 100)))).toBeGreaterThan(20)
    expect(Math.min(...f.map(([x, y]) => Math.hypot(x + 80, y + 100)))).toBeLessThan(5)
    const d = objectOutline('sun-path', 200)
    expect(d.filter(([, y]) => Math.abs(y - 100) < 0.5).length).toBeGreaterThan(30)
  })
})

describe('Stage 2 beats on a morph state', () => {
  const state = (beats: unknown) => ({ states: [{ at: 0, object: 'scale', x: 0.5, y: 0.5, size: 0.5, beats }] })

  it('accepts ascending non-negative beats (up to 8) and leaves them optional', () => {
    expect(morphObjectParams.parse(state([0.2, 0.2, 1.5])).states[0]!.beats).toEqual([0.2, 0.2, 1.5])
    expect(morphObjectParams.parse({ states: [{ at: 0, object: 'sun', x: 0.5, y: 0.5, size: 0.4 }] }).states[0]!.beats).toBeUndefined()
    expect(morphObjectParams.safeParse(state([0, 1, 2, 3, 4, 5, 6, 7])).success).toBe(true)
  })

  it('refuses unsorted, negative or too many beats, Arabic first', () => {
    for (const bad of [[1, 0.5], [-0.1, 1], [0, 1, 2, 3, 4, 5, 6, 7, 8]]) {
      const r = morphObjectParams.safeParse(state(bad))
      expect(r.success, JSON.stringify(bad)).toBe(false)
      if (!r.success) {
        expect(r.error.issues[0]!.message).toMatch(ARABIC_FIRST)
        expect(r.error.issues[0]!.message).toContain(' — ')
      }
    }
  })

  it('beatsOf fills the object defaults and keeps their spacing after a given beat', () => {
    expect(beatsOf(undefined, SCALE.beats)).toEqual([0.3, 1.2])
    expect(beatsOf([], SCALE.beats)).toEqual([0.3, 1.2])
    expect(beatsOf([0.5], SCALE.beats)).toEqual([0.5, 1.4])
    expect(beatsOf([0.5, 0.6], SCALE.beats)).toEqual([0.5, 0.6])
    expect(beatsOf([2], MATERIALS.beats).map((b) => +b.toFixed(3))).toEqual([2, 2.22, 2.44, 2.66, 3.48])
  })

  it('the brief defaults: scale 0.3 / 1.2, room 0.4 / 1.4, pin 0.25, window rays 1.2 and zero 0.2 / 1.0, file 0.4 / 1.4; build times', () => {
    expect([...SCALE.beats]).toEqual([0.3, 1.2])
    expect([...ROOM.beats]).toEqual([0.4, 1.4])
    expect([...PIN.beats]).toEqual([0.25])
    expect([...WINDOW.beats.rays]).toEqual([1.2])
    expect([...WINDOW.beats.zero]).toEqual([0.2, 1.0])
    expect(WINDOW.kwh).toBe(3.3)
    expect(WINDOW.kwhGlass).toBe(1.4)
    expect([...FILE.beats]).toEqual([0.4, 1.4])
    expect(SUN_PATH.beats).toHaveLength(2)
    expect(MATERIALS.beats).toHaveLength(5)
    expect(buildSecOf('scale')).toBe(0.6)
    expect(buildSecOf('sun')).toBe(0.8)
    expect(buildSecOf('room')).toBe(0.6)
    expect(OBJECT_SIZE_CAP.sun).toBeDefined()
    expect(windowModeOf('glass')).toBe('glass')
    expect(windowModeOf('zero')).toBe('zero')
    expect(windowModeOf(undefined)).toBe('rays')
    expect(windowModeOf('anything')).toBe('rays')
  })

  it('brick variants: the thermostone is ≈ 1.3× as wide; unknown text is the Iraqi brick', () => {
    expect(BRICK_VARIANTS.thermostone.sx).toBeCloseTo(1.3, 5)
    expect(BRICK_VARIANTS.gulf.sx).toBeGreaterThan(1)
    expect(brickVariantOf('measure')).toBe('measure')
    expect(brickVariantOf('fall')).toBe('iraqi')
    expect(brickVariantOf(undefined)).toBe('iraqi')
  })

  it('cues: the scale bills tick, each material pops, the pin pops, the stamp hits — only while the state shows', () => {
    const p = morphObjectParams.parse({
      states: [
        { at: 0, object: 'scale', x: 0.5, y: 0.5, size: 0.5 },
        { at: 2, object: 'materials', x: 0.5, y: 0.5, size: 0.5 },
        { at: 4, object: 'pin', x: 0.5, y: 0.5, size: 0.5 },
        { at: 5, object: 'file', x: 0.5, y: 0.5, size: 0.4, beats: [0.2, 0.5] },
      ],
    })
    expect(beatCuesOf(p, 0, 8)).toEqual([{ t: 0.3 + SCALE.dropSec, kind: 'tick' }])
    expect(beatCuesOf(p, 1, 8).map((c) => c.kind)).toEqual(['pop', 'pop', 'pop', 'pop'])
    expect(beatCuesOf(p, 2, 8)).toEqual([{ t: 4.25, kind: 'pop' }])
    expect(beatCuesOf(p, 3, 8)).toEqual([{ t: 5.2 + FILE.stampSec, kind: 'hit' }])
    // a beat after the next move starts is dropped
    const q = morphObjectParams.parse({ states: [{ at: 0, object: 'pin', x: 0.5, y: 0.5, size: 0.5, beats: [1] }, { at: 1.1, object: 'dot', x: 0.5, y: 0.5, size: 0.05 }] })
    expect(beatCuesOf(q, 0, 4)).toEqual([])
    expect(cuesOfMorphObject(p, { duration: 8 }).filter((c) => c.kind === 'hit')).toHaveLength(1)
  })
})

describe('build-number params', () => {
  const ok = (v: unknown) => buildNumberParams.safeParse(v)
  const msg = (v: unknown) => {
    const r = ok(v)
    return r.success ? '' : r.error.issues[0]!.message
  }

  it('parses with its defaults', () => {
    const p = buildNumberParams.parse({ value: '37,658' })
    expect(p).toMatchObject({ item: 'brick', entry: 'fall', scramble: false, at: { x: 0.5, y: 0.5 }, width: 0.9, fallFrom: 0, buildSec: 1.3 })
    expect(morphAtOf(p)).toBeCloseTo(1.3 + BUILD_NUMBER.morphAfter, 6)
  })

  it('takes digits, separators and question marks up to 11 characters; refuses anything else, Arabic first', () => {
    for (const v of ['37,658', '456', '؟؟٬؟؟؟٬؟؟؟', '?', '3.3', '95,000,000']) expect(ok({ value: v }).success, v).toBe(true)
    for (const v of ['', '123456789012', '٣٧', 'abc', '12 3', ',']) {
      expect(ok({ value: v }).success, v).toBe(false)
      expect(msg({ value: v }), v).toMatch(ARABIC_FIRST)
    }
  })

  it('refuses a morph before the build ends, flutter for bricks and a long label', () => {
    expect(msg({ value: '12', buildSec: 1.3, fallFrom: 0.5, morphAt: 1.7 })).toMatch(ARABIC_FIRST)
    expect(ok({ value: '12', buildSec: 1.3, fallFrom: 0.5, morphAt: 1.8 }).success).toBe(true)
    expect(msg({ value: '12', item: 'brick', entry: 'flutter' })).toMatch(ARABIC_FIRST)
    expect(ok({ value: '12', item: 'banknote', entry: 'flutter', from: { x: 0.5, y: 0.8 } }).success).toBe(true)
    expect(ok({ value: '12', label: 'طابوقة' }).success).toBe(true)
    expect(ok({ value: '12', label: 'ا'.repeat(17) }).success).toBe(false)
    expect(ok({ value: '12', buildSec: 0.2 }).success).toBe(false)
  })

  it('is a registered scene type with a timing check: the morph must finish inside the scene', () => {
    expect(PRIMITIVE_IDS).toContain('build-number')
    expect(CUES['build-number']).toBeDefined()
    const sb = (duration: number) => parseStoryboard({ version: 1, fps: 60, scenes: [{ id: 'n', type: 'build-number', start: 0, duration, params: { value: '456', item: 'cement-bag', buildSec: 1.2, morphAt: 1.9 } }] }, [...PRIMITIVE_IDS])
    expect(() => validateSceneParams(sb(2.4))).not.toThrow()
    let err: unknown
    try {
      validateSceneParams(sb(2.2))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StoryboardError)
    expect((err as Error).message).toMatch(/morphAt/)
    expect(timingIssueOfBuildNumber(buildNumberParams.parse({ value: '1', morphAt: 2 }), 2.2)).toBeDefined()
  })
})

describe('build-number layout', () => {
  it('bricks: 3 × 7 digits in running bond (half bricks at run ends on odd courses), Latin left-to-right order', () => {
    const p = buildNumberParams.parse({ value: '37,658' })
    const L = buildNumberLayout(p)
    expect(L.glyphs.map((g) => g.ch).join('')).toBe('37,658')
    for (let i = 1; i < L.glyphs.length; i++) expect(L.glyphs[i]!.x0).toBeGreaterThan(L.glyphs[i - 1]!.x1)
    expect(L.h).toBe(7)
    expect(glyphBitmap('8', 'brick', false)).toHaveLength(7)
    // the 8's middle course (from the bottom: 3, odd) is a full run of 3 cells → half, 2 whole, half
    const eight = L.items.filter((it) => it.glyph === 5 && it.row === 3)
    expect(eight.map((it) => it.w)).toEqual([1, 2, 2, 1])
    // the separator is one small item on the bottom course
    const sep = L.items.filter((it) => it.glyph === 2)
    expect(sep).toHaveLength(1)
    expect(sep[0]!.small).toBe(true)
    expect(sep[0]!.row).toBe(0)
  })

  it('cement sacks and bills: 3 × 5 cells; a single glyph is BIG (5 × 9)', () => {
    const c = buildNumberLayout(buildNumberParams.parse({ value: '456', item: 'cement-bag' }))
    expect(c.h).toBeCloseTo(5 * 1.3, 6)
    expect(c.items.every((it) => it.w === 1)).toBe(true)
    const q = buildNumberLayout(buildNumberParams.parse({ value: '؟', item: 'banknote', entry: 'flutter' }))
    expect(q.big).toBe(true)
    expect(q.h).toBe(9)
    expect(q.w).toBe(10)
    // the Arabic question mark is the Latin one mirrored
    const latin = glyphBitmap('?', 'banknote', true)
    expect(glyphBitmap('؟', 'banknote', true)).toEqual(latin.map((r) => [...r].reverse().join('')))
  })

  it('landings: bottom courses first, spread over [fallFrom + travel, fallFrom + buildSec]; pure', () => {
    const p = buildNumberParams.parse({ value: '2026', fallFrom: 0.5, buildSec: 1.5 })
    const L = buildNumberLayout(p)
    const byLand = [...L.items].sort((a, b) => a.land - b.land)
    for (let i = 1; i < byLand.length; i++) expect(byLand[i]!.row).toBeGreaterThanOrEqual(byLand[i - 1]!.row)
    expect(Math.min(...L.items.map((it) => it.land))).toBeCloseTo(0.5 + travelSecOf(p), 6)
    expect(Math.max(...L.items.map((it) => it.land))).toBeCloseTo(2.0, 6)
    for (const it of L.items) expect(it.start).toBeCloseTo(it.land - travelSecOf(p), 6)
    expect(buildNumberLayout(p)).toEqual(L)
  })

  it('scramble: digits and question marks roll every 0.08 s (seeded), separators stay; off → the value', () => {
    const p = buildNumberParams.parse({ value: '؟؟٬؟؟؟٬؟؟؟', item: 'banknote', scramble: true })
    const a = buildNumberText(p, 2.0)
    expect(a).toMatch(/^\d\d٬\d\d\d٬\d\d\d$/)
    expect(buildNumberText(p, 2.0 + 0.01)).toBe(a)
    expect(buildNumberText(p, 2.0 + 0.09)).not.toBe(a)
    expect(buildNumberText(buildNumberParams.parse({ value: '37,658' }), 2)).toBe('37,658')
  })

  it('cues: ticks in clusters (at most 8), a pop at the morph; bills fluttering get a whoosh', () => {
    const p = buildNumberParams.parse({ value: '37,658', fallFrom: 0.2, buildSec: 1.3, morphAt: 2 })
    const cues = cuesOfBuildNumber(p)
    const ticks = cues.filter((c) => c.kind === 'tick')
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks.length).toBeLessThanOrEqual(BUILD_NUMBER.maxTicks)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.t - ticks[i - 1]!.t).toBeGreaterThanOrEqual(BUILD_NUMBER.clusterSec - 1e-9)
    expect(cues.filter((c) => c.kind === 'pop')).toEqual([{ t: 2, kind: 'pop' }])
    const f = cuesOfBuildNumber(buildNumberParams.parse({ value: '؟', item: 'banknote', entry: 'flutter', morphAt: 2 }))
    expect(f.map((c) => c.kind)).toEqual(['whoosh', 'pop'])
  })
})
