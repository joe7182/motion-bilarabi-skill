/**
 * Canvas drawing of the house reel's objects (Stage 1A, «لا تبني بيتك…»): the Iraqi brick, a
 * two-storey Iraqi house traced like an elevation, an engineer's plan sheet whose numbers turn to
 * noise, the eye that has not seen it, the photo of the plan and the chat that sends it to Claude
 * and gets the house back drawn. Same contract as `objects-draw.ts`: every function draws centred
 * on the context's origin (the caller translates and squashes), is a pure function of its
 * arguments (`since`, `build`, `seed`; no clocks, no unseeded randomness), reads colours as resolved hex
 * values, draws the body on `d.path` and gates its details on `build` / `detailAlpha`. Canvas text
 * is decoration (the canvas is `aria-hidden`). Our own drawing.
 */
import type { Pt } from '../core/morph'
import { BRICK_VARIANTS, brickCorners, brickVariantOf, eyeLids, houseCorners, OBJECT_GEOMETRY, roundedPolygon, type BrickVariant } from '../core/objects'
import { easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../core/ease'
import { BANKNOTE, BLUEPRINT, BRICK, buildSecOf, CHAT, EYE, HOUSE, PHOTO, softSpring } from '../core/params/morph-object'
import { rgba } from './materials'
import { decoText, hash01, liftShadowPath, lum, mixHex, paperInk, partialLine, rrect, softShadow, type ObjectColours, type ObjectDraw } from './objects-draw'

const TAU = Math.PI * 2

/** `pts` (units of the size) scaled by `s`. */
const scaled = (pts: readonly Pt[], s: number): Pt[] => pts.map(([x, y]) => [x * s, y * s] as Pt)

/** A path through `pts` (closed unless `open`). */
function polyPath(pts: readonly Pt[], open = false): Path2D {
  const p = new Path2D()
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)))
  if (!open) p.closePath()
  return p
}

/** The four corners of the rectangle [x0, y0, x1, y1] as a closed polyline (top-left first, clockwise). */
const rectLine = ([x0, y0, x1, y1]: readonly number[], s: number): Pt[] => [
  [x0! * s, y0! * s],
  [x1! * s, y0! * s],
  [x1! * s, y1! * s],
  [x0! * s, y1! * s],
  [x0! * s, y0! * s],
]

// ------------------------------------------------------------------ brick

/** The brick's own colours (the same in every world): its three faces, a dark edge and a highlight. */
export const BRICK_TOKENS = { top: '#E38B5E', front: '#C4592F', end: '#9E4424', edge: '#6A2711', light: '#F7BE98' } as const

/**
 * Stage 2 variant colours: the Gulf brick paler and sandier, the thermostone block a light
 * aerated-concrete grey (the Iraqi and the measured brick use `BRICK_TOKENS`).
 */
export const BRICK_VARIANT_TOKENS: Record<BrickVariant, { top: string; front: string; end: string; edge: string; light: string }> = {
  iraqi: BRICK_TOKENS,
  measure: BRICK_TOKENS,
  gulf: { top: '#EFC7A0', front: '#D99668', end: '#B5764A', edge: '#7A4626', light: '#FCE4CD' },
  thermostone: { top: '#EEEEE9', front: '#D6D6CF', end: '#B3B3AC', edge: '#6B6B66', light: '#FFFFFF' },
}

/**
 * Brick (Stage 1A, «طابوقة»): the Iraqi brick in a 3/4 view from above-front, 1 × 0.62 × size —
 * a lit top face, the front face and the darker right end face (`BRICK_TOKENS`), seeded speckle,
 * soft bevels, a thin highlight on the top-front edge, one shallow frog in the top face (two deep holes read as a concrete block) and
 * a soft contact shadow below. Build: its edges ink-draw in the world's fg, then the faces fill in
 * and the lines settle into the brick's own dark edge. With `text: 'fall'`, faint speed streaks
 * show above it for `BRICK.streakSec` after arrival. Layout in units of the size; the frogs in
 * (u along the front edge, v into the depth) of the top face.
 *
 * Stage 2 variants by `text` (`BRICK_VARIANTS`): `'gulf'` a slightly larger, paler cored brick with
 * three round holes through its top; `'thermostone'` a large light-grey aerated block (≈ 1.3× as
 * wide) with fine pores and crisp edges; `'measure'` the Iraqi brick with dimension arrows on its
 * three edges («24», «11.5», «7.5»). The variant scales the brick's own outline; a move between two
 * brick states crossfades the face details (`textMix`).
 */
export const BRICK_LAYOUT = {
  frogs: [[0.28, 0.72]],
  frogV: [0.34, 0.66],
  frogDepth: 0.025,
  speckles: 54,
  line: 0.0085,
  shadow: { x: -0.04, y: 0.315, rx: 0.6, ry: 0.07 },
  streak: { x0: -0.36, x1: 0.44, gap: 0.05, len: [0.16, 0.4], width: 0.0075 },
  /** Gulf brick: three cores along the top face's middle (u), radius (units of the size), visible depth. */
  cores: { u: [0.21, 0.5, 0.79], v: 0.5, r: 0.058, depth: 0.04 },
  /** Thermostone: fine pores on the top face (fewer on the others). */
  pores: 150,
  /** Measure: dimension lines `off` outside the edges; labels in cm (length, depth, height). */
  dims: { off: 0.075, labels: ['24', '11.5', '7.5'] },
} as const

/** The three faces of a brick variant (top, front, end), inside the body: gradients, texture, holes, bevels. */
function brickFaces(g: CanvasRenderingContext2D, s: number, v: BrickVariant, seed: number): void {
  const T = BRICK_VARIANT_TOKENS[v]
  const L = BRICK_LAYOUT
  const geo = OBJECT_GEOMETRY.brick
  const [D, C, E, F, G, A] = brickCorners() as [Pt, Pt, Pt, Pt, Pt, Pt]
  const B: Pt = [A[0] + geo.front.w, A[1]]
  const stone = v === 'thermostone'
  const faces: { pts: Pt[]; from: string; to: string; g0: Pt; g1: Pt }[] = [
    { pts: [A, B, C, D], from: mixHex(T.top, T.light, 0.3), to: mixHex(T.top, T.front, 0.25), g0: D, g1: B },
    { pts: [A, B, F, G], from: mixHex(T.front, T.top, 0.12), to: mixHex(T.front, T.end, 0.35), g0: A, g1: G },
    { pts: [B, C, E, F], from: mixHex(T.end, T.front, 0.15), to: mixHex(T.end, T.edge, 0.3), g0: C, g1: F },
  ]
  faces.forEach((f, fi) => {
    const path = polyPath(scaled(f.pts, s))
    g.save()
    g.clip(path)
    const gr = g.createLinearGradient(f.g0[0] * s, f.g0[1] * s, f.g1[0] * s, f.g1[1] * s)
    gr.addColorStop(0, f.from)
    gr.addColorStop(1, f.to)
    g.fillStyle = gr
    g.fill(path)
    // a few soft blotches and the speckle (or the pores): seeded points of the face (u, w), pure in the seed
    const [p0, p1, , p3] = f.pts as [Pt, Pt, Pt, Pt]
    const at = (u: number, w: number): Pt => [(p0[0] + (p1[0] - p0[0]) * u + (p3[0] - p0[0]) * w) * s, (p0[1] + (p1[1] - p0[1]) * u + (p3[1] - p0[1]) * w) * s]
    const blotches = stone ? 2 : 4
    for (let i = 0; i < blotches; i++) {
      const [x, y] = at(hash01(seed, 600 + fi * 10 + i), hash01(seed, 640 + fi * 10 + i))
      const rb = (0.08 + 0.07 * hash01(seed, 680 + fi * 10 + i)) * s
      const bl = g.createRadialGradient(x, y, 0, x, y, rb)
      const tone = stone ? (i % 2 ? '#6b6b66' : '#ffffff') : i % 2 ? '#3a1205' : '#ffe2cc'
      bl.addColorStop(0, rgba(tone, stone || v === 'gulf' ? 0.06 : 0.09))
      bl.addColorStop(1, rgba(tone, 0))
      g.fillStyle = bl
      g.fillRect(x - rb, y - rb, 2 * rb, 2 * rb)
    }
    if (stone) {
      // aerated concrete: many fine pores, each a dark pit with a light lower lip
      const count = Math.round(L.pores * [1, 0.9, 0.5][fi]!)
      for (let i = 0; i < count; i++) {
        const [x, y] = at(hash01(seed, 2000 + fi * 300 + i), hash01(seed, 2400 + fi * 300 + i))
        const pr = (0.0028 + 0.005 * hash01(seed, 2800 + fi * 300 + i) ** 2) * s
        g.fillStyle = rgba('#55554f', 0.42)
        g.beginPath()
        g.arc(x, y, pr, 0, TAU)
        g.fill()
        g.fillStyle = rgba('#ffffff', 0.55)
        g.beginPath()
        g.arc(x, y + pr * 0.7, pr * 0.55, 0, Math.PI)
        g.fill()
      }
    } else {
      const count = Math.round(L.speckles * [1, 0.85, 0.45][fi]! * (v === 'gulf' ? 0.6 : 1))
      const dark = v === 'gulf' ? '#5a2c12' : '#4a1606'
      for (let i = 0; i < count; i++) {
        const h = hash01(seed, 700 + fi * 100 + i)
        const [x, y] = at(hash01(seed, 1000 + fi * 100 + i), hash01(seed, 1300 + fi * 100 + i))
        g.fillStyle = h < 0.58 ? rgba(dark, (0.3 + 0.2 * h) * (v === 'gulf' ? 0.7 : 1)) : rgba('#ffd6b8', 0.28 + 0.2 * (h - 0.58))
        g.beginPath()
        g.arc(x, y, (0.003 + 0.0055 * hash01(seed, 1600 + fi * 100 + i)) * s, 0, TAU)
        g.fill()
      }
    }
    g.restore()
  })

  const Q = (u: number, w: number): Pt => [(A[0] + (B[0] - A[0]) * u + (D[0] - A[0]) * w) * s, (A[1] + (B[1] - A[1]) * u + (D[1] - A[1]) * w) * s]
  if (v === 'iraqi' || v === 'measure') {
    // the frog holes: a darker floor, the far inner wall (facing us, lit like the front), the
    // left inner wall (facing right, shaded like the end), a light lip on the near rims
    const [v0, v1] = L.frogV
    const hf = L.frogDepth * s
    for (const [u0, u1] of L.frogs) {
      const hole = polyPath([Q(u0, v0), Q(u1, v0), Q(u1, v1), Q(u0, v1)])
      g.save()
      g.clip(hole)
      g.fillStyle = mixHex(T.top, T.end, 0.55)
      g.fill(hole)
      const far0 = Q(u0, v1)
      const far1 = Q(u1, v1)
      g.fillStyle = mixHex(T.front, T.end, 0.15)
      g.fill(polyPath([far0, far1, [far1[0], far1[1] + hf], [far0[0], far0[1] + hf]]))
      const n0 = Q(u0, v0)
      g.fillStyle = mixHex(T.end, T.edge, 0.25)
      g.fill(polyPath([n0, far0, [far0[0], far0[1] + hf], [n0[0], n0[1] + hf]]))
      g.restore()
      g.strokeStyle = rgba(T.light, 0.7)
      g.lineWidth = 0.006 * s
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(...Q(u0, v0))
      g.lineTo(...Q(u1, v0))
      g.lineTo(...Q(u1, v1))
      g.stroke()
    }
  } else if (v === 'gulf') {
    // three round cores through the top, drawn in the top face's own plane (an affine image of a
    // circle): a dark well, the far inner wall lit, a light near rim
    const Cr = L.cores
    const ux = (B[0] - A[0]) * s, uy = (B[1] - A[1]) * s
    const vx = (D[0] - A[0]) * s, vy = (D[1] - A[1]) * s
    const ru = Cr.r / geo.front.w
    const rv = Cr.r / Math.hypot(geo.depth.x, geo.depth.y)
    for (const u of Cr.u) {
      const [cx, cy] = Q(u, Cr.v)
      const disc = new Path2D()
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * TAU
        const du = Math.cos(a) * ru, dv = Math.sin(a) * rv
        const x = cx + du * ux + dv * vx, y = cy + du * uy + dv * vy
        if (i) disc.lineTo(x, y)
        else disc.moveTo(x, y)
      }
      disc.closePath()
      g.save()
      g.clip(disc)
      g.fillStyle = mixHex(T.front, T.end, 0.25)
      g.fill(disc)
      // the near rim's shadow falls into the well: the disc shifted down by the visible depth
      g.translate(0, Cr.depth * s)
      g.fillStyle = mixHex(T.end, T.edge, 0.75)
      g.fill(disc)
      g.restore()
      g.strokeStyle = rgba(T.light, 0.8)
      g.lineWidth = 0.006 * s
      g.stroke(disc)
    }
  }

  // bevels: a soft light band along the top-front edge on both faces, then the edges themselves
  g.save()
  g.clip(polyPath(scaled([A, B, F, G], s)))
  const bv = g.createLinearGradient(0, A[1] * s, 0, (A[1] + 0.05) * s)
  bv.addColorStop(0, rgba(T.light, stone ? 0.3 : 0.42))
  bv.addColorStop(1, rgba(T.light, 0))
  g.fillStyle = bv
  g.fillRect(A[0] * s, A[1] * s, geo.front.w * s, 0.05 * s)
  g.restore()
  g.lineCap = 'round'
  g.strokeStyle = rgba(T.light, 0.95)
  g.lineWidth = (stone ? 0.008 : 0.011) * s
  partialLine(g, scaled([A, B], s), 1)
  g.strokeStyle = rgba(T.light, 0.5)
  g.lineWidth = 0.007 * s
  partialLine(g, scaled([B, C], s), 1)
  g.strokeStyle = rgba(T.edge, stone ? 0.5 : 0.32)
  g.lineWidth = (stone ? 0.005 : 0.006) * s
  partialLine(g, scaled([B, F], s), 1)
}

