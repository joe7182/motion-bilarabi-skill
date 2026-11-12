/**
 * Canvas drawing of the everyday objects (`core/objects-everyday.ts`): camera, heart, star, video
 * player, shopping cart, open book, megaphone, rocket. Same contract as `objects-draw.ts`: every
 * function draws centred on the context's origin, is a pure function of its arguments (`since`,
 * `build`, `beats`, `seed`), reads colours as resolved hex values, draws the body on `d.path` and
 * gates its details on `build` / `detailAlpha`. Each has one moment of its own at `beats[0]`
 * (default `EVERYDAY_BEAT`). Our own drawing; no real product or logo.
 */
import { easeInOutCubic, easeOutBack, easeOutCubic, seg } from '../core/ease'
import { EVERYDAY_BEAT, EVERYDAY_GEOMETRY as G, type EverydayId } from '../core/objects-everyday'
import { beatsOf } from '../core/params/morph-object'
import { rgba } from './materials'
import { hash01, lum, mixHex, rrect, softShadow, type ObjectDraw } from './objects-draw'

const TAU = Math.PI * 2

/** What every drawing starts from: the size, a scaler, the tones for this colour world, and the beat clock. */
function setup(d: ObjectDraw) {
  const s = 2 * d.r
  const c = d.colours
  const light = lum(c.bg) > 0.5
  return {
    s,
    S: (v: number) => v * s,
    c,
    light,
    /** Details drawn ON a paper body: always dark. */
    dark: light ? c.fg : c.bg,
    /** A dark material body (a camera, a screen): ink on a light world, a lifted charcoal with a rim on a dark one. */
    slab: light ? c.fg : mixHex(c.bg, c.fg, 0.17),
    /** Lines drawn outside the body, on the world itself. */
    line: c.fg,
    paper: light ? mixHex(c.bg, '#ffffff', 0.7) : mixHex(c.bg, c.fg, 0.92),
    soft: light ? mixHex(c.bg, c.fg, 0.14) : mixHex(c.bg, c.fg, 0.26),
    /** Seconds since the object's own moment (negative before it). */
    tau: d.since - beatsOf(d.beats, [EVERYDAY_BEAT])[0]!,
    b: d.build,
  }
}

/** The body on the morphing outline, with a soft shadow on a light world. */
function body(g: CanvasRenderingContext2D, d: ObjectDraw, fill: string | CanvasGradient, light: boolean): void {
  if (light && d.detailAlpha > 0) softShadow(g, d.path, d.colours.fg, 0.14 * d.detailAlpha, d.r * 0.16, d.r * 0.08)
  g.fillStyle = fill
  g.fill(d.path)
}

/** A dark slab body: on a dark world it gets a thin light rim so it reads against the background. */
function slabBody(g: CanvasRenderingContext2D, d: ObjectDraw, slab: string, light: boolean): void {
  body(g, d, slab, light)
  if (light) return
  g.save()
  g.clip(d.path)
  g.strokeStyle = rgba(d.colours.fg, 0.4 * Math.min(1, d.alpha))
  g.lineWidth = d.r * 0.035
  g.stroke(d.path)
  g.restore()
}

/** Details are drawn only once the body has arrived. */
const ready = (d: ObjectDraw) => d.detailAlpha > 0 && d.build > 0

/** A burst of short rays around (x, y) at progress k (0..1). */
function rays(g: CanvasRenderingContext2D, x: number, y: number, r0: number, len: number, n: number, k: number, colour: string, width: number, spin = 0): void {
  if (!(k > 0 && k < 1)) return
  const out = easeOutCubic(k)
  g.save()
  g.strokeStyle = rgba(colour, 1 - k * k)
  g.lineWidth = width
  g.lineCap = 'round'
  for (let i = 0; i < n; i++) {
    const a = spin + (i / n) * TAU
    g.beginPath()
    g.moveTo(x + Math.cos(a) * (r0 + len * out * 0.6), y + Math.sin(a) * (r0 + len * out * 0.6))
    g.lineTo(x + Math.cos(a) * (r0 + len * out), y + Math.sin(a) * (r0 + len * out))
    g.stroke()
  }
  g.restore()
}

