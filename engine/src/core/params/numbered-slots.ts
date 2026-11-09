import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { easeOutCubic, seg } from '../ease'
import { morphKey, oneLine } from './common'
import { safePoint } from './line-art'

/**
 * Params of `numbered-slots` (Stage 1B): `count` numbered cards in a row («ثلاث أخطاء») that a video
 * comes back to. Slot indices are 0-based: index 0 is slot «١», the RIGHTMOST card (RTL order).
 */
export const numberedSlotsParams = z
  .object({
    count: z
      .number()
      .int()
      .min(2, { message: 'عدد الخانات من ٢ إلى ٥ — count must be 2..5' })
      .max(5, { message: 'عدد الخانات من ٢ إلى ٥ — count must be 2..5' }),
    /** One short label per slot, shown under its numeral. */
    labels: z.array(oneLine(14, 'label')).optional(),
    digits: z.enum(['arabic', 'latin']).default('arabic'),
    /** Centre of the row in the safe area. */
    at: safePoint.default({ x: 0.5, y: 0.5 }),
    /** Row width as a fraction of the safe width (the active card's 1.08 scale still fits at 0.95). */
    width: z.number().min(0.3).max(0.95).default(0.8),
    /** Scene s each slot pops in (default slot i at i × NUMBERED_SLOTS.stagger). */
    appear: z.array(z.number().finite().min(0)).optional(),
    /** Index of a slot drawn locked (padlock over a dark card, numeral blurred). */
    locked: z.number().int().min(0).optional(),
    /** Scene s the locked slot opens: shackle snaps, lock drops, card flashes accent, numeral shows. */
    unlockAt: z.number().finite().min(0).optional(),
    /** From `at`, the slot at `index` is highlighted (accent, ×1.08) and the others dim to 45 %. */
    active: z
      .array(z.object({ at: z.number().finite().min(0), index: z.number().int().min(0) }))
      .max(12, { message: 'تغييرات التمييز لا تزيد عن ١٢ — active has at most 12 entries' })
      .default([]),
    key: morphKey,
  })
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    if (p.labels && p.labels.length !== p.count) {
      issue(['labels'], `عدد التسميات يساوي عدد الخانات (${p.count}) — labels must have exactly count (${p.count}) entries`)
    }
    if (p.appear && p.appear.length !== p.count) {
      issue(['appear'], `عدد أوقات الظهور يساوي عدد الخانات (${p.count}) — appear must have exactly count (${p.count}) entries`)
    }
    if (p.locked !== undefined && p.locked >= p.count) {
      issue(['locked'], `الخانة المقفلة خارج الصف (٠ إلى ${p.count - 1}) — locked must be a slot index 0..${p.count - 1}`)
    }
    if (p.unlockAt !== undefined && p.locked === undefined) {
      issue(['unlockAt'], 'وقت الفتح يحتاج خانة مقفلة (locked) — unlockAt needs a locked slot')
    }
    if (p.unlockAt !== undefined && p.locked !== undefined && p.locked < p.count && p.unlockAt < slotAppearAt(p, p.locked)) {
      issue(['unlockAt'], 'الفتح قبل ظهور الخانة — unlockAt must be no earlier than the locked slot appears')
    }
    p.active.forEach((a, k) => {
      if (a.index >= p.count) issue(['active', k, 'index'], `الخانة خارج الصف (٠ إلى ${p.count - 1}) — index must be 0..${p.count - 1}`)
      if (k > 0 && a.at < p.active[k - 1]!.at) issue(['active', k, 'at'], 'أوقات التمييز مرتبة تصاعديًا — active must be in ascending order of at')
    })
  })

export type NumberedSlotsParams = z.infer<typeof numberedSlotsParams>

