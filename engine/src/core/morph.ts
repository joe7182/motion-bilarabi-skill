/**
 * Morph geometry: closed outlines as fixed-size point rings, so any outline can be blended with any
 * other point by point. Everything here is a pure function (no state, no time).
 *
 * Coordinates are screen coordinates (y grows downwards). "Clockwise" is as seen on screen.
 */

/** A 2D point. */
export type Pt = [number, number]

/** Number of points in every morphable outline. */
export const MORPH_N = 240

/** Corner arc resolution for `roundRect` before it is resampled. */
const CORNER_STEPS = 24

/** Indexed read that stays in range by construction (the project compiles with noUncheckedIndexedAccess). */
function at<T>(a: readonly T[], i: number): T {
  return a[i] as T
}

/** Signed shoelace area; positive = clockwise on screen (y down). */
function signedArea(pts: Pt[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = at(pts, i)
    const q = at(pts, (i + 1) % pts.length)
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

/**
 * Resample a closed polyline to `n` points equally spaced by arc length. The ring is made clockwise
 * and starts at 12 o'clock: where the vertical ray up from the bounding-box centre meets the outline
 * (the vertex nearest to straight up when the centre lies outside the shape).
 */
export function resample(pts: Pt[], n: number = MORPH_N): Pt[] {
  if (pts.length < 2) throw new Error(`نقاط المسار أقل من اللازم — a closed outline needs at least 2 points, got ${pts.length}`)
  if (!Number.isInteger(n) || n < 3) throw new Error(`عدد النقاط غير صالح — n must be an integer ≥ 3, got ${n}`)
  const ring: Pt[] = signedArea(pts) < 0 ? [...pts].reverse() : [...pts]
  const m = ring.length
  // cumulative arc length at each vertex (closed: the last segment returns to the first vertex)
  const cum: number[] = [0]
  for (let i = 0; i < m; i++) {
    const p = at(ring, i)
    const q = at(ring, (i + 1) % m)
    cum.push(at(cum, i) + Math.hypot(q[0] - p[0], q[1] - p[1]))
  }
  const total = at(cum, m)
  if (!(total > 0)) throw new Error('المسار بلا طول — the outline has zero length')

  // 12 o'clock start: arc length of the topmost crossing of the vertical line through the box centre
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of ring) {
    if (p[0] < minX) minX = p[0]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[1] > maxY) maxY = p[1]
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  let start = -1
  let bestY = Infinity
  for (let i = 0; i < m; i++) {
    const p = at(ring, i)
    const q = at(ring, (i + 1) % m)
    const ci = at(cum, i)
    if (p[0] === q[0]) {
      if (p[0] !== cx) continue
      const y = Math.min(p[1], q[1])
      if (y <= cy && y < bestY) { bestY = y; start = ci + Math.abs(y - p[1]) }
      continue
    }
    if ((p[0] - cx) * (q[0] - cx) > 0) continue
    const k = (cx - p[0]) / (q[0] - p[0])
    const y = p[1] + k * (q[1] - p[1])
    if (y <= cy && y < bestY) { bestY = y; start = ci + k * (at(cum, i + 1) - ci) }
  }
  if (start < 0) {
    // centre outside the shape: take the vertex with the smallest angle from straight up
    let best = Infinity
    for (let i = 0; i < m; i++) {
      const v = at(ring, i)
      let d = Math.atan2(v[1] - cy, v[0] - cx) + Math.PI / 2
      d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))
      if (d < best) { best = d; start = at(cum, i) }
    }
  }

  const out: Pt[] = []
  let seg = 0
  for (let k = 0; k < n; k++) {
    let s = (start + (k * total) / n) % total
    if (s < 0) s += total
    // walk forward from the previous segment; restart once when the walk wraps past the end
    if (s < at(cum, seg)) seg = 0
    while (seg < m - 1 && at(cum, seg + 1) <= s) seg++
    const len = at(cum, seg + 1) - at(cum, seg)
    const u = len > 0 ? (s - at(cum, seg)) / len : 0
    const p = at(ring, seg)
    const q = at(ring, (seg + 1) % m)
    out.push([p[0] + u * (q[0] - p[0]), p[1] + u * (q[1] - p[1])])
  }
  return out
}

/** A circle as `n` points, first at 12 o'clock, clockwise. */
export function circle(cx: number, cy: number, r: number, n: number = MORPH_N): Pt[] {
  const out: Pt[] = []
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return out
}

/** A rounded rectangle (corner radius clamped to half the shorter side) as `n` points. */
export function roundRect(cx: number, cy: number, w: number, h: number, r: number, n: number = MORPH_N): Pt[] {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2
  const dense: Pt[] = []
  // corners clockwise from top-right: arc centre + start angle
  const corners: [number, number, number][] = [
    [x1 - rr, y0 + rr, -Math.PI / 2],
    [x1 - rr, y1 - rr, 0],
    [x0 + rr, y1 - rr, Math.PI / 2],
    [x0 + rr, y0 + rr, Math.PI],
  ]
  for (const [ox, oy, a0] of corners) {
    if (rr === 0) { dense.push([ox, oy]); continue }
    for (let i = 0; i <= CORNER_STEPS; i++) {
      const a = a0 + (Math.PI / 2) * (i / CORNER_STEPS)
      dense.push([ox + rr * Math.cos(a), oy + rr * Math.sin(a)])
    }
  }
  return resample(dense, n)
}

/** Point-by-point blend of two outlines (u = 0 gives `a`, u = 1 gives `b`; u is not clamped). */
export function lerpPts(a: Pt[], b: Pt[], u: number): Pt[] {
  if (a.length !== b.length) {
    throw new Error(`عدد النقاط غير متطابق — point arrays must have the same length (${a.length} vs ${b.length})`)
  }
  const out: Pt[] = []
  for (let i = 0; i < a.length; i++) {
    const p = at(a, i)
    const q = at(b, i)
    out.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u])
  }
  return out
}
