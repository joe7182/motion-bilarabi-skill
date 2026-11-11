import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * beat-pulse — the music made visible: on every beat a shockwave ring bursts from a point, speed
 * lines shoot out, and the frame's edges flash. Put it on a track above the content; pair it with
 * the camera's `pulses` (a zoom kick on the same beats) for a beat edit.
 */
export const BEAT_KINDS = ['ring', 'lines', 'edge'] as const

export const beatPulseParams = z.object({
  /** Local s of every beat (or use `bpm` + `count`). */
  at: z.array(z.number().min(0)).max(128).default([]),
  /** A steady grid instead: `count` beats at `bpm` from `from` (local s); `accent` every Nth beat hits harder. */
  bpm: z.number().min(40).max(220).optional(),
  from: z.number().min(0).default(0),
  count: z.number().int().min(1).max(128).optional(),
  accent: z.number().int().min(1).max(16).default(4),
  /** Where the ring and the lines start (frame fractions). */
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.45),
  kinds: z.array(z.enum(BEAT_KINDS)).min(1).default(['ring', 'lines', 'edge']),
  colour: z.enum(['accent', 'white']).default('accent'),
  /** Overall strength (0.2 subtle … 1.5 wild). */
  strength: z.number().min(0.1).max(2).default(1),
})
export type BeatPulseParams = z.infer<typeof beatPulseParams>

/** The beats of a pulse scene (local s, sorted) and whether each is an accent. */
export function beatTimes(p: Pick<BeatPulseParams, 'at' | 'bpm' | 'from' | 'count' | 'accent'>): { t: number; strong: boolean }[] {
  const out: { t: number; strong: boolean }[] = p.at.map((t, i) => ({ t, strong: i % p.accent === 0 }))
  if (p.bpm && p.count) for (let i = 0; i < p.count; i++) out.push({ t: p.from + (i * 60) / p.bpm, strong: i % p.accent === 0 })
  return out.sort((a, b) => a.t - b.t)
}

export const cuesOfBeatPulse = (p: BeatPulseParams): Cue[] => beatTimes(p).filter((b) => b.strong).map((b) => ({ t: b.t, kind: 'hit' as const }))
