import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveAnchors } from '../../src/core/anchors'
import { parseStoryboard, type Storyboard } from '../../src/core/storyboard'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { validateSceneParams } from '../../src/core/params/index'
import { kineticTextParams } from '../../src/core/params/kinetic-text'
import { alignScript, parseScript, parseTranscript, type Marks, type Transcript, type TranscriptWord } from '../../src/core/transcript'
import { explainerStoryboard, parseBrief, plannedPace, type BriefInput, type ExplainInput } from '../../src/core/recipes/explain'
import { compilePlan, parsePlan, planExplainer, type ExplainPlan } from '../../src/core/recipes/plan'
import { OBJECT_STEMS, stemVisualOf } from '../../src/core/keywords-ar'
import { FORMATS, SAFE_AREA, safeRect, type Format } from '../../src/core/types'

// Plan 3 Task 7: the `signature` compile path (director spike), on the real v1-voice recording.

const dir = new URL('../fixtures/v1-voice/', import.meta.url)
const read = (f: string) => readFileSync(fileURLToPath(new URL(f, dir)), 'utf8')
const v1t = parseTranscript(JSON.parse(read('transcript.json')))
const v1m = alignScript(parseScript(read('script.md')), v1t.words)
const v1b = JSON.parse(read('brief.json')) as BriefInput
const BRIEF: BriefInput = { ...v1b, look: 'signature', currency: 'AED', cta: { keyword: 'موشن' } }
const FPS = 30
const snap = (t: number) => Math.round(t * FPS) / FPS

const inputOf = (brief: BriefInput = BRIEF, t: Transcript = v1t, m: Marks = v1m, extra: Partial<ExplainInput> = {}): ExplainInput & { warnings: string[] } => ({
  transcript: t,
  marks: m,
  brief,
  voiceMedia: 'm1',
  fps: FPS,
  seed: 11,
  warnings: [],
  ...extra,
})

type Json = Record<string, any>
function load(raw: unknown, i: ExplainInput): Storyboard {
  const sb = parseStoryboard(resolveAnchors(raw, { transcript: i.transcript, marks: i.marks, fps: i.fps }).json, [...PRIMITIVE_IDS])
  validateSceneParams(sb)
  return sb
}
const W = (t: Transcript, text: string, from = 0) => t.words.findIndex((w, k) => k >= from && w.text === text)
const statesOf = (sb: Storyboard) =>
  sb.scenes
    .filter((s) => s.type === 'morph-object')
    .flatMap((s) => (s.params.states as Json[]).map((st): Json => ({ ...st, abs: s.start + st.at, scene: s.id })))

describe('Task 7: kinetic-text additions (R19, R20)', () => {
  it('enter "fade" and word color "accent" parse; the defaults are unchanged', () => {
    const p = kineticTextParams.parse({ enter: 'fade', words: [{ text: 'موشن', at: 0, color: 'accent' }] })
    expect(p.enter).toBe('fade')
    expect(p.words[0]!.color).toBe('accent')
    const d = kineticTextParams.parse({ words: [{ text: 'موشن', at: 0 }] })
    expect(d.enter).toBe('slide')
    expect(d.words[0]!.color).toBeUndefined()
    expect(() => kineticTextParams.parse({ words: [{ text: 'موشن', at: 0, color: 'red' }] })).toThrow()
  })
})

