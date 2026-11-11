import { describe, it, expect } from 'vitest'
import { PARAMS, validateSceneParams } from '../../src/core/params/index'
import { iconParams } from '../../src/core/params/icon'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { parseStoryboard, StoryboardError } from '../../src/core/storyboard'
import { planSfx, SFX_GAIN, WHOOSH } from '../../src/core/audio-plan'
import { cutCue } from '../../src/core/params/transitions'
import { cuesOfKineticText, entranceStart, KINETIC_MAX_REST_SEC, KINETIC_TIMING, kineticTextParams } from '../../src/core/params/kinetic-text'
import { DRIFT_MAX_PX, DRIFT_MIN_FIT_SCALE, DRIFT_PER_SEC, DRIFT_PX_PER_SEC, driftCss, driftExtent, driftFitBox, driftFitScale, driftOffset, driftScale, translateDrift } from '../../src/core/params/drift'
import { rng as makeRng } from '../../src/core/rng'
import { REST_SCALE_TOL } from '../../src/runtime/audit'
import { counterDecimals, counterParams, counterWidthProbes, counterValue, cuesOfCounter, formatCounter } from '../../src/core/params/counter'
import { CHECKLIST_TIMING, checklistParams, checkStart, cuesOfChecklist, rowStart } from '../../src/core/params/checklist'
import { appWindowParams, cuesOfAppWindow, typedChars } from '../../src/core/params/app-window'
import { cuesOfStamp, stampScale } from '../../src/core/params/stamp'
import { hudSectionAt, hudParams } from '../../src/core/params/hud'
import { commentCtaParams, cuesOfCommentCta } from '../../src/core/params/comment-cta'
import { cuesOfPhone, phoneLineStart, phoneParams, PHONE_TIMING } from '../../src/core/params/phone'
import { earlyStart } from '../../src/core/params/common'
import { highlightParams } from '../../src/core/params/highlight'
import { cuesOfSectionNumber, SECTION_IMPACT_GAIN, sectionNumberParams } from '../../src/core/params/section-number'
import { wordWallParams } from '../../src/core/params/word-wall'
import { cuesOfShapeStates, shapeAt, shapeStatesParams, STATE_GEOMETRY } from '../../src/core/params/shape-states'
import { cuesOfMorphObject, levelAt, MORPH_OBJECT, morphObjectParams, morphObjectPose, OBJECT_BUILD_SEC, softSpring, TIMELINE, timelineCuts } from '../../src/core/params/morph-object'
import { cuesOfRepeatLoop, REPEAT_LOOP, repeatLoopParams } from '../../src/core/params/repeat-loop'
import { CHASE, chaseCurve, chaseParams, chasePose, cuesOfChase } from '../../src/core/params/chase'
import { BLUEPRINT, CALENDAR, CHAT, checkAtOf, EYE, HOUSE, OBJECT_SIZE_CAP, PHONE_APP, phoneCheckCues, PHOTO } from '../../src/core/params/morph-object'
import { cuesOfParticleWord, makeParticles, PARTICLE_WORD, particleAlpha, particleAt, particleStep, particleWordParams } from '../../src/core/params/particle-word'

const sb = (scenes: unknown[]) => parseStoryboard({ version: 1, scenes }, [...PRIMITIVE_IDS])
const pathOf = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(StoryboardError)
    return (e as StoryboardError).path
  }
  return undefined
}

describe('primitive params (DOM-free)', () => {
  it('PRIMITIVE_IDS is derived from PARAMS and keeps _probe', () => {
    expect([...PRIMITIVE_IDS]).toEqual(Object.keys(PARAMS))
    expect(PRIMITIVE_IDS).toContain('_probe')
    expect([...PRIMITIVE_IDS].sort()).toEqual(['_probe', 'app-window', 'arabic-move', 'backdrop', 'beat-pulse', 'beat-slam', 'book-flip', 'bounce-ball', 'build-number', 'captions', 'chapter-bar', 'chase', 'chat-thread', 'checklist', 'code-chat', 'code-file', 'comment-cta', 'comment-drop', 'comment-stickers', 'context-window', 'counter', 'cutout', 'day-dial', 'ecg-line', 'editorial-type', 'effect-list', 'gauge-ring', 'glitch-text', 'glow-words', 'head-stack', 'heavy-word', 'hero', 'highlight', 'hud', 'icon', 'kinetic-text', 'knowledge-timeline', 'laser-beam', 'laser-type', 'layer-stack', 'letters-join', 'line-art', 'live-cursor', 'live-timer', 'loaded-die', 'logo-row', 'microscope', 'misquote', 'morph-object', 'node-graph', 'notify-stack', 'numbered-slots', 'orbit-ring', 'particle-word', 'permission-prompt', 'phone', 'photo-look', 'post-wall', 'predict-keys', 'profile-card', 'red-pen', 'repeat-loop', 'said-written', 'screen-clip', 'screen-mockup', 'search-typing', 'section-number', 'server-batch', 'shape-states', 'signature-card', 'sketch-words', 'skill-deck', 'slam', 'space-field', 'stamp', 'stat-bars', 'tech-grid', 'token-odds', 'token-stream', 'twin-sync', 'type-stretch', 'ui-morph', 'video', 'viewfinder', 'voice-note', 'web-crawl', 'wipe-reveal', 'word-cut', 'word-wall', 'zoom-callout'])
  })
  it('valid params pass', () => {
    expect(() =>
      validateSceneParams(
        sb([
          { id: 'a', type: 'search-typing', start: 0, duration: 3, params: { text: 'كيف' } },
          { id: 'b', type: 'slam', start: 0, duration: 2, params: { text: 'Claude أصبح أذكى', accent: 'أذكى' } },
          { id: 'c', type: 'wipe-reveal', start: 0, duration: 2, params: { title: 'يوسف' } },
        ]),
      ),
    ).not.toThrow()
  })
  it('errors keep the scenes[i].params.<field> path', () => {
    const ok = { id: 'a', type: 'slam', start: 0, duration: 2, params: { text: 'جديد' } }
    expect(pathOf(() => validateSceneParams(sb([ok, { id: 'w', type: 'wipe-reveal', start: 0, duration: 2, params: { title: 'ا'.repeat(41) } }])))).toBe(
      'scenes[1].params.title',
    )
    expect(pathOf(() => validateSceneParams(sb([{ id: 's', type: 'search-typing', start: 0, duration: 2, params: { query: 'x' } }])))).toBe(
      'scenes[0].params.text',
    )
    expect(pathOf(() => validateSceneParams(sb([{ id: 's', type: 'slam', start: 0, duration: 2, params: { text: 'جديد', accent: 'x' } }])))).toBe(
      'scenes[0].params.accent',
    )
  })
})

describe('library II params: kinetic-text, counter, checklist', () => {
  const one = (type: string, params: unknown) => () => validateSceneParams(sb([{ id: 'x', type, start: 0, duration: 3, params }]))

  it('valid params pass', () => {
    expect(one('kinetic-text', { words: [{ text: 'المال', at: 0 }, { text: 'وقت', at: 0.6, stress: 2 }] })).not.toThrow()
    expect(one('counter', { from: 0, to: 300 })).not.toThrow()
    expect(one('checklist', { items: [{ text: 'أولاً', at: 0 }, { text: 'ثانياً', at: 1 }] })).not.toThrow()
  })
  it('kinetic-text: 0 words fails at words; a word with a space or a stress of 3 fails', () => {
    expect(pathOf(one('kinetic-text', { words: [] }))).toBe('scenes[0].params.words')
    expect(pathOf(one('kinetic-text', { words: [{ text: 'ذكاء اصطناعي', at: 0 }] }))).toBe('scenes[0].params.words[0].text')
    expect(pathOf(one('kinetic-text', { words: [{ text: 'وقت', at: 0, stress: 3 }] }))).toBe('scenes[0].params.words[0].stress')
    expect(pathOf(one('kinetic-text', { words: [{ text: 'وقت', at: -1 }] }))).toBe('scenes[0].params.words[0].at')
  })
  it('kinetic-text defaults: mode stack, stress 0; cues: one action per word at its at', () => {
    const p = kineticTextParams.parse({ words: [{ text: 'المال', at: 0 }, { text: 'وقت', at: 0.6, stress: 2 }] })
    expect(p.mode).toBe('stack')
    expect(p.words[0]!.stress).toBe(0)
    expect(cuesOfKineticText(p, { duration: 3 })).toEqual([
      { t: 0, kind: 'action' },
      { t: 0.6, kind: 'action' },
    ])
  })
  it('counter: roll <= 0 fails at roll', () => {
    expect(pathOf(one('counter', { from: 0, to: 300, roll: 0 }))).toBe('scenes[0].params.roll')
    expect(pathOf(one('counter', { from: 0, to: 300, roll: -1 }))).toBe('scenes[0].params.roll')
  })
  it('counter: arabic digits by default, power3.out roll, monotonic, exact at the ends', () => {
    const p = counterParams.parse({ from: 0, to: 300 })
    expect(p.digits).toBe('arabic')
    expect(p.roll).toBe(1.2)
    expect(formatCounter(p, counterValue(p, 0))).toBe('٠')
    expect(formatCounter(p, counterValue(p, 1.2))).toBe('٣٠٠')
    expect(formatCounter(p, counterValue(p, 5))).toBe('٣٠٠')
    // power3.out: past half the value at a quarter of the roll
    expect(counterValue(p, 0.3)).toBeGreaterThan(150)
    let last = -Infinity
    for (let t = 0; t <= 1.3; t += 1 / 30) {
      const v = counterValue(p, t)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
    const latin = counterParams.parse({ from: 0, to: 1500, digits: 'latin', prefix: '$', suffix: '+' })
    expect(formatCounter(latin, 1500)).toBe('$1,500+')
    expect(formatCounter(counterParams.parse({ from: 0, to: 45, suffix: '٪' }), 45)).toBe('٤٥٪')
    expect(formatCounter(counterParams.parse({ from: 0, to: 2.5 }), 2.5)).toBe('٢٫٥')
  })
  it('counter cues: count over [0, roll], final at roll end (compressed to a shorter scene)', () => {
    const p = counterParams.parse({ from: 0, to: 300, roll: 1.2 })
    expect(cuesOfCounter(p, { duration: 3 })).toEqual([
      { t: 0, kind: 'count', duration: 1.2 },
      { t: 1.2, kind: 'final' },
    ])
    expect(cuesOfCounter(p, { duration: 0.8 })).toEqual([
      { t: 0, kind: 'count', duration: 0.8 },
      { t: 0.8, kind: 'final' },
    ])
  })
  it('checklist: more than 8 items fails at items (fits the safe area); 0 items fails', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ text: `بند ${i}`, at: i * 0.25 }))
    expect(pathOf(one('checklist', { items }))).toBe('scenes[0].params.items')
    expect(pathOf(one('checklist', { items: items.slice(0, 8) }))).toBeUndefined()
    expect(pathOf(one('checklist', { items: [] }))).toBe('scenes[0].params.items')
  })
  it('checklist cues: one action per item at its check start; planSfx makes them ticks', () => {
    const params = { items: [{ text: 'أولاً', at: 0 }, { text: 'ثانياً', at: 1 }, { text: 'ثالثاً', at: 2 }] }
    // R17: the row at 0 enters early (ends at 0), so its check starts at 0; the others at at + rowIn.
    const starts = [0, 1 + CHECKLIST_TIMING.rowIn, 2 + CHECKLIST_TIMING.rowIn]
    expect(cuesOfChecklist(checklistParams.parse(params), { duration: 4 })).toEqual(starts.map((t) => ({ t, kind: 'action' })))
    const fx = planSfx(sb([{ id: 'c', type: 'checklist', start: 1, duration: 4, params }]), { fps: 30 })
    expect(fx.map((c) => c.sfx)).toEqual(['tick', 'tick', 'tick'])
    fx.forEach((c, i) => expect(c.at).toBeCloseTo(Math.round((1 + starts[i]!) * 30) / 30, 9))
  })
  it('counter and kinetic-text cues reach the planner (count + chime; taps)', () => {
    const fx = planSfx(
      sb([
        { id: 'n', type: 'counter', start: 0, duration: 2, params: { from: 0, to: 300 } },
        { id: 'k', type: 'kinetic-text', start: 2, duration: 2, params: { words: [{ text: 'المال', at: 0.2 }, { text: 'وقت', at: 0.8, stress: 2 }] } },
      ]),
      { fps: 30 },
    )
    expect(fx.map((c) => [c.sfx, c.at])).toEqual([
      ['count', 0],
      ['chime', 1.2],
      ['tap', 2.2],
      ['tap', 2.8],
    ])
  })
})

