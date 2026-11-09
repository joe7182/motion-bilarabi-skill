import type { Primitive } from './registry'
import { videoParams, type VideoParams } from '../../core/params/video'
import { videoFrameAt, videoZoomAt, videoZoomTransform } from '../../core/video'

/** URL of frame n of a project media, served by the Node frame server (node/framesrv.ts). */
export const frameUrl = (media: string, n: number) => `/__frames/${encodeURIComponent(media)}/${n}.jpg`

/**
 * `video`: a clip of the user's media, frame-exact. There is no `<video>` element (its
 * currentTime is neither frame-accurate nor deterministic): every frame is a JPEG extracted from
 * the project's working copy (at the project fps = the storyboard fps) and shown in an `<img>`.
 *
 * - Frame n = round((in + localT·speed)·fps) (video scenes have no preroll, R6), clamped to the scene's last frame (core/video.ts);
 *   a pure function of local time, never of a clock.
 * - `update` swaps `src` only when n changes and awaits `img.decode()`, so the seek resolves only
 *   once the frame is decoded and paintable. A failed load or decode rejects the seek (no other
 *   frame is ever shown in its place).
 * - The `<img>` fills the frame (`object-fit` = `fit`) inside a `.cam` wrapper that carries the
 *   `zoom` keyframes (spring tracks, `transform-origin: 0 0`). The scene layer is never styled.
 * - No text: the text audit is unaffected.
 */
export const video: Primitive<VideoParams> = {
  id: 'video',
  params: videoParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const cam = document.createElement('div')
    cam.className = 'cam'
    Object.assign(cam.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: `${w}px`,
      height: `${h}px`,
      transformOrigin: '0 0',
    })
    const img = document.createElement('img')
    img.alt = ''
    img.draggable = false
    img.decoding = 'sync'
    Object.assign(img.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: `${w}px`,
      height: `${h}px`,
      objectFit: p.fit,
      display: 'block',
    })
    cam.append(img)
    ctx.layer.append(cam)

    return {
      async update(localT) {
        cam.style.transform = videoZoomTransform(videoZoomAt(p.zoom, localT), w, h)
        const n = String(videoFrameAt(p, localT, ctx.duration, ctx.fps))
        if (img.dataset.n === n) return
        delete img.dataset.n
        const url = frameUrl(p.media, Number(n))
        img.src = url
        try {
          await img.decode()
        } catch (e) {
          // The URL path lets the Node side attach the frame server's own failure (ffmpeg stderr).
          throw new Error(
            `تعذّر تحميل الإطار ${n} من المادة ${p.media} — video ${p.media}: frame ${n} could not be loaded (${url}; ${e instanceof Error ? e.message : String(e)})`,
          )
        }
        img.dataset.n = n
      },
    }
  },
}
