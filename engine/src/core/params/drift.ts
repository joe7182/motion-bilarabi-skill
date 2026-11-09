/**
 * Shared slow drift (Pro Pace: no static runs once content settles), used by six primitives:
 * `kinetic-text` (scale only), and `counter`, `checklist`, `icon`, `line-art` and `wipe-reveal`
 * (scale plus the seeded translate drift of R16). Pure in t: scale = 1 + rate · t, and the
 * translate travels at DRIFT_PX_PER_SEC along a seeded direction, turning back after `reach` px.
 *
 * Fitting (Task 7 fix round 4): content is laid out at its natural size, as without a drift. Only
 * when the content plus the drift would leave the safe area is the whole drifting container shrunk,
 * uniformly, by `driftFitScale` (folded into `driftCss`), so lines never rewrap for the drift. A
 * shrink below DRIFT_MIN_FIT_SCALE (full-width content in a long scene) lays the content out
 * again inside the smaller `driftFitBox` instead.
 */
export const DRIFT_PER_SEC = 0.012

/** Drift scale at local `t` (no drift before local 0) at `rate` per second. */
export const driftScale = (t: number, rate: number = DRIFT_PER_SEC): number => 1 + rate * Math.max(0, t)

/** Largest drift scale over a scene of `duration` s: content is fitted to the safe area / this. */
export const driftGrow = (duration: number, rate: number = DRIFT_PER_SEC): number => driftScale(duration, rate)

/**
 * R16: slow translate drift for content whose scale drift alone is under the review's static
 * threshold (counter, checklist): DRIFT_PX_PER_SEC px/s at a 1080 px wide frame, scaled with the
 * frame width, in a seeded direction. Measured: a 3 s counter registers from ~12 px/s (fix round 1).
 */
export const DRIFT_PX_PER_SEC = 12
export const DRIFT_REF_WIDTH = 1080
/**
 * Longest translate travel (px at DRIFT_REF_WIDTH, scaled with the frame width): 3 s of drift. A
 * longer scene turns back and forth along the same line at the same speed, so the room it needs
 * stays capped (a 10 s scene would otherwise need 2 × 120 px).
 */
export const DRIFT_MAX_PX = 36

export interface TranslateDrift {
  /** px/s along each axis (frame px). */
  vx: number
  vy: number
  /** Travel (px along the direction) before the drift turns back; unbounded when absent. */
  reach?: number
}

/** A translate drift with a direction drawn once from `rng` (build time) and speed scaled to `frameW`. */
export function translateDrift(rng: () => number, frameW: number): TranslateDrift {
  const k = frameW / DRIFT_REF_WIDTH
  const speed = DRIFT_PX_PER_SEC * k
  const a = rng() * 2 * Math.PI
  return { vx: speed * Math.cos(a), vy: speed * Math.sin(a), reach: DRIFT_MAX_PX * k }
}

/** Distance travelled along the direction after `dist` px of motion: 0 → reach → 0 → … (triangle). */
function along(dist: number, reach: number | undefined): number {
  if (reach === undefined || !(reach > 0)) return dist
  const m = dist % (2 * reach)
  return m <= reach ? m : 2 * reach - m
}

/** Offset (px) at local `t`: pure in t, 0 before local 0, never further than `reach` from 0. */
export function driftOffset(d: TranslateDrift, t: number): { x: number; y: number } {
  if (!(t > 0)) return { x: 0, y: 0 }
  if (d.reach === undefined) return { x: d.vx * t, y: d.vy * t }
  const speed = Math.hypot(d.vx, d.vy)
  if (!(speed > 0)) return { x: 0, y: 0 }
  const u = along(speed * t, d.reach) / speed
  return { x: d.vx * u, y: d.vy * u }
}

/**
 * Furthest offset (signed px per axis) the drift reaches within `duration` s; every offset in the
 * scene lies between 0 and this on each axis.
 */
export function driftExtent(d: TranslateDrift | undefined, duration: number): { x: number; y: number } {
  if (!d || !(duration > 0)) return { x: 0, y: 0 }
  const speed = Math.hypot(d.vx, d.vy)
  if (!(speed > 0)) return { x: 0, y: 0 }
  const u = Math.min(speed * duration, d.reach ?? Infinity) / speed
  return { x: d.vx * u, y: d.vy * u }
}

/**
 * The box content may be fitted to inside `box` so that, after both drifts over `duration` s, it
 * stays inside `box` wherever it sits: room for the (capped) translate on each side, then divided
 * by the scale growth. Used only when the content at its natural size would leave the safe area.
 */
export function driftFitBox(box: { w: number; h: number }, duration: number, rate: number, d?: TranslateDrift): { w: number; h: number } {
  const grow = driftGrow(duration, rate)
  const e = driftExtent(d, duration)
  return { w: Math.floor(Math.max(1, box.w - 2 * Math.abs(e.x)) / grow), h: Math.floor(Math.max(1, box.h - 2 * Math.abs(e.y)) / grow) }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The uniform shrink a drifting container needs (fix round 4): the largest k ≤ 1 such that
 * content with untransformed extents `content`, scaled by k · driftScale(t) about `origin` and then
 * offset by the translate, stays inside `safe` on every frame of a `duration` s scene. 1 when the
 * content already leaves room for the drift. The scale only grows and every offset lies between 0
 * and `driftExtent`, so the scene end bounds every frame. `tol` px of slack absorbs sub-pixel layout.
 */
export function driftFitScale(
  content: Rect,
  safe: Rect,
  origin: { x: number; y: number },
  duration: number,
  rate: number,
  d?: TranslateDrift,
  tol: number = 0.5,
): number {
  const grow = driftGrow(duration, rate)
  const e = driftExtent(d, duration)
  // Room between the origin (moved by the offset) and the safe edge, over the content's reach.
  const room = (space: number, reach: number) => (reach > 0 ? space / (reach * grow) : Infinity)
  const k = Math.min(
    1,
    room(origin.x - Math.max(0, -e.x) - (safe.x - tol), origin.x - content.x),
    room(safe.x + safe.w + tol - origin.x - Math.max(0, e.x), content.x + content.w - origin.x),
    room(origin.y - Math.max(0, -e.y) - (safe.y - tol), origin.y - content.y),
    room(safe.y + safe.h + tol - origin.y - Math.max(0, e.y), content.y + content.h - origin.y),
  )
  return Math.max(0, k)
}

/**
 * Below this uniform shrink a drifting container is laid out again inside `driftFitBox` instead,
 * so k · driftScale stays above the audit's 0.85 rest scale (1 − REST_SCALE_TOL). Full-width
 * content in a scene of up to ~4 s (k ≥ 0.877 at 9:16) keeps its natural layout.
 */
export const DRIFT_MIN_FIT_SCALE = 0.87

/**
 * The drift as a CSS transform, its scale times `fit` (driftFitScale): translate to 0.01 px, scale
 * to 4 decimals. The fixed precision only keeps the string short and free of exponents (`1e-7px`);
 * it is not what makes frames deterministic. The cold/warm `mba verify` mismatch first blamed on an unrounded scale (fix
 * round 3) came from hidden scene layers left in paint, fixed in the stage (fix round 4).
 */
export function driftCss(t: number, rate: number = DRIFT_PER_SEC, d?: TranslateDrift, fit: number = 1): string {
  const s = (fit * driftScale(t, rate)).toFixed(4)
  if (!d) return `scale(${s})`
  const o = driftOffset(d, t)
  return `translate(${o.x.toFixed(2)}px, ${o.y.toFixed(2)}px) scale(${s})`
}
