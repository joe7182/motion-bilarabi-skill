import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { link, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { chromium, type Browser, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { parseStoryboard, storyboardDuration, StoryboardError, type Storyboard } from '../core/storyboard'
import { parseMarks, resolveAnchors } from '../core/anchors'
import { parseTranscript, transcriptHash, type Marks, type Transcript } from '../core/transcript'
import type { Project, ProjectMedia, RenderKind } from '../core/project'
import { mediaSceneOf } from '../core/media-scenes'
import { screenClipLayout, screenClipParams } from '../core/params/screen-clip'
import { PRIMITIVE_IDS } from '../core/primitive-ids'
import { validateSceneParams } from '../core/params/index'
import { frameCount, frameToTime } from '../core/clock'
import { FORMAT_SIZE, safeRect, type Format } from '../core/types'
import type { Brand } from '../core/brand'
import { loadBrand } from './brand-fs'
import { ffmpegVersionLine, resolveFfmpeg } from './tools'
import { storyboardPlugin } from './preview-plugins'
import { audioPlugin } from './preview-audio'
import { appendLog, findProjectFor, nextVersion } from './project'
import { attachPlates, placeAroundFaces } from './face-place'
import { INGEST_RECIPE, SET_BT709, type MediaRecord } from './ingest'
import { createFrameServer, framesNeeded, pidAlive, type FrameRange, type FrameServer, type FrameServerStats } from './framesrv'
import { couldNotWrite, fsStep, renameWithRetry, rmWithRetry, writeFileAtomic } from './fsx'
import { partsDirOf, removeProjectTempIfEmpty } from './tempdirs'
import { probeVideo } from './frames'
import { audioHashInputs, buildAudioTrack } from './audio'
import { sfxWav } from './sfx-synth'
import { mergePlannedAudio, planSfx, userSfxMap } from '../core/audio-plan'
import { TRANSCRIPT_FILE } from './whisper'
import type {} from '../runtime/mba-api'

const VITE_CONFIG = fileURLToPath(new URL('../../vite.config.ts', import.meta.url))
// Own dep-optimizer cache so a render never races the dev/test server over node_modules/.vite.
const VITE_CACHE = fileURLToPath(new URL('../../node_modules/.vite-mba-render', import.meta.url))
const READY_TIMEOUT_MS = 30_000

const LOGO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

export interface LoadedStoryboard {
  /**
   * The JSON as injected into the page (brand filled in, logo inlined as a data URL, word and pause
   * anchors resolved: every time is a number of seconds).
   */
  json: Record<string, unknown>
  /** The parsed storyboard (defaults applied). */
  sb: Storyboard
  /** Absolute directory of the storyboard file. */
  dir: string
  /** R1: the project whose folder holds the storyboard (`mba-project.json` next to it), if any. */
  project?: Project
  /** sha1 of the project's `transcript.json` and `marks.json` bytes (null when absent or no project). */
  inputs: { transcript: string | null; marks: string | null }
  /**
   * Arabic-first warnings: I3, the storyboard names the transcript its word anchors were written
   * for (`transcript: { sourceHash, words }`) and the project's `transcript.json` is another one.
   */
  warnings: string[]
}

/**
 * I3: word anchors are bare indexes. A storyboard that records the transcript it was written for
 * (`mba explain` does) is checked against the current one: another audio or another word count
 * means the anchors may point at other words. Arabic first.
 */
export function transcriptWarnings(ref: unknown, t: Transcript | undefined): string[] {
  if (!ref || typeof ref !== 'object' || !t) return []
  const r = ref as { sourceHash?: unknown; words?: unknown; hash?: unknown }
  const out: string[] = []
  // Re-review (I3): the same audio transcribed again keeps sourceHash and may keep the word count;
  // the words hash (core `transcriptHash`) catches moved words and new spellings. Absent in an
  // edit.json written before it existed: no warning on it alone.
  if (typeof r.hash === 'string' && r.hash !== transcriptHash(t)) {
    out.push(
      `التفريغ أُعيد أو كلماته تغيّرت بعد كتابة القصة، فقد تشير المراسي إلى كلمات أخرى؛ أعد mba explain — transcript.json was transcribed again (words changed: text or times) after edit.json was written: ` +
        `its word anchors may point at other words; re-run mba explain or check the timing`,
    )
    return out
  }
  if (typeof r.sourceHash === 'string' && r.sourceHash !== t.sourceHash) {
    out.push(
      `القصة كُتبت لتفريغ صوت آخر، فقد تشير المراسي إلى كلمات أخرى؛ أعد mba explain — edit.json was written for another transcript ` +
        `(sourceHash ${r.sourceHash.slice(0, 12)}…, transcript.json has ${t.sourceHash.slice(0, 12)}…): its word anchors may point at other words; re-run mba explain or check the timing`,
    )
  }
  if (typeof r.words === 'number' && r.words !== t.words.length) {
    out.push(
      `عدد كلمات التفريغ تغيّر (${r.words} ← ${t.words.length})، فقد تشير المراسي إلى كلمات أخرى — edit.json was written for a transcript of ${r.words} words, ` +
        `transcript.json has ${t.words.length}: its word anchors may point at other words; re-run mba explain or check the timing`,
    )
  }
  return out
}

/** The project's `marks.json` (written by `mba transcribe` when the project has a script.md). */
export const MARKS_FILE = 'marks.json'

/** Reads an optional project file: its bytes and their sha1, or null when it does not exist. */
async function readOptional(path: string): Promise<{ bytes: Buffer; sha1: string } | null> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  return { bytes, sha1: createHash('sha1').update(bytes).digest('hex') }
}

/** Parses an optional JSON project file with `parse`; errors name the file (Arabic first). */
function parseProjectJson<T>(file: { bytes: Buffer }, path: string, parse: (json: unknown) => T): T {
  let text = file.bytes.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  try {
    return parse(JSON.parse(text))
  } catch (e) {
    throw new Error(`تعذّرت قراءة ${basename(path)} — Could not read ${path}: ${(e as Error).message}`)
  }
}

/**
 * Reads and validates a storyboard file. If it has no `brand`, `mba-brand.json` from the same
 * directory is used. A file-path `brand.logo` is resolved against the storyboard's directory and
 * inlined as a data URL. Schema errors, including each scene's primitive params, are
 * `StoryboardError`s (message `path: message`, e.g. `scenes[0].params.title: ...`).
 *
 * In a project, sound effects are planned (`planSfx`) and merged into `audio[]` unless the file
 * says `"autoSfx": false`.
 *
 * In a project (R1), `transcript.json` and `marks.json` are read when present and word/pause
 * anchors are resolved to seconds (`resolveAnchors`) before the schema check; `inputs` carries the
 * sha1 of both files' bytes for the job hash.
 *
 * `opts.testTypes`: also accept scene types starting with `_` that the engine does not know (test
 * primitives registered in the page through `?test=1`). Their params are not checked here; the page
 * rejects any that no test primitive registers. Off by default.
 */
export async function loadStoryboardFile(
  storyboardPath: string,
  opts: { testTypes?: boolean } = {},
): Promise<LoadedStoryboard> {
  const file = resolve(storyboardPath)
  const dir = dirname(file)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`لم يتم العثور على ملف القصة — Storyboard file not found: ${file}`)
    }
    throw e
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`ملف القصة ليس JSON صالحًا — Storyboard is not valid JSON (${file}): ${(e as Error).message}`)
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    // Let the schema produce its normal error for non-objects.
    parseStoryboard(json, [...PRIMITIVE_IDS])
  }
  const project = (await findProjectFor(file)) ?? undefined
  let transcript: Transcript | undefined
  let marks: Marks | undefined
  const inputs: LoadedStoryboard['inputs'] = { transcript: null, marks: null }
  if (project) {
    const tPath = join(project.dir, TRANSCRIPT_FILE)
    const mPath = join(project.dir, MARKS_FILE)
    const t = await readOptional(tPath)
    const m = await readOptional(mPath)
    if (t) {
      transcript = parseProjectJson(t, tPath, parseTranscript)
      inputs.transcript = t.sha1
    }
    if (m) {
      marks = parseProjectJson(m, mPath, parseMarks)
      inputs.marks = m.sha1
    }
  }
  // An edit.json that does not say its fps takes the project's (60 unless the project is 30); an
  // explicit fps is kept as written, and the render checks it against the project.
  const rawFps = (json as { fps?: unknown }).fps ?? project?.manifest.fps
  const fps = rawFps === 60 ? 60 : 30 // any other value is reported by the schema below
  const obj = { ...(resolveAnchors(json, { transcript, marks, fps }).json as Record<string, unknown>) }
  if (obj.fps === undefined && project) obj.fps = project.manifest.fps
  if (obj.brand === undefined) {
    const brand = await loadBrand(dir)
    if (brand) obj.brand = brand
  }
  const brand = obj.brand as { logo?: unknown } | undefined
  if (brand && typeof brand === 'object' && typeof brand.logo === 'string') {
    if (REMOTE_URL.test(brand.logo)) throw remoteImageError('brand.logo', 'الشعار', 'brand.logo')
    if (!/^data:/i.test(brand.logo)) {
      obj.brand = { ...brand, logo: await inlineLogo(isAbsolute(brand.logo) ? brand.logo : join(dir, brand.logo)) }
    } else checkInlineSize(brand.logo, 'brand.logo', 'الشعار')
  }
  fillSignatureCards(obj)
  await inlinePhoneImages(obj, dir)
  // Face-aware placement: headlines and stamps over a filmed face move below the chin (or above the head).
  if (project) {
    const fmt = ((obj.format as Format | undefined) ?? project.manifest.format ?? '9:16') as Format
    const size = FORMAT_SIZE[fmt] ?? FORMAT_SIZE['9:16']
    const media = new Map(project.manifest.media.filter((m) => m.work).map((m) => [m.id, m.work!] as [string, string]))
    placeAroundFaces(obj, project.dir, media, fmt, size.w / size.h)
    attachPlates(obj, project.dir, media)
  }
  const known: string[] = [...PRIMITIVE_IDS]
  if (opts.testTypes && Array.isArray(obj.scenes)) {
    for (const sc of obj.scenes as unknown[]) {
      const type = (sc as { type?: unknown } | null)?.type
      if (typeof type === 'string' && type.startsWith('_') && !known.includes(type)) known.push(type)
    }
  }
  const sb = parseStoryboard(obj, known)
  const paramWarnings: string[] = []
  validateSceneParams(sb, paramWarnings)
  await checkVideoScenes(sb, project)
  // Planned sound effects join audio[] once anchors are resolved (project storyboards only: the
  // mix needs a project). User-written clips are kept; `"autoSfx": false` turns planning off.
  if (project && sb.autoSfx !== false) {
    sb.audio = mergePlannedAudio(sb.audio, planSfx(sb, { fps: sb.fps, userSfx: userSfxMap(project.manifest.media) }))
  }
  await checkAudioClips(sb, project)
  const warnings = [...paramWarnings, ...transcriptWarnings((json as { transcript?: unknown }).transcript, transcript)]
  return { json: obj, sb, dir, ...(project ? { project } : {}), inputs, warnings }
}

