import { describe, it, expect } from 'vitest'
import { CAMERA, cameraAt, cameraJitter, cameraToScreen, cameraTransform, poseAtDepth, screenToCamera, type CameraSpec } from '../../src/core/camera'
import { heroAt, heroParams, HERO } from '../../src/core/params/hero'
import { parseStoryboard, StoryboardError } from '../../src/core/storyboard'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { resolveAnchors } from '../../src/core/anchors'

const cam = (keys: CameraSpec['keys']): CameraSpec => ({ keys, fixedTracks: [0, 5] })

describe('cameraAt', () => {
  it('zoom interpolates in log space: 1 → 4 over 0..2 is 2 at t = 1 (linear and smooth)', () => {
    const lin = cam([{ at: 0, x: 0.5, y: 0.5, zoom: 1 }, { at: 2, x: 0.5, y: 0.5, zoom: 4, ease: 'linear' }])
    expect(cameraAt(lin, 1).zoom).toBeCloseTo(2, 12)
    const smooth = cam([{ at: 0, x: 0.5, y: 0.5, zoom: 1 }, { at: 2, x: 0.5, y: 0.5, zoom: 4 }])
    expect(cameraAt(smooth, 1).zoom).toBeCloseTo(Math.exp(Math.log(4) * 0.5), 12)
    expect(cameraAt(smooth, 1).zoom).toBeCloseTo(2, 12)
    // Smoothstep is slower than linear in the first half.
    expect(cameraAt(smooth, 0.5).zoom).toBeLessThan(cameraAt(lin, 0.5).zoom)
  })
  it('holds before the first and after the last key; x, y lerp on the eased parameter', () => {
    const c = cam([{ at: 1, x: 0.2, y: 0.3, zoom: 1.2 }, { at: 3, x: 0.6, y: 0.7, zoom: 2, ease: 'linear' }])
    expect(cameraAt(c, 0)).toEqual({ x: 0.2, y: 0.3, zoom: 1.2 })
    expect(cameraAt(c, -5)).toEqual({ x: 0.2, y: 0.3, zoom: 1.2 })
    expect(cameraAt(c, 3)).toEqual({ x: 0.6, y: 0.7, zoom: 2 })
    expect(cameraAt(c, 9)).toEqual({ x: 0.6, y: 0.7, zoom: 2 })
    const mid = cameraAt(c, 2)
    expect(mid.x).toBeCloseTo(0.4, 12)
    expect(mid.y).toBeCloseTo(0.5, 12)
  })
  it('a single key is a still camera', () => {
    expect(cameraAt(cam([{ at: 0, x: 0.5, y: 0.4, zoom: 1.4 }]), 7)).toEqual({ x: 0.5, y: 0.4, zoom: 1.4 })
  })
})

describe('cameraTransform', () => {
  const size = { w: 1080, h: 1920 }
  it('identity at the centre and zoom 1', () => {
    expect(cameraTransform({ x: 0.5, y: 0.5, zoom: 1 }, size)).toBe('translate(0px, 0px) scale(1)')
  })
  it('(0.25, 0.5) at zoom 2 lands the point at the frame centre', () => {
    expect(cameraTransform({ x: 0.25, y: 0.5, zoom: 2 }, size)).toBe('translate(0px, -960px) scale(2)')
  })
})

describe('storyboard camera', () => {
  const base = { version: 1, scenes: [{ id: 'a', type: 'slam', start: 0, duration: 2, params: { text: 'نص' } }] }
  it('defaults: x, y 0.5, ease smooth, fixedTracks [0, 5]', () => {
    const sb = parseStoryboard({ ...base, camera: { keys: [{ at: 0, zoom: 1 }] } }, [...PRIMITIVE_IDS])
    expect(sb.camera).toEqual({ keys: [{ at: 0, x: 0.5, y: 0.5, zoom: 1, ease: 'smooth' }], fixedTracks: [0, 5] })
  })
  it('refuses zoom outside 0.5..3, unsorted keys and no keys', () => {
    const bad = (camera: unknown) => () => parseStoryboard({ ...base, camera }, [...PRIMITIVE_IDS])
    expect(bad({ keys: [{ at: 0, zoom: CAMERA.maxZoom + 0.1 }] })).toThrow(StoryboardError)
    expect(bad({ keys: [{ at: 0, zoom: 0.4 }] })).toThrow(StoryboardError)
    expect(bad({ keys: [] })).toThrow(StoryboardError)
    expect(bad({ keys: [{ at: 2, zoom: 1 }, { at: 1, zoom: 1 }] })).toThrow(/camera\.keys\[1\]\.at/)
  })
  it('no camera: the field stays absent', () => {
    expect(parseStoryboard(base, [...PRIMITIVE_IDS]).camera).toBeUndefined()
  })
})

