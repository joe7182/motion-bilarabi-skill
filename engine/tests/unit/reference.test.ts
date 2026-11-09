import { describe, expect, it } from 'vitest'
import { deltaE, fewCuts, paletteOf, parseShowinfoTimes, referenceMarkdown, shotStats, type ReferenceReport } from '../../src/node/reference'
import { hexToRgb, paceOf, type RGB } from '../../src/node/metrics'
import { rng } from '../../src/core/rng'
import { styleFromReports } from '../../src/core/style'
import {
  buildCompareArgs,
  compareMarkdown,
  compareVerdict,
  cutScenes,
  sceneVerdict,
  staleWarnings,
  storyboardScenes,
  mergeShortWindows,
  tilingOf,
  windowPace,
} from '../../src/node/compare'

// Captured from ffmpeg 9.0.1: `-vf select='gt(scene,0.3)',showinfo -f null -` on a 6 s clip with
// cuts at 2 and 4 s (the banner and stream lines are part of the real stderr).
const SAMPLE = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'ref.mp4':",
  '  Duration: 00:00:06.00, start: 0.000000, bitrate: 7702 kb/s',
  'Stream mapping:',
  '  Stream #0:0 -> #0:0 (h264 (native) -> wrapped_avframe (native))',
  '[Parsed_showinfo_1 @ 000002005653b0c0] config in time_base: 1/15360, frame_rate: 30/1',
  '[Parsed_showinfo_1 @ 000002005653b0c0] config out time_base: 0/0, frame_rate: 0/0',
  '[Parsed_showinfo_1 @ 000002005653b0c0] n:   0 pts:  30720 pts_time:2       duration:    512 duration_time:0.0333333 fmt:yuv420p cl:left sar:1/1 s:360x640 i:P iskey:0 type:P checksum:3C3152A1 plane_checksum:[FB01A023 37F4BA65 A4E8F7FB] mean:[208 128 129] stdev:[5.5 6.6 6.6]',
  '[Parsed_showinfo_1 @ 000002005653b0c0] color_range:unknown color_space:unknown color_primaries:unknown color_trc:unknown',
  "Output #0, null, to 'pipe:':",
  '[Parsed_showinfo_1 @ 000002005653b0c0] n:   1 pts:  61440 pts_time:4       duration:    512 duration_time:0.0333333 fmt:yuv420p cl:left sar:1/1 s:360x640 i:P iskey:0 type:P checksum:6A2BF4EE plane_checksum:[70FF6A48 9E760A25 CCE08081] mean:[72 175 107] stdev:[5.5 6.6 6.6]',
  '[out#0/null @ 0000020054270f40] video:1KiB audio:0KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown',
].join('\r\n')

describe('parseShowinfoTimes', () => {
  it('reads pts_time of every selected frame from a captured stderr', () => {
    expect(parseShowinfoTimes(SAMPLE)).toEqual([2, 4])
  })
  it('handles decimals, LF line ends and ignores non-showinfo lines', () => {
    const s = [
      '[Parsed_showinfo_2 @ 0x1] n:   0 pts: 1 pts_time:0.5333  duration: 1',
      '[other @ 0x2] pts_time:9',
      '[Parsed_showinfo_2 @ 0x1] n:   1 pts: 2 pts_time:12.0667 duration: 1',
    ].join('\n')
    expect(parseShowinfoTimes(s)).toEqual([0.5333, 12.0667])
  })
  it('returns [] when nothing was selected', () => {
    expect(parseShowinfoTimes('')).toEqual([])
    expect(parseShowinfoTimes(SAMPLE.split('\r\n').slice(0, 6).join('\n'))).toEqual([])
  })
})

describe('shotStats', () => {
  it('splits the clip at the cuts', () => {
    const s = shotStats([2, 4], 6, 30)
    expect(s.cuts).toEqual([2, 4])
    expect(s.shotLengths).toEqual([2, 2, 2])
    expect(s.avgShot).toBe(2)
    expect(s.medianShot).toBe(2)
  })
  it('drops cuts at the edges or within a frame of another, and sorts', () => {
    const s = shotStats([4, 0, 2, 2.01, 6], 6, 30)
    expect(s.cuts).toEqual([2, 4])
  })
  it('one shot without cuts; median of an even count', () => {
    expect(shotStats([], 5, 30)).toEqual({ cuts: [], shotLengths: [5], avgShot: 5, medianShot: 5 })
    expect(shotStats([1, 4, 6], 10, 30).medianShot).toBe(2.5) // shots 1, 3, 2, 4
  })
})

