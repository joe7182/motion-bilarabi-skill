import { contrastRatio } from './palette'
import { getLook } from '../runtime/looks'
import { BACKDROP_WORLDS, backdropParams, type BackdropWorld } from './params/backdrop'
import type { Storyboard } from './storyboard'

export type WorldColours = { bg: string; fg: string; accent: string }

export const WORLDS = BACKDROP_WORLDS

/** WCAG contrast every world's fg on bg must reach (normal text). */
export const WORLD_MIN_CONTRAST = 4.5

/**
 * The colours of `world` for a look's colours `c` (see `backdropParams.world`). `ink` swaps bg and
 * fg. `accent`: bg = the accent; fg = whichever of the look's bg / fg contrasts more with it, and
 * the accent becomes the other one.
 */
export function worldOf(c: WorldColours, world: BackdropWorld): WorldColours {
  if (world === 'ink') return { bg: c.fg, fg: c.bg, accent: c.accent }
  if (world === 'accent') {
    const bgWins = contrastRatio(c.bg, c.accent) >= contrastRatio(c.fg, c.accent)
    return { bg: c.accent, fg: bgWins ? c.bg : c.fg, accent: bgWins ? c.fg : c.bg }
  }
  return { bg: c.bg, fg: c.fg, accent: c.accent }
}

/**
 * The world actually shown: `accent` falls back to `ink` when even its best pair stays below
 * `WORLD_MIN_CONTRAST` for this look (`validateSceneParams` warns). Paper and ink always pass.
 */
export function resolveWorld(c: WorldColours, world: BackdropWorld): BackdropWorld {
  if (world !== 'accent') return world
  const w = worldOf(c, 'accent')
  return contrastRatio(w.fg, w.bg) >= WORLD_MIN_CONTRAST ? 'accent' : 'ink'
}

/**
 * Every colour set the frame can show: the look's own (paper) and one per other distinct backdrop
 * world of the storyboard, in the order paper, ink, accent. Blank-frame detection compares a flat
 * frame against each world's `bg`. The brand's primary colour is the accent of the look in every
 * world. The accent world's fg is the look's bg or fg, whichever contrasts more with the accent
 * (and it falls back to ink when neither reaches 4.5, see `resolveWorld`).
 */
export function worldColours(sb: Storyboard): WorldColours[] {
  const look = getLook(sb.look, sb.brand)
  const used = new Set<BackdropWorld>(['paper'])
  for (const sc of sb.scenes) {
    if (sc.type !== 'backdrop') continue
    const r = backdropParams.safeParse(sc.params ?? {})
    if (r.success) used.add(resolveWorld(look, r.data.world))
  }
  return WORLDS.filter((w) => used.has(w)).map((w) => worldOf(look, w))
}
