import { spawn } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import type { Project } from '../core/project'
import { CUT_TOLERANCE, type Storyboard } from '../core/storyboard'
import { mediaSceneOf } from '../core/media-scenes'
import { renameWithRetry, rmWithRetry } from './fsx'
import { framesRootOf, removeProjectTempIfEmpty } from './tempdirs'
import { resolveFfmpeg } from './tools'

/**
 * Frame server: the user's video, frame-exact, without a `<video>` element. Frames of a working
 * copy (`work/<id>.mp4`, already at the project fps) are extracted by ffmpeg as JPEG files
 * `<frames>/<id>/<n>.jpg` (n = 0-based frame index) and served at `/__frames/<id>/<n>.jpg`, where
 * `<frames>` is `<tmp>/mba/<project id>/frames` (tempdirs.ts): never inside the project folder,
 * which is often synced (OneDrive).
 *
 * - `prepare` extracts the frames a range of seeks will need, one ffmpeg call per media (per
 *   `MAX_RUNS_PER_CALL` runs for a very sparse set).
 * - A request for a frame that was not prepared (the preview) extracts a small window around it
 *   (`ON_DEMAND_WINDOW` frames) before answering. A frame is never substituted by another one: an
 *   index outside the working copy is a 404 (the page's decode then fails loudly). Frames extracted
 *   on demand are capped per media (`maxOnDemand`, default ON_DEMAND_MAX), least recently served
 *   evicted first, so a long preview session does not fill the disk.
 * - `release` deletes extracted files (retrying a file held for a moment); the frame folder and the
 *   project's temp folder are removed once empty.
 */

/** URL prefix the runtime's `video` primitive requests frames from. */
export const FRAMES_URL = '/__frames/'
/** Frames extracted around an unprepared request: ON_DEMAND_BEFORE before it, the rest after. */
export const ON_DEMAND_WINDOW = 30
export const ON_DEMAND_BEFORE = 4
/** Most on-demand frames kept per media (preview); older ones are evicted, least recently served first. */
export const ON_DEMAND_MAX = 600

/** Frames `from..to` (inclusive) of one media. */
export interface FrameRange {
  mediaId: string
  from: number
  to: number
}

export interface FrameServerStats {
  /** ffmpeg extraction calls (prepare + on demand). */
  calls: number
  /** Frames written. */
  frames: number
  /** Wall time spent in ffmpeg extraction, ms. */
  ms: number
  /** Requests answered through the on-demand path. */
  onDemand: number
}

export interface FrameServer {
  readonly project: Project
  /** Absolute folder of this server's frames: `<tmp>/mba/<id>/frames`, or `…/frames/<session>`. */
  readonly dir: string
  /** Vite plugin with the `/__frames/<id>/<n>.jpg` middleware. */
  plugin(): Plugin
  /** Frames in the working copy of `mediaId` (from the manifest's durationSec × fps). */
  frameCount(mediaId: string): number
  /** Absolute path of frame n of `mediaId`. */
  framePath(mediaId: string, n: number): string
  /**
   * Extracts every frame of `ranges` not already extracted, one ffmpeg call per media and per
   * `MAX_RUNS_PER_CALL` runs (input seek to just before the group's first frame, then an exact
   * `select` on the frame index).
   */
  prepare(ranges: readonly FrameRange[]): Promise<void>
  /** Deletes the extracted frames of `ranges` (all extracted frames when omitted). */
  release(ranges?: readonly FrameRange[]): Promise<void>
  /**
   * The JPEG bytes of frame n of `mediaId`, as the middleware serves them: extracted on demand
   * (a window around n) when not there, then counted as recently served for the on-demand cap.
   */
  readFrame(mediaId: string, n: number): Promise<Buffer>
  stats(): FrameServerStats
  /**
   * The last failure the middleware answered for a frame URL path (`/__frames/<id>/<n>.jpg`),
   * Arabic first with the ffmpeg cause; undefined when that URL never failed. Tools attach it to a
   * rejected seek, since the page only sees a generic decode error.
   */
  failureFor(urlPath: string): string | undefined
}

/** Temp folder of one extraction: `.x<pid>-<k>`. */
const TEMP_RE = /^\.x(\d+)-\d+$/
/** Session folder of one tool run (render, verify, stills, preview): `s<pid>-<k>`. */
const SESSION_RE = /^s(\d+)-\d+$/
/** Temp folders older than this are swept even when their pid is (again) alive. */
export const STALE_TEMP_MS = 60 * 60 * 1000

