import { contrastRatio } from '../core/palette'
import { rng as makeRng } from '../core/rng'

/**
 * Printed-paper materials for canvas surfaces (Plan 3): a seeded paper texture, film grain, a
 * radial vignette and a halftone dot field. Every texture is generated once at build from a seeded
 * generator; the per-frame picture is a pure function of the frame index and the world's colours.
 * Sizes are in frame px for a 1080 px short side and scale with it (`k`).
 */
export const MATERIAL = {
  /** Canvas bleed on every side (px): camera motion and parallax never show an edge. */
  bleed: 64,
  paper: {
    /** The texture is generated at this share of the canvas resolution and drawn scaled up. */
    scale: 0.5,
    /** Value-noise lattice cell (frame px at k = 1). */
    cell: 38.5,
    /** Darkening from the low-frequency noise and from per-pixel noise (0..255 levels at full). */
    mottle: 14,
    speckle: 10,
    /** Fibres per texture px, their colour and width (texture px). */
    fibres: 420 / (540 * 960),
    fibreColour: 'rgba(120,95,60,0.10)',
    fibreWidth: 0.7,
  },
  grain: { tile: 256, tiles: 3, spread: 120 },
  vignette: {
    /** Centre at 0.47 of the frame height; clear inside r0, full at r1 (shares of the frame diagonal). */
    cy: 0.47,
    r0: 0.1725,
    r1: 0.567,
    /** Light worlds: a warm brown at 0.2 × strength; dark worlds: black at 0.8 × strength. */
    light: { rgb: [60, 35, 10] as const, alpha: 0.2 },
    dark: { rgb: [0, 0, 0] as const, alpha: 0.8 },
  },
  halftone: {
    /** Dot pitch, the largest radius, the reach from the corner (frame px at k = 1) and the alpha of the world's fg. */
    pitch: 22,
    radius: 7.5,
    reach: 900,
    minRadius: 0.4,
    /** The field's origin: this far in from the bottom-left corner (x right, y up). */
    corner: { x: 40, y: 20 },
    alpha: 0.06,
  },
} as const

export interface MaterialParams {
  paper: number
  grain: number
  vignette: number
  halftone: boolean
}

export interface MaterialTextures {
  paper: HTMLCanvasElement
  grain: HTMLCanvasElement[]
  halftone: Path2D | null
  /** Seed of the per-frame grain tile offset. */
  grainSeed: number
}

const TAU = Math.PI * 2

const canvasOf = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}
const ctx2d = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
  const g = c.getContext('2d')
  if (!g) throw new Error('canvas 2D context unavailable')
  return g
}
const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const smooth = (u: number) => u * u * (3 - 2 * u)

/** `#rrggbb` → `rgba(r,g,b,a)`. */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/**
 * Builds the textures for a `size` frame with `bleed` px on every side, drawing every random value
 * from `rnd` (the scene's seeded generator), in a fixed order: grain seed, grain tiles, paper.
 * The halftone path is only built when `halftone` is on.
 */
export function buildMaterialTextures(rnd: () => number, size: { w: number; h: number }, bleed: number, halftone: boolean): MaterialTextures {
  const k = Math.min(size.w, size.h) / 1080
  const W = size.w + 2 * bleed
  const H = size.h + 2 * bleed
  const grainSeed = Math.floor(rnd() * 4294967296) >>> 0

  const { tile, tiles, spread } = MATERIAL.grain
  const grain: HTMLCanvasElement[] = []
  for (let t = 0; t < tiles; t++) {
    const c = canvasOf(tile, tile)
    const x = ctx2d(c)
    const id = x.createImageData(tile, tile)
    for (let i = 0; i < tile * tile; i++) {
      const v = 128 + (rnd() - 0.5) * spread
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v
      id.data[i * 4 + 3] = 255
    }
    x.putImageData(id, 0, 0)
    grain.push(c)
  }

  // Paper: low-frequency value noise (a seeded lattice, smoothstep-interpolated) plus per-pixel
  // speckle, slightly warm (blue darkens most), then short curved fibres. Multiplied at draw.
  const P = MATERIAL.paper
  const pw = Math.ceil(W * P.scale)
  const ph = Math.ceil(H * P.scale)
  const paper = canvasOf(pw, ph)
  const px = ctx2d(paper)
  const id = px.createImageData(pw, ph)
  const gw = Math.max(2, Math.round(W / (P.cell * k)))
  const gh = Math.max(2, Math.round(H / (P.cell * k)))
  const lat: number[] = []
  for (let i = 0; i < (gw + 1) * (gh + 1); i++) lat.push(rnd())
  for (let y = 0; y < ph; y++) {
    const fy = (y / ph) * gh
    const iy = Math.min(gh - 1, Math.floor(fy))
    const uy = smooth(fy - iy)
    for (let x = 0; x < pw; x++) {
      const fx = (x / pw) * gw
      const ix = Math.min(gw - 1, Math.floor(fx))
      const ux = smooth(fx - ix)
      const a = lat[iy * (gw + 1) + ix]!
      const b = lat[iy * (gw + 1) + ix + 1]!
      const c = lat[(iy + 1) * (gw + 1) + ix]!
      const d = lat[(iy + 1) * (gw + 1) + ix + 1]!
      const n = lerp(lerp(a, b, ux), lerp(c, d, ux), uy)
      const v = 255 - n * P.mottle - rnd() * P.speckle
      const i = (y * pw + x) * 4
      id.data[i] = v
      id.data[i + 1] = v - 1
      id.data[i + 2] = v - 4
      id.data[i + 3] = 255
    }
  }
  px.putImageData(id, 0, 0)
  px.strokeStyle = P.fibreColour
  px.lineWidth = P.fibreWidth
  const fibres = Math.round(P.fibres * pw * ph)
  for (let f = 0; f < fibres; f++) {
    const x = rnd() * pw
    const y = rnd() * ph
    const a = rnd() * TAU
    const l = 4 + rnd() * 14
    px.beginPath()
    px.moveTo(x, y)
    px.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l)
    px.stroke()
  }

  return { paper, grain, halftone: halftone ? halftonePath(size, bleed, k) : null, grainSeed }
}

