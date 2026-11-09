import { seg } from '../../core/ease'
import { BACKDROP, backdropParams, type BackdropParams } from '../../core/params/backdrop'
import { resolveWorld, worldOf } from '../../core/worlds'
import { applyLookVars } from '../looks'
import type { Primitive } from './registry'
import { buildPattern } from './backdrop-patterns'
import { heroAt, type HeroParams } from '../../core/params/hero'
import type { HeroExports } from './hero'
import { resolvedWorld, sceneCanvas } from '../canvas'
import { buildMaterialTextures, drawMaterial, MATERIAL, type MaterialGlow } from '../materials'

/**
 * Backdrop: a full-frame child filled with the world's background (CSS var `--mba-bg`) and, for
 * every tone but `base`, a soft radial glow (upper third); optionally a generative pattern in the
 * world's fg. While visible it writes the world's colours to the frame root on every update (the
 * last visible backdrop in storyboard order wins; the flip is instantaneous). After an optional
 * `fadeIn` (opacity 0 → 1) the picture is a pure function of local t.
 *
 * `react.hero` (Task 6, `dots`): while the named hero scene shows, the dots swell around the hero's
 * position (`heroAt` on that scene's params and its build-time resolved path, read through
 * `ctx.sceneParams`), mapped through the one-world camera into this layer (`toThisSpace`): a backdrop
 * on fixed track 0 swells where the hero shows ON SCREEN, pure in t (identity without a camera).
 *
 * `material` (Plan 3): the fill is a canvas instead (`sceneCanvas`, `MATERIAL.bleed` px of bleed)
 * repainted every update from the colours in force at this layer (`resolvedWorld(ctx.layer)`, read
 * after this backdrop wrote its world): bg, the tone's glow, paper, vignette, halftone, grain at
 * the local frame index `round(localT · fps)`. Its textures are built from `ctx.rng` AFTER the
 * pattern, so a pattern draws the same with or without a material.
 */
export const backdrop: Primitive<BackdropParams> = {
  id: 'backdrop',
  params: backdropParams,
  build(ctx, p) {
    const { vars } = ctx.look
    const glowColour = p.tone === 'warm' ? vars.accent : p.tone === 'cool' ? BACKDROP.cool : p.tone === 'deep' ? vars.fg : undefined
    const pct = Math.round(BACKDROP.glow * (p.tone === 'deep' ? 0.5 : 1) * 100)
    let fill: HTMLElement
    let surface: ReturnType<typeof sceneCanvas> | undefined
    if (p.material) {
      surface = sceneCanvas(ctx, { bleed: MATERIAL.bleed })
      fill = surface.el
      fill.dataset.mbaPart = 'backdrop-material'
    } else {
      fill = document.createElement('div')
      fill.dataset.mbaPart = 'backdrop'
      Object.assign(fill.style, {
        position: 'absolute',
        inset: '0',
        backgroundColor: vars.bg,
        backgroundImage: glowColour
          ? `radial-gradient(ellipse 85% 60% at 50% 32%, color-mix(in srgb, ${glowColour} ${pct}%, transparent), transparent 70%)`
          : 'none',
      })
      ctx.layer.append(fill)
    }
    const info = p.react && p.pattern === 'dots' ? ctx.sceneParams(p.react.hero) : undefined
    const hero = info
      ? (localT: number) => {
          const ht = info.localOf(localT)
          // Only a built hero scene exports its path (any other scene: no reaction).
          const ex = info.exports() as HeroExports | undefined
          if (ht === undefined || ex?.kind !== 'hero') return undefined
          // The hero's world point, mapped through the camera into this layer (fixed: the screen).
          return info.toThisSpace(heroAt(info.params as HeroParams, ex.points, ht, ex.end), localT)
        }
      : undefined
    const pattern = buildPattern(ctx, p, hero)
    if (pattern) ctx.layer.append(pattern.svg)
    const world = worldOf(ctx.look, resolveWorld(ctx.look, p.world))
    const material = p.material
    const textures = surface && material ? buildMaterialTextures(ctx.rng, ctx.size, surface.bleed, material.halftone) : undefined
    const paint = (localT: number) => {
      if (!surface || !material || !textures) return
      const c = resolvedWorld(ctx.layer)
      const glow: MaterialGlow | undefined =
        p.tone === 'base' ? undefined : { colour: p.tone === 'warm' ? c.accent : p.tone === 'cool' ? BACKDROP.cool : c.fg, alpha: pct / 100 }
      drawMaterial(surface.g, textures, ctx.size, surface.bleed, material, c, Math.round(localT * ctx.fps), glow)
    }
    return {
      update(localT) {
        // The root's colours are this world's while the backdrop shows (the stage resets them first).
        // A backdrop on a camera track sits in a world wrapper: the colours go on the frame above it.
        const parent = ctx.layer.parentElement
        const root = parent?.dataset.mbaWorld !== undefined ? parent.parentElement : parent
        if (root) applyLookVars(root, world)
        paint(localT)
        pattern?.update(localT)
        if (!(p.fadeIn > 0)) return
        const x = seg(localT, 0, p.fadeIn)
        const o = x >= 1 ? '' : x.toFixed(4)
        fill.style.opacity = o
        if (pattern) pattern.svg.style.opacity = o
      },
    }
  },
}
