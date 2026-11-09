import { describe, expect, it } from 'vitest'
import { STYLE, adherence, styleFromReports, styleSchema, styleTargets, type StyleDna, type StyleReport } from '../../src/core/style'
import { mergeShortWindows, parseUnits } from '../../src/node/compare'
import { parseBrief } from '../../src/core/recipes/explain'

const pace = {
  eventsPerSec: 2.6,
  medianEventGap: 0.33,
  maxEventGap: 0.9,
  movingPct: 0.9,
}
const palette = [
  { hex: '#101820', share: 0.7, role: 'background' as const },
  { hex: '#f2f2f2', share: 0.25, role: 'text' as const },
  { hex: '#ff6a00', share: 0.05, role: 'accent' as const },
]
function report(over: Partial<StyleReport> = {}): StyleReport {
  return { duration: 20, cuts: [], medianShot: 20, palette, ...pace, events: Array.from({ length: 52 }, (_, i) => i * 0.38), ...over }
}
const src = (r: StyleReport, over: { detailMean?: number; motionMean?: number; file?: string } = {}) => ({
  report: r,
  detailMean: over.detailMean ?? 10,
  motionMean: over.motionMean ?? 12,
  file: over.file ?? 'a.mp4',
  sha1: 'a'.repeat(40),
})

