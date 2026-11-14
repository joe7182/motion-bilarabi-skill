import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Page } from '@playwright/test'
import { easeMove, recordRecipeSchema, shotFrames, type RecordMove, type RecordRecipe, type RecordStep } from '../core/record-recipe'

/**
 * `mba record <recipe.json> [--out dir] [--only a,b]`: records a web tool shot by shot (see
 * `core/record-recipe.ts`) into `<out>/<shot>.mp4` (each with a silent track, so `mba project add`
 * takes it), and joins them into `<out>/recording.mp4` with `recording.json` giving each shot's
 * span, ready for `screen-clip` (`in` = a shot's `from`). Nothing is signed in to; it only clicks,
 * types and drags what the recipe says.
 */

export interface RecordResult { dir: string; video: string; spans: { name: string; from: number; to: number }[] }

/** Finds a target in the page: a CSS selector, else the innermost element whose visible text is exactly it. */
const FIND = `(t) => {
  let el = null
  try { el = document.querySelector(t) } catch {}
  if (el) return el
  const all = [...document.querySelectorAll('body *')].filter((e) => e.textContent && e.textContent.trim() === t)
  return all.find((e) => ![...e.children].some((c) => c.textContent && c.textContent.trim() === t)) || null
}`

async function must(page: Page, target: string, what: string): Promise<void> {
  const ok = await page.evaluate(`(${FIND})(${JSON.stringify(target)}) !== null`)
  if (!ok) throw new Error(`ما لقيت «${target}» بالصفحة — ${what}: nothing matches "${target}" (a CSS selector or an element's exact text)`)
}

async function setValue(page: Page, target: string, value: string | number): Promise<void> {
  await page.evaluate(
    `((el, v) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })((${FIND})(${JSON.stringify(target)}), ${JSON.stringify(value)})`,
  )
}

async function runStep(page: Page, s: RecordStep): Promise<void> {
  if ('click' in s) {
    await must(page, s.click, 'click')
    await page.evaluate(`(${FIND})(${JSON.stringify(s.click)}).click()`)
    await page.waitForTimeout(500)
  } else if ('check' in s) {
    const ok = await page.evaluate(
      `(([text, on]) => {
        const l = [...document.querySelectorAll('label')].find((e) => e.textContent.includes(text))
        const box = l && (l.querySelector('input[type=checkbox]') || (l.htmlFor && document.getElementById(l.htmlFor)) || (l.parentElement && l.parentElement.querySelector('input[type=checkbox]')))
        if (box && box.checked !== on) box.click()
        return !!box
      })(${JSON.stringify([s.check, s.on])})`,
    )
    if (!ok) throw new Error(`ما لقيت مربع «${s.check}» — check: no checkbox label contains "${s.check}"`)
    await page.waitForTimeout(500)
  } else if ('set' in s) {
    await must(page, s.set, 'set')
    await setValue(page, s.set, s.value)
    await page.waitForTimeout(300)
  } else if ('scrollTo' in s) {
    await must(page, s.scrollTo, 'scrollTo')
    await page.evaluate(`(${FIND})(${JSON.stringify(s.scrollTo)}).scrollIntoView({ block: 'center' })`)
    await page.waitForTimeout(400)
  } else if ('scrollTop' in s) {
    await page.evaluate(`window.scrollTo(0, ${s.scrollTop})`)
    await page.waitForTimeout(300)
  } else {
    await page.waitForTimeout(s.wait)
  }
}

