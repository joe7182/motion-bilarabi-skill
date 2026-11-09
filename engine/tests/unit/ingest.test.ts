import { describe, it, expect } from 'vitest'
import {
  buildAudioIngestArgs,
  buildIngestArgs,
  describeIssues,
  INGEST_RECIPE,
  SCALE_FLAGS,
  SET_BT709,
  sourceMatrix,
  detectHdrPath,
  pickAudioStream,
  hdrPathFromFilters,
  normalizeRotation,
  parseProbe,
  workSize,
  type MediaInfo,
} from '../../src/node/ingest'
import { parseClockDuration, videoDurationFrom } from '../../src/node/frames'

const stream = (o: Record<string, unknown> = {}) => ({
  codec_type: 'video',
  codec_name: 'h264',
  width: 1920,
  height: 1080,
  r_frame_rate: '30/1',
  avg_frame_rate: '30/1',
  pix_fmt: 'yuv420p',
  duration: '2.000000',
  nb_frames: '60',
  ...o,
})

const base: MediaInfo = {
  w: 1920, h: 1080, rotation: 0, fps: 30, vfr: false, hdr: false, codec: 'h264', durationSec: 2, hasVideo: true, hasAudio: true, audioStream: 1,
  frames: 60, pixFmt: 'yuv420p', colorTransfer: null, colorPrimaries: null, colorSpace: null, videoStartSec: 0,
}

describe('normalizeRotation', () => {
  it('maps any multiple of 90 into 0/90/180/270', () => {
    expect(normalizeRotation(0)).toBe(0)
    expect(normalizeRotation(90)).toBe(90)
    expect(normalizeRotation(-90)).toBe(270)
    expect(normalizeRotation(-180)).toBe(180)
    expect(normalizeRotation(450)).toBe(90)
    expect(normalizeRotation(-270)).toBe(90)
    expect(normalizeRotation(89.99)).toBe(90)
  })
})

describe('parseProbe', () => {
  it('reads size, fps, codec, duration, audio', () => {
    const i = parseProbe({ streams: [stream({ index: 0 }), { index: 1, codec_type: 'audio', codec_name: 'aac' }], format: { duration: '2.1' } })
    expect(i).toMatchObject({ audioStream: 1, w: 1920, h: 1080, rotation: 0, fps: 30, vfr: false, hdr: false, codec: 'h264', durationSec: 2, hasAudio: true, frames: 60 })
  })
  it('rotation from the display matrix (counter-clockwise) is the clockwise turn to display', () => {
    const dm = (r: number) => ({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: r }] })
    expect(parseProbe({ streams: [stream(dm(-90))] }).rotation).toBe(90)
    expect(parseProbe({ streams: [stream(dm(90))] }).rotation).toBe(270)
    expect(parseProbe({ streams: [stream(dm(180))] }).rotation).toBe(180)
    expect(parseProbe({ streams: [stream(dm(-180))] }).rotation).toBe(180)
  })
  it('rotation from the legacy rotate tag', () => {
    expect(parseProbe({ streams: [stream({ tags: { rotate: '90' } })] }).rotation).toBe(90)
    expect(parseProbe({ streams: [stream({ tags: { rotate: '-90' } })] }).rotation).toBe(270)
  })
  it('vfr when r_frame_rate and avg_frame_rate differ by more than 1%', () => {
    expect(parseProbe({ streams: [stream({ r_frame_rate: '120/1', avg_frame_rate: '1680/41' })] }).vfr).toBe(true)
    expect(parseProbe({ streams: [stream({ r_frame_rate: '30000/1001', avg_frame_rate: '30/1' })] }).vfr).toBe(false)
    expect(parseProbe({ streams: [stream({ r_frame_rate: '30/1', avg_frame_rate: '29.6/1' })] }).vfr).toBe(true)
  })
  it('hdr for PQ and HLG only', () => {
    expect(parseProbe({ streams: [stream({ color_transfer: 'smpte2084' })] }).hdr).toBe(true)
    expect(parseProbe({ streams: [stream({ color_transfer: 'arib-std-b67' })] }).hdr).toBe(true)
    expect(parseProbe({ streams: [stream({ color_transfer: 'bt709' })] }).hdr).toBe(false)
  })
  it('audio-only file: hasVideo false, no video fields, codec and duration from the audio', () => {
    const i = parseProbe({ streams: [{ index: 0, codec_type: 'audio', codec_name: 'aac', channels: 2, duration: '4.010' }], format: { duration: '4.02' } })
    expect(i).toMatchObject({ hasVideo: false, hasAudio: true, audioStream: 0, w: 0, h: 0, fps: 0, frames: 0, rotation: 0, codec: 'aac', durationSec: 4.01 })
    expect(parseProbe({ streams: [{ index: 0, codec_type: 'audio', codec_name: 'aac', channels: 2 }], format: { duration: '4.02' } }).durationSec).toBe(4.02)
    expect(parseProbe({ streams: [stream()] }).hasVideo).toBe(true)
  })
  it('cover art (attached_pic video stream, m4a/mp3) is not video: the file is audio-only', () => {
    const art = { index: 0, codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600, r_frame_rate: '90000/1', avg_frame_rate: '0/0', disposition: { attached_pic: 1 } }
    const i = parseProbe({ streams: [art, { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, duration: '5.5' }], format: { duration: '5.5' } })
    expect(i).toMatchObject({ hasVideo: false, hasAudio: true, audioStream: 1, codec: 'aac', durationSec: 5.5 })
  })
  it('a file with no media stream at all is still refused, Arabic first', () => {
    expect(() => parseProbe({ streams: [] })).toThrow(/^[؀-ۿ].*—.*No media stream/s)
    expect(() => parseProbe({ streams: [{ codec_type: 'data' }] })).toThrow(/^[؀-ۿ].*—.*No media stream/s)
  })
})

