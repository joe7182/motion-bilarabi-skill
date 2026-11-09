import { z } from 'zod'
import { FORMATS } from './types'
import { formatPath } from './brand'

/**
 * The project folder (spec §16.2), DOM-free so Node and later tools share one schema:
 *
 *   <dir>/mba-project.json   this manifest (marker: the tool created this folder)
 *   <dir>/source/            copies of the user's media, read-only, never modified
 *   <dir>/work/              normalized working copies
 *   <dir>/renders/           v001-draft.mp4, v002-final.mp4, …
 *   <dir>/review/            critique kits
 *   <dir>/edit.json          the storyboard
 *   <dir>/log.md             what was asked and what changed
 */

/** Manifest file name; its presence marks a folder this tool created. */
export const PROJECT_MANIFEST = 'mba-project.json'

/** v1 input limit: total media length per project, in seconds (spec §14.7). */
export const MAX_PROJECT_MEDIA_SEC = 180

/** A path relative to the project folder, under `prefix/`, forward slashes, no `..` segment. */
const relUnder = (prefix: string) =>
  z
    .string()
    .refine((s) => s.startsWith(`${prefix}/`) && s.length > prefix.length + 1 && !s.includes('\\') && !s.split('/').includes('..'), {
      message: `must be a relative path under ${prefix}/`,
    })

/** A project id: a uuid from init, or any plain name safe as one path segment. */
export const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/

// Loose objects: keys this version does not know survive a read → write round trip.
const mediaSchema = z.looseObject({
  id: z.string().regex(/^m[1-9]\d*$/, 'must be m1, m2, …'),
  /** `audio`: voice or music with no picture (V1); it has a WAV working copy and never plays as a `video` scene. */
  kind: z.enum(['video', 'audio']).default('video'),
  source: relUnder('source'),
  /** What the user added it as (`mba project add --kind`); unset for init media. */
  role: z.enum(['voice', 'music', 'sfx']).optional(),
  work: relUnder('work').optional(),
  durationSec: z.number().finite().positive().optional(),
})

/**
 * Every delivered video is 60 fps; 30 fps only when the user asks (`mba project init --fps 30`).
 * Drafts, `mba review` analysis and the Playwright goldens may stay at 30 for speed.
 */
export const DEFAULT_FPS = 60

export const projectSchema = z
  .looseObject({
    version: z.literal(1),
    /** Also names the project's temp folder (`<tmp>/mba/<id>`), so it must be a plain name. */
    id: z.string().regex(PROJECT_ID_RE, 'معرّف المشروع يجب أن يكون حروفًا لاتينية وأرقامًا و- فقط — must be 1–64 letters, digits or -, starting with a letter or digit'),
    /** ISO time, written once at init by Node; never read by the runtime. */
    createdAt: z.iso.datetime(),
    fps: z.union([z.literal(30), z.literal(60)]).default(DEFAULT_FPS),
    format: z.enum(FORMATS).default('9:16'),
    media: z.array(mediaSchema).default([]),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>()
    m.media.forEach((x, i) => {
      if (seen.has(x.id)) ctx.addIssue({ code: 'custom', path: ['media', i, 'id'], message: `duplicate media id "${x.id}"` })
      seen.add(x.id)
    })
  })

export type ProjectManifest = z.infer<typeof projectSchema>
export type ProjectMedia = ProjectManifest['media'][number]

/** An opened project: its absolute folder and parsed manifest. */
export interface Project {
  dir: string
  manifest: ProjectManifest
}

export class ProjectError extends Error {
  path: string
  /** `full` replaces the standard "Invalid project manifest" message. */
  constructor(path: string, message: string, full?: string) {
    super(full ?? `ملف المشروع غير صالح — Invalid project manifest: ${path ? `${path}: ` : ''}${message}`)
    this.name = 'ProjectError'
    this.path = path
  }
}

/**
 * Parses a manifest; the first issue becomes a ProjectError carrying its field path. A manifest
 * with a version other than 1 gets its own "made by a newer version" error.
 */
export function parseProjectManifest(json: unknown): ProjectManifest {
  const v = typeof json === 'object' && json !== null ? (json as { version?: unknown }).version : undefined
  if (v !== undefined && v !== 1) {
    throw new ProjectError(
      'version',
      `unsupported version ${JSON.stringify(v)}`,
      `أُنشئ هذا المشروع بإصدار أحدث من الأداة، حدّثها أولًا — This project was made by a newer version of the tool ` +
        `(mba-project.json version ${JSON.stringify(v)}, this tool reads version 1); update the tool first`,
    )
  }
  const r = projectSchema.safeParse(json)
  if (!r.success) {
    const issue = r.error.issues[0]!
    throw new ProjectError(formatPath(issue.path), issue.message)
  }
  return r.data
}

export type RenderKind = 'draft' | 'final'

/** `v001-draft`, `v001-draft.mp4`, `v001-draft.mp4.123.tmp`, … (any number of extensions, or none). */
const VERSION_FILE = /^v(\d+)-(draft|final)(?:\.[A-Za-z0-9]+)*$/

/**
 * The next render path given the names already in `renders/` (and the unfinished renders in `<tmp>/mba/<id>/parts/`):
 * `renders/v001-draft.mp4`, `renders/v002-final.mp4`, … numbered across both kinds (highest
 * existing number + 1). A version folder (`v003-draft`, no extension) and a temp file with a
 * double extension (`v004-final.mp4.part`) take their number too.
 */
export function nextVersionName(existing: readonly string[], kind: RenderKind): string {
  let max = 0
  for (const name of existing) {
    const m = VERSION_FILE.exec(name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `renders/v${String(max + 1).padStart(3, '0')}-${kind}.mp4`
}

const REVIEW_DIR = /^r(\d+)$/

/**
 * The next review kit folder given the names already in `review/`: `review/r1`, `review/r2`, …
 * (highest existing `r<N>` + 1), so a new review never overwrites a finished kit. When the highest
 * kit is unfinished (`finished(name)` is false: an interrupted or failed review), it is reused, so
 * the rerun resumes its draft render instead of leaving it behind.
 */
export function nextReviewName(existing: readonly string[], finished: (name: string) => boolean = () => true): string {
  let max = 0
  for (const name of existing) {
    const m = REVIEW_DIR.exec(name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  if (max > 0 && !finished(`r${max}`)) return `review/r${max}`
  return `review/r${max + 1}`
}
