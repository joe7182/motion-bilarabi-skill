import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { contrastRatio } from '../../src/core/palette'
import { backdropParams } from '../../src/core/params/backdrop'
import { resolveWorld, worldColours, worldOf, WORLDS } from '../../src/core/worlds'
import { getLook } from '../../src/runtime/looks'
import { LOOK_IDS } from '../../src/core/storyboard'
import { AUDIO_DEFAULTS, parseStoryboard, sceneAt, storyboardDuration, StoryboardError } from '../../src/core/storyboard'

const known = ['search-typing', 'slam', 'wipe-reveal']
const fixture = (n: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8'))
const s = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'slam', start: 0, duration: 1, params: {}, ...over })
const pathOf = (fn: () => unknown): string | undefined => {
  try { fn() } catch (e) { return (e as StoryboardError).path }
  return undefined
}

describe('storyboard', () => {
  it('applies defaults', () => {
    const sb = parseStoryboard(fixture('minimal.json'), known)
    expect(sb.format).toBe('9:16'); expect(sb.fps).toBe(30); expect(sb.look).toBe('dark-tech')
    expect(sb.dir).toBe('rtl'); expect(sb.seed).toBe(1)
    expect(sb.scenes[0]!.params).toEqual({ text: 'جديد' })
  })
  it('a pack supplies the look unless the storyboard names one', () => {
    const base = { version: 1, scenes: [s('a')] }
    expect(parseStoryboard({ ...base, pack: 'swiss-red' }, known).look).toBe('swiss-red')
    expect(parseStoryboard({ ...base, pack: 'swiss-red', look: 'signature' }, known).look).toBe('signature')
    expect(parseStoryboard(base, known).pack).toBeUndefined()
    expect(parseStoryboard(base, known).look).toBe('dark-tech')
    expect(() => parseStoryboard({ ...base, pack: 'nope' }, known)).toThrow(StoryboardError)
  })
  it('duration is max end, overlap allowed', () => {
    expect(storyboardDuration(parseStoryboard(fixture('three-scenes.json'), known))).toBeCloseTo(7.5)
  })
  it('error is a StoryboardError with path', () => {
    expect(() => parseStoryboard({ version: 1, scenes: [] }, known)).toThrow(StoryboardError)
  })
  it('field paths', () => {
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a', { type: 'nope' })] }, known))).toBe('scenes[0].type')
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a'), s('b', { duration: 0 })] }, known))).toBe('scenes[1].duration')
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a', { start: -1 })] }, known))).toBe('scenes[0].start')
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [] }, known))).toBe('scenes')
    expect(pathOf(() => parseStoryboard({ version: 1 }, known))).toBe('scenes')
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a'), s('a')] }, known))).toBe('scenes[1].id')
    expect(pathOf(() => parseStoryboard({ version: 2, scenes: [s('a')] }, known))).toBe('version')
    expect(pathOf(() => parseStoryboard({ version: 1, fps: 24, scenes: [s('a')] }, known))).toBe('fps')
    expect(pathOf(() => parseStoryboard({ version: 1, format: '2:3', scenes: [s('a')] }, known))).toBe('format')
    expect(pathOf(() => parseStoryboard({ version: 1, dir: 'ltr', scenes: [s('a')] }, known))).toBe('dir')
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a', { params: 5 })] }, known))).toBe('scenes[0].params')
    expect(pathOf(() => parseStoryboard(null, known))).toBe('')
  })
  it('accepts 1:1 and 4:5', () => {
    expect(parseStoryboard({ version: 1, format: '1:1', scenes: [s('a')] }, known).format).toBe('1:1')
    expect(parseStoryboard({ version: 1, format: '4:5', scenes: [s('a')] }, known).format).toBe('4:5')
  })
  it('accepts 60 fps and 16:9', () => {
    const sb = parseStoryboard({ version: 1, fps: 60, format: '16:9', scenes: [s('a')] }, known)
    expect(sb.fps).toBe(60); expect(sb.format).toBe('16:9')
  })
  it('parses brand inside storyboard', () => {
    const sb = parseStoryboard({ version: 1, brand: { name: 'x', handle: '@x', colors: { primary: '#ff5a1f', secondary: '#111111', bg: '#0e0d0c', text: '#f2ece2' } }, scenes: [s('a')] }, known)
    expect(sb.brand?.watermark).toBe(false)
    expect(pathOf(() => parseStoryboard({ version: 1, brand: { name: 'x', handle: '@x', colors: { primary: 'red', secondary: '#111111', bg: '#0e0d0c', text: '#f2ece2' } }, scenes: [s('a')] }, known))).toBe('brand.colors.primary')
  })
})

