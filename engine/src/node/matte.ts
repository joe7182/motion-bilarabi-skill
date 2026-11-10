import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openProject } from './project'
import { resolveFfmpeg } from './tools'

/** Where `mba matte` looks for the MediaPipe selfie model unless `--model` names one. */
export const DEFAULT_MATTE_MODEL = join(homedir(), '.mba', 'models', 'selfie_segmenter.tflite')
/** The MODNet portrait-matting model (true soft alpha); used when present, with onnxruntime. */
export const MODNET_MODEL = join(homedir(), '.mba', 'models', 'modnet.onnx')

/** The matte file of a working copy: `work/m3.mp4` → `work/m3.matte.mp4`. */
export const mattePathOf = (work: string) => work.replace(/\.mp4$/i, '.matte.mp4')

/**
 * `mba matte <projectDir> <mediaId> [--model file]`: writes the person matte of a media's working
 * copy beside it (`work/<id>.matte.mp4`, white = person, same fps and size), used by `cutout` scenes.
 * Runs `scripts/matte.py` (Python + mediapipe + opencv; MODNet via onnxruntime when installed).
 */
export async function makeMatte(dir: string, mediaId: string, model = DEFAULT_MATTE_MODEL, onLine: (s: string) => void = () => {}): Promise<string> {
  const project = await openProject(dir)
  const m = project.manifest.media.find((x) => x.id === mediaId)
  if (!m) throw new Error(`لا توجد مادة "${mediaId}" في المشروع — No media "${mediaId}" in ${project.dir}`)
  if (!m.work || !existsSync(join(project.dir, m.work))) throw new Error(`لا توجد نسخة عمل للمادة ${mediaId}؛ شغّل mba ingest — ${mediaId} has no working copy; run mba ingest`)
  if (!existsSync(model)) {
    throw new Error(`نموذج القناع غير موجود: ${model} — The matte model is missing: ${model} (MediaPipe selfie_segmenter.tflite)`)
  }
  const script = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'matte.py')
  const out = join(project.dir, mattePathOf(m.work))
  await new Promise<void>((ok, fail) => {
    const p = spawn('python', [script, join(project.dir, m.work!), out, model, resolveFfmpeg(), String(project.manifest.fps), ...(existsSync(MODNET_MODEL) ? [MODNET_MODEL] : [])], { stdio: ['ignore', 'inherit', 'pipe'], windowsHide: true })
    let err = ''
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      err += s
      for (const line of s.split(/\r?\n/)) if (line.trim()) onLine(line.trim())
    })
    p.on('error', fail)
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`تعذّر صنع القناع — matte.py failed (exit ${code}): ${err.trim().slice(-1200)}`))))
  })
  return out
}
