import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveAnchors } from '../../src/core/anchors'
import { parseStoryboard, type Storyboard } from '../../src/core/storyboard'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { validateSceneParams } from '../../src/core/params/index'
import { KINETIC_MAX_REST_SEC } from '../../src/core/params/kinetic-text'
import { alignScript, parseScript, parseTranscript, type Marks, type Transcript, type TranscriptWord } from '../../src/core/transcript'

const parseTranscriptJson = (text: string): Transcript => parseTranscript(JSON.parse(text))
import { explainerStoryboard, parseBrief, plannedPace, rowText, type Brief } from '../../src/core/recipes/explain'
import { compilePlan, KINETIC_ROW_PX, planExplainer, SECTION_BAND, textBand } from '../../src/core/recipes/plan'
import { FORMAT_SIZE, FORMATS } from '../../src/core/types'
import { BRIEF_TYPES, HOOK_FAMILIES_AR, TYPE_PRESETS } from '../../src/core/recipes/types'
import { loadStoryboardFile, transcriptWarnings } from '../../src/node/render'
import { transcriptHash } from '../../src/core/transcript'

// ---------------------------------------------------------------------------------------------
// Fixture: 40 spoken words (~17 s) with *المال*, two «...» (gaps 0.6 s and 0.3 s), ٣٠٠, الوقت and
// أولاً/ثانياً/ثالثاً; one unmarked 0.5 s silence before the enumeration.

const LINES = [
  'هذه طريقة بسيطة توفر عليك *المال* كل شهر «...»',
  'خسرت أكثر من ٣٠٠ ساعة في السنة على شغل مكرر',
  'لأن الوقت ما يرجع «...»',
  'الحل في ثلاث خطوات',
  'أولاً اكتب النص ثانياً سجل صوتك ثالثاً خل المحرك يشتغل',
  'والنتيجة فيديو جاهز بسرعة',
]
const SCRIPT = LINES.join('\n')
const SECTIONED = ['# المقدمة', LINES[0], '# المشكلة', LINES[1], LINES[2], '# الحل', ...LINES.slice(3)].join('\n')
const TEXTS = SCRIPT.replace(/\*|«\.\.\.»/g, '').split(/\s+/).filter(Boolean)
/** Silence after word i (s); default 0.06–0.10. */
const GAP_AFTER: Record<number, number> = { 7: 0.6, 21: 0.3, 25: 0.5 }

function words(): TranscriptWord[] {
  let t = 0.2
  return TEXTS.map((text, i) => {
    const start = Math.round(t * 1000) / 1000
    const end = Math.round((t + 0.3) * 1000) / 1000
    t = end + (GAP_AFTER[i] ?? 0.06 + 0.02 * (i % 3))
    return { i, text, start, end, p: 0.9 }
  })
}

const transcript: Transcript = { version: 1, media: 'm1', sourceHash: 'x', model: 'ggml-small.bin', language: 'ar', words: words() }
const marksOf = (script: string): Marks => alignScript(parseScript(script), transcript.words)
const marks = marksOf(SCRIPT)
const W = (text: string) => transcript.words.findIndex((w) => w.text === text)

const BRIEF: Brief = parseBrief({ title: 'وفّر وقتك ومالك', cta: { keyword: 'دليل' }, musicMedia: 'm2', musicFrom: 12 })

type Raw = {
  scenes: { id: string; type: string; start: unknown; duration: unknown; track?: number; params: Record<string, any> }[]
  transitions?: { type: string; at: unknown; track?: number; params: Record<string, any> }[]
  audio?: Record<string, unknown>[]
  sfxGainDb?: number
}

function build(brief: Brief = BRIEF, m: Marks = marks): Raw {
  return explainerStoryboard({ transcript, marks: m, brief, voiceMedia: 'm1', fps: 30, seed: 7 }) as Raw
}

/** resolveAnchors + parseStoryboard + every primitive's params and scene-level checks. */
function load(raw: Raw, m: Marks = marks): Storyboard {
  const sb = parseStoryboard(resolveAnchors(raw, { transcript, marks: m, fps: 30 }).json, [...PRIMITIVE_IDS])
  validateSceneParams(sb)
  return sb
}

describe('fixture sanity', () => {
  it('has 40 words, the two marked pauses and the stressed word', () => {
    expect(transcript.words).toHaveLength(40)
    expect(marks.unmatched).toEqual([])
    expect(marks.pauses.map((p) => [p.after, p.gap])).toEqual([
      [7, 0.6],
      [21, 0.3],
    ])
    expect(marks.stress).toEqual([W('المال')])
  })
})