export const NUMBERED_SLOTS = {
  /** Gap between cards (× card side). */
  gap: 0.16,
  /** Default appear stagger (s). */
  stagger: 0.12,
  /** A slot pops from `popFrom` scale over `popSec` (soft spring), fading in over `fadeSec`. */
  popSec: 0.45,
  popFrom: 0.55,
  fadeSec: 0.16,
  /** Card corner radius (× side), numeral size (× side). */
  radius: 0.2,
  numeral: 0.6,
  /** Label: `labelGap` (× side) under the card, font `labelRatio` × side within [min, max] px at 1080. */
  labelGap: 0.12,
  labelRatio: 0.17,
  labelMinPx: 32,
  labelMaxPx: 52,
  /** Active: scale and the others' opacity; changes ease over `activeSec`. */
  activeScale: 1.08,
  dim: 0.45,
  activeSec: 0.28,
  /** Locked card colour and its numeral's blur (× side) and opacity. */
  lockedBg: '#1d1b19',
  lockFg: '#f3efe7',
  lockedBlur: 0.06,
  lockedNumeral: 0.3,
  /** Padlock size (× side). */
  lockSize: 0.5,
  /** Unlock beats after `unlockAt` (s): shackle snaps open, then the lock drops and fades. */
  shackleSec: 0.16,
  dropFrom: 0.12,
  dropSec: 0.5,
  /** The card flashes accent: up by `flashPeak`, back to the surface by `flashEnd`. */
  flashPeak: 0.12,
  flashEnd: 0.7,
  /** The numeral clears from `revealFrom` over `revealSec`. */
  revealFrom: 0.14,
  revealSec: 0.3,
} as const

/** Scene s slot `i` pops in. */
export function slotAppearAt(p: Pick<NumberedSlotsParams, 'appear'>, i: number): number {
  return p.appear?.[i] ?? i * NUMBERED_SLOTS.stagger
}

/** The numeral of slot `i` (1-based number), in the chosen digits: «١» / "1". */
export function slotNumeral(p: Pick<NumberedSlotsParams, 'digits'>, i: number): string {
  const s = String(i + 1)
  return p.digits === 'arabic' ? [...s].map((c) => '٠١٢٣٤٥٦٧٨٩'[Number(c)]).join('') : s
}

/** The active index at local `t` (undefined before the first `active` entry). */
export function activeIndexAt(p: Pick<NumberedSlotsParams, 'active'>, t: number): number | undefined {
  let idx: number | undefined
  for (const a of p.active) if (t >= a.at) idx = a.index
  return idx
}

/**
 * Per-slot highlight (0..1) and dim (0..1) at local `t`: each `active` change eases (easeOutCubic,
 * `activeSec`) from the previous targets to the new ones (highlight 1 on `index`, dim 1 on the rest).
 */
export function slotEmphasis(p: Pick<NumberedSlotsParams, 'active' | 'count'>, i: number, t: number): { hl: number; dim: number } {
  let hl = 0
  let dim = 0
  let prevHl = 0
  let prevDim = 0
  for (const a of p.active) {
    const th = a.index === i ? 1 : 0
    const td = a.index === i ? 0 : 1
    const x = easeOutCubic(seg(t, a.at, a.at + NUMBERED_SLOTS.activeSec))
    hl += (th - prevHl) * x
    dim += (td - prevDim) * x
    prevHl = th
    prevDim = td
  }
  return { hl, dim }
}

/** Scene-level check: every appear / unlock / active time lies inside the scene. */
export function timingIssueOfNumberedSlots(p: NumberedSlotsParams, sceneLen: number) {
  for (let i = 0; i < p.count; i++) {
    const a = slotAppearAt(p, i)
    if (a >= sceneLen) {
      return {
        path: p.appear ? ['appear', i] : ['count'],
        ar: `الخانة ${i + 1} تظهر بعد نهاية المشهد (${sceneLen} ث)`,
        en: `slot ${i + 1} appears at ${a} s, at or past the scene end (${sceneLen} s local)`,
      }
    }
  }
  if (p.unlockAt !== undefined && p.unlockAt >= sceneLen) {
    return { path: ['unlockAt'], ar: `الفتح بعد نهاية المشهد (${sceneLen} ث)`, en: `unlockAt ${p.unlockAt} s is at or past the scene end (${sceneLen} s local)` }
  }
  const k = p.active.findIndex((a) => a.at >= sceneLen)
  if (k >= 0) {
    return { path: ['active', k, 'at'], ar: `التمييز بعد نهاية المشهد (${sceneLen} ث)`, en: `active[${k}] at ${p.active[k]!.at} s is at or past the scene end (${sceneLen} s local)` }
  }
  return undefined
}

/** Sound cues: a `pop` per slot as it appears, a `hit` on the unlock, an `action` per active change. */
export function cuesOfNumberedSlots(p: NumberedSlotsParams, _ctx: { duration: number }): Cue[] {
  const out: Cue[] = []
  for (let i = 0; i < p.count; i++) out.push({ t: slotAppearAt(p, i), kind: 'pop' })
  if (p.unlockAt !== undefined) out.push({ t: p.unlockAt, kind: 'hit' })
  for (const a of p.active) out.push({ t: a.at, kind: 'action' })
  return out.sort((a, b) => a.t - b.t)
}