async function readMediaRecords(project: Project): Promise<MediaRecord[]> {
  try {
    const j = JSON.parse(await readFile(join(project.dir, 'work', 'media.json'), 'utf8')) as { media?: unknown }
    return Array.isArray(j.media) ? (j.media as MediaRecord[]) : []
  } catch {
    return []
  }
}

/**
 * Project-aware checks of `video` scenes (R1). Without a project, a video scene is refused (its
 * frames come from a project's working copies). With one:
 * - the storyboard fps must be the project fps (frames are indexed at that rate);
 * - `params.media` must be a media id of the manifest with an up-to-date working copy (recorded in
 *   `work/media.json` with the current INGEST_RECIPE and the project fps, file present), else the
 *   user is told to run `mba ingest`;
 * - R6: a video scene has no preroll (its `in` is the media time of its first visible frame);
 * - the last frame the scene shows (`videoLastFrame`) must exist: `in + duration·speed`
 *   may not run past the working copy. The error path is `.in`, or `.speed` when `in` alone fits.
 * Stage 1B: `screen-clip` scenes (`mediaSceneOf`) get the same checks (a `still` needs only its
 * frame at `in`), and their window must fit the safe area at the working copy's aspect.
 */
/** A StoryboardError at `path` whose message is Arabic first: `<ar> — <path>: <en>`. */
function videoError(path: string, ar: string, en: string): StoryboardError {
  const e = new StoryboardError('', `${ar} — ${path}: ${en}`)
  e.path = path
  return e
}

/** The media's working copy is recorded with the current INGEST_RECIPE and project fps, and present. */
function workingCopyFresh(project: Project, m: ProjectMedia, records: readonly MediaRecord[]): boolean {
  const rec = records.find((r) => r.id === m.id)
  return (
    m.work !== undefined &&
    m.durationSec !== undefined &&
    rec !== undefined &&
    rec.recipe === INGEST_RECIPE &&
    rec.fps === project.manifest.fps &&
    rec.work === m.work &&
    existsSync(join(project.dir, m.work))
  )
}

/**
 * Project-aware checks of `audio[]` clips: they need a project; a clip's `media` must be a media
 * id of the manifest (audio or video) with an up-to-date working copy, and `in` must lie inside it.
 */
async function checkAudioClips(sb: Storyboard, project: Project | undefined): Promise<void> {
  if (!sb.audio?.length) return
  if (!project) {
    throw videoError('audio', 'مسار الصوت يحتاج مجلد مشروع (mba-project.json بجانب ملف القصة)', 'audio clips need a project folder (mba-project.json next to the storyboard); create one with mba project init')
  }
  const records = await readMediaRecords(project)
  for (const [i, c] of sb.audio.entries()) {
    if (c.media === undefined) continue
    const m = project.manifest.media.find((x) => x.id === c.media)
    if (!m) {
      const ids = project.manifest.media.map((x) => x.id).join(', ') || '—'
      throw videoError(`audio[${i}].media`, `لا توجد مادة "${c.media}" في المشروع (المتاح: ${ids})`, `no media "${c.media}" in the project (have: ${ids})`)
    }
    if (!workingCopyFresh(project, m, records)) {
      throw videoError(`audio[${i}].media`, `نسخة العمل للمادة ${m.id} غير موجودة أو قديمة؛ شغّل mba ingest`, `the working copy of ${m.id} is missing or out of date; run: mba ingest "${project.dir}"`)
    }
    if (c.in >= m.durationSec!) {
      throw videoError(`audio[${i}].in`, `نقطة البداية in بعد نهاية ${m.id} (${m.durationSec} ث)`, `in (${c.in} s) is past the end of ${m.id} (${m.durationSec} s)`)
    }
  }
}

async function checkVideoScenes(sb: Storyboard, project: Project | undefined): Promise<void> {
  const videos = sb.scenes.map((sc, i) => ({ sc, i, m: mediaSceneOf(sc) })).filter((x) => x.m !== undefined)
  if (videos.length === 0) return
  for (const { sc, i } of videos) {
    if ((sc.preroll ?? 0) > 0) {
      throw videoError(
        `scenes[${i}].preroll`,
        'مشاهد الفيديو لا تقبل preroll: نقطة البداية in هي أول إطار ظاهر',
        'video scenes take no preroll: the in-point is the first visible frame',
      )
    }
  }
  if (!project) {
    throw videoError(`scenes[${videos[0]!.i}].type`, 'مشاهد الفيديو تحتاج مجلد مشروع (mba-project.json بجانب ملف القصة)', 'video scenes need a project folder (mba-project.json next to the storyboard); create one with mba project init')
  }
  const fps = project.manifest.fps
  if (sb.fps !== fps) {
    throw videoError('fps', `معدل إطارات القصة ${sb.fps} يخالف المشروع ${fps}`, `the storyboard fps ${sb.fps} differs from the project fps ${fps}`)
  }
  const records = await readMediaRecords(project)
  for (const { sc, i, m: ms } of videos) {
    const p = ms!
    const m = project.manifest.media.find((x) => x.id === p.media)
    if (!m) {
      const ids = project.manifest.media.map((x) => x.id).join(', ') || '—'
      throw videoError(`scenes[${i}].params.media`, `لا توجد مادة "${p.media}" في المشروع (المتاح: ${ids})`, `no media "${p.media}" in the project (have: ${ids})`)
    }
    if (m.kind === 'audio') {
      throw videoError(`scenes[${i}].params.media`, `المادة ${m.id} صوت فقط ولا يمكن عرضها كفيديو`, `${m.id} is audio-only and cannot be shown as video`)
    }
    if (!workingCopyFresh(project, m, records)) {
      throw videoError(`scenes[${i}].params.media`, `نسخة العمل للمادة ${m.id} غير موجودة أو قديمة؛ شغّل mba ingest`, `the working copy of ${m.id} is missing or out of date; run: mba ingest "${project.dir}"`)
    }
    if (sc.type === 'cutout' && !existsSync(join(project.dir, m.work!.replace(/\.mp4$/i, '.matte.mp4')))) {
      throw videoError(`scenes[${i}].params.media`, `لا يوجد قناع شخص للمادة ${m.id}؛ شغّل mba matte`, `${m.id} has no person matte; run: mba matte "${project.dir}" ${m.id}`)
    }
    const frames = Math.round(m.durationSec! * fps)
    const len = sc.duration
    if (p.lastFrame(len, fps) > frames - 1) {
      if (p.still) {
        throw videoError(`scenes[${i}].params.in`, `الإطار الثابت بعد نهاية ${m.id} (${m.durationSec} ث)`, `the still frame at in = ${p.in} s is past the end of ${m.id} (${m.durationSec} s)`)
      }
      const field = mediaSceneOf({ type: sc.type, params: { ...(sc.params as object), speed: 1 } })!.lastFrame(len, fps) <= frames - 1 && p.speed > 1 ? 'speed' : 'in'
      const need = Math.round((p.in + len * p.speed) * 1000) / 1000
      throw videoError(`scenes[${i}].params.${field}`, `المقطع يتجاوز نهاية ${m.id}: يحتاج حتى ${need} ث والمتاح ${m.durationSec} ث`, `the clip runs past the end of ${m.id}: in + duration·speed = ${need} s, the working copy is ${m.durationSec} s`)
    }
    // Stage 1B: a screen clip's window must fit the safe area for this media's aspect.
    if (sc.type === 'screen-clip') {
      const rec = records.find((r) => r.id === m.id)!
      const w = rec.workInfo?.w ?? 0
      const h = rec.workInfo?.h ?? 0
      if (w > 0 && h > 0) {
        const laid = screenClipLayout(screenClipParams.parse(sc.params), w / h, safeRect(sb.format), FORMAT_SIZE[sb.format].w)
        if ('issue' in laid) throw videoError(`scenes[${i}].params.${laid.issue.path.join('.')}`, laid.issue.ar, laid.issue.en)
      }
    }
  }
}