/** True when a process with this pid exists (EPERM counts as alive); this process always is. */
export function pidAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Removes what a process that died left in `framesDir` (`<tmp>/mba/<id>/frames`):
 * - `.x<pid>-<k>` extraction temp folders under `<id>/` or `s…/<id>/` whose pid is not alive, or
 *   that are older than STALE_TEMP_MS;
 * - session folders `s<pid>-<k>` (with their frames) whose pid is not alive (e.g. a render killed
 *   mid-chunk).
 * A live process's session and recent temp folders (this one's included) are never touched. Best
 * effort, synchronous. The emptied frame folder is removed.
 */
export function sweepStaleTemps(framesDir: string, now = Date.now()): string[] {
  const removed: string[] = []
  let ids: string[] = []
  try {
    ids = readdirSync(framesDir)
  } catch {
    return removed
  }
  const mediaDirs: string[] = []
  for (const name of ids) {
    const m = SESSION_RE.exec(name)
    if (!m) {
      mediaDirs.push(name)
      continue
    }
    const p = join(framesDir, name)
    const pid = Number(m[1])
    if (pid !== process.pid && !pidAlive(pid)) {
      try {
        rmSync(p, { recursive: true, force: true })
        removed.push(p)
      } catch {
        // In use: a later sweep gets it.
      }
      continue
    }
    try {
      for (const id of readdirSync(p)) mediaDirs.push(join(name, id))
    } catch {
      // Gone meanwhile.
    }
  }
  if (removed.length) {
    try {
      if (readdirSync(framesDir).length === 0) rmSync(framesDir, { recursive: true, force: true })
    } catch {
      // Best effort.
    }
  }
  for (const id of mediaDirs) {
    let names: string[] = []
    try {
      names = readdirSync(join(framesDir, id))
    } catch {
      continue
    }
    for (const name of names) {
      const m = TEMP_RE.exec(name)
      if (!m) continue
      const p = join(framesDir, id, name)
      const pid = Number(m[1])
      let old = false
      try {
        old = now - statSync(p).mtimeMs > STALE_TEMP_MS
      } catch {
        continue
      }
      if (pid !== process.pid && (old || !pidAlive(pid))) {
        try {
          rmSync(p, { recursive: true, force: true })
          removed.push(p)
        } catch {
          // In use: a later sweep gets it.
        }
      }
    }
  }
  return removed
}

/** Merges sorted unique indices into inclusive runs. */
export function toRuns(indices: readonly number[]): [number, number][] {
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const n of sorted) {
    const last = runs.at(-1)
    if (last && n === last[1] + 1) last[1] = n
    else runs.push([n, n])
  }
  return runs
}

/**
 * The working-copy frames the stage draws at `times`: for every `video` / `screen-clip` scene whose window
 * contains t (with CUT_TOLERANCE either side, as a transition may show a layer at its cut), the
 * frame its `mediaSceneOf` mapping gives for the stage's local time. Merged into runs per media.
 */
export function framesNeeded(sb: Storyboard, times: readonly number[]): FrameRange[] {
  const per = new Map<string, number[]>()
  for (const sc of sb.scenes) {
    const m = mediaSceneOf(sc)
    if (!m) continue
    // A cutout also draws the same frames of its person matte.
    for (const id of sc.type === 'cutout' ? [m.media, `${m.media}.matte`] : [m.media]) {
      const list = per.get(id) ?? []
      // Video and screen-clip scenes have no preroll (R6): local time is t − start.
      for (const t of times) {
        if (t < sc.start - CUT_TOLERANCE || t > sc.start + sc.duration + CUT_TOLERANCE) continue
        list.push(m.frameAt(t - sc.start, sc.duration, sb.fps))
      }
      per.set(id, list)
    }
  }
  if (per.size === 0) return []
  const out: FrameRange[] = []
  for (const [mediaId, list] of per) for (const [from, to] of toRuns(list)) out.push({ mediaId, from, to })
  return out
}

/** Most runs (`eq`/`between` terms) one extraction call selects: ffmpeg rejects much longer sums. */
export const MAX_RUNS_PER_CALL = 40

