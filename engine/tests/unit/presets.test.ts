import { describe, expect, it } from 'vitest'
import { findPhrase, parsePreset, presetStoryboard } from '../../src/core/recipes/presets'
import { parseStoryboard } from '../../src/core/storyboard'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { validateSceneParams } from '../../src/core/params'

const script = 'أربع أشياء تخلي العربي احترافي. أولاً الحروف خلها متصلة. ثانياً التطويل الكشيدة تمد. ثالثاً الكثرة لا تكتب الجملة. تبي القالب علّق عربي'
const tr = (() => {
  let t = 0.1
  const words = script.split(/\s+/).map((raw, i) => {
    const w = { i, text: raw.replace(/\./g, ''), start: +t.toFixed(2), end: +(t + 0.34).toFixed(2), p: 1 }
    t += 0.62 + (raw.endsWith('.') ? 0.4 : 0)
    return w
  })
  return { version: 1 as const, media: 'm1', sourceHash: 'x', model: 'm', language: 'ar', words }
})()

const preset = {
  preset: 'list',
  hook: { say: 'أربع أشياء', text: 'العربي احترافي', box: 'احترافي' },
  items: [
    { say: 'أولا الحروف', title: 'الحروف', text: 'خلها متصلة', show: { kind: 'join', word: 'العربي' } },
    { say: 'ثانيا التطويل', title: 'التطويل', show: { kind: 'stretch', word: 'تتمدد' } },
    { say: 'ثالثا الكثرة', title: 'الكثرة', show: { kind: 'strike', wrong: 'الجملة', right: 'الكلمة' } },
  ],
  cta: { say: 'تبي القالب', text: 'علّق: عربي', box: 'عربي', keyword: 'عربي' },
}

describe('presets: list', () => {
  it('anchors phrases with hamza and harakat ignored, in order, and refuses a missing one Arabic first', () => {
    expect(findPhrase(tr as never, 'أولا الحروف', 0, 'x')).toBe(5)
    expect(() => findPhrase(tr as never, 'كلمة غائبة تماماً', 0, 'items[9]')).toThrow(/^[^]*[؀-ۿ][^]*items\[9\]/)
  })
  it('compiles to a valid storyboard: one section per item, bar index per item, badge, show, CTA last, 60 fps, no SFX', () => {
    const sb = presetStoryboard({ preset: parsePreset(preset), transcript: tr as never, fps: 60, seed: 1 }) as { scenes: { id: string; type: string; start: number; duration: number; params: Record<string, unknown> }[] } & Record<string, unknown>
    expect(sb.fps).toBe(60)
    expect(sb.autoSfx).toBe(false)
    expect(sb.look).toBe('swiss-red')
    const parsed = parseStoryboard(sb, PRIMITIVE_IDS)
    validateSceneParams(parsed)
    const bars = sb.scenes.filter((s) => s.type === 'chapter-bar').map((s) => s.params.index)
    expect(bars).toEqual([1, 2, 3])
    expect(sb.scenes.filter((s) => s.type === 'section-number').map((s) => s.params.number)).toEqual([1, 2, 3])
    expect(sb.scenes.map((s) => s.type)).toEqual(expect.arrayContaining(['letters-join', 'type-stretch', 'comment-cta']))
    // Sections tile the timeline: each backdrop starts where the previous ends.
    const bgs = sb.scenes.filter((s) => s.type === 'backdrop')
    for (let i = 1; i < bgs.length; i++) expect(bgs[i]!.start).toBeCloseTo(bgs[i - 1]!.start + bgs[i - 1]!.duration, 3)
    // Item 1 starts on «أولاً».
    expect(bgs[1]!.start).toBeCloseTo(tr.words[5]!.start, 3)
    expect(sb.scenes.at(-1)!.type).toBe('comment-cta')
  })
  it('refuses an unknown preset and a word that cannot stretch, Arabic first where it can', () => {
    expect(() => parsePreset({ ...preset, preset: 'nope' })).toThrow(/preset/)
    expect(() => parsePreset({ ...preset, items: [{ ...preset.items[0], show: { kind: 'stretch', word: 'ورد' } }, preset.items[1]] })).toThrow(/^[^]*[؀-ۿ]/)
  })
})

