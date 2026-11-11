import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * ui-morph — one shape that becomes every interface piece in turn: a button, a loader, a check, a
 * toggle, a slider, tabs, a chart card, a toast, a phone island. Its size, corners and colour follow a
 * spring into each state; the inside swaps under a short blur; a cursor clicks to cause each change.
 * Arabic labels, right-to-left controls.
 */
export const UI_STATES = ['button', 'loader', 'check', 'toggle', 'slider', 'tabs', 'chart', 'toast', 'island'] as const
export type UiState = (typeof UI_STATES)[number]

export const uiMorphParams = z.object({
  states: z
    .array(
      z.object({
        kind: z.enum(UI_STATES),
        /** Local s the shape starts becoming this state. */
        at: z.number().min(0),
        /** button / toast / island text; tabs: three labels separated by «،» or «,». */
        label: z.string().max(40).optional(),
        /** slider: the value it reaches (0–100). */
        value: z.number().min(0).max(100).optional(),
      }),
    )
    .min(1)
    .max(12)
    .refine((s) => s.every((x, i) => i === 0 || x.at > s[i - 1]!.at), { message: 'الأوقات تصاعدية — state times must increase' }),
  /** A cursor that clicks to cause each change. */
  cursor: z.boolean().default(true),
  /** Centre of the shape (safe-area fractions). */
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.45),
  /** Overall scale of the shapes. */
  scale: z.number().min(0.5).max(1.6).default(1.2),
})
export type UiMorphParams = z.infer<typeof uiMorphParams>

/** Each state's box (fractions of the safe width), corner radius (fraction of height) and fill. */
export const UI_BOX: Record<UiState, { w: number; h: number; r: number; fill: 'accent' | 'ink' | 'card' | 'ok' | 'black' }> = {
  button: { w: 0.56, h: 0.12, r: 0.5, fill: 'accent' },
  loader: { w: 0.16, h: 0.16, r: 0.5, fill: 'ink' },
  check: { w: 0.18, h: 0.18, r: 0.5, fill: 'ok' },
  toggle: { w: 0.32, h: 0.15, r: 0.5, fill: 'ink' },
  slider: { w: 0.7, h: 0.07, r: 0.5, fill: 'card' },
  tabs: { w: 0.8, h: 0.12, r: 0.5, fill: 'ink' },
  chart: { w: 0.68, h: 0.46, r: 0.1, fill: 'card' },
  toast: { w: 0.78, h: 0.14, r: 0.5, fill: 'ink' },
  island: { w: 0.82, h: 0.17, r: 0.5, fill: 'black' },
}

/**
 * A damped spring from 0 to 1 (pure, closed form): ζ = 0.62, ω = 15 rad/s — settles in about 0.4 s
 * with a small overshoot. 0 before u = 0.
 */
export function spring(u: number, zeta = 0.62, omega = 15): number {
  if (u <= 0) return 0
  const wd = omega * Math.sqrt(1 - zeta * zeta)
  return 1 - Math.exp(-zeta * omega * u) * (Math.cos(wd * u) + ((zeta * omega) / wd) * Math.sin(wd * u))
}

export const cuesOfUiMorph = (p: UiMorphParams): Cue[] => p.states.map((s) => ({ t: s.at, kind: 'tick' as const }))
