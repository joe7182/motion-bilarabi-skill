import type { Cue } from '../audio-plan'
import { z } from 'zod'
import type { Storyboard } from '../storyboard'
import { morphKey } from './common'
import { safePoint } from './line-art'

const frac = z.number().min(0).max(1)

/** Params of `highlight`. */
export const highlightParams = z
  .object({
    kind: z.enum(['circle', 'burst', 'underline', 'strike']),
    /**
     * `data-mba-key` of an element in a scene shown over the whole highlight (it starts no later and
     * ends no earlier; on another track, earlier in the storyboard, so it is built first). Measured
     * once at build, at rest.
     */
    target: z.string().min(1).optional(),
    /**
     * Transcript index of a word (`data-mba-word`, Task 1) in an earlier scene shown over the whole
     * highlight; the mark is measured on that word. Alternative to `target` and `box`.
     */
    word: z.number().int().min(0).optional(),
    /** The region in safe-area fractions (x, y = top-left). */
    box: z.object({ x: frac, y: frac, w: frac.positive(), h: frac.positive() }).optional(),
    /** Stroke colour (default: the look's accent). */
    color: z.string().min(1).optional(),
    /** Seconds the stroke takes to draw. */
    drawIn: z.number().positive().max(5).default(0.45),
    /** Without `target` or `box`: the region's centre in the safe area (default: its centre)… */
    at: safePoint.optional(),
    /** …and its width as a fraction of the safe width (height: half of it). */
    size: z.number().min(0.05).max(1).default(0.5),
    key: morphKey,
  })
  .refine((p) => !(p.target !== undefined && p.box !== undefined), { path: ['box'], message: 'give either target or box, not both' })
  .refine((p) => p.word === undefined || (p.target === undefined && p.box === undefined), {
    path: ['word'],
    message: 'give at most one of target, box and word',
  })

export type HighlightParams = z.infer<typeof highlightParams>

/** Underline: its distance under the target's ink box bottom (× the target's font size), so it never grazes the letters. */
export const UNDERLINE = { below: 0.12 } as const

export const HIGHLIGHT = {
  /** Room between the region and the stroke (× frame width): covers the target's own drift (R16). */
  pad: 0.05,
  /** Circle: radius wobble (fraction, outward only), number of wobble points, overshoot (turns). */
  wobble: 0.06,
  points: 14,
  turns: 1.08,
  /** Burst: rays, inner/outer radius (× the circle radius). */
  rays: 10,
  rayFrom: 1.12,
  rayTo: 1.38,
  /** Burst rays start one after another over this share of `drawIn`. */
  rayStagger: 0.5,
} as const

/** True when scene `t` is shown over the whole of scene `h` (visible spans; float slack). */
export const covers = (t: { start: number; duration: number }, h: { start: number; duration: number }): boolean =>
  t.start <= h.start + 1e-9 && t.start + t.duration >= h.start + h.duration - 1e-9

/**
 * Node-side check of a `target` (before render): an earlier scene shown over the whole of scene
 * `i` (`covers`) must have `params.key === target`. Returns the issue for `validateSceneParams`.
 */
export function targetIssueOfHighlight(sb: Storyboard, i: number, p: HighlightParams) {
  if (p.word !== undefined) return wordIssueOfHighlight(sb, i, p.word)
  if (p.target === undefined) return undefined
  const me = sb.scenes[i]!
  // The scene's own key, or (Task 10) a key on one of its kinetic words, or (fix wave I4) on one
  // of its checklist rows.
  const keys = (sc: { params: Record<string, unknown> }) => {
    const ps = sc.params as { key?: unknown; words?: { key?: unknown }[]; items?: { key?: unknown }[] } | undefined
    const sub = (xs: unknown) => (Array.isArray(xs) ? (xs as { key?: unknown }[]).map((w) => w?.key) : [])
    return [ps?.key, ...sub(ps?.words), ...sub(ps?.items)]
  }
  const found = sb.scenes.slice(0, i).some((sc) => keys(sc).includes(p.target) && covers(sc, me))
  if (found) return undefined
  return {
    path: ['target'],
    ar: `لا يوجد مشهد سابق يغطي مدة التحديد كلها فيه العنصر ذو المفتاح «${p.target}»`,
    en: `no earlier scene shown over this whole scene has key "${p.target}"`,
  }
}

/** `word` check: an earlier scene shown over the whole of scene `i` has a word with that transcript index. */
function wordIssueOfHighlight(sb: Storyboard, i: number, word: number) {
  const me = sb.scenes[i]!
  const has = (sc: { params: Record<string, unknown> }) => {
    const ws = (sc.params as { words?: unknown } | undefined)?.words
    return Array.isArray(ws) && ws.some((w) => (w as { word?: unknown } | null)?.word === word)
  }
  if (sb.scenes.slice(0, i).some((sc) => has(sc) && covers(sc, me))) return undefined
  return {
    path: ['word'],
    ar: `لا توجد كلمة بالرقم ${word} معروضة طوال هذا المشهد`,
    en: `no word ${word} shown over this whole scene`,
  }
}

/** Sound cue of `highlight`: one `action` as the stroke starts. */
export function cuesOfHighlight(_p: HighlightParams, _ctx: { duration: number }): Cue[] {
  return [{ t: 0, kind: 'action' }]
}