describe('presets: beat and easy ease', () => {
  it('with a beat, show events and the badge land on the beat grid; text and numbers use easy ease', () => {
    const sb = presetStoryboard({ preset: parsePreset({ ...preset, beat: { bpm: 120 } }), transcript: tr as never, fps: 60, seed: 1 }) as { scenes: { type: string; start: number; duration: number; params: Record<string, unknown> }[] }
    const onGrid = (t: number) => Math.abs(t * 2 - Math.round(t * 2)) < 1e-6
    for (const s of sb.scenes) {
      if (s.type === 'section-number') expect(s.duration).toBeCloseTo(1, 6)
      if (s.type === 'type-stretch' || s.type === 'letters-join') {
        expect(onGrid(s.start + (s.params.at as number)), `${s.type} at`).toBe(true)
        expect(s.params.duration).toBeCloseTo(1, 6)
      }
      if (s.type === 'kinetic-text' || s.type === 'section-number') expect(s.params.ease).toBe('easy')
    }
  })
})

describe('presets: motion is the user\'s choice', () => {
  it('snappy turns every eased scene to ease-out; default is easy', () => {
    const of = (extra: object) => (presetStoryboard({ preset: parsePreset({ ...preset, ...extra }), transcript: tr as never, fps: 60, seed: 1 }) as { scenes: { type: string; params: Record<string, unknown> }[] }).scenes
    const eased = (sc: { type: string; params: Record<string, unknown> }[]) => sc.filter((s) => ['kinetic-text', 'section-number', 'type-stretch', 'letters-join', 'chapter-bar'].includes(s.type)).map((s) => s.params.ease)
    expect(new Set(eased(of({})))).toEqual(new Set(['easy']))
    expect(new Set(eased(of({ motion: 'snappy' })))).toEqual(new Set(['out']))
  })
  it('reads the words: snappy wins, smooth words ask for easy, silence leaves it to the default', async () => {
    const { motionFromWords } = await import('../../src/core/recipes/presets')
    expect(motionFromWords('ابيه حاد وسريع')).toBe('snappy')
    expect(motionFromWords('بدون ease لو سمحت')).toBe('snappy')
    expect(motionFromWords('خلي الحركة ناعمة')).toBe('easy')
    expect(motionFromWords('Easy Ease please')).toBe('easy')
    expect(motionFromWords('سوّ لي فيديو عن القهوة')).toBeUndefined()
  })
})

