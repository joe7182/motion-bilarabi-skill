import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAFE_AREA, type Format } from '../core/types'

/**
 * Face-aware placement. `mba matte` records the head of every frame (work/<id>.matte.face.json,
 * normalized [x0, y0, x1, y1]). Before a storyboard is drawn, a line headline (`kinetic-text`) or a
 * `stamp` that would sit over the face of a person shown at the same time (a `video` or `cutout`
 * scene of that media) is moved: below the chin when there is room above the subtitles, otherwise
 * above the head. Scenes that set `"face": "keep"` in their params are left where they are.
 */

type Box = [number, number, number, number]
interface Faces {
  fps: number
  w: number
  h: number
  boxes: (Box | null)[]
}
type RawScene = { id?: string; type?: string; start?: unknown; duration?: unknown; track?: unknown; params?: Record<string, unknown> }

/** Half the height of a one-line headline and of a stamp, as fractions of the frame height. */
const LINE_HALF = 0.045
const STAMP_HALF = 0.075
/** Space kept between the text and the face, and the lowest a moved text may sit (subtitles below). */
const GAP = 0.025
const LOWEST = 0.74

function loadFaces(projectDir: string, work: string): Faces | null {
  const p = join(projectDir, work.replace(/\.mp4$/i, '.matte.face.json'))
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Faces
  } catch {
    return null
  }
}

