import { describe, expect, it } from 'vitest'
import { PACK_IDS } from '../../src/core/pack-ids'
import { validateSceneParams } from '../../src/core/params/index'
import { nameStripParams } from '../../src/core/params/name-strip'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { beatTranscript, parsePreset, presetStoryboard } from '../../src/core/recipes/presets'
import { keyMoments, TALKING } from '../../src/core/recipes/talking'
import { parseStoryboard } from '../../src/core/storyboard'
import { PACKS } from '../../src/packs/index'

type Sc = { id: string; type: string; track: number; start: number; duration: number; params: Record<string, unknown> }
type Sb = { scenes: Sc[]; look: string; pack?: string; audio?: unknown[]; camera: { fixedTracks: number[]; keys: { at: number; x: number; y: number; zoom: number }[] } }

const script = 'اليوم أعلمك طريقة بسيطة تخلي الفيديو احترافي. أول شي سجل بإضاءة واضحة. بعدها اكتب العنوان بكلمات قليلة. وآخر شي خلي الحركة هادئة ومرتبة. جربها وقلي النتيجة.'
const tr = beatTranscript(script, 100)
const build = (over: Record<string, unknown> = {}, face?: [number, number, number, number]) =>
  presetStoryboard({ preset: parsePreset({ preset: 'talking', media: 'm1', ...over }), transcript: tr, fps: 60, seed: 1, ...(face ? { face } : {}) }) as unknown as Sb

describe('talking preset', () => {
  it('gives a valid one-take storyboard for every pack and without one', () => {
    for (const pack of [undefined, ...PACK_IDS]) {
      const sb = build({ ...(pack ? { pack } : {}), name: 'يوسف الجبوري', handle: '@yousif_aljbouri' })
      validateSceneParams(parseStoryboard(structuredClone(sb), PRIMITIVE_IDS))
      expect(sb.scenes[0]).toMatchObject({ type: 'video', track: 0, start: 0 })
      expect(sb.scenes.filter((s) => s.type === 'video').length).toBe(1)
      expect(sb.camera.fixedTracks).not.toContain(0)
      if (pack) expect(sb.look).toBe(PACKS[pack].look)
    }
  })
  it('each pack dresses the captions, the pop-up and the name strip its own way', () => {
    const sig = PACK_IDS.map((pack) => {
      const sb = build({ pack, name: 'يوسف' })
      const cap = sb.scenes.find((s) => s.type === 'captions')!
      const pop = sb.scenes.find((s) => s.id.startsWith('pop'))!
      const w = (pop.params.words as Record<string, unknown>[])[0]!
      return [cap.params.skin, cap.params.presentation, w.box ? 'box' : w.underline ? 'underline' : 'colour', sb.scenes.find((s) => s.type === 'name-strip')!.params.kind].join('|')
    })
    expect(new Set(sig).size).toBe(PACK_IDS.length)
  })
  it('marks the key words in the captions and punches in on them, toward the face', () => {
    const sb = build({ pack: 'dark-tech', punch: true }, [0.4, 0.2, 0.6, 0.4])
    const cues = sb.scenes.find((s) => s.type === 'captions')!.params.cues as { words: { emph?: string }[] }[]
    const marked = cues.flatMap((c) => c.words).filter((w) => w.emph)
    expect(marked.length).toBeGreaterThanOrEqual(3)
    expect(marked.every((w) => w.emph === 'underline')).toBe(true)
    const keys = sb.camera.keys
    expect(keys.every((k, i) => i === 0 || k.at >= keys[i - 1]!.at)).toBe(true)
    expect(Math.max(...keys.map((k) => k.zoom))).toBe(PACKS['dark-tech'].talking.punch.zoom)
    expect(keys.at(-1)!.zoom).toBe(1)
    // At rest the whole clip shows; a punch moves toward the face but never far enough to show an edge.
    const Z = PACKS['dark-tech'].talking.punch.zoom
    for (const k of keys) {
      if (k.zoom === 1) expect([k.x, k.y]).toEqual([0.5, 0.5])
      else { expect(k.y).toBeGreaterThanOrEqual(0.5 / Z - 1e-3); expect(k.y).toBeLessThan(0.5) }
    }
  })
  it('pop-ups never overlap each other and stay inside the video', () => {
    const sb = build({ pack: 'signature-cream' })
    const pops = sb.scenes.filter((s) => s.id.startsWith('pop')).sort((a, b) => a.start - b.start)
    expect(pops.length).toBeGreaterThanOrEqual(2)
    const end = sb.scenes[0]!.duration
    pops.forEach((p, i) => {
      expect(p.start + p.duration).toBeLessThanOrEqual(end + 1e-6)
      if (i) expect(p.start).toBeGreaterThanOrEqual(pops[i - 1]!.start + pops[i - 1]!.duration)
    })
  })
  it("takes the person's own key words, and can switch each part off", () => {
    const find = (say: string) => tr.words.findIndex((w) => w.text === say.split(' ')[0])
    const keys = keyMoments(tr, [{ say: 'الفيديو احترافي' }, { say: 'بإضاءة واضحة', text: 'الإضاءة' }], find)
    expect(keys.map((k) => k.text)).toEqual(['احترافي', 'الإضاءة'])
    // By default the clip keeps its own framing (no zoom) and there is no name strip.
    const plain = build({ pack: 'dark-tech' })
    expect(plain.camera.keys).toEqual([{ at: 0, x: 0.5, y: 0.5, zoom: 1 }])
    expect(plain.scenes.some((s) => s.type === 'name-strip')).toBe(false)
    const bare = build({ captions: false, popups: false })
    expect(bare.scenes.map((s) => s.type)).toEqual(['video'])
    expect(bare.camera.keys.length).toBe(1)
  })
  it('auto key words are real words, spaced out', () => {
    const keys = keyMoments(tr, undefined, () => 0)
    expect(keys.length).toBeGreaterThanOrEqual(3)
    keys.forEach((k, i) => {
      expect(k.text.length).toBeGreaterThanOrEqual(TALKING.minLetters)
      if (i) expect(k.at - keys[i - 1]!.at).toBeGreaterThanOrEqual(TALKING.minGap)
    })
  })
})

