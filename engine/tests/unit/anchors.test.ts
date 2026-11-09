import { describe, it, expect } from 'vitest'
import { parseMarks, resolveAnchors } from '../../src/core/anchors'
import { StoryboardError } from '../../src/core/storyboard'
import type { Marks, Transcript } from '../../src/core/transcript'

const transcript: Transcript = {
  version: 1,
  media: 'm1',
  sourceHash: 'x',
  model: 'ggml-small.bin',
  language: 'ar',
  words: [
    { i: 0, text: 'مرحبا', start: 1.02, end: 1.4, p: 0.9 },
    { i: 1, text: 'بكم', start: 1.46, end: 1.8, p: 0.9 },
    { i: 2, text: 'جميعا', start: 2.51, end: 3.0, p: 0.9 },
  ],
}
const marks: Marks = { stress: [2], pauses: [{ after: 1, at: 1.81, gap: 0.7 }], unmatched: [] }
const ctx = { transcript, marks, fps: 30 }

const scene = (o: Record<string, unknown>) => ({ id: 'a', type: 'slam', start: 0, duration: 1, params: {}, ...o })
const sbOf = (...scenes: Record<string, unknown>[]) => ({ version: 1, scenes })
type Out = { scenes: { start: number; duration: number; params: Record<string, unknown> }[]; transitions?: { at: number }[]; audio?: { at: number }[] }
const resolve = (json: unknown, c: Parameters<typeof resolveAnchors>[1] = ctx) => resolveAnchors(json, c) as { json: Out; used: boolean }

function errorOf(fn: () => unknown): StoryboardError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(StoryboardError)
    return e as StoryboardError
  }
  throw new Error('expected a StoryboardError')
}