describe('Task 7 review round 1', () => {
  const scene = (type: string, params: unknown, duration: number, preroll = 0) => () =>
    validateSceneParams(sb([{ id: 'x', type, start: 1, duration, preroll, params }]))
  const errOf = (fn: () => unknown): StoryboardError | undefined => {
    try {
      fn()
    } catch (e) {
      expect(e).toBeInstanceOf(StoryboardError)
      return e as StoryboardError
    }
    return undefined
  }

  it('kinetic-text: a word at or after the scene end (duration + preroll) fails at words[k].at, Arabic first', () => {
    const words = (last: number) => [{ text: 'المال', at: 0 }, { text: 'وقت', at: last }]
    expect(errOf(scene('kinetic-text', { words: words(2.4) }, 2, 0.5))).toBeUndefined()
    const e = errOf(scene('kinetic-text', { words: words(2.5) }, 2, 0.5))!
    expect(e.path).toBe('scenes[0].params.words[1].at')
    expect(e.message).toMatch(/^scenes\[0\]\.params\.words\[1\]\.at: [\u0600-\u06FF«]/)
    expect(e.message).toContain(' — word appears at 2.5 s')
  })
  it('checklist: an item whose check cannot finish (at + rowIn + checkIn > duration + preroll) fails at items[k].at', () => {
    const items = (last: number) => [{ text: 'أولاً', at: 0 }, { text: 'ثانياً', at: last }]
    const need = CHECKLIST_TIMING.rowIn + CHECKLIST_TIMING.checkIn
    expect(errOf(scene('checklist', { items: items(2 - need) }, 2))).toBeUndefined()
    expect(errOf(scene('checklist', { items: items(2.5 - need) }, 2, 0.5))).toBeUndefined()
    const e = errOf(scene('checklist', { items: items(2 - need + 0.05) }, 2))!
    expect(e.path).toBe('scenes[0].params.items[1].at')
    expect(e.message).toMatch(/^scenes\[0\]\.params\.items\[1\]\.at: [\u0600-\u06FF]/)
  })
  it('kinetic-text: a word with * is refused with a hint to use stress: 2 (R7)', () => {
    const e = errOf(scene('kinetic-text', { words: [{ text: '*وقت*', at: 0 }] }, 2))!
    expect(e.path).toBe('scenes[0].params.words[0].text')
    expect(e.message).toContain('stress: 2')
  })
  it('counterDecimals compares with toFixed (no absolute epsilon): 1234567.8 → 1 decimal', () => {
    expect(counterDecimals({ from: 0, to: 1234567.8 })).toBe(1)
    expect(counterDecimals({ from: 0.125, to: 1 })).toBe(3)
    expect(counterDecimals({ from: -50, to: 50 })).toBe(0)
    const p = counterParams.parse({ from: 0, to: 1234567.8, digits: 'latin' })
    expect(formatCounter(p, counterValue(p, 99))).toBe('1,234,567.8')
  })
  it('KINETIC_MAX_REST_SEC: the drift stays within the audit rest scale up to the cap, and passes it soon after', () => {
    expect(KINETIC_MAX_REST_SEC).toBe(12)
    expect(driftScale(KINETIC_MAX_REST_SEC) - 1).toBeLessThanOrEqual(REST_SCALE_TOL)
    expect(driftScale(KINETIC_MAX_REST_SEC + 1) - 1).toBeGreaterThan(REST_SCALE_TOL)
    expect(DRIFT_PER_SEC).toBeGreaterThanOrEqual(0.01)
  })
})

describe('Task 7 review round 2 (R16 translate drift, R17 early entrances)', () => {
  it('R16: translate drift is seeded, 12 px/s at 1080 px (scaled with the frame width), pure in t', () => {
    const a = translateDrift(makeRng(5), 1080)
    const b = translateDrift(makeRng(5), 1080)
    expect(a).toEqual(b)
    expect(Math.hypot(a.vx, a.vy)).toBeCloseTo(DRIFT_PX_PER_SEC, 9)
    expect(DRIFT_PX_PER_SEC).toBe(12)
    const wide = translateDrift(makeRng(5), 1920)
    expect(Math.hypot(wide.vx, wide.vy)).toBeCloseTo((12 * 1920) / 1080, 9)
    expect(translateDrift(makeRng(6), 1080)).not.toEqual(a)
    expect(driftOffset(a, 2)).toEqual(driftOffset(a, 2))
    expect(driftOffset(a, -1)).toEqual({ x: 0, y: 0 })
    expect(driftOffset(a, 2).x).toBeCloseTo(2 * a.vx, 9)
  })
  it('R16: the fit box reserves the translate on each side, then the scale growth', () => {
    const d = { vx: 10, vy: -5 }
    expect(driftFitBox({ w: 900, h: 1500 }, 3, 0.012, d)).toEqual({ w: Math.floor((900 - 60) / 1.036), h: Math.floor((1500 - 30) / 1.036) })
    expect(driftFitBox({ w: 900, h: 1500 }, 3, 0.012)).toEqual({ w: Math.floor(900 / 1.036), h: Math.floor(1500 / 1.036) })
  })
  it('R17: a kinetic word earlier than its entrance enters early and is fully in at its at', () => {
    expect(entranceStart({ at: 0, stress: 0 })).toBeCloseTo(-KINETIC_TIMING.slideIn, 9)
    expect(entranceStart({ at: 0.1, stress: 0 })).toBeCloseTo(0.1 - KINETIC_TIMING.slideIn, 9)
    expect(entranceStart({ at: 0.25, stress: 0 })).toBe(0.25)
    expect(entranceStart({ at: 0.03, stress: 2 })).toBeCloseTo(0.03 - KINETIC_TIMING.fadeIn, 9)
    expect(entranceStart({ at: 0.5, stress: 1 })).toBe(0.5)
  })
  it('R17: a checklist row at 0 enters before 0; its check starts at 0', () => {
    expect(rowStart({ at: 0 })).toBe(-CHECKLIST_TIMING.rowIn)
    expect(checkStart({ at: 0 })).toBe(0)
    expect(rowStart({ at: 1 })).toBe(1)
    expect(checkStart({ at: 1 })).toBe(1 + CHECKLIST_TIMING.rowIn)
  })
})

describe('Task 7 fix round 3 (demo findings)', () => {
  it('counter: a word affix is spaced from the number; symbols stay attached', () => {
    const f = (o: Record<string, unknown>, v: number) => formatCounter(counterParams.parse({ from: 0, to: 300, ...o }), v)
    expect(f({ suffix: 'ساعة' }, 173)).toBe('١٧٣ ساعة')
    expect(f({ prefix: 'ريال' }, 5)).toBe('ريال ٥')
    expect(f({ suffix: 'USD', digits: 'latin' }, 5)).toBe('5 USD')
    expect(f({ suffix: '٪' }, 45)).toBe('٤٥٪')
    expect(f({ suffix: '%', digits: 'latin' }, 45)).toBe('45%')
    expect(f({ prefix: '$', suffix: '+', digits: 'latin' }, 1500)).toBe('$1,500+')
  })
  it('counter width probes: every digit in every position, affix included (Cairo digits are not tabular)', () => {
    const p = counterParams.parse({ from: 0, to: 300, suffix: 'ساعة' })
    const probes = counterWidthProbes(p)
    expect(probes).toContain('١١١ ساعة')
    expect(probes).toContain('٨٨٨ ساعة')
    expect(probes).toContain('٨ ساعة')
    expect(probes.every((s) => s.endsWith(' ساعة'))).toBe(true)
    const signed = counterWidthProbes(counterParams.parse({ from: -50, to: 50, digits: 'latin' }))
    expect(signed).toContain('-88')
  })
  it('driftCss: translate to 0.01 px, scale to 4 decimals (short string, never an exponent)', () => {
    expect(driftCss(0)).toBe('scale(1.0000)')
    expect(driftCss(1 / 3)).toBe('scale(1.0040)')
    expect(driftCss(2, 0.012, { vx: 10, vy: -5 })).toBe('translate(20.00px, -10.00px) scale(1.0240)')
    expect(driftCss(0, 0.012, { vx: 10, vy: -5 })).toBe('translate(0.00px, 0.00px) scale(1.0000)')
  })
  it('icon default size is 0.55 (R14 as updated)', () => {
    expect(iconParams.parse({ icon: 'clock' }).size).toBe(0.55)
  })
})

