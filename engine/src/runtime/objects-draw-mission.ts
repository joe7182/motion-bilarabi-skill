/**
 * Canvas drawing of the second reel's objects (Video 2: the hook «المهندسين راح يزعلون منّي» and the
 * mission «مهمتي أراويكم شلون بالذكاء الاصطناعي نحوّل أفكارنا لأدوات مفيدة… ونتحقّق من نتائجها»):
 * three engineers in hard hats who get upset and huff, a light bulb that switches on, an AI chip
 * whose traces pulse into it, a gear-and-wrench tool, a magnifier checking a results card, a
 * profile card whose follow button is pressed, a compass settling on «ش», and a purchase-order slip
 * that is struck through and stamped «تقدير أولي». Same contract as `objects-draw.ts`: every
 * function draws centred on the context's origin (the caller translates and squashes), is a pure
 * function of its arguments (`since`, `build`, `beats`, `seed`), reads colours as resolved hex
 * values, draws the body on `d.path` and gates its details on `build` / `detailAlpha`. No
 * `shadowBlur` (soft shadows are stacked strokes or gradients). Canvas text is decoration (the
 * canvas is `aria-hidden`). Our own drawing; no real person, product or logo.
 */
import type { Pt } from '../core/morph'
import { bulbHalf, OBJECT_GEOMETRY } from '../core/objects'
import { easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../core/ease'
import { AI_CHIP, beatsOf, buildSecOf, BULB, COMPASS, FOLLOW, HARD_HAT, MAGNIFIER, RECEIPT, TOOL } from '../core/params/morph-object'
import { rgba } from './materials'
import { decoText, hash01, lum, mixHex, paperInk, partialLine, rrect, softShadow, type ObjectColours, type ObjectDraw } from './objects-draw'
import { cardShadow } from './objects-draw-cost'

const TAU = Math.PI * 2
const DEG = Math.PI / 180

/** A path through `pts` (closed unless `open`). */
function polyPath(pts: readonly Pt[], open = false): Path2D {
  const p = new Path2D()
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)))
  if (!open) p.closePath()
  return p
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u
/** `ink` at alpha `a` over `paper`, as an opaque hex (so it can be mixed further). */
const rgbaHex = (ink: string, paper: string, a: number): string => mixHex(paper, ink, a)

/** A damped spring response (0 → 1, overshooting) `t` s after its start: ζ `z`, ω `w`. */
function damped(t: number, z: number, w: number): number {
  if (!(t > 0)) return 0
  const wd = w * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t))
}

/** Is this a light (paper-like) world? */
const isLight = (c: ObjectColours): boolean => lum(c.bg) > 0.5

/** The silhouette's ghost: the morph's body in `tone`, fading as the details come in (and back as they leave). */
function ghost(g: CanvasRenderingContext2D, d: ObjectDraw, tone: string, appear: number): void {
  const a = Math.max(1 - appear, 1 - d.detailAlpha)
  if (!(a > 0)) return
  g.fillStyle = rgba(mixHex(d.colours.bg, tone, 0.75), a)
  g.fill(d.path)
}

/** Length of a polyline. */
function lengthOf(pts: readonly Pt[]): number {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])
  return l
}

/** The part of the polyline `pts` between the length shares `a` and `b` (0..1). */
function subLine(pts: readonly Pt[], a: number, b: number): Pt[] {
  const total = lengthOf(pts)
  const la = Math.max(0, a) * total
  const lb = Math.min(1, b) * total
  const out: Pt[] = []
  if (!(lb > la)) return out
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!
    const q = pts[i]!
    const l = Math.hypot(q[0] - p[0], q[1] - p[1])
    const s0 = acc
    const s1 = acc + l
    acc = s1
    if (s1 < la || s0 > lb || !(l > 0)) continue
    const f0 = Math.max(0, (la - s0) / l)
    const f1 = Math.min(1, (lb - s0) / l)
    if (out.length === 0) out.push([p[0] + (q[0] - p[0]) * f0, p[1] + (q[1] - p[1]) * f0])
    out.push([p[0] + (q[0] - p[0]) * f1, p[1] + (q[1] - p[1]) * f1])
  }
  return out
}

/** A four-pointed sparkle of radius r at (x, y). */
function sparkle(g: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string): void {
  if (!(r > 0)) return
  const w = r * 0.24
  g.fillStyle = colour
  g.beginPath()
  g.moveTo(x, y - r)
  g.quadraticCurveTo(x + w * 0.4, y - w * 0.4, x + r, y)
  g.quadraticCurveTo(x + w * 0.4, y + w * 0.4, x, y + r)
  g.quadraticCurveTo(x - w * 0.4, y + w * 0.4, x - r, y)
  g.quadraticCurveTo(x - w * 0.4, y - w * 0.4, x, y - r)
  g.fill()
}

/** Brushed steel tinted by the world's fg (its own highlight on both worlds). */
function steelOf(c: ObjectColours): { hi: string; light: string; mid: string; dark: string; edge: string } {
  const light = isLight(c)
  return light
    ? { hi: '#F7F9FB', light: mixHex('#DDE2E8', c.fg, 0.05), mid: mixHex('#A7B0BB', c.fg, 0.16), dark: mixHex('#6E7985', c.fg, 0.28), edge: mixHex('#48515B', c.fg, 0.4) }
    : { hi: '#FFFFFF', light: mixHex('#E4E8ED', c.fg, 0.1), mid: mixHex('#AEB7C1', c.fg, 0.12), dark: '#6B7581', edge: '#3D454E' }
}

/**
 * A rubber stamp: a rounded double border and the word, in accent, turned `deg`°, slammed from
 * `from`× (`fall` 0..1, eased in) with a squash on impact (`impact` s since it hit), worn ink
 * (specks of `paper` knocked out of it) and splatter round it once it has hit.
 */
function rubberStamp(g: CanvasRenderingContext2D, s: number, accent: string, paper: string, font: string, seed: number, st: { x: number; y: number; w: number; h: number; deg: number; text: string; size: number }, fall: number, from: number, impact: number, backing = 0): void {
  const S = (v: number) => v * s
  const sc = from + (1 - from) * easeInCubic(fall)
  const q = impact > 0 ? Math.exp(-14 * impact) * Math.cos(30 * impact) : 0
  g.save()
  g.translate(S(st.x), S(st.y))
  g.rotate(st.deg * DEG)
  g.scale(sc * (1 + 0.08 * q), sc * (1 - 0.1 * q))
  g.globalAlpha *= Math.min(1, 0.25 + 0.75 * fall)
  const outer = new Path2D()
  rrect(outer, S(-st.w / 2), S(-st.h / 2), S(st.w), S(st.h), S(0.03))
  const inner = new Path2D()
  rrect(inner, S(-st.w / 2 + 0.02), S(-st.h / 2 + 0.02), S(st.w - 0.04), S(st.h - 0.04), S(0.02))
  if (backing > 0) {
    // the stamp pressed over printing: the paper shows through the ink's own body
    g.fillStyle = rgba(paper, backing)
    g.fill(outer)
    g.fillStyle = rgba(accent, 0.07)
    g.fill(outer)
  }
  g.strokeStyle = accent
  g.lineWidth = S(0.013)
  g.stroke(outer)
  g.lineWidth = S(0.006)
  g.stroke(inner)
  g.fillStyle = accent
  decoText(g, st.text, 0, S(0.006), S(st.size), S(st.w - 0.09), font, 900, 'rtl', 'center')
  if (impact > 0) {
    g.save()
    g.clip(outer)
    for (let i = 0; i < 52; i++) {
      const x = (hash01(seed, 1200 + i) - 0.5) * S(st.w)
      const y = (hash01(seed, 1300 + i) - 0.5) * S(st.h)
      g.fillStyle = rgba(paper, 0.75)
      g.beginPath()
      g.arc(x, y, S(0.002 + 0.004 * hash01(seed, 1400 + i)), 0, TAU)
      g.fill()
    }
    // a worn band: the stamp pressed lighter along one edge
    const wg = g.createLinearGradient(0, S(-st.h / 2), 0, S(st.h / 2))
    wg.addColorStop(0, rgba(paper, 0.28))
    wg.addColorStop(0.35, rgba(paper, 0))
    g.fillStyle = wg
    g.fill(outer)
    g.restore()
    g.fillStyle = rgba(accent, 0.8)
    for (let i = 0; i < 9; i++) {
      const a = hash01(seed, 1500 + i) * TAU
      const rr = 0.5 + 0.25 * hash01(seed, 1600 + i)
      g.beginPath()
      g.arc(Math.cos(a) * S(st.w) * rr * 0.62, Math.sin(a) * S(st.h) * rr * 0.9, S(0.003 + 0.004 * hash01(seed, 1700 + i)), 0, TAU)
      g.fill()
    }
  }
  g.restore()
}

// ------------------------------------------------------------------ hard-hat

/** The engineers' own colours: the glossy yellow hat, skin, features, the work shirt and hi-vis straps. */
export const HAT_TOKENS = {
  hat: '#F2B705',
  hi: '#FFE27A',
  shade: '#C79300',
  brim: '#D9A300',
  brimDark: '#8F6700',
  plate: '#FFF4CC',
  skin: '#E9B48E',
  skinShade: '#C98B66',
  eye: '#2A1F1A',
  brow: '#3E2B20',
  mouth: '#7A3527',
  blush: '#E8483F',
  hair: '#2B211C',
  shirt: '#3B5B7E',
  shirtDark: '#2A4360',
  vest: '#C9DF3C',
  stripe: '#EEF1F3',
  frame: '#2A2A2E',
} as const

interface EngineerLook {
  /** 0 calm → 1 upset (brows slant, mouth frowns, cheeks flush). */
  upset: number
  glasses: boolean
  mustache: boolean
  /** The hat's jump (× size, up) and its landing squash. */
  hatLift: number
  hatSquash: number
  /** Steam puffs: progress 0..1 of each puff (≤ 0 or ≥ 1 is none). */
  puffs: number[]
}

