import { PNG } from 'pngjs'

export interface PngDiff {
  /** Pixels where any RGBA channel differs (delta > 0). */
  diffPixels: number
  /** Largest absolute channel delta over all pixels (0..255). */
  maxChannelDelta: number
}

/**
 * Exact pixel comparison of two PNGs on decoded RGBA (no tolerance: one unit in one channel is a
 * difference). Images of different sizes differ everywhere: every pixel of the larger one counts,
 * with max delta 255.
 */
export function diffPngs(a: Buffer, b: Buffer): PngDiff {
  const pa = PNG.sync.read(a)
  const pb = PNG.sync.read(b)
  if (pa.width !== pb.width || pa.height !== pb.height) {
    return { diffPixels: Math.max(pa.width * pa.height, pb.width * pb.height), maxChannelDelta: 255 }
  }
  const da = pa.data
  const db = pb.data
  let diffPixels = 0
  let maxChannelDelta = 0
  for (let i = 0; i < da.length; i += 4) {
    let px = 0
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(da[i + c]! - db[i + c]!)
      if (d > px) px = d
    }
    if (px > 0) {
      diffPixels++
      if (px > maxChannelDelta) maxChannelDelta = px
    }
  }
  return { diffPixels, maxChannelDelta }
}
