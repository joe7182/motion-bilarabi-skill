import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateSceneParams } from '../../src/core/params/index'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { parseStoryboard, StoryboardError } from '../../src/core/storyboard'
import { CUES } from '../../src/core/audio-plan'
import { emphasisAt, settle } from '../../src/core/params/common'
import { cuesOfLogoRow, LOGO_ROW, logoColumns, logoRowParams } from '../../src/core/params/logo-row'
import { cuesOfLayerStack, layerStackParams, slabNumber, slabSlideStart } from '../../src/core/params/layer-stack'
import { cuesOfNodeGraph, nodeGraphParams } from '../../src/core/params/node-graph'
import { CHAT, chatThreadParams, cuesOfChatThread, typingWindow } from '../../src/core/params/chat-thread'
import { loadStoryboardFile } from '../../src/node/render'

const IMG = 'data:image/svg+xml;base64,PHN2Zy8+'
const ARABIC_FIRST = /^[؀-ۿ]/
/** A StoryboardError message: `<path>: <Arabic> — <English>`. */
const AR_AFTER_PATH = /^scenes\[\d+\]\.params[^ ]*: [؀-ۿ]/
const sb = (scenes: unknown[]) => parseStoryboard({ version: 1, fps: 60, scenes }, [...PRIMITIVE_IDS])
const errOf = (fn: () => unknown): StoryboardError | undefined => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(StoryboardError)
    return e as StoryboardError
  }
  return undefined
}
const scene = (type: string, params: unknown, duration = 4) => [{ id: 's', type, start: 0, duration, params }]
const firstIssue = (r: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) => r.error?.issues[0]

describe('shared «layers» helpers', () => {
  it('settle: 0 → 1 exactly at the ends, a tiny overshoot (< 4 %) between', () => {
    expect(settle(0)).toBe(0)
    expect(settle(1)).toBe(1)
    expect(settle(-1)).toBe(0)
    expect(settle(2)).toBe(1)
    let max = 0
    for (let i = 0; i <= 1000; i++) max = Math.max(max, settle(i / 1000))
    expect(max).toBeGreaterThan(1)
    expect(max).toBeLessThan(1.04)
  })
  it('emphasisAt eases one key up and the others down, change by change', () => {
    const ch = [{ at: 1, key: 0 }, { at: 2, key: 1 }]
    expect(emphasisAt(ch, 0, 0.5, 0.3)).toEqual({ hl: 0, dim: 0 })
    expect(emphasisAt(ch, 0, 1.5, 0.3)).toEqual({ hl: 1, dim: 0 })
    expect(emphasisAt(ch, 1, 1.5, 0.3)).toEqual({ hl: 0, dim: 1 })
    const mid = emphasisAt(ch, 0, 2.15, 0.3)
    expect(mid.hl).toBeGreaterThan(0)
    expect(mid.hl).toBeLessThan(1)
    expect(emphasisAt(ch, 0, 3, 0.3)).toEqual({ hl: 0, dim: 1 })
  })
})

