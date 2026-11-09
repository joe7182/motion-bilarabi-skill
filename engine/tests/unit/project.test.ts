import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_PROJECT_MEDIA_SEC,
  nextReviewName,
  nextVersionName,
  parseProjectManifest,
  ProjectError,
  projectSchema,
} from '../../src/core/project'
import { nextReviewDir, nextVersion, storyboardArg } from '../../src/node/project'
import { PARAMS } from '../../src/core/params/index'
import { projectTempDir } from '../../src/node/tempdirs'

const base = { version: 1, id: 'p-1', createdAt: '2026-10-28T10:00:00.000Z' }
const pathOf = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ProjectError)
    return (e as ProjectError).path
  }
  return undefined
}

describe('project id (used in temp paths)', () => {
  it('accepts uuids and short ids; refuses path-like or odd ids, Arabic first', () => {
    expect(parseProjectManifest({ ...base, id: '0b6c1e8a-3c1e-4c51-9a55-1f2d3e4f5a6b' }).id).toBe('0b6c1e8a-3c1e-4c51-9a55-1f2d3e4f5a6b')
    for (const id of ['../x', 'a/b', 'a\\b', '-x', '', 'a'.repeat(65), 'مشروع', 'a b', '.', 'C:']) {
      expect(pathOf(() => parseProjectManifest({ ...base, id })), id).toBe('id')
    }
    expect(() => parseProjectManifest({ ...base, id: '../x' })).toThrow(/^ملف المشروع غير صالح — .*id: .*معرّف/)
  })
  it('tempdirs refuse an invalid id even when the manifest was not parsed', () => {
    const p = { dir: 'x', manifest: { ...base, id: '../../etc', fps: 30, format: '9:16', media: [] } } as never
    expect(() => projectTempDir(p)).toThrow(/^[؀-ۿ].*\.\.\/\.\.\/etc/)
  })
})