describe('transitions', () => {
  const two = (tr: unknown[], over: { a?: number; b?: number } = {}) => ({
    version: 1,
    scenes: [s('a', { duration: over.a ?? 2 }), s('b', { start: over.a ?? 2, duration: over.b ?? 2 })],
    transitions: tr,
  })
  const three = (tr: unknown[]) => ({
    version: 1,
    scenes: [s('a', { duration: 1 }), s('b', { start: 1, duration: 0.5 }), s('c', { start: 1.5, duration: 1 })],
    transitions: tr,
  })

  it('every tr fixture parses, with default duration and params', () => {
    for (const id of ['color-wipe', 'whip-pan', 'zoom-through', 'glitch-cut']) {
      const sb = parseStoryboard(fixture(`tr-${id}.json`), known)
      expect(sb.transitions).toHaveLength(1)
      expect(sb.transitions![0]!.type).toBe(id)
      expect(sb.transitions![0]!.duration).toBe(0.4)
      expect(sb.transitions![0]!.params).toBeTypeOf('object')
    }
    const cw = parseStoryboard(fixture('tr-color-wipe.json'), known).transitions![0]!
    expect(cw.params).toEqual({ hit: false, color: 'accent', direction: 'rtl' })
    const up = parseStoryboard(fixture('tr-color-wipe-up.json'), known).transitions![0]!
    expect(up.params).toEqual({ hit: false, color: 'fg', direction: 'up' })
    expect(parseStoryboard(two([{ type: 'whip-pan', at: 2 }]), known).transitions![0]!.params).toEqual({ hit: false, direction: 'left', blur: 28 })
    expect(parseStoryboard(two([{ type: 'zoom-through', at: 2 }]), known).transitions![0]!.params).toEqual({ hit: false, scale: 7 })
    expect(parseStoryboard(two([{ type: 'glitch-cut', at: 2 }]), known).transitions![0]!.params).toEqual({ hit: false, intensity: 1 })
  })
  it('a storyboard without transitions has none', () => {
    expect(parseStoryboard(fixture('minimal.json'), known).transitions).toBeUndefined()
  })
  it('at within 1 ms of the cut is accepted', () => {
    expect(() => parseStoryboard(two([{ type: 'glitch-cut', at: 2.0009 }]), known)).not.toThrow()
  })
  it('field paths', () => {
    // not on a cut
    expect(pathOf(() => parseStoryboard(two([{ type: 'color-wipe', at: 1.5 }]), known))).toBe('transitions[0].at')
    expect(pathOf(() => parseStoryboard(two([{ type: 'color-wipe', at: 2.002 }]), known))).toBe('transitions[0].at')
    // the end of the storyboard is not a cut (no incoming scene)
    expect(pathOf(() => parseStoryboard(two([{ type: 'color-wipe', at: 4 }]), known))).toBe('transitions[0].at')
    // window longer than a scene: d/2 = 0.6 > 0.5
    expect(pathOf(() => parseStoryboard(three([{ type: 'whip-pan', at: 1, duration: 1.2 }]), known))).toBe('transitions[0].duration')
    expect(pathOf(() => parseStoryboard(two([{ type: 'whip-pan', at: 2, duration: 1.21 }]), known))).toBe('transitions[0].duration')
    expect(pathOf(() => parseStoryboard(two([{ type: 'whip-pan', at: 2, duration: 0.05 }]), known))).toBe('transitions[0].duration')
    // overlapping windows: [0.8, 1.2] and [1.3, 1.7] are fine; [0.8,1.2] and [1.15,1.85] overlap
    expect(() => parseStoryboard(three([{ type: 'color-wipe', at: 1 }, { type: 'color-wipe', at: 1.5 }]), known)).not.toThrow()
    expect(
      pathOf(() => parseStoryboard(three([{ type: 'color-wipe', at: 1 }, { type: 'zoom-through', at: 1.5, duration: 0.7 }]), known)),
    ).toBe('transitions[1].at')
    // bad params
    expect(pathOf(() => parseStoryboard(two([{ type: 'color-wipe', at: 2, params: { direction: 'sideways' } }]), known))).toBe(
      'transitions[0].params.direction',
    )
    expect(pathOf(() => parseStoryboard(two([{ type: 'color-wipe', at: 2, params: { color: '#fff' } }]), known))).toBe(
      'transitions[0].params.color',
    )
    expect(pathOf(() => parseStoryboard(two([{ type: 'whip-pan', at: 2, params: { blur: -1 } }]), known))).toBe('transitions[0].params.blur')
    // unknown type
    expect(pathOf(() => parseStoryboard(two([{ type: 'star-wipe', at: 2 }]), known))).toBe('transitions[0].type')
  })
})