/** One engineer in the middle head's frame (units of the size `s`; the caller scales the side ones about the box bottom). */
function engineerArt(g: CanvasRenderingContext2D, s: number, c: ObjectColours, look: EngineerLook): void {
  const T = HAT_TOKENS
  const geo = OBJECT_GEOMETRY['hard-hat']
  const S = (v: number) => v * s
  const skin = mixHex(T.skin, c.bg, 0.1)
  const skinShade = mixHex(T.skinShade, c.bg, 0.1)
  const u = look.upset
  g.lineCap = 'round'
  g.lineJoin = 'round'

  // the neck (the shirt covers its foot)
  g.fillStyle = skinShade
  g.fillRect(S(-0.07), S(0.16), S(0.14), S(0.2))
  // shoulders: the work shirt, the collar and hi-vis straps with a reflective band
  const bw = geo.body.w
  const body = new Path2D()
  const N = 24
  body.moveTo(S(-bw), S(0.56))
  for (let i = 0; i <= N; i++) {
    const x = -bw + (2 * bw * i) / N
    body.lineTo(S(x), S(0.5 - (0.5 - geo.body.y) * Math.max(0, 1 - (Math.abs(x) / bw) ** 4) ** 0.25))
  }
  body.lineTo(S(bw), S(0.56))
  body.closePath()
  const sg = g.createLinearGradient(S(-bw), 0, S(bw), 0)
  sg.addColorStop(0, T.shirtDark)
  sg.addColorStop(0.4, T.shirt)
  sg.addColorStop(1, T.shirtDark)
  g.fillStyle = sg
  g.fill(body)
  g.save()
  g.clip(body)
  for (const side of [-1, 1]) {
    g.fillStyle = T.vest
    g.fillRect(S(side * 0.2 - 0.045), S(0.28), S(0.09), S(0.3))
    g.fillStyle = T.stripe
    g.fillRect(S(side * 0.2 - 0.045), S(0.43), S(0.09), S(0.025))
    g.fillStyle = rgba('#000000', 0.12)
    g.fillRect(S(side * 0.2 + 0.035), S(0.28), S(0.01), S(0.3))
  }
  g.restore()
  // the collar's V: skin in the opening, a darker collar band round it
  g.fillStyle = skinShade
  g.beginPath()
  g.moveTo(S(-0.075), S(0.29))
  g.lineTo(S(0), S(0.36))
  g.lineTo(S(0.075), S(0.29))
  g.closePath()
  g.fill()
  g.fillStyle = T.shirtDark
  g.beginPath()
  g.moveTo(S(-0.105), S(0.3))
  g.lineTo(S(0), S(0.395))
  g.lineTo(S(0.105), S(0.3))
  g.lineTo(S(0.078), S(0.292))
  g.lineTo(S(0), S(0.362))
  g.lineTo(S(-0.078), S(0.292))
  g.closePath()
  g.fill()

  // ears, face
  const F = geo.face
  for (const side of [-1, 1]) {
    g.fillStyle = skin
    g.beginPath()
    g.ellipse(S(side * F.rx * 0.98), S(F.y + 0.01), S(0.033), S(0.052), 0, 0, TAU)
    g.fill()
    g.fillStyle = rgba(skinShade, 0.8)
    g.beginPath()
    g.ellipse(S(side * F.rx * 1.0), S(F.y + 0.012), S(0.016), S(0.03), 0, 0, TAU)
    g.fill()
  }
  const face = new Path2D()
  face.ellipse(0, S(F.y), S(F.rx), S(F.ry), 0, 0, TAU)
  const fg = g.createRadialGradient(S(-0.06), S(F.y - 0.08), S(0.02), 0, S(F.y), S(F.ry * 1.05))
  fg.addColorStop(0, mixHex(skin, '#ffffff', 0.18))
  fg.addColorStop(0.7, skin)
  fg.addColorStop(1, skinShade)
  g.fillStyle = fg
  g.fill(face)
  g.save()
  g.clip(face)
  // hair under the helmet: a hairline high in the middle, down to sideburns at the temples
  g.fillStyle = T.hair
  g.beginPath()
  g.moveTo(S(-F.rx - 0.01), S(-0.3))
  for (let i = 0; i <= 16; i++) {
    const x = -F.rx - 0.01 + ((2 * F.rx + 0.02) * i) / 16
    g.lineTo(S(x), S(-0.155 + 0.07 * (x / F.rx) ** 2))
  }
  g.lineTo(S(F.rx + 0.01), S(-0.3))
  g.closePath()
  g.fill()
  // the helmet's shadow on the forehead
  const hs = g.createLinearGradient(0, S(-0.17), 0, S(-0.09))
  hs.addColorStop(0, rgba('#000000', 0.22))
  hs.addColorStop(1, rgba('#000000', 0))
  g.fillStyle = hs
  g.fillRect(S(-0.3), S(-0.17), S(0.6), S(0.08))
  // flushed cheeks
  if (u > 0) {
    for (const side of [-1, 1]) {
      const bx = S(side * 0.112)
      const by = S(F.y + 0.07)
      const bl = g.createRadialGradient(bx, by, 0, bx, by, S(0.055))
      bl.addColorStop(0, rgba(T.blush, 0.6 * u))
      bl.addColorStop(1, rgba(T.blush, 0))
      g.fillStyle = bl
      g.beginPath()
      g.ellipse(bx, by, S(0.055), S(0.036), 0, 0, TAU)
      g.fill()
    }
  }
  g.restore()

  // features
  const ey = F.y - 0.01
  for (const side of [-1, 1]) {
    g.fillStyle = T.eye
    g.beginPath()
    g.ellipse(S(side * 0.072), S(ey), S(0.021), S(0.023 - 0.004 * u), 0, 0, TAU)
    g.fill()
    g.fillStyle = rgba('#ffffff', 0.85)
    g.beginPath()
    g.arc(S(side * 0.072 - 0.007), S(ey - 0.008), S(0.006), 0, TAU)
    g.fill()
    // brows: relaxed arches → slanting down to the middle
    const inner: Pt = [S(side * 0.03), S(ey - 0.062 + 0.042 * u)]
    const outer: Pt = [S(side * 0.118), S(ey - 0.058 - 0.014 * u)]
    g.strokeStyle = T.brow
    g.lineWidth = S(0.019)
    g.beginPath()
    g.moveTo(inner[0], inner[1])
    g.quadraticCurveTo(S(side * 0.075), S(ey - 0.078 + 0.018 * u), outer[0], outer[1])
    g.stroke()
  }
  if (look.glasses) {
    g.strokeStyle = T.frame
    g.lineWidth = S(0.011)
    for (const side of [-1, 1]) {
      g.beginPath()
      g.arc(S(side * 0.072), S(ey), S(0.043), 0, TAU)
      g.stroke()
    }
    g.beginPath()
    g.moveTo(S(-0.03), S(ey - 0.006))
    g.quadraticCurveTo(0, S(ey - 0.018), S(0.03), S(ey - 0.006))
    g.stroke()
    g.beginPath()
    g.moveTo(S(-0.115), S(ey - 0.004))
    g.lineTo(S(-0.18), S(ey - 0.012))
    g.moveTo(S(0.115), S(ey - 0.004))
    g.lineTo(S(0.18), S(ey - 0.012))
    g.stroke()
  }
  // nose
  g.strokeStyle = rgba(skinShade, 0.95)
  g.lineWidth = S(0.012)
  g.beginPath()
  g.moveTo(S(-0.02), S(F.y + 0.055))
  g.quadraticCurveTo(0, S(F.y + 0.075), S(0.02), S(F.y + 0.055))
  g.stroke()
  // mouth: a small smile → a frown
  const my = F.y + 0.125
  const mw = 0.055 - 0.008 * u
  const curve = 0.024 * (1 - u) - 0.032 * u
  g.strokeStyle = T.mouth
  g.lineWidth = S(0.015)
  g.beginPath()
  g.moveTo(S(-mw), S(my))
  g.quadraticCurveTo(0, S(my + 2 * curve), S(mw), S(my))
  g.stroke()
  if (look.mustache) {
    g.fillStyle = T.hair
    g.beginPath()
    g.moveTo(S(-0.08), S(F.y + 0.108))
    g.quadraticCurveTo(S(-0.045), S(F.y + 0.07), S(0), S(F.y + 0.083))
    g.quadraticCurveTo(S(0.045), S(F.y + 0.07), S(0.08), S(F.y + 0.108))
    g.quadraticCurveTo(S(0.04), S(F.y + 0.1), S(0), S(F.y + 0.104))
    g.quadraticCurveTo(S(-0.04), S(F.y + 0.1), S(-0.08), S(F.y + 0.108))
    g.fill()
  }

  // the hard hat (it can jump off the head and land with a squash)
  const D = geo.dome
  const B = geo.brim
  g.save()
  g.translate(0, S(B.y + B.t) - S(look.hatLift))
  g.scale(1 + 0.05 * look.hatSquash, 1 - 0.07 * look.hatSquash)
  g.translate(0, -S(B.y + B.t))
  // its shadow on the head
  const dome = new Path2D()
  dome.ellipse(0, S(D.y), S(D.rx), S(D.ry), 0, Math.PI, TAU)
  dome.closePath()
  const dg = g.createRadialGradient(S(-0.08), S(D.y - 0.2), S(0.02), 0, S(D.y - 0.05), S(D.rx * 1.25))
  dg.addColorStop(0, T.hi)
  dg.addColorStop(0.45, T.hat)
  dg.addColorStop(1, T.shade)
  g.fillStyle = dg
  g.fill(dome)
  // ribs either side and the central ridge
  g.save()
  g.clip(dome)
  g.strokeStyle = rgba(T.shade, 0.55)
  g.lineWidth = S(0.008)
  for (const side of [-1, 1]) {
    g.beginPath()
    g.ellipse(0, S(D.y), S(0.14), S(D.ry * 0.97), 0, side < 0 ? Math.PI : 1.5 * Math.PI, side < 0 ? 1.5 * Math.PI : TAU)
    g.stroke()
  }
  const ridge = new Path2D()
  ridge.ellipse(0, S(D.y), S(0.05), S(D.ry + 0.004), 0, Math.PI, TAU)
  ridge.closePath()
  const rg = g.createLinearGradient(S(-0.05), 0, S(0.05), 0)
  rg.addColorStop(0, T.shade)
  rg.addColorStop(0.35, T.hi)
  rg.addColorStop(1, T.hat)
  g.fillStyle = rg
  g.fill(ridge)
  g.strokeStyle = rgba(T.brimDark, 0.35)
  g.lineWidth = S(0.005)
  g.stroke(ridge)
  // the gloss streak
  g.save()
  g.translate(S(-0.12), S(D.y - 0.17))
  g.rotate(-0.75)
  const gl = g.createLinearGradient(0, S(-0.02), 0, S(0.02))
  gl.addColorStop(0, rgba('#ffffff', 0))
  gl.addColorStop(0.5, rgba('#ffffff', 0.75))
  gl.addColorStop(1, rgba('#ffffff', 0))
  g.fillStyle = gl
  g.beginPath()
  g.ellipse(0, 0, S(0.075), S(0.018), 0, 0, TAU)
  g.fill()
  g.restore()
  g.restore()
  g.strokeStyle = rgba(T.brimDark, 0.5)
  g.lineWidth = S(0.006)
  g.stroke(dome)
  // the small front plate (our own blank badge)
  const plate = new Path2D()
  rrect(plate, S(-0.055), S(D.y - 0.105), S(0.11), S(0.07), S(0.014))
  g.fillStyle = T.plate
  g.fill(plate)
  g.strokeStyle = rgba(T.brimDark, 0.55)
  g.lineWidth = S(0.005)
  g.stroke(plate)
  g.fillStyle = rgba(T.shade, 0.9)
  g.beginPath()
  g.moveTo(S(0), S(D.y - 0.092))
  g.lineTo(S(0.024), S(D.y - 0.05))
  g.lineTo(S(-0.024), S(D.y - 0.05))
  g.closePath()
  g.fill()
  // the brim: a band wider than the dome, its front peak dipping a little
  const brim = new Path2D()
  brim.moveTo(S(-B.w), S(B.y))
  brim.quadraticCurveTo(0, S(B.y + 0.02), S(B.w), S(B.y))
  brim.quadraticCurveTo(S(B.w + 0.022), S(B.y + 0.022), S(B.w - 0.004), S(B.y + B.t * 0.72))
  brim.quadraticCurveTo(0, S(B.y + B.t + 0.035), S(-B.w + 0.004), S(B.y + B.t * 0.72))
  brim.quadraticCurveTo(S(-B.w - 0.022), S(B.y + 0.022), S(-B.w), S(B.y))
  brim.closePath()
  const bg = g.createLinearGradient(0, S(B.y), 0, S(B.y + B.t + 0.03))
  bg.addColorStop(0, T.hi)
  bg.addColorStop(0.3, T.brim)
  bg.addColorStop(1, T.brimDark)
  g.fillStyle = bg
  g.fill(brim)
  g.strokeStyle = rgba(T.brimDark, 0.6)
  g.lineWidth = S(0.005)
  g.stroke(brim)
  g.restore()

  // steam puffs bursting out from under the helmet's sides (a kettle's huff): lobed clouds
  // that swell, drift out and up, and fade
  const light = isLight(c)
  for (const k of look.puffs) {
    if (!(k > 0 && k < 1)) continue
    const e = easeOutCubic(k)
    const a = Math.min(1, k * 8) * (1 - easeInCubic(seg(k, 0.55, 1)))
    const lobes: [number, number, number][] = []
    for (const side of [-1, 1]) {
      const ox = side * (F.rx + 0.03)
      const oy = B.y + B.t + 0.02
      const cx = ox + side * (0.05 + 0.2 * e)
      const cy = oy - 0.04 - 0.16 * e
      const r = 0.035 + 0.06 * e
      for (const [dx, dy, f] of [[0, 0, 1], [0.75, 0.2, 0.72], [-0.6, 0.35, 0.66], [0.3, -0.55, 0.7], [-0.35, -0.45, 0.58]] as const)
        lobes.push([cx + side * dx * r, cy + dy * r, r * f])
      // a little trail of wisps back toward the helmet
      lobes.push([ox + side * (0.02 + 0.08 * e), oy - 0.01 - 0.05 * e, r * 0.38])
    }
    g.save()
    g.globalAlpha *= a
    g.fillStyle = light ? rgba(c.fg, 0.22) : rgba('#000000', 0.3)
    for (const [x, y, r] of lobes) {
      g.beginPath()
      g.arc(S(x), S(y), S(r) + Math.max(1.5, S(0.007)), 0, TAU)
      g.fill()
    }
    for (const [x, y, r] of lobes) {
      const pg = g.createLinearGradient(0, S(y - r), 0, S(y + r))
      pg.addColorStop(0, '#FFFFFF')
      pg.addColorStop(1, light ? '#E4E6EA' : '#C9CDD3')
      g.fillStyle = pg
      g.beginPath()
      g.arc(S(x), S(y), S(r), 0, TAU)
      g.fill()
    }
    g.restore()
  }
}

