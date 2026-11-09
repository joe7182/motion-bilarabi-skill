import { describe, it, expect } from 'vitest'
import { PNG } from 'pngjs'
import { diffPngs } from '../../src/node/png-diff'

function png(w: number, h: number, paint?: (x: number, y: number) => [number, number, number, number]): Buffer {
  const p = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = paint?.(x, y) ?? [10, 20, 30, 255]
      const i = (y * w + x) * 4
      p.data[i] = r
      p.data[i + 1] = g
      p.data[i + 2] = b
      p.data[i + 3] = a
    }
  }
  return PNG.sync.write(p)
}

describe('diffPngs', () => {
  it('identical images: 0 px, max delta 0', () => {
    expect(diffPngs(png(4, 3), png(4, 3))).toEqual({ diffPixels: 0, maxChannelDelta: 0 })
  })
  it('counts pixels with any channel delta > 0 and reports the largest delta', () => {
    const b = png(4, 3, (x, y) => (x === 1 && y === 2 ? [11, 20, 30, 255] : x === 3 && y === 0 ? [10, 20, 30, 200] : [10, 20, 30, 255]))
    expect(diffPngs(png(4, 3), b)).toEqual({ diffPixels: 2, maxChannelDelta: 55 })
  })
  it('a one-unit change in one channel is a difference', () => {
    const b = png(2, 2, (x, y) => (x === 0 && y === 0 ? [10, 20, 31, 255] : [10, 20, 30, 255]))
    expect(diffPngs(png(2, 2), b)).toEqual({ diffPixels: 1, maxChannelDelta: 1 })
  })
  it('different sizes: every pixel of the larger image differs', () => {
    expect(diffPngs(png(2, 2), png(3, 2))).toEqual({ diffPixels: 6, maxChannelDelta: 255 })
  })
})