/**
 * Where each scene type keeps its project images: paths into `params` (`*` = every array entry).
 * Task 9 phone screens, Task 10 app-window screenshots, the profile-card avatar, and the «layers»
 * primitives' logos / icons / avatar.
 */
const SCENE_IMAGE_FIELDS: Record<string, readonly (readonly string[])[]> = {
  phone: [['screen', 'image']],
  'app-window': [['image']],
  'screen-mockup': [['image']],
  'page-flyover': [['image']],
  'photo-grid': [['images', '*']],
  'orb-card': [['from', 'image'], ['to', 'image'], ['centre', 'image'], ['satellites', '*', 'image']],
  'before-after': [['before', 'image'], ['after', 'image']],
  'profile-card': [['avatar']],
  'book-flip': [['image']],
  'photo-look': [['image']],
  'signature-card': [['photo']],
  'logo-row': [['items', '*', 'image']],
  'layer-stack': [['layers', '*', 'icons', '*']],
  'node-graph': [['nodes', '*', 'icon']],
  'chat-thread': [['avatar']],
}

/** Every string at `path` under `root`, with its concrete path (`items[2].image`) and a setter. */
function imageSlots(root: unknown, path: readonly string[]): { at: string; value: string; set: (v: string) => void }[] {
  const out: { at: string; value: string; set: (v: string) => void }[] = []
  const walk = (node: unknown, i: number, at: string, set: (v: unknown) => void) => {
    if (i === path.length) {
      if (typeof node === 'string') out.push({ at, value: node, set })
      return
    }
    const seg = path[i]!
    if (seg === '*') {
      if (!Array.isArray(node)) return
      node.forEach((v, j) => walk(v, i + 1, `${at}[${j}]`, (x) => (node[j] = x)))
      return
    }
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return
    const o = node as Record<string, unknown>
    walk(o[seg], i + 1, `${at}.${seg}`, (x) => (o[seg] = x))
  }
  walk(root, 0, '', () => {})
  return out
}

/**
 * A `signature-card` takes what it leaves out from the creator's brand (brand.json): photo
 * (`avatar`), name, Latin name, tagline, links and colours. The scene's own values win.
 */
export function fillSignatureCards(obj: Record<string, unknown>): void {
  const brand = obj.brand as Brand | undefined
  if (!brand || !Array.isArray(obj.scenes)) return
  obj.scenes = (obj.scenes as unknown[]).map((sc) => {
    const s = sc as { type?: unknown; params?: Record<string, unknown> } | null
    if (s?.type !== 'signature-card') return sc
    const p = { ...(s.params ?? {}) }
    const fill = (k: string, v: unknown) => {
      if (p[k] === undefined && v !== undefined) p[k] = v
    }
    fill('photo', brand.avatar)
    fill('name', brand.name)
    fill('en', brand.nameEn)
    fill('line', brand.tagline)
    fill('lineAccent', brand.taglineAccent)
    fill('links', brand.links)
    fill('colors', brand.colors ? { bg: brand.colors.bg, ink: brand.colors.text, accent: brand.colors.primary } : undefined)
    return { ...s, params: p }
  })
}

/**
 * Task 9: a scene's project images (a `phone`'s `screen.image`, ... see SCENE_IMAGE_FIELDS) that
 * are file paths (relative to the storyboard) are inlined as data URLs, like `brand.logo`, so the
 * page needs no file server and the job hash covers the image bytes. Remote URLs and images over
 * MAX_INLINE_IMAGE_BYTES are refused. Errors carry the param path.
 */
async function inlinePhoneImages(obj: Record<string, unknown>, dir: string): Promise<void> {
  await inlineImagesOf(obj, dir, 'scenes', SCENE_IMAGE_FIELDS)
  await inlineImagesOf(obj, dir, 'transitions', TRANSITION_IMAGE_FIELDS)
}

/** Where transitions keep project images: `profile-grid`'s tiles (the user's own posts). */
const TRANSITION_IMAGE_FIELDS: Record<string, readonly (readonly string[])[]> = {
  'profile-grid': [['tiles', '*']],
}

async function inlineImagesOf(obj: Record<string, unknown>, dir: string, key: 'scenes' | 'transitions', table: Record<string, readonly (readonly string[])[]>): Promise<void> {
  if (!Array.isArray(obj[key])) return
  obj[key] = await Promise.all(
    (obj[key] as unknown[]).map(async (sc, i) => {
      const s = sc as { type?: unknown; params?: unknown } | null
      const fields = typeof s?.type === 'string' && Object.hasOwn(table, s.type) ? table[s.type]! : []
      if (fields.length === 0 || s?.params === null || typeof s?.params !== 'object') return sc
      const params = structuredClone(s.params) as Record<string, unknown>
      let changed = false
      for (const f of fields) {
        for (const slot of imageSlots(params, f)) {
          const at = `${key}[${i}].params${slot.at}`
          const image = slot.value
          if (REMOTE_URL.test(image)) throw remoteImageError(at, s.type === 'phone' ? 'صورة شاشة الجوال' : 'صور المشهد', s.type === 'phone' ? 'a phone screen image' : 'a scene image')
          if (/^data:/i.test(image)) {
            checkInlineSize(image, at, 'صورة الشاشة')
            continue
          }
          const path = isAbsolute(image) ? image : join(dir, image)
          try {
            slot.set(await inlineLogo(path, 'صورة الشاشة', 'Screen image'))
          } catch (e) {
            throw atPath(at, (e as Error).message)
          }
          changed = true
        }
      }
      return changed ? { ...s, params } : sc
    }),
  )
}

/** Remote URLs are refused: V1 is offline, and the job hash must cover the image bytes. */
const REMOTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i
/** Largest image file (bytes) inlined into the storyboard (phone screens, brand logo). */
export const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024

function remoteImageError(path: string, ar: string, en: string): StoryboardError {
  return videoError(path, `لا تُقبل روابط الإنترنت في ${ar}؛ ضع الملف بجانب ملف القصة`, `${en} must be a local file next to the storyboard (no remote URLs: rendering is offline)`)
}

const MB = MAX_INLINE_IMAGE_BYTES / 1024 / 1024
const tooBig = (ar: string, bytes: number) => `${ar} أكبر من ${MB} ميغابايت — the image is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${MB} MB limit`

/** An Arabic-first `<ar> — <en>` message re-thrown at `path` as `<ar> — <path>: <en>`. */
function atPath(path: string, message: string): StoryboardError {
  const k = message.indexOf(' — ')
  return k < 0 ? new StoryboardError(path, message) : videoError(path, message.slice(0, k), message.slice(k + 3))
}