describe('morph transition', () => {
  const two = (tr: unknown[]) => ({
    version: 1,
    scenes: [s('a', { duration: 2 }), s('b', { start: 2, duration: 2 })],
    transitions: tr,
  })
  it('parses with key, hit default false and default duration 0.6', () => {
    const tr = parseStoryboard(two([{ type: 'morph', at: 2, params: { key: 'coin' } }]), known).transitions![0]!
    expect(tr.duration).toBe(0.6)
    expect(tr.params).toEqual({ key: 'coin', hit: false })
    const hard = parseStoryboard(two([{ type: 'morph', at: 2, duration: 0.8, params: { key: 'coin', hit: true } }]), known).transitions![0]!
    expect(hard.duration).toBe(0.8)
    expect(hard.params).toEqual({ key: 'coin', hit: true })
    // other transitions keep 0.4
    expect(parseStoryboard(two([{ type: 'whip-pan', at: 2 }]), known).transitions![0]!.duration).toBe(0.4)
  })
  it('key is required and non-empty', () => {
    expect(pathOf(() => parseStoryboard(two([{ type: 'morph', at: 2 }]), known))).toBe('transitions[0].params.key')
    expect(pathOf(() => parseStoryboard(two([{ type: 'morph', at: 2, params: { key: '' } }]), known))).toBe('transitions[0].params.key')
  })
})

describe('sceneAt', () => {
  it('without a track: the latest-started scene of any track; with one: only that track', () => {
    const sb = parseStoryboard(
      { version: 1, scenes: [s('a', { start: 0, duration: 4, track: 0 }), s('b', { start: 1, duration: 2, track: 2 })] },
      known,
    )
    expect(sceneAt(sb, 2)).toBe('b')
    expect(sceneAt(sb, 2, 0)).toBe('a')
    expect(sceneAt(sb, 2, 2)).toBe('b')
    expect(sceneAt(sb, 3.5, 2)).toBe('(none)')
    expect(sceneAt(sb, 3.5)).toBe('a')
  })
})

describe('scene preroll (R27)', () => {
  it('defaults to 0 and accepts 0 ≤ preroll ≤ min(1, duration)', () => {
    expect(parseStoryboard({ version: 1, scenes: [s('a')] }, known).scenes[0]!.preroll).toBe(0)
    expect(parseStoryboard({ version: 1, scenes: [s('a', { preroll: 0.3 })] }, known).scenes[0]!.preroll).toBe(0.3)
    expect(parseStoryboard({ version: 1, scenes: [s('a', { duration: 2, preroll: 1 })] }, known).scenes[0]!.preroll).toBe(1)
    expect(parseStoryboard({ version: 1, scenes: [s('a', { duration: 0.5, preroll: 0.5 })] }, known).scenes[0]!.preroll).toBe(0.5)
  })
  it('field paths', () => {
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a', { preroll: -0.1 })] }, known))).toBe('scenes[0].preroll')
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a', { duration: 3, preroll: 1.01 })] }, known))).toBe('scenes[0].preroll')
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a'), s('b', { duration: 0.4, preroll: 0.5 })] }, known))).toBe(
      'scenes[1].preroll',
    )
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a', { preroll: 'x' })] }, known))).toBe('scenes[0].preroll')
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a', { preroll: Number.NaN })] }, known))).toBe('scenes[0].preroll')
  })
  it('does not move the scene window: duration and transition cuts still use start/end', () => {
    const sb = parseStoryboard(
      {
        version: 1,
        scenes: [s('a', { duration: 2, preroll: 0.4 }), s('b', { start: 2, duration: 2, preroll: 0.5 })],
        transitions: [{ type: 'whip-pan', at: 2 }],
      },
      known,
    )
    expect(storyboardDuration(sb)).toBe(4)
    expect(sb.transitions![0]!.at).toBe(2)
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a', { duration: 2 }), s('b', { start: 2, duration: 2, preroll: 0.5 })], transitions: [{ type: 'whip-pan', at: 1.5 }] }, known))).toBe('transitions[0].at')
  })
})

