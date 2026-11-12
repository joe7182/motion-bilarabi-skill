import { describe, it, expect } from 'vitest'
import { MORPH_N, circle, lerpPts, resample, roundRect, type Pt } from '../../src/core/morph'
import { OBJECT_IDS, objectOutline } from '../../src/core/objects'
import { CURRENCIES, currencySign, parseCurrency } from '../../src/core/currency'

/** Indexed read that stays in range by construction (noUncheckedIndexedAccess). */
function at(a: readonly Pt[], i: number): Pt {
  return a[i] as Pt
}

function bbox(pts: Pt[]) {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

describe('resample', () => {
  const square: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

  it('returns 240 points equally spaced by arc length (±1 %)', () => {
    const out = resample(square)
    expect(MORPH_N).toBe(240)
    expect(out).toHaveLength(240)
    const d: number[] = []
    for (let i = 0; i < out.length; i++) {
      const a = at(out, i)
      const b = at(out, (i + 1) % out.length)
      d.push(Math.hypot(b[0] - a[0], b[1] - a[1]))
    }
    // 240 divides the perimeter (8) into 30-step edges, so corners land on samples: chords equal the step
    const step = 8 / 240
    for (const v of d) expect(Math.abs(v - step) / step).toBeLessThan(0.01)
  })

  it('starts at the point nearest 12 o\'clock and runs clockwise (screen, y down)', () => {
    const out = resample(square)
    expect(at(out, 0)[0]).toBeCloseTo(0, 6)
    expect(at(out, 0)[1]).toBeCloseTo(-1, 6)
    // clockwise on screen: the next point is to the right of the first
    expect(at(out, 1)[0]).toBeGreaterThan(at(out, 0)[0])
    // reversed input gives the same orientation
    const rev = resample([...square].reverse())
    expect(at(rev, 1)[0]).toBeGreaterThan(at(rev, 0)[0])
    expect(at(rev, 0)[1]).toBeCloseTo(-1, 6)
  })

  it('honours a custom n', () => {
    expect(resample(square, 12)).toHaveLength(12)
  })
})

describe('circle / roundRect / lerpPts', () => {
  it('circle has n points on the radius, first at the top', () => {
    const c = circle(10, 20, 5)
    expect(c).toHaveLength(240)
    expect(at(c, 0)[0]).toBeCloseTo(10, 9)
    expect(at(c, 0)[1]).toBeCloseTo(15, 9)
    for (const p of c) expect(Math.hypot(p[0] - 10, p[1] - 20)).toBeCloseTo(5, 9)
  })

  it('roundRect has 240 points inside its box', () => {
    const r = roundRect(0, 0, 100, 16, 8)
    expect(r).toHaveLength(240)
    const b = bbox(r)
    expect(b.maxX - b.minX).toBeGreaterThan(98)
    expect(b.maxX - b.minX).toBeLessThanOrEqual(100 + 1e-9)
    expect(b.maxY - b.minY).toBeGreaterThan(15.7)
  })

  it('lerpPts hits both ends exactly and the middle halfway', () => {
    const a = circle(0, 0, 10)
    const b = roundRect(0, 0, 30, 10, 3)
    expect(lerpPts(a, b, 0)).toEqual(a)
    expect(lerpPts(a, b, 1)).toEqual(b)
    const m = lerpPts(a, b, 0.5)
    expect(at(m, 7)[0]).toBeCloseTo((at(a, 7)[0] + at(b, 7)[0]) / 2, 12)
    expect(at(m, 7)[1]).toBeCloseTo((at(a, 7)[1] + at(b, 7)[1]) / 2, 12)
  })

  it('lerpPts throws an Arabic-first message on a length mismatch', () => {
    expect(() => lerpPts(circle(0, 0, 1, 10), circle(0, 0, 1, 12), 0.5)).toThrow(/^[؀-ۿ]/)
    expect(() => lerpPts(circle(0, 0, 1, 10), circle(0, 0, 1, 12), 0.5)).toThrow(' — ')
  })
})

describe('objectOutline', () => {
  it('has 240 points and a box ≈ size for every round object and the bar', () => {
    // Task 6b / 6c: the document, microphone, timeline and the script objects have their own boxes (tested below; Stage 2's in stage2-objects.test.ts).
    for (const id of OBJECT_IDS.filter((i) => !['document', 'microphone', 'timeline', 'calendar', 'envelope', 'bell', 'voice-note', 'phone-app', 'brick', 'house', 'blueprint', 'eye', 'photo', 'chat', 'scale', 'materials', 'room', 'window', 'sun-path', 'file', 'hard-hat', 'bulb', 'ai-chip', 'magnifier', 'follow', 'receipt', 'camera', 'heart', 'star', 'play', 'cart', 'book', 'megaphone', 'rocket'].includes(i))) {
      const o = objectOutline(id, 200)
      expect(o).toHaveLength(240)
      const b = bbox(o)
      expect((b.maxX - b.minX) / 200).toBeGreaterThan(0.98)
      expect((b.maxX - b.minX) / 200).toBeLessThan(1.02)
      expect(Math.abs((b.minX + b.maxX) / 2)).toBeLessThan(2)
      expect(Math.abs((b.minY + b.maxY) / 2)).toBeLessThan(2)
    }
  })

  it('bar is wide and thin, the rest are round', () => {
    const bar = bbox(objectOutline('bar', 200))
    expect((bar.maxY - bar.minY) / 200).toBeCloseTo(0.16, 1)
    const dot = bbox(objectOutline('dot', 200))
    expect(dot.maxY - dot.minY).toBeCloseTo(dot.maxX - dot.minX, 0)
  })

  it('rejects an unknown id with an Arabic-first message', () => {
    // @ts-expect-error deliberately invalid
    expect(() => objectOutline('nope', 10)).toThrow(/^[؀-ۿ].* — /)
  })
})

describe('Task 6b outlines: document, microphone, timeline', () => {
  /** Expected box (width, height) per unit size. */
  const BOX = { document: [1, 1.26], microphone: [0.6, 1], timeline: [1.5, 0.9] } as const

  it('the three new objects are known, have 240 points and their expected box (±2 %), centred', () => {
    for (const [id, [w, h]] of Object.entries(BOX)) {
      expect(OBJECT_IDS as readonly string[]).toContain(id)
      const o = objectOutline(id as keyof typeof BOX, 200)
      expect(o, id).toHaveLength(240)
      const b = bbox(o)
      expect(Math.abs((b.maxX - b.minX) / (200 * w) - 1), `${id} width`).toBeLessThanOrEqual(0.02)
      expect(Math.abs((b.maxY - b.minY) / (200 * h) - 1), `${id} height`).toBeLessThanOrEqual(0.02)
      expect(Math.abs((b.minX + b.maxX) / 2), `${id} centre x`).toBeLessThan(2)
      expect(Math.abs((b.minY + b.maxY) / 2), `${id} centre y`).toBeLessThan(2)
    }
  })

  it('every new outline starts at top-centre and runs clockwise (the morph contract)', () => {
    for (const [id, [, h]] of Object.entries(BOX)) {
      const o = objectOutline(id as keyof typeof BOX, 200)
      expect(at(o, 0)[0], id).toBeCloseTo(0, 6)
      expect(at(o, 0)[1], id).toBeCloseTo(-100 * h, 3)
      expect(at(o, 1)[0], id).toBeGreaterThan(at(o, 0)[0])
    }
  })

  it('the document has a folded top-left corner: no outline point near the sharp corner, the other corners rounded', () => {
    const o = objectOutline('document', 200)
    const x0 = -100, y0 = -126
    // the fold cuts the corner along x + y = x0 + y0 + fold (fold 0.18 × 200 = 36 px)
    expect(Math.min(...o.map(([x, y]) => x - x0 + (y - y0)))).toBeGreaterThan(30)
    // the top-right corner is rounded (radius 0.07 × 200 = 14 px): nothing within 3 px of its sharp corner
    expect(Math.min(...o.map(([x, y]) => Math.hypot(x - 100, y - y0)))).toBeGreaterThan(3)
  })
})

describe('Task 6c outlines: calendar, envelope, bell, voice-note, phone-app', () => {
  /** Expected box (width, height) per unit size. */
  const BOX = { calendar: [1, 1.1], envelope: [1.4, 0.9], bell: [0.7, 0.72], 'voice-note': [1.5, 0.42], 'phone-app': [0.56, 1.1] } as const
  type Id = keyof typeof BOX

  it('the five script objects are known, have 240 points and their expected box (±2 %), centred', () => {
    for (const [id, [w, h]] of Object.entries(BOX)) {
      expect(OBJECT_IDS as readonly string[]).toContain(id)
      const o = objectOutline(id as Id, 200)
      expect(o, id).toHaveLength(240)
      const b = bbox(o)
      expect(Math.abs((b.maxX - b.minX) / (200 * w) - 1), `${id} width`).toBeLessThanOrEqual(0.02)
      expect(Math.abs((b.maxY - b.minY) / (200 * h) - 1), `${id} height`).toBeLessThanOrEqual(0.02)
      expect(Math.abs((b.minX + b.maxX) / 2), `${id} centre x`).toBeLessThan(2)
      expect(Math.abs((b.minY + b.maxY) / 2), `${id} centre y`).toBeLessThan(2)
    }
  })

  it('every script outline starts at top-centre and runs clockwise (the morph contract)', () => {
    for (const [id, [, h]] of Object.entries(BOX)) {
      const o = objectOutline(id as Id, 200)
      expect(at(o, 0)[0], id).toBeCloseTo(0, 6)
      expect(at(o, 0)[1], id).toBeCloseTo(-100 * h, 3)
      expect(at(o, 1)[0], id).toBeGreaterThan(at(o, 0)[0])
    }
  })

  it('the bell flares: narrow at the dome, full width at the lip', () => {
    const o = objectOutline('bell', 200)
    const widthAt = (y: number) => {
      const xs = o.filter(([, py]) => Math.abs(py - y) < 3).map(([x]) => Math.abs(x))
      return 2 * Math.max(...xs)
    }
    expect(widthAt(-40) / 140).toBeLessThan(0.75)
    expect(widthAt(60) / 140).toBeGreaterThan(0.95)
  })

  it('the voice-note bubble has its tail at the top right (RTL): the top-right corner is sharp, the top-left rounded', () => {
    const o = objectOutline('voice-note', 200)
    // the tail tip reaches the box corner (150, -42); the left corners are rounded (nothing near (-150, -42))
    expect(Math.min(...o.map(([x, y]) => Math.hypot(x - 150, y + 42)))).toBeLessThan(3)
    expect(Math.min(...o.map(([x, y]) => Math.hypot(x + 150, y + 42)))).toBeGreaterThan(8)
  })
})

describe('Stage 1A outlines: brick, house, blueprint, eye, photo, chat', () => {
  /** Expected box (width, height) per unit size. */
  const BOX = { brick: [1, 0.62], house: [1, 0.9], blueprint: [1, 1.28], eye: [1, 0.56], photo: [0.9, 1.08], chat: [1.4, 1] } as const
  type Id = keyof typeof BOX
  const area = (o: Pt[]) => o.reduce((a, p, i) => a + p[0] * at(o, (i + 1) % o.length)[1] - at(o, (i + 1) % o.length)[0] * p[1], 0) / 2

  it('the six house-reel objects are known, have 240 points and fit their geometry box (±2 %), centred', () => {
    for (const [id, [w, h]] of Object.entries(BOX)) {
      expect(OBJECT_IDS as readonly string[]).toContain(id)
      const o = objectOutline(id as Id, 200)
      expect(o, id).toHaveLength(240)
      const b = bbox(o)
      expect(Math.abs((b.maxX - b.minX) / (200 * w) - 1), `${id} width`).toBeLessThanOrEqual(0.02)
      expect(Math.abs((b.maxY - b.minY) / (200 * h) - 1), `${id} height`).toBeLessThanOrEqual(0.02)
      expect(Math.abs((b.minX + b.maxX) / 2), `${id} centre x`).toBeLessThan(2)
      expect(Math.abs((b.minY + b.maxY) / 2), `${id} centre y`).toBeLessThan(2)
    }
  })

  it('every outline starts at top-centre (the topmost crossing of x = 0) and runs clockwise (the morph contract)', () => {
    for (const id of Object.keys(BOX) as Id[]) {
      const o = objectOutline(id, 200)
      expect(at(o, 0)[0], id).toBeCloseTo(0, 6)
      const topAtCentre = Math.min(...o.filter(([x]) => Math.abs(x) < 3).map(([, y]) => y))
      expect(at(o, 0)[1], id).toBeCloseTo(topAtCentre, 0)
      expect(at(o, 1)[0], id).toBeGreaterThan(at(o, 0)[0])
      expect(area(o), `${id} clockwise (positive area on screen)`).toBeGreaterThan(0)
    }
    // all but the house start at the box top; the house starts on its parapet (its stair tower is at the right)
    expect(at(objectOutline('house', 200), 0)[1]).toBeCloseTo(-0.28 * 200, 0)
    for (const id of ['brick', 'blueprint', 'eye', 'photo', 'chat'] as const) expect(at(objectOutline(id, 200), 0)[1], id).toBeCloseTo(-100 * BOX[id][1], 0)
  })

  it('the brick is a 3/4 hexagon: its top-left and bottom-right corners are cut away; the house has its tower at the right', () => {
    const brick = objectOutline('brick', 200)
    // nothing near the box's top-left (−100, −62) or bottom-right (100, 62) corners
    expect(Math.min(...brick.map(([x, y]) => Math.hypot(x + 100, y + 62)))).toBeGreaterThan(30)
    expect(Math.min(...brick.map(([x, y]) => Math.hypot(x - 100, y - 62)))).toBeGreaterThan(30)
    const house = objectOutline('house', 200)
    const topXs = house.filter(([, y]) => y < -80).map(([x]) => x)
    expect(Math.min(...topXs)).toBeGreaterThan(0)
  })

  it('the eye is an almond: pointed at its corners, widest at the middle', () => {
    const o = objectOutline('eye', 200)
    const heightAt = (x: number) => {
      const ys = o.filter(([px]) => Math.abs(px - x) < 2).map(([, y]) => y)
      return Math.max(...ys) - Math.min(...ys)
    }
    expect(heightAt(0)).toBeGreaterThan(108)
    expect(heightAt(90)).toBeLessThan(40)
  })
})

describe('currency signs', () => {
  it('AED is a D plus two bars, one unit tall', () => {
    const s = currencySign('AED')
    expect(s.strokes).toHaveLength(3)
    expect(s.closed).toEqual([true, false, false])
    const b = bbox(s.strokes.flat())
    expect(Math.abs(b.maxY - b.minY - 1)).toBeLessThanOrEqual(0.01)
    expect(Math.abs((b.minY + b.maxY) / 2)).toBeLessThan(0.01)
  })

  it('every currency has matching strokes/closed arrays and a unit-height box', () => {
    for (const c of CURRENCIES) {
      const s = currencySign(c)
      expect(s.strokes.length).toBeGreaterThan(0)
      expect(s.closed).toHaveLength(s.strokes.length)
      const b = bbox(s.strokes.flat())
      expect(Math.abs(b.maxY - b.minY - 1)).toBeLessThanOrEqual(0.01)
      for (const st of s.strokes) for (const p of st) expect(Number.isFinite(p[0] + p[1])).toBe(true)
    }
  })

  it('parseCurrency defaults, normalises and flags unknown codes', () => {
    expect(parseCurrency(undefined)).toEqual({ currency: 'AED' })
    expect(parseCurrency('sar')).toEqual({ currency: 'SAR' })
    expect(parseCurrency(' usd ')).toEqual({ currency: 'USD' })
    expect(parseCurrency('EUR')).toEqual({ currency: 'EUR' })
    expect(parseCurrency('xyz')).toEqual({ currency: 'AED', unknown: 'xyz' })
  })

  it('IQD: «د.ع» — a dal, the dot (closed) and an ain, inside the unit box; parsed case-insensitively', () => {
    expect(CURRENCIES).toContain('IQD')
    expect(parseCurrency('iqd')).toEqual({ currency: 'IQD' })
    expect(parseCurrency(' IqD ')).toEqual({ currency: 'IQD' })
    const s = currencySign('IQD')
    expect(s.strokes).toHaveLength(3)
    expect(s.closed).toEqual([false, true, false])
    const b = bbox(s.strokes.flat())
    expect(Math.abs(b.maxY - b.minY - 1)).toBeLessThanOrEqual(0.01)
    expect(Math.abs((b.minY + b.maxY) / 2)).toBeLessThan(0.01)
    expect(Math.abs((b.minX + b.maxX) / 2)).toBeLessThan(0.01)
    expect(b.maxX - b.minX).toBeLessThan(1.4)
    // read right → left: the dal on the right, the dot between, the ain on the left
    const cx = (st: Pt[]) => st.reduce((a, p) => a + p[0], 0) / st.length
    const [dal, dot, ain] = s.strokes as [Pt[], Pt[], Pt[]]
    expect(cx(dal)).toBeGreaterThan(cx(dot))
    expect(cx(dot)).toBeGreaterThan(cx(ain))
    const db = bbox(dot)
    expect(db.maxX - db.minX).toBeLessThan(0.12)
  })
})
