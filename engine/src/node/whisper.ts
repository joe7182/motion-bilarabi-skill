import { spawn, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { transcriptFromWhisper, type Transcript } from '../core/transcript'
import type { Project } from '../core/project'
import { appendLog } from './project'
import { fsStep, rmWithRetry, writeFileAtomic } from './fsx'
import { sha1File } from './ingest'
import { resolveFfmpeg, ToolMissingError, whichSync, type ToolLookupOptions } from './tools'

/**
 * Arabic speech → word timings with whisper.cpp (one native binary + one ggml model, offline).
 * Word-level output comes from `--max-len 1 --split-on-word --output-json-full`.
 */

type Env = Record<string, string | undefined>

/** Default model (~550 MB, good Arabic) and the lighter fallback. */
export const WHISPER_MODELS = [
  { file: 'ggml-large-v3-turbo-q5_0.bin', size: '~550 MB' },
  { file: 'ggml-small.bin', size: '~470 MB' },
] as const

/** `~/.mba/models/`, where models are looked up when MBA_WHISPER_MODEL is not set. */
export const modelsDir = (home: string = homedir()) => join(home, '.mba', 'models')

/** The project file `transcribeMedia` writes. */
export const TRANSCRIPT_FILE = 'transcript.json'

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Install steps per OS, model file and folder, env vars (Arabic then English). */
function installHelp(home: string): string {
  const [turbo, small] = WHISPER_MODELS
  return [
    'التثبيت — Install:',
    '  Windows: نزّل whisper-bin-x64.zip من https://github.com/ggml-org/whisper.cpp/releases وضع whisper-cli.exe في PATH — ' +
      'download whisper-bin-x64.zip from https://github.com/ggml-org/whisper.cpp/releases and put whisper-cli.exe on PATH',
    '  macOS: brew install whisper-cpp',
    `النموذج — Model: ${turbo.file} (${turbo.size}) من — from https://huggingface.co/ggerganov/whisper.cpp ` +
      `(أخف — lighter: ${small.file}, ${small.size})`,
    `ضعه في — put it in: ${modelsDir(home)}`,
    'أو حدّد المسارات — or set the paths: MBA_WHISPER (whisper-cli), MBA_WHISPER_MODEL (model file)',
  ].join('\n')
}

/**
 * Finds whisper.cpp and its model: `MBA_WHISPER` / `MBA_WHISPER_MODEL`, else `whisper-cli` (or the
 * older `main`) on PATH or in the Homebrew folders, and the model in `~/.mba/models/`
 * (large-v3-turbo first, then small). Anything missing → ToolMissingError with install help.
 */
export function resolveWhisper(env: Env = process.env, opts: ToolLookupOptions = {}): { bin: string; model: string } {
  const exists = opts.exists ?? isFile
  const which = opts.which ?? ((n: string) => whichSync(n, env))
  const home = opts.home ?? homedir()

  let bin: string | null = null
  let note = ''
  if (env.MBA_WHISPER) {
    if (exists(env.MBA_WHISPER)) bin = env.MBA_WHISPER
    else note = `المسار في MBA_WHISPER غير موجود — MBA_WHISPER points to a file that does not exist: ${env.MBA_WHISPER}\n`
  } else {
    bin = which('whisper-cli') ?? which('main')
    if (!bin) bin = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'].find((p) => exists(p)) ?? null
  }
  if (!bin) {
    throw new ToolMissingError('whisper', `لم يُعثر على whisper.cpp — whisper.cpp was not found.\n${note}${installHelp(home)}`)
  }

  let model: string | null = null
  if (env.MBA_WHISPER_MODEL) {
    if (exists(env.MBA_WHISPER_MODEL)) model = env.MBA_WHISPER_MODEL
    else note = `المسار في MBA_WHISPER_MODEL غير موجود — MBA_WHISPER_MODEL points to a file that does not exist: ${env.MBA_WHISPER_MODEL}\n`
  } else {
    model = WHISPER_MODELS.map((m) => join(modelsDir(home), m.file)).find((p) => exists(p)) ?? null
  }
  if (!model) {
    throw new ToolMissingError(
      'whisper-model',
      `لم يُعثر على نموذج whisper.cpp — the whisper.cpp model was not found.\n${note}${installHelp(home)}`,
    )
  }
  return { bin, model }
}

interface RunResult {
  code: number | null
  stderr: string
  error?: Error
}

/** Spawns a tool (argv array, no shell); a `.mjs`/`.js` "binary" runs with this Node (tests). */
function runTool(bin: string, args: string[], env: Env, onStderrLine: (l: string) => void = () => {}): Promise<RunResult> {
  const viaNode = ['.mjs', '.js', '.cjs'].includes(extname(bin).toLowerCase())
  const [cmd, argv] = viaNode ? [process.execPath, [bin, ...args]] : [bin, args]
  return new Promise((res) => {
    const proc = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env })
    let err = ''
    let pending = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      err = (err + d).slice(-4000)
      pending += d
      const lines = pending.split(/\r?\n/)
      pending = lines.pop()!
      for (const l of lines) onStderrLine(l)
    })
    proc.once('error', (error) => res({ code: null, stderr: err, error }))
    proc.once('close', (code) => res({ code, stderr: err }))
  })
}