describe('heroAt', () => {
  const p = (o: Record<string, unknown> = {}) =>
    heroParams.parse({ path: [{ at: 0.5, x: 0.2, y: 0.2 }, { at: 2, x: 0.8, y: 0.7, squash: true }, { at: 4, x: 0.3, y: 0.9 }], ...o })
  const pts = [{ x: 200, y: 300 }, { x: 800, y: 1300 }, { x: 300, y: 1600 }]
  for (const spring of ['snappy', 'soft'] as const) {
    it(`${spring}: arrives exactly at each point at its at (< 0.5 px)`, () => {
      const hp = p({ spring })
      for (const [i, at] of [0.5, 2, 4].entries()) {
        const h = heroAt(hp, pts, at)
        expect(Math.abs(h.x - pts[i]!.x)).toBeLessThan(0.5)
        expect(Math.abs(h.y - pts[i]!.y)).toBeLessThan(0.5)
      }
    })
  }
  it('stays at the first point before its at, starts moving SPRING_LEAD before the next', () => {
    const hp = p()
    expect(heroAt(hp, pts, 0)).toEqual({ x: 200, y: 300, sx: 1, sy: 1 })
    expect(heroAt(hp, pts, 0.5)).toEqual({ x: 200, y: 300, sx: 1, sy: 1 })
    expect(heroAt(hp, pts, 2 - HERO.springLead - 0.01)).toMatchObject({ x: 200, y: 300 })
    expect(heroAt(hp, pts, 2 - HERO.springLead / 2).x).toBeGreaterThan(200)
  })
  it('squash on arrival: sy < 1 (sx > 1) at at + 0.05, back to 1 by at + 0.3; none without squash', () => {
    const hp = p()
    const h = heroAt(hp, pts, 2.05)
    expect(h.sy).toBeLessThan(1)
    expect(h.sx).toBeGreaterThan(1)
    expect(h.sy).toBeGreaterThanOrEqual(0.8 - 1e-9)
    expect(heroAt(hp, pts, 2.3)).toMatchObject({ sx: 1, sy: 1 })
    expect(heroAt(hp, pts, 4.05)).toMatchObject({ sx: 1, sy: 1 })
  })
  it('loop appends the first point at the scene end: it ends where it started', () => {
    const hp = p({ loop: true })
    const h = heroAt(hp, pts, 6, 6)
    expect(Math.abs(h.x - pts[0]!.x)).toBeLessThan(0.5)
    expect(Math.abs(h.y - pts[0]!.y)).toBeLessThan(0.5)
    // Without loop the hero rests on the last point.
    const still = heroAt(p(), pts, 6, 6)
    expect(Math.abs(still.x - pts[2]!.x)).toBeLessThan(0.5)
  })
  it('is pure: the same t gives the same pose', () => {
    const hp = p()
    expect(heroAt(hp, pts, 1.77)).toEqual(heroAt(hp, pts, 1.77))
  })
  it('params: defaults, a point needs x and y or a target, path at ascending', () => {
    const d = heroParams.parse({ path: [{ at: 0, x: 0.5, y: 0.5 }, { at: 1, target: 'w' }] })
    expect(d).toMatchObject({ shape: 'dot', size: 0.05, color: 'accent', spring: 'snappy', trail: false, loop: false })
    expect(heroParams.safeParse({ path: [{ at: 0, x: 0.5 }, { at: 1, x: 0.5, y: 0.5 }] }).success).toBe(false)
    expect(heroParams.safeParse({ path: [{ at: 0, x: 0.5, y: 0.5, target: 'w' }, { at: 1, x: 0.5, y: 0.5 }] }).success).toBe(false)
    expect(heroParams.safeParse({ path: [{ at: 0, x: 0.5, y: 0.5 }] }).success).toBe(false)
    expect(heroParams.safeParse({ path: [{ at: 1, x: 0.5, y: 0.5 }, { at: 1, x: 0.2, y: 0.5 }] }).success).toBe(false)
    expect(heroParams.safeParse({ size: 0.3, path: [{ at: 0, x: 0.5, y: 0.5 }, { at: 1, x: 0.2, y: 0.5 }] }).success).toBe(false)
  })
})

