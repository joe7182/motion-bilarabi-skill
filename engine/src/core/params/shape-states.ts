import { z } from 'zod'
import type { Cue } from '../audio-plan'
import type { Spring } from '../springs'
import { morphKey, oneLine } from './common'
import { moveProgress } from './hero'
import { safePoint } from './line-art'

export const SHAPE_KINDS = ['button', 'pill', 'toggle', 'chip', 'card', 'window', 'check'] as const
export type ShapeKind = (typeof SHAPE_KINDS)[number]

const shapeState = z.object({
  /** Scene-local s at which the shape IS this state (the first state: when it is fully in). */
  at: z.number().min(0),
  kind: z.enum(SHAPE_KINDS),
  /** A whole word/line shown inside (not on `toggle` / `check`, which are glyph-only). */
  label: oneLine(24, 'label').optional(),
  /** `toggle` only: the knob is at the reading-end side (left in RTL). */
  on: z.boolean().optional(),
})

/** Params of `shape-states`: one shape that springs through UI states, a fake cursor clicking each change. */
export const shapeStatesParams = z
  .object({
    states: z
      .array(shapeState)
      .min(2, { message: 'الحالات لا تقل عن حالتين — states needs at least 2 entries' })
      .max(8, { message: 'الحالات لا تزيد عن ٨ — states has at most 8 entries' }),
    /** Centre of the shape in the safe area (default: its centre). */
    at: safePoint.optional(),
    /** The widest state's share of the safe width. */
    size: z.number().min(0.3).max(0.9).default(0.6),
    cursor: z.boolean().default(true),
    /** `snappy` (ζ 0.7, ω 16) or `soft` (ζ 0.9, ω 9). */
    spring: z.enum(['soft', 'snappy']).default('snappy'),
    key: morphKey,
  })
  .superRefine((p, ctx) => {
    for (let k = 1; k < p.states.length; k++) {
      if (!(p.states[k]!.at > p.states[k - 1]!.at)) {
        ctx.addIssue({
          code: 'custom',
          path: ['states', k, 'at'],
          message: `at الحالة ${k} يجب أن يكبر عن السابقة — states[${k}].at must be greater than states[${k - 1}].at`,
        })
        return
      }
    }
  })

export type ShapeStatesParams = z.infer<typeof shapeStatesParams>

/** Width, height and corner radius of each kind: fractions of `size × safe width`; `r` × min(w, h) is the radius. */
export const STATE_GEOMETRY: Record<ShapeKind, { w: number; h: number; r: number }> = {
  button: { w: 0.55, h: 0.14, r: 0.5 },
  pill: { w: 0.4, h: 0.1, r: 1 },
  toggle: { w: 0.18, h: 0.1, r: 1 },
  chip: { w: 0.3, h: 0.08, r: 1 },
  card: { w: 1, h: 0.55, r: 0.06 },
  window: { w: 1, h: 0.65, r: 0.04 },
  check: { w: 0.14, h: 0.14, r: 1 },
}

export const SHAPE_STATES = {
  /** A transition to a state starts this long before its `at`, so the shape is the state at `at` (s). */
  lead: 0.3,
  /** The label cross-fade (s), ending at the state's `at`, under a blur of `blurPx`. */
  fadeSec: 0.12,
  blurPx: 4,
  /** The first state fades in over this long, ending at its `at` (s). */
  enterSec: 0.3,
  /** The cursor starts gliding in `cursorIn` s before `at`, arrives `cursorGlideEnd` s before it, presses `pressAt` s before it, and fades out `cursorOut` s after it. */
  cursorIn: 0.45,
  cursorGlideEnd: 0.15,
  pressAt: 0.15,
  pressSec: 0.12,
  cursorOut: [0.1, 0.3],
  /** The chime of a `check` follows the tap by this long (s). */
  chimeDelay: 0.1,
  /** The window's title bar height, as a fraction of `size × safe width`. */
  bar: 0.09,
} as const

/** The two springs, as `springs.ts` springs (response = 2π / ω). */
export const SHAPE_SPRINGS: Record<ShapeStatesParams['spring'], Spring> = {
  snappy: { response: (2 * Math.PI) / 16, damping: 0.7 },
  soft: { response: (2 * Math.PI) / 9, damping: 0.9 },
}