describe('explainerStoryboard', () => {
  const raw = build()
  const sb = load(raw)

  it('parses after resolveAnchors + parseStoryboard with every primitive param valid', () => {
    expect(sb.scenes.length).toBeGreaterThan(10)
    expect(sb.format).toBe('9:16')
  })

  it('frame 0: a kinetic-text scene at 0 shows the title, its first word at 0, all words in by 0.3 s', () => {
    const hook = sb.scenes.find((s) => s.start === 0 && s.type === 'kinetic-text')!
    expect(hook).toBeDefined()
    const ws = hook.params.words as { text: string; at: number }[]
    expect(ws.map((w) => w.text).join(' ')).toBe('وفّر وقتك ومالك')
    expect(ws[0]!.at).toBe(0)
    expect(Math.max(...ws.map((w) => w.at))).toBeLessThanOrEqual(0.3)
  })

  it('one background scene on track 0 spans the whole video', () => {
    const bg = sb.scenes.filter((s) => s.track === 0)
    expect(bg.length).toBeGreaterThanOrEqual(1)
    expect(Math.min(...bg.map((s) => s.start))).toBe(0)
    const end = Math.max(...sb.scenes.map((s) => s.start + s.duration))
    expect(Math.max(...bg.map((s) => s.start + s.duration))).toBeCloseTo(end, 6)
  })

  it('beats on track 1 start on a word and end where the next beat starts (anchors, not seconds)', () => {
    const beats = raw.scenes.filter((s) => s.track === 1 && s.type === 'kinetic-text' && s.id !== 'hook')
    expect(beats.length).toBeGreaterThan(2)
    for (const b of beats) {
      expect(b.start).toMatchObject({ word: expect.any(Number) })
      expect(b.duration).toMatchObject({ until: expect.anything() })
    }
  })

  it('المال: an icon banknote anchored at its word, and the kinetic word has stress 2', () => {
    const k = W('المال')
    const icon = raw.scenes.find((s) => s.type === 'icon' && s.params.icon === 'banknote')!
    expect(icon).toBeDefined()
    expect(icon.start).toEqual({ word: k })
    const word = raw.scenes.flatMap((s) => (s.type === 'kinetic-text' ? s.params.words : [])).find((w: any) => w.text === 'المال')
    expect(word).toMatchObject({ stress: 2, at: { word: k } })
  })

  it('٣٠٠ → counter to 300 on its word; the enumeration → a checklist of 3 items anchored to their words', () => {
    const counter = raw.scenes.find((s) => s.type === 'counter')!
    expect(counter.params.to).toBe(300)
    // Fix wave I4: the particle before the number («من») is the counter's prefix, from its word.
    expect(counter.start).toEqual({ word: W('٣٠٠') - 1 })
    expect(counter.params.prefix).toBe('من')
    const list = raw.scenes.find((s) => s.type === 'checklist')!
    expect(list.params.items).toHaveLength(3)
    expect(list.params.items.map((it: any) => it.at)).toEqual([{ word: W('أولاً') }, { word: W('ثانياً') }, { word: W('ثالثاً') }])
  })

  it('a pause with gap 0.6 s → a hit transition on the word after it; gap 0.3 s → no transition', () => {
    const after = (k: number) => (raw.transitions ?? []).filter((t) => JSON.stringify(t.at) === JSON.stringify({ word: k + 1 }))
    const hit = after(marks.pauses[0]!.after)
    expect(hit).toHaveLength(1)
    expect(hit[0]!.params.hit).toBe(true)
    expect(after(marks.pauses[1]!.after)).toHaveLength(0)
  })

  it('planned pace: max event gap ≤ 1.0 s, median 0.3–0.55 s', () => {
    const p = plannedPace(sb)
    expect(p.maxEventGap).toBeLessThanOrEqual(1.0)
    expect(p.medianEventGap).toBeGreaterThanOrEqual(0.3)
    expect(p.medianEventGap).toBeLessThanOrEqual(0.55)
  })

  it('no kinetic-text scene is longer than KINETIC_MAX_REST_SEC', () => {
    for (const s of sb.scenes.filter((x) => x.type === 'kinetic-text')) {
      expect(s.duration + (s.preroll ?? 0)).toBeLessThanOrEqual(KINETIC_MAX_REST_SEC)
    }
  })

  it('audio: the voice, and the music from musicFrom', () => {
    expect(raw.audio).toEqual([
      { kind: 'voice', media: 'm1' },
      { kind: 'music', media: 'm2', in: 12 },
    ])
  })

  it('cta.keyword → the last scene is a comment-cta of at most 2.5 s', () => {
    const end = Math.max(...sb.scenes.map((s) => s.start + s.duration))
    const last = sb.scenes.filter((s) => s.track === 1).sort((a, b) => a.start - b.start).at(-1)!
    expect(last.type).toBe('comment-cta')
    expect(last.params.keyword).toBe('دليل')
    expect(last.start + last.duration).toBeCloseTo(end, 6)
    expect(last.duration).toBeLessThanOrEqual(2.5)
    expect(last.start).toBeGreaterThanOrEqual(transcript.words.at(-1)!.end - 1e-9)
  })

  it('without a keyword the CTA is kinetic text held at most 2 s', () => {
    const s = load(build(parseBrief({ title: 'وفّر وقتك ومالك', cta: 'تابعني للمزيد' })))
    const last = s.scenes.filter((x) => x.track === 1).sort((a, b) => a.start - b.start).at(-1)!
    expect(last.type).toBe('kinetic-text')
    expect((last.params.words as { text: string }[]).map((w) => w.text).join(' ')).toBe('تابعني للمزيد')
    expect(last.duration).toBeLessThanOrEqual(2 + 1e-9)
    expect(plannedPace(s).maxEventGap).toBeLessThanOrEqual(1.0)
  })

  it('no title: the hook is the first spoken words (at most 3), shown from frame 0', () => {
    const s = load(build(parseBrief({})))
    const hook = s.scenes.find((x) => x.start === 0 && x.type === 'kinetic-text')!
    const ws = hook.params.words as { text: string; at: number }[]
    expect(ws[0]).toMatchObject({ text: 'هذه', at: 0 })
    expect(ws.length).toBeLessThanOrEqual(3)
  })

  it('I1: without a title the first beat keeps its visuals (المال → banknote; ٣٠٠ in an 18-word opening → counter)', () => {
    const raw = build(parseBrief({}))
    expect(raw.scenes.find((x) => x.type === 'icon' && x.params.icon === 'banknote')?.start).toEqual({ word: W('المال') })
    const texts = 'اليوم سأشرح لكم بالتفصيل كيف يمكن أن نوفر أكثر من ٣٠٠ ساعة في السنة على أعمال مكررة ومملة'.split(' ')
    expect(texts).toHaveLength(18)
    const ws = texts.map((text, i) => ({ i, text, start: 0.2 + i * 0.38, end: 0.5 + i * 0.38, p: 0.9 }))
    const t: Transcript = { ...transcript, words: ws }
    const m: Marks = { stress: [], pauses: [], unmatched: [], sections: [] }
    const out = explainerStoryboard({ transcript: t, marks: m, brief: {}, voiceMedia: 'm1', fps: 30, seed: 1 }) as Raw
    parseStoryboard(resolveAnchors(out, { transcript: t, marks: m, fps: 30 }).json, [...PRIMITIVE_IDS])
    expect(out.scenes.find((x) => x.type === 'counter')).toMatchObject({ start: { word: texts.indexOf('٣٠٠') - 1 }, params: { to: 300, prefix: 'من' } })
  })

  it('I2: fillers are highlights on their host, never overlapping each other', () => {
    for (const type of BRIEF_TYPES) {
      const m = marksOf(SECTIONED)
      const s = load(build(parseBrief({ ...BRIEF, type }), m), m)
      const fillers = s.scenes.filter((x) => /^f\d+$/.test(x.id)).sort((a, b) => a.start - b.start)
      if (TYPE_PRESETS[type].intensity >= 3) expect(fillers.length, type).toBeGreaterThan(0)
      fillers.forEach((f, x) => {
        if (x > 0) expect(f.start, type).toBeGreaterThanOrEqual(fillers[x - 1]!.start + fillers[x - 1]!.duration - 1e-9)
        const host = s.scenes.find((h) => h.track === 1 && h.start <= f.start + 1e-9 && f.start < h.start + h.duration - 1e-9)!
        expect(host, `${type} ${f.id}`).toBeDefined()
        if (host.type === 'checklist') {
          // Fix wave I4: no check icon above a ticking list; an underline under a row already in.
          const items = host.params.items as { at: number; key?: string }[]
          const row = items.find((it) => it.key === f.params.target)
          expect(f.type).toBe('highlight')
          expect(row, `${type} ${f.id}`).toBeDefined()
          expect(host.start + row!.at).toBeLessThanOrEqual(f.start + 1e-9)
          expect(f.start + f.duration).toBeLessThanOrEqual(host.start + host.duration + 1e-9)
        } else {
          expect(f).toMatchObject({ type: 'highlight', params: { kind: 'underline', target: host.params.key } })
          expect(f.start + f.duration).toBeLessThanOrEqual(host.start + host.duration + 1e-9)
        }
      })
      expect(s.scenes.some((x) => x.type === 'line-art' && x.params.art === 'underline' && (x.params.at as { y: number } | undefined)?.y === 0.8)).toBe(false)
    }
  })

  it('R22: no hit list within 1.5 s after another checklist; one 1.5 s or more after it is allowed', () => {
    const m: Marks = { stress: [], pauses: [], unmatched: [], sections: [] }
    const run = (lead: string) => {
      const texts = `أولاً اكتب النص ثانياً سجل صوتك ${lead} عن المال ثم عن الوقت وأخيرا عن الأمان في كل مرة`.split(' ')
      let t = 2
      const ws = texts.map((text, i) => {
        const w = { i, text, start: t, end: t + 0.3, p: 0.9 }
        t += i === 5 ? 0.8 : 0.4 // a 0.5 s silence after the list: a new beat
        return w
      })
      const tr: Transcript = { ...transcript, words: ws }
      const out = explainerStoryboard({ transcript: tr, marks: m, brief: { title: 'عنوان' }, voiceMedia: 'm1', fps: 30, seed: 1 }) as Raw
      parseStoryboard(resolveAnchors(out, { transcript: tr, marks: m, fps: 30 }).json, [...PRIMITIVE_IDS])
      return out.scenes.filter((x) => x.type === 'checklist')
    }
    // The ordinal list (أولاً … ثانياً), then a sentence with 3 distinct visuals: its first hit
    // 0.4 s after the list ends → no second list; 2.0 s after → a second list.
    expect(run('هنا')).toHaveLength(1)
    const later = run('هنا نبدأ الحديث اليوم بالتفصيل')
    expect(later).toHaveLength(2)
    expect(later[1]!.params.items).toHaveLength(3)
  })
  it('I4 / R22: an ordinary sentence with keyword hits is not a checklist; a spread list of 3 distinct visuals is', () => {
    const raw = build()
    expect(raw.scenes.filter((x) => x.type === 'checklist')).toHaveLength(1) // only the ordinal list
    const texts = 'في هذا الشرح نتكلم عن المال ثم عن الوقت وأخيرا عن الأمان في كل مرة'.split(' ')
    const ws = texts.map((text, i) => ({ i, text, start: 0.2 + i * 0.4, end: 0.5 + i * 0.4, p: 0.9 }))
    const t: Transcript = { ...transcript, words: ws }
    const m: Marks = { stress: [], pauses: [], unmatched: [], sections: [] }
    const out = explainerStoryboard({ transcript: t, marks: m, brief: { title: 'عنوان' }, voiceMedia: 'm1', fps: 30, seed: 1 }) as Raw
    const list = out.scenes.find((x) => x.type === 'checklist')!
    expect(list.params.items.map((it: any) => it.at)).toEqual([{ word: texts.indexOf('المال') }, { word: texts.indexOf('الوقت') }, { word: texts.indexOf('الأمان') }])
    // Fix round 3: a row never ends on a particle («ثم», «عن»).
    expect(list.params.items[0].text).toBe('المال')
  })

  it('highlights and morph keys are consistent: every highlight target covers it', () => {
    // validateSceneParams already checks targets; make sure the recipe can emit them (motion type).
    const s = load(build(parseBrief({ ...BRIEF, type: 'motion' })))
    expect(s.scenes.some((x) => x.type === 'highlight')).toBe(true)
  })

  it('same input twice → deep-equal output', () => {
    expect(build()).toEqual(build())
    expect(JSON.stringify(build(parseBrief({ type: 'motion', hook: { family: 'تحذير' } })))).toBe(
      JSON.stringify(build(parseBrief({ type: 'motion', hook: { family: 'تحذير' } }))),
    )
  })
})