describe('cameraToScreen / screenToCamera (fix round 1)', () => {
  const size = { w: 1080, h: 1920 }
  it('matches cameraTransform: the camera point lands at the frame centre; identity at the centred zoom 1', () => {
    const cam = { x: 0.3, y: 0.5, zoom: 1.4 }
    expect(cameraToScreen(cam, size, { x: 0.3 * 1080, y: 960 })).toEqual({ x: 540, y: 960 })
    const p = cameraToScreen(cam, size, { x: 100, y: 200 })
    expect(p.x).toBeCloseTo(540 - 0.3 * 1080 * 1.4 + 140, 9)
    expect(p.y).toBeCloseTo(960 - 960 * 1.4 + 280, 9)
    const back = screenToCamera(cam, size, p)
    expect(back.x).toBeCloseTo(100, 9)
    expect(back.y).toBeCloseTo(200, 9)
    expect(cameraToScreen({ x: 0.5, y: 0.5, zoom: 1 }, size, { x: 12, y: 34 })).toEqual({ x: 12, y: 34 })
  })
})

describe('cameraJitter (Plan 3 Task 4)', () => {
  const still: CameraSpec = { keys: [{ at: 0, x: 0.5, y: 0.5, zoom: 1 }], fixedTracks: [0, 5] }
  it('no handheld and no shakes: exactly 0 at any t', () => {
    for (const t of [0, 0.5, 1.37, 7, 25]) expect(cameraJitter(still, t)).toEqual({ dx: 0, dy: 0, rot: 0 })
  })
  it('handheld: the brief formula, φ = 2πt/25, scaled by amp', () => {
    const t = 3.7
    const ph = (2 * Math.PI * t) / 25
    const j = cameraJitter({ ...still, handheld: { amp: 2 } }, t)
    expect(j.dx).toBeCloseTo(2 * (7 * Math.sin(2 * ph + 1.3) + 3 * Math.sin(5 * ph + 0.2)), 12)
    expect(j.dy).toBeCloseTo(2 * 6 * Math.sin(3 * ph + 0.4), 12)
    expect(j.rot).toBeCloseTo(2 * 0.0024 * Math.sin(2 * ph + 2.1), 15)
    const one = cameraJitter({ ...still, handheld: { amp: 1 } }, t)
    expect(one.dx).toBeCloseTo(j.dx / 2, 12)
  })
  it('a shake {at: 1, amp: 20}: 0 before 1, non-zero at 1.05, under 0.01 px at 1.7', () => {
    const c: CameraSpec = { ...still, shakes: [{ at: 1, amp: 20 }] }
    expect(cameraJitter(c, 0.99)).toEqual({ dx: 0, dy: 0, rot: 0 })
    const hit = cameraJitter(c, 1.05)
    expect(Math.hypot(hit.dx, hit.dy)).toBeGreaterThan(1)
    expect(hit.rot).not.toBe(0)
    const end = cameraJitter(c, 1.7)
    expect(Math.abs(end.dx)).toBeLessThan(0.01)
    expect(Math.abs(end.dy)).toBeLessThan(0.01)
    expect(Math.abs(end.rot)).toBeLessThan(0.01)
    // k = the shake's index: env·sin(2π·14d + k), 0.8·env·sin(2π·18.5d + 2k), 0.0009·env·sin(2π·11d + k).
    const two: CameraSpec = { ...still, shakes: [{ at: 5, amp: 3 }, { at: 1, amp: 20 }] }
    const d = 0.05
    const env = 20 * Math.exp(-9 * d)
    const j = cameraJitter(two, 1 + d)
    expect(j.dx).toBeCloseTo(env * Math.sin(2 * Math.PI * 14 * d + 1), 9)
    expect(j.dy).toBeCloseTo(0.8 * env * Math.sin(2 * Math.PI * 18.5 * d + 2), 9)
    expect(j.rot).toBeCloseTo(0.0009 * env * Math.sin(2 * Math.PI * 11 * d + 1), 12)
  })
})