describe('paceOf', () => {
  it('event density and static share, from the same functions as review', () => {
    // 30 fps, 3 s: frames 0..89 → series of 89. Peaks at indices 14, 44, 74 (t = 0.5, 1.5, 2.5);
    // static (0) from index 50 to 88, split by the peak at 74 → runs 50/30..75/30 (0.833 s) and
    // 75/30..90/30 (0.5 s).
    const series = new Array(89).fill(1)
    for (let i = 50; i < 89; i++) series[i] = 0
    series[14] = 10
    series[44] = 10
    series[74] = 10
    const p = paceOf(series, 30, 3)
    expect(p.events).toEqual([0.5, 1.5, 2.5])
    expect(p.eventsPerSec).toBe(1)
    expect(p.medianEventGap).toBe(1)
    expect(p.maxEventGap).toBe(1)
    expect(p.longestStatic).toBeCloseTo(25 / 30, 3)
    expect(p.movingPct).toBeCloseTo(1 - 40 / 30 / 3, 3)
  })
  it('a static clip: no events, everything finite', () => {
    const p = paceOf(new Array(59).fill(0), 30, 2)
    expect(p.events).toEqual([])
    expect(p.eventsPerSec).toBe(0)
    expect(p.maxEventGap).toBe(2)
    expect(p.medianEventGap).toBe(2)
    expect(p.movingPct).toBe(0)
    expect(p.longestStatic).toBe(2)
  })
})

describe('fewCuts', () => {
  it('flags a reference that moves far more often than it cuts', () => {
    expect(fewCuts(8, 50, 2.6)).toBe(true) // 0.16 cuts/s vs 2.6 events/s
    expect(fewCuts(20, 10, 2.6)).toBe(false) // 2 cuts/s
    expect(fewCuts(0, 10, 0)).toBe(false) // nothing moves at all
  })
})

describe('referenceMarkdown', () => {
  const base: ReferenceReport = {
    duration: 2, fps: 30, analysisFps: 30, w: 1080, h: 1920, sceneThr: 0.3, cuts: [], shotLengths: [2], avgShot: 2, medianShot: 2,
    motionProfile: [{ t: 0, motion: 0 }], events: [], eventsPerSec: 0, medianEventGap: 2, maxEventGap: 2,
    movingPct: 0, longestStatic: 2, palette: [],
  }
  it('qualifies the median gap when it falls back to the longest gap', () => {
    expect(referenceMarkdown(base, 'a.mp4')).toContain('(fewer than 2 events')
    const two = { ...base, events: [0.5, 1.5], eventsPerSec: 1, medianEventGap: 1, maxEventGap: 1 }
    expect(referenceMarkdown(two, 'a.mp4')).not.toContain('fewer than 2 events')
  })
})

