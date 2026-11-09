/**
 * Canvas drawing of the house reel's cost-section objects (Stage 2, «شكد راح يكلفك»): the balance
 * scale whose pan of dinars outweighs a «؟», the grid of building materials that doubles per
 * floor, and the one free HTML file. Same contract as `objects-draw.ts`: every function draws
 * centred on the context's origin (the caller translates and squashes), is a pure function of its
 * arguments (`since`, `build`, `beats`, `seed`), reads colours as resolved hex values, draws the
 * body on `d.path` and gates its details on `build` / `detailAlpha`. The Iraqi dinar is paper: the
 * money here is bills (`drawBill`), never coins. Canvas text is decoration (the canvas is
 * `aria-hidden`). Our own drawing; no real product's logo.
 */
import type { Pt } from '../core/morph'
import { OBJECT_GEOMETRY } from '../core/objects'
import { easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../core/ease'
import { beatsOf, FILE, MATERIALS, SCALE, softSpring } from '../core/params/morph-object'
import { rgba } from './materials'
import { decoText, hash01, lum, mixHex, paperInk, partialLine, rrect, softShadow, type ObjectColours, type ObjectDraw } from './objects-draw'
import { drawBill, drawBrickBlock, NOTE_TOKENS } from './objects-draw-home'

const TAU = Math.PI * 2

/** A path through `pts` (closed unless `open`). */
function polyPath(pts: readonly Pt[], open = false): Path2D {
  const p = new Path2D()
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)))
  if (!open) p.closePath()
  return p
}

/** A soft elliptical contact shadow centred at (x, y), `rx` wide, in the world's shadow tone. */
function contact(g: CanvasRenderingContext2D, c: ObjectColours, x: number, y: number, rx: number, ry: number, a: number): void {
  if (!(a > 0) || !(rx > 0)) return
  const light = lum(c.bg) > 0.5
  const col = light ? c.fg : '#000000'
  g.save()
  g.translate(x, y)
  g.scale(1, ry / rx)
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx)
  gr.addColorStop(0, rgba(col, (light ? 0.26 : 0.55) * a))
  gr.addColorStop(0.55, rgba(col, (light ? 0.1 : 0.24) * a))
  gr.addColorStop(1, rgba(col, 0))
  g.fillStyle = gr
  g.beginPath()
  g.arc(0, 0, rx, 0, TAU)
  g.fill()
  g.restore()
}

/**
 * Stage 2: the tight drop shadow of a card-like object (map tile, wall section, page, materials
 * card): `softShadow` from the world's fg on light worlds, black on dark ones, close under it.
 * (Tighter than `liftShadowPath`, whose wide halo read as stacked rectangles on these cards.)
 */
export function cardShadow(g: CanvasRenderingContext2D, c: ObjectColours, s: number, a: number, path: Path2D): void {
  if (!(a > 0) || !(s > 0)) return
  const light = lum(c.bg) > 0.5
  softShadow(g, path, light ? c.fg : '#000000', (light ? 0.13 : 0.35) * Math.min(1, a), s * 0.035, s * 0.018)
}

/** A damped spring response (0 → 1, overshooting) `t` s after its start: ζ `z`, ω `w`. */
function damped(t: number, z: number, w: number): number {
  if (!(t > 0)) return 0
  const wd = w * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t))
}

// ------------------------------------------------------------------ scale

/** The scale's brass (its own colours in every world). */
export const BRASS = { hi: '#FFF0BE', light: '#EBC86E', mid: '#C99A3B', dark: '#8A6420', edge: '#5C4115' } as const

/**
 * Scale layout (units of the size; the box is 1.2 × 1): the bills' bundle (`bill` wide, `bills`
 * thick) on the right pan, the price tag hanging under the pan on a string (`tag`: centre below the
 * rim, w × h, turn in degrees), the «؟» card on the left pan, the pointer dial on the post.
 */
export const SCALE_LAYOUT = {
  bill: 0.3,
  bills: 6,
  sheet: 0.014,
  tag: { dy: 0.25, dx: 0.02, w: 0.4, h: 0.115, deg: -5 },
  card: { w: 0.2, h: 0.25 },
  dial: { y: -0.3, r: 0.085 },
  price: '٩٥٬٠٠٠٬٠٠٠ د.ع',
} as const

/** A brass bar from (x0, y) to (x1, y), `t` thick, lit from above (in the current transform). */
function brassBar(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, t: number): void {
  const gr = g.createLinearGradient(0, y - t / 2, 0, y + t / 2)
  gr.addColorStop(0, BRASS.hi)
  gr.addColorStop(0.35, BRASS.light)
  gr.addColorStop(1, BRASS.dark)
  g.fillStyle = gr
  const p = new Path2D()
  rrect(p, x0, y - t / 2, x1 - x0, t, t / 2)
  g.fill(p)
  g.strokeStyle = rgba(BRASS.edge, 0.55)
  g.lineWidth = Math.max(1, t * 0.08)
  g.stroke(p)
}

/** A brass ball of radius r at (x, y). */
function brassBall(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r)
  gr.addColorStop(0, BRASS.hi)
  gr.addColorStop(0.45, BRASS.light)
  gr.addColorStop(1, BRASS.dark)
  g.fillStyle = gr
  g.beginPath()
  g.arc(x, y, r, 0, TAU)
  g.fill()
  g.strokeStyle = rgba(BRASS.edge, 0.5)
  g.lineWidth = Math.max(1, r * 0.12)
  g.stroke()
}

/** A pan (shallow bowl) hanging with its rim centre at (x, y), half-width r, depth dp; `inside` draws before the front lip. */
function pan(g: CanvasRenderingContext2D, x: number, y: number, r: number, dp: number, s: number, inside: () => void): void {
  const ry = 0.022 * s
  const bowl = new Path2D()
  bowl.moveTo(x - r, y)
  for (let i = 0; i <= 24; i++) {
    const u = -1 + (2 * i) / 24
    bowl.lineTo(x + r * u, y + dp * (1 - u * u) ** 0.8)
  }
  bowl.closePath()
  const gr = g.createLinearGradient(x - r, 0, x + r, 0)
  gr.addColorStop(0, BRASS.mid)
  gr.addColorStop(0.32, BRASS.hi)
  gr.addColorStop(0.6, BRASS.light)
  gr.addColorStop(1, BRASS.dark)
  g.fillStyle = gr
  g.fill(bowl)
  g.strokeStyle = rgba(BRASS.edge, 0.6)
  g.lineWidth = Math.max(1, 0.004 * s)
  g.stroke(bowl)
  // the inside of the bowl seen just from above: a dark ellipse, its back rim lit
  g.fillStyle = mixHex(BRASS.dark, BRASS.mid, 0.4)
  g.beginPath()
  g.ellipse(x, y, r, ry, 0, 0, TAU)
  g.fill()
  g.strokeStyle = BRASS.light
  g.lineWidth = Math.max(1, 0.006 * s)
  g.beginPath()
  g.ellipse(x, y, r, ry, 0, Math.PI, TAU)
  g.stroke()
  inside()
  // the front lip over the contents' feet
  g.strokeStyle = BRASS.hi
  g.lineWidth = Math.max(1.2, 0.008 * s)
  g.beginPath()
  g.ellipse(x, y, r, ry, 0, 0, Math.PI)
  g.stroke()
}

