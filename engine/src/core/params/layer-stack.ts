import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { imageSrc, indexBeats, morphKey, oneLineAr as oneLine, rangeAr } from './common'
import { safePoint } from './line-art'
import type { SceneTimingIssue } from './index'

/** One slab of `layer-stack`, listed TOP to BOTTOM: its labels, up to 3 logos on it, and the scene s it lands. */
export const stackLayer = z.object({
  title: oneLine(20, 'title'),
  subtitle: oneLine(28, 'subtitle').optional(),
  icons: z.array(imageSrc).max(3, { message: 'ثلاث أيقونات على الأكثر لكل طبقة — at most 3 icons per layer' }).default([]),
  at: z.number().finite().min(0),
})

/**
 * Params of `layer-stack`: 2..4 isometric slabs stacked vertically («the three layers of any real
 * system»), listed TOP to BOTTOM. Each slab slides down and lands softly at its `at`; its title and
 * subtitle sit to the side on a hairline leader with a numbered badge (1 = the BOTTOM slab).
 * `active` lifts one slab (accent edge, +4 %) and dims the others to 45 %; from `flowAt` small accent
 * pulses climb the wires between the slabs, looping. Indices (`active[].index`) are 0-based in the
 * listed order: 0 = the TOP slab.
 */
export const layerStackParams = z
  .object({
    layers: z
      .array(stackLayer)
      .min(2, { message: 'من طبقتين إلى أربع — layers must be 2..4' })
      .max(4, { message: 'من طبقتين إلى أربع — layers must be 2..4' }),
    active: indexBeats(12, 'active'),
    /** Scene s the pulses start climbing (absent: no flow). */
    flowAt: z.number().finite().min(0).optional(),
    /** Numbered badges (1 = the bottom slab). */
    number: z.boolean().default(true),
    digits: z.enum(['arabic', 'latin']).default('arabic'),
    /** Centre of the whole figure (slabs + labels) in the safe area. */
    at: safePoint.default({ x: 0.5, y: 0.5 }),
    /** Figure width as a fraction of the safe width. */
    width: rangeAr(0.5, 1, 'width').default(0.86),
    key: morphKey,
  })
  .superRefine((p, ctx) => {
    const n = p.layers.length
    p.active.forEach((a, i) => {
      if (a.index >= n) ctx.addIssue({ code: 'custom', path: ['active', i, 'index'], message: `الطبقة خارج القائمة (٠ إلى ${n - 1}) — index must be 0..${n - 1}` })
      if (i > 0 && a.at < p.active[i - 1]!.at) ctx.addIssue({ code: 'custom', path: ['active', i, 'at'], message: 'أوقات التمييز مرتبة تصاعديًا — active must be in ascending order of at' })
    })
  })

export type LayerStackParams = z.infer<typeof layerStackParams>

export const LAYER_STACK = {
  /** Slab region width (× figure width); the rest holds the leaders and labels. */
  slabShare: 0.47,
  /** Top-face half-height (× half-width a), slab thickness (× a), vertical pitch (× b, + thickness). */
  flat: 0.5,
  thick: 0.17,
  pitch: 1.72,
  /** Top-face corner radius (face units, the face is the square [-1, 1]²). */
  radius: 0.2,
  /** The slab slides down by `drop` (× pitch) and lands (settle) at its `at`, over `slideSec`. */
  drop: 0.55,
  slideSec: 0.55,
  /** Label beats after landing (s): leader, badge, title wipe, subtitle fade. */
  leader: [0.0, 0.3],
  badge: [0.1, 0.4],
  title: [0.12, 0.55],
  subtitle: [0.3, 0.65],
  /** Leader length (× figure width) and the gap after the slab's right corner (× a). */
  leaderW: 0.06,
  leaderGap: 0.06,
  /** Active: lift (× slab width), others' opacity, ease (s). */
  lift: 0.04,
  dim: 0.45,
  activeSec: 0.35,
  /** Wires: x offsets on the top face (× a); a pulse climbs one wire in `pulseSec`, looping. */
  wires: [-0.62, 0, 0.62],
  pulseSec: 1.3,
  /** Icons: tile side (× a), offsets along the face's long diagonal (× a), pop after landing (s). */
  icon: 0.3,
  iconSlots: { 1: [0], 2: [-0.32, 0.32], 3: [-0.46, 0, 0.46] } as Record<number, number[]>,
  iconPop: [0.12, 0.45],
  /** Title / subtitle font px at 1080 (scaled), and the floor when shrinking to fit. */
  titlePx: 40,
  subtitlePx: 30,
  minPx: 26,
} as const

/** Scene s slab `i` (listed order) starts sliding: it lands at its `at`. */
export const slabSlideStart = (p: Pick<LayerStackParams, 'layers'>, i: number): number => p.layers[i]!.at - LAYER_STACK.slideSec

/** Badge number of slab `i` (listed TOP to BOTTOM): 1 = the bottom slab. */
export function slabNumber(p: Pick<LayerStackParams, 'layers' | 'digits'>, i: number): string {
  const s = String(p.layers.length - i)
  return p.digits === 'arabic' ? [...s].map((c) => '٠١٢٣٤٥٦٧٨٩'[Number(c)]).join('') : s
}

/** Scene-level check: every landing / active / flow time lies inside the scene. */
export function timingIssueOfLayerStack(p: LayerStackParams, sceneLen: number): SceneTimingIssue | undefined {
  const k = p.layers.findIndex((l) => l.at >= sceneLen)
  if (k >= 0) return { path: ['layers', k, 'at'], ar: `الطبقة ${k + 1} تهبط بعد نهاية المشهد (${sceneLen} ث)`, en: `layers[${k}] lands at ${p.layers[k]!.at} s, at or past the scene end (${sceneLen} s local)` }
  const j = p.active.findIndex((a) => a.at >= sceneLen)
  if (j >= 0) return { path: ['active', j, 'at'], ar: `التمييز بعد نهاية المشهد (${sceneLen} ث)`, en: `active[${j}] at ${p.active[j]!.at} s is at or past the scene end (${sceneLen} s local)` }
  if (p.flowAt !== undefined && p.flowAt >= sceneLen) return { path: ['flowAt'], ar: `التدفق بعد نهاية المشهد (${sceneLen} ث)`, en: `flowAt ${p.flowAt} s is at or past the scene end (${sceneLen} s local)` }
  return undefined
}

/** Sound cues: a `pop` as each slab lands, an `action` per active change. */
export function cuesOfLayerStack(p: LayerStackParams, _ctx: { duration: number }): Cue[] {
  const out: Cue[] = p.layers.map((l) => ({ t: l.at, kind: 'pop' as const }))
  for (const a of p.active) out.push({ t: a.at, kind: 'action' })
  return out.sort((a, b) => a.t - b.t)
}
