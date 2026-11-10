import { describe, expect, it } from 'vitest'
import { mediaSceneOf } from '../../src/core/media-scenes'
import { cuesOfGlitchText, cuesOfZoomCallout, glitchTextParams, zoomCalloutParams } from '../../src/core/params/glitch'

describe('glitch-text params', () => {
  it('fills defaults and takes a swap', () => {
    const p = glitchTextParams.parse({ lines: ['خطأ واحد'], to: { lines: ['يخرب', 'كل شي'], at: 1.9 } })
    expect(p.at).toBe(0.1)
    expect(p.scan).toBe(true)
    expect(p.to!.accent).toEqual([])
  })
  it('rejects three lines and an empty line', () => {
    expect(glitchTextParams.safeParse({ lines: ['أ', 'ب', 'ج'] }).success).toBe(false)
    expect(glitchTextParams.safeParse({ lines: [' '] }).success).toBe(false)
  })
  it('cues a hit on the glitch-in, each burst and the swap', () => {
    const p = glitchTextParams.parse({ lines: ['خطأ'], at: 0.2, hits: [{ at: 1 }], to: { lines: ['صح'], at: 2 } })
    expect(cuesOfGlitchText(p).map((c) => c.t)).toEqual([0.2, 1, 2])
  })
})

describe('zoom-callout params', () => {
  const base = { media: 'm1', in: 0.5, spot: { x: 0.5, y: 0.4 }, lens: { x: 0.5, y: 0.8 } }
  it('fills defaults', () => {
    const p = zoomCalloutParams.parse(base)
    expect(p.spot.r).toBe(0.07)
    expect(p.lens.size).toBe(0.46)
    expect(p.shape).toBe('circle')
    expect(cuesOfZoomCallout(p)).toEqual([{ t: p.at + 0.35, kind: 'whoosh' }])
  })
  it('is a media scene with the video frame mapping', () => {
    const m = mediaSceneOf({ type: 'zoom-callout', params: base })!
    expect(m.media).toBe('m1')
    expect(m.frameAt(1, 4, 60)).toBe(90)
    expect(m.lastFrame(4, 60)).toBe(269)
  })
  it('rejects a spot outside the frame', () => {
    expect(zoomCalloutParams.safeParse({ ...base, spot: { x: 1.2, y: 0.4 } }).success).toBe(false)
  })
})
