import { describe, expect, it } from 'vitest'
import { videoFrameAt, videoLastFrame, videoZoomAt, videoZoomTransform } from '../../src/core/video'
import { buildExtractArgs, JPEG_FROM_WORK, toRuns } from '../../src/node/framesrv'

describe('video frame mapping', () => {
  it('n = round((in + localT·speed)·fps)', () => {
    expect(videoFrameAt({ in: 1, speed: 1 }, 0.5, 1, 30)).toBe(45)
    expect(videoFrameAt({ in: 1, speed: 2 }, 0.5, 0.9, 30)).toBe(60)
    expect(videoFrameAt({ in: 0, speed: 1 }, 0, 2, 30)).toBe(0)
    expect(videoFrameAt({ in: 0.5, speed: 1 }, 1 / 60, 1, 60)).toBe(31)
    expect(videoFrameAt({ in: 0, speed: 0.25 }, 1, 2, 30)).toBe(8) // round(7.5)
  })
  it('the last frame of a scene: the clip end gives frames − 1; times past it are clamped', () => {
    expect(videoLastFrame({ in: 0, speed: 1 }, 2, 30)).toBe(59)
    expect(videoLastFrame({ in: 1, speed: 1 }, 2, 30)).toBe(89)
    expect(videoLastFrame({ in: 0, speed: 1 }, 1.99, 30)).toBe(59) // ends inside frame 59
    expect(videoLastFrame({ in: 0, speed: 1 }, 2.001, 30)).toBe(59) // 3-decimal rounding of durations
    expect(videoFrameAt({ in: 0, speed: 1 }, 2, 2, 30)).toBe(59)
    expect(videoFrameAt({ in: 0, speed: 1 }, -0.1, 2, 30)).toBe(0)
  })
})

describe('video zoom', () => {
  it('no keys: identity; keys: spring tracks, x/y default to the centre and carry over', () => {
    expect(videoZoomAt(undefined, 1)).toEqual({ scale: 1, x: 0.5, y: 0.5 })
    expect(videoZoomTransform(videoZoomAt([], 0), 100, 200)).toBe('')
    const keys = [{ t: 0.5, scale: 2, x: 0.25 }, { t: 0, scale: 1 }]
    expect(videoZoomAt(keys, 0)).toEqual({ scale: 1, x: 0.5, y: 0.5 })
    const late = videoZoomAt(keys, 5)
    expect(late.scale).toBeCloseTo(2, 3)
    expect(late.x).toBeCloseTo(0.25, 3)
    expect(late.y).toBeCloseTo(0.5, 6)
    // Pure: same input, same output.
    expect(videoZoomAt(keys, 0.7)).toEqual(videoZoomAt(keys, 0.7))
  })
  it('the transform keeps (x·w, y·h) fixed', () => {
    const tr = videoZoomTransform({ scale: 2, x: 0.5, y: 0.5 }, 100, 200)
    expect(tr).toBe('translate(-50.000px, -100.000px) scale(2.00000)')
  })
})

describe('frame extraction argv', () => {
  it('runs: sorted unique inclusive runs', () => {
    expect(toRuns([5, 3, 4, 9, 9, 10, 0])).toEqual([[0, 0], [3, 5], [9, 10]])
  })
  it('seeks half a frame before the first wanted frame and selects by index relative to it', () => {
    const a = buildExtractArgs('C:/p 100%/work/m1.mp4', [17, 18, 19, 20, 45, 60, 61], 30)
    expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 2)).toEqual(['-ss', (16.5 / 30).toFixed(6)])
    expect(a[a.indexOf('-vf') + 1]).toBe('select=between(n\\,0\\,3)+eq(n\\,28)+between(n\\,43\\,44),' + JPEG_FROM_WORK)
    expect(a.slice(-9)).toEqual(['-fps_mode', 'passthrough', '-frames:v', '7', '-q:v', '2', '-start_number', '0', '%d.jpg'])
    expect(buildExtractArgs('x.mp4', [0, 1], 30)).not.toContain('-ss')
  })
  it('converts the BT.709 limited-range working copy to the BT.601 full-range YCbCr a browser decodes JPEG as', () => {
    expect(JPEG_FROM_WORK).toBe('scale=in_color_matrix=bt709:in_range=tv:out_color_matrix=bt601:out_range=pc:flags=bicubic+accurate_rnd+full_chroma_int,format=yuvj420p')
  })
})
