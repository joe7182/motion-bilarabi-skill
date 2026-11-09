import { describe, it, expect } from 'vitest'
import {
  DETAIL_BLANK,
  blankRuns,
  blockMotionSeries,
  emptyFrames,
  hexToRgb,
  type RGB,
  frameDetail,
  runsOf,
  eventTimes,
  fastestMoments,
  maxEventGap,
  motionSeries,
  nearBlank,
  staticRuns,
  stripWindow,
} from '../../src/node/metrics'

const W = 8
const H = 8

/** A frame whose pixels are `paint(i)` (default: a fixed non-uniform pattern). */
function frame(paint: (i: number) => number = (i) => (i * 37) % 256): Uint8Array {
  const f = new Uint8Array(W * H)
  for (let i = 0; i < f.length; i++) f[i] = paint(i)
  return f
}
const uniform = (v: number) => frame(() => v)

describe('motionSeries', () => {
  it('is all 0 for identical frames, length frames - 1', () => {
    const s = motionSeries([frame(), frame(), frame(), frame()])
    expect(s).toEqual([0, 0, 0])
  })

  it('a single changed frame gives two spikes', () => {
    const frames = [uniform(10), uniform(10), uniform(110), uniform(10), uniform(10)]
    expect(motionSeries(frames)).toEqual([0, 100, 100, 0])
  })

  it('is the mean absolute difference (0..255)', () => {
    const a = uniform(0)
    const b = frame((i) => (i < 32 ? 255 : 0)) // half the pixels change by 255
    expect(motionSeries([a, b])[0]).toBeCloseTo(127.5, 9)
  })

  it('is empty for 0 or 1 frames', () => {
    expect(motionSeries([])).toEqual([])
    expect(motionSeries([frame()])).toEqual([])
  })
})

describe('staticRuns', () => {
  it('finds a 2 s run at the right times', () => {
    const fps = 10
    // Frames 0..9 move (diff 5), frames 10..30 identical (20 static diffs = 2.1 s of one picture), then motion.
    const series = [
      ...Array(10).fill(5), // diffs 0..9 (frame 10 differs from 9)
      ...Array(20).fill(0), // diffs 10..29: frames 10..30 identical
      ...Array(5).fill(5),
    ]
    const runs = staticRuns(series, fps)
    expect(runs).toHaveLength(1)
    // The picture of frame 10 is shown from 1.0 s until frame 31 replaces it at 3.1 s.
    expect(runs[0]!.start).toBeCloseTo(1.0, 9)
    expect(runs[0]!.end).toBeCloseTo(3.1, 9)
  })

  it('uses the threshold (values just below count as static)', () => {
    const runs = staticRuns([0.59, 0.59, 0.59, 0.59, 0.59], 10, 0.6)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.start).toBeCloseTo(0, 9)
    expect(runs[0]!.end).toBeCloseTo(0.6, 9)
    expect(staticRuns([0.6, 0.6, 0.6, 0.6], 10, 0.6)).toEqual([])
  })

  it('a fully static clip is one run over the whole duration', () => {
    const runs = staticRuns(Array(89).fill(0), 30) // 90 identical frames
    expect(runs).toHaveLength(1)
    expect(runs[0]!.start).toBe(0)
    expect(runs[0]!.end).toBeCloseTo(3, 9)
  })

  it('drops runs shorter than minDur', () => {
    // 2 static diffs at 30 fps = 3 frames = 0.1 s.
    expect(staticRuns([5, 0, 0, 5], 30)).toEqual([])
    expect(staticRuns([5, 0, 0, 5], 30, 0.6, 0.05)).toHaveLength(1)
  })
})

describe('eventTimes', () => {
  it('returns local maxima above the threshold, at the time the new frame appears', () => {
    const s = Array(30).fill(0)
    s[4] = 10 // frame 5 appears at 0.5 s
    s[19] = 6 // frame 20 at 2.0 s
    s[25] = 3 // below thr
    expect(eventTimes(s, 10)).toEqual([0.5, 2.0])
  })

  it('respects minApart: of two peaks closer than 0.25 s the larger wins', () => {
    const s = Array(60).fill(0)
    s[9] = 8 // 0.333 s at 30 fps
    s[13] = 12 // 0.467 s (0.133 s later)
    s[40] = 9 // 1.367 s
    const ev = eventTimes(s, 30)
    expect(ev).toHaveLength(2)
    expect(ev[0]).toBeCloseTo(14 / 30, 9)
    expect(ev[1]).toBeCloseTo(41 / 30, 9)
    for (let i = 1; i < ev.length; i++) expect(ev[i]! - ev[i - 1]!).toBeGreaterThanOrEqual(0.25)
  })

  it('is empty for a static series', () => {
    expect(eventTimes(Array(50).fill(0.2), 30)).toEqual([])
    expect(eventTimes([], 30)).toEqual([])
  })
})