describe('Task 7 fix round 4 (capped drift reach, natural-size fit)', () => {
  it('the translate drift turns back after DRIFT_MAX_PX (scaled with the frame width), at the same speed', () => {
    expect(DRIFT_MAX_PX).toBe(36)
    const d = translateDrift(makeRng(5), 1080)
    expect(d.reach).toBe(36)
    expect(translateDrift(makeRng(5), 1920).reach).toBeCloseTo((36 * 1920) / 1080, 9)
    const dist = (t: number) => Math.hypot(driftOffset(d, t).x, driftOffset(d, t).y)
    expect(dist(1)).toBeCloseTo(12, 9) // linear up to 3 s: short scenes are unchanged
    expect(dist(3)).toBeCloseTo(36, 9)
    expect(dist(4)).toBeCloseTo(24, 9) // back along the same line
    expect(dist(6)).toBeCloseTo(0, 9)
    expect(dist(7)).toBeCloseTo(12, 9)
    for (let t = 0; t <= 20; t += 0.1) expect(dist(t)).toBeLessThanOrEqual(36 + 1e-9)
    // Same direction all along: the offset stays a non-negative multiple of (vx, vy).
    expect(driftOffset(d, 4).x * d.vx).toBeGreaterThanOrEqual(0)
  })
  it('driftExtent: furthest offset per axis, capped; driftFitBox reserves at most 2 x reach per axis', () => {
    const d = { vx: 12, vy: 0, reach: 36 }
    expect(driftExtent(d, 2)).toEqual({ x: 24, y: 0 })
    expect(driftExtent(d, 10)).toEqual({ x: 36, y: 0 })
    expect(driftExtent(undefined, 10)).toEqual({ x: 0, y: 0 })
    // A 10 s scene loses 72 px of width (not 240) before the scale growth.
    expect(driftFitBox({ w: 900, h: 1500 }, 10, 0.012, d)).toEqual({ w: Math.floor((900 - 72) / 1.12), h: Math.floor(1500 / 1.12) })
  })
  it('driftFitScale: 1 for content that leaves room for the drift; otherwise the exact uniform shrink', () => {
    const safe = { x: 0, y: 0, w: 1000, h: 1000 }
    const o = { x: 500, y: 500 }
    const d = { vx: 12, vy: 0, reach: 36 }
    // 600 px wide, 3 s: 300 x 1.036 + 36 = 346.8 <= 500 on the right: natural size.
    expect(driftFitScale({ x: 200, y: 400, w: 600, h: 200 }, safe, o, 3, 0.012, d)).toBe(1)
    // Filling the width: the right edge needs (500 + 0.5 - 36) / (500 x 1.036).
    expect(driftFitScale({ x: 0, y: 400, w: 1000, h: 200 }, safe, o, 3, 0.012, d)).toBeCloseTo(464.5 / 518, 9)
    // The translate goes one way only: room is needed on that side alone.
    expect(driftFitScale({ x: 10, y: 400, w: 920, h: 200 }, safe, o, 1, 0, d)).toBe(1) // right edge 930 + 12
    expect(driftFitScale({ x: 10, y: 400, w: 980, h: 200 }, safe, o, 1, 0, d)).toBeCloseTo(488.5 / 490, 9) // 990 + 12
    expect(driftFitScale({ x: 10, y: 400, w: 980, h: 200 }, safe, o, 1, 0, { vx: -12, vy: 0, reach: 36 })).toBeCloseTo(488.5 / 490, 9)
    // Scale only (no translate): edges move away from the origin.
    expect(driftFitScale({ x: 60, y: 60, w: 880, h: 880 }, safe, o, 5, 0.012)).toBe(1) // 440 x 1.06 = 466.4
    expect(driftFitScale({ x: 50, y: 50, w: 900, h: 900 }, safe, o, 10, 0.012)).toBeCloseTo(500.5 / (450 * 1.12), 9)
    // A shrink below DRIFT_MIN_FIT_SCALE keeps k x drift scale inside the audit rest scale (0.85-1.15).
    expect(DRIFT_MIN_FIT_SCALE).toBe(0.87)
    expect(DRIFT_MIN_FIT_SCALE).toBeGreaterThan(0.85)
  })
})

describe('Task 9 library III params: phone, app-window, stamp, highlight, hud, comment-cta', () => {
  const one = (type: string, params: unknown, duration = 3, extra: Record<string, unknown> = {}) => sb([{ id: 'x', type, start: 0, duration, params, ...extra }])
  it('Task 10: app-window may show an image instead of lines; neither fails at lines', () => {
    expect(() => validateSceneParams(one('app-window', { mode: 'app', image: 'source/wide.png' }))).not.toThrow()
    expect(pathOf(() => validateSceneParams(one('app-window', { mode: 'app' })))).toBe('scenes[0].params.lines')
  })
  it('app-window with 0 lines fails at lines', () => {
    expect(pathOf(() => validateSceneParams(one('app-window', { mode: 'terminal', lines: [] })))).toBe('scenes[0].params.lines')
  })
  it('comment-cta keyword over 20 characters fails at keyword; 20 passes; defaults filled', () => {
    expect(pathOf(() => validateSceneParams(one('comment-cta', { keyword: 'ك'.repeat(21) })))).toBe('scenes[0].params.keyword')
    expect(() => validateSceneParams(one('comment-cta', { keyword: 'ك'.repeat(20) }))).not.toThrow()
    const p = commentCtaParams.parse({ keyword: 'موشن' })
    expect(p.placeholder).toBe('أضف تعليقاً…')
    expect(p.dmTitle).toBe('وصلتك الرسالة')
  })
  it('hud sections not ascending fail at sections[1].at', () => {
    const sections = [
      { label: 'المقدمة', at: 1 },
      { label: 'الفكرة', at: 0.5 },
    ]
    expect(pathOf(() => validateSceneParams(one('hud', { sections, progress: 'pips' })))).toBe('scenes[0].params.sections[1].at')
    expect(pathOf(() => validateSceneParams(one('hud', { sections: [sections[0], { label: 'ب', at: 1 }], progress: 'pips' })))).toBe('scenes[0].params.sections[1].at')
  })
  it('scene-end checks: app-window lines and hud sections past the end fail at their at', () => {
    // 13 chars at 34 cps = 0.38 s: at 2.7 it ends at 3.08 > 3.
    const lines = [{ text: '> mba explain', at: 0 }, { text: '> done', at: 2.9 }]
    expect(pathOf(() => validateSceneParams(one('app-window', { mode: 'terminal', lines })))).toBe('scenes[0].params.lines[1].at')
    expect(() => validateSceneParams(one('app-window', { mode: 'terminal', lines: [lines[0]] }))).not.toThrow()
    const sections = [{ label: 'أ', at: 0 }, { label: 'ب', at: 3 }]
    expect(pathOf(() => validateSceneParams(one('hud', { sections, progress: 'none' })))).toBe('scenes[0].params.sections[1].at')
    expect(pathOf(() => validateSceneParams(one('comment-cta', { keyword: 'موشن' }, 1.5)))).toBe('scenes[0].params')
  })
  it('highlight target must be a key of an earlier overlapping scene', () => {
    const counter = { id: 'n', type: 'counter', start: 0, duration: 3, params: { from: 0, to: 9, key: 'num' } }
    const hl = (target: string, start = 0.5) => ({ id: 'h', type: 'highlight', start, duration: 2, track: 1, params: { kind: 'circle', target } })
    expect(() => validateSceneParams(sb([counter, hl('num')]))).not.toThrow()
    expect(pathOf(() => validateSceneParams(sb([counter, hl('nope')])))).toBe('scenes[1].params.target')
    expect(pathOf(() => validateSceneParams(sb([counter, hl('num', 3)])))).toBe('scenes[1].params.target')
    expect(pathOf(() => validateSceneParams(sb([hl('num'), { ...counter, track: 0 }])))).toBe('scenes[0].params.target')
    expect(highlightParams.safeParse({ kind: 'circle', target: 'a', box: { x: 0, y: 0, w: 1, h: 1 } }).success).toBe(false)
    expect(highlightParams.parse({ kind: 'burst' }).drawIn).toBe(0.45)
  })
  it('phone: image or lines; tilt default -2; pop at 0', () => {
    expect(phoneParams.parse({ screen: { image: 'shot.png' } }).tilt).toBe(-2)
    expect(phoneParams.safeParse({ screen: { lines: [] } }).success).toBe(false)
    expect(cuesOfPhone(phoneParams.parse({ screen: { image: 'a.png' } }), { duration: 3 })).toEqual([{ t: 0, kind: 'pop' }])
  })
  it('app-window cues: one type-letter per Latin non-space character, one action per Arabic line; typedChars', () => {
    const p = appWindowParams.parse({ mode: 'terminal', lines: [{ text: '> mba explain', at: 0.5 }, { text: 'جاري التحريك…', at: 1.2 }] })
    expect(p.cps).toBe(34)
    const cues = cuesOfAppWindow(p, { duration: 3 })
    expect(cues.filter((c) => c.kind === 'type-letter')).toHaveLength(11)
    expect(cues.filter((c) => c.kind === 'action')).toEqual([{ t: 1.2, kind: 'action' }])
    expect(cues[0]).toEqual({ t: 0.5, kind: 'type-letter' })
    const l = p.lines[0]!
    expect(typedChars(p, l, 0.49)).toBe(0)
    expect(typedChars(p, l, 0.5)).toBe(1)
    expect(typedChars(p, l, 0.5 + 4 / 34)).toBe(5)
    expect(typedChars(p, l, 9)).toBe(13)
  })
  it('stamp: 1.7 → 1 expo.out over 0.25 s; one hit at 0', () => {
    expect(stampScale(-1)).toBeCloseTo(1.7, 9)
    expect(stampScale(0)).toBeCloseTo(1.7, 9)
    expect(stampScale(0.02)).toBeGreaterThan(1.3)
    expect(stampScale(0.25)).toBe(1)
    expect(stampScale(0.5)).toBe(1)
    expect(cuesOfStamp({} as never, { duration: 2 })).toEqual([{ t: 0, kind: 'hit' }])
  })
  it('hudSectionAt and comment-cta cues', () => {
    const p = hudParams.parse({ sections: [{ label: 'أ', at: 0 }, { label: 'ب', at: 1 }, { label: 'ج', at: 2 }], progress: 'pips' })
    expect([-0.1, 0, 0.99, 1, 2.5].map((t) => hudSectionAt(p, t))).toEqual([-1, 0, 0, 1, 2])
    expect(cuesOfCommentCta(commentCtaParams.parse({ keyword: 'موشن' }), { duration: 3 })).toEqual([
      { t: 1.0, kind: 'action' },
      { t: 1.7, kind: 'final' },
    ])
  })
})

describe('Task 9 fix round 1', () => {
  it('highlight target scene must cover the whole highlight span (overlap is not enough)', () => {
    const counter = { id: 'n', type: 'counter', start: 0, duration: 3, params: { from: 0, to: 9, key: 'num' } }
    const hl = (start: number, duration: number) => ({ id: 'h', type: 'highlight', start, duration, track: 1, params: { kind: 'circle', target: 'num' } })
    expect(() => validateSceneParams(sb([counter, hl(0, 3)]))).not.toThrow()
    expect(() => validateSceneParams(sb([counter, hl(0.1 + 0.2, 2.7)]))).not.toThrow()
    expect(pathOf(() => validateSceneParams(sb([counter, hl(0.5, 3)])))).toBe('scenes[1].params.target') // ends after
    expect(pathOf(() => validateSceneParams(sb([{ ...counter, start: 1, duration: 2 }, hl(0.5, 2)])))).toBe('scenes[1].params.target') // starts before
  })
  it('earlyStart (R17) is shared; comment-cta keyword uses oneLine', () => {
    expect(earlyStart(0, 0.25)).toBe(-0.25)
    expect(earlyStart(0.1, 0.25)).toBeCloseTo(-0.15, 12)
    expect(earlyStart(0.25, 0.25)).toBe(0.25)
    expect(phoneLineStart({ at: 0 })).toBe(earlyStart(0, PHONE_TIMING.lineIn))
    const r = commentCtaParams.safeParse({ keyword: 'a\nb' })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0]!.message).toBe('keyword must be a single line')
    expect(commentCtaParams.safeParse({ keyword: '  ' }).error!.issues[0]!.message).toBe('keyword must not be blank')
  })
})

