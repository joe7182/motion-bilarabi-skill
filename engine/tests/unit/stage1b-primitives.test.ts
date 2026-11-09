import { describe, it, expect } from 'vitest'
import { validateSceneParams } from '../../src/core/params/index'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { parseStoryboard, StoryboardError } from '../../src/core/storyboard'
import { planSfx } from '../../src/core/audio-plan'
import { safeRect } from '../../src/core/types'
import { mediaSceneOf } from '../../src/core/media-scenes'
import {
  cuesOfScreenClip,
  SCREEN_CLIP,
  screenClipDrift,
  screenClipEdges,
  screenClipFocusAt,
  screenClipFrameAt,
  screenClipLastFrame,
  screenClipLayout,
  screenClipParams,
  screenClipPose,
  screenClipReveal,
  screenClipView,
  sourceToBody,
} from '../../src/core/params/screen-clip'
import {
  activeIndexAt,
  cuesOfNumberedSlots,
  NUMBERED_SLOTS,
  numberedSlotsParams,
  slotAppearAt,
  slotEmphasis,
  slotNumeral,
} from '../../src/core/params/numbered-slots'

const sb = (scenes: unknown[]) => parseStoryboard({ version: 1, fps: 60, scenes }, [...PRIMITIVE_IDS])
const errOf = (fn: () => unknown): StoryboardError | undefined => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(StoryboardError)
    return e as StoryboardError
  }
  return undefined
}
const ARABIC_FIRST = /^[؀-ۿ]/

