/**
 * The one-world camera (Plan 2a+ Task 6): every scene layer on a track that is not fixed sits in
 * one world (`#mba-world`), and the camera moves that world as a whole: pans to a frame-fraction
 * point and zooms on it. Tracks in `fixedTracks` (default 0, the backdrop, and 5, the HUD) are not
 * under the camera. Pure (no DOM): the stage writes `cameraTransform(cameraAt(c, t), size)` on the
 * world wrapper on every seek.
 *
 * Plan 3 Task 4, the living camera: an optional handheld drift (`handheld`) and decaying hit shakes
 * (`shakes`) add a screen-space jitter (`cameraJitter`: a translation and a small rotation about
 * the frame centre) on top of the keyed pose, and a scene's `depth` (0..3, default 1) scales how
 * far its layer follows the camera (`poseAtDepth`, jitter × depth): parallax. Fixed tracks get
 * neither. Without `handheld`/`shakes` the jitter is exactly 0 and every transform string is the
 * one from before.
 */

/** One camera key: from `at` (absolute seconds; a word or pause anchor in the file) the camera centres on (`x`, `y`) at `zoom`. */
export interface CameraKey {
  at: number
  /** Frame-fraction point the camera centres on (default 0.5, 0.5). */
  x: number
  y: number
  /** 0.5..CAMERA.maxZoom. Interpolated in log space. */
  zoom: number
  /** How the camera arrives at this key from the previous one: `smooth` (default, smoothstep) or `linear`. */
  ease?: 'linear' | 'smooth'
}

export interface CameraSpec {
  /** At least one key, sorted by `at`. */
  keys: CameraKey[]
  /** Tracks not under the camera (default [0, 5]: the backdrop and the HUD). */
  fixedTracks?: number[]
  /** Plan 3: a slow handheld drift over the whole video; `amp` 0..3 (default 1 when the object is given). */
  handheld?: { amp: number }
  /** Plan 3: decaying shakes on hits; `at` absolute seconds (a word or pause anchor in the file), `amp` 0..30 px. */
  shakes?: { at: number; amp: number }[]
}

/** The camera's screen-space jitter at a time: frame px and radians (rotation about the frame centre). */
export interface CameraJitter {
  dx: number
  dy: number
  rot: number
}

export const CAMERA = {
  minZoom: 0.5,
  maxZoom: 3,
  /** Tracks not under the camera when `fixedTracks` is not given. */
  fixedTracks: [0, 5] as readonly number[],
  /** Largest `handheld.amp`. */
  maxHandheld: 3,
  /** Largest shake `amp` (px). */
  maxShake: 30,
  /** Largest scene `depth` (0..maxDepth; absent = 1). */
  maxDepth: 3,
  /** The handheld drift's period (s): φ = 2πt / handheldPeriod. */
  handheldPeriod: 25,
  /** A shake acts over [at, at + shakeWindow) s. */
  shakeWindow: 0.7,
} as const

export interface CameraPose {
  x: number
  y: number
  zoom: number
}

const smoothstep = (u: number): number => u * u * (3 - 2 * u)

/**
 * The camera at absolute time `t`: holds the first key before it and the last key after it;
 * between two keys `x`, `y` interpolate linearly on the eased parameter (the later key's `ease`)
 * and `zoom` interpolates in log space, `exp(lerp(log z0, log z1, e))`, so a zoom reads as a
 * constant rate. Keys sharing an `at` cut: the later one holds from that time on.
 */
export function cameraAt(c: CameraSpec, t: number): CameraPose {
  const keys = c.keys
  const pose = (k: CameraKey): CameraPose => ({ x: k.x, y: k.y, zoom: k.zoom })
  const first = keys[0]
  if (!first) throw new Error('cameraAt: at least one key is required')
  if (!(t > first.at)) return pose(first)
  // The last key at or before t, then the next one strictly after it.
  let i = 0
  while (i + 1 < keys.length && keys[i + 1]!.at <= t) i++
  const a = keys[i]!
  const b = keys[i + 1]
  if (!b) return pose(a)
  const u = (t - a.at) / (b.at - a.at)
  const e = b.ease === 'linear' ? u : smoothstep(u)
  return {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
    zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * e),
  }
}

const TAU = 2 * Math.PI

/**
 * The jitter at absolute time `t` (pure): the handheld drift, φ = 2πt/25,
 * `dx = amp·(7·sin(2φ+1.3) + 3·sin(5φ+0.2))`, `dy = amp·6·sin(3φ+0.4)`, `rot = amp·0.0024·sin(2φ+2.1)`;
 * plus every shake k (its index) with d = t − at in [0, 0.7): `env = amp·e^(−9d)`,
 * `dx += env·sin(2π·14d + k)`, `dy += 0.8·env·sin(2π·18.5d + 2k)`, `rot += 0.0009·env·sin(2π·11d + k)`.
 * The window is half-open so a shake ends at exactly 0 (at d = 0.7 it would still be ≈ 0.04 px).
 * Exactly 0 without `handheld` and outside every shake window.
 */
