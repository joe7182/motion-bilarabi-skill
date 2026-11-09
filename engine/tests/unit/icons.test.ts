import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ICON_NAMES, iconParams, cuesOfIcon } from '../../src/core/params/icon'
import { LINE_ART_NAMES, LINE_ART_TIMING, lineArtParams, cuesOfLineArt, drawProgress, drawEnd } from '../../src/core/params/line-art'
import { LUCIDE } from '../../src/runtime/icons/lucide'
import { LINE_ART } from '../../src/runtime/icons/line-art'
import { CUES, planSfx } from '../../src/core/audio-plan'
import { parseStoryboard } from '../../src/core/storyboard'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('vendored Lucide icons', () => {
  it('only the icons the engine uses are vendored (keys = ICON_NAMES sorted)', () => {
    expect(Object.keys(LUCIDE)).toEqual([...ICON_NAMES].sort())
  })
  it('every icon is a non-empty list of SVG nodes', () => {
    for (const [name, nodes] of Object.entries(LUCIDE)) {
      expect(nodes.length, name).toBeGreaterThan(0)
      for (const [tag, attrs] of nodes) {
        expect(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'], name).toContain(tag)
        expect(Object.keys(attrs).length, name).toBeGreaterThan(0)
      }
    }
  })
  it('lucide.ts starts with the licence header', () => {
    const src = read('../../src/runtime/icons/lucide.ts')
    expect(src.startsWith('/*')).toBe(true)
    const header = src.slice(0, src.indexOf('*/'))
    expect(header).toContain('Lucide')
    expect(header).toContain('ISC License')
    expect(header).toContain('Feather')
    expect(header).toContain('MIT')
  })
  it('THIRD_PARTY.md credits Lucide (ISC) and Feather (MIT) with the full licence texts', () => {
    const doc = read('../../THIRD_PARTY.md')
    expect(doc).toContain('Lucide')
    expect(doc).toContain('ISC')
    expect(doc).toContain('Feather')
    expect(doc).toContain('Permission to use, copy, modify, and/or distribute this software')
    expect(doc).toContain('Permission is hereby granted, free of charge')
  })
})

describe('line art (our own paths)', () => {
  it('every LINE_ART_NAMES entry has a viewBox and at least one path', () => {
    expect(Object.keys(LINE_ART).sort()).toEqual([...LINE_ART_NAMES].sort())
    for (const name of LINE_ART_NAMES) {
      const a = LINE_ART[name]
      expect(a.viewBox.w, name).toBeGreaterThan(0)
      expect(a.viewBox.h, name).toBeGreaterThan(0)
      expect(a.paths.length, name).toBeGreaterThan(0)
    }
  })
  it('drawProgress: path i draws over [i·0.12, i·0.12 + drawIn] with power2.out', () => {
    expect(LINE_ART_TIMING.stagger).toBe(0.12)
    expect(drawProgress(0, 0, 0.8)).toBe(0)
    expect(drawProgress(0.4, 0, 0.8)).toBeCloseTo(1 - 0.5 ** 2, 9)
    expect(drawProgress(0.8, 0, 0.8)).toBe(1)
    expect(drawProgress(0.12, 1, 0.8)).toBe(0)
    expect(drawProgress(0.92, 1, 0.8)).toBe(1)
    expect(drawEnd(3, 0.8)).toBeCloseTo(0.8 + 2 * 0.12, 9)
  })
})

describe('line-art / icon params', () => {
  it('line-art defaults: size 0.6, drawIn 0.8, unknown art refused', () => {
    expect(lineArtParams.parse({ art: 'chart-up' })).toEqual({ art: 'chart-up', size: 0.6, drawIn: 0.8 })
    expect(lineArtParams.safeParse({ art: 'nope' }).success).toBe(false)
    expect(lineArtParams.safeParse({ art: 'underline', size: 0.1 }).success).toBe(false)
    expect(lineArtParams.safeParse({ art: 'underline', size: 1.1 }).success).toBe(false)
    expect(lineArtParams.safeParse({ art: 'underline', at: { x: 1.2, y: 0.5 } }).success).toBe(false)
  })
  it('icon defaults: enter draw; unknown icon refused; label is one line', () => {
    const p = iconParams.parse({ icon: 'lock' })
    expect(p.enter).toBe('draw')
    expect(iconParams.safeParse({ icon: 'house' }).success).toBe(false)
    expect(iconParams.safeParse({ icon: 'lock', enter: 'fade' }).success).toBe(false)
    expect(iconParams.safeParse({ icon: 'lock', label: 'سطر\nآخر' }).success).toBe(false)
    expect(iconParams.parse({ icon: 'lock', label: 'الأمان', enter: 'pop' }).label).toBe('الأمان')
  })
  it('both are scene types', () => {
    expect(PRIMITIVE_IDS).toContain('line-art')
    expect(PRIMITIVE_IDS).toContain('icon')
  })
})

describe('cues', () => {
  it('line-art: one action at 0; icon: one pop at 0; both in CUES', () => {
    expect(cuesOfLineArt(lineArtParams.parse({ art: 'chart-up' }), { duration: 2 })).toEqual([{ t: 0, kind: 'action' }])
    expect(cuesOfIcon(iconParams.parse({ icon: 'lock' }), { duration: 2 })).toEqual([{ t: 0, kind: 'pop' }])
    expect(CUES['line-art']).toBe(cuesOfLineArt)
    expect(CUES.icon).toBe(cuesOfIcon)
  })
  it('planSfx: line-art → tap at its start, icon → mallet at its start', () => {
    const sb = parseStoryboard(
      {
        version: 1,
        fps: 30,
        scenes: [
          { id: 'a', type: 'line-art', start: 0, duration: 1.5, params: { art: 'chart-up' } },
          { id: 'b', type: 'icon', start: 1.5, duration: 1.5, params: { icon: 'lock' } },
        ],
      },
      [...PRIMITIVE_IDS],
    )
    const fx = planSfx(sb, { fps: 30 }).filter((c) => c.kind === 'sfx')
    expect(fx.map((c) => [c.sfx, c.at])).toEqual([['tap', 0], ['mallet', 1.5]])
  })
})
