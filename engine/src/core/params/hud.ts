import { z } from 'zod'
import { morphKey, oneLine } from './common'

/** One section of `hud`: its label shows from `at` (scene-local s; an anchor in the storyboard, R3). */
export const hudSection = z.object({ label: oneLine(30, 'label'), at: z.number().min(0) })

/**
 * Params of `hud`: a top-track overlay (section label top-right, progress pips top-left, optional
 * handle tag). It sits at the safe area's top edge, so it takes no `at`; `size` caps the label width.
 */
export const hudParams = z
  .object({
    sections: z.array(hudSection).min(1, { message: 'sections must have at least one section' }).max(8),
    /** Creator handle (e.g. `@yousif`), shown at 35 % opacity. */
    handle: oneLine(30, 'handle').optional(),
    progress: z.enum(['pips', 'none']),
    /** Widest the label may be, as a fraction of the safe width. */
    size: z.number().min(0.2).max(0.7).default(0.55),
    key: morphKey,
  })
  .superRefine((p, ctx) => {
    for (let k = 1; k < p.sections.length; k++) {
      if (!(p.sections[k]!.at > p.sections[k - 1]!.at)) {
        ctx.addIssue({ code: 'custom', path: ['sections', k, 'at'], message: 'sections must be in ascending order of at' })
        return
      }
    }
  })

export type HudParams = z.infer<typeof hudParams>

export const HUD = {
  /** A new section label fades and slides in over this long (s). */
  labelIn: 0.25,
  /** Handle tag opacity. */
  handleOpacity: 0.35,
} as const

/** Index of the section shown at local `t`: the last one whose `at` ≤ t, or −1 before the first. */
export function hudSectionAt(p: Pick<HudParams, 'sections'>, t: number): number {
  let k = -1
  p.sections.forEach((s, i) => {
    if (t >= s.at) k = i
  })
  return k
}

/** Scene-level check: every section must start before the scene ends. */
export function timingIssueOfHud(p: HudParams, sceneLen: number) {
  const k = p.sections.findIndex((s) => !(s.at < sceneLen))
  if (k < 0) return undefined
  return {
    path: ['sections', k, 'at'],
    ar: `القسم «${p.sections[k]!.label}» يبدأ بعد نهاية المشهد`,
    en: `section starts at ${p.sections[k]!.at} s, at or after the scene end (${sceneLen} s local, duration + preroll)`,
  }
}
