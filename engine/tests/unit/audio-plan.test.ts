import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseStoryboard, type AudioClip } from '../../src/core/storyboard'
import { planSfx, mergePlannedAudio, userSfxMap, SFX_GAIN, CUES, LIST_TYPES, type CuesOf } from '../../src/core/audio-plan'
import { cutCue, RISER_SEC } from '../../src/core/params/transitions'
import { RISER_SEC as SYNTH_RISER, sfxKey, wavBytes } from '../../src/node/sfx-synth'
import { jobHashOf, RENDER_RECIPE } from '../../src/node/render'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { typingTimes, searchTypingParams } from '../../src/core/params/search-typing'
import { buildMixArgs, measureLoudness, resolveAudioClips, sourceGain, audioHashInputs } from '../../src/node/audio'
import { sfxWav, SFX_RECIPE } from '../../src/node/sfx-synth'

const FPS = 30
const sb = (o: Record<string, unknown>, types: string[]) => parseStoryboard({ version: 1, fps: FPS, ...o }, types)
const sfxOf = (clips: AudioClip[]) => clips.filter((c) => c.kind === 'sfx')

/** Test cue sources, injected (not in the production CUES table). */
const TEST_CUES: Record<string, CuesOf> = {
  _cues: () => [0.5, 1, 1.5].map((t) => ({ t, kind: 'action' as const })),
  _pops: () => [0.2, 0.6, 1, 1.4, 1.8, 2.2].map((t) => ({ t, kind: 'pop' as const })),
  _roll: () => [{ t: 0.5, kind: 'count' as const, duration: 4.5 }],
  checklist: () => [{ t: 0.5, kind: 'action' as const }],
}