describe('backdrop react (live since Task 6)', () => {
  it('a react.hero naming no hero scene is accepted and warns, Arabic first, naming the scene', () => {
    const board = sb([{ id: 'b', type: 'backdrop', start: 0, duration: 2, params: { pattern: 'dots', react: { hero: 'hero-1' } } }])
    const warnings: string[] = []
    validateSceneParams(board, warnings)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('hero-1')
    expect(warnings[0]).toMatch(/^[؀-ۿ].* — [A-Za-z]/)
  })
  it('no warning when react.hero names a hero scene', () => {
    const hero = { id: 'hero-1', type: 'hero', start: 0, duration: 2, track: 4, params: { path: [{ at: 0, x: 0.2, y: 0.5 }, { at: 1, x: 0.8, y: 0.5 }] } }
    const warnings: string[] = []
    validateSceneParams(sb([{ id: 'b', type: 'backdrop', start: 0, duration: 2, params: { pattern: 'dots', react: { hero: 'hero-1' } } }, hero]), warnings)
    expect(warnings).toEqual([])
  })
  it('no warning without react', () => {
    const warnings: string[] = []
    validateSceneParams(sb([{ id: 'b', type: 'backdrop', start: 0, duration: 2, params: { pattern: 'dots' } }]), warnings)
    expect(warnings).toEqual([])
  })
})

describe('backdrop material (Plan 3 Task 2)', () => {
  it('absent material stays undefined (the old backdrop)', () => {
    expect(PARAMS.backdrop.parse({}).material).toBeUndefined()
    expect(PARAMS.backdrop.parse({ world: 'ink', pattern: 'dots' }).material).toBeUndefined()
  })
  it('material {} parses to paper 0.5, grain 0.08, vignette 0.6, halftone off', () => {
    expect(PARAMS.backdrop.parse({ material: {} }).material).toEqual({ paper: 0.5, grain: 0.08, vignette: 0.6, halftone: false })
    expect(PARAMS.backdrop.parse({ material: { paper: 1, grain: 0.2, vignette: 0, halftone: true } }).material).toEqual({ paper: 1, grain: 0.2, vignette: 0, halftone: true })
  })
  it('out-of-range values fail at scenes[i].params.material.<field>', () => {
    const one = (material: unknown) => () => validateSceneParams(sb([{ id: 'b', type: 'backdrop', start: 0, duration: 2, params: { material } }]))
    expect(pathOf(one({ grain: 0.5 }))).toBe('scenes[0].params.material.grain')
    expect(pathOf(one({ paper: 1.5 }))).toBe('scenes[0].params.material.paper')
    expect(pathOf(one({ vignette: -0.1 }))).toBe('scenes[0].params.material.vignette')
    expect(pathOf(one({ halftone: 'yes' }))).toBe('scenes[0].params.material.halftone')
    expect(one({ paper: 0, grain: 0, vignette: 1, halftone: true })).not.toThrow()
  })
})

describe('backdrop accent world contrast fallback', () => {
  const board = (look: string, primary?: string) =>
    parseStoryboard(
      {
        version: 1,
        look,
        ...(primary ? { brand: { name: 'x', handle: '@x', colors: { primary, secondary: '#222222', bg: '#000000', text: '#ffffff' } } } : {}),
        scenes: [{ id: 'b', type: 'backdrop', start: 0, duration: 2, params: { world: 'accent' } }],
      },
      [...PRIMITIVE_IDS],
    )
  it('warns (Arabic first) when no pair of the look reaches 4.5 and ink is used', () => {
    const warnings: string[] = []
    validateSceneParams(board('dark-tech', '#777777'), warnings)
    expect(warnings).toEqual(['الجو «accent» لا يحقق تباين ٤٫٥ في هذا الستايل؛ استُبدل بـ «ink» — accent world fails 4.5 contrast for this look; using ink'])
  })
  it('no warning for looks whose accent world passes', () => {
    for (const look of ['dark-tech', 'light-editorial', 'paper-editorial']) {
      const warnings: string[] = []
      validateSceneParams(board(look), warnings)
      expect(warnings, look).toEqual([])
    }
  })
})

describe('Plan 2a+ Task 3: editorial kinetic text params', () => {
  const run = (params: unknown) => () => validateSceneParams(sb([{ id: 'x', type: 'kinetic-text', start: 0, duration: 3, params }]))
  const errOf = (fn: () => unknown): StoryboardError | undefined => {
    try {
      fn()
    } catch (e) {
      return e as StoryboardError
    }
    return undefined
  }
  const word = (extra: Record<string, unknown> = {}) => ({ text: 'تمدد', at: 0, ...extra })

  it('defaults: enter slide, echo 0, mode stack; no stretch, strike or punch', () => {
    const p = kineticTextParams.parse({ words: [word()] })
    expect(p.enter).toBe('slide')
    expect(p.mode).toBe('stack')
    expect(p.words[0]!.echo).toBe(0)
    expect(p.words[0]!.stretch).toBeUndefined()
    expect(p.words[0]!.strike).toBeUndefined()
    expect(p.words[0]!.punch).toBeUndefined()
  })
  it('the V1 enters mask and pop still parse; rise and mask-line are new', () => {
    for (const enter of ['slide', 'rise', 'mask-line', 'mask', 'pop']) expect(kineticTextParams.parse({ words: [word()], enter }).enter).toBe(enter)
    expect(() => kineticTextParams.parse({ words: [word()], enter: 'spin' })).toThrow()
  })
  it('giant takes exactly one word, else a zod error at words mentioning "one word"', () => {
    expect(run({ mode: 'giant', words: [word()] })).not.toThrow()
    const e = errOf(run({ mode: 'giant', words: [word(), word({ text: 'وقت', at: 1 })] }))!
    expect(e.path).toBe('scenes[0].params.words')
    expect(e.message).toContain('one word')
  })
  it('echo is an integer 0..4', () => {
    expect(run({ words: [word({ echo: 4 })] })).not.toThrow()
    expect(errOf(run({ words: [word({ echo: 5 })] }))!.path).toBe('scenes[0].params.words[0].echo')
    expect(errOf(run({ words: [word({ echo: 1.5 })] }))!.path).toBe('scenes[0].params.words[0].echo')
  })
  it('stretch: to 1..12, duration 0.1..3, at >= 0, hold >= 0', () => {
    const ok = { to: 6, at: 0.5, duration: 1 }
    expect(run({ words: [word({ stretch: ok })] })).not.toThrow()
    expect(run({ words: [word({ stretch: { ...ok, hold: 0.4 } })] })).not.toThrow()
    for (const bad of [{ ...ok, to: 0 }, { ...ok, to: 13 }, { ...ok, duration: 0.05 }, { ...ok, duration: 3.5 }, { ...ok, at: -1 }, { ...ok, hold: -1 }]) {
      expect(errOf(run({ words: [word({ stretch: bad })] }))!.path, JSON.stringify(bad)).toMatch(/^scenes\[0\]\.params\.words\[0\]\.stretch\./)
    }
  })
  it('stretch on a word with no kashida slot is an Arabic-first issue from validateSceneParams', () => {
    const e = errOf(run({ words: [word({ text: 'درود', stretch: { to: 6, at: 0.5, duration: 1 } })] }))!
    expect(e.path).toBe('scenes[0].params.words[0].stretch')
    expect(e.message).toContain('الكلمة «درود» لا تقبل التطويل — word has no kashida slot; use mode "giant" or stress 2 instead')
  })
  it('strike: at >= 0, colour accent | fg', () => {
    expect(run({ words: [word({ strike: { at: 1, color: 'fg' } })] })).not.toThrow()
    expect(errOf(run({ words: [word({ strike: { at: 1, color: 'red' } })] }))!.path).toBe('scenes[0].params.words[0].strike.color')
  })
  it('punch overrides the stress-2 peak: 1.1..1.5 only', () => {
    expect(run({ words: [word({ stress: 2, punch: 1.1 })] })).not.toThrow()
    expect(run({ words: [word({ stress: 2, punch: 1.5 })] })).not.toThrow()
    for (const punch of [1.05, 1.6]) expect(errOf(run({ words: [word({ stress: 2, punch })] }))!.path).toBe('scenes[0].params.words[0].punch')
  })
  it('R17 with the editorial entrances: rise (0.28 s) and mask-line (0.3 s) start early for an early word', () => {
    expect(entranceStart({ at: 0, stress: 0 }, 'rise')).toBeCloseTo(-0.28, 9)
    expect(entranceStart({ at: 0, stress: 0 }, 'mask-line')).toBeCloseTo(-0.3, 9)
    expect(entranceStart({ at: 1, stress: 2 }, 'mask-line')).toBe(1)
    expect(entranceStart({ at: 0, stress: 0 }, 'slide')).toBeCloseTo(-KINETIC_TIMING.slideIn, 9)
  })
  it('cues: action per word, tick at a strike, chime (final) at a stretch; the planner turns them into tap, tick, chime', () => {
    const params = { words: [word({ at: 0.2, strike: { at: 1 }, stretch: { to: 4, at: 1.5, duration: 0.5 } })] }
    const cues = cuesOfKineticText(kineticTextParams.parse(params), { duration: 3 })
    expect(cues).toContainEqual({ t: 0.2, kind: 'action' })
    expect(cues).toContainEqual({ t: 1, kind: 'tick' })
    expect(cues).toContainEqual({ t: 1.5, kind: 'final' })
    const fx = planSfx(sb([{ id: 'k', type: 'kinetic-text', start: 0, duration: 3, params }]), { fps: 30 })
    expect(fx.map((c) => [c.sfx, c.at])).toEqual([['tap', 0.2], ['tick', 1], ['chime', 1.5]])
  })
})

