import { easeOutExpo } from '../../core/ease'
import {
  flashProgress,
  makeParticles,
  PARTICLE_WORD,
  particleAlpha,
  particleAt,
  particleStep,
  particleWordParams,
  type Particle,
  type ParticleWordParams,
} from '../../core/params/particle-word'
import { resolvedWorld, sceneCanvas } from '../canvas'
import type { MorphObjectExports } from './morph-object'
import type { BuildCtx, Primitive, SceneInfo } from './registry'

/** Canvas bleed (px): particles and the flash near the frame edge stay whole under camera motion. */
const BLEED = 64

/** Alpha (0..255) at which a pixel of the drawn word counts as ink. */
const INK_ALPHA = 128

/** Jitter of a grid sample (± share of the step), so the cloud has no visible rows. */
const GRID_JITTER = 0.36

type Pt = { x: number; y: number }

/**
 * The silhouette of `word` (a DOM element of another scene) as seeded sample points, in frame px
 * of that scene's layer. Each text run is drawn with `fillText` in the run's own computed font
 * (style, weight, size, family) at its measured place: left edge and baseline from the run's
 * Range rect, scaled to the rect, so the cloud lands on the real glyphs, dots and all. The ink
 * area sets the grid step (`particleStep`).
 */
function sampleWord(ctx: BuildCtx, word: HTMLElement, layer: HTMLElement, count: number | undefined): { targets: Pt[]; step: number } {
  const L = layer.getBoundingClientRect()
  const k = L.width > 0 ? L.width / ctx.size.w : 1
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) throw new Error('canvas 2D context unavailable')
  const runs: { text: string; font: string; x: number; base: number; scale: number; px: number; left: number; right: number; top: number; bottom: number }[] = []
  const walker = document.createTreeWalker(word, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? ''
    if (!text.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    const r = range.getBoundingClientRect()
    if (!(r.width > 0) || !(r.height > 0)) continue
    const cs = getComputedStyle(n.parentElement!)
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    probe.font = font
    probe.direction = 'rtl'
    const m = probe.measureText(text)
    const fh = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent
    // Client px per CSS px of the run, then layer px per CSS px.
    const scale = (fh > 0 ? r.height / fh : 1) / k
    const left = (r.left - L.left) / k
    const width = r.width / k
    runs.push({
      text,
      font,
      x: left + (width - m.width * scale) / 2,
      base: (r.top - L.top) / k + m.fontBoundingBoxAscent * scale,
      scale,
      px: parseFloat(cs.fontSize) * scale,
      left,
      right: left + width,
      top: (r.top - L.top) / k,
      bottom: (r.bottom - L.top) / k,
    })
  }
  if (runs.length === 0) return { targets: [], step: 1 }
  // The drawn region: the runs' boxes plus room for glyph overhang.
  const pad = Math.ceil(0.3 * Math.max(...runs.map((u) => u.px)))
  const x0 = Math.floor(Math.min(...runs.map((u) => u.left)) - pad)
  const y0 = Math.floor(Math.min(...runs.map((u) => u.top)) - pad)
  const w = Math.ceil(Math.max(...runs.map((u) => u.right)) + pad) - x0
  const h = Math.ceil(Math.max(...runs.map((u) => u.bottom)) + pad) - y0
  const off = document.createElement('canvas')
  off.width = Math.max(1, w)
  off.height = Math.max(1, h)
  const g = off.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('canvas 2D context unavailable')
  g.fillStyle = '#000000'
  g.textBaseline = 'alphabetic'
  g.textAlign = 'left'
  g.direction = 'rtl'
  for (const u of runs) {
    g.setTransform(u.scale, 0, 0, u.scale, u.x - x0, u.base - y0)
    g.font = u.font
    g.fillText(u.text, 0, 0)
  }
  const data = g.getImageData(0, 0, off.width, off.height).data
  const alphaAt = (x: number, y: number): number => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    if (xi < 0 || yi < 0 || xi >= off.width || yi >= off.height) return 0
    return data[(yi * off.width + xi) * 4 + 3]!
  }
  let area = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]! >= INK_ALPHA) area++
  const step = particleStep(area, count)
  const cap = Math.min(count ?? PARTICLE_WORD.maxCount, PARTICLE_WORD.maxCount)
  let targets: Pt[] = []
  for (let y = step / 2; y < off.height; y += step) {
    for (let x = step / 2; x < off.width; x += step) {
      const sx = x + (ctx.rng() * 2 - 1) * GRID_JITTER * step
      const sy = y + (ctx.rng() * 2 - 1) * GRID_JITTER * step
      if (alphaAt(sx, sy) >= INK_ALPHA) targets.push({ x: x0 + sx, y: y0 + sy })
    }
  }
  // The jitter can let a few more samples hit than the cap allows: keep an even subset.
  if (targets.length > cap) {
    const all = targets
    targets = Array.from({ length: cap }, (_, i) => all[Math.floor((i * all.length) / cap)]!)
  }
  return { targets, step }
}