describe('buildAudioIngestArgs', () => {
  it('WAV 48 kHz stereo pcm_s16le from t = 0, no video, ends with the out path', () => {
    const a = buildAudioIngestArgs({ input: 'in.m4a', out: 'out.wav.part', audioStream: 0 })
    const s = a.join(' ')
    for (const x of ['-vn', '-ar 48000', '-ac 2', '-c:a pcm_s16le', '-map 0:0', '-i in.m4a', '-f wav']) expect(s).toContain(x)
    expect(a[a.indexOf('-af') + 1]).toBe('aresample=async=1:first_pts=0')
    expect(a.at(-1)).toBe('out.wav.part')
  })
})

describe('describeIssues (audio-only)', () => {
  it('reports no video problems for an audio-only file', () => {
    expect(describeIssues({ ...base, hasVideo: false, w: 0, h: 0, fps: 0, frames: 0, codec: 'aac' }, 30)).toEqual([])
  })
})

describe('workSize', () => {
  it('upright display size, long side at most 1920, even', () => {
    expect(workSize({ ...base, w: 1920, h: 1080, rotation: 90 })).toEqual({ w: 1080, h: 1920 })
    expect(workSize({ ...base, w: 2560, h: 1440 })).toEqual({ w: 1920, h: 1080 })
    expect(workSize({ ...base, w: 3840, h: 2160, rotation: 270 })).toEqual({ w: 1080, h: 1920 })
    expect(workSize({ ...base, w: 1281, h: 721 })).toEqual({ w: 1280, h: 720 })
    expect(workSize({ ...base, w: 640, h: 360, rotation: 180 })).toEqual({ w: 640, h: 360 })
  })
})