/** The measured brick's dimension lines (length, depth, height) at progress `k` (0..1), alpha `a`. */
function brickDims(g: CanvasRenderingContext2D, s: number, c: ObjectColours, font: string, k: number, a: number): void {
  if (!(k > 0) || !(a > 0)) return
  const L = BRICK_LAYOUT.dims
  const [, , E, F, G, A] = brickCorners() as [Pt, Pt, Pt, Pt, Pt, Pt]
  const off = L.off
  // the depth edge's outward normal (down-right, away from the brick)
  const ex = E[0] - F[0], ey = E[1] - F[1], el = Math.hypot(ex, ey)
  const dims: { p: Pt; q: Pt; n: Pt; label: string }[] = [
    { p: G, q: F, n: [0, 1], label: L.labels[0] },
    { p: F, q: E, n: [-ey / el, ex / el], label: L.labels[1] },
    { p: G, q: A, n: [-1, 0], label: L.labels[2] },
  ]
  if (dims[1]!.n[0] < 0) dims[1]!.n = [-dims[1]!.n[0], -dims[1]!.n[1]]
  g.save()
  g.globalAlpha *= a
  g.strokeStyle = rgba(c.fg, 0.85)
  g.fillStyle = c.fg
  g.lineWidth = Math.max(1, 0.0055 * s)
  g.lineCap = 'round'
  dims.forEach((dm, i) => {
    const ki = easeOutCubic(seg(k, i * 0.18, 0.55 + i * 0.18))
    if (!(ki > 0)) return
    const P: Pt = [(dm.p[0] + dm.n[0] * off) * s, (dm.p[1] + dm.n[1] * off) * s]
    const Q: Pt = [(dm.q[0] + dm.n[0] * off) * s, (dm.q[1] + dm.n[1] * off) * s]
    // extension lines from the corners out past the dimension line
    g.save()
    g.globalAlpha *= 0.6
    for (const e of [dm.p, dm.q]) {
      g.beginPath()
      g.moveTo((e[0] + dm.n[0] * 0.018) * s, (e[1] + dm.n[1] * 0.018) * s)
      g.lineTo((e[0] + dm.n[0] * (0.018 + (off + 0.002) * ki)) * s, (e[1] + dm.n[1] * (0.018 + (off + 0.002) * ki)) * s)
      g.stroke()
    }
    g.restore()
    // the line grows from its middle out to both arrowheads
    const M: Pt = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2]
    const P1: Pt = [M[0] + (P[0] - M[0]) * ki, M[1] + (P[1] - M[1]) * ki]
    const Q1: Pt = [M[0] + (Q[0] - M[0]) * ki, M[1] + (Q[1] - M[1]) * ki]
    g.beginPath()
    g.moveTo(...P1)
    g.lineTo(...Q1)
    g.stroke()
    const ln = Math.hypot(Q[0] - P[0], Q[1] - P[1])
    const ux = (Q[0] - P[0]) / ln
    const uy = (Q[1] - P[1]) / ln
    const ah = 0.03 * s
    for (const [T0, sg] of [[P1, 1], [Q1, -1]] as const) {
      g.beginPath()
      g.moveTo(T0[0], T0[1])
      g.lineTo(T0[0] + sg * ux * ah - uy * ah * 0.42, T0[1] + sg * uy * ah + ux * ah * 0.42)
      g.lineTo(T0[0] + sg * ux * ah + uy * ah * 0.42, T0[1] + sg * uy * ah - ux * ah * 0.42)
      g.closePath()
      g.fill()
    }
    // the label beyond the line, upright
    const lk = seg(ki, 0.5, 1)
    if (lk > 0) {
      g.save()
      g.globalAlpha *= lk
      decoText(g, dm.label, M[0] + dm.n[0] * 0.05 * s, M[1] + dm.n[1] * 0.05 * s, 0.058 * s, 0.14 * s, font, 800, 'ltr', 'center')
      g.restore()
    }
  })
  g.restore()
}

export function drawBrick(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const L = BRICK_LAYOUT
  const geo = OBJECT_GEOMETRY.brick
  const light = lum(c.bg) > 0.5
  const K = brickCorners()
  const [D, C, , F, , A] = K as [Pt, Pt, Pt, Pt, Pt, Pt]
  const B: Pt = [A[0] + geo.front.w, A[1]]
  const b = d.build
  const fill = easeOutCubic(seg(b, 0.4, 1))
  // the variant now, the one a brick → brick move leaves, and how far the move has handed over
  const cur = brickVariantOf(d.text)
  const m = Math.min(1, Math.max(0, d.textMix))
  const prev = m < 1 ? brickVariantOf(d.prevText) : cur
  const V = BRICK_VARIANTS
  // the variant's own proportions show once it is itself (they ease in with a morph into it)
  const own = Math.min(1, d.alpha, d.detailAlpha)
  const sx = 1 + (V[prev].sx + (V[cur].sx - V[prev].sx) * m - 1) * own
  const sy = 1 + (V[prev].sy + (V[cur].sy - V[prev].sy) * m - 1) * own
  const Tc = BRICK_VARIANT_TOKENS[cur]
  const Tp = BRICK_VARIANT_TOKENS[prev]
  g.save()
  g.scale(sx, sy)

  // speed streaks above it just after it arrives falling (behind the body)
  if (d.text === 'fall' && d.detailAlpha > 0 && d.since >= 0 && d.since < BRICK.streakSec) {
    const k = d.since / BRICK.streakSec
    const St = L.streak
    g.save()
    g.globalAlpha *= d.detailAlpha * (1 - k)
    g.lineCap = 'round'
    g.lineWidth = St.width * s
    for (let i = 0; i < BRICK.streaks; i++) {
      const x = St.x0 + ((St.x1 - St.x0) * (i + 0.5)) / BRICK.streaks + 0.05 * (hash01(d.seed, 500 + i) - 0.5)
      const topY = x >= D[0] ? D[1] : A[1] + ((D[1] - A[1]) * (x - A[0])) / (D[0] - A[0])
      const len = (St.len[0] + (St.len[1] - St.len[0]) * hash01(d.seed, 510 + i)) * (1 - 0.35 * k)
      const y1 = (topY - St.gap - 0.06 * k) * s
      const y0 = y1 - len * s
      const gr = g.createLinearGradient(0, y0, 0, y1)
      gr.addColorStop(0, rgba(c.fg, 0))
      gr.addColorStop(1, rgba(c.fg, 0.32))
      g.strokeStyle = gr
      g.beginPath()
      g.moveTo(x * s, y0)
      g.lineTo(x * s, y1)
      g.stroke()
    }
    g.restore()
  }

  // the soft contact shadow under it (a detail: it fills in with the faces)
  const sa = d.detailAlpha * fill
  if (sa > 0) {
    const sh = L.shadow
    g.save()
    g.translate(sh.x * s, sh.y * s)
    g.scale(1, sh.ry / sh.rx)
    const rad = sh.rx * s
    const col = light ? c.fg : '#000000'
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rad)
    gr.addColorStop(0, rgba(col, (light ? 0.3 : 0.6) * sa))
    gr.addColorStop(0.5, rgba(col, (light ? 0.12 : 0.28) * sa))
    gr.addColorStop(1, rgba(col, 0))
    g.fillStyle = gr
    g.beginPath()
    g.arc(0, 0, rad, 0, TAU)
    g.fill()
    g.restore()
  }

  // body: a faint tint of the brick while the edges draw, the front's colour once filled
  const front = mixHex(Tp.front, Tc.front, m)
  g.fillStyle = mixHex(mixHex(c.bg, front, 0.12), front, fill)
  g.fill(d.path)
  if (!(d.detailAlpha > 0) || !(b > 0)) {
    g.restore()
    return
  }

  g.save()
  g.globalAlpha *= d.detailAlpha
  if (fill > 0) {
    // the faces: the leaving variant's under the new one's (the face details crossfade)
    g.save()
    g.clip(d.path)
    if (m < 1) {
      g.save()
      g.globalAlpha *= fill
      brickFaces(g, s, prev, d.seed)
      g.restore()
    }
    if (m > 0) {
      g.save()
      g.globalAlpha *= fill * (prev === cur ? 1 : m)
      brickFaces(g, s, cur, d.seed)
      g.restore()
    }
    g.restore()
  }

  // the ink lines: the silhouette, then the inner edges; they settle into the brick's own edge
  const ink = mixHex(c.fg, mixHex(Tp.edge, Tc.edge, m), fill)
  g.strokeStyle = rgba(ink, 1 - 0.72 * fill)
  g.lineWidth = L.line * s
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const outer = roundedPolygon(scaled(K, s), geo.r * s)
  partialLine(g, [...outer, outer[0]!], easeInOutCubic(seg(b, 0, 0.55)))
  if (fill < 1) {
    g.strokeStyle = rgba(ink, 1 - fill)
    const inner = easeOutCubic(seg(b, 0.25, 0.6))
    partialLine(g, scaled([A, B, C], s), inner)
    partialLine(g, scaled([B, F], s), inner)
  }
  // the measured brick's dimensions (fading in and out with the variant)
  const dimA = (cur === 'measure' ? m : 0) + (prev === 'measure' && prev !== cur ? 1 - m : 0)
  const dimK = cur === 'measure' ? seg(d.since, 0.05, 0.65) : 1
  brickDims(g, s, c, d.font, dimK * fill, dimA)
  g.restore()
  g.restore()
}

// ------------------------------------------------------------------ house

/**
 * House (Stage 1A, «بيت»): a two-storey Iraqi house in front elevation, 1 × 0.9 × size — plaster
 * walls (the world's bg tinted 12 % towards its fg), architectural pen linework (round caps): the
 * parapet coping and the stair tower on the roof at the right with its cap and a small window, a
 * cornice at roof level, the floor band between the storeys, a plinth, the ground line; on the
 * ground floor a roller garage door (housing, slats, bottom rail) on the left, the front door under
 * a concrete canopy and a pair of windows with guard bars; two windows upstairs with transoms; sills
 * under every window. Build: the pen traces the outline, then the bands, then each opening, the
 * inside details come in and the fills fade up. At `checkAt` it is lived in: the windows light up
 * one by one (warm accent glow in the panes) and warm light spills under the door. Rectangles are
 * [x0, y0, x1, y1] in units of the size.
 */
export const HOUSE_LAYOUT = {
  roof: -0.2,
  floor: [0.105, 0.128],
  plinth: 0.425,
  ground: { y: 0.45, ext: 0.09 },
  towerCap: -0.428,
  towerWindow: [0.22, -0.4, 0.3, -0.32],
  garage: [-0.43, 0.2, -0.11, 0.45],
  door: [-0.03, 0.205, 0.09, 0.45],
  canopy: [-0.065, 0.178, 0.125, 0.192],
  windows: [
    [0.15, 0.215, 0.27, 0.37],
    [0.31, 0.215, 0.43, 0.37],
    [-0.37, -0.12, -0.15, 0.05],
    [0.15, -0.12, 0.37, 0.05],
  ],
  /** The order the windows light up (the tower window last). */
  lightOrder: [2, 0, 3, 1, 4],
  line: 0.0072,
} as const