describe('styleFromReports', () => {
  it('ranges are [min, max] widened to the minimum width around the mean', () => {
    const s = styleFromReports([
      src(report({ eventsPerSec: 2.6, medianEventGap: 0.33 })),
      src(report({ eventsPerSec: 2.7, medianEventGap: 0.37 }), { file: 'b.mp4' }),
    ])
    expect(STYLE.minWidth).toEqual({ eventsPerSec: 0.4, medianEventGap: 0.1 })
    expect(s.rhythm.eventsPerSec).toEqual([2.45, 2.85])
    expect(s.rhythm.medianEventGap).toEqual([0.3, 0.4])
    expect(s.sources.map((x) => x.file)).toEqual(['a.mp4', 'b.mp4'])
    expect(s.warnings).toEqual([])
    expect(styleSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })
  it('a range wider than the minimum is kept as measured', () => {
    const s = styleFromReports([src(report({ eventsPerSec: 2 })), src(report({ eventsPerSec: 3 }), { file: 'b.mp4' })])
    expect(s.rhythm.eventsPerSec).toEqual([2, 3])
  })
  it('a 3 s / 2-event source: continuous null, density unknown, one Arabic-first warning', () => {
    const s = styleFromReports([src(report({ duration: 3, events: [0.5, 1.5] }))])
    expect(s.rhythm.continuous).toBeNull()
    expect(s.text.density).toBe('unknown')
    expect(s.warnings).toHaveLength(1)
    expect(s.warnings[0]).toContain('قصير')
    expect(s.warnings[0]).toContain(' — ')
  })
  it('continuous = every source has few cuts; density and motion size from the means', () => {
    const few = styleFromReports([src(report())])
    expect(few.rhythm.continuous).toBe(true)
    expect(few.rhythm.cutsPerSec).toBe(0)
    const cutty = styleFromReports([src(report()), src(report({ cuts: Array.from({ length: 20 }, (_, i) => i + 0.5) }), { file: 'b.mp4' })])
    expect(cutty.rhythm.continuous).toBe(false)
    expect(styleFromReports([src(report(), { detailMean: 5, motionMean: 7 })])).toMatchObject({ text: { density: 'sparse' }, motion: { size: 'small' } })
    expect(styleFromReports([src(report(), { detailMean: 13.9, motionMean: 19.9 })])).toMatchObject({ text: { density: 'medium' }, motion: { size: 'medium' } })
    expect(styleFromReports([src(report(), { detailMean: 14, motionMean: 20 })])).toMatchObject({ text: { density: 'dense' }, motion: { size: 'large' } })
  })
  it('colours: union merged by ΔE < 8, shares renormalised, roles kept, at most 6', () => {
    const near = [
      { hex: '#101820', share: 0.7, role: 'background' as const },
      { hex: '#f2f2f2', share: 0.2, role: 'text' as const },
      { hex: '#ff6a00', share: 0.1, role: 'accent' as const },
    ]
    const nearB = near.map((c) => (c.role === 'accent' ? { ...c, hex: '#fb6c04' } : c))
    const s = styleFromReports([src(report({ palette: near })), src(report({ palette: nearB }), { file: 'b.mp4' })])
    const accents = s.colours.filter((c) => c.role === 'accent')
    expect(accents).toHaveLength(1)
    expect(accents[0]!.share).toBeCloseTo(0.1, 3)
    expect(s.colours.map((c) => c.role).sort()).toEqual(['accent', 'bg', 'fg'])
    expect(s.colours.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 2)
    const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
    const many = Array.from({ length: 6 }, (_, i) => ({ hex: hex(i * 40, 255 - i * 40, 128), share: 1 / 6, role: 'surface' as const }))
    const other = Array.from({ length: 6 }, (_, i) => ({ hex: hex(128, i * 40, 255), share: 1 / 6, role: 'surface' as const }))
    const wide = styleFromReports([src(report({ palette: many })), src(report({ palette: other }), { file: 'b.mp4' })])
    expect(wide.colours.length).toBeLessThanOrEqual(6)
    expect(wide.colours.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 2)
  })
})

const style = (over: Partial<StyleDna> = {}): StyleDna => ({
  version: 1,
  sources: [{ file: 'a.mp4', sha1: 'a'.repeat(40), duration: 20 }],
  rhythm: { eventsPerSec: [2.45, 2.85], medianEventGap: [0.3, 0.4], maxEventGap: 0.9, movingPct: 0.9, medianShot: 20, cutsPerSec: 0, continuous: true },
  colours: [
    { hex: '#101820', share: 0.7, role: 'bg' },
    { hex: '#f2f2f2', share: 0.25, role: 'fg' },
    { hex: '#ff6a00', share: 0.05, role: 'accent' },
  ],
  text: { density: 'dense' },
  motion: { size: 'large' },
  signature: [],
  warnings: [],
  ...over,
})

describe('styleTargets', () => {
  it('dense / large → 3 words, 1.45; worlds from bg / fg / accent', () => {
    const t = styleTargets(style())
    expect(t).toMatchObject({ medianGap: [0.3, 0.4], preferContinuous: true, wordsPerShot: 3, punchScale: 1.45 })
    expect(t.worlds).toEqual({ bg: '#101820', fg: '#f2f2f2', accent: '#ff6a00' })
  })
  it('sparse / small, medium, and unknown', () => {
    expect(styleTargets(style({ text: { density: 'sparse' }, motion: { size: 'small' } }))).toMatchObject({ wordsPerShot: 1, punchScale: 1.15 })
    expect(styleTargets(style({ text: { density: 'medium' }, motion: { size: 'medium' } }))).toMatchObject({ wordsPerShot: 2, punchScale: 1.3 })
    expect(styleTargets(style({ text: { density: 'unknown' }, motion: { size: 'unknown' }, rhythm: { ...style().rhythm, continuous: null } }))).toMatchObject({
      wordsPerShot: 2,
      punchScale: 1.3,
      preferContinuous: false,
    })
  })
  it('worlds is null when a role is missing or contrast is below 4.5', () => {
    expect(styleTargets(style({ colours: style().colours.filter((c) => c.role !== 'accent') })).worlds).toBeNull()
    const low = style().colours.map((c) => (c.role === 'fg' ? { ...c, hex: '#202830' } : c))
    expect(styleTargets(style({ colours: low })).worlds).toBeNull()
  })
})

describe('adherence', () => {
  const ours = { events: [], eventsPerSec: 2.6, medianEventGap: 0.35, maxEventGap: 0.95, movingPct: 0.9, longestStatic: 0.3, cutsPerSec: 0.05 }
  it('every row ok when ours sits inside the target', () => {
    const rows = adherence(style(), ours)
    expect(rows.map((r) => r.field)).toEqual(['eventsPerSec', 'medianEventGap', 'maxEventGap', 'movingPct', 'cuts'])
    expect(rows.every((r) => r.ok)).toBe(true)
  })
  it('ours median 0.45 vs [0.30, 0.40] is not ok', () => {
    const row = adherence(style(), { ...ours, medianEventGap: 0.45 }).find((r) => r.field === 'medianEventGap')!
    expect(row.ok).toBe(false)
    expect(row.target).toContain('0.3')
  })
  it('maxEventGap tolerance 10 %, movingPct tolerance 0.03, cuts only for a continuous style', () => {
    const f = (o: Partial<typeof ours>, k: string) => adherence(style(), { ...ours, ...o }).find((r) => r.field === k)!.ok
    expect(f({ maxEventGap: 0.99 }, 'maxEventGap')).toBe(true)
    expect(f({ maxEventGap: 1.0 }, 'maxEventGap')).toBe(false)
    expect(f({ movingPct: 0.87 }, 'movingPct')).toBe(true)
    expect(f({ movingPct: 0.86 }, 'movingPct')).toBe(false)
    expect(f({ cutsPerSec: 0.2 }, 'cuts')).toBe(false)
    const notCont = adherence(style({ rhythm: { ...style().rhythm, continuous: false } }), ours)
    expect(notCont.map((r) => r.field)).not.toContain('cuts')
  })
})

describe('mergeShortWindows(minSec)', () => {
  it('21 windows of 0.4 s with minSec 2 → 4 windows, the last ≥ 2 s', () => {
    const ws = Array.from({ length: 21 }, (_, i) => ({ id: `w${i}`, a: i * 0.4, b: (i + 1) * 0.4 }))
    const out = mergeShortWindows(ws, 2)
    expect(out).toHaveLength(4)
    const last = out[3]!
    expect(last.b - last.a).toBeGreaterThanOrEqual(2)
    expect(out[0]!.a).toBe(0)
    expect(last.b).toBeCloseTo(8.4, 9)
  })
})

describe('parseUnits and Brief.style', () => {
  it('parses the --units values', () => {
    expect(parseUnits('beats')).toBe('beats')
    expect(parseUnits('scenes')).toBe('scenes')
    expect(parseUnits('shots')).toBe('shots')
    expect(parseUnits('fixed:2')).toEqual({ fixed: 2 })
    expect(parseUnits('fixed:0.5')).toEqual({ fixed: 0.5 })
    for (const bad of ['fixed:0', 'fixed:', 'fixed:-1', 'beat', '']) expect(() => parseUnits(bad), bad).toThrow(/--units/)
    expect(() => parseUnits('x')).toThrow(/^قيمة --units/)
  })
  it('the brief may name a style file, relative to the project', () => {
    expect(parseBrief({ style: 'refs/style.json' }).style).toBe('refs/style.json')
    expect(parseBrief({}).style).toBeUndefined()
    expect(() => parseBrief({ style: '' })).toThrow()
  })
})
