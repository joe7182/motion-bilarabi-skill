import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { resolveFfmpeg, resolveFfprobe } from './tools'
import { resolveWhisper } from './whisper'
import { loadBrand, personalBrandPath } from './brand-fs'
import { spawnSync } from 'node:child_process'
import { DEFAULT_MATTE_MODEL, MODNET_MODEL } from './matte'

/**
 * `mba doctor`: the setup check a new user runs first. Every check says what it found, and when
 * something is missing, how to fix it two ways: a terminal command, and a sentence to paste into the
 * Claude app's Code tab (for people who never open a terminal). Arabic first.
 */

export interface Check {
  id: string
  /** `required`: no video without it; `optional`: a feature needs it (voice transcription, brand). */
  need: 'required' | 'optional'
  ok: boolean
  ar: string
  en: string
  found?: string
  fix?: { terminal: string; claude: string }
}

const win = process.platform === 'win32'

export async function runDoctor(opts: { engineDir?: string; home?: string } = {}): Promise<Check[]> {
  const engine = resolve(opts.engineDir ?? process.cwd())
  const home = opts.home ?? homedir()
  const checks: Check[] = []
  const add = (c: Check) => checks.push(c)

  const major = Number(process.versions.node.split('.')[0])
  add({
    id: 'node', need: 'required', ok: major >= 20, ar: 'Node.js ‏(٢٠ أو أحدث)', en: 'Node.js 20 or newer', found: `v${process.versions.node}`,
    fix: { terminal: win ? 'winget install OpenJS.NodeJS.LTS' : 'brew install node', claude: 'ثبّت لي Node.js آخر نسخة LTS — Install the latest Node.js LTS for me' },
  })

  for (const [id, fn, label] of [['ffmpeg', resolveFfmpeg, 'ffmpeg'], ['ffprobe', resolveFfprobe, 'ffprobe']] as const) {
    let found: string | undefined
    try {
      found = fn()
    } catch {
      found = undefined
    }
    add({
      id, need: 'required', ok: found !== undefined, ar: `${label} ‏(تصدير الفيديو)`, en: `${label} (video export)`, ...(found ? { found } : {}),
      fix: { terminal: win ? 'winget install Gyan.FFmpeg' : 'brew install ffmpeg', claude: 'ثبّت لي ffmpeg — Install ffmpeg for me' },
    })
  }

  let browser: string | undefined
  try {
    const p = chromium.executablePath()
    if (p && existsSync(p)) browser = p
  } catch {
    browser = undefined
  }
  add({
    id: 'chromium', need: 'required', ok: browser !== undefined, ar: 'متصفح الرندر ‏(Chromium)', en: 'Render browser (Chromium)', ...(browser ? { found: browser } : {}),
    fix: { terminal: 'npx playwright install chromium', claude: 'شغّل npx playwright install chromium في مجلد engine — Run npx playwright install chromium in the engine folder' },
  })

  const fonts = ['assets/fonts/cairo/Cairo-Variable.ttf', 'assets/fonts/tajawal/Tajawal-Bold.ttf']
  const missingFonts = fonts.filter((f) => !existsSync(join(engine, f)))
  add({
    id: 'fonts', need: 'required', ok: missingFonts.length === 0, ar: 'الخطوط العربية ‏(Cairo، Tajawal)', en: 'Arabic fonts (Cairo, Tajawal)',
    ...(missingFonts.length ? {} : { found: join(engine, 'assets/fonts') }),
    fix: { terminal: 'git checkout -- engine/assets/fonts', claude: 'رجّع ملفات الخطوط في engine/assets/fonts من المستودع — Restore engine/assets/fonts from the repository' },
  })

  let whisper: string | undefined
  try {
    const w = resolveWhisper(process.env, {})
    whisper = `${w.bin} · ${w.model}`
  } catch {
    whisper = undefined
  }
  add({
    id: 'whisper', need: 'optional', ok: whisper !== undefined, ar: 'تفريغ الصوت ‏(whisper.cpp + النموذج)', en: 'Voice transcription (whisper.cpp + model)', ...(whisper ? { found: whisper } : {}),
    fix: {
      terminal: win ? 'نزّل whisper-bin-x64.zip من github.com/ggml-org/whisper.cpp/releases وضع النموذج في ~/.mba/models' : 'brew install whisper-cpp  (والنموذج في ~/.mba/models)',
      claude: 'ثبّت لي whisper.cpp ونموذج large-v3-turbo في ~/.mba/models — Install whisper.cpp and the large-v3-turbo model in ~/.mba/models',
    },
  })

  // The person cut-out (mba matte → cutout scenes): Python with mediapipe + opencv, and the selfie model.
  const py = spawnSync('python', ['-c', 'import mediapipe, cv2; print(mediapipe.__version__)'], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  const pyOk = py.status === 0
  const model = existsSync(DEFAULT_MATTE_MODEL)
  const modelUrl = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
  add({
    id: 'matte', need: 'optional', ok: pyOk && model,
    ar: 'قصّ الشخص من الفيديو ‏(Python + mediapipe + النموذج)', en: 'Person cut-out (Python + mediapipe + selfie model)',
    found: [pyOk ? `mediapipe ${py.stdout.trim()}` : 'mediapipe: —', model ? DEFAULT_MATTE_MODEL : 'model: —'].join(' · '),
    fix: {
      terminal: `pip install mediapipe opencv-python && curl -L --create-dirs -o "${DEFAULT_MATTE_MODEL}" ${modelUrl}`,
      claude: 'ثبّت لي mediapipe و opencv-python بـ pip، ونزّل نموذج selfie_segmenter.tflite إلى ~/.mba/models — Install mediapipe and opencv-python with pip, and download the selfie_segmenter.tflite model into ~/.mba/models',
    },
  })

  // Professional mask: MODNet portrait matting (soft hair edges) through onnxruntime.
  const ort = spawnSync('python', ['-c', 'import onnxruntime; print(onnxruntime.__version__)'], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  const ortOk = ort.status === 0
  const modnet = existsSync(MODNET_MODEL)
  const modnetUrl = 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx'
  add({
    id: 'matte-pro', need: 'optional', ok: ortOk && modnet,
    ar: 'قناع احترافي للشعر والحواف ‏(MODNet)', en: 'Professional mask: soft hair and edges (MODNet)',
    found: [ortOk ? `onnxruntime ${ort.stdout.trim()}` : 'onnxruntime: —', modnet ? MODNET_MODEL : 'model: —'].join(' · '),
    fix: {
      terminal: `pip install onnxruntime && curl -L --create-dirs -o "${MODNET_MODEL}" ${modnetUrl}`,
      claude: 'ثبّت لي onnxruntime بـ pip، ونزّل نموذج MODNet ‏(model.onnx من huggingface.co/Xenova/modnet) باسم modnet.onnx إلى ~/.mba/models — Install onnxruntime with pip and download the MODNet model (model.onnx from huggingface.co/Xenova/modnet) as modnet.onnx into ~/.mba/models',
    },
  })

  let brandOk = false
  let brandNote: string | undefined
  try {
    const b = await loadBrand(join(home, '.mba', '__none__'), home)
    brandOk = b !== null
    if (b) brandNote = `${b.name} ${b.handle}`
  } catch (e) {
    brandNote = (e as Error).message
  }
  add({
    id: 'brand', need: 'optional', ok: brandOk, ar: 'هويتك ‏(الاسم، الحساب، اللون)', en: 'Your brand (name, handle, colour)', ...(brandNote ? { found: brandNote } : {}),
    fix: {
      terminal: `انسخ engine/examples/brand.json إلى ${personalBrandPath(home)} وعدّله`,
      claude: 'سوّ لي ملف الهوية ~/.mba/brand.json باسمي وحسابي ولوني — Make my ~/.mba/brand.json with my name, handle and colour',
    },
  })
  return checks
}

/** The report, one line per check, then the fixes (both ways) for what is missing. */
export function doctorReport(checks: Check[]): { text: string; ok: boolean } {
  const lines = ['فحص التجهيز — Setup check', '']
  for (const c of checks) {
    const mark = c.ok ? '✓' : c.need === 'required' ? '✗' : '·'
    lines.push(`${mark} ${c.ar} — ${c.en}${c.found ? `\n    ${c.found}` : ''}`)
  }
  const missing = checks.filter((c) => !c.ok)
  if (missing.length) {
    lines.push('', 'الإصلاح — How to fix:')
    for (const c of missing) {
      lines.push(`• ${c.ar}${c.need === 'optional' ? ' (اختياري — optional)' : ''}`)
      lines.push(`    الطرفية — terminal:  ${c.fix!.terminal}`)
      lines.push(`    تطبيق Claude ‏(Code) — or paste in the Claude app:  «${c.fix!.claude}»`)
    }
  }
  const ok = checks.every((c) => c.ok || c.need === 'optional')
  lines.push('', ok ? 'جاهز تصنع فيديو ✓ — Ready to make videos' : 'ناقص شي مطلوب ✗ — Something required is missing')
  return { text: lines.join('\n'), ok }
}