/** What `houseArt` draws: pen progress (0..1, the trace), fill progress, each window's light (0..1; the tower window last) and the door spill. */
export interface HouseArt {
  pen: number
  fill: number
  lights: readonly number[]
  spill: number
  /** Fill the walls here (the chat's reply card; the house object fills its morph outline instead). */
  walls: boolean
}

/** The house elevation centred on the origin, `s` wide, in colours `c` (bg = the surface it is drawn on). */
export function houseArt(g: CanvasRenderingContext2D, s: number, c: ObjectColours, a: HouseArt): void {
  const L = HOUSE_LAYOUT
  const geo = OBJECT_GEOMETRY.house
  const light = lum(c.bg) > 0.5
  const wall = mixHex(c.bg, c.fg, 0.12)
  const glass = light ? mixHex(wall, c.fg, 0.24) : mixHex(wall, c.bg, 0.65)
  const warm = mixHex(c.accent, '#FFD089', 0.55)
  const W = geo.wall * s
  const lw = L.line * s
  const Y = (v: number) => v * s
  g.save()
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const outline = scaled(houseCorners(), s)
  if (a.walls && a.fill > 0) {
    g.fillStyle = rgba(wall, a.fill)
    g.fill(polyPath(outline))
  }

  // fills: garage, door, canopy, glass (lit or not)
  const openings: (readonly number[])[] = [L.garage, L.door, ...L.windows, L.towerWindow]
  if (a.fill > 0) {
    g.save()
    g.globalAlpha *= a.fill
    const [gx0, gy0, gx1, gy1] = L.garage
    g.fillStyle = mixHex(wall, c.fg, light ? 0.14 : 0.2)
    g.fillRect(gx0 * s, gy0 * s, (gx1 - gx0) * s, (gy1 - gy0) * s)
    g.fillStyle = mixHex(wall, c.fg, light ? 0.26 : 0.3)
    g.fillRect(gx0 * s, gy0 * s, (gx1 - gx0) * s, 0.032 * s)
    const [dx0, dy0, dx1, dy1] = L.door
    g.fillStyle = mixHex(wall, c.fg, light ? 0.42 : 0.36)
    g.fillRect(dx0 * s, dy0 * s, (dx1 - dx0) * s, (dy1 - dy0) * s)
    const [cx0, cy0, cx1, cy1] = L.canopy
    g.fillStyle = mixHex(wall, c.fg, 0.2)
    g.fillRect(cx0 * s, cy0 * s, (cx1 - cx0) * s, (cy1 - cy0) * s)
    g.save()
    g.clip(polyPath(outline))
    ;[...L.windows, L.towerWindow].forEach((w, i) => {
      const k = a.lights[i] ?? 0
      if (!(k > 0)) return
      const [x0, y0, x1, y1] = w
      const cxw = ((x0 + x1) / 2) * s
      const cyw = ((y0 + y1) / 2) * s
      const rh = (x1 - x0 + y1 - y0) * 0.75 * s
      const halo = g.createRadialGradient(cxw, cyw, 0, cxw, cyw, rh)
      halo.addColorStop(0, rgba(warm, (light ? 0.22 : 0.3) * k))
      halo.addColorStop(1, rgba(warm, 0))
      g.fillStyle = halo
      g.fillRect(cxw - rh, cyw - rh, 2 * rh, 2 * rh)
    })
    g.restore()
    ;[...L.windows, L.towerWindow].forEach((w, i) => {
      const [x0, y0, x1, y1] = w
      const k = a.lights[i] ?? 0
      g.fillStyle = mixHex(glass, warm, k)
      g.fillRect(x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s)
      g.save()
      g.beginPath()
      g.rect(x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s)
      g.clip()
      if (k > 0) {
        // a warm glow inside the panes, brightest low in the room
        const cxw = ((x0 + x1) / 2) * s
        const cyw = (y0 + (y1 - y0) * 0.62) * s
        const gr = g.createRadialGradient(cxw, cyw, 0, cxw, cyw, (x1 - x0) * s * 0.75)
        gr.addColorStop(0, rgba(mixHex(warm, '#ffffff', 0.45), 0.85 * k))
        gr.addColorStop(1, rgba(warm, 0))
        g.fillStyle = gr
        g.fillRect(x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s)
      }
      // a soft diagonal reflection on the glass
      g.strokeStyle = rgba('#ffffff', (light ? 0.35 : 0.16) * (1 - 0.6 * k))
      g.lineWidth = (x1 - x0) * s * 0.16
      g.beginPath()
      g.moveTo((x0 + (x1 - x0) * 0.15) * s, y1 * s)
      g.lineTo((x0 + (x1 - x0) * 0.75) * s, y0 * s)
      g.stroke()
      g.restore()
    })
    g.restore()
  }

  // the light under the door: a bright slit and a soft fan on the ground
  if (a.spill > 0) {
    const [dx0, , dx1, dy1] = L.door
    g.save()
    g.fillStyle = rgba(mixHex(warm, '#ffffff', 0.3), a.spill)
    g.fillRect(dx0 * s, Y(dy1 - 0.008), (dx1 - dx0) * s, 0.008 * s)
    const gr = g.createLinearGradient(0, Y(dy1), 0, Y(dy1 + 0.07))
    gr.addColorStop(0, rgba(warm, 0.55 * a.spill))
    gr.addColorStop(1, rgba(warm, 0))
    g.fillStyle = gr
    g.beginPath()
    g.moveTo(dx0 * s, Y(dy1))
    g.lineTo(dx1 * s, Y(dy1))
    g.lineTo((dx1 + 0.07) * s, Y(dy1 + 0.07))
    g.lineTo((dx0 - 0.07) * s, Y(dy1 + 0.07))
    g.closePath()
    g.fill()
    g.restore()
  }

  // pen: the outline, the bands, the openings one after another
  g.strokeStyle = c.fg
  g.lineWidth = lw
  partialLine(g, [...outline, outline[0]!], easeInOutCubic(seg(a.pen, 0, 0.32)))
  const bands: Pt[][] = [
    [[-0.5 * s, Y(geo.coping.y + geo.coping.h)], [0.5 * s, Y(geo.coping.y + geo.coping.h)]],
    [[geo.tower.x0 * s, Y(L.towerCap)], [geo.tower.x1 * s, Y(L.towerCap)]],
    [[-W, Y(L.roof)], [W, Y(L.roof)]],
    [[-W, Y(L.floor[0])], [W, Y(L.floor[0])]],
    [[-W, Y(L.floor[1])], [W, Y(L.floor[1])]],
    [[-W, Y(L.plinth)], [W, Y(L.plinth)]],
  ]
  bands.forEach((ln, i) => {
    g.lineWidth = lw * (i === 2 || i === 5 ? 0.7 : 0.85)
    partialLine(g, ln, easeOutCubic(seg(a.pen, 0.22 + 0.025 * i, 0.4 + 0.025 * i)))
  })
  g.lineWidth = lw * 1.7
  partialLine(g, [[-(0.5 + L.ground.ext) * s, Y(L.ground.y)], [(0.5 + L.ground.ext) * s, Y(L.ground.y)]], easeOutCubic(seg(a.pen, 0.25, 0.45)))
  g.lineWidth = lw
  openings.forEach((o, i) => partialLine(g, rectLine(o, s), easeInOutCubic(seg(a.pen, 0.38 + 0.06 * i, 0.56 + 0.06 * i))))
  partialLine(g, rectLine(L.canopy, s), easeOutCubic(seg(a.pen, 0.44, 0.6)))

  // inside details: slats, door panels and handle, mullions, transoms, guard bars, sills
  const da = seg(a.pen, 0.6, 0.95)
  if (da > 0) {
    g.save()
    g.globalAlpha *= da
    const [gx0, gy0, gx1, gy1] = L.garage
    g.strokeStyle = rgba(c.fg, 0.38)
    g.lineWidth = lw * 0.55
    g.beginPath()
    for (let y = gy0 + 0.032; y < gy1 - 0.012; y += 0.022) {
      g.moveTo(gx0 * s, Y(y))
      g.lineTo(gx1 * s, Y(y))
    }
    g.stroke()
    g.strokeStyle = c.fg
    g.lineWidth = lw * 0.8
    g.beginPath()
    g.moveTo(gx0 * s, Y(gy0 + 0.032))
    g.lineTo(gx1 * s, Y(gy0 + 0.032))
    g.moveTo((gx0 + gx1) / 2 * s - 0.03 * s, Y(gy1 - 0.02))
    g.lineTo((gx0 + gx1) / 2 * s + 0.03 * s, Y(gy1 - 0.02))
    g.stroke()
    const [dx0, dy0, dx1, dy1] = L.door
    g.strokeStyle = rgba(light ? wall : c.fg, light ? 0.55 : 0.45)
    g.lineWidth = lw * 0.6
    const px0 = dx0 + 0.02, px1 = dx1 - 0.02
    g.beginPath()
    rrect(g, px0 * s, Y(dy0 + 0.025), (px1 - px0) * s, 0.09 * s, 0.006 * s)
    rrect(g, px0 * s, Y(dy0 + 0.135), (px1 - px0) * s, 0.09 * s, 0.006 * s)
    g.stroke()
    g.fillStyle = c.accent
    g.beginPath()
    g.arc((dx0 + 0.022) * s, Y((dy0 + dy1) / 2 + 0.01), 0.008 * s, 0, TAU)
    g.fill()
    g.strokeStyle = c.fg
    L.windows.forEach((w, i) => {
      const [x0, y0, x1, y1] = w
      const mx = (x0 + x1) / 2
      g.lineWidth = lw * 0.7
      g.beginPath()
      g.moveTo(mx * s, Y(y0))
      g.lineTo(mx * s, Y(y1))
      if (i >= 2) {
        g.moveTo(x0 * s, Y(y0 + (y1 - y0) * 0.3))
        g.lineTo(x1 * s, Y(y0 + (y1 - y0) * 0.3))
      }
      g.stroke()
      if (i < 2) {
        g.save()
        g.strokeStyle = rgba(c.fg, 0.55)
        g.lineWidth = lw * 0.45
        g.beginPath()
        for (const f of [0.25, 0.75]) {
          g.moveTo((x0 + (x1 - x0) * f) * s, Y(y0))
          g.lineTo((x0 + (x1 - x0) * f) * s, Y(y1))
        }
        g.moveTo(x0 * s, Y((y0 + y1) / 2))
        g.lineTo(x1 * s, Y((y0 + y1) / 2))
        g.stroke()
        g.restore()
      }
      g.lineWidth = lw * 1.5
      g.beginPath()
      g.moveTo((x0 - 0.014) * s, Y(y1 + 0.008))
      g.lineTo((x1 + 0.014) * s, Y(y1 + 0.008))
      g.stroke()
    })
    g.restore()
  }
  g.restore()
}

/** Each window's light (0..1, `HOUSE_LAYOUT.windows` then the tower window) `k` s into the second beat. */
function houseLights(k: number): number[] {
  const out = new Array<number>(HOUSE_LAYOUT.windows.length + 1).fill(0)
  HOUSE_LAYOUT.lightOrder.forEach((w, i) => {
    out[w] = easeOutCubic(seg(k, i * HOUSE.lightEvery, i * HOUSE.lightEvery + HOUSE.lightSec))
  })
  return out
}

export function drawHouse(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const b = d.build
  const fill = easeOutCubic(seg(b, 0.7, 1))
  const wall = mixHex(c.bg, c.fg, 0.12)
  g.fillStyle = mixHex(mixHex(c.bg, wall, 0.3), wall, fill)
  g.fill(d.path)
  if (!(d.detailAlpha > 0) || !(b > 0)) return
  const k = d.since - d.checkAt
  g.save()
  g.globalAlpha *= d.detailAlpha
  houseArt(g, s, c, { pen: b, fill, lights: houseLights(k), spill: easeOutCubic(seg(k, 0.1, 0.45)), walls: false })
  g.restore()
}

// ------------------------------------------------------------------ blueprint

/**
 * Blueprint (Stage 1A, «خريطة»): an engineer's plan sheet, 1 × 1.28 × size, inverted like a
 * blueprint — the sheet in the world's fg, lines and numbers in its bg at 85 %, a faint grid, a
 * thin inner border and a title block bottom-left. Build: the floor plan draws itself — the outer
 * walls (thick, window breaks in them), the interior walls, the stair hatch, the door swings —
 * then the dimension chains with their ticks and labels along the top and the left. After the
 * build the labels scramble (new digits every `BLUEPRINT.scrambleEvery` s, seeded by label and
 * time step), so the sheet reads as lines and numbers that mean nothing to you. At `checkAt` an
 * accent signature scribbles across the lower right, then an underline flicks under it. Layout in
 * units of the size (y from the sheet centre); walls as polylines, doors as [hinge x, y, leaf dx,
 * dy, arc from, arc to (radians)].
 */