/** Camera: the lens draws in ring by ring; at the beat the shutter closes and opens and the flash fires. */
function drawCamera(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const { S, c, light, slab, paper, soft, tau, b } = setup(d)
  const dark = '#0b0d14'
  const geo = G.camera
  slabBody(g, d, slab, light)
  if (!ready(d)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  // a grip band across the body, the flash window and the shutter button on the hump
  g.fillStyle = rgba(light ? '#ffffff' : '#000000', light ? 0.1 : 0.22)
  g.fillRect(S(-0.5), S(-0.06), S(1), S(0.26))
  const flash = seg(tau, 0, 0.09) * (1 - seg(tau, 0.09, 0.4))
  g.fillStyle = mixHex(soft, '#ffffff', 0.5 + 0.5 * flash)
  g.beginPath()
  rrect(g, S(0.26), S(-0.19), S(0.15), S(0.08), S(0.02))
  g.fill()
  g.fillStyle = c.accent
  g.beginPath()
  rrect(g, S(-0.42), S(-0.27), S(0.13), S(0.05), S(0.02))
  g.fill()
  // the lens: rim, glass, iris, glint
  const k = easeOutBack(seg(b, 0.2, 0.9), 1.4)
  const ly = S(geo.lens.y)
  const R = S(geo.lens.r) * k
  if (R > 0.5) {
    g.fillStyle = paper
    g.beginPath(); g.arc(0, ly, R, 0, TAU); g.fill()
    g.fillStyle = dark
    g.beginPath(); g.arc(0, ly, R * 0.82, 0, TAU); g.fill()
    const glass = g.createRadialGradient(-R * 0.25, ly - R * 0.25, R * 0.05, 0, ly, R * 0.7)
    glass.addColorStop(0, mixHex(c.accent, '#ffffff', 0.55))
    glass.addColorStop(0.55, mixHex(c.accent, '#10131c', 0.55))
    glass.addColorStop(1, '#0b0d14')
    g.fillStyle = glass
    g.beginPath(); g.arc(0, ly, R * 0.66, 0, TAU); g.fill()
    // the shutter: closes to a point and opens again
    const shut = seg(tau, 0, 0.1) * (1 - seg(tau, 0.12, 0.3))
    if (shut > 0) {
      g.fillStyle = '#0b0d14'
      g.beginPath(); g.arc(0, ly, R * 0.66 * shut, 0, TAU); g.fill()
    }
    g.fillStyle = rgba('#ffffff', 0.75)
    g.beginPath(); g.arc(-R * 0.26, ly - R * 0.28, R * 0.1, 0, TAU); g.fill()
  }
  // the flash: a white bloom from the flash window and a ring of rays
  if (flash > 0) {
    const fx = S(0.335), fy = S(-0.15)
    const bloom = g.createRadialGradient(fx, fy, 0, fx, fy, S(0.55))
    bloom.addColorStop(0, rgba('#ffffff', 0.95 * flash))
    bloom.addColorStop(1, rgba('#ffffff', 0))
    g.fillStyle = bloom
    g.fillRect(fx - S(0.6), fy - S(0.6), S(1.2), S(1.2))
  }
  rays(g, S(0.335), S(-0.15), S(0.1), S(0.16), 8, seg(tau, 0.02, 0.5), light ? c.accent : '#ffffff', S(0.018))
  g.restore()
}

/** Heart: at the beat it beats twice (a quick double pulse) and small hearts fly up. */
function drawHeart(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const { S, c, light, tau } = setup(d)
  const pulse = (t: number) => (t > 0 && t < 0.3 ? Math.sin((t / 0.3) * Math.PI) * (1 - t / 0.3) : 0)
  const k = 1 + 0.16 * pulse(tau) + 0.11 * pulse(tau - 0.22)
  const fill = g.createLinearGradient(0, S(-0.45), 0, S(0.45))
  fill.addColorStop(0, mixHex(c.accent, '#ffffff', 0.18))
  fill.addColorStop(1, mixHex(c.accent, '#000000', 0.12))
  g.save()
  g.scale(k, k)
  body(g, d, fill, light)
  if (ready(d)) {
    // a soft highlight on the upper left lobe
    g.globalAlpha *= d.detailAlpha * easeOutCubic(seg(d.build, 0.3, 1))
    g.strokeStyle = rgba('#ffffff', 0.55)
    g.lineWidth = S(0.045)
    g.lineCap = 'round'
    g.beginPath()
    g.arc(S(-0.23), S(-0.16), S(0.13), Math.PI * 1.05, Math.PI * 1.55)
    g.stroke()
  }
  g.restore()
  if (!ready(d)) return
  // three small hearts rising after the beat
  for (let i = 0; i < 3; i++) {
    const u = seg(tau, 0.12 + i * 0.1, 1.1 + i * 0.1)
    if (!(u > 0 && u < 1)) continue
    const x = S([-0.42, 0.44, 0.08][i]! + 0.05 * Math.sin(u * 5 + i))
    const y = S(-0.25 - 0.55 * easeOutCubic(u))
    const r = S(0.055) * (1 - 0.4 * u)
    g.save()
    g.globalAlpha *= d.detailAlpha * (1 - u * u)
    g.translate(x, y)
    g.fillStyle = c.accent
    g.beginPath()
    g.moveTo(0, r * 0.9)
    g.bezierCurveTo(-r * 2, -r * 0.6, -r * 0.6, -r * 1.6, 0, -r * 0.5)
    g.bezierCurveTo(r * 0.6, -r * 1.6, r * 2, -r * 0.6, 0, r * 0.9)
    g.fill()
    g.restore()
  }
}

/** Star: a warm gold star; at the beat it spins a little, a shine sweeps across and sparkles pop around it. */
function drawStar(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const { S, c, light, tau } = setup(d)
  const gold = mixHex(c.accent, '#FFC83A', 0.7)
  const turn = (1 - easeOutCubic(seg(tau, 0, 0.6))) * (tau > 0 ? -0.5 : 0)
  const pop = 1 + 0.14 * Math.sin(seg(tau, 0, 0.35) * Math.PI)
  const fill = g.createLinearGradient(0, S(-0.5), 0, S(0.5))
  fill.addColorStop(0, mixHex(gold, '#ffffff', 0.35))
  fill.addColorStop(1, mixHex(gold, c.accent, 0.35))
  g.save()
  g.rotate(turn)
  g.scale(pop, pop)
  body(g, d, fill, light)
  if (ready(d)) {
    // the shine: a bright band sweeping across, clipped to the star
    const u = seg(tau, 0.1, 0.7)
    if (u > 0 && u < 1) {
      g.save()
      g.clip(d.path)
      g.globalAlpha *= d.detailAlpha
      g.rotate(-0.5)
      g.fillStyle = rgba('#ffffff', 0.6 * Math.sin(u * Math.PI))
      g.fillRect(S(-0.75 + 1.5 * u), S(-0.8), S(0.16), S(1.6))
      g.restore()
    }
  }
  g.restore()
  if (!ready(d)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  // four-point sparkles around it
  for (let i = 0; i < 4; i++) {
    const u = seg(tau, 0.05 + i * 0.09, 0.65 + i * 0.09)
    if (!(u > 0 && u < 1)) continue
    const a = -0.9 + i * 1.7 + hash01(d.seed, 40 + i)
    const x = Math.cos(a) * S(0.62), y = Math.sin(a) * S(0.58)
    const r = S(0.07) * Math.sin(u * Math.PI)
    g.fillStyle = light ? gold : '#ffffff'
    g.beginPath()
    for (let q = 0; q < 8; q++) {
      const rr = q % 2 ? r * 0.28 : r
      const aa = (q / 8) * TAU
      q ? g.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr) : g.moveTo(x + rr, y)
    }
    g.closePath()
    g.fill()
  }
  g.restore()
}

/** Video player: a dark screen with a round play button; at the beat the button is pressed and the progress bar starts to fill. */
function drawPlay(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const { S, c, light, slab, tau, b } = setup(d)
  const dark = '#14110e'
  const geo = G.play
  slabBody(g, d, slab, light)
  if (!ready(d)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.clip(d.path)
  // a soft picture glow, so the screen is not a flat slab
  const glow = g.createRadialGradient(S(-0.25), S(-0.12), 0, S(-0.25), S(-0.12), S(0.9))
  glow.addColorStop(0, rgba(c.accent, 0.3))
  glow.addColorStop(1, rgba(c.accent, 0))
  g.fillStyle = glow
  g.fillRect(S(-geo.w / 2), S(-geo.h / 2), S(geo.w), S(geo.h))
  // the play button
  const press = 1 - 0.14 * Math.sin(seg(tau, 0, 0.22) * Math.PI)
  const k = easeOutBack(seg(b, 0.25, 0.9), 1.6) * press
  const R = S(0.17) * k
  const playing = tau > 0.12
  if (R > 0.5) {
    g.fillStyle = playing ? c.accent : rgba('#ffffff', 0.92)
    g.beginPath(); g.arc(0, S(-0.04), R, 0, TAU); g.fill()
    g.fillStyle = playing ? '#ffffff' : dark
    g.beginPath()
    if (playing) {
      rrect(g, -R * 0.38, S(-0.04) - R * 0.42, R * 0.26, R * 0.84, R * 0.06)
      rrect(g, R * 0.12, S(-0.04) - R * 0.42, R * 0.26, R * 0.84, R * 0.06)
    } else {
      g.moveTo(-R * 0.3, S(-0.04) - R * 0.46); g.lineTo(R * 0.52, S(-0.04)); g.lineTo(-R * 0.3, S(-0.04) + R * 0.46); g.closePath()
    }
    g.fill()
  }
  // the progress bar: a track, a fill that runs once pressed, a knob
  const barK = easeOutCubic(seg(b, 0.5, 1))
  const x0 = S(-geo.w / 2 + 0.1), w = S(geo.w - 0.2) * barK, y = S(geo.h / 2 - 0.12)
  g.fillStyle = rgba('#ffffff', 0.28)
  g.beginPath(); rrect(g, x0, y, w, S(0.028), S(0.014)); g.fill()
  const p = Math.min(0.72, Math.max(0, tau - 0.12) * 0.22)
  if (p > 0) {
    g.fillStyle = c.accent
    g.beginPath(); rrect(g, x0, y, w * p, S(0.028), S(0.014)); g.fill()
    g.fillStyle = '#ffffff'
    g.beginPath(); g.arc(x0 + w * p, y + S(0.014), S(0.03), 0, TAU); g.fill()
  }
  g.restore()
}

/** Shopping cart: the basket's wires, the handle and the wheels build; at the beat a parcel drops in and the cart bounces. */
function drawCart(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const { S, c, light, dark, line, paper, tau, b } = setup(d)
  const geo = G.cart
  const drop = seg(tau, 0, 0.28)
  const bounce = tau > 0.28 ? Math.exp(-9 * (tau - 0.28)) * Math.sin((tau - 0.28) * 30) * S(0.022) : 0
  g.save()
  g.translate(0, bounce)
  // the parcel falls in behind the front wires
  if (ready(d) && tau > 0) {
    const py = S(-0.75 + 0.6 * drop * drop)
    g.save()
    g.globalAlpha *= d.detailAlpha
    g.fillStyle = c.accent
    g.beginPath(); rrect(g, S(-0.17), py, S(0.34), S(0.3), S(0.03)); g.fill()
    g.fillStyle = rgba('#ffffff', 0.5)
    g.fillRect(S(-0.03), py, S(0.06), S(0.3))
    g.restore()
  }
  body(g, d, paper, light)
  if (ready(d)) {
    g.globalAlpha *= d.detailAlpha
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.lineWidth = S(0.03)
    // rim (on the world), wires (on the basket)
    g.strokeStyle = light ? dark : mixHex(paper, dark, 0.35)
    g.stroke(d.path)
    g.strokeStyle = dark
    g.save()
    g.clip(d.path)
    g.lineWidth = S(0.016)
    const wires = easeOutCubic(seg(b, 0.2, 0.8))
    for (let i = 1; i <= 5; i++) {
      const x = S(-0.5 + i / 6)
      g.beginPath(); g.moveTo(x, S(geo.top)); g.lineTo(x * 0.72, S(geo.top) + S(geo.bottom - geo.top) * wires); g.stroke()
    }
    for (let j = 1; j <= 2; j++) {
      const y = S(geo.top + ((geo.bottom - geo.top) * j) / 3)
      g.beginPath(); g.moveTo(S(-0.5), y); g.lineTo(S(-0.5) + S(1) * wires, y); g.stroke()
    }
    g.restore()
    // the handle (on the right, the side the cart is pushed from in RTL) and the undercarriage
    g.strokeStyle = line
    g.lineWidth = S(0.04)
    const hk = easeOutCubic(seg(b, 0.4, 1))
    g.beginPath(); g.moveTo(S(0.47), S(geo.top + 0.02)); g.lineTo(S(0.47 + 0.11 * hk), S(geo.top - 0.1 * hk)); g.lineTo(S(0.47 + 0.24 * hk), S(geo.top - 0.1 * hk)); g.stroke()
    g.lineWidth = S(0.03)
    g.beginPath(); g.moveTo(S(-0.34), S(geo.bottom)); g.lineTo(S(-0.3), S(0.31)); g.lineTo(S(0.3), S(0.31)); g.lineTo(S(0.34), S(geo.bottom)); g.stroke()
    // the wheels
    const wk = easeOutBack(seg(b, 0.5, 1), 1.8)
    for (const x of [-0.24, 0.24]) {
      g.fillStyle = line
      g.beginPath(); g.arc(S(x), S(0.39), S(0.065) * wk, 0, TAU); g.fill()
      g.fillStyle = c.bg
      g.beginPath(); g.arc(S(x), S(0.39), S(0.024) * wk, 0, TAU); g.fill()
    }
  }
  g.restore()
}

/** Open book: two pages with text lines that write themselves; at the beat a page turns from the reading side. */
function drawBook(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const { S, c, light, dark, paper, soft, tau, b } = setup(d)
  const geo = G.book
  body(g, d, paper, light)
  if (!ready(d)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.save()
  g.clip(d.path)
  // the gutter shadow at the spine, the cover edge at the bottom
  const gut = g.createLinearGradient(S(-0.1), 0, S(0.1), 0)
  gut.addColorStop(0, rgba(dark, 0)); gut.addColorStop(0.5, rgba(dark, light ? 0.22 : 0.3)); gut.addColorStop(1, rgba(dark, 0))
  g.fillStyle = gut
  g.fillRect(S(-0.1), S(-geo.h / 2), S(0.2), S(geo.h + 0.1))
  g.fillStyle = c.accent
  g.fillRect(S(-geo.w / 2), S(geo.h / 2 - 0.02), S(geo.w), S(0.12))
  // text lines on both pages (they write from the reading side: the right page first)
  g.lineCap = 'round'
  g.lineWidth = S(0.022)
  g.strokeStyle = soft
  for (let page = 0; page < 2; page++) {
    for (let i = 0; i < 5; i++) {
      const u = easeOutCubic(seg(b, 0.25 + page * 0.25 + i * 0.05, 0.6 + page * 0.25 + i * 0.05))
      if (!(u > 0)) continue
      const xr = page === 0 ? S(0.56) : S(-0.1)
      const len = S(0.46) * (i === 4 ? 0.55 : 1) * u
      const y = S(-0.22 + i * 0.1)
      g.strokeStyle = i === 1 && page === 0 ? c.accent : soft
      g.beginPath(); g.moveTo(xr, y); g.lineTo(xr - len, y); g.stroke()
    }
  }
  g.restore()
  // the turning page: sweeps from the right edge over the spine to the left
  const u = easeInOutCubic(seg(tau, 0, 0.7))
  if (u > 0 && u < 1) {
    const edge = S(geo.w / 2) * Math.cos(u * Math.PI)
    const lift = S(0.16) * Math.sin(u * Math.PI)
    g.fillStyle = mixHex(paper, dark, 0.06 + 0.1 * Math.sin(u * Math.PI))
    g.strokeStyle = rgba(dark, 0.25)
    g.lineWidth = S(0.008)
    g.beginPath()
    g.moveTo(0, S(-geo.h / 2 + geo.dip))
    g.quadraticCurveTo(edge * 0.5, S(-geo.h / 2) - lift, edge, S(-geo.h / 2 + 0.02) - lift * 0.5)
    g.lineTo(edge, S(geo.h / 2 - 0.02) - lift * 0.5)
    g.quadraticCurveTo(edge * 0.5, S(geo.h / 2) - lift, 0, S(geo.h / 2 + geo.dip - 0.04))
    g.closePath()
    g.fill()
    g.stroke()
  }
  g.restore()
}

/** Megaphone: a cone with an accent rim and a grip; from the beat on, sound arcs leave its bell in waves. */
function drawMegaphone(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const { S, c, light, dark, paper, tau, b } = setup(d)
  const geo = G.megaphone
  const kick = tau > 0 ? Math.exp(-7 * tau) * Math.sin(tau * 34) * 0.05 : 0
  g.save()
  g.rotate(kick)
  body(g, d, paper, light)
  if (ready(d)) {
    g.save()
    g.globalAlpha *= d.detailAlpha
    g.save()
    g.clip(d.path)
    // the accent rim of the bell, the dark grip block, a band on the cone
    g.fillStyle = c.accent
    g.fillRect(S(-geo.w / 2), S(-geo.bell), S(0.09), S(geo.bell * 2))
    g.fillStyle = light ? dark : mixHex(paper, dark, 0.45)
    g.fillRect(S(geo.grip.x), S(-geo.neck), S(geo.w / 2 - geo.grip.x), S(geo.neck * 2))
    g.fillStyle = rgba(dark, light ? 0.12 : 0.2)
    g.fillRect(S(-0.02), S(-geo.bell), S(0.06), S(geo.bell * 2))
    g.restore()
    // the handle under the grip
    const hk = easeOutCubic(seg(b, 0.4, 1))
    g.fillStyle = light ? dark : mixHex(paper, dark, 0.3)
    g.beginPath(); rrect(g, S(geo.grip.x + 0.01), S(geo.neck - 0.01), S(0.09), S(0.26) * hk, S(0.03)); g.fill()
    g.restore()
  }
  g.restore()
  if (!ready(d) || !(tau > 0)) return
  // sound arcs, three at a time, leaving the bell toward the reading side (left)
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    const u = ((tau * 1.1 + i / 3) % 1 + 1) % 1
    const r = S(0.16 + 0.42 * u)
    g.strokeStyle = rgba(c.accent, Math.sin(u * Math.PI) * Math.min(1, tau * 4))
    g.lineWidth = S(0.034) * (1 - 0.4 * u)
    g.beginPath()
    g.arc(S(-geo.w / 2 + 0.06), 0, r, Math.PI - 0.62, Math.PI + 0.62)
    g.stroke()
  }
  g.restore()
}

/** Rocket: a white body with an accent nose and fins and a round window; at the beat the engine lights: a flickering flame and puffs of smoke. */
function drawRocket(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const { S, c, light, dark, paper, soft, tau, b } = setup(d)
  const geo = G.rocket
  const lit = seg(tau, 0, 0.18)
  const shake = lit > 0 ? (hash01(d.seed, Math.floor(d.since * 40)) - 0.5) * S(0.012) * lit : 0
  // the flame and the smoke, behind the body
  if (ready(d) && lit > 0) {
    g.save()
    g.globalAlpha *= d.detailAlpha
    for (let i = 0; i < 5; i++) {
      const u = ((tau * 0.9 + i / 5) % 1 + 1) % 1
      const x = S((hash01(d.seed, 60 + i) - 0.5) * 0.5 * u)
      g.fillStyle = rgba(soft, 0.75 * (1 - u) * lit)
      g.beginPath(); g.arc(x, S(geo.base + 0.2 + 0.5 * u), S(0.06 + 0.12 * u), 0, TAU); g.fill()
    }
    const flick = 0.82 + 0.18 * Math.sin(d.since * 46) * Math.sin(d.since * 29)
    const len = S(0.42) * lit * flick
    for (const [w, col, k] of [[0.13, c.accent, 1], [0.08, mixHex(c.accent, '#FFD45C', 0.75), 0.72], [0.04, '#FFFBE8', 0.45]] as const) {
      g.fillStyle = col
      g.beginPath()
      g.moveTo(S(-w), S(geo.base + 0.08))
      g.quadraticCurveTo(S(-w * 0.9), S(geo.base + 0.08) + len * k * 0.6, 0, S(geo.base + 0.08) + len * k)
      g.quadraticCurveTo(S(w * 0.9), S(geo.base + 0.08) + len * k * 0.6, S(w), S(geo.base + 0.08))
      g.closePath()
      g.fill()
    }
    g.restore()
  }
  g.save()
  g.translate(shake, 0)
  body(g, d, paper, light)
  if (ready(d)) {
    g.save()
    g.globalAlpha *= d.detailAlpha
    g.save()
    g.clip(d.path)
    // the nose cone, the fins, the engine collar, a shade down one side
    g.fillStyle = c.accent
    g.fillRect(S(-geo.w / 2), S(geo.nose), S(geo.w), S(0.2))
    g.fillRect(S(-geo.w / 2), S(0.12), S(geo.w / 2 - geo.body), S(0.5))
    g.fillRect(S(geo.body), S(0.12), S(geo.w / 2 - geo.body), S(0.5))
    g.fillStyle = dark
    g.fillRect(S(-geo.body), S(geo.base + 0.02), S(geo.body * 2), S(0.1))
    g.fillStyle = rgba(dark, light ? 0.09 : 0.16)
    g.fillRect(S(0.04), S(geo.nose), S(geo.body), S(1))
    g.restore()
    // the window
    const k = easeOutBack(seg(b, 0.3, 0.9), 1.6)
    g.fillStyle = dark
    g.beginPath(); g.arc(0, S(-0.1), S(0.1) * k, 0, TAU); g.fill()
    g.fillStyle = mixHex(c.accent, '#9fd8ff', 0.75)
    g.beginPath(); g.arc(0, S(-0.1), S(0.07) * k, 0, TAU); g.fill()
    g.fillStyle = rgba('#ffffff', 0.7)
    g.beginPath(); g.arc(S(-0.025), S(-0.125), S(0.02) * k, 0, TAU); g.fill()
    g.restore()
  }
  g.restore()
}

/** Draws one everyday object (the caller has saved the context and set its alpha). */
export function drawEveryday(g: CanvasRenderingContext2D, id: EverydayId, d: ObjectDraw): void {
  switch (id) {
    case 'camera': return drawCamera(g, d)
    case 'heart': return drawHeart(g, d)
    case 'star': return drawStar(g, d)
    case 'play': return drawPlay(g, d)
    case 'cart': return drawCart(g, d)
    case 'book': return drawBook(g, d)
    case 'megaphone': return drawMegaphone(g, d)
    case 'rocket': return drawRocket(g, d)
  }
}