describe('tracks (E1a)', () => {
  // Track 0: a | b cut at 2.0 with a color-wipe. Track 2: captions changing on the same jump cut.
  const tracked = (tr: unknown[], over: Record<string, unknown> = {}) => ({
    version: 1,
    scenes: [
      s('a', { duration: 2 }),
      s('cap1', { duration: 2, track: 2 }),
      s('b', { start: 2, duration: 2 }),
      s('cap2', { start: 2, duration: 2, track: 2 }),
    ],
    transitions: tr,
    ...over,
  })

  it('track defaults to 0 on scenes and transitions', () => {
    const sb = parseStoryboard(fixture('tr-color-wipe.json'), known)
    expect(sb.scenes.map((sc) => sc.track)).toEqual([0, 0])
    expect(sb.transitions![0]!.track).toBe(0)
  })
  it('a cut on track 0 with a caption starting at the same time on track 2 parses', () => {
    const sb = parseStoryboard(tracked([{ type: 'color-wipe', at: 2 }]), known)
    expect(sb.scenes.map((sc) => sc.track)).toEqual([0, 2, 0, 2])
    expect(sb.transitions![0]!.track).toBe(0)
    // Only a caption starting at 2.0 on track 2 (no caption ending there) parses too.
    const one = {
      version: 1,
      scenes: [s('a', { duration: 2 }), s('b', { start: 2, duration: 2 }), s('cap', { start: 2, duration: 1, track: 2 })],
      transitions: [{ type: 'color-wipe', at: 2 }],
    }
    expect(() => parseStoryboard(one, known)).not.toThrow()
    expect(() => parseStoryboard(fixture('tracks.json'), known)).not.toThrow()
  })
  it('a transition on track 2 uses only the track-2 cut', () => {
    const sb = parseStoryboard(tracked([{ type: 'color-wipe', at: 2, track: 2 }]), known)
    expect(sb.transitions![0]!.track).toBe(2)
  })
  it('a transition whose cut exists only on another track fails at transitions[i].at', () => {
    expect(pathOf(() => parseStoryboard(tracked([{ type: 'color-wipe', at: 2, track: 1 }]), known))).toBe('transitions[0].at')
    // Track 0 has scenes but no cut at 1.0; track 2 has one.
    const other = {
      version: 1,
      scenes: [s('a', { duration: 2 }), s('c1', { duration: 1, track: 2 }), s('c2', { start: 1, duration: 1, track: 2 })],
      transitions: [{ type: 'color-wipe', at: 1 }],
    }
    expect(pathOf(() => parseStoryboard(other, known))).toBe('transitions[0].at')
    expect(() => parseStoryboard({ ...other, transitions: [{ type: 'color-wipe', at: 1, track: 2 }] }, known)).not.toThrow()
  })
  it('duration check uses the track scenes', () => {
    // On track 2 the caption joining the cut is 0.1 s long: a 0.4 s transition there is too long.
    const sb = {
      version: 1,
      scenes: [s('a', { duration: 2 }), s('b', { start: 2, duration: 2 }), s('c1', { start: 1.9, duration: 0.1, track: 2 }), s('c2', { start: 2, duration: 1, track: 2 })],
      transitions: [{ type: 'color-wipe', at: 2, track: 2 }],
    }
    expect(pathOf(() => parseStoryboard(sb, known))).toBe('transitions[0].duration')
    expect(() => parseStoryboard({ ...sb, transitions: [{ type: 'color-wipe', at: 2 }] }, known)).not.toThrow()
  })
  it('window overlap is per track', () => {
    const both = [{ type: 'color-wipe', at: 2 }, { type: 'whip-pan', at: 2, track: 2 }]
    expect(() => parseStoryboard(tracked(both), known)).not.toThrow()
    expect(pathOf(() => parseStoryboard(tracked([{ type: 'color-wipe', at: 2, track: 2 }, { type: 'whip-pan', at: 2, track: 2 }]), known))).toBe(
      'transitions[1].at',
    )
  })
  it('field paths', () => {
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a', { track: 10 })] }, known))).toBe('scenes[0].track')
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a', { track: -1 })] }, known))).toBe('scenes[0].track')
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a'), s('b', { track: 1.5 })] }, known))).toBe('scenes[1].track')
    expect(pathOf(() => parseStoryboard({ version: 1, scenes: [s('a', { track: '1' })] }, known))).toBe('scenes[0].track')
    expect(pathOf(() => parseStoryboard(tracked([{ type: 'color-wipe', at: 2, track: 10 }]), known))).toBe('transitions[0].track')
    expect(pathOf(() => parseStoryboard(tracked([{ type: 'color-wipe', at: 2, track: 0.5 }]), known))).toBe('transitions[0].track')
    expect(parseStoryboard({ version: 1, scenes: [s('a', { track: 9 })] }, known).scenes[0]!.track).toBe(9)
  })
})