describe('robustness', () => {
  const tOf = (ws: TranscriptWord[]): Transcript => ({ ...transcript, words: ws.map((w, i) => ({ ...w, i })) })
  const at = (text: string, start: number) => ({ i: 0, text, start, end: start + 0.3, p: 0.9 })
  const cases: [string, TranscriptWord[]][] = [
    ['one word at 0', [at('مرحبا', 0)]],
    ['three words', [at('هذا', 0.3), at('المال', 0.7), at('مهم', 1.1)]],
    ['a 14 s silence', [at('أولا', 0.2), at('نبدأ', 0.6), at('ثم', 15), at('ننتهي', 15.4)]],
    ['120 words', Array.from({ length: 120 }, (_, k) => at(['الوقت', 'كلمة', '٥٠', 'المال', 'نص'][k % 5]!, 0.2 + k * 0.37))],
  ]
  for (const [name, ws] of cases) {
    it(`${name}: every type builds a valid storyboard with no kinetic-text scene over 12 s`, () => {
      const t = tOf(ws)
      const m: Marks = { stress: [], pauses: [], unmatched: [], sections: [] }
      for (const type of BRIEF_TYPES) {
        for (const brief of [{ type }, { type, title: 'عنوان', cta: 'تابع' }, { type, hook: { family: 'تحذير' }, cta: { keyword: 'دليل' } }]) {
          const raw = explainerStoryboard({ transcript: t, marks: m, brief: parseBrief(brief), voiceMedia: 'm1', fps: 30, seed: 3 })
          const sb = parseStoryboard(resolveAnchors(raw, { transcript: t, marks: m, fps: 30 }).json, [...PRIMITIVE_IDS])
          validateSceneParams(sb)
          for (const s of sb.scenes.filter((x) => x.type === 'kinetic-text')) expect(s.duration, `${name} ${type}`).toBeLessThanOrEqual(KINETIC_MAX_REST_SEC)
          expect(sb.scenes.some((x) => x.start === 0 && x.track === 1 && x.type === 'kinetic-text')).toBe(true)
        }
      }
    }, 30_000)
  }
  it('an empty transcript is refused (Arabic first)', () => {
    expect(() => explainerStoryboard({ transcript: tOf([]), marks, brief: {}, voiceMedia: 'm1', fps: 30, seed: 1 })).toThrow(/^[؀-ۿ]/)
  })
})

describe('fix round 2: what the frame shows', () => {
  it('checklist rows drop the ordinal, keep ≤ 20 characters of whole words, and keep the verb', () => {
    const list = build().scenes.find((x) => x.type === 'checklist')!
    for (const it of list.params.items) expect([...it.text].length).toBeLessThanOrEqual(20)
    expect(list.params.items.map((it: any) => it.text)).toEqual(['اكتب النص', 'سجل صوتك', 'خل المحرك يشتغل'])
  })
  it('rowText: ordinal dropped first, then ≤ 20 characters, never a trailing particle', () => {
    expect(rowText(['ثالثاً', 'خل', 'المحرك', 'يشتغل'])).toBe('خل المحرك يشتغل')
    // «اكتب النص الذي تريده» is 20 characters: kept whole; «اليوم» would pass 20.
    expect(rowText(['أولاً', 'اكتب', 'النص', 'الذي', 'تريده', 'اليوم'])).toBe('اكتب النص الذي تريده')
    expect(rowText(['أولاً', 'اكتب', 'النص', 'الذي', 'تريدونه', 'اليوم'])).toBe('اكتب النص')
    expect(rowText(['المال', 'ثم', 'عن', 'الوقت'])).toBe('المال ثم عن الوقت')
    expect(rowText(['المال', 'ثم', 'عن'])).toBe('المال')
    expect(rowText(['أولاً'])).toBe('أولاً')
  })
  it('a mark-type keyword (circle-mark, underline, bracket) punches its word (stress 1) instead of drawing in the top band', () => {
    const raw = build()
    expect(raw.scenes.some((x) => x.type === 'line-art' && ['circle-mark', 'underline', 'bracket'].includes(x.params.art))).toBe(false)
    const word = raw.scenes.flatMap((x) => (x.type === 'kinetic-text' ? x.params.words : [])).find((w: any) => w.text === 'والنتيجة')
    expect(word).toMatchObject({ stress: 1 })
  })
  it('the warning stamp is large (45 % of the safe width) below a one-line hook', () => {
    const raw = build(parseBrief({ ...BRIEF, hook: { family: 'تحذير' } }))
    expect(raw.scenes.find((x) => x.type === 'stamp')!.params).toMatchObject({ size: 0.45, at: { x: 0.5, y: 0.78 } })
    expect(raw.scenes.find((x) => x.id === 'hook')!.params.mode).toBe('line')
  })
  it('motion: a stressed word is circled by a key on that word alone', () => {
    const s = load(build(parseBrief({ ...BRIEF, type: 'motion' })))
    // Fix round 3: an underline under the word (a circle in a stack cut through the rows around it).
    // Plan 2a+ Task 9: every transcript word carries the key `w<index>`; the underline targets it.
    const hl = s.scenes.find((x) => x.type === 'highlight' && /^w\d+$/.test(String(x.params.target)))!
    expect(hl.params.kind).toBe('underline')
    const host = s.scenes.find((x) => x.type === 'kinetic-text' && (x.params.words as { key?: string }[]).some((w) => w.key === hl.params.target))!
    expect((host.params.words as { text: string; key?: string }[]).find((w) => w.key === hl.params.target)!.text).toBe('المال')
    // The word's own key, never the block's (a pace filler may underline the block separately).
    expect(hl.params.target).not.toBe(host.params.key)
  })
  it('R23: the motion median range is 0.3–0.45 s', () => {
    expect(TYPE_PRESETS.motion.medianGap).toEqual([0.3, 0.45])
  })
})

describe('morph between consecutive beats', () => {
  it('two beats each opening with an icon → a morph on the visuals track with a shared key', () => {
    const texts = ['نبدأ', 'بالمال', 'هنا', 'الوقت', 'يمر', 'كثير', 'اليوم']
    const starts = [1.6, 2.0, 2.4, 3.3, 3.7, 4.1, 4.5]
    const ws = texts.map((text, i) => ({ i, text, start: starts[i]!, end: starts[i]! + 0.3, p: 0.9 }))
    const t: Transcript = { ...transcript, words: ws }
    const m = alignScript(parseScript('نبدأ بالمال هنا «...» الوقت يمر كثير اليوم'), ws)
    const raw = explainerStoryboard({ transcript: t, marks: m, brief: parseBrief({ title: 'عنوان' }), voiceMedia: 'm1', fps: 30, seed: 1 }) as Raw
    parseStoryboard(resolveAnchors(raw, { transcript: t, marks: m, fps: 30 }).json, [...PRIMITIVE_IDS])
    const morph = (raw.transitions ?? []).find((x) => x.type === 'morph')!
    expect(morph).toMatchObject({ track: 2, at: { word: 3 } })
    const keyed = raw.scenes.filter((s) => s.params.key === morph.params.key)
    expect(keyed.map((s) => s.params.icon)).toEqual(['banknote', 'clock'])
  })
})

