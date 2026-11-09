import { describe, it, expect } from 'vitest'
import { SFX_RECIPE } from '../../src/node/sfx-synth'
import {
  audioHashInputs,
  buildLoudnormArgs,
  buildMixArgs,
  clipSpan,
  DUCK,
  loudnessVerdict,
  LOUDNESS,
  LOUDNORM_TP,
  MIX_LIMIT,
  parseEbur128,
  parseLoudnormJson,
  parseNormalizationType,
  pass2Plan,
  sourceGain,
  trackSamples,
  SOURCE_REF_LUFS,
  type ResolvedClip,
} from '../../src/node/audio'
import { parseStoryboard } from '../../src/core/storyboard'

const clip = (o: Partial<ResolvedClip> & Pick<ResolvedClip, 'id' | 'bus' | 'input'>): ResolvedClip => ({
  in: 0, duration: 10, speed: 1, at: 0, gain: 0, fadeIn: 0, fadeOut: 0, ...o,
})
const graphOf = (a: string[]) => a[a.indexOf('-filter_complex') + 1]!

describe('buildMixArgs', () => {
  const total = 20
  const voice = clip({ id: 'a0', bus: 'voice', input: 'C:/p 100%/work/m1.wav', duration: 18 })
  const music = clip({ id: 'a1', bus: 'music', input: 'C:/p 100%/work/m2.wav', in: 32, duration: 20, gain: -21, fadeOut: 1.5 })
  const sfx = clip({ id: 'a2', bus: 'sfx', input: 'C:/p 100%/work/m3.wav', at: 4, duration: 0.4, gain: -14 })
  const measure = { i: -23.4, tp: -3.2, lra: 5.1, thresh: -33.9, offset: 0.4 }

  it('voice + music + 1 sfx: ducking keyed by the voice bus, one amix of three buses, limiter, measuring loudnorm (pass 1)', () => {
    const a = buildMixArgs({ clips: [voice, music, sfx], total, out: 'mix.wav' })
    expect(a.filter((x) => x === '-i')).toHaveLength(3)
    const g = graphOf(a)
    expect(g).toContain('sidechaincompress=threshold=0.02:ratio=8:attack=20:release=300')
    expect(g).toContain('amix=inputs=3:normalize=0')
    expect(g).toContain(`afade=t=out:st=${total - 1.5}:d=1.5`)
    expect(g).toContain('atrim=start=32:duration=20')
    expect(g).toContain('volume=-21dB')
    expect(g).toContain('volume=-14dB')
    expect(g).toContain('adelay=delays=192000S:all=1')
    expect(g).toContain(`alimiter=limit=${MIX_LIMIT}`)
    expect(MIX_LIMIT).toBe(0.89)
    expect(g).toContain('loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json')
    expect(g).not.toContain('measured_I')
    // The music bus is the compressor's main input, the voice bus its key.
    expect(g).toMatch(/\[music\]\[vkey\]sidechaincompress/)
    expect(a.at(-1)).toBe('mix.wav')
  })
  it('pass 2: the measured values with linear=true, only when `loudnorm` is passed', () => {
    const g = graphOf(buildMixArgs({ clips: [voice, music, sfx], total, out: 'audio.wav', loudnorm: measure }))
    // I1: +9.4 dB of gain leaves room for a −10.9 dBTP peak; the mix is limited 0.5 dB under it first.
    expect(g).toContain(
      'alimiter=limit=0.269153:level=false:latency=true,loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-23.4:measured_TP=-10.95:measured_LRA=5.1:measured_thresh=-33.9:offset=0.4:linear=true:print_format=json',
    )
    expect(g).toContain('aresample=48000,asetpts=N/SR/TB,apad=whole_len=960000,atrim=end_sample=960000[out]')
    expect(g).not.toContain('anullsink')
  })
  it('I1: pass 1 cuts the mix by time; pass 2 cuts the WAV to the exact sample count (775 frames at 30 fps = 1 240 000 samples)', () => {
    const g = graphOf(buildMixArgs({ clips: [voice], total: 775 / 30, out: 'mix.wav' }))
    expect(g).toContain('alimiter=limit=0.89:level=false:latency=true,atrim=duration=25.833333,asplit=2[out][measure]')
    expect(trackSamples(775 / 30)).toBe(1240000)
    const p2 = buildLoudnormArgs({ input: 'mix.wav', out: 'audio.wav', total: 775 / 30, loudnorm: null })
    expect(p2[p2.indexOf('-af') + 1]).toBe('asetpts=N/SR/TB,apad=whole_len=1240000,atrim=end_sample=1240000')
  })
  it('no voice: no ducking; no music: no compressor either', () => {
    expect(graphOf(buildMixArgs({ clips: [music, sfx], total, out: 'o.wav' }))).not.toContain('sidechaincompress')
    expect(graphOf(buildMixArgs({ clips: [voice, sfx], total, out: 'o.wav' }))).not.toContain('sidechaincompress')
  })
  it('8 ms anti-click fades at least on every voice/music piece; a short piece fades over at most half its length', () => {
    const g = graphOf(buildMixArgs({ clips: [voice], total, out: 'o.wav' }))
    expect(g).toContain('afade=t=in:d=0.008')
    expect(g).toContain('afade=t=out:st=17.992:d=0.008')
    const short = graphOf(buildMixArgs({ clips: [clip({ id: 'x', bus: 'voice', input: 'v.mp4', duration: 0.01 })], total: 1, out: 'o.wav' }))
    expect(short).toContain('afade=t=in:d=0.005,afade=t=out:st=0.005:d=0.005')
  })
  it('video-scene pieces keep their speed (atempo) and one input per file (asplit)', () => {
    const p1 = clip({ id: 's1', bus: 'voice', input: 'w/m1.mp4', in: 10, duration: 1, speed: 0.25, at: 6.5 })
    const p2 = clip({ id: 's2', bus: 'voice', input: 'w/m1.mp4', in: 0, duration: 2, speed: 2, at: 0 })
    const a = buildMixArgs({ clips: [p1, p2], total: 8, out: 'o.wav' })
    expect(a.filter((x) => x === '-i')).toHaveLength(1)
    const g = graphOf(a)
    expect(g).toContain('[0:a]asplit=2[s0_0][s0_1]')
    expect(g).toContain('atrim=start=10:duration=0.25,asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atempo=0.5,atempo=0.5,apad,atrim=duration=1')
    expect(g).toContain('adelay=delays=312000S:all=1')
  })
  it('no clips: silence of the total length, no loudnorm', () => {
    const a = buildMixArgs({ clips: [], total: 3, out: 'o.wav' })
    expect(a).not.toContain('-i')
    expect(graphOf(a)).toBe('anullsrc=r=48000:cl=stereo,atrim=duration=3[out]')
  })
})