/** A bundle of bills lying on a pan (seen a little from above) with its paper band, bottom-centre at (0, 0). */
function billBundle(g: CanvasRenderingContext2D, s: number, font: string, seed: number): void {
  const L = SCALE_LAYOUT
  const w = L.bill * s
  const hw = w / 2
  const n = L.bills
  const th = L.sheet * s
  const T = NOTE_TOKENS
  const depth = 0.42 * (OBJECT_GEOMETRY.banknote.h / OBJECT_GEOMETRY.banknote.w) * w
  // the stack's front edge: one thin sheet per bill, alternating light and shaded paper
  for (let i = 0; i < n; i++) {
    const y = -(i + 1) * th
    const jx = (hash01(seed, 900 + i) - 0.5) * 0.012 * s
    g.fillStyle = i % 2 ? mixHex(T.paper, T.ink, 0.18) : mixHex(T.paper, T.tint, 0.5)
    g.fillRect(-hw + jx, y, w, th * 0.92)
    g.fillStyle = rgba(T.ink, 0.35)
    g.fillRect(-hw + jx, y + th * 0.82, w, Math.max(0.6, th * 0.12))
  }
  // the top bill, foreshortened
  g.save()
  g.translate((hash01(seed, 950) - 0.5) * 0.01 * s, -n * th - depth / 2)
  g.scale(1, 0.42)
  drawBill(g, w, font)
  g.restore()
  // the band round the middle: over the top face and down the front
  const bw = 0.07 * s
  g.fillStyle = '#F3EEE0'
  g.fillRect(-bw / 2, -n * th - depth, bw, depth + n * th)
  g.strokeStyle = rgba(T.ink, 0.35)
  g.lineWidth = Math.max(0.8, 0.003 * s)
  g.strokeRect(-bw / 2, -n * th - depth, bw, depth + n * th)
  g.fillStyle = rgba(T.gold, 0.9)
  g.fillRect(-bw / 2, -n * th - depth * 0.62, bw, Math.max(1, 0.006 * s))
}

/**
 * Scale (Stage 2, «المقاول يگلك رقم… وما عندك رقم تقارنه بيه»): a brass balance scale in front
 * view, 1.2 × 1 × size — a stepped base, the post with its finial and a pointer dial, the beam and
 * two shallow pans on strings. Build (`OBJECT_BUILD_SEC` 0.6): the base and post rise, the beam
 * spreads from the pivot, the pans swing in; the silhouette's ghost gives way to the parts. At
 * beats[0] a bundle of dinars (bills: the Iraqi dinar is paper) drops onto the RIGHT pan with an
 * accent price tag (the state `text`) dangling under it; as it lands the beam tips toward it on a
 * damped swing (`SCALE`) and the left pan rises; at beats[1] a faint dashed «؟» card fades onto the
 * LEFT pan: nothing to weigh the price against.
 */
