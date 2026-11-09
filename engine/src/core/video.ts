import { springTrack, type SpringKey } from './springs'
import type { VideoParams } from './params/video'

/**
 * Frame mapping of a `video` scene, shared by the runtime primitive (which frame to draw) and the
 * Node side (which frames to extract, and whether the working copy is long enough), so both always
 * agree. DOM-free and pure.
 *
 * `localT` is the scene's local time as the stage passes it to `update` (seconds since the scene's
 * start: video scenes take no preroll, R6, so `in` is the media time of the first visible frame);
 * `sceneLen` is the scene's duration. Frame indices are 0-based frames of the working copy at the project fps.
 */

/**
 * The last working-copy frame the scene can show: the frame whose display interval contains the
 * media time just before the scene ends, `ceil((in + sceneLen·speed)·fps − 0.5) − 1`. A scene that
 * uses the clip to its very end (in + len·speed = frames / fps) gives `frames − 1`.
 */
export function videoLastFrame(p: Pick<VideoParams, 'in' | 'speed'>, sceneLen: number, fps: number): number {
  return Math.max(0, Math.ceil((p.in + sceneLen * p.speed) * fps - 0.5) - 1)
}

/** Frame n = round((in + localT·speed)·fps), clamped to [0, videoLastFrame]. Never from a clock. */
export function videoFrameAt(p: Pick<VideoParams, 'in' | 'speed'>, localT: number, sceneLen: number, fps: number): number {
  const n = Math.round((p.in + Math.max(0, localT) * p.speed) * fps)
  return Math.min(Math.max(n, 0), videoLastFrame(p, sceneLen, fps))
}

export interface VideoZoom {
  /** Scale factor of the picture. */
  scale: number
  /** Fixed point of the scale, as a fraction of the frame width / height (0.5, 0.5 = centre). */
  x: number
  y: number
}

/**
 * The zoom at local time `t`: each of scale, x and y is a `springTrack` over the keys sorted by
 * time (the first key is the resting value). `x`/`y` default to 0.5 (the frame centre) and, when a
 * key omits them, keep the previous key's value. No keys: scale 1 at the centre.
 */
export function videoZoomAt(keys: VideoParams['zoom'], t: number): VideoZoom {
  if (!keys || keys.length === 0) return { scale: 1, x: 0.5, y: 0.5 }
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const sk: SpringKey[] = []
  const xk: SpringKey[] = []
  const yk: SpringKey[] = []
  let x = 0.5
  let y = 0.5
  for (const k of sorted) {
    x = k.x ?? x
    y = k.y ?? y
    sk.push([k.t, k.scale])
    xk.push([k.t, x])
    yk.push([k.t, y])
  }
  return { scale: springTrack(t, sk), x: springTrack(t, xk), y: springTrack(t, yk) }
}

/** CSS transform (with `transform-origin: 0 0`) that scales a w×h box by `z.scale` about (x·w, y·h). */
export function videoZoomTransform(z: VideoZoom, w: number, h: number): string {
  if (z.scale === 1) return ''
  const tx = z.x * w * (1 - z.scale)
  const ty = z.y * h * (1 - z.scale)
  return `translate(${tx.toFixed(3)}px, ${ty.toFixed(3)}px) scale(${z.scale.toFixed(5)})`
}