describe('buildLoudnormArgs (pass 2 on the pre-normalized mix WAV)', () => {
  it('applies the measured values linearly and resamples back to 48 kHz, exactly `total` s by sample count', () => {
    const a = buildLoudnormArgs({ input: 'mix.wav', out: 'audio.wav', total: 12, loudnorm: { i: -26, tp: -16, lra: 3, thresh: -36, offset: 0.1 } })
    const af = a[a.indexOf('-af') + 1]!
    expect(af).toBe(
      'loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-26:measured_TP=-16:measured_LRA=3:measured_thresh=-36:offset=0.1:linear=true:print_format=json,' +
        'aresample=48000,asetpts=N/SR/TB,apad=whole_len=576000,atrim=end_sample=576000',
    )
    expect(a.join(' ')).toContain('-c:a pcm_s16le -ar 48000 -ac 2')
    // Info level: loudnorm's normalization_type is read back from stderr.
    expect(a.slice(0, 4)).toEqual(['-hide_banner', '-nostats', '-v', 'info'])
  })
  it('I1: a peak with too little room for the gain is limited first, so linear mode never falls back to dynamic', () => {
    const m = { i: -20, tp: -4, lra: 3, thresh: -30, offset: 0 }
    expect(pass2Plan(m)).toEqual({ gain: 6, measuredTp: -7.55, limitDb: -8, lra: 11, measuredLra: 3 })
    const af = buildLoudnormArgs({ input: 'a.wav', out: 'b.wav', total: 2, loudnorm: m })
    expect(af[af.indexOf('-af') + 1]).toMatch(/^alimiter=limit=0\.398107:level=false:latency=true,loudnorm=.*measured_TP=-7\.55:/)
    // The real v1-voice mix: −14.32 LUFS, −1.01 dBTP (+0.32 dB would reach −0.69).
    expect(pass2Plan({ i: -14.32, tp: -1.01, lra: 6, thresh: -24, offset: 0 }).limitDb).toBeCloseTo(-2.32, 6)
    // Enough room: no limiter.
    expect(pass2Plan({ i: -14, tp: -3, lra: 6, thresh: -24, offset: 0 }).limitDb).toBeUndefined()
    // Linear mode also falls back on a measured LRA above the target, or one of 0 ("not given").
    expect(pass2Plan({ i: -14, tp: -3, lra: 14.2, thresh: -24, offset: 0 }).lra).toBe(16)
    expect(pass2Plan({ i: -14, tp: -3, lra: 0, thresh: -24, offset: 0 }).measuredLra).toBe(0.1)
  })
  it('parseNormalizationType reads loudnorm’s mode from the last JSON block', () => {
    expect(parseNormalizationType('{\n\t"normalization_type" : "dynamic",\n}\n{\n\t"normalization_type" : "linear",\n}')).toBe('linear')
    expect(parseNormalizationType('no json')).toBeUndefined()
  })
  it('a silent mix (no measurable loudness) is only converted', () => {
    const a = buildLoudnormArgs({ input: 'mix.wav', out: 'audio.wav', total: 2, loudnorm: null })
    expect(a[a.indexOf('-af') + 1]).toBe('asetpts=N/SR/TB,apad=whole_len=96000,atrim=end_sample=96000')
  })
})

