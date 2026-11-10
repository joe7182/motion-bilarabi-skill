import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cameraAt, tourKeys } from '../../src/core/camera'
import { spaceFieldParams } from '../../src/core/params/space'
import { PRIMITIVE_IDS } from '../../src/core/primitive-ids'
import { parseStoryboard } from '../../src/core/storyboard'

const types = [...PRIMITIVE_IDS]
const stops = [
  { start: 0, place: { x: 0.3, y: 0.2, scale: 0.34 } },
  { start: 2.4, place: { x: 0.7, y: 0.4, scale: 0.34 } },
  { start: 4, place: { x: 0.5, y: 0.5, scale: 1 } },
]

describe('one-space tour', () => {
  it('holds on each stop and lands exactly as the next one starts', () => {
    const keys = tourKeys(stops, { travel: 1.2, lift: 0.4 })
    expect(keys.map((k) => k.at)).toEqual([0, 1.2, 2.4, 2.8, 4])
    const c = { keys }
    expect(cameraAt(c, 1).x).toBeCloseTo(0.3)
    expect(cameraAt(c, 1).zoom).toBeCloseTo(1 / 0.34)
    expect(cameraAt(c, 2.4).x).toBe(0.7)
    expect(cameraAt(c, 2.4).zoom).toBeCloseTo(1 / 0.34)
    expect(cameraAt(c, 4).zoom).toBeCloseTo(1)
  })
  it('pulls back mid-flight by the lift', () => {
    const c = { keys: tourKeys(stops, { travel: 1.2, lift: 0.4 }) }
    expect(cameraAt(c, 1.8).zoom).toBeCloseTo((1 / 0.34) * 0.6)
  })
  it('a short gap never leaves before arriving', () => {
    const keys = tourKeys([stops[0]!, { start: 0.5, place: stops[1]!.place }], { travel: 2, lift: 0 })
    expect(keys[1]!.at).toBeGreaterThan(0)
    expect(keys[1]!.at).toBeLessThan(0.5)
  })
  it('parsing fills the keys from placed scenes and rejects places without a camera or on a fixed track', () => {
    const scene = (id: string, start: number, place?: object, track = 2) => ({ id, type: 'backdrop', start, duration: 2, track, ...(place ? { place } : {}) })
    const sb = parseStoryboard({ version: 1, camera: { tour: {} }, scenes: [scene('a', 0, stops[0]!.place), scene('b', 2.4, stops[1]!.place)] }, types)
    expect(sb.camera!.keys.length).toBe(3)
    expect(() => parseStoryboard({ version: 1, scenes: [scene('a', 0, stops[0]!.place)] }, types)).toThrow(/camera/)
    expect(() => parseStoryboard({ version: 1, camera: { tour: {} }, scenes: [scene('a', 0, stops[0]!.place, 0)] }, types)).toThrow(/fixed/)
    expect(() => parseStoryboard({ version: 1, camera: { tour: {} }, scenes: [scene('a', 0)] }, types)).toThrow(/place/)
    expect(() => parseStoryboard({ version: 1, camera: {}, scenes: [scene('a', 0)] }, types)).toThrow(/key/)
  })
  it('the example storyboard parses', () => {
    const sb = parseStoryboard(JSON.parse(readFileSync('examples/one-space.json', 'utf8')), types)
    expect(sb.camera!.keys.at(-1)!.at).toBe(14)
  })
  it('space-field params', () => {
    expect(spaceFieldParams.parse({}).kind).toBe('dots')
    expect(spaceFieldParams.safeParse({ kind: 'route' }).success).toBe(false)
    expect(spaceFieldParams.safeParse({ kind: 'nebula' }).success).toBe(false)
  })
})

import { screenMockupParams } from '../../src/core/params/screen-mockup'
import { takeShot } from '../../src/node/shot'

describe('screen-mockup and shots', () => {
  it('screen-mockup fills defaults and checks boxes', () => {
    const p = screenMockupParams.parse({ image: 'img/site.jpg' })
    expect(p.device).toBe('browser')
    expect(p.tilt).toBe(true)
    expect(screenMockupParams.parse({ image: 'a.jpg', focus: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.1, at: 1 }] }).focus[0]!.zoom).toBe(1.5)
    expect(screenMockupParams.safeParse({ image: 'a.jpg', taps: [{ x: 1.2, y: 0.5, at: 1 }] }).success).toBe(false)
    expect(screenMockupParams.safeParse({}).success).toBe(false)
  })
  it('mba shot only takes http(s) links', async () => {
    await expect(takeShot('file:///etc/passwd', 'x.jpg')).rejects.toThrow(/http/)
  })
})