describe('Plan 2a+ Task 4 params: section-number, word-wall, highlight word/strike, counter strike, word box', () => {
  const sectionScene = (params: unknown) => [{ id: 's', type: 'section-number', start: 0, duration: 3, params }]
  it('section-number: defaults, number 1..99, size 0.3..0.9, title 1..40 characters', () => {
    expect(sectionNumberParams.parse({ number: 4, title: 'السبب' })).toEqual({
      number: 4,
      title: 'السبب',
      size: 0.7,
      digits: 'arabic',
      enter: 'mask-line',
      ease: 'out',
    })
    expect(sectionNumberParams.safeParse({ number: 99, title: 'x', at: { x: 0.5, y: 0.3 } }).success).toBe(true)
    for (const number of [0, 100, 1.5]) expect(sectionNumberParams.safeParse({ number, title: 'x' }).success).toBe(false)
    expect(sectionNumberParams.safeParse({ number: 1, title: 'x', size: 0.95 }).success).toBe(false)
    expect(sectionNumberParams.safeParse({ number: 1, title: 'ا'.repeat(41) }).success).toBe(false)
    expect(pathOf(() => validateSceneParams(sb(sectionScene({ number: 100, title: 'x' }))))).toBe('scenes[0].params.number')
  })
  it('section-number cue: an impact (-12 dB) as the entrance ends, planned as an impact clip', () => {
    const p = sectionNumberParams.parse({ number: 4, title: 'السبب' })
    const cues = cuesOfSectionNumber(p, { duration: 3 })
    expect(cues).toHaveLength(1)
    expect(cues[0]!.kind).toBe('impact')
    const fx = planSfx(sb(sectionScene({ number: 4, title: 'السبب' })), { fps: 30 })
    expect(fx.map((c) => [c.sfx, c.gain])).toEqual([['impact', SECTION_IMPACT_GAIN]])
  })
  it('word-wall: defaults, rows 3..9, cols 1..4, alpha 0.08..0.45, speed 0..60, highlight inside the grid', () => {
    expect(wordWallParams.parse({ text: 'موشن' })).toEqual({ text: 'موشن', rows: 6, cols: 2, speed: 18, alpha: 0.14 })
    expect(wordWallParams.safeParse({ text: 'موشن', rows: 10 }).success).toBe(false)
    expect(wordWallParams.safeParse({ text: 'موشن', rows: 2 }).success).toBe(false)
    expect(wordWallParams.safeParse({ text: 'موشن', cols: 5 }).success).toBe(false)
    expect(wordWallParams.safeParse({ text: 'موشن', alpha: 0.05 }).success).toBe(false)
    expect(wordWallParams.safeParse({ text: 'موشن', alpha: 0.45 }).success).toBe(true)
    expect(wordWallParams.safeParse({ text: 'موشن', alpha: 0.5 }).success).toBe(false)
    expect(wordWallParams.safeParse({ text: 'موشن', speed: 61 }).success).toBe(false)
    expect(wordWallParams.safeParse({ text: 'موشن', rows: 3, cols: 1, highlight: 2 }).success).toBe(true)
    expect(wordWallParams.safeParse({ text: 'موشن', rows: 3, cols: 1, highlight: 3 }).success).toBe(false)
  })
  it('highlight: kinds circle | burst | underline | strike; word together with target or box fails at `word`', () => {
    expect(highlightParams.parse({ kind: 'strike', word: 7 }).word).toBe(7)
    expect(highlightParams.safeParse({ kind: 'box' }).success).toBe(false)
    const both = highlightParams.safeParse({ kind: 'strike', word: 7, target: 'k' })
    expect(both.success).toBe(false)
    expect(both.success ? [] : both.error.issues[0]!.path).toEqual(['word'])
    expect(highlightParams.safeParse({ kind: 'strike', word: 7, box: { x: 0, y: 0, w: 1, h: 1 } }).success).toBe(false)
    expect(highlightParams.safeParse({ kind: 'underline', target: 'k', box: { x: 0, y: 0, w: 1, h: 1 } }).success).toBe(false)
  })
  it('highlight word: a covering earlier kinetic-text word with that index is required (Arabic first)', () => {
    const kin = (word: number) => ({ id: 'k', type: 'kinetic-text', start: 0, duration: 3, params: { words: [{ text: 'وقت', at: 0, word }] } })
    const hl = { id: 'h', type: 'highlight', track: 3, start: 0.5, duration: 1, params: { kind: 'strike', word: 7 } }
    expect(() => validateSceneParams(sb([kin(7), hl]))).not.toThrow()
    let err: StoryboardError | undefined
    try {
      validateSceneParams(sb([kin(6), hl]))
    } catch (e) {
      err = e as StoryboardError
    }
    expect(err?.path).toBe('scenes[1].params.word')
    expect(err?.message).toContain('لا توجد كلمة بالرقم 7 معروضة طوال هذا المشهد — no word 7 shown over this whole scene')
  })
  it('counter strike: at >= the roll; the tick cue is at strike.at', () => {
    expect(counterParams.safeParse({ from: 0, to: 9, roll: 1, strike: { at: 0.5 } }).success).toBe(false)
    const p = counterParams.parse({ from: 0, to: 9, roll: 1, strike: { at: 2 } })
    expect(cuesOfCounter(p, { duration: 3 })).toContainEqual({ t: 2, kind: 'tick' })
  })
  it('kinetic word box: an optional boolean', () => {
    expect(kineticTextParams.parse({ words: [{ text: 'وقت', at: 0, box: true }] }).words[0]!.box).toBe(true)
    expect(kineticTextParams.parse({ words: [{ text: 'وقت', at: 0 }] }).words[0]!.box).toBeUndefined()
  })
})

describe('Plan 2a+ Task 5 transitions: flood and iris', () => {
  const two = (tr: unknown[]) => ({
    version: 1,
    scenes: [
      { id: 'a', type: 'slam', start: 0, duration: 2, params: { text: 'جديد' } },
      { id: 'b', type: 'slam', start: 2, duration: 2, params: { text: 'قديم' } },
    ],
    transitions: tr,
  })
  const known = [...PRIMITIVE_IDS]
  it('flood: defaults (circle, centred, fg, hit false) and duration 0.5', () => {
    const tr = parseStoryboard(two([{ type: 'flood', at: 2 }]), known).transitions![0]!
    expect(tr.duration).toBe(0.5)
    expect(tr.params).toEqual({ hit: false, shape: 'circle', origin: { x: 0.5, y: 0.5 }, color: 'fg' })
  })
  it('iris: defaults (bg, open, centred, hit false) and duration 0.45', () => {
    const tr = parseStoryboard(two([{ type: 'iris', at: 2 }]), known).transitions![0]!
    expect(tr.duration).toBe(0.45)
    expect(tr.params).toEqual({ hit: false, origin: { x: 0.5, y: 0.5 }, color: 'bg', direction: 'open' })
  })
  it('origin outside 0..1 is rejected at origin.x / origin.y', () => {
    expect(pathOf(() => parseStoryboard(two([{ type: 'flood', at: 2, params: { origin: { x: 1.2, y: 0.5 } } }]), known))).toBe(
      'transitions[0].params.origin.x',
    )
    expect(pathOf(() => parseStoryboard(two([{ type: 'iris', at: 2, params: { origin: { x: 0.5, y: -0.1 } } }]), known))).toBe(
      'transitions[0].params.origin.y',
    )
  })
  it('unknown shape / direction / colour are rejected', () => {
    expect(pathOf(() => parseStoryboard(two([{ type: 'flood', at: 2, params: { shape: 'star' } }]), known))).toBe('transitions[0].params.shape')
    expect(pathOf(() => parseStoryboard(two([{ type: 'iris', at: 2, params: { direction: 'in' } }]), known))).toBe('transitions[0].params.direction')
  })
  it('sound: flood hit -> riser + impact on the cut; plain flood -> a mallet on the cut; iris is silent', () => {
    const fx = (tr: unknown) =>
      planSfx(parseStoryboard(two([tr]), known), { fps: 30 })
        .filter((c) => c.kind === 'sfx' && c.at >= 1.3 && c.at <= 2.1)
        .map((c) => [c.sfx, c.at])
    expect(fx({ type: 'flood', at: 2, params: { hit: true } })).toEqual([['riser', 1.4], ['impact', 2]])
    expect(fx({ type: 'flood', at: 2 })).toEqual([['mallet', 2]])
    expect(fx({ type: 'iris', at: 2 })).toEqual([])
  })
})

describe('Plan 2a+ Task 7 params: shape-states', () => {
  const states = [
    { at: 0, kind: 'button', label: 'ابدأ' },
    { at: 1.5, kind: 'card', label: 'الخطة' },
    { at: 3, kind: 'toggle', on: true },
  ]
  const scene = (params: unknown) => [{ id: 's', type: 'shape-states', start: 0, duration: 4, params }]
  it('defaults: size 0.6, cursor on, snappy; 2..8 states', () => {
    expect(shapeStatesParams.parse({ states })).toEqual({ states, size: 0.6, cursor: true, spring: 'snappy' })
    expect(shapeStatesParams.safeParse({ states, size: 0.2 }).success).toBe(false)
    expect(shapeStatesParams.safeParse({ states, size: 0.95 }).success).toBe(false)
    expect(shapeStatesParams.safeParse({ states, at: { x: 0.5, y: 0.4 }, spring: 'soft' }).success).toBe(true)
    expect(shapeStatesParams.safeParse({ states: [{ at: 0, kind: 'pill', label: 'x'.repeat(25) }, { at: 1, kind: 'pill' }] }).success).toBe(false)
    expect(shapeStatesParams.safeParse({ states: Array.from({ length: 9 }, (_, i) => ({ at: i, kind: 'chip' })) }).success).toBe(false)
  })
  it('one state is an error at states; a non-increasing at names its index', () => {
    expect(pathOf(() => validateSceneParams(sb(scene({ states: [states[0]] }))))).toBe('scenes[0].params.states')
    expect(pathOf(() => validateSceneParams(sb(scene({ states: [states[0], states[1], { at: 1.5, kind: 'pill' }] }))))).toBe('scenes[0].params.states[2].at')
    expect(pathOf(() => validateSceneParams(sb(scene({ states: [{ at: 1, kind: 'pill' }, { at: 0.5, kind: 'pill' }] }))))).toBe('scenes[0].params.states[1].at')
  })
  it('a state at or after the scene end is refused in Node, naming the index', () => {
    expect(pathOf(() => validateSceneParams(sb(scene({ states: [states[0], { at: 4, kind: 'chip' }] }))))).toBe('scenes[0].params.states[1].at')
    expect(() => validateSceneParams(sb(scene({ states })))).not.toThrow()
  })
  it('geometry table is the brief, and the shape IS the state at its at (closed form, pure in t)', () => {
    expect(STATE_GEOMETRY.card).toEqual({ w: 1, h: 0.55, r: 0.06 })
    expect(STATE_GEOMETRY.check).toEqual({ w: 0.14, h: 0.14, r: 1 })
    const p = shapeStatesParams.parse({ states })
    const card = shapeAt(p, 1.5)
    expect(card.w).toBeCloseTo(1, 6)
    expect(card.h).toBeCloseTo(0.55, 6)
    const mid = shapeAt(p, 1.35)
    expect(mid.w).toBeGreaterThan(0.55)
    expect(mid.w).not.toBeCloseTo(1, 2)
    expect(shapeAt(p, 3).knob).toBeCloseTo(1, 6)
    expect(shapeAt(p, 3).pos).toBeCloseTo(1, 6)
    expect(shapeAt(p, 1.2)).toEqual(shapeAt(p, 1.2))
    expect(shapeAt(p, 0.9).w).toBeCloseTo(0.55, 9)
  })
  it('cues: a tap at every state change, a chime after a check; none for the first state', () => {
    const p = shapeStatesParams.parse({ states })
    expect(cuesOfShapeStates(p, { duration: 4 })).toEqual([{ t: 1.5, kind: 'action' }, { t: 3, kind: 'action' }])
    const q = shapeStatesParams.parse({ states: [{ at: 0, kind: 'button' }, { at: 1, kind: 'check' }] })
    expect(cuesOfShapeStates(q, { duration: 3 })).toEqual([{ t: 1, kind: 'action' }, { t: 1.1, kind: 'final' }])
    const fx = planSfx(sb(scene({ states })), { fps: 30 })
    expect(fx.map((c) => [c.sfx, c.at])).toEqual([['tap', 1.5], ['tap', 3]])
  })
})

