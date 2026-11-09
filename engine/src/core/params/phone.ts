import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { earlyStart, morphKey, oneLine } from './common'
import { safePoint } from './line-art'

/** One message line on the phone screen: enters as a whole text unit at `at` (scene-local s). */
export const phoneLine = z.object({ text: oneLine(60), at: z.number().min(0) })

/** Params of `phone`. */
export const phoneParams = z.object({
  /**
   * The screen: a project image (a path relative to the storyboard, or a data URL; inlined at
   * load like `brand.logo`), fitted `cover`, or message lines.
   */
  screen: z.union([
    z.object({ image: z.string().min(1) }).strict(),
    z.object({ lines: z.array(phoneLine).min(1, { message: 'lines must have at least one line' }).max(6) }).strict(),
  ]),
  /** Tilt of the whole device (deg). */
  tilt: z.number().min(-20).max(20).default(-2),
  /** Centre of the phone in the safe area (default: its centre). */
  at: safePoint.optional(),
  /** Phone width as a fraction of the safe width (the height caps it). */
  size: z.number().min(0.2).max(1).default(0.6),
  key: morphKey,
})

export type PhoneParams = z.infer<typeof phoneParams>

export const PHONE_TIMING = {
  /** The device pops in on the `playful` spring from this scale (visible on frame 0). */
  popFrom: 0.8,
  /** A line fades and rises over this long from its `at` (R17: earlier when `at` < lineIn). */
  lineIn: 0.25,
} as const

/** R17: local time a line starts entering (ends at `at` when `at` < lineIn). */
export const phoneLineStart = (l: { at: number }): number => earlyStart(l.at, PHONE_TIMING.lineIn)

/** Scene-level check: every line must appear before the scene ends. */
export function timingIssueOfPhone(p: PhoneParams, sceneLen: number) {
  if (!('lines' in p.screen)) return undefined
  const k = p.screen.lines.findIndex((l) => !(l.at < sceneLen))
  if (k < 0) return undefined
  return {
    path: ['screen', 'lines', k, 'at'],
    ar: `السطر «${p.screen.lines[k]!.text}» يظهر بعد نهاية المشهد`,
    en: `line appears at ${p.screen.lines[k]!.at} s, at or after the scene end (${sceneLen} s local, duration + preroll)`,
  }
}

/** Sound cue of `phone`: one `pop` as it appears. */
export function cuesOfPhone(_p: PhoneParams, _ctx: { duration: number }): Cue[] {
  return [{ t: 0, kind: 'pop' }]
}
