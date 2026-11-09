/**
 * Easing curves for `update(localT)` code: pure functions of a progress x in [0, 1]
 * (0 -> 0, 1 -> 1). Build x with `seg(t, a, b)`; the curves themselves do not clamp.
 */

export const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x)

/** Progress of `t` through [a, b], clamped to [0, 1]. A zero-length segment is a step at `a`. */
export function seg(t: number, a: number, b: number): number {
  if (b === a) return t >= a ? 1 : 0
  return clamp01((t - a) / (b - a))
}

export const easeInCubic = (x: number): number => x * x * x

export const easeOutCubic = (x: number): number => 1 - (1 - x) ** 3

export const easeInOutCubic = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
/** After Effects «Easy Ease» (both ends eased, no overshoot): sine in-out, ≈ cubic-bezier(0.37, 0, 0.63, 1). */
export const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * Math.min(1, Math.max(0, x))) - 1) / 2

export const easeInExpo = (x: number): number => (x <= 0 ? 0 : 2 ** (10 * x - 10))

export const easeOutExpo = (x: number): number => (x >= 1 ? 1 : 1 - 2 ** (-10 * x))

/** Overshoots past 1 and settles back; `s` sets the overshoot (default 1.7). */
export function easeOutBack(x: number, s = 1.7): number {
  const u = x - 1
  return 1 + (s + 1) * u * u * u + s * u * u
}
