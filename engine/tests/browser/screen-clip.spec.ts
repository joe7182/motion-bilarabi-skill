import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { initProject, type Project } from '../../src/node/project'
import { ingestProject } from '../../src/node/ingest'
import { loadStoryboardFile, openRenderPage, type RenderPage } from '../../src/node/render'
import { framesNeeded } from '../../src/node/framesrv'
import { resolveFfmpeg } from '../../src/node/tools'
import type {} from '../../src/runtime/mba-api'

// Stage 1B `screen-clip`: a real project (a landscape lavfi clip → init → ingest), frames served by
// the frame server to the page openRenderPage starts. Serial, explicit timeout.
test.describe.configure({ mode: 'serial', timeout: 240_000 })

/*
 * The clip: 3 s at 30 fps, 480×360 (4:3 landscape, like a screen recording). Every frame carries
 * its own FRAME INDEX n as an 8-bit code in 8 vertical black/white stripes (stripe k white ⇔ bit k
 * of n), the trick video.spec uses; the stripes run the full height.
 */
const W = 1080
const H = 1920
const stripes = `geq=lum='if(mod(floor(floor(T*30+0.5)/pow(2\\,floor(X*8/W)))\\,2)\\,235\\,16)':cb=128:cr=128`
const ARABIC_FIRST = /^[؀-ۿ]/

let root: string
let project: Project
let dir: string

async function unlock(d: string): Promise<void> {
  if (!existsSync(d)) return
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) await unlock(p)
    else await chmod(p, 0o644)
  }
}

type Scene = Record<string, unknown>
async function writeSb(name: string, scenes: Scene[], extra: Scene = {}): Promise<string> {
  const p = join(dir, name)
  await writeFile(p, JSON.stringify({ version: 1, format: '9:16', fps: 30, look: 'signature', seed: 5, autoSfx: false, scenes, ...extra }, null, 2))
  return p
}
const shot = (rp: RenderPage) => rp.page.screenshot({ clip: { x: 0, y: 0, width: W, height: H }, type: 'png', caret: 'hide' })

/** The frame code read on row `y` across the window body [x0, x0 + w]. */
function codeIn(png: Buffer, x0: number, w: number, y: number): number {
  const img = PNG.sync.read(png)
  let c = 0
  for (let k = 0; k < 8; k++) {
    const x = Math.round(x0 + ((k + 0.5) * w) / 8)
    const i = (Math.round(y) * img.width + x) * 4
    if ((img.data[i]! + img.data[i + 1]! + img.data[i + 2]!) / 3 > 127) c |= 1 << k
  }
  return c
}

