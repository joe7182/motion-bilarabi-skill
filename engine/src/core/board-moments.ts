/**
 * The moments of the review board (`mba board`): one card per new thing on screen, with the words
 * said over it, so the person reviews the video as a list of moments and writes a note on any of them.
 * Pure: a storyboard's scenes and a transcript in, moments out.
 */

export interface BoardScene { id: string; type: string; track?: number; start: number; duration: number }
export interface BoardWord { text: string; start: number; end: number }
export interface Moment {
  /** 1-based, in time order. */
  n: number
  /** The moment's span (s) and the time of its still (late in the span, once things have arrived). */
  from: number
  to: number
  t: number
  /** What is said over it, and the scenes on screen at the still. */
  words: string
  scenes: { id: string; type: string }[]
}

/** Scenes that dress the whole video rather than make a moment. */
const GROUND = new Set(['backdrop', 'hue-field', 'tech-grid', 'geo-pattern', 'paper-shapes', 'frame-marks', 'chapter-bar', 'captions', 'object-frame', 'beat-pulse'])
const r2 = (x: number) => Math.round(x * 100) / 100

export function boardMoments(scenes: readonly BoardScene[], words: readonly BoardWord[], total: number, opts: { minGap?: number } = {}): Moment[] {
  const minGap = opts.minGap ?? 1.0
  const cand = scenes.filter((s) => !GROUND.has(s.type) && s.duration > 0.25 && s.duration < total * 0.8)
  const pool = cand.length ? cand : scenes.filter((s) => s.duration > 0.25)
  // boundaries: where a scene starts; starts closer than minGap merge into one moment
  const starts = [...new Set(pool.map((s) => r2(s.start)))].sort((a, b) => a - b)
  const bounds: number[] = []
  for (const s of [0, ...starts]) if (s < total - 0.3 && (bounds.length === 0 || s - bounds[bounds.length - 1]! >= minGap)) bounds.push(s)
  return bounds.map((from, i) => {
    const to = i + 1 < bounds.length ? bounds[i + 1]! : total
    const len = to - from
    const t = r2(Math.min(from + len * 0.75, to - 0.15, from + 3.5))
    const said = words.filter((w) => w.start >= from - 0.05 && w.start < to - 0.05).map((w) => w.text).join(' ')
    const on = pool.filter((s) => s.start <= t + 1e-6 && s.start + s.duration > t).map((s) => ({ id: s.id, type: s.type }))
    return { n: i + 1, from: r2(from), to: r2(to), t: Math.max(0, t), words: said, scenes: on }
  })
}

/** What the board saves: the notes the person wrote, or their approval. */
export interface BoardNotes {
  storyboard: string
  at: string
  approved: boolean
  general: string
  moments: (Pick<Moment, 'n' | 'from' | 'to' | 't' | 'words' | 'scenes'> & { note: string })[]
}
