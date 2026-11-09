import type { LineArtName } from '../../core/params/line-art'

/**
 * Motion Bil-Arabi's own line art (drawn for this engine, not from any icon set). Each art is a
 * viewBox and its stroked paths, in draw order; `stroke` is the stroke width in viewBox units.
 * DOM-free data, so unit tests can read it.
 */
export interface LineArt {
  viewBox: { w: number; h: number }
  stroke: number
  paths: readonly string[]
}

export const LINE_ART: Record<LineArtName, LineArt> = {
  // Axes, then a rising zig-zag ending in an arrowhead (retraced so it stays one stroke).
  'chart-up': {
    viewBox: { w: 100, h: 100 },
    stroke: 5,
    paths: ['M12 10 V88 H92', 'M22 74 L42 54 L56 64 L84 30 L71 31 L84 30 L83 43'],
  },
  'speed-lines': {
    viewBox: { w: 100, h: 60 },
    stroke: 5,
    paths: ['M30 12 H92', 'M10 30 H80', 'M40 48 H88'],
  },
  'arrow-curve': {
    viewBox: { w: 100, h: 80 },
    stroke: 5,
    paths: ['M10 66 C30 10 70 6 88 40', 'M76 35 L88 40 L91 27'],
  },
  // A hand-drawn wave under a word.
  underline: {
    viewBox: { w: 100, h: 16 },
    stroke: 3,
    paths: ['M4 10 C24 4 40 14 60 8 S88 6 96 9'],
  },
  // A loose ring that overshoots its start, like a marker circling a word.
  'circle-mark': {
    viewBox: { w: 100, h: 70 },
    stroke: 4,
    paths: ['M78 12 C60 2 14 6 8 34 C4 58 44 68 74 60 C98 52 98 22 70 10 L62 8'],
  },
  bracket: {
    viewBox: { w: 40, h: 100 },
    stroke: 3,
    paths: ['M30 6 C16 6 20 20 20 34 C20 44 14 50 6 50 C14 50 20 56 20 66 C20 80 16 94 30 94'],
  },
}
