import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { jobHashOf, loadStoryboardFile } from '../../src/node/render'

const brand = { name: 'يوسف', handle: '@y', colors: { primary: '#ff5a1f', secondary: '#111111', bg: '#0e0d0c', text: '#f2ece2' } }
const sb = { version: 1, scenes: [{ id: 'a', type: '_probe', start: 0, duration: 1, params: { text: 'مرحبا' } }] }

async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'mba prep تجربة-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('loadStoryboardFile', () => {
  it('loads mba-brand.json beside the storyboard and inlines a relative logo', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'شعار.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
      await writeFile(join(dir, 'mba-brand.json'), JSON.stringify({ ...brand, logo: 'شعار.svg' }))
      await writeFile(join(dir, 'sb.json'), '﻿' + JSON.stringify(sb))
      const r = await loadStoryboardFile(join(dir, 'sb.json'))
      const logo = (r.json as { brand: { logo: string } }).brand.logo
      expect(logo.startsWith('data:image/svg+xml;base64,')).toBe(true)
      expect(r.sb.brand?.name).toBe('يوسف')
      expect(r.sb.brand?.logo).toBe(logo)
    })
  })
  it('a brand inside the storyboard wins over mba-brand.json', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'mba-brand.json'), JSON.stringify({ ...brand, name: 'other' }))
      await writeFile(join(dir, 'sb.json'), JSON.stringify({ ...sb, brand }))
      expect((await loadStoryboardFile(join(dir, 'sb.json'))).sb.brand?.name).toBe('يوسف')
    })
  })
  it('a missing logo file is an error naming the path', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'sb.json'), JSON.stringify({ ...sb, brand: { ...brand, logo: 'missing logo.png' } }))
      await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/missing logo\.png/)
    })
  })
  it('a schema error keeps the field path', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'sb.json'), JSON.stringify({ ...sb, scenes: [{ ...sb.scenes[0], duration: -1 }] }))
      await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/scenes\[0\]\.duration/)
    })
  })
  it('per-primitive params are validated node-side with the scenes[i].params path', async () => {
    await withDir(async (dir) => {
      const bad = { version: 1, scenes: [{ id: 'w', type: 'wipe-reveal', start: 0, duration: 2, params: { title: 'ا'.repeat(41) } }] }
      await writeFile(join(dir, 'sb.json'), JSON.stringify(bad))
      await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/^scenes\[0\]\.params\.title: /)
      const nested = { version: 1, scenes: [{ id: 's', type: 'slam', start: 0, duration: 2, params: { text: 'جديد', accent: 'x' } }] }
      await writeFile(join(dir, 'sb.json'), JSON.stringify(nested))
      await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/^scenes\[0\]\.params\.accent: /)
    })
  })
  it('a missing storyboard file is a clear error', async () => {
    await withDir(async (dir) => {
      await expect(loadStoryboardFile(join(dir, 'nope.json'))).rejects.toThrow(/nope\.json/)
    })
  })
})

describe('word anchors at load time', () => {
  const transcript = {
    version: 1,
    media: 'm1',
    sourceHash: 'x',
    model: 'ggml-small.bin',
    language: 'ar',
    words: [
      { i: 0, text: 'مرحبا', start: 1.02, end: 1.4, p: 0.9 },
      { i: 1, text: 'بكم', start: 2.51, end: 3, p: 0.9 },
    ],
  }
  const marks = { stress: [1], pauses: [{ after: 0, at: 1.4, gap: 1.11 }], unmatched: [] }
  const anchored = {
    version: 1,
    scenes: [{ id: 'a', type: '_probe', start: { word: 0 }, duration: { until: { word: 1, edge: 'end' } }, params: { text: 'مرحبا', items: [{ at: { pause: 0 } }] } }],
  }
  async function project(dir: string, files: { transcript?: string; marks?: string }) {
    await writeFile(
      join(dir, 'mba-project.json'),
      JSON.stringify({ version: 1, id: 'p1', createdAt: '2026-10-28T00:00:00.000Z', fps: 30, media: [{ id: 'm1', kind: 'audio', source: 'source/v.m4a', work: 'work/m1.wav', durationSec: 4 }] }),
    )
    if (files.transcript !== undefined) await writeFile(join(dir, 'transcript.json'), files.transcript)
    if (files.marks !== undefined) await writeFile(join(dir, 'marks.json'), files.marks)
    await writeFile(join(dir, 'sb.json'), JSON.stringify(anchored))
  }
  const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')
  const keysDeep = (x: unknown): string[] =>
    Array.isArray(x) ? x.flatMap(keysDeep) : x && typeof x === 'object' ? Object.entries(x).flatMap(([k, v]) => [k, ...keysDeep(v)]) : []

  it('anchors resolve to numbers; the page-facing JSON has no anchor keys; inputs carry the sha1 of the bytes', async () => {
    await withDir(async (dir) => {
      const t = JSON.stringify(transcript)
      const m = JSON.stringify(marks)
      await project(dir, { transcript: t, marks: m })
      const r = await loadStoryboardFile(join(dir, 'sb.json'), { testTypes: true })
      const sc = (r.json as { scenes: { start: unknown; duration: unknown; params: { items: { at: unknown }[] } }[] }).scenes[0]!
      expect(sc.start).toBe(31 / 30)
      expect(sc.duration).toBeCloseTo(2 - 31 / 30 + 1, 10) // until frame 90 (3 s)
      expect(sc.params.items[0]!.at).toBeCloseTo(11 / 30, 10) // 1.4 s → frame 42, minus 31
      expect(r.sb.scenes[0]!.start).toBe(31 / 30)
      const keys = keysDeep(r.json)
      for (const k of ['word', 'pause', 'until', 'edge', 'offset']) expect(keys).not.toContain(k)
      expect(r.inputs).toEqual({ transcript: sha1(t), marks: sha1(m) })
    })
  })
  it('a project without transcript.json: inputs are null; an anchor is the no-transcript error', async () => {
    await withDir(async (dir) => {
      await project(dir, {})
      await expect(loadStoryboardFile(join(dir, 'sb.json'), { testTypes: true })).rejects.toThrow(/^scenes\[0\]\.start: .+ — no transcript; run mba transcribe$/)
      await writeFile(join(dir, 'sb.json'), JSON.stringify(sb))
      expect((await loadStoryboardFile(join(dir, 'sb.json'), { testTypes: true })).inputs).toEqual({ transcript: null, marks: null })
    })
  })
  it('a plain storyboard (no project) has null inputs', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'sb.json'), JSON.stringify(sb))
      expect((await loadStoryboardFile(join(dir, 'sb.json'), { testTypes: true })).inputs).toEqual({ transcript: null, marks: null })
    })
  })
  it('an invalid transcript.json names the file', async () => {
    await withDir(async (dir) => {
      await project(dir, { transcript: '{"version":1' })
      await expect(loadStoryboardFile(join(dir, 'sb.json'), { testTypes: true })).rejects.toThrow(/transcript\.json/)
    })
  })
})

