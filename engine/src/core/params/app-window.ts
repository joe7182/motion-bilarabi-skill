import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { hasArabic } from '../text'
import { morphKey, oneLine } from './common'
import { safePoint } from './line-art'

/** One line of `app-window`: starts at `at` (scene-local s; an anchor in the storyboard, R3). */
export const appWindowLine = z.object({
  /** At most 36 characters: a terminal line never wraps and must stay readable (≥ the audit's glyph floor). */
  text: oneLine(36),
  at: z.number().min(0),
  /** Text colour (default: the window's text colour). */
  color: z.string().min(1).optional(),
})

/** Params of `app-window`. */
export const appWindowParams = z
  .object({
  /** Title-bar text (one line unit). */
  title: oneLine(40, 'title').optional(),
  /** `terminal`: Latin/code lines type with a caret, Arabic lines wipe right → left; `app`: lines fade in whole. */
  mode: z.enum(['terminal', 'app']),
  lines: z.array(appWindowLine).max(8, { message: 'at most 8 lines fit the window' }).default([]),
  /**
   * A screenshot shown in the window body above the lines (Task 10: the user's landscape screens):
   * a project image path (relative to the storyboard) or a data URL, inlined at load like a phone screen.
   */
  image: z.string().min(1).optional(),
  /** Typing speed (characters per second). */
  cps: z.number().min(4).max(120).default(34),
  /** Centre of the window in the safe area (default: its centre). */
  at: safePoint.optional(),
  /** Window width as a fraction of the safe width. */
  size: z.number().min(0.3).max(1).default(0.92),
  key: morphKey,
})
  .refine((p) => p.lines.length > 0 || p.image !== undefined, { path: ['lines'], message: 'lines must have at least one line (or give an image)' })

export type AppWindowParams = z.infer<typeof appWindowParams>

export const APP_WINDOW_TIMING = {
  /** The window scales in from `popFrom` over this long (visible on frame 0). */
  windowIn: 0.3,
  popFrom: 0.92,
  /** `app` mode: a line fades and rises over this long from its `at`. */
  lineIn: 0.25,
  /** Caret blink half-period once a line is typed (s). */
  blink: 0.5,
} as const

/** How a line is revealed: `type` (per character, terminal Latin), `wipe` (terminal Arabic), `fade` (app mode). */
export function lineReveal(p: Pick<AppWindowParams, 'mode'>, text: string): 'type' | 'wipe' | 'fade' {
  if (p.mode === 'app') return 'fade'
  return hasArabic(text) ? 'wipe' : 'type'
}

/** Seconds a line takes to reveal: its code points / cps (typing and wipe), or `lineIn` (app). */
export function lineDuration(p: Pick<AppWindowParams, 'mode' | 'cps'>, text: string): number {
  return lineReveal(p, text) === 'fade' ? APP_WINDOW_TIMING.lineIn : [...text].length / p.cps
}

/** Local time code point `i` of a typed line appears: `at + i / cps` (the first one on `at`). */
export const charTime = (p: Pick<AppWindowParams, 'cps'>, line: { at: number }, i: number): number => line.at + i / p.cps

/** Code points of a typed line shown at local `t` (pure; 0 before `at`, all once typed). */
export function typedChars(p: Pick<AppWindowParams, 'cps'>, line: { text: string; at: number }, t: number): number {
  const n = [...line.text].length
  if (!(t >= line.at)) return 0
  return Math.min(n, Math.floor((t - line.at) * p.cps + 1e-9) + 1)
}

/** Scene-level check: every line must finish revealing inside the scene. */
export function timingIssueOfAppWindow(p: AppWindowParams, sceneLen: number) {
  const k = p.lines.findIndex((l) => l.at + lineDuration(p, l.text) > sceneLen + 1e-9)
  if (k < 0) return undefined
  const l = p.lines[k]!
  return {
    path: ['lines', k, 'at'],
    ar: `السطر «${l.text}» لا يكتمل قبل نهاية المشهد`,
    en: `line at ${l.at} s finishes at ${l.at + lineDuration(p, l.text)} s, past the scene end (${sceneLen} s local, duration + preroll)`,
  }
}

/**
 * Sound cues of `app-window`: a `type-letter` per typed non-space character (terminal Latin), one
 * `action` per Arabic (wiped) line and per `app` line.
 */
export function cuesOfAppWindow(p: AppWindowParams, _ctx: { duration: number }): Cue[] {
  return p.lines.flatMap((l): Cue[] => {
    if (lineReveal(p, l.text) !== 'type') return [{ t: l.at, kind: 'action' }]
    return [...l.text].flatMap((c, i) => (/\s/.test(c) ? [] : [{ t: charTime(p, l, i), kind: 'type-letter' as const }]))
  })
}
