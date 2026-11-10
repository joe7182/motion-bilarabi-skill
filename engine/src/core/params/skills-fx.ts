import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { oneLineAr } from './common'

/**
 * Skill-package explainers.
 * - skill-deck: skills as cards. A source (a package box labelled with a file name) deals the cards
 *   along arcs into app windows ("docks"); docks can start with cards, or show a question mark.
 * - twin-sync: two machines side by side (yours and a friend's) with skill · version rows; a lock
 *   file seals between them and the friend's rows fill in, each matched to yours.
 */

const at = z.number().min(0)
const skill = z.object({ name: z.string().min(1).max(18), ver: z.string().min(1).max(8).optional() })

export const skillDeckParams = z.object({
  skills: z.array(skill).min(1).max(5),
  /** The app windows the cards go into (left to right on screen). */
  docks: z.array(z.object({ name: z.string().min(1).max(16), tint: z.string().max(20).optional() })).min(1).max(3),
  /** Docks that already hold every card when the scene opens (indices). */
  preloaded: z.array(z.number().int().min(0).max(2)).default([]),
  /** A dock that shows a big question mark until it receives cards. */
  question: z.number().int().min(0).max(2).optional(),
  /** The source box (a file name) the cards come out of; none: cards fly from the first preloaded dock. */
  source: z.string().max(24).optional(),
  /** Local s the source opens and fans the cards, and when the deal starts (cards fly 0.55 s, staggered). */
  fanAt: at.default(0.3),
  dealAt: at.optional(),
  /** Which docks receive the deal (default: every dock not preloaded). */
  dealTo: z.array(z.number().int().min(0).max(2)).optional(),
})
export type SkillDeckParams = z.infer<typeof skillDeckParams>
export const DECK = { fly: 0.55, stagger: 0.12 } as const

export const twinSyncParams = z.object({
  rows: z.array(skill).min(1).max(5),
  you: oneLineAr(14, 'you').default('إنت'),
  friend: oneLineAr(14, 'friend').default('صديقك'),
  /** The lock file name shown between the machines. */
  lock: z.string().min(1).max(24).default('apm.lock.yaml'),
  /** Local s: the lock card drops in and snaps shut, then the friend's rows fill (one per 0.18 s). */
  lockAt: at.default(0.8),
  fillAt: at.default(1.8),
  /** The match lines and the «same» badge. */
  matchAt: at.default(2.8),
  badge: oneLineAr(20, 'badge').default('نفس النسخ بالضبط'),
})
export type TwinSyncParams = z.infer<typeof twinSyncParams>

export const cuesOfSkillDeck = (p: SkillDeckParams): Cue[] => (p.dealAt === undefined ? [] : [{ t: p.dealAt, kind: 'whoosh' }])
export const cuesOfTwinSync = (p: TwinSyncParams): Cue[] => [{ t: p.lockAt + 0.35, kind: 'hit' }, { t: p.matchAt, kind: 'pop' }]