/** A data URL already in the storyboard obeys the same size cap (decoded bytes). */
function checkInlineSize(dataUrl: string, path: string, ar: string): void {
  const comma = dataUrl.indexOf(',')
  const body = comma < 0 ? '' : dataUrl.slice(comma + 1)
  const bytes = /;base64,/i.test(dataUrl.slice(0, comma + 1)) ? Math.floor((body.length * 3) / 4) : body.length
  if (bytes > MAX_INLINE_IMAGE_BYTES) throw atPath(path, tooBig(ar, bytes))
}

async function inlineLogo(path: string, ar = 'الشعار', en = 'Logo'): Promise<string> {
  const mime = LOGO_MIME[extname(path).toLowerCase()]
  if (!mime) {
    throw new Error(`نوع ملف ${ar} غير مدعوم — Unsupported ${en.toLowerCase()} file type (use png, jpg, svg or webp): ${path}`)
  }
  let data: Buffer
  try {
    const st = await stat(path)
    if (st.size > MAX_INLINE_IMAGE_BYTES) throw new Error(tooBig(`ملف ${ar}`, st.size))
    data = await readFile(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`لم يتم العثور على ملف ${ar} — ${en} file not found: ${path}`)
    }
    throw e
  }
  return `data:${mime};base64,${data.toString('base64')}`
}

/** Starts the runtime's Vite dev server (engine/vite.config.ts); port 0 picks a free localhost port. */
export async function startRuntimeServer(
  port = 0,
  /** If set, the page can load this storyboard (brand fallback + logo inlined) at /__sb.json. */
  previewStoryboardPath?: string,
  /** A project storyboard's frame server: its `/__frames/…` middleware is installed. */
  frames?: FrameServer,
): Promise<{ server: ViteDevServer; url: string }> {
  const server = await createServer({
    configFile: VITE_CONFIG,
    plugins: [
      ...(previewStoryboardPath
        ? [storyboardPlugin(() => loadStoryboardFile(previewStoryboardPath)), audioPlugin(() => loadStoryboardFile(previewStoryboardPath))]
        : []),
      ...(frames ? [frames.plugin()] : []),
    ],
    cacheDir: port === 0 ? VITE_CACHE : undefined,
    logLevel: 'error',
    // Tools (render/verify/review) report page errors themselves; only `mba preview` forwards the
    // browser console to the terminal.
    server: { host: '127.0.0.1', port, strictPort: port === 0, hmr: false, forwardConsole: previewStoryboardPath !== undefined },
  })
  await server.listen()
  const addr = server.httpServer?.address() as AddressInfo | null
  if (!addr || typeof addr === 'string') {
    await server.close()
    throw new Error('تعذّر تشغيل خادم المعاينة — Could not start the Vite server')
  }
  return { server, url: `http://127.0.0.1:${addr.port}/` }
}

export interface OpenRenderPageOptions {
  /** Open the page with `?test=1` (test-primitive hook on). Defaults to true when `testPrimitivesSource` is set. */
  test?: boolean
  /**
   * Source of a browser function returning the test primitives (`[{ id: '_x', params?, build }]`).
   * Installed before every navigation as `window.__MBA_TEST_PRIMITIVES__ = (<source>)();`.
   */
  testPrimitivesSource?: string
}

export interface RenderPage {
  page: Page
  sb: Storyboard
  size: { w: number; h: number }
  /**
   * Full reload: navigates the page again (fresh document and JS realm, init scripts re-run) and
   * waits for `__mba.ready` exactly as on open. The stage has then drawn only its initial t = 0.
   */
  reload(): Promise<void>
  /**
   * Every uncaught page error (`pageerror`) since the page opened, across reloads, in order. Errors
   * while loading also fail `openRenderPage`/`reload` fast; later ones (e.g. thrown during a seek
   * outside the awaited update) only land here.
   */
  pageErrors(): string[]
  /** The frame server of a project storyboard (R1); undefined for a plain storyboard. */
  frames?: FrameServer
  /**
   * Extracts the video frames the stage will draw at `times` (`framesNeeded` → `frames.prepare`),
   * so seeking them never waits for on-demand extraction. A no-op without video scenes.
   */
  prepareTimes(times: readonly number[]): Promise<void>
  /**
   * Deletes the extracted video frames of `times` (the reverse of `prepareTimes`), keeping the
   * frames the page draws at t = 0 on every (re)load. Callers that probe a long storyboard prepare
   * and release in batches, so only a batch of frames is ever on disk. A no-op without video scenes.
   */
  releaseTimes(times: readonly number[]): Promise<void>
  /**
   * `seekFrame` on this page. A rejected seek is rethrown Arabic first, without Playwright's
   * wrapping; when it names a frame URL the frame server failed to answer, that failure (with the
   * ffmpeg cause) is attached.
   */
  seek(t: number): Promise<void>
  /** Closes Chromium and the Vite server and releases every extracted frame. Never throws. */
  close(): Promise<void>
}

/**
 * Starts Vite + headless Chromium (viewport = frame size, DPR 1), injects the loaded storyboard and
 * opens the runtime page, waiting for `__mba.ready`. Fails fast on a page error, rejects with the
 * page's `__mba.error` if the storyboard fails to load, and never hangs (30 s ready timeout).
 * Shared by `renderVideo`, `renderStills` and `verifyDeterminism`.
 */
export async function openRenderPage(loaded: LoadedStoryboard, opts: OpenRenderPageOptions = {}): Promise<RenderPage> {
  const { json, sb } = loaded
  const size = FORMAT_SIZE[sb.format]
  const test = opts.test ?? opts.testPrimitivesSource !== undefined
  let server: ViteDevServer | undefined
  let browser: Browser | undefined
  // Own session folder: another tool on the same project never releases this page's frames.
  const frames = loaded.project ? createFrameServer(loaded.project, { session: true }) : undefined
  const prepareTimes = async (times: readonly number[]) => {
    if (frames) await frames.prepare(framesNeeded(sb, times))
  }
  const releaseTimes = async (times: readonly number[]) => {
    if (!frames) return
    const keep = new Set(framesNeeded(sb, [0]).flatMap((r) => Array.from({ length: r.to - r.from + 1 }, (_, k) => `${r.mediaId}/${r.from + k}`)))
    const drop: FrameRange[] = []
    for (const r of framesNeeded(sb, times)) {
      for (let n = r.from; n <= r.to; n++) if (!keep.has(`${r.mediaId}/${n}`)) drop.push({ mediaId: r.mediaId, from: n, to: n })
    }
    if (drop.length) await frames.release(drop)
  }
  const close = async () => {
    await browser?.close().catch(() => {})
    await server?.close().catch(() => {})
    await frames?.release().catch(() => {})
  }
  try {
    // The page draws t = 0 while loading (and on every reload).
    await prepareTimes([0])
    const started = await startRuntimeServer(0, undefined, frames)
    server = started.server
    const url = test ? `${started.url}?test=1` : started.url
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    const pageErrors: string[] = []
    const allPageErrors: string[] = []
    const consoleErrors: string[] = []
    let failFast: (e: Error) => void = () => {}
    page.on('pageerror', (err) => {
      pageErrors.push(err.message)
      allPageErrors.push(err.message)
      failFast(new Error(`خطأ في صفحة العرض — The runtime page threw: ${err.message}`))
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    await page.addInitScript((sbJson) => {
      window.__MBA_STORYBOARD__ = sbJson
    }, json)
    if (opts.testPrimitivesSource !== undefined) {
      await page.addInitScript({ content: `window.__MBA_TEST_PRIMITIVES__ = (${opts.testPrimitivesSource})();` })
    }

    const load = async () => {
      pageErrors.length = 0
      consoleErrors.length = 0
      const failed = new Promise<never>((_, reject) => (failFast = reject))
      failed.catch(() => {})
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const details = [...pageErrors, ...consoleErrors].join(' | ') || 'no page errors reported'
          reject(new Error(`انتهت مهلة تجهيز المشهد — The runtime did not become ready within ${READY_TIMEOUT_MS / 1000} s: ${details}`))
        }, READY_TIMEOUT_MS)
      })
      try {
        await Promise.race([
          (async () => {
            await page.goto(url, { waitUntil: 'load' })
            await page.waitForFunction(() => typeof window.__mba === 'object', null, { timeout: READY_TIMEOUT_MS })
            await page.evaluate(() => window.__mba.ready)
          })(),
          failed,
          timeout,
        ])
      } finally {
        clearTimeout(timer)
        failFast = () => {}
      }
      const error = await page.evaluate(() => window.__mba.error)
      if (error) throw new Error(`تعذّر تحميل القصة في المتصفح — The storyboard failed to load: ${error}`)
    }

    await load()
    const seek = async (t: number) => {
      try {
        await seekFrame(page, t)
      } catch (e) {
        throw seekError(e, frames)
      }
    }
    return { page, sb, size, reload: load, pageErrors: () => [...allPageErrors], ...(frames ? { frames } : {}), prepareTimes, releaseTimes, seek, close }
  } catch (e) {
    await close()
    throw e
  }
}

