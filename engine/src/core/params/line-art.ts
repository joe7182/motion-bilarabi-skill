import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { seg } from '../ease'

/** Our own self-drawing line art (paths in `runtime/icons/line-art.ts`). */
export const LINE_ART_NAMES = ['chart-up', 'speed-lines', 'arrow-curve', 'underline', 'circle-mark', 'bracket'] as const

export type LineArtName = (typeof LINE_ART_NAMES)[number]

/** A point in the safe area, 0..1 on each axis (0,0 = top-left). Not a time: anchors never apply. */
export const safePoint = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })

/** Params of `line-art`. */
export const lineArtParams = z.object({
  art: z.enum(LINE_ART_NAMES),
  /** Centre of the art in the safe area (default: its centre). */
  at: safePoint.optional(),
  /** Width as a fraction of the safe width. */
  size: z.number().min(0.2).max(1).default(0.6),
  /** Stroke colour (default: the look's accent). */
  color: z.string().min(1).optional(),
  /** Seconds each path takes to draw. */
  drawIn: z.number().positive().max(10).default(0.8),
  /** Seconds the finished art stays before it fades out (default: until the scene ends). */
  hold: z.number().min(0).optional(),
  /** Morph key (Task 8). */
  key: z.string().min(1).optional(),
})

export type LineArtParams = z.infer<typeof lineArtParams>

export const LINE_ART_TIMING = {
  /** Delay between consecutive paths (s). */
  stagger: 0.12,
  /** Fade-out after `hold` (s). */
  exit: 0.25,
} as const

/** GSAP `power2.out`. */
export const power2Out = (x: number): number => 1 - (1 - x) ** 2

/** Draw progress 0..1 of path `i` at local `t`: path i draws over [i·stagger, i·stagger + drawIn], power2.out. */
export function drawProgress(t: number, i: number, drawIn: number, stagger: number = LINE_ART_TIMING.stagger): number {
  const a = i * stagger
  return power2Out(seg(t, a, a + drawIn))
}

/** Local time the last of `paths` paths finishes drawing. */
export function drawEnd(paths: number, drawIn: number, stagger: number = LINE_ART_TIMING.stagger): number {
  return Math.max(0, paths - 1) * stagger + drawIn
}

/** Sound cue of `line-art`: one `action` as the first stroke starts. */
export function cuesOfLineArt(_p: LineArtParams, _ctx: { duration: number }): Cue[] {
  return [{ t: 0, kind: 'action' }]
}
