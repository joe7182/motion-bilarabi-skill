import { test, expect } from '@playwright/test'
import { PNG } from 'pngjs'
import { openStoryboard, frameAt, isNearBlank } from './helpers'
import { resolveAnchors } from '../../src/core/anchors'
import { parseStoryboard } from '../../src/core/storyboard'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { alignScript, parseScript, type Transcript } from '../../src/core/transcript'
import { explainerStoryboard, parseBrief } from '../../src/core/recipes/explain'

const pixel = (png: Buffer, x: number, y: number) => {
  const img = PNG.sync.read(png)
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]
}

test('backdrop: base is the look background; warm glows with the accent in the upper third', async ({ page }) => {
  const sb = (tone: string) => ({ version: 1, format: '9:16', look: 'dark-tech', seed: 1, scenes: [{ id: 'b', type: 'backdrop', start: 0, duration: 1, params: { tone } }] })
  await openStoryboard(page, sb('base'))
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  const base = pixel(await frameAt(page, 0.5), 540, 614)
  expect(base).toEqual([0x0e, 0x0d, 0x0c])
  await openStoryboard(page, sb('warm'))
  const warm = pixel(await frameAt(page, 0.5), 540, 614)
  // Accent #ff5a1f mixed in: more red than the background, still dark.
  expect(warm[0]).toBeGreaterThan(base[0]! + 20)
  expect(warm[0]).toBeLessThan(120)
})

test('backdrop fadeIn: transparent at its start, half way at half the fade, full after (pure in t)', async ({ page }) => {
  const sb = {
    version: 1,
    format: '9:16',
    look: 'dark-tech',
    seed: 1,
    scenes: [
      { id: 'a', type: 'backdrop', track: 0, start: 0, duration: 2, params: { tone: 'base' } },
      { id: 'b', type: 'backdrop', track: 0, start: 1, duration: 1, params: { tone: 'warm', fadeIn: 0.4 } },
    ],
  }
  await openStoryboard(page, sb)
  const at = async (t: number) => pixel(await frameAt(page, t), 540, 614)[0]!
  const base = await at(0.5)
  const half = await at(1.2)
  const full = await at(1.6)
  expect(await at(1.0)).toBe(base)
  expect(full).toBeGreaterThan(base + 10)
  expect(half).toBeGreaterThan(base)
  expect(half).toBeLessThan(full)
  expect(await at(1.2)).toBe(half) // seeking back gives the same frame
})