/** Box of the first `[data-mba-part=part]` inside scene `scene`, in page px. */
const boxOf = (rp: RenderPage, scene: string, part: string) =>
  rp.page.evaluate(
    ([s, p]) => {
      const el = document.querySelector<HTMLElement>(`[data-mba-scene="${s}"] [data-mba-part="${p}"]`)!
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    },
    [scene, part] as const,
  )

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mba-sc-'))
  const media = join(root, 'مصادر')
  await mkdir(media, { recursive: true })
  const clip = join(media, 'شاشة.mp4')
  const r = spawnSync(
    resolveFfmpeg(),
    ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=black:s=96x72:r=30:d=3,format=yuv420p,${stripes},scale=480:360:flags=neighbor`,
      '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', clip],
    { encoding: 'utf8' },
  )
  expect(r.status, r.stderr).toBe(0)
  dir = join(root, 'مشروع الشاشة')
  project = await initProject({ dir, media: [clip] })
  await ingestProject(project)
})
test.afterAll(async () => {
  await unlock(root)
  await rm(root, { recursive: true, force: true })
})

const clipScene = (extra: Scene = {}, params: Scene = {}): Scene => ({
  id: 'c', type: 'screen-clip', start: 0, duration: 1.5, track: 1,
  params: { media: 'm1', in: 0.5, chrome: false, enter: 'none', exit: false, ...params }, ...extra,
})
const backdrop: Scene = { id: 'b', type: 'backdrop', start: 0, duration: 3, track: 0, params: { world: 'paper' } }

test('frame-exact: a clip shows frame round((in + t·speed)·fps) in its window, a still the frame at in throughout; framesNeeded covers both', async () => {
  const sbPath = await writeSb('sc-frames.json', [
    backdrop,
    clipScene(),
    clipScene({ id: 's', start: 1.5 }, { in: 2.0, still: true, speed: 2 }),
  ])
  const loaded = await loadStoryboardFile(sbPath)
  expect(framesNeeded(loaded.sb, [0.2, 0.9, 1.6, 2.9])).toEqual([{ mediaId: 'm1', from: 21, to: 21 }, { mediaId: 'm1', from: 42, to: 42 }, { mediaId: 'm1', from: 60, to: 60 }])
  const rp = await openRenderPage(loaded)
  try {
    for (const [t, scene, want] of [[0.2, 'c', 21], [0.9, 'c', 42], [1.6, 's', 60], [2.4, 's', 60], [2.9, 's', 60]] as const) {
      await rp.prepareTimes([t])
      await rp.seek(t)
      const body = await boxOf(rp, scene, 'screen-clip-body')
      expect(codeIn(await shot(rp), body.x, body.w, body.y + body.h / 2), `t ${t}`).toBe(want)
    }
    // Media aspect by default (4:3), no bar without chrome, no <video>, no text.
    const body = await boxOf(rp, 's', 'screen-clip-body')
    expect(body.w / body.h).toBeCloseTo(4 / 3, 2)
    expect(await rp.page.evaluate(() => document.querySelectorAll('video').length)).toBe(0)
    expect(await rp.page.evaluate(() => window.__mba.audit())).toEqual([])
  } finally {
    await rp.close()
  }
})

const callouts = [
  { at: 0.4, x: 0.3, y: 0.6, label: 'درج' },
  { at: 0.5, x: 0.7, y: 0.2, label: 'غرفة نوم' },
  { at: 0.6, x: 0.25, y: 0.9, label: 'كراج' },
]
const zoomScene: Scene = {
  id: 'z', type: 'screen-clip', start: 0, duration: 3, track: 1,
  params: {
    media: 'm1', in: 1.0, still: true, aspect: 0.75, chrome: { url: 'claude.ai/house' },
    focus: [{ t: 0, x: 0.5, y: 0.5, scale: 1 }, { t: 1.0, x: 0.3, y: 0.6, scale: 2.2 }],
    reveal: 'scan', callouts,
    marks: [{ at: 1.2, x: 0.25, y: 0.55, w: 0.1, h: 0.1, style: 'hot' }],
    clicks: [{ at: 2.3, x: 0.3, y: 0.6 }],
  },
}

test('callout pins track their source point through the zoom; labels stay inside the window; the picture always covers the body; audit clean', async () => {
  const rp = await openRenderPage(await loadStoryboardFile(await writeSb('sc-zoom.json', [{ ...backdrop }, zoomScene])))
  try {
    let moved = 0
    let prev: { x: number; y: number } | undefined
    for (const t of [0.8, 1.1, 1.25, 1.5, 2.0, 2.5]) {
      await rp.seek(t)
      const m = await rp.page.evaluate(() => {
        const sc = document.querySelector('[data-mba-scene="z"]')!
        const r = (el: Element) => {
          const b = el.getBoundingClientRect()
          return { x: b.left, y: b.top, w: b.width, h: b.height }
        }
        return {
          content: r(sc.querySelector('[data-mba-part="screen-clip-content"]')!),
          body: r(sc.querySelector('[data-mba-part="screen-clip-body"]')!),
          pins: [...sc.querySelectorAll<HTMLElement>('[data-mba-part="screen-clip-pin"]')].map((p) => ({
            shown: getComputedStyle(p).display !== 'none',
            ...r(p),
          })),
          labels: [...sc.querySelectorAll<HTMLElement>('[data-mba-part="screen-clip-label"]')].map((l) => ({
            shown: getComputedStyle(l).display !== 'none',
            ...r(l),
          })),
        }
      })
      // The picture covers the body (never shows outside the image).
      expect(m.content.x).toBeLessThanOrEqual(m.body.x + 0.5)
      expect(m.content.y).toBeLessThanOrEqual(m.body.y + 0.5)
      expect(m.content.x + m.content.w).toBeGreaterThanOrEqual(m.body.x + m.body.w - 0.5)
      expect(m.content.y + m.content.h).toBeGreaterThanOrEqual(m.body.y + m.body.h - 0.5)
      callouts.forEach((c, i) => {
        // The source point as the picture is actually drawn.
        const want = { x: m.content.x + c.x * m.content.w, y: m.content.y + c.y * m.content.h }
        const inside = want.x >= m.body.x && want.x <= m.body.x + m.body.w && want.y >= m.body.y && want.y <= m.body.y + m.body.h
        expect(m.pins[i]!.shown, `pin ${i} at ${t}`).toBe(inside)
        if (!inside) return
        expect(Math.abs(m.pins[i]!.x - want.x), `pin ${i} x at ${t}`).toBeLessThan(0.75)
        expect(Math.abs(m.pins[i]!.y - want.y), `pin ${i} y at ${t}`).toBeLessThan(0.75)
        const l = m.labels[i]!
        expect(l.shown).toBe(true)
        expect(l.x).toBeGreaterThanOrEqual(m.body.x - 0.5)
        expect(l.y).toBeGreaterThanOrEqual(m.body.y - 0.5)
        expect(l.x + l.w).toBeLessThanOrEqual(m.body.x + m.body.w + 0.5)
        expect(l.y + l.h).toBeLessThanOrEqual(m.body.y + m.body.h + 0.5)
      })
      // Pin 0 sits on the zoom's focus point: it moves while the zoom runs.
      if (prev) moved += Math.hypot(m.pins[0]!.x - prev.x, m.pins[0]!.y - prev.y)
      prev = { x: m.pins[0]!.x, y: m.pins[0]!.y }
      expect(await rp.page.evaluate(() => window.__mba.audit()), `audit at ${t}`).toEqual([])
    }
    expect(moved).toBeGreaterThan(20)
    // The url pill is real text.
    expect(await rp.page.evaluate(() => document.querySelector('[data-mba-part="screen-clip-url"]')!.textContent)).toBe('claude.ai/house')
    // The labels are DOM line units, audited (some text was measured, not a vacuous pass).
    // At 0.8 (before the zoom) all three labels and the url pill are measured.
    await rp.seek(0.8)
    expect(await rp.page.evaluate(() => window.__mba.auditStats().checkedGeometric)).toBe(4)
  } finally {
    await rp.close()
  }
})

test('cold vs warm seeks are identical: mid-enter, mid-scan, mid-zoom, after the callouts, on a click, mid-exit', async () => {
  const rp = await openRenderPage(await loadStoryboardFile(await writeSb('sc-det.json', [{ ...backdrop }, zoomScene])))
  try {
    const times = [0.2, 0.62, 1.05, 1.3, 2.4, 2.85]
    await rp.prepareTimes([...times, 0.1, 1.9, 2.95])
    const cold: Buffer[] = []
    for (const t of times) {
      await rp.reload()
      await rp.seek(t)
      cold.push(await shot(rp))
    }
    await rp.reload()
    for (const t of [2.95, 0.1, 1.9, ...[...times].reverse()]) await rp.seek(t)
    for (const [i, t] of times.entries()) {
      await rp.seek(2.95 - i * 0.3)
      await rp.seek(t)
      expect(Buffer.compare(cold[i]!, await shot(rp)), `cold / warm at ${t}`).toBe(0)
    }
    expect(rp.pageErrors()).toEqual([])
  } finally {
    await rp.close()
  }
})

test('project-aware refusals, Arabic first: a window too tall or off the safe area, a preroll, a still past the end, no project', async () => {
  const bad = async (name: string, scenes: Scene[], re: RegExp) => {
    await expect(loadStoryboardFile(await writeSb(name, scenes)), name).rejects.toThrow(re)
  }
  await bad('e-tall.json', [clipScene({}, { aspect: 0.6, width: 1 })], /^[؀-ۿ][^]*scenes\[0\]\.params\.aspect/)
  // Default aspect (the media's 4:3) at full width fits; a portrait 0.75 at 0.94 fits too.
  await loadStoryboardFile(await writeSb('ok-wide.json', [clipScene({}, { width: 1 })]))
  await loadStoryboardFile(await writeSb('ok-tall.json', [clipScene({}, { aspect: 0.75, chrome: {} })]))
  await bad('e-at.json', [clipScene({}, { at: { x: 0.1, y: 0.5 } })], /^[؀-ۿ][^]*scenes\[0\]\.params\.at/)
  await bad('e-preroll.json', [clipScene({ preroll: 0.3 })], /^[؀-ۿ][^]*scenes\[0\]\.preroll/)
  await bad('e-still.json', [clipScene({}, { in: 3.2, still: true })], /^[؀-ۿ][^]*scenes\[0\]\.params\.in/)
  await bad('e-range.json', [clipScene({ duration: 2 }, { in: 1.5 })], /^[؀-ۿ][^]*scenes\[0\]\.params\.in/)
  await bad('e-media.json', [clipScene({}, { media: 'm9' })], /^[؀-ۿ][^]*scenes\[0\]\.params\.media/)
  const loose = join(root, 'قصة.json')
  await writeFile(loose, JSON.stringify({ version: 1, scenes: [clipScene()] }))
  await expect(loadStoryboardFile(loose)).rejects.toThrow(ARABIC_FIRST)
})
