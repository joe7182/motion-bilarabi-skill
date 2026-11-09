import type { Cue } from '../audio-plan'
import { z } from 'zod'

/** One row of `checklist`: enters at `at` (scene-local s; an anchor in the storyboard, R3). */
export const checklistItem = z.object({
  text: z
    .string()
    .min(1)
    .max(40)
    .refine((t) => t.trim().length > 0, { message: 'text must not be blank' })
    .refine((t) => !/[\r\n]/.test(t), { message: 'text must be a single line' }),
  at: z.number().min(0),
  /** Fix wave I4: `data-mba-key` on this row's label alone (a highlight `target` that marks one row). */
  key: z.string().min(1).optional(),
})

/** Params of `checklist` (at most 8 rows: they must fit the safe area at a readable size). */
export const checklistParams = z.object({
  items: z.array(checklistItem).min(1, { message: 'items must have at least one item' }).max(8, { message: 'at most 8 items fit the safe area' }),
  /** Morph key (Task 8). */
  key: z.string().min(1).optional(),
  /**
   * Fix wave I4: the row font size to aim for (px at a 1080 px wide frame, scaled with the frame
   * width), filling up to the whole safe width instead of CHECKLIST.fillW; smaller only when the
   * rows do not fit. Default: the fit to CHECKLIST.fillW.
   */
  rowPx: z.number().min(40).max(200).optional(),
  /**
   * Critic round 2: the vertical centre of the list as a fraction of the frame height (default:
   * the centre of the safe area). Clamped so the list stays inside the safe area.
   */
  y: z.number().min(0).max(1).optional(),
  /**
   * Fix wave: punchier rows, so each spoken item is a visible beat (a row sliding in at 100 px did
   * not always register in the review): a row enters from CHECKLIST_TIMING.popFrom scale with a
   * longer slide, and once its check is drawn it pulses (up to `pulseScale` and back over `pulse`
   * s). Off by default.
   */
  pulse: z.boolean().default(false),
})

export type ChecklistParams = z.infer<typeof checklistParams>

export const CHECKLIST_TIMING = {
  /** A row slides/fades in over this long from its `at`; its check starts drawing right after (s). */
  rowIn: 0.25,
  /** The check stroke self-draws over this long (s). */
  checkIn: 0.3,
  /** `pulse`: the ticked row swells to this scale and back over this long (s). */
  pulse: 0.3,
  pulseScale: 1.15,
  /** `pulse`: a row enters from this scale, sliding this much further (× CHECKLIST.slide). */
  popFrom: 0.8,
  popSlide: 1.6,
} as const

/**
 * R17: local time a row starts entering. Normally its `at`; a row whose `at` is earlier than
 * `rowIn` enters early instead, ending at `at`, so a row at 0 is fully visible on frame 0.
 */
export const rowStart = (item: { at: number }): number => (item.at < CHECKLIST_TIMING.rowIn ? item.at - CHECKLIST_TIMING.rowIn : item.at)

/** Local time an item's check starts drawing: right after its row has entered. */
export const checkStart = (item: { at: number }): number => rowStart(item) + CHECKLIST_TIMING.rowIn

/**
 * Scene-level check (`validateSceneParams`): every row must finish its check inside the scene,
 * i.e. `checkStart + checkIn ≤ sceneLen` where sceneLen = duration + preroll (local time).
 */
export function timingIssueOfChecklist(p: ChecklistParams, sceneLen: number) {
  const k = p.items.findIndex((it) => checkStart(it) + CHECKLIST_TIMING.checkIn > sceneLen + 1e-9)
  if (k < 0) return undefined
  const it = p.items[k]!
  return {
    path: ['items', k, 'at'],
    ar: `البند «${it.text}» لا يكتمل قبل نهاية المشهد`,
    en: `item at ${it.at} s finishes its check at ${checkStart(it) + CHECKLIST_TIMING.checkIn} s, past the scene end (${sceneLen} s local, duration + preroll)`,
  }
}

/** Sound cues of `checklist`: one `action` (a tick, LIST_TYPES) per item as its check starts. */
export function cuesOfChecklist(p: ChecklistParams, _ctx: { duration: number }): Cue[] {
  return p.items.map((it) => ({ t: checkStart(it), kind: 'action' as const }))
}
