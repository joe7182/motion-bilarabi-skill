import { z } from 'zod'

/** A single non-blank line of 1..`max` code points (Task 9 devices). */
export function oneLine(max: number, field = 'text') {
  return z
    .string()
    .refine((t) => [...t].length >= 1 && [...t].length <= max, { message: `${field} must be 1..${max} characters` })
    .refine((t) => t.trim().length > 0, { message: `${field} must not be blank` })
    .refine((t) => !/[\r\n]/.test(t), { message: `${field} must be a single line` })
}

/**
 * R17: local time an entrance of length `len` starts for something due at `at`. Normally `at`; an
 * `at` earlier than `len` starts early instead, ending at `at` (fully in on frame 0 for `at` = 0).
 */
export const earlyStart = (at: number, len: number): number => (at < len ? at - len : at)

/** Morph key (Task 8). */
export const morphKey = z.string().min(1).optional()

/**
 * A project image: a path relative to the storyboard or a data URL (inlined at load by the
 * renderer, like `profile-card.avatar`; remote URLs are refused there).
 */
export const imageSrc = z.string().min(1, { message: 'مسار الصورة فارغ — image must be a file path or a data URL' })

/**
 * The «layers» primitives' entrance curve: an ease-out with a tiny overshoot (≈ 3 %, easeOutBack
 * s = 0.9). 0 at x ≤ 0, exactly 1 at x ≥ 1.
 */
export function settle(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const u = x - 1
  return 1 + 1.9 * u * u * u + 0.9 * u * u
}

/**
 * Eased emphasis of item `key` from a list of `{ at, key }` changes (ascending `at`): each change
 * eases (easeOutCubic over `sec`) from the previous target to the new one (1 on the chosen key, 0
 * elsewhere). `hl` = this item is the chosen one, `dim` = another one is. Pure in `t`.
 */
export function emphasisAt<K>(changes: readonly { at: number; key: K }[], key: K, t: number, sec: number): { hl: number; dim: number } {
  let hl = 0
  let dim = 0
  let prevHl = 0
  let prevDim = 0
  for (const c of changes) {
    const th = c.key === key ? 1 : 0
    const td = 1 - th
    const p = sec <= 0 ? (t >= c.at ? 1 : 0) : Math.min(Math.max((t - c.at) / sec, 0), 1)
    const x = 1 - (1 - p) ** 3
    hl += (th - prevHl) * x
    dim += (td - prevDim) * x
    prevHl = th
    prevDim = td
  }
  return { hl, dim }
}

/** `{ at, index }` beats (focus / strike / active), at most `max`, in ascending order of `at`. */
export function indexBeats(max: number, what: string) {
  return z
    .array(z.object({ at: z.number().finite().min(0), index: z.number().int().min(0) }))
    .max(max, { message: `لا يزيد عن ${max} — ${what}: at most ${max} entries` })
    .default([])
}

/** `oneLine` with Arabic-first bilingual messages (the «layers» primitives). */
export function oneLineAr(max: number, field = 'text') {
  return z
    .string()
    .refine((t) => [...t].length >= 1 && [...t].length <= max, { message: `النص من 1 إلى ${max} حرفًا — ${field} must be 1..${max} characters` })
    .refine((t) => t.trim().length > 0, { message: `النص فارغ — ${field} must not be blank` })
    .refine((t) => !/[\r\n]/.test(t), { message: `سطر واحد فقط — ${field} must be a single line` })
}

/** A number in [min, max] with an Arabic-first bilingual range message. */
export function rangeAr(min: number, max: number, field: string) {
  const message = `القيمة من ${min} إلى ${max} — ${field} must be ${min}..${max}`
  return z.number({ message }).min(min, { message }).max(max, { message })
}

/** A non-empty id / reference with an Arabic-first bilingual message. */
export const idAr = (field: string) => z.string().min(1, { message: `المعرّف فارغ — ${field} must not be empty` })