describe('planSfx', () => {
  it('search-typing: one key per letter at its typed time (the schedule the picture uses)', () => {
    const params = { text: 'مرحبا' }
    const s = sb({ scenes: [{ id: 's', type: 'search-typing', start: 2, duration: 4, params }] }, ['search-typing'])
    const keys = sfxOf(planSfx(s, { fps: FPS, cues: TEST_CUES })).filter((c) => c.sfx === 'key')
    const times = typingTimes(searchTypingParams.parse(params), 4)
    expect(times).toHaveLength(5)
    expect(keys).toHaveLength(5)
    keys.forEach((k, i) => expect(Math.abs(k.at - (2 + times[i]!))).toBeLessThanOrEqual(1 / FPS / 2 + 1e-9))
  })
  it('action cues → one tap on each cue frame (the _cues test primitive: 0.5 / 1.0 / 1.5)', () => {
    const s = sb({ scenes: [{ id: 'c', type: '_cues', start: 1, duration: 3, params: {} }] }, ['_cues'])
    const taps = sfxOf(planSfx(s, { fps: FPS, cues: TEST_CUES }))
    expect(taps.map((c) => [c.sfx, c.at])).toEqual([['tap', 1.5], ['tap', 2], ['tap', 2.5]])
  })
  it('a hard cut (hit: true): riser ending on the cut, impact on it, nothing else in [at − 0.85, at), music dipped −12 dB before the riser', () => {
    const s = sb(
      {
        scenes: [
          { id: 'a', type: 'search-typing', start: 0, duration: 4, params: { text: 'مرحبا بكم في هذا الفيديو الطويل جدا' } },
          { id: 'b', type: '_cues', start: 4, duration: 3, params: {} },
        ],
        transitions: [{ type: 'color-wipe', at: 4, params: { hit: true } }],
        audio: [{ id: 'bed', kind: 'music', media: 'm9' }],
      },
      ['search-typing', '_cues'],
    )
    const planned = planSfx(s, { fps: FPS, cues: TEST_CUES })
    const fx = sfxOf(planned)
    const riser = fx.find((c) => c.sfx === 'riser')!
    expect(Math.abs(riser.at + riser.duration! - 4)).toBeLessThanOrEqual(1 / FPS)
    expect(riser.duration).toBeCloseTo(0.6, 6)
    expect(fx.find((c) => c.sfx === 'impact')!.at).toBe(4)
    expect(fx.filter((c) => c !== riser && c.at >= 3.15 && c.at < 4)).toEqual([])
    expect(fx.filter((c) => c.sfx === 'key').length).toBeGreaterThan(0) // keys before the quiet window survive
    const bed = planned.find((c) => c.id === 'bed')!
    expect(bed.dips).toHaveLength(1)
    expect(bed.dips![0]!.at).toBeCloseTo(riser.at - 0.25, 9)
    expect(bed.dips![0]).toMatchObject({ duration: 0.25, db: -12 })
  })
  it('a plain transition: no clip; the merge keeps user clips', () => {
    const s = sb(
      {
        scenes: [
          { id: 'a', type: 'slam', start: 0, duration: 2, params: { text: 'واحد' } },
          { id: 'b', type: 'slam', start: 2, duration: 2, params: { text: 'اثنان' } },
        ],
        transitions: [{ type: 'whip-pan', at: 2 }],
        audio: [{ id: 'mine', kind: 'sfx', sfx: 'chime', at: 3 }],
      },
      ['slam'],
    )
    const planned = planSfx(s, { fps: FPS, cues: TEST_CUES })
    expect(planned.filter((c) => c.sfx === 'riser' || c.sfx === 'impact')).toEqual([])
    const merged = mergePlannedAudio(s.audio, planned)
    expect(merged.find((c) => c.id === 'mine')).toBeDefined()
  })
  it('two cues on the same frame → one clip', () => {
    const s = sb(
      {
        scenes: [
          { id: 'c1', type: '_cues', start: 0, duration: 3, params: {} },
          { id: 'c2', type: '_cues', start: 0, duration: 3, track: 1, params: {} },
        ],
      },
      ['_cues'],
    )
    expect(sfxOf(planSfx(s, { fps: FPS, cues: TEST_CUES }))).toHaveLength(3)
  })
  it('every clip ≤ −12 dB; ids are unique', () => {
    const s = sb({ scenes: [{ id: 's', type: 'search-typing', start: 0, duration: 4, params: { text: 'abc' } }] }, ['search-typing'])
    const fx = sfxOf(planSfx(s, { fps: FPS, cues: TEST_CUES }))
    expect(fx.length).toBeGreaterThan(0)
    for (const c of fx) expect(c.gain).toBeLessThanOrEqual(-12)
    for (const g of Object.values(SFX_GAIN)) expect(g).toBeLessThanOrEqual(-12)
    expect(new Set(fx.map((c) => c.id)).size).toBe(fx.length)
  })
  it('R5: user SFX files replace the synth (whoosh→riser, click→tap+key, impact→impact, pop→mallet)', () => {
    const map = userSfxMap([
      { id: 'm2', role: 'sfx', source: 'source/Whoosh.wav' },
      { id: 'm3', role: 'sfx', source: 'source/click.mp3' },
      { id: 'm4', role: 'sfx', source: 'source/pop.wav' },
      { id: 'm5', role: 'music', source: 'source/impact.wav' },
    ])
    expect(map).toEqual({ riser: 'm2', tap: 'm3', key: 'm3', mallet: 'm4' })
    const s = sb({ scenes: [{ id: 'c', type: '_cues', start: 0, duration: 3, params: {} }] }, ['_cues'])
    const fx = sfxOf(planSfx(s, { fps: FPS, cues: TEST_CUES, userSfx: map }))
    expect(fx).toHaveLength(3)
    expect(fx.every((c) => c.media === 'm3' && c.sfx === undefined)).toBe(true)
  })
  it('pop cues → mallet, variant = cue index mod 5', () => {
    const s = sb({ scenes: [{ id: 'p', type: '_pops', start: 0, duration: 3, params: {} }] }, ['_pops'])
    const fx = sfxOf(planSfx(s, { fps: FPS, cues: TEST_CUES }))
    expect(fx.map((c) => [c.sfx, c.variant])).toEqual([0, 1, 2, 3, 4, 0].map((v) => ['mallet', v]))
  })
})

describe('R4 music dips in the mix', () => {
  it('each dip is a volume step enabled between its clip-local start and end', () => {
    const args = buildMixArgs({
      clips: [{ id: 'bed', bus: 'music', input: 'm.wav', in: 0, duration: 10, speed: 1, at: 2, gain: -21, fadeIn: 0, fadeOut: 0, dips: [{ at: 5, duration: 0.25, db: -12 }] }],
      total: 12,
      out: 'o.wav',
    })
    const g = args[args.indexOf('-filter_complex') + 1]!
    expect(g).toContain("volume=-12dB:enable='between(t,3,3.25)'")
  })
  it('dips are music only', () => {
    expect(() => sb({ scenes: [{ id: 's', type: 'slam', start: 0, duration: 1, params: {} }], audio: [{ kind: 'sfx', sfx: 'tap', dips: [{ at: 0, duration: 1, db: -6 }] }] }, ['slam'])).toThrow(/dips/)
  })
})

