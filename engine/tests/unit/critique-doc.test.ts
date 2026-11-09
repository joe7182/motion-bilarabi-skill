import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REVIEW_METRIC_KEYS } from '../../src/node/review'

/**
 * The critic rubric (review/CRITIQUE.md) is read by a fresh agent that judges a render only from the
 * `mba review` kit. These checks keep the rubric from drifting away from the kit it references.
 */

const ENGINE = join(__dirname, '..', '..')
const RUBRIC = join(ENGINE, 'review', 'CRITIQUE.md')
const read = (): string => (existsSync(RUBRIC) ? readFileSync(RUBRIC, 'utf8') : '')

/** Every `inline code` span in the document. */
function codeSpans(md: string): string[] {
  return [...md.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '')
}

/** The lines of the section whose `## ` heading starts with `title`, up to the next `## `. */
function section(md: string, title: string): string[] {
  const lines = md.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(`## ${title}`))
  if (start < 0) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## '))
  return end < 0 ? rest : rest.slice(0, end)
}

const CRITERIA = [
  'Hook',
  'Phone readability',
  'Motion quality',
  'Variety & pacing',
  'Brand accuracy',
  'Sound sync',
  'Composition per format',
  'Polish',
  'Arabic integrity',
]

describe('review/CRITIQUE.md', () => {
  it('exists', () => {
    expect(existsSync(RUBRIC)).toBe(true)
  })

  it('names all 9 criteria', () => {
    const md = read()
    for (const c of CRITERIA) expect(md, c).toContain(c)
  })

  it('every camelCase metric it quotes exists in REVIEW_METRIC_KEYS', () => {
    const keys = new Set<string>(REVIEW_METRIC_KEYS)
    const quoted = codeSpans(read()).filter((s) => /^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(s))
    expect(quoted.length).toBeGreaterThan(0)
    for (const q of quoted) expect(keys.has(q), `\`${q}\` is not a ReviewMetrics key`).toBe(true)
  })

  it('quotes the metrics its caps depend on', () => {
    const spans = new Set(codeSpans(read()))
    for (const k of [
      'frame0Blank',
      'nearBlankTimes',
      'nearBlankRuns',
      'staticRuns',
      'longestStatic',
      'maxEventGap',
      'eventsPerSec',
      'medianEventGap',
      'movingPct',
      'eventTimes',
      'fastest',
      'audit',
      'duration',
      'format',
      'notes',
      'sheets',
    ] as const) {
      expect(REVIEW_METRIC_KEYS).toContain(k)
      expect(spans.has(k), `\`${k}\` not quoted`).toBe(true)
    }
  })

  it('every audit rule it quotes is a real AuditRule, and all six are covered', () => {
    const src = readFileSync(join(ENGINE, 'src', 'runtime', 'audit.ts'), 'utf8')
    const decl = /export type AuditRule\s*=([^\n]+)/.exec(src)
    expect(decl).not.toBeNull()
    const rules = new Set([...(decl?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]))
    expect(rules.size).toBe(6)
    const spans = codeSpans(read())
    for (const r of rules) expect(spans, r).toContain(r)
    const ruleLike = spans.filter((s) =>
      /^(unsanctioned|wrong|tatweel|outside|too|clipped)-[a-z-]+$/.test(s),
    )
    for (const s of ruleLike) expect(rules.has(s), `\`${s}\` is not an AuditRule`).toBe(true)
  })

  it('states the 1:1 / 4:5 safe area as in types.ts (bottom 8 %)', () => {
    const md = read()
    expect(md).not.toContain('6 % on every side')
    expect(md).toContain('1:1 and 4:5: top 6 %, bottom 8 %, left 6 %, right 6 %')
  })

  it('names the kit files', () => {
    const md = read()
    for (const f of ['metrics.json', 'contact.jpg', 'strip_fast_1.jpg', 'strip_fast_2.jpg', 'phone.jpg', 'safe.jpg'])
      expect(md, f).toContain(f)
  })

  it('tells the critic that long videos have several sheet pages and to read every one', () => {
    const md = read()
    expect(md).toContain('contact-2.jpg')
    expect(md).toContain('phone-2.jpg')
    expect(md).toMatch(/every page/i)
  })

  it('has both verdicts, both pace profiles and the review log', () => {
    const md = read()
    expect(md).toContain('SHIP')
    expect(md).toContain('ANOTHER ROUND')
    expect(md).toContain('review_log.md')
    expect(md).toMatch(/\*\*motion\*\*/)
    expect(md).toMatch(/\*\*edit\*\*/)
  })

  it('has at least 12 numbered failure modes, including the required ones', () => {
    const items = section(read(), 'Failure-mode checklist').filter((l) => /^\d+\.\s+\S/.test(l))
    expect(items.length).toBeGreaterThanOrEqual(12)
    const body = items.join('\n').toLowerCase()
    for (const needle of [
      'disjoined',
      'word order',
      'caret',
      'double exposure',
      'blank frame at a cut',
      'empty layer',
      'end card',
      'intro starts empty',
      'outro',
      'face',
      'off its word',
      'pops',
    ])
      expect(body, needle).toContain(needle)
  })
})

describe('fix wave M4: the V1 sound criterion', () => {
  it('judges voice intelligibility, SFX placement against cues, loudness and ducking (no longer n/a)', () => {
    const md = read()
    const sound = md.slice(md.indexOf('### 6. Sound sync'), md.indexOf('### 7.'))
    expect(sound).not.toContain('n/a until Plan 3')
    for (const k of ['Voice intelligibility', 'SFX placement against cues', 'Loudness', 'Ducking', '−14 ± 1 LUFS', '−1 dBTP']) expect(sound, k).toContain(k)
    expect(sound).toMatch(/\*\*Cap:\*\*/)
  })
})
