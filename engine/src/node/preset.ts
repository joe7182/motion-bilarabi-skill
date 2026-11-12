import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beatTranscript, parsePreset, presetStoryboard } from '../core/recipes/presets'
import { parseStoryboard } from '../core/storyboard'
import { PRIMITIVE_IDS } from '../core/primitive-ids'
import { validateSceneParams } from '../core/params'
import { parseTranscript } from '../core/transcript'
import { appendLog, openProject, PROJECT_EDIT } from './project'
import { writeFileAtomic } from './fsx'
import { loadBrand } from './brand-fs'
import { TRANSCRIPT_FILE } from './whisper'
import { usualFace } from './face-place'

export const PRESET_FILE = 'preset.json'

const strip = (t: string) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t)

/** A stable 31-bit seed from the project id (same project → same storyboard). */
function seedOf(id: string): number {
  let h = 11
  for (const c of id) h = (Math.imul(h, 31) + c.codePointAt(0)!) >>> 0
  return (h % 2147483646) + 1
}

/**
 * `mba preset <dir>`: `preset.json` + `transcript.json` → `edit.json` (validated: storyboard and
 * every scene's params). Overwrites edit.json; the preset file is the source of truth.
 */
export async function presetProject(dir: string, opts: { presetPath?: string; script?: string; bpm?: number } = {}): Promise<{ editPath: string; scenes: number; preset: string; seconds: number; stills: number[] }> {
  const project = await openProject(dir)
  const read = async (path: string, what: string) => {
    try {
      return JSON.parse(strip(await readFile(path, 'utf8'))) as unknown
    } catch (e) {
      throw new Error(`تعذّرت قراءة ${what} — Could not read ${path}: ${(e as Error).message}`)
    }
  }
  const raw = (await read(opts.presetPath ?? join(project.dir, PRESET_FILE), PRESET_FILE)) as { cta?: { keyword?: string } }
  // The creator's brand fills a CTA keyword the preset leaves out.
  const brand = await loadBrand(project.dir)
  if (raw && typeof raw === 'object' && raw.cta && typeof raw.cta === 'object' && raw.cta.keyword === undefined && brand?.keyword) raw.cta.keyword = brand.keyword
  // No voice: the script's words on the beat (bpm, default 120); the beat also snaps the shows.
  if (opts.script !== undefined && raw && typeof raw === 'object' && (raw as { beat?: unknown }).beat === undefined) (raw as { beat?: unknown }).beat = { bpm: opts.bpm ?? 120 }
  const preset = parsePreset(raw)
  const transcript =
    opts.script !== undefined
      ? beatTranscript(strip(await readFile(opts.script, 'utf8')), preset.beat?.bpm ?? opts.bpm ?? 120)
      : parseTranscript(await read(join(project.dir, TRANSCRIPT_FILE), 'التفريغ (شغّل mba transcribe)'))
  // A talking video pushes in toward the speaker: their usual face place, when `mba matte` has found it (9:16 frame).
  const clip = preset.preset === 'talking' ? project.manifest.media.find((m) => m.id === preset.media) : undefined
  if (preset.preset === 'talking' && !clip) throw new Error(`الوسيط «${preset.media}» غير موجود بالمشروع — media "${preset.media}" is not in the project`)
  const face = clip?.work ? usualFace(project.dir, clip.work, 9 / 16) : undefined
  const json = presetStoryboard({ preset, transcript, fps: project.manifest.fps, seed: seedOf(project.manifest.id), ...(face ? { face } : {}), ...(clip ? { clipSec: clip.durationSec } : {}) })
  // A scene error names the preset section the scene came from (scene ids start with the section id).
  const named = (e: unknown) => {
    const scenes = (json as { scenes?: { id?: string }[] }).scenes ?? []
    const msg = (e as Error).message.replace(/scenes\[(\d+)\]/g, (m, i: string) => {
      const id = scenes[Number(i)]?.id
      return id ? `${m} (القسم — section «${id.replace(/-[a-z]+\d*$/, '')}»)` : m
    })
    return new Error(msg)
  }
  let sb: ReturnType<typeof parseStoryboard>
  try {
    sb = parseStoryboard(json, [...PRIMITIVE_IDS])
    validateSceneParams(sb)
  } catch (e) {
    throw named(e)
  }
  const editPath = join(project.dir, PROJECT_EDIT)
  await writeFileAtomic(editPath, JSON.stringify(json, null, 2) + '\n')
  await appendLog(project, { action: 'preset', details: `${preset.preset}: ${sb.scenes.length} scenes` })
  const seconds = Math.max(...sb.scenes.map((s) => (s.start as number) + (s.duration as number)))
  // One settled moment per section for the storyboard images: 0.3 s before each headline's end, once
  // its words and its show (a strike's right word, an object) have landed.
  const heads = sb.scenes.filter((s) => s.track === 5 && s.type === 'kinetic-text').sort((a, b) => (a.start as number) - (b.start as number))
  const stills = [...new Set(heads.map((s) => Math.round(((s.start as number) + Math.max(0.1, (s.duration as number) - 0.3)) * 100) / 100))]
  return { editPath, scenes: sb.scenes.length, preset: preset.preset, seconds, stills }
}
