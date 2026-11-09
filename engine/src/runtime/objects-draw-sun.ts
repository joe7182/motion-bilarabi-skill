/**
 * Canvas drawing of the house reel's sun-section objects (Stage 2, «الخطأ الثالث: الشمس»): the big
 * sun, the bedroom that is an oven in summer and dark in winter, the map pin that finds your
 * place, the window and its kWh meter (rays, double glass, and the «منور» that gets zero sun) and
 * the sun's high and low paths over a small house. Same contract as `objects-draw.ts`: every
 * function draws centred on the context's origin, is a pure function of its arguments (`since`,
 * `build`, `beats`, `seed`), reads colours as resolved hex values, draws the body on `d.path` and
 * gates its details on `build` / `detailAlpha`. Canvas text is decoration (the canvas is
 * `aria-hidden`). Our own drawing.
 */
import type { Pt } from '../core/morph'
import { OBJECT_GEOMETRY } from '../core/objects'
import { easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../core/ease'
import { beatsOf, PIN, ROOM, SUN, SUN_PATH, WINDOW, windowModeOf } from '../core/params/morph-object'
import { rgba } from './materials'
import { decoText, hash01, lum, mixHex, partialLine, rrect, softShadow, type ObjectColours, type ObjectDraw } from './objects-draw'
import { houseArt } from './objects-draw-home'
import { cardShadow } from './objects-draw-cost'

const TAU = Math.PI * 2

/** A path through `pts` (closed unless `open`). */
function polyPath(pts: readonly Pt[], open = false): Path2D {
  const p = new Path2D()
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)))
  if (!open) p.closePath()
  return p
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const frac = (x: number) => x - Math.floor(x)

// ------------------------------------------------------------------ sun

/** The sun's warm yellow-orange (its disc runs from it to the accent). */
export const SUN_TOKENS = { core: '#FFE3A3', warm: '#FFB547' } as const

/**
 * Sun (Stage 2, «الخطأ الثالث: الشمس»): a big sun, size = its disc's diameter — a warm disc (a radial
 * from `SUN_TOKENS.warm` to the accent, a soft specular), a corona of `SUN.rays` tapered rays,
 * long and short in turn, slowly turning (`SUN.spinDeg`°/s) and breathing in length (seeded
 * periods), and a soft halo. Build (0.8 s): the disc rises from below its own horizon (a thin fg
 * line that fades after), then the rays grow out one by one.
 */