export const BLUEPRINT_LAYOUT = {
  border: 0.035,
  grid: 0.05,
  plan: { x0: -0.24, x1: 0.4, y0: -0.4, y1: 0.3 },
  outerWall: 0.02,
  innerWall: 0.009,
  hair: 0.0035,
  /** The outer walls, from the entrance's right jamb round to its left jamb. */
  outer: [
    [-0.02, 0.3],
    [0.4, 0.3],
    [0.4, -0.4],
    [-0.24, -0.4],
    [-0.24, 0.3],
    [-0.12, 0.3],
  ],
  inner: [
    [[0.1, -0.4], [0.1, -0.26]],
    [[0.1, -0.17], [0.1, -0.02]],
    [[-0.24, -0.02], [-0.14, -0.02]],
    [[-0.05, -0.02], [0.4, -0.02]],
    [[0.02, -0.02], [0.02, 0.06]],
    [[0.02, 0.15], [0.02, 0.3]],
  ],
  /** Window breaks in the outer walls: [x0, y0, x1, y1] along a wall. */
  windows: [
    [-0.17, -0.4, -0.05, -0.4],
    [0.2, -0.4, 0.32, -0.4],
    [-0.24, 0.08, -0.24, 0.2],
    [0.4, -0.31, 0.4, -0.19],
  ],
  doors: [
    [0.1, -0.26, 0.09, 0, 0, Math.PI / 2],
    [-0.14, -0.02, 0, 0.09, Math.PI / 2, 0],
    [0.02, 0.06, -0.09, 0, Math.PI, Math.PI / 2],
    [-0.12, 0.3, 0, -0.1, -Math.PI / 2, 0],
  ],
  stair: { x0: 0.2, y0: 0.04, x1: 0.36, y1: 0.27, tread: 0.023 },
  /** Dimension chains: the top one's y (chain, overall) and the left one's x. */
  dimTop: [-0.47, -0.53],
  dimLeft: [-0.32, -0.39],
  breaksX: [-0.24, 0.1, 0.4],
  breaksY: [-0.4, -0.02, 0.3],
  /** Room areas, [x, y, label]. */
  rooms: [
    [-0.07, -0.2, '14.8'],
    [0.25, -0.2, '9.60'],
    [-0.11, 0.14, '12.0'],
  ],
  /** Dimension labels: the top chain's two spans and the overall, then the left chain's. */
  labels: ['3.40', '3.00', '6.40', '3.80', '3.20', '7.00'],
  label: 0.03,
  title: [-0.465, 0.43, -0.07, 0.605],
  sign: { x0: 0.04, x1: 0.42, y: 0.5, loops: 4 },
} as const

/** Blueprint linework colours: the sheet and its lines. */
interface SheetInk {
  sheet: string
  line: string
}

/** A label `base` with its digits scrambled for time step `n` (label `i`, under `seed`); the dot stays. */
function scrambled(base: string, seed: number, i: number, n: number): string {
  let out = ''
  for (let j = 0; j < base.length; j++) {
    const ch = base[j]!
    out += ch >= '0' && ch <= '9' ? String(Math.floor(hash01(seed, 4000 + i * 61 + j * 7 + n * 977) * 10)) : ch
  }
  return out
}

/**
 * The plan's linework on a sheet `s` wide, centred, at build `b` (0..1). `labelOf(i, base)` gives
 * the text of label i (dimension labels then room areas); null draws none.
 */
function blueprintArt(g: CanvasRenderingContext2D, s: number, k: SheetInk, b: number, font: string, labelOf: ((i: number, base: string) => string) | null): void {
  const L = BLUEPRINT_LAYOUT
  const geo = OBJECT_GEOMETRY.blueprint
  const P = L.plan
  const W = (geo.w / 2) * s
  const H = (geo.h / 2) * s
  const S = (p: readonly number[]): Pt => [p[0]! * s, p[1]! * s]
  g.save()
  g.lineCap = 'round'
  g.lineJoin = 'round'
  // grid, border, title block
  const ga = seg(b, 0, 0.25)
  if (ga > 0) {
    g.save()
    g.globalAlpha *= ga
    g.strokeStyle = rgba(k.line, 0.07)
    g.lineWidth = Math.max(0.6, 0.0018 * s)
    g.beginPath()
    for (let x = -0.45; x <= 0.451; x += L.grid) {
      g.moveTo(x * s, -H)
      g.lineTo(x * s, H)
    }
    for (let y = -0.6; y <= 0.601; y += L.grid) {
      g.moveTo(-W, y * s)
      g.lineTo(W, y * s)
    }
    g.stroke()
    const bi = L.border * s
    g.strokeStyle = rgba(k.line, 0.6)
    g.lineWidth = Math.max(0.8, 0.004 * s)
    g.strokeRect(-W + bi, -H + bi, 2 * (W - bi), 2 * (H - bi))
    const [tx0, ty0, tx1, ty1] = L.title
    g.strokeRect(tx0 * s, ty0 * s, (tx1 - tx0) * s, (ty1 - ty0) * s)
    g.beginPath()
    g.moveTo(tx0 * s, (ty0 + 0.07) * s)
    g.lineTo(tx1 * s, (ty0 + 0.07) * s)
    g.moveTo(tx0 * s, (ty0 + 0.122) * s)
    g.lineTo(tx1 * s, (ty0 + 0.122) * s)
    g.moveTo((tx0 + 0.24) * s, (ty0 + 0.07) * s)
    g.lineTo((tx0 + 0.24) * s, ty1 * s)
    g.stroke()
    g.strokeStyle = rgba(k.line, 0.45)
    g.lineWidth = Math.max(0.8, 0.006 * s)
    g.beginPath()
    for (const [x, y, w] of [[0.02, 0.095, 0.16], [0.02, 0.148, 0.12], [0.26, 0.095, 0.1], [0.26, 0.148, 0.08]] as const) {
      g.moveTo((tx0 + x) * s, (ty0 + y) * s)
      g.lineTo((tx0 + x + w) * s, (ty0 + y) * s)
    }
    g.stroke()
    g.fillStyle = rgba(k.line, 0.85)
    decoText(g, 'A-101', (tx0 + 0.025) * s, (ty0 + 0.037) * s, 0.04 * s, 0.3 * s, font, 800, 'ltr', 'left')
    g.restore()
  }

  // outer walls (thick), with window breaks once they are drawn
  g.strokeStyle = rgba(k.line, 0.85)
  g.lineWidth = L.outerWall * s
  g.lineJoin = 'miter'
  g.lineCap = 'butt'
  partialLine(g, L.outer.map(S), easeInOutCubic(seg(b, 0.05, 0.35)))
  const wa = seg(b, 0.3, 0.4)
  if (wa > 0) {
    for (const [x0, y0, x1, y1] of L.windows) {
      const horiz = y0 === y1
      const t = (L.outerWall / 2 + 0.002) * s
      g.fillStyle = k.sheet
      if (horiz) g.fillRect(x0 * s, y0 * s - t, (x1 - x0) * s, 2 * t)
      else g.fillRect(x0 * s - t, y0 * s, 2 * t, (y1 - y0) * s)
      g.strokeStyle = rgba(k.line, 0.85 * wa)
      g.lineWidth = L.hair * s
      g.beginPath()
      for (const o of [-1, -0.25, 0.25, 1]) {
        const off = o * (L.outerWall / 2) * s
        if (horiz) {
          g.moveTo(x0 * s, y0 * s + off)
          g.lineTo(x1 * s, y0 * s + off)
        } else {
          g.moveTo(x0 * s + off, y0 * s)
          g.lineTo(x0 * s + off, y1 * s)
        }
      }
      if (horiz) {
        g.moveTo(x0 * s, y0 * s - t)
        g.lineTo(x0 * s, y0 * s + t)
        g.moveTo(x1 * s, y0 * s - t)
        g.lineTo(x1 * s, y0 * s + t)
      } else {
        g.moveTo(x0 * s - t, y0 * s)
        g.lineTo(x0 * s + t, y0 * s)
        g.moveTo(x0 * s - t, y1 * s)
        g.lineTo(x0 * s + t, y1 * s)
      }
      g.stroke()
    }
  }
  g.lineJoin = 'round'
  g.lineCap = 'round'
  // interior walls
  g.strokeStyle = rgba(k.line, 0.85)
  g.lineWidth = L.innerWall * s
  L.inner.forEach((ln, i) => partialLine(g, ln.map(S), easeOutCubic(seg(b, 0.3 + 0.03 * i, 0.45 + 0.03 * i))))
  // the stair hatch: an outline, treads, a direction line with its arrow and a break line
  const St = L.stair
  const sa = seg(b, 0.45, 0.72)
  if (sa > 0) {
    g.save()
    g.lineWidth = L.hair * s
    partialLine(g, rectLine([St.x0, St.y0, St.x1, St.y1], s), easeOutCubic(sa))
    g.strokeStyle = rgba(k.line, 0.7)
    const n = Math.floor((St.y1 - St.y0) / St.tread)
    g.beginPath()
    for (let i = 1; i < n; i++) {
      if (i / n > sa) break
      const y = (St.y0 + i * St.tread) * s
      g.moveTo(St.x0 * s, y)
      g.lineTo(St.x1 * s, y)
    }
    g.stroke()
    const mx = ((St.x0 + St.x1) / 2) * s
    g.strokeStyle = rgba(k.line, 0.85)
    partialLine(g, [[mx, St.y1 * s - 0.01 * s], [mx, St.y0 * s + 0.02 * s]], seg(sa, 0.5, 1))
    if (sa >= 1) {
      g.beginPath()
      g.moveTo(mx - 0.012 * s, St.y0 * s + 0.038 * s)
      g.lineTo(mx, St.y0 * s + 0.02 * s)
      g.lineTo(mx + 0.012 * s, St.y0 * s + 0.038 * s)
      g.stroke()
    }
    partialLine(g, [[St.x0 * s, (St.y0 + 0.14) * s], [(St.x0 + 0.06) * s, (St.y0 + 0.14) * s], [(St.x0 + 0.08) * s, (St.y0 + 0.11) * s], [(St.x0 + 0.1) * s, (St.y0 + 0.17) * s], [(St.x0 + 0.12) * s, (St.y0 + 0.14) * s], [St.x1 * s, (St.y0 + 0.14) * s]], seg(sa, 0.6, 1))
    g.restore()
  }
  // door leaves and swing arcs
  L.doors.forEach(([hx, hy, lx, ly, a0, a1], i) => {
    const e = easeOutCubic(seg(b, 0.55 + 0.04 * i, 0.72 + 0.04 * i))
    if (e <= 0) return
    const rad = Math.hypot(lx, ly) * s
    g.lineWidth = L.hair * 1.4 * s
    g.strokeStyle = rgba(k.line, 0.85)
    g.beginPath()
    g.moveTo(hx * s, hy * s)
    g.lineTo((hx + lx * e) * s, (hy + ly * e) * s)
    g.stroke()
    g.strokeStyle = rgba(k.line, 0.55)
    g.lineWidth = L.hair * s
    g.beginPath()
    g.arc(hx * s, hy * s, rad, a0, a0 + (a1 - a0) * e, a1 < a0)
    g.stroke()
  })

  // dimension chains: extension lines, the chain, 45° ticks, labels
  const dimA = seg(b, 0.66, 0.92)
  if (dimA > 0) {
    g.save()
    g.strokeStyle = rgba(k.line, 0.75)
    g.lineWidth = L.hair * s
    const [cy, oy] = L.dimTop
    const [cx, ox] = L.dimLeft
    const tick = 0.012 * s
    const e = easeOutCubic(dimA)
    const lineX = (y: number, x0: number, x1: number) => partialLine(g, [[x0 * s, y * s], [x1 * s, y * s]], e)
    const lineY = (x: number, y0: number, y1: number) => partialLine(g, [[x * s, y0 * s], [x * s, y1 * s]], e)
    // extension lines (from just off the wall to past the chains)
    g.save()
    g.strokeStyle = rgba(k.line, 0.4)
    for (const x of L.breaksX) lineY(x, P.y0 - 0.02, (x === 0.1 ? cy : oy) - 0.015)
    for (const y of L.breaksY) lineX(y, P.x0 - 0.02, (y === -0.02 ? cx : ox) - 0.015)
    g.restore()
    lineX(cy, P.x0 - 0.015, P.x1 + 0.015)
    lineX(oy, P.x0 - 0.015, P.x1 + 0.015)
    lineY(cx, P.y0 - 0.015, P.y1 + 0.015)
    lineY(ox, P.y0 - 0.015, P.y1 + 0.015)
    const ta = seg(b, 0.78, 0.95)
    if (ta > 0) {
      g.globalAlpha *= ta
      g.lineWidth = L.hair * 1.8 * s
      g.beginPath()
      for (const x of L.breaksX) for (const y of x === 0.1 ? [cy] : [cy, oy]) {
        g.moveTo(x * s - tick, y * s + tick)
        g.lineTo(x * s + tick, y * s - tick)
      }
      for (const y of L.breaksY) for (const x of y === -0.02 ? [cx] : [cx, ox]) {
        g.moveTo(x * s - tick, y * s + tick)
        g.lineTo(x * s + tick, y * s - tick)
      }
      g.stroke()
      if (labelOf) {
        g.fillStyle = rgba(k.line, 0.85)
        const fs = L.label * s
        const top: [number, number][] = [
          [(L.breaksX[0] + L.breaksX[1]) / 2, cy],
          [(L.breaksX[1] + L.breaksX[2]) / 2, cy],
          [(L.breaksX[0] + L.breaksX[2]) / 2, oy],
        ]
        top.forEach(([x, y], i) => decoText(g, labelOf(i, L.labels[i]!), x * s, (y - 0.02) * s, fs, 0.2 * s, font, 700, 'ltr', 'center'))
        const left: [number, number][] = [
          [cx, (L.breaksY[0] + L.breaksY[1]) / 2],
          [cx, (L.breaksY[1] + L.breaksY[2]) / 2],
          [ox, (L.breaksY[0] + L.breaksY[2]) / 2],
        ]
        left.forEach(([x, y], i) => {
          g.save()
          g.translate((x - 0.02) * s, y * s)
          g.rotate(-Math.PI / 2)
          decoText(g, labelOf(3 + i, L.labels[3 + i]!), 0, 0, fs, 0.2 * s, font, 700, 'ltr', 'center')
          g.restore()
        })
        L.rooms.forEach(([x, y, base], i) => {
          g.fillStyle = rgba(k.line, 0.6)
          decoText(g, `${labelOf(6 + i, base)} m²`, x * s, y * s, fs * 0.9, 0.2 * s, font, 600, 'ltr', 'center')
        })
      }
    }
    g.restore()
  }
  g.restore()
}