describe('resolveAnchors', () => {
  it('a word start snaps to the frame grid: 1.02 s at 30 fps → 31/30', () => {
    const r = resolve(sbOf(scene({ start: { word: 0 } })))
    expect(r.used).toBe(true)
    expect(r.json.scenes[0]!.start).toBe(31 / 30)
  })
  it('edge end with an offset: 1.4 − 0.1 → 1.3', () => {
    const r = resolve(sbOf(scene({ start: { word: 0, edge: 'end', offset: -0.1 } })))
    expect(r.json.scenes[0]!.start).toBeCloseTo(1.3, 10)
    expect(Math.abs(r.json.scenes[0]!.start * 30 - Math.round(r.json.scenes[0]!.start * 30))).toBeLessThan(1e-9)
  })
  it('duration {until: anchor} → anchor − start, a whole number of frames', () => {
    const r = resolve(sbOf(scene({ start: { word: 0 }, duration: { until: { word: 2 } } })))
    const { start, duration } = r.json.scenes[0]!
    // word 2 starts at 2.51 → frame 75 (2.5 s); start = frame 31.
    expect(duration).toBeCloseTo(75 / 30 - 31 / 30, 10)
    expect(Math.round((start + duration) * 30)).toBe(75)
    // A plain-number start works too.
    expect(resolve(sbOf(scene({ start: 0.5, duration: { until: { word: 2 } } }))).json.scenes[0]!.duration).toBeCloseTo(2, 10)
  })
  it('a pause resolves to marks.pauses[k].at, snapped (1.81 → frame 54 = 1.8)', () => {
    const r = resolve(sbOf(scene({ start: { pause: 0 } })))
    expect(r.json.scenes[0]!.start).toBe(54 / 30)
    expect(resolve(sbOf(scene({ start: { pause: 0, offset: 0.2 } }))).json.scenes[0]!.start).toBeCloseTo(2, 10)
  })
  it('transitions[].at and audio[].at take anchors; numbers are left untouched and used=false', () => {
    const r = resolve({ ...sbOf(scene({})), transitions: [{ type: 'cut', at: { word: 1 } }], audio: [{ kind: 'voice', media: 'm1', at: { pause: 0 } }] })
    expect(r.json.transitions![0]!.at).toBeCloseTo(44 / 30, 10)
    expect(r.json.audio![0]!.at).toBe(54 / 30)
    const plain = sbOf(scene({ start: 0.123, duration: 0.777 }))
    const p = resolve(plain)
    expect(p.used).toBe(false)
    expect(p.json).toEqual(plain)
  })
  it('is pure: the input is not mutated', () => {
    const input = sbOf(scene({ start: { word: 0 }, params: { words: [{ at: { word: 1 } }] } }))
    const copy = structuredClone(input)
    resolve(input)
    expect(input).toEqual(copy)
  })
  it('without anchors no transcript is needed', () => {
    expect(resolve(sbOf(scene({})), { fps: 30 }).used).toBe(false)
  })

  describe('errors carry the JSON path (Arabic first)', () => {
    it('word out of range', () => {
      const big = { ...transcript, words: Array.from({ length: 35 }, (_, i) => ({ i, text: 'و', start: i, end: i + 0.5, p: 1 })) }
      const json = sbOf(scene({}), scene({ id: 'b' }), scene({ id: 'c' }), scene({ id: 'd', start: { word: 40 } }))
      const e = errorOf(() => resolveAnchors(json, { transcript: big, fps: 30 }))
      expect(e.message).toBe('scenes[3].start: الكلمة 40 غير موجودة، التفريغ فيه 35 كلمة — word 40 does not exist; the transcript has 35 words')
      expect(e.path).toBe('scenes[3].start')
    })
    it('an anchor without a transcript', () => {
      const e = errorOf(() => resolveAnchors(sbOf(scene({ start: { word: 0 } })), { fps: 30 }))
      expect(e.message).toBe('scenes[0].start: لا يوجد تفريغ؛ شغّل mba transcribe — no transcript; run mba transcribe')
    })
    it('a pause without marks, and a pause out of range', () => {
      expect(errorOf(() => resolveAnchors(sbOf(scene({ start: { pause: 0 } })), { transcript, fps: 30 })).message).toMatch(/^scenes\[0\]\.start: .+ — no marks\.json/)
      expect(errorOf(() => resolve(sbOf(scene({ start: { pause: 3 } })))).message).toMatch(/^scenes\[0\]\.start: .+ — pause 3 does not exist; marks\.json has 1 pause/)
    })
    it('a negative result', () => {
      const e = errorOf(() => resolve(sbOf(scene({ start: { word: 0, offset: -2 } }))))
      expect(e.path).toBe('scenes[0].start')
      expect(e.message).toMatch(/^scenes\[0\]\.start: .+ — the anchor resolves to a negative time \(-0\.98/)
      expect(errorOf(() => resolve({ ...sbOf(scene({})), transitions: [{ type: 'cut', at: { word: 0, offset: -5 } }] })).path).toBe('transitions[0].at')
    })
    it('until before (or at) the start', () => {
      const e = errorOf(() => resolve(sbOf(scene({ start: { word: 2 }, duration: { until: { word: 0 } } }))))
      expect(e.path).toBe('scenes[0].duration')
      expect(e.message).toMatch(/^scenes\[0\]\.duration: .+ — until \(1\.0333 s\) is not after the scene start \(2\.5 s\)/)
      expect(errorOf(() => resolve(sbOf(scene({ start: { word: 1 }, duration: { until: { word: 1 } } })))).path).toBe('scenes[0].duration')
    })
    it('malformed anchors', () => {
      expect(errorOf(() => resolve(sbOf(scene({ start: { word: 1.5 } })))).path).toBe('scenes[0].start')
      expect(errorOf(() => resolve(sbOf(scene({ start: { word: 0, edge: 'middle' } })))).message).toMatch(/edge/)
      expect(errorOf(() => resolve(sbOf(scene({ start: { word: 0, extra: 1 } })))).message).toMatch(/extra/)
      expect(errorOf(() => resolve(sbOf(scene({ start: { word: 0, pause: 0 } })))).path).toBe('scenes[0].start')
      expect(errorOf(() => resolve(sbOf(scene({ duration: { until: 'x' } })))).path).toBe('scenes[0].duration.until')
      expect(resolve(sbOf(scene({ start: 0.5, duration: { until: 3 } }))).json.scenes[0]!.duration).toBe(2.5)
      // A bare anchor is not a length.
      expect(errorOf(() => resolve(sbOf(scene({ duration: { word: 2 } })))).message).toMatch(/until/)
    })
  })

  describe('R3: params `at` fields (deep) become scene-local seconds', () => {
    it('words[].at and items[].at, nested in objects and arrays', () => {
      const params = {
        words: [{ text: 'مرحبا', at: { word: 0 } }, { text: 'بكم', at: { word: 1, edge: 'end' } }, { text: 'ثابت', at: 0.25 }],
        group: { items: [{ at: { pause: 0 } }], deep: [[{ at: { word: 2 } }]] },
      }
      const r = resolve(sbOf(scene({ start: 1, duration: 3, params })))
      const p = r.json.scenes[0]!.params as typeof params
      expect(r.used).toBe(true)
      expect(p.words[0]!.at).toBeCloseTo(1 / 30, 10) // 31/30 − 1
      expect(p.words[1]!.at).toBeCloseTo(24 / 30, 10) // 1.8 → frame 54 → 54/30 − 1
      expect(p.words[2]!.at).toBe(0.25) // numbers are already scene-local
      expect(p.group.items[0]!.at).toBeCloseTo(24 / 30, 10) // 54/30 − 1
      expect(p.group.deep[0]![0]!.at as unknown as number).toBeCloseTo(1.5, 10) // 75/30 − 1
      expect(p.words[0]!.text).toBe('مرحبا')
    })
    it('relative to the resolved (anchored) scene start', () => {
      const r = resolve(sbOf(scene({ start: { word: 0 }, params: { items: [{ at: { word: 2 } }] } })))
      expect((r.json.scenes[0]!.params.items as { at: number }[])[0]!.at).toBeCloseTo(44 / 30, 10)
    })
    it('a negative scene-local time is a StoryboardError with the full path', () => {
      const json = sbOf(scene({}), scene({}), scene({ start: 2, params: { words: [{ at: 0 }, { at: { word: 0 } }] } }))
      const e = errorOf(() => resolve(json))
      expect(e.path).toBe('scenes[2].params.words[1].at')
      expect(e.message).toMatch(/^scenes\[2\]\.params\.words\[1\]\.at: .+ — .*before the scene start/)
    })
    it('an out-of-range word in params names the full path', () => {
      const e = errorOf(() => resolve(sbOf(scene({ params: { items: [{ at: { word: 9 } }] } }))))
      expect(e.message).toBe('scenes[0].params.items[0].at: الكلمة 9 غير موجودة، التفريغ فيه 3 كلمة — word 9 does not exist; the transcript has 3 words')
    })
  })
})

describe('camera keys (Plan 2a+ Task 6)', () => {
  const four: Transcript = { ...transcript, words: [...transcript.words, { i: 3, text: 'هنا', start: 3.2, end: 3.5, p: 0.9 }] }
  it('camera.keys[1].at = { word: 3 } resolves to that word start (absolute, on the frame grid)', () => {
    const json = { ...sbOf(scene({ start: 1, duration: 4 })), camera: { keys: [{ at: 0, zoom: 1 }, { at: { word: 3 }, zoom: 1.4 }] } }
    const r = resolveAnchors(json, { ...ctx, transcript: four }) as { json: { camera: { keys: { at: number; zoom: number }[] } }; used: boolean }
    expect(r.used).toBe(true)
    expect(r.json.camera.keys[1]!.at).toBeCloseTo(96 / 30, 10) // 3.2 s = frame 96
    expect(r.json.camera.keys[0]!.at).toBe(0)
    expect(r.json.camera.keys[1]!.zoom).toBe(1.4)
  })
  it('a bad camera anchor names its path', () => {
    const e = errorOf(() => resolve({ ...sbOf(scene({})), camera: { keys: [{ at: { word: 9 }, zoom: 1 }] } }))
    expect(e.path).toBe('camera.keys[0].at')
  })
})

describe('parseMarks', () => {
  it('accepts marks.json and refuses a malformed file', () => {
    // R11 + fix wave I2: marks written before Task 10 have no sections, before the fix wave no display; parsing fills [].
    expect(parseMarks(marks)).toEqual({ ...marks, sections: [], display: [], stops: [] })
    expect(parseMarks({ ...marks, sections: [{ title: 'أ', word: 1 }] }).sections).toEqual([{ title: 'أ', word: 1 }])
    expect(() => parseMarks({ stress: [], pauses: [{ after: 0 }] })).toThrow(/marks/)
  })
})