describe('paletteOf', () => {
  /** n pixels: 70 % #101820, 25 % #F2F2F2, 5 % #FF6A00, interleaved. */
  function synthetic(n = 2000): Uint8Array {
    const px = new Uint8Array(n * 3)
    const cols: RGB[] = [[0x10, 0x18, 0x20], [0xf2, 0xf2, 0xf2], [0xff, 0x6a, 0x00]]
    for (let i = 0; i < n; i++) {
      const k = i % 20
      const c = cols[k < 14 ? 0 : k < 19 ? 1 : 2]!
      px.set(c, i * 3)
    }
    return px
  }
  it('finds background, text and accent within ΔE 3', () => {
    const p = paletteOf(synthetic(), 7)
    const role = (r: string) => p.find((c) => c.role === r)!
    expect(deltaE(hexToRgb(role('background').hex), [0x10, 0x18, 0x20])).toBeLessThan(3)
    expect(deltaE(hexToRgb(role('text').hex), [0xf2, 0xf2, 0xf2])).toBeLessThan(3)
    expect(deltaE(hexToRgb(role('accent').hex), [0xff, 0x6a, 0x00])).toBeLessThan(3)
    expect(role('background').share).toBeCloseTo(0.7, 2)
    expect(role('text').share).toBeCloseTo(0.25, 2)
    expect(role('accent').share).toBeCloseTo(0.05, 2)
    expect(p.length).toBeLessThanOrEqual(6)
  })
  it('is deterministic for a seed', () => {
    // Noisy pixels so k-means has real work: same seed → identical output.
    const px = synthetic(3000)
    const r = rng(3)
    for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, px[i]! + Math.round((r() - 0.5) * 30)))
    expect(paletteOf(px, 42)).toEqual(paletteOf(px, 42))
    const p = paletteOf(px, 42)
    expect(p.length).toBeGreaterThan(0)
    expect(p.length).toBeLessThanOrEqual(6)
    expect(p.reduce((a, c) => a + c.share, 0)).toBeLessThanOrEqual(1 + 1e-9)
    expect(p[0]!.role).toBe('background')
  })
  it('merges near-identical colours (ΔE < 8) and refuses a bad buffer', () => {
    const px = new Uint8Array(300)
    for (let i = 0; i < 100; i++) px.set(i % 2 ? [100, 100, 100] : [102, 101, 100], i * 3)
    const p = paletteOf(px, 1)
    expect(p).toHaveLength(1)
    expect(p[0]!.share).toBeCloseTo(1, 6)
    expect(() => paletteOf(new Uint8Array(4), 1)).toThrow(/RGB/)
    expect(paletteOf(new Uint8Array(0), 1)).toEqual([])
  })
  it('reference.md carries the measured colour table', () => {
    const md = referenceMarkdown(
      {
        duration: 2, fps: 30, analysisFps: 30, w: 1080, h: 1920, sceneThr: 0.3, cuts: [], shotLengths: [2], avgShot: 2, medianShot: 2,
        motionProfile: [{ t: 0, motion: 0 }], events: [], eventsPerSec: 0, medianEventGap: 2, maxEventGap: 2, movingPct: 0, longestStatic: 2,
        palette: [{ hex: '#101820', share: 0.7, role: 'background' }, { hex: '#ff6a00', share: 0.05, role: 'accent' }],
      },
      'a.mp4',
    )
    expect(md).toContain('**SEEN (measured)**')
    expect(md).toMatch(/\| background \| `#101820` \| 70 % \|/)
    expect(md).toMatch(/\| accent \| `#ff6a00` \| 5 % \|/)
  })
})