describe('Task 7: OBJECT_STEMS — script-specific objects (amendment B)', () => {
  const v = (s: string) => stemVisualOf(s.split(' '))?.kind
  it('maps time, money, writing, recording and editing words to their objects', () => {
    expect(v('تضيّع ساعات')).toBe('clock')
    expect(v('والوقت هذا…')).toBe('clock')
    expect(v('فلوس')).toBe('coin')
    expect(v('فلوسك متأخرة')).toBe('coin')
    expect(v('أولاً اكتب السكربت')).toBe('document')
    expect(v('ثانياً سجّل صوتك')).toBe('microphone')
    expect(v('خل المهارة تحرّك')).toBe('timeline')
    expect(v('كل شهر')).toBe('calendar')
  })
  it('script-specific rules: e-mail invoices are an envelope, reminders a bell, a voice note, the app, the chase', () => {
    expect(v('فواتير بالإيميل،')).toBe('envelope')
    expect(v('اكتب الفاتورة بثواني')).toBe('document')
    expect(v('رسايل تذكير،')).toBe('bell')
    expect(v('سجّل ملاحظة بصوتك للعميل')).toBe('voice-note')
    expect(v('والتطبيق يذكّره بالدفع في وقته')).toBe('phone-app')
    expect(v('كل شهر تلاحق')).toBe('chase')
  })
  it('repetition: «مكرر» / «نفس الشغل» → a word wall, «كل يوم» / «دايماً» → a repeat loop; the multi-word stem wins', () => {
    expect(v('على شغل مكرر')).toBe('wall')
    expect(v('ونفس الشغل مكرر كل شهر')).toBe('wall')
    expect(v('نسويها كل يوم')).toBe('loop')
    expect(v('دايماً')).toBe('loop')
  })
  it('no stem: undefined («جرّبها اليوم» is today, not a calendar)', () => {
    expect(v('جرّبها اليوم')).toBeUndefined()
    expect(v('الموضوع صار بسيط')).toBeUndefined()
  })
  it('every object of OBJECT_STEMS is a meaningful object (never dot, ring or bar)', () => {
    for (const s of OBJECT_STEMS) expect(['dot', 'ring', 'bar']).not.toContain(s.object)
  })
})