describe('projectSchema (E1a)', () => {
  it('defaults: fps 60 (delivered videos are 60 fps), format 9:16, media []', () => {
    const m = projectSchema.parse(base)
    expect(m.fps).toBe(60)
    expect(m.format).toBe('9:16')
    expect(m.media).toEqual([])
  })
  it('a project file that says fps 30 stays 30 (30 only on request)', () => {
    expect(parseProjectManifest({ ...base, fps: 30 }).fps).toBe(30)
    expect(parseProjectManifest({ ...base, fps: 60 }).fps).toBe(60)
  })
  it('keeps media entries, work and durationSec optional', () => {
    const m = parseProjectManifest({
      ...base,
      fps: 60,
      format: '16:9',
      media: [
        { id: 'm1', source: 'source/a.mp4', durationSec: 2 },
        { id: 'm2', source: 'source/مقطع %1 (2).mp4', work: 'work/m2.mp4' },
      ],
    })
    expect(m.fps).toBe(60)
    expect(m.format).toBe('16:9')
    expect(m.media[1]).toEqual({ id: 'm2', kind: 'video', source: 'source/مقطع %1 (2).mp4', work: 'work/m2.mp4' })
  })
  it('errors carry the field path and are Arabic first', () => {
    expect(pathOf(() => parseProjectManifest({ ...base, fps: 25 }))).toBe('fps')
    expect(pathOf(() => parseProjectManifest({ ...base, format: '3:2' }))).toBe('format')
    expect(pathOf(() => parseProjectManifest({ version: 1, createdAt: base.createdAt }))).toBe('id')
    expect(pathOf(() => parseProjectManifest({ ...base, media: [{ id: 'm1', source: '../x.mp4' }] }))).toBe('media[0].source')
    expect(pathOf(() => parseProjectManifest({ ...base, media: [{ id: 'm1', source: 'a.mp4' }] }))).toBe('media[0].source')
    expect(pathOf(() => parseProjectManifest({ ...base, media: [{ id: 'm1', source: 'source/a.mp4', durationSec: -1 }] }))).toBe(
      'media[0].durationSec',
    )
    expect(
      pathOf(() =>
        parseProjectManifest({
          ...base,
          media: [
            { id: 'm1', source: 'source/a.mp4' },
            { id: 'm1', source: 'source/b.mp4' },
          ],
        }),
      ),
    ).toBe('media[1].id')
    try {
      parseProjectManifest({ ...base, fps: 25 })
    } catch (e) {
      expect((e as Error).message).toMatch(/^[؀-ۿ]/)
      expect((e as Error).message).toContain('fps')
    }
  })
  it('a version other than 1 is "made by a newer version" (Arabic + English)', () => {
    for (const version of [2, '2']) {
      expect(pathOf(() => parseProjectManifest({ ...base, version }))).toBe('version')
      expect(() => parseProjectManifest({ ...base, version })).toThrow(/^[؀-ۿ].*— This project was made by a newer version/s)
    }
  })
  it('createdAt must be an ISO date-time', () => {
    expect(pathOf(() => parseProjectManifest({ ...base, createdAt: 'yesterday' }))).toBe('createdAt')
  })
  it('unknown keys survive parsing (top level and media)', () => {
    const m = parseProjectManifest({ ...base, future: { a: 1 }, media: [{ id: 'm1', source: 'source/a.mp4', lang: 'ar' }] })
    expect((m as Record<string, unknown>).future).toEqual({ a: 1 })
    expect((m.media[0] as Record<string, unknown>).lang).toBe('ar')
  })
  it('media kind: absent means video (E1a manifests), audio is allowed, anything else fails at media[i].kind', () => {
    expect(parseProjectManifest({ ...base, media: [{ id: 'm1', source: 'source/a.mp4' }] }).media[0]!.kind).toBe('video')
    expect(parseProjectManifest({ ...base, media: [{ id: 'm1', source: 'source/a.m4a', kind: 'audio' }] }).media[0]!.kind).toBe('audio')
    expect(pathOf(() => parseProjectManifest({ ...base, media: [{ id: 'm1', source: 'source/a.png', kind: 'image' }] }))).toBe('media[0].kind')
  })
  it('the v1 media limit is 3 minutes', () => {
    expect(MAX_PROJECT_MEDIA_SEC).toBe(180)
  })
})

describe('video params (E1a)', () => {
  it('defaults: speed 1, fit cover', () => {
    expect(PARAMS.video.parse({ media: 'm1', in: 0 })).toEqual({ media: 'm1', in: 0, speed: 1, fit: 'cover' })
  })
  it('accepts zoom keys and contain', () => {
    const p = PARAMS.video.parse({ media: 'm2', in: 1.5, speed: 0.25, fit: 'contain', zoom: [{ t: 0, scale: 1 }, { t: 1, scale: 1.15, x: 0.5, y: 0.4 }] })
    expect(p.zoom).toHaveLength(2)
  })
  it('rejects bad values', () => {
    expect(PARAMS.video.safeParse({ in: 0 }).success).toBe(false)
    expect(PARAMS.video.safeParse({ media: 'm1', in: -1 }).success).toBe(false)
    expect(PARAMS.video.safeParse({ media: 'm1', in: 0, speed: 0.2 }).success).toBe(false)
    expect(PARAMS.video.safeParse({ media: 'm1', in: 0, speed: 4.5 }).success).toBe(false)
    expect(PARAMS.video.safeParse({ media: 'm1', in: 0, fit: 'fill' }).success).toBe(false)
    expect(PARAMS.video.safeParse({ media: 'm1', in: 0, zoom: [{ t: 0 }] }).success).toBe(false)
  })
})