describe('logo-row params', () => {
  const items = [{ image: IMG, at: 0 }, { image: IMG, label: 'Claude', at: 0.2 }]
  it('defaults: row, size 0.2, centred, no focus / strike / out', () => {
    expect(logoRowParams.parse({ items })).toEqual({ items, layout: 'row', size: 0.2, at: { x: 0.5, y: 0.5 }, focus: [], strike: [] })
    expect(logoColumns('grid', 5)).toBe(3)
    expect(logoColumns('row', 5)).toBe(5)
  })
  it('refuses 0 or 7 logos, an index past the list, unordered focus, a row wider than the safe area, an out before the last pop — Arabic first', () => {
    const bad = [
      { items: [] },
      { items: Array.from({ length: 7 }, () => ({ image: IMG, at: 0 })) },
      { items, focus: [{ at: 1, index: 2 }] },
      { items, focus: [{ at: 2, index: 0 }, { at: 1, index: 1 }] },
      { items, strike: [{ at: 1, index: 5 }] },
      { items: Array.from({ length: 6 }, () => ({ image: IMG, at: 0 })), size: 0.2 },
      { items, out: 0.1 },
      { items: [{ image: '', at: 0 }] },
      { items: [{ image: IMG, at: 0, label: 'x'.repeat(19) }] },
      { items, size: 0.5 },
    ]
    for (const p of bad) {
      const r = logoRowParams.safeParse(p)
      expect(r.success, JSON.stringify(p).slice(0, 80)).toBe(false)
      expect(firstIssue(r)!.message).toMatch(ARABIC_FIRST)
    }
    // Six fit as a grid (or as a row of small tiles).
    expect(logoRowParams.safeParse({ items: Array.from({ length: 6 }, () => ({ image: IMG, at: 0 })), layout: 'grid' }).success).toBe(true)
    expect(logoRowParams.safeParse({ items: Array.from({ length: 6 }, () => ({ image: IMG, at: 0 })), size: 0.12 }).success).toBe(true)
  })
  it('scene timing: a beat past the scene end is refused at its path; cues: pop per logo, action per focus, tick per strike', () => {
    const e = errOf(() => validateSceneParams(sb(scene('logo-row', { items, focus: [{ at: 5, index: 0 }] }))))
    expect(e?.message).toMatch(AR_AFTER_PATH)
    expect(e?.path).toBe('scenes[0].params.focus[0].at')
    expect(errOf(() => validateSceneParams(sb(scene('logo-row', { items, out: 3 }))))).toBeUndefined()
    const p = logoRowParams.parse({ items, focus: [{ at: 1, index: 0 }], strike: [{ at: 1.5, index: 1 }] })
    expect(cuesOfLogoRow(p, { duration: 4 })).toEqual([{ t: 0, kind: 'pop' }, { t: 0.2, kind: 'pop' }, { t: 1, kind: 'action' }, { t: 1.5, kind: 'tick' }])
    expect(LOGO_ROW.focusScale).toBe(1.15)
    expect(LOGO_ROW.dim).toBe(0.35)
  })
})

describe('layer-stack params', () => {
  const layers = [{ title: 'القناة', at: 1.6 }, { title: 'التنسيق', at: 1.1 }, { title: 'النموذج', subtitle: 'العقل', icons: [IMG, IMG], at: 0.6 }]
  it('defaults: numbered (Arabic digits), centred, width 0.86, no active / flow; badge 1 = the bottom slab; a slab lands at its at', () => {
    const p = layerStackParams.parse({ layers })
    expect(p).toMatchObject({ number: true, digits: 'arabic', at: { x: 0.5, y: 0.5 }, width: 0.86, active: [] })
    expect(p.flowAt).toBeUndefined()
    expect(p.layers[0]!.icons).toEqual([])
    expect([0, 1, 2].map((i) => slabNumber(p, i))).toEqual(['٣', '٢', '١'])
    expect(slabNumber({ ...p, digits: 'latin' }, 2)).toBe('1')
    expect(slabSlideStart(p, 2)).toBeCloseTo(0.6 - 0.55, 9)
  })
  it('refuses 1 or 5 layers, 4 icons, an index past the stack, unordered active, a 21-character title — Arabic first', () => {
    const bad = [
      { layers: [layers[0]] },
      { layers: [...layers, ...layers].slice(0, 5) },
      { layers: [{ ...layers[0], icons: [IMG, IMG, IMG, IMG] }, layers[1]] },
      { layers, active: [{ at: 1, index: 3 }] },
      { layers, active: [{ at: 2, index: 0 }, { at: 1, index: 1 }] },
      { layers: [{ title: 'ا'.repeat(21), at: 0 }, layers[1]] },
      { layers, width: 0.3 },
    ]
    for (const p of bad) {
      const r = layerStackParams.safeParse(p)
      expect(r.success, JSON.stringify(p).slice(0, 80)).toBe(false)
      expect(firstIssue(r)!.message).toMatch(ARABIC_FIRST)
    }
  })
  it('scene timing and cues', () => {
    const e = errOf(() => validateSceneParams(sb(scene('layer-stack', { layers, flowAt: 4 }))))
    expect(e?.path).toBe('scenes[0].params.flowAt')
    expect(e?.message).toMatch(AR_AFTER_PATH)
    expect(cuesOfLayerStack(layerStackParams.parse({ layers, active: [{ at: 2, index: 1 }] }), { duration: 4 })).toEqual([
      { t: 0.6, kind: 'pop' }, { t: 1.1, kind: 'pop' }, { t: 1.6, kind: 'pop' }, { t: 2, kind: 'action' },
    ])
  })
})