export function drawSun(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const R = d.r
  const c = d.colours
  const b = d.build
  const light = lum(c.bg) > 0.5
  const rise = easeOutCubic(seg(b, 0, SUN.riseShare))
  // the morph's body: a faint warm ghost the disc rises into
  const ghost = Math.max(1 - rise, 1 - d.detailAlpha)
  if (ghost > 0) {
    g.fillStyle = rgba(mixHex(c.bg, SUN_TOKENS.warm, 0.35), ghost)
    g.fill(d.path)
  }
  if (!(d.detailAlpha > 0) || !(b > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  const lift = (1 - rise) * 2 * R
  const horizon = R * 1.0
  // the halo
  const halo = g.createRadialGradient(0, lift, R * 0.8, 0, lift, R * 2.1)
  halo.addColorStop(0, rgba(SUN_TOKENS.warm, (light ? 0.34 : 0.3) * rise))
  halo.addColorStop(0.45, rgba(c.accent, (light ? 0.12 : 0.14) * rise))
  halo.addColorStop(1, rgba(c.accent, 0))
  g.fillStyle = halo
  g.fillRect(-R * 2.2, -R * 2.2 + lift, R * 4.4, R * 4.4)
  // the corona: tapered rays, turning and breathing
  const spin = ((SUN.spinDeg * Math.PI) / 180) * d.since
  for (let i = 0; i < SUN.rays; i++) {
    const k = easeOutBack(seg(b, SUN.riseShare + (i / SUN.rays) * (1 - SUN.riseShare) * 0.85, SUN.riseShare + ((i + 1.5) / SUN.rays) * (1 - SUN.riseShare)))
    if (!(k > 0)) continue
    const long = i % 2 === 0
    const per = SUN.breatheSec[0] + (SUN.breatheSec[1] - SUN.breatheSec[0]) * hash01(d.seed, 40 + i)
    const breathe = 1 + SUN.breathe * Math.sin((TAU * d.since) / per + hash01(d.seed, 60 + i) * TAU)
    const len = R * (long ? 0.55 : 0.36) * breathe * k
    const r0 = R * 1.0
    const hw = R * (long ? 0.06 : 0.048)
    const a = spin + (i / SUN.rays) * TAU
    g.save()
    g.rotate(a)
    const p = new Path2D()
    // a slim spike: straight flanks to a softly rounded tip, the base hugging the disc
    const tip = r0 + len
    p.moveTo(r0, -hw)
    p.lineTo(tip - hw * 0.35, -hw * 0.16)
    p.quadraticCurveTo(tip, 0, tip - hw * 0.35, hw * 0.16)
    p.lineTo(r0, hw)
    p.arc(0, 0, r0, Math.asin(hw / r0), -Math.asin(hw / r0), true)
    p.closePath()
    const gr = g.createLinearGradient(r0, 0, tip, 0)
    gr.addColorStop(0, SUN_TOKENS.warm)
    gr.addColorStop(0.55, mixHex(SUN_TOKENS.warm, c.accent, 0.5))
    gr.addColorStop(1, rgba(c.accent, 0.55))
    g.fillStyle = gr
    g.fill(p)
    g.restore()
  }
  const corona = g.createRadialGradient(0, lift, R * 0.95, 0, lift, R * 1.45)
  corona.addColorStop(0, rgba(SUN_TOKENS.warm, 0.55 * rise))
  corona.addColorStop(1, rgba(SUN_TOKENS.warm, 0))
  g.fillStyle = corona
  g.beginPath()
  g.arc(0, lift, R * 1.45, 0, TAU)
  g.fill()
  // the disc, rising from below its horizon (clipped above it while it rises)
  g.save()
  if (rise < 1) {
    g.beginPath()
    g.rect(-R * 3, -R * 3, R * 6, R * 3 + horizon)
    g.clip()
  }
  g.translate(0, lift)
  const disc = g.createRadialGradient(-R * 0.28, -R * 0.32, R * 0.05, 0, 0, R)
  disc.addColorStop(0, SUN_TOKENS.core)
  disc.addColorStop(0.45, SUN_TOKENS.warm)
  disc.addColorStop(1, c.accent)
  g.fillStyle = disc
  g.beginPath()
  g.arc(0, 0, R, 0, TAU)
  g.fill()
  // a soft rim and a specular
  g.strokeStyle = rgba(mixHex(c.accent, '#000000', 0.15), 0.35)
  g.lineWidth = Math.max(1, R * 0.03)
  g.stroke()
  const sp = g.createRadialGradient(-R * 0.36, -R * 0.4, 0, -R * 0.36, -R * 0.4, R * 0.42)
  sp.addColorStop(0, rgba('#ffffff', 0.45))
  sp.addColorStop(1, rgba('#ffffff', 0))
  g.fillStyle = sp
  g.beginPath()
  g.arc(0, 0, R, 0, TAU)
  g.fill()
  g.restore()
  // the horizon line, fading once the disc is up
  const ha = 1 - seg(b, SUN.riseShare, 1)
  if (ha > 0) {
    g.strokeStyle = rgba(c.fg, 0.8 * ha)
    g.lineWidth = Math.max(1, R * 0.025)
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(-R * 1.7, horizon)
    g.lineTo(R * 1.7, horizon)
    g.stroke()
  }
  g.restore()
}

// ------------------------------------------------------------------ room

/** The bedroom's own colours (the same in every world). */
export const ROOM_TOKENS = {
  back: '#F2EADD',
  left: '#E2D5C0',
  right: '#E8DCC9',
  ceiling: '#F7F2E9',
  floor: '#C9A27A',
  floorFar: '#B48C64',
  plank: '#9C7652',
  frame: '#FBFAF6',
  glass: '#BFDDF0',
  blaze: '#FFF2C2',
  grey: '#8D969F',
  bed: '#7A5236',
  sheet: '#F8F4EC',
  blanket: '#4F8A8B',
  pillow: '#FFFFFF',
  hot: '#E8552B',
  cold: '#2F4A6B',
  red: '#E0362C',
  blue: '#3B7DD8',
  heat: '#FF7A45',
} as const

/**
 * Room layout (units of the size; the box is 1.2 × 0.9): the wall section's thickness, the back
 * wall, the right wall's window (depth `u` and height `v` fractions of that wall), the bed, the
 * thermometer on the left wall.
 */
export const ROOM_LAYOUT = {
  wall: 0.035,
  back: { x: 0.36, top: -0.27, bottom: 0.17 },
  window: { u: [0.22, 0.72], v: [0.16, 0.6] },
  thermo: { x: -0.47, y0: -0.18, y1: 0.03, w: 0.026 },
} as const

/**
 * Room (Stage 2, «غرفة نومك… يا صيف تصير فرن، يا شتا ما تشوف الضو»): a cutaway bedroom in a wall
 * section, 1.2 × 0.9 × size — the cut walls (poché), the back wall, ceiling and wooden floor in
 * perspective, a window in the right wall, a bed with pillow and blanket against the back wall, a
 * small thermometer on the left wall. beats[0] (summer): the window blazes and throws a shaft of
 * light on the floor, the room tints hot, heat lines rise off the bed and the floor, the
 * thermometer climbs to red. beats[1] (winter): the heat fades, the room drops to a cold dim blue,
 * the window turns grey and lets no light in, the thermometer falls to blue, slow snow flecks
 * drift past outside the window.
 */
export function drawRoom(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const T = ROOM_TOKENS
  const L = ROOM_LAYOUT
  const geo = OBJECT_GEOMETRY.room
  const S = (v: number) => v * s
  const beats = beatsOf(d.beats, ROOM.beats)
  // the section's cut walls: the body
  g.fillStyle = mixHex(c.fg, c.bg, 0.12)
  g.fill(d.path)
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  const b = d.build
  const W = geo.w / 2 - L.wall
  const H = geo.h / 2 - L.wall
  const Bk = L.back
  const kw = easeInOutCubic(seg(d.since, beats[1]!, beats[1]! + ROOM.winterSec))
  const ksRaw = easeInOutCubic(seg(d.since, beats[0]!, beats[0]! + ROOM.summerSec))
  const ks = ksRaw * (1 - kw)
  g.save()
  g.globalAlpha *= d.detailAlpha
  const inner = polyPath([[S(-W), S(-H)], [S(W), S(-H)], [S(W), S(H)], [S(-W), S(H)]])
  g.save()
  g.clip(inner)
  const fillK = easeOutCubic(seg(b, 0, 0.5))
  g.globalAlpha *= fillK
  const P = (x: number, y: number): Pt => [S(x), S(y)]
  // ceiling, side walls, back wall, floor
  g.fillStyle = T.ceiling
  g.fill(polyPath([P(-W, -H), P(W, -H), P(Bk.x, Bk.top), P(-Bk.x, Bk.top)]))
  g.fillStyle = T.left
  g.fill(polyPath([P(-W, -H), P(-Bk.x, Bk.top), P(-Bk.x, Bk.bottom), P(-W, H)]))
  g.fillStyle = T.right
  g.fill(polyPath([P(W, -H), P(Bk.x, Bk.top), P(Bk.x, Bk.bottom), P(W, H)]))
  g.fillStyle = T.back
  g.fill(polyPath([P(-Bk.x, Bk.top), P(Bk.x, Bk.top), P(Bk.x, Bk.bottom), P(-Bk.x, Bk.bottom)]))
  const floor = polyPath([P(-Bk.x, Bk.bottom), P(Bk.x, Bk.bottom), P(W, H), P(-W, H)])
  const fg0 = g.createLinearGradient(0, S(Bk.bottom), 0, S(H))
  fg0.addColorStop(0, T.floorFar)
  fg0.addColorStop(1, T.floor)
  g.fillStyle = fg0
  g.fill(floor)
  // planks converging to the back
  g.strokeStyle = rgba(T.plank, 0.45)
  g.lineWidth = Math.max(1, S(0.003))
  for (let i = 1; i < 9; i++) {
    const u = i / 9
    g.beginPath()
    g.moveTo(S(lerp(-Bk.x, Bk.x, u)), S(Bk.bottom))
    g.lineTo(S(lerp(-W, W, u)), S(H))
    g.stroke()
  }
  // the room's corner lines
  g.strokeStyle = rgba('#000000', 0.12)
  g.lineWidth = Math.max(1, S(0.003))
  for (const [a, bb] of [[P(-W, -H), P(-Bk.x, Bk.top)], [P(W, -H), P(Bk.x, Bk.top)], [P(-W, H), P(-Bk.x, Bk.bottom)], [P(W, H), P(Bk.x, Bk.bottom)]] as const) {
    g.beginPath()
    g.moveTo(...a)
    g.lineTo(...bb)
    g.stroke()
  }
  g.strokeRect(S(-Bk.x), S(Bk.top), S(2 * Bk.x), S(Bk.bottom - Bk.top))

  // the window in the right wall: a quad on that wall's plane
  const wallAt = (u: number, v: number): Pt => {
    const x = lerp(Bk.x, W, u)
    const top = lerp(Bk.top, -H, u)
    const bot = lerp(Bk.bottom, H, u)
    return [S(x), S(lerp(top, bot, v))]
  }
  const Wn = L.window
  const quad = (u0: number, u1: number, v0: number, v1: number) => polyPath([wallAt(u0, v0), wallAt(u1, v0), wallAt(u1, v1), wallAt(u0, v1)])
  const frameQ = quad(Wn.u[0] - 0.04, Wn.u[1] + 0.04, Wn.v[0] - 0.035, Wn.v[1] + 0.035)
  const glassQ = quad(Wn.u[0], Wn.u[1], Wn.v[0], Wn.v[1])
  g.fillStyle = T.frame
  g.fill(frameQ)
  g.strokeStyle = rgba('#000000', 0.18)
  g.lineWidth = Math.max(1, S(0.003))
  g.stroke(frameQ)
  const glass = mixHex(mixHex(T.glass, T.blaze, ks), T.grey, kw)
  g.fillStyle = glass
  g.fill(glassQ)
  g.save()
  g.clip(glassQ)
  if (ks > 0) {
    // the summer sun blazing in the glass
    const [gx, gy] = wallAt(lerp(Wn.u[0], Wn.u[1], 0.6), lerp(Wn.v[0], Wn.v[1], 0.3))
    const bl = g.createRadialGradient(gx, gy, 0, gx, gy, S(0.16))
    bl.addColorStop(0, rgba('#ffffff', 0.95 * ks))
    bl.addColorStop(0.4, rgba(T.blaze, 0.8 * ks))
    bl.addColorStop(1, rgba(T.blaze, 0))
    g.fillStyle = bl
    g.fillRect(gx - S(0.2), gy - S(0.2), S(0.4), S(0.4))
  }
  if (kw > 0) {
    // slow snow flecks outside
    for (let i = 0; i < 16; i++) {
      const u = lerp(Wn.u[0], Wn.u[1], hash01(d.seed, 300 + i))
      const v = lerp(Wn.v[0] - 0.1, Wn.v[1] + 0.1, frac(hash01(d.seed, 320 + i) + (d.since - beats[1]!) * (0.12 + 0.08 * hash01(d.seed, 340 + i))))
      const [x, y] = wallAt(u, v)
      g.fillStyle = rgba('#ffffff', 0.9 * kw)
      g.beginPath()
      g.arc(x + Math.sin(d.since * 1.3 + i) * S(0.006), y, S(0.0045 + 0.003 * hash01(d.seed, 360 + i)), 0, TAU)
      g.fill()
    }
  }
  // a sheen on the glass
  const [sx0, sy0] = wallAt(Wn.u[0] + 0.08, Wn.v[1])
  const [sx1, sy1] = wallAt(Wn.u[0] + 0.3, Wn.v[0])
  g.strokeStyle = rgba('#ffffff', 0.35 * (1 - kw * 0.7))
  g.lineWidth = S(0.012)
  g.beginPath()
  g.moveTo(sx0, sy0)
  g.lineTo(sx1, sy1)
  g.stroke()
  g.restore()
  // mullions
  g.strokeStyle = T.frame
  g.lineWidth = S(0.012)
  const um = (Wn.u[0] + Wn.u[1]) / 2, vm = (Wn.v[0] + Wn.v[1]) / 2
  g.beginPath()
  g.moveTo(...wallAt(um, Wn.v[0]))
  g.lineTo(...wallAt(um, Wn.v[1]))
  g.moveTo(...wallAt(Wn.u[0], vm))
  g.lineTo(...wallAt(Wn.u[1], vm))
  g.stroke()

  // the summer light shaft from the window onto the floor
  if (ks > 0) {
    const w0 = wallAt(Wn.u[0], Wn.v[0]), w1 = wallAt(Wn.u[1], Wn.v[0]), w2 = wallAt(Wn.u[1], Wn.v[1]), w3 = wallAt(Wn.u[0], Wn.v[1])
    const f3: Pt = [S(0.13), S(0.25)], f0: Pt = [S(0.33), S(0.23)], f1: Pt = [S(0.46), S(0.36)], f2: Pt = [S(0.2), S(0.39)]
    const shaft = polyPath([w0, w1, w2, f1, f2, f3, w3])
    const sg = g.createLinearGradient(w1[0], w1[1], f2[0], f2[1])
    sg.addColorStop(0, rgba('#FFE08A', 0.6 * ks))
    sg.addColorStop(1, rgba('#FFE08A', 0.22 * ks))
    g.fillStyle = sg
    g.fill(shaft)
    g.fillStyle = rgba('#FFF2C0', 0.8 * ks)
    g.fill(polyPath([f3, f0, f1, f2]))
  }

  // the bed against the back wall: headboard, mattress top, blanket, pillow, legs
  const bk = easeOutCubic(seg(b, 0.25, 0.8))
  g.save()
  g.globalAlpha *= bk
  g.translate(0, S(0.03 * (1 - bk)))
  const hb = polyPath([P(-0.31, -0.02), P(0.02, -0.02), P(0.02, 0.15), P(-0.31, 0.15)])
  g.fillStyle = T.bed
  g.fill(hb)
  g.fillStyle = rgba('#ffffff', 0.12)
  g.fillRect(S(-0.31), S(-0.02), S(0.33), S(0.012))
  const top = [P(-0.33, 0.1), P(0.04, 0.1), P(0.1, 0.27), P(-0.4, 0.27)] as const
  // the mattress side and the bed frame below it
  g.fillStyle = mixHex(T.bed, '#000000', 0.15)
  g.fill(polyPath([P(-0.4, 0.27), P(0.1, 0.27), P(0.1, 0.33), P(-0.4, 0.33)]))
  g.fillStyle = mixHex(T.sheet, '#000000', 0.08)
  g.fill(polyPath([P(-0.4, 0.27), P(0.1, 0.27), P(0.1, 0.29), P(-0.4, 0.29)]))
  for (const lx of [-0.39, 0.08]) {
    g.fillStyle = mixHex(T.bed, '#000000', 0.3)
    g.fillRect(S(lx), S(0.33), S(0.022), S(0.035))
  }
  g.fillStyle = T.sheet
  g.fill(polyPath([...top]))
  // the blanket over the front two thirds, folded back at its top
  const bt = 0.15
  const blanket = polyPath([P(lerp(-0.33, -0.4, (bt - 0.1) / 0.17), bt), P(lerp(0.04, 0.1, (bt - 0.1) / 0.17), bt), P(0.1, 0.27), P(0.1, 0.3), P(-0.4, 0.3), P(-0.4, 0.27)])
  g.fillStyle = T.blanket
  g.fill(blanket)
  g.fillStyle = mixHex(T.blanket, '#ffffff', 0.25)
  g.fill(polyPath([P(lerp(-0.33, -0.4, (bt - 0.1) / 0.17), bt), P(lerp(0.04, 0.1, (bt - 0.1) / 0.17), bt), P(lerp(0.04, 0.1, (bt + 0.03 - 0.1) / 0.17), bt + 0.03), P(lerp(-0.33, -0.4, (bt + 0.03 - 0.1) / 0.17), bt + 0.03)]))
  // the pillow
  const pw = new Path2D()
  rrect(pw, S(-0.24), S(0.075), S(0.2), S(0.06), S(0.025))
  g.fillStyle = T.pillow
  g.fill(pw)
  g.strokeStyle = rgba('#000000', 0.12)
  g.lineWidth = Math.max(1, S(0.003))
  g.stroke(pw)
  g.restore()

  // the thermometer on the left wall
  const Th = L.thermo
  const lvl = lerp(lerp(0.45, 0.92, ksRaw), 0.1, kw)
  const merc = mixHex(mixHex('#D9604A', T.red, ksRaw), T.blue, kw)
  const tk = easeOutCubic(seg(b, 0.4, 0.9))
  g.save()
  g.globalAlpha *= tk
  const tube = new Path2D()
  rrect(tube, S(Th.x - Th.w / 2), S(Th.y0), S(Th.w), S(Th.y1 - Th.y0), S(Th.w / 2))
  g.fillStyle = '#FFFFFF'
  g.fill(tube)
  g.strokeStyle = rgba('#000000', 0.3)
  g.lineWidth = Math.max(1, S(0.003))
  g.stroke(tube)
  g.beginPath()
  g.arc(S(Th.x), S(Th.y1 + 0.012), S(Th.w * 0.95), 0, TAU)
  g.fillStyle = '#FFFFFF'
  g.fill()
  g.stroke()
  g.fillStyle = merc
  g.beginPath()
  g.arc(S(Th.x), S(Th.y1 + 0.012), S(Th.w * 0.65), 0, TAU)
  g.fill()
  const colTop = lerp(Th.y1, Th.y0 + 0.012, lvl)
  g.fillRect(S(Th.x - Th.w * 0.22), S(colTop), S(Th.w * 0.44), S(Th.y1 + 0.012 - colTop))
  g.strokeStyle = rgba('#000000', 0.35)
  for (let i = 1; i < 6; i++) {
    const y = lerp(Th.y1, Th.y0, i / 6)
    g.beginPath()
    g.moveTo(S(Th.x + Th.w / 2), S(y))
    g.lineTo(S(Th.x + Th.w / 2 + 0.012), S(y))
    g.stroke()
  }
  g.restore()
  g.restore()

  // the room's air: hot red-orange in summer, a cold dim blue in winter
  g.save()
  g.clip(inner)
  if (ks > 0) {
    g.fillStyle = rgba(T.hot, 0.35 * ks)
    g.fill(inner)
    // heat lines rising off the bed and the floor
    g.strokeStyle = rgba(T.heat, 0.7 * ks)
    g.lineWidth = Math.max(1, S(0.006))
    g.lineCap = 'round'
    const xs = [-0.32, -0.2, -0.08, 0.2, 0.32]
    xs.forEach((x0, i) => {
      const base = i < 3 ? 0.12 : 0.36
      const ph = frac(d.since * 0.6 + hash01(d.seed, 80 + i))
      const y0 = base - ph * 0.22
      const pts: Pt[] = []
      for (let j = 0; j <= 14; j++) {
        const u = j / 14
        pts.push([S(x0 + 0.018 * Math.sin(u * 9 + d.since * 5 + i)), S(y0 - u * 0.16)])
      }
      g.save()
      g.globalAlpha *= Math.sin(Math.PI * ph)
      partialLine(g, pts, 1)
      g.restore()
    })
  }
  if (kw > 0) {
    g.fillStyle = rgba(T.cold, 0.45 * kw)
    g.fill(inner)
  }
  g.restore()
  // the cut line of the section
  g.strokeStyle = rgba(c.fg, 0.9)
  g.lineWidth = Math.max(1, S(0.005))
  g.stroke(inner)
  g.restore()
}

// ------------------------------------------------------------------ pin

/** The map's own colours (the same in every world). */
export const MAP_TOKENS = { land: '#EFE9DC', block: '#E4DCCB', road: '#FFFFFF', edge: '#D2C7B2', river: '#8FC1DE', riverEdge: '#6CA3C6', park: '#CFE1B9', ink: '#4F5A64', pill: '#1F2933' } as const

/**
 * Pin layout (units of the size; the tile is 1 × 1): the river (a meandering band, Tigris-like —
 * our own curve) as cubic Bézier points, the street grid's pitch and turn, the major roads, the
 * pin's landing point, head radius and height, the label's offset, the coordinates.
 */
export const PIN_LAYOUT = {
  river: [[0.62, -0.48], [0.2, -0.3], [0.42, 0.05], [0.08, 0.12], [-0.25, 0.19], [-0.05, 0.42], [-0.6, 0.5]],
  riverW: 0.075,
  grid: 0.105,
  gridDeg: 14,
  roads: [[[-0.52, -0.2], [-0.1, -0.12], [0.2, 0.3], [0.55, 0.36]], [[-0.3, -0.55], [-0.2, -0.1], [-0.42, 0.25], [-0.36, 0.55]]],
  parks: [[-0.36, -0.4, 0.14, 0.1], [0.24, 0.24, 0.12, 0.09]],
  at: [0.04, 0.03],
  head: 0.085,
  height: 0.2,
  label: { dx: -0.27, dy: -0.15 },
  coords: '33.31, 44.37',
  place: 'بغداد',
} as const

/** Points along a chain of cubic Béziers (p0, c1, c2, p1, c1, c2, p2 …). */
function bezierChain(pts: readonly (readonly number[])[], s: number, steps = 24): Pt[] {
  const out: Pt[] = []
  for (let k = 0; k + 3 < pts.length; k += 3) {
    const [a, b, c, e] = [pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!]
    for (let i = k === 0 ? 0 : 1; i <= steps; i++) {
      const u = i / steps
      const v = 1 - u
      out.push([s * (v * v * v * a[0]! + 3 * v * v * u * b[0]! + 3 * v * u * u * c[0]! + u * u * u * e[0]!), s * (v * v * v * a[1]! + 3 * v * v * u * b[1]! + 3 * v * u * u * c[1]! + u * u * u * e[1]!)])
    }
  }
  return out
}

/** The pin's teardrop (tip at the origin, pointing down), head radius r, height h. */
function pinPath(r: number, h: number): Path2D {
  const p = new Path2D()
  const cy = -h + r
  const a = Math.asin(Math.min(0.95, r / (h - r)))
  p.moveTo(0, 0)
  p.lineTo(-Math.cos(a) * r, cy + Math.sin(a) * r)
  p.arc(0, cy, r, Math.PI - a, TAU + a)
  p.closePath()
  return p
}

/**
 * Pin (Stage 2, «تحسب الشمس الحقيقية لمكانك»): a map tile, 1 × 1 × size (rounded) — blocks on a
 * faint turned street grid, two main roads, parks and a meandering river (Tigris-like, our own
 * curve) with bridges — and an accent location pin that drops from above and lands at beats[0]
 * with a squash, a pulse ring spreading under it (`PIN.pulseEvery`), a label pill with the state
 * `text` (e.g. «بغداد») beside it and small lat / long numerals in the corner («33.31, 44.37»).
 */
export function drawPin(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const T = MAP_TOKENS
  const L = PIN_LAYOUT
  const S = (v: number) => v * s
  const beats = beatsOf(d.beats, PIN.beats)
  cardShadow(g, c, s, d.alpha, d.path)
  g.fillStyle = T.land
  g.fill(d.path)
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  const b = d.build
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.save()
  g.clip(d.path)
  // blocks between the turned street grid
  const gk = easeOutCubic(seg(b, 0, 0.5))
  g.save()
  g.globalAlpha *= gk
  g.rotate((L.gridDeg * Math.PI) / 180)
  const n = Math.ceil(0.8 / L.grid)
  for (let i = -n; i < n; i++)
    for (let j = -n; j < n; j++) {
      const h0 = hash01(d.seed, 2000 + (i + n) * 40 + (j + n))
      g.fillStyle = h0 < 0.08 ? T.park : mixHex(T.block, T.land, 0.3 * hash01(d.seed, 3000 + (i + n) * 40 + (j + n)))
      g.fillRect(S(i * L.grid + 0.012), S(j * L.grid + 0.012), S(L.grid - 0.024), S(L.grid - 0.024))
    }
  g.restore()
  for (const [x, y, w, h] of L.parks) {
    g.fillStyle = rgba(T.park, gk)
    const p = new Path2D()
    rrect(p, S(x!), S(y!), S(w!), S(h!), S(0.02))
    g.fill(p)
  }
  // the main roads draw in
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const road of L.roads) {
    const pts = bezierChain(road, s)
    const k = easeInOutCubic(seg(b, 0.15, 0.7))
    g.strokeStyle = T.edge
    g.lineWidth = S(0.034)
    partialLine(g, pts, k)
    g.strokeStyle = T.road
    g.lineWidth = S(0.024)
    partialLine(g, pts, k)
  }
  // the river, with its bank and two bridges
  const river = bezierChain(L.river, s, 32)
  const rk = easeInOutCubic(seg(b, 0.25, 0.85))
  g.strokeStyle = T.riverEdge
  g.lineWidth = S(L.riverW + 0.012)
  partialLine(g, river, rk)
  g.strokeStyle = T.river
  g.lineWidth = S(L.riverW)
  partialLine(g, river, rk)
  g.strokeStyle = rgba('#ffffff', 0.35)
  g.lineWidth = S(0.008)
  partialLine(g, river.map(([x, y]) => [x - S(0.012), y - S(0.008)] as Pt), rk)
  if (rk >= 1) {
    for (const i of [Math.floor(river.length * 0.3), Math.floor(river.length * 0.72)]) {
      const p = river[i]!
      const q = river[Math.min(river.length - 1, i + 1)]!
      const ang = Math.atan2(q[1] - p[1], q[0] - p[0]) + Math.PI / 2
      g.strokeStyle = T.edge
      g.lineWidth = S(0.03)
      g.beginPath()
      g.moveTo(p[0] - Math.cos(ang) * S(0.06), p[1] - Math.sin(ang) * S(0.06))
      g.lineTo(p[0] + Math.cos(ang) * S(0.06), p[1] + Math.sin(ang) * S(0.06))
      g.stroke()
      g.strokeStyle = T.road
      g.lineWidth = S(0.02)
      g.stroke()
    }
  }
  // the coordinates in the corner
  const ck = seg(b, 0.6, 1)
  if (ck > 0) {
    g.save()
    g.globalAlpha *= ck
    const p = new Path2D()
    rrect(p, S(-0.47), S(0.37), S(0.36), S(0.085), S(0.02))
    g.fillStyle = rgba('#ffffff', 0.85)
    g.fill(p)
    g.fillStyle = T.ink
    decoText(g, L.coords, S(-0.29), S(0.415), S(0.045), S(0.32), d.font, 700, 'ltr', 'center')
    g.restore()
  }
  g.restore()
  // the tile's edge
  g.strokeStyle = rgba(T.ink, 0.25)
  g.lineWidth = Math.max(1, S(0.004))
  g.stroke(d.path)

  // the pin: drops in, lands at beats[0] with a squash; the pulse ring; the label
  const landT = beats[0]!
  const tau = d.since - landT
  const [ax, ay] = [S(L.at[0]), S(L.at[1])]
  if (d.since >= landT - PIN.dropSec) {
    const fall = easeInCubic(seg(d.since, landT - PIN.dropSec, landT))
    // pulse rings on the map
    if (tau > 0) {
      for (let k = 0; k < 3; k++) {
        const t0 = k * PIN.pulseEvery
        const pk = (tau - t0) / PIN.pulseSec
        if (!(pk > 0 && pk < 1)) continue
        g.strokeStyle = rgba(c.accent, 0.6 * (1 - pk))
        g.lineWidth = Math.max(1, S(0.008) * (1 - pk * 0.5))
        g.beginPath()
        g.ellipse(ax, ay, S(0.03 + 0.2 * easeOutCubic(pk)), S(0.012 + 0.08 * easeOutCubic(pk)), 0, 0, TAU)
        g.stroke()
      }
    }
    // its shadow grows as it comes down
    g.fillStyle = rgba('#000000', 0.22 * fall)
    g.beginPath()
    g.ellipse(ax, ay, S(0.03 + 0.02 * fall), S(0.012 + 0.006 * fall), 0, 0, TAU)
    g.fill()
    const q = tau > 0 ? Math.exp(-12 * tau) * Math.cos(30 * tau) : 0
    g.save()
    g.translate(ax, ay - S(0.9) * (1 - fall))
    g.scale(1 + 0.22 * q, 1 - 0.24 * q)
    const pp = pinPath(S(L.head), S(L.height))
    softShadow(g, pp, '#000000', 0.2, S(0.02), S(0.008))
    const pg = g.createRadialGradient(-S(L.head * 0.35), -S(L.height - L.head * 0.6), S(0.01), 0, -S(L.height - L.head), S(L.head * 1.3))
    pg.addColorStop(0, mixHex(c.accent, '#ffffff', 0.35))
    pg.addColorStop(1, mixHex(c.accent, '#000000', 0.12))
    g.fillStyle = pg
    g.fill(pp)
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.arc(0, -S(L.height - L.head), S(L.head * 0.42), 0, TAU)
    g.fill()
    g.restore()
  }
  // the label pill beside the pin
  const lk = easeOutBack(seg(tau, PIN.labelAfter, PIN.labelAfter + 0.25))
  if (lk > 0) {
    const text = d.text ?? L.place
    const lx = ax + S(L.label.dx)
    const ly = ay + S(L.label.dy)
    g.save()
    g.translate(lx, ly)
    g.scale(lk, lk)
    g.font = `800 ${S(0.06)}px ${d.font}`
    const tw = Math.min(S(0.34), g.measureText(text).width)
    const pw = tw + S(0.07)
    const ph = S(0.1)
    const p = new Path2D()
    rrect(p, -pw / 2, -ph / 2, pw, ph, ph / 2)
    softShadow(g, p, '#000000', 0.25, S(0.02), S(0.008))
    g.fillStyle = T.pill
    g.fill(p)
    // a little pointer toward the pin
    g.beginPath()
    g.moveTo(pw / 2 - S(0.01), -S(0.018))
    g.lineTo(pw / 2 + S(0.03), S(0.0))
    g.lineTo(pw / 2 - S(0.01), S(0.018))
    g.fill()
    g.fillStyle = '#ffffff'
    decoText(g, text, 0, S(0.004), S(0.06), S(0.34), d.font, 800, 'rtl', 'center')
    g.restore()
  }
  g.restore()
}

// ------------------------------------------------------------------ window

/** The window's own colours: the wall, the frame, the glass and its light, the meter chip. */
export const WINDOW_TOKENS = {
  wall: '#EFE7DA',
  wallShade: '#E1D6C4',
  floor: '#C9A27A',
  plank: '#9C7652',
  frame: '#FAFAF6',
  frameShade: '#D9D6CE',
  sky: '#CFE6F5',
  skyLow: '#EEF6FB',
  light: '#FFF1C4',
  pane2: '#9CC9E8',
  chip: '#1D242B',
  chipInk: '#9AA6B2',
  red: '#FF4D4F',
  winterSky: '#C6D0DA',
  winterLow: '#E3E8ED',
  gap: '#59626C',
  gapDeep: '#363D45',
  poche: '#3F3A36',
  inside: '#D8CBB7',
  neighbour: '#B8B1A6',
  sunLow: '#FFE2AE',
  snow: '#FFFFFF',
} as const

/**
 * Window layout (units of the size; the wall section is 0.9 × 1.1): the opening (outer frame
 * [x0, y0, x1, y1]), frame thickness, transom, the sill, the floor band, the meter chip (centre,
 * w × h), the light's direction (dx, dy per unit of travel); for the «منور»: the house wall and the
 * neighbour's wall (x ranges, tops), the gap, the window in the wall, the ground, the sun's path.
 */
export const WINDOW_LAYOUT = {
  opening: [-0.27, -0.45, 0.27, 0.06],
  frame: 0.032,
  transom: -0.25,
  sill: [-0.32, 0.06, 0.32, 0.095],
  floor: 0.4,
  chip: { x: 0, y: 0.235, w: 0.4, h: 0.12 },
  ray: [-0.15, 0.62],
  zero: {
    house: { x0: -0.26, x1: -0.13, top: -0.33, parapet: -0.38 },
    neighbour: { x0: 0.13, x1: 0.26, top: -0.47 },
    window: { y0: -0.17, y1: 0.07 },
    ground: 0.44,
    sun: { x0: -0.42, x1: -0.28, y: -0.495, lift: 0.015, r: 0.042 },
    chip: { x: 0, y: 0.34, w: 0.56, h: 0.16 },
  },
} as const

/** The kWh meter chip centred at (x, y): a dark rounded chip with a bolt, the value in accent digits and «kWh». */
function meterChip(g: CanvasRenderingContext2D, s: number, c: ObjectColours, font: string, x: number, y: number, w: number, h: number, value: number, red: number): void {
  const T = WINDOW_TOKENS
  const p = new Path2D()
  rrect(p, x - w / 2, y - h / 2, w, h, h * 0.28)
  softShadow(g, p, '#000000', 0.25, h * 0.2, h * 0.08)
  g.fillStyle = T.chip
  g.fill(p)
  g.strokeStyle = rgba('#ffffff', 0.12)
  g.lineWidth = Math.max(1, s * 0.003)
  g.stroke(p)
  const ink = mixHex(c.accent, T.red, red)
  // the bolt
  g.fillStyle = ink
  const bx = x - w / 2 + h * 0.5
  const u = h * 0.32
  g.beginPath()
  g.moveTo(bx + u * 0.25, y - u)
  g.lineTo(bx - u * 0.45, y + u * 0.12)
  g.lineTo(bx + u * 0.02, y + u * 0.12)
  g.lineTo(bx - u * 0.25, y + u)
  g.lineTo(bx + u * 0.45, y - u * 0.15)
  g.lineTo(bx - u * 0.02, y - u * 0.15)
  g.closePath()
  g.fill()
  const digits = value.toFixed(1)
  decoText(g, digits, x + w * 0.06, y + h * 0.03, h * 0.62, w * 0.44, font, 800, 'ltr', 'right')
  g.fillStyle = T.chipInk
  decoText(g, 'kWh', x + w * 0.1, y + h * 0.08, h * 0.32, w * 0.3, font, 700, 'ltr', 'left')
}

/**
 * Window (Stage 2, «شكد كيلو واط بالساعة تدخل من كل شباك» and «صفر شمس بالشتا»): a window in a
 * wall section, 0.9 × 1.1 × size — frame, mullions, glass with a sheen, a sill, and a kWh meter
 * chip under it (Latin digits). By `text`: `'rays'` (default) sun rays stream down through the
 * glass onto the floor as light shafts with drifting dust motes while the meter counts up to
 * `WINDOW.kwh`, landing at beats[0]; `'glass'` the same, then at beats[0] a second inner frame
 * slides in (double glazing, cooler tint, dimmer shafts) and the meter counts down to
 * `WINDOW.kwhGlass`; `'zero'` a section through a «منور» — the empty, unroofed gap between this
 * house's wall (with the window) and the neighbour's tall blank wall, open to the sky: the low
 * winter sun crosses above from beats[0], its slanted beam hits only the top of the neighbour's
 * wall, the gap stays in shadow down to the ground (no ray reaches the glass), snow falls in it and
 * the meter's large «0.0» pulses red at beats[1].
 */
export function drawWindow(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const mode = windowModeOf(d.text)
  if (mode === 'zero') return drawWindowZero(g, d)
  const s = 2 * d.r
  const c = d.colours
  const T = WINDOW_TOKENS
  const L = WINDOW_LAYOUT
  const geo = OBJECT_GEOMETRY.window
  const S = (v: number) => v * s
  const beats = beatsOf(d.beats, WINDOW.beats[mode])
  cardShadow(g, c, s, d.alpha, d.path)
  const wg = g.createLinearGradient(0, S(-geo.h / 2), 0, S(L.floor))
  wg.addColorStop(0, T.wall)
  wg.addColorStop(1, T.wallShade)
  g.fillStyle = wg
  g.fill(d.path)
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  const b = d.build
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.save()
  g.clip(d.path)
  // the floor band and its planks
  const fk = easeOutCubic(seg(b, 0, 0.5))
  g.globalAlpha *= fk
  g.fillStyle = T.floor
  g.fillRect(S(-0.5), S(L.floor), S(1), S(0.2))
  g.strokeStyle = rgba(T.plank, 0.5)
  g.lineWidth = Math.max(1, S(0.003))
  for (let i = 0; i < 4; i++) {
    g.beginPath()
    g.moveTo(S(-0.5), S(L.floor + 0.035 * (i + 1)))
    g.lineTo(S(0.5), S(L.floor + 0.035 * (i + 1)))
    g.stroke()
  }
  g.fillStyle = mixHex(T.wallShade, '#000000', 0.12)
  g.fillRect(S(-0.5), S(L.floor - 0.02), S(1), S(0.02))
  g.globalAlpha /= fk || 1

  const [ox0, oy0, ox1, oy1] = L.opening
  const fr = L.frame
  const gx0 = ox0 + fr, gx1 = ox1 - fr, gy0 = oy0 + fr, gy1 = oy1 - fr
  const glassPath = polyPath([[S(gx0), S(gy0)], [S(gx1), S(gy0)], [S(gx1), S(gy1)], [S(gx0), S(gy1)]])
  // the double pane (glass mode) and how the light changes
  const pane = mode === 'glass' ? easeInOutCubic(seg(d.since, beats[0]!, beats[0]! + WINDOW.paneSec)) : 0
  const lightK = easeOutCubic(seg(b, 0.35, 1)) * (1 - 0.55 * pane)
  // the glass: sky, the sun's glow at the top right
  const sk = g.createLinearGradient(0, S(gy0), 0, S(gy1))
  sk.addColorStop(0, T.sky)
  sk.addColorStop(1, T.skyLow)
  g.fillStyle = sk
  g.fill(glassPath)
  g.save()
  g.clip(glassPath)
  const sun = g.createRadialGradient(S(gx1 - 0.05), S(gy0 + 0.05), 0, S(gx1 - 0.05), S(gy0 + 0.05), S(0.2))
  sun.addColorStop(0, rgba('#ffffff', 0.95 * lightK))
  sun.addColorStop(0.25, rgba(T.light, 0.8 * lightK))
  sun.addColorStop(1, rgba(T.light, 0))
  g.fillStyle = sun
  g.fill(glassPath)
  if (pane > 0) {
    g.fillStyle = rgba(T.pane2, 0.35 * pane)
    g.fill(glassPath)
  }
  g.strokeStyle = rgba('#ffffff', 0.5)
  g.lineWidth = S(0.018)
  g.beginPath()
  g.moveTo(S(gx0 + 0.05), S(gy1))
  g.lineTo(S(gx0 + 0.2), S(gy0))
  g.moveTo(S(gx0 + 0.11), S(gy1))
  g.lineTo(S(gx0 + 0.23), S(gy0 + 0.1))
  g.stroke()
  g.restore()

  // the light: one shaft swept down-left from the glass to the floor, cut by the mullion and
  // transom shadows, a bright patch on the floor, dust motes drifting in it
  const [vx, vy] = L.ray
  if (lightK > 0) {
    const reach = (L.floor - gy0) / vy
    const ex = vx * reach, ey = vy * reach
    const sweep = (x0: number, y0: number, x1: number, y1: number): Path2D => polyPath([[S(x0), S(y0)], [S(x1), S(y0)], [S(x1), S(y1)], [S(x1 + ex), S(y1 + ey)], [S(x0 + ex), S(y1 + ey)], [S(x0 + ex), S(y0 + ey)]])
    g.save()
    g.beginPath()
    g.rect(S(-0.5), S(-0.6), S(1), S(0.6 + L.floor))
    g.rect(S(ox0), S(oy0), S(ox1 - ox0), S(oy1 - oy0))
    g.clip('evenodd')
    const shaft = sweep(gx0, gy0, gx1, gy1)
    const sgr = g.createLinearGradient(S(gx1), S(gy0), S(gx0 + ex), S(gy1 + ey))
    sgr.addColorStop(0, rgba('#FFD978', 0.62 * lightK))
    sgr.addColorStop(1, rgba('#FFD978', 0.24 * lightK))
    g.fillStyle = sgr
    g.fill(shaft)
    g.save()
    g.clip(shaft)
    g.fillStyle = rgba(T.wallShade, 0.75)
    g.fill(sweep(-0.012, gy0, 0.012, gy1))
    g.fill(sweep(gx0, L.transom - 0.012, gx1, L.transom + 0.012))
    g.restore()
    for (let k = 0; k < 22; k++) {
      const u = frac(hash01(d.seed, 400 + k) + d.since * (0.06 + 0.05 * hash01(d.seed, 420 + k)))
      const x = lerp(gx0, gx1, hash01(d.seed, 440 + k)) + ex * u + 0.01 * Math.sin(d.since * 1.7 + k)
      const y = lerp(gy0, gy1, hash01(d.seed, 460 + k)) + ey * u
      g.fillStyle = rgba('#ffffff', 0.9 * lightK * Math.sin(Math.PI * u))
      g.beginPath()
      g.arc(S(x), S(y), S(0.004 + 0.004 * hash01(d.seed, 480 + k)), 0, TAU)
      g.fill()
    }
    g.restore()
    // the patch on the floor (cut by the mullion's shadow), foreshortened
    const px0 = gx0 + ex, px1 = gx1 + ex
    for (const [a0, a1] of [[px0, (px0 + px1) / 2 - 0.012], [(px0 + px1) / 2 + 0.012, px1]] as const) {
      g.fillStyle = rgba('#FFEBB0', 0.85 * lightK)
      g.fill(polyPath([[S(a0 + 0.02), S(L.floor + 0.008)], [S(a1 + 0.02), S(L.floor + 0.008)], [S(a1 - 0.03), S(L.floor + 0.075)], [S(a0 - 0.03), S(L.floor + 0.075)]]))
    }
  }

  // the frame, the mullion and transom, the inner frame of the double pane sliding in
  const frame = new Path2D()
  frame.rect(S(ox0), S(oy0), S(ox1 - ox0), S(oy1 - oy0))
  frame.rect(S(gx0), S(gy0), S(gx1 - gx0), S(gy1 - gy0))
  const fk2 = easeOutCubic(seg(b, 0, 0.6))
  g.save()
  g.globalAlpha *= fk2
  g.fillStyle = T.frame
  g.fill(frame, 'evenodd')
  g.strokeStyle = rgba('#000000', 0.18)
  g.lineWidth = Math.max(1, S(0.003))
  g.strokeRect(S(ox0), S(oy0), S(ox1 - ox0), S(oy1 - oy0))
  g.strokeRect(S(gx0), S(gy0), S(gx1 - gx0), S(gy1 - gy0))
  g.fillStyle = T.frame
  g.fillRect(S(-0.012), S(gy0), S(0.024), S(gy1 - gy0))
  g.fillRect(S(gx0), S(L.transom - 0.012), S(gx1 - gx0), S(0.024))
  g.strokeStyle = rgba('#000000', 0.12)
  g.strokeRect(S(-0.012), S(gy0), S(0.024), S(gy1 - gy0))
  g.strokeRect(S(gx0), S(L.transom - 0.012), S(gx1 - gx0), S(0.024))
  g.restore()
  if (pane > 0) {
    g.save()
    g.clip(glassPath)
    g.translate(S(0.6) * (1 - pane), 0)
    const inset = 0.022
    const f2 = new Path2D()
    f2.rect(S(gx0 + 0.006), S(gy0 + 0.006), S(gx1 - gx0 - 0.012), S(gy1 - gy0 - 0.012))
    f2.rect(S(gx0 + inset), S(gy0 + inset), S(gx1 - gx0 - 2 * inset), S(gy1 - gy0 - 2 * inset))
    g.fillStyle = T.frameShade
    g.fill(f2, 'evenodd')
    g.strokeStyle = rgba('#000000', 0.2)
    g.lineWidth = Math.max(1, S(0.003))
    g.strokeRect(S(gx0 + inset), S(gy0 + inset), S(gx1 - gx0 - 2 * inset), S(gy1 - gy0 - 2 * inset))
    g.restore()
  }
  // the sill
  const [sx0, sy0, sx1, sy1] = L.sill
  g.save()
  g.globalAlpha *= fk2
  g.fillStyle = rgba('#000000', 0.08)
  g.fillRect(S(sx0 + 0.01), S(sy1), S(sx1 - sx0 - 0.02), S(0.025))
  g.fillStyle = T.frame
  g.fillRect(S(sx0), S(sy0), S(sx1 - sx0), S(sy1 - sy0))
  g.strokeStyle = rgba('#000000', 0.2)
  g.lineWidth = Math.max(1, S(0.003))
  g.strokeRect(S(sx0), S(sy0), S(sx1 - sx0), S(sy1 - sy0))
  g.restore()
  g.restore()

  // the meter chip under the sill: counts up (and in glass mode down again)
  const ck = easeOutBack(seg(b, 0.5, 1))
  if (ck > 0) {
    let v: number
    if (mode === 'glass') {
      const up = Math.max(WINDOW.countFrom + 0.2, Math.min(WINDOW.countFrom + WINDOW.countSec, beats[0]! - 0.1))
      v = WINDOW.kwh * easeOutCubic(seg(d.since, WINDOW.countFrom, up))
      v += (WINDOW.kwhGlass - WINDOW.kwh) * easeInOutCubic(seg(d.since, beats[0]! + 0.1, beats[0]! + 0.1 + WINDOW.downSec))
    } else v = WINDOW.kwh * easeOutCubic(seg(d.since, WINDOW.countFrom, Math.max(WINDOW.countFrom + 0.05, beats[0]!)))
    const C = L.chip
    g.save()
    g.translate(S(C.x), S(C.y))
    g.scale(ck, ck)
    meterChip(g, s, c, d.font, 0, 0, S(C.w), S(C.h), Math.round(v * 10) / 10, 0)
    g.restore()
  }
  g.restore()
}

/** The «منور» section (window mode 'zero'). */
function drawWindowZero(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const T = WINDOW_TOKENS
  const Z = WINDOW_LAYOUT.zero
  const geo = OBJECT_GEOMETRY.window
  const S = (v: number) => v * s
  const beats = beatsOf(d.beats, WINDOW.beats.zero)
  const top = -geo.h / 2, bottom = geo.h / 2, left = -geo.w / 2, right = geo.w / 2
  cardShadow(g, c, s, d.alpha, d.path)
  // the body: the pale winter sky
  const sky = g.createLinearGradient(0, S(top), 0, S(0))
  sky.addColorStop(0, T.winterSky)
  sky.addColorStop(1, T.winterLow)
  g.fillStyle = sky
  g.fill(d.path)
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  const b = d.build
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.save()
  g.clip(d.path)
  const H = Z.house, N = Z.neighbour
  const wk = easeOutCubic(seg(b, 0, 0.6))
  // the low winter sun crossing above, and its slanted beam ending on the neighbour's wall top
  const u = easeInOutCubic(seg(d.since, beats[0]!, beats[0]! + WINDOW.travelSec))
  const sunX = lerp(Z.sun.x0, Z.sun.x1, u)
  const sunY = Z.sun.y - Z.sun.lift * Math.sin(Math.PI * u)
  const sa = seg(d.since, beats[0]! - 0.1, beats[0]! + 0.15)
  if (sa > 0) {
    const halo = g.createRadialGradient(S(sunX), S(sunY), 0, S(sunX), S(sunY), S(0.2))
    halo.addColorStop(0, rgba(T.sunLow, 0.7 * sa))
    halo.addColorStop(1, rgba(T.sunLow, 0))
    g.fillStyle = halo
    g.fillRect(S(sunX - 0.2), S(sunY - 0.2), S(0.4), S(0.4))
    // the beam: from the sun to the top of the neighbour's wall, and no further
    // its lower edge grazes the house's parapet corner, so it ends on the neighbour's upper face
    const lowY = Math.min(N.top + 0.09, lerp(sunY, H.parapet, (N.x0 - sunX) / (H.x1 - sunX)))
    const beam = polyPath([[S(sunX), S(sunY - 0.025)], [S(N.x1), S(N.top - 0.004)], [S(N.x0), S(N.top)], [S(N.x0), S(lowY)], [S(sunX), S(sunY + 0.025)]])
    const bg = g.createLinearGradient(S(sunX), S(sunY), S(N.x0), S(N.top))
    bg.addColorStop(0, rgba(T.sunLow, 0.6 * sa))
    bg.addColorStop(1, rgba(T.sunLow, 0.3 * sa))
    g.fillStyle = bg
    g.fill(beam)
    g.fillStyle = mixHex(T.sunLow, '#ffffff', 0.4)
    g.globalAlpha *= sa
    g.beginPath()
    g.arc(S(sunX), S(sunY), S(Z.sun.r), 0, TAU)
    g.fill()
    g.globalAlpha /= sa
  }
  g.globalAlpha *= wk
  // the gap (منور): in shadow all the way down to the ground
  const gap = g.createLinearGradient(0, S(H.parapet), 0, S(Z.ground))
  gap.addColorStop(0, mixHex(T.gap, T.winterSky, 0.35))
  gap.addColorStop(0.3, T.gap)
  gap.addColorStop(1, T.gapDeep)
  g.fillStyle = gap
  g.fillRect(S(H.x1), S(H.parapet), S(N.x0 - H.x1), S(Z.ground - H.parapet))
  // the house: inside (left), its cut wall with the window, the parapet
  g.fillStyle = T.inside
  g.fillRect(S(left), S(H.top + 0.03), S(H.x0 - left), S(Z.ground - H.top))
  g.fillStyle = mixHex(T.inside, '#000000', 0.15)
  g.fillRect(S(left), S(H.top + 0.03), S(H.x0 - left), S(0.035))
  g.fillRect(S(left), S(Z.ground - 0.02), S(H.x0 - left), S(0.02))
  g.fillStyle = T.poche
  g.fillRect(S(H.x0), S(H.parapet), S(H.x1 - H.x0), S(Z.ground - H.parapet))
  g.fillRect(S(left), S(H.top), S(H.x0 - left), S(0.035))
  // the window through the wall: frame, double glass lines, sill
  const Wz = Z.window
  g.fillStyle = mixHex(T.inside, '#000000', 0.12)
  g.fillRect(S(H.x0), S(Wz.y0), S(H.x1 - H.x0), S(Wz.y1 - Wz.y0))
  const fx = (H.x0 + H.x1) / 2
  g.fillStyle = T.frame
  g.fillRect(S(fx - 0.03), S(Wz.y0), S(0.06), S(0.016))
  g.fillRect(S(fx - 0.03), S(Wz.y1 - 0.016), S(0.06), S(0.016))
  g.fillRect(S(fx - 0.03), S(Wz.y0), S(0.012), S(Wz.y1 - Wz.y0))
  g.fillRect(S(fx + 0.018), S(Wz.y0), S(0.012), S(Wz.y1 - Wz.y0))
  g.fillStyle = mixHex(T.gapDeep, '#9FB2C4', 0.55)
  g.fillRect(S(fx - 0.012), S(Wz.y0 + 0.016), S(0.008), S(Wz.y1 - Wz.y0 - 0.032))
  g.fillRect(S(fx + 0.004), S(Wz.y0 + 0.016), S(0.008), S(Wz.y1 - Wz.y0 - 0.032))
  g.fillStyle = T.frame
  g.fillRect(S(H.x0 - 0.015), S(Wz.y1), S(H.x1 - H.x0 + 0.04), S(0.016))
  // the neighbour's tall blank wall (cut) and its house beyond
  g.fillStyle = T.neighbour
  g.fillRect(S(N.x1), S(N.top + 0.02), S(right - N.x1), S(Z.ground - N.top))
  g.fillStyle = T.poche
  g.fillRect(S(N.x0), S(N.top), S(N.x1 - N.x0), S(Z.ground - N.top))
  // where the low sun lands: the very top of the neighbour's wall, lit
  if (sa > 0) {
    g.fillStyle = rgba(T.sunLow, 0.95 * sa)
    g.fillRect(S(N.x0), S(N.top), S(N.x1 - N.x0), S(0.014))
    const lowY = Math.min(N.top + 0.09, lerp(sunY, H.parapet, (N.x0 - sunX) / (H.x1 - sunX)))
    g.fillStyle = rgba(T.sunLow, 0.85 * sa)
    g.fillRect(S(N.x0 - 0.01), S(N.top), S(0.01), S(lowY - N.top))
  }
  // the ground (cut) under everything
  g.fillStyle = T.poche
  g.fillRect(S(left), S(Z.ground), S(right - left), S(bottom - Z.ground))
  g.strokeStyle = rgba('#ffffff', 0.12)
  g.lineWidth = Math.max(1, S(0.003))
  for (let i = 0; i < 12; i++) {
    const x = left + i * 0.08
    g.beginPath()
    g.moveTo(S(x), S(bottom))
    g.lineTo(S(x + 0.1), S(Z.ground))
    g.stroke()
  }
  // snow falling slowly in the gap
  for (let i = 0; i < 14; i++) {
    const x = lerp(H.x1 + 0.015, N.x0 - 0.015, hash01(d.seed, 600 + i)) + 0.01 * Math.sin(d.since * 1.2 + i * 1.7)
    const y = lerp(N.top, Z.ground, frac(hash01(d.seed, 620 + i) + d.since * (0.07 + 0.05 * hash01(d.seed, 640 + i))))
    g.fillStyle = rgba(T.snow, 0.85)
    g.beginPath()
    g.arc(S(x), S(y), S(0.004 + 0.003 * hash01(d.seed, 660 + i)), 0, TAU)
    g.fill()
  }
  // the gap's name
  g.fillStyle = rgba('#ffffff', 0.75)
  decoText(g, 'منور', S((H.x1 + N.x0) / 2), S(-0.26), S(0.05), S(N.x0 - H.x1 - 0.03), d.font, 800, 'rtl', 'center')
  g.restore()

  // the meter: a large 0.0 that pulses red once
  const ck = easeOutBack(seg(b, 0.5, 1))
  if (ck > 0) {
    const C = Z.chip
    const pk = seg(d.since, beats[1]!, beats[1]! + WINDOW.pulseSec)
    const pulse = Math.sin(Math.PI * pk)
    g.save()
    g.translate(S(C.x), S(C.y))
    g.scale(ck * (1 + 0.12 * pulse), ck * (1 + 0.12 * pulse))
    if (pulse > 0) {
      const ring = new Path2D()
      rrect(ring, -S(C.w / 2) - S(0.02) * pk, -S(C.h / 2) - S(0.02) * pk, S(C.w) + S(0.04) * pk, S(C.h) + S(0.04) * pk, S(C.h * 0.35))
      g.strokeStyle = rgba(T.red, 0.7 * (1 - pk))
      g.lineWidth = S(0.012)
      g.stroke(ring)
    }
    meterChip(g, s, c, d.font, 0, 0, S(C.w), S(C.h), 0, pulse)
    g.restore()
  }
  g.restore()
}

// ------------------------------------------------------------------ sun-path

/**
 * Sun-path layout (units of the size; the dome is 1.2 × 1, the ground at `ground`): the summer
 * and winter arcs (half ellipses rx × ry on the ground at the house), their labels, the house's
 * width, the suns' radii.
 */
export const SUN_PATH_LAYOUT = {
  summer: { rx: 0.52, ry: 0.78, label: '٢١ يونيو', lx: 0.33, ly: -0.47 },
  winter: { rx: 0.37, ry: 0.37, label: '٢١ ديسمبر', lx: 0.0, ly: -0.06 },
  house: 0.3,
  sunR: [0.05, 0.038],
} as const

/**
 * Sun path (Stage 2, «بأطول يوم وأقصر يوم بالسنة»): a small house (the house object's linework)
 * at the bottom centre under the sky's dome, 1.2 × 1 × size, with two dashed arcs — the high summer
 * arc «٢١ يونيو» and the low winter arc «٢١ ديسمبر». At beats[0] a sun travels the high arc
 * (`SUN_PATH.travelSec`) leaving a solid trail; at beats[1] a smaller, paler sun travels the low
 * arc. The house's shadow on the ground swings with the moving sun: short under the high sun,
 * long under the low one.
 */
export function drawSunPath(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const geo = OBJECT_GEOMETRY['sun-path']
  const L = SUN_PATH_LAYOUT
  const S = (v: number) => v * s
  const beats = beatsOf(d.beats, SUN_PATH.beats)
  const light = lum(c.bg) > 0.5
  const gy = geo.ground
  // the sky dome (the body) and the ground band
  const sky = g.createLinearGradient(0, S(-geo.h / 2), 0, S(gy))
  sky.addColorStop(0, mixHex(c.bg, '#8EC3EA', light ? 0.22 : 0.2))
  sky.addColorStop(1, mixHex(c.bg, '#FFD9A0', light ? 0.16 : 0.1))
  g.fillStyle = sky
  g.fill(d.path)
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  const b = d.build
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.save()
  g.clip(d.path)
  g.fillStyle = mixHex(c.bg, c.fg, light ? 0.1 : 0.16)
  g.fillRect(S(-0.6), S(gy), S(1.2), S(0.2))
  g.restore()
  g.strokeStyle = rgba(c.fg, 0.8)
  g.lineWidth = Math.max(1, S(0.006))
  g.lineCap = 'round'
  partialLine(g, [[S(-0.6), S(gy)], [S(0.6), S(gy)]], easeOutCubic(seg(b, 0, 0.4)))

  const arcPt = (a: { rx: number; ry: number }, u: number): Pt => {
    const ang = Math.PI + Math.PI * u
    return [S(a.rx * Math.cos(ang)), S(gy + a.ry * Math.sin(ang))]
  }
  const arcPts = (a: { rx: number; ry: number }, u1 = 1): Pt[] => Array.from({ length: 65 }, (_, i) => arcPt(a, (i / 64) * u1))
  const arcs = [L.summer, L.winter] as const
  // the dashed arcs and their labels
  arcs.forEach((a, i) => {
    const k = easeInOutCubic(seg(b, 0.15 + 0.15 * i, 0.75 + 0.15 * i))
    g.save()
    g.setLineDash([S(0.018), S(0.016)])
    g.strokeStyle = rgba(c.fg, 0.45)
    g.lineWidth = Math.max(1, S(0.0055))
    partialLine(g, arcPts(a), k)
    g.restore()
    const lk = seg(b, 0.6 + 0.2 * i, 1)
    if (lk > 0) {
      g.save()
      g.globalAlpha *= lk
      g.fillStyle = rgba(c.fg, 0.85)
      decoText(g, a.label, S(a.lx), S(a.ly), S(0.058), S(0.3), d.font, 800, 'rtl', 'center')
      g.restore()
    }
  })

  // the suns and their trails; the active sun drives the shadow
  const prog = beats.map((t0) => easeInOutCubic(seg(d.since, t0, t0 + SUN_PATH.travelSec)))
  let shadowSun: Pt | undefined
  arcs.forEach((a, i) => {
    if (!(d.since >= beats[i]!)) return
    const u = prog[i]!
    const pale = i === 1
    const col = pale ? mixHex(SUN_TOKENS.warm, c.bg, 0.25) : c.accent
    g.strokeStyle = rgba(col, pale ? 0.8 : 0.95)
    g.lineWidth = S(pale ? 0.008 : 0.011)
    g.lineCap = 'round'
    if (u > 0) partialLine(g, arcPts(a, u), 1)
    const [x, y] = arcPt(a, u)
    const r = S(L.sunR[i]!)
    const ap = seg(d.since, beats[i]!, beats[i]! + 0.12)
    g.save()
    g.globalAlpha *= ap
    const halo = g.createRadialGradient(x, y, r * 0.5, x, y, r * 2.6)
    halo.addColorStop(0, rgba(SUN_TOKENS.warm, pale ? 0.3 : 0.45))
    halo.addColorStop(1, rgba(SUN_TOKENS.warm, 0))
    g.fillStyle = halo
    g.fillRect(x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2)
    const disc = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
    disc.addColorStop(0, pale ? '#FFF1D2' : SUN_TOKENS.core)
    disc.addColorStop(1, pale ? mixHex(SUN_TOKENS.warm, '#ffffff', 0.25) : mixHex(c.accent, SUN_TOKENS.warm, 0.35))
    g.fillStyle = disc
    g.beginPath()
    g.arc(x, y, r, 0, TAU)
    g.fill()
    g.restore()
    shadowSun = [x / s, y / s]
  })

  // the house and its shadow
  const hs = S(L.house)
  const hk = easeOutCubic(seg(b, 0.1, 0.7))
  if (shadowSun) {
    const [sx, sy] = shadowSun
    const elev = Math.atan2(gy - sy, Math.abs(sx) + 1e-3)
    const hh = 0.27 * L.house
    const len = Math.min(0.42, hh / Math.max(0.12, Math.tan(elev)))
    const dir = sx < 0 ? 1 : -1
    const sa = 0.35 * Math.min(1, Math.sin(elev) * 3)
    if (sa > 0) {
      const x0 = -0.48 * L.house, x1 = 0.48 * L.house
      const far = dir > 0 ? x1 : x0
      const near = dir > 0 ? x0 : x1
      g.fillStyle = rgba(light ? c.fg : '#000000', sa)
      const depth = 0.01 + 0.06 * (len / 0.42)
      g.fill(polyPath([[S(near), S(gy)], [S(far), S(gy)], [S(far + dir * len), S(gy + depth)], [S(near + dir * len), S(gy + depth)]]))
    }
  }
  g.save()
  g.globalAlpha *= hk
  g.translate(0, S(gy) - 0.45 * hs)
  houseArt(g, hs, c, { pen: 1, fill: 1, lights: [], spill: 0, walls: true })
  g.restore()
  g.restore()
}