describe('parsers', () => {
  it('parseLoudnormJson reads the last JSON block of ffmpeg stderr', () => {
    const stderr = `[Parsed_loudnorm_9 @ 0000] \n{\n\t"input_i" : "-27.61",\n\t"input_tp" : "-4.47",\n\t"input_lra" : "18.06",\n\t"input_thresh" : "-39.20",\n\t"output_i" : "-16.58",\n\t"output_tp" : "-1.50",\n\t"output_lra" : "14.78",\n\t"output_thresh" : "-27.71",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "0.58"\n}\n`
    expect(parseLoudnormJson(stderr)).toEqual({ i: -27.61, tp: -4.47, lra: 18.06, thresh: -39.2, offset: 0.58 })
    expect(parseLoudnormJson(stderr.replace('"-27.61"', '"-inf"')).i).toBe(-Infinity)
    expect(() => parseLoudnormJson('nothing here')).toThrow(/^[؀-ۿ].*—/s)
  })
  it('parseEbur128 reads integrated loudness and true peak from the summary', () => {
    const stderr = `[Parsed_ebur128_0 @ 0] Summary:\n\n  Integrated loudness:\n    I:         -14.2 LUFS\n    Threshold: -24.6 LUFS\n\n  Loudness range:\n    LRA:         4.1 LU\n\n  True peak:\n    Peak:       -1.3 dBFS\n`
    expect(parseEbur128(stderr)).toEqual({ i: -14.2, tp: -1.3 })
    expect(parseEbur128(stderr.replace('-1.3 dBFS', '-inf dBFS')).tp).toBe(-Infinity)
  })
})