describe('audio clips (Task 4)', () => {
  const sb = (audio: unknown) => ({ version: 1, audio, scenes: [s('a', { duration: 10 })] })
  const msgOf = (fn: () => unknown): string => {
    try { fn() } catch (e) { return (e as Error).message }
    return ''
  }
  it('R2: the raw voice entry written by project init parses with defaults', () => {
    const a = parseStoryboard(sb([{ kind: 'voice', media: 'm1' }]), known).audio!
    expect(a).toEqual([{ id: 'a0', kind: 'voice', media: 'm1', at: 0, in: 0, gain: 0, fadeIn: 0, fadeOut: 0 }])
  })
  it('music "from 0:32" parses with its defaults: −21 dB (R6), 1.5 s fade-out, at 0, no duration (runs to the end)', () => {
    const a = parseStoryboard(sb([{ kind: 'voice', media: 'm1' }, { kind: 'music', media: 'm2', in: 32 }]), known).audio!
    expect(a[1]).toEqual({ id: 'a1', kind: 'music', media: 'm2', at: 0, in: 32, gain: -21, fadeIn: 0, fadeOut: 1.5 })
    expect(AUDIO_DEFAULTS.music.gain).toBe(AUDIO_DEFAULTS.sfx.gain - 7)
  })
  it('sfx defaults to −14 dB; an explicit id, duration and fades are kept', () => {
    const a = parseStoryboard(sb([{ id: 'boom', kind: 'sfx', sfx: 'impact', at: 2.5, duration: 0.4, fadeOut: 0.1 }]), known).audio!
    expect(a[0]).toEqual({ id: 'boom', kind: 'sfx', sfx: 'impact', at: 2.5, in: 0, duration: 0.4, gain: -14, fadeIn: 0, fadeOut: 0.1 })
  })
  it('sfx louder than −6 dB is refused at audio[i].gain, Arabic first', () => {
    const fn = () => parseStoryboard(sb([{ kind: 'sfx', sfx: 'tap', gain: -3 }]), known)
    expect(pathOf(fn)).toBe('audio[0].gain')
    expect(msgOf(fn)).toBe('audio[0].gain: المؤثرات يجب أن تبقى أخفض من الصوت — SFX must stay below the voice (≤ −6 dB)')
    expect(parseStoryboard(sb([{ kind: 'sfx', sfx: 'tap', gain: -6 }]), known).audio![0]!.gain).toBe(-6)
  })
  it('exactly one of media / sfx', () => {
    expect(pathOf(() => parseStoryboard(sb([{ kind: 'sfx', media: 'm3', sfx: 'tap' }]), known))).toBe('audio[0]')
    expect(pathOf(() => parseStoryboard(sb([{ kind: 'music' }]), known))).toBe('audio[0]')
    // A built-in sound is an effect, never voice or music.
    expect(pathOf(() => parseStoryboard(sb([{ kind: 'music', sfx: 'riser' }]), known))).toBe('audio[0].sfx')
  })
  it('field checks: kind, sfx name, times, fades, duplicate ids', () => {
    expect(pathOf(() => parseStoryboard(sb([{ kind: 'noise', media: 'm1' }]), known))).toBe('audio[0].kind')
    expect(pathOf(() => parseStoryboard(sb([{ kind: 'sfx', sfx: 'whoosh' }]), known))).toBe('audio[0].sfx')
    expect(pathOf(() => parseStoryboard(sb([{ kind: 'voice', media: 'm1', at: -1 }]), known))).toBe('audio[0].at')
    expect(pathOf(() => parseStoryboard(sb([{ kind: 'voice', media: 'm1', in: -1 }]), known))).toBe('audio[0].in')
    expect(pathOf(() => parseStoryboard(sb([{ kind: 'voice', media: 'm1', duration: 0 }]), known))).toBe('audio[0].duration')
    expect(pathOf(() => parseStoryboard(sb([{ kind: 'voice', media: 'm1', fadeOut: -0.1 }]), known))).toBe('audio[0].fadeOut')
    expect(pathOf(() => parseStoryboard(sb([{ kind: 'voice', media: 'm1' }, { id: 'a0', kind: 'music', media: 'm2' }]), known))).toBe('audio[1].id')
  })
  it('no audio key: audio stays undefined', () => {
    expect(parseStoryboard({ version: 1, scenes: [s('a')] }, known).audio).toBeUndefined()
  })
})