/** Maps a box in the clip's frame onto the video frame when the clip is drawn `cover`. */
function cover(b: Box, clipAspect: number, frameAspect: number): Box {
  if (Math.abs(clipAspect - frameAspect) < 1e-3) return b
  if (clipAspect > frameAspect) {
    const s = clipAspect / frameAspect
    return [(b[0] - 0.5) * s + 0.5, b[1], (b[2] - 0.5) * s + 0.5, b[3]]
  }
  const s = frameAspect / clipAspect
  return [b[0], (b[1] - 0.5) * s + 0.5, b[2], (b[3] - 0.5) * s + 0.5]
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/**
 * Moves texts off faces in place (`obj.scenes[].params`). Returns one note per moved scene.
 * `media` maps a media id to its working copy path (relative to `projectDir`).
 */
export function placeAroundFaces(obj: Record<string, unknown>, projectDir: string, media: Map<string, string>, format: Format, frameAspect: number): string[] {
  const scenes = Array.isArray(obj.scenes) ? (obj.scenes as RawScene[]) : []
  const safe = SAFE_AREA[format] ?? SAFE_AREA['9:16']
  const top = safe.top
  const bottom = 1 - safe.bottom
  const notes: string[] = []
  const cache = new Map<string, Faces | null>()
  const facesOf = (id: string) => {
    if (!cache.has(id)) {
      const work = media.get(id)
      cache.set(id, work ? loadFaces(projectDir, work) : null)
    }
    return cache.get(id) ?? null
  }
  // Every text's band once placed (time span and vertical extent), so moved texts never land on each other.
  const placed: { a: number; b: number; y0: number; y1: number }[] = []
  const clash = (a: number, b: number, y0: number, y1: number) => placed.some((q) => q.a < b && a < q.b && q.y0 < y1 + GAP && y0 < q.y1 + GAP)
  const shots = scenes.filter((s) => (s.type === 'video' || s.type === 'cutout') && typeof s.params?.media === 'string')
  for (const s of scenes) {
    const p = s.params
    if (!p || p.face === 'keep') continue
    const isLine = s.type === 'kinetic-text' && p.mode !== 'giant' && p.mode !== 'stack'
    const isStamp = s.type === 'stamp'
    if (!isLine && !isStamp) continue
    const a = num(s.start)
    const d = num(s.duration)
    if (a === null || d === null) continue
    // The union of the face boxes over the text's time on screen.
    let u: Box | null = null
    for (const sh of shots) {
      const sa = num(sh.start)
      const sd = num(sh.duration)
      if (sa === null || sd === null || sa >= a + d || sa + sd <= a) continue
      const f = facesOf(sh.params!.media as string)
      if (!f || !f.boxes.length) continue
      const inAt = num(sh.params!.in) ?? 0
      const speed = num(sh.params!.speed) ?? 1
      for (let t = Math.max(a, sa); t <= Math.min(a + d, sa + sd); t += 0.2) {
        const i = Math.min(f.boxes.length - 1, Math.max(0, Math.round((inAt + (t - sa) * speed) * f.fps)))
        const b = f.boxes[i]
        if (!b) continue
        const m = cover(b, f.w / f.h, frameAspect)
        u = u ? [Math.min(u[0], m[0]), Math.min(u[1], m[1]), Math.max(u[2], m[2]), Math.max(u[3], m[3])] : m
      }
    }
    if (!u) continue
    const half = isLine ? LINE_HALF : STAMP_HALF
    // Where the text's centre sits now (frame fraction).
    let cy: number
    if (isLine) cy = Math.min(bottom - half, Math.max(top + half, num(p.y) ?? (top + bottom) / 2))
    else {
      const at = (p.at as { y?: number } | undefined)?.y ?? 0.5
      cy = top + at * (bottom - top)
    }
    if (cy + half <= u[1] - 0.005 || cy - half >= u[3] + 0.005) {
      placed.push({ a, b: a + d, y0: cy - half, y1: cy + half })
      continue
    }
    // Below the chin first, stepping further down past other texts; then above the head.
    let ny: number | null = null
    for (let y = u[3] + GAP + half; y + half <= Math.min(LOWEST, bottom); y += 0.01) {
      if (!clash(a, a + d, y - half, y + half)) {
        ny = y
        break
      }
    }
    if (ny === null) {
      for (let y = u[1] - GAP - half; y - half >= top; y -= 0.01) {
        if (!clash(a, a + d, y - half, y + half)) {
          ny = y
          break
        }
      }
    }
    if (ny === null) {
      placed.push({ a, b: a + d, y0: cy - half, y1: cy + half })
      continue
    }
    placed.push({ a, b: a + d, y0: ny - half, y1: ny + half })
    if (isLine) p.y = +ny.toFixed(3)
    else p.at = { ...((p.at as object) ?? { x: 0.5 }), y: +((ny - top) / (bottom - top)).toFixed(3) }
    notes.push(`${s.id ?? s.type}: moved off the face (${cy.toFixed(2)} → ${ny.toFixed(2)})`)
  }
  return notes
}

/**
 * Gives every `cutout` scene the clean plate `mba matte` made for its media (work/<id>.plate.jpg) as a
 * data URL, so blow-away, back focus, clones and layers show the real room behind the person.
 */
export function attachPlates(obj: Record<string, unknown>, projectDir: string, media: Map<string, string>): void {
  const scenes = Array.isArray(obj.scenes) ? (obj.scenes as RawScene[]) : []
  const cache = new Map<string, string | null>()
  for (const s of scenes) {
    if (s.type !== 'cutout' || !s.params || typeof s.params.media !== 'string' || s.params.plate !== undefined) continue
    const id = s.params.media
    if (!cache.has(id)) {
      const work = media.get(id)
      const file = work ? join(projectDir, work.replace(/\.mp4$/i, '.plate.jpg')) : ''
      cache.set(id, file && existsSync(file) ? `data:image/jpeg;base64,${readFileSync(file).toString('base64')}` : null)
    }
    const url = cache.get(id)
    if (url) s.params.plate = url
  }
}

/**
 * The room the speaker's face takes in the video frame over the whole clip (0..1; the 5th–95th
 * percentile of each edge, so a walk-in or a slow push-in is covered), or undefined
 * when `mba matte` has not run for that media. `frameAspect` = width / height of the video frame.
 */
export function usualFace(projectDir: string, work: string, frameAspect: number): Box | undefined {
  const faces = loadFaces(projectDir, work)
  const boxes = faces?.boxes.filter((b): b is Box => b !== null) ?? []
  if (!faces || boxes.length === 0) return undefined
  const at = (k: 0 | 1 | 2 | 3, q: number) => boxes.map((b) => b[k]).sort((a, b) => a - b)[Math.min(boxes.length - 1, Math.floor(boxes.length * q))]!
  return cover([at(0, 0.05), at(1, 0.05), at(2, 0.95), at(3, 0.95)], faces.w / faces.h, frameAspect)
}