describe('levels', () => {
  it('sourceGain brings a source to the reference level, capped, and leaves silence alone', () => {
    expect(SOURCE_REF_LUFS).toBe(-14)
    expect(sourceGain(-35)).toBe(21)
    expect(sourceGain(-6)).toBe(-8)
    expect(sourceGain(-60)).toBe(24)
    expect(sourceGain(-70)).toBe(0)
    expect(sourceGain(-Infinity)).toBe(0)
  })
  it('the ducking constants of the brief', () => {
    expect(DUCK).toMatchObject({ threshold: 0.02, ratio: 8, attack: 20, release: 300 })
  })
  it('loudnessVerdict: −14 ± 1 LUFS and TP ≤ −1 dBTP, Arabic first', () => {
    expect(loudnessVerdict({ i: -14.4, tp: -1.2 }).ok).toBe(true)
    expect(loudnessVerdict({ i: -13, tp: -1 }).ok).toBe(true)
    const loud = loudnessVerdict({ i: -12.5, tp: -1.2 })
    expect(loud.ok).toBe(false)
    expect(loud.message).toMatch(/^[؀-ۿ].*—.*-12\.5 LUFS/s)
    expect(loudnessVerdict({ i: -14, tp: -0.4 }).ok).toBe(false)
  })
})

describe('clipSpan (timeline length of a clip)', () => {
  it('music without a duration runs to the storyboard end, or to its own end when shorter', () => {
    expect(clipSpan({ kind: 'music', at: 0, in: 32 }, 60 - 32, 20)).toBe(20)
    expect(clipSpan({ kind: 'music', at: 2, in: 0 }, 3, 20)).toBe(3)
  })
  it('voice/sfx without a duration: the rest of the source; never past the storyboard end', () => {
    expect(clipSpan({ kind: 'voice', at: 1, in: 0 }, 30, 20)).toBe(19)
    expect(clipSpan({ kind: 'sfx', at: 4, in: 0, duration: 0.4 }, 2, 20)).toBe(0.4)
    expect(clipSpan({ kind: 'sfx', at: 4, in: 0, duration: 5 }, 2, 20)).toBe(2)
    expect(clipSpan({ kind: 'voice', at: 25, in: 0 }, 30, 20)).toBe(0)
  })
})

describe('audioHashInputs (JobHashInput.audio)', () => {
  it('every clip input: the source sha1 of media clips and video scenes, the recipe id of built-in SFX', () => {
    const sb = parseStoryboard(
      {
        version: 1,
        audio: [{ kind: 'voice', media: 'm1' }, { id: 'hit', kind: 'sfx', sfx: 'impact', at: 1 }],
        scenes: [{ id: 'v1', type: 'video', start: 0, duration: 2, params: { media: 'm2', in: 0 } }],
      },
      ['video'],
    )
    const records = [{ id: 'm1', sourceHash: 'aaa' }, { id: 'm2', sourceHash: 'bbb' }]
    expect(audioHashInputs(sb, records)).toEqual([
      { id: 'a0', hash: 'aaa' },
      { id: 'hit', hash: `sfx:impact-0-${SFX_RECIPE}` },
      { id: 'scene:v1', hash: 'bbb' },
    ])
  })
})