describe('Task 7: the signature compile path on the v1-voice fixture', () => {
  const i = inputOf()
  const raw = explainerStoryboard(i) as Json
  const sb = load(raw, i)
  const scenes = (type: string) => sb.scenes.filter((s) => s.type === type)
  const ex = (text: string, from = 0) => W(v1t, text, from)

  it('parses with every primitive param valid; look signature', () => {
    expect(sb.look).toBe('signature')
    expect(sb.scenes.length).toBeGreaterThan(10)
  })

  it('the hero: two morph-object scenes on track 4 at depth 1.35, split around the particle word (R23)', () => {
    const heroes = scenes('morph-object')
    expect(heroes).toHaveLength(2)
    for (const h of heroes) {
      expect(h.track).toBe(4)
      expect(h.depth).toBe(1.35)
      expect(h.params.currency).toBe('AED')
    }
    const pw = scenes('particle-word')
    expect(pw).toHaveLength(1)
    const burst = pw[0]!.start + (pw[0]!.params.burst as number)
    const land = pw[0]!.start + (pw[0]!.params.land as number)
    expect(heroes[0]!.start).toBe(0)
    expect(heroes[0]!.start + heroes[0]!.duration).toBeCloseTo(burst, 2)
    expect(heroes[1]!.start).toBeGreaterThanOrEqual(land + 0.3 - 2e-3)
    expect(pw[0]!.track).toBe(4)
    expect(pw[0]!.depth).toBe(1.35)
    expect(pw[0]!.params.from).toEqual({ scene: heroes[0]!.id })
  })

  it('a clock at the start of «ساعات», a coin (AED, spinning) at «فلوس»; lands on the first object of each section', () => {
    const st = statesOf(sb)
    const clock = st.find((s) => s.object === 'clock')!
    expect(clock).toBeDefined()
    expect(clock.abs).toBeCloseTo(snap(v1t.words[ex('ساعات')]!.start), 1)
    const coin = st.find((s) => s.object === 'coin')!
    expect(coin.abs).toBeCloseTo(snap(v1t.words[ex('فلوس')]!.start), 1)
    expect(coin.spin).toBe(1)
    expect(clock.land).toBe(true)
    // The document writes the script's word; the microphone and the timeline follow the voice when levels are given.
    expect(st.find((s) => s.object === 'document')?.text).toBe('السكربت')
    expect(st.some((s) => s.object === 'microphone')).toBe(true)
    expect(st.some((s) => s.object === 'timeline')).toBe(true)
    // Abstract shapes are bridges only: no ring or bar where a meaningful object exists.
    expect(st.filter((s) => s.object === 'ring' || s.object === 'bar')).toEqual([])
  })

  it('the particle word lands on the first «موشن» (key w<k>), which fades in at the land in the accent colour (R19, R20)', () => {
    const pw = scenes('particle-word')[0]!
    const k = ex('موشن')
    expect(pw.params.target).toBe(`w${k}`)
    const host = sb.scenes.find((s) => s.type === 'kinetic-text' && (s.params.words as Json[]).some((w) => w.key === `w${k}`))!
    expect(host.track).toBe(5)
    expect(host.params.enter).toBe('fade')
    const word = (host.params.words as Json[]).find((w) => w.key === `w${k}`)!
    expect(word.color).toBe('accent')
    expect(host.start + word.at).toBeCloseTo(pw.start + (pw.params.land as number), 2)
    expect(host.start).toBeLessThanOrEqual(pw.start + 1e-9)
    expect(host.start + host.duration).toBeGreaterThanOrEqual(pw.start + pw.duration - 1e-9)
  })

  it('one reveal per section cut on track 0, cycling circle → bands → panel, from the hero; paper / ink worlds, halftone last', () => {
    const cuts = (v1m.sections ?? []).filter((s) => s.word > 0).map((s) => snap(v1t.words[s.word]!.start))
    const rv = (sb.transitions ?? []).filter((t) => t.type === 'reveal')
    expect(rv.map((t) => t.at)).toEqual(cuts)
    expect(rv.map((t) => t.params.shape)).toEqual(['circle', 'bands', 'panel'])
    for (const t of rv) expect(t.track).toBe(0)
    const bg = scenes('backdrop')
    expect(bg.map((b) => b.params.world)).toEqual(['paper', 'ink', 'paper', 'ink'])
    expect(bg.map((b) => (b.params.material as Json).halftone ?? false)).toEqual([false, false, false, true])
    for (const b of bg) {
      expect(b.track).toBe(0)
      expect(b.depth).toBe(0.3)
    }
    expect(sb.transitions!.some((t) => t.type === 'flood' || t.type === 'iris')).toBe(false)
    expect(sb.scenes.some((s) => ['section-number', 'hero', 'flood'].includes(s.type))).toBe(false)
  })

  it('camera: fixed track 5 (R3), handheld, shakes on stressed words (15) and lands (9), pushes ≤ 1.15 back to 1 within 0.35 s', () => {
    const cam = sb.camera!
    expect(cam.fixedTracks).toEqual([5])
    expect(cam.handheld).toEqual({ amp: 1 })
    const shakes = cam.shakes!
    for (const k of v1m.stress) expect(shakes.some((s) => Math.abs(s.at - snap(v1t.words[k]!.start)) < 0.02 && s.amp === 15), `stress ${k}`).toBe(true)
    expect(shakes.some((s) => s.amp === 9)).toBe(true)
    const keys = cam.keys
    const pushes = keys.filter((k) => k.zoom > 1 + 1e-9)
    expect(pushes.length).toBeGreaterThanOrEqual(2)
    for (const k of keys) expect(k.zoom).toBeLessThanOrEqual(1.15 + 1e-9)
    // After the last key of a push hold, zoom 1 comes back within 0.35 s.
    keys.forEach((k, q) => {
      if (k.zoom > 1 + 1e-9 && keys[q + 1] && keys[q + 1]!.zoom === 1) expect(keys[q + 1]!.at - k.at).toBeLessThanOrEqual(0.35 + 1e-6)
      // R17: pans stay within ±0.06 of the frame centre.
      expect(Math.abs(k.x - 0.5)).toBeLessThanOrEqual(0.06 + 1e-9)
      expect(Math.abs(k.y - 0.5)).toBeLessThanOrEqual(0.06 + 1e-9)
    })
  })

  it('headlines: line mode on fixed track 5 near y 0.27; a punch only on a one-word line (R33); every spoken word shown once', () => {
    const heads = scenes('kinetic-text')
    expect(heads.length).toBeGreaterThan(8)
    for (const h of heads) {
      expect(h.track).toBe(5)
      expect(h.params.mode).toBe('line')
      expect(h.params.y).toBeCloseTo(0.27, 2)
      const ws = h.params.words as Json[]
      if (ws.length > 1) for (const w of ws) expect(w.stress, `${h.id} ${w.text}`).toBe(0)
    }
    const shown = heads.flatMap((h) => (h.params.words as Json[]).map((w) => w.word)).filter((k) => k !== undefined)
    expect(new Set(shown).size).toBe(shown.length)
    expect(shown.length).toBe(v1t.words.length)
    // The end card on track 2, the hero a small dot at y 0.97 below it.
    const cta = scenes('comment-cta')[0]!
    expect(cta.track).toBe(2)
    const last = statesOf(sb).at(-1)!
    expect(last).toMatchObject({ object: 'dot', size: 0.05, y: 0.97 })
    expect(last.abs).toBeLessThanOrEqual(cta.start + 1e-6)
  })

  it('the word wall for «مكرر» sits on track 2 while the hero waits as a 0.04 dot at safe y 0.97', () => {
    const wall = scenes('word-wall').filter((w) => w.id !== 'cta-wall')
    expect(wall).toHaveLength(1)
    expect(wall[0]!.track).toBe(2)
    expect(wall[0]!.params.text).toBe('مكرر')
    const st = statesOf(sb).filter((s) => s.abs <= wall[0]!.start + 0.05 && s.abs >= wall[0]!.start - 0.4)
    expect(st.some((s) => s.object === 'dot' && s.size === 0.04 && s.y === 0.97)).toBe(true)
  })

  it('plannedPace: maxEventGap ≤ 0.95', () => {
    expect(plannedPace(sb).maxEventGap).toBeLessThanOrEqual(0.95)
  })

  it('same input twice → deep-equal output', () => {
    expect(explainerStoryboard(inputOf())).toEqual(raw)
  })
})