describe('job hash covers the transcript', () => {
  const base = { engine: '1.0.0', recipe: 3, ffmpeg: 'ffmpeg version 9', sb: { scenes: [] }, fps: 30, draft: false, chunkFrames: 300, media: [], marks: null, audio: [] }
  it('differs when only the transcript differs; identical for identical bytes', () => {
    const a = jobHashOf({ ...base, transcript: 'aaaa' })
    expect(jobHashOf({ ...base, transcript: 'aaaa' })).toBe(a)
    expect(jobHashOf({ ...base, transcript: 'bbbb' })).not.toBe(a)
    expect(jobHashOf({ ...base, transcript: null })).not.toBe(a)
    expect(jobHashOf({ ...base, transcript: 'aaaa', marks: 'cccc' })).not.toBe(a)
    expect(jobHashOf({ ...base, transcript: 'aaaa', audio: [{ id: 'a0', hash: 'h' }] })).not.toBe(a)
  })
})

describe('phone screen images (Task 9)', () => {
  it('a relative screen.image is inlined as a data URL at load; a missing one is refused at its path', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'لقطة شاشة.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
      const phone = (image: string) => ({ version: 1, scenes: [{ id: 'p', type: 'phone', start: 0, duration: 2, params: { screen: { image } } }] })
      await writeFile(join(dir, 'sb.json'), JSON.stringify(phone('لقطة شاشة.svg')))
      const r = await loadStoryboardFile(join(dir, 'sb.json'))
      const img = (r.sb.scenes[0]!.params as { screen: { image: string } }).screen.image
      expect(img.startsWith('data:image/svg+xml;base64,')).toBe(true)
      await writeFile(join(dir, 'sb.json'), JSON.stringify(phone('missing.png')))
      await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/scenes\[0\]\.params\.screen\.image/)
    })
  })
})

describe('image inlining: offline and capped (Task 9 fix round 1)', () => {
  const phone = (image: string) => ({ version: 1, scenes: [{ id: 'p', type: 'phone', start: 0, duration: 2, params: { screen: { image } } }] })
  it('a remote phone screen image is refused at its path, Arabic first', async () => {
    await withDir(async (dir) => {
      for (const url of ['https://example.com/a.png', 'http://x/y.jpg']) {
        await writeFile(join(dir, 'sb.json'), JSON.stringify(phone(url)))
        await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/^لا تُقبل روابط الإنترنت.* — scenes\[0\]\.params\.screen\.image: .*no remote URLs/)
      }
    })
  })
  it('a remote brand.logo is refused at brand.logo, Arabic first', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'mba-brand.json'), JSON.stringify({ ...brand, logo: 'https://example.com/logo.png' }))
      await writeFile(join(dir, 'sb.json'), JSON.stringify(sb))
      await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/^لا تُقبل روابط الإنترنت.* — brand\.logo: /)
    })
  })
  it('images over 8 MB are refused (file and data URL; phone and logo)', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'big.png'), Buffer.alloc(8 * 1024 * 1024 + 1))
      await writeFile(join(dir, 'sb.json'), JSON.stringify(phone('big.png')))
      await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/أكبر من 8 ميغابايت — scenes\[0\]\.params\.screen\.image: .*over the 8 MB limit/)
      const bigData = `data:image/png;base64,${'A'.repeat(Math.ceil(((8 * 1024 * 1024 + 4) * 4) / 3))}`
      await writeFile(join(dir, 'sb.json'), JSON.stringify(phone(bigData)))
      await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/scenes\[0\]\.params\.screen\.image: .*over the 8 MB limit/)
      await writeFile(join(dir, 'mba-brand.json'), JSON.stringify({ ...brand, logo: 'big.png' }))
      await writeFile(join(dir, 'sb.json'), JSON.stringify(sb))
      await expect(loadStoryboardFile(join(dir, 'sb.json'))).rejects.toThrow(/over the 8 MB limit/)
    })
  })
})