describe('Plan 3 Task 3 params: morph-object', () => {
  const dot = { at: 0, object: 'dot', x: 0.5, y: 0.5, size: 0.04 }
  const coin = { at: 1, object: 'coin', x: 0.5, y: 0.6, size: 0.38, spin: 1 }
  const scene = (params: unknown) => [{ id: 'm', type: 'morph-object', start: 0, duration: 3, params }]
  const SAFE = { x: 64.8, y: 268.8, w: 885.6, h: 1228.8 }
  it('defaults: currency AED, glow on, no rings; 1..12 states; size 0.04..0.9', () => {
    expect(morphObjectParams.parse({ states: [dot] })).toEqual({ states: [dot], currency: 'AED', glow: true, rings: [] })
    expect(morphObjectParams.safeParse({ states: [] }).success).toBe(false)
    expect(morphObjectParams.safeParse({ states: Array.from({ length: 13 }, (_, i) => ({ ...dot, at: i })) }).success).toBe(false)
    expect(morphObjectParams.safeParse({ states: [{ ...dot, size: 0.03 }] }).success).toBe(false)
    expect(morphObjectParams.safeParse({ states: [{ ...dot, size: 0.91 }] }).success).toBe(false)
    expect(morphObjectParams.safeParse({ states: [dot, coin], currency: 'usd', glow: false, rings: [0.2, 1.4], key: 'k' }).success).toBe(true)
  })
  it('a non-increasing at names its index; an unknown object is an enum error at its field', () => {
    expect(pathOf(() => validateSceneParams(sb(scene({ states: [dot, coin, { ...coin, at: 1 }] }))))).toBe('scenes[0].params.states[2].at')
    expect(pathOf(() => validateSceneParams(sb(scene({ states: [{ ...dot, at: 1 }, { ...coin, at: 0.5 }] }))))).toBe('scenes[0].params.states[1].at')
    let msg = ''
    try {
      validateSceneParams(sb(scene({ states: [{ ...dot, object: 'star' }] })))
    } catch (e) {
      expect(e).toBeInstanceOf(StoryboardError)
      expect((e as StoryboardError).path).toBe('scenes[0].params.states[0].object')
      msg = (e as Error).message
    }
    expect(msg).toMatch(/[؀-ۿ].* — .*dot, ring, bar, clock, coin/)
  })
  it('an unknown currency warns (Arabic first) and falls back to AED', () => {
    const warnings: string[] = []
    validateSceneParams(sb(scene({ states: [dot], currency: 'XYZ' })), warnings)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^[؀-ۿ].* — .*XYZ.*AED/)
  })
  it('softSpring is the prototype ease: 0 → 1 exactly at the ends, overshoots in between', () => {
    expect(softSpring(0)).toBe(0)
    expect(softSpring(1)).toBe(1)
    expect(Math.max(...Array.from({ length: 99 }, (_, i) => softSpring((i + 1) / 100)))).toBeGreaterThan(1.05)
  })
  it('pose: the move starts at at − 0.35 and the object IS the state at its at; land squashes after it (pure in t)', () => {
    const p = morphObjectParams.parse({ states: [dot, { ...coin, land: true }] })
    expect(MORPH_OBJECT.lead).toBe(0.35)
    const end = 3
    const atDot = morphObjectPose(p, 0.6, end, SAFE)
    expect(atDot.to).toBe(0)
    expect(atDot.size).toBeCloseTo(0.04 * SAFE.w, 6)
    const arrived = morphObjectPose(p, 1, end, SAFE)
    expect(arrived).toMatchObject({ from: 0, to: 1, u: 1 })
    expect(arrived.size).toBeCloseTo(0.38 * SAFE.w, 6)
    expect(arrived.x).toBeCloseTo(SAFE.x + 0.5 * SAFE.w, 6)
    expect(arrived.sx).toBeCloseTo(1.45, 6)
    expect(arrived.sy).toBeCloseTo(0.58, 6)
    const mid = morphObjectPose(p, 0.7, end, SAFE)
    expect(mid.size).toBeGreaterThan(0.04 * SAFE.w)
    expect(mid.size).toBeLessThan(0.38 * SAFE.w)
    expect(mid.fade).toBeLessThan(1)
    expect(morphObjectPose(p, 0.9, end, SAFE).fade).toBe(0)
    expect(morphObjectPose(p, 1.2, end, SAFE).build).toBeCloseTo(0.5, 6)
    expect(morphObjectPose(p, 1.4, end, SAFE).build).toBe(1)
    expect(morphObjectPose(p, 2.5, end, SAFE).sx).toBeCloseTo(1, 3)
    expect(morphObjectPose(p, 3, end, SAFE).angleTo).toBeCloseTo(2 * Math.PI, 6)
    expect(morphObjectPose(p, 0.83, end, SAFE)).toEqual(morphObjectPose(p, 0.83, end, SAFE))
  })
  it('cues: a tap at every state at, a chime when a coin or clock finishes building', () => {
    const p = morphObjectParams.parse({ states: [dot, coin, { at: 2, object: 'clock', x: 0.5, y: 0.5, size: 0.3 }, { at: 2.6, object: 'ring', x: 0.5, y: 0.5, size: 0.2 }] })
    expect(cuesOfMorphObject(p, { duration: 4 })).toEqual([
      { t: 0, kind: 'action' },
      { t: 1, kind: 'action' },
      { t: 1 + MORPH_OBJECT.buildSec, kind: 'final' },
      { t: 2, kind: 'action' },
      { t: 2 + MORPH_OBJECT.buildSec, kind: 'final' },
      { t: 2.6, kind: 'action' },
    ])
    const fx = planSfx(sb(scene({ states: [dot, coin] })), { fps: 30 })
    expect(fx.map((c) => [c.sfx, c.at])).toEqual([['tap', 0], ['tap', 1], ['chime', 1.4]])
  })
})

describe('Plan 3 Task 5 params: particle-word', () => {
  const SAFE = { x: 64.8, y: 268.8, w: 885.6, h: 1228.8 }
  const kinetic = { id: 'k', type: 'kinetic-text', start: 0, duration: 3, params: { words: [{ text: 'موشن', at: 1.2, key: 'w-moshn' }], mode: 'giant' } }
  const hero = { id: 'h', type: 'morph-object', start: 0, duration: 3, params: { states: [{ at: 0, object: 'dot', x: 0.5, y: 0.5, size: 0.04 }] } }
  const pw = (params: unknown, duration = 3) => ({ id: 'p', type: 'particle-word', start: 0, duration, params })
  const base = { target: 'w-moshn', from: { x: 0.5, y: 0.5 }, burst: 0.2, land: 1.2 }

  it('parses; from is a scene id or a safe-area point; count ≤ 6000', () => {
    expect(particleWordParams.parse(base)).toEqual(base)
    expect(particleWordParams.parse({ ...base, from: { scene: 'h' }, count: 6000 })).toEqual({ ...base, from: { scene: 'h' }, count: 6000 })
    expect(particleWordParams.safeParse({ ...base, from: { x: 1.2, y: 0.5 } }).success).toBe(false)
    expect(particleWordParams.safeParse({ ...base, from: {} }).success).toBe(false)
  })
  it('land ≤ burst + 0.3 is an error at land; count 9000 is an error at count (Arabic first)', () => {
    const errOf = (params: unknown) => {
      try {
        validateSceneParams(sb([kinetic, pw(params)]))
      } catch (e) {
        expect(e).toBeInstanceOf(StoryboardError)
        return { path: (e as StoryboardError).path, msg: (e as Error).message }
      }
      return undefined
    }
    const land = errOf({ ...base, land: 0.5 })
    expect(land?.path).toBe('scenes[1].params.land')
    expect(land?.msg).toMatch(/: [؀-ۿ][^—]* — .*land/)
    expect(errOf({ ...base, land: 0.2 + 0.3 })?.path).toBe('scenes[1].params.land')
    const count = errOf({ ...base, count: 9000 })
    expect(count?.path).toBe('scenes[1].params.count')
    expect(count?.msg).toMatch(/: [؀-ۿ][^—]* — .*6000/)
    expect(errOf(base)).toBeUndefined()
  })
  it('the target key must be in an earlier scene shown over the whole scene; from.scene must be a morph-object; land before the scene end', () => {
    const pathOfSb = (scenes: unknown[]) => pathOf(() => validateSceneParams(sb(scenes)))
    expect(pathOfSb([kinetic, pw({ ...base, target: 'nope' })])).toBe('scenes[1].params.target')
    expect(pathOfSb([pw(base), kinetic])).toBe('scenes[0].params.target')
    expect(pathOfSb([kinetic, hero, pw({ ...base, from: { scene: 'h' } })])).toBeUndefined()
    expect(pathOfSb([kinetic, hero, pw({ ...base, from: { scene: 'k' } })])).toBe('scenes[2].params.from.scene')
    expect(pathOfSb([kinetic, hero, pw({ ...base, from: { scene: 'zz' } })])).toBe('scenes[2].params.from.scene')
    expect(pathOfSb([{ ...kinetic, duration: 1, params: { ...kinetic.params, words: [{ text: 'موشن', at: 0.5, key: 'w-moshn' }] } }, pw(base, 1)])).toBe('scenes[1].params.land')
  })
  it('grid step: count ≈ ink area / 18, capped at 6000 (or the given count)', () => {
    expect(particleStep(36000)).toBeCloseTo(Math.sqrt(18), 9)
    expect(particleStep(36000 * 18) ** 2).toBeCloseTo((36000 * 18) / 6000, 6)
    expect(particleStep(36000, 500) ** 2).toBeCloseTo(36000 / 500, 6)
    expect(particleStep(36000, 9000)).toBeCloseTo(Math.sqrt(18), 9)
  })
  it('motion is closed form: nothing before the burst, out of the source at the burst, on target by land, inside the safe area', () => {
    const r = makeRng(5)
    const targets = Array.from({ length: 400 }, () => ({ x: SAFE.x + 200 + r() * 480, y: SAFE.y + 300 + r() * 300 }))
    const p = particleWordParams.parse(base)
    const parts = makeParticles(targets, makeRng(9), p, 4)
    const from = { x: SAFE.x + 0.5 * SAFE.w, y: SAFE.y + 0.5 * SAFE.h }
    for (const [k, q] of parts.entries()) {
      expect(q.delay + q.dur).toBeLessThanOrEqual(p.land - p.burst + 1e-9)
      expect(particleAt(q, from, p.burst - 0.01, p, SAFE)).toBeUndefined()
      const start = particleAt(q, from, p.burst, p, SAFE)
      if (start) expect(Math.hypot(start.x - from.x, start.y - from.y)).toBeLessThan(12)
      const landed = particleAt(q, from, p.land, p, SAFE)!
      expect(Math.hypot(landed.x - targets[k]!.x, landed.y - targets[k]!.y)).toBeLessThanOrEqual(PARTICLE_WORD.wobble.amp + 1e-9)
      for (let t = p.burst; t <= p.land + 0.3; t += 0.05) {
        const at = particleAt(q, from, t, p, SAFE)
        if (!at) continue
        expect(at.x).toBeGreaterThanOrEqual(SAFE.x)
        expect(at.x).toBeLessThanOrEqual(SAFE.x + SAFE.w)
        expect(at.y).toBeGreaterThanOrEqual(SAFE.y)
        expect(at.y).toBeLessThanOrEqual(SAFE.y + SAFE.h)
        expect(particleAt(q, from, t, p, SAFE)).toEqual(at)
      }
    }
    expect(particleAlpha(p, p.land)).toBe(1)
    expect(particleAlpha(p, p.land + PARTICLE_WORD.fade / 2)).toBeCloseTo(0.5, 9)
    expect(particleAlpha(p, p.land + PARTICLE_WORD.fade)).toBe(0)
    expect(particleAlpha(p, p.burst - 0.01)).toBe(0)
  })
  it('cues: whoosh at the burst, impact (−12 dB) at the land', () => {
    const p = particleWordParams.parse(base)
    expect(cuesOfParticleWord(p, { duration: 3 })).toEqual([
      { t: 0.2, kind: 'whoosh' },
      { t: 1.2, kind: 'impact' },
    ])
    const fx = planSfx(sb([kinetic, pw(base)]), { fps: 30 })
    expect(fx.map((c) => [c.sfx, c.at, c.gain])).toEqual([['riser', 0.2, SFX_GAIN.riser], ['impact', 1.2, -12]])
    expect(fx[0]).toMatchObject({ duration: WHOOSH.sec, align: 'end' })
  })
})