describe('video types (TYPE_PRESETS)', () => {
  it('every BriefType parses and its planned median lies in its preset range', () => {
    for (const type of BRIEF_TYPES) {
      const s = load(build(parseBrief({ ...BRIEF, type })))
      const p = plannedPace(s)
      const [lo, hi] = TYPE_PRESETS[type].medianGap
      expect(p.medianEventGap, type).toBeGreaterThanOrEqual(lo)
      expect(p.medianEventGap, type).toBeLessThanOrEqual(hi)
      if (TYPE_PRESETS[type].intensity >= 3) expect(p.maxEventGap, type).toBeLessThanOrEqual(1.0)
      // Plan 2a+ Task 9: plus the director's flood / iris cuts.
      for (const t of s.transitions ?? []) expect([...TYPE_PRESETS[type].transitions, 'flood', 'iris'], type).toContain(t.type)
    }
  })
  it('corporate: no hit transitions, SFX 4 dB softer, no HUD', () => {
    const raw = build(parseBrief({ ...BRIEF, type: 'corporate' }), marksOf(SECTIONED))
    load(raw, marksOf(SECTIONED))
    expect((raw.transitions ?? []).filter((t) => t.params.hit)).toEqual([])
    expect(raw.sfxGainDb).toBe(-4)
    expect(raw.scenes.some((s) => s.type === 'hud')).toBe(false)
  })
  it('product-launch with 2 screens places 2 phone scenes showing them, in order, each ≤ ~4 s', () => {
    const raw = build(parseBrief({ ...BRIEF, type: 'product-launch', screens: ['شاشة 1.png', 'shot2.png'] }))
    const sb = load(raw)
    const phones = raw.scenes.filter((s) => s.type === 'phone')
    expect(phones.map((p) => p.params.screen)).toEqual([{ image: 'source/شاشة 1.png' }, { image: 'source/shot2.png' }])
    for (const p of sb.scenes.filter((s) => s.type === 'phone')) expect(p.duration).toBeLessThanOrEqual(4.5)
  })
  it('Task 12: edit.json stays valid when one word of a new transcript moves 0.2 s (a filler ending with its host shares its end anchor)', () => {
    const m = marksOf(SECTIONED)
    for (const type of BRIEF_TYPES) {
      const raw = build(parseBrief({ ...BRIEF, type, screens: ['a.png', 'b.png'] }), m)
      const bad: string[] = []
      for (let k = 0; k < transcript.words.length; k++) {
        for (const dt of [0.2, -0.2]) {
          const ws = transcript.words.map((w) => ({ ...w }))
          const w = ws[k]!
          if (w.end + dt > (ws[k + 1]?.start ?? 99) - 0.02 || w.start + dt < (ws[k - 1]?.end ?? 0) + 0.02) continue
          w.start = Math.round((w.start + dt) * 1000) / 1000
          w.end = Math.round((w.end + dt) * 1000) / 1000
          const t: Transcript = { ...transcript, words: ws }
          try {
            validateSceneParams(parseStoryboard(resolveAnchors(raw, { transcript: t, marks: m, fps: 30 }).json, [...PRIMITIVE_IDS]))
          } catch (e) {
            bad.push(`word ${k} ${dt > 0 ? '+' : ''}${dt}: ${(e as Error).message.slice(0, 80)}`)
          }
        }
      }
      expect(bad, type).toEqual([])
    }
  })
  it('screens: a landscape one goes in an app window; screens with no room are reported (Arabic first)', () => {
    const warnings: string[] = []
    const screens = ['wide.png', 'tall.png', ...Array.from({ length: 6 }, (_, k) => `x${k}.png`)]
    const raw = explainerStoryboard({
      transcript,
      marks,
      brief: parseBrief({ ...BRIEF, type: 'product-launch', screens }),
      voiceMedia: 'm1',
      fps: 30,
      seed: 7,
      screenSizes: { 'wide.png': { w: 1920, h: 1080 }, 'tall.png': { w: 1080, h: 1920 } },
      warnings,
    }) as Raw
    load(raw)
    expect(raw.scenes.find((s) => s.type === 'app-window')?.params).toMatchObject({ mode: 'app', image: 'source/wide.png' })
    expect(raw.scenes.find((s) => s.type === 'phone')?.params.screen).toEqual({ image: 'source/tall.png' })
    expect(warnings.some((w) => /^[\u0600-\u06FF]/.test(w) && /x5\.png/.test(w))).toBe(true)
  })
  it('product-launch without sections or screens is warned about (Arabic first)', () => {
    const warnings: string[] = []
    explainerStoryboard({ transcript, marks, brief: parseBrief({ ...BRIEF, type: 'product-launch' }), voiceMedia: 'm1', fps: 30, seed: 7, warnings })
    expect(warnings.filter((w) => /product-launch/.test(w))).toHaveLength(2)
    expect(warnings.every((w) => /^[\u0600-\u06FF]/.test(w))).toBe(true)
  })
  it('median steering that cannot reach the range is warned about', () => {
    const warnings: string[] = []
    const ws = [{ i: 0, text: 'كلمة', start: 0.2, end: 0.5, p: 0.9 }]
    const t: Transcript = { ...transcript, words: ws }
    explainerStoryboard({ transcript: t, marks: { stress: [], pauses: [], unmatched: [], sections: [] }, brief: { type: 'corporate' }, voiceMedia: 'm1', fps: 30, seed: 1, warnings })
    expect(warnings.some((w) => /planned median/.test(w))).toBe(true)
  })
  it('section hits for product-launch and motion; pause hits for explainer', () => {
    const m = marksOf(SECTIONED)
    for (const type of ['product-launch', 'motion'] as const) {
      const raw = build(parseBrief({ ...BRIEF, type }), m)
      load(raw, m)
      const at = (k: number) => (raw.transitions ?? []).find((t) => JSON.stringify(t.at) === JSON.stringify({ word: k }))
      expect(at(m.sections![2]!.word)?.params.hit, type).toBe(true)
    }
  })
})

describe('hook families', () => {
  it('has the 12 families', () => {
    expect(HOOK_FAMILIES_AR).toHaveLength(12)
    expect(HOOK_FAMILIES_AR.map((h) => h.id)).toContain('تحذير')
  })
  it('every family builds a valid storyboard with text on frame 0 and a change by 0.5 s', () => {
    for (const h of HOOK_FAMILIES_AR) {
      const s = load(build(parseBrief({ ...BRIEF, hook: { family: h.id, text: 'هل تضيع ٣٠٠ ساعة كل سنة؟' } })))
      const at0 = s.scenes.filter((x) => x.start === 0 && x.track === 1)
      expect(at0.some((x) => x.type === 'kinetic-text'), h.id).toBe(true)
      const p = plannedPace(s)
      expect(p.events.filter((t) => t > 0 && t <= 0.5).length, h.id).toBeGreaterThan(0)
    }
  })
  it('I5: a one-word hook gets an accent by 0.4 s (a registered change by 0.5 s)', () => {
    const s = load(build(parseBrief({ ...BRIEF, title: 'وفّر' })))
    const hook = s.scenes.find((x) => x.id === 'hook')!
    expect((hook.params.words as unknown[]).length).toBe(1)
    const accent = s.scenes.find((x) => x.type === 'highlight' && x.params.target === hook.params.key)!
    expect(accent.start).toBeLessThanOrEqual(0.4)
    expect(plannedPace(s).events.filter((t) => t > 0 && t <= 0.5).length).toBeGreaterThan(0)
  })
  it('تحذير puts a stamp in the frame-0 scenes', () => {
    const s = load(build(parseBrief({ ...BRIEF, hook: { family: 'تحذير' } })))
    expect(s.scenes.some((x) => x.type === 'stamp' && x.start === 0)).toBe(true)
  })
  it('رقم → a counter in the hook; سؤال → stress 2; قبل/بعد → a wipe at 1.0 s; وعد بقائمة → a hud from 0', () => {
    const num = load(build(parseBrief({ ...BRIEF, hook: { family: 'نتيجة/رقم', text: '٣٠٠ ساعة ضايعة' } })))
    expect(num.scenes.some((x) => x.type === 'counter' && x.start <= 0.5 && x.params.to === 300)).toBe(true)
    const q = load(build(parseBrief({ ...BRIEF, hook: { family: 'سؤال مباشر', text: 'ليش تضيع وقتك؟' } })))
    const qh = q.scenes.find((x) => x.start === 0 && x.type === 'kinetic-text')!
    expect((qh.params.words as { stress: number }[]).some((w) => w.stress === 2)).toBe(true)
    const ba = load(build(parseBrief({ ...BRIEF, hook: { family: 'قبل/بعد', text: 'قبل ساعات بعد دقائق' } })))
    expect(ba.transitions!.some((t) => t.type === 'color-wipe' && Math.abs(t.at - 1) < 1e-9 && t.track === 1)).toBe(true)
    const list = load(build(parseBrief({ ...BRIEF, hook: { family: 'وعد بقائمة', text: 'ثلاث خطوات فقط' } })))
    expect(list.scenes.some((x) => x.type === 'hud' && x.start === 0)).toBe(true)
  })
  it('an unknown family is refused (Arabic first)', () => {
    expect(() => parseBrief({ hook: { family: 'غير موجود' } })).toThrow(/^[^A-Za-z]*عائلة/)
  })
})