/**
 * The error of a rejected seek, for the user: the page's own message (Arabic first for the video
 * primitive) without Playwright's `page.evaluate:` prefix and call log, plus the frame server's
 * recorded failure for the frame URL it names, if any.
 */
export function seekError(e: unknown, frames?: FrameServer): Error {
  const raw = e instanceof Error ? e.message : String(e)
  const msg = raw.replace(/^page\.evaluate:\s*/, '').replace(/^Error:\s*/, '').split('\n')[0]!.trim()
  const url = /\/__frames\/m[1-9]\d*\/\d+\.jpg/.exec(msg)?.[0]
  const cause = url ? frames?.failureFor(url) : undefined
  const head = /^[؀-ۿ]/.test(msg) ? msg : `تعذّر رسم الإطار — Could not draw the frame: ${msg}`
  return new Error(cause ? `${head} — السبب — cause: ${cause}` : head)
}

/**
 * Seeks and waits until the frame is fully drawn (`__mba.seek` resolves after async updates), then
 * makes the next paint a fresh one: `#frame` is taken out of layout and put back, so Chromium
 * rebuilds its layout objects, paint and layers from the current DOM. Without this, Chromium can
 * reuse paint/raster state from earlier frames, and text (e.g. slam's tag pill) lands a sub-pixel
 * apart depending on seek history and machine load. Caught by `mba verify`; frames now equal a
 * fresh page's. Used by renderVideo, renderStills and verifyDeterminism alike.
 */
export async function seekFrame(page: Page, t: number): Promise<void> {
  await page.evaluate(async (tt) => {
    await window.__mba.seek(tt)
    const frame = document.getElementById('frame')
    if (frame) {
      const prev = frame.style.display
      frame.style.display = 'none'
      void frame.offsetHeight
      frame.style.display = prev
    }
  }, t)
}

function stderrTail(chunks: string[]): string {
  return chunks.join('').trim().slice(-2000)
}

/** Default chunk length of a project render (s). */
export const DEFAULT_CHUNK_SEC = 10
/** The first time estimate is shown after this many rendered frames. */
export const ETA_AFTER_FRAMES = 60
/**
 * Version of the project render recipe (encoder settings, chunk files, audio mux). Part of a
 * job's hash: an unfinished render of another recipe is never resumed. Bump on any change.
 * 2: JPEG final capture, BT.709 conversion and tags, audio fades + limiter.
 * 3: word-anchored timing; transcript, marks and audio inputs in the job hash.
 * 4: audio track: voice/music/SFX buses, ducking, limiter 0.89, two-pass −14 LUFS loudnorm.
 * 5: planned SFX (cue planner) and planned audio in the job hash.
 * 6: loudnorm true-peak target −1.5 dBTP (LOUDNORM_TP), under verify's −1 dBTP limit.
 * 7: audio cut by sample count, pass-2 peak limit so loudnorm stays linear, muxed frame count checked (I1).
 * 8: the one-world camera (Plan 2a+ Task 6): it changes how every chunk is drawn, so cached chunks invalidate.
 * 9: the living camera (Plan 3 Task 4): handheld drift, hit shakes and per-scene depth wrappers.
 */
export const RENDER_RECIPE = 9

const ENGINE_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version?: unknown }
    return String(pkg.version ?? 'unknown')
  } catch {
    return 'unknown'
  }
})()

/** Frames `from..to` (inclusive) of a render, written as `chunk-<index>.mp4`. */
export interface ChunkPlan {
  index: number
  from: number
  to: number
  frames: number
}

/** Splits `total` frames into chunks of `chunkFrames` (the last one shorter). */
export function planChunks(total: number, chunkFrames: number): ChunkPlan[] {
  const out: ChunkPlan[] = []
  for (let from = 0, index = 0; from < total; from += chunkFrames, index++) {
    const to = Math.min(total, from + chunkFrames) - 1
    out.push({ index, from, to, frames: to - from + 1 })
  }
  return out
}

/** Seconds as `M:SS` (rounded to the second). */
export function formatEta(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The time-estimate line, Arabic first: `الوقت المتبقي تقريباً ~ M:SS — about M:SS left`. */
export function etaLine(sec: number): string {
  const t = formatEta(sec)
  return `الوقت المتبقي تقريباً ~ ${t} — about ${t} left`
}

export interface ChunkEvent {
  index: number
  /** Number of chunks of the render. */
  count: number
  frames: number
  /** Already done by an earlier (interrupted) run of the same job. */
  skipped: boolean
}

export interface RenderStart {
  outPath: string
  /** `v001-draft`, … for a versioned project render. */
  version?: string
  /** An unfinished render of the same job is being continued. */
  resumed: boolean
  chunks: number
  frames: number
}

export interface RenderResult extends RenderStart {
  /** Chunks taken over from the interrupted run. */
  skipped: number
}

export interface RenderVideoOptions {
  storyboardPath: string
  /**
   * Output file. Required for a plain storyboard. For a project storyboard (R1) it may be left out:
   * the render is then the project's next version `renders/vNNN-<draft|final>.mp4`, logged in log.md.
   */
  outPath?: string
  fps?: 30 | 60
  draft?: boolean
  /** Project renders: chunk length in seconds (default 10; rounded to whole frames). */
  chunkSec?: number
  onProgress?: (done: number, total: number) => void
  /** Frame-server statistics, reported once all frames are drawn (project storyboards only). */
  onFrames?: (stats: FrameServerStats) => void
  /** Project renders: the output and whether an interrupted render is resumed, before any frame. */
  onStart?: (s: RenderStart) => void
  /** Project renders: after each chunk (done now, or skipped because an earlier run finished it). */
  onChunk?: (e: ChunkEvent) => void
  /** Project renders: the time estimate after the first ETA_AFTER_FRAMES frames, then after each chunk. */
  onEta?: (line: string, secondsLeft: number) => void
  /** Arabic-first warnings: the storyboard's (`LoadedStoryboard.warnings`) and the audio track's. */
  onWarning?: (message: string) => void
}

/**
 * JPEG quality of final frames. A PNG capture cost ~165 ms per footage frame against ~34 ms for a
 * JPEG (final review); at this quality the JPEG step is far below x264 crf 18's own loss.
 */
export const FINAL_JPEG_QUALITY = 95
/** JPEG quality of draft frames. */
export const DRAFT_JPEG_QUALITY = 80

/** How a frame is captured: always JPEG (deterministic: the same pixels give the same bytes). */
export function captureOptions(draft: boolean): { type: 'jpeg'; quality: number } {
  return { type: 'jpeg', quality: draft ? DRAFT_JPEG_QUALITY : FINAL_JPEG_QUALITY }
}

/**
 * ffmpeg argv encoding the captured JPEG frames (stdin) to `out`: libx264 crf 18, yuv420p.
 * Chromium writes JPEG as JFIF (BT.601 full range); the frames are converted to BT.709 limited
 * range and the stream is tagged so, which is what players assume for HD video. Draft: half size,
 * each side rounded down to even (yuv420p): 1080×1350 (4:5) → 540×674.
 */
export function buildEncodeArgs(o: { fps: number; draft: boolean; out: string; blurSamples?: number }): string[] {
  // Motion blur: the frames arrive as `S` sub-frames per frame; tmix averages each group, the last
  // frame of every group is kept, and the timestamps are put back on the frame grid.
  const S = o.blurSamples && o.blurSamples > 1 ? o.blurSamples : 1
  const blur = S > 1 ? `tmix=frames=${S},select='eq(mod(n\\,${S})\\,${S - 1})',setpts=N/(${o.fps}*TB),` : ''
  const colour = 'in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv:flags=bicubic+accurate_rnd+full_chroma_int'
  const scale = o.draft ? `scale=trunc(iw/4)*2:trunc(ih/4)*2:${colour}` : `scale=${colour}`
  return [
    '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(o.fps * S), '-i', '-',
    '-vf', `${blur}${scale},format=yuv420p,${SET_BT709}`,
    ...(S > 1 ? ['-r', String(o.fps)] : []),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', o.out,
  ]
}

/**
 * Seeks and screenshots frames `from..to` (JPEG, `captureOptions`) and pipes them into one ffmpeg
 * (`buildEncodeArgs`) writing `out`.
 */
/** The moments one frame is made of: the frame time, or with motion blur `samples` moments over the shutter. */
export function frameMoments(i: number, fps: number, blur?: { samples: number; shutter: number }): number[] {
  const t = frameToTime(i, fps)
  if (!blur || blur.samples < 2) return [t]
  const open = blur.shutter / 360 / fps
  return Array.from({ length: blur.samples }, (_, k) => Math.max(0, t - open / 2 + (open * k) / (blur.samples - 1)))
}

async function encodeFrames(
  session: RenderPage,
  o: { fps: number; draft: boolean; from: number; to: number; out: string; blur?: { samples: number; shutter: number } },
  onFrame: () => void,
): Promise<void> {
  const { page, size } = session
  const proc = spawn(resolveFfmpeg(), buildEncodeArgs({ ...o, ...(o.blur ? { blurSamples: o.blur.samples } : {}) }), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  try {
    const stderr: string[] = []
    let stderrLen = 0
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      stderr.push(d)
      stderrLen += d.length
      while (stderrLen > 16_000 && stderr.length > 1) stderrLen -= stderr.shift()!.length
    })
    proc.stdout.resume()
    proc.stdin.on('error', () => {}) // EPIPE when ffmpeg exits early; reported via `exited` below.
    const exited = new Promise<{ code: number | null; error?: Error }>((res) => {
      proc.once('error', (error) => res({ code: null, error }))
      proc.once('close', (code) => res({ code }))
    })
    let exitInfo: { code: number | null; error?: Error } | undefined
    void exited.then((x) => (exitInfo = x))
    const ffmpegFailed = (x: { code: number | null; error?: Error }) =>
      new Error(`فشل ffmpeg في إنشاء الفيديو — ffmpeg failed (${x.error ? x.error.message : `exit code ${x.code}`}): ${stderrTail(stderr)}`)

    for (let i = o.from; i <= o.to; i++) {
      for (const t of frameMoments(i, o.fps, o.blur)) {
        await session.seek(Math.max(0, t))
        const buf = await page.screenshot({ clip: { x: 0, y: 0, width: size.w, height: size.h }, ...captureOptions(o.draft), caret: 'hide' })
        if (exitInfo) throw ffmpegFailed(exitInfo)
        if (!proc.stdin.write(buf)) {
          const r = await Promise.race([new Promise<'drain'>((res) => proc.stdin.once('drain', () => res('drain'))), exited])
          if (r !== 'drain') throw ffmpegFailed(r)
        }
      }
      onFrame()
    }
    proc.stdin.end()
    const x = await exited
    if (x.error || x.code !== 0) throw ffmpegFailed(x)
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill()
  }
}