export function drawScale(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const geo = OBJECT_GEOMETRY.scale
  const L = SCALE_LAYOUT
  const b = d.build
  const beats = beatsOf(d.beats, SCALE.beats)
  const appear = easeOutCubic(seg(b, 0, 0.65))
  // the silhouette's ghost: the morph's body, fading as the parts come in (and back as it leaves)
  const ghost = Math.max(1 - appear, 1 - d.detailAlpha)
  if (ghost > 0) {
    g.fillStyle = rgba(mixHex(c.bg, BRASS.mid, 0.85), ghost)
    g.fill(d.path)
  }
  if (!(d.detailAlpha > 0) || !(b > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const S = (v: number) => v * s

  // the tilt: the bundle lands at beats[0] + dropSec and the beam swings toward it
  const land = beats[0]! + SCALE.dropSec
  const theta = ((SCALE.tiltDeg * Math.PI) / 180) * damped(d.since - land, SCALE.zeta, SCALE.omega)
  const thetaPrev = ((SCALE.tiltDeg * Math.PI) / 180) * damped(d.since - d.dt - land, SCALE.zeta, SCALE.omega)
  const omegaNow = (theta - thetaPrev) / Math.max(1e-3, d.dt)

  // base, post, finial (rising in)
  const kBase = easeOutCubic(seg(b, 0, 0.45))
  const B = geo.beam
  const pivot: Pt = [0, S(B.y + B.t / 2)]
  g.save()
  g.globalAlpha *= kBase
  g.translate(0, S(0.04 * (1 - kBase)))
  contact(g, c, 0, S(0.5), S(0.3), S(0.035), 1)
  const base = polyPath([[S(-geo.base.top), S(geo.base.y)], [S(geo.base.top), S(geo.base.y)], [S(geo.base.bottom), S(0.47)], [S(-geo.base.bottom), S(0.47)]])
  const bg = g.createLinearGradient(S(-geo.base.bottom), 0, S(geo.base.bottom), 0)
  bg.addColorStop(0, BRASS.mid)
  bg.addColorStop(0.35, BRASS.hi)
  bg.addColorStop(0.7, BRASS.light)
  bg.addColorStop(1, BRASS.dark)
  g.fillStyle = bg
  g.fill(base)
  g.strokeStyle = rgba(BRASS.edge, 0.55)
  g.lineWidth = Math.max(1, S(0.004))
  g.stroke(base)
  brassBar(g, S(-geo.base.bottom - 0.01), S(geo.base.bottom + 0.01), S(0.485), S(0.03))
  // the post: a lit cylinder
  const pg = g.createLinearGradient(S(-geo.post), 0, S(geo.post), 0)
  pg.addColorStop(0, BRASS.dark)
  pg.addColorStop(0.35, BRASS.hi)
  pg.addColorStop(1, BRASS.mid)
  g.fillStyle = pg
  g.fillRect(S(-geo.post), pivot[1], S(2 * geo.post), S(geo.base.y) - pivot[1])
  brassBar(g, S(-0.045), S(0.045), S(geo.base.y - 0.008), S(0.022))
  // the pointer dial on the post, just under the pivot
  const Dl = L.dial
  g.fillStyle = mixHex(BRASS.hi, '#ffffff', 0.35)
  g.beginPath()
  g.moveTo(0, S(Dl.y + 0.02))
  g.arc(0, S(Dl.y + 0.02), S(Dl.r), Math.PI * 0.25, Math.PI * 0.75)
  g.closePath()
  g.fill()
  g.strokeStyle = rgba(BRASS.edge, 0.7)
  g.lineWidth = Math.max(1, S(0.003))
  g.stroke()
  for (let i = -3; i <= 3; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 16
    g.beginPath()
    g.moveTo(Math.cos(a) * S(Dl.r * 0.78), S(Dl.y + 0.02) + Math.sin(a) * S(Dl.r * 0.78))
    g.lineTo(Math.cos(a) * S(Dl.r * (i === 0 ? 0.55 : 0.66)), S(Dl.y + 0.02) + Math.sin(a) * S(Dl.r * (i === 0 ? 0.55 : 0.66)))
    g.stroke()
  }
  // the finial: a small spire on a collar above the pivot
  const fy0 = S(B.y - 0.004)
  const spire = new Path2D()
  spire.moveTo(S(-0.03), fy0)
  spire.quadraticCurveTo(S(-0.032), S(-0.47), 0, S(-0.5))
  spire.quadraticCurveTo(S(0.032), S(-0.47), S(0.03), fy0)
  spire.closePath()
  const sg = g.createLinearGradient(S(-0.03), 0, S(0.03), 0)
  sg.addColorStop(0, BRASS.dark)
  sg.addColorStop(0.4, BRASS.hi)
  sg.addColorStop(1, BRASS.mid)
  g.fillStyle = sg
  g.fill(spire)
  g.strokeStyle = rgba(BRASS.edge, 0.55)
  g.lineWidth = Math.max(1, S(0.003))
  g.stroke(spire)
  g.restore()

  // the beam (spreading from the pivot) with the pointer, end caps and hooks; tilted by theta
  const kBeam = easeOutCubic(seg(b, 0.2, 0.6))
  const hang = (side: 1 | -1): Pt => [pivot[0] + Math.cos(theta) * S(geo.hang) * side * kBeam, pivot[1] + Math.sin(theta) * S(geo.hang) * side * kBeam]
  // the pans (swinging in), hanging straight down from the hooks
  const kPan = easeOutCubic(seg(b, 0.3, 0.72))
  const strLen = S(geo.pan.y - (B.y + B.t / 2))
  const swing = (side: 1 | -1) => -0.12 * (1 - kPan) * side - 0.012 * omegaNow
  const drop = easeInCubic(seg(d.since, beats[0]!, land))
  const landed = d.since >= land
  const squash = landed ? 1 - 0.1 * Math.exp(-14 * (d.since - land)) * Math.cos(26 * (d.since - land)) : 1
  const card = easeOutCubic(seg(d.since, beats[1]!, beats[1]! + SCALE.cardSec))
  for (const side of [-1, 1] as const) {
    if (!(kPan > 0)) break
    const H = hang(side)
    const a = swing(side)
    g.save()
    g.translate(H[0], H[1])
    g.rotate(a)
    g.globalAlpha *= kPan
    const rim: Pt = [0, strLen * (0.6 + 0.4 * kPan)]
    const r = S(geo.pan.r)
    // three strings from the hook to the rim
    g.strokeStyle = rgba(BRASS.edge, 0.85)
    g.lineWidth = Math.max(1, S(0.0035))
    g.beginPath()
    for (const u of [-1, 0, 1]) {
      g.moveTo(0, 0)
      g.lineTo(rim[0] + u * r * 0.97, rim[1] - (u === 0 ? S(0.02) : 0))
    }
    g.stroke()
    pan(g, rim[0], rim[1], r, S(geo.pan.d), s, () => {
      if (side === 1 && d.since >= beats[0]! && kPan >= 1) {
        // the bundle drops in from above and settles with a small squash; the tag dangles below
        g.save()
        g.translate(rim[0], rim[1] - S(0.5) * (1 - drop))
        g.globalAlpha *= seg(d.since, beats[0]!, beats[0]! + 0.06)
        g.scale(2 - squash, squash)
        billBundle(g, s, d.font, d.seed)
        g.restore()
      }
      if (side === -1 && card > 0) {
        // a faint dashed card with «؟»: no number to compare
        const C = L.card
        g.save()
        g.translate(rim[0], rim[1] - S(0.05) * (1 - card))
        g.globalAlpha *= card * 0.75
        const p = new Path2D()
        rrect(p, S(-C.w / 2), S(-C.h) - S(0.004), S(C.w), S(C.h), S(0.02))
        g.fillStyle = mixHex(c.bg, c.fg, 0.06)
        g.fill(p)
        g.setLineDash([S(0.018), S(0.012)])
        g.strokeStyle = rgba(c.fg, 0.6)
        g.lineWidth = Math.max(1, S(0.005))
        g.stroke(p)
        g.setLineDash([])
        g.fillStyle = rgba(c.fg, 0.6)
        decoText(g, '؟', 0, S(-C.h / 2), S(0.17), S(C.w * 0.8), d.font, 800, 'rtl', 'center')
        g.restore()
      }
    })
    if (side === 1 && d.since >= beats[0]! && kPan >= 1) {
      // the price tag: an accent card on a string from the bundle's band, over the front lip
      const T = L.tag
      const tagIn = seg(d.since, beats[0]!, beats[0]! + 0.08)
      const tx = rim[0] + S(T.dx)
      const ty = rim[1] + S(T.dy) - S(0.5) * (1 - drop)
      const turn = ((T.deg * Math.PI) / 180) + 0.03 * omegaNow
      g.save()
      g.globalAlpha *= tagIn
      g.strokeStyle = rgba(c.fg, 0.75)
      g.lineWidth = Math.max(1, S(0.003))
      g.beginPath()
      g.moveTo(rim[0], rim[1] - S(0.03) - S(0.5) * (1 - drop))
      g.quadraticCurveTo(rim[0] + S(0.01), rim[1] + S(0.06) - S(0.5) * (1 - drop), tx, ty - S(T.h / 2))
      g.stroke()
      g.translate(tx, ty)
      g.rotate(turn)
      const p = new Path2D()
      // a tag: rounded card with a notched top and a punched hole
      rrect(p, S(-T.w / 2), S(-T.h / 2), S(T.w), S(T.h), S(0.022))
      softShadow(g, p, '#000000', 0.25, S(0.02), S(0.008))
      g.fillStyle = c.accent
      g.fill(p)
      g.fillStyle = mixHex(c.accent, '#ffffff', 0.7)
      g.beginPath()
      g.arc(0, S(-T.h / 2 + 0.02), S(0.009), 0, TAU)
      g.fill()
      g.fillStyle = lum(c.accent) > 0.6 ? '#1a1a1a' : '#ffffff'
      decoText(g, d.text ?? L.price, 0, S(0.012), S(0.062), S(T.w - 0.05), d.font, 800, 'rtl', 'center')
      g.restore()
    }
    g.restore()
  }

  // the beam on top of the strings
  if (kBeam > 0) {
    g.save()
    g.translate(pivot[0], pivot[1])
    g.rotate(theta)
    const half = S(B.x) * kBeam
    // tapered: thicker at the pivot
    const t0 = S(B.t * 1.25), t1 = S(B.t * 0.75)
    const beam = new Path2D()
    beam.moveTo(-half, -t1 / 2)
    beam.quadraticCurveTo(0, -t0 / 2 - S(0.006), half, -t1 / 2)
    beam.lineTo(half, t1 / 2)
    beam.quadraticCurveTo(0, t0 / 2, -half, t1 / 2)
    beam.closePath()
    const bgr = g.createLinearGradient(0, -t0 / 2, 0, t0 / 2)
    bgr.addColorStop(0, BRASS.hi)
    bgr.addColorStop(0.4, BRASS.light)
    bgr.addColorStop(1, BRASS.dark)
    g.fillStyle = bgr
    g.fill(beam)
    g.strokeStyle = rgba(BRASS.edge, 0.6)
    g.lineWidth = Math.max(1, S(0.003))
    g.stroke(beam)
    // the pointer: down from the pivot over the dial
    g.strokeStyle = BRASS.edge
    g.lineWidth = Math.max(1.2, S(0.007))
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(0, S(Math.abs(L.dial.y + 0.02 - (B.y + B.t / 2)) + L.dial.r * 0.78))
    g.stroke()
    brassBall(g, -half, 0, S(0.022) * kBeam)
    brassBall(g, half, 0, S(0.022) * kBeam)
    for (const side of [-1, 1]) {
      g.strokeStyle = BRASS.edge
      g.lineWidth = Math.max(1, S(0.005))
      g.beginPath()
      g.arc(side * S(geo.hang) * kBeam, S(0.012), S(0.012), 0, TAU)
      g.stroke()
    }
    g.restore()
    brassBall(g, pivot[0], pivot[1], S(0.028))
  }
  g.restore()
}

// ------------------------------------------------------------------ materials

/** The cement sack's own colours: paper, its shading, the printed band and its ink. */
export const BAG_TOKENS = { paper: '#ECE6D8', shade: '#BDB4A2', fold: '#D6CDBA', band: '#2D5B8C', ink: '#FFFFFF', stitch: '#8C8270' } as const
/** Sand and gravel colours. */
export const SAND_TOKENS = { light: '#EED29D', mid: '#D9B271', dark: '#B48848', grain: '#8E6A35' } as const
export const GRAVEL_TONES = ['#8E8B84', '#A9A59C', '#77746D', '#BDB8AE', '#9C978C'] as const

/**
 * A paper cement sack `w` × `h` px standing on (0, 0) (bottom-centre), front view: a pillow with
 * bulging sides, its folded and stitched top, the printed band with «50kg», shading for the bulge.
 */
export function drawCementBag(g: CanvasRenderingContext2D, w: number, h: number, font: string, seed: number): void {
  if (!(w > 1)) return
  const T = BAG_TOKENS
  const hw = w / 2
  const top = -h
  const p = new Path2D()
  p.moveTo(-hw * 0.9, top + h * 0.05)
  p.quadraticCurveTo(0, top + h * 0.11, hw * 0.9, top + h * 0.05)
  p.bezierCurveTo(hw * 1.06, top + h * 0.35, hw * 1.08, -h * 0.25, hw * 0.94, -h * 0.03)
  p.quadraticCurveTo(0, h * 0.02, -hw * 0.94, -h * 0.03)
  p.bezierCurveTo(-hw * 1.08, -h * 0.25, -hw * 1.06, top + h * 0.35, -hw * 0.9, top + h * 0.05)
  p.closePath()
  const gr = g.createLinearGradient(-hw, 0, hw, 0)
  gr.addColorStop(0, T.shade)
  gr.addColorStop(0.3, mixHex(T.paper, '#ffffff', 0.4))
  gr.addColorStop(0.65, T.paper)
  gr.addColorStop(1, T.shade)
  g.save()
  g.fillStyle = gr
  g.fill(p)
  g.clip(p)
  // the printed band, bowed with the sack
  const by0 = top + h * 0.42
  const by1 = top + h * 0.7
  const band = new Path2D()
  band.moveTo(-hw * 1.2, by0)
  band.quadraticCurveTo(0, by0 + h * 0.04, hw * 1.2, by0)
  band.lineTo(hw * 1.2, by1)
  band.quadraticCurveTo(0, by1 + h * 0.04, -hw * 1.2, by1)
  band.closePath()
  g.fillStyle = T.band
  g.fill(band)
  g.fillStyle = rgba('#ffffff', 0.12)
  g.fillRect(-hw * 1.2, by0, w * 1.2, h * 0.05)
  if (w > 22) {
    g.fillStyle = T.ink
    decoText(g, '50kg', 0, (by0 + by1) / 2 + h * 0.025, h * 0.15, w * 0.7, font, 800, 'ltr', 'center')
  }
  // the folded top: a darker strip with the stitch line
  g.fillStyle = T.fold
  g.fillRect(-hw * 1.2, top, w * 1.2, h * 0.16)
  g.strokeStyle = rgba(T.stitch, 0.9)
  g.lineWidth = Math.max(0.6, h * 0.012)
  g.setLineDash([Math.max(1, w * 0.035), Math.max(1, w * 0.025)])
  g.beginPath()
  g.moveTo(-hw, top + h * 0.12)
  g.quadraticCurveTo(0, top + h * 0.15, hw, top + h * 0.12)
  g.stroke()
  g.setLineDash([])
  // a vertical shading for the bulge and a soft crease
  const vg = g.createLinearGradient(0, top, 0, 0)
  vg.addColorStop(0, rgba('#000000', 0))
  vg.addColorStop(1, rgba('#000000', 0.16))
  g.fillStyle = vg
  g.fillRect(-hw * 1.2, top, w * 1.2, h)
  g.strokeStyle = rgba(T.stitch, 0.35)
  g.lineWidth = Math.max(0.5, h * 0.008)
  g.beginPath()
  g.moveTo(-hw * 0.45 + (hash01(seed, 3) - 0.5) * w * 0.1, top + h * 0.2)
  g.quadraticCurveTo(-hw * 0.3, top + h * 0.55, -hw * 0.5, -h * 0.1)
  g.stroke()
  g.restore()
  g.strokeStyle = rgba(T.stitch, 0.8)
  g.lineWidth = Math.max(0.6, h * 0.012)
  g.stroke(p)
}

/** A brick stack icon `w` wide standing on (0, 0): two bricks below, one on top (running bond). */
function brickStack(g: CanvasRenderingContext2D, w: number, seed: number): void {
  const bw = 0.42 * w
  const bh = 0.2 * w
  const dx = 0.1 * w, dy = -0.075 * w
  const x0 = -0.47 * w
  drawBrickBlock(g, x0, -bh, bw, bh, dx, dy, seed + 1, { end: false })
  drawBrickBlock(g, x0 + bw, -bh, bw, bh, dx, dy, seed + 2)
  drawBrickBlock(g, x0 + bw / 2, -2 * bh, bw, bh, dx, dy, seed + 3)
}

/** The profile of a mound `w` wide and `h` tall at x (0 at the foot, h at the top). */
const mound = (x: number, w: number, h: number): number => {
  const u = Math.min(1, Math.abs(x) / (w / 2))
  return h * (1 - u * u) ** 1.35 * (1 + 0.12 * (1 - u))
}

/** A sand pile `w` wide on (0, 0): a soft mound, lit from the upper left, with grain speckle. */
function sandPile(g: CanvasRenderingContext2D, w: number, seed: number): void {
  const T = SAND_TOKENS
  const h = 0.4 * w
  const p = new Path2D()
  p.moveTo(-w / 2, 0)
  for (let i = 0; i <= 40; i++) {
    const x = -w / 2 + (i / 40) * w
    p.lineTo(x, -mound(x, w, h) / 1.12)
  }
  p.closePath()
  const gr = g.createLinearGradient(-w * 0.3, -h, w * 0.35, 0)
  gr.addColorStop(0, T.light)
  gr.addColorStop(0.55, T.mid)
  gr.addColorStop(1, T.dark)
  g.save()
  g.fillStyle = gr
  g.fill(p)
  g.clip(p)
  for (let i = 0; i < 120; i++) {
    const x = (hash01(seed, 300 + i) - 0.5) * w
    const y = -hash01(seed, 500 + i) * h
    const t = hash01(seed, 700 + i)
    g.fillStyle = t < 0.55 ? rgba(T.grain, 0.45) : rgba('#FFF4D8', 0.6)
    g.fillRect(x, y, Math.max(0.6, w * 0.008), Math.max(0.6, w * 0.008))
  }
  // a few ridges where the sand slid
  g.strokeStyle = rgba(T.dark, 0.35)
  g.lineWidth = Math.max(0.5, w * 0.007)
  for (let i = 0; i < 3; i++) {
    const x0 = (-0.18 + 0.16 * i) * w
    g.beginPath()
    g.moveTo(x0, -mound(x0, w, h) / 1.12 + w * 0.02)
    g.quadraticCurveTo(x0 + w * 0.07, -h * 0.25, x0 + w * 0.12, -w * 0.01)
    g.stroke()
  }
  g.restore()
}

/** A gravel pile `w` wide on (0, 0): seeded small rounded stones heaped into a mound. */
function gravelPile(g: CanvasRenderingContext2D, w: number, seed: number): void {
  const h = 0.38 * w
  const rs = 0.05 * w
  const rows = Math.floor(h / (rs * 1.15))
  let k = 0
  for (let r = rows; r >= 0; r--) {
    const y = -r * rs * 1.15 - rs * 0.6
    // the mound's half-width at this height
    let half = 0
    for (let x = 0; x < w / 2; x += 1) if (mound(x, w, h) / 1.12 > -y - rs * 0.4) half = x
    const n = Math.max(1, Math.round((2 * half) / (rs * 1.7)))
    for (let i = 0; i < n; i++) {
      k++
      const x = -half + ((i + 0.5) / n) * 2 * half + (hash01(seed, 40 + k) - 0.5) * rs * 0.6
      const yy = y + (hash01(seed, 80 + k) - 0.5) * rs * 0.4
      const rx = rs * (0.85 + 0.35 * hash01(seed, 120 + k))
      const ry = rx * (0.68 + 0.2 * hash01(seed, 160 + k))
      const tone = GRAVEL_TONES[Math.floor(hash01(seed, 200 + k) * GRAVEL_TONES.length)]!
      const rot = (hash01(seed, 240 + k) - 0.5) * 1.2
      g.save()
      g.translate(x, yy)
      g.rotate(rot)
      const sg = g.createRadialGradient(-rx * 0.3, -ry * 0.35, rx * 0.1, 0, 0, rx)
      sg.addColorStop(0, mixHex(tone, '#ffffff', 0.35))
      sg.addColorStop(0.6, tone)
      sg.addColorStop(1, mixHex(tone, '#2a2926', 0.4))
      g.fillStyle = sg
      g.beginPath()
      g.ellipse(0, 0, rx, ry, 0, 0, TAU)
      g.fill()
      g.strokeStyle = rgba('#2a2926', 0.35)
      g.lineWidth = Math.max(0.5, rx * 0.08)
      g.stroke()
      g.restore()
    }
  }
}

/**
 * Materials layout (units of the size; the card is 1.1 × 1): the 2 × 2 grid's cells (RTL: brick
 * top-right, cement top-left, sand bottom-right, gravel bottom-left), the icon width, the label
 * offset; the two floor rows («الأول» above, «الأرضي» below), their icons' x and scale.
 */
export const MATERIALS_LAYOUT = {
  cells: [[0.27, -0.25], [-0.27, -0.25], [0.27, 0.22], [-0.27, 0.22]],
  icon: 0.36,
  ground: 0.07,
  label: 0.15,
  labels: ['طابوق', 'سمنت', 'رمل', 'حصى'],
  floors: { y: [-0.04, 0.36], roof: -0.36, x: [0.19, -0.03, -0.24, -0.43], scale: 0.5, label: 0.4, names: ['الأول', 'الأرضي'] },
} as const

/** One material icon `w` wide standing on (0, 0). */
function materialIcon(g: CanvasRenderingContext2D, i: number, w: number, font: string, seed: number): void {
  if (i === 0) brickStack(g, w, seed)
  else if (i === 1) drawCementBag(g, w * 0.66, w * 0.62, font, seed)
  else if (i === 2) sandPile(g, w * 1.05, seed + 7)
  else gravelPile(g, w * 1.0, seed + 11)
}

/** An icon's drop-in at `tau` s after its beat: offset y (× the icon width), squash, alpha. */
function dropIn(tau: number): { y: number; sx: number; sy: number; a: number } {
  if (tau < 0) return { y: 0, sx: 1, sy: 1, a: 0 }
  const fall = MATERIALS.dropSec * 0.55
  const f = seg(tau, 0, fall)
  const y = -0.5 * (1 - f * f)
  const k = tau - fall
  const q = k > 0 ? Math.exp(-9 * k) * Math.cos(24 * k) : 0
  return { y: y - (k > 0 ? 0.05 * Math.max(0, Math.sin(Math.min(Math.PI, k * 14))) * Math.exp(-6 * k) : 0), sx: 1 + 0.1 * q, sy: 1 - 0.12 * q, a: seg(tau, 0, 0.08) }
}

/**
 * Materials (Stage 2, «طابوق، سمنت، رمل، حصى… لكل طابق»): a tidy 2 × 2 of building materials on a
 * soft card, 1.1 × 1 × size — a stack of bricks, a paper cement sack (folded top, printed band,
 * «50kg»), a sand pile with grain and a heap of gravel, each labelled. beats[0..3] each drops in
 * with a small bounce (RTL: the brick top-right first); at beats[4] («لكل طابق») the set slides
 * up into a compact upper-floor row («الأول») and a second set builds on the ground-floor row
 * below («الأرضي»), each row on its slab.
 */
export function drawMaterials(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const L = MATERIALS_LAYOUT
  const beats = beatsOf(d.beats, MATERIALS.beats)
  const light = lum(c.bg) > 0.5
  // the card
  cardShadow(g, c, s, d.alpha, d.path)
  g.fillStyle = mixHex(c.bg, c.fg, light ? 0.045 : 0.08)
  g.fill(d.path)
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha * easeOutCubic(d.build)
  g.strokeStyle = rgba(c.fg, 0.1)
  g.lineWidth = Math.max(1, 0.004 * s)
  g.stroke(d.path)
  const S = (v: number) => v * s
  const fk = easeInOutCubic(seg(d.since, beats[4]!, beats[4]! + MATERIALS.floorSec))
  const F = L.floors
  // the slabs of the two floors (drawn in with the split)
  if (fk > 0) {
    // a two-storey section: the roof and floor slabs spread in from the right, the columns rise
    const wv = S(1.0) * fk
    for (const y0 of [F.roof, F.y[0]!, F.y[1]!]) {
      g.fillStyle = rgba(c.fg, 0.26)
      g.fillRect(S(0.5) - wv, S(y0 + 0.012), wv, S(0.026))
    }
    g.fillStyle = rgba(c.fg, 0.16)
    for (const x0 of [0.47, -0.5]) {
      const hgt = (F.y[1]! - F.roof) * seg(fk, 0.3, 1)
      g.fillRect(S(x0), S(F.y[1]! + 0.012) - S(hgt), S(0.03), S(hgt))
    }
    g.save()
    g.globalAlpha *= seg(fk, 0.4, 1)
    for (let r = 0; r < 2; r++) {
      g.fillStyle = rgba(c.fg, 0.8)
      decoText(g, F.names[r]!, S(F.label), S(F.y[r]! - 0.08), S(0.065), S(0.17), d.font, 800, 'rtl', 'center')
    }
    g.restore()
  }
  // the first set: in its grid cell, then moving to the upper floor row
  for (let i = 0; i < 4; i++) {
    const dp = dropIn(d.since - beats[i]!)
    if (!(dp.a > 0)) continue
    const [gx, gy] = L.cells[i] as readonly [number, number]
    const x = gx + (F.x[i]! - gx) * fk
    const y = gy + L.ground + (F.y[0]! - gy - L.ground) * fk
    const sc = 1 + (F.scale - 1) * fk
    const w = S(L.icon * sc)
    g.save()
    g.globalAlpha *= dp.a
    contact(g, c, S(x), S(y), w * 0.55, w * 0.07, 1)
    g.translate(S(x), S(y) + dp.y * w)
    g.scale(dp.sx, dp.sy)
    materialIcon(g, i, w, d.font, d.seed + i * 31)
    g.restore()
    const la = 1 - seg(fk, 0, 0.35)
    if (la > 0) {
      g.save()
      g.globalAlpha *= dp.a * la
      g.fillStyle = rgba(c.fg, 0.85)
      decoText(g, L.labels[i]!, S(gx), S(gy + L.ground + 0.075), S(0.062), S(0.3), d.font, 800, 'rtl', 'center')
      g.restore()
    }
  }
  // the second set builds on the ground floor
  if (fk > 0) {
    for (let i = 0; i < 4; i++) {
      const dp = dropIn(d.since - (beats[4]! + MATERIALS.floorSec * 0.55 + i * MATERIALS.again))
      if (!(dp.a > 0)) continue
      const w = S(L.icon * F.scale)
      g.save()
      g.globalAlpha *= dp.a
      contact(g, c, S(F.x[i]!), S(F.y[1]!), w * 0.55, w * 0.07, 1)
      g.translate(S(F.x[i]!), S(F.y[1]!) + dp.y * w)
      g.scale(dp.sx, dp.sy)
      materialIcon(g, i, w, d.font, d.seed + 500 + i * 31)
      g.restore()
    }
  }
  g.restore()
}

// ------------------------------------------------------------------ file

/** The file's own colours: the «.html» badge and its text. */
export const FILE_TOKENS = { badge: '#1F3B5A', badgeInk: '#FFFFFF' } as const

/**
 * File layout (units of the size; the page is 0.8 × 1): the `</>` glyph, the code lines, the
 * «.html» badge (sticking out past the left edge), the name line under the page, the stamp (centre,
 * w × h, turn) and the three tiles (final centre, turn in degrees; side).
 */
export const FILE_LAYOUT = {
  glyph: { y: -0.24, w: 0.26, h: 0.13 },
  lines: [[-0.27, 0.27, -0.06], [-0.2, 0.27, 0.0], [-0.27, 0.12, 0.06]],
  badge: [-0.5, 0.15, 0.2, 0.33],
  name: 0.58,
  name0: 'مخطط-بيتك.html',
  stamp: { x: 0.0, y: -0.02, w: 0.62, h: 0.22, deg: -13 },
  tiles: [[-0.66, -0.12, -10], [0.6, -0.34, 9], [0.62, 0.24, -7]],
  tile: 0.27,
} as const

/** Tile glyphs (our own, abstract): 0 protractor and compass, 1 a wireframe cube, 2 a ruler and a pencil; drawn in a unit box ±0.5. */
function tileGlyph(g: CanvasRenderingContext2D, i: number, u: number, ink: string, accent: string): void {
  g.save()
  g.strokeStyle = ink
  g.fillStyle = ink
  g.lineWidth = Math.max(1, 0.045 * u)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (i === 0) {
    // protractor: a half disc with ticks; a compass standing over it
    g.beginPath()
    g.arc(0, 0.22 * u, 0.36 * u, Math.PI, TAU)
    g.closePath()
    g.stroke()
    g.lineWidth = Math.max(1, 0.025 * u)
    for (let k = 1; k < 9; k++) {
      const a = Math.PI + (k * Math.PI) / 9
      g.beginPath()
      g.moveTo(Math.cos(a) * 0.36 * u, 0.22 * u + Math.sin(a) * 0.36 * u)
      g.lineTo(Math.cos(a) * 0.28 * u, 0.22 * u + Math.sin(a) * 0.28 * u)
      g.stroke()
    }
    g.lineWidth = Math.max(1, 0.05 * u)
    g.beginPath()
    g.moveTo(-0.16 * u, 0.3 * u)
    g.lineTo(0, -0.34 * u)
    g.lineTo(0.18 * u, 0.3 * u)
    g.stroke()
    g.beginPath()
    g.arc(0, -0.36 * u, 0.05 * u, 0, TAU)
    g.fill()
  } else if (i === 1) {
    // an isometric wireframe cube, its top face tinted
    const a = 0.3 * u
    const top: Pt[] = [[0, -a * 1.15], [a, -a * 0.58], [0, 0], [-a, -a * 0.58]]
    g.fillStyle = rgba(accent, 0.18)
    g.fill(polyPath(top))
    g.beginPath()
    g.moveTo(0, -a * 1.15)
    g.lineTo(a, -a * 0.58)
    g.lineTo(a, a * 0.58)
    g.lineTo(0, a * 1.15)
    g.lineTo(-a, a * 0.58)
    g.lineTo(-a, -a * 0.58)
    g.closePath()
    g.moveTo(-a, -a * 0.58)
    g.lineTo(0, 0)
    g.lineTo(a, -a * 0.58)
    g.moveTo(0, 0)
    g.lineTo(0, a * 1.15)
    g.stroke()
  } else {
    // a ruler on the diagonal with ticks, a pencil crossing it
    g.save()
    g.rotate(-Math.PI / 4)
    g.strokeRect(-0.42 * u, -0.08 * u, 0.84 * u, 0.16 * u)
    g.lineWidth = Math.max(1, 0.025 * u)
    for (let k = 1; k < 8; k++) {
      const x = -0.42 * u + (k * 0.84 * u) / 8
      g.beginPath()
      g.moveTo(x, -0.08 * u)
      g.lineTo(x, (k % 2 ? -0.02 : 0.01) * u)
      g.stroke()
    }
    g.restore()
    g.save()
    g.rotate(Math.PI / 4)
    g.lineWidth = Math.max(1, 0.045 * u)
    g.strokeRect(-0.3 * u, -0.06 * u, 0.5 * u, 0.12 * u)
    g.beginPath()
    g.moveTo(0.2 * u, -0.06 * u)
    g.lineTo(0.36 * u, 0)
    g.lineTo(0.2 * u, 0.06 * u)
    g.stroke()
    g.restore()
  }
  g.restore()
}

/**
 * File (Stage 2, «الأداة مجانية، ملف واحد، وبدون برامج هندسية»): one document file, 0.8 × 1 ×
 * size — a page with its top-right corner folded, a `</>` glyph and code lines, a big «.html» badge
 * sticking out past its left edge, and the file's name (state `text`, e.g. «مخطط-بيتك.html») on a
 * line under it. At beats[0] an accent rubber stamp «مجاناً» slams onto it (from `FILE.stampFrom`×,
 * a squash and a jolt on impact, ink specks); at beats[1] three engineering-software tiles (our own
 * abstract glyphs: protractor and compass, a cube, a ruler and pencil) fan out from behind it and
 * each is struck through in accent.
 */
export function drawFile(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const geo = OBJECT_GEOMETRY.file
  const L = FILE_LAYOUT
  const { paper, ink } = paperInk(c)
  const beats = beatsOf(d.beats, FILE.beats)
  const S = (v: number) => v * s
  const live = d.detailAlpha > 0 && d.build > 0

  // the tiles fan out from behind the page
  if (live) {
    L.tiles.forEach(([tx, ty, deg], i) => {
      const t0 = beats[1]! + i * FILE.tileEvery
      const k = softSpring(seg(d.since, t0, t0 + FILE.tileSec))
      if (!(d.since >= t0)) return
      const ts = S(L.tile)
      g.save()
      g.globalAlpha *= d.detailAlpha * seg(d.since, t0, t0 + 0.08)
      g.translate(S(tx * k), S(ty * k))
      g.rotate(((deg * Math.PI) / 180) * k)
      g.scale(0.45 + 0.55 * k, 0.45 + 0.55 * k)
      const p = new Path2D()
      rrect(p, -ts / 2, -ts / 2, ts, ts, ts * 0.2)
      softShadow(g, p, '#000000', lum(c.bg) > 0.5 ? 0.16 : 0.4, ts * 0.12, ts * 0.05)
      const struck = seg(d.since, t0 + FILE.tileSec + FILE.strikeAfter, t0 + FILE.tileSec + FILE.strikeAfter + FILE.strikeSec)
      g.fillStyle = mixHex(paper, ink, 0.06)
      g.fill(p)
      g.strokeStyle = rgba(ink, 0.12)
      g.lineWidth = Math.max(1, ts * 0.012)
      g.stroke(p)
      g.save()
      g.globalAlpha *= 1 - 0.45 * struck
      tileGlyph(g, i, ts * 0.8, rgba(ink, 0.8), c.accent)
      g.restore()
      if (struck > 0) {
        const a: Pt = [-ts * 0.52, -ts * 0.52]
        const bb: Pt = [ts * 0.52, ts * 0.52]
        g.lineCap = 'round'
        g.strokeStyle = paper
        g.lineWidth = ts * 0.11
        partialLine(g, [a, bb], easeOutCubic(struck))
        g.strokeStyle = c.accent
        g.lineWidth = ts * 0.065
        partialLine(g, [a, bb], easeOutCubic(struck))
      }
      g.restore()
    })
  }

  // the stamp's jolt on impact moves the page too
  const tau = d.since - beats[0]!
  const impact = tau - FILE.stampSec
  const jolt = impact > 0 ? Math.exp(-16 * impact) * Math.sin(40 * impact) : 0
  g.save()
  g.translate(0, S(0.012) * jolt)
  // the page
  cardShadow(g, c, s, d.alpha, d.path)
  g.fillStyle = paper
  g.fill(d.path)
  if (!live) {
    g.restore()
    return
  }
  g.save()
  g.globalAlpha *= d.detailAlpha
  const b = d.build
  const W = geo.w / 2, H = geo.h / 2, f = geo.fold
  // the fold: the turned-down corner and its shadow
  const fk = easeOutCubic(seg(b, 0, 0.4))
  const fold = polyPath([[S(W - f), S(-H)], [S(W - f), S(-H + f)], [S(W), S(-H + f)]])
  g.save()
  g.clip(d.path)
  g.fillStyle = rgba(ink, 0.07 * fk)
  g.fillRect(S(W - f - 0.03), S(-H + f), S(f + 0.03), S(0.03))
  g.restore()
  g.fillStyle = mixHex(paper, ink, 0.12 * fk)
  g.fill(fold)
  g.strokeStyle = rgba(ink, 0.25 * fk)
  g.lineWidth = Math.max(1, S(0.004))
  g.stroke(fold)
  // the </> glyph and the code lines write in
  const G = L.glyph
  g.strokeStyle = rgba(ink, 0.7)
  g.lineWidth = Math.max(1.2, S(0.016))
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const gk = easeOutCubic(seg(b, 0.1, 0.55))
  partialLine(g, [[S(-G.w / 2 + 0.06), S(G.y - G.h / 2)], [S(-G.w / 2), S(G.y)], [S(-G.w / 2 + 0.06), S(G.y + G.h / 2)]], gk)
  partialLine(g, [[S(G.w / 2 - 0.06), S(G.y - G.h / 2)], [S(G.w / 2), S(G.y)], [S(G.w / 2 - 0.06), S(G.y + G.h / 2)]], gk)
  g.strokeStyle = c.accent
  partialLine(g, [[S(0.035), S(G.y - G.h / 2 - 0.01)], [S(-0.035), S(G.y + G.h / 2 + 0.01)]], gk)
  L.lines.forEach(([x0, x1, y], i) => {
    const k = easeOutCubic(seg(b, 0.3 + i * 0.1, 0.65 + i * 0.1))
    g.strokeStyle = rgba(ink, i === 1 ? 0.22 : 0.16)
    g.lineWidth = Math.max(1, S(0.022))
    partialLine(g, [[S(x1), S(y)], [S(x0), S(y)]], k)
  })
  // the badge, sticking out past the left edge
  const bk = easeOutBack(seg(b, 0.45, 0.95))
  if (bk > 0) {
    const [x0, y0, x1, y1] = L.badge
    g.save()
    g.translate(S((x0 + x1) / 2), S((y0 + y1) / 2))
    g.scale(bk, bk)
    const p = new Path2D()
    rrect(p, S((x0 - x1) / 2), S((y0 - y1) / 2), S(x1 - x0), S(y1 - y0), S(0.03))
    softShadow(g, p, '#000000', 0.22, S(0.02), S(0.008))
    g.fillStyle = FILE_TOKENS.badge
    g.fill(p)
    g.fillStyle = FILE_TOKENS.badgeInk
    decoText(g, '.html', 0, S(0.004), S(0.105), S(x1 - x0 - 0.06), d.font, 800, 'ltr', 'center')
    g.restore()
  }
  // the name on its line under the page
  const nk = seg(b, 0.6, 1)
  if (nk > 0) {
    g.save()
    g.globalAlpha *= nk
    g.fillStyle = rgba(c.fg, 0.9)
    decoText(g, d.text ?? L.name0, 0, S(L.name), S(0.075), S(1.0), d.font, 800, 'ltr', 'center')
    g.strokeStyle = rgba(c.fg, 0.3)
    g.lineWidth = Math.max(1, S(0.004))
    g.beginPath()
    g.moveTo(S(-0.3), S(L.name + 0.06))
    g.lineTo(S(0.3), S(L.name + 0.06))
    g.stroke()
    g.restore()
  }

  // the stamp slams down
  if (tau >= 0) {
    const St = L.stamp
    const fall = seg(tau, 0, FILE.stampSec)
    const sc = FILE.stampFrom + (1 - FILE.stampFrom) * easeInCubic(fall)
    const q = impact > 0 ? Math.exp(-14 * impact) * Math.cos(30 * impact) : 0
    g.save()
    g.translate(S(St.x), S(St.y))
    g.rotate((St.deg * Math.PI) / 180)
    g.scale(sc * (1 + 0.08 * q), sc * (1 - 0.1 * q))
    g.globalAlpha *= Math.min(1, 0.25 + 0.75 * fall)
    const outer = new Path2D()
    rrect(outer, S(-St.w / 2), S(-St.h / 2), S(St.w), S(St.h), S(0.035))
    const inner = new Path2D()
    rrect(inner, S(-St.w / 2 + 0.022), S(-St.h / 2 + 0.022), S(St.w - 0.044), S(St.h - 0.044), S(0.022))
    g.strokeStyle = c.accent
    g.lineWidth = S(0.014)
    g.stroke(outer)
    g.lineWidth = S(0.006)
    g.stroke(inner)
    g.fillStyle = c.accent
    decoText(g, 'مجاناً', 0, S(0.008), S(0.14), S(St.w - 0.1), d.font, 900, 'rtl', 'center')
    if (impact > 0) {
      // worn ink: specks of the paper knocked out of the border, a few splatters round it
      g.save()
      g.clip(outer)
      for (let i = 0; i < 46; i++) {
        const x = (hash01(d.seed, 1200 + i) - 0.5) * S(St.w)
        const y = (hash01(d.seed, 1300 + i) - 0.5) * S(St.h)
        g.fillStyle = rgba(paper, 0.75)
        g.beginPath()
        g.arc(x, y, S(0.002 + 0.004 * hash01(d.seed, 1400 + i)), 0, TAU)
        g.fill()
      }
      g.restore()
      g.fillStyle = rgba(c.accent, 0.8)
      for (let i = 0; i < 9; i++) {
        const a = hash01(d.seed, 1500 + i) * TAU
        const rr = 0.5 + 0.25 * hash01(d.seed, 1600 + i)
        g.beginPath()
        g.arc(Math.cos(a) * S(St.w) * rr * 0.62, Math.sin(a) * S(St.h) * rr * 0.9, S(0.003 + 0.004 * hash01(d.seed, 1700 + i)), 0, TAU)
        g.fill()
      }
    }
    g.restore()
  }
  g.restore()
  g.restore()
}
