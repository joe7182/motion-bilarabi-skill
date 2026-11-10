import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
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

/** The user's clean plate marker beside the working copy: `mba matte` keeps a user plate. */
export const userPlateMarker = (work: string) => work.replace(/\.mp4$/i, '.plate.user')

/** Runs a Python script, streaming its stderr lines; rejects with the tail of stderr on failure. */
function runPython(args: string[], what: string, onLine: (s: string) => void): Promise<void> {
  return new Promise<void>((ok, fail) => {
    const p = spawn('python', args, { stdio: ['ignore', 'inherit', 'pipe'], windowsHide: true })
    let err = ''
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      err += s
      for (const line of s.split(/\r?\n/)) if (line.trim()) onLine(line.trim())
    })
    p.on('error', fail)
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${what} (exit ${code}): ${err.trim().slice(-1200)}`))))
  })
}

/**
 * `mba matte <projectDir> <mediaId> [--model file]`: writes the person matte of a media's working
 * copy beside it (`work/<id>.matte.mp4`, white = person, same fps and size), used by `cutout` scenes,
 * plus the head per frame (`.matte.face.json`) and a clean plate of the room (`.plate.jpg`, kept when
 * the user gave one with `mba plate`). Runs `scripts/matte.py` (Python + mediapipe + opencv; MODNet
 * via onnxruntime when installed).
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
  const keepPlate = existsSync(join(project.dir, userPlateMarker(m.work)))
  await runPython(
    [script, join(project.dir, m.work), out, model, resolveFfmpeg(), String(project.manifest.fps), existsSync(MODNET_MODEL) ? MODNET_MODEL : '', keepPlate ? 'keep-plate' : ''],
    'تعذّر صنع القناع — matte.py failed',
    onLine,
  )
  return out
}

/**
 * `mba plate <projectDir> <mediaId> <photo-or-clip>`: the user's photo (or a short clip) of the empty
 * scene, from the same camera spot, becomes the media's clean plate (work/<id>.plate.jpg), fitted and
 * aligned to the clip. Rebuilding the matte keeps it.
 */
export async function makePlate(dir: string, mediaId: string, file: string, onLine: (s: string) => void = () => {}): Promise<string> {
  const project = await openProject(dir)
  const m = project.manifest.media.find((x) => x.id === mediaId)
  if (!m) throw new Error(`لا توجد مادة "${mediaId}" في المشروع — No media "${mediaId}" in ${project.dir}`)
  if (!m.work || !existsSync(join(project.dir, m.work))) throw new Error(`لا توجد نسخة عمل للمادة ${mediaId}؛ شغّل mba ingest — ${mediaId} has no working copy; run mba ingest`)
  const src = resolve(file)
  if (!existsSync(src)) throw new Error(`لم يتم العثور على صورة المكان — Plate file not found: ${src}`)
  const script = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'plate.py')
  const matte = join(project.dir, mattePathOf(m.work))
  const out = join(project.dir, m.work.replace(/\.mp4$/i, '.plate.jpg'))
  await runPython([script, join(project.dir, m.work), existsSync(matte) ? matte : '-', src, out], 'تعذّر صنع خلفية المكان — plate.py failed', onLine)
  writeFileSync(join(project.dir, userPlateMarker(m.work)), src + '\n')
  return out
}