describe('buildIngestArgs', () => {
  const o = { src: 'in.mp4', out: 'out.part', fps: 30 }
  it('CFR at project fps, x264 crf 16 gop 15, yuv420p, AAC 48 kHz stereo', () => {
    const a = buildIngestArgs({ ...o, info: base, hdrPath: null })
    const s = a.join(' ')
    expect(a[a.indexOf('-vf') + 1]).toBe(`fps=30,scale=1920:1080:in_color_matrix=bt709:out_color_matrix=bt709:out_range=tv:flags=${SCALE_FLAGS},setsar=1,format=yuv420p,${SET_BT709}`)
    expect(a[a.indexOf('-af') + 1]).toBe('aresample=async=1:first_pts=0,apad,atrim=end=2')
    for (const x of ['-c:v libx264', '-crf 16', '-g 15', '-pix_fmt yuv420p', '-c:a aac', '-ar 48000', '-ac 2', '-fps_mode cfr', '-map 0:1']) {
      expect(s).toContain(x)
    }
    expect(s).not.toContain('anullsrc')
    expect(s).not.toContain('noautorotate')
    expect(a.at(-1)).toBe('out.part')
  })
  it('a silent track of the same duration when there is no audio', () => {
    const a = buildIngestArgs({ ...o, info: { ...base, hasAudio: false, audioStream: null, durationSec: 2.5 }, hdrPath: null })
    const i = a.indexOf('anullsrc=r=48000:cl=stereo')
    expect(a.slice(i - 5, i + 1)).toEqual(['-f', 'lavfi', '-t', '2.5', '-i', 'anullsrc=r=48000:cl=stereo'])
    expect(a.join(' ')).toContain('-map 1:a:0')
    expect(a[a.indexOf('-af') + 1]).toBe('aresample=async=1:first_pts=0,apad,atrim=end=2.5')
  })
  it('HDR: zscale tone map, or the colorspace fallback, tagged bt709', () => {
    const hdr = { ...base, hdr: true, colorTransfer: 'arib-std-b67', colorPrimaries: 'bt2020', colorSpace: 'bt2020nc', pixFmt: 'yuv420p10le' }
    const z = buildIngestArgs({ ...o, info: hdr, hdrPath: 'zscale' })
    const vz = z[z.indexOf('-vf') + 1]!
    expect(vz).toMatch(/^fps=30,zscale=tin=arib-std-b67:pin=bt2020:min=bt2020nc:.*t=linear.*tonemap=.*zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale=/)
    const c = buildIngestArgs({ ...o, info: hdr, hdrPath: 'colorspace' })
    const vc = c[c.indexOf('-vf') + 1]!
    expect(vc).toMatch(/^fps=30,colorspace=all=bt709:iall=bt2020:.*,scale=/)
    expect(vc).not.toContain('zscale')
    for (const a of [z, c]) expect(a.join(' ')).toContain('-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv')
    // The HDR chains already end in BT.709: the scale keeps that matrix.
    for (const v of [vz, vc]) expect(v).toContain(`scale=1920:1080:in_color_matrix=bt709:out_color_matrix=bt709:out_range=tv:flags=${SCALE_FLAGS}`)
  })
  it('SDR: every working copy is BT.709 limited range and tagged so (final review: colour chain)', () => {
    const tags = '-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv'
    for (const colorSpace of [null, 'bt709', 'smpte170m', 'bt470bg', 'bt2020nc']) {
      expect(buildIngestArgs({ ...o, info: { ...base, colorSpace }, hdrPath: null }).join(' ')).toContain(tags)
    }
  })
  it('SDR: the source matrix is read from its tag; untagged and BT.601 (smpte170m / bt470bg) are converted to BT.709', () => {
    expect(sourceMatrix({ ...base, colorSpace: 'bt709' })).toBe('bt709')
    expect(sourceMatrix({ ...base, colorSpace: 'smpte170m' })).toBe('bt601')
    expect(sourceMatrix({ ...base, colorSpace: 'bt470bg' })).toBe('bt601')
    // Untagged (round 2): HD (shorter side ≥ 720, either orientation) is BT.709, smaller is BT.601.
    expect(sourceMatrix({ ...base, colorSpace: null })).toBe('bt709') // 1920×1080
    expect(sourceMatrix({ ...base, colorSpace: null, w: 1280, h: 720 })).toBe('bt709')
    expect(sourceMatrix({ ...base, colorSpace: null, w: 720, h: 1280 })).toBe('bt709')
    expect(sourceMatrix({ ...base, colorSpace: null, w: 1280, h: 718 })).toBe('bt601')
    expect(sourceMatrix({ ...base, colorSpace: null, w: 360, h: 640 })).toBe('bt601')
    expect(sourceMatrix({ ...base, colorSpace: null, w: 640, h: 480 })).toBe('bt601')
    expect(sourceMatrix({ ...base, colorSpace: 'weird', w: 640, h: 480 })).toBe('bt601')
    // An explicit BT.601 tag wins even at HD.
    expect(sourceMatrix({ ...base, colorSpace: 'smpte170m', w: 1920, h: 1080 })).toBe('bt601')
    expect(sourceMatrix({ ...base, colorSpace: 'bt2020nc' })).toBe('bt2020')
    expect(sourceMatrix({ ...base, colorSpace: 'smpte240m' })).toBe('smpte240m')
    expect(sourceMatrix({ ...base, colorSpace: 'weird' })).toBe('bt709')
    expect(sourceMatrix({ ...base, hdr: true, colorSpace: 'bt2020nc' })).toBe('bt709')
    const v = (colorSpace: string | null) => {
      const a = buildIngestArgs({ ...o, info: { ...base, colorSpace }, hdrPath: null })
      return a[a.indexOf('-vf') + 1]!
    }
    expect(v('bt709')).toContain('scale=1920:1080:in_color_matrix=bt709:out_color_matrix=bt709:out_range=tv')
    expect(v('smpte170m')).toContain('scale=1920:1080:in_color_matrix=bt601:out_color_matrix=bt709:out_range=tv')
  })
  it('the frames themselves carry BT.709 (ffmpeg 9 tags the stream from the frames)', () => {
    expect(SET_BT709).toBe('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv')
  })
  it('recipe 5: untagged HD sources changed matrix', () => {
    expect(INGEST_RECIPE).toBe(6)
  })
})