/** The halftone dots (staggered rows) over the frame and its bleed, shrinking with distance from the bottom-left corner. */
function halftonePath(size: { w: number; h: number }, bleed: number, k: number): Path2D {
  const T = MATERIAL.halftone
  const pitch = T.pitch * k
  const ox = T.corner.x * k
  const oy = size.h - T.corner.y * k
  const reach = T.reach * k
  const path = new Path2D()
  const j0 = Math.floor(-bleed / pitch)
  const j1 = Math.ceil((size.h + bleed) / pitch)
  const i0 = Math.floor(-bleed / pitch) - 1
  const i1 = Math.ceil((size.w + bleed) / pitch)
  for (let j = j0; j <= j1; j++) {
    const y = j * pitch
    const shift = ((j % 2) + 2) % 2 ? pitch / 2 : 0
    for (let i = i0; i <= i1; i++) {
      const x = i * pitch + shift
      const r = T.radius * k * Math.max(0, 1 - Math.hypot(x - ox, y - oy) / reach)
      if (r <= T.minRadius * k) continue
      path.moveTo(x + r, y)
      path.arc(x, y, r, 0, TAU)
    }
  }
  return path
}

/** A soft glow over the material (the backdrop's tone): radial, ellipse 85 % × 60 % of the frame at (50 %, 32 %), clear at 70 %. */
export interface MaterialGlow {
  colour: string
  alpha: number
}

/**
 * Paints one frame on `g` (its transform translated by `bleed`, frame coordinates): the world's bg
 * over the whole canvas, the glow, the paper texture (multiply at `m.paper`), the vignette, the
 * halftone field in the world's fg, then grain (soft-light at `m.grain`) from tile `frame % 3` at an
 * offset seeded by `frame`. Pure in (`frame`, `world`).
 */
export function drawMaterial(
  g: CanvasRenderingContext2D,
  tex: MaterialTextures,
  size: { w: number; h: number },
  bleed: number,
  m: MaterialParams,
  world: { bg: string; fg: string },
  frame: number,
  glow?: MaterialGlow,
): void {
  const { w, h } = size
  const x0 = -bleed
  const y0 = -bleed
  const W = w + 2 * bleed
  const H = h + 2 * bleed
  g.save()
  g.setTransform(1, 0, 0, 1, bleed, bleed)
  g.globalCompositeOperation = 'source-over'
  g.globalAlpha = 1
  g.fillStyle = world.bg
  g.fillRect(x0, y0, W, H)

  if (glow && glow.alpha > 0) {
    g.save()
    g.translate(w * 0.5, h * 0.32)
    g.scale(w * 0.85, h * 0.6)
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1)
    gr.addColorStop(0, rgba(glow.colour, glow.alpha))
    gr.addColorStop(0.7, rgba(glow.colour, 0))
    g.fillStyle = gr
    g.fillRect(-1, -1, 2, 2)
    g.restore()
  }

  if (m.paper > 0) {
    g.globalCompositeOperation = 'multiply'
    g.globalAlpha = m.paper
    g.drawImage(tex.paper, x0, y0, W, H)
  }

  if (m.vignette > 0) {
    const V = MATERIAL.vignette
    const light = contrastRatio(world.bg, '#000000') >= contrastRatio(world.bg, '#ffffff')
    const tone = light ? V.light : V.dark
    const diag = Math.hypot(w, h)
    const rgb = tone.rgb.join(',')
    const gr = g.createRadialGradient(w / 2, h * V.cy, V.r0 * diag, w / 2, h * V.cy, V.r1 * diag)
    gr.addColorStop(0, `rgba(${rgb},0)`)
    gr.addColorStop(1, `rgba(${rgb},${tone.alpha * m.vignette})`)
    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 1
    g.fillStyle = gr
    g.fillRect(x0, y0, W, H)
  }

  if (tex.halftone) {
    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = MATERIAL.halftone.alpha
    g.fillStyle = world.fg
    g.fill(tex.halftone)
  }

  if (m.grain > 0) {
    const { tile, tiles } = MATERIAL.grain
    const f = Math.round(frame)
    const r = makeRng((tex.grainSeed + Math.imul(f, 9973) + 17) >>> 0)
    const img = tex.grain[((f % tiles) + tiles) % tiles]!
    const ox = Math.floor(r() * tile)
    const oy = Math.floor(r() * tile)
    g.globalCompositeOperation = 'soft-light'
    g.globalAlpha = m.grain
    for (let y = y0 - oy; y < y0 + H; y += tile) for (let x = x0 - ox; x < x0 + W; x += tile) g.drawImage(img, x, y)
  }
  g.restore()
}
