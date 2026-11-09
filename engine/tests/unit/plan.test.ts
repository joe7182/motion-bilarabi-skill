import { describe, it, expect } from 'vitest'
import { resolveAnchors } from '../../src/core/anchors'
import { parseStoryboard } from '../../src/core/storyboard'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { validateSceneParams } from '../../src/core/params/index'
import { alignScript, parseScript, type Marks, type Transcript, type TranscriptWord } from '../../src/core/transcript'
import { parseBrief, type BriefInput } from '../../src/core/recipes/explain'
import { compilePlan, parsePlan, planExplainer, type ExplainPlan } from '../../src/core/recipes/plan'
import { IDEAS } from '../../src/core/recipes/ideas'
import { BRIEF_TYPES } from '../../src/core/recipes/types'
import type { StyleDna } from '../../src/core/style'

// The V1 40-word fixture (tests/unit/explain.test.ts): *المال*, two «...», ٣٠٠, أولاً/ثانياً/ثالثاً.
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
const GAP_AFTER: Record<number, number> = { 7: 0.6, 21: 0.3, 25: 0.5 }

function wordsOf(script: string): TranscriptWord[] {
  const texts = script
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join(' ')
    .replace(/\*|«\.\.\.»/g, '')
    .split(/\s+/)
    .filter(Boolean)
  let t = 0.2
  return texts.map((text, i) => {
    const start = Math.round(t * 1000) / 1000
    const end = Math.round((t + 0.3) * 1000) / 1000
    t = end + (GAP_AFTER[i] ?? 0.06 + 0.02 * (i % 3))
    return { i, text, start, end, p: 0.9 }
  })
}

const transcript: Transcript = { version: 1, media: 'm1', sourceHash: 'x', model: 'ggml-small.bin', language: 'ar', words: wordsOf(SCRIPT) }
const marks = alignScript(parseScript(SCRIPT), transcript.words)
const sectioned = alignScript(parseScript(SECTIONED), transcript.words)
const W = (text: string) => transcript.words.findIndex((w) => w.text === text)

// Second fixture: a stressed word with no kashida slot («درود»).
const SCRIPT2 = 'اليوم نبدأ القصة من البداية «...» هنا تسمع *درود* كثيرة عن المشروع الجديد'
const transcript2: Transcript = { ...transcript, words: wordsOf(SCRIPT2) }
const marks2 = alignScript(parseScript(SCRIPT2), transcript2.words)

const BRIEF = { title: 'وفّر وقتك ومالك', cta: { keyword: 'دليل' } } satisfies BriefInput

const input = (brief: BriefInput, m: Marks = sectioned, t: Transcript = transcript, style?: StyleDna) => ({
  transcript: t,
  marks: m,
  brief: parseBrief(brief),
  voiceMedia: 'm1',
  fps: 30,
  seed: 7,
  ...(style ? { style } : {}),
})

const beatOfWord = (p: ExplainPlan, k: number) => p.beats.find((b) => b.from <= k && k < b.to)!

const style = (density: string, size: string): StyleDna => ({
  version: 1,
  sources: [{ file: 'a.mp4', sha1: 'a'.repeat(40), duration: 20 }],
  rhythm: { eventsPerSec: [2, 3], medianEventGap: [0.35, 0.5], maxEventGap: 0.9, movingPct: 0.92, medianShot: 1.2, cutsPerSec: 0.6, continuous: false },
  colours: [],
  text: { density: density as StyleDna['text']['density'] },
  motion: { size: size as StyleDna['motion']['size'] },
  signature: [],
  warnings: [],
})