describe('poseAtDepth (Plan 3 Task 4)', () => {
  it('({x: 0.6, y: 0.5, zoom: 1.4}, 0.3) = {x: 0.53, y: 0.5, zoom: 1.12}', () => {
    const p = poseAtDepth({ x: 0.6, y: 0.5, zoom: 1.4 }, 0.3)
    expect(p.x).toBeCloseTo(0.53, 12)
    expect(p.y).toBeCloseTo(0.5, 12)
    expect(p.zoom).toBeCloseTo(1.12, 12)
  })
  it('R18: zoom is clamped to CAMERA.minZoom (zoom 0.5 at depth 3 would be −0.5); conversions stay finite', () => {
    const p = poseAtDepth({ x: 0.5, y: 0.5, zoom: 0.5 }, 3)
    expect(p.zoom).toBe(CAMERA.minZoom)
    expect(p).toEqual({ x: 0.5, y: 0.5, zoom: CAMERA.minZoom })
    // At exactly 1/(1 − zoom) the raw zoom would be 0 (a divide by zero).
    expect(poseAtDepth({ x: 0.5, y: 0.5, zoom: 0.5 }, 2).zoom).toBe(CAMERA.minZoom)
    const size = { w: 1080, h: 1920 }
    for (const d of [2, 3]) {
      const back = screenToCamera(poseAtDepth({ x: 0.4, y: 0.6, zoom: 0.5 }, d), size, { x: 300, y: 700 }, { dx: 4 * d, dy: -3 * d, rot: 0.002 * d })
      expect(Number.isFinite(back.x) && Number.isFinite(back.y), JSON.stringify(back)).toBe(true)
    }
  })
  it('depth 1 is the pose itself; depth 0 the centred zoom 1', () => {
    expect(poseAtDepth({ x: 0.3, y: 0.7, zoom: 2 }, 1)).toEqual({ x: 0.3, y: 0.7, zoom: 2 })
    expect(poseAtDepth({ x: 0.3, y: 0.7, zoom: 2 }, 0)).toEqual({ x: 0.5, y: 0.5, zoom: 1 })
  })
})

describe('camera conversions with jitter and depth (Plan 3 Task 4)', () => {
  const size = { w: 1080, h: 1920 }
  /** Applies a `cameraTransform` string (transform-origin 0 0) to a point: what the browser draws. */
  const applyCss = (css: string, pt: { x: number; y: number }) => {
    const n = (s: string) => Number(s.replace(/px|rad/, ''))
    const ops = [...css.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)].map((m) => ({ op: m[1]!, args: m[2]!.split(',').map((s) => n(s.trim())) }))
    let { x, y } = pt
    for (const { op, args } of ops.reverse()) {
      if (op === 'scale') {
        x *= args[0]!
        y *= args[0]!
      } else if (op === 'translate') {
        x += args[0]!
        y += args[1]!
      } else {
        const c = Math.cos(args[0]!)
        const s = Math.sin(args[0]!)
        ;[x, y] = [c * x - s * y, s * x + c * y]
      }
    }
    return { x, y }
  }
  it('no jitter: the old transform string and the old maths', () => {
    const cam = { x: 0.3, y: 0.5, zoom: 1.4 }
    expect(cameraTransform(cam, size, { dx: 0, dy: 0, rot: 0 })).toBe(cameraTransform(cam, size))
    expect(cameraToScreen(cam, size, { x: 100, y: 200 }, { dx: 0, dy: 0, rot: 0 })).toEqual(cameraToScreen(cam, size, { x: 100, y: 200 }))
  })
  it('a depth-2 layer under a moving, shaking camera: cameraToScreen matches the CSS transform; screenToCamera inverts it', () => {
    const c: CameraSpec = {
      keys: [{ at: 0, x: 0.5, y: 0.5, zoom: 1 }, { at: 2, x: 0.6, y: 0.45, zoom: 1.3 }],
      fixedTracks: [5],
      handheld: { amp: 2 },
      shakes: [{ at: 1, amp: 25 }],
    }
    const t = 1.04
    const d = 2
    const pose = poseAtDepth(cameraAt(c, t), d)
    const j0 = cameraJitter(c, t)
    const j = { dx: j0.dx * d, dy: j0.dy * d, rot: j0.rot * d }
    expect(Math.abs(j.rot)).toBeGreaterThan(0.001)
    const css = cameraTransform(pose, size, j)
    expect(css).toMatch(/^translate\([^)]*\) rotate\([^)]*rad\) translate\([^)]*\) scale\([^)]*\)$/)
    for (const pt of [{ x: 0, y: 0 }, { x: 400, y: 900 }, { x: 1080, y: 1920 }]) {
      const s = cameraToScreen(pose, size, pt, j)
      const want = applyCss(css, pt)
      expect(Math.abs(s.x - want.x)).toBeLessThan(0.01)
      expect(Math.abs(s.y - want.y)).toBeLessThan(0.01)
      const back = screenToCamera(pose, size, s, j)
      expect(back.x).toBeCloseTo(pt.x, 9)
      expect(back.y).toBeCloseTo(pt.y, 9)
    }
    // Depth 2 moves a point further than depth 1 would (the parallax).
    const p1 = cameraToScreen(poseAtDepth(cameraAt(c, t), 1), size, { x: 100, y: 100 }, j0)
    const p2 = cameraToScreen(pose, size, { x: 100, y: 100 }, j)
    expect(Math.hypot(p2.x - 100, p2.y - 100)).toBeGreaterThan(1.5 * Math.hypot(p1.x - 100, p1.y - 100))
  })
})

