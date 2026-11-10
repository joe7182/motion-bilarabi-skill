import { screenClipFrameAt, screenClipLastFrame, screenClipParams } from './params/screen-clip'
import { videoParams } from './params/video'
import { cutoutParams } from './params/cutout'
import { zoomCalloutParams } from './params/glitch'
import { videoFrameAt, videoLastFrame } from './video'

/**
 * Scene types that draw frames of a project media (`/__frames/<media>/<n>.jpg`): `video` and
 * Stage 1B's `screen-clip`. The Node side (frame extraction, project checks, job hash) treats both
 * the same through `mediaSceneOf`, so a new frame-drawing type is added here once.
 */
export const MEDIA_SCENE_TYPES: ReadonlySet<string> = new Set(['video', 'screen-clip', 'cutout', 'zoom-callout'])

export interface MediaScene {
  media: string
  in: number
  speed: number
  /** Shows the single frame at `in` for the whole scene. */
  still: boolean
  /** Working-copy frame at scene-local `localT` (these scenes take no preroll, R6). */
  frameAt(localT: number, sceneLen: number, fps: number): number
  /** The last working-copy frame the scene can show. */
  lastFrame(sceneLen: number, fps: number): number
}

/** The media mapping of a frame-drawing scene (params parsed), or undefined for any other type. */
export function mediaSceneOf(sc: { type: string; params: unknown }): MediaScene | undefined {
  if (sc.type === 'video' || sc.type === 'cutout' || sc.type === 'zoom-callout') {
    const p = sc.type === 'cutout' ? cutoutParams.parse(sc.params) : sc.type === 'zoom-callout' ? zoomCalloutParams.parse(sc.params) : videoParams.parse(sc.params)
    return {
      media: p.media,
      in: p.in,
      speed: p.speed,
      still: false,
      frameAt: (t, len, fps) => videoFrameAt(p, t, len, fps),
      lastFrame: (len, fps) => videoLastFrame(p, len, fps),
    }
  }
  if (sc.type === 'screen-clip') {
    const p = screenClipParams.parse(sc.params)
    return {
      media: p.media,
      in: p.in,
      speed: p.speed,
      still: p.still,
      frameAt: (t, len, fps) => screenClipFrameAt(p, t, len, fps),
      lastFrame: (len, fps) => screenClipLastFrame(p, len, fps),
    }
  }
  return undefined
}
