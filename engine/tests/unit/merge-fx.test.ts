import { describe, expect, it } from 'vitest'
import { bento, evenGrid, gooMergeParams, photoGridParams } from '../../src/core/params/merge-fx'
import { glassCardParams } from '../../src/core/params/showcase-fx'

const area = (boxes: number[][]) => boxes.reduce((a, b) => a + b[2]! * b[3]!, 0)
const overlap = (a: number[], b: number[]) => Math.max(0, Math.min(a[0]! + a[2]!, b[0]! + b[2]!) - Math.max(a[0]!, b[0]!)) * Math.max(0, Math.min(a[1]! + a[3]!, b[1]! + b[3]!) - Math.max(a[1]!, b[1]!))

describe('photo-grid layouts', () => {
  it('the bento fills the block exactly, with no tile over another, for 3 to 6 photos and any hero', () => {
    for (let n = 3; n <= 6; n++) {
      for (let hero = 0; hero < n; hero++) {
        const b = bento(n, hero)
        expect(b).toHaveLength(n)
        expect(area(b), `${n}/${hero}`).toBeCloseTo(1, 6)
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlap(b[i]!, b[j]!), `${n}/${hero}: ${i}×${j}`).toBeLessThan(1e-9)
        // the hero is the largest tile
        expect(Math.max(...b.map((x) => x[2] * x[3]))).toBeCloseTo(b[hero]![2] * b[hero]![3], 9)
      }
    }
  })
  it('the even grid keeps every tile inside the block and the same size', () => {
    for (let n = 3; n <= 6; n++) {
      const g = evenGrid(n)
      expect(new Set(g.map((x) => `${x[2].toFixed(4)}x${x[3].toFixed(4)}`)).size).toBe(1)
      for (const x of g) { expect(x[0] + x[2]).toBeLessThanOrEqual(1 + 1e-9); expect(x[1] + x[3]).toBeLessThanOrEqual(1 + 1e-9) }
    }
  })
  it('params: three to six photos, and the hero is one of them', () => {
    expect(photoGridParams.safeParse({ images: ['a.jpg', 'b.jpg'] }).success).toBe(false)
    expect(photoGridParams.safeParse({ images: ['a.jpg', 'b.jpg', 'c.jpg'], hero: 3 }).success).toBe(false)
    expect(photoGridParams.parse({ images: ['a.jpg', 'b.jpg', 'c.jpg'] }).hero).toBe(0)
  })
})

describe('goo-merge and liquid glass params', () => {
  it('goo-merge takes two to five things and what they become', () => {
    expect(gooMergeParams.safeParse({ from: ['سكربت'], to: 'ريل' }).success).toBe(false)
    expect(gooMergeParams.parse({ from: ['سكربت', 'صوت'], to: 'ريل' }).dur).toBe(1.1)
  })
  it('the glass card is plain glass unless liquid is asked for', () => {
    expect(glassCardParams.parse({ title: 'عنوان' }).liquid).toBe(false)
  })
})
