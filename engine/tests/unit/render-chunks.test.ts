import { describe, it, expect } from 'vitest'
import { nextVersionName } from '../../src/core/project'
import { atempoChain } from '../../src/node/audio'
import { hostname } from 'node:os'
import { buildEncodeArgs, captureOptions, etaLine, FINAL_JPEG_QUALITY, formatEta, jobHashOf, LOCK_GRACE_MS, lockState, parseJobLock, planChunks, RENDER_RECIPE } from '../../src/node/render'
import { ffmpegVersionLine } from '../../src/node/tools'
import { buildIngestArgs, parseProbe, SET_BT709, type MediaInfo } from '../../src/node/ingest'

describe('nextVersionName counts reserved and partial versions', () => {
  it('a .parts/<version> folder name (no extension) takes its number', () => {
    expect(nextVersionName(['v001-draft.mp4', 'v004-draft'], 'final')).toBe('renders/v005-final.mp4')
  })
  it('double extensions (temp files) take their number', () => {
    expect(nextVersionName(['v006-final.mp4.123.tmp', 'v002-draft.mp4'], 'draft')).toBe('renders/v007-draft.mp4')
    expect(nextVersionName(['v003-draft.mp4.part'], 'draft')).toBe('renders/v004-draft.mp4')
  })
  it('still ignores other names', () => {
    expect(nextVersionName(['v1-draftx', 'xv002-draft.mp4', 'v002-other.mp4', '.parts'], 'draft')).toBe('renders/v001-draft.mp4')
  })
})

describe('planChunks', () => {
  it('splits on frame multiples, the last chunk shorter', () => {
    expect(planChunks(750, 300)).toEqual([
      { index: 0, from: 0, to: 299, frames: 300 },
      { index: 1, from: 300, to: 599, frames: 300 },
      { index: 2, from: 600, to: 749, frames: 150 },
    ])
  })
  it('one chunk when the timeline is shorter than a chunk; none when empty', () => {
    expect(planChunks(90, 300)).toEqual([{ index: 0, from: 0, to: 89, frames: 90 }])
    expect(planChunks(0, 300)).toEqual([])
  })
})

describe('ETA line', () => {
  it('M:SS with rounding', () => {
    expect(formatEta(0)).toBe('0:00')
    expect(formatEta(75)).toBe('1:15')
    expect(formatEta(59.6)).toBe('1:00')
    expect(formatEta(3600 + 61)).toBe('61:01')
  })
  it('Arabic first, then English, verbatim', () => {
    expect(etaLine(75)).toBe('الوقت المتبقي تقريباً ~ 1:15 — about 1:15 left')
  })
})

describe('atempoChain', () => {
  const prod = (xs: number[]) => xs.reduce((a, x) => a * x, 1)
  it('no filter at speed 1; factors within 0.5..2 whose product is the speed', () => {
    expect(atempoChain(1)).toEqual([])
    expect(atempoChain(2)).toEqual([2])
    expect(atempoChain(4)).toEqual([2, 2])
    expect(atempoChain(0.25)).toEqual([0.5, 0.5])
    expect(atempoChain(3)).toEqual([2, 1.5])
    for (const s of [0.25, 0.3, 0.7, 1.5, 2.5, 3.9, 4]) {
      const c = atempoChain(s)
      for (const f of c) expect(f >= 0.5 && f <= 2).toBe(true)
      expect(prod(c)).toBeCloseTo(s, 9)
    }
  })
})

describe('ingest keeps audio to the end of late-starting video', () => {
  const base: MediaInfo = {
    w: 270, h: 480, rotation: 0, fps: 30, vfr: false, hdr: false, codec: 'h264', durationSec: 25, hasVideo: true, hasAudio: true, audioStream: 1,
    frames: 750, pixFmt: 'yuv420p', colorTransfer: null, colorPrimaries: null, colorSpace: null, videoStartSec: 0,
  }
  it('parseProbe: video start relative to the file start', () => {
    const v = { index: 0, codec_type: 'video', codec_name: 'h264', width: 270, height: 480, r_frame_rate: '30/1', avg_frame_rate: '30/1', duration: '25', start_time: '0.200000' }
    expect(parseProbe({ streams: [v], format: { start_time: '0.000000' } }).videoStartSec).toBeCloseTo(0.2, 9)
    expect(parseProbe({ streams: [{ ...v, start_time: '1.5' }], format: { start_time: '1.4' } }).videoStartSec).toBeCloseTo(0.1, 9)
    expect(parseProbe({ streams: [{ ...v, start_time: undefined }] }).videoStartSec).toBe(0)
  })
  it('the audio is trimmed at the end of the video in the output timeline (start + duration)', () => {
    const a = buildIngestArgs({ src: 'i.mp4', out: 'o.part', fps: 30, info: { ...base, videoStartSec: 0.2 }, hdrPath: null })
    expect(a[a.indexOf('-af') + 1]).toBe('aresample=async=1:first_pts=0,apad,atrim=end=25.2')
    const b = buildIngestArgs({ src: 'i.mp4', out: 'o.part', fps: 30, info: { ...base, videoStartSec: 0.2, hasAudio: false, audioStream: null }, hdrPath: null })
    expect(b[b.indexOf('-t') + 1]).toBe('25.2')
  })
})