describe('script sections', () => {
  it('3 `# ` sections → a hud with 3 sections anchored to their first words, and a background switch at each', () => {
    const m = marksOf(SECTIONED)
    expect(m.sections!.map((x) => x.word)).toEqual([0, 8, W('الحل')])
    const raw = build(BRIEF, m)
    load(raw, m)
    const hud = raw.scenes.find((s) => s.type === 'hud')!
    expect(hud.params.sections).toEqual([
      { label: 'المقدمة', at: { word: 0 } },
      { label: 'المشكلة', at: { word: 8 } },
      { label: 'الحل', at: { word: W('الحل') } },
    ])
    const bg = raw.scenes.filter((s) => s.type === 'backdrop')
    // Plan 2a+ Task 9: each section flips the colour world, so its backdrop starts exactly on its
    // section word (an instant flip, not V1's 0.4 s cross-fade).
    // The comment card (cta.keyword) is never shown in the accent world: the frame flips back to paper as it comes in.
    const end = { word: transcript.words.length - 1, edge: 'end', offset: 0.2 }
    expect(bg.map((s) => s.start)).toEqual([0, { word: 8 }, { word: W('الحل') }, end])
    expect(bg.map((s) => s.params.fadeIn)).toEqual([undefined, undefined, undefined, undefined])
    expect(bg.slice(0, 3).map((s) => s.duration)).toEqual([{ until: { word: 8 } }, { until: { word: W('الحل') } }, { until: end }])
    expect(bg.map((s) => s.params.world)).toEqual(['paper', 'ink', 'accent', 'paper'])
    expect(new Set(bg.map((s) => s.params.tone)).size).toBeGreaterThan(1)
  })
})