describe('maxEventGap', () => {
  it('counts the start -> first and last -> end gaps', () => {
    expect(maxEventGap([1, 2], 3)).toBeCloseTo(1, 9)
    expect(maxEventGap([2.5, 3], 4)).toBeCloseTo(2.5, 9) // start edge
    expect(maxEventGap([0.5, 1], 5)).toBeCloseTo(4, 9) // end edge
    expect(maxEventGap([1, 3.5], 4)).toBeCloseTo(2.5, 9) // middle
  })

  it('is the whole duration with no events', () => {
    expect(maxEventGap([], 3)).toBe(3)
  })
})

describe('nearBlank (detail, R23)', () => {
  const VW = 72
  const VH = 128
  /** A dark radial vignette: smooth, no edges (like a look's background with no content). */
  const vignette = () => {
    const f = new Uint8Array(VW * VH)
    for (let y = 0; y < VH; y++) {
      for (let x = 0; x < VW; x++) {
        const d = Math.hypot((x - VW / 2) / VW, (y - VH * 0.4) / VH)
        f[y * VW + x] = Math.round(48 - 60 * d) // ~48 in the centre, darker towards the edges
      }
    }
    return f
  }
  /** The vignette with a thin text-like bar: 2 px tall, 24 px wide, light on dark. */
  const withBar = () => {
    const f = vignette()
    for (let y = 60; y < 62; y++) for (let x = 24; x < 48; x++) f[y * VW + x] = 230
    return f
  }

  it('a smooth vignette is blank, the same frame with a thin bar is not', () => {
    expect(frameDetail(vignette(), VW)).toBeLessThan(DETAIL_BLANK)
    expect(frameDetail(withBar(), VW)).toBeGreaterThan(DETAIL_BLANK)
    expect(nearBlank([vignette(), withBar(), vignette()], 10, DETAIL_BLANK, VW)).toEqual([0, 0.2])
  })

  it('a flat frame is blank and has zero detail', () => {
    const flat = new Uint8Array(VW * VH).fill(17)
    expect(frameDetail(flat, VW)).toBe(0)
    expect(nearBlank([flat], 30, undefined, VW)).toEqual([0])
  })

  it('flags uniform frames and not textured ones, as frame times', () => {
    const frames = [uniform(0), frame(), uniform(200), frame(), uniform(17)]
    expect(nearBlank(frames, 10, undefined, W)).toEqual([0, 0.2, 0.4])
  })

  it('detail is the per-mille of edge pixels; thr is compared against it', () => {
    // 1 of 64 pixels differs strongly from its 3x3 neighbourhood mean -> it and its neighbours count.
    const f = uniform(0)
    f[3 * W + 3] = 255
    const d = frameDetail(f, W)
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThanOrEqual(1000)
    expect(nearBlank([f], 30, d + 1, W)).toEqual([0])
    expect(nearBlank([f], 30, d, W)).toEqual([])
  })
})

describe('emptyFrames / blankRuns (designed covers, R10)', () => {
  const BG: RGB = [14, 13, 12]
  const ACCENT: RGB = [255, 90, 31]
  it('hexToRgb', () => {
    expect(hexToRgb('#0e0d0c')).toEqual([14, 13, 12])
    expect(hexToRgb('#FF5A1F')).toEqual([255, 90, 31])
  })
  it('without a background colour every flat frame is empty (plain video)', () => {
    const colors: RGB[] = [BG, ACCENT, ACCENT, BG]
    expect(emptyFrames([0, 0.1, 0.2, 0.3], 10, colors)).toEqual([0, 0.1, 0.2, 0.3])
  })
  it('a list of world backgrounds: a flat frame is empty when it matches any of them', () => {
    const CREAM: RGB = [240, 236, 226]
    const colors: RGB[] = [BG, ACCENT, CREAM, CREAM]
    expect(emptyFrames([0, 0.1, 0.2, 0.3], 10, colors, [BG, CREAM])).toEqual([0, 0.2, 0.3])
    expect(emptyFrames([0, 0.1, 0.2, 0.3], 10, colors, [BG])).toEqual([0])
  })
  it('with the look background, only background-coloured flat frames are empty', () => {
    const colors: RGB[] = [BG, ACCENT, [20, 18, 30], [240, 236, 226]]
    expect(emptyFrames([0, 0.1, 0.2, 0.3], 10, colors, BG)).toEqual([0, 0.2])
    expect(emptyFrames([0, 0.2], 10, colors, BG, 5)).toEqual([0])
  })
  it('runs carry their mean colour and whether they sit inside a transition window', () => {
    const colors: RGB[] = Array.from({ length: 30 }, (_, k): RGB => (k < 10 ? [10, 10, 10] : [20, 14, 12]))
    // Frames 3..4 (0.1..0.1667 s) and 20..21 (0.6667..0.7333 s) at 30 fps; window [0.6, 0.8].
    const runs = blankRuns([3, 4, 20, 21].map((k) => k / 30), 30, colors, [{ a: 0.6, b: 0.8 }])
    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({ nearBlankColor: [10, 10, 10], designed: false })
    expect(runs[0]!.start).toBeCloseTo(0.1, 9)
    expect(runs[1]).toMatchObject({ nearBlankColor: [20, 14, 12], designed: true })
    // A run reaching past the window is not designed.
    expect(blankRuns([20, 21, 22, 23, 24, 25].map((k) => k / 30), 30, colors, [{ a: 0.6, b: 0.75 }])[0]!.designed).toBe(false)
    // Mean colour over the run's frames, rounded.
    expect(blankRuns([9, 10].map((k) => k / 30), 30, colors, [])[0]!.nearBlankColor).toEqual([15, 12, 11])
  })
})