describe('encode argv and capture (final review: colour chain, final capture speed)', () => {
  const COLOUR = 'in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv:flags=bicubic+accurate_rnd+full_chroma_int'
  const TAGS = '-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv'
  it('final: JPEG frames in, Chromium BT.601 full range → BT.709 limited range yuv420p, tagged', () => {
    const a = buildEncodeArgs({ fps: 30, draft: false, out: 'o.mp4' })
    const s = a.join(' ')
    expect(s).toContain('-f image2pipe -c:v mjpeg -framerate 30 -i -')
    expect(a[a.indexOf('-vf') + 1]).toBe(`scale=${COLOUR},format=yuv420p,${SET_BT709}`)
    expect(s).toContain(TAGS)
    expect(s).toContain('-c:v libx264 -pix_fmt yuv420p -crf 18')
    expect(a.at(-1)).toBe('o.mp4')
  })
  it('draft: half size (even sides) in the same scale, same colour conversion and tags', () => {
    const a = buildEncodeArgs({ fps: 60, draft: true, out: 'd.mp4' })
    expect(a[a.indexOf('-vf') + 1]).toBe(`scale=trunc(iw/4)*2:trunc(ih/4)*2:${COLOUR},format=yuv420p,${SET_BT709}`)
    expect(a.join(' ')).toContain(TAGS)
    expect(a.join(' ')).toContain('-framerate 60')
  })
  it('final frames are captured as high-quality JPEG (not PNG); drafts as JPEG q80', () => {
    expect(captureOptions(false)).toEqual({ type: 'jpeg', quality: FINAL_JPEG_QUALITY })
    expect(FINAL_JPEG_QUALITY).toBeGreaterThanOrEqual(95)
    expect(captureOptions(true)).toEqual({ type: 'jpeg', quality: 80 })
  })
  it('recipe 7 (exact-length audio, I1)', () => {
    expect(RENDER_RECIPE).toBe(9)
  })
})

describe('job hash includes the ffmpeg build', () => {
  const base = { engine: '1.0.0', recipe: 3, sb: { scenes: [] }, fps: 30, draft: false, chunkFrames: 300, media: [], transcript: null, marks: null, audio: [] }
  it('another ffmpeg version gives another hash; the same inputs the same hash', () => {
    const a = jobHashOf({ ...base, ffmpeg: 'ffmpeg version 9.0.1' })
    expect(jobHashOf({ ...base, ffmpeg: 'ffmpeg version 9.0.1' })).toBe(a)
    expect(jobHashOf({ ...base, ffmpeg: 'ffmpeg version 9.0.2' })).not.toBe(a)
  })
  it('ffmpegVersionLine: the first line of `ffmpeg -version`, asked once per binary', async () => {
    let calls = 0
    const runner = async () => {
      calls++
      return { code: 0, stdout: 'ffmpeg version 9.9-test Copyright (c)\nbuilt with gcc\n', stderr: '' }
    }
    expect(await ffmpegVersionLine('C:/x/ffmpeg-test.exe', runner)).toBe('ffmpeg version 9.9-test Copyright (c)')
    expect(await ffmpegVersionLine('C:/x/ffmpeg-test.exe', runner)).toBe('ffmpeg version 9.9-test Copyright (c)')
    expect(calls).toBe(1)
    expect(await ffmpegVersionLine('C:/y/ffmpeg-bad.exe', async () => ({ code: 1, stdout: '', stderr: 'boom' }))).toBe('unknown')
  })
})

describe('job.lock (round 2: pid only; host kept as information)', () => {
  const alive = (pid: number) => pid === 42
  it('JSON {pid, host}; a legacy plain pid parses too', () => {
    expect(parseJobLock('{"pid":42,"host":"a"}')).toEqual({ pid: 42, host: 'a' })
    expect(parseJobLock('42\n')).toEqual({ pid: 42, host: hostname() })
    expect(parseJobLock('')).toBeNull()
    expect(parseJobLock('{"pid":"x"}')).toBeNull()
  })
  it('judged by pid only: a lock written under another hostname (e.g. renamed Mac) is free once its pid is gone', () => {
    expect(lockState('{"pid":42,"host":"me"}', 60_000, alive)).toBe('live')
    expect(lockState('{"pid":7,"host":"me"}', 0, alive)).toBe('free')
    expect(lockState('{"pid":7,"host":"old-name.local"}', 0, alive)).toBe('free')
    expect(lockState('{"pid":42,"host":"old-name.local"}', 0, alive)).toBe('live')
  })
  it('an empty or unreadable lock is live while younger than LOCK_GRACE_MS (a claim being written), free after', () => {
    expect(LOCK_GRACE_MS).toBe(10_000)
    for (const t of ['', '{"pid":', 'junk']) {
      expect(lockState(t, 500, alive)).toBe('live')
      expect(lockState(t, LOCK_GRACE_MS + 1, alive)).toBe('free')
    }
  })
})