describe('Plan 3 Task 6 transitions: reveal', () => {
  const two = (tr: unknown[]) => ({
    version: 1,
    scenes: [
      { id: 'a', type: 'slam', start: 0, duration: 2, params: { text: 'جديد' } },
      { id: 'b', type: 'slam', start: 2, duration: 2, params: { text: 'قديم' } },
    ],
    transitions: tr,
  })
  const known = [...PRIMITIVE_IDS]
  it('defaults: circle from (0.5, 0.45), ring on, hit false; duration 0.42', () => {
    const tr = parseStoryboard(two([{ type: 'reveal', at: 2 }]), known).transitions![0]!
    expect(tr.duration).toBe(0.42)
    expect(tr.params).toEqual({ hit: false, shape: 'circle', origin: { x: 0.5, y: 0.45 }, ring: true })
  })
  it('bands and panel are accepted; an unknown shape or an origin outside 0..1 is rejected', () => {
    for (const shape of ['bands', 'panel']) {
      expect(parseStoryboard(two([{ type: 'reveal', at: 2, params: { shape } }]), known).transitions![0]!.params.shape).toBe(shape)
    }
    expect(pathOf(() => parseStoryboard(two([{ type: 'reveal', at: 2, params: { shape: 'star' } }]), known))).toBe('transitions[0].params.shape')
    expect(pathOf(() => parseStoryboard(two([{ type: 'reveal', at: 2, params: { origin: { x: 0.5, y: 1.5 } } }]), known))).toBe(
      'transitions[0].params.origin.y',
    )
  })
  it('sound: a whoosh at the window start; an impact at the window end only with hit (no riser into the cut)', () => {
    const fx = (tr: unknown) =>
      planSfx(parseStoryboard(two([tr]), known), { fps: 30 })
        .filter((c) => c.kind === 'sfx' && c.at >= 1.3 && c.at <= 2.3)
        .map((c) => [c.sfx, c.at])
    // Window 1.79–2.21, snapped to frames at 30 fps: 1.8 and 2.2.
    expect(fx({ type: 'reveal', at: 2 })).toEqual([['riser', 1.8]])
    expect(fx({ type: 'reveal', at: 2, params: { hit: true } })).toEqual([['riser', 1.8], ['impact', 2.2]])
    const whoosh = planSfx(parseStoryboard(two([{ type: 'reveal', at: 2 }]), known), { fps: 30 }).find((c) => c.sfx === 'riser')!
    expect(whoosh).toMatchObject({ duration: WHOOSH.sec, align: 'end', fadeOut: WHOOSH.fadeOut, gain: SFX_GAIN.riser })
  })
  it('cutCue: a reveal is never a hard cut, even with hit', () => {
    expect(cutCue({ type: 'reveal', at: 2, params: { hit: true } })).toBeNull()
    expect(cutCue({ type: 'flood', at: 2, params: { hit: true } })).toEqual({ riserAt: 1.4, impactAt: 2 })
  })
})

describe('Plan 3 Task 6b params: meaningful objects (document, microphone, timeline) and repeat-loop', () => {
  const SAFE = { x: 64.8, y: 268.8, w: 885.6, h: 1228.8 }
  const dot = { at: 0, object: 'dot', x: 0.5, y: 0.5, size: 0.04 }
  const scene = (params: unknown, duration = 4) => [{ id: 'm', type: 'morph-object', start: 0, duration, params }]

  it('morph-object: the new objects parse; a state takes text (one line) and levels (0..1, at most 3600 values)', () => {
    for (const object of ['document', 'microphone', 'timeline']) {
      expect(morphObjectParams.safeParse({ states: [dot, { at: 1, object, x: 0.5, y: 0.5, size: 0.4 }] }).success, object).toBe(true)
    }
    const doc = { at: 1, object: 'document', x: 0.5, y: 0.5, size: 0.4, text: 'السكربت' }
    expect(morphObjectParams.parse({ states: [dot, doc] }).states[1]!.text).toBe('السكربت')
    expect(morphObjectParams.parse({ states: [dot] }).states[0]).toEqual(dot)
    expect(morphObjectParams.safeParse({ states: [{ ...doc, text: 'سطر' + String.fromCharCode(10) + 'ثان' }] }).success).toBe(false)
    const mic = { at: 1, object: 'microphone', x: 0.5, y: 0.5, size: 0.4, levels: [0, 0.5, 1] }
    expect(morphObjectParams.parse({ states: [dot, mic] }).states[1]!.levels).toEqual([0, 0.5, 1])
    expect(morphObjectParams.safeParse({ states: [dot, { ...mic, levels: [0, 1.2] }] }).success).toBe(false)
    expect(morphObjectParams.safeParse({ states: [dot, { ...mic, levels: [-0.1] }] }).success).toBe(false)
    expect(morphObjectParams.safeParse({ states: [dot, { ...mic, levels: new Array(3601).fill(0.5) }] }).success).toBe(false)
    expect(pathOf(() => validateSceneParams(sb(scene({ states: [dot, { ...mic, levels: [0, 2] }] }))))).toBe('scenes[0].params.states[1].levels[1]')
  })

  it('levelAt: levels[round(since · 30)], clamped at both ends (pure in t); undefined without levels', () => {
    const lv = [0, 0.1, 0.2, 0.3]
    expect(levelAt(lv, 0)).toBe(0)
    expect(levelAt(lv, 1 / 30)).toBe(0.1)
    expect(levelAt(lv, 2.4 / 30)).toBe(0.2)
    expect(levelAt(lv, 2.6 / 30)).toBe(0.3)
    expect(levelAt(lv, -1)).toBe(0)
    expect(levelAt(lv, 99)).toBe(0.3)
    expect(levelAt(undefined, 1)).toBeUndefined()
    expect(levelAt([], 1)).toBeUndefined()
  })

  it('build spans: the document writes over 0.8 s, the microphone and timeline build over their own spans; old objects keep 0.4 s', () => {
    expect(OBJECT_BUILD_SEC.document).toBe(0.8)
    for (const id of ['dot', 'ring', 'bar', 'clock', 'coin'] as const) expect(OBJECT_BUILD_SEC[id] ?? MORPH_OBJECT.buildSec).toBe(0.4)
    const p = morphObjectParams.parse({ states: [dot, { at: 1, object: 'document', x: 0.5, y: 0.5, size: 0.4 }] })
    expect(morphObjectPose(p, 1.4, 4, SAFE).build).toBeCloseTo(0.5, 6)
    expect(morphObjectPose(p, 1.8, 4, SAFE).build).toBe(1)
    const tl = morphObjectParams.parse({ states: [dot, { at: 1, object: 'timeline', x: 0.5, y: 0.5, size: 0.4 }] })
    expect(morphObjectPose(tl, 1 + OBJECT_BUILD_SEC.timeline! / 2, 4, SAFE).build).toBeCloseTo(0.5, 6)
  })

  it('timeline: three seeded cuts inside the state (the first opens before the build ends), each a tick cue planned as a tick', () => {
    const tl = { at: 1, object: 'timeline', x: 0.5, y: 0.5, size: 0.4 }
    const p = morphObjectParams.parse({ states: [dot, tl] })
    const cuts = timelineCuts(p, 1, 4)
    expect(cuts).toHaveLength(3)
    expect(cuts).toEqual(timelineCuts(p, 1, 4))
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]!).toBeGreaterThan(cuts[i - 1]! + 0.2)
    expect(cuts[0]!).toBeGreaterThan(1)
    expect(cuts[0]! + TIMELINE.gapSec).toBeLessThanOrEqual(1 + OBJECT_BUILD_SEC.timeline!)
    expect(cuts[2]!).toBeLessThan(4)
    expect(timelineCuts(p, 0, 4)).toEqual([])
    expect(cuesOfMorphObject(p, { duration: 4 })).toEqual([{ t: 0, kind: 'action' }, { t: 1, kind: 'action' }, ...cuts.map((t) => ({ t, kind: 'tick' }))])
    const fx = planSfx(sb(scene({ states: [dot, tl] })), { fps: 30 })
    expect(fx.filter((c) => c.sfx === 'tick')).toHaveLength(3)
    // A move away before the later cuts drops them (no tick for a cut that never shows).
    const away = morphObjectParams.parse({ states: [dot, tl, { ...dot, at: cuts[1]! + 0.1 }] })
    const left = timelineCuts(away, 1, 4)
    expect(left.length).toBeLessThan(3)
    for (const t of left) expect(t).toBeLessThan(cuts[1]! + 0.1 - MORPH_OBJECT.lead)
  })

  it('repeat-loop: defaults (centre, size 0.6, 7 copies, 1.5 turns, stack); copies 3..12, size 0.2..0.9, mode stack | orbit', () => {
    expect(repeatLoopParams.parse({ text: 'مكرر' })).toEqual({ text: 'مكرر', at: { x: 0.5, y: 0.5 }, size: 0.6, copies: 7, turns: 1.5, mode: 'stack' })
    expect(repeatLoopParams.safeParse({ text: 'مكرر', copies: 13 }).success).toBe(false)
    expect(repeatLoopParams.safeParse({ text: 'مكرر', copies: 2 }).success).toBe(false)
    expect(repeatLoopParams.safeParse({ text: 'مكرر', copies: 12, mode: 'orbit', size: 0.9, turns: -2, at: { x: 0.3, y: 0.7 }, key: 'k' }).success).toBe(true)
    expect(repeatLoopParams.safeParse({ text: 'مكرر', size: 0.15 }).success).toBe(false)
    expect(repeatLoopParams.safeParse({ text: 'مكرر', size: 0.95 }).success).toBe(false)
    expect(repeatLoopParams.safeParse({ text: 'مكرر', mode: 'spiral' }).success).toBe(false)
    expect(repeatLoopParams.safeParse({ text: 'ا'.repeat(25) }).success).toBe(false)
    expect(pathOf(() => validateSceneParams(sb([{ id: 'r', type: 'repeat-loop', start: 0, duration: 3, params: { text: 'مكرر', copies: 13 } }])))).toBe(
      'scenes[0].params.copies',
    )
  })

  it('repeat-loop cues: a tap per copy entrance, a beat apart, at most 6', () => {
    const seven = cuesOfRepeatLoop(repeatLoopParams.parse({ text: 'مكرر' }), { duration: 3 })
    expect(seven).toHaveLength(6)
    seven.forEach((c, i) => expect(c).toEqual({ t: expect.closeTo(i * REPEAT_LOOP.beat, 9), kind: 'action' }))
    expect(cuesOfRepeatLoop(repeatLoopParams.parse({ text: 'مكرر', copies: 3 }), { duration: 3 })).toHaveLength(3)
    const fx = planSfx(sb([{ id: 'r', type: 'repeat-loop', start: 0, duration: 3, params: { text: 'مكرر', copies: 4 } }]), { fps: 30 })
    expect(fx.map((c) => c.sfx)).toEqual(['tap', 'tap', 'tap', 'tap'])
  })
})