describe('Task 7: objects stay in the object zone in every format (Review Focus 1)', () => {
  for (const format of FORMATS) {
    it(`${format}: state centres inside the safe area, object boxes clear of the headline zone (top 0.36 of the safe height)`, () => {
      const i = inputOf({ ...BRIEF, format })
      const sb = load(explainerStoryboard(i), i)
      const safe = safeRect(format as Format)
      const zoneBottom = safe.y + 0.36 * safe.h
      for (const s of statesOf(sb)) {
        expect(s.x).toBeGreaterThanOrEqual(0)
        expect(s.x).toBeLessThanOrEqual(1)
        expect(s.y).toBeGreaterThanOrEqual(0)
        expect(s.y).toBeLessThanOrEqual(1)
        if (s.object === 'dot') continue
        const cy = safe.y + s.y * safe.h
        const half = (s.size * safe.w) / 2
        expect(cy - half, `${format} ${s.object}`).toBeGreaterThanOrEqual(zoneBottom)
        expect(cy + half, `${format} ${s.object}`).toBeLessThanOrEqual(safe.y + safe.h)
        expect(safe.x + s.x * safe.w - half).toBeGreaterThanOrEqual(safe.x - 1e-6)
        expect(safe.x + s.x * safe.w + half).toBeLessThanOrEqual(safe.x + safe.w + 1e-6)
      }
      // Headline centre in the headline zone of this format.
      for (const h of sb.scenes.filter((x) => x.type === 'kinetic-text')) {
        const y = (h.params.y as number) * (format === '16:9' ? 1080 : format === '9:16' ? 1920 : format === '1:1' ? 1080 : 1350)
        expect(y).toBeGreaterThan(safe.y)
        expect(y).toBeLessThan(zoneBottom)
      }
      expect(plannedPace(sb).maxEventGap, format).toBeLessThanOrEqual(0.95)
      void SAFE_AREA
    })
  }
})

// A script without time or money words (and no other object stems).
function synthetic(lines: string[]): { t: Transcript; m: Marks } {
  const texts = lines.filter((l) => !l.startsWith('#')).join(' ').replace(/\*/g, '').split(/\s+/).filter(Boolean)
  let at = 0.2
  const words: TranscriptWord[] = texts.map((text, k) => {
    const start = Math.round(at * 1000) / 1000
    const end = Math.round((at + 0.34) * 1000) / 1000
    at = end + (k % 4 === 3 ? 0.5 : 0.08)
    return { i: k, text, start, end, p: 0.9 }
  })
  const t: Transcript = { version: 1, media: 'm1', sourceHash: 'x', model: 'ggml-small.bin', language: 'ar', words }
  return { t, m: alignScript(parseScript(lines.join('\n')), words) }
}