describe('planExplainer', () => {
  const plan = planExplainer(input({ ...BRIEF, type: 'explainer' }))

  it('the plan parses (plan.json schema) and names the transcript it was made for', () => {
    expect(parsePlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan)
    expect(plan.version).toBe(1)
    expect(plan.transcriptHash).toMatch(/\S/)
    expect(plan.look).toBe('paper-editorial')
    expect(plan.camera).toBe('push')
  })
  it('*المال* (stretchable) → kashida-stretch; a stressed «درود» (no slot) → giant-word', () => {
    expect(beatOfWord(plan, W('المال')).idea).toBe('kashida-stretch')
    const p2 = planExplainer(input({ type: 'explainer' }, marks2, transcript2))
    const k = transcript2.words.findIndex((w) => w.text === 'درود')
    expect(marks2.stress).toEqual([k])
    expect(beatOfWord(p2, k).idea).toBe('giant-word')
  })
  it('3 sections → 3 section-number ideas and worlds paper, ink, accent', () => {
    expect(plan.beats.filter((b) => b.idea === 'section-number')).toHaveLength(3)
    expect(plan.sections.map((s) => s.world)).toEqual(['paper', 'ink', 'accent'])
    expect(plan.sections.map((s) => s.title)).toEqual(['المقدمة', 'المشكلة', 'الحل'])
  })
  it('signature moments: at least the type minimum (explainer 2); no two consecutive beats share an idea', () => {
    expect(plan.signature.length).toBeGreaterThanOrEqual(2)
    for (const id of plan.signature) expect(IDEAS[id].signature, id).toBe(true)
    for (const type of BRIEF_TYPES) {
      for (const m of [marks, sectioned]) {
        const p = planExplainer(input({ ...BRIEF, type }, m))
        for (let x = 1; x < p.beats.length; x++) {
          if (p.beats[x]!.idea !== undefined) expect(p.beats[x]!.idea, `${type} beat ${x}`).not.toBe(p.beats[x - 1]!.idea)
        }
      }
    }
  })
  it('motion on the 18 s fixture → at least 4 signature moments, with the hero on', () => {
    const p = planExplainer(input({ ...BRIEF, type: 'motion' }, marks))
    expect(p.signature.length).toBeGreaterThanOrEqual(4)
    expect(p.hero).toBeDefined()
    expect(p.hero!.handoffBeats.length).toBeGreaterThan(0)
    expect(p.warnings.some((w) => /fewer signature moments/.test(w))).toBe(false)
  })
  it('corporate → no camera, light-editorial', () => {
    const p = planExplainer(input({ ...BRIEF, type: 'corporate' }))
    expect(p.camera).toBe('none')
    expect(p.look).toBe('light-editorial')
    expect(planExplainer(input({ ...BRIEF, type: 'motion' })).look).toBe('dark-tech')
  })
  it('a dense, large style → 3 words a shot and a 1.45 punch; no style → 3 and 1.3', () => {
    const p = planExplainer(input({ ...BRIEF, type: 'explainer' }, sectioned, transcript, style('dense', 'large')))
    expect(p.wordsPerShot).toBe(3)
    expect(p.punchScale).toBe(1.45)
    expect(plan.wordsPerShot).toBe(3)
    expect(plan.punchScale).toBe(1.3)
    // An `unknown` style (one short source) still plans.
    const u = planExplainer(input({ ...BRIEF, type: 'explainer' }, sectioned, transcript, style('unknown', 'unknown')))
    expect(u.wordsPerShot).toBe(2)
    expect(u.punchScale).toBe(1.3)
  })
  it('brief.beat 120 bpm → every transition is on a word start or within 1 ms of a 0.5 s beat', () => {
    for (const type of ['explainer', 'motion', 'product-launch'] as const) {
      const i = input({ ...BRIEF, type, beat: { bpm: 120 } })
      const p = planExplainer(i)
      expect(p.beat).toEqual({ bpm: 120, offset: 0 })
      const sb = parseStoryboard(resolveAnchors(compilePlan(p, i), { transcript, marks: sectioned, fps: 30 }).json, [...PRIMITIVE_IDS])
      validateSceneParams(sb)
      const starts = transcript.words.map((w) => Math.round(w.start * 30) / 30)
      for (const tr of sb.transitions ?? []) {
        const onBeat = Math.abs(tr.at / 0.5 - Math.round(tr.at / 0.5)) * 0.5 < 1e-3 + 1e-9
        const onWord = starts.some((s) => Math.abs(s - tr.at) < 1e-3)
        expect(onBeat || onWord, `${type} ${tr.type} at ${tr.at}`).toBe(true)
      }
    }
  })
  it('same input twice → deep-equal plan', () => {
    expect(planExplainer(input({ ...BRIEF, type: 'motion' }))).toEqual(planExplainer(input({ ...BRIEF, type: 'motion' })))
  })
  it('a plan below the type minimum is warned about (Arabic first)', () => {
    const short: Transcript = { ...transcript, words: [{ i: 0, text: 'مرحبا', start: 0.2, end: 0.5, p: 0.9 }] }
    const m: Marks = { stress: [], pauses: [], unmatched: [], sections: [] }
    const p = planExplainer(input({ type: 'motion' }, m, short))
    expect(p.warnings.some((w) => /^[؀-ۿ]/.test(w) && /fewer signature moments than the type's minimum/.test(w))).toBe(true)
  })
})