describe('node-graph params', () => {
  const nodes = [
    { id: 'a', label: 'رسالة', x: 0, y: 0.3, at: 0.2, kind: 'trigger' },
    { id: 'b', label: 'وكيل', x: 0.5, y: 0.3, at: 0.4, kind: 'agent' },
    { id: 'm', label: 'النموذج', x: 0.5, y: 1, at: 0.5, kind: 'slot', fillAt: 2 },
  ]
  const edges = [{ from: 'a', to: 'b', at: 0.6 }, { from: 'b', to: 'm', at: 0.8, kind: 'sub' }]
  it('defaults: step nodes, main edges, width 0.94, aspect 0.95, empty panel, no focus / flow', () => {
    const p = nodeGraphParams.parse({ nodes: [{ id: 'x', label: 'خطوة', x: 0.5, y: 0.5, at: 0 }] })
    expect(p).toMatchObject({ edges: [], focus: [], panel: {}, width: 0.94, aspect: 0.95, at: { x: 0.5, y: 0.5 } })
    expect(p.nodes[0]!.kind).toBe('step')
    expect(nodeGraphParams.parse({ nodes, edges }).edges[0]!.kind).toBe('main')
  })
  it('refuses 9 nodes, 11 edges, a duplicate id, an unknown end, a self-loop, fillAt on a non-slot or before the node, an edge before its nodes, an unknown focus id — Arabic first', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, label: 'x', x: 0, y: 0, at: 0 }))
    const bad = [
      { nodes: nine },
      { nodes, edges: Array.from({ length: 11 }, () => edges[0]) },
      { nodes: [nodes[0], { ...nodes[1], id: 'a' }] },
      { nodes, edges: [{ from: 'a', to: 'zz', at: 1 }] },
      { nodes, edges: [{ from: 'a', to: 'a', at: 1 }] },
      { nodes: [{ ...nodes[0], fillAt: 1 }] },
      { nodes: [{ ...nodes[2], fillAt: 0.1 }] },
      { nodes, edges: [{ from: 'a', to: 'm', at: 0.3 }] },
      { nodes, focus: [{ at: 1, id: 'q' }] },
      { nodes: [{ ...nodes[0], x: 1.2 }] },
      { nodes: [{ ...nodes[0], id: '' }] },
    ]
    for (const p of bad) {
      const r = nodeGraphParams.safeParse(p)
      expect(r.success, JSON.stringify(p).slice(0, 80)).toBe(false)
      expect(firstIssue(r)!.message).toMatch(ARABIC_FIRST)
    }
  })
  it('scene timing and cues: pop per node, hit per fill, action per focus', () => {
    const e = errOf(() => validateSceneParams(sb(scene('node-graph', { nodes, edges }, 1.5))))
    expect(e?.path).toBe('scenes[0].params.nodes[2].fillAt')
    expect(cuesOfNodeGraph(nodeGraphParams.parse({ nodes, edges, focus: [{ at: 2.5, id: 'b' }] }), { duration: 4 })).toEqual([
      { t: 0.2, kind: 'pop' }, { t: 0.4, kind: 'pop' }, { t: 0.5, kind: 'pop' }, { t: 2, kind: 'hit' }, { t: 2.5, kind: 'action' },
    ])
  })
})