export interface TranscribeOptions {
  /** 0..1, from whisper's `--print-progress`; 1 once the transcript is written. */
  onProgress?: (fraction: number) => void
  /** Tool lookup and child environment (MBA_WHISPER, MBA_WHISPER_MODEL, PATH); defaults to process.env. */
  env?: Env
  /**
   * Fix wave M3: the words the voice is expected to say (`scriptPrompt` of the project's
   * script.md), passed as whisper.cpp's `--prompt` so it spells them the script's way (offline).
   */
  prompt?: string
}

/** Windows ANSI code page (registry `Nls\CodePage\ACP`), or null when it cannot be read. */
function windowsAcp(): string | null {
  const r = spawnSync('reg', ['query', String.raw`HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage`, '/v', 'ACP'], { encoding: 'utf8', windowsHide: true })
  return r.status === 0 ? (/ACP\s+REG_SZ\s+(\d+)/.exec(r.stdout)?.[1] ?? null) : null
}

let acpCache: string | null | undefined

/**
 * Fix wave M3: the `--prompt` argument that reaches whisper.cpp as UTF-8, or undefined when it
 * cannot. whisper-cli reads `char** argv`; on Windows those are the command line converted to the
 * ANSI code page, so Arabic arrives as «???» (measured: an Arabic path came out as `???.wav`).
 * With a single-byte ANSI code page (windows-125x, 874) the prompt is passed as the characters
 * whose ANSI bytes are its UTF-8 bytes; with UTF-8 (65001), and on macOS/Linux, as it is; any other
 * code page (double-byte) cannot carry it: no prompt.
 */
export function whisperPromptArg(prompt: string, platform: string = process.platform, acp: string | null | undefined = undefined): string | undefined {
  const text = prompt.trim()
  if (!text) return undefined
  if (platform !== 'win32') return text
  const cp = acp !== undefined ? acp : (acpCache ??= windowsAcp())
  if (cp === '65001') return text
  if (cp === null || !/^(?:125[0-8]|874)$/.test(cp)) return undefined
  const arg = new TextDecoder(`windows-${cp}`).decode(Buffer.from(text, 'utf8'))
  // Re-review minor: a code page with holes where the prompt's UTF-8 bytes fall (1253, 1255, 1257
  // for Arabic) decodes them to U+FFFD, which the ANSI conversion turns into «?»: no prompt then.
  return arg.includes('�') ? undefined : arg
}

/**
 * ffmpeg argv: the first audio stream of `src` → 16 kHz mono 16-bit PCM WAV, the input every
 * whisper.cpp version reads.
 */
export function buildWhisperInputArgs(src: string, out: string): string[] {
  return ['-v', 'error', '-nostdin', '-y', '-i', src, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out]
}