describe('Task 7: no time / money words (Review Focus 2) and the currency (Review Focus 3)', () => {
  const plain = synthetic(['# البداية', 'نحن نحب القراءة *كثيراً* والكتب جميلة جداً', '# الفكرة', 'القراءة تفتح العقل وتبني الخيال عند الأطفال', '# النهاية', 'ابدأ القراءة الآن مع أطفالك'])

  it('no clock or coin is forced; every section still gets a non-dot state (a ring bridge)', () => {
    const i = inputOf({ type: 'explainer', look: 'signature' }, plain.t, plain.m)
    const sb = load(explainerStoryboard(i), i)
    const st = statesOf(sb)
    expect(st.some((s) => s.object === 'clock' || s.object === 'coin')).toBe(false)
    const cuts = [0, ...(plain.m.sections ?? []).filter((s) => s.word > 0).map((s) => snap(plain.t.words[s.word]!.start)), Infinity]
    for (let j = 0; j + 1 < cuts.length; j++) {
      expect(st.some((s) => s.object !== 'dot' && s.abs >= cuts[j]! - 1e-6 && s.abs < cuts[j + 1]!), `section ${j}`).toBe(true)
    }
    // No CTA keyword: no particle word, one hero scene.
    expect(sb.scenes.filter((s) => s.type === 'particle-word')).toEqual([])
    expect(sb.scenes.filter((s) => s.type === 'morph-object')).toHaveLength(1)
    expect(plannedPace(sb).maxEventGap).toBeLessThanOrEqual(0.95)
  })

  it('currency "XYZ": an Arabic-first warning and the coin shows AED', () => {
    const i = inputOf({ ...BRIEF, currency: 'XYZ' })
    const sb = load(explainerStoryboard(i), i)
    expect(i.warnings.some((w) => /^عملة غير معروفة «XYZ»/.test(w) && / — unknown currency "XYZ"/.test(w))).toBe(true)
    for (const h of sb.scenes.filter((s) => s.type === 'morph-object')) expect(h.params.currency).toBe('AED')
  })

  it('currency SAR is passed through; no currency → AED without a warning', () => {
    const sar = inputOf({ ...BRIEF, currency: 'sar' })
    const sb = load(explainerStoryboard(sar), sar)
    for (const h of sb.scenes.filter((s) => s.type === 'morph-object')) expect(h.params.currency).toBe('SAR')
    const none = inputOf({ ...BRIEF, currency: undefined })
    explainerStoryboard(none)
    expect(none.warnings.filter((w) => /عملة/.test(w))).toEqual([])
  })
})