describe('hdrPathFromFilters', () => {
  it('zscale + tonemap when both exist, else colorspace', () => {
    const line = (n: string) => ` TS ${n.padEnd(16)} V->V       x`
    expect(hdrPathFromFilters([line('zscale'), line('tonemap'), line('colorspace')].join('\n'))).toBe('zscale')
    expect(hdrPathFromFilters([line('tonemap'), line('colorspace')].join('\n'))).toBe('colorspace')
    expect(hdrPathFromFilters([line('zscale'), line('colorspace')].join('\n'))).toBe('colorspace')
    expect(hdrPathFromFilters(line('scale'))).toBe(null)
  })
})

describe('describeIssues', () => {
  it('Arabic first, then English', () => {
    const d = describeIssues({ ...base, rotation: 90, vfr: true, hdr: true, colorTransfer: 'arib-std-b67', fps: 60, hasAudio: false, audioStream: null }, 30)
    expect(d).toContain('مُدار 90° — rotated 90°')
    expect(d).toContain('إطارات متغيرة — variable frame rate')
    expect(d.some((x) => x.startsWith('HDR'))).toBe(true)
    expect(d.some((x) => x.includes('60') && x.includes('30'))).toBe(true)
    expect(d.some((x) => /no audio/.test(x))).toBe(true)
    expect(describeIssues(base, 30)).toEqual([])
  })
})