/**
 * Hard hat (Video 2, «المهندسين راح يزعلون منّي»): three engineers, front view, 1.3 × 1 × size —
 * a big one in the middle, two smaller behind on each side — each a simple flat face (skin from
 * `HAT_TOKENS` mixed toward the world, dot eyes, brows, a mouth; the middle one has a moustache,
 * the left one glasses) under a glossy yellow hard hat (dome, ridge and ribs, a front plate, a
 * darker brim), in a work shirt with hi-vis straps. Build (0.5 s): they pop up from below one by
 * one (right, left, middle). beats[0]: they turn upset — brows slant down, mouths flip to a frown,
 * cheeks flush. beats[1]: steam puffs burst from the helmets' sides (twice) and the middle hat
 * jumps once. Idle: a tiny seeded bob.
 */
export function drawHardHat(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const geo = OBJECT_GEOMETRY['hard-hat']
  const b = d.build
  const H = HARD_HAT
  const beats = beatsOf(d.beats, H.beats)
  const tb = b * buildSecOf('hard-hat')
  ghost(g, d, HAT_TOKENS.hat, seg(b, 0, 0.3))
  if (!(d.detailAlpha > 0) || !(b > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  // they rise from behind the box bottom
  g.beginPath()
  g.rect(-s * 2, -s * 2, s * 4, s * 2 + (geo.h / 2) * s)
  g.clip()
  geo.heads.forEach(([hx, hs], i) => {
    const pop = easeOutBack(seg(tb, i * H.popEvery, i * H.popEvery + H.popSec), 1.4)
    if (!(pop > 0)) return
    const per = 1.3 + 0.5 * hash01(d.seed, 10 + i)
    const bob = H.bob * Math.sin((TAU * d.since) / per + hash01(d.seed, 20 + i) * TAU)
    const upset = easeOutCubic(seg(d.since, beats[0]! + i * 0.05, beats[0]! + i * 0.05 + H.upsetSec))
    const t1 = beats[1]! + (i === 2 ? 0 : 0.06 * (i + 1))
    const puffs = [seg(d.since, t1, t1 + H.puffSec), seg(d.since, t1 + H.puffAgain, t1 + H.puffAgain + H.puffSec)]
    const middle = i === 2
    const jk = seg(d.since, beats[1]!, beats[1]! + H.jumpSec)
    const after = d.since - beats[1]! - H.jumpSec
    const look: EngineerLook = {
      upset,
      glasses: i === 1,
      mustache: middle,
      hatLift: middle && jk > 0 && jk < 1 ? 0.1 * Math.sin(Math.PI * jk) : 0,
      hatSquash: middle && after > 0 ? Math.exp(-12 * after) * Math.cos(32 * after) : 0,
      puffs,
    }
    g.save()
    g.translate(hx * s, (geo.h / 2) * s + (1 - pop) * 0.75 * hs * s + bob * s)
    g.scale(hs, hs)
    g.translate(0, -(geo.h / 2) * s)
    engineerArt(g, s, c, look)
    g.restore()
  })
  g.restore()
}

// ------------------------------------------------------------------ bulb

/** The bulb's own colours: the lit glass, the filament, the screw base. */
export const BULB_TOKENS = { core: '#FFF9E6', warm: '#FFD45C', deep: '#FFB21F', wire: '#7C6A55', hot: '#FFF6D2', metal: '#C3CAD2', metalHi: '#F1F4F7', metalDark: '#78828E', insulator: '#2A2B30' } as const

/**
 * Bulb (Video 2, «أفكارنا»): a light bulb 0.62 × 1 × size — a clear glass globe and neck (`bulbHalf`)
 * with a stem, support wires and a coiled filament, a threaded screw base, an insulator and the
 * contact tip. Build (0.4 s): the glass draws, the base rises in, the filament coils. beats[0]: it
 * switches on with a little stutter — the filament glows, the globe fills warm accent-yellow, a
 * soft halo and `BULB.rays` short rays flick out. Lit, the halo flickers gently (seeded).
 */
export function drawBulb(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const T = BULB_TOKENS
  const geo = OBJECT_GEOMETRY.bulb
  const b = d.build
  const S = (v: number) => v * s
  const light = isLight(c)
  const beats = beatsOf(d.beats, BULB.beats)
  ghost(g, d, light ? mixHex(c.bg, c.fg, 0.25) : mixHex(c.bg, c.fg, 0.35), seg(b, 0, 0.6))
  if (!(d.detailAlpha > 0) || !(b > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'
  g.lineJoin = 'round'
  // on: a stutter (on, dip, on) — then a seeded flicker of the halo
  const t0 = beats[0]!
  const tau = d.since - t0
  const on = tau < 0 ? 0 : tau < 0.03 ? tau / 0.03 : tau < 0.065 ? 0.3 : Math.min(1, 0.3 + (0.7 * (tau - 0.065)) / (BULB.onSec - 0.065))
  const n0 = Math.floor(d.since * 11)
  const f = d.since * 11 - n0
  const noise = lerp(hash01(d.seed, 300 + n0), hash01(d.seed, 301 + n0), f * f * (3 - 2 * f))
  const flicker = 1 - BULB.flicker * (0.55 * noise + 0.45 * (0.5 + 0.5 * Math.sin(TAU * 0.9 * d.since)))
  const G = geo.globe
  const cy = S(G.y)
  const R = S(G.r)

  // the glass: the half outline mirrored, down to the base
  const half = bulbHalf().filter(([, y]) => y <= geo.base.y0 + 1e-6)
  const glassPts: Pt[] = [...half.map(([x, y]) => [S(x), S(y)] as Pt), ...half.slice(1).reverse().map(([x, y]) => [S(-x), S(y)] as Pt)]
  const glass = polyPath(glassPts)
  const appear = easeOutCubic(seg(b, 0, 0.5))

  // halo and rays behind the glass
  if (on > 0) {
    const ha = on * flicker
    const halo = g.createRadialGradient(0, cy, R * 0.6, 0, cy, R * 2.7)
    halo.addColorStop(0, rgba(T.warm, (light ? 0.55 : 0.45) * ha))
    halo.addColorStop(0.4, rgba(mixHex(T.warm, c.accent, 0.4), (light ? 0.2 : 0.18) * ha))
    halo.addColorStop(1, rgba(c.accent, 0))
    g.fillStyle = halo
    g.fillRect(-R * 3, cy - R * 3, R * 6, R * 6)
    for (let i = 0; i < BULB.rays; i++) {
      // a fan over the top: −200° .. 20° (none toward the base)
      const a = (-200 + (220 * (i + 0.5)) / BULB.rays) * DEG
      const k = seg(tau, 0.04 + i * 0.012, 0.04 + i * 0.012 + BULB.raySec)
      if (!(k > 0)) continue
      const len = R * 0.3 * (k < 1 ? easeOutBack(k, 2.4) : 1) * (0.85 + 0.15 * flicker) * (i % 2 ? 0.75 : 1)
      const r0 = R * 1.22 + R * 0.08 * (1 - easeOutCubic(k))
      g.strokeStyle = rgba(mixHex(T.deep, c.accent, 0.45), on)
      g.lineWidth = S(0.024)
      g.beginPath()
      g.moveTo(Math.cos(a) * r0, cy + Math.sin(a) * r0)
      g.lineTo(Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len))
      g.stroke()
    }
  }

  // the glass body: clear (tinted from the world) → warm when lit
  g.save()
  g.globalAlpha *= appear
  if (light) softShadow(g, glass, c.fg, 0.08 * (1 - on), S(0.03), S(0.015))
  g.fillStyle = light ? rgba('#ffffff', 0.7) : rgba(c.fg, 0.1)
  g.fill(glass)
  if (on > 0) {
    const lit = g.createRadialGradient(0, S(-0.17), S(0.02), 0, cy, R * 1.15)
    lit.addColorStop(0, rgba(T.core, on))
    lit.addColorStop(0.45, rgba(T.warm, on))
    lit.addColorStop(1, rgba(mixHex(T.deep, c.accent, 0.35), on))
    g.fillStyle = lit
    g.fill(glass)
  }
  // inner shading at the rim of the glass
  g.save()
  g.clip(glass)
  g.strokeStyle = rgba(light ? c.fg : '#000000', light ? 0.08 : 0.18)
  g.lineWidth = S(0.05)
  g.stroke(glass)
  g.restore()
  g.restore()

  // the stem, the support wires and the coiled filament
  const fk = seg(b, 0.45, 1)
  if (fk > 0) {
    g.save()
    g.globalAlpha *= easeOutCubic(Math.min(1, fk * 1.6))
    const stem = polyPath([[S(-0.04), S(geo.base.y0 + 0.01)], [S(-0.022), S(-0.03)], [S(0.022), S(-0.03)], [S(0.04), S(geo.base.y0 + 0.01)]])
    g.fillStyle = light ? rgba(c.fg, 0.1) : rgba(c.fg, 0.16)
    g.fill(stem)
    g.strokeStyle = mixHex(T.wire, c.fg, 0.2)
    g.lineWidth = S(0.008)
    g.beginPath()
    g.moveTo(S(-0.012), S(-0.03))
    g.lineTo(S(-0.075), S(-0.16))
    g.moveTo(S(0.012), S(-0.03))
    g.lineTo(S(0.075), S(-0.16))
    g.stroke()
    g.restore()
    // the coil: a tight helix seen side on, sagging slightly between the wires
    const coil: Pt[] = []
    const turns = 7
    for (let i = 0; i <= turns * 12; i++) {
      const u = i / (turns * 12)
      const x = -0.075 + 0.15 * u
      const sag = 0.012 * Math.sin(Math.PI * u)
      coil.push([S(x + 0.006 * Math.sin(u * turns * TAU)), S(-0.16 - sag + 0.014 * Math.cos(u * turns * TAU))])
    }
    const hot = on
    if (hot > 0) {
      g.strokeStyle = rgba(T.warm, 0.45 * hot * flicker)
      g.lineWidth = S(0.05)
      partialLine(g, coil, 1)
      g.strokeStyle = rgba(T.core, 0.7 * hot)
      g.lineWidth = S(0.022)
      partialLine(g, coil, 1)
    }
    g.strokeStyle = hot > 0 ? mixHex(mixHex(T.wire, c.fg, 0.2), T.hot, hot) : mixHex(T.wire, c.fg, 0.2)
    g.lineWidth = S(0.008)
    partialLine(g, coil, easeOutCubic(fk))
  }

  // the glass edge and its highlights
  g.save()
  g.globalAlpha *= appear
  g.strokeStyle = rgba(c.fg, light ? 0.55 : 0.6)
  g.lineWidth = S(0.012)
  partialLine(g, [...glassPts, glassPts[0]!], easeInOutCubic(seg(b, 0, 0.55)))
  g.strokeStyle = rgba('#ffffff', 0.85)
  g.lineWidth = S(0.018)
  g.beginPath()
  g.arc(0, cy, R * 0.74, -2.55, -1.85)
  g.stroke()
  g.fillStyle = rgba('#ffffff', 0.9)
  g.beginPath()
  g.arc(Math.cos(-1.62) * R * 0.74, cy + Math.sin(-1.62) * R * 0.74, S(0.011), 0, TAU)
  g.fill()
  g.restore()

  // the screw base: a collar, the threads, the insulator and the contact tip
  const bk = easeOutCubic(seg(b, 0.2, 0.75))
  if (bk > 0) {
    const W = geo.base.w
    const y0 = geo.base.y0
    const y1 = geo.base.y1
    g.save()
    g.globalAlpha *= bk
    g.translate(0, S(0.05 * (1 - bk)))
    const mg = g.createLinearGradient(S(-W), 0, S(W), 0)
    mg.addColorStop(0, T.metalDark)
    mg.addColorStop(0.32, T.metalHi)
    mg.addColorStop(0.55, T.metal)
    mg.addColorStop(1, T.metalDark)
    const base = new Path2D()
    rrect(base, S(-W), S(y0 - 0.005), S(2 * W), S(y1 - y0 + 0.01), S(0.012))
    g.fillStyle = mg
    g.fill(base)
    // the threads: slanted ridges (a shadow under each, a light line over it)
    g.save()
    g.clip(base)
    for (let k = 0; k < 5; k++) {
      const y = y0 + 0.035 + k * 0.045
      g.strokeStyle = rgba('#000000', 0.32)
      g.lineWidth = S(0.012)
      g.beginPath()
      g.moveTo(S(-W), S(y + 0.006))
      g.quadraticCurveTo(0, S(y + 0.03), S(W), S(y + 0.018))
      g.stroke()
      g.strokeStyle = rgba('#ffffff', 0.55)
      g.lineWidth = S(0.006)
      g.beginPath()
      g.moveTo(S(-W), S(y - 0.006))
      g.quadraticCurveTo(0, S(y + 0.018), S(W), S(y + 0.006))
      g.stroke()
    }
    g.restore()
    g.strokeStyle = rgba(T.metalDark, 0.9)
    g.lineWidth = S(0.006)
    g.stroke(base)
    // the collar where the glass meets the metal
    const collar = new Path2D()
    rrect(collar, S(-W - 0.012), S(y0 - 0.018), S(2 * W + 0.024), S(0.03), S(0.012))
    g.fillStyle = mg
    g.fill(collar)
    g.stroke(collar)
    // insulator and tip
    const ins = polyPath([[S(-W + 0.01), S(y1)], [S(W - 0.01), S(y1)], [S(geo.tip + 0.02), S(y1 + 0.045)], [S(-geo.tip - 0.02), S(y1 + 0.045)]])
    g.fillStyle = T.insulator
    g.fill(ins)
    const tip = new Path2D()
    tip.moveTo(S(-geo.tip), S(y1 + 0.043))
    tip.lineTo(S(geo.tip), S(y1 + 0.043))
    tip.quadraticCurveTo(S(geo.tip), S(0.5), 0, S(0.5))
    tip.quadraticCurveTo(S(-geo.tip), S(0.5), S(-geo.tip), S(y1 + 0.043))
    g.fillStyle = mg
    g.fill(tip)
    g.restore()
  }
  g.restore()
}

// ------------------------------------------------------------------ ai-chip

/** The chip's own colours: the circuit board, its copper-gold traces and pads, the package, the pins, the label. */
export const CHIP_TOKENS = { board: '#123A30', boardHi: '#1B4D40', boardEdge: '#2F6E5C', trace: '#C9A35A', pad: '#E6C67E', via: '#0B2A22', chip: '#1A1D23', chipHi: '#363C46', chipEdge: '#0B0D10', pin: '#CDD2D9', pinDark: '#8A929C', label: '#F2F4F7' } as const

/** Chip layout (units of the size): the package half-width, its die, the pins per side and their pitch, the pin tip, the board margin. */
export const CHIP_LAYOUT = { pkg: 0.21, die: 0.145, pins: 6, pitch: 0.062, pinOut: 0.265, edge: 0.455, spread: 0.044 } as const

/** The traces of one side (the right; the others are it turned by 90°), from the pin tip outward to the board edge. */
function chipTraces(): Pt[][] {
  const L = CHIP_LAYOUT
  const out: Pt[][] = []
  for (let k = 0; k < L.pins; k++) {
    const t = (k - (L.pins - 1) / 2) * L.pitch
    const dv = (k - (L.pins - 1) / 2) * L.spread
    const bend = 0.3 + 0.012 * Math.abs(k - (L.pins - 1) / 2)
    out.push([[L.pinOut, t], [bend, t], [bend + Math.abs(dv), t + dv], [L.edge, t + dv]])
  }
  return out
}

/**
 * AI chip (Video 2, «بالذكاء الاصطناعي»): a circuit-board tile, 1 × 1 × size, with a processor in
 * its middle — the package with a bevel, the die, «AI» in the display font, a pin-1 dot — and
 * `CHIP_LAYOUT.pins` pins on each side whose traces run out to pads at the board edge (our own
 * drawing, no brand). Build (0.5 s): the board, the package, the pins, then the traces draw
 * outward and the pads pop. After beats[0]: accent pulses run along the traces INTO the chip
 * (seeded, looping), a pin flashes as each arrives, and the die glows.
 */
export function drawAiChip(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const T = CHIP_TOKENS
  const L = CHIP_LAYOUT
  const b = d.build
  const S = (v: number) => v * s
  const beats = beatsOf(d.beats, AI_CHIP.beats)
  cardShadow(g, c, s, d.alpha, d.path)
  const bg = g.createLinearGradient(S(-0.5), S(-0.5), S(0.5), S(0.5))
  bg.addColorStop(0, T.boardHi)
  bg.addColorStop(1, T.board)
  g.fillStyle = bg
  g.fill(d.path)
  g.strokeStyle = rgba(T.boardEdge, 0.9)
  g.lineWidth = Math.max(1, S(0.008))
  g.stroke(d.path)
  if (!(d.detailAlpha > 0) || !(b > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'
  g.lineJoin = 'round'
  // a faint inner border and scattered vias on the board
  const bk = seg(b, 0, 0.3)
  g.save()
  g.globalAlpha *= bk
  const inner = new Path2D()
  rrect(inner, S(-0.47), S(-0.47), S(0.94), S(0.94), S(0.06))
  g.strokeStyle = rgba(T.boardEdge, 0.55)
  g.lineWidth = Math.max(1, S(0.004))
  g.stroke(inner)
  for (const [x, y] of [[-0.39, -0.39], [0.39, -0.39], [0.39, 0.39], [-0.39, 0.39]] as const) {
    g.fillStyle = T.pad
    g.beginPath()
    g.arc(S(x), S(y), S(0.018), 0, TAU)
    g.fill()
    g.fillStyle = T.via
    g.beginPath()
    g.arc(S(x), S(y), S(0.008), 0, TAU)
    g.fill()
  }
  g.restore()

  // traces (four sides), drawn outward from the pins
  const sides = [0, 1, 2, 3].map((q) => {
    const ca = Math.cos((q * Math.PI) / 2)
    const sa = Math.sin((q * Math.PI) / 2)
    return chipTraces().map((tr) => tr.map(([x, y]) => [S(x * ca - y * sa), S(x * sa + y * ca)] as Pt))
  })
  const traces = sides.flat()
  traces.forEach((tr, j) => {
    const k = easeInOutCubic(seg(b, 0.4 + (j % L.pins) * 0.025, 0.85 + (j % L.pins) * 0.025))
    if (!(k > 0)) return
    g.strokeStyle = rgba('#000000', 0.25)
    g.lineWidth = S(0.019)
    partialLine(g, tr, k)
    g.strokeStyle = T.trace
    g.lineWidth = S(0.012)
    partialLine(g, tr, k)
    const pk = easeOutBack(seg(b, 0.86, 1))
    if (pk > 0) {
      const [ex, ey] = tr[tr.length - 1]!
      g.fillStyle = T.pad
      g.beginPath()
      g.arc(ex, ey, S(0.017) * pk, 0, TAU)
      g.fill()
      g.fillStyle = T.via
      g.beginPath()
      g.arc(ex, ey, S(0.007) * pk, 0, TAU)
      g.fill()
    }
  })

  // pulses running in along the traces (once the traces are drawn)
  const t0 = Math.max(beats[0]!, buildSecOf('ai-chip'))
  const arrived: number[] = new Array(traces.length).fill(0)
  if (d.since > t0) {
    traces.forEach((tr, j) => {
      const dur = AI_CHIP.pulseSec * (0.85 + 0.3 * hash01(d.seed, 500 + j))
      const gap = lerp(AI_CHIP.gapSec[0], AI_CHIP.gapSec[1], hash01(d.seed, 600 + j))
      const delay = hash01(d.seed, 700 + j) * (dur + gap)
      const local = d.since - t0 - delay
      if (!(local > 0)) return
      const m = local % (dur + gap)
      const rev = [...tr].reverse()
      if (m < dur) {
        const u = easeInCubic(m / dur) * 0.7 + (m / dur) * 0.3
        const seg0 = subLine(rev, u - 0.28, u)
        if (seg0.length > 1) {
          g.strokeStyle = rgba(c.accent, 0.28)
          g.lineWidth = S(0.034)
          partialLine(g, seg0, 1)
          g.strokeStyle = c.accent
          g.lineWidth = S(0.014)
          partialLine(g, seg0, 1)
          const [hx, hy] = seg0[seg0.length - 1]!
          g.fillStyle = mixHex(c.accent, '#ffffff', 0.6)
          g.beginPath()
          g.arc(hx, hy, S(0.011), 0, TAU)
          g.fill()
        }
      } else if (m < dur + 0.2) arrived[j] = 1 - (m - dur) / 0.2
    })
  }
  const glow = easeOutCubic(seg(d.since, beats[0]!, beats[0]! + AI_CHIP.glowSec)) * seg(b, 0.45, 0.8)

  // the package: a soft shadow, the body with a bevel, the pins
  const ck = easeOutBack(seg(b, 0.1, 0.45))
  if (ck > 0) {
    g.save()
    g.scale(0.85 + 0.15 * ck, 0.85 + 0.15 * ck)
    g.globalAlpha *= Math.min(1, ck)
    if (glow > 0) {
      const gg = g.createRadialGradient(0, 0, S(L.pkg * 0.6), 0, 0, S(L.pkg * 2.1))
      gg.addColorStop(0, rgba(c.accent, 0.5 * glow))
      gg.addColorStop(1, rgba(c.accent, 0))
      g.fillStyle = gg
      g.fillRect(S(-0.5), S(-0.5), S(1), S(1))
    }
    // pins
    const pinK = seg(b, 0.25, 0.55)
    for (let q = 0; q < 4; q++) {
      g.save()
      g.rotate((q * Math.PI) / 2)
      for (let k = 0; k < L.pins; k++) {
        const t = (k - (L.pins - 1) / 2) * L.pitch
        const len = (L.pinOut - L.pkg + 0.01) * easeOutCubic(pinK)
        const flash = arrived[q * L.pins + k]!
        const pg = g.createLinearGradient(0, S(t - 0.016), 0, S(t + 0.016))
        pg.addColorStop(0, T.pin)
        pg.addColorStop(1, T.pinDark)
        g.fillStyle = flash > 0 ? mixHex(T.pin, c.accent, flash) : pg
        g.fillRect(S(L.pkg - 0.01), S(t - 0.016), S(len), S(0.032))
      }
      g.restore()
    }
    const pkg = new Path2D()
    rrect(pkg, S(-L.pkg), S(-L.pkg), S(2 * L.pkg), S(2 * L.pkg), S(0.03))
    softShadow(g, pkg, '#000000', 0.45, S(0.025), S(0.012))
    const pg = g.createLinearGradient(S(-L.pkg), S(-L.pkg), S(L.pkg), S(L.pkg))
    pg.addColorStop(0, T.chipHi)
    pg.addColorStop(0.5, T.chip)
    pg.addColorStop(1, T.chipEdge)
    g.fillStyle = pg
    g.fill(pkg)
    g.strokeStyle = rgba('#ffffff', 0.12)
    g.lineWidth = Math.max(1, S(0.005))
    g.stroke(pkg)
    // the die: a recessed square, an accent rim when it glows
    const die = new Path2D()
    rrect(die, S(-L.die), S(-L.die), S(2 * L.die), S(2 * L.die), S(0.018))
    g.fillStyle = mixHex(T.chip, '#000000', 0.25)
    g.fill(die)
    g.strokeStyle = glow > 0 ? rgba(c.accent, 0.35 + 0.55 * glow) : rgba('#ffffff', 0.1)
    g.lineWidth = Math.max(1, S(0.008))
    g.stroke(die)
    if (glow > 0) {
      const dg = g.createRadialGradient(0, 0, 0, 0, 0, S(L.die * 1.3))
      dg.addColorStop(0, rgba(c.accent, 0.35 * glow))
      dg.addColorStop(1, rgba(c.accent, 0))
      g.fillStyle = dg
      g.fill(die)
    }
    // pin 1
    g.fillStyle = rgba('#ffffff', 0.35)
    g.beginPath()
    g.arc(S(L.pkg - 0.035), S(-L.pkg + 0.035), S(0.012), 0, TAU)
    g.fill()
    // «AI»
    const tk = seg(b, 0.45, 0.8)
    if (tk > 0) {
      g.save()
      g.globalAlpha *= tk
      g.font = `900 ${S(0.13)}px ${d.font}`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.direction = 'ltr'
      g.fillStyle = glow > 0 ? mixHex(T.label, mixHex(c.accent, '#ffffff', 0.55), glow) : T.label
      g.fillText('AI', 0, S(0.008))
      g.restore()
    }
    g.restore()
  }
  g.restore()
}

// ------------------------------------------------------------------ tool

/** Tool layout (units of the size): the gear's tooth tip / root radii, teeth, web and hub; the wrench's ring, handle and open end; the bolt. */
export const TOOL_LAYOUT = { tip: 0.47, root: 0.385, teeth: 10, web: 0.3, holes: 5, hole: 0.058, hub: 0.135, wrench: { deg: 135, ring: 0.125, hole: 0.082, len: 0.54, head: 0.12, jaw: 0.1, w0: 0.11, w1: 0.088 }, bolt: 0.07 } as const

/** The gear's outline at angle `a` (radians), units of px for size `s`. */
function gearPath(s: number, a: number): Path2D {
  const L = TOOL_LAYOUT
  const p = new Path2D()
  const n = L.teeth
  const pitch = TAU / n
  const pts: Pt[] = []
  for (let i = 0; i < n; i++) {
    const c0 = a + i * pitch
    const arc = (r: number, a0: number, a1: number, steps: number) => {
      for (let k = 0; k <= steps; k++) {
        const t = a0 + ((a1 - a0) * k) / steps
        pts.push([Math.cos(t) * r * s, Math.sin(t) * r * s])
      }
    }
    arc(L.root, c0 - 0.5 * pitch, c0 - 0.27 * pitch, 4)
    arc(L.tip, c0 - 0.17 * pitch, c0 + 0.17 * pitch, 6)
    arc(L.root, c0 + 0.27 * pitch, c0 + 0.5 * pitch, 4)
  }
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)))
  p.closePath()
  return p
}

/** A regular hexagon of circumradius r at the origin turned by `a`. */
function hexPath(r: number, a: number): Path2D {
  const p = new Path2D()
  for (let i = 0; i < 6; i++) {
    const t = a + (i * Math.PI) / 3
    if (i) p.lineTo(Math.cos(t) * r, Math.sin(t) * r)
    else p.moveTo(Math.cos(t) * r, Math.sin(t) * r)
  }
  p.closePath()
  return p
}

/**
 * Tool (Video 2, «لأدوات مفيدة»): a gear (size = its outer diameter) with a combination wrench over
 * it, the wrench's ring on the accent hex bolt at the gear's centre and its handle running down
 * to an open end past the rim — fg-tinted brushed steel with highlights, a web with lightening
 * holes. Build (0.5 s): the gear turns into place, the wrench slides onto the bolt, the bolt pops.
 * After the build the gear turns slowly (`TOOL.spinDeg`°/s); beats[0]: the wrench gives the bolt one
 * turn (a short rotation with overshoot), swings back, and three sparkles pop.
 */
export function drawTool(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const L = TOOL_LAYOUT
  const W = L.wrench
  const b = d.build
  const S = (v: number) => v * s
  const st = steelOf(c)
  const beats = beatsOf(d.beats, TOOL.beats)
  const buildSec = buildSecOf('tool')
  ghost(g, d, st.mid, seg(b, 0, 0.6))
  if (!(d.detailAlpha > 0) || !(b > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'
  g.lineJoin = 'round'

  // the gear: turns into place, then keeps turning slowly
  const gk = easeOutCubic(seg(b, 0, 0.8))
  const ga = -40 * DEG * (1 - gk) + TOOL.spinDeg * DEG * Math.max(0, d.since - buildSec)
  g.save()
  g.globalAlpha *= Math.min(1, gk * 1.5)
  g.scale(0.9 + 0.1 * gk, 0.9 + 0.1 * gk)
  const gear = gearPath(s, ga)
  const body = new Path2D()
  body.addPath(gear)
  for (let i = 0; i < L.holes; i++) {
    const a = ga + (i * TAU) / L.holes + Math.PI / L.holes
    const hx = Math.cos(a) * S((L.web + L.hub) / 2 + 0.01)
    const hy = Math.sin(a) * S((L.web + L.hub) / 2 + 0.01)
    body.moveTo(hx + S(L.hole), hy)
    body.arc(hx, hy, S(L.hole), 0, -TAU, true)
  }
  softShadow(g, gear, isLight(c) ? c.fg : '#000000', isLight(c) ? 0.14 : 0.4, S(0.03), S(0.018))
  const gg = g.createLinearGradient(S(-0.45), S(-0.45), S(0.45), S(0.45))
  gg.addColorStop(0, st.light)
  gg.addColorStop(0.5, st.mid)
  gg.addColorStop(1, st.dark)
  g.fillStyle = gg
  g.fill(body, 'evenodd')
  // the web: a recessed ring between the rim and the hub
  g.save()
  g.clip(body, 'evenodd')
  const web = new Path2D()
  web.arc(0, 0, S(L.web), 0, TAU)
  web.arc(0, 0, S(L.hub), 0, TAU, true)
  const wg = g.createLinearGradient(S(-0.3), S(-0.3), S(0.3), S(0.3))
  wg.addColorStop(0, st.dark)
  wg.addColorStop(1, st.light)
  g.fillStyle = rgba(st.dark, 0.35)
  g.fill(web, 'evenodd')
  g.strokeStyle = wg
  g.lineWidth = S(0.012)
  g.beginPath()
  g.arc(0, 0, S(L.web), 0, TAU)
  g.stroke()
  g.strokeStyle = rgba(st.hi, 0.6)
  g.lineWidth = S(0.008)
  g.beginPath()
  g.arc(0, 0, S(L.hub), 0, TAU)
  g.stroke()
  g.restore()
  // the bevel: light on the upper-left edges, dark on the lower-right
  g.save()
  g.clip(body, 'evenodd')
  g.translate(S(0.006), S(0.006))
  g.strokeStyle = rgba(st.hi, 0.9)
  g.lineWidth = S(0.012)
  g.stroke(gear)
  g.translate(S(-0.012), S(-0.012))
  g.strokeStyle = rgba(st.edge, 0.55)
  g.stroke(gear)
  g.restore()
  g.strokeStyle = rgba(st.edge, 0.8)
  g.lineWidth = Math.max(1, S(0.005))
  g.stroke(gear)
  g.restore()

  // the turn: the wrench rotates the bolt with an overshoot, holds, swings back (the bolt stays)
  const t0 = beats[0]!
  const turnK = seg(d.since, t0, t0 + TOOL.turnSec)
  const turn = TOOL.turnDeg * DEG * (turnK > 0 ? easeOutBack(turnK, 2.2) : 0)
  const back = easeInOutCubic(seg(d.since, t0 + TOOL.turnSec + TOOL.holdSec, t0 + TOOL.turnSec + TOOL.holdSec + TOOL.backSec))
  const wrenchA = W.deg * DEG + turn * (1 - back)
  const boltA = turn

  // the bolt (accent hex) on its washer
  const bk = easeOutBack(seg(b, 0.55, 0.9))
  const drawBolt = () => {
    if (!(bk > 0)) return
    g.save()
    g.scale(bk, bk)
    g.fillStyle = st.light
    g.beginPath()
    g.arc(0, 0, S(L.bolt * 1.3), 0, TAU)
    g.fill()
    g.strokeStyle = rgba(st.edge, 0.6)
    g.lineWidth = Math.max(1, S(0.005))
    g.stroke()
    const hex = hexPath(S(L.bolt), boltA + Math.PI / 6)
    const hg = g.createLinearGradient(S(-L.bolt), S(-L.bolt), S(L.bolt), S(L.bolt))
    hg.addColorStop(0, mixHex(c.accent, '#ffffff', 0.35))
    hg.addColorStop(0.55, c.accent)
    hg.addColorStop(1, mixHex(c.accent, '#000000', 0.3))
    g.fillStyle = hg
    g.fill(hex)
    g.strokeStyle = mixHex(c.accent, '#000000', 0.4)
    g.lineWidth = Math.max(1, S(0.005))
    g.stroke(hex)
    g.fillStyle = rgba('#ffffff', 0.3)
    g.beginPath()
    g.arc(0, 0, S(L.bolt * 0.55), 0, TAU)
    g.fill()
    g.restore()
  }

  // the wrench, sliding in along its handle onto the bolt
  const wk = easeOutCubic(seg(b, 0.2, 0.75))
  if (wk > 0) {
    g.save()
    g.rotate(wrenchA)
    g.translate(S(0.32 * (1 - wk)), 0)
    g.globalAlpha *= Math.min(1, wk * 1.4)
    const shape = new Path2D()
    shape.arc(0, 0, S(W.ring), 0, TAU)
    shape.moveTo(S(0.06), S(-W.w0 / 2))
    shape.lineTo(S(W.len - 0.04), S(-W.w1 / 2))
    shape.lineTo(S(W.len - 0.04), S(W.w1 / 2))
    shape.lineTo(S(0.06), S(W.w0 / 2))
    shape.closePath()
    shape.moveTo(S(W.len + W.head), 0)
    shape.arc(S(W.len), 0, S(W.head), 0, TAU)
    // holes: the ring's 12-point socket and the open end's jaw (opening outward, a little turned)
    const holes = new Path2D()
    holes.rect(S(-2), S(-2), S(4), S(4))
    holes.moveTo(S(W.hole), 0)
    holes.arc(0, 0, S(W.hole), 0, TAU)
    const jaw = new DOMMatrix().translate(S(W.len), 0).rotate(-15)
    const jawRect = new Path2D()
    jawRect.rect(S(-0.005), S(-W.jaw / 2), S(W.head + 0.05), S(W.jaw))
    holes.addPath(jawRect, jaw)
    g.save()
    g.clip(holes, 'evenodd')
    softShadow(g, shape, '#000000', isLight(c) ? 0.22 : 0.45, S(0.02), S(0.014))
    const wg = g.createLinearGradient(0, S(-W.ring), 0, S(W.ring))
    wg.addColorStop(0, st.hi)
    wg.addColorStop(0.4, st.light)
    wg.addColorStop(1, st.mid)
    g.fillStyle = wg
    g.fill(shape)
    // the handle's recessed channel
    const ch = new Path2D()
    rrect(ch, S(0.15), S(-W.w1 * 0.22), S(W.len - 0.3), S(W.w1 * 0.44), S(W.w1 * 0.22))
    g.fillStyle = rgba(st.dark, 0.45)
    g.fill(ch)
    g.strokeStyle = rgba(st.hi, 0.7)
    g.lineWidth = Math.max(1, S(0.004))
    g.stroke(ch)
    g.strokeStyle = rgba(st.edge, 0.85)
    g.lineWidth = Math.max(1, S(0.006))
    g.stroke(shape)
    g.restore()
    // the socket's inner edge
    g.strokeStyle = rgba(st.edge, 0.7)
    g.lineWidth = Math.max(1, S(0.005))
    g.beginPath()
    g.arc(0, 0, S(W.hole), 0, TAU)
    g.stroke()
    g.restore()
  }
  drawBolt()

  // three sparkles at the turn's end
  const sk = seg(d.since, t0 + TOOL.turnSec * 0.6, t0 + TOOL.turnSec * 0.6 + TOOL.sparkSec)
  if (sk > 0 && sk < 1) {
    for (let i = 0; i < 3; i++) {
      const a = wrenchA + (-75 + i * 60) * DEG + Math.PI
      const rr = S(0.17 + 0.07 * easeOutCubic(sk) + 0.02 * i)
      const k = seg(sk, i * 0.08, 0.6 + i * 0.08)
      const size = S(0.05 - 0.008 * i) * Math.sin(Math.PI * Math.min(1, k))
      sparkle(g, Math.cos(a) * rr, Math.sin(a) * rr, size, i === 1 ? mixHex(c.accent, '#ffffff', 0.5) : c.accent)
    }
  }
  g.restore()
}

// ------------------------------------------------------------------ magnifier

/** The magnifier's own colours: the lens rim and the grip. */
export const LENS_TOKENS = { rim: '#2C323A', rimHi: '#6B7480', grip: '#23282E', gripHi: '#4A535E', ferrule: '#B9C1CA', glass: '#CFE6FF' } as const

/**
 * Magnifier layout (units of the size; the card is 1.2 × 1): the header band, the rows (centre y,
 * the value, the label bar's width), the number column's left edge, the lens (centre x, radius,
 * rim) and the handle (angle, length), the check mark's points.
 */
export const MAGNIFIER_LAYOUT = {
  header: 0.2,
  rows: [
    [-0.2, '37,658', 0.3],
    [-0.02, '456', 0.22],
    [0.16, '3.3 kWh', 0.34],
    [0.34, '0.0', 0.26],
  ],
  numX: -0.5,
  lens: { x: -0.32, r: 0.19, rim: 0.028 },
  handle: { deg: 135, len: 0.25, w: 0.062 },
  check: [[0.06, 0.02], [0.19, 0.16], [0.45, -0.17]],
} as const

/** The card's table (header, row lines, values, label bars) in card units; `hl` tints row `hlRow` in accent. */
function tableArt(g: CanvasRenderingContext2D, s: number, paper: string, ink: string, accent: string, font: string, rowIn: (i: number) => number, hlRow: number, hl: number): void {
  const L = MAGNIFIER_LAYOUT
  const S = (v: number) => v * s
  const geo = OBJECT_GEOMETRY.magnifier
  const W = geo.w / 2
  const top = -geo.h / 2
  // header: a tinted band, title bars, a small bar-chart glyph
  g.fillStyle = mixHex(paper, ink, 0.05)
  g.fillRect(S(-W), S(top), S(geo.w), S(L.header))
  g.fillStyle = rgba(ink, 0.75)
  const t1 = new Path2D()
  rrect(t1, S(W - 0.08 - 0.36), S(top + 0.065), S(0.36), S(0.045), S(0.022))
  g.fill(t1)
  g.fillStyle = rgba(ink, 0.25)
  const t2 = new Path2D()
  rrect(t2, S(W - 0.08 - 0.22), S(top + 0.13), S(0.22), S(0.03), S(0.015))
  g.fill(t2)
  for (let k = 0; k < 3; k++) {
    g.fillStyle = k === 2 ? accent : rgba(ink, 0.35)
    const h = [0.05, 0.08, 0.11][k]!
    g.fillRect(S(-W + 0.08 + k * 0.035), S(top + 0.15 - h), S(0.022), S(h))
  }
  // rows
  L.rows.forEach(([y, value, lw], i) => {
    const k = rowIn(i)
    if (!(k > 0)) return
    g.save()
    g.globalAlpha *= k
    g.translate(S(0.06 * (1 - k)), 0)
    if (i === hlRow && hl > 0) {
      g.fillStyle = rgba(accent, 0.1 * hl)
      g.fillRect(S(-W), S(y - 0.09), S(geo.w), S(0.18))
    }
    g.strokeStyle = rgba(ink, 0.1)
    g.lineWidth = Math.max(1, S(0.004))
    g.beginPath()
    g.moveTo(S(-W + 0.05), S(y + 0.09))
    g.lineTo(S(W - 0.05), S(y + 0.09))
    g.stroke()
    // the label: a placeholder bar and a small dot (right, RTL)
    g.fillStyle = rgba(ink, 0.22)
    const bar = new Path2D()
    rrect(bar, S(W - 0.12 - lw), S(y - 0.018), S(lw), S(0.036), S(0.018))
    g.fill(bar)
    g.fillStyle = rgba(ink, 0.3)
    g.beginPath()
    g.arc(S(W - 0.075), S(y), S(0.018), 0, TAU)
    g.fill()
    // the value (Latin, left-aligned), the unit lighter
    const [num, unit] = value.split(' ')
    g.fillStyle = rgba(ink, 0.88)
    g.font = `800 ${S(0.085)}px ${font}`
    g.direction = 'ltr'
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    const x0 = S(L.numX + 0.06)
    g.fillText(num!, x0, S(y + 0.005))
    if (unit) {
      const nw = g.measureText(num!).width
      g.font = `700 ${S(0.05)}px ${font}`
      g.fillStyle = rgba(ink, 0.5)
      g.fillText(unit, x0 + nw + S(0.02), S(y + 0.012))
    }
    g.restore()
  })
}

/**
 * Magnifier (Video 2, «ونتحقّق من نتائجها»): a small results card, 1.2 × 1 × size — a header and a
 * mini table of four rows (RTL: label bars on the right, values on the left: «37,658», «456»,
 * «3.3 kWh», «0.0») — with a magnifying glass over it whose lens shows the card enlarged
 * (`MAGNIFIER.zoom`×, clipped to the lens). Build (0.4 s): the header, the rows slide in, the glass
 * comes in. Then the glass glides down the rows (`MAGNIFIER.rowSec` per row, back up if it goes on);
 * beats[0]: it stops on its row, an accent check mark draws over the card, then a soft ring pulses.
 */
export function drawMagnifier(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const L = MAGNIFIER_LAYOUT
  const T = LENS_TOKENS
  const M = MAGNIFIER
  const b = d.build
  const S = (v: number) => v * s
  const { paper, ink } = paperInk(c)
  const beats = beatsOf(d.beats, M.beats)
  cardShadow(g, c, s, d.alpha, d.path)
  g.fillStyle = paper
  g.fill(d.path)
  if (!(d.detailAlpha > 0) || !(b > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'
  g.lineJoin = 'round'

  // the glass's row position (in rows): eased steps down (and back up), stopping at beats[0]
  const buildSec = buildSecOf('magnifier')
  const tri = (n: number) => {
    const p = 2 * (M.rows - 1)
    const m = ((n % p) + p) % p
    return m <= M.rows - 1 ? m : p - m
  }
  const posAt = (since: number) => {
    const q = Math.max(0, since - buildSec) / M.rowSec
    const i = Math.floor(q)
    const f = easeInOutCubic(Math.min(1, (q - i) / 0.7))
    return tri(i) + (tri(i + 1) - tri(i)) * f
  }
  const t0 = beats[0]!
  let pos = posAt(Math.min(d.since, t0))
  if (d.since > t0) pos = pos + (Math.round(pos) - pos) * easeOutCubic(seg(d.since, t0, t0 + M.stopSec))
  const row = (r: number) => {
    const i = Math.max(0, Math.min(M.rows - 2, Math.floor(r)))
    return lerp(L.rows[i]![0], L.rows[i + 1]![0], r - i)
  }
  const lensK = easeOutCubic(seg(b, 0.45, 1))
  const lx = S(L.lens.x) - S(0.25) * (1 - lensK)
  const ly = S(row(pos)) + S(0.3) * (1 - lensK)
  const hlRow = Math.round(pos)
  const hl = d.since > t0 ? easeOutCubic(seg(d.since, t0, t0 + M.stopSec)) : 0.6 * (1 - Math.min(1, Math.abs(pos - hlRow) * 2))
  const rowIn = (i: number) => easeOutCubic(seg(b, 0.15 + i * 0.12, 0.55 + i * 0.12))

  g.save()
  g.clip(d.path)
  g.globalAlpha *= seg(b, 0, 0.4)
  tableArt(g, s, paper, ink, c.accent, d.font, (i) => rowIn(i), hlRow, hl)
  g.restore()

  // the glass: its shadow on the card, the enlarged card in the lens, the glass, the rim, the handle
  if (lensK > 0) {
    const R = S(L.lens.r)
    const ha = L.handle.deg * DEG
    const hx0 = lx + Math.cos(ha) * (R + S(L.lens.rim * 0.5))
    const hy0 = ly + Math.sin(ha) * (R + S(L.lens.rim * 0.5))
    const hx1 = lx + Math.cos(ha) * (R + S(L.handle.len))
    const hy1 = ly + Math.sin(ha) * (R + S(L.handle.len))
    g.save()
    g.globalAlpha *= Math.min(1, lensK * 1.5)
    // shadow (down-right, on the card)
    const sh = new Path2D()
    sh.arc(lx, ly, R + S(L.lens.rim * 0.5), 0, TAU)
    g.save()
    g.translate(S(0.025), S(0.035))
    g.strokeStyle = rgba(isLight(c) ? c.fg : '#000000', isLight(c) ? 0.1 : 0.3)
    g.lineWidth = S(L.lens.rim * 1.6)
    g.stroke(sh)
    g.lineCap = 'round'
    g.lineWidth = S(L.handle.w * 1.2)
    g.beginPath()
    g.moveTo(hx0, hy0)
    g.lineTo(hx1, hy1)
    g.stroke()
    g.restore()
    // the enlarged card
    const lens = new Path2D()
    lens.arc(lx, ly, R, 0, TAU)
    g.save()
    g.clip(lens)
    g.fillStyle = paper
    g.fill(lens)
    g.translate(lx, ly)
    g.scale(M.zoom, M.zoom)
    g.translate(-lx, -ly)
    tableArt(g, s, paper, ink, c.accent, d.font, () => 1, hlRow, hl)
    g.restore()
    // the glass: a faint cool tint, an inner shade at the rim and a highlight arc
    const tint = g.createRadialGradient(lx - R * 0.3, ly - R * 0.35, R * 0.1, lx, ly, R)
    tint.addColorStop(0, rgba('#ffffff', 0.22))
    tint.addColorStop(0.7, rgba(T.glass, 0.06))
    tint.addColorStop(1, rgba(T.rim, 0.16))
    g.fillStyle = tint
    g.fill(lens)
    g.strokeStyle = rgba('#ffffff', 0.75)
    g.lineWidth = S(0.012)
    g.beginPath()
    g.arc(lx, ly, R * 0.78, -2.6, -1.75)
    g.stroke()
    // the handle: a ferrule then the grip
    const fx = lx + Math.cos(ha) * (R + S(L.lens.rim * 0.5 + 0.05))
    const fy = ly + Math.sin(ha) * (R + S(L.lens.rim * 0.5 + 0.05))
    g.lineCap = 'butt'
    g.strokeStyle = T.ferrule
    g.lineWidth = S(L.handle.w * 0.75)
    g.beginPath()
    g.moveTo(hx0, hy0)
    g.lineTo(fx, fy)
    g.stroke()
    g.lineCap = 'round'
    g.strokeStyle = T.grip
    g.lineWidth = S(L.handle.w)
    g.beginPath()
    g.moveTo(fx + Math.cos(ha) * S(0.02), fy + Math.sin(ha) * S(0.02))
    g.lineTo(hx1, hy1)
    g.stroke()
    g.strokeStyle = rgba(T.gripHi, 0.9)
    g.lineWidth = S(L.handle.w * 0.22)
    const nx = Math.cos(ha - Math.PI / 2) * S(L.handle.w * 0.22)
    const ny = Math.sin(ha - Math.PI / 2) * S(L.handle.w * 0.22)
    g.beginPath()
    g.moveTo(fx + Math.cos(ha) * S(0.03) + nx, fy + Math.sin(ha) * S(0.03) + ny)
    g.lineTo(hx1 + nx - Math.cos(ha) * S(0.02), hy1 + ny - Math.sin(ha) * S(0.02))
    g.stroke()
    // the rim
    const rg = g.createLinearGradient(lx - R, ly - R, lx + R, ly + R)
    rg.addColorStop(0, T.rimHi)
    rg.addColorStop(0.5, T.rim)
    rg.addColorStop(1, T.rim)
    g.strokeStyle = rg
    g.lineWidth = S(L.lens.rim)
    g.beginPath()
    g.arc(lx, ly, R + S(L.lens.rim * 0.5), 0, TAU)
    g.stroke()
    g.restore()
  }

  // the check mark, then a soft ring
  const ck = seg(d.since, t0 + M.stopSec, t0 + M.stopSec + M.checkSec)
  if (ck > 0) {
    const pts = L.check.map(([x, y]) => [S(x), S(y)] as Pt)
    const rk = seg(d.since, t0 + M.stopSec + M.checkSec, t0 + M.stopSec + M.checkSec + M.ringSec)
    if (rk > 0 && rk < 1) {
      const [cx, cy] = [S(0.22), S(0.0)]
      g.strokeStyle = rgba(c.accent, 0.45 * (1 - rk))
      g.lineWidth = S(0.012) * (1 - 0.5 * rk)
      g.beginPath()
      g.arc(cx, cy, S(0.12 + 0.3 * easeOutCubic(rk)), 0, TAU)
      g.stroke()
    }
    g.strokeStyle = paper
    g.lineWidth = S(0.085)
    partialLine(g, pts, easeOutCubic(ck))
    g.strokeStyle = c.accent
    g.lineWidth = S(0.05)
    partialLine(g, pts, easeOutCubic(ck))
  }
  g.restore()
}

// ------------------------------------------------------------------ follow

/**
 * Follow layout (units of the size; the card is 1.3 × 0.8): the avatar (centre, radius), the two
 * name lines (right edge, y, length, thickness), the stats row, the button (centre, w × h), its labels.
 */
export const FOLLOW_LAYOUT = {
  avatar: { x: 0.37, y: -0.02, r: 0.2 },
  lines: [[0.1, -0.2, 0.42, 0.055], [0.1, -0.115, 0.26, 0.034]],
  /** Three stat placeholders (posts, followers, following; RTL from the right): centre x; the «+1» rises from the middle one. */
  stats: { y: -0.02, xs: [0.03, -0.17, -0.37], w: 0.1 },
  button: { x: -0.19, y: 0.17, w: 0.58, h: 0.15 },
  follow: 'تابِع',
  following: 'تتابعه',
} as const

/**
 * Follow (Video 2, «تابعني حتى تستفاد»): a profile card, 1.3 × 0.8 × size — a round avatar with a
 * generic head silhouette (no real person), two placeholder name lines and an outlined pill button
 * «تابِع» (canvas text). Build (0.4 s): the avatar pops, the lines draw in, the button pops.
 * beats[0]: a cursor-less press — the button squashes (`FOLLOW.squash` → 1 on a spring), fills
 * accent from its middle and reads «تتابعه ✓» (a drawn check); a «+1» floats up and fades, and tiny
 * confetti dots burst from the button; the avatar's ring turns accent.
 */
export function drawFollow(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const L = FOLLOW_LAYOUT
  const F = FOLLOW
  const b = d.build
  const S = (v: number) => v * s
  const { paper, ink } = paperInk(c)
  const beats = beatsOf(d.beats, F.beats)
  cardShadow(g, c, s, d.alpha, d.path)
  g.fillStyle = paper
  g.fill(d.path)
  g.strokeStyle = rgba(ink, 0.08)
  g.lineWidth = Math.max(1, S(0.004))
  g.stroke(d.path)
  if (!(d.detailAlpha > 0) || !(b > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const t0 = beats[0]!
  const tau = d.since - t0
  const done = easeOutCubic(seg(tau, F.pressSec * 0.5, F.pressSec * 0.5 + F.fillSec))

  // the avatar: a soft disc, a generic head-and-shoulders, a ring (accent once followed)
  const A = L.avatar
  const ak = easeOutBack(seg(b, 0, 0.6))
  if (ak > 0) {
    g.save()
    g.translate(S(A.x), S(A.y))
    g.scale(ak, ak)
    const disc = new Path2D()
    disc.arc(0, 0, S(A.r), 0, TAU)
    g.fillStyle = mixHex(paper, ink, 0.09)
    g.fill(disc)
    g.save()
    g.clip(disc)
    g.fillStyle = mixHex(paper, ink, 0.32)
    g.beginPath()
    g.arc(0, S(-A.r * 0.16), S(A.r * 0.36), 0, TAU)
    g.fill()
    g.beginPath()
    g.ellipse(0, S(A.r * 0.9), S(A.r * 0.68), S(A.r * 0.56), 0, 0, TAU)
    g.fill()
    g.restore()
    g.strokeStyle = done > 0 ? mixHex(mixHex(paper, ink, 0.15), c.accent, done) : mixHex(paper, ink, 0.15)
    g.lineWidth = S(0.012 + 0.006 * done)
    g.beginPath()
    g.arc(0, 0, S(A.r + 0.022), 0, TAU)
    g.stroke()
    g.restore()
  }
  // the name lines (RTL: drawn from the right)
  L.lines.forEach(([x0, y, len, th], i) => {
    const k = easeOutCubic(seg(b, 0.25 + i * 0.12, 0.7 + i * 0.12))
    if (!(k > 0)) return
    g.strokeStyle = rgba(ink, i === 0 ? 0.78 : 0.28)
    g.lineWidth = S(th)
    partialLine(g, [[S(x0 - th / 2), S(y)], [S(x0 - len + th / 2), S(y)]], k)
  })
  // the stats: a bold figure bar over a small caption bar each (the followers' tints accent once followed)
  const Sx = L.stats
  Sx.xs.forEach((x, i) => {
    const k = easeOutCubic(seg(b, 0.35 + i * 0.08, 0.75 + i * 0.08))
    if (!(k > 0)) return
    g.save()
    g.globalAlpha *= k
    g.strokeStyle = i === 1 && done > 0 ? mixHex(rgbaHex(ink, paper, 0.7), c.accent, done) : rgbaHex(ink, paper, 0.7)
    g.lineWidth = S(0.034)
    g.beginPath()
    g.moveTo(S(x + Sx.w * 0.32), S(Sx.y - 0.012))
    g.lineTo(S(x - Sx.w * 0.32), S(Sx.y - 0.012))
    g.stroke()
    g.strokeStyle = rgba(ink, 0.22)
    g.lineWidth = S(0.018)
    g.beginPath()
    g.moveTo(S(x + Sx.w * 0.5), S(Sx.y + 0.042))
    g.lineTo(S(x - Sx.w * 0.5), S(Sx.y + 0.042))
    g.stroke()
    g.restore()
  })

  // the button
  const Bt = L.button
  const bk = easeOutBack(seg(b, 0.5, 1))
  if (bk > 0) {
    const press = tau < 0 ? 1 : tau < F.pressSec ? 1 - (1 - F.squash) * easeOutCubic(tau / F.pressSec) : F.squash + (1 - F.squash) * damped(tau - F.pressSec, 0.35, 22)
    g.save()
    g.translate(S(Bt.x), S(Bt.y))
    g.scale(bk * press, bk * press)
    const pill = new Path2D()
    rrect(pill, S(-Bt.w / 2), S(-Bt.h / 2), S(Bt.w), S(Bt.h), S(Bt.h / 2))
    g.fillStyle = paper
    g.fill(pill)
    if (done > 0) {
      g.save()
      g.clip(pill)
      g.fillStyle = c.accent
      g.beginPath()
      g.arc(0, 0, S(Bt.w * 0.56) * done, 0, TAU)
      g.fill()
      g.restore()
    }
    g.strokeStyle = done > 0 ? mixHex(ink, c.accent, done) : ink
    g.lineWidth = S(0.012)
    g.stroke(pill)
    const swap = seg(tau, F.pressSec, F.pressSec + 0.14)
    const gone = seg(tau, F.pressSec * 0.5, F.pressSec + 0.04)
    if (gone < 1) {
      g.save()
      g.globalAlpha *= 1 - gone
      g.fillStyle = ink
      decoText(g, L.follow, 0, S(0.004), S(0.075), S(Bt.w - 0.08), d.font, 800, 'rtl', 'center')
      g.restore()
    }
    if (swap > 0) {
      g.save()
      g.globalAlpha *= swap
      g.font = `800 ${S(0.066)}px ${d.font}`
      const tw = Math.min(S(Bt.w - 0.16), g.measureText(L.following).width)
      const cw = S(0.05)
      const gap = S(0.018)
      const total = tw + gap + cw
      g.fillStyle = '#ffffff'
      decoText(g, L.following, total / 2, S(0.004), S(0.066), S(Bt.w - 0.16), d.font, 800, 'rtl', 'right')
      // ✓ after the word (RTL: to its left), drawn
      const cx0 = -total / 2
      g.strokeStyle = '#ffffff'
      g.lineWidth = S(0.014)
      partialLine(g, [[cx0, S(0.0)], [cx0 + cw * 0.36, S(0.026)], [cx0 + cw, S(-0.03)]], easeOutCubic(seg(tau, F.pressSec + 0.06, F.pressSec + 0.26)))
      g.restore()
    }
    g.restore()

    // confetti and the «+1»
    if (tau > 0) {
      const ck = tau / F.confettiSec
      if (ck < 1) {
        const tones = [c.accent, '#FFC94A', mixHex(c.accent, '#ffffff', 0.45), rgba(ink, 0.55)]
        for (let i = 0; i < F.confetti; i++) {
          const a = (-165 + 150 * hash01(d.seed, 900 + i)) * DEG
          const v = 0.5 + 0.55 * hash01(d.seed, 920 + i)
          const t = tau
          const x = S(Bt.x) + Math.cos(a) * S(v) * t * 1.0
          const y = S(Bt.y - 0.02) + Math.sin(a) * S(v) * t * 1.0 + S(0.9) * t * t
          const r = S(0.008 + 0.008 * hash01(d.seed, 940 + i))
          g.save()
          g.globalAlpha *= 1 - seg(ck, 0.55, 1)
          g.fillStyle = tones[i % tones.length]!
          g.translate(x, y)
          if (i % 3 === 0) {
            g.rotate(a + t * 9)
            g.fillRect(-r, -r * 0.5, 2 * r, r)
          } else {
            g.beginPath()
            g.arc(0, 0, r * 0.8, 0, TAU)
            g.fill()
          }
          g.restore()
        }
      }
      const pk = seg(tau, 0.05, 0.05 + F.plusSec)
      if (pk > 0 && pk < 1) {
        g.save()
        g.globalAlpha *= Math.min(1, pk * 5) * (1 - seg(pk, 0.55, 1))
        g.fillStyle = c.accent
        g.font = `900 ${S(0.075)}px ${d.font}`
        g.direction = 'ltr'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText('+1', S(Bt.x - Bt.w / 2 - 0.02), S(Bt.y - 0.1 - 0.18 * easeOutCubic(pk)))
        g.restore()
      }
    }
  }
  g.restore()
}

// ------------------------------------------------------------------ compass

/** The compass's cardinal letters (Arabic): north, east, south, west, clockwise from the top. */
export const COMPASS_LETTERS = ['ش', 'ق', 'ج', 'غ'] as const

/**
 * Compass (Video 2, «واتجاه الشمال»): a compass, size = its bezel's diameter — a brushed-steel
 * bezel, a face with ticks every 5° (longer every 10° and 30°), a faint eight-point rose, the four
 * letters ش / ق / ج / غ, and a needle (accent north half, ink south half) on a steel pivot, under
 * a glass highlight. Build (0.4 s): the bezel, the ticks sweep round, the letters pop, the needle
 * comes in. From `COMPASS.swingFrom` the needle swings in a damped oscillation (seeded side) and is
 * settled on «ش» by beats[0]; then «ش» lights in accent with a soft glow.
 */
export function drawCompass(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const b = d.build
  const S = (v: number) => v * s
  const st = steelOf(c)
  const { paper, ink } = paperInk(c)
  const beats = beatsOf(d.beats, COMPASS.beats)
  const t0 = beats[0]!
  // the bezel is the body
  if (isLight(c)) softShadow(g, d.path, c.fg, 0.16 * Math.min(1, d.alpha), S(0.035), S(0.02))
  else softShadow(g, d.path, '#000000', 0.4 * Math.min(1, d.alpha), S(0.035), S(0.02))
  const bz = g.createLinearGradient(S(-0.5), S(-0.5), S(0.5), S(0.5))
  bz.addColorStop(0, st.hi)
  bz.addColorStop(0.45, st.mid)
  bz.addColorStop(1, st.dark)
  g.fillStyle = bz
  g.fill(d.path)
  if (!(d.detailAlpha > 0) || !(b > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'
  const fr = 0.43
  const fk = easeOutCubic(seg(b, 0, 0.4))
  // the face (recessed: a dark inner edge, then the paper)
  g.save()
  g.globalAlpha *= fk
  g.fillStyle = st.edge
  g.beginPath()
  g.arc(0, 0, S(fr + 0.012), 0, TAU)
  g.fill()
  const face = g.createRadialGradient(S(-0.08), S(-0.1), S(0.05), 0, 0, S(fr))
  face.addColorStop(0, mixHex(paper, '#ffffff', 0.3))
  face.addColorStop(0.8, paper)
  face.addColorStop(1, mixHex(paper, ink, 0.12))
  g.fillStyle = face
  g.beginPath()
  g.arc(0, 0, S(fr), 0, TAU)
  g.fill()
  g.restore()
  // the rose
  const rk = easeOutCubic(seg(b, 0.3, 0.8))
  if (rk > 0) {
    g.save()
    g.globalAlpha *= rk
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 4
      const len = S(i % 2 ? 0.14 : 0.24)
      const w = S(0.035)
      g.fillStyle = rgba(ink, i % 2 ? 0.06 : 0.09)
      g.beginPath()
      g.moveTo(Math.cos(a) * len, Math.sin(a) * len)
      g.lineTo(Math.cos(a + Math.PI / 2) * w, Math.sin(a + Math.PI / 2) * w)
      g.lineTo(0, 0)
      g.lineTo(Math.cos(a - Math.PI / 2) * w, Math.sin(a - Math.PI / 2) * w)
      g.closePath()
      g.fill()
    }
    g.restore()
  }
  // the ticks sweep round
  const tk = seg(b, 0.1, 0.7)
  const light = easeOutCubic(seg(d.since, t0, t0 + COMPASS.lightSec))
  for (let i = 0; i < 72; i++) {
    if (!(i / 72 < tk)) break
    const a = -Math.PI / 2 + (i * TAU) / 72
    const major = i % 6 === 0
    const mid = i % 2 === 0
    const len = major ? 0.05 : mid ? 0.03 : 0.018
    g.strokeStyle = i === 0 && light > 0 ? mixHex(ink, c.accent, light) : rgba(ink, major ? 0.8 : 0.45)
    g.lineWidth = S(major ? 0.009 : 0.005)
    g.beginPath()
    g.moveTo(Math.cos(a) * S(fr - 0.015), Math.sin(a) * S(fr - 0.015))
    g.lineTo(Math.cos(a) * S(fr - 0.015 - len), Math.sin(a) * S(fr - 0.015 - len))
    g.stroke()
  }
  // the letters
  COMPASS_LETTERS.forEach((ch, i) => {
    const k = easeOutBack(seg(b, 0.4 + i * 0.08, 0.8 + i * 0.08))
    if (!(k > 0)) return
    const a = -Math.PI / 2 + (i * Math.PI) / 2
    const x = Math.cos(a) * S(0.29)
    const y = Math.sin(a) * S(0.29)
    g.save()
    g.translate(x, y)
    g.scale(k, k)
    if (i === 0 && light > 0) {
      const gl = g.createRadialGradient(0, 0, 0, 0, 0, S(0.09))
      gl.addColorStop(0, rgba(c.accent, 0.3 * light))
      gl.addColorStop(1, rgba(c.accent, 0))
      g.fillStyle = gl
      g.beginPath()
      g.arc(0, 0, S(0.09), 0, TAU)
      g.fill()
    }
    g.fillStyle = i === 0 && light > 0 ? mixHex(ink, c.accent, light) : rgba(ink, 0.85)
    decoText(g, ch, 0, S(0.004), S(i === 0 ? 0.1 + 0.015 * light : 0.085), S(0.14), d.font, 900, 'rtl', 'center')
    g.restore()
  })

  // the needle: swings (damped), then is held exactly on «ش» from beats[0]
  const nk = easeOutCubic(seg(b, 0.3, 0.75))
  if (nk > 0) {
    const tt = Math.max(0, d.since - COMPASS.swingFrom)
    const side = hash01(d.seed, 77) < 0.5 ? -1 : 1
    const zw = COMPASS.zeta * COMPASS.omega
    const wd = COMPASS.omega * Math.sqrt(1 - COMPASS.zeta * COMPASS.zeta)
    const osc = side * COMPASS.swingDeg * DEG * Math.exp(-zw * tt) * Math.cos(wd * tt)
    const theta = osc * (1 - easeInOutCubic(seg(d.since, t0 - 0.3, t0)))
    g.save()
    g.globalAlpha *= nk
    g.rotate(theta)
    const len = S(0.22)
    const w = S(0.05)
    const tri = (y: number, x: number) => polyPath([[0, y], [x, 0], [0, 0]])
    softShadow(g, polyPath([[0, -len], [w, 0], [0, len], [-w, 0]]), '#000000', 0.18, S(0.012), S(0.012))
    g.fillStyle = mixHex(c.accent, '#ffffff', 0.18)
    g.fill(tri(-len, -w))
    g.fillStyle = mixHex(c.accent, '#000000', 0.18)
    g.fill(tri(-len, w))
    g.fillStyle = mixHex(ink, paper, 0.25)
    g.fill(tri(len, -w))
    g.fillStyle = mixHex(ink, paper, 0.45)
    g.fill(tri(len, w))
    g.restore()
    // the pivot cap
    const pc = g.createRadialGradient(S(-0.01), S(-0.012), 0, 0, 0, S(0.034))
    pc.addColorStop(0, st.hi)
    pc.addColorStop(1, st.dark)
    g.fillStyle = pc
    g.beginPath()
    g.arc(0, 0, S(0.032) * nk, 0, TAU)
    g.fill()
  }
  // the glass highlight and the bezel's inner shine
  g.save()
  g.globalAlpha *= fk
  g.strokeStyle = rgba('#ffffff', 0.55)
  g.lineWidth = S(0.014)
  g.beginPath()
  g.arc(0, 0, S(fr - 0.04), -2.65, -1.95)
  g.stroke()
  g.strokeStyle = rgba(st.hi, 0.7)
  g.lineWidth = S(0.006)
  g.beginPath()
  g.arc(0, 0, S(0.49), -2.9, -1.2)
  g.stroke()
  g.restore()
  g.restore()
}

// ------------------------------------------------------------------ receipt

/**
 * Receipt layout (units of the size; the slip is 0.75 × 1.1): the header «طلبية شراء», the item
 * lines (y, label bar width, price), the total, the barcode, the strike (from → to), the stamp.
 */
export const RECEIPT_LAYOUT = {
  title: 'طلبية شراء',
  items: [[-0.25, 0.24, '1,250'], [-0.17, 0.18, '480'], [-0.09, 0.27, '2,100'], [-0.01, 0.2, '760']],
  total: { y: 0.11, label: 'المجموع', value: '4,590' },
  barcode: { y0: 0.24, y1: 0.36, w: 0.5, bars: 34 },
  strike: [[0.31, -0.47], [-0.31, 0.14]],
  stamp: { x: 0.0, y: 0.27, w: 0.62, h: 0.2, deg: -11, text: 'تقدير أولي', size: 0.095 },
} as const

/**
 * Receipt (Video 2, «تقديرات أولية… مو طلبية شراء جاهزة»): a purchase-order slip, 0.75 × 1.1 ×
 * size, with a zig-zag torn bottom — a header «طلبية شراء» (canvas text), dashed rules, item lines
 * (label bars on the right, Latin prices on the left), a bold total and a barcode. Build (0.4 s): it
 * prints downward (revealed top to bottom, feeding out from its top edge). beats[0]: a big accent
 * strike draws across it, then the rotated stamp «تقدير أولي» (accent outline, worn ink) slams on
 * from `RECEIPT.stampFrom`× with a squash, jolting the slip.
 */
export function drawReceipt(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const L = RECEIPT_LAYOUT
  const geo = OBJECT_GEOMETRY.receipt
  const b = d.build
  const S = (v: number) => v * s
  const { paper, ink } = paperInk(c)
  const beats = beatsOf(d.beats, RECEIPT.beats)
  const t0 = beats[0]!
  const print = easeInOutCubic(b)
  // the blank slip while it prints (the morph's body), faint below the print head
  const ga = Math.max(1 - print, 1 - d.detailAlpha)
  if (ga > 0) {
    g.fillStyle = rgba(mixHex(c.bg, paper, 0.35), ga)
    g.fill(d.path)
  }
  if (!(d.detailAlpha > 0) || !(b > 0)) return
  const top = -geo.h / 2
  const W = geo.w / 2
  const stampAt = t0 + RECEIPT.stampAfter
  const impact = d.since - stampAt - RECEIPT.stampSec
  const jolt = impact > 0 ? Math.exp(-16 * impact) * Math.sin(40 * impact) : 0
  g.save()
  g.globalAlpha *= d.detailAlpha
  // printed top → bottom: everything above the print head shows
  const head = S(top) + S(geo.h + 0.03) * print
  g.save()
  if (print < 1) {
    g.beginPath()
    g.rect(-s, -s, 2 * s, head + s)
    g.clip()
  }
  g.translate(0, S(0.012) * jolt)
  cardShadow(g, c, s, print, d.path)
  g.fillStyle = paper
  g.fill(d.path)
  g.lineCap = 'round'
  // a faint thermal-paper curl shade at the top
  const curl = g.createLinearGradient(0, S(top), 0, S(top + 0.06))
  curl.addColorStop(0, rgba(ink, 0.07))
  curl.addColorStop(1, rgba(ink, 0))
  g.fillStyle = curl
  g.fillRect(S(-W), S(top), S(geo.w), S(0.06))
  // header
  g.fillStyle = rgba(ink, 0.9)
  decoText(g, L.title, 0, S(top + 0.1), S(0.075), S(geo.w - 0.12), d.font, 900, 'rtl', 'center')
  g.fillStyle = rgba(ink, 0.3)
  const sub = new Path2D()
  rrect(sub, S(-0.13), S(top + 0.16), S(0.26), S(0.022), S(0.011))
  g.fill(sub)
  const dashed = (y: number) => {
    g.strokeStyle = rgba(ink, 0.35)
    g.lineWidth = Math.max(1, S(0.005))
    g.setLineDash([S(0.018), S(0.012)])
    g.beginPath()
    g.moveTo(S(-W + 0.05), S(y))
    g.lineTo(S(W - 0.05), S(y))
    g.stroke()
    g.setLineDash([])
  }
  dashed(top + 0.22)
  // items: label bars (right) and prices (left)
  for (const [y, lw, price] of L.items) {
    g.fillStyle = rgba(ink, 0.32)
    const bar = new Path2D()
    rrect(bar, S(W - 0.06 - lw), S(y - 0.014), S(lw), S(0.028), S(0.014))
    g.fill(bar)
    g.fillStyle = rgba(ink, 0.72)
    decoText(g, price, S(-W + 0.06), S(y + 0.003), S(0.045), S(0.2), d.font, 700, 'ltr', 'left')
  }
  dashed(0.05)
  // the total
  g.fillStyle = rgba(ink, 0.9)
  decoText(g, L.total.label, S(W - 0.06), S(L.total.y), S(0.055), S(0.3), d.font, 900, 'rtl', 'right')
  decoText(g, L.total.value, S(-W + 0.06), S(L.total.y + 0.003), S(0.06), S(0.26), d.font, 900, 'ltr', 'left')
  dashed(0.18)
  // the barcode
  const Bc = L.barcode
  let x = -Bc.w / 2
  const unit = Bc.w / (Bc.bars * 1.6)
  g.fillStyle = rgba(ink, 0.8)
  for (let i = 0; i < Bc.bars && x < Bc.w / 2; i++) {
    const w = unit * (0.6 + 1.6 * hash01(17, 800 + i))
    if (i % 2 === 0) g.fillRect(S(x), S(Bc.y0), Math.max(1, S(w)), S(Bc.y1 - Bc.y0))
    x += w + unit * (0.4 + 0.6 * hash01(17, 850 + i))
  }
  g.fillStyle = rgba(ink, 0.3)
  const thanks = new Path2D()
  rrect(thanks, S(-0.16), S(0.42), S(0.32), S(0.02), S(0.01))
  g.fill(thanks)

  // the strike: a big accent marker stroke across the slip
  const sk = easeOutCubic(seg(d.since, t0, t0 + RECEIPT.strikeSec))
  if (sk > 0) {
    const [[x0, y0], [x1, y1]] = L.strike
    const pts: Pt[] = []
    for (let i = 0; i <= 20; i++) {
      const u = i / 20
      pts.push([S(lerp(x0, x1, u) + 0.006 * Math.sin(u * 9 + 1)), S(lerp(y0, y1, u) + 0.008 * Math.sin(u * 7))])
    }
    g.strokeStyle = rgba(c.accent, 0.92)
    g.lineWidth = S(0.045)
    partialLine(g, pts, sk)
    g.strokeStyle = rgba(mixHex(c.accent, '#000000', 0.15), 0.5)
    g.lineWidth = S(0.012)
    partialLine(g, pts.map(([px, py]) => [px + S(0.006), py + S(0.012)] as Pt), sk)
  }
  // the stamp
  const tau = d.since - stampAt
  if (tau >= 0) rubberStamp(g, s, c.accent, paper, d.font, d.seed, L.stamp, seg(tau, 0, RECEIPT.stampSec), RECEIPT.stampFrom, impact, 0.86)
  g.restore()
  // the print head: a thin dark bar across the slip at the edge of the printing
  const pa = 1 - seg(print, 0.85, 1)
  if (pa > 0) {
    const bar = new Path2D()
    rrect(bar, S(-W - 0.03), head - S(0.008), S(geo.w + 0.06), S(0.016), S(0.008))
    g.fillStyle = rgba(isLight(c) ? c.fg : '#000000', 0.75 * pa)
    g.fill(bar)
    g.fillStyle = rgba(c.accent, 0.8 * pa)
    g.fillRect(S(-W), head - S(0.002), S(geo.w), Math.max(1, S(0.004)))
  }
  g.restore()
}