/** An affine map (a point of another scene's layer → this layer), or undefined for the identity. */
function affineOf(info: SceneInfo | undefined, localT: number): ((pt: Pt) => Pt) | undefined {
  if (!info) return undefined
  const S = 1000
  const o = info.toThisSpace({ x: 0, y: 0 }, localT)
  const ex = info.toThisSpace({ x: S, y: 0 }, localT)
  const ey = info.toThisSpace({ x: 0, y: S }, localT)
  const a = (ex.x - o.x) / S
  const b = (ex.y - o.y) / S
  const c = (ey.x - o.x) / S
  const d = (ey.y - o.y) / S
  if (o.x === 0 && o.y === 0 && a === 1 && b === 0 && c === 0 && d === 1) return undefined
  return (pt) => ({ x: o.x + a * pt.x + c * pt.y, y: o.y + b * pt.x + d * pt.y })
}

/**
 * particle-word (Plan 3): at `burst` the hero bursts — a flash ring and thousands of accent
 * particles — and the particles gather into the silhouette of a DOM word (`target`, a kinetic-text
 * word shown from `land` on), dots included, then fade over `PARTICLE_WORD.fade` while the DOM word
 * enters (its own entrance, set by the recipe; this primitive never touches another scene's
 * elements). Targets are sampled once at build from the word drawn in its own computed font at its
 * measured box; each particle's position is a closed-form function of t (`particleAt`). Canvas
 * colours from `resolvedWorld(ctx.layer)` per frame. Decoration only: `aria-hidden`, no DOM text.
 */
export const particleWord: Primitive<ParticleWordParams> = {
  id: 'particle-word',
  params: particleWordParams,
  build(ctx, p) {
    const word = ctx.keyed(p.target, 'target')
    const wordLayer = word.closest<HTMLElement>('[data-mba-scene]') ?? ctx.layer
    const wordScene = wordLayer.dataset.mbaScene
    const { targets, step } = sampleWord(ctx, word, wordLayer, p.count)
    const particles: Particle[] = makeParticles(targets, ctx.rng, p, step)

    const surface = sceneCanvas(ctx, { bleed: BLEED })
    const { el, g } = surface
    el.dataset.mbaPart = 'particle-word'
    el.dataset.mbaParticles = String(particles.length)

    const S = Math.min(ctx.safe.w, ctx.safe.h)
    const dotR = PARTICLE_WORD.dot * ctx.safe.w
    const fromInfo = 'scene' in p.from ? ctx.sceneParams(p.from.scene) : undefined
    const wordInfo = wordScene !== undefined ? ctx.sceneParams(wordScene) : undefined

    /** The source at local t: the morph-object's object at `burst` (seen from this layer now), or the fixed point. */
    const source = (t: number): { x: number; y: number; r: number } => {
      if ('scene' in p.from) {
        const ex = fromInfo?.exports() as MorphObjectExports | undefined
        // The object as it was at the burst (or on its last frame, when its scene ends there).
        const lt = fromInfo?.localOf(p.burst) ?? fromInfo?.localOf(p.burst - 1 / ctx.fps)
        if (fromInfo && ex?.kind === 'morph-object' && lt !== undefined) {
          const a = ex.at(lt)
          const pt = fromInfo.toThisSpace({ x: a.x, y: a.y }, t)
          return { x: pt.x, y: pt.y, r: a.r }
        }
        return { x: ctx.safe.x + ctx.safe.w / 2, y: ctx.safe.y + ctx.safe.h / 2, r: dotR }
      }
      return { x: ctx.safe.x + p.from.x * ctx.safe.w, y: ctx.safe.y + p.from.y * ctx.safe.h, r: dotR }
    }

    const paint = (t: number) => {
      g.save()
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.clearRect(0, 0, el.width, el.height)
      g.restore()
      const alpha = particleAlpha(p, t)
      const flash = flashProgress(p, t)
      if (!(alpha > 0) && flash === undefined) return
      const { accent } = resolvedWorld(ctx.layer)
      const src = source(t)

      if (flash !== undefined) {
        const F = PARTICLE_WORD.flash
        g.save()
        g.strokeStyle = accent
        g.globalAlpha = 1 - flash
        g.lineWidth = F.width * (1 - flash) + 1
        g.beginPath()
        g.arc(src.x, src.y, src.r + F.reach * S * easeOutExpo(flash), 0, 2 * Math.PI)
        g.stroke()
        g.restore()
      }
      if (!(alpha > 0) || particles.length === 0) return

      // The word's layer may sit at another depth under the camera: its targets follow it.
      const map = affineOf(wordInfo, t)
      g.save()
      g.globalAlpha = alpha
      g.fillStyle = accent
      g.beginPath()
      for (const q of particles) {
        let qq = q
        if (map) {
          const m = map({ x: q.tx, y: q.ty })
          qq = { ...q, tx: m.x, ty: m.y }
        }
        const at = particleAt(qq, src, t, p, ctx.safe)
        if (!at) continue
        g.moveTo(at.x + at.r, at.y)
        g.arc(at.x, at.y, at.r, 0, 2 * Math.PI)
      }
      g.fill()
      g.restore()
    }

    return {
      update(localT) {
        paint(localT)
      },
    }
  },
}