describe('chat-thread params', () => {
  const messages = [
    { side: 'in', text: 'مرحبا', at: 0.4 },
    { side: 'out', text: 'أهلاً', at: 1.2 },
    { side: 'out', kind: 'card', text: 'تم الحجز', rows: [['الخدمة', 'قص']], at: 2.0 },
  ]
  it('defaults: status «متصل», time 10:30, placeholder, width 0.78, height 0.8, text messages, look accent', () => {
    const p = chatThreadParams.parse({ avatar: IMG, name: 'صالون', messages: [messages[0]] })
    expect(p).toMatchObject({ status: 'متصل', time: '10:30', placeholder: 'اكتب رسالة', width: 0.78, height: 0.8, at: { x: 0.5, y: 0.5 } })
    expect(p.accent).toBeUndefined()
    expect(p.messages[0]!.kind).toBe('text')
    const q = chatThreadParams.parse({ avatar: IMG, name: 'صالون', messages })
    expect(typingWindow(q, 0)).toBeUndefined()
    expect(typingWindow(q, 1)).toEqual([1.2 - CHAT.typingSec, 1.2])
  })
  it('refuses 9 messages, rows on a text message, 4 rows, unordered messages, no time to type, a bad accent, a 49-character text — Arabic first', () => {
    const base = { avatar: IMG, name: 'صالون' }
    const bad = [
      { ...base, messages: Array.from({ length: 9 }, (_, i) => ({ side: 'in', text: 'x', at: i })) },
      { ...base, messages: [{ side: 'in', text: 'x', at: 0, rows: [['a', 'b']] }] },
      { ...base, messages: [{ side: 'out', kind: 'card', text: 'x', at: 1, rows: [['a', 'b'], ['a', 'b'], ['a', 'b'], ['a', 'b']] }] },
      { ...base, messages: [messages[1], messages[0]] },
      { ...base, messages: [messages[0], { ...messages[1], at: 0.8 }] },
      { ...base, accent: 'green', messages },
      { ...base, messages: [{ side: 'in', text: 'ا'.repeat(49), at: 0 }] },
      { ...base, messages: [] },
    ]
    for (const p of bad) {
      const r = chatThreadParams.safeParse(p)
      expect(r.success, JSON.stringify(p).slice(0, 80)).toBe(false)
      expect(firstIssue(r)!.message).toMatch(ARABIC_FIRST)
    }
  })
  it('scene timing and cues: pop per message, final on the card', () => {
    const e = errOf(() => validateSceneParams(sb(scene('chat-thread', { avatar: IMG, name: 'ص', messages }, 1.5))))
    expect(e?.path).toBe('scenes[0].params.messages[2].at')
    expect(cuesOfChatThread(chatThreadParams.parse({ avatar: IMG, name: 'ص', messages }), { duration: 4 })).toEqual([
      { t: 0.4, kind: 'pop' }, { t: 1.2, kind: 'pop' }, { t: 2, kind: 'final' },
    ])
  })
})

describe('registration', () => {
  it('all four are scene types with cue sources', () => {
    for (const id of ['logo-row', 'layer-stack', 'node-graph', 'chat-thread']) {
      expect(PRIMITIVE_IDS).toContain(id)
      expect(CUES[id]).toBeTypeOf('function')
    }
  })
})

describe('image inlining of the «layers» primitives', () => {
  it('relative logos / icons / avatars are inlined at load; a remote one or a missing one is refused at its path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mba layers صور-'))
    try {
      await writeFile(join(dir, 'شعار.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
      const scenes = (img: string) => [
        { id: 'l', type: 'logo-row', start: 0, duration: 2, params: { items: [{ image: IMG, at: 0 }, { image: img, at: 0.1 }] } },
        { id: 's', type: 'layer-stack', start: 0, duration: 2, params: { layers: [{ title: 'أ', icons: [img], at: 0.5 }, { title: 'ب', at: 0.6 }] } },
        { id: 'g', type: 'node-graph', start: 0, duration: 2, params: { nodes: [{ id: 'a', label: 'أ', icon: img, x: 0, y: 0, at: 0 }] } },
        { id: 'c', type: 'chat-thread', start: 0, duration: 2, params: { avatar: img, name: 'ص', messages: [{ side: 'in', text: 'مرحبا', at: 0.2 }] } },
      ]
      await writeFile(join(dir, 'sb.json'), JSON.stringify({ version: 1, scenes: scenes('شعار.svg') }))
      const r = await loadStoryboardFile(join(dir, 'sb.json'))
      const ps = r.sb.scenes.map((s) => s.params as Record<string, any>)
      const inlined = [ps[0]!.items[1].image, ps[1]!.layers[0].icons[0], ps[2]!.nodes[0].icon, ps[3]!.avatar]
      for (const v of inlined) expect(v.startsWith('data:image/svg+xml;base64,')).toBe(true)
      expect(ps[0]!.items[0].image).toBe(IMG)
      await writeFile(join(dir, 'sb.json'), JSON.stringify({ version: 1, scenes: scenes('https://example.com/a.svg') }))
      await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/^لا تُقبل روابط الإنترنت.* — scenes\[0\]\.params\.items\[1\]\.image: .*no remote URLs/)
      await writeFile(join(dir, 'sb.json'), JSON.stringify({ version: 1, scenes: scenes('missing.svg').slice(1) }))
      await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/scenes\[0\]\.params\.layers\[0\]\.icons\[0\]/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