/** What a state looks like, all blendable numbers; w, h, radius in fractions of `size × safe width`. */
export interface ShapeLook {
  w: number
  h: number
  radius: number
  /** Accent / foreground-wash / border strength, 0..100 (%). */
  accent: number
  fill: number
  border: number
  /** Weights 0..1 of the toggle knob, the window's title bar and the check's tick. */
  knob: number
  bar: number
  tick: number
  /** Knob position: 0 = reading start (right), 1 = reading end (left). */
  pos: number
}

const PAINT: Record<ShapeKind, { accent: number; fill: number; border: number }> = {
  button: { accent: 100, fill: 0, border: 0 },
  pill: { accent: 0, fill: 14, border: 22 },
  toggle: { accent: 0, fill: 22, border: 0 },
  chip: { accent: 0, fill: 8, border: 30 },
  card: { accent: 0, fill: 7, border: 16 },
  window: { accent: 0, fill: 5, border: 24 },
  check: { accent: 100, fill: 0, border: 0 },
}

/** The resting look of every state. */
export function stateLooks(p: Pick<ShapeStatesParams, 'states'>): ShapeLook[] {
  let pos = 0
  return p.states.map((s) => {
    const g = STATE_GEOMETRY[s.kind]
    const paint = { ...PAINT[s.kind] }
    if (s.kind === 'toggle') {
      pos = s.on ? 1 : 0
      if (s.on) Object.assign(paint, { accent: 100, fill: 0 })
    }
    return {
      w: g.w,
      h: g.h,
      radius: g.r * Math.min(g.w, g.h),
      ...paint,
      knob: s.kind === 'toggle' ? 1 : 0,
      bar: s.kind === 'window' ? 1 : 0,
      tick: s.kind === 'check' ? 1 : 0,
      pos,
    }
  })
}

/** The move into state k starts this long before its `at` (the gap since the previous state caps it). */
export const leadOf = (p: Pick<ShapeStatesParams, 'states'>, k: number): number =>
  Math.min(SHAPE_STATES.lead, p.states[k]!.at - p.states[k - 1]!.at)

/**
 * The shape at scene-local `t`, a pure closed-form function of t: the first state's look plus, for
 * every later state, the change into it times `moveProgress` (the spring step corrected to be
 * exactly 1 at the state's `at`). So at each `at` the shape is exactly that state; in between it
 * overshoots like the spring.
 */
export function shapeAt(p: Pick<ShapeStatesParams, 'states' | 'spring'>, t: number): ShapeLook {
  const ls = stateLooks(p)
  const spring = SHAPE_SPRINGS[p.spring]
  const out = { ...ls[0]! }
  for (let k = 1; k < ls.length; k++) {
    const lead = leadOf(p, k)
    const m = moveProgress(t - (p.states[k]!.at - lead), lead, spring)
    for (const key of Object.keys(out) as (keyof ShapeLook)[]) out[key] += (ls[k]![key] - ls[k - 1]![key]) * m
  }
  return out
}

/** Sound: a `tap` as the shape lands in every state after the first; a `check` adds a `chime` just after. */
export function cuesOfShapeStates(p: ShapeStatesParams, _ctx: { duration: number }): Cue[] {
  return p.states.slice(1).flatMap((s): Cue[] => [
    { t: s.at, kind: 'action' },
    ...(s.kind === 'check' ? [{ t: s.at + SHAPE_STATES.chimeDelay, kind: 'final' as const }] : []),
  ])
}

/** A state at or after the scene end (local time, duration + preroll) would never show. */
export function timingIssueOfShapeStates(p: ShapeStatesParams, sceneLen: number) {
  const k = p.states.findIndex((s) => !(s.at < sceneLen))
  if (k < 0) return undefined
  return {
    path: ['states', k, 'at'],
    ar: `الحالة ${k} تأتي بعد نهاية المشهد`,
    en: `state ${k} is at ${p.states[k]!.at} s, at or after the scene end (${sceneLen} s local, duration + preroll)`,
  }
}