/** Plays one frame of a move at progress `u` (0…1); `prev` is the previous frame's progress. */
async function moveFrame(page: Page, m: RecordMove, u: number, prev: number, vp: { w: number; h: number }): Promise<void> {
  const lerp = (a: readonly [number, number], b: readonly [number, number], k: number) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k] as const
  if ('drag' in m || 'hover' in m) {
    const d = 'drag' in m ? m.drag : m.hover
    const [x, y] = lerp(d.from, d.to, easeMove(u))
    await page.mouse.move(x, y)
  } else if ('sweep' in m) {
    let v = m.sweep.from + (m.sweep.to - m.sweep.from) * easeMove(u)
    if (m.sweep.step) v = Math.round(v / m.sweep.step) * m.sweep.step
    await setValue(page, m.sweep.target, Number(v.toFixed(4)))
  } else if ('scroll' in m) {
    const [x, y] = m.scroll.at ?? [vp.w / 2, vp.h / 2]
    await page.mouse.move(x, y)
    const dy = m.scroll.by * (easeMove(u) - easeMove(prev))
    if (dy) await page.mouse.wheel(0, dy)
  } else {
    // typing reads best at an even pace, so no easing here
    const n = Math.round(m.type.text.length * u)
    await setValue(page, m.type.target, m.type.text.slice(0, n))
  }
}

const encode = (frames: string, fps: number, out: string) =>
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-i', join(frames, '%05d.jpg'), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out])

export async function record(recipePath: string, o: { out?: string; only?: string[]; log?: (l: string) => void } = {}): Promise<RecordResult> {
  const log = o.log ?? (() => {})
  const file = resolve(recipePath)
  const r: RecordRecipe = recordRecipeSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  const base = dirname(file)
  const url = /^https?:\/\//i.test(r.url) ? r.url : pathToFileURL(isAbsolute(r.url) ? r.url : join(base, r.url)).href
  if (url.startsWith('file:') && !existsSync(new URL(url))) throw new Error(`ما لقيت الملف — no such page: ${r.url}`)
  const dir = resolve(o.out ?? join(base, 'rec'))
  mkdirSync(dir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const spans: RecordResult['spans'] = []
  // every shot's frames also go to one sequence, so the joined clip has no gaps between shots
  const all = join(dir, '_all')
  rmSync(all, { recursive: true, force: true })
  mkdirSync(all)
  let total = 0
  let complete = true
  try {
    const page = await browser.newPage({ viewport: { width: r.viewport.w, height: r.viewport.h }, deviceScaleFactor: r.scale })
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(r.wait)
    let at = 0
    for (const shot of r.shots) {
      for (const s of shot.setup) await runStep(page, s)
      const n = shotFrames(shot.seconds, r.fps)
      const skip = o.only?.length && !o.only.includes(shot.name)
      if (!skip) {
        const frames = join(dir, shot.name)
        rmSync(frames, { recursive: true, force: true })
        mkdirSync(frames)
        const m = shot.move
        if (m && 'drag' in m) {
          await page.mouse.move(...m.drag.from)
          await page.mouse.down()
        }
        let prev = 0
        for (let i = 0; i < n; i++) {
          const u = n === 1 ? 1 : i / (n - 1)
          if (m) await moveFrame(page, m, u, prev, r.viewport)
          prev = u
          // let the page paint the change (and any of its own transitions advance a little)
          await page.waitForTimeout(40)
          const jpg = join(frames, `${String(i).padStart(5, '0')}.jpg`)
          await page.screenshot({ path: jpg, type: 'jpeg', quality: 95 })
          copyFileSync(jpg, join(all, `${String(total++).padStart(5, '0')}.jpg`))
        }
        if (m && 'drag' in m) await page.mouse.up()
        encode(frames, r.fps, join(dir, `${shot.name}.mp4`))
        rmSync(frames, { recursive: true, force: true })
        log(`${shot.name}: ${n} frames (${shot.seconds}s)`)
      } else complete = false
      spans.push({ name: shot.name, from: Number(at.toFixed(3)), to: Number((at + n / r.fps).toFixed(3)) })
      at += n / r.fps
    }
  } finally {
    await browser.close()
  }
  const video = join(dir, 'recording.mp4')
  if (complete) {
    encode(all, r.fps, video)
    writeFileSync(join(dir, 'recording.json'), JSON.stringify({ recipe: file, fps: r.fps, shots: spans }, null, 1))
  } else {
    log('recording.mp4 not rebuilt: --only recorded part of the shots')
  }
  rmSync(all, { recursive: true, force: true })
  return { dir, video, spans }
}
