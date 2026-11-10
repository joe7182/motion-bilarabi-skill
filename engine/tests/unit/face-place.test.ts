import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { placeAroundFaces } from '../../src/node/face-place'

function project(box: [number, number, number, number]) {
  const dir = mkdtempSync(join(tmpdir(), 'face-'))
  mkdirSync(join(dir, 'work'))
  writeFileSync(join(dir, 'work', 'm1.matte.face.json'), JSON.stringify({ fps: 60, w: 1080, h: 1920, boxes: Array.from({ length: 600 }, () => box) }))
  return dir
}
const media = new Map([['m1', 'work/m1.mp4']])
const shot = { id: 'v', type: 'cutout', track: 0, start: 0, duration: 4, params: { media: 'm1', in: 0 } }

describe('face-aware placement', () => {
  it('a headline over the face moves below the chin; one clear of it stays', () => {
    const dir = project([0.3, 0.2, 0.7, 0.42])
    const over = { id: 'h', type: 'kinetic-text', start: 0, duration: 2, params: { mode: 'line', y: 0.3 } }
    const clear = { id: 'c', type: 'kinetic-text', start: 0, duration: 2, params: { mode: 'line', y: 0.6 } }
    const obj = { scenes: [shot, over, clear] }
    const notes = placeAroundFaces(obj, dir, media, '9:16', 1080 / 1920)
    expect(notes).toHaveLength(1)
    expect(over.params.y).toBeGreaterThan(0.42)
    expect(clear.params.y).toBe(0.6)
  })
  it('two moved texts do not land on each other; "face": "keep" is left alone', () => {
    const dir = project([0.3, 0.2, 0.7, 0.42])
    const a = { id: 'a', type: 'kinetic-text', start: 0, duration: 2, params: { mode: 'line', y: 0.3 } as Record<string, unknown> }
    const b = { id: 'b', type: 'stamp', start: 0, duration: 2, params: { at: { x: 0.5, y: 0.2 } } as Record<string, unknown> }
    const k = { id: 'k', type: 'kinetic-text', start: 0, duration: 2, params: { mode: 'line', y: 0.3, face: 'keep' } as Record<string, unknown> }
    placeAroundFaces({ scenes: [shot, a, b, k] }, dir, media, '9:16', 1080 / 1920)
    const ay = a.params.y as number
    const by = 0.14 + ((b.params.at as { y: number }).y) * 0.64
    expect(Math.abs(ay - by)).toBeGreaterThan(0.1)
    expect(k.params.y).toBe(0.3)
  })
})