/**
 * The signature's polyline (sheet units), written right → left: a tall opening loop, then running
 * loops whose sizes vary smoothly (seeded), the hand speeding up and the line drifting upwards.
 */
function signaturePts(seed: number): Pt[] {
  const Sg = BLUEPRINT_LAYOUT.sign
  const N = 200
  const W = Sg.x1 - Sg.x0
  const amps = Array.from({ length: Sg.loops + 2 }, (_, j) => (j === 0 ? 2.3 : j > Sg.loops - 1 ? 0.15 : 0.35 + 0.8 * hash01(seed, 4500 + j)))
  const out: Pt[] = []
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const w = u + 0.05 * Math.sin(TAU * 1.3 * u)
    const th = TAU * Sg.loops * w + 0.9
    const f = Sg.loops * w
    const j = Math.max(0, Math.min(Sg.loops, Math.floor(f)))
    const fr = f - Math.floor(f)
    const sm = fr * fr * (3 - 2 * fr)
    const amp = (amps[j]! + (amps[j + 1]! - amps[j]!) * sm) * (1.1 - 0.4 * u)
    const x = Sg.x1 - W * u + 0.022 * Math.sin(th) * Math.min(1.4, amp)
    const y = Sg.y - 0.03 * u - 0.03 * amp * Math.cos(th) - (amp > 1.2 ? 0.016 * (amp - 1.2) : 0) + 0.035 * seg(u, 0.82, 1) ** 2
    out.push([x, y])
  }
  return out
}

export function drawBlueprint(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const k: SheetInk = { sheet: c.fg, line: c.bg }
  g.save()
  liftShadowPath(g, c, s, d.detailAlpha, d.path)
  g.fillStyle = k.sheet
  g.fill(d.path)
  g.restore()
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.clip(d.path)
  const built = d.since >= buildSecOf('blueprint')
  const n = Math.floor(d.since / BLUEPRINT.scrambleEvery)
  blueprintArt(g, s, k, d.build, d.font, built ? (i, base) => scrambled(base, d.seed, i, n) : (_i, base) => base)
  // the signature, then its underline flick
  const sk = seg(d.since, d.checkAt, d.checkAt + BLUEPRINT.signSec)
  if (sk > 0) {
    const Sg = BLUEPRINT_LAYOUT.sign
    g.strokeStyle = c.accent
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.lineWidth = 0.0085 * s
    partialLine(g, scaled(signaturePts(d.seed), s), easeInOutCubic(sk))
    const fk = seg(d.since, d.checkAt + BLUEPRINT.signSec, d.checkAt + BLUEPRINT.signSec + BLUEPRINT.flickSec)
    if (fk > 0) {
      const fl: Pt[] = []
      for (let i = 0; i <= 16; i++) {
        const u = i / 16
        fl.push([(Sg.x1 + 0.01 - (Sg.x1 - Sg.x0 + 0.05) * u) * s, (Sg.y + 0.062 - 0.012 * u - 0.03 * u ** 6) * s])
      }
      g.lineWidth = 0.007 * s
      partialLine(g, fl, easeOutCubic(fk))
    }
  }
  g.restore()
}

// ------------------------------------------------------------------ eye

/**
 * Eye (Stage 1A, «ما شفته بعينك»): an almond 1 × 0.56 × size. The body is the lid (the world's bg
 * warmed towards the accent); the opening shows the white of the eye (paper on light worlds, the
 * world's fg on ink) with a soft shadow under the upper lid and a tear-duct tint, an accent iris
 * (a radial gradient, fibres, a dark limbal ring), the pupil in the world's dark tone, two
 * specular dots, a tapered lash line with a few lashes, a crease above and a faint lower lid.
 * Build: the lids open from closed. Idle: the iris glances around (a seeded target every
 * `EYE.lookEvery` s, reached in `EYE.lookSec`). At `checkAt` the lids close over `EYE.closeSec`
 * and stay closed (a curved lash line with short lashes), then an accent slash draws across the
 * whole eye over `EYE.slashSec`, cut out of the eye by a thin gap in the world's bg.
 */
export const EYE_LAYOUT = {
  iris: 0.165,
  pupil: 0.072,
  closed: 0.1,
  lash: 0.034,
  crease: 1.3,
  look: { x: 0.12, y: 0.035 },
  slash: { from: [-0.58, -0.34], to: [0.58, 0.34], width: 0.042, gap: 0.03 },
} as const

/** The iris centre (units of the size) `since` s into the state: a seeded glance every `lookEvery` s. */
function irisAt(seed: number, since: number): Pt {
  const L = EYE_LAYOUT.look
  const target = (j: number): Pt => (j <= 0 ? [0, 0] : [L.x * (2 * hash01(seed, 4700 + j) - 1), L.y * (2 * hash01(seed, 4800 + j) - 1)])
  const t = Math.max(0, since)
  const j = Math.floor(t / EYE.lookEvery)
  const e = easeInOutCubic(seg(t - j * EYE.lookEvery, 0, EYE.lookSec))
  const a = target(j - 1)
  const b = target(j)
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e]
}

export function drawEye(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const { light, paper, ink } = paperInk(c)
  const L = EYE_LAYOUT
  const geo = OBJECT_GEOMETRY.eye
  const lid = mixHex(c.bg, c.accent, light ? 0.2 : 0.24)
  g.fillStyle = lid
  g.fill(d.path)
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  const close = easeInOutCubic(seg(d.since, d.checkAt, d.checkAt + EYE.closeSec))
  const o = easeOutCubic(d.build) * (1 - close)
  const N = 48
  const X = (u: number) => ((u * geo.w) / 2) * s
  const closedY = (u: number) => L.closed * (1 - u * u) * s
  const upper: Pt[] = []
  const lower: Pt[] = []
  for (let i = 0; i <= N; i++) {
    const u = -1 + (2 * i) / N
    const lidY = eyeLids(u)
    upper.push([X(u), closedY(u) + (lidY.top * s - closedY(u)) * o])
    lower.push([X(u), closedY(u) + (lidY.bottom * s - closedY(u)) * Math.sqrt(o)])
  }
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (o > 0.002) {
    // the opening: white, shadow under the lid, tear duct, iris, pupil, highlights
    const opening = polyPath([...upper, ...[...lower].reverse()])
    g.save()
    g.clip(d.path)
    g.clip(opening)
    g.fillStyle = paper
    g.fill(opening)
    const tear = g.createRadialGradient(X(-0.92), 0.01 * s, 0, X(-0.92), 0.01 * s, 0.09 * s)
    tear.addColorStop(0, rgba(mixHex(paper, c.accent, 0.45), 0.8))
    tear.addColorStop(1, rgba(paper, 0))
    g.fillStyle = tear
    g.fillRect(-0.5 * s, -0.3 * s, 0.2 * s, 0.6 * s)
    const [ix0, iy0] = irisAt(d.seed, d.since)
    const ix = ix0 * s
    const iy = iy0 * s
    const ir = L.iris * s
    const iris = g.createRadialGradient(ix - 0.2 * ir, iy - 0.25 * ir, 0.1 * ir, ix, iy, ir)
    iris.addColorStop(0, mixHex(c.accent, '#FFE0C2', 0.45))
    iris.addColorStop(0.55, c.accent)
    iris.addColorStop(1, mixHex(c.accent, '#000000', 0.42))
    g.fillStyle = iris
    g.beginPath()
    g.arc(ix, iy, ir, 0, TAU)
    g.fill()
    // fibres
    g.lineWidth = Math.max(0.6, 0.004 * s)
    for (let i = 0; i < 36; i++) {
      const a = (TAU * i) / 36 + 0.3 * hash01(d.seed, 4900 + i)
      const r0 = L.pupil * s * 1.15
      const r1 = ir * (0.72 + 0.22 * hash01(d.seed, 4950 + i))
      g.strokeStyle = i % 2 ? rgba('#ffffff', 0.18) : rgba('#3a0d00', 0.22)
      g.beginPath()
      g.moveTo(ix + r0 * Math.cos(a), iy + r0 * Math.sin(a))
      g.lineTo(ix + r1 * Math.cos(a), iy + r1 * Math.sin(a))
      g.stroke()
    }
    g.strokeStyle = rgba(mixHex(c.accent, '#000000', 0.6), 0.85)
    g.lineWidth = 0.012 * s
    g.beginPath()
    g.arc(ix, iy, ir - 0.006 * s, 0, TAU)
    g.stroke()
    const dark = light ? c.fg : mixHex(c.bg, '#000000', 0.3)
    g.fillStyle = dark
    g.beginPath()
    g.arc(ix, iy, L.pupil * s, 0, TAU)
    g.fill()
    g.fillStyle = 'rgba(255,255,255,0.92)'
    g.beginPath()
    g.arc(ix - 0.42 * ir, iy - 0.42 * ir, 0.03 * s, 0, TAU)
    g.fill()
    g.fillStyle = 'rgba(255,255,255,0.55)'
    g.beginPath()
    g.arc(ix + 0.35 * ir, iy + 0.3 * ir, 0.013 * s, 0, TAU)
    g.fill()
    // the shadow the upper lid casts on the eye
    // (layered strokes along the lid: the shadow follows its curve)
    g.strokeStyle = rgba(ink, light ? 0.03 : 0.05)
    for (let i = 6; i >= 1; i--) {
      g.lineWidth = 0.016 * s * i
      partialLine(g, upper, 1)
    }
    g.restore()
    // the faint lower lid line
    g.strokeStyle = rgba(ink, light ? 0.3 : 0.45)
    g.lineWidth = 0.007 * s
    partialLine(g, lower.slice(2, -2), 1)
  }
  // the lash line: a tapered band along the upper lid (closed: along the closed line), with lashes
  const lashCol = light ? c.fg : mixHex(c.fg, c.accent, 0.12)
  g.fillStyle = lashCol
  g.beginPath()
  upper.forEach(([x, y], i) => {
    const u = -1 + (2 * i) / N
    const th = L.lash * s * (0.25 + 0.75 * (1 - u * u))
    const yy = y - th * (0.35 + 0.65 * o)
    if (i) g.lineTo(x, yy)
    else g.moveTo(x, yy)
  })
  for (let i = N; i >= 0; i--) g.lineTo(upper[i]![0], upper[i]![1] + 0.004 * s)
  g.closePath()
  g.fill()
  g.strokeStyle = lashCol
  g.lineWidth = 0.009 * s
  const lashes = [-0.62, -0.38, -0.12, 0.14, 0.4, 0.64]
  for (const u of lashes) {
    const i = Math.round(((u + 1) / 2) * N)
    const [x, y] = upper[i]!
    // open: up and outwards; closed: down from the closed line (they fold through zero length mid-blink)
    const dir = o > 0.5 ? -1 : 1
    const len = (0.05 + 0.02 * (1 - u * u)) * s * Math.abs(2 * o - 1)
    if (len < 0.004 * s) continue
    const out = u * 0.045 * s
    g.beginPath()
    g.moveTo(x, y + dir * -0.004 * s)
    g.quadraticCurveTo(x + out * 0.4, y + dir * len * 0.6, x + out, y + dir * len)
    g.stroke()
  }
  // the crease over the open eye
  if (o > 0.1) {
    g.strokeStyle = rgba(light ? ink : c.fg, (light ? 0.32 : 0.4) * o * o)
    g.lineWidth = 0.008 * s
    const crease: Pt[] = []
    for (let i = 6; i <= N - 6; i++) {
      const u = -1 + (2 * i) / N
      crease.push([X(u) * 0.92, eyeLids(u).top * s * L.crease - 0.015 * s])
    }
    partialLine(g, crease, 1)
  }
  // the slash, cut out of the eye by a gap in the world's bg
  const sl = easeOutCubic(seg(d.since, d.checkAt + EYE.closeSec, d.checkAt + EYE.closeSec + EYE.slashSec))
  if (sl > 0) {
    const Sl = L.slash
    const line: Pt[] = [[Sl.from[0] * s, Sl.from[1] * s], [Sl.to[0] * s, Sl.to[1] * s]]
    g.strokeStyle = c.bg
    g.lineWidth = (Sl.width + 2 * Sl.gap) * s
    partialLine(g, line, sl)
    g.strokeStyle = c.accent
    g.lineWidth = Sl.width * s
    partialLine(g, line, sl)
  }
  g.restore()
}