/**
 * Transcribes a media's working copy (from `mba ingest`: `work/<mediaId>.wav` for audio, else the
 * audio of the video working copy) with whisper.cpp in Arabic, writes `transcript.json` atomically
 * and appends `log.md`. ffmpeg first converts the audio to a 16 kHz mono WAV in a temp folder, so
 * whisper only sees a plain temp path. Errors are Arabic first; on any failure `transcript.json` is
 * left as it was.
 */
export async function transcribeMedia(project: Project, mediaId: string, o: TranscribeOptions = {}): Promise<Transcript> {
  const media = project.manifest.media.find((m) => m.id === mediaId)
  if (!media) throw new Error(`المادة غير موجودة في المشروع — Media ${mediaId} is not in the project manifest`)
  const candidates = [join(project.dir, 'work', `${mediaId}.wav`), ...(media.work ? [join(project.dir, media.work)] : [])]
  const src = candidates.find((p) => existsSync(p))
  if (!src) {
    throw new Error(`لا توجد نسخة عمل للمادة ${mediaId} — No working copy for ${mediaId} (work/${mediaId}.wav); run mba ingest first`)
  }
  const env = o.env ?? process.env
  const { bin, model } = resolveWhisper(env)
  const ffmpeg = resolveFfmpeg(env)
  const sourceHash = await sha1File(src)

  const tmp = await fsStep('تعذّر إنشاء مجلد مؤقت', 'Could not create a temp folder in', tmpdir(), () => mkdtemp(join(tmpdir(), 'mba-whisper-')))
  try {
    const input = join(tmp, 'in.wav')
    const conv = await runTool(ffmpeg, buildWhisperInputArgs(src, input), env)
    if (conv.error || conv.code !== 0) {
      throw new Error(
        `تعذّر تحويل الصوت إلى صيغة whisper.cpp — Could not convert the audio of ${mediaId} to 16 kHz mono for whisper.cpp ` +
          `(${conv.error ? conv.error.message : `exit code ${conv.code}`}): ${conv.stderr.trim().slice(-1500)}`,
      )
    }
    const out = join(tmp, 'out')
    const args = ['-m', model, '-f', input, '-l', 'ar', '--max-len', '1', '--split-on-word', '--output-json-full', '-of', out, '--print-progress']
    const prompt = o.prompt !== undefined ? whisperPromptArg(o.prompt) : undefined
    if (prompt) args.push('--prompt', prompt)
    const r = await runTool(bin, args, env, (line) => {
      const m = /progress\s*=\s*(\d+)\s*%/.exec(line)
      if (m) o.onProgress?.(Math.min(1, Number(m[1]) / 100))
    })
    if (r.error || r.code !== 0) {
      throw new Error(
        `فشل تفريغ الصوت بواسطة whisper.cpp — whisper.cpp failed on ${mediaId} ` +
          `(${r.error ? r.error.message : `exit code ${r.code}`}): ${r.stderr.trim().slice(-1500)}`,
      )
    }
    const jsonFile = `${out}.json`
    const text = await fsStep('تعذّر قراءة مخرجات whisper.cpp', 'Could not read the whisper.cpp output', jsonFile, () => readFile(jsonFile, 'utf8'))
    let json: unknown
    try {
      json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    } catch (e) {
      throw new Error(`مخرجات whisper.cpp ليست JSON صالحًا — whisper.cpp output is not valid JSON: ${(e as Error).message}`)
    }
    const transcript = transcriptFromWhisper(json, { media: mediaId, sourceHash, model: basename(model) })
    await writeFileAtomic(join(project.dir, TRANSCRIPT_FILE), JSON.stringify(transcript, null, 2) + '\n')
    await appendLog(project, {
      action: 'transcribe',
      details: `${mediaId}: ${transcript.words.length} كلمة — ${transcript.words.length} words, ${basename(model)} → ${TRANSCRIPT_FILE}`,
    })
    o.onProgress?.(1)
    return transcript
  } finally {
    await rmWithRetry(tmp).catch(() => {})
  }
}
