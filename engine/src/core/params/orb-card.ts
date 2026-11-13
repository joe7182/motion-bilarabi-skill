import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * Params of `orb-card`: a glowing orb with app tiles — the chapter card of a list of tools, or a hub.
 * - `chapter`: a small label and a big number («كونكتور» ٠١ / ٠٥) over the orb; a `from` tile and a
 *   `to` tile slide in on either side and a light line joins them through the orb; the tool's name
 *   writes in below, heavy, in an accent-to-pink gradient.
 * - `hub`: one tile at the orb's centre and up to twelve satellite tiles on a ring around it; each
 *   joins the centre with a line as it arrives; an optional `count` («+١٠٠٠») under the ring.
 * A tile shows a logo (`image`, a project image) or, without one, a monogram (`mark`) on `colour`.
 */

const tile = z.object({
  /** A logo file (png/svg/jpg) in the project. */
  image: z.string().min(1).optional(),
  /** Without a logo: one or two characters drawn on the tile. */
  mark: z.string().min(1).max(3).optional(),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** A small caption under the tile. */
  label: z.string().max(16).optional(),
})
export type OrbTile = z.infer<typeof tile>

const at = z.number().min(0)

export const orbCardParams = z
  .object({
    mode: z.enum(['chapter', 'hub']).default('chapter'),
    // chapter
    label: z.string().max(24).optional(),
    number: z.number().int().min(0).max(99).optional(),
    total: z.number().int().min(1).max(99).optional(),
    from: tile.optional(),
    to: tile.optional(),
    name: z.string().max(28).optional(),
    nameAt: at.default(0.35),
    // hub
    centre: tile.optional(),
    satellites: z.array(tile.extend({ at: at.optional() })).max(12).default([]),
    count: z.string().max(12).optional(),
    countAt: at.optional(),
    /** Satellites start arriving here, one every `stagger` s. */
    at: at.default(0.15),
    stagger: z.number().min(0.03).max(1).default(0.12),
    /** Orb diameter (fraction of the safe width) and its vertical centre (safe fraction). */
    size: z.number().min(0.2).max(0.8).default(0.42),
    y: z.number().min(0.1).max(0.9).default(0.48),
  })
  .refine((p) => p.mode !== 'chapter' || (p.from && p.to), { path: ['from'], message: 'بطاقة الفصل تحتاج from و to — a chapter card needs a from tile and a to tile' })
  .refine((p) => p.mode !== 'hub' || p.centre, { path: ['centre'], message: 'المحور يحتاج centre — a hub needs a centre tile' })
export type OrbCardParams = z.infer<typeof orbCardParams>

export const ORB = {
  /** Tile size (fraction of the orb diameter) in each mode. */
  chapterTile: 0.5,
  hubTile: 0.36,
  satTile: 0.3,
  /** The ring the satellites sit on (radius / orb diameter). */
  ring: 1.02,
} as const

export const cuesOfOrbCard = (p: OrbCardParams): Cue[] => [{ t: 0, kind: 'whoosh' }, ...(p.mode === 'chapter' ? [{ t: p.nameAt, kind: 'tick' as const }] : [])]