describe('preview audio (runtime/preview/audio.ts, node/preview-audio.ts)', () => {
  it('clipState: active only while playing inside the clip; source position and faded volume', async () => {
    const { clipState } = await import('../../src/runtime/preview/audio')
    const c = { id: 'a1', src: '/__audio/m2', at: 2, in: 32, duration: 10, gain: -20, fadeIn: 0, fadeOut: 2 }
    expect(clipState(c, 1, true).active).toBe(false)
    expect(clipState(c, 3, false).active).toBe(false)
    const s = clipState(c, 3, true)
    expect(s).toMatchObject({ active: true, pos: 33 })
    expect(s.volume).toBeCloseTo(0.1, 6)
    expect(clipState(c, 11, true).volume).toBeCloseTo(0.05, 6) // halfway through the 2 s fade-out
    expect(clipState(c, 12, true).active).toBe(false)
  })
  it('previewClips: media clips only (built-in effects are not previewed), served by media id, music to the storyboard end', async () => {
    const { previewClips } = await import('../../src/node/preview-audio')
    const sb = parseStoryboard(
      {
        version: 1,
        audio: [{ kind: 'voice', media: 'm1' }, { kind: 'music', media: 'm2', in: 32 }, { kind: 'sfx', sfx: 'tap', at: 1 }],
        scenes: [{ id: 's', type: 'slam', start: 0, duration: 12, params: {} }],
      },
      ['slam'],
    )
    const project = { dir: 'p', manifest: { media: [{ id: 'm1', work: 'work/m1.wav', durationSec: 10 }, { id: 'm2', work: 'work/m2.wav', durationSec: 60 }] } }
    const clips = previewClips(project as never, sb)
    expect(clips.map((c) => [c.id, c.src, c.duration, c.gain])).toEqual([
      ['a0', '/__audio/m1', 10, 0],
      ['a1', '/__audio/m2', 12, -21],
    ])
    expect(previewClips(undefined, sb)).toEqual([])
  })
})

describe('true-peak headroom (Task 7 fix round 3)', () => {
  it('loudnorm aims at −1.5 dBTP while verify still allows up to −1 dBTP', () => {
    expect(LOUDNORM_TP).toBe(-1.5)
    expect(LOUDNORM_TP).toBeLessThan(LOUDNESS.tp)
    expect(LOUDNESS.tp).toBe(-1)
    const af = buildLoudnormArgs({ input: 'a.wav', out: 'b.wav', total: 2, loudnorm: { i: -20, tp: -4, lra: 3, thresh: -30, offset: 0 } }).join(' ')
    expect(af).toContain('TP=-1.5')
    expect(loudnessVerdict({ i: -14, tp: -1.2 }).ok).toBe(true)
    expect(loudnessVerdict({ i: -14, tp: -0.9 }).ok).toBe(false)
  })
})

import { assertMixLength, wavSampleCount } from '../../src/node/audio'

describe('R28: pass-1 mix length guard (the mid-wave silent-mix regression class)', () => {
  const wav = (samples: number, channels = 2, bytesPerSample = 4): Buffer => {
    const data = samples * channels * bytesPerSample
    const b = Buffer.alloc(44 + 12 + data)
    b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4); b.write('WAVE', 8)
    b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(channels, 22)
    b.writeUInt32LE(48000, 24); b.writeUInt32LE(48000 * channels * bytesPerSample, 28); b.writeUInt16LE(channels * bytesPerSample, 32); b.writeUInt16LE(bytesPerSample * 8, 34)
    // An extra chunk before `data`, as ffmpeg writes (LIST): the parser must skip it.
    b.write('LIST', 36); b.writeUInt32LE(4, 40); b.write('INFO', 44)
    b.write('data', 48); b.writeUInt32LE(data, 52)
    return b
  }
  it('wavSampleCount reads the data chunk past other chunks', () => {
    expect(wavSampleCount(wav(1_240_000))).toBe(1_240_000)
    expect(wavSampleCount(wav(10, 1, 2))).toBe(10)
    expect(() => wavSampleCount(Buffer.from('not a wav file at all, really'))).toThrow(/WAV/)
  })
  it('assertMixLength: a mix shorter than the track by more than 1 ms is refused, Arabic first', () => {
    expect(() => assertMixLength(1_240_000, 775 / 30)).not.toThrow()
    expect(() => assertMixLength(1_240_000 - 40, 775 / 30)).not.toThrow()
    expect(() => assertMixLength(168_000, 775 / 30)).toThrow(/^[؀-ۿ].*168000.*1240000/)
  })
})