/** Sorted unique frame indices cut into consecutive groups of at most `maxRuns` runs each. */
export function extractGroups(sorted: readonly number[], maxRuns: number = MAX_RUNS_PER_CALL): number[][] {
  const groups: number[][] = []
  let runs = 0
  let cur: number[] = []
  for (const n of sorted) {
    const newRun = cur.length === 0 || n !== cur.at(-1)! + 1
    if (newRun && runs === maxRuns) {
      groups.push(cur)
      cur = []
      runs = 0
    }
    if (newRun) runs++
    cur.push(n)
  }
  if (cur.length) groups.push(cur)
  return groups
}

/**
 * Colour conversion of extracted frames: working copies are BT.709 limited range (ingest), while a
 * browser decodes a JPEG as JFIF, i.e. BT.601 full range. Without it every frame is shown with the
 * wrong matrix (a BT.709 red 200,30,30 drew as 184,13,31).
 */
export const JPEG_FROM_WORK =
  'scale=in_color_matrix=bt709:in_range=tv:out_color_matrix=bt601:out_range=pc:flags=bicubic+accurate_rnd+full_chroma_int,format=yuvj420p'

/**
 * ffmpeg argv extracting the frames `wanted` (sorted, unique, ≥ 0) of a working copy at `fps`
 * as `<k>.jpg`, k = 0.. in the order of `wanted` (relative output pattern: run it with cwd = the
 * output folder, so `%` in the project path is never pattern-expanded).
 * The input seek lands half a frame before the first wanted frame, so that frame is the first one
 * decoded out (ffmpeg seeks to the keyframe before and discards up to the seek time); `select` then
 * counts n from there.
 */
export function buildExtractArgs(input: string, wanted: readonly number[], fps: number): string[] {
  const first = wanted[0]!
  const expr = toRuns(wanted.map((n) => n - first))
    .map(([a, b]) => (a === b ? `eq(n\\,${a})` : `between(n\\,${a}\\,${b})`))
    .join('+')
  return [
    '-v', 'error', '-nostdin', '-y',
    ...(first > 0 ? ['-ss', ((first - 0.5) / fps).toFixed(6)] : []),
    '-i', input,
    '-an', '-sn', '-dn',
    '-vf', `select=${expr},${JPEG_FROM_WORK}`,
    '-fps_mode', 'passthrough',
    '-frames:v', String(wanted.length),
    '-q:v', '2',
    '-start_number', '0',
    '%d.jpg',
  ]
}

function runFfmpeg(args: string[], cwd: string): Promise<{ code: number | null; stderr: string; error?: Error }> {
  return new Promise((res) => {
    const proc = spawn(resolveFfmpeg(), args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-3000)
    })
    proc.once('error', (error) => res({ code: null, stderr, error }))
    proc.once('close', (code) => res({ code, stderr }))
  })
}

let tmpCounter = 0
let sessionCounter = 0

export interface FrameServerOptions {
  /**
   * Keep this server's frames in its own folder `<frames>/s<pid>-<k>/<id>/` instead of
   * `<frames>/<id>/`, so another tool on the same project (a preview next to a render) can never
   * release them. The folder is removed with the last frame.
   */
  session?: boolean
  /** Most frames extracted on demand kept per media (default ON_DEMAND_MAX). Prepared frames are never evicted. */
  maxOnDemand?: number
}