describe('Task 7: plan.json — concept first, per-beat visuals compiled exactly as written (amendment A)', () => {
  const i = inputOf()
  const plan = planExplainer(i)

  it('mba explain --plan writes an empty concept and the default director’s visuals for every beat', () => {
    expect(plan.look).toBe('signature')
    expect(plan.concept).toEqual({ idea: '', metaphor: '', arc: [] })
    for (const b of plan.beats) expect(b.visual, `beat ${b.i}`).toMatchObject({ kind: expect.any(String) })
    const kinds = plan.beats.map((b) => (b.visual as { kind: string; object?: string }).kind === 'object' ? (b.visual as { object: string }).object : (b.visual as { kind: string }).kind)
    expect(kinds).toContain('clock')
    expect(kinds).toContain('coin')
    expect(kinds).toContain('particles')
    expect(kinds).toContain('wall')
    // The plan compiles to the same storyboard as the one-step recipe.
    expect(compilePlan(plan, inputOf())).toEqual(explainerStoryboard(inputOf()))
  })

  it('a hand-written concept and visuals compile exactly as written', () => {
    const edited: ExplainPlan = JSON.parse(JSON.stringify(plan))
    edited.concept = { idea: 'الوقت الضائع في المونتاج هو فلوس ضائعة', metaphor: 'الساعة تصير عملة', arc: ['الوقت يضيع', 'الوقت فلوس', 'الحل', 'جرّب'] }
    const bClock = edited.beats.find((b) => (b.visual as Json).object === 'clock')!
    bClock.visual = { kind: 'object', object: 'calendar', flipSec: 0.3 }
    const bCoin = edited.beats.find((b) => (b.visual as Json).object === 'coin')!
    bCoin.visual = { kind: 'object', object: 'coin', spin: 2 }
    const bDoc = edited.beats.find((b) => (b.visual as Json).object === 'document')!
    bDoc.visual = { kind: 'object', object: 'document', text: 'سكربتك' }
    const bWall = edited.beats.find((b) => (b.visual as Json).kind === 'wall')!
    const k = bWall.from + bWall.words.findIndex((w) => w === 'مكرر')
    bWall.visual = { kind: 'loop', word: k }
    const bNone = edited.beats.find((b) => (b.visual as Json).object === 'microphone')!
    bNone.visual = { kind: 'chase', customers: 5 }
    const p = parsePlan(edited)
    expect(p.concept).toEqual(edited.concept)
    const ii = inputOf()
    const sb = load(compilePlan(p, ii), ii)
    const st = statesOf(sb)
    const cal = st.find((s) => s.object === 'calendar')!
    expect(cal.flipSec).toBe(0.3)
    expect(st.some((s) => s.object === 'clock' && s.abs < cal.abs + 0.5)).toBe(false)
    expect(st.find((s) => s.object === 'coin')!.spin).toBe(2)
    expect(st.find((s) => s.object === 'document')!.text).toBe('سكربتك')
    expect(st.some((s) => s.object === 'microphone')).toBe(false)
    const loop = sb.scenes.filter((s) => s.type === 'repeat-loop')
    expect(loop).toHaveLength(1)
    expect(loop[0]!.params.text).toBe('مكرر')
    // R32: the loop sits at the object-zone centre.
    expect(loop[0]!.params.at).toEqual({ x: 0.5, y: 0.635 })
    expect(sb.scenes.filter((s) => s.type === 'word-wall' && s.id !== 'cta-wall')).toEqual([])
    // The end card's keyword wall sits behind the card (track 1), not in a beat.
    expect(sb.scenes.find((s) => s.id === 'cta-wall')).toMatchObject({ track: 1, params: { text: 'موشن' } })
    const chase = sb.scenes.filter((s) => s.type === 'chase')
    expect(chase).toHaveLength(1)
    expect(chase[0]!.params.customers).toBe(5)
    expect(plannedPace(sb).maxEventGap).toBeLessThanOrEqual(0.95)
  })

  it('kind none: the beat shows no object (the hero waits as a dot)', () => {
    const edited: ExplainPlan = JSON.parse(JSON.stringify(plan))
    for (const b of edited.beats) if ((b.visual as Json).kind === 'object') b.visual = { kind: 'none' }
    const ii = inputOf()
    const sb = load(compilePlan(parsePlan(edited), ii), ii)
    expect(statesOf(sb).filter((s) => s.object !== 'dot')).toEqual([])
  })

  it('invalid visuals are refused, Arabic first', () => {
    const bad: Json = JSON.parse(JSON.stringify(plan))
    bad.beats[1].visual = { kind: 'object', object: 'banana' }
    expect(() => parsePlan(bad)).toThrow(/^ملف الخطة غير صالح — Invalid plan\.json: beats\.1\.visual/)
    const far: Json = JSON.parse(JSON.stringify(plan))
    far.beats[1].visual = { kind: 'wall', word: 999 }
    expect(() => compilePlan(parsePlan(far), inputOf())).toThrow(/^[^—]*[؀-ۿ][^—]* — .*beat 1.*word 999/)
    const empty: Json = JSON.parse(JSON.stringify(plan))
    empty.concept = { idea: 'x'.repeat(2000), metaphor: '', arc: [] }
    expect(() => parsePlan(empty)).toThrow(/^ملف الخطة غير صالح/)
  })

  it('a 2a+ plan (other looks) has no concept and keeps its keyword visuals', () => {
    const p2 = planExplainer(inputOf({ ...BRIEF, look: 'paper-editorial' }))
    expect(p2.concept).toBeUndefined()
    for (const b of p2.beats) if (b.visual) expect(b.visual).toHaveProperty('type')
  })
})