// ------------------------------------------------------------------ photo

/**
 * Photo (Stage 1A, «صوّر المخطط»): a print 0.9 × 1.08 × size — a white card (deeper strip at the
 * bottom with a marker scribble) with a soft shadow; the image is the blueprint photographed on a
 * desk (the sheet slightly turned, a vignette), reusing the blueprint linework, static. Arrival:
 * four accent viewfinder brackets snap from `PHOTO.bracketFrom`× to 1× over `PHOTO.bracketSec`,
 * then a white flash fades over `PHOTO.flashSec` while the image develops (contrast low → full)
 * over `PHOTO.developSec`. Layout in units of the size.
 */
export const PHOTO_LAYOUT = {
  border: 0.045,
  bottom: 0.2,
  sheet: { h: 0.74, tilt: -0.06 },
  bracket: { out: 0.04, len: 0.1, width: 0.016 },
  idle: 0.3,
} as const

/** The image area of the photo [x0, y0, x1, y1] in px for size `s`. */
function photoImage(s: number): [number, number, number, number] {
  const geo = OBJECT_GEOMETRY.photo
  const L = PHOTO_LAYOUT
  return [(-geo.w / 2 + L.border) * s, (-geo.h / 2 + L.border) * s, (geo.w / 2 - L.border) * s, (geo.h / 2 - L.bottom) * s]
}

/** The photographed plan inside [x0, y0, x1, y1]: a desk, the sheet slightly turned with its static linework, a vignette. */
function photoArt(g: CanvasRenderingContext2D, hs: number, c: ObjectColours, box: readonly [number, number, number, number], font: string): void {
  const [x0, y0, x1, y1] = box
  const L = PHOTO_LAYOUT
  const light = lum(c.bg) > 0.5
  const desk = light ? mixHex(c.bg, c.fg, 0.38) : mixHex(c.bg, c.fg, 0.2)
  g.save()
  g.beginPath()
  g.rect(x0, y0, x1 - x0, y1 - y0)
  g.clip()
  g.fillStyle = desk
  g.fillRect(x0, y0, x1 - x0, y1 - y0)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const ws = hs / OBJECT_GEOMETRY.blueprint.h
  g.translate(cx, cy)
  g.rotate(L.sheet.tilt)
  const sheet = new Path2D()
  sheet.rect(-ws / 2, -hs / 2, ws, hs)
  softShadow(g, sheet, '#000000', 0.35, 0.04 * hs, 0.016 * hs)
  g.fillStyle = c.fg
  g.fill(sheet)
  g.clip(sheet)
  blueprintArt(g, ws, { sheet: c.fg, line: c.bg }, 1, font, (_i, base) => base)
  g.restore()
  // a vignette: the corners of the shot darker
  g.save()
  g.beginPath()
  g.rect(x0, y0, x1 - x0, y1 - y0)
  g.clip()
  const vr = Math.hypot(x1 - x0, y1 - y0) / 2
  const vg = g.createRadialGradient(cx, cy, vr * 0.45, cx, cy, vr)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.3)')
  g.fillStyle = vg
  g.fillRect(x0, y0, x1 - x0, y1 - y0)
  g.restore()
}

export function drawPhoto(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const light = lum(c.bg) > 0.5
  const L = PHOTO_LAYOUT
  const geo = OBJECT_GEOMETRY.photo
  const card = light ? mixHex(c.bg, '#ffffff', 0.82) : mixHex(c.fg, '#ffffff', 0.35)
  g.save()
  if (d.detailAlpha > 0) softShadow(g, d.path, light ? c.fg : '#000000', (light ? 0.22 : 0.5) * Math.min(1, d.detailAlpha), s * 0.09, s * 0.035)
  g.fillStyle = card
  g.fill(d.path)
  g.restore()
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  const box = photoImage(s)
  const [x0, y0, x1, y1] = box
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.save()
  g.clip(d.path)
  photoArt(g, L.sheet.h * s, c, box, d.font)
  // develop: contrast low → full (a flat mid-tone over the image, thinning out)
  const shot = PHOTO.bracketSec
  const dev = easeOutCubic(seg(d.since, shot, shot + PHOTO.developSec))
  const flat = 0.78 * (1 - dev)
  if (flat > 0) {
    g.fillStyle = rgba(mixHex(c.fg, c.bg, 0.5), flat)
    g.fillRect(x0, y0, x1 - x0, y1 - y0)
  }
  // the image's inner edge and the marker scribble on the bottom strip
  g.strokeStyle = 'rgba(0,0,0,0.12)'
  g.lineWidth = Math.max(1, 0.003 * s)
  g.strokeRect(x0, y0, x1 - x0, y1 - y0)
  g.strokeStyle = rgba(light ? c.fg : c.bg, 0.55)
  g.lineWidth = 0.009 * s
  g.lineCap = 'round'
  const sy = ((geo.h / 2 - L.bottom / 2) + 0.005) * s
  const scrib: Pt[] = []
  for (let i = 0; i <= 30; i++) {
    const u = i / 30
    scrib.push([x1 - 0.04 * s - 0.3 * s * u, sy + 0.012 * s * Math.sin(u * 19 + d.seed % 7) * (0.5 + 0.5 * hash01(d.seed, 5000 + (i >> 2)))])
  }
  partialLine(g, scrib, easeOutCubic(seg(d.since, shot + 0.15, shot + 0.55)))
  // the flash: an overexposure over the whole print, fading
  const fl = 1 - seg(d.since, shot, shot + PHOTO.flashSec)
  if (d.since >= shot && fl > 0) {
    g.fillStyle = `rgba(255,255,255,${easeOutCubic(fl)})`
    g.fill(d.path)
  }
  g.restore()
  // viewfinder brackets: snap in, then leave with the flash
  const bk = easeOutCubic(seg(d.since, 0, PHOTO.bracketSec))
  const ba = Math.min(1, bk * 3) * (1 - seg(d.since, shot, shot + PHOTO.flashSec))
  if (ba > 0) {
    const B = L.bracket
    const sc = PHOTO.bracketFrom + (1 - PHOTO.bracketFrom) * bk
    const hw = ((geo.w / 2 + B.out) * s) * sc
    const hh = ((geo.h / 2 + B.out) * s) * sc
    const len = B.len * s
    g.globalAlpha *= ba
    g.strokeStyle = c.accent
    g.lineWidth = B.width * s
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const [sx, sy2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      g.beginPath()
      g.moveTo(sx * hw, sy2 * hh - sy2 * len)
      g.lineTo(sx * hw, sy2 * hh)
      g.lineTo(sx * hw - sx * len, sy2 * hh)
      g.stroke()
    }
  }
  g.restore()
}

// ------------------------------------------------------------------ chat

/**
 * Chat (Stage 1A, «انطيه لـ Claude… ويرجعلك البيت مرسوم»): a chat panel card 1.4 × 1 × size — a
 * surface tinted from the world's bg with a subtle border; a header with a small 8-ray spark glyph
 * (our own asterisk, not a brand logo) top right marking the assistant, a title bar and a rule; at
 * the bottom a composer with the attached photo (a mini blueprint) on its right (RTL start), a
 * placeholder line and a round accent send button with an arrow on the left. Build: the panel,
 * then the composer rises in. At `checkAt` the send button presses, the photo flies up into a sent
 * bubble on the right; `CHAT.typingAfter` s after it lands three typing dots pulse in an assistant
 * bubble on the left (the spark turning); `CHAT.replyAfter` s later that bubble opens into a reply
 * card where a small house elevation draws itself over `CHAT.drawSec`. Layout in units of the
 * size, rectangles [x0, y0, x1, y1].
 */
export const CHAT_LAYOUT = {
  header: { y: -0.415, rule: -0.335 },
  spark: { x: 0.6, r: 0.036 },
  title: [0.25, -0.43, 0.53, -0.4],
  sent: [0.22, -0.3, 0.62, -0.06],
  typing: [-0.62, -0.02, -0.4, 0.08],
  reply: [-0.62, -0.05, -0.04, 0.265],
  composer: [-0.62, 0.3, 0.62, 0.44],
  thumb: [0.45, 0.317, 0.555, 0.423],
  send: { x: -0.545, r: 0.05 },
  bubbleR: 0.04,
} as const

/** The 8-ray spark (our own asterisk: rays of alternating length, round caps), `r` across, at the origin. */
function sparkGlyph(g: CanvasRenderingContext2D, r: number, colour: string, turn: number): void {
  g.save()
  g.rotate(turn)
  g.strokeStyle = colour
  g.lineCap = 'round'
  g.lineWidth = r * 0.28
  g.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (TAU * i) / 8 - Math.PI / 2
    const len = i % 2 ? r * 0.62 : r
    g.moveTo(Math.cos(a) * r * 0.18, Math.sin(a) * r * 0.18)
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len)
  }
  g.stroke()
  g.restore()
}

/** The photo of the plan as a thumbnail filling [x0, y0, x1, y1] (px), with rounded corners. */
function thumbArt(g: CanvasRenderingContext2D, c: ObjectColours, x0: number, y0: number, x1: number, y1: number, font: string): void {
  const w = x1 - x0
  const h = y1 - y0
  g.save()
  const p = new Path2D()
  rrect(p, x0, y0, w, h, Math.min(w, h) * 0.12)
  g.clip(p)
  photoArt(g, h * (PHOTO_LAYOUT.sheet.h / 0.835), c, [x0, y0, x1, y1], font)
  g.restore()
}