describe('presets: stage 3 (tool, loop, system, teaser)', () => {
  const words = (text: string) => {
    let t = 0.5
    return { version: 1 as const, media: 'm1', sourceHash: 'x', model: 'm', language: 'ar', words: text.split(/\s+/).map((w, i) => ({ i, text: w, start: (t += 0.5), end: t + 0.4, p: 1 })) }
  }
  const compile = (pr: unknown, text: string) =>
    (presetStoryboard({ preset: parsePreset(pr), transcript: words(text) as never, fps: 60, seed: 1 }) as { scenes: { id: string; type: string; start: number; duration: number; preroll?: number; params: Record<string, unknown> }[] }).scenes
  it('loop: the opening search bar is typed on frame 0 and the same bar closes the video', () => {
    const sc = compile(
      { preset: 'loop', topic: 'حركة احترافية', open: { say: 'لو تبي' }, tips: [{ say: 'أولا التوقيت', title: 'التوقيت' }, { say: 'ثانيا التسهيل', title: 'التسهيل' }], close: { say: 'وهذي الثلاث' } },
      'لو تبي حركة حلوة ابحث هنا أولا التوقيت مع الكلمة دايماً ثانيا التسهيل هادي وناعم وهذي الثلاث اكتبها بالبحث',
    )
    const bars = sc.filter((s) => s.type === 'search-typing')
    expect(bars.length).toBe(2)
    expect(bars[0]!.start).toBe(0)
    expect(bars[0]!.preroll).toBe(1)
    expect(bars[0]!.params.text).toBe(bars[1]!.params.text)
    expect(bars[1]!.start + bars[1]!.duration).toBeCloseTo(Math.max(...sc.map((s) => s.start + s.duration)), 3)
  })
  it('teaser: one hero morphs through every line; particles land on the brand word; the stamp has no duplicate headline', () => {
    const sc = compile(
      { preset: 'teaser', lines: [{ say: 'كلمة تصير', object: 'dot' }, { say: 'وشكل يصير', object: 'bulb' }], brand: { say: 'موشن بالعربي', word: 'موشن' }, soon: { say: 'قريبا', text: 'قريباً' } },
      'كلمة تصير شكل وشكل يصير فكرة موشن بالعربي قريبا',
    )
    const hero = sc.find((s) => s.id === 'hero')!
    expect((hero.params.states as { object: string }[]).map((s) => s.object)).toEqual(['dot', 'bulb'])
    expect(sc.some((s) => s.type === 'particle-word')).toBe(true)
    expect(sc.some((s) => s.id === 'soon-h')).toBe(false)
  })
  it('system: a graph wires its nodes in order', () => {
    const sc = compile(
      { preset: 'system', hook: { say: 'أي أتمتة' }, parts: [{ say: 'الطبقة الأولى', show: { kind: 'graph', nodes: [{ id: 'a', label: 'رسالة' }, { id: 'b', label: 'تفهم' }, { id: 'c', label: 'ترد' }] } }, { say: 'الطبقة الثانية' }], cta: { say: 'تبي المخطط', keyword: 'طبقات' } },
      'أي أتمتة ناجحة الطبقة الأولى الموديل يفهم كل شي الطبقة الثانية الأدوات تبي المخطط علق طبقات',
    )
    const g = sc.find((s) => s.type === 'node-graph')!
    expect((g.params.edges as { from: string; to: string }[]).map((e) => `${e.from}>${e.to}`)).toEqual(['a>b', 'b>c'])
  })
})

describe('presets: no voice (script on the beat)', () => {
  it('one word per beat, a sentence end rests a beat; the storyboard has no voice track', async () => {
    const { beatTranscript } = await import('../../src/core/recipes/presets')
    const t = beatTranscript('أربع أشياء. أولاً الحروف', 120)
    expect(t.words.map((w) => w.start)).toEqual([0.5, 1, 2, 2.5])
    expect(t.words.map((w) => w.text)).toEqual(['أربع', 'أشياء', 'أولاً', 'الحروف'])
    const sb = presetStoryboard({ preset: parsePreset({ ...preset, beat: { bpm: 120 } }), transcript: beatTranscript(script, 120), fps: 60, seed: 1 }) as Record<string, unknown>
    expect(sb.audio).toBeUndefined()
  })
})

describe('presets: the shipped examples', () => {
  it('every examples/presets/*.json is a valid preset', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const files = readdirSync('examples/presets').filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(8)
    for (const f of files) expect(() => parsePreset(JSON.parse(readFileSync(`examples/presets/${f}`, 'utf8'))), f).not.toThrow()
  })
})

describe('captions', () => {
  it('groups at most 4 words per cue and starts a new cue after a pause; cues never overlap', async () => {
    const { groupCaptions } = await import('../../src/core/params/captions')
    const ws = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 2.3, 2.6].map((at, i) => ({ text: `w${i}`, at, end: at + 0.25 }))
    const cs = groupCaptions(ws)
    expect(cs.map((c) => c.words.length)).toEqual([4, 2, 2])
    for (let i = 1; i < cs.length; i++) expect(cs[i - 1]!.end).toBeLessThanOrEqual(cs[i]!.at)
  })
  it('a preset with captions adds one captions scene covering the video, with the chosen skin', () => {
    const sb = presetStoryboard({ preset: parsePreset({ ...preset, captions: { skin: 'karaoke' } }), transcript: tr as never, fps: 60, seed: 1 }) as { scenes: { type: string; start: number; params: Record<string, unknown> }[] }
    const c = sb.scenes.filter((s) => s.type === 'captions')
    expect(c.length).toBe(1)
    expect(c[0]!.params.skin).toBe('karaoke')
    expect(c[0]!.start).toBe(0)
  })
})