describe('synth SFX levelling and hash (carried from Task 4)', () => {
  it('synth clips get the same R12 source correction as user SFX; the hash names the recipe and variant', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mba plan '))
    try {
      const s = sb({ scenes: [{ id: 's', type: 'slam', start: 0, duration: 3, params: { text: 'نص' } }], audio: [{ id: 'k', kind: 'sfx', sfx: 'mallet', variant: 3, at: 1 }] }, ['slam'])
      const project = { dir, manifest: { media: [] } }
      const clips = await resolveAudioClips(project as never, s, 3, { synth: (name, variant) => sfxWav(dir, name, variant) })
      const m = await measureLoudness(clips[0]!.input)
      expect(clips[0]!.gain).toBeCloseTo(-14 + sourceGain(m.i), 6)
      expect(clips[0]!.input).toContain(`mallet-3-${SFX_RECIPE}.wav`)
      expect(audioHashInputs(s, [])).toEqual([{ id: 'k', hash: `sfx:mallet-3-${SFX_RECIPE}` }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('fix round 1', () => {
  const hitSb = (cut: number) =>
    sb(
      {
        scenes: [
          { id: 'a', type: 'slam', start: 0, duration: cut, params: { text: 'واحد' } },
          { id: 'b', type: 'slam', start: cut, duration: 2, params: { text: 'اثنان' } },
        ],
        transitions: [{ type: 'color-wipe', at: cut, duration: 0.2, params: { hit: true } }],
      },
      ['slam'],
    )
  const sine = (sec: number) => {
    const x = new Float32Array(Math.round(sec * 48000))
    for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / 48000)
    return x
  }

  it('user whoosh (0.3 s and 2 s) is end-aligned: it ends on the cut, the impact stays on the cut', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mba whoosh '))
    try {
      await mkdir(join(dir, 'work'), { recursive: true })
      for (const len of [0.3, 2]) {
        await writeFile(join(dir, 'work', `w${len}.wav`), wavBytes(sine(len), 48000))
        const project = { dir, manifest: { media: [{ id: 'm2', work: `work/w${len}.wav`, durationSec: len }] } }
        const s = hitSb(4)
        s.audio = mergePlannedAudio(s.audio, planSfx(s, { fps: FPS, userSfx: { riser: 'm2' } }))
        const clips = await resolveAudioClips(project as never, s, 6, { synth: (n, v, l) => sfxWav(dir, n, v, l) })
        const w = clips.find((c) => c.input.endsWith(`w${len}.wav`))!
        expect(Math.abs(w.at + w.duration - 4), `whoosh ${len}`).toBeLessThanOrEqual(1 / FPS)
        expect(w.duration).toBeCloseTo(Math.min(len, RISER_SEC), 6)
        expect(w.in).toBeCloseTo(Math.max(0, len - RISER_SEC), 6)
        const impact = s.audio!.find((c) => c.sfx === 'impact')!
        expect(impact.at).toBe(4)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('a hard cut before 0.6 s: the riser plays the end of its source (full level on the cut)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mba early '))
    try {
      const s = hitSb(0.4)
      s.audio = mergePlannedAudio(s.audio, planSfx(s, { fps: FPS }))
      const clips = await resolveAudioClips({ dir, manifest: { media: [] } } as never, s, 2.4, { synth: (n, v, l) => sfxWav(dir, n, v, l) })
      const r = clips.find((c) => c.input.includes('riser'))!
      expect(r.at).toBeCloseTo(0, 9)
      expect(r.in).toBeCloseTo(0.2, 6)
      expect(r.duration).toBeCloseTo(0.4, 6)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('RISER_SEC is one constant; cutCue gives riser and impact times of hard cuts only', () => {
    expect(SYNTH_RISER).toBe(RISER_SEC)
    expect(cutCue({ at: 4, params: { hit: true } })).toEqual({ riserAt: 4 - RISER_SEC, impactAt: 4 })
    expect(cutCue({ at: 0.3, params: { hit: true } })).toEqual({ riserAt: 0, impactAt: 0.3 })
    expect(cutCue({ at: 4, params: { hit: false } })).toBeNull()
  })

  it('a 4.5 s count roll keeps sounding to its end (synthesized at the roll length, length in the name and hash)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mba roll '))
    try {
      const s = sb({ scenes: [{ id: 'r', type: '_roll', start: 0, duration: 6, params: {} }] }, ['_roll'])
      s.audio = mergePlannedAudio(s.audio, planSfx(s, { fps: FPS, cues: TEST_CUES }))
      const clips = await resolveAudioClips({ dir, manifest: { media: [] } } as never, s, 6, { synth: (n, v, l) => sfxWav(dir, n, v, l) })
      expect(clips[0]!.duration).toBeCloseTo(4.5, 6)
      expect(clips[0]!.input).toContain(`${sfxKey('count', 0, 4.5)}.wav`)
      expect(sfxKey('count', 0, 4.5)).toContain('4.5s')
      expect(audioHashInputs(s, [])[0]!.hash).toBe(`sfx:${sfxKey('count', 0, 4.5)}`)
      const pcm = (await readFile(clips[0]!.input)).subarray(44)
      let m = 0
      for (let i = Math.round(4.0 * 48000); i < Math.round(4.5 * 48000); i++) m = Math.max(m, Math.abs(pcm.readInt16LE(i * 2)))
      expect(m).toBeGreaterThan(1000)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('test cue sources are not in the production table; list ticks come from an explicit set', () => {
    expect(Object.keys(CUES).filter((k) => k.startsWith('_'))).toEqual([])
    expect([...LIST_TYPES]).toEqual(['checklist'])
    const s = sb({ scenes: [{ id: 'c', type: 'checklist', start: 0, duration: 2, params: { items: [{ text: 'أولاً', at: 0.25 }] } }, { id: 'l', type: '_cues', start: 2, duration: 2, params: {} }] }, ['checklist', '_cues'])
    const fx = sfxOf(planSfx(s, { fps: FPS, cues: TEST_CUES }))
    expect(fx.map((c) => c.sfx)).toEqual(['tick', 'tap', 'tap', 'tap'])
  })

  it('sfxWav does not synthesize again on a cache hit (length read from the file)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mba cache '))
    try {
      const a = await sfxWav(dir, 'tap', 0)
      await writeFile(a.path, wavBytes(new Float32Array(48000), 48000)) // a 1 s stand-in
      const before = (await stat(a.path)).mtimeMs
      const b = await sfxWav(dir, 'tap', 0)
      expect(b.durationSec).toBe(1)
      expect((await stat(a.path)).mtimeMs).toBe(before)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('the job hash covers the planned audio[]; RENDER_RECIPE is 9', () => {
    const base = { engine: 'e', recipe: RENDER_RECIPE, ffmpeg: 'f', sb: {}, fps: 30, draft: false, chunkFrames: 1, media: [], transcript: null, marks: null, audio: [] }
    expect(RENDER_RECIPE).toBe(9)
    expect(jobHashOf({ ...base, audioClips: [{ id: 'auto0', at: 1 }] })).not.toBe(jobHashOf({ ...base, audioClips: [{ id: 'auto0', at: 2 }] }))
  })
})

describe('Task 9: hit cue (stamp) → impact at −16 dB (R11)', () => {
  it('planSfx turns a stamp cue into one impact at −16 dB on its frame', () => {
    const s = sb({ scenes: [{ id: 'st', type: 'stamp', start: 1.01, duration: 2, params: { text: 'جديد' } }] }, ['stamp'])
    const fx = sfxOf(planSfx(s, { fps: FPS }))
    expect(fx).toHaveLength(1)
    expect(fx[0]).toMatchObject({ sfx: 'impact', gain: -16, at: Math.round(1.01 * FPS) / FPS })
    expect(SFX_GAIN.impact).toBe(-12) // a hard cut's impact keeps its own level
  })
  it('every Task 9 device that makes a sound has a cue source', () => {
    for (const id of ['phone', 'app-window', 'stamp', 'highlight', 'comment-cta']) expect(CUES[id], id).toBeTypeOf('function')
    expect(CUES.hud).toBeUndefined()
  })
})

describe('Task 10: sfxGainDb (video-type SFX offset)', () => {
  it('lowers every planned SFX by the offset; out of range is refused', () => {
    const scenes = [{ id: 'c', type: '_cues', start: 1, duration: 3, params: {} }]
    const base = sfxOf(planSfx(sb({ scenes }, ['_cues']), { fps: FPS, cues: TEST_CUES }))
    const soft = sfxOf(planSfx(sb({ scenes, sfxGainDb: -4 }, ['_cues']), { fps: FPS, cues: TEST_CUES }))
    expect(soft.map((c) => c.gain)).toEqual(base.map((c) => c.gain - 4))
    expect(() => sb({ scenes, sfxGainDb: 2 }, ['_cues'])).toThrow(/sfxGainDb/)
  })
})
