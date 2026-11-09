import { createHash } from 'node:crypto'
import { access, mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseMarks } from '../core/anchors'
import { parseBrief, plannedPace, screenPath, type ExplainInput, type PlannedPace } from '../core/recipes/explain'
import { compilePlan, parsePlan, planExplainer, signatureLabels, type ExplainPlan } from '../core/recipes/plan'
import type { IdeaId } from '../core/recipes/ideas'
import { HOOK_FAMILIES_AR } from '../core/recipes/types'
import { parseStoryboard } from '../core/storyboard'
import { PRIMITIVE_IDS } from '../core/primitive-ids'
import { resolveAnchors } from '../core/anchors'
import { parseTranscript, type Marks } from '../core/transcript'
import { appendLog, openProject, PROJECT_EDIT } from './project'
import { writeFileAtomic } from './fsx'
import { TRANSCRIPT_FILE } from './whisper'
import { loadStyleFile } from './reference'
import { voiceLevels } from './audio'
import { LEVELS_FPS } from '../core/params/morph-object'

/** The last `edit.json` the recipe wrote (byte for byte): an `edit.json` equal to it holds no user edits. */
export const EXPLAIN_RECORD = 'work/explain-last.json'
/** Plan 2a+ Task 9: the creative director's plan, and the last one the recipe wrote (a `plan.json` equal to it holds no user edits). */
export const PLAN_FILE = 'plan.json'
export const PLAN_RECORD = 'work/plan-last.json'
export const BRIEF_FILE = 'brief.json'
const MARKS_FILE = 'marks.json'

/** `mba explain` refused to overwrite a user-edited `edit.json` (exit 1). */
export class ExplainRefusedError extends Error {}

/** `mba explain` refused a `plan.json` made for another transcript (exit 1). */
export class StalePlanError extends Error {}

async function readText(path: string): Promise<string | null> {
  try {
    const t = await readFile(path, 'utf8')
    return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

function parseJsonFile<T>(text: string, path: string, parse: (json: unknown) => T): T {
  try {
    return parse(JSON.parse(text))
  } catch (e) {
    throw new Error(`تعذّرت قراءة ${basename(path)} — Could not read ${path}: ${(e as Error).message}`)
  }
}

/** The `edit.json` `project init` writes: only `c<n>` placeholder/video scenes, no transitions. */
function isInitPlaceholder(text: string): boolean {
  try {
    const j = JSON.parse(text) as { scenes?: { id?: unknown; type?: unknown }[]; transitions?: unknown[] }
    return (
      Array.isArray(j.scenes) &&
      j.scenes.every((s) => typeof s.id === 'string' && /^c\d+$/.test(s.id) && (s.type === 'wipe-reveal' || s.type === 'video')) &&
      !(j.transitions?.length)
    )
  } catch {
    return false
  }
}

/**
 * Pixel size from an image file's header (PNG, JPEG, GIF, WebP), or undefined when unknown. Only
 * the orientation matters (a landscape screen goes in an app window).
 */
export function imageSize(b: Buffer): { w: number; h: number } | undefined {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  if (b.length >= 10 && b.toString('ascii', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) }
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16)
    if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L') {
      const v = b.readUInt32LE(21)
      return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }
    }
    return undefined
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return undefined
      const m = b[o + 1]!
      const len = b.readUInt16BE(o + 2)
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(o + 7), h: b.readUInt16BE(o + 5) }
      o += 2 + len
    }
  }
  return undefined
}

/**
 * The voice's levels from 0 s at LEVELS_FPS (`voiceLevels` over the ingested working copy
 * `work/<media>.wav`, or the media's `work` file), up to the end of the voice plus the end card.
 * Without a working copy (or when ffmpeg cannot read it) none, with an Arabic-first warning: the
 * objects then move on their own.
 */
async function signatureLevels(project: Awaited<ReturnType<typeof openProject>>, transcript: { media: string; words: { end: number }[] }): Promise<{ levels?: number[]; warning?: string }> {
  const media = project.manifest.media.find((m) => m.id === transcript.media)
  const candidates = [join(project.dir, 'work', `${transcript.media}.wav`), ...(media?.work ? [join(project.dir, media.work)] : [])]
  const lastEnd = transcript.words.at(-1)?.end ?? 0
  const to = Math.max(media?.durationSec ?? 0, lastEnd + 3)
  for (const path of candidates) {
    if (!(await access(path).then(() => true, () => false))) continue
    try {
      return { levels: (await voiceLevels(path, 0, to, LEVELS_FPS)).map((v) => Math.round(v * 1000) / 1000) }
    } catch (e) {
      return { warning: `تعذّرت قراءة مستويات الصوت؛ الأشكال تتحرك وحدها — could not read the voice levels (${(e as Error).message}); the microphone and timeline move on their own` }
    }
  }
  return { warning: `لا توجد نسخة عمل للصوت؛ شغّل mba ingest لتتبع الأشكال الصوت — no working copy of the voice (work/${transcript.media}.wav); run mba ingest so the microphone and timeline follow it` }
}