export function createFrameServer(project: Project, opts: FrameServerOptions = {}): FrameServer {
  const root = framesRootOf(project)
  const dir = opts.session ? join(root, `s${process.pid}-${++sessionCounter}`) : root
  const fps = project.manifest.fps
  const maxOnDemand = opts.maxOnDemand ?? ON_DEMAND_MAX
  /** Frames this server extracted (and has not released), per media. */
  const have = new Map<string, Set<number>>()
  /** Frames extracted on demand (not prepared), per media, least recently served first. */
  const lru = new Map<string, Map<number, true>>()
  /** Frames asked for by `prepare`: never evicted by the on-demand cap. */
  const pinned = new Map<string, Set<number>>()
  const lruOf = (id: string) => {
    let m = lru.get(id)
    if (!m) lru.set(id, (m = new Map()))
    return m
  }
  const pinnedOf = (id: string) => {
    let p = pinned.get(id)
    if (!p) pinned.set(id, (p = new Set()))
    return p
  }
  /** Per-media lock: extractions and releases of one media never overlap. */
  const locks = new Map<string, Promise<unknown>>()
  const stats: FrameServerStats = { calls: 0, frames: 0, ms: 0, onDemand: 0 }
  const failures = new Map<string, string>()
  sweepStaleTemps(root)
  // Before E1a's final fix wave frames lived in the project (`work/.frames`): sweep what dead runs left there.
  sweepStaleTemps(join(project.dir, 'work', '.frames'))

  const media = (id: string) => {
    // A person matte (`m3.matte`, made by mba matte) is served like a working copy: `work/m3.matte.mp4`.
    const mt = /^(m[1-9]\d*)\.matte$/.exec(id)
    if (!mt) return project.manifest.media.find((m) => m.id === id)
    const base = project.manifest.media.find((m) => m.id === mt[1])
    if (!base?.work) return base
    const work = base.work.replace(/\.mp4$/i, '.matte.mp4')
    return existsSync(join(project.dir, work)) ? { ...base, id, work } : { ...base, id, work: undefined }
  }
  const frameCount = (id: string): number => {
    const m = media(id)
    return m?.work && m.durationSec ? Math.round(m.durationSec * fps) : 0
  }
  const framePath = (id: string, n: number) => join(dir, id, `${n}.jpg`)
  const setOf = (id: string) => {
    let s = have.get(id)
    if (!s) have.set(id, (s = new Set()))
    return s
  }
  const locked = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(id) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    locks.set(id, next.catch(() => {}))
    return next
  }

  const checkRange = (id: string, n: number) => {
    const m = media(id)
    if (!m) throw new Error(`لا توجد مادة بهذا المعرّف في المشروع — No media "${id}" in ${project.dir}`)
    if (!m.work) throw new Error(`لا توجد نسخة عمل للمادة ${id}؛ شغّل mba ingest — Media ${id} has no working copy; run mba ingest`)
    const count = frameCount(id)
    if (!Number.isInteger(n) || n < 0 || n >= count) {
      throw new Error(`الإطار ${n} خارج نسخة العمل للمادة ${id} (0–${count - 1}) — Frame ${n} is outside the working copy of ${id} (0–${count - 1})`)
    }
  }

  /** Extracts the frames of `wanted` that are missing (caller holds the media lock). */
  const extract = async (id: string, wanted: number[]): Promise<void> => {
    const s = setOf(id)
    const todo = [...new Set(wanted)].filter((n) => !(s.has(n) && existsSync(framePath(id, n)))).sort((a, b) => a - b)
    if (todo.length === 0) return
    for (const n of todo) checkRange(id, n)
    const input = join(project.dir, media(id)!.work!)
    // ffmpeg's expression parser rejects a long select sum, so a sparse set is cut into groups of at
    // most MAX_RUNS_PER_CALL runs, one call each (in order: every call seeks to its own first frame).
    for (const group of extractGroups(todo)) await extractGroup(id, input, group)
  }

  const extractGroup = async (id: string, input: string, todo: number[]): Promise<void> => {
    const s = setOf(id)
    const tmp = join(dir, id, `.x${process.pid}-${++tmpCounter}`)
    // Another session's release may remove an empty `work/.frames` between mkdir's steps.
    await mkdir(tmp, { recursive: true }).catch(() => mkdir(tmp, { recursive: true }))
    const t0 = performance.now()
    try {
      const r = await runFfmpeg(buildExtractArgs(input, todo, fps), tmp)
      if (r.error || r.code !== 0) {
        throw new Error(
          `تعذّر استخراج إطارات ${id} — ffmpeg could not extract frames ${todo[0]}–${todo.at(-1)} of ${id} ` +
            `(${r.error ? r.error.message : `exit code ${r.code}`}): ${r.stderr.trim().slice(-1500)}`,
        )
      }
      const names = new Set(await readdir(tmp))
      for (let k = 0; k < todo.length; k++) {
        if (!names.has(`${k}.jpg`)) {
          throw new Error(
            `استخرج ffmpeg إطارات أقل من المطلوب — ffmpeg wrote ${names.size} of ${todo.length} frames of ${id} (${todo[0]}–${todo.at(-1)})`,
          )
        }
      }
      for (let k = 0; k < todo.length; k++) {
        await renameWithRetry(join(tmp, `${k}.jpg`), framePath(id, todo[k]!))
        s.add(todo[k]!)
        if (!pinnedOf(id).has(todo[k]!)) lruOf(id).set(todo[k]!, true)
      }
      stats.calls++
      stats.frames += todo.length
    } finally {
      stats.ms += performance.now() - t0
      await rmWithRetry(tmp).catch(() => {}) // best effort: the startup sweep gets a leftover
    }
  }

  const removeEmptyDirs = async (ids: Iterable<string>) => {
    for (const id of ids) await rmdir(join(dir, id)).catch(() => {})
    await rmdir(dir).catch(() => {})
    if (dir !== root) await rmdir(root).catch(() => {})
    await removeProjectTempIfEmpty(project)
  }

  /** Deletes frame n of `id` (caller holds the media lock). */
  const drop = async (id: string, n: number) => {
    await rmWithRetry(framePath(id, n))
    setOf(id).delete(n)
    lru.get(id)?.delete(n)
  }

  /** Keeps at most `maxOnDemand` on-demand frames of `id`, never `keep` (caller holds the lock). */
  const evict = async (id: string, keep: number) => {
    const m = lruOf(id)
    for (const n of [...m.keys()]) {
      if (m.size <= maxOnDemand) break
      if (n === keep) continue
      await drop(id, n)
    }
  }

  /** Serves frame n: on-demand extraction when missing, LRU bookkeeping, eviction. */
  const readFrame = async (id: string, n: number): Promise<Buffer> => {
    checkRange(id, n)
    const file = framePath(id, n)
    const onDemand = async () => {
      stats.onDemand++
      const count = frameCount(id)
      const from = Math.max(0, n - ON_DEMAND_BEFORE)
      const to = Math.min(count - 1, from + ON_DEMAND_WINDOW - 1)
      await locked(id, () => extract(id, Array.from({ length: to - from + 1 }, (_, k) => from + k)))
    }
    if (!(have.get(id)?.has(n) && existsSync(file))) await onDemand()
    let data: Buffer
    try {
      data = await readFile(file)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      // Removed meanwhile (e.g. another process released the shared path): once more.
      have.get(id)?.delete(n)
      await onDemand()
      data = await readFile(file)
    }
    const m = lru.get(id)
    if (m?.has(n)) {
      m.delete(n)
      m.set(n, true)
    }
    if (m && m.size > maxOnDemand) await locked(id, () => evict(id, n))
    return data
  }

  const server: FrameServer = {
    project,
    dir,
    frameCount,
    framePath,
    async prepare(ranges) {
      const per = new Map<string, number[]>()
      for (const r of ranges) {
        const list = per.get(r.mediaId) ?? []
        for (let n = r.from; n <= r.to; n++) list.push(n)
        per.set(r.mediaId, list)
      }
      for (const [id, list] of per) {
        const p = pinnedOf(id)
        for (const n of list) {
          p.add(n)
          lru.get(id)?.delete(n)
        }
        await locked(id, () => extract(id, list))
      }
    },
    async release(ranges) {
      const per = new Map<string, number[]>()
      if (ranges === undefined) {
        for (const [id, s] of have) per.set(id, [...s])
      } else {
        for (const r of ranges) {
          const list = per.get(r.mediaId) ?? []
          for (let n = r.from; n <= r.to; n++) list.push(n)
          per.set(r.mediaId, list)
        }
      }
      for (const [id, list] of per) {
        await locked(id, async () => {
          const s = setOf(id)
          for (const n of list) {
            pinned.get(id)?.delete(n)
            if (!s.has(n)) continue
            await drop(id, n)
          }
        })
      }
      await removeEmptyDirs(per.keys())
    },
    readFrame,
    stats: () => ({ ...stats }),
    failureFor: (urlPath) => failures.get(urlPath),
    plugin(): Plugin {
      return {
        name: 'mba-frames',
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            const url = (req.url ?? '').split('?')[0]!
            if (!url.startsWith(FRAMES_URL)) return next()
            const m = /^\/__frames\/(m[1-9]\d*(?:\.matte)?)\/(\d+)\.jpg$/.exec(url)
            const fail = (status: number, msg: string) => {
              res.statusCode = status
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end(msg)
            }
            if (!m) return fail(404, `not a frame URL: ${url}`)
            const id = m[1]!
            const n = Number(m[2])
            try {
              const data = await readFrame(id, n)
              failures.delete(url)
              res.setHeader('Content-Type', 'image/jpeg')
              res.setHeader('Cache-Control', 'no-store')
              res.end(data)
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              failures.set(url, msg)
              fail(/خارج|outside|No media|no working copy/.test(msg) ? 404 : 500, msg)
            }
          })
        },
      }
    },
  }
  return server
}