describe('screen-clip params', () => {
  const base = { media: 'm2', in: 7 }
  const scene = (params: unknown, duration = 4) => [{ id: 's', type: 'screen-clip', start: 0, duration, params }]

  it('defaults: speed 1, not still, centre, 0.94 wide, media aspect, chrome on, tilt in, exit, no focus / scan / pins', () => {
    expect(screenClipParams.parse(base)).toEqual({
      media: 'm2',
      in: 7,
      speed: 1,
      still: false,
      at: { x: 0.5, y: 0.5 },
      width: 0.94,
      chrome: {},
      enter: 'tilt',
      exit: true,
      focus: [],
      reveal: 'none',
      revealSec: 0.9,
      callouts: [],
      marks: [],
      clicks: [],
    })
    expect(screenClipParams.parse({ ...base, chrome: false }).chrome).toBe(false)
    expect(screenClipParams.parse({ ...base, chrome: { url: 'claude.ai/house' } }).chrome).toEqual({ url: 'claude.ai/house' })
  })

  it('limits: 6 callouts, 6 marks, 4 clicks, 12 focus keys; labels ≤ 18, url ≤ 40; scale 1..6; marks inside the image', () => {
    const c = { at: 1, x: 0.5, y: 0.5, label: 'درج' }
    expect(screenClipParams.safeParse({ ...base, callouts: Array(6).fill(c) }).success).toBe(true)
    const many = screenClipParams.safeParse({ ...base, callouts: Array(7).fill(c) })
    expect(many.success).toBe(false)
    expect(many.error!.issues[0]!.message).toMatch(ARABIC_FIRST)
    expect(screenClipParams.safeParse({ ...base, callouts: [{ ...c, label: 'ا'.repeat(19) }] }).success).toBe(false)
    expect(screenClipParams.safeParse({ ...base, callouts: [{ ...c, x: 1.2 }] }).success).toBe(false)
    expect(screenClipParams.safeParse({ ...base, marks: Array(7).fill({ at: 0, x: 0, y: 0, w: 0.1, h: 0.1 }) }).success).toBe(false)
    expect(screenClipParams.safeParse({ ...base, clicks: Array(5).fill({ at: 0, x: 0, y: 0 }) }).success).toBe(false)
    expect(screenClipParams.safeParse({ ...base, focus: Array(13).fill({ t: 0, x: 0.5, y: 0.5, scale: 1 }) }).success).toBe(false)
    expect(screenClipParams.safeParse({ ...base, chrome: { url: 'x'.repeat(41) } }).success).toBe(false)
    const small = screenClipParams.safeParse({ ...base, focus: [{ t: 0, x: 0.5, y: 0.5, scale: 0.8 }] })
    expect(small.success).toBe(false)
    expect(small.error!.issues[0]!.message).toMatch(ARABIC_FIRST)
    const out = screenClipParams.safeParse({ ...base, marks: [{ at: 0, x: 0.9, y: 0.1, w: 0.2, h: 0.1 }] })
    expect(out.success).toBe(false)
    expect(out.error!.issues[0]!.message).toMatch(ARABIC_FIRST)
    expect(screenClipParams.parse({ ...base, marks: [{ at: 0, x: 0.8, y: 0.1, w: 0.2, h: 0.1 }] }).marks[0]!.style).toBe('box')
    expect(screenClipParams.safeParse({ ...base, width: 0.2 }).success).toBe(false)
    expect(screenClipParams.safeParse({ ...base, speed: 5 }).success).toBe(false)
  })

  it('scene timing: a callout / mark / click / focus key at or past the scene end is refused at its path, Arabic first', () => {
    expect(() => validateSceneParams(sb(scene({ ...base, callouts: [{ at: 3.9, x: 0.1, y: 0.1, label: 'كراج' }] })))).not.toThrow()
    const e = errOf(() => validateSceneParams(sb(scene({ ...base, callouts: [{ at: 4, x: 0.1, y: 0.1, label: 'كراج' }] }))))
    expect(e!.path).toBe('scenes[0].params.callouts[0].at')
    expect(e!.message).toMatch(/^scenes\[0\]\.params\.callouts\[0\]\.at: [؀-ۿ]/)
    expect(errOf(() => validateSceneParams(sb(scene({ ...base, focus: [{ t: 5, x: 0.5, y: 0.5, scale: 1.2 }] }))))!.path).toBe('scenes[0].params.focus[0].t')
    expect(errOf(() => validateSceneParams(sb(scene({ ...base, clicks: [{ at: 4.5, x: 0.5, y: 0.5 }] }))))!.path).toBe('scenes[0].params.clicks[0].at')
  })

  it('frames: a still shows the frame at in for the whole scene; a clip maps like video and clamps to its last frame', () => {
    const still = screenClipParams.parse({ ...base, still: true })
    for (const t of [0, 0.5, 3.99]) expect(screenClipFrameAt(still, t, 4, 60)).toBe(420)
    expect(screenClipLastFrame(still, 4, 60)).toBe(420)
    const clip = screenClipParams.parse({ media: 'm2', in: 14.5 })
    expect(screenClipFrameAt(clip, 0, 4, 60)).toBe(870)
    expect(screenClipFrameAt(clip, 1, 4, 60)).toBe(930)
    expect(screenClipLastFrame(clip, 4, 60)).toBe(1109)
    expect(screenClipFrameAt(clip, 9, 4, 60)).toBe(1109)
    // Node treats video and screen-clip the same way.
    const m = mediaSceneOf({ type: 'screen-clip', params: { media: 'm2', in: 7, still: true } })!
    expect([m.media, m.still, m.frameAt(2, 4, 60), m.lastFrame(4, 60)]).toEqual(['m2', true, 420, 420])
    expect(mediaSceneOf({ type: 'video', params: { media: 'm1', in: 1 } })!.frameAt(0.5, 1, 30)).toBe(45)
    expect(mediaSceneOf({ type: 'slam', params: {} })).toBeUndefined()
  })

  it('view: scale 1 covers the body (portrait body on a landscape source: full height); zoom divides; clamped inside the image', () => {
    const src = 1440 / 1080
    const v1 = screenClipView({ x: 0.5, y: 0.5, scale: 1 }, src, 0.75)
    expect(v1.h).toBeCloseTo(1, 9)
    expect(v1.w).toBeCloseTo(0.75 / src, 9)
    expect(v1.x).toBeCloseTo((1 - v1.w) / 2, 9)
    // Landscape body on the same source: the whole image.
    expect(screenClipView({ x: 0.2, y: 0.9, scale: 1 }, src, src)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    // The plan: x 0.14 cannot be centred at 1.1 (half width 0.256) → clamped to the left edge.
    const plan = screenClipView({ x: 0.14, y: 0.51, scale: 1.1 }, src, 0.75)
    expect(plan.x).toBe(0)
    expect(plan.w).toBeCloseTo(0.75 / src / 1.1, 9)
    expect(plan.h).toBeCloseTo(1 / 1.1, 9)
    expect(plan.y + plan.h / 2).toBeCloseTo(0.51, 9)
    // A source point maps to body px through the view (the centre of the view is the body centre).
    const c = sourceToBody(plan, 832, 1109, plan.x + plan.w / 2, plan.y + plan.h / 2)
    expect(c.x).toBeCloseTo(416, 6)
    expect(c.y).toBeCloseTo(554.5, 6)
    for (let x = 0; x <= 1; x += 0.25) {
      for (let y = 0; y <= 1; y += 0.25) {
        const v = screenClipView({ x, y, scale: 2.5 }, src, 0.75)
        expect(v.x).toBeGreaterThanOrEqual(0)
        expect(v.y).toBeGreaterThanOrEqual(0)
        expect(v.x + v.w).toBeLessThanOrEqual(1 + 1e-12)
        expect(v.y + v.h).toBeLessThanOrEqual(1 + 1e-12)
      }
    }
  })

  it('focus: spring tracks between keys (the first key rests); drift pans ≤ 1 % and creeps the zoom', () => {
    expect(screenClipFocusAt([], 3)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
    const keys = [
      { t: 0, x: 0.5, y: 0.5, scale: 1 },
      { t: 1, x: 0.3, y: 0.6, scale: 1.4 },
    ]
    expect(screenClipFocusAt(keys, 0.5)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
    const mid = screenClipFocusAt(keys, 1.2)
    expect(mid.scale).toBeGreaterThan(1)
    expect(mid.scale).toBeLessThan(1.4)
    expect(screenClipFocusAt(keys, 6).scale).toBeCloseTo(1.4, 3)
    // Unsorted keys give the same track.
    expect(screenClipFocusAt([...keys].reverse(), 1.2)).toEqual(mid)
    const f = { x: 0.5, y: 0.5, scale: 1 }
    for (const t of [0, 1, 2, 4]) {
      const d = screenClipDrift(f, 0.3, t, 4)
      expect(Math.hypot(d.x - 0.5, d.y - 0.5)).toBeLessThanOrEqual(0.01)
      expect(d.scale).toBeCloseTo(1 + SCREEN_CLIP.driftZoom * (t / 4), 12)
    }
    expect(screenClipDrift(f, 0.3, 2, 4)).toEqual({ x: 0.5, y: 0.5, scale: 1 + SCREEN_CLIP.driftZoom / 2 })
  })

  it('layout: width × safe width, body = width / aspect, plus the bar; a window leaving the safe area is refused (Arabic first)', () => {
    const safe = safeRect('9:16')
    const plan = screenClipLayout(screenClipParams.parse({ ...base, aspect: 0.75 }), 1440 / 1080, safe, 1080)
    expect('box' in plan).toBe(true)
    if (!('box' in plan)) return
    expect(plan.box.w).toBe(Math.floor(0.94 * safe.w))
    expect(plan.box.bodyH).toBe(Math.round(plan.box.w / 0.75))
    expect(plan.box.bar).toBe(SCREEN_CLIP.barPx)
    expect(plan.box.h).toBe(plan.box.bodyH + SCREEN_CLIP.barPx)
    expect(plan.box.y).toBeGreaterThanOrEqual(safe.y)
    expect(plan.box.y + plan.box.h).toBeLessThanOrEqual(safe.y + safe.h)
    // Without chrome there is no bar.
    const bare = screenClipLayout(screenClipParams.parse({ ...base, chrome: false }), 1440 / 1080, safe, 1080)
    expect('box' in bare && bare.box.bar).toBe(0)
    // Too tall: aspect 0.6 at full width.
    const tall = screenClipLayout(screenClipParams.parse({ ...base, aspect: 0.6 }), 1440 / 1080, safe, 1080)
    expect('issue' in tall && tall.issue.path).toEqual(['aspect'])
    expect('issue' in tall && tall.issue.ar).toMatch(ARABIC_FIRST)
    // Fits in size but not at this position.
    const off = screenClipLayout(screenClipParams.parse({ ...base, at: { x: 0.2, y: 0.5 } }), 1440 / 1080, safe, 1080)
    expect('issue' in off && off.issue.path).toEqual(['at'])
  })

  it('pose: tilt from 18° / 0.9 / transparent to rest over 0.5 s, held, then back over the last 0.35 s; rise; none', () => {
    const tilt = screenClipParams.parse(base)
    const p0 = screenClipPose(tilt, 0, 4)
    expect(p0.rot).toBeCloseTo(SCREEN_CLIP.tiltDeg, 9)
    expect(p0.scale).toBeCloseTo(SCREEN_CLIP.scaleFrom, 9)
    expect(p0.opacity).toBe(0)
    expect(screenClipPose(tilt, 0.5, 4)).toEqual({ rot: 0, scale: 1, rise: 0, opacity: 1 })
    expect(screenClipPose(tilt, 2, 4)).toEqual({ rot: 0, scale: 1, rise: 0, opacity: 1 })
    const late = screenClipPose(tilt, 3.9, 4)
    expect(late.rot).toBeGreaterThan(0)
    expect(late.opacity).toBeLessThan(1)
    expect(screenClipPose(tilt, 4, 4).opacity).toBe(0)
    expect(screenClipEdges(tilt, 4)).toEqual({ enter: 0.5, exit: 0.35 })
    expect(screenClipEdges(tilt, 0.5)).toEqual({ enter: 0.2, exit: 0.15 })
    const rise = screenClipPose(screenClipParams.parse({ ...base, enter: 'rise' }), 0.05, 4)
    expect(rise.rot).toBe(0)
    expect(rise.rise).toBeGreaterThan(0)
    const none = screenClipParams.parse({ ...base, enter: 'none', exit: false })
    for (const t of [0, 2, 4]) expect(screenClipPose(none, t, 4)).toEqual({ rot: 0, scale: 1, rise: 0, opacity: 1 })
  })

  it('scan: 0 until revealLead, 1 after revealSec; always 1 without a scan', () => {
    const p = screenClipParams.parse({ ...base, reveal: 'scan' })
    expect(screenClipReveal(p, 0.2)).toBe(0)
    expect(screenClipReveal(p, SCREEN_CLIP.revealLead + 0.45)).toBeCloseTo(0.5, 9)
    expect(screenClipReveal(p, SCREEN_CLIP.revealLead + 0.9)).toBe(1)
    expect(screenClipReveal(screenClipParams.parse({ ...base, reveal: 'scan', enter: 'none' }), 0)).toBe(0)
    expect(screenClipReveal(screenClipParams.parse(base), 0)).toBe(1)
  })

  it('cues: a whoosh on the entrance, a pop per callout and mark, a tap per click; planned as SFX', () => {
    const p = screenClipParams.parse({
      ...base,
      callouts: [{ at: 1.2, x: 0.1, y: 0.1, label: 'درج' }],
      marks: [{ at: 2, x: 0.1, y: 0.1, w: 0.1, h: 0.1, style: 'hot' }],
      clicks: [{ at: 0.8, x: 0.5, y: 0.5 }],
    })
    expect(cuesOfScreenClip(p, { duration: 4 })).toEqual([
      { t: 0, kind: 'whoosh' },
      { t: 0.8, kind: 'action' },
      { t: 1.2, kind: 'pop' },
      { t: 2, kind: 'pop' },
    ])
    expect(cuesOfScreenClip(screenClipParams.parse({ ...base, enter: 'none' }), { duration: 4 })).toEqual([])
    const fx = planSfx(sb(scene({ ...base, callouts: [{ at: 1.2, x: 0.1, y: 0.1, label: 'درج' }] })), { fps: 60 })
    expect(fx.map((c) => c.sfx)).toEqual(['riser', 'mallet'])
  })
})

describe('numbered-slots params', () => {
  const scene = (params: unknown, duration = 3) => [{ id: 'n', type: 'numbered-slots', start: 0, duration, params }]

  it('defaults: arabic digits, centre, 0.8 wide, staggered appear, no lock, nothing active', () => {
    expect(numberedSlotsParams.parse({ count: 3 })).toEqual({ count: 3, digits: 'arabic', at: { x: 0.5, y: 0.5 }, width: 0.8, active: [] })
    const p = numberedSlotsParams.parse({ count: 3 })
    expect([0, 1, 2].map((i) => slotAppearAt(p, i))).toEqual([0, NUMBERED_SLOTS.stagger, 2 * NUMBERED_SLOTS.stagger])
    expect([0, 1, 2].map((i) => slotNumeral(p, i))).toEqual(['١', '٢', '٣'])
    expect(slotNumeral(numberedSlotsParams.parse({ count: 2, digits: 'latin' }), 1)).toBe('2')
    expect(slotAppearAt(numberedSlotsParams.parse({ count: 2, appear: [1, 2.5] }), 1)).toBe(2.5)
  })

  it('refusals, Arabic first: count 2..5, labels / appear per slot, locked inside the row, unlockAt needs a lock, active ordered and inside', () => {
    const bad = (params: unknown, path: string) => {
      const r = numberedSlotsParams.safeParse(params)
      expect(r.success, JSON.stringify(params)).toBe(false)
      const issue = r.error!.issues[0]!
      expect(issue.message).toMatch(ARABIC_FIRST)
      expect(issue.path.join('.')).toBe(path)
    }
    bad({ count: 1 }, 'count')
    bad({ count: 6 }, 'count')
    bad({ count: 3, labels: ['أ', 'ب'] }, 'labels')
    bad({ count: 3, appear: [0, 1] }, 'appear')
    bad({ count: 3, locked: 3 }, 'locked')
    bad({ count: 3, unlockAt: 1 }, 'unlockAt')
    bad({ count: 3, locked: 2, appear: [0, 0.5, 1.5], unlockAt: 1 }, 'unlockAt')
    bad({ count: 3, active: [{ at: 1, index: 3 }] }, 'active.0.index')
    bad({ count: 3, active: [{ at: 2, index: 0 }, { at: 1, index: 1 }] }, 'active.1.at')
    expect(numberedSlotsParams.safeParse({ count: 3, labels: ['ا'.repeat(15), 'ب', 'ج'] }).success).toBe(false)
    expect(numberedSlotsParams.safeParse({ count: 3, width: 0.96 }).success).toBe(false)
    expect(numberedSlotsParams.safeParse({ count: 3, locked: 2, unlockAt: 1.4, labels: ['البناء', 'الكلفة', 'الشمس'] }).success).toBe(true)
    // Scene timing: everything inside the scene.
    expect(errOf(() => validateSceneParams(sb(scene({ count: 3, locked: 0, unlockAt: 3 }))))!.path).toBe('scenes[0].params.unlockAt')
    expect(errOf(() => validateSceneParams(sb(scene({ count: 3, active: [{ at: 3.2, index: 0 }] }))))!.path).toBe('scenes[0].params.active[0].at')
    expect(errOf(() => validateSceneParams(sb(scene({ count: 2, appear: [0, 3] }))))!.path).toBe('scenes[0].params.appear[1]')
    expect(() => validateSceneParams(sb(scene({ count: 3, locked: 2, unlockAt: 2 })))).not.toThrow()
  })

  it('active: the latest entry wins; highlight / dim ease in over activeSec', () => {
    const p = numberedSlotsParams.parse({ count: 3, active: [{ at: 1, index: 0 }, { at: 2, index: 2 }] })
    expect(activeIndexAt(p, 0.5)).toBeUndefined()
    expect(activeIndexAt(p, 1.5)).toBe(0)
    expect(activeIndexAt(p, 2)).toBe(2)
    expect(slotEmphasis(p, 0, 0.5)).toEqual({ hl: 0, dim: 0 })
    expect(slotEmphasis(p, 0, 1.5)).toEqual({ hl: 1, dim: 0 })
    expect(slotEmphasis(p, 1, 1.5)).toEqual({ hl: 0, dim: 1 })
    const mid = slotEmphasis(p, 0, 1 + NUMBERED_SLOTS.activeSec / 2)
    expect(mid.hl).toBeGreaterThan(0)
    expect(mid.hl).toBeLessThan(1)
    expect(slotEmphasis(p, 0, 3)).toEqual({ hl: 0, dim: 1 })
    expect(slotEmphasis(p, 2, 3)).toEqual({ hl: 1, dim: 0 })
  })

  it('cues: a pop per slot as it appears, a hit on the unlock, a tap per active change', () => {
    const p = numberedSlotsParams.parse({ count: 3, locked: 2, unlockAt: 1.5, active: [{ at: 2, index: 2 }] })
    expect(cuesOfNumberedSlots(p, { duration: 3 })).toEqual([
      { t: 0, kind: 'pop' },
      { t: 0.12, kind: 'pop' },
      { t: 0.24, kind: 'pop' },
      { t: 1.5, kind: 'hit' },
      { t: 2, kind: 'action' },
    ])
    const fx = planSfx(sb(scene({ count: 3, locked: 2, unlockAt: 1.5 })), { fps: 60 })
    expect(fx.map((c) => c.sfx)).toEqual(['mallet', 'mallet', 'mallet', 'impact'])
  })
})
