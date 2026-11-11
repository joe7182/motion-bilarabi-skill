import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { isStretchable, splitWords } from '../text'
import { earlyStart } from './common'

/** One word of `kinetic-text`: shown at `at` (scene-local s; an anchor in the storyboard, R3). */
export const kineticWord = z.object({
  text: z
    .string()
    .min(1)
    .max(40)
    .refine((t) => splitWords(t).length === 1 && t.trim() === t, { message: 'text must be exactly one word (no spaces)' })
    .refine((t) => !t.includes('*'), { message: 'text must not contain "*": stress a word with stress: 2 (stars are script.md syntax, R7)' }),
  at: z.number().min(0),
  /** 0: slide/fade in; 1: scale punch 1.15; 2 (a `*…*` word in script.md): punch 1.3 + camera shake + accent (R7). */
  stress: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  /** `data-mba-key` on this word alone (Task 10): a highlight `target` that marks the word, not the block. */
  key: z.string().min(1).optional(),
  /** Transcript index of the word (`data-mba-word`); identity only, the time stays `at` (R3). */
  word: z.number().int().min(0).optional(),
  /** `n` copies of the word behind it (offset down and along the reading direction, fading); see `ECHO`. */
  echo: z.number().int().min(0).max(4).default(0),
  /**
   * Kashida stretch (`stretchArabic`): the word's tatweel count rises from 0 to `to` with `expo.out`
   * over `duration` from `at`, held for `hold` (default: to the scene end) and then back to 0 over
   * `STRETCH_BACK_SEC` when `hold` is given. A word with no kashida slot is refused by `timingIssueOfKineticText`.
   */
  stretch: z
    .object({
      to: z.number().min(1).max(12),
      at: z.number().min(0),
      duration: z.number().min(0.1).max(3),
      hold: z.number().min(0).optional(),
    })
    .optional(),
  /** A line drawn through the word from the reading side over `STRIKE.sec`, from `at` (cue `tick`). */
  strike: z.object({ at: z.number().min(0), color: z.enum(['accent', 'fg']).optional() }).optional(),
  /** A rounded accent box behind the word (the word in the bg colour), drawn in from the reading side over `BOX.sec` at `at`. */
  box: z.boolean().optional(),
  /** A line in the accent colour drawn under the word from the reading side over `BOX.sec` at `at` (not with `box`). */
  underline: z.boolean().optional(),
  /** Overrides the stress punch peak scale of this word (Task 9 feeds it from the style DNA). */
  punch: z.number().min(1.1).max(1.5).optional(),
  /**
   * Plan 3 Task 7 (R20): `accent` draws the word in the accent colour with no punch and no shake
   * (the particle-word's target; a stressed word inside a shared line). Absent: fg (stress 2: accent).
   */
  color: z.enum(['accent']).optional(),
})

/** Params of `kinetic-text`. */
export const kineticTextParams = z
  .object({
    words: z.array(kineticWord).min(1, { message: 'words must have at least one word' }).max(16),
    /** `stack`: one word per row; `line`: the words on one (wrapping) line; `giant`: one word as big as the safe area allows. */
    mode: z.enum(['stack', 'line', 'giant']).default('stack'),
    /**
     * How an unstressed (stress 0) word enters. `slide` (the default, formerly named `rise`) slides
     * up 0.35 em and fades in. Plan 2a+: `rise` translates up 0.6 em out of a blur; `mask-line` lifts
     * the word out from under its row (the row clips it). Fix wave I4: `mask` is wiped in from the
     * reading side while it slides 0.3 em; `pop` scales up from 0.6 with a small overshoot. Stressed
     * words punch after `rise`/`mask-line`, and with the other entrances punch instead of entering.
     * Plan 3 Task 7 (R19): `fade` is opacity only over `FADE.sec` — no movement, no punch, no shake
     * (a particle-word hands over to its DOM word in place).
     */
    enter: z.enum(['slide', 'rise', 'mask-line', 'mask', 'pop', 'fade']).default('slide'),
    /**
     * Fix wave I4: the vertical centre of the text block as a fraction of the frame height (default:
     * the centre of the safe area; `giant`: `GIANT.y` of the safe height). Clamped so the block stays
     * inside the safe area.
     */
    y: z.number().min(0).max(1).optional(),
    /** Morph key (Task 8). */
    key: z.string().min(1).optional(),
    /** The largest font px tried (default 180; giant 900): kinetic typography beats go bigger. */
    maxPx: z.number().min(56).max(900).optional(),
    /** `out`: entrances ease out (default); `easy`: easy ease, eased in and out (sine). */
    ease: z.enum(['out', 'easy']).default('out'),
    /** The edge the block hugs: the centre (default) or the right / left edge of the safe area (a style pack's headline). */
    align: z.enum(['centre', 'right', 'left']).default('centre'),
  })
  .refine((p) => p.words.every((w) => !(w.box && w.underline)), { message: 'كلمة وحدة ما تاخذ صندوق وخط تحتها سوا — a word takes box or underline, not both', path: ['words'] })
  .refine((p) => p.mode !== 'giant' || p.words.length === 1, { message: 'mode "giant" takes exactly one word', path: ['words'] })

export type KineticTextParams = z.infer<typeof kineticTextParams>