describe('pickAudioStream', () => {
  const a = (index: number, codec_name: string | undefined, def = 0, extra: Record<string, unknown> = {}) => ({
    index, codec_type: 'audio', codec_name, disposition: { default: def }, channels: 2, ...extra,
  })
  const v = { index: 0, codec_type: 'video', codec_name: 'h264' }
  it('default disposition first, else the first AAC, else the first decodable; null when none', () => {
    expect(pickAudioStream([v, a(1, 'opus'), a(2, 'aac', 1)])).toBe(2)
    expect(pickAudioStream([v, a(1, 'mp3'), a(2, 'aac')])).toBe(2)
    expect(pickAudioStream([v, a(1, 'mp3'), a(2, 'opus')])).toBe(1)
    expect(pickAudioStream([v, a(1, undefined, 1), a(2, 'aac')])).toBe(2) // undecodable default skipped
    expect(pickAudioStream([v, a(1, 'none'), a(2, 'pcm_s16le', 0, { channels: 0 })])).toBe(null)
    expect(pickAudioStream([v])).toBe(null)
  })
  it('parseProbe uses it: hasAudio follows', () => {
    const i = parseProbe({ streams: [stream({ index: 0 }), a(1, undefined), a(2, 'aac')] })
    expect(i).toMatchObject({ audioStream: 2, hasAudio: true })
    expect(parseProbe({ streams: [stream({ index: 0 }), a(1, undefined)] })).toMatchObject({ audioStream: null, hasAudio: false })
  })
})

describe('detectHdrPath', () => {
  it('a failed ffmpeg -filters is reported Arabic first and not cached', async () => {
    const fail = async () => ({ code: 1, stdout: '', stderr: 'boom' })
    await expect(detectHdrPath('fake-ffmpeg-x', fail)).rejects.toThrow(/^[؀-ۿ].*—.*-filters.*boom/s)
    const line = (n: string) => ` TS ${n.padEnd(16)} V->V       x`
    const good = async () => ({ code: 0, stdout: [line('zscale'), line('tonemap')].join(String.fromCharCode(10)), stderr: '' })
    expect(await detectHdrPath('fake-ffmpeg-x', good)).toBe('zscale')
    // Now cached: a later failure is not even asked.
    expect(await detectHdrPath('fake-ffmpeg-x', fail)).toBe('zscale')
  })
})

describe('video stream duration (round 2: never the container when there is audio)', () => {
  it('Matroska DURATION tags parse as seconds', () => {
    expect(parseClockDuration('00:00:02.000000000')).toBe(2)
    expect(parseClockDuration('01:02:03.500000000')).toBeCloseTo(3723.5, 9)
    expect(parseClockDuration('2.5')).toBeNaN()
    expect(parseClockDuration(undefined)).toBeNaN()
  })
  it('stream duration, else its DURATION tag, else the container only when there is no audio, else 0 (ask the packets)', () => {
    expect(videoDurationFrom({ duration: '2.000000' }, { duration: '2.6' }, true)).toBe(2)
    expect(videoDurationFrom({ duration: 'N/A', tags: { DURATION: '00:00:02.000000000' } }, { duration: '2.623' }, true)).toBe(2)
    expect(videoDurationFrom({ tags: { duration: '00:00:02.950000000' } }, { duration: '2.95' }, false)).toBeCloseTo(2.95, 9)
    expect(videoDurationFrom({}, { duration: '2.95' }, false)).toBeCloseTo(2.95, 9)
    expect(videoDurationFrom({}, { duration: '2.623' }, true)).toBe(0)
  })
  it('parseProbe: an MKV with longer audio and no stream duration is measured by its video tag', () => {
    const v = { index: 0, codec_type: 'video', codec_name: 'h264', width: 180, height: 320, r_frame_rate: '30/1', avg_frame_rate: '30/1', tags: { DURATION: '00:00:02.000000000' } }
    const a = { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { DURATION: '00:00:02.623000000' } }
    expect(parseProbe({ streams: [v, a], format: { duration: '2.623000' } }).durationSec).toBe(2)
    expect(parseProbe({ streams: [{ ...v, tags: {} }, a], format: { duration: '2.623000' } }).durationSec).toBe(0)
  })
})