describe('runsOf', () => {
  it('groups consecutive frame times into {start,end} runs, end = last frame end', () => {
    expect(runsOf([0, 0.1, 0.2, 0.5, 0.9, 1.0], 10)).toEqual([
      { start: 0, end: 0.3 },
      { start: 0.5, end: 0.6 },
      { start: 0.9, end: 1.1 },
    ])
    expect(runsOf([], 30)).toEqual([])
  })
})

describe('fastestMoments', () => {
  it('returns distinct moments >= 1 s apart, fastest first', () => {
    const fps = 30
    const s = Array(150).fill(1)
    s[30] = 50 // the fastest
    s[40] = 45 // too close to the first (0.33 s)
    s[70] = 30 // 1.33 s after the first
    s[120] = 20
    const m = fastestMoments(s, fps)
    expect(m).toHaveLength(2)
    expect(m[0]).toBeCloseTo(31 / fps, 9)
    expect(m[1]).toBeCloseTo(71 / fps, 9)
    expect(Math.abs(m[1]! - m[0]!)).toBeGreaterThanOrEqual(1)
  })

  it('returns fewer when the clip is too short or static', () => {
    const short = [2, 9, 3, 1] // 5 frames at 10 fps: no second moment 1 s away
    expect(fastestMoments(short, 10)).toHaveLength(1)
    expect(fastestMoments(Array(100).fill(0), 30)).toEqual([])
    expect(fastestMoments([], 30)).toEqual([])
  })

  it('honours n', () => {
    const s = Array(300).fill(0)
    s[10] = 5
    s[100] = 6
    s[200] = 7
    expect(fastestMoments(s, 30, 3)).toHaveLength(3)
  })
})

describe('stripWindow', () => {
  it('centres 12 frames on the moment and clamps to the clip', () => {
    // A moment at t: the frame at round(t*fps) is the 7th of the window.
    expect(stripWindow(2.0, 30, 210)).toEqual({ start: 54, count: 12 })
    expect(stripWindow(0.05, 30, 210)).toEqual({ start: 0, count: 12 })
    expect(stripWindow(6.99, 30, 210)).toEqual({ start: 198, count: 12 })
  })

  it('uses every frame of a clip shorter than a strip', () => {
    expect(stripWindow(0.2, 10, 5)).toEqual({ start: 0, count: 5 })
  })
})

describe('blockMotionSeries', () => {
  it('is the largest per-block mean abs diff, so small local motion is not diluted', () => {
    // 12×16 frames, a 2×2 grid of 6×8 blocks; one 3×4 patch (a quarter of one block) changes by 200.
    const w = 12
    const h = 16
    const a = new Uint8Array(w * h).fill(20)
    const b = a.slice()
    for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) b[y * w + x] = 220
    const global = motionSeries([a, b])[0]!
    const local = blockMotionSeries([a, b], w, h, 2, 2)[0]!
    expect(global).toBeCloseTo((12 * 200) / 192, 9) // 12.5
    expect(local).toBeCloseTo((12 * 200) / 48, 9) // 50
  })

  it('is all 0 for identical frames and empty for < 2 frames', () => {
    const f = new Uint8Array(72 * 128).fill(9)
    expect(blockMotionSeries([f, f, f], 72, 128)).toEqual([0, 0])
    expect(blockMotionSeries([f], 72, 128)).toEqual([])
  })

  it('handles sizes that do not divide by the grid', () => {
    const w = 7
    const h = 5
    const a = new Uint8Array(w * h)
    const b = new Uint8Array(w * h).fill(10)
    expect(blockMotionSeries([a, b], w, h, 3, 2)[0]).toBeCloseTo(10, 9)
  })
})
