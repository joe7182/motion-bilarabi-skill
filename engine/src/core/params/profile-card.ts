import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { morphKey, oneLine } from './common'
import { safePoint } from './line-art'

/** One stat of `profile-card`: a number that rolls up from 0 and its label under it. */
export const profileStat = z.object({
  value: z.number().int().min(0).max(99_999_999),
  label: oneLine(16, 'label'),
})

/**
 * Params of `profile-card`: the creator's own profile card («أنا يوسف»). `avatar` is a project image
 * (a path relative to the storyboard, or a data URL; inlined at load like a phone screen). The card
 * rises in, the avatar pops inside a ring that draws itself, the name wipes in, the stats roll up,
 * and at `pressAt` the follow button is pressed and becomes `followed`.
 */
export const profileCardParams = z.object({
  avatar: z.string().min(1),
  name: oneLine(40, 'name'),
  stats: z.array(profileStat).min(1).max(3),
  button: oneLine(16, 'button').default('Follow'),
  followed: oneLine(16, 'followed').default('Following ✓'),
  /** Local s the button is pressed (absent: never). */
  pressAt: z.number().min(0).optional(),
  /** Centre of the card in the safe area (default: its centre). */
  at: safePoint.optional(),
  /** Card width as a fraction of the safe width. */
  size: z.number().min(0.5).max(1).default(0.96),
  key: morphKey,
})

export type ProfileCardParams = z.infer<typeof profileCardParams>

/** The beats of `profile-card` (local s). */
export const PROFILE_TIMING = {
  cardIn: [0, 0.35],
  avatar: [0.08, 0.5],
  ring: [0.1, 0.75],
  name: [0.3, 0.75],
  /** Stat i rolls over [rollFrom + i·stagger, … + roll]. */
  rollFrom: 0.45,
  stagger: 0.12,
  roll: 1.0,
  buttonIn: [0.6, 0.9],
  press: 0.35,
} as const

/** Sound cues: `pop` as the avatar lands, `action` on the press. */
export function cuesOfProfileCard(p: ProfileCardParams, _ctx: { duration: number }): Cue[] {
  return [{ t: PROFILE_TIMING.avatar[1], kind: 'pop' }, ...(p.pressAt === undefined ? [] : [{ t: p.pressAt, kind: 'action' as const }])]
}