export function cameraJitter(c: CameraSpec, t: number): CameraJitter {
  let dx = 0
  let dy = 0
  let rot = 0
  if (c.handheld) {
    const a = c.handheld.amp
    const ph = (TAU * t) / CAMERA.handheldPeriod
    dx += a * (7 * Math.sin(2 * ph + 1.3) + 3 * Math.sin(5 * ph + 0.2))
    dy += a * 6 * Math.sin(3 * ph + 0.4)
    rot += a * 0.0024 * Math.sin(2 * ph + 2.1)
  }
  c.shakes?.forEach((s, k) => {
    const d = t - s.at
    if (!(d >= 0 && d < CAMERA.shakeWindow)) return
    const env = s.amp * Math.exp(-9 * d)
    dx += env * Math.sin(TAU * 14 * d + k)
    dy += 0.8 * env * Math.sin(TAU * 18.5 * d + 2 * k)
    rot += 0.0009 * env * Math.sin(TAU * 11 * d + k)
  })
  return { dx, dy, rot }
}

/** The jitter seen by a layer at `depth` (every component × depth). Depth 1 returns it as is. */
export function jitterAtDepth(j: CameraJitter, depth: number): CameraJitter {
  return depth === 1 ? j : { dx: j.dx * depth, dy: j.dy * depth, rot: j.rot * depth }
}

/**
 * The pose a layer at depth `d` sees: `zoom 1 + (zoom − 1)·d`, `x 0.5 + (x − 0.5)·d`, `y 0.5 + (y − 0.5)·d`.
 * Depth 1 is the camera itself, 0 a layer that never moves, 2 one that moves twice as much (near).
 * Ruling R18: the zoom is clamped to at least `CAMERA.minZoom`. A zoom-out below 1 at a large depth
 * (zoom 0.5 at depth 3 → −0.5) would otherwise collapse or mirror the layer, and `screenToCamera`
 * would divide by 0 or a negative zoom. `x` and `y` are not clamped.
 */
export function poseAtDepth(p: CameraPose, d: number): CameraPose {
  if (d === 1) return { x: p.x, y: p.y, zoom: p.zoom }
  return { zoom: Math.max(CAMERA.minZoom, 1 + (p.zoom - 1) * d), x: 0.5 + (p.x - 0.5) * d, y: 0.5 + (p.y - 0.5) * d }
}

const noJitter = (j: CameraJitter | undefined): j is undefined => !j || (j.dx === 0 && j.dy === 0 && j.rot === 0)

/**
 * Where a world point (frame px inside the world, as laid out at zoom 1) shows on screen under
 * `cam`: the same maths as `cameraTransform`, `(W/2 − x·W·z + px·z, H/2 − y·H·z + py·z)`; with a
 * jitter `j`, the point is then rotated by `j.rot` about the frame centre and moved by (dx, dy).
 */
export function cameraToScreen(
  cam: CameraPose,
  size: { w: number; h: number },
  pt: { x: number; y: number },
  j?: CameraJitter,
): { x: number; y: number } {
  const z = cam.zoom
  if (noJitter(j)) return { x: size.w / 2 - cam.x * size.w * z + pt.x * z, y: size.h / 2 - cam.y * size.h * z + pt.y * z }
  // Relative to the frame centre, before the jitter.
  const u = (pt.x - cam.x * size.w) * z
  const v = (pt.y - cam.y * size.h) * z
  const c = Math.cos(j.rot)
  const s = Math.sin(j.rot)
  return { x: size.w / 2 + j.dx + c * u - s * v, y: size.h / 2 + j.dy + s * u + c * v }
}

/** The inverse of `cameraToScreen`: the world point under a screen point. */
export function screenToCamera(
  cam: CameraPose,
  size: { w: number; h: number },
  pt: { x: number; y: number },
  j?: CameraJitter,
): { x: number; y: number } {
  const z = cam.zoom
  if (noJitter(j)) return { x: (pt.x - size.w / 2) / z + cam.x * size.w, y: (pt.y - size.h / 2) / z + cam.y * size.h }
  // Undo the jitter (move, then rotate back about the centre), then the zoom.
  const a = pt.x - size.w / 2 - j.dx
  const b = pt.y - size.h / 2 - j.dy
  const c = Math.cos(j.rot)
  const s = Math.sin(j.rot)
  return { x: (c * a + s * b) / z + cam.x * size.w, y: (-s * a + c * b) / z + cam.y * size.h }
}

/** A CSS length number: at most `d` decimals, never `-0`. */
function num(v: number, d: number): string {
  const r = Number(v.toFixed(d))
  return String(r === 0 ? 0 : r)
}

/**
 * The world wrapper's CSS transform (transform-origin 0 0) for a camera pose on a frame of `size`:
 * `translate(W/2 − x·W·z, H/2 − y·H·z) scale(z)`, so the frame point (x·W, y·H) lands at the
 * frame centre at zoom z. The centred pose at zoom 1 is the identity `translate(0px, 0px) scale(1)`.
 * With a non-zero jitter: `translate(W/2 + dx, H/2 + dy) rotate(rot) translate(−x·W·z, −y·H·z)
 * scale(z)` (the same point lands at the centre, then the jitter rotates about it and moves it).
 */
export function cameraTransform(cam: CameraPose, size: { w: number; h: number }, j?: CameraJitter): string {
  const z = cam.zoom
  if (noJitter(j)) {
    const tx = size.w / 2 - cam.x * size.w * z
    const ty = size.h / 2 - cam.y * size.h * z
    return `translate(${num(tx, 3)}px, ${num(ty, 3)}px) scale(${num(z, 6)})`
  }
  return (
    `translate(${num(size.w / 2 + j.dx, 3)}px, ${num(size.h / 2 + j.dy, 3)}px) rotate(${num(j.rot, 7)}rad) ` +
    `translate(${num(-cam.x * size.w * z, 3)}px, ${num(-cam.y * size.h * z, 3)}px) scale(${num(z, 6)})`
  )
}
