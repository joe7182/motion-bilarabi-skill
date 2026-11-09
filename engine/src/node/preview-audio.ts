import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Plugin } from 'vite'
import type { Project } from '../core/project'
import { storyboardDuration, type Storyboard } from '../core/storyboard'
import type { PreviewClip } from '../runtime/preview/audio'
import { clipSpan } from './audio'

// Kept out of preview-plugins.ts: vite.config.ts imports that file, and this one pulls in the
// storyboard schema and the audio mixer.

/**
 * The preview's clips (`runtime/preview/audio.ts`): every `audio[]` clip with media, its file served
 * at `/__audio/<media id>`. Gains are the storyboard's (no source level correction, no ducking or
 * loudness normalization: the render's mix is ffmpeg's); built-in effects are not previewed.
 */
export function previewClips(project: Project | undefined, sb: Storyboard): PreviewClip[] {
  if (!project) return []
  const total = storyboardDuration(sb)
  const out: PreviewClip[] = []
  for (const c of sb.audio ?? []) {
    const m = c.media === undefined ? undefined : project.manifest.media.find((x) => x.id === c.media)
    if (!m?.work || m.durationSec === undefined) continue
    const duration = clipSpan(c, m.durationSec - c.in, total)
    if (duration > 0) {
      out.push({ id: c.id, src: `/__audio/${encodeURIComponent(m.id)}`, at: c.at, in: c.in, duration, gain: c.gain, fadeIn: c.fadeIn, fadeOut: c.fadeOut })
    }
  }
  return out
}

const AUDIO_MIME: Record<string, string> = { '.wav': 'audio/wav', '.mp4': 'video/mp4' }

/**
 * `mba preview` audio: `/__audio.json` lists the clips (`previewClips`, re-read on every request)
 * and `/__audio/<media id>` serves a media's working copy, with byte ranges so the page can seek.
 */
export function audioPlugin(load: () => Promise<{ sb: Storyboard; project?: Project }>): Plugin {
  return {
    name: 'mba-audio',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]!
        if (url !== '/__audio.json' && !url.startsWith('/__audio/')) return next()
        try {
          const { sb, project } = await load()
          if (url === '/__audio.json') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.end(JSON.stringify(previewClips(project, sb)))
            return
          }
          const id = decodeURIComponent(url.slice('/__audio/'.length))
          const m = project?.manifest.media.find((x) => x.id === id)
          if (!project || !m?.work) {
            res.statusCode = 404
            res.end()
            return
          }
          const file = join(project.dir, m.work)
          const size = (await stat(file)).size
          res.setHeader('Content-Type', AUDIO_MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
          res.setHeader('Accept-Ranges', 'bytes')
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
          let start = 0
          let end = size - 1
          if (range && (range[1] || range[2])) {
            if (range[1]) {
              start = Number(range[1])
              if (range[2]) end = Math.min(Number(range[2]), size - 1)
            } else {
              start = Math.max(0, size - Number(range[2]))
            }
            if (start > end) {
              res.statusCode = 416
              res.setHeader('Content-Range', `bytes */${size}`)
              res.end()
              return
            }
            res.statusCode = 206
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
          }
          res.setHeader('Content-Length', String(end - start + 1))
          createReadStream(file, { start, end }).pipe(res)
        } catch (e) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(e instanceof Error ? e.message : String(e))
        }
      })
    },
  }
}
