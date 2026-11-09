import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { imageSrc, morphKey, oneLineAr as oneLine, rangeAr, idAr } from './common'
import { safePoint } from './line-art'
import type { SceneTimingIssue } from './index'

export const NODE_KINDS = ['trigger', 'step', 'agent', 'slot'] as const

/** One node of `node-graph`: `x`, `y` place its box centre inside the panel's canvas (0..1). */
export const graphNode = z.object({
  id: idAr('id'),
  label: oneLine(18, 'label'),
  sub: oneLine(22, 'sub').optional(),
  icon: imageSrc.optional(),
  x: rangeAr(0, 1, 'x'),
  y: rangeAr(0, 1, 'y'),
  at: z.number().finite().min(0),
  kind: z.enum(NODE_KINDS).default('step'),
  /** `slot` only: the scene s the empty socket becomes a filled node. */
  fillAt: z.number().finite().min(0).optional(),
})

/** A wire: `main` = a horizontal bezier left → right (data flow), `sub` = a dashed drop from `from`'s bottom to `to`'s top. */
export const graphEdge = z.object({
  from: idAr('from'),
  to: idAr('to'),
  at: z.number().finite().min(0),
  kind: z.enum(['main', 'sub']).default('main'),
})

/**
 * Params of `node-graph`: a workflow canvas (our own drawing, n8n / Zapier style): a rounded panel
 * with a dot grid and a toolbar strip, ≤ 8 nodes that pop in, ≤ 10 wires that draw themselves, an
 * optional flow of pulses along every drawn wire, and `focus` outlines. Data flows left → right like
 * the real tools; only the labels are Arabic.
 */
export const nodeGraphParams = z
  .object({
    nodes: z.array(graphNode).min(1, { message: 'عقدة واحدة على الأقل — nodes needs at least one node' }).max(8, { message: 'ثماني عقد على الأكثر — at most 8 nodes' }),
    edges: z.array(graphEdge).max(10, { message: 'عشرة أسلاك على الأكثر — at most 10 edges' }).default([]),
    flowAt: z.number().finite().min(0).optional(),
    focus: z
      .array(z.object({ at: z.number().finite().min(0), id: z.string().min(1) }))
      .max(12, { message: 'لا يزيد عن ١٢ — focus: at most 12 entries' })
      .default([]),
    panel: z.object({ title: oneLine(30, 'title').optional() }).default({}),
    at: safePoint.default({ x: 0.5, y: 0.5 }),
    /** Panel width as a fraction of the safe width, and its width / height. */
    width: rangeAr(0.5, 1, 'width').default(0.94),
    aspect: rangeAr(0.5, 2, 'aspect').default(0.95),
    key: morphKey,
  })
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    const ids = new Map<string, number>()
    p.nodes.forEach((n, i) => {
      if (ids.has(n.id)) issue(['nodes', i, 'id'], `معرّف مكرر «${n.id}» — duplicate node id "${n.id}"`)
      ids.set(n.id, i)
      if (n.fillAt !== undefined && n.kind !== 'slot') issue(['nodes', i, 'fillAt'], 'الملء للعقدة الفارغة فقط (kind: "slot") — fillAt needs kind "slot"')
      if (n.fillAt !== undefined && n.fillAt < n.at) issue(['nodes', i, 'fillAt'], 'الملء قبل ظهور العقدة — fillAt must be no earlier than the node appears')
    })
    p.edges.forEach((e, i) => {
      for (const end of ['from', 'to'] as const) {
        if (!ids.has(e[end])) issue(['edges', i, end], `لا توجد عقدة «${e[end]}» — no node with id "${e[end]}"`)
      }
      if (e.from === e.to) issue(['edges', i, 'to'], 'السلك يصل عقدتين مختلفتين — an edge joins two different nodes')
      const a = p.nodes[ids.get(e.from) ?? -1]
      const b = p.nodes[ids.get(e.to) ?? -1]
      if (a && b && e.at < Math.max(a.at, b.at)) issue(['edges', i, 'at'], 'السلك يُرسم قبل ظهور عقدتيه — an edge must draw no earlier than both its nodes appear')
    })
    p.focus.forEach((f, i) => {
      if (!ids.has(f.id)) issue(['focus', i, 'id'], `لا توجد عقدة «${f.id}» — no node with id "${f.id}"`)
      if (i > 0 && f.at < p.focus[i - 1]!.at) issue(['focus', i, 'at'], 'الأوقات مرتبة تصاعديًا — focus must be in ascending order of at')
    })
  })

export type NodeGraphParams = z.infer<typeof nodeGraphParams>
export type GraphNode = NodeGraphParams['nodes'][number]

export const NODE_GRAPH = {
  /** Panel: corner radius, toolbar height, canvas padding, dot pitch (× panel width). */
  radius: 0.045,
  toolbar: 0.085,
  pad: 0.05,
  dot: 0.034,
  /** Node box side (× panel width); agent box width / height (× side); slot circle (× side). */
  side: 0.16,
  agentW: 2.0,
  agentH: 0.72,
  slot: 0.78,
  /** Node pop: scale `popFrom` → 1 (settle) + fade over `popSec`; the panel rises in over `panelSec`. */
  popFrom: 0.82,
  popSec: 0.38,
  panelSec: 0.45,
  /** Wires draw over `drawSec`; pulses move at `pulseSpeed` (× panel width per s). */
  drawSec: 0.4,
  pulseSpeed: 0.55,
  /** Slot fill: the socket turns into a node over `fillSec`. */
  fillSec: 0.45,
  /** Focus outline eases over `focusSec`. */
  focusSec: 0.28,
  /** Label / sub font px at 1080 (scaled). */
  labelPx: 30,
  subPx: 25,
  titlePx: 28,
} as const

/** Scene-level check: every beat lies inside the scene. */
export function timingIssueOfNodeGraph(p: NodeGraphParams, sceneLen: number): SceneTimingIssue | undefined {
  const late = (path: (string | number)[], t: number, what: string) => ({ path, ar: `${what} بعد نهاية المشهد (${sceneLen} ث)`, en: `${path.join('.')} = ${t} s is at or past the scene end (${sceneLen} s local)` })
  for (const [i, n] of p.nodes.entries()) {
    if (n.at >= sceneLen) return late(['nodes', i, 'at'], n.at, 'العقدة')
    if (n.fillAt !== undefined && n.fillAt >= sceneLen) return late(['nodes', i, 'fillAt'], n.fillAt, 'الملء')
  }
  for (const [i, e] of p.edges.entries()) if (e.at >= sceneLen) return late(['edges', i, 'at'], e.at, 'السلك')
  for (const [i, f] of p.focus.entries()) if (f.at >= sceneLen) return late(['focus', i, 'at'], f.at, 'التركيز')
  if (p.flowAt !== undefined && p.flowAt >= sceneLen) return late(['flowAt'], p.flowAt, 'التدفق')
  return undefined
}

/** Sound cues: a `pop` per node, a `hit` per slot fill, an `action` per focus change. */
export function cuesOfNodeGraph(p: NodeGraphParams, _ctx: { duration: number }): Cue[] {
  const out: Cue[] = p.nodes.map((n) => ({ t: n.at, kind: 'pop' as const }))
  for (const n of p.nodes) if (n.fillAt !== undefined) out.push({ t: n.fillAt, kind: 'hit' })
  for (const f of p.focus) out.push({ t: f.at, kind: 'action' })
  return out.sort((a, b) => a.t - b.t)
}