describe('nextVersionName (pure)', () => {
  it('starts at v001 and numbers across draft and final', () => {
    expect(nextVersionName([], 'draft')).toBe('renders/v001-draft.mp4')
    expect(nextVersionName(['v001-draft.mp4'], 'final')).toBe('renders/v002-final.mp4')
    expect(nextVersionName(['v001-draft.mp4', 'v002-final.mp4'], 'draft')).toBe('renders/v003-draft.mp4')
  })
  it('uses the highest number, ignores other files, goes past 999', () => {
    expect(nextVersionName(['v007-final.mp4', 'v002-draft.mp4', 'notes.txt', 'vx-draft.mp4', 'v003-draft.part'], 'draft')).toBe(
      'renders/v008-draft.mp4',
    )
    expect(nextVersionName(['v999-draft.mp4'], 'final')).toBe('renders/v1000-final.mp4')
  })
})

describe('nextVersion (renders/ on disk)', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mba-'))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })
  it('reads renders/ and sequences', async () => {
    const dir = join(root, 'مشروع 100%')
    const project = { dir, manifest: projectSchema.parse(base) }
    await mkdir(join(dir, 'renders'), { recursive: true })
    expect(nextVersion(project, 'draft')).toBe('renders/v001-draft.mp4')
    await writeFile(join(dir, 'renders', 'v001-draft.mp4'), '')
    expect(nextVersion(project, 'final')).toBe('renders/v002-final.mp4')
    await writeFile(join(dir, 'renders', 'v002-final.mp4'), '')
    expect(nextVersion(project, 'draft')).toBe('renders/v003-draft.mp4')
  })
  it('a missing renders/ folder gives v001', () => {
    const project = { dir: join(root, 'none'), manifest: projectSchema.parse(base) }
    expect(nextVersion(project, 'final')).toBe('renders/v001-final.mp4')
  })
})

describe('nextReviewName / nextReviewDir (review/ kits)', () => {
  it('starts at r1, uses the highest r<N> + 1, ignores other names', () => {
    expect(nextReviewName([])).toBe('review/r1')
    expect(nextReviewName(['r1', 'r2', 'verify', 'notes.md', 'r10x', 'R7'])).toBe('review/r3')
    expect(nextReviewName(['r9'])).toBe('review/r10')
  })
  it('reuses the highest kit when it is unfinished (only the highest)', () => {
    const done = (n: string) => n !== 'r2'
    expect(nextReviewName(['r1', 'r2'], done)).toBe('review/r2')
    expect(nextReviewName(['r2', 'r3'], done)).toBe('review/r4')
    expect(nextReviewName([], () => false)).toBe('review/r1')
  })
  it('reads review/ on disk; a missing folder gives r1', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mba-rev-'))
    try {
      const project = { dir: root, manifest: projectSchema.parse(base) }
      expect(nextReviewDir(project)).toBe('review/r1')
      await mkdir(join(root, 'review', 'r1'), { recursive: true })
      await mkdir(join(root, 'review', 'verify'), { recursive: true })
      // r1 has no metrics.json yet: an unfinished kit is reused.
      expect(nextReviewDir(project)).toBe('review/r1')
      await writeFile(join(root, 'review', 'r1', 'metrics.json'), '{}')
      expect(nextReviewDir(project)).toBe('review/r2')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('storyboardArg (CLI: a project folder stands for its edit.json)', () => {
  it('a project folder gives <dir>/edit.json; a file is itself; a plain folder is refused Arabic first', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mba-arg-'))
    try {
      const proj = join(root, 'مشروع %1')
      await mkdir(proj)
      await writeFile(join(proj, 'mba-project.json'), JSON.stringify(base))
      expect(await storyboardArg(proj)).toBe(join(proj, 'edit.json'))
      const file = join(root, 'sb.json')
      await writeFile(file, '{}')
      expect(await storyboardArg(file)).toBe(file)
      expect(await storyboardArg(join(root, 'missing.json'))).toBe(join(root, 'missing.json'))
      const plain = join(root, 'plain')
      await mkdir(plain)
      await expect(storyboardArg(plain)).rejects.toThrow(/^هذا المجلد ليس مشروعًا — Not a project folder/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