describe('storyboard camera: handheld, shakes, depth (Plan 3 Task 4)', () => {
  const base = { version: 1, scenes: [{ id: 'a', type: 'slam', start: 0, duration: 2, params: { text: 'نص' } }] }
  const parse = (o: Record<string, unknown>) => parseStoryboard({ ...base, ...o }, [...PRIMITIVE_IDS])
  it('handheld amp defaults to 1; shakes parse; both stay absent when not given', () => {
    const sb = parse({ camera: { keys: [{ at: 0, zoom: 1 }], handheld: {}, shakes: [{ at: 1, amp: 20 }] } })
    expect(sb.camera?.handheld).toEqual({ amp: 1 })
    expect(sb.camera?.shakes).toEqual([{ at: 1, amp: 20 }])
    const plain = parse({ camera: { keys: [{ at: 0, zoom: 1 }] } })
    expect(plain.camera && 'handheld' in plain.camera).toBe(false)
    expect(plain.camera && 'shakes' in plain.camera).toBe(false)
  })
  it('refuses handheld amp outside 0..3 and shake amp outside 0..30', () => {
    expect(() => parse({ camera: { keys: [{ at: 0, zoom: 1 }], handheld: { amp: 3.1 } } })).toThrow(/camera\.handheld\.amp/)
    expect(() => parse({ camera: { keys: [{ at: 0, zoom: 1 }], shakes: [{ at: 1, amp: 31 }] } })).toThrow(/camera\.shakes\[0\]\.amp/)
    expect(() => parse({ camera: { keys: [{ at: 0, zoom: 1 }], shakes: [{ at: -1, amp: 3 }] } })).toThrow(StoryboardError)
  })
  it('scene depth: 0..3, absent stays absent; outside → schema error', () => {
    const scene = (depth: unknown) => ({ scenes: [{ ...base.scenes[0], depth }] })
    expect(parse(scene(0.3)).scenes[0]!.depth).toBe(0.3)
    expect(parse(scene(3)).scenes[0]!.depth).toBe(3)
    expect('depth' in parse(base).scenes[0]!).toBe(false)
    expect(() => parse(scene(3.5))).toThrow(/scenes\[0\]\.depth/)
    expect(() => parse(scene(-0.1))).toThrow(StoryboardError)
  })
  it('camera.shakes[i].at may be a word anchor (absolute seconds, like camera.keys)', () => {
    const transcript = {
      version: 1 as const,
      media: 'm1',
      sourceHash: 'x',
      model: 'ggml-small.bin',
      language: 'ar' as const,
      words: [
        { i: 0, text: 'أ', start: 0.2, end: 0.5, p: 0.9 },
        { i: 1, text: 'ب', start: 1.3, end: 1.6, p: 0.9 },
      ],
    }
    const r = resolveAnchors({ ...base, camera: { keys: [{ at: 0, zoom: 1 }], shakes: [{ at: { word: 1 }, amp: 12 }, { at: 0.5, amp: 3 }] } }, { transcript, fps: 30 })
    expect(r.used).toBe(true)
    expect((r.json as { camera: { shakes: unknown[] } }).camera.shakes).toEqual([{ at: 1.3, amp: 12 }, { at: 0.5, amp: 3 }])
  })
})