describe('talking layout around the face', () => {
  const tops = (sb: Sb) => ({ pop: sb.scenes.find((s) => s.id.startsWith('pop')), strip: sb.scenes.find((s) => s.type === 'name-strip') })
  it('a face with room above gets a pop-up over the head and the strip under the chin', () => {
    const { pop, strip } = tops(build({ pack: 'signature-cream', name: 'يوسف' }, [0.38, 0.3, 0.62, 0.46]))
    expect(pop!.params.y as number).toBeLessThan(0.3 - 0.04)
    expect(strip).toBeDefined()
  })
  it('a head near the top of the frame puts the pop-up under the chin, after the name strip has left', () => {
    const sb = build({ pack: 'signature-cream', name: 'يوسف' }, [0.3, 0.08, 0.68, 0.4])
    const pops = sb.scenes.filter((s) => s.id.startsWith('pop'))
    expect(pops.length).toBeGreaterThanOrEqual(1)
    for (const p of pops) { expect(p.params.y as number).toBeGreaterThan(0.45); expect(p.start).toBeGreaterThanOrEqual(TALKING.strip.out + 0.6) }
    expect(sb.scenes.some((s) => s.type === 'name-strip')).toBe(true)
  })
  it('a tight close-up gets no pop-up and no strip on the face', () => {
    const { pop, strip } = tops(build({ pack: 'signature-cream', name: 'يوسف' }, [0.3, 0.16, 0.7, 0.62]))
    expect(pop).toBeUndefined()
    expect(strip).toBeUndefined()
  })
})

describe('name-strip', () => {
  it('needs a name, and an exit that leaves time to read it', () => {
    expect(nameStripParams.parse({ name: 'يوسف' }).kind).toBe('card')
    expect(nameStripParams.safeParse({ name: 'يوسف', at: 1, out: 1.2 }).success).toBe(false)
    expect(nameStripParams.safeParse({}).success).toBe(false)
  })
})