export function drawChat(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const light = lum(c.bg) > 0.5
  const ink = c.fg
  const L = CHAT_LAYOUT
  const surface = light ? mixHex(c.bg, '#ffffff', 0.6) : mixHex(c.bg, c.fg, 0.07)
  const R = (r: readonly number[]): [number, number, number, number] => [r[0]! * s, r[1]! * s, r[2]! * s, r[3]! * s]
  g.save()
  liftShadowPath(g, c, s, d.detailAlpha, d.path)
  g.fillStyle = surface
  g.fill(d.path)
  g.restore()
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  const b = d.build
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.strokeStyle = rgba(c.fg, light ? 0.16 : 0.18)
  g.lineWidth = Math.max(1, 0.004 * s)
  g.stroke(d.path)
  g.clip(d.path)
  const k = d.since - d.checkAt
  const fly = easeInOutCubic(seg(k, 0.04, 0.04 + CHAT.flySec))
  const landed = 0.04 + CHAT.flySec
  const typingAt = landed + CHAT.typingAfter
  const replyAt = typingAt + CHAT.replyAfter
  const typing = seg(k, typingAt, typingAt + 0.18)
  const open = softSpring(seg(k, replyAt, replyAt + CHAT.openSec))
  const openC = Math.min(1, Math.max(0, open))

  // header: the spark (turning while the assistant types), the title bar and the rule
  const ha = seg(b, 0, 0.5)
  if (ha > 0) {
    g.save()
    g.globalAlpha *= ha
    const turn = k > typingAt && openC < 1 ? (k - typingAt) * 2.4 : 0
    g.save()
    g.translate(L.spark.x * s, L.header.y * s)
    sparkGlyph(g, L.spark.r * s, c.accent, turn)
    g.restore()
    const [tx0, ty0, tx1, ty1] = R(L.title)
    g.fillStyle = rgba(ink, 0.14)
    g.beginPath()
    rrect(g, tx0, ty0, tx1 - tx0, ty1 - ty0, (ty1 - ty0) / 2)
    g.fill()
    g.fillStyle = rgba(ink, 0.08)
    for (let i = 0; i < 2; i++) {
      g.beginPath()
      g.arc((-0.6 + 0.06 * i) * s, L.header.y * s, 0.014 * s, 0, TAU)
      g.fill()
    }
    g.fillRect(-0.7 * s, L.header.rule * s, 1.4 * s, Math.max(1, 0.003 * s))
    g.restore()
  }

  // the sent bubble with the photo (it forms as the photo lands)
  const [sx0, sy0, sx1, sy1] = R(L.sent)
  const pad = 0.022 * s
  const sentIn: [number, number, number, number] = [sx0 + pad, sy0 + pad, sx1 - pad, sy1 - pad]
  const ba = seg(fly, 0.55, 1)
  if (ba > 0) {
    g.save()
    const sc = 0.92 + 0.08 * easeOutBack(ba, 2)
    g.translate(sx1, sy1)
    g.scale(sc, sc)
    g.translate(-sx1, -sy1)
    g.globalAlpha *= Math.min(1, ba * 1.6)
    g.fillStyle = mixHex(surface, c.accent, light ? 0.2 : 0.3)
    const bub = new Path2D()
    rrect(bub, sx0, sy0, sx1 - sx0, sy1 - sy0, L.bubbleR * s)
    g.fill(bub)
    g.restore()
  }

  // the assistant's bubble: typing dots, then the reply card with the house drawing itself
  if (typing > 0) {
    const t0 = R(L.typing)
    const t1 = R(L.reply)
    const r4 = t0.map((v, i) => v + (t1[i]! - v) * open) as [number, number, number, number]
    const [rx0, ry0, rx1, ry1] = r4
    g.save()
    g.globalAlpha *= typing
    const bubble = new Path2D()
    rrect(bubble, rx0, ry0, rx1 - rx0, ry1 - ry0, L.bubbleR * s)
    g.fillStyle = light ? '#ffffff' : mixHex(surface, c.fg, 0.08)
    g.fill(bubble)
    g.strokeStyle = rgba(ink, light ? 0.1 : 0)
    g.lineWidth = Math.max(1, 0.003 * s)
    if (light) g.stroke(bubble)
    const dotsA = 1 - seg(open, 0, 0.35)
    if (dotsA > 0) {
      const cy = (ry0 + ry1) / 2
      for (let i = 0; i < 3; i++) {
        const ph = Math.max(0, Math.sin(TAU * 1.6 * (k - typingAt) - i * 0.9))
        g.fillStyle = rgba(ink, (0.25 + 0.5 * ph) * dotsA)
        g.beginPath()
        g.arc(rx0 + (0.055 + 0.055 * i) * s, cy - 0.012 * s * ph, 0.016 * s, 0, TAU)
        g.fill()
      }
    }
    if (openC > 0.6) {
      g.save()
      g.clip(bubble)
      g.globalAlpha *= seg(openC, 0.6, 1)
      // two lines of reply text (RTL, right-aligned), then the drawing on a small sheet
      g.strokeStyle = rgba(ink, 0.5)
      g.lineCap = 'round'
      g.lineWidth = 0.016 * s
      g.beginPath()
      g.moveTo(rx1 - 0.035 * s, ry0 + 0.036 * s)
      g.lineTo(rx1 - 0.33 * s, ry0 + 0.036 * s)
      g.stroke()
      g.strokeStyle = rgba(ink, 0.28)
      g.beginPath()
      g.moveTo(rx1 - 0.035 * s, ry0 + 0.066 * s)
      g.lineTo(rx1 - 0.22 * s, ry0 + 0.066 * s)
      g.stroke()
      const ty0 = ry0 + 0.092 * s
      const ty1 = ry1 - 0.024 * s
      const hw = (ty1 - ty0) * 0.88
      const hx = (rx0 + rx1) / 2
      const hy = (ty0 + ty1) / 2 - 0.01 * hw
      const tile = new Path2D()
      rrect(tile, rx0 + 0.024 * s, ty0, rx1 - rx0 - 0.048 * s, ty1 - ty0, 0.02 * s)
      const tileBg = light ? mixHex(c.bg, '#ffffff', 0.4) : mixHex(surface, c.fg, 0.05)
      g.fillStyle = tileBg
      g.fill(tile)
      g.translate(hx, hy)
      const pen = seg(k, replyAt + CHAT.openSec * 0.6, replyAt + CHAT.openSec * 0.6 + CHAT.drawSec)
      houseArt(g, hw, { bg: tileBg, fg: c.fg, accent: c.accent }, { pen, fill: easeOutCubic(seg(pen, 0.7, 1)), lights: [], spill: 0, walls: true })
      g.restore()
    }
    g.restore()
  }

  // the composer: rises in after the panel; the attached photo, the placeholder, the send button
  const ca = easeOutCubic(seg(b, 0.4, 1))
  if (ca > 0) {
    g.save()
    g.globalAlpha *= ca
    g.translate(0, 0.04 * s * (1 - ca))
    const [cx0, cy0, cx1, cy1] = R(L.composer)
    const comp = new Path2D()
    rrect(comp, cx0, cy0, cx1 - cx0, cy1 - cy0, (cy1 - cy0) / 2)
    g.fillStyle = light ? '#ffffff' : mixHex(surface, c.fg, 0.06)
    g.fill(comp)
    g.strokeStyle = rgba(ink, light ? 0.14 : 0)
    g.lineWidth = Math.max(1, 0.003 * s)
    if (light) g.stroke(comp)
    g.strokeStyle = rgba(ink, 0.22)
    g.lineCap = 'round'
    g.lineWidth = 0.014 * s
    g.beginPath()
    g.moveTo(0.38 * s, (cy0 + cy1) / 2)
    g.lineTo(-0.2 * s, (cy0 + cy1) / 2)
    g.stroke()
    // send: an accent disc with an up arrow, pressing at the second beat
    const press = seg(k, 0, CHAT.pressSec)
    const ps = press > 0 && press < 1 ? 1 - 0.15 * Math.sin(Math.PI * Math.min(1, press * 1.6)) * (press < 0.62 ? 1 : 1 - seg(press, 0.62, 1)) : 1
    g.save()
    g.translate(L.send.x * s, (cy0 + cy1) / 2)
    g.scale(ps, ps)
    g.fillStyle = c.accent
    g.beginPath()
    g.arc(0, 0, L.send.r * s, 0, TAU)
    g.fill()
    g.strokeStyle = light ? '#ffffff' : c.bg
    g.lineWidth = 0.011 * s
    g.lineJoin = 'round'
    const a = L.send.r * s * 0.45
    g.beginPath()
    g.moveTo(0, a)
    g.lineTo(0, -a)
    g.moveTo(-a * 0.75, -a * 0.2)
    g.lineTo(0, -a)
    g.lineTo(a * 0.75, -a * 0.2)
    g.stroke()
    g.restore()
    g.restore()
  }

  // the photo: attached in the composer, then flying up (an arc) into the sent bubble
  if (ca > 0) {
    const t0 = R(L.thumb)
    const shift = 0.04 * s * (1 - ca)
    t0[1] += shift
    t0[3] += shift
    const r4 = t0.map((v, i) => v + (sentIn[i]! - v) * fly) as [number, number, number, number]
    const lift = -0.1 * s * Math.sin(Math.PI * fly)
    g.save()
    g.globalAlpha *= fly > 0 ? 1 : ca
    g.translate(0, lift)
    const [px0, py0, px1, py1] = r4
    const frame = new Path2D()
    rrect(frame, px0 - 0.006 * s, py0 - 0.006 * s, px1 - px0 + 0.012 * s, py1 - py0 + 0.012 * s, 0.016 * s)
    if (fly > 0 && fly < 1) softShadow(g, frame, light ? c.fg : '#000000', 0.25, 0.03 * s, 0.012 * s)
    g.fillStyle = light ? '#ffffff' : mixHex(c.fg, '#ffffff', 0.3)
    g.fill(frame)
    thumbArt(g, c, px0, py0, px1, py1, d.font)
    g.restore()
  }
  g.restore()
}

// ------------------------------------------------------------------ banknote

/** The bill's own colours (the same in every world): sage paper, deep green engraving, a gold thread. */
export const NOTE_TOKENS = { paper: '#E3E7CF', tint: '#C3D3B4', ink: '#2E5A4C', light: '#F4F6E8', gold: '#C9A15A' } as const

/**
 * Banknote layout (units of the size; the bill is 1 × 0.48): an engraved double frame, a guilloche
 * rosette (right, RTL start), a watermark oval with a palm (left), fine wave lines across, the
 * value in the corners and «دينار» in the middle. The fanned stack: bills turned by `fanDeg`·i
 * about the bottom-left corner, offset by `fanOff`·i.
 */
export const BANKNOTE_LAYOUT = {
  frame: 0.03,
  frame2: 0.045,
  waves: 9,
  rosette: { x: 0.27, y: 0.0, r: 0.15, petals: 14 },
  oval: { x: -0.27, y: 0.0, rx: 0.12, ry: 0.15 },
  fanDeg: -4.5,
  fanOff: [0.012, 0.01],
  value: '25000',
} as const