/**
 * Renders the storyboard frame by frame (seek → JPEG screenshot) into ffmpeg (`buildEncodeArgs`).
 * Draft mode: JPEG q80 frames, downscaled to half resolution by ffmpeg.
 *
 * A plain storyboard is written in one pass to `outPath` (video only), as before.
 *
 * A project storyboard (R1) is rendered in resumable chunks (see `renderProject`), with the media
 * audio muxed in. Without `outPath` the result is the project's next version.
 */
export async function renderVideo(o: RenderVideoOptions): Promise<RenderResult> {
  const loaded = await loadStoryboardFile(o.storyboardPath)
  for (const w of loaded.warnings) o.onWarning?.(w)
  if (loaded.project) return renderProject(o, loaded, loaded.project)
  if (o.outPath === undefined) {
    throw new Error('مسار الفيديو الناتج مطلوب لقصة خارج مشروع — An output path is required for a storyboard outside a project')
  }
  const outPath = resolve(o.outPath)
  const session = await openRenderPage(loaded)
  try {
    const fps = o.fps ?? session.sb.fps
    const total = frameCount(storyboardDuration(session.sb), fps)
    await mkdir(dirname(outPath), { recursive: true })
    let done = 0
    await encodeFrames(session, { fps, draft: o.draft ?? false, from: 0, to: total - 1, out: outPath, ...(session.sb.motionBlur ? { blur: session.sb.motionBlur } : {}) }, () => {
      done++
      o.onProgress?.(done, total)
    })
    return { outPath, resumed: false, chunks: 1, frames: total, skipped: 0 }
  } finally {
    await session.close()
  }
}

/** `<tmp>/mba/<project id>/parts/<name>/job.json`: what an unfinished render was making. */
interface JobFile {
  version: 1
  /** sha1 of the storyboard as rendered (brand inlined), engine version, render recipe, options, media. */
  hash: string
  kind: RenderKind
  fps: number
  draft: boolean
  chunkFrames: number
  total: number
  /** Absolute output path. */
  out: string
}

const VERSION_DIR = /^v(\d+)-(draft|final)$/
const JOB_FILE = 'job.json'
const JOB_LOCK = 'job.lock'

async function readJob(dir: string): Promise<JobFile | null> {
  try {
    const j = JSON.parse(await readFile(join(dir, JOB_FILE), 'utf8')) as JobFile
    return j && j.version === 1 && typeof j.hash === 'string' ? j : null
  } catch {
    return null
  }
}

/** Who holds a job folder: `job.lock` is `{"pid":…,"host":…}` (the host is information only). */
export interface JobLock {
  pid: number
  host: string
}

/** Parses a `job.lock`; a legacy lock holding only a pid parses too. Null when unreadable. */
export function parseJobLock(text: string): JobLock | null {
  const t = text.trim()
  if (/^\d+$/.test(t)) return { pid: Number(t), host: hostname() }
  try {
    const j = JSON.parse(t) as Partial<JobLock>
    if (Number.isInteger(j.pid) && (j.pid as number) > 0 && typeof j.host === 'string') return { pid: j.pid as number, host: j.host }
  } catch {
    // Unreadable: see lockState.
  }
  return null
}

/** An empty or unreadable lock younger than this counts as live (another process may be writing it). */
export const LOCK_GRACE_MS = 10_000

/**
 * Whether a lock (its text, and its age in ms) is held. Judged by pid only: job folders live in
 * the machine-local temp folder, so a different host name in a lock only means this machine was
 * renamed (macOS does so with the network); the host is never a reason to keep a lock.
 */
export function lockState(text: string, ageMs: number, alive: (pid: number) => boolean = pidAlive): 'free' | 'live' {
  const lock = parseJobLock(text)
  if (!lock) return ageMs < LOCK_GRACE_MS ? 'live' : 'free'
  return alive(lock.pid) ? 'live' : 'free'
}

let lockCounter = 0

/**
 * Creates `lock` with `text` atomically and never over an existing one: the text is written to a
 * temp file first, then hard-linked to `lock` (link fails with EEXIST when it exists), so no other
 * process ever sees a half-written lock. Falls back to open 'wx' where hard links are not
 * supported. Returns false when the lock exists.
 */
async function createLock(lock: string, text: string): Promise<boolean> {
  const tmp = `${lock}.${process.pid}-${++lockCounter}.tmp`
  try {
    await writeFile(tmp, text, { flag: 'wx' })
  } catch (e) {
    throw couldNotWrite(lock, e)
  }
  try {
    await link(tmp, lock)
    return true
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return false
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV' && code !== 'ENOSYS') throw couldNotWrite(lock, e)
    try {
      await writeFile(lock, text, { flag: 'wx' })
      return true
    } catch (e2) {
      if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw couldNotWrite(lock, e2)
    }
  } finally {
    await rmWithRetry(tmp).catch(() => {})
  }
}

/** Reads a lock's text and age (ms); null when it is gone. */
async function readLock(lock: string): Promise<{ text: string; ageMs: number } | null> {
  try {
    const [text, st] = await Promise.all([readFile(lock, 'utf8'), stat(lock)])
    return { text, ageMs: Date.now() - st.mtimeMs }
  } catch {
    return null
  }
}

/**
 * Takes the job folder for this process: creates `job.lock` (`createLock`) holding our pid (and
 * host, as information). A lock whose process is gone is taken over: it is first renamed to a name
 * of our own, so of two processes taking over the same stale lock only one can; if what we renamed
 * turns out to be a live lock (taken meanwhile), it is put back and the job counts as busy.
 */
