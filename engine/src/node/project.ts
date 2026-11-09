import { randomUUID } from 'node:crypto'
import { constants as fsc, existsSync, readdirSync, statSync } from 'node:fs'
import { appendFile, chmod, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { Format } from '../core/types'
import type { Storyboard } from '../core/storyboard'
import {
  MAX_PROJECT_MEDIA_SEC,
  nextReviewName,
  nextVersionName,
  parseProjectManifest,
  PROJECT_MANIFEST,
  type Project,
  type ProjectManifest,
  type RenderKind,
} from '../core/project'
import { probeVideo } from './frames'
import { probeMedia } from './ingest'
import { fsStep, writeFileAtomic } from './fsx'
import { partsDirOf } from './tempdirs'

export type { Project, ProjectManifest, RenderKind }

export interface InitProjectOptions {
  /** Project folder: new, or an existing EMPTY directory (parents are created). */
  dir: string
  /** Media files to import, in timeline order. */
  media: string[]
  /** Library default 30 (the media pipeline's fixtures are 30 fps); `mba project init` passes the product default, 60 (`DEFAULT_FPS`). */
  fps?: 30 | 60
  format?: Format
  /** Test hook only: replaces the copy of one media file into source/ (to simulate a failing copy). */
  copyMedia?: (src: string, dest: string) => Promise<void>
}

/** A refusal about the target folder: passed through as is, never wrapped. */
class TargetError extends Error {}

/**
 * Checks the target folder: 'absent' (nothing there) or 'empty' (an existing empty directory).
 * Refuses a file, an existing project and a non-empty folder without a manifest.
 */
async function checkTarget(dir: string): Promise<'absent' | 'empty'> {
  let st
  try {
    st = await stat(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'
    throw e
  }
  if (!st.isDirectory()) {
    throw new TargetError(`المسار ملف وليس مجلدًا — The project path is a file, not a folder: ${dir}`)
  }
  if (existsSync(join(dir, PROJECT_MANIFEST))) {
    throw new TargetError(`المشروع موجود بالفعل — A project already exists in this folder: ${dir}`)
  }
  if ((await readdir(dir)).length > 0) {
    throw new TargetError(
      `المجلد موجود وليس مشروعًا، لن نكتب فيه — The folder already exists and is not a project (no ${PROJECT_MANIFEST}); ` +
        `choose a new or empty folder: ${dir}`,
    )
  }
  return 'empty'
}

/** Seconds with at most 3 decimals, no trailing zeros. */
const fmtSec = (t: number): string => String(Number(t.toFixed(3)))

/** `name.ext`, or `name (2).ext`, `name (3).ext`, … when the name is already taken (case-insensitive). */
function uniqueName(name: string, taken: Set<string>): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let out = name
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${stem} (${n})${ext}`
  taken.add(out.toLowerCase())
  return out
}

/** Makes every file under `dir` writable again (read-only source copies), so it can be removed. */
async function unlockTree(dir: string): Promise<void> {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await unlockTree(p)
    else await chmod(p, 0o644).catch(() => {})
  }
}

/** One dated Markdown bullet: `- **YYYY-MM-DD HH:MM UTC** — action — details` (one line). */
function logLine(entry: { action: string; details: string }): string {
  const when = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
  const flat = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim()
  return `- **${when}** — ${flat(entry.action)} — ${flat(entry.details)}\n`
}

/**
 * Creates a project folder from the user's media (spec §16.2):
 * - `dir` must be new or an existing EMPTY directory (ruling R4); a file, an existing project and a
 *   non-empty folder are refused (the tool never writes into a folder it did not create, and init
 *   never overwrites an existing project);
 * - measures every file with ffprobe and refuses more than MAX_PROJECT_MEDIA_SEC in total, before
 *   anything is written;
 * - copies each file into `source/` under its own name (deduped as `name (2).ext`) and makes the
 *   copy read-only; the originals are only read;
 * - writes `mba-project.json`, a minimal `edit.json` (one `video` scene per video media, end to end on
 *   track 0; with audio-only media, one `wipe-reveal` placeholder over the audio and
 *   `audio: [{ kind: 'voice', media: 'm1' }]`) and `log.md`.
 * On failure after creation, a folder this call created is removed; a pre-existing empty folder is
 * emptied again (never removed).
 */
export async function initProject(o: InitProjectOptions): Promise<Project> {
  const dir = resolve(o.dir)
  let state = await checkTarget(dir)
  // No media is fine: a video made on a beat from a script needs no recording.
  const fps = o.fps ?? 30
  const format = o.format ?? '9:16'

  const inputs: { path: string; durationSec: number; kind: 'video' | 'audio' }[] = []
  for (const m of o.media) {
    const path = resolve(m)
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`لم يتم العثور على الملف — Media file not found: ${path}`)
    const probed = await probeMedia(path)
    if (!probed.hasVideo) {
      // Audio-only (V1): the container/stream duration, rounded DOWN to the millisecond.
      if (!(probed.durationSec > 0)) throw new Error(`تعذّر قياس مدة الملف — Could not measure the duration of ${path}`)
      inputs.push({ path, durationSec: Math.floor(probed.durationSec * 1000 + 1e-6) / 1000, kind: 'audio' })
      continue
    }
    const info = await probeVideo(path)
    // The stream (or container) duration: packets / average fps drops the tail of a VFR clip whose
    // average rate is misreported.
    const durationSec = info.streamDuration > 0 ? info.streamDuration : info.duration
    if (!(durationSec > 0)) throw new Error(`تعذّر قياس مدة الملف — Could not measure the duration of ${path}`)
    // Rounded DOWN to the millisecond: the init scene never runs past the probed video.
    inputs.push({ path, durationSec: Math.floor(durationSec * 1000 + 1e-6) / 1000, kind: 'video' })
  }
  const total = inputs.reduce((a, x) => a + x.durationSec, 0)
  if (total > MAX_PROJECT_MEDIA_SEC + 1e-9) {
    throw new Error(
      `مدة المواد ${fmtSec(total)} ث وتتجاوز الحد (${MAX_PROJECT_MEDIA_SEC} ث = 3 دقائق) — ` +
        `Total media length is ${fmtSec(total)} s, over the ${MAX_PROJECT_MEDIA_SEC} s (3 minute) limit of v1`,
    )
  }

  const fail = (e: unknown) =>
    e instanceof TargetError ? e : new Error(`تعذّر إنشاء المشروع — Could not create the project: ${(e as Error).message}`)

  // Atomic leaf creation: only a plain mkdir that succeeds makes the folder "ours" to remove later.
  try {
    await mkdir(dirname(dir), { recursive: true })
    if (state === 'absent') {
      try {
        await mkdir(dir)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        state = await checkTarget(dir) // appeared meanwhile: accept only an empty directory
      }
    }
  } catch (e) {
    throw fail(e)
  }
  const created = state === 'absent'

  try {
    for (const d of ['source', 'work', 'renders', 'review']) await mkdir(join(dir, d))
    const taken = new Set<string>()
    const media: ProjectManifest['media'] = []
    for (const [i, x] of inputs.entries()) {
      const name = uniqueName(basename(x.path), taken)
      const dest = join(dir, 'source', name)
      if (o.copyMedia) await o.copyMedia(x.path, dest)
      else await copyFile(x.path, dest, fsc.COPYFILE_EXCL)
      await chmod(dest, 0o444)
      media.push({ id: `m${i + 1}`, source: `source/${name}`, durationSec: x.durationSec, kind: x.kind })
    }
    const manifest = parseProjectManifest({ version: 1, id: randomUUID(), createdAt: new Date().toISOString(), fps, format, media })

    let start = 0
    const videoMedia = media.filter((m) => m.kind === 'video')
    const audioMedia = media.filter((m) => m.kind === 'audio')
    let scenes: Storyboard['scenes']
    let audio: { kind: 'voice'; media: string }[] | undefined
    if (videoMedia.length === 0) {
      // Audio only (V1): one placeholder scene over the audio, never a `video` scene. The raw
      // audio entry is exactly this shape; the schema that fills its defaults comes later.
      const span = audioMedia.length ? Number(audioMedia.reduce((a, m) => a + m.durationSec!, 0).toFixed(3)) : 3
      scenes = [{ id: 'c1', type: 'wipe-reveal', start: 0, duration: span, track: 0, params: { title: 'عنوان الفيديو' } }]
      if (audioMedia.length) audio = [{ kind: 'voice', media: audioMedia[0]!.id }]
    } else {
      scenes = videoMedia.map((m, i) => {
        const sc = { id: `c${i + 1}`, type: 'video', start, duration: m.durationSec!, track: 0, params: { media: m.id, in: 0 } }
        start = Number((start + m.durationSec!).toFixed(3))
        return sc
      })
    }
    const edit = { version: 1, format, fps, ...(audio ? { audio } : {}), scenes }
    await writeFile(join(dir, 'edit.json'), JSON.stringify(edit, null, 2) + '\n')
    await writeFile(join(dir, 'log.md'), '# سجل المشروع — Project log\n\n')
    await writeFile(join(dir, PROJECT_MANIFEST), JSON.stringify(manifest, null, 2) + '\n')
    const project: Project = { dir, manifest }
    await appendLog(project, {
      action: 'init',
      details:
        `${media.length} ملف، ${fmtSec(total)} ث — ${media.length} file(s), ${fmtSec(total)} s, ${format}, ${fps} fps: ` +
        media.map((m) => `${m.id} = ${m.source}`).join(', '),
    })
    return project
  } catch (e) {
    const err = fail(e)
    await unlockTree(dir)
    try {
      if (created) {
        await rm(dir, { recursive: true, force: true })
      } else {
        // The user's own empty folder: remove only what this call put in it.
        for (const name of await readdir(dir)) await rm(join(dir, name), { recursive: true, force: true })
      }
    } catch (rmErr) {
      err.message +=
        ` — تعذّر حذف ما أُنشئ جزئيًا، احذفه يدويًا — Could not clean up the partly created project; remove it by hand: ${dir} ` +
        `(${(rmErr as Error).message})`
    }
    throw err
  }
}

/** Opens an existing project; refuses folders without `mba-project.json` (Arabic + English). */
export async function openProject(dir: string): Promise<Project> {
  const abs = resolve(dir)
  const file = join(abs, PROJECT_MANIFEST)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') {
      throw new Error(`هذا المجلد ليس مشروعًا — Not a project folder (no ${PROJECT_MANIFEST}): ${abs}`)
    }
    throw e
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`ملف المشروع ليس JSON صالحًا — ${PROJECT_MANIFEST} is not valid JSON (${file}): ${(e as Error).message}`)
  }
  return { dir: abs, manifest: parseProjectManifest(json) }
}

/**
 * R1: a storyboard is project-aware when its file's directory contains `mba-project.json`.
 * Returns that project, or null for a plain storyboard.
 */
export async function findProjectFor(storyboardPath: string): Promise<Project | null> {
  const dir = dirname(resolve(storyboardPath))
  if (!existsSync(join(dir, PROJECT_MANIFEST))) return null
  return openProject(dir)
}

/**
 * The next render path (relative to the project): `renders/v001-draft.mp4`, … numbered across
 * draft and final. Unfinished renders (`<tmp>/mba/<project id>/parts/<version>/`, see tempdirs.ts)
 * keep their number. This only proposes a name; `renderVideo` reserves it atomically.
 */
export function nextVersion(project: Project, kind: RenderKind): string {
  const names: string[] = []
  for (const d of [join(project.dir, 'renders'), partsDirOf(project)]) {
    try {
      names.push(...readdirSync(d))
    } catch {
      // A missing folder counts as empty.
    }
  }
  return nextVersionName(names, kind)
}

/**
 * The next review kit folder (relative to the project): `review/r1`, `review/r2`, … A kit is
 * finished once its `metrics.json` exists (written last); an unfinished highest kit is reused.
 */
export function nextReviewDir(project: Project): string {
  const review = join(project.dir, 'review')
  let names: string[] = []
  try {
    names = readdirSync(review)
  } catch {
    // A missing folder counts as empty.
  }
  return nextReviewName(names, (name) => existsSync(join(review, name, 'metrics.json')))
}

/** The newest finished render of a project (`renders/v<N>-draft|final.mp4`, highest N), or null. */
export async function latestRender(project: Project): Promise<string | null> {
  let best: { n: number; name: string } | null = null
  for (const name of await readdir(join(project.dir, 'renders')).catch(() => [] as string[])) {
    const m = /^v(\d+)-(?:draft|final)\.mp4$/.exec(name)
    if (m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), name }
  }
  return best ? join(project.dir, 'renders', best.name) : null
}

/**
 * The next `mba compare` folder (relative to `dir`, a project or the working folder): `review/compare-1`, `review/compare-2`, …
 * (highest existing number + 1, so an earlier comparison is never overwritten).
 */
export function nextCompareDir(dir: string): string {
  let max = 0
  try {
    for (const name of readdirSync(join(dir, 'review'))) {
      const m = /^compare-(\d+)$/.exec(name)
      if (m) max = Math.max(max, Number(m[1]))
    }
  } catch {
    // A missing folder counts as empty.
  }
  return `review/compare-${max + 1}`
}

/** The storyboard of a project: `<dir>/edit.json`. */
export const PROJECT_EDIT = 'edit.json'

/**
 * A storyboard argument of the CLI: a folder stands for its project's `edit.json` (a folder
 * without `mba-project.json` is refused, Arabic first); anything else is returned unchanged.
 */
export async function storyboardArg(arg: string): Promise<string> {
  if (!(existsSync(arg) && statSync(arg).isDirectory())) return arg
  await openProject(arg)
  return join(arg, PROJECT_EDIT)
}

/**
 * Records working copies in `mba-project.json`: sets `work` and `durationSec` of the named media.
 * The manifest file is re-read and rewritten as raw JSON, so keys this version does not know
 * survive; the result is validated, written to a temp file and renamed into place.
 * `project.manifest` is updated to the new manifest.
 */
export async function recordWorkingCopies(
  project: Project,
  updates: readonly { id: string; work: string; durationSec: number }[],
): Promise<void> {
  if (updates.length === 0) return
  const file = join(project.dir, PROJECT_MANIFEST)
  let text = await fsStep('تعذّر قراءة الملف', 'Could not read', file, () => readFile(file, 'utf8'))
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  let raw: { media?: { id?: unknown; [k: string]: unknown }[] }
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error(`ملف المشروع ليس JSON صالحًا — ${PROJECT_MANIFEST} is not valid JSON (${file}): ${(e as Error).message}`)
  }
  for (const u of updates) {
    const m = raw.media?.find((x) => x.id === u.id)
    if (!m) throw new Error(`المادة غير موجودة في المشروع — Media ${u.id} is not in the project manifest`)
    m.work = u.work
    m.durationSec = u.durationSec
  }
  const manifest = parseProjectManifest(raw)
  await writeFileAtomic(file, JSON.stringify(raw, null, 2) + '\n')
  project.manifest = manifest
}

export type MediaRole = 'voice' | 'music' | 'sfx'

/**
 * `mba project add <dir> <file> --kind music|sfx|voice`: copies one more file of the user into
 * `source/` (own name, deduped as `name (2).ext`, read-only), records it in `mba-project.json` as
 * the next media id with its `role`, and logs it. The project's total media length stays within
 * MAX_PROJECT_MEDIA_SEC. The working copy is made by the next `mba ingest`; the storyboard is not
 * changed (the user or a recipe places the clip in `audio[]`).
 */
export async function addProjectMedia(dir: string, file: string, role: MediaRole): Promise<{ project: Project; id: string }> {
  const project = await openProject(dir)
  const path = resolve(file)
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`لم يتم العثور على الملف — Media file not found: ${path}`)
  const probed = await probeMedia(path)
  if (!(probed.durationSec > 0)) throw new Error(`تعذّر قياس مدة الملف — Could not measure the duration of ${path}`)
  if (!probed.hasAudio) throw new Error(`لا يوجد صوت في الملف — The file has no audio: ${path}`)
  const durationSec = Math.floor(probed.durationSec * 1000 + 1e-6) / 1000
  const have = project.manifest.media.reduce((a, m) => a + (m.durationSec ?? 0), 0)
  if (have + durationSec > MAX_PROJECT_MEDIA_SEC + 1e-9) {
    throw new Error(
      `مدة المواد ستصبح ${fmtSec(have + durationSec)} ث وتتجاوز الحد (${MAX_PROJECT_MEDIA_SEC} ث = 3 دقائق) — ` +
        `Total media length would be ${fmtSec(have + durationSec)} s, over the ${MAX_PROJECT_MEDIA_SEC} s (3 minute) limit of v1`,
    )
  }
  const taken = new Set(readdirSync(join(project.dir, 'source')).map((n) => n.toLowerCase()))
  const name = uniqueName(basename(path), taken)
  const dest = join(project.dir, 'source', name)
  const next = Math.max(0, ...project.manifest.media.map((m) => Number(m.id.slice(1)))) + 1
  const id = `m${next}`
  const manifestFile = join(project.dir, PROJECT_MANIFEST)
  let text = await fsStep('تعذّر قراءة الملف', 'Could not read', manifestFile, () => readFile(manifestFile, 'utf8'))
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const raw = JSON.parse(text) as { media?: unknown[] }
  raw.media = [...(raw.media ?? []), { id, source: `source/${name}`, durationSec, kind: probed.hasVideo ? 'video' : 'audio', role }]
  const manifest = parseProjectManifest(raw)
  await fsStep('تعذّر نسخ الملف', 'Could not copy', dest, () => copyFile(path, dest, fsc.COPYFILE_EXCL))
  await chmod(dest, 0o444)
  try {
    await writeFileAtomic(manifestFile, JSON.stringify(raw, null, 2) + '\n')
  } catch (e) {
    await chmod(dest, 0o644).catch(() => {})
    await rm(dest, { force: true }).catch(() => {})
    throw e
  }
  project.manifest = manifest
  await appendLog(project, { action: 'add', details: `${id} = source/${name} (${role}, ${fmtSec(durationSec)} ث — s)` })
  return { project, id }
}

/** Appends one dated Markdown bullet to the project's `log.md`. */
export async function appendLog(project: Project, entry: { action: string; details: string }): Promise<void> {
  const file = join(project.dir, 'log.md')
  await fsStep('تعذّر حفظ الملف', 'Could not write', file, () => appendFile(file, logLine(entry)))
}