test('app-window with an image body (a landscape screenshot) shows the decoded image', async ({ page }) => {
  // 4×2 PNG, solid orange.
  const png = new PNG({ width: 4, height: 2 })
  for (let k = 0; k < 8; k++) png.data.set([255, 90, 31, 255], k * 4)
  const image = `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
  await openStoryboard(page, { version: 1, format: '9:16', look: 'dark-tech', seed: 1, scenes: [{ id: 'w', type: 'app-window', start: 0, duration: 2, params: { mode: 'app', image } }] })
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await page.evaluate(() => window.__mba.seek(1))
  const img = await page.evaluate(() => {
    const el = document.querySelector<HTMLImageElement>('#frame [data-mba-part=app-window-image]')!
    const r = el.getBoundingClientRect()
    return { complete: el.complete, w: el.naturalWidth, aspect: r.width / r.height }
  })
  expect(img.complete).toBe(true)
  expect(img.w).toBe(4)
  expect(img.aspect).toBeCloseTo(2, 1)
})

test('highlight circle/burst stay inside the safe area around a wide counter; a word key circles that word only', async ({ page }) => {
  const safe = { x: 1080 * 0.06, y: 1920 * 0.14, w: 1080 * 0.82, h: 1920 * 0.64 }
  for (const kind of ['circle', 'burst']) {
    await openStoryboard(page, {
      version: 1, format: '9:16', look: 'dark-tech', seed: 1,
      scenes: [
        { id: 'c', type: 'counter', track: 1, start: 0, duration: 2, params: { from: 0, to: 300, roll: 0.3, suffix: 'ساعة', key: 'k' } },
        { id: 'h', type: 'highlight', track: 3, start: 0.5, duration: 1.5, params: { kind, target: 'k', drawIn: 0.2 } },
      ],
    })
    expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
    await page.evaluate(() => window.__mba.seek(1.99))
    const r = await page.evaluate(() => {
      const f = document.getElementById('frame')!.getBoundingClientRect()
      const b = document.querySelector('#frame [data-mba-part=highlight] svg')!.getBoundingClientRect()
      return { x: b.left - f.left, y: b.top - f.top, w: b.width, h: b.height }
    })
    // The svg box pads the ink by one stroke width (13 px at 1080): the ink itself stays inside.
    expect(r.x, kind).toBeGreaterThanOrEqual(safe.x - 13)
    expect(r.x + r.w, kind).toBeLessThanOrEqual(safe.x + safe.w + 13)
  }
  await openStoryboard(page, {
    version: 1, format: '9:16', look: 'dark-tech', seed: 1,
    scenes: [
      { id: 't', type: 'kinetic-text', track: 1, start: 0, duration: 2, params: { mode: 'stack', words: [{ text: 'عليك', at: 0 }, { text: 'المال', at: 0, stress: 2, key: 'w' }, { text: 'كل', at: 0 }] } },
      { id: 'h', type: 'highlight', track: 3, start: 0.5, duration: 1.5, params: { kind: 'circle', target: 'w', drawIn: 0.2 } },
    ],
  })
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await page.evaluate(() => window.__mba.seek(1))
  const g = await page.evaluate(() => {
    const word = document.querySelector('#frame [data-mba-key=w]')!.getBoundingClientRect()
    const mark = document.querySelector('#frame [data-mba-part=highlight] svg')!.getBoundingClientRect()
    const rows = [...document.querySelectorAll('#frame [data-mba-part=kinetic-text] > div')].map((d) => d.getBoundingClientRect())
    return { word, mark, first: rows[0]!, last: rows[2]! }
  })
  // Encloses the word, and is much shorter than the whole three-row stack.
  expect(g.mark.top).toBeLessThan(g.word.top + 1)
  expect(g.mark.bottom).toBeGreaterThan(g.word.bottom - 1)
  expect(g.mark.height).toBeLessThan(g.last.bottom - g.first.top)
})

const markBox = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const f = document.getElementById('frame')!.getBoundingClientRect()
    const path = document.querySelector('#frame [data-mba-part=highlight] svg path') as SVGGraphicsElement
    const b = path.getBoundingClientRect()
    return { x: b.left - f.left, y: b.top - f.top, r: b.right - f.left, b: b.bottom - f.top, w: b.width, h: b.height }
  })

test('fix round 3: an underline under a wide counter hugs the number ink and stays inside the safe area', async ({ page }) => {
  const safe = { x: 1080 * 0.06, r: 1080 * 0.88 }
  await openStoryboard(page, {
    version: 1, format: '9:16', look: 'dark-tech', seed: 1,
    scenes: [
      { id: 'c', type: 'counter', track: 1, start: 0, duration: 2, params: { from: 0, to: 300, roll: 0.3, suffix: 'ساعة', key: 'k' } },
      { id: 'h', type: 'highlight', track: 3, start: 0.5, duration: 1.5, params: { kind: 'underline', target: 'k', drawIn: 0.15 } },
    ],
  })
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await page.evaluate(() => window.__mba.seek(1.99))
  const m = await markBox(page)
  const ink = await page.evaluate(() => {
    const f = document.getElementById('frame')!.getBoundingClientRect()
    const walker = document.createTreeWalker(document.querySelector('#frame [data-mba-key=k]')!, NodeFilter.SHOW_TEXT)
    let l = Infinity, r = -Infinity
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue
      const g = document.createRange()
      g.selectNodeContents(n)
      const b = g.getBoundingClientRect()
      l = Math.min(l, b.left - f.left)
      r = Math.max(r, b.right - f.left)
    }
    return { l, r }
  })
  expect(m.x).toBeGreaterThanOrEqual(safe.x)
  expect(m.r).toBeLessThanOrEqual(safe.r)
  // About the ink width (the drift grows it a little), not the 860 px container.
  expect(m.w).toBeLessThan((ink.r - ink.l) * 1.25)
  expect(m.w).toBeGreaterThan((ink.r - ink.l) * 0.9)
})

test('fix round 3: a word-keyed underline in a stack never touches the letters of the rows above and below', async ({ page }) => {
  await openStoryboard(page, {
    version: 1, format: '9:16', look: 'dark-tech', seed: 1,
    scenes: [
      { id: 't', type: 'kinetic-text', track: 1, start: 0, duration: 2, params: { mode: 'stack', words: [{ text: 'عليك', at: 0 }, { text: 'المال', at: 0, stress: 2, key: 'w' }, { text: 'يجيء', at: 0 }] } },
      { id: 'h', type: 'highlight', track: 3, start: 0.2, duration: 1.8, params: { kind: 'underline', target: 'w', drawIn: 0.15 } },
    ],
  })
  for (const t of [0.6, 1.99]) {
    await page.evaluate((tt) => window.__mba.seek(tt), t)
    const m = await markBox(page)
    const sib = await page.evaluate(() => {
      const f = document.getElementById('frame')!.getBoundingClientRect()
      return [...document.querySelectorAll('#frame [data-mba-part=kinetic-text] > div')]
        .map((d) => d.firstElementChild as HTMLElement)
        .filter((sp) => sp.dataset.mbaKey !== 'w')
        .map((sp) => {
          // The row's ink (not its taller line box): the mark sits in the gap between the letters of two rows.
          const g = document.createRange(); g.selectNodeContents(sp)
          const r = g.getBoundingClientRect()
          const cs = getComputedStyle(sp)
          const c = document.createElement('canvas').getContext('2d')!
          c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
          const m = c.measureText(sp.textContent!)
          const s = r.height / (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)
          const base = r.top + m.fontBoundingBoxAscent * s
          return { y: base - m.actualBoundingBoxAscent * s - f.top, b: base + m.actualBoundingBoxDescent * s - f.top }
        })
    })
    expect(sib).toHaveLength(2)
    for (const b of sib) expect(m.b <= b.y + 0.5 || m.y >= b.b - 0.5, `t=${t} mark ${m.y}-${m.b} vs word ${b.y}-${b.b}`).toBe(true)
  }
})

test('fix round 3: a target at the safe edge still gets a full-size mark, moved inward', async ({ page }) => {
  await openStoryboard(page, {
    version: 1, format: '9:16', look: 'dark-tech', seed: 1,
    scenes: [
      { id: 'i', type: 'icon', track: 1, start: 0, duration: 2, params: { icon: 'clock', at: { x: 1, y: 0.5 }, size: 0.2, key: 'k' } },
      { id: 'h', type: 'highlight', track: 3, start: 0.2, duration: 1.8, params: { kind: 'circle', target: 'k', drawIn: 0.15 } },
    ],
  })
  expect(await page.evaluate(() => window.__mba.error)).toBeUndefined()
  await page.evaluate(() => window.__mba.seek(1.99))
  const m = await markBox(page)
  expect(m.w).toBeGreaterThan(1080 * 0.08)
  expect(m.r).toBeLessThanOrEqual(1080 * 0.88 + 1)
})

test('an explainer recipe output plays end to end without page errors, frame 0 not blank', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const lines = [
    '# المقدمة',
    'هذه طريقة بسيطة توفر عليك *المال* كل شهر «...»',
    '# المشكلة',
    'خسرت أكثر من ٣٠٠ ساعة في السنة على شغل مكرر',
    'لأن الوقت ما يرجع «...»',
    '# الحل',
    'الحل في ثلاث خطوات',
    'أولاً اكتب النص ثانياً سجل صوتك ثالثاً خل المحرك يشتغل',
    'والنتيجة فيديو جاهز بسرعة',
  ]
  const texts = lines.filter((l) => !l.startsWith('#')).join(' ').replace(/\*|«\.\.\.»/g, '').split(/\s+/).filter(Boolean)
  const gapAfter: Record<number, number> = { 7: 0.6, 21: 0.3, 25: 0.5 }
  let t = 0.2
  const words = texts.map((text, i) => {
    const start = Math.round(t * 1000) / 1000
    const end = Math.round((t + 0.3) * 1000) / 1000
    t = end + (gapAfter[i] ?? 0.08)
    return { i, text, start, end, p: 0.9 }
  })
  const transcript: Transcript = { version: 1, media: 'm1', sourceHash: 'x', model: 'm', language: 'ar', words }
  const marks = alignScript(parseScript(lines.join('\n')), words)
  for (const type of ['explainer', 'motion'] as const) {
    const raw = explainerStoryboard({
      transcript,
      marks,
      brief: parseBrief({ title: 'وفّر وقتك ومالك', type, hook: { family: 'تحذير' }, cta: { keyword: 'دليل' } }),
      voiceMedia: 'm1',
      fps: 30,
      seed: 7,
    })
    const json = resolveAnchors(raw, { transcript, marks, fps: 30 }).json as Record<string, unknown>
    delete json.audio // no media in this page
    const sb = parseStoryboard(json, [...PRIMITIVE_IDS])
    await openStoryboard(page, json)
    expect(await page.evaluate(() => window.__mba.error), type).toBeUndefined()
    expect(isNearBlank(await frameAt(page, 0)), type).toBe(false)
    const end = Math.max(...sb.scenes.map((s) => s.start + s.duration))
    for (let x = 0.05; x < end; x += 0.5) await page.evaluate((tt) => window.__mba.seek(tt), x)
    // Every transition window, including the morph on the visuals track.
    for (const tr of sb.transitions ?? []) await page.evaluate((tt) => window.__mba.seek(tt), tr.at)
    expect(await page.evaluate(() => window.__mba.error), type).toBeUndefined()
  }
  expect(errors).toEqual([])
})

test('mba explain --plan writes plan.json only; mba explain compiles it; a changed transcript is refused until --force', async () => {
  test.setTimeout(180_000)
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const engine = fileURLToPath(new URL('../..', import.meta.url))
  const fix = join(engine, 'tests/fixtures/explain')
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'explain', ...args], { cwd: engine, encoding: 'utf8' })
  const dir = mkdtempSync(join(tmpdir(), 'mba plan 100% '))
  try {
    const media = [{ id: 'm1', source: 'source/voice.wav', durationSec: 22, kind: 'audio' }]
    writeFileSync(join(dir, 'mba-project.json'), JSON.stringify({ version: 1, id: 'plan-test', createdAt: '2026-10-30T00:00:00.000Z', fps: 30, format: '9:16', media }))
    const tText = readFileSync(join(fix, 'transcript.json'), 'utf8')
    writeFileSync(join(dir, 'transcript.json'), tText)
    const t = JSON.parse(tText) as Transcript
    writeFileSync(join(dir, 'marks.json'), JSON.stringify(alignScript(parseScript(readFileSync(join(fix, 'script.md'), 'utf8')), t.words)))
    writeFileSync(join(dir, 'brief.json'), JSON.stringify({ title: 'وفّر وقتك ومالك', type: 'explainer', cta: { keyword: 'دليل' } }))
    writeFileSync(join(dir, 'log.md'), '# log\n\n')

    const plan = run(dir, '--plan')
    expect(plan.status, plan.stderr).toBe(0)
    expect(existsSync(join(dir, 'plan.json'))).toBe(true)
    expect(existsSync(join(dir, 'edit.json'))).toBe(false)
    expect(plan.stdout).toMatch(/اللحظات المميزة: /)
    expect(plan.stdout).toMatch(/Hook options/)
    const h1 = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8')).transcriptHash as string
    expect(h1).toMatch(/^[0-9a-f]{40}$/)

    const compile = run(dir)
    expect(compile.status, compile.stderr).toBe(0)
    const edit = JSON.parse(readFileSync(join(dir, 'edit.json'), 'utf8'))
    expect(edit.look).toBe('paper-editorial')
    expect(edit.scenes.some((s: { type: string }) => s.type === 'section-number')).toBe(true)

    // One word 0.2 s later: the plan is stale.
    const moved = JSON.parse(tText) as Transcript
    const k = moved.words.findIndex((w, i) => i > 20 && i + 1 < moved.words.length && moved.words[i + 1]!.start - w.end >= 0.45)
    moved.words[k] = { ...moved.words[k]!, start: +(moved.words[k]!.start + 0.2).toFixed(3), end: +(moved.words[k]!.end + 0.2).toFixed(3) }
    writeFileSync(join(dir, 'transcript.json'), JSON.stringify(moved, null, 2) + '\n')
    const stale = run(dir)
    expect(stale.status).toBe(1)
    expect(stale.stderr).toMatch(/^خطة قديمة: التفريغ تغيّر/)
    expect(stale.stderr).toMatch(/stale plan\.json: the transcript changed; run mba explain --plan again/)
    const forced = run(dir, '--force')
    expect(forced.status, forced.stderr).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8')).transcriptHash).not.toBe(h1)
    expect(run(dir).status).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mba explain writes edit.json at the project fps: 60 on a 60 fps project, 30 on an existing 30 fps project', async () => {
  test.setTimeout(180_000)
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const engine = fileURLToPath(new URL('../..', import.meta.url))
  const fix = join(engine, 'tests/fixtures/explain')
  const tText = readFileSync(join(fix, 'transcript.json'), 'utf8')
  const t = JSON.parse(tText) as Transcript
  const marks = JSON.stringify(alignScript(parseScript(readFileSync(join(fix, 'script.md'), 'utf8')), t.words))
  for (const [fps, brief] of [
    [60, { title: 'وفّر وقتك ومالك', type: 'explainer', cta: { keyword: 'دليل' } }],
    [30, { title: 'وفّر وقتك ومالك', type: 'explainer', cta: { keyword: 'دليل' } }],
    [60, { title: 'وفّر وقتك ومالك', type: 'explainer', look: 'signature', cta: { keyword: 'دليل' } }],
  ] as const) {
    const dir = mkdtempSync(join(tmpdir(), 'mba fps 100% '))
    try {
      const media = [{ id: 'm1', source: 'source/voice.wav', durationSec: 22, kind: 'audio' }]
      writeFileSync(join(dir, 'mba-project.json'), JSON.stringify({ version: 1, id: 'fps-test', createdAt: '2026-10-31T00:00:00.000Z', fps, format: '9:16', media }))
      writeFileSync(join(dir, 'transcript.json'), tText)
      writeFileSync(join(dir, 'marks.json'), marks)
      writeFileSync(join(dir, 'brief.json'), JSON.stringify(brief))
      writeFileSync(join(dir, 'log.md'), '# log\n\n')
      const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'explain', dir], { cwd: engine, encoding: 'utf8' })
      expect(r.status, r.stderr).toBe(0)
      const edit = JSON.parse(readFileSync(join(dir, 'edit.json'), 'utf8')) as { fps: number; look: string }
      expect(edit.fps, `${edit.look} at ${fps}`).toBe(fps)
      const sb = parseStoryboard(resolveAnchors(edit, { transcript: t, marks: JSON.parse(marks), fps }).json, [...PRIMITIVE_IDS])
      expect(sb.fps).toBe(fps)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('Plan 2a+ ideas play end to end: hero handoffs, flood, giant word, shape states, camera, section numbers, word walls', async ({ page }) => {
  test.setTimeout(180_000)
  const { planExplainer, compilePlan } = await import('../../src/core/recipes/plan')
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const script = [
    'هذه طريقة بسيطة توفر عليك *المال* كل شهر «...»',
    'اضغط الزر في التطبيق ثم فعّل الإعدادات الجديدة «...»',
    'خسرت أكثر من ٣٠٠ ساعة في السنة على شغل مكرر',
    'والنتيجة فيديو جاهز بسرعة',
  ].join('\n')
  const texts = script.replace(/\*|«\.\.\.»/g, '').split(/\s+/).filter(Boolean)
  let t = 0.2
  const words = texts.map((text, i) => {
    const start = Math.round(t * 1000) / 1000
    const end = Math.round((t + 0.3) * 1000) / 1000
    t = end + (i === 7 || i === 15 ? 0.6 : 0.08)
    return { i, text, start, end, p: 0.9 }
  })
  const transcript: Transcript = { version: 1, media: 'm1', sourceHash: 'x', model: 'm', language: 'ar', words }
  const marks = alignScript(parseScript(script), words)
  for (const brief of [
    { title: 'وفّر وقتك ومالك', type: 'motion', hero: true, cta: { keyword: 'دليل' } },
    { type: 'explainer', hero: 'ball', cta: 'تابعني للمزيد' },
    { title: 'وفّر وقتك ومالك', type: 'product-launch', cta: { keyword: 'دليل' } },
  ] as const) {
    const input = { transcript, marks, brief: parseBrief(brief), voiceMedia: 'm1', fps: 30, seed: 7 }
    const plan = planExplainer(input)
    // Hand edits: the stressed beat as a giant word, a flood into the second beat.
    const k = words.findIndex((w) => w.text === 'المال')
    const fx = plan.beats.findIndex((b, x) => x >= 3 && b.idea === undefined && plan.beats[x - 1]!.idea !== 'flood')
    const beats = plan.beats.map((b, x) => (b.from <= k && k < b.to ? { ...b, idea: 'giant-word' as const } : x === fx ? { ...b, idea: 'flood' as const } : b))
    const raw = compilePlan({ ...plan, beats }, input)
    const json = resolveAnchors(raw, { transcript, marks, fps: 30 }).json as Record<string, unknown>
    delete json.audio
    const sb = parseStoryboard(json, [...PRIMITIVE_IDS])
    const types = new Set(sb.scenes.map((s) => s.type))
    if (brief.type !== 'product-launch') expect(types.has('hero'), brief.type).toBe(true)
    if (brief.type === 'explainer') expect(types.has('shape-states'), brief.type).toBe(true)
    expect((sb.transitions ?? []).some((tr) => tr.type === 'flood'), brief.type).toBe(true)
    expect(sb.scenes.some((s) => s.type === 'kinetic-text' && s.params.mode === 'giant'), brief.type).toBe(true)
    await openStoryboard(page, json)
    expect(await page.evaluate(() => window.__mba.error), brief.type).toBeUndefined()
    expect(isNearBlank(await frameAt(page, 0)), brief.type).toBe(false)
    const end = Math.max(...sb.scenes.map((s) => s.start + s.duration))
    for (let x = 0.05; x < end; x += 0.25) await page.evaluate((tt) => window.__mba.seek(tt), x)
    for (const tr of sb.transitions ?? []) await page.evaluate((tt) => window.__mba.seek(tt), tr.at)
    expect(await page.evaluate(() => window.__mba.error), brief.type).toBeUndefined()
  }
  expect(errors).toEqual([])
})

test('ruling T9-c: at a section number’s midpoint its glyphs and the visible kinetic text never intersect', async ({ page }) => {
  test.setTimeout(180_000)
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const fix = fileURLToPath(new URL('../fixtures/explain/', import.meta.url))
  const transcript = JSON.parse(readFileSync(fix + 'transcript.json', 'utf8')) as Transcript
  const marks = alignScript(parseScript(readFileSync(fix + 'script.md', 'utf8')), transcript.words)
  for (const format of ['9:16', '16:9', '1:1'] as const) {
    const raw = explainerStoryboard({ transcript, marks, brief: parseBrief({ ...JSON.parse(readFileSync(fix + 'brief.json', 'utf8')), format }), voiceMedia: 'm1', fps: 30, seed: 7 })
    const json = resolveAnchors(raw, { transcript, marks, fps: 30 }).json as Record<string, unknown>
    delete json.audio
    const sb = parseStoryboard(json, [...PRIMITIVE_IDS])
    const nums = sb.scenes.filter((s) => s.type === 'section-number')
    expect(nums.length, format).toBeGreaterThan(0)
    await openStoryboard(page, json)
    for (const n of nums) {
      await page.evaluate((tt) => window.__mba.seek(tt), n.start + n.duration / 2)
      const boxes = await page.evaluate(() => {
        const rects = (sel: string) =>
          [...document.querySelectorAll<HTMLElement>(sel)].flatMap((root) => {
            const scene = root.closest<HTMLElement>('[data-mba-scene]')
            if (!scene || getComputedStyle(scene).display === 'none') return []
            const out: { l: number; t: number; r: number; b: number }[] = []
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
            for (let x = walker.nextNode(); x; x = walker.nextNode()) {
              if (!x.textContent?.trim()) continue
              const el = x.parentElement!
              if (Number(getComputedStyle(el).opacity) < 0.05 || el.closest('[aria-hidden=true]')) continue
              const g = document.createRange()
              g.selectNodeContents(x)
              for (const b of g.getClientRects()) if (b.width > 0 && b.height > 0) out.push({ l: b.left, t: b.top, r: b.right, b: b.bottom })
            }
            return out
          })
        return { num: rects('#frame [data-mba-part=section-number]'), text: rects('#frame [data-mba-part=kinetic-text]') }
      })
      expect(boxes.num.length, `${format} ${n.id}`).toBeGreaterThan(0)
      expect(boxes.text.length, `${format} ${n.id} kinetic text on screen`).toBeGreaterThan(0)
      for (const a of boxes.num) {
        for (const b of boxes.text) {
          const hit = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
          expect(hit, `${format} ${n.id}: number ${JSON.stringify(a)} over text ${JSON.stringify(b)}`).toBe(false)
        }
      }
    }
  }
})

test('Task 7: a signature draft render of the v1-voice fixture passes mba verify and mba review (moving ≥ 0.9, max gap ≤ 1.0, audit 0, blank 0)', async () => {
  test.setTimeout(1_200_000)
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, chmodSync, statSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const engine = fileURLToPath(new URL('../..', import.meta.url))
  const fix = join(engine, 'tests/fixtures/v1-voice')
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: engine, encoding: 'utf8', maxBuffer: 1 << 26 })
  const root = mkdtempSync(join(tmpdir(), 'mba signature 100% '))
  const unlock = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) unlock(p)
      else chmodSync(p, 0o644)
    }
  }
  try {
    const tText = readFileSync(join(fix, 'transcript.json'), 'utf8')
    const t = JSON.parse(tText) as Transcript
    // A stand-in voice: seeded noise bursts on the transcript's word times, 26 s, 16 kHz mono.
    const rate = 16_000
    const n = 26 * rate
    const data = Buffer.alloc(n * 2)
    let s = 99
    for (let q = 0; q < n; q++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      const time = q / rate
      const on = t.words.some((w) => time >= w.start && time < w.end) ? 1 : 0
      data.writeInt16LE(Math.round((s / 2 ** 32 - 0.5) * 0.5 * on * 32767), q * 2)
    }
    const h = Buffer.alloc(44)
    h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii'); h.write('fmt ', 12, 'ascii')
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28)
    h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40)
    const wav = join(root, 'صوت.wav')
    writeFileSync(wav, Buffer.concat([h, data]))
    const dir = join(root, 'توقيع')
    const init = cli('project', 'init', dir, wav)
    expect(init.status, init.stderr).toBe(0)
    const ing = cli('ingest', dir)
    expect(ing.status, ing.stderr).toBe(0)
    writeFileSync(join(dir, 'transcript.json'), tText)
    writeFileSync(join(dir, 'marks.json'), JSON.stringify(alignScript(parseScript(readFileSync(join(fix, 'script.md'), 'utf8')), t.words)))
    writeFileSync(join(dir, 'brief.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(fix, 'brief.json'), 'utf8')), look: 'signature', currency: 'AED' }))
    const ex = cli('explain', dir)
    expect(ex.status, ex.stderr).toBe(0)
    console.log(`[signature] ${ex.stdout.trim()}`)
    const edit = JSON.parse(readFileSync(join(dir, 'edit.json'), 'utf8'))
    expect(edit.look).toBe('signature')
    // The Node side fed the voice levels to the microphone and the timeline.
    const states = edit.scenes.filter((x: { type: string }) => x.type === 'morph-object').flatMap((x: { params: { states: { object: string; levels?: number[] }[] } }) => x.params.states)
    expect(states.find((x: { object: string }) => x.object === 'microphone')?.levels?.length).toBeGreaterThan(5)
    const rn = cli('render', dir, '--draft')
    expect(rn.status, rn.stderr).toBe(0)
    const vf = cli('verify', dir)
    console.log(`[signature] verify: ${vf.stdout.trim()}`)
    expect(vf.status, vf.stdout + vf.stderr).toBe(0)
    const rv = cli('review', dir)
    expect(rv.status, rv.stderr).toBe(0)
    console.log(`[signature] review: ${rv.stdout.trim()}`)
    const m = JSON.parse(readFileSync(join(dir, 'review', 'r1', 'metrics.json'), 'utf8')) as {
      movingPct: number
      maxEventGap: number
      frame0Blank: boolean
      eventTimes?: number[]
      nearBlankRuns?: { designed: boolean }[]
      audit: { t: number; issues: { rule: string; text?: string }[] }[] | null
    }
    console.log(`[signature] moving ${m.movingPct}, maxEventGap ${m.maxEventGap}, events ${JSON.stringify(m.eventTimes)}`)
    expect(m.movingPct).toBeGreaterThanOrEqual(0.9)
    expect(m.maxEventGap).toBeLessThanOrEqual(1.0)
    expect(m.frame0Blank).toBe(false)
    expect((m.nearBlankRuns ?? []).filter((r) => !r.designed)).toEqual([])
    expect(m.audit).not.toBeNull()
    expect(m.audit!.flatMap((a) => a.issues.map((i) => `${a.t}: ${i.rule} ${i.text ?? ''}`))).toEqual([])
  } finally {
    try {
      unlock(root)
    } catch {}
    rmSync(root, { recursive: true, force: true })
  }
})
