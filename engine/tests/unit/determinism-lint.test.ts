import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUNTIME = fileURLToPath(new URL('../../src/runtime', import.meta.url))
const PREVIEW = join(RUNTIME, 'preview')

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (p === PREVIEW) continue
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const files = walk(RUNTIME)
const rel = (f: string) => relative(RUNTIME, f).split(sep).join('/')

/** Wall-clock / timer APIs: frames must be a pure function of the seek time. */
const NONDETERMINISTIC = [
  /Math\.random/,
  /Date\.now/,
  /performance\.now/,
  /requestAnimationFrame/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bnew\s+Date\b/,
]

/** CSS / Web Animations motion that runs on its own clock instead of paused GSAP or update(localT). */
const SELF_RUNNING_MOTION = [
  /transition:/,
  /transition-/,
  /@keyframes/,
  /animation:/,
  /animation-/,
  /\.style\.(transition|animation)/, // el.style.transition = '...', el.style.animationName = ... (no colon)
  /setProperty\(\s*['"`](transition|animation)/,
  /\.animate\(/, // Element.animate (Web Animations API)
]

/** Media elements play on their own clock: preview audio lives under preview/ only, render audio is ffmpeg's. */
const MEDIA_ELEMENTS = [/<audio\b/, /new\s+Audio\(/, /createElement\(\s*['"`]audio['"`]/]

const matching = (rules: RegExp[], text: string) => rules.filter((r) => r.test(text)).map(String)

describe('determinism lint', () => {
  it('runtime .ts files avoid nondeterministic APIs', () => {
    for (const f of files.filter((f) => f.endsWith('.ts'))) {
      expect(matching(NONDETERMINISTIC, readFileSync(f, 'utf8')), rel(f)).toEqual([])
    }
  })
  it('runtime .ts/.css/.html files avoid CSS transitions and animations', () => {
    for (const f of files.filter((f) => /\.(ts|css|html)$/.test(f))) {
      expect(matching(SELF_RUNNING_MOTION, readFileSync(f, 'utf8')), rel(f)).toEqual([])
    }
  })
  it('runtime .ts/.html files create no <audio> element outside preview/', () => {
    for (const f of files.filter((f) => /\.(ts|html)$/.test(f))) {
      expect(matching(MEDIA_ELEMENTS, readFileSync(f, 'utf8')), rel(f)).toEqual([])
    }
  })
  it('preview audio is the one allowed place (preview/audio.ts, skipped by the walk)', () => {
    const previewAudio = join(PREVIEW, 'audio.ts')
    expect(existsSync(previewAudio)).toBe(true)
    expect(matching(MEDIA_ELEMENTS, readFileSync(previewAudio, 'utf8'))).not.toEqual([])
    expect(files).not.toContain(previewAudio)
  })
  it('the lint walks the runtime but skips preview/', () => {
    expect(files.map(rel)).toContain('stage.ts')
    expect(files.map(rel).some((f) => f.startsWith('preview/'))).toBe(false)
  })

  describe('self-test: every rule catches a known-bad line and passes a benign one', () => {
    const cases: [RegExp[], string, string][] = [
      [NONDETERMINISTIC, 'const x = Math.random()', 'const x = rng()'],
      [NONDETERMINISTIC, 'const t = Date.now()', 'const t = localT'],
      [NONDETERMINISTIC, 'const t = performance.now()', 'const t = frameToTime(i, fps)'],
      [NONDETERMINISTIC, 'requestAnimationFrame(tick)', 'stage.seek(t)'],
      [NONDETERMINISTIC, 'setTimeout(() => el.remove(), 100)', 'const timeoutMs = 100'],
      [NONDETERMINISTIC, 'const id = setInterval(tick, 16)', 'const interval = 16'],
      [NONDETERMINISTIC, 'const d = new Date()', 'const d = updatedAt'],
      [SELF_RUNNING_MOTION, "Object.assign(el.style, { transition: 'opacity 1s' })", "Object.assign(el.style, { opacity: '1' })"],
      [SELF_RUNNING_MOTION, 'el.style.cssText = "transition-duration: 1s"', 'el.style.cssText = "opacity: 1"'],
      [SELF_RUNNING_MOTION, '@keyframes spin { to { rotate: 1turn } }', '.spin { rotate: 1turn }'],
      [SELF_RUNNING_MOTION, 'el.style.cssText = "animation: spin 1s"', 'el.style.cssText = "rotate: 1turn"'],
      [SELF_RUNNING_MOTION, '.spin { animation-name: spin }', '.spin { rotate: 1turn }'],
      [SELF_RUNNING_MOTION, "el.style.animationName = 'spin'", "el.style.rotate = '1turn'"],
      [SELF_RUNNING_MOTION, "el.style.transition = 'opacity 1s'", "el.style.opacity = '1'"],
      [SELF_RUNNING_MOTION, "el.style.animation = 'spin 1s infinite'", "el.style.transform = 'none'"],
      [SELF_RUNNING_MOTION, "el.style.setProperty('transition', 'all 1s')", "el.style.setProperty('opacity', '1')"],
      [SELF_RUNNING_MOTION, 'el.animate([{ opacity: 0 }, { opacity: 1 }], 300)', 'tl.fromTo(el, { opacity: 0 }, { opacity: 1 })'],
      [MEDIA_ELEMENTS, 'root.innerHTML = "<audio src=a.wav>"', 'root.innerHTML = "<div>"'],
      [MEDIA_ELEMENTS, 'const a = new Audio(src)', 'const a = audioClips(src)'],
      [MEDIA_ELEMENTS, "const a = document.createElement('audio')", "const a = document.createElement('div')"],
    ]
    for (const [rules, bad, benign] of cases) {
      it(`${bad}  vs  ${benign}`, () => {
        expect(matching(rules, bad)).not.toEqual([])
        expect(matching(rules, benign)).toEqual([])
      })
    }
    it('every rule is exercised by at least one known-bad line', () => {
      for (const r of [...NONDETERMINISTIC, ...SELF_RUNNING_MOTION, ...MEDIA_ELEMENTS]) {
        expect(
          cases.some(([, bad]) => r.test(bad)),
          String(r),
        ).toBe(true)
      }
    })
  })
})
