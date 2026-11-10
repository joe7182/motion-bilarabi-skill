import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { oneLineAr } from './common'

/**
 * The Laser pack — a dark, cinematic tech look.
 * - tech-grid: a charcoal world with a fine grid, soft drifting glows and a vignette (a background).
 * - laser-type: a big headline cut in by a laser: the cut edge glows hot orange, then cools to white,
 *   with sparks flying off where the beam meets the letters.
 * - laser-beam: beams that shoot across the frame (a hot head, a fading trail, a faint line left
 *   behind), optional glowing boxes they connect, a spark travelling a path, and red ✕ marks.
 * - glow-words: a sentence shown dim; each word lights up in the accent as it is said, then cools to
 *   white (key words stay lit).
 * - beat-slam: on each beat the frame flashes the accent colour with one giant word in ink.
 */

const at = z.number().min(0)
const frac = z.number().min(-0.2).max(1.2)
const point = z.object({ x: frac, y: frac })

export const techGridParams = z.object({
  /** Cell size as a fraction of the frame width. */
  cell: z.number().min(0.02).max(0.2).default(0.06),
  /** Soft glows drifting behind the grid. */
  glows: z.number().int().min(0).max(4).default(2),
  /** Tilt the grid into a floor (perspective). */
  floor: z.boolean().default(false),
})
export type TechGridParams = z.infer<typeof techGridParams>

export const laserTypeParams = z.object({
  /** One or two lines; a word in `accent` keeps the hot colour. */
  lines: z.array(oneLineAr(18, 'lines[]')).min(1).max(2),
  accent: z.array(z.string().min(1).max(18)).max(4).default([]),
  /** Local s the cut starts, and how long it takes per line. */
  at: at.default(0.15),
  cut: z.number().min(0.2).max(3).default(0.7),
  /** Vertical centre of the block, fraction of the safe height. */
  y: z.number().min(0).max(1).default(0.42),
  /** Largest font px at 1080 wide. */
  size: z.number().min(60).max(320).default(200),
})
export type LaserTypeParams = z.infer<typeof laserTypeParams>
export const LASER = { cool: 0.5, sparks: 70 } as const

export const laserBeamParams = z.object({
  beams: z
    .array(z.object({ from: point, to: point, at, dur: z.number().min(0.1).max(3).default(0.45), colour: z.enum(['accent', 'red', 'white']).default('accent'), keep: z.boolean().default(true) }))
    .max(10)
    .default([]),
  /** Glowing outlined boxes (diagram nodes), centred at their point, from `at`. */
  boxes: z.array(z.object({ label: z.string().min(1).max(20), sub: z.string().max(24).optional(), x: frac, y: frac, from: at.default(0) })).max(6).default([]),
  /** Red ✕ marks. */
  marks: z.array(z.object({ x: frac, y: frac, at })).max(6).default([]),
  /** A crosshair (guide lines across the frame) through a point. */
  crosshair: z.object({ x: frac, y: frac, at }).optional(),
})
export type LaserBeamParams = z.infer<typeof laserBeamParams>

export const glowWordsParams = z.object({
  words: z.array(z.object({ text: z.string().min(1).max(18), at, key: z.boolean().default(false) })).min(1).max(16),
  /** Vertical centre, fraction of the safe height. */
  y: z.number().min(0).max(1).default(0.3),
  size: z.number().min(30).max(140).default(84),
})
export type GlowWordsParams = z.infer<typeof glowWordsParams>

export const beatSlamParams = z.object({
  /** One word per beat; each holds until the next. */
  words: z.array(z.object({ text: oneLineAr(14, 'words[].text'), at })).min(1).max(12),
  /** Flash colour: the accent (orange) or ink with an accent word. */
  flash: z.enum(['accent', 'ink']).default('accent'),
})
export type BeatSlamParams = z.infer<typeof beatSlamParams>

export const cuesOfLaserType = (p: LaserTypeParams): Cue[] => [{ t: p.at, kind: 'whoosh' }]
export const cuesOfLaserBeam = (p: LaserBeamParams): Cue[] => p.beams.map((b) => ({ t: b.at, kind: 'whoosh' as const }))
export const cuesOfGlowWords = (p: GlowWordsParams): Cue[] => p.words.filter((w) => w.key).map((w) => ({ t: w.at, kind: 'tick' as const }))
export const cuesOfBeatSlam = (p: BeatSlamParams): Cue[] => p.words.map((w) => ({ t: w.at, kind: 'impact' as const }))
export const cuesOfTechGrid = (): Cue[] => []