describe('Task 7: voice levels from the Node side', () => {
  it('microphone and timeline states carry levels sliced from ExplainInput.voiceLevels (30 per s, normalised)', () => {
    const n = Math.ceil(30 * 26)
    const voiceLevels = Array.from({ length: n }, (_, q) => 0.2 + 0.2 * Math.abs(Math.sin(q / 7)))
    const i = inputOf(BRIEF, v1t, v1m, { voiceLevels })
    const sb = load(explainerStoryboard(i), i)
    const st = statesOf(sb)
    for (const o of ['microphone', 'timeline']) {
      const s = st.find((x) => x.object === o)!
      expect(Array.isArray(s.levels), o).toBe(true)
      expect(s.levels.length).toBeGreaterThan(10)
      expect(Math.max(...s.levels)).toBeLessThanOrEqual(1)
      expect(Math.max(...s.levels)).toBeGreaterThan(0.9)
    }
    // Without levels: none written (seeded idle motion in the primitive).
    expect(statesOf(load(explainerStoryboard(inputOf()), inputOf())).every((s) => s.levels === undefined)).toBe(true)
  })
})

describe('Task 7 fix round 1: the particle word finds its hero at any frame rate and timing', () => {
  const shifted = (d: number): Transcript => ({ ...v1t, words: v1t.words.map((w) => ({ ...w, start: Math.round((w.start + d) * 1e6) / 1e6, end: Math.round((w.end + d) * 1e6) / 1e6 })) })
  const cases: [string, Transcript, number][] = [
    ['30 fps', v1t, 30],
    ['60 fps', v1t, 60],
    ['30 fps, +0.034 s', shifted(0.034), 30],
    ['30 fps, +0.045 s', shifted(0.045), 30],
    ['60 fps, +0.034 s', shifted(0.034), 60],
    ['60 fps, +0.017 s', shifted(0.017), 60],
  ]
  for (const [name, t, fps] of cases) {
    it(`${name}: compiles; from.scene is the hero scene that ends at the burst`, () => {
      const m = alignScript(parseScript(read('script.md')), t.words)
      const i = { ...inputOf(BRIEF, t, m), fps }
      const sb = load(explainerStoryboard(i), i)
      const pw = sb.scenes.find((s) => s.type === 'particle-word')!
      expect(pw).toBeDefined()
      const hero = sb.scenes.find((s) => s.id === (pw.params.from as { scene: string }).scene)!
      expect(hero.type).toBe('morph-object')
      expect(hero.start + hero.duration).toBeCloseTo(pw.start + (pw.params.burst as number), 2)
      expect(plannedPace(sb).maxEventGap).toBeLessThanOrEqual(0.95)
    })
  }
})

describe('Task 7 fix round 1: plan validation', () => {
  const plan = planExplainer(inputOf())
  it('particles in the hook are dropped without dropping a valid particle beat later', () => {
    const edited: Json = JSON.parse(JSON.stringify(plan))
    const later = edited.beats.find((b: Json) => b.visual.kind === 'particles')
    edited.beats[0].visual = { kind: 'particles', word: edited.beats[0].from }
    expect(later).toBeDefined()
    const i = inputOf()
    const sb = load(compilePlan(parsePlan(edited), i), i)
    const pw = sb.scenes.filter((s) => s.type === 'particle-word')
    expect(pw).toHaveLength(1)
    expect(pw[0]!.params.target).toBe(`w${later.visual.word}`)
    expect(i.warnings.some((w) => /^كلمة الجسيمات/.test(w) && /beat 0/.test(w))).toBe(true)
  })
  it('an unknown object names the value and lists the objects, Arabic first', () => {
    const bad: Json = JSON.parse(JSON.stringify(plan))
    bad.beats[1].visual = { kind: 'object', object: 'banana' }
    let msg = ''
    try {
      parsePlan(bad)
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toMatch(/^ملف الخطة غير صالح — Invalid plan\.json: beats\.1\.visual\.object: /)
    expect(msg).toMatch(/[؀-ۿ].*«banana».* — .*"banana"/)
    for (const o of ['clock', 'coin', 'document', 'phone-app']) expect(msg).toContain(o)
  })
})
