import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTranscript, PROMPT_MAX_CHARS, scriptPrompt } from '../../src/core/transcript'
import { spawnSync } from 'node:child_process'
import { buildWhisperInputArgs, resolveWhisper, transcribeMedia, whisperPromptArg } from '../../src/node/whisper'
import { openProject } from '../../src/node/project'
import { resolveFfmpeg, ToolMissingError } from '../../src/node/tools'

const FAKE = fileURLToPath(new URL('../fixtures/fake-whisper.mjs', import.meta.url))

/** A silent 16-bit PCM WAV (like the ingest working copy: 48 kHz stereo). */
function silentWav(rate: number, channels: number, sec: number): Buffer {
  const data = Math.round(rate * sec) * channels * 2
  const b = Buffer.alloc(44 + data)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + data, 4)
  b.write('WAVEfmt ', 8, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(channels, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * channels * 2, 28)
  b.writeUInt16LE(channels * 2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(data, 40)
  return b
}
const none = { exists: () => false, which: () => null, home: 'C:/Users/test user' }

describe('resolveWhisper', () => {
  it('MBA_WHISPER pointing nowhere throws ToolMissingError, Arabic first, with install help', () => {
    let err: unknown
    try {
      resolveWhisper({ MBA_WHISPER: '<nowhere>' }, none)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ToolMissingError)
    const msg = (err as Error).message
    expect(msg.startsWith('لم يُعثر على whisper.cpp — whisper.cpp was not found')).toBe(true)
    for (const s of ['brew install whisper-cpp', 'whisper-bin-x64.zip', 'ggml-large-v3-turbo-q5_0.bin', '550 MB', join('C:/Users/test user', '.mba', 'models'), 'MBA_WHISPER', 'MBA_WHISPER_MODEL', '<nowhere>']) {
      expect(msg).toContain(s)
    }
  })
  it('nothing on PATH throws the same help', () => {
    expect(() => resolveWhisper({}, none)).toThrow(/^لم يُعثر على whisper\.cpp/)
  })
  it('env vars win; the model is looked up in ~/.mba/models (large-v3-turbo first, then small)', () => {
    const ok = (...ps: string[]) => (p: string) => ps.map((x) => join(x)).includes(join(p))
    expect(resolveWhisper({ MBA_WHISPER: '/w/whisper-cli', MBA_WHISPER_MODEL: '/m/x.bin' }, { ...none, exists: ok('/w/whisper-cli', '/m/x.bin') })).toEqual({
      bin: '/w/whisper-cli',
      model: '/m/x.bin',
    })
    const turbo = join('C:/Users/test user', '.mba', 'models', 'ggml-large-v3-turbo-q5_0.bin')
    const small = join('C:/Users/test user', '.mba', 'models', 'ggml-small.bin')
    const which = (n: string) => (n === 'whisper-cli' ? '/bin/whisper-cli' : null)
    expect(resolveWhisper({}, { ...none, which, exists: ok(turbo, small) }).model).toBe(turbo)
    expect(resolveWhisper({}, { ...none, which, exists: ok(small) })).toEqual({ bin: '/bin/whisper-cli', model: small })
    expect(resolveWhisper({}, { ...none, which: (n) => (n === 'main' ? '/bin/main' : null), exists: ok(small) }).bin).toBe('/bin/main')
  })
  it('a missing model throws ToolMissingError naming the model and folder', () => {
    const run = () => resolveWhisper({}, { ...none, which: () => '/bin/whisper-cli' })
    expect(run).toThrow(ToolMissingError)
    expect(run).toThrow(/^لم يُعثر على نموذج whisper\.cpp/)
    expect(run).toThrow(/ggml-large-v3-turbo-q5_0\.bin/)
  })
})

describe('transcribeMedia (fake whisper)', () => {
  let dir: string
  let env: Record<string, string | undefined>

  beforeEach(() => {
    // Spaces, Arabic and % in the path.
    dir = join(mkdtempSync(join(tmpdir(), 'mba wsp ')), 'مشروع 100%')
    mkdirSync(join(dir, 'work'), { recursive: true })
    mkdirSync(join(dir, 'source'))
    writeFileSync(join(dir, 'work', 'm1.wav'), silentWav(48000, 2, 0.5))
    writeFileSync(join(dir, 'log.md'), '# log\n\n')
    writeFileSync(
      join(dir, 'mba-project.json'),
      JSON.stringify({
        version: 1,
        id: 'p1',
        createdAt: '2026-10-28T00:00:00.000Z',
        media: [{ id: 'm1', kind: 'audio', source: 'source/voice.m4a', work: 'work/m1.wav', durationSec: 6.1 }],
      }),
    )
    const model = join(dir, '..', 'ggml-small.bin')
    writeFileSync(model, 'x')
    env = { ...process.env, MBA_WHISPER: FAKE, MBA_WHISPER_MODEL: model, FAKE_WHISPER_FAIL: undefined }
  })
  afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

  it('writes transcript.json that parses, logs, reports progress', async () => {
    const project = await openProject(dir)
    const progress: number[] = []
    const t = await transcribeMedia(project, 'm1', { env, onProgress: (f) => progress.push(f) })
    const file = join(dir, 'transcript.json')
    expect(existsSync(file)).toBe(true)
    const back = parseTranscript(JSON.parse(readFileSync(file, 'utf8')))
    expect(back).toEqual(t)
    expect(back.words).toHaveLength(12)
    expect(back.media).toBe('m1')
    expect(back.model).toBe('ggml-small.bin')
    expect(back.sourceHash).toMatch(/^[0-9a-f]{40}$/)
    expect(progress.at(-1)).toBe(1)
    expect(readFileSync(join(dir, 'log.md'), 'utf8')).toMatch(/transcribe/)
  })

  it('whisper exiting 1: Arabic-first error, no transcript.json', async () => {
    const project = await openProject(dir)
    await expect(transcribeMedia(project, 'm1', { env: { ...env, FAKE_WHISPER_FAIL: '1' } })).rejects.toThrow(/^[\u0600-\u06FF][^—]* — .*failed to initialize whisper context/s)
    expect(existsSync(join(dir, 'transcript.json'))).toBe(false)
  })

  it('feeds whisper a 16 kHz mono WAV converted by ffmpeg (the fake checks the header)', () => {
    expect(buildWhisperInputArgs('in put.wav', 'o.wav')).toEqual([
      '-v', 'error', '-nostdin', '-y', '-i', 'in put.wav', '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'o.wav',
    ])
  })

  it('transcribes the audio of a video working copy', async () => {
    rmSync(join(dir, 'work', 'm1.wav'))
    const mp4 = join(dir, 'work', 'm1.mp4')
    const r = spawnSync(resolveFfmpeg(), [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=30:d=0.5', '-f', 'lavfi', '-i', 'sine=f=440:d=0.5:sample_rate=48000',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4,
    ])
    expect(r.status).toBe(0)
    const manifest = JSON.parse(readFileSync(join(dir, 'mba-project.json'), 'utf8'))
    manifest.media[0] = { id: 'm1', kind: 'video', source: 'source/clip.mp4', work: 'work/m1.mp4', durationSec: 0.5 }
    writeFileSync(join(dir, 'mba-project.json'), JSON.stringify(manifest))
    const t = await transcribeMedia(await openProject(dir), 'm1', { env })
    expect(t.words).toHaveLength(12)
    expect(existsSync(join(dir, 'transcript.json'))).toBe(true)
  }, 30000)

  it('an unreadable working copy: Arabic-first conversion error, no transcript.json', async () => {
    writeFileSync(join(dir, 'work', 'm1.wav'), Buffer.alloc(64))
    await expect(transcribeMedia(await openProject(dir), 'm1', { env })).rejects.toThrow(/^[؀-ۿ][^—]* — Could not convert the audio of m1/)
    expect(existsSync(join(dir, 'transcript.json'))).toBe(false)
  })

  it('refuses a media without a WAV working copy, Arabic first', async () => {
    rmSync(join(dir, 'work', 'm1.wav'))
    const project = await openProject(dir)
    await expect(transcribeMedia(project, 'm1', { env })).rejects.toThrow(/^[\u0600-\u06FF].*mba ingest/s)
    await expect(transcribeMedia(project, 'm9', { env })).rejects.toThrow(/^[\u0600-\u06FF].*m9/s)
  })
})

describe('fix wave M3: the script as whisper --prompt', () => {
  it('scriptPrompt: spoken words only (no # titles, stars or pause marks), cut at a word', () => {
    const md = '# المقدمة\nتضيّع *ساعات* في المونتاج؟ «...»\n# الحل\n- أولاً، اكتب السكربت.'
    expect(scriptPrompt(md)).toBe('تضيّع ساعات في المونتاج أولاً اكتب السكربت')
    const long = scriptPrompt(Array.from({ length: 200 }, () => 'كلمة').join(' '))
    expect([...long].length).toBeLessThanOrEqual(PROMPT_MAX_CHARS)
    expect(long.endsWith('كلمة')).toBe(true)
  })
  it('whisperPromptArg: on Windows the ANSI bytes of the argument are the prompt’s UTF-8 bytes', () => {
    const p = 'علّق كلمة موشن؟ فلوس'
    expect(whisperPromptArg(p, 'darwin')).toBe(p)
    expect(whisperPromptArg(p, 'win32', '65001')).toBe(p)
    expect(whisperPromptArg(p, 'win32', '932')).toBeUndefined()
    expect(whisperPromptArg(p, 'win32', null)).toBeUndefined()
    // Re-review minor: a single-byte code page whose table has holes where Arabic UTF-8 bytes fall
    // (1253, 1255, 1257) would hand whisper «?» bytes: no prompt rather than a corrupted one.
    // «ت» is D8 AA in UTF-8 and 0xAA has no character in windows-1253.
    expect(whisperPromptArg('ثلاثمية تضيّع', 'win32', '1253')).toBeUndefined()
    for (const cp of ['1250', '1251', '1253', '1254', '1255', '1257', '1258', '874']) {
      const arg = whisperPromptArg('ثلاثمية تضيّع موشن إلى', 'win32', cp)
      if (arg !== undefined) expect(arg, cp).not.toContain('�')
    }
    expect(whisperPromptArg('  ', 'darwin')).toBeUndefined()
    for (const cp of ['1252', '1256']) {
      const arg = whisperPromptArg(p, 'win32', cp)!
      // Re-encode each character to its single ANSI byte through the decoder's own table.
      const dec = new TextDecoder(`windows-${cp}`)
      const table = new Map<string, number>()
      for (let b = 0; b < 256; b++) table.set(dec.decode(Uint8Array.of(b)), b)
      const bytes = Buffer.from([...arg].map((ch) => table.get(ch)!))
      expect(bytes.toString('utf8'), cp).toBe(p)
    }
  })
  it('transcribeMedia passes the prompt to whisper as one --prompt argument; none without one', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'mba wsp ')), 'مشروع')
    try {
      mkdirSync(join(dir, 'work'), { recursive: true })
      writeFileSync(join(dir, 'work', 'm1.wav'), silentWav(48000, 2, 0.5))
      writeFileSync(join(dir, 'log.md'), '# log\n\n')
      writeFileSync(
        join(dir, 'mba-project.json'),
        JSON.stringify({ version: 1, id: 'p1', createdAt: '2026-10-28T00:00:00.000Z', media: [{ id: 'm1', kind: 'audio', source: 'source/v.m4a', work: 'work/m1.wav', durationSec: 0.5 }] }),
      )
      const model = join(dir, '..', 'ggml-small.bin')
      writeFileSync(model, 'x')
      const argvFile = join(dir, '..', 'argv.json')
      const env = { ...process.env, MBA_WHISPER: FAKE, MBA_WHISPER_MODEL: model, FAKE_WHISPER_FAIL: undefined, FAKE_WHISPER_ARGV: argvFile }
      await transcribeMedia(await openProject(dir), 'm1', { env, prompt: 'علّق كلمة موشن' })
      const argv = JSON.parse(readFileSync(argvFile, 'utf8')) as string[]
      // What reaches whisper's argv as UTF-8 bytes (on Windows: re-spelled for the ANSI code page).
      expect(argv[argv.indexOf('--prompt') + 1]).toBe(whisperPromptArg('علّق كلمة موشن'))
      expect(argv.filter((a) => a === '--prompt')).toHaveLength(1)
      await transcribeMedia(await openProject(dir), 'm1', { env })
      expect(JSON.parse(readFileSync(argvFile, 'utf8'))).not.toContain('--prompt')
    } finally {
      rmSync(join(dir, '..'), { recursive: true, force: true })
    }
  })
})