/** A stable 31-bit seed from the project id (same project → same storyboard). */
function seedOf(id: string): number {
  let h = 7
  for (const c of id) h = (Math.imul(h, 31) + c.codePointAt(0)!) >>> 0
  return (h % 2147483646) + 1
}

export interface ExplainResult {
  /** Undefined with `plan` (only plan.json is written). */
  editPath?: string
  planPath: string
  scenes: number
  transitions: number
  pace?: PlannedPace
  /** Arabic-first warnings of the recipe (also written to log.md). */
  warnings: string[]
  type: string
  /** The plan's look (Plan 3 Task 7: `signature` plans carry a concept and per-beat visuals). */
  look: string
  /** The plan's signature moments, and their Arabic labels. */
  signature: IdeaId[]
  signatureLabels: string[]
  /** The plan's hook family first, then two others to try (Arabic: family — idea). */
  hookOptions: string[]
}

/** The plan's hook family and the next two families (in `HOOK_FAMILIES_AR` order) as options to try. */
function hookOptions(plan: ExplainPlan): string[] {
  const k = HOOK_FAMILIES_AR.findIndex((h) => h.id === plan.hook.family)
  return [0, 1, 2].map((d) => HOOK_FAMILIES_AR[(k + d) % HOOK_FAMILIES_AR.length]!).map((h) => `${h.id} — ${h.idea}`)
}

/**
 * `mba explain <projectDir> [--brief brief.json] [--plan] [--force]`: transcript.json + marks.json
 * (optional) + brief → plan.json (the creative director, Plan 2a+ Task 9) → edit.json.
 *
 * - `plan`: writes plan.json only (validated) and returns its signature moments and hook options.
 * - Otherwise, with a plan.json: one made for another transcript (`transcriptHash`, the sha1 of the
 *   transcript.json bytes as render hashes them) is refused (StalePlanError) unless `force`, which
 *   re-plans; one edited by hand (not equal to the recipe's last plan, PLAN_RECORD) is compiled as
 *   it is; the recipe's own is planned again (it picks up a changed brief). Without one: plan, then
 *   compile, writing both.
 *
 * An existing edit.json is replaced only when it is the recipe's own last output, the `project init`
 * placeholder, or with `force`; user edits are never lost silently. Appends one line to log.md.
 */