describe('mba explain (CLI)', () => {
  const root = resolve(__dirname, '../..')
  const run = (dir: string, ...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src/cli.ts'), 'explain', dir, ...args], { cwd: root, encoding: 'utf8' })

  it('writes edit.json, refuses to overwrite a manual edit without --force, appends log.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mba explain '))
    try {
      const manifest = {
        version: 1,
        id: 'explain-test',
        createdAt: '2026-10-30T00:00:00.000Z',
        fps: 30,
        format: '9:16',
        media: [{ id: 'm1', source: 'source/voice.wav', durationSec: 18, kind: 'audio' }],
      }
      writeFileSync(join(dir, 'mba-project.json'), JSON.stringify(manifest))
      writeFileSync(join(dir, 'transcript.json'), JSON.stringify(transcript))
      writeFileSync(join(dir, 'marks.json'), JSON.stringify(marks))
      writeFileSync(join(dir, 'brief.json'), JSON.stringify({ title: 'وفّر وقتك ومالك' }))
      writeFileSync(join(dir, 'log.md'), '# log\n\n')
      // The init placeholder may be replaced.
      writeFileSync(join(dir, 'edit.json'), JSON.stringify({ version: 1, scenes: [{ id: 'c1', type: 'wipe-reveal', start: 0, duration: 18, params: { title: 'x' } }] }))

      const first = run(dir)
      expect(first.status, first.stderr).toBe(0)
      const written = readFileSync(join(dir, 'edit.json'), 'utf8')
      expect(JSON.parse(written).scenes.length).toBeGreaterThan(5)
      // Unchanged since the last run: overwritten without --force.
      expect(run(dir).status).toBe(0)

      const edited = JSON.parse(written)
      edited.scenes[1].id = 'mine'
      writeFileSync(join(dir, 'edit.json'), JSON.stringify(edited, null, 2))
      const refused = run(dir)
      expect(refused.status).toBe(1)
      expect(refused.stderr).toMatch(/^[؀-ۿ]/)
      expect(refused.stderr).toMatch(/--force/)
      expect(JSON.parse(readFileSync(join(dir, 'edit.json'), 'utf8')).scenes[1].id).toBe('mine')

      expect(run(dir, '--force').status).toBe(0)
      expect(readFileSync(join(dir, 'edit.json'), 'utf8')).toBe(written)
      expect(readFileSync(join(dir, 'log.md'), 'utf8')).toMatch(/explain/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('without a transcript: exit 1, Arabic first, nothing written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mba explain '))
    try {
      writeFileSync(
        join(dir, 'mba-project.json'),
        JSON.stringify({ version: 1, id: 'explain-test-2', createdAt: '2026-10-30T00:00:00.000Z', media: [] }),
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/^[؀-ۿ]/)
      expect(existsSync(join(dir, 'edit.json'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('mba explain: brief media checks and output labels (fix round 1)', () => {
  const root = resolve(__dirname, '../..')
  const run = (dir: string) => spawnSync(process.execPath, ['--import', 'tsx', join(root, 'src/cli.ts'), 'explain', dir], { cwd: root, encoding: 'utf8' })
  const project = (brief: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), 'mba explain '))
    const media = [{ id: 'm1', source: 'source/voice.wav', durationSec: 18, kind: 'audio' }]
    writeFileSync(join(dir, 'mba-project.json'), JSON.stringify({ version: 1, id: 'explain-test-3', createdAt: '2026-10-30T00:00:00.000Z', media }))
    writeFileSync(join(dir, 'transcript.json'), JSON.stringify(transcript))
    writeFileSync(join(dir, 'brief.json'), JSON.stringify(brief))
    writeFileSync(join(dir, 'log.md'), '# log\n\n')
    return dir
  }
  it('a missing musicMedia or screen file: exit 1, Arabic first, no edit.json', () => {
    for (const brief of [{ musicMedia: 'm9' }, { type: 'product-launch', screens: ['missing.png'] }]) {
      const dir = project(brief)
      try {
        const r = run(dir)
        expect(r.status, JSON.stringify(brief)).toBe(1)
        expect(r.stderr).toMatch(/^[؀-ۿ]/)
        expect(existsSync(join(dir, 'edit.json'))).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  }, 60_000)
  it('pace numbers are labelled planned (no "moving 100 %"); warnings are printed and logged', () => {
    const dir = project({ type: 'product-launch' })
    try {
      const r = run(dir)
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toMatch(/Planned pace \(an estimate; mba review decides\)/)
      expect(r.stdout).not.toMatch(/moving/)
      expect(r.stdout).toMatch(/Warning: .*product-launch/)
      expect(readFileSync(join(dir, 'log.md'), 'utf8')).toMatch(/planned \(estimate, mba review decides\)/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
  it('brief.style: a missing or invalid style file is refused (exit 1, Arabic first); a valid one is read and its warnings logged', () => {
    const dir = project({ style: 'refs/style.json' })
    try {
      const missing = run(dir)
      expect(missing.status).toBe(1)
      expect(missing.stderr).toMatch(/^[؀-ۿ]/)
      expect(missing.stderr).toContain('style.json')
      expect(existsSync(join(dir, 'edit.json'))).toBe(false)
      mkdirSync(join(dir, 'refs'))
      writeFileSync(join(dir, 'refs', 'style.json'), JSON.stringify({ version: 1 }))
      const invalid = run(dir)
      expect(invalid.status).toBe(1)
      expect(invalid.stderr).toMatch(/^[؀-ۿ]/)
      const style = {
        version: 1,
        sources: [{ file: 'a.mp4', sha1: 'a'.repeat(40), duration: 3 }],
        rhythm: { eventsPerSec: [2, 3], medianEventGap: [0.3, 0.4], maxEventGap: 0.9, movingPct: 0.9, medianShot: null, cutsPerSec: null, continuous: null },
        colours: [],
        text: { density: 'unknown' },
        motion: { size: 'unknown' },
        signature: [],
        warnings: ['المرجع «a.mp4» قصير — reference "a.mp4" is short'],
      }
      writeFileSync(join(dir, 'refs', 'style.json'), JSON.stringify(style))
      const ok = run(dir)
      expect(ok.status, ok.stderr).toBe(0)
      expect(readFileSync(join(dir, 'log.md'), 'utf8')).toContain('a.mp4')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
  it('imageSize reads PNG and JPEG headers', async () => {
    const { imageSize } = await import('../../src/node/explain')
    const png = Buffer.alloc(24)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(1920, 16)
    png.writeUInt32BE(1080, 20)
    expect(imageSize(png)).toEqual({ w: 1920, h: 1080 })
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x07, 0x80, 0x04, 0x38, 0x03])
    expect(imageSize(jpg)).toEqual({ w: 1080, h: 1920 })
    expect(imageSize(Buffer.from('nope'))).toBeUndefined()
  })
})

describe('fix wave: the real v1-voice recording', () => {
  const dir = new URL('../fixtures/v1-voice/', import.meta.url)
  const read = (f: string) => readFileSync(fileURLToPath(new URL(f, dir)), 'utf8')
  const t = parseTranscriptJson(read('transcript.json'))
  const m = alignScript(parseScript(read('script.md')), t.words)
  const brief = parseBrief(JSON.parse(read('brief.json')))
  const out = explainerStoryboard({ transcript: t, marks: m, brief, voiceMedia: 'm1', fps: 30, seed: 11 }) as Raw & { transcript?: unknown }
  const sb = parseStoryboard(resolveAnchors(out, { transcript: t, marks: m, fps: 30 }).json, [...PRIMITIVE_IDS])
  validateSceneParams(sb)
  const main = sb.scenes.filter((s) => s.track === 1).sort((a, b) => a.start - b.start)
  const kinetic = main.filter((s) => s.type === 'kinetic-text')
  const shownWords = kinetic.flatMap((s) => (s.params.words as { text: string }[]).map((w) => w.text))

  it('I2: on-screen words are the script’s («علّق», «السكربت», «سجّل»), never whisper’s misspellings', () => {
    // Kinetic words and checklist rows (أولاً … ثالثاً is a checklist).
    const rows = main.filter((s) => s.type === 'checklist').flatMap((s) => (s.params.items as { text: string }[]).map((it) => it.text))
    const all = [...shownWords, ...rows.flatMap((r) => r.split(' '))]
    expect(all).toContain('علّق')
    expect(all).toContain('السكربت')
    expect(all).toContain('سجّل')
    expect(all).toContain('تضيّع')
    expect(all).not.toContain('علك')
    expect(all).not.toContain('السكريبت')
    expect(all).not.toContain('سجل')
  })
  it('I2: the counter keeps whisper’s digits (300 from «ثلاثمية»)', () => {
    const counter = main.find((s) => s.type === 'counter')!
    expect(counter.params.to).toBe(300)
  })
  it('I3: edit.json names the transcript it was written for (sourceHash, word count and the words hash)', () => {
    expect(out.transcript).toEqual({ sourceHash: t.sourceHash, words: 48, hash: transcriptHash(t) })
    expect(sb.transcript).toEqual({ sourceHash: t.sourceHash, words: 48, hash: transcriptHash(t) })
  })
  it('I4: no kinetic chunk ends on a particle', () => {
    for (const s of kinetic) {
      const ws = s.params.words as { text: string }[]
      if (ws.length > 1) expect(['في', 'من', 'على', 'إلى', 'عن', 'مع', 'و', 'كل'], s.id).not.toContain(ws.at(-1)!.text)
    }
  })
  it('I4: kinetic text sits near 0.42 of the frame height and entrances rotate (never 4 in a row the same)', () => {
    // Ruling T9-c: text under a section number sits below its band instead.
    const nums = sb.scenes.filter((x) => x.type === 'section-number')
    for (const s of kinetic.filter((k) => !nums.some((n) => k.start < n.start + n.duration - 1e-9 && n.start < k.start + k.duration - 1e-9))) {
      const rows = s.params.mode === 'stack' ? (s.params.words as unknown[]).length : 1
      expect(s.params.y as number).toBeCloseTo(0.42 + 0.04 * (rows - 1), 6)
    }
    const enters = kinetic.map((s) => s.params.enter)
    expect(new Set(enters).size).toBe(3)
    for (let x = 3; x < enters.length; x++) expect(new Set(enters.slice(x - 3, x + 1)).size, `scenes ${x - 3}..${x}`).toBeGreaterThan(1)
  })
  it('I4: the checklist rows aim at 100 px and no check-circle filler pops above it', () => {
    const list = main.find((s) => s.type === 'checklist')!
    expect(list.params.rowPx).toBe(100)
    expect(sb.scenes.some((s) => s.type === 'icon' && s.params.icon === 'check-circle')).toBe(false)
  })
  it('critic round 2: no kinetic chunk runs across a sentence end of the script', () => {
    for (const s of kinetic) {
      const ws = s.params.words as { text: string }[]
      const first = t.words.findIndex((w) => Math.abs(w.start - (s.start + (s.params.words as { at: number }[])[0]!.at)) < 0.04)
      if (first < 0) continue
      for (let q = 0; q + 1 < ws.length; q++) expect(m.stops, `${s.id} «${ws.map((w) => w.text).join(' ')}»`).not.toContain(first + q)
    }
  })
  it('critic round 2: the checklist is centred like the text; the cuts never repeat a transition', () => {
    const list = main.find((s) => s.type === 'checklist')!
    expect(list.params.y).toBeCloseTo(0.42 + 0.04 * ((list.params.items as unknown[]).length - 1), 6)
    const types = (sb.transitions ?? []).filter((tr) => tr.track === 1 && tr.type !== 'morph').map((tr) => tr.type)
    for (let x = 1; x < types.length; x++) expect(types[x]).not.toBe(types[x - 1])
    expect(types).not.toContain('whip-pan')
  })
  it('I4: a transition at every section change', () => {
    const cuts = (sb.transitions ?? []).filter((tr) => tr.track === 1).map((tr) => tr.at)
    for (const s of m.sections!.filter((x) => x.word > 0)) {
      const at = Math.round(t.words[s.word]!.start * 30) / 30
      expect(cuts.some((c) => Math.abs(c - at) < 1e-6), `section ${s.title} at ${at}`).toBe(true)
    }
  })
})

describe('I3: anchors tied to the transcript they were written for', () => {
  it('transcriptWarnings: another sourceHash or word count → a warning, Arabic first; the same → none', () => {
    expect(transcriptWarnings({ sourceHash: 'x', words: 40 }, transcript)).toEqual([])
    expect(transcriptWarnings(undefined, transcript)).toEqual([])
    const w = transcriptWarnings({ sourceHash: 'y', words: 41 }, transcript)
    expect(w).toHaveLength(2)
    for (const x of w) expect(x).toMatch(/^[؀-ۿ]/)
    expect(w[0]).toMatch(/another transcript/)
    expect(w[1]).toMatch(/41 words.*has 40/)
  })
  it('re-review: the same audio transcribed again (same sourceHash and word count, other words or times) → a warning on the words hash', () => {
    const h = transcriptHash(transcript)
    expect(transcriptWarnings({ sourceHash: 'x', words: 40, hash: h }, transcript)).toEqual([])
    const moved = { ...transcript, words: transcript.words.map((w, i) => (i === 5 ? { ...w, start: w.start + 0.2 } : w)) }
    const spelled = { ...transcript, words: transcript.words.map((w, i) => (i === 5 ? { ...w, text: w.text + 'ء' } : w)) }
    expect(transcriptHash(moved)).not.toBe(h)
    expect(transcriptHash(spelled)).not.toBe(h)
    expect(transcriptHash({ ...transcript, sourceHash: 'other' } as typeof transcript)).toBe(h)
    const w = transcriptWarnings({ sourceHash: 'x', words: 40, hash: h }, spelled)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/^[؀-ۿ]/)
    expect(w[0]).toMatch(/transcribed again|words changed/)
    // An edit.json written before the hash existed is not warned about on the hash alone.
    expect(transcriptWarnings({ sourceHash: 'x', words: 40 }, spelled)).toEqual([])
  })
  it('loadStoryboardFile warns when the project’s transcript.json is not the one edit.json names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mba i3 '))
    try {
      const manifest = { version: 1, id: 'i3', createdAt: '2026-10-30T00:00:00.000Z', fps: 30, format: '9:16', media: [] }
      writeFileSync(join(dir, 'mba-project.json'), JSON.stringify(manifest))
      writeFileSync(join(dir, 'transcript.json'), JSON.stringify(transcript))
      const edit = (ref: unknown) =>
        JSON.stringify({
          version: 1,
          autoSfx: false,
          transcript: ref,
          scenes: [{ id: 'a', type: 'kinetic-text', start: { word: 0 }, duration: { until: { word: 3 } }, params: { words: [{ text: 'هذه', at: { word: 0 } }] } }],
        })
      writeFileSync(join(dir, 'edit.json'), edit({ sourceHash: 'x', words: 40 }))
      expect((await loadStoryboardFile(join(dir, 'edit.json'))).warnings).toEqual([])
      writeFileSync(join(dir, 'edit.json'), edit({ sourceHash: 'old', words: 52 }))
      const w = (await loadStoryboardFile(join(dir, 'edit.json'))).warnings
      expect(w).toHaveLength(2)
      expect(w[0]).toMatch(/^[؀-ۿ].* — edit\.json was written for another transcript/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Task 7b: 60 fps by default; 30 only when the project says so', () => {
  const scene = [{ id: 'a', type: 'kinetic-text', start: 0, duration: 1, params: { words: [{ text: 'هذه', at: 0 }] } }]
  const loadFrom = async (manifestFps: number | undefined, editFps: number | undefined) => {
    const dir = mkdtempSync(join(tmpdir(), 'mba f60 '))
    try {
      const manifest = { version: 1, id: 'f60', createdAt: '2026-10-31T00:00:00.000Z', ...(manifestFps !== undefined ? { fps: manifestFps } : {}), format: '9:16', media: [] }
      writeFileSync(join(dir, 'mba-project.json'), JSON.stringify(manifest))
      writeFileSync(join(dir, 'edit.json'), JSON.stringify({ version: 1, autoSfx: false, ...(editFps !== undefined ? { fps: editFps } : {}), scenes: scene }))
      return (await loadStoryboardFile(join(dir, 'edit.json'))).sb.fps
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  it('an edit.json with no fps takes the project fps (60 by default, 30 when the project is 30)', async () => {
    expect(await loadFrom(60, undefined)).toBe(60)
    expect(await loadFrom(undefined, undefined)).toBe(60) // a manifest with no fps is a 60 fps project
    expect(await loadFrom(30, undefined)).toBe(30)
  })
  it('an explicit fps in edit.json is kept as written (30 stays 30)', async () => {
    expect(await loadFrom(30, 30)).toBe(30)
    expect(await loadFrom(60, 60)).toBe(60)
    expect(await loadFrom(60, 30)).toBe(30) // the render refuses the mismatch with its own Arabic-first error
  })
  it('the recipe compiles at the project fps: 60 gives fps 60, an explicit 30 stays 30', () => {
    for (const fps of [60, 30] as const) {
      const json = explainerStoryboard({ transcript, marks, brief: BRIEF, voiceMedia: 'm1', fps, seed: 7 }) as { fps: number }
      expect(json.fps, `fps ${fps}`).toBe(fps)
      parseStoryboard(resolveAnchors(json, { transcript, marks, fps }).json, [...PRIMITIVE_IDS])
    }
  })
})

describe('fix wave I2: a number whisper writes in words', () => {
  it('«ثلاثمائة ساعة» still becomes a counter to 300; «ثلاث خطوات» does not', () => {
    const texts = 'نحن نضيع دائما أكثر من ثلاثمائة ساعة بلا داع وبعدها ثلاث خطوات تكفي'.split(' ')
    const ws = texts.map((text, i) => ({ i, text, start: 0.2 + i * 0.4, end: 0.5 + i * 0.4, p: 0.9 }))
    const t: Transcript = { ...transcript, words: ws }
    const m: Marks = { stress: [], pauses: [], unmatched: [], sections: [] }
    const out = explainerStoryboard({ transcript: t, marks: m, brief: {}, voiceMedia: 'm1', fps: 30, seed: 1 }) as Raw
    const counters = out.scenes.filter((x) => x.type === 'counter')
    expect(counters.map((c) => c.params.to)).toEqual([300])
  })
})

describe('R28: spelled numbers in the recipe', () => {
  const mk = (text: string): Transcript => {
    let t = 0.2
    const ws = text.split(/\s+/).map((w, i) => {
      const start = Math.round(t * 1000) / 1000
      const end = Math.round((t + 0.3) * 1000) / 1000
      t = end + 0.08
      return { i, text: w, start, end, p: 0.9 }
    })
    return { version: 1, media: 'm1', sourceHash: 'x', model: 'ggml-small.bin', language: 'ar', words: ws }
  }
  const counters = (text: string) => {
    const t = mk(text)
    const raw = explainerStoryboard({ transcript: t, marks: alignScript(parseScript(text), t.words), brief: parseBrief({}), voiceMedia: 'm1', fps: 30, seed: 7 }) as Raw
    return raw.scenes.filter((s) => s.type === 'counter').map((s) => ({ to: s.params.to, suffix: s.params.suffix, start: s.start }))
  }
  it('«ألف وخمسمية ريال» is one counter to 1500 with the suffix ريال, starting on ألف', () => {
    const c = counters('اليوم نتكلم عن الادخار الذكي وتحتاج ألف وخمسمية ريال كل شهر لتبدأ في المشروع الصغير والنتيجة فيديو جاهز بسرعة')
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ to: 1500, suffix: 'ريال', start: { word: 6 } })
  })
  it('«تشرب مية كثير» makes no counter; «مية ساعة» does', () => {
    expect(counters('اليوم نتكلم عن الصحة وكل يوم تشرب مية كثير وهذا شي مهم جداً لك ولعائلتك والنتيجة فيديو جاهز بسرعة')).toEqual([])
    // (Few keyword hits on purpose: three hits in one beat would claim the words for a checklist first.)
    const c = counters('اليوم نتكلم عن المونتاج وكل سنة تخسر مية ساعة لوحدك بدون فايدة تذكر والنهاية قريبة جداً')
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ to: 100, suffix: 'ساعة' })
  })
})

describe('Plan 2a+ Task 9: compilePlan(planExplainer(i), i)', () => {
  const sectioned = marksOf(SECTIONED)
  const v1 = new URL('../fixtures/v1-voice/', import.meta.url)
  const v1t = parseTranscriptJson(readFileSync(fileURLToPath(new URL('transcript.json', v1)), 'utf8'))
  const v1m = alignScript(parseScript(readFileSync(fileURLToPath(new URL('script.md', v1)), 'utf8')), v1t.words)
  const v1b = parseBrief(JSON.parse(readFileSync(fileURLToPath(new URL('brief.json', v1)), 'utf8')))
  const inputOf = (brief: Brief, m: Marks = sectioned, t: Transcript = transcript) => ({ transcript: t, marks: m, brief, voiceMedia: 'm1', fps: 30, seed: 7 })
  const compiled = (i: ReturnType<typeof inputOf>) => {
    const raw = compilePlan(planExplainer(i), i) as Raw & { camera?: { keys: { at: unknown; zoom: number }[] } }
    const sb = parseStoryboard(resolveAnchors(raw, { transcript: i.transcript, marks: i.marks, fps: 30 }).json, [...PRIMITIVE_IDS])
    validateSceneParams(sb)
    return { raw, sb }
  }

  it('parses (resolveAnchors + parseStoryboard + every param) for every BriefType and both fixtures', () => {
    for (const type of BRIEF_TYPES) {
      for (const [t, m, b] of [
        [transcript, sectioned, parseBrief({ ...BRIEF, type })],
        [transcript, marks, parseBrief({ ...BRIEF, type, hook: { family: 'تحذير' } })],
        [transcript, sectioned, parseBrief({ ...BRIEF, type, screens: ['a.png', 'b.png'] })],
        [v1t, v1m, parseBrief({ ...v1b, type })],
      ] as const) {
        const { sb } = compiled(inputOf(b, m, t))
        expect(sb.scenes.length, type).toBeGreaterThan(5)
        // Pro Pace binds every type: the plan keeps maxEventGap ≤ PLAN_MAX_GAP (0.95).
        expect(plannedPace(sb).maxEventGap, `${type} maxEventGap`).toBeLessThanOrEqual(0.95)
        // Frame 0 shows the hook alone: no section number over the hook.
        const hookEnd = Math.max(...sb.scenes.filter((s) => s.track === 1 && /^hook/.test(s.id)).map((s) => s.start + s.duration))
        for (const n of sb.scenes.filter((s) => s.type === 'section-number')) expect(n.start, `${type} section-number over the hook`).toBeGreaterThanOrEqual(hookEnd - 1e-9)
      }
    }
  })
  it('ruling T9-c: a section number owns the top band; no kinetic block it overlaps reaches the band, none is giant or stretched', () => {
    for (const format of FORMATS) {
      for (const type of BRIEF_TYPES) {
        for (const [t, m, b] of [
          [transcript, sectioned, parseBrief({ ...BRIEF, type, format })],
          [v1t, v1m, parseBrief({ ...v1b, type, format })],
        ] as const) {
          const { sb } = compiled(inputOf(b, m, t))
          const tb = textBand(format)
          const H = FORMAT_SIZE[format].h
          for (const n of sb.scenes.filter((s) => s.type === 'section-number')) {
            expect(n.params.band, `${format} ${type}`).toBe(SECTION_BAND)
            const over = sb.scenes.filter((s) => s.type === 'kinetic-text' && s.start < n.start + n.duration - 1e-9 && n.start < s.start + s.duration - 1e-9)
            for (const k of over) {
              const p = k.params as { mode: string; y?: number; words: { stretch?: unknown }[] }
              expect(p.mode, `${format} ${type} ${k.id} giant under a section number`).not.toBe('giant')
              expect(p.words.some((w) => w.stretch), `${format} ${type} ${k.id} stretched under a section number`).toBe(false)
              const rows = p.mode === 'stack' ? p.words.length : 1
              expect(p.y! - (rows * KINETIC_ROW_PX) / H / 2, `${format} ${type} ${k.id} reaches the band`).toBeGreaterThanOrEqual(tb.top - 1e-9)
            }
          }
        }
      }
    }
  }, 30_000)
  it('explainerStoryboard is the composed wrapper: the same as compilePlan(planExplainer(i), i)', () => {
    const i = inputOf(BRIEF)
    expect(explainerStoryboard(i)).toEqual(compilePlan(planExplainer(i), i))
  })
  it('the kashida-stretch beat: its stressed word stretches (to ≤ 8) and carries word / key', () => {
    const { raw } = compiled(inputOf(parseBrief({ ...BRIEF, type: 'explainer' })))
    const k = W('المال')
    const word = raw.scenes.flatMap((s) => (s.type === 'kinetic-text' ? s.params.words : [])).find((w: any) => w.word === k)
    expect(word).toMatchObject({ text: 'المال', word: k, key: `w${k}`, stress: 2 })
    expect(word.stretch.to).toBeLessThanOrEqual(8)
    expect(word.stretch.at).toEqual({ word: k })
    // Every kinetic word built from the transcript carries word and key.
    for (const w of raw.scenes.flatMap((s) => (s.type === 'kinetic-text' ? s.params.words : [])) as any[]) {
      if (w.word !== undefined) expect(w.key).toBe(`w${w.word}`)
    }
  })
  it('3 sections → section-number scenes on track 2 (01 dropped: its only beat after the hook is the stretched «المال»); each section flips the backdrop world at its first word', () => {
    const i = { ...inputOf(parseBrief({ ...BRIEF, type: 'explainer' })), warnings: [] as string[] }
    const { raw, sb } = compiled(i)
    expect(planExplainer(i).warnings.some((w) => /^[؀-ۿ]/.test(w) && /no room for section number 1/.test(w))).toBe(true)
    const nums = sb.scenes.filter((s) => s.type === 'section-number')
    expect(nums).toHaveLength(2)
    for (const s of nums) {
      expect(s.track).toBe(2)
      expect(s.duration).toBeLessThanOrEqual(1.6 + 1e-9)
    }
    expect(nums.map((s) => s.params.number)).toEqual([2, 3])
    // Without a stressed word in the hook's next beat, 01 shows after the hook.
    const plain = compiled(inputOf(parseBrief({ ...BRIEF, type: 'explainer' }), marksOf(SECTIONED.replace('*المال*', 'المال')))).sb
    expect(plain.scenes.filter((s) => s.type === 'section-number').map((s) => s.params.number)).toEqual([1, 2, 3])
    const bg = raw.scenes.filter((s) => s.type === 'backdrop')
    // …and back to paper for the comment card (measured: its post does not register in the accent world).
    expect(bg.map((s) => s.params.world)).toEqual(['paper', 'ink', 'accent', 'paper'])
    expect(bg.slice(1, 3).map((s) => s.start)).toEqual([{ word: 8 }, { word: W('الحل') }])
    const textCta = compiled(inputOf(parseBrief({ title: 'وفّر وقتك ومالك', cta: 'تابعني للمزيد', type: 'explainer' }))).raw
    expect(textCta.scenes.filter((s) => s.type === 'backdrop').map((s) => s.params.world)).toEqual(['paper', 'ink', 'accent'])
  })
  it('hero: one scene on track 4 over [0, duration], its targets existing word keys', () => {
    const { raw, sb } = compiled(inputOf(parseBrief({ ...BRIEF, type: 'explainer', hero: true })))
    const heroes = sb.scenes.filter((s) => s.type === 'hero')
    expect(heroes).toHaveLength(1)
    const end = Math.max(...sb.scenes.map((s) => s.start + s.duration))
    expect(heroes[0]!.track).toBe(4)
    expect(heroes[0]!.start).toBe(0)
    expect(heroes[0]!.start + heroes[0]!.duration).toBeCloseTo(end, 6)
    const keys = new Set(raw.scenes.flatMap((s) => (s.type === 'kinetic-text' ? (s.params.words as { key?: string }[]).map((w) => w.key) : [])))
    const targets = (heroes[0]!.params.path as { target?: string }[]).map((p) => p.target).filter((t) => t !== undefined)
    expect(targets.length).toBeGreaterThan(0)
    for (const t of targets) expect(keys.has(t), t).toBe(true)
    // The HUD moved to track 5 (fixed under the camera).
    expect(sb.scenes.find((s) => s.type === 'hud')?.track).toBe(5)
    expect(planExplainer(inputOf(parseBrief({ ...BRIEF, type: 'motion', hero: false }), marks)).hero).toBeUndefined()
  })
  it('camera push: keys present, zoom between 1 and 1.6', () => {
    const { raw, sb } = compiled(inputOf(parseBrief({ ...BRIEF, type: 'explainer' })))
    expect(raw.camera?.keys.length).toBeGreaterThan(1)
    for (const k of sb.camera!.keys) {
      expect(k.zoom).toBeGreaterThanOrEqual(1)
      expect(k.zoom).toBeLessThanOrEqual(1.6)
    }
    for (const type of ['product-launch', 'motion'] as const) {
      const w = compiled(inputOf(parseBrief({ ...BRIEF, type }))).sb
      expect(w.camera, type).toBeDefined()
      for (const k of w.camera!.keys) expect(k.zoom, type).toBeLessThanOrEqual(1.25)
    }
    expect(compiled(inputOf(parseBrief({ ...BRIEF, type: 'corporate' }))).sb.camera).toBeUndefined()
  })
  it('the comment-cta gets a word wall of its keyword behind it', () => {
    const { sb } = compiled(inputOf(parseBrief({ ...BRIEF, type: 'explainer' })))
    const cta = sb.scenes.find((s) => s.type === 'comment-cta')!
    const wall = sb.scenes.find((s) => s.type === 'word-wall' && s.params.text === 'دليل')!
    expect(wall).toBeDefined()
    expect(wall.params.alpha).toBeCloseTo(0.1, 6)
    // It comes in 0.85 s into the card (between the keyword wipe and the post: a measured event) and stays to the end.
    expect(wall.start).toBeCloseTo(cta.start + 0.85, 1)
    expect(wall.start + wall.duration).toBeCloseTo(cta.start + cta.duration, 6)
    expect(wall.track ?? 0).toBeLessThan(cta.track ?? 0)
  })
  it('a hand-edited plan: shape-states on a beat without a UI word → a compile warning (Arabic first), the beat falls back to its kind', () => {
    const i = { ...inputOf(parseBrief({ ...BRIEF, type: 'explainer' })), warnings: [] as string[] }
    const plan = planExplainer(i)
    const x = plan.beats.findIndex((b, j) => j > 0 && b.kind === 'text' && b.idea === undefined)
    expect(x).toBeGreaterThan(0)
    const edited = { ...plan, beats: plan.beats.map((b, j) => (j === x ? { ...b, idea: 'shape-states' as const } : b)) }
    const raw = compilePlan(edited, i) as Raw
    expect(i.warnings.some((w) => /^[؀-ۿ]/.test(w) && /shape-states/.test(w))).toBe(true)
    expect(raw.scenes.some((s) => s.type === 'shape-states')).toBe(false)
    expect(raw).toEqual(compilePlan(plan, { ...i, warnings: [] }))
  })
})