async function claimJob(dir: string): Promise<boolean> {
  const lock = join(dir, JOB_LOCK)
  const mine = JSON.stringify({ pid: process.pid, host: hostname() })
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await createLock(lock, mine)) return true
    const held = await readLock(lock)
    if (!held) continue // released meanwhile
    if (lockState(held.text, held.ageMs) === 'live') return false
    const stale = `${lock}.stale-${process.pid}-${++lockCounter}`
    try {
      await rename(lock, stale)
    } catch {
      continue // someone else took it over first
    }
    const took = await readLock(stale)
    if (took && lockState(took.text, took.ageMs) === 'live') {
      await link(stale, lock).catch(() => {})
      await rmWithRetry(stale).catch(() => {})
      return false
    }
    await rmWithRetry(stale).catch(() => {})
  }
  return false
}

/** The Arabic-first refusal for a busy explicit-output job. */
function busyError(outPath: string): Error {
  return new Error(`عرض آخر يكتب هذا الملف الآن — Another render is writing ${outPath} right now`)
}

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

/** What a job hash covers. */
export interface JobHashInput {
  engine: string
  recipe: number
  /** First line of `ffmpeg -version`: another ffmpeg build may encode differently. */
  ffmpeg: string
  sb: unknown
  fps: number
  draft: boolean
  chunkFrames: number
  media: unknown[]
  /** sha1 of `transcript.json` bytes (null without one). */
  transcript: string | null
  /** sha1 of `marks.json` bytes (null without one). */
  marks: string | null
  /** Every clip input of the audio mix and its hash (`audioHashInputs`). */
  audio: { id: string; hash: string }[]
  /** The storyboard's `audio[]` as mixed: the file's clips merged with the planned SFX and dips. */
  audioClips?: unknown[]
}

/** sha1 of a job's inputs (pure). */
export function jobHashOf(x: JobHashInput): string {
  return sha1(
    JSON.stringify({
      engine: x.engine,
      recipe: x.recipe,
      ffmpeg: x.ffmpeg,
      sb: x.sb,
      fps: x.fps,
      draft: x.draft,
      chunkFrames: x.chunkFrames,
      media: x.media,
      transcript: x.transcript,
      marks: x.marks,
      audio: x.audio,
      audioClips: x.audioClips ?? [],
    }),
  )
}

/**
 * The job hash: the storyboard as rendered + engine version + render recipe + ffmpeg build + options
 * + the working copies used + the transcript and marks bytes + every audio clip input.
 */
async function jobHash(loaded: LoadedStoryboard, project: Project, opts: { fps: number; draft: boolean; chunkFrames: number }): Promise<string> {
  const used = new Set(loaded.sb.scenes.flatMap((sc) => mediaSceneOf(sc)?.media ?? []))
  const records = await readMediaRecords(project)
  const media = records
    .filter((r) => used.has(r.id))
    .map((r) => ({ id: r.id, sourceHash: r.sourceHash, recipe: r.recipe, fps: r.fps, work: r.work }))
    .sort((a, b) => a.id.localeCompare(b.id))
  // A remade person matte changes every cutout frame: its size and time stamp join the hash.
  const mattes = [...new Set(loaded.sb.scenes.filter((sc) => sc.type === 'cutout').map((sc) => mediaSceneOf(sc)!.media))].sort().map((id) => {
    const work = project.manifest.media.find((m) => m.id === id)?.work
    const f = work ? join(project.dir, work.replace(/\.mp4$/i, '.matte.mp4')) : ''
    const st = f && existsSync(f) ? statSync(f) : undefined
    return { id, size: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 }
  })
  return jobHashOf({ engine: ENGINE_VERSION, recipe: RENDER_RECIPE, ffmpeg: await ffmpegVersionLine(), sb: loaded.json, ...opts, media, ...(mattes.length ? { mattes } : {}), ...loaded.inputs, audio: audioHashInputs(loaded.sb, records), audioClips: loaded.sb.audio ?? [] })
}

interface OpenedJob {
  dir: string
  out: string
  version?: string
  resumed: boolean
}

/**
 * Finds or creates the job folder of a project render under `<tmp>/mba/<project id>/parts/`
 * (`partsDirOf`: outside the possibly synced project folder).
 * - Explicit `outPath`: the folder `out-<sha1(outPath)>`. Its lock is taken first (open 'wx'), so
 *   of two renders of one file only one ever touches the folder; then it is resumed when its job
 *   hash matches, otherwise emptied and started afresh.
 * - Versioned: the newest unfinished `v<N>-<kind>` whose job hash matches (and whose output does
 *   not exist yet) is resumed. Otherwise a new version is reserved atomically: `mkdir` of
 *   `.parts/<nextVersion>` fails with EEXIST when another render took that name first (then the
 *   next name is tried), and `job.json` is created with open 'wx'.
 */
async function openJob(project: Project, job: Omit<JobFile, 'version' | 'out'>, outPath?: string): Promise<OpenedJob> {
  const parts = partsDirOf(project)
  await fsStep('تعذّر إنشاء المجلد', 'Could not create the folder', parts, () => mkdir(parts, { recursive: true }))
  const writeJob = (dir: string, out: string) => {
    const j: JobFile = { version: 1, ...job, out }
    return fsStep('تعذّر حفظ الملف', 'Could not write', join(dir, JOB_FILE), () => writeFile(join(dir, JOB_FILE), JSON.stringify(j, null, 2) + '\n', { flag: 'wx' }))
  }
  const create = async (dir: string, out: string) => {
    await writeJob(dir, out)
    if (!(await claimJob(dir))) throw new Error(`تعذّر حجز مجلد العرض — Could not lock the render folder ${dir}`)
  }

  if (outPath !== undefined) {
    const dir = join(parts, `out-${sha1(outPath).slice(0, 12)}`)
    await fsStep('تعذّر إنشاء المجلد', 'Could not create the folder', dir, () => mkdir(dir, { recursive: true }))
    // Lock first: nothing in the folder is read or removed before this process owns it.
    if (!(await claimJob(dir))) throw busyError(outPath)
    const j = await readJob(dir)
    if (j && j.hash === job.hash && j.out === outPath) return { dir, out: outPath, resumed: true }
    const names = await fsStep('تعذّر قراءة المجلد', 'Could not read the folder', dir, () => readdir(dir))
    for (const name of names) if (name !== JOB_LOCK) await rmWithRetry(join(dir, name))
    await writeJob(dir, outPath)
    return { dir, out: outPath, resumed: false }
  }

  const candidates: { n: number; name: string }[] = []
  const names = await fsStep('تعذّر قراءة المجلد', 'Could not read the folder', parts, () => readdir(parts))
  for (const name of names) {
    const m = VERSION_DIR.exec(name)
    if (!m || m[2] !== job.kind) continue
    if (existsSync(join(project.dir, 'renders', `${name}.mp4`))) {
      // Finished, but the process died before removing its parts: clean up (unless still running).
      if (await claimJob(join(parts, name))) await rmWithRetry(join(parts, name))
      continue
    }
    const j = await readJob(join(parts, name))
    if (j?.hash === job.hash) candidates.push({ n: Number(m[1]), name })
  }
  for (const { name } of candidates.sort((a, b) => b.n - a.n)) {
    const dir = join(parts, name)
    if (await claimJob(dir)) return { dir, out: join(project.dir, 'renders', `${name}.mp4`), version: name, resumed: true }
  }
  for (let attempt = 0; attempt < 1000; attempt++) {
    const name = basename(nextVersion(project, job.kind), '.mp4')
    const dir = join(parts, name)
    try {
      await mkdir(dir)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw couldNotWrite(dir, e)
    }
    const out = join(project.dir, 'renders', `${name}.mp4`)
    await create(dir, out)
    return { dir, out, version: name, resumed: false }
  }
  throw new Error(`تعذّر حجز رقم إصدار — Could not reserve a version name in ${parts}`)
}

function runFfmpegIn(args: string[], cwd: string): Promise<{ code: number | null; stderr: string; error?: Error }> {
  return new Promise((res) => {
    const proc = spawn(resolveFfmpeg(), args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => (stderr = (stderr + d).slice(-3000)))
    proc.once('error', (error) => res({ code: null, stderr, error }))
    proc.once('close', (code) => res({ code, stderr }))
  })
}

async function ffmpegStep(ar: string, en: string, args: string[], cwd: string): Promise<void> {
  const r = await runFfmpegIn(args, cwd)
  if (r.error || r.code !== 0) throw new Error(`${ar} — ${en} (${r.error ? r.error.message : `exit code ${r.code}`}): ${r.stderr.trim().slice(-1500)}`)
}

const chunkName = (i: number) => `chunk-${String(i).padStart(3, '0')}`