describe('Plan 3 Task 6c params: script objects (calendar, envelope, bell, voice-note, phone-app) and chase', () => {
  const SAFE = { x: 64.8, y: 268.8, w: 885.6, h: 1228.8 }
  const dot = { at: 0, object: 'dot', x: 0.5, y: 0.5, size: 0.04 }
  const scene = (params: unknown, duration = 4) => [{ id: 'm', type: 'morph-object', start: 0, duration, params }]
  const st = (object: string, extra: Record<string, unknown> = {}) => ({ at: 1, object, x: 0.5, y: 0.5, size: 0.4, ...extra })

  it('morph-object: the five script objects parse; flipSec and checkAt are optional positive seconds', () => {
    for (const object of ['calendar', 'envelope', 'bell', 'voice-note', 'phone-app']) {
      expect(morphObjectParams.safeParse({ states: [dot, st(object)] }).success, object).toBe(true)
    }
    expect(morphObjectParams.parse({ states: [dot, st('calendar', { flipSec: 0.6 })] }).states[1]!.flipSec).toBe(0.6)
    expect(morphObjectParams.parse({ states: [dot, st('calendar')] }).states[1]!.flipSec).toBeUndefined()
    expect(morphObjectParams.safeParse({ states: [dot, st('calendar', { flipSec: 0 })] }).success).toBe(false)
    expect(morphObjectParams.safeParse({ states: [dot, st('calendar', { flipSec: -1 })] }).success).toBe(false)
    expect(pathOf(() => validateSceneParams(sb(scene({ states: [dot, st('calendar', { flipSec: 0 })] }))))).toBe('scenes[0].params.states[1].flipSec')
    expect(morphObjectParams.parse({ states: [dot, st('phone-app', { checkAt: 1.5 })] }).states[1]!.checkAt).toBe(1.5)
    expect(morphObjectParams.safeParse({ states: [dot, st('phone-app', { checkAt: 0 })] }).success).toBe(false)
    expect(pathOf(() => validateSceneParams(sb(scene({ states: [dot, st('phone-app', { checkAt: -0.2 })] }))))).toBe('scenes[0].params.states[1].checkAt')
    // the messages are Arabic first
    const r = morphObjectParams.safeParse({ states: [dot, st('calendar', { flipSec: 0 })] })
    expect(r.success ? '' : r.error.issues[0]!.message).toMatch(/^[؀-ۿ].* — /)
  })

  it('defaults: a calendar page flips every 0.45 s; the phone notification comes at +0.4 s and the check at +1.2 s', () => {
    expect(CALENDAR.flipSec).toBe(0.45)
    expect(PHONE_APP.notifyAt).toBe(0.4)
    expect(PHONE_APP.checkAt).toBe(1.2)
  })

  it('size caps keep the wide script objects inside the frame; the older objects are never capped', () => {
    const p = morphObjectParams.parse({ states: [dot, st('voice-note', { size: 0.9 })] })
    expect(morphObjectPose(p, 2, 4, SAFE).size).toBeCloseTo(OBJECT_SIZE_CAP['voice-note']! * SAFE.w, 6)
    for (const [id, cap] of Object.entries(OBJECT_SIZE_CAP)) expect(cap, id).toBeLessThan(0.9)
    for (const id of ['dot', 'ring', 'bar', 'clock', 'coin', 'document', 'microphone', 'timeline'] as const) expect(OBJECT_SIZE_CAP[id]).toBeUndefined()
    const coin = morphObjectParams.parse({ states: [dot, { ...st('coin'), size: 0.9 }] })
    expect(morphObjectPose(coin, 2, 4, SAFE).size).toBeCloseTo(0.9 * SAFE.w, 6)
  })

  it('phone-app: a chime when the paid check lands (at + checkAt), none when a move away starts first', () => {
    const p = morphObjectParams.parse({ states: [dot, st('phone-app')] })
    expect(phoneCheckCues(p, 4)).toEqual([1 + 1.2])
    expect(cuesOfMorphObject(p, { duration: 4 })).toEqual([{ t: 0, kind: 'action' }, { t: 1, kind: 'action' }, { t: 2.2, kind: 'final' }])
    const late = morphObjectParams.parse({ states: [dot, st('phone-app', { checkAt: 1.6 })] })
    expect(phoneCheckCues(late, 4)).toEqual([2.6])
    const away = morphObjectParams.parse({ states: [dot, st('phone-app'), { ...dot, at: 2.1 }] })
    expect(phoneCheckCues(away, 4)).toEqual([])
    expect(planSfx(sb(scene({ states: [dot, st('phone-app')] })), { fps: 30 }).filter((c) => c.sfx === 'chime')).toHaveLength(1)
  })

  it('Stage 1A: the house-reel objects parse; their builds, second-beat defaults (checkAtOf) and the chat size cap', () => {
    for (const object of ['brick', 'house', 'blueprint', 'eye', 'photo', 'chat']) {
      expect(morphObjectParams.safeParse({ states: [dot, st(object)] }).success, object).toBe(true)
    }
    expect(morphObjectParams.parse({ states: [dot, st('brick', { text: 'fall' })] }).states[1]!.text).toBe('fall')
    expect([OBJECT_BUILD_SEC.brick, OBJECT_BUILD_SEC.house, OBJECT_BUILD_SEC.blueprint, OBJECT_BUILD_SEC.photo]).toEqual([0.5, 1.0, 1.2, 0.6])
    expect(OBJECT_BUILD_SEC.eye).toBeUndefined()
    expect(OBJECT_BUILD_SEC.chat).toBeUndefined()
    expect([checkAtOf('house'), checkAtOf('blueprint'), checkAtOf('eye'), checkAtOf('chat'), checkAtOf('phone-app')]).toEqual([0.9, 1.6, 0.6, 0.5, 1.2])
    expect([HOUSE.checkAt, BLUEPRINT.checkAt, EYE.checkAt, CHAT.checkAt]).toEqual([0.9, 1.6, 0.6, 0.5])
    expect([HOUSE.lightEvery, BLUEPRINT.scrambleEvery, BLUEPRINT.signSec, EYE.closeSec, EYE.slashSec, PHOTO.bracketFrom, PHOTO.flashSec, PHOTO.developSec]).toEqual([0.12, 0.09, 0.6, 0.18, 0.25, 1.25, 0.3, 0.4])
    const p = morphObjectParams.parse({ states: [dot, st('chat', { size: 0.9 })] })
    expect(morphObjectPose(p, 2, 4, SAFE).size).toBeCloseTo(OBJECT_SIZE_CAP.chat! * SAFE.w, 6)
    // the IQD coin parses without a warning-worthy unknown code
    expect(morphObjectParams.parse({ states: [dot], currency: 'iqd' }).currency).toBe('iqd')
  })

  it('chase: defaults (4 customers, centre, size 0.6, 1.2 laps); customers 3..7, size 0.3..0.9', () => {
    expect(chaseParams.parse({})).toEqual({ customers: 4, at: { x: 0.5, y: 0.5 }, size: 0.6, laps: 1.2 })
    expect(chaseParams.safeParse({ customers: 9 }).success).toBe(false)
    expect(chaseParams.safeParse({ customers: 2 }).success).toBe(false)
    expect(chaseParams.safeParse({ customers: 3.5 }).success).toBe(false)
    expect(chaseParams.safeParse({ size: 0.2 }).success).toBe(false)
    expect(chaseParams.safeParse({ size: 0.95 }).success).toBe(false)
    expect(chaseParams.safeParse({ customers: 7, size: 0.9, laps: 3, at: { x: 0.3, y: 0.6 }, key: 'k' }).success).toBe(true)
    expect(pathOf(() => validateSceneParams(sb([{ id: 'c', type: 'chase', start: 0, duration: 3, params: { customers: 9 } }])))).toBe('scenes[0].params.customers')
  })

  it('chase cues: a tap every 0.4 s inside the scene, at most 6', () => {
    const p = chaseParams.parse({})
    expect(cuesOfChase(p, { duration: 4 })).toEqual([0, 0.4, 0.8, 1.2, 1.6, 2].map((t) => ({ t: expect.closeTo(t, 9), kind: 'action' })))
    expect(cuesOfChase(p, { duration: 1 })).toHaveLength(3)
    expect(CHASE.maxTaps).toBe(6)
    const fx = planSfx(sb([{ id: 'c', type: 'chase', start: 0, duration: 1, params: {} }]), { fps: 30 })
    expect(fx.map((c) => c.sfx)).toEqual(['tap', 'tap', 'tap'])
  })

  it('chase pose: pure; the figures move; the pursuer gains but never catches (≥ 0.05 safe widths from the nearest figure)', () => {
    for (const [seed, customers, size] of [[1, 4, 0.6], [77, 7, 0.3], [123456, 3, 0.9], [9, 7, 0.45]] as const) {
      const p = chaseParams.parse({ customers, size })
      const curve = chaseCurve(seed, p, SAFE)
      expect(chasePose(p, curve, 1.3, 4)).toEqual(chasePose(p, curve, 1.3, 4))
      let minD = Infinity
      const gaps: number[] = []
      for (let t = 0; t <= 4; t += 1 / 30) {
        const pose = chasePose(p, curve, t, 4)
        expect(pose.figures).toHaveLength(customers)
        const d = Math.min(...pose.figures.map((f) => Math.hypot(f.x - pose.pursuer.x, f.y - pose.pursuer.y)))
        minD = Math.min(minD, d)
        gaps.push(pose.figures[0]!.s - pose.pursuer.s)
        // the curve stays inside the safe area
        for (const q of [pose.pursuer, ...pose.figures]) {
          expect(q.x).toBeGreaterThan(SAFE.x)
          expect(q.x).toBeLessThan(SAFE.x + SAFE.w)
          expect(q.y).toBeGreaterThan(SAFE.y)
          expect(q.y).toBeLessThan(SAFE.y + SAFE.h)
        }
      }
      expect(minD / SAFE.w, `seed ${seed}`).toBeGreaterThanOrEqual(0.05)
      // the gap oscillates: it closes in and opens again
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.04 * SAFE.w)
      const a = chasePose(p, curve, 1.0, 4)
      const b = chasePose(p, curve, 1.5, 4)
      a.figures.forEach((f, i) => expect(Math.hypot(f.x - b.figures[i]!.x, f.y - b.figures[i]!.y)).toBeGreaterThan(20))
    }
    // a different seed gives a different curve
    const p = chaseParams.parse({})
    expect(chaseCurve(1, p, SAFE).pts).not.toEqual(chaseCurve(2, p, SAFE).pts)
  })
})