export async function explainProject(dir: string, o: { briefPath?: string; force?: boolean; plan?: boolean } = {}): Promise<ExplainResult> {
  const project = await openProject(dir)
  const tPath = join(project.dir, TRANSCRIPT_FILE)
  let tBytes: Buffer
  try {
    tBytes = await readFile(tPath)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    throw new Error(`لا يوجد تفريغ للصوت (transcript.json)؛ شغّل mba transcribe أولاً — no transcript.json in ${project.dir}; run mba transcribe first`)
  }
  const tText = tBytes.toString('utf8')
  const transcript = parseJsonFile(tText.charCodeAt(0) === 0xfeff ? tText.slice(1) : tText, tPath, parseTranscript)
  const transcriptSha1 = createHash('sha1').update(tBytes).digest('hex')
  const mPath = join(project.dir, MARKS_FILE)
  const mText = await readText(mPath)
  const marks: Marks = mText === null ? { stress: [], pauses: [], unmatched: [], sections: [] } : parseJsonFile(mText, mPath, parseMarks)
  const bPath = o.briefPath !== undefined ? resolve(o.briefPath) : join(project.dir, BRIEF_FILE)
  const bText = await readText(bPath)
  if (bText === null && o.briefPath !== undefined) throw new Error(`لم يتم العثور على ملف الموجز — Brief file not found: ${bPath}`)
  const brief = bText === null ? parseBrief({}) : parseJsonFile(bText, bPath, parseBrief)
  brief.format ??= project.manifest.format
  // The brief may only name what the project has: music by media id, screens as files in source/.
  if (brief.musicMedia !== undefined) {
    const m = project.manifest.media.find((x) => x.id === brief.musicMedia)
    if (!m) {
      throw new Error(
        `الموسيقى «${brief.musicMedia}» ليست في المشروع؛ أضفها بـ mba project add --kind music — brief.musicMedia "${brief.musicMedia}" is not a media id of this project ` +
          `(known: ${project.manifest.media.map((x) => x.id).join(', ') || 'none'}); add it with mba project add --kind music`,
      )
    }
  }
  const screenSizes: Record<string, { w: number; h: number }> = {}
  for (const name of brief.screens ?? []) {
    const path = join(project.dir, screenPath(name))
    let bytes: Buffer
    try {
      bytes = await readFile(path)
    } catch {
      throw new Error(`لقطة الشاشة «${name}» غير موجودة في source/ — brief.screens: ${name} was not found at ${path}`)
    }
    const size = imageSize(bytes)
    if (size) screenSizes[name] = size
  }
  // The brief's style (a path relative to the project) is read and validated here; the recipe consumes it.
  const style = brief.style !== undefined ? await loadStyleFile(resolve(project.dir, brief.style)) : undefined
  const fps = project.manifest.fps

  const warnings: string[] = style ? [...style.warnings] : []
  const input: ExplainInput = { transcript, marks, brief, voiceMedia: transcript.media, fps, seed: seedOf(project.manifest.id), screenSizes, warnings, transcriptSha1, ...(style ? { style } : {}) }

  // The plan: planned now, or the plan.json there (hand-edited, same transcript).
  const planPath = join(project.dir, PLAN_FILE)
  const planRecordPath = join(project.dir, PLAN_RECORD)
  const planText0 = o.plan ? null : await readText(planPath)
  let plan: ExplainPlan
  let planned = true
  if (planText0 !== null) {
    const existing = parseJsonFile(planText0, planPath, parsePlan)
    if (existing.transcriptHash !== transcriptSha1 && !o.force) {
      throw new StalePlanError(`خطة قديمة: التفريغ تغيّر؛ شغّل mba explain --plan من جديد — stale plan.json: the transcript changed; run mba explain --plan again (or --force to re-plan): ${planPath}`)
    }
    const ours = existing.transcriptHash !== transcriptSha1 || planText0 === (await readText(planRecordPath))
    plan = ours ? planExplainer(input) : existing
    planned = ours
  } else plan = planExplainer(input)
  if (planned) warnings.push(...plan.warnings)
  const planText = JSON.stringify(plan, null, 2) + '\n'
  const labels = signatureLabels(plan, input)
  const writePlan = async () => {
    if (!planned) return
    await mkdir(dirname(planRecordPath), { recursive: true })
    await writeFileAtomic(planPath, planText)
    await writeFileAtomic(planRecordPath, planText)
  }
  const common = { planPath, type: plan.type, look: plan.look, signature: plan.signature, signatureLabels: labels, hookOptions: hookOptions(plan) }
  if (o.plan) {
    await writePlan()
    await appendLog(project, {
      action: 'explain',
      details:
        `plan.json من التفريغ والموجز — plan.json from the transcript and brief: type ${plan.type}, ${plan.beats.length} beats, signature ${plan.signature.join(', ') || 'none'}` +
        warnings.map((w) => `; تنبيه — warning: ${w}`).join(''),
    })
    return { ...common, scenes: 0, transitions: 0, warnings }
  }

  // Plan 3 Task 7: the signature look's microphone, voice note and timeline follow the voice.
  if (plan.look === 'signature') {
    const levels = await signatureLevels(project, transcript)
    if (levels.levels) input.voiceLevels = levels.levels
    if (levels.warning) warnings.push(levels.warning)
  }
  const json = compilePlan(plan, input)
  const text = JSON.stringify(json, null, 2) + '\n'
  const sb = parseStoryboard(resolveAnchors(json, { transcript, marks, fps }).json, [...PRIMITIVE_IDS])

  const editPath = join(project.dir, PROJECT_EDIT)
  const recordPath = join(project.dir, EXPLAIN_RECORD)
  const current = await readText(editPath)
  if (current !== null && current !== text && !o.force) {
    const record = await readText(recordPath)
    const ours = record !== null ? current === record : isInitPlaceholder(current)
    if (!ours) {
      throw new ExplainRefusedError(
        `ملف edit.json فيه تعديلات يدوية ولن يُستبدل؛ أعد التشغيل مع --force لاستبداله (ستضيع التعديلات) — ` +
          `edit.json was edited since mba explain last wrote it; not overwritten. Re-run with --force to replace it (your edits will be lost): ${editPath}`,
      )
    }
  }
  await writePlan()
  await mkdir(dirname(recordPath), { recursive: true })
  await writeFileAtomic(editPath, text)
  await writeFileAtomic(recordPath, text)
  const pace = plannedPace(sb)
  await appendLog(project, {
    action: 'explain',
    details:
      `edit.json من التفريغ والموجز — edit.json from the transcript and brief: type ${plan.type}, ${sb.scenes.length} scenes, ` +
      `${sb.transitions?.length ?? 0} transitions; planned (estimate, mba review decides): maxEventGap ${pace.maxEventGap} s, ` +
      `median ${pace.medianEventGap} s` +
      (planned ? '' : ' (plan.json edited by hand)') +
      (o.force ? ' (--force)' : '') +
      warnings.map((w) => `; تنبيه — warning: ${w}`).join(''),
  })
  return { ...common, editPath, scenes: sb.scenes.length, transitions: sb.transitions?.length ?? 0, pace, warnings }
}