/** A chunk finished by an earlier run: `.done` names its frame count, and ffprobe counts as many. */
async function chunkDone(dir: string, c: ChunkPlan): Promise<boolean> {
  const done = join(dir, `${chunkName(c.index)}.done`)
  const mp4 = join(dir, `${chunkName(c.index)}.mp4`)
  if (!existsSync(done) || !existsSync(mp4)) return false
  const text = (await readFile(done, 'utf8').catch(() => '')).trim()
  if (text !== String(c.frames)) return false
  const info = await probeVideo(mp4).catch(() => null)
  return info?.frames === c.frames
}

/**
 * The chunked, resumable render of a project storyboard:
 * 1. job: resume the newest unfinished render of the same job (`<parts>/<version>/job.json`
 *    with the same hash), or reserve the next version (see `openJob`);
 * 2. per chunk of `chunkSec`: a chunk whose `.done` and ffprobe frame count match is skipped;
 *    otherwise its leftovers are deleted, its frames prepared (frame server, own session folder),
 *    rendered to `chunk-<NNN>.mp4` (video only), `chunk-<NNN>.done` written (frame count) and
 *    its frames released, so at most one chunk of frames is on disk;
 * 3. concat (demuxer, `-c copy`), audio track (`buildAudioTrack`: mix, two-pass −14 LUFS, exactly frames/fps long), mux
 *    (`-c:v copy -c:a aac -b:a 256k -shortest +faststart`) to a temp file renamed onto the output;
 * 4. the job folder is removed and, for a version, a log.md entry appended.
 */
async function renderProject(o: RenderVideoOptions, loaded: LoadedStoryboard, project: Project): Promise<RenderResult> {
  const { sb } = loaded
  const fps = o.fps ?? sb.fps
  const draft = o.draft ?? false
  const kind: RenderKind = draft ? 'draft' : 'final'
  const chunkSec = o.chunkSec ?? DEFAULT_CHUNK_SEC
  if (!(Number.isFinite(chunkSec) && chunkSec > 0)) {
    throw new Error(`طول القطعة يجب أن يكون رقمًا موجبًا — The chunk length must be a positive number of seconds, got ${chunkSec}`)
  }
  const total = frameCount(storyboardDuration(sb), fps)
  const chunkFrames = Math.max(1, Math.round(chunkSec * fps))
  const plan = planChunks(total, chunkFrames)
  const hash = await jobHash(loaded, project, { fps, draft, chunkFrames })
  const job = await openJob(project, { hash, kind, fps, draft, chunkFrames, total }, o.outPath === undefined ? undefined : resolve(o.outPath))
  const { dir } = job
  const start: RenderStart = { outPath: job.out, ...(job.version ? { version: job.version } : {}), resumed: job.resumed, chunks: plan.length, frames: total }
  o.onStart?.(start)
  let skipped = 0
  try {
    // Leftovers of an interrupted finish.
    for (const f of ['concat.txt', 'video.mp4', 'mix.wav', 'audio.wav']) await rmWithRetry(join(dir, f))

    const session = await openRenderPage(loaded)
    try {
      let rendered = 0
      let done = 0
      let t0: number | undefined
      let etaOn = false
      const eta = () => {
        const rate = rendered / ((performance.now() - t0!) / 1000)
        const left = rate > 0 ? (total - done) / rate : 0
        o.onEta?.(etaLine(left), left)
      }
      for (const c of plan) {
        const mp4 = join(dir, `${chunkName(c.index)}.mp4`)
        const doneFile = join(dir, `${chunkName(c.index)}.done`)
        if (await chunkDone(dir, c)) {
          skipped++
          done += c.frames
          o.onProgress?.(done, total)
          o.onChunk?.({ index: c.index, count: plan.length, frames: c.frames, skipped: true })
          continue
        }
        await rmWithRetry(doneFile)
        await rmWithRetry(mp4)
        t0 ??= performance.now()
        await session.prepareTimes(Array.from({ length: c.frames }, (_, k) => frameMoments(c.from + k, fps, session.sb.motionBlur)).flat().map((t) => Math.max(0, t)))
        await encodeFrames(session, { fps, draft, from: c.from, to: c.to, out: mp4, ...(session.sb.motionBlur ? { blur: session.sb.motionBlur } : {}) }, () => {
          rendered++
          done++ // not inside o.onProgress?.(…): optional chaining would skip the increment
          o.onProgress?.(done, total)
          if (!etaOn && rendered === ETA_AFTER_FRAMES) {
            etaOn = true
            eta()
          }
        })
        await writeFileAtomic(doneFile, `${c.frames}\n`)
        await session.frames?.release()
        o.onChunk?.({ index: c.index, count: plan.length, frames: c.frames, skipped: false })
        if (etaOn && done < total) eta()
      }
      if (session.frames) o.onFrames?.(session.frames.stats())
    } finally {
      await session.close()
    }

    // Finish: concat, audio, mux.
    await writeFile(join(dir, 'concat.txt'), plan.map((c) => `file '${chunkName(c.index)}.mp4'`).join('\n') + '\n')
    await ffmpegStep('تعذّر دمج القطع', 'ffmpeg could not join the chunks', ['-v', 'error', '-nostdin', '-y', '-f', 'concat', '-i', 'concat.txt', '-c', 'copy', '-f', 'mp4', 'video.mp4'], dir)
    const joined = await probeVideo(join(dir, 'video.mp4'))
    if (joined.frames !== total) {
      throw new Error(`عدد إطارات الفيديو المدموج غير صحيح — The joined video has ${joined.frames} frames, expected ${total}`)
    }
    const track = await buildAudioTrack(project, sb, join(dir, 'audio.wav'), total / fps, { synth: (name, variant, len) => sfxWav(project.dir, name, variant, len) })
    for (const w of track.warnings) o.onWarning?.(w)
    await mkdir(dirname(job.out), { recursive: true })
    const tmp = `${job.out}.${process.pid}.part`
    try {
      await ffmpegStep(
        'تعذّر دمج الصوت مع الفيديو',
        'ffmpeg could not mux the audio',
        ['-v', 'error', '-nostdin', '-y', '-i', 'video.mp4', '-i', 'audio.wav', '-map', '0:v:0', '-map', '1:a:0',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', '-f', 'mp4', tmp],
        dir,
      )
      // I1: `-shortest` drops video frames when the audio is short; never ship a render that lost any.
      const muxed = await probeVideo(tmp)
      if (muxed.frames !== total) {
        throw new Error(`عدد إطارات الفيديو بعد دمج الصوت غير صحيح — The muxed render has ${muxed.frames} frames, expected ${total} (the audio track is shorter than the video?)`)
      }
      await renameWithRetry(tmp, job.out)
    } finally {
      await rm(tmp, { force: true }).catch(() => {})
    }
    await rmWithRetry(dir)
    await rmdir(dirname(dir)).catch(() => {}) // `parts`, once empty
    await removeProjectTempIfEmpty(project)
    if (job.version) {
      const rel = `renders/${job.version}.mp4`
      const secs = Number((total / fps).toFixed(3))
      await appendLog(project, {
        action: 'render',
        details: `${rel} (${kind}, ${secs} s, ${total} frames, ${plan.length} chunks${skipped ? `, ${skipped} resumed` : ''})`,
      })
    }
    return { ...start, skipped }
  } finally {
    await rmWithRetry(join(dir, JOB_LOCK)).catch(() => {})
  }
}

export interface RenderStillsOptions {
  storyboardPath: string
  times: number[]
  outDir: string
  /** Frame-server statistics after the stills (project storyboards only). */
  onFrames?: (stats: FrameServerStats) => void
}

/** Writes one PNG per time as `<outDir>/still-<t>.png` and returns the paths. */
export async function renderStills(o: RenderStillsOptions): Promise<string[]> {
  for (const t of o.times) {
    if (!Number.isFinite(t) || t < 0) throw new Error(`وقت غير صالح — Invalid still time: ${t}`)
  }
  const outDir = resolve(o.outDir)
  const session = await openRenderPage(await loadStoryboardFile(o.storyboardPath))
  try {
    await mkdir(outDir, { recursive: true })
    const { page, size } = session
    await session.prepareTimes(o.times)
    const paths: string[] = []
    for (const t of o.times) {
      await session.seek(t)
      const buf = await page.screenshot({ clip: { x: 0, y: 0, width: size.w, height: size.h }, type: 'png', caret: 'hide' })
      const p = join(outDir, `still-${t}.png`)
      await writeFile(p, buf)
      paths.push(p)
    }
    if (session.frames) o.onFrames?.(session.frames.stats())
    return paths
  } finally {
    await session.close()
  }
}