describe('compare helpers', () => {
  const pace = (movingPct: number, eventsPerSec: number) =>
    ({ events: [], eventsPerSec, medianEventGap: 0, maxEventGap: 0, movingPct, longestStatic: 0 })
  it('verdict: the scene that moves less is fixed (§17.1)', () => {
    expect(compareVerdict(pace(0.9, 2), pace(0.94, 2))).toBe('ok') // within 0.05
    expect(compareVerdict(pace(0.88, 2), pace(0.94, 2))).toBe('fix')
    expect(compareVerdict(pace(1, 1.6), pace(1, 2))).toBe('ok') // exactly 0.8 ×
    expect(compareVerdict(pace(1, 1.5), pace(1, 2))).toBe('fix')
    expect(compareVerdict(pace(0, 0), pace(0, 0))).toBe('ok')
    expect(compareVerdict(pace(1, 5), pace(0.5, 1))).toBe('ok') // moving more is never a fix
  })
  it('storyboard scenes: the track with the most scenes, sorted, clipped to the render', () => {
    const sc = (id: string, start: number, duration: number, track: number) => ({ id, type: 'x', start, duration, track, params: {} })
    const sb = { scenes: [sc('bg', 0, 10, 0), sc('s2', 3, 4, 1), sc('s1', 0, 3, 1), sc('s3', 7, 5, 1), sc('cap', 1, 1, 2)] }
    expect(storyboardScenes(sb as never, 10)).toEqual({
      track: 1,
      trackScenes: 3,
      auto: true,
      merged: false,
      scenes: [
        { id: 's1', a: 0, b: 3 },
        { id: 's2', a: 3, b: 7 },
        { id: 's3', a: 7, b: 10 },
      ],
    })
    // Tie → the lowest track.
    const tie = { scenes: [sc('v2', 4, 4, 0), sc('v1', 0, 4, 0), sc('t1', 0, 1, 1), sc('t2', 5, 1, 1)] }
    expect(storyboardScenes(tie as never, 8).scenes.map((s) => s.id)).toEqual(['v1', 'v2'])
    // --track overrides; an empty track is refused, Arabic first.
    const t1 = storyboardScenes(tie as never, 8, 1)
    expect(t1).toMatchObject({ track: 1, trackScenes: 2, auto: false })
    expect(t1.scenes.map((s) => s.id)).toEqual(['t1', 't2'])
    expect(() => storyboardScenes(tie as never, 8, 5)).toThrow(/^لا توجد مشاهد على المسار 5 — No scenes on track 5 \(tracks with scenes: 0, 1\)/)
  })
  it('M1: the default is the content track — backdrop, HUD and accent-only tracks skipped, ranked by timeline covered', () => {
    const sc = (id: string, type: string, start: number, duration: number, track: number) => ({ id, type, start, duration, track, params: {} })
    // Many accents and HUD pips, a main line with fewer scenes but the whole timeline, sparse overlays.
    const sb = {
      scenes: [
        sc('bg', 'backdrop', 0, 10, 0),
        sc('m1', 'kinetic-text', 0, 4, 1),
        sc('m2', 'counter', 4, 6, 1),
        sc('v1', 'icon', 1, 1, 2),
        sc('v2', 'icon', 3, 1, 2),
        sc('v3', 'icon', 5, 1, 2),
        ...[0, 1, 2, 3, 4, 5].map((k) => sc(`f${k}`, 'highlight', k, 0.5, 3)),
        sc('hud', 'hud', 0, 10, 4),
      ],
    }
    const pick = storyboardScenes(sb as never, 10)
    expect(pick).toMatchObject({ track: 1, auto: true, merged: false })
    expect(pick.scenes.map((s) => s.id)).toEqual(['m1', 'm2'])
    // --track still takes any track as it is.
    expect(storyboardScenes(sb as never, 10, 3).scenes).toHaveLength(6)
  })
  it('M1: recipe output (it names its transcript) has its sub-second scenes merged into beats of ≥ 1 s', () => {
    const sc = (id: string, start: number, duration: number) => ({ id, type: 'kinetic-text', start, duration, track: 1, params: {} })
    const sb = { transcript: { sourceHash: 'x', words: 9 }, scenes: [sc('a', 0, 0.4), sc('b', 0.4, 0.4), sc('c', 0.8, 0.5), sc('d', 1.3, 2), sc('e', 3.3, 0.3)] }
    const pick = storyboardScenes(sb as never, 3.6)
    expect(pick.merged).toBe(true)
    expect(pick.scenes).toEqual([
      { id: 'a+b+c', a: 0, b: 1.3 },
      { id: 'd+e', a: 1.3, b: 3.6 },
    ])
    expect(storyboardScenes(sb as never, 3.6, 1).scenes).toHaveLength(5)
    expect(mergeShortWindows([{ id: 'x', a: 0, b: 0.5 }])).toEqual([{ id: 'x', a: 0, b: 0.5 }])
  })
  it('tiling of the chosen track: gaps and overlaps (more than a frame)', () => {
    const w = (id: string, a: number, b: number) => ({ id, a, b })
    expect(tilingOf([w('a', 0, 3), w('b', 3, 7), w('c', 7, 10)], 10, 30)).toEqual({ gaps: [], overlaps: [] })
    // Float noise within a frame is not a gap.
    expect(tilingOf([w('a', 0, 3), w('b', 3.02, 10)], 10, 30)).toEqual({ gaps: [], overlaps: [] })
    expect(tilingOf([w('t1', 0, 1), w('t2', 5, 6)], 8, 30)).toEqual({
      gaps: [{ a: 1, b: 5 }, { a: 6, b: 8 }],
      overlaps: [],
    })
    expect(tilingOf([w('a', 0.5, 4), w('b', 3, 6), w('c', 6, 8)], 8, 30)).toEqual({
      gaps: [{ a: 0, b: 0.5 }],
      overlaps: [{ a: 3, b: 4, ids: ['a', 'b'] }],
    })
  })
  it('stale storyboard: duration more than a frame off, or edited after the render', () => {
    const base = { sbDuration: 3, renderDuration: 3, fps: 30, sbMtimeMs: 1000, renderMtimeMs: 5000, sbName: 'edit.json' }
    expect(staleWarnings(base)).toEqual([])
    expect(staleWarnings({ ...base, renderDuration: 3 + 1 / 30 })).toEqual([]) // one frame: fine
    const dur = staleWarnings({ ...base, renderDuration: 3.1 })
    expect(dur).toHaveLength(1)
    expect(dur[0]).toMatch(/^[\u0600-\u06FF]/)
    expect(dur[0]).toContain('edit.json lasts 3 s but the render lasts 3.1 s')
    // M2: both causes are named — another storyboard, or a render that lost frames.
    expect(dur[0]).toContain('made from a different storyboard')
    expect(dur[0]).toContain('lost frames')
    const newer = staleWarnings({ ...base, sbMtimeMs: 9000 })
    expect(newer).toHaveLength(1)
    expect(newer[0]).toMatch(/^[\u0600-\u06FF]/)
    expect(newer[0]).toContain('changed after the render')
  })
  it('scenes under 1 s are short (indicative, never fix)', () => {
    expect(sceneVerdict(0, 0.5, pace(0, 0), pace(1, 3))).toBe('short')
    expect(sceneVerdict(0, 1, pace(0, 0), pace(1, 3))).toBe('fix')
    expect(sceneVerdict(0, 1, pace(1, 3), pace(1, 3))).toBe('ok')
  })
  it('compare.md: source, tiling, timing note with both durations and the ratio; short excluded from the fix count', () => {
    const scene = (id: string, a: number, b: number, verdict: 'ok' | 'fix' | 'short') => ({ id, a, b, ours: pace(1, 1), ref: pace(1, 1), verdict })
    const md = compareMarkdown(
      {
        scenes: [scene('s1', 0, 2, 'fix'), scene('s2', 2, 2.5, 'short'), scene('s3', 2.5, 4, 'ok')],
        source: { kind: 'storyboard', track: 1, trackScenes: 3, auto: true, summary: 'scenes from track 1 (3 scenes), the track with the most scenes' },
        tiling: { gaps: [{ a: 4, b: 5 }], overlaps: [] },
        durations: { ours: 5, ref: 10, ratio: 2 },
        warnings: ['ملف القصة عُدّل بعد العرض — edit.json was changed after the render'],
      },
      'ref.mp4',
      'v002-draft.mp4',
    )
    expect(md).toContain('scenes from track 1 (3 scenes)')
    expect(md).toContain('Gap on that track: 4–5 s')
    expect(md).toContain('plays both videos in real time (ours 5 s, reference 10 s')
    expect(md).toContain('× 2 (= 10 / 5)')
    expect(md).toContain('Scenes to fix: **1** of 2 scored (s1); 1 short (indicative)')
    expect(md).toMatch(/\| s2 \| 2–2\.5 \| 4–5 \|.*\| short \(indicative\) \|/)
    expect(md).toContain('## تنبيهات — Warnings')
  })
  it('cut scenes: one shot per cut', () => {
    expect(cutScenes([], 3)).toEqual([{ id: 'shot-1', a: 0, b: 3 }])
    expect(cutScenes([1, 2.5], 4)).toEqual([
      { id: 'shot-1', a: 0, b: 1 },
      { id: 'shot-2', a: 1, b: 2.5 },
      { id: 'shot-3', a: 2.5, b: 4 },
    ])
  })
  it('windowPace: changes strictly inside [a, b), events in absolute time', () => {
    // 30 fps, 90 frames → 89 diffs. Moving (2: above static, below the event threshold) except
    // frames 30..59 (diffs 30..58 = 0); the cut diffs into frame 30 (index 29) and 60 (59) are large.
    const series = new Array(89).fill(2)
    for (let i = 30; i <= 58; i++) series[i] = 0
    series[29] = 50
    series[59] = 50
    const mid = windowPace(series, 30, 1, 2)
    expect(mid.movingPct).toBe(0)
    expect(mid.events).toEqual([])
    const first = windowPace(series, 30, 0, 1)
    expect(first.movingPct).toBe(1)
    series[14] = 20
    expect(windowPace(series, 30, 0, 1).events).toEqual([0.5])
    series[74] = 20
    expect(windowPace(series, 30, 2, 3).events).toEqual([2.5])
  })
  it('ffmpeg argv: both 960 px high, hstack, the shorter cloned to the longer, labels overlaid', () => {
    const args = buildCompareArgs({
      reference: 'C:/a b/ref%.mp4', render: 'C:/ر/ours.mp4', refLabel: 'C:/50%/l1.png', oursLabel: 'C:/50%/l2.png',
      refDuration: 2, oursDuration: 3, fps: 30, hasAudio: false, out: 'C:/out/compare.mp4.tmp',
    })
    expect(args).toContain('C:/a b/ref%.mp4')
    expect(args.filter((a) => a === '-pattern_type')).toHaveLength(2)
    const g = args[args.indexOf('-filter_complex') + 1]!
    expect(g).toContain('scale=-2:960')
    expect(g).toMatch(/\[0:v\][^;]*tpad=stop_mode=clone:stop_duration=1(?:\.0+)?[;,\[]/)
    expect(g).not.toMatch(/\[1:v\][^;]*tpad/)
    expect(g).toContain('hstack=inputs=2')
    expect(g).not.toContain('drawtext')
    expect(args[args.indexOf('-t') + 1]).toBe('3')
    expect(args).toContain('-an')
    expect(args.at(-1)).toBe('C:/out/compare.mp4.tmp')
  })
})

describe('paletteOf roles (fix round 1)', () => {
  it('R24: a grey band (≥ 1 %) and no other colour gives no accent', () => {
    const px = new Uint8Array(1000 * 3)
    for (let i = 0; i < 1000; i++) px.set(i % 10 === 0 ? [0x80, 0x80, 0x80] : [0x10, 0x18, 0x20], i * 3)
    const p = paletteOf(px, 1)
    expect(p.find((c) => c.role === 'accent')).toBeUndefined()
    expect(p.map((c) => c.role).sort()).toEqual(['background', 'text'])
  })
  it('a different seed on the same palette gives the same roles, hex within ΔE 3', () => {
    const px = new Uint8Array(3000 * 3)
    const cols: RGB[] = [[0x10, 0x18, 0x20], [0xf2, 0xf2, 0xf2], [0xff, 0x6a, 0x00]]
    const r = rng(11)
    for (let i = 0; i < 3000; i++) {
      const k = i % 20
      const c = cols[k < 14 ? 0 : k < 19 ? 1 : 2]!
      px.set(c.map((v) => Math.max(0, Math.min(255, v + Math.round((r() - 0.5) * 16)))), i * 3)
    }
    const a = paletteOf(px, 1)
    const b = paletteOf(px, 987654)
    expect(b.map((c) => c.role).sort()).toEqual(a.map((c) => c.role).sort())
    for (const role of ['background', 'text', 'accent'] as const) {
      const x = a.find((c) => c.role === role)!
      const y = b.find((c) => c.role === role)!
      expect(deltaE(hexToRgb(x.hex), hexToRgb(y.hex)), role).toBeLessThan(3)
    }
  })
})

describe('core/palette (fix round 1)', () => {
  it('the colour maths lives in core and reference.ts re-exports it', async () => {
    const core = await import('../../src/core/palette')
    expect(core.paletteOf).toBe(paletteOf)
    expect(core.deltaE).toBe(deltaE)
    expect(core.labToRgb(core.rgbToLab([0xff, 0x6a, 0x00]))).toEqual([0xff, 0x6a, 0x00])
  })
})

describe('styleFromReports (palette merge)', () => {
  it('merges two accents that differ by ΔE 5 into one accent with the summed share', () => {
    const a: RGB = [255, 106, 0]
    let b: RGB = a
    for (let g = 107; g < 200; g++) {
      b = [255, g, 0]
      if (deltaE(a, b) >= 4.5) break
    }
    expect(deltaE(a, b)).toBeGreaterThan(4)
    expect(deltaE(a, b)).toBeLessThan(6)
    const hex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
    const mk = (accent: RGB) => ({
      duration: 20,
      cuts: [],
      medianShot: 20,
      events: Array.from({ length: 40 }, (_, i) => i * 0.5),
      eventsPerSec: 2,
      medianEventGap: 0.5,
      maxEventGap: 1,
      movingPct: 0.9,
      palette: [
        { hex: '#101820', share: 0.8, role: 'background' as const },
        { hex: hex(accent), share: 0.2, role: 'accent' as const },
      ],
    })
    const src = (r: ReturnType<typeof mk>, file: string) => ({ report: r, detailMean: 10, motionMean: 10, file, sha1: 'f'.repeat(40) })
    const s = styleFromReports([src(mk(a), 'a.mp4'), src(mk(b), 'b.mp4')])
    const accents = s.colours.filter((c) => c.role === 'accent')
    expect(accents).toHaveLength(1)
    // Summed 0.2 + 0.2 over a total share of 2, then renormalised: 0.2.
    expect(accents[0]!.share).toBeCloseTo(0.2, 3)
    expect(s.colours.filter((c) => c.role === 'bg')).toHaveLength(1)
    expect(s.colours.reduce((x, c) => x + c.share, 0)).toBeCloseTo(1, 3)
  })
})
