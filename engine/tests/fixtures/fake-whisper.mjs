// A stand-in for whisper.cpp's `whisper-cli` in tests (run with `node`). It checks the argv the
// engine passes and that the input is a 16 kHz mono 16-bit WAV, prints progress lines like `--print-progress`, and writes whisper-ar.json to
// `<-of>.json`, as `--output-json-full` does.
// FAKE_WHISPER_FAIL=1 makes it print an error and exit 1 without writing anything.
// `--prompt <text>` (fix wave M3) is accepted; FAKE_WHISPER_ARGV=<file> records the argv there.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The `fmt ` chunk of a RIFF/WAVE file, or null. */
function wavFormat(b) {
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null
  for (let o = 12; o + 8 <= b.length; o += 8 + b.readUInt32LE(o + 4) + (b.readUInt32LE(o + 4) % 2)) {
    if (b.toString('ascii', o, o + 4) === 'fmt ') {
      return { codec: b.readUInt16LE(o + 8), channels: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }
    }
  }
  return null
}

const args = process.argv.slice(2)
const val = (...names) => {
  for (const n of names) {
    const i = args.indexOf(n)
    if (i >= 0) return args[i + 1]
  }
  return undefined
}

if (process.env.FAKE_WHISPER_FAIL === '1') {
  process.stderr.write('error: failed to initialize whisper context\n')
  process.exit(1)
}

const of = val('-of', '--output-file')
const file = val('-f', '--file')
const model = val('-m', '--model')
const problems = []
if (!of) problems.push('missing -of')
if (!file || !existsSync(file)) problems.push(`input not found: ${file}`)
if (!model || !existsSync(model)) problems.push(`model not found: ${model}`)
if (val('-l', '--language') !== 'ar') problems.push('language is not ar')
for (const f of ['--output-json-full', '--split-on-word']) if (!args.includes(f)) problems.push(`missing ${f}`)
if (val('--max-len', '-ml') !== '1') problems.push('missing --max-len 1')
if (args.includes('--prompt')) {
  const prompt = val('--prompt')
  if (!prompt || prompt.startsWith('-')) problems.push('--prompt without a text')
}
if (process.env.FAKE_WHISPER_ARGV) writeFileSync(process.env.FAKE_WHISPER_ARGV, JSON.stringify(args))
if (file && existsSync(file)) {
  const fmt = wavFormat(readFileSync(file))
  if (!fmt || fmt.codec !== 1 || fmt.channels !== 1 || fmt.rate !== 16000 || fmt.bits !== 16) {
    problems.push(`input is not a 16 kHz mono s16 WAV: ${JSON.stringify(fmt)}`)
  }
}
if (problems.length) {
  process.stderr.write(`fake-whisper: ${problems.join('; ')}\n`)
  process.exit(3)
}

for (const p of [0, 25, 50, 75, 100]) process.stderr.write(`whisper_print_progress_callback: progress = ${String(p).padStart(3)}%\n`)
copyFileSync(fileURLToPath(new URL('./whisper-ar.json', import.meta.url)), `${of}.json`)