export const KINETIC_TIMING = {
  /** Stress 0: slide + fade in over this long (s). */
  slideIn: 0.25,
  /** Stress 1/2: fade in over this long while the punch rises (s). */
  fadeIn: 0.06,
  /** Punch: rise to the peak scale, then settle back to 1 (s). */
  punchRise: 0.08,
  punchSettle: 0.3,
  /** Peak scale per stress level. */
  punch: { 0: 1, 1: 1.15, 2: 1.3 },
  /** Stress 2 camera shake: length (s), amplitude as a fraction of the frame width, keyframes. */
  shake: 0.12,
  shakeAmp: 0.015,
  shakeSteps: 5,
} as const

/** `giant`: the word's width (fraction of the safe width), height cap (fraction of the safe height), centre (fraction of the safe height) and the largest font px tried. */
export const GIANT = { width: 0.92, height: 0.5, y: 0.42, maxPx: 900 } as const
/** `rise` entrance: length (s), lift (em) and the starting blur (px). */
export const RISE = { sec: 0.28, lift: 0.6, blur: 6 } as const
/** `mask-line` entrance: length (s), the row's vertical padding (em, so ascenders and dots are not clipped), the start offset below the row (em). */
export const MASK = { sec: 0.3, pad: 0.25, from: 1.6 } as const
/** `fade` entrance (R19): opacity 0 → 1 over this long (s), the particle-word's `PARTICLE_WORD.fade`. */
export const FADE = { sec: 0.25 } as const
/** Echo copies: offset per copy (em, along the reading direction and down) and the first copy's opacity (copy k: opacity / k). */
export const ECHO = { dx: 0.06, dy: 0.05, opacity: 0.45 } as const
/** Strike line: length of the draw (s) and thickness (em). */
export const STRIKE = { sec: 0.25, thick: 0.08 } as const
/** Keyword box: length of the draw (s), corner radius and padding (em; vertical, horizontal). */
export const BOX = { sec: 0.2, radius: 0.12, padY: 0.1, padX: 0.25 } as const
/** A stretched word returns to its plain form over this long (s) when `hold` ends. */
export const STRETCH_BACK_SEC = 0.2

/**
 * Longest kinetic-text scene (local s) recipes should make. The whole-text drift (`DRIFT_PER_SEC` in
 * `drift.ts`) passes the audit's 1.15 rest scale (REST_SCALE_TOL) after 0.15 / DRIFT_PER_SEC
 * ≈ 12.5 s, after which the text no longer counts as at rest; cap kinetic-text scenes here.
 */
export const KINETIC_MAX_REST_SEC = 12

type Enter = KineticTextParams['enter']

/**
 * Scene-level check (`validateSceneParams`): every word must appear before the scene ends, i.e.
 * `at < sceneLen` where sceneLen = duration + preroll (local time); a word with `stretch` must have a
 * kashida slot. Returns the first offender.
 */
export function timingIssueOfKineticText(p: KineticTextParams, sceneLen: number) {
  const k = p.words.findIndex((w) => !(w.at < sceneLen))
  if (k >= 0) {
    const at = p.words[k]!.at
    return {
      path: ['words', k, 'at'],
      ar: `الكلمة «${p.words[k]!.text}» تظهر بعد نهاية المشهد`,
      en: `word appears at ${at} s, at or after the scene end (${sceneLen} s local, duration + preroll)`,
    }
  }
  const j = p.words.findIndex((w) => w.stretch && !isStretchable(w.text))
  if (j < 0) return undefined
  return {
    path: ['words', j, 'stretch'],
    ar: `الكلمة «${p.words[j]!.text}» لا تقبل التطويل`,
    en: 'word has no kashida slot; use mode "giant" or stress 2 instead',
  }
}

/** Entrance length of a word: `rise`/`mask-line`/`fade` have their own; otherwise the slide (stress 0) or the fade (stress 1/2). */
export const entranceOf = (w: { stress: 0 | 1 | 2 }, enter: Enter = 'slide'): number =>
  enter === 'rise' ? RISE.sec : enter === 'mask-line' ? MASK.sec : enter === 'fade' ? FADE.sec : w.stress === 0 ? KINETIC_TIMING.slideIn : KINETIC_TIMING.fadeIn

/**
 * R17: local time a word's entrance starts. Normally its `at`; a word whose `at` is earlier than
 * its entrance length enters early instead, ending at `at`, so it is fully visible at `at` (a word
 * at 0 shows on frame 0, the hook rule of Task 10).
 */
export function entranceStart(w: { at: number; stress: 0 | 1 | 2 }, enter: Enter = 'slide'): number {
  return earlyStart(w.at, entranceOf(w, enter))
}

/** Local time the punch of a stressed word starts: with its fade (V1 entrances) or after the `rise`/`mask-line` entrance. */
export function punchStart(w: { at: number; stress: 0 | 1 | 2 }, enter: Enter = 'slide'): number {
  return entranceStart(w, enter) + (enter === 'rise' || enter === 'mask-line' ? entranceOf(w, enter) : 0)
}

/** Peak scale of a word's punch: 1 for stress 0, else its `punch` or the stress level's peak. */
export const punchPeak = (w: { stress: 0 | 1 | 2; punch?: number | undefined }): number =>
  w.stress === 0 ? 1 : (w.punch ?? KINETIC_TIMING.punch[w.stress])

/** Sound cues of `kinetic-text`: one `action` per word as it appears, a `tick` at each strike, a `final` (chime) at each stretch. */
export function cuesOfKineticText(p: KineticTextParams, _ctx: { duration: number }): Cue[] {
  return p.words.flatMap((w): Cue[] => [
    { t: w.at, kind: 'action' },
    ...(w.strike ? [{ t: w.strike.at, kind: 'tick' as const }] : []),
    ...(w.stretch ? [{ t: w.stretch.at, kind: 'final' as const }] : []),
  ])
}