describe('looks and colour worlds', () => {
  const bd = (id: string, world: string, start = 0) => ({ id, type: 'backdrop', start, duration: 1, params: { world } })
  it('accepts look paper-editorial and keeps the other two', () => {
    expect([...LOOK_IDS]).toEqual(['dark-tech', 'light-editorial', 'paper-editorial', 'signature', 'swiss-red'])
    const sb = parseStoryboard({ version: 1, look: 'paper-editorial', scenes: [s('a')] }, known)
    expect(sb.look).toBe('paper-editorial')
    expect(getLook('paper-editorial')).toMatchObject({ bg: '#f3eadb', fg: '#141210', accent: '#c8201a' })
  })
  it('accepts look signature: cream / ink / orange tokens; ink world swaps; paper and ink reach 4.5', () => {
    const sb = parseStoryboard({ version: 1, look: 'signature', scenes: [s('a')] }, known)
    expect(sb.look).toBe('signature')
    const l = getLook('signature')
    expect(l).toMatchObject({ bg: '#f3efe7', fg: '#16130f', accent: '#ff5a1f' })
    expect(l.fontDisplay).toBe(getLook('paper-editorial').fontDisplay)
    expect(l.fontBody).toBe(getLook('paper-editorial').fontBody)
    expect(worldOf(l, 'ink')).toEqual({ bg: '#16130f', fg: '#f3efe7', accent: '#ff5a1f' })
    expect(contrastRatio(l.fg, l.bg)).toBeGreaterThanOrEqual(4.5)
    const ink = worldOf(l, 'ink')
    expect(contrastRatio(ink.fg, ink.bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('accepts look swiss-red: paper / ink / signal red; the red world reaches 4.5 with paper text', () => {
    expect(parseStoryboard({ version: 1, look: 'swiss-red', scenes: [s('a')] }, known).look).toBe('swiss-red')
    const l = getLook('swiss-red')
    expect(l).toMatchObject({ bg: '#efede8', fg: '#111111', accent: '#cf1f17' })
    expect(worldOf(l, 'accent')).toEqual({ bg: '#cf1f17', fg: '#efede8', accent: '#111111' })
    expect(contrastRatio(l.accent, l.bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('looks carry constant var() strings next to the hex tokens', () => {
    for (const id of LOOK_IDS) {
      const l = getLook(id)
      expect(l.vars).toEqual({ bg: 'var(--mba-bg)', fg: 'var(--mba-fg)', accent: 'var(--mba-accent)' })
      expect(l.bg).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
  it('backdrop params default to world paper, no pattern, alpha 0.12', () => {
    expect(backdropParams.parse({})).toMatchObject({ world: 'paper', pattern: 'none', patternAlpha: 0.12 })
    expect(backdropParams.safeParse({ patternAlpha: 0.6 }).success).toBe(false)
    expect(backdropParams.safeParse({ pattern: 'waves' }).success).toBe(false)
  })
  it('worldColours: look colours plus one entry per distinct backdrop world, with the swaps', () => {
    const sb = parseStoryboard({ version: 1, look: 'paper-editorial', scenes: [bd('p', 'paper'), bd('i', 'ink', 1), bd('a', 'accent', 2), bd('i2', 'ink', 3)] }, ['backdrop'])
    expect(worldColours(sb)).toEqual([
      { bg: '#f3eadb', fg: '#141210', accent: '#c8201a' },
      { bg: '#141210', fg: '#f3eadb', accent: '#c8201a' },
      { bg: '#c8201a', fg: '#f3eadb', accent: '#141210' },
    ])
  })
  it('worldColours without backdrops is the look alone; a brand colour overrides accent in every world', () => {
    const plain = parseStoryboard({ version: 1, look: 'dark-tech', scenes: [s('a')] }, known)
    expect(worldColours(plain)).toEqual([{ bg: '#0e0d0c', fg: '#f2ece2', accent: '#ff5a1f' }])
    const sb = parseStoryboard(
      { version: 1, look: 'dark-tech', brand: { name: 'x', handle: '@x', colors: { primary: '#123456', secondary: '#222222', bg: '#000000', text: '#ffffff' } }, scenes: [bd('a', 'accent')] },
      ['backdrop'],
    )
    // paper keeps the brand accent; accent world: bg = brand accent, fg = the look colour with more contrast (cream here)
    expect(worldColours(sb)).toEqual([
      { bg: '#0e0d0c', fg: '#f2ece2', accent: '#123456' },
      { bg: '#123456', fg: '#f2ece2', accent: '#0e0d0c' },
    ])
  })
  it('contrast: fg on bg >= 4.5 for every look and every effective world', () => {
    for (const id of LOOK_IDS) {
      const l = getLook(id)
      for (const w of WORLDS) {
        const c = worldOf(l, resolveWorld(l, w))
        expect(contrastRatio(c.fg, c.bg), `${id}/${w}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it('accent world: fg is the look colour that contrasts more with the accent', () => {
    expect(worldOf(getLook('dark-tech'), 'accent')).toEqual({ bg: '#ff5a1f', fg: '#0e0d0c', accent: '#f2ece2' })
    expect(worldOf(getLook('light-editorial'), 'accent')).toEqual({ bg: '#ff5a1f', fg: '#151311', accent: '#f2ece2' })
    expect(worldOf(getLook('paper-editorial'), 'accent')).toEqual({ bg: '#c8201a', fg: '#f3eadb', accent: '#141210' })
    for (const id of LOOK_IDS) expect(resolveWorld(getLook(id), 'accent'), id).toBe('accent')
  })
  it('accent world falls back to ink when no pair of the look reaches 4.5 (a mid-grey brand colour)', () => {
    const grey = { ...getLook('dark-tech'), accent: '#777777' }
    expect(resolveWorld(grey, 'accent')).toBe('ink')
    expect(resolveWorld(grey, 'paper')).toBe('paper')
    const sb = parseStoryboard(
      { version: 1, look: 'dark-tech', brand: { name: 'x', handle: '@x', colors: { primary: '#777777', secondary: '#222222', bg: '#000000', text: '#ffffff' } }, scenes: [bd('a', 'accent')] },
      ['backdrop'],
    )
    expect(worldColours(sb)).toEqual([
      { bg: '#0e0d0c', fg: '#f2ece2', accent: '#777777' },
      { bg: '#f2ece2', fg: '#0e0d0c', accent: '#777777' },
    ])
  })
  it('contrastRatio is symmetric and spans 1..21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
  })
})