/** The engraved face of one bill at build `b` (0..1): frame, waves, rosette, watermark, value. */
function noteArt(g: CanvasRenderingContext2D, s: number, b: number, font: string, value: string, full: boolean): void {
  const geo = OBJECT_GEOMETRY.banknote
  const L = BANKNOTE_LAYOUT
  const T = NOTE_TOKENS
  const hw = (geo.w / 2) * s
  const hh = (geo.h / 2) * s
  const lw = Math.max(1, 0.004 * s)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  // a pale tint band through the middle and fine wave lines across it
  g.fillStyle = rgba(T.tint, 0.55)
  g.fillRect(-hw, -hh * 0.42, 2 * hw, hh * 0.84)
  g.strokeStyle = rgba(T.ink, 0.16)
  g.lineWidth = lw * 0.7
  for (let k = 0; k < L.waves; k++) {
    const y = -hh * 0.8 + (k / (L.waves - 1)) * hh * 1.6
    const pts: Pt[] = []
    for (let i = 0; i <= 48; i++) {
      const x = -hw + (i / 48) * 2 * hw
      pts.push([x, y + Math.sin(i * 0.55 + k * 0.9) * 0.012 * s])
    }
    partialLine(g, pts, easeOutCubic(seg(b, 0.1 + k * 0.03, 0.6 + k * 0.03)))
  }
  // the double frame
  g.strokeStyle = T.ink
  g.lineWidth = lw * 1.4
  partialLine(g, rectLine([-geo.w / 2 + L.frame, -geo.h / 2 + L.frame, geo.w / 2 - L.frame, geo.h / 2 - L.frame], s), easeInOutCubic(seg(b, 0, 0.55)))
  g.lineWidth = lw * 0.7
  partialLine(g, rectLine([-geo.w / 2 + L.frame2, -geo.h / 2 + L.frame2, geo.w / 2 - L.frame2, geo.h / 2 - L.frame2], s), easeInOutCubic(seg(b, 0.1, 0.65)))
  if (!full) return
  // the guilloche rosette: overlapping sine rings
  const R = L.rosette
  const rk = easeOutCubic(seg(b, 0.25, 0.85))
  g.save()
  g.translate(R.x * s, R.y * s)
  g.rotate(-0.6 * (1 - rk))
  g.strokeStyle = rgba(T.ink, 0.7)
  g.lineWidth = lw * 0.6
  for (let ring = 0; ring < 3; ring++) {
    const base = R.r * s * (0.55 + ring * 0.2)
    const pts: Pt[] = []
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * TAU
      const rr = base * (1 + 0.16 * Math.sin(R.petals * a + ring * 1.3))
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr])
    }
    partialLine(g, pts, rk)
  }
  g.fillStyle = rgba(T.gold, 0.9 * rk)
  g.beginPath()
  g.arc(0, 0, R.r * s * 0.18, 0, TAU)
  g.fill()
  g.restore()
  // the watermark oval with a palm (our own simple glyph)
  const O = L.oval
  const ok = easeOutCubic(seg(b, 0.35, 0.9))
  g.save()
  g.translate(O.x * s, O.y * s)
  g.fillStyle = rgba(T.light, 0.85 * ok)
  g.beginPath()
  g.ellipse(0, 0, O.rx * s, O.ry * s, 0, 0, TAU)
  g.fill()
  g.strokeStyle = rgba(T.ink, 0.55 * ok)
  g.lineWidth = lw
  g.stroke()
  g.strokeStyle = rgba(T.ink, 0.6 * ok)
  g.lineWidth = lw * 1.3
  const top: Pt = [0.012 * s, -0.07 * s]
  g.beginPath()
  g.moveTo(-0.01 * s, 0.11 * s)
  g.quadraticCurveTo(0.02 * s, 0.02 * s, top[0], top[1])
  g.stroke()
  // seven fronds arching up and drooping at their tips, each with a few leaflets
  for (let k = 0; k < 7; k++) {
    const side = k < 3 ? -1 : k > 3 ? 1 : 0
    const spread = side === 0 ? 0 : (Math.abs(k - 3) / 3)
    const ex = top[0] + side * (0.03 + 0.07 * spread) * s
    const ey = top[1] + (side === 0 ? -0.055 : -0.035 + 0.085 * spread) * s
    const cx = top[0] + side * (0.015 + 0.045 * spread) * s
    const cy = top[1] - (0.045 - 0.01 * spread) * s
    g.beginPath()
    g.moveTo(top[0], top[1])
    g.quadraticCurveTo(cx, cy, ex, ey)
    g.stroke()
    g.save()
    g.lineWidth = lw * 0.6
    for (let j = 1; j <= 3; j++) {
      const u = j / 4
      const px = (1 - u) * (1 - u) * top[0] + 2 * (1 - u) * u * cx + u * u * ex
      const py = (1 - u) * (1 - u) * top[1] + 2 * (1 - u) * u * cy + u * u * ey
      g.beginPath()
      g.moveTo(px, py)
      g.lineTo(px + (side || 0.4) * 0.008 * s, py + 0.014 * s)
      g.stroke()
    }
    g.restore()
  }
  g.restore()
  // the value and the word (decoration; the readable price is DOM text elsewhere)
  const tk = seg(b, 0.55, 1)
  if (tk > 0) {
    g.save()
    g.globalAlpha *= tk
    g.fillStyle = T.ink
    decoText(g, value, -hw + 0.07 * s, -hh + 0.085 * s, 0.05 * s, 0.25 * s, font, 800, 'ltr', 'left')
    decoText(g, value, hw - 0.07 * s, hh - 0.075 * s, 0.05 * s, 0.25 * s, font, 800, 'ltr', 'right')
    decoText(g, 'دينار', 0, 0.02 * s, 0.075 * s, 0.3 * s, font, 800, 'rtl', 'center')
    g.fillStyle = rgba(T.gold, 0.9)
    g.fillRect(-0.145 * s, -hh, 0.012 * s, 2 * hh)
    g.restore()
  }
}

/**
 * Banknote (the house reel, «شكد راح يكلفك»): the Iraqi dinar is paper, so the money is a bill, not a
 * coin — sage paper, an engraved double frame, wave lines, a guilloche rosette, a watermark oval
 * with a palm, the value (state `text`, default `BANKNOTE_LAYOUT.value`) in two corners and
 * «دينار» in the middle; its own colours in every world. Build: the engraving draws in. At
 * `checkAt` more bills fan out behind it like counted cash (`BANKNOTE`); a sheen sweeps the front
 * bill now and then. Our own design, not any real note's.
 */
export function drawBanknote(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const geo = OBJECT_GEOMETRY.banknote
  const L = BANKNOTE_LAYOUT
  const T = NOTE_TOKENS
  const value = d.text ?? L.value
  const hw = (geo.w / 2) * s
  const hh = (geo.h / 2) * s
  // the fanned stack behind (only once the bill has arrived)
  const fanned: number[] = []
  if (d.detailAlpha > 0) {
    for (let i = 1; i <= BANKNOTE.fan; i++) {
      const k = softSpring(seg(d.since, d.checkAt + (i - 1) * BANKNOTE.fanEvery, d.checkAt + (i - 1) * BANKNOTE.fanEvery + BANKNOTE.fanSec))
      if (k > 0) fanned.push(k)
    }
  }
  for (let i = fanned.length; i >= 1; i--) {
    const k = fanned[i - 1]!
    g.save()
    g.globalAlpha *= d.detailAlpha
    g.translate(-hw, hh)
    g.rotate(((L.fanDeg * i * Math.PI) / 180) * k)
    g.translate(hw + L.fanOff[0] * s * i * k, -hh - L.fanOff[1] * s * i * k)
    const p = new Path2D()
    rrect(p, -hw, -hh, 2 * hw, 2 * hh, geo.r * s)
    softShadow(g, p, '#000000', 0.18, s * 0.03, s * 0.01)
    g.fillStyle = mixHex(T.paper, T.ink, 0.04 * i)
    g.fill(p)
    g.clip(p)
    noteArt(g, s, 1, d.font, value, false)
    g.restore()
  }
  // the front bill
  g.save()
  if (d.detailAlpha > 0) softShadow(g, d.path, '#000000', 0.22 * Math.min(1, d.detailAlpha), s * 0.05, s * 0.018)
  g.fillStyle = T.paper
  g.fill(d.path)
  g.restore()
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.clip(d.path)
  noteArt(g, s, d.build, d.font, value, true)
  // a sheen: a soft light band sweeping across now and then
  const ph = (d.since % BANKNOTE.sheenEvery) / 0.55
  if (d.build >= 1 && ph < 1) {
    const x = -hw * 1.4 + ph * hw * 2.8
    const gr = g.createLinearGradient(x - 0.12 * s, 0, x + 0.12 * s, 0)
    gr.addColorStop(0, 'rgba(255,255,255,0)')
    gr.addColorStop(0.5, 'rgba(255,255,255,0.32)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(-hw, -hh, 2 * hw, 2 * hh)
  }
  g.restore()
}

// ------------------------------------------------------------------ Stage 2 shared: small bills and bricks

/**
 * One bill `w` px wide (the banknote's 1 × 0.48 proportions) centred on the origin, for the scale's
 * bundle and the `build-number` items: the engraved face (`noteArt`) when it is large enough to
 * read, a frame and the rosette's gold dot when small, a flat bill with a tint band when tiny.
 * `shade` (0..1) darkens it (a bill further back in a stack).
 */
export function drawBill(g: CanvasRenderingContext2D, w: number, font: string, shade = 0, value: string = BANKNOTE_LAYOUT.value): void {
  if (!(w > 1)) return
  const geo = OBJECT_GEOMETRY.banknote
  const T = NOTE_TOKENS
  const hw = w / 2
  const hh = (geo.h / geo.w) * hw
  const p = new Path2D()
  rrect(p, -hw, -hh, 2 * hw, 2 * hh, Math.max(0.5, geo.r * w))
  g.save()
  g.fillStyle = mixHex(T.paper, T.ink, 0.05 + 0.18 * shade)
  g.fill(p)
  g.clip(p)
  if (w >= 110) noteArt(g, w, 1, font, value, true)
  else if (w >= 34) {
    g.fillStyle = rgba(T.tint, 0.6)
    g.fillRect(-hw, -hh * 0.42, 2 * hw, hh * 0.84)
    g.strokeStyle = rgba(T.ink, 0.75)
    g.lineWidth = Math.max(0.8, 0.012 * w)
    g.strokeRect(-hw + 0.06 * w, -hh + 0.06 * w, 2 * hw - 0.12 * w, 2 * hh - 0.12 * w)
    g.fillStyle = rgba(T.light, 0.9)
    g.beginPath()
    g.ellipse(-0.27 * w, 0, 0.11 * w, 0.14 * w, 0, 0, TAU)
    g.fill()
    g.strokeStyle = rgba(T.ink, 0.5)
    g.lineWidth = Math.max(0.6, 0.008 * w)
    g.stroke()
    g.fillStyle = rgba(T.ink, 0.55)
    g.beginPath()
    g.arc(0.27 * w, 0, 0.1 * w, 0, TAU)
    g.fill()
    g.fillStyle = T.gold
    g.beginPath()
    g.arc(0.27 * w, 0, 0.045 * w, 0, TAU)
    g.fill()
    g.fillStyle = rgba(T.gold, 0.9)
    g.fillRect(-0.15 * w, -hh, Math.max(0.8, 0.014 * w), 2 * hh)
  } else {
    g.fillStyle = rgba(T.tint, 0.8)
    g.fillRect(-hw, -hh * 0.4, 2 * hw, hh * 0.8)
    g.fillStyle = rgba(T.ink, 0.6)
    g.beginPath()
    g.arc(0.27 * w, 0, 0.11 * w, 0, TAU)
    g.fill()
  }
  g.restore()
  g.strokeStyle = rgba(T.ink, 0.45)
  g.lineWidth = Math.max(0.6, 0.006 * w)
  g.stroke(p)
}

/**
 * One small brick for stacks and walls (`build-number`, the materials icon): its front face
 * `w` × `h` with the top-left corner at (x, y), the top face receding by (`dx`, `dy`) and the
 * right end face (both drawn only when `top` / `end`: hidden ones under a neighbour are skipped),
 * in `BRICK_TOKENS` with gradients, a few seeded specks and its dark edge. A real three-faced
 * brick, not a square.
 */
export function drawBrickBlock(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dx: number, dy: number, seed: number, opts: { top?: boolean; end?: boolean; shade?: number } = {}): void {
  const T = BRICK_TOKENS
  const shade = opts.shade ?? 0
  const lw = Math.max(0.6, 0.035 * h)
  g.save()
  g.lineJoin = 'round'
  if (opts.top !== false) {
    const tp = new Path2D()
    tp.moveTo(x, y)
    tp.lineTo(x + w, y)
    tp.lineTo(x + w + dx, y + dy)
    tp.lineTo(x + dx, y + dy)
    tp.closePath()
    const gr = g.createLinearGradient(0, y + dy, 0, y)
    gr.addColorStop(0, mixHex(mixHex(T.top, T.light, 0.25), T.end, shade))
    gr.addColorStop(1, mixHex(T.top, T.end, shade))
    g.fillStyle = gr
    g.fill(tp)
    g.strokeStyle = rgba(T.edge, 0.55)
    g.lineWidth = lw
    g.stroke(tp)
  }
  if (opts.end !== false) {
    const ep = new Path2D()
    ep.moveTo(x + w, y)
    ep.lineTo(x + w + dx, y + dy)
    ep.lineTo(x + w + dx, y + dy + h)
    ep.lineTo(x + w, y + h)
    ep.closePath()
    g.fillStyle = mixHex(mixHex(T.end, T.edge, 0.15), T.edge, shade * 0.5)
    g.fill(ep)
    g.strokeStyle = rgba(T.edge, 0.6)
    g.lineWidth = lw
    g.stroke(ep)
  }
  const fp = new Path2D()
  rrect(fp, x, y, w, h, Math.min(w, h) * 0.06)
  const gr = g.createLinearGradient(0, y, 0, y + h)
  gr.addColorStop(0, mixHex(mixHex(T.front, T.top, 0.18), T.edge, shade * 0.6))
  gr.addColorStop(1, mixHex(mixHex(T.front, T.end, 0.3), T.edge, shade * 0.6))
  g.fillStyle = gr
  g.fill(fp)
  g.save()
  g.clip(fp)
  for (let i = 0; i < 7; i++) {
    const h0 = hash01(seed, 40 + i)
    g.fillStyle = h0 < 0.6 ? rgba('#4a1606', 0.35) : rgba('#ffd6b8', 0.35)
    g.beginPath()
    g.arc(x + w * hash01(seed, 60 + i), y + h * hash01(seed, 80 + i), Math.max(0.5, h * (0.03 + 0.03 * hash01(seed, 100 + i))), 0, TAU)
    g.fill()
  }
  g.fillStyle = rgba(T.light, 0.5)
  g.fillRect(x, y, w, Math.max(0.6, h * 0.07))
  g.restore()
  g.strokeStyle = rgba(T.edge, 0.7)
  g.lineWidth = lw
  g.stroke(fp)
  g.restore()
}
