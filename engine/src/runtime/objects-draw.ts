/**
 * Canvas drawing of the morph objects (Plan 3): dot, ring, bar, clock, the coin with an embossed
 * currency sign, (Task 6b) the document that writes itself, the microphone with live level
 * bars and the editing timeline with cuts, and (Task 6c) the script's own objects: a calendar whose
 * months flip, an envelope that lets out invoices, a ringing bell with sticky notes, a voice-note
 * bubble that records and plays, a phone whose notification becomes a paid check, and (Stage 1A,
 * `objects-draw-home.ts`) the house reel's brick, house, blueprint, eye, photo and chat (and, in
 * `objects-draw-cost.ts` / `objects-draw-sun.ts` / `objects-draw-mission.ts`, the later stages' objects). Every function draws centred on the context's origin
 * (the caller translates and squashes), is a pure function of its arguments, and reads colours as
 * resolved hex values. Our own drawing; the look follows the creative prototype (coin face
 * gradient, reeded edge, rim ticks, specular sweep, two-stroke emboss, guilloche on the back; the
 * page with its fold and writing lines, the mic capsule with its grille, stand and bars, the
 * editor window).
 */
import type { Pt } from '../core/morph'
import { OBJECT_GEOMETRY, type ObjectId } from '../core/objects'
import type { CurrencySign } from '../core/currency'
import { seg, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic } from '../core/ease'
import { rng } from '../core/rng'
import { BELL, buildSecOf, CALENDAR, ENVELOPE, levelAt, PHONE_APP, softSpring, TIMELINE, VOICE_NOTE } from '../core/params/morph-object'
import { rgba } from './materials'
import { drawBanknote, drawBlueprint, drawBrick, drawChat, drawEye, drawHouse, drawPhoto } from './objects-draw-home'
import { drawFile, drawMaterials, drawScale } from './objects-draw-cost'
import { drawPin, drawRoom, drawSun, drawSunPath, drawWindow } from './objects-draw-sun'
import { drawAiChip, drawBulb, drawCompass, drawFollow, drawHardHat, drawMagnifier, drawReceipt, drawTool } from './objects-draw-mission'

const TAU = Math.PI * 2

/** Coin tokens (Global Constraints): face gradient light → mid → dark, edge. */
export const COIN_TOKENS = { light: '#FFC089', mid: '#FF6A26', dark: '#D3400D', edge: '#A9360C' } as const

export interface ObjectColours {
  bg: string
  fg: string
  accent: string
}

/** What one object draw needs. `r` = radius (half the size, px); `path` = the outline around (0, 0). */
export interface ObjectDraw {
  r: number
  path: Path2D
  /** Clip round objects (clock face, coin) to `path` (when the outline is not a circle, e.g. towards a bar). */
  clip: boolean
  /** Coin flip angle (radians). */
  angle: number
  /** Body alpha. */
  alpha: number
  /** Inside details: build progress (0..1) and alpha. */
  build: number
  detailAlpha: number
  colours: ObjectColours
  /** Local time and the build progress one frame earlier (clock hands and their motion blur). */
  t: number
  dt: number
  buildPrev: number
  sign: CurrencySign
  /** Task 6b: seconds since the drawn state's `at` (its voice levels, playhead and cuts run on it). */
  since: number
  /** Task 6b: the drawn state's voice levels (0..1 per 1/30 s), its line of text, a per-state seed. */
  levels?: readonly number[]
  text?: string
  seed: number
  /** Task 6b: the look's display font family (canvas decoration text). */
  font: string
  /** Task 6b timeline: seconds after arrival of the drawn state's cuts. */
  cuts: readonly number[]
  /** Task 6c: the calendar's seconds per month page, the phone's check time (s after `at`), the currency code on the invoices. */
  flipSec: number
  checkAt: number
  currency: string
  /**
   * Stage 2: the drawn state's beats (s after its `at`, as the state gives them; `beatsOf` fills in
   * the object's defaults). Empty when the state gives none.
   */
  beats: readonly number[]
  /**
   * Stage 2: during a move between two states of the same object, the previous state's `text` and
   * how far its look has given way to this state's (0 → 1); `textMix` is 1 at rest. The brick
   * crossfades its variant's face details on it.
   */
  prevText?: string
  textMix: number
}

/** A Path2D through `pts` (closed). */
export function pathOf(pts: Pt[]): Path2D {
  const p = new Path2D()
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)))
  p.closePath()
  return p
}

export const lum = (hex: string): number => {
  const n = parseInt(hex.slice(1, 7), 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

/** `a` → `b` by u, as `#rrggbb`. */
export function mixHex(a: string, b: string, u: number): string {
  const A = parseInt(a.slice(1, 7), 16)
  const B = parseInt(b.slice(1, 7), 16)
  const ch = (s: number) => Math.round(((A >> s) & 255) + (((B >> s) & 255) - ((A >> s) & 255)) * u)
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')
}

/** A radial accent glow of strength `weight` around (x, y) for an object of radius r. */
export function drawGlow(g: CanvasRenderingContext2D, x: number, y: number, r: number, accent: string, weight: number, spec: { inner: number; outer: number; alpha: number }): void {
  if (!(weight > 0) || !(r > 0)) return
  const gr = g.createRadialGradient(x, y, r * spec.inner, x, y, r * spec.outer)
  gr.addColorStop(0, rgba(accent, spec.alpha * weight))
  gr.addColorStop(1, rgba(accent, 0))
  g.fillStyle = gr
  g.beginPath()
  g.arc(x, y, r * spec.outer, 0, TAU)
  g.fill()
}

/** One expanding ring at progress k (0..1): radius from → to (sine-out), alpha · (1 − k). */
export function drawRing(g: CanvasRenderingContext2D, x: number, y: number, k: number, accent: string, spec: { from: number; to: number; alpha: number; width: number }): void {
  if (!(k > 0 && k < 1)) return
  const rad = spec.from + (spec.to - spec.from) * Math.sin((k * Math.PI) / 2)
  g.save()
  g.strokeStyle = rgba(accent, spec.alpha * (1 - k))
  g.lineWidth = spec.width
  g.beginPath()
  g.arc(x, y, rad, 0, TAU)
  g.stroke()
  g.restore()
}

/** Strokes the inside half of a `w` px band along `path` (the path clips the stroke). */
function innerBand(g: CanvasRenderingContext2D, path: Path2D, w: number, colour: string): void {
  g.save()
  g.clip(path)
  g.strokeStyle = colour
  g.lineWidth = 2 * w
  g.stroke(path)
  g.restore()
}

/** Draws one object (body, then its inside details at `build`). */
export function drawObject(g: CanvasRenderingContext2D, id: ObjectId, d: ObjectDraw): void {
  if (!(d.alpha > 0) || !(d.r > 0.5)) return
  g.save()
  g.globalAlpha *= Math.min(1, d.alpha)
  switch (id) {
    case 'dot':
    case 'bar':
      g.fillStyle = d.colours.accent
      g.fill(d.path)
      break
    case 'ring':
      innerBand(g, d.path, Math.max(2, d.r * 0.16), d.colours.accent)
      break
    case 'clock':
      drawClock(g, d)
      break
    case 'coin':
      if (d.clip) g.clip(d.path)
      drawCoin(g, d)
      break
    case 'document':
      drawDocument(g, d)
      break
    case 'microphone':
      drawMicrophone(g, d)
      break
    case 'timeline':
      drawTimeline(g, d)
      break
    case 'calendar':
      drawCalendar(g, d)
      break
    case 'envelope':
      drawEnvelope(g, d)
      break
    case 'bell':
      drawBell(g, d)
      break
    case 'voice-note':
      drawVoiceNote(g, d)
      break
    case 'phone-app':
      drawPhoneApp(g, d)
      break
    case 'brick':
      drawBrick(g, d)
      break
    case 'house':
      drawHouse(g, d)
      break
    case 'blueprint':
      drawBlueprint(g, d)
      break
    case 'eye':
      drawEye(g, d)
      break
    case 'photo':
      drawPhoto(g, d)
      break
    case 'chat':
      drawChat(g, d)
      break
    case 'banknote':
      drawBanknote(g, d)
      break
    case 'scale':
      drawScale(g, d)
      break
    case 'materials':
      drawMaterials(g, d)
      break
    case 'sun':
      drawSun(g, d)
      break
    case 'room':
      drawRoom(g, d)
      break
    case 'pin':
      drawPin(g, d)
      break
    case 'window':
      drawWindow(g, d)
      break
    case 'sun-path':
      drawSunPath(g, d)
      break
    case 'file':
      drawFile(g, d)
      break
    case 'hard-hat':
      drawHardHat(g, d)
      break
    case 'bulb':
      drawBulb(g, d)
      break
    case 'ai-chip':
      drawAiChip(g, d)
      break
    case 'tool':
      drawTool(g, d)
      break
    case 'magnifier':
      drawMagnifier(g, d)
      break
    case 'follow':
      drawFollow(g, d)
      break
    case 'compass':
      drawCompass(g, d)
      break
    case 'receipt':
      drawReceipt(g, d)
      break
  }
  g.restore()
}

// ------------------------------------------------------------------ clock

/** Minute and hour hand angles at t for a build progress: the hands wind forward into place as it builds. */
function handAngles(t: number, build: number): { am: number; ah: number } {
  const wind = 1 - easeOutCubic(build)
  return {
    am: -Math.PI / 2 + TAU * (0.02 + 0.25 * t) - TAU * 1.25 * wind,
    ah: -Math.PI / 2 + TAU * (0.33 + t / 48) - TAU * 0.3 * wind,
  }
}

function drawClock(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const { r, colours: c } = d
  const light = lum(c.bg) > 0.5
  const face = light ? '#ffffff' : mixHex(c.bg, c.fg, 0.1)
  // face with a soft drop shadow on light worlds (it leaves with the details when the clock morphs away)
  g.save()
  if (light && d.detailAlpha > 0) softShadow(g, d.path, '#502d0f', 0.22 * d.detailAlpha, r * 0.3, r * 0.12)
  g.fillStyle = face
  g.fill(d.path)
  g.restore()
  innerBand(g, d.path, r * 0.13, c.accent)
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  g.save()
  if (d.clip) g.clip(d.path)
  g.globalAlpha *= d.detailAlpha
  g.strokeStyle = c.fg
  g.lineCap = 'butt'
  // 12 ticks, growing in from 12 o'clock clockwise
  const outer = r * 0.78
  for (let k = 0; k < 12; k++) {
    const grow = Math.max(0, Math.min(1, d.build * 1.8 - (k / 12) * 0.8))
    if (grow <= 0) continue
    const long = k % 3 === 0
    const len = (long ? 0.16 : 0.09) * r * grow
    const a = -Math.PI / 2 + (TAU * k) / 12
    g.lineWidth = (long ? 0.045 : 0.022) * r
    g.beginPath()
    g.moveTo(Math.cos(a) * outer, Math.sin(a) * outer)
    g.lineTo(Math.cos(a) * (outer - len), Math.sin(a) * (outer - len))
    g.stroke()
  }
  // hands
  const hp = easeOutBack(seg(d.build, 0.2, 1), 2)
  if (hp > 0) {
    const { am, ah } = handAngles(d.t, d.build)
    const prev = handAngles(d.t - d.dt, d.buildPrev).am
    const lm = 0.64 * r * hp
    const blur = Math.min(2.6, Math.abs(am - prev) * 1.2)
    g.lineCap = 'round'
    if (blur > 0.05) {
      g.fillStyle = rgba(c.fg, 0.12)
      g.beginPath()
      g.moveTo(0, 0)
      g.arc(0, 0, lm, am - blur, am)
      g.closePath()
      g.fill()
    }
    g.lineWidth = 0.075 * r
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(Math.cos(ah) * 0.42 * r * hp, Math.sin(ah) * 0.42 * r * hp)
    g.stroke()
    g.lineWidth = 0.048 * r
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(Math.cos(am) * lm, Math.sin(am) * lm)
    g.stroke()
    g.fillStyle = c.accent
    g.beginPath()
    g.arc(0, 0, 0.065 * r * Math.min(1.2, hp), 0, TAU)
    g.fill()
  }
  g.restore()
}

// ------------------------------------------------------------------ coin

/** Strokes the sign's polylines at glyph height `sz` (centred on the origin). */
function signPath(sign: CurrencySign, sz: number): Path2D {
  const p = new Path2D()
  sign.strokes.forEach((s, i) => {
    s.forEach(([x, y], j) => (j ? p.lineTo(x * sz, y * sz) : p.moveTo(x * sz, y * sz)))
    if (sign.closed[i]) p.closePath()
  })
  return p
}

/** The embossed sign: two offset strokes, light (up-left) then dark (down-right). */
function emboss(g: CanvasRenderingContext2D, sign: CurrencySign, sz: number, lw: number, r: number): void {
  const path = signPath(sign, sz)
  g.save()
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.lineWidth = lw
  for (const [col, o] of [
    ['rgba(255,226,196,0.62)', -Math.max(1, r * 0.013)],
    ['rgba(110,24,0,0.62)', Math.max(0.8, r * 0.0106)],
  ] as const) {
    g.save()
    g.translate(o, o)
    g.strokeStyle = col
    g.stroke(path)
    g.restore()
  }
  g.restore()
}

/** Four interleaved guilloche loops (the coin's back), radius ~0.36..0.6 r. */
function guilloche(g: CanvasRenderingContext2D, r: number): void {
  g.save()
  g.lineWidth = Math.max(0.8, r * 0.0094)
  for (let j = 0; j < 4; j++) {
    g.strokeStyle = j % 2 ? 'rgba(120,28,0,0.40)' : 'rgba(255,214,170,0.45)'
    g.beginPath()
    for (let i = 0; i <= 720; i++) {
      const a = (TAU * i) / 720
      const rr = r * (0.36 + 0.05 * j) + r * 0.13 * Math.sin(9 * a + j * 0.7) + r * 0.05 * Math.sin(27 * a + j)
      const x = rr * Math.cos(a)
      const y = rr * Math.sin(a)
      if (i) g.lineTo(x, y)
      else g.moveTo(x, y)
    }
    g.closePath()
    g.stroke()
  }
  g.restore()
}

/**
 * The coin at flip angle `angle` (about the vertical axis): the reeded edge shows its thickness
 * (0.14 r × |sin|) beside a face squeezed to |cos|; the front carries the sign large, the back a
 * guilloche with the sign small. Details (rim ticks, sign, guilloche) build with `build`.
 */
function drawCoin(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const { r, angle } = d
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const sx = Math.max(0.035, Math.abs(c))
  const front = c >= 0
  const th = r * 0.14 * Math.abs(s)
  const dir = s >= 0 ? 1 : -1
  // edge (thickness) with reeding
  g.fillStyle = COIN_TOKENS.edge
  g.beginPath()
  g.ellipse(dir * th, 0, r * sx, r, 0, 0, TAU)
  g.fill()
  g.fillRect(Math.min(0, dir * th), -r, Math.abs(th), r * 2)
  if (th > 2) {
    g.strokeStyle = 'rgba(255,170,110,0.35)'
    g.lineWidth = Math.max(1, r * 0.012)
    for (let k = -10; k <= 10; k++) {
      const yy = (k / 10.5) * r
      const hw = r * Math.sqrt(1 - (k / 10.5) ** 2) * sx
      g.beginPath()
      g.moveTo(0, yy)
      g.lineTo(dir * (th + hw), yy)
      g.stroke()
    }
  }
  // face
  g.save()
  g.scale(sx, 1)
  const gr = g.createRadialGradient(-r * 0.32, -r * 0.38, r * 0.08, 0, 0, r)
  gr.addColorStop(0, COIN_TOKENS.light)
  gr.addColorStop(0.5, COIN_TOKENS.mid)
  gr.addColorStop(1, COIN_TOKENS.dark)
  g.fillStyle = gr
  g.beginPath()
  g.arc(0, 0, r, 0, TAU)
  g.fill()
  g.strokeStyle = 'rgba(115,28,4,0.55)'
  g.lineWidth = r * 0.03
  g.beginPath()
  g.arc(0, 0, r * 0.83, 0, TAU)
  g.stroke()
  g.strokeStyle = 'rgba(255,220,190,0.45)'
  g.lineWidth = r * 0.012
  g.beginPath()
  g.arc(-r * 0.009, -r * 0.009, r * 0.8, 0, TAU)
  g.stroke()
  if (d.detailAlpha > 0 && d.build > 0) {
    g.save()
    g.globalAlpha *= d.detailAlpha
    // 72 rim ticks, sweeping in clockwise from 12 o'clock
    const n = Math.round(72 * easeOutCubic(d.build))
    g.strokeStyle = 'rgba(115,28,4,0.38)'
    g.lineWidth = Math.max(1, r * 0.014)
    g.beginPath()
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (TAU * k) / 72
      g.moveTo(Math.cos(a) * r * 0.89, Math.sin(a) * r * 0.89)
      g.lineTo(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97)
    }
    g.stroke()
    // the sign: pops in (back-out scale) as the ticks run
    const sp = seg(d.build, 0.15, 1)
    if (sp > 0) {
      g.save()
      g.globalAlpha *= Math.min(1, sp * 2.5)
      const sc = 0.6 + 0.4 * easeOutBack(sp, 2)
      g.scale(sc, sc)
      if (front) emboss(g, d.sign, r * 1.08, r * 0.075, r)
      else {
        guilloche(g, r)
        emboss(g, d.sign, r * 0.5, r * 0.05, r)
      }
      g.restore()
    }
    g.restore()
  }
  // specular sweep (moves with the flip)
  g.beginPath()
  g.arc(0, 0, r, 0, TAU)
  g.clip()
  const hx = r * 1.6 * Math.sin(angle + 0.5)
  const sg = g.createLinearGradient(hx - r * 0.5, -r, hx + r * 0.5, r)
  sg.addColorStop(0, 'rgba(255,255,255,0)')
  sg.addColorStop(0.5, 'rgba(255,245,230,0.32)')
  sg.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = sg
  g.fillRect(-r, -r, r * 2, r * 2)
  g.restore()
}

// ------------------------------------------------------------------ Task 6b shared

/** A rounded-rectangle path (x, y = top-left). */
export function rrect(g: CanvasPath, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  g.moveTo(x + rr, y)
  g.arcTo(x + w, y, x + w, y + h, rr)
  g.arcTo(x + w, y + h, x, y + h, rr)
  g.arcTo(x, y + h, x, y, rr)
  g.arcTo(x, y, x + w, y, rr)
  g.closePath()
}

/** The soft drop shadow light worlds give a raised object (the prototype's paper shadow), from the world's fg. */
/**
 * A soft drop shadow of `path` drawn without `shadowBlur` (Plan 3 Task 7, `mba verify`): a blurred
 * canvas shadow rasterised differently cold and warm (max Δ 1–2 over 40 000+ px) once a radial-gradient
 * glow had been drawn on an earlier frame — clock → document / calendar mid-move on paper. Here:
 * `SOFT.layers` strokes of the path (round joins: each one dilates the outline), moved down by
 * `offsetY`, widening to `SOFT.spread`·`blur`, stacked so the centre reaches `alpha` of `colour` (hex).
 * Pure in its inputs: the same pixels whatever was drawn before.
 */
const SOFT = { layers: 6, spread: 0.7 } as const
export function softShadow(g: CanvasRenderingContext2D, path: Path2D, colour: string, alpha: number, blur: number, offsetY: number): void {
  if (!(alpha > 0) || !(blur > 0)) return
  const each = 1 - (1 - Math.min(1, alpha)) ** (1 / SOFT.layers)
  g.save()
  g.translate(0, offsetY)
  g.strokeStyle = rgba(colour, each)
  g.lineJoin = 'round'
  for (let i = SOFT.layers; i >= 1; i--) {
    g.lineWidth = 2 * blur * SOFT.spread * (i / SOFT.layers)
    g.stroke(path)
  }
  g.restore()
}

/** The lift shadow light worlds give a raised object body (`softShadow`, from the world's fg): 0.2·a, blur 0.14·s, 0.06·s down. */
export function liftShadowPath(g: CanvasRenderingContext2D, c: ObjectColours, s: number, a: number, path: Path2D): void {
  if (!(lum(c.bg) > 0.5) || !(a > 0) || !(s > 0)) return
  softShadow(g, path, c.fg, 0.2 * Math.min(1, a), s * 0.14, s * 0.06)
}


/** A deterministic 0..1 value for integer `i` under `seed` (no state). */
export const hash01 = (seed: number, i: number): number => rng((seed * 2654435761 + i * 40503) >>> 0)()

/** A speech-like idle level at time `tt` (s) when a state has no voice levels: seeded, pure in t. */
function idleLevel(seed: number, tt: number): number {
  const p1 = hash01(seed, 1) * 6.283
  const p2 = hash01(seed, 2) * 6.283
  const syll = 0.5 + 0.5 * Math.sin(6.283 * 3.1 * tt + p1)
  const phrase = 0.55 + 0.45 * Math.sin(6.283 * 0.47 * tt + p2)
  return Math.max(0, Math.min(1, 0.12 + 0.7 * syll * phrase))
}

/** The voice level `since` s into a state (its levels, else idle motion). */
const voiceAt = (d: ObjectDraw, since: number): number => levelAt(d.levels, since) ?? idleLevel(d.seed, since)

// ------------------------------------------------------------------ document

/**
 * Document (spec of Task 6b): a page `size` wide, 1.26 × size tall, the top-left corner folded.
 * Inside: six text lines (0.05 × size thick, seeded widths 0.55–0.85 of the page, the first
 * in the accent) write themselves right → left one after another during the build, a steady accent
 * caret at the writing point. With `text`, the first line is that string (canvas decoration,
 * revealed right → left as a whole word).
 */
export const DOCUMENT = {
  /** Right margin (× size); first line y and line pitch from the top (× size). Line widths are 0.55–0.85 of the page. */
  margin: 0.08,
  firstY: 0.31,
  pitch: 0.152,
  lines: 6,
  thick: 0.05,
  /** Line k starts writing at k × stagger s into the build and takes `lineSec` s. */
  stagger: 0.1,
  lineSec: 0.3,
  /** Caret: width and height (× size), fading out over `caretOut` s after the writing ends. */
  caret: { w: 0.014, h: 0.085 },
  caretOut: 0.3,
} as const

function drawDocument(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const geo = OBJECT_GEOMETRY.document
  const w = geo.w * s
  const h = geo.h * s
  const fold = geo.fold * s
  const c = d.colours
  const light = lum(c.bg) > 0.5
  const paper = light ? mixHex(c.bg, '#ffffff', 0.65) : c.fg
  const ink = light ? c.fg : c.bg
  const l = -w / 2
  const t = -h / 2
  g.save()
  liftShadowPath(g, c, s, d.detailAlpha, d.path)
  g.fillStyle = paper
  g.fill(d.path)
  g.restore()
  // the fold (a darker flap with a hairline) and the page outline on light worlds: page details, so
  // they stay inside the outline and leave with the details when the page morphs away
  if (d.detailAlpha > 0) {
    g.save()
    g.globalAlpha *= d.detailAlpha
    g.lineJoin = 'round'
    g.lineWidth = Math.max(1.2, s * 0.008)
    g.strokeStyle = rgba(ink, light ? 0.85 : 0.35)
    if (light) g.stroke(d.path)
    g.clip(d.path)
    g.fillStyle = mixHex(paper, ink, 0.1)
    g.beginPath()
    g.moveTo(l, t + fold)
    g.lineTo(l + fold, t + fold)
    g.lineTo(l + fold, t)
    g.closePath()
    g.fill()
    g.beginPath()
    g.moveTo(l, t + fold)
    g.lineTo(l + fold, t + fold)
    g.lineTo(l + fold, t)
    g.stroke()
    g.restore()
  }
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return

  g.save()
  g.clip(d.path)
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'
  const xr = w / 2 - DOCUMENT.margin * s
  const col = xr + w / 2 - 0.06 * s
  const sec = d.build * buildSecOf('document')
  const r = rng((d.seed * 7 + 11) >>> 0)
  let caret: { x: number; y: number } | null = null
  for (let k = 0; k < DOCUMENT.lines; k++) {
    const len = w * (0.55 + 0.3 * r())
    const e = easeOutCubic(seg(sec, k * DOCUMENT.stagger, k * DOCUMENT.stagger + DOCUMENT.lineSec))
    if (e <= 0) continue
    const y = t + (DOCUMENT.firstY + k * DOCUMENT.pitch) * s
    if (k === 0 && d.text) {
      // the line the voice says, as a whole word revealed right → left (decoration)
      let fs = s * 0.1
      g.font = `900 ${fs}px ${d.font}`
      const tw = g.measureText(d.text).width
      if (tw > col) {
        fs *= col / tw
        g.font = `900 ${fs}px ${d.font}`
      }
      const full = Math.min(col, g.measureText(d.text).width)
      g.save()
      g.beginPath()
      g.rect(xr - full * e - 2, y - fs, full * e + fs, fs * 2)
      g.clip()
      g.fillStyle = c.accent
      g.direction = 'rtl'
      g.textAlign = 'right'
      g.textBaseline = 'middle'
      g.fillText(d.text, xr, y)
      g.restore()
      caret = { x: xr - full * e, y }
      continue
    }
    g.strokeStyle = k === 0 ? c.accent : rgba(ink, 0.82)
    g.lineWidth = DOCUMENT.thick * s
    g.beginPath()
    g.moveTo(xr, y)
    g.lineTo(xr - len * e, y)
    g.stroke()
    caret = { x: xr - len * e, y }
  }
  const writeEnd = (DOCUMENT.lines - 1) * DOCUMENT.stagger + DOCUMENT.lineSec
  const ca = 1 - seg(d.since, writeEnd, writeEnd + DOCUMENT.caretOut)
  if (caret && ca > 0) {
    g.globalAlpha *= ca
    g.fillStyle = c.accent
    const cw = DOCUMENT.caret.w * s
    const chh = DOCUMENT.caret.h * s
    g.fillRect(caret.x - DOCUMENT.thick * s * 0.6 - cw, caret.y - chh / 2, cw, chh)
  }
  g.restore()
}

// ------------------------------------------------------------------ microphone

/**
 * Microphone (Task 6b, the prototype's MICP / micInside / micStand / micBars): a capsule 0.6 × size
 * wide and `size` tall with horizontal grille slots and a side highlight; a stand (U arc + stem +
 * base) that draws in during the build; 7 level bars a side whose heights follow the voice
 * (`levels[round(t·30)]`, each further bar a little later and shorter), seeded idle motion without
 * levels. Geometry in units of the size (the prototype's 380 px mic).
 */
export const MICROPHONE = {
  slots: { from: 0.084, step: 0.068, width: 0.0158, half: 0.24 },
  stand: { cy: 0.197, r: 0.395, stem: 0.184, base: 0.237, width: 0.0316 },
  bars: { n: 7, x0: 0.53, dx: 0.079, width: 0.039, dw: 0.0021, min: 0.042, range: 0.763, shrink: 0.075, lag: 0.05 },
} as const

function drawMicrophone(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const geo = OBJECT_GEOMETRY.microphone
  const hw = (geo.w * s) / 2
  const hh = (geo.h * s) / 2
  g.save()
  liftShadowPath(g, c, s, d.detailAlpha, d.path)
  g.fillStyle = c.fg
  g.fill(d.path)
  g.restore()
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  const b = d.build

  // grille: slots appear top → bottom; a soft side highlight
  g.save()
  g.clip(d.path)
  g.globalAlpha *= d.detailAlpha
  g.strokeStyle = rgba(c.bg, 0.22)
  g.lineWidth = MICROPHONE.slots.width * s
  g.lineCap = 'round'
  const slots = Math.floor((2 * hh - MICROPHONE.slots.from * s) / (MICROPHONE.slots.step * s))
  for (let i = 0; i <= slots; i++) {
    const a = seg(b, (i / slots) * 0.5, (i / slots) * 0.5 + 0.3)
    if (a <= 0) continue
    const y = -hh + (MICROPHONE.slots.from + i * MICROPHONE.slots.step) * s
    const half = MICROPHONE.slots.half * s * easeOutCubic(a)
    g.beginPath()
    g.moveTo(-half, y)
    g.lineTo(half, y)
    g.stroke()
  }
  const hl = g.createLinearGradient(-hw, 0, hw, 0)
  hl.addColorStop(0, `rgba(255,255,255,${0.1 * b})`)
  hl.addColorStop(0.35, 'rgba(255,255,255,0)')
  hl.addColorStop(1, `rgba(0,0,0,${0.15 * b})`)
  g.fillStyle = hl
  g.fillRect(-hw, -hh, 2 * hw, 2 * hh)
  g.restore()

  g.save()
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'
  // stand: the U arc, then the stem and the base, drawn in along their length
  const st = MICROPHONE.stand
  const arcL = Math.PI * st.r * s
  const restL = (st.stem + 2 * st.base) * s
  const drawn = (arcL + restL) * easeOutCubic(seg(b, 0, 0.9))
  if (drawn > 0) {
    g.strokeStyle = c.fg
    g.lineWidth = st.width * s
    g.beginPath()
    g.arc(0, st.cy * s, st.r * s, 0, Math.PI * Math.min(1, drawn / arcL), false)
    g.stroke()
    const rest = drawn - arcL
    if (rest > 0) {
      const y0 = (st.cy + st.r) * s
      const y1 = y0 + st.stem * s
      const stem = Math.min(rest, st.stem * s)
      g.beginPath()
      g.moveTo(0, y0)
      g.lineTo(0, y0 + stem)
      const base = Math.max(0, rest - st.stem * s) / 2
      if (base > 0) {
        g.moveTo(-base, y1)
        g.lineTo(base, y1)
      }
      g.stroke()
    }
  }
  // level bars either side, following the voice
  const bars = MICROPHONE.bars
  const ba = seg(b, 0.3, 0.75)
  if (ba > 0) {
    g.globalAlpha *= ba
    for (let k = 0; k < bars.n; k++) {
      const v = voiceAt(d, d.since - k * bars.lag)
      const bh = (bars.min + bars.range * v) * (1 - bars.shrink * k) * s
      g.strokeStyle = k % 2 ? c.fg : c.accent
      g.lineWidth = (bars.width - bars.dw * k) * s
      const x = (bars.x0 + k * bars.dx) * s
      g.beginPath()
      g.moveTo(-x, -bh / 2)
      g.lineTo(-x, bh / 2)
      g.moveTo(x, -bh / 2)
      g.lineTo(x, bh / 2)
      g.stroke()
    }
  }
  g.restore()
}

// ------------------------------------------------------------------ timeline

/**
 * Timeline (Task 6b): an editor window 1.5 × size wide, 0.9 × size tall. Header with window dots,
 * a ruler, three tracks (video clips as abutting rounded blocks in accent and fg tints; the voice
 * as a waveform from the same `levels`; text chips, the first carrying `text`), track headers on
 * the right (RTL), a playhead sweeping right → left, and three cuts: the video clip under the
 * playhead splits with a thin gap and an accent scissor tick. Layout in units of the size (y from
 * the window centre).
 */
export const TIMELINE_LAYOUT = {
  header: { y: -0.39, dotR: 0.016, dotDx: 0.05 },
  ruler: { y0: -0.3, y1: -0.25 },
  video: { y0: -0.2, y1: 0 },
  audio: { y0: 0.05, y1: 0.22 },
  text: { y0: 0.27, y1: 0.37 },
  /** Content x range: from the left edge + `left` to the right edge − `right` (track headers there). */
  left: 0.05,
  right: 0.2,
  scissor: { y: -0.225, a: 0.02 },
} as const

/** The playhead x (in size units from the centre) `since` s after arrival: right → left, looping. */
function playheadX(since: number, xl: number, xr: number): number {
  const u = Math.max(0, since - TIMELINE.playheadIn) / TIMELINE.sweepSec
  return xr - (xr - xl) * (u - Math.floor(u))
}

function drawTimeline(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const light = lum(c.bg) > 0.5
  const geo = OBJECT_GEOMETRY.timeline
  const W = geo.w * s
  const win = light ? c.fg : mixHex(c.bg, c.fg, 0.08)
  const cont = light ? c.bg : c.fg
  g.save()
  liftShadowPath(g, c, s, d.detailAlpha, d.path)
  g.fillStyle = win
  g.fill(d.path)
  g.restore()
  if (!light) {
    g.save()
    g.strokeStyle = rgba(c.fg, 0.16)
    g.lineWidth = Math.max(1, s * 0.005)
    g.stroke(d.path)
    g.restore()
  }
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  const L = TIMELINE_LAYOUT
  const b = d.build
  const xl = -W / 2 + L.left * s
  const xr = W / 2 - L.right * s
  const span = xr - xl
  const r = rng((d.seed * 13 + 5) >>> 0)
  const Y = (v: number) => v * s

  g.save()
  g.clip(d.path)
  g.globalAlpha *= d.detailAlpha
  g.lineCap = 'round'

  // header: window dots (top right, RTL), a toolbar pill, a separator
  const ha = seg(b, 0, 0.3)
  g.save()
  g.globalAlpha *= ha
  for (let i = 0; i < 3; i++) {
    g.fillStyle = i === 0 ? c.accent : rgba(cont, 0.25)
    g.beginPath()
    g.arc(W / 2 - 0.07 * s - i * L.header.dotDx * s, Y(L.header.y), L.header.dotR * s, 0, TAU)
    g.fill()
  }
  g.fillStyle = rgba(cont, 0.1)
  g.beginPath()
  rrect(g, -W / 2 + 0.06 * s, Y(L.header.y) - 0.022 * s, 0.32 * s, 0.044 * s, 0.022 * s)
  g.fill()
  g.fillStyle = rgba(cont, 0.08)
  g.fillRect(-W / 2, Y(-0.335), W, Math.max(1, 0.004 * s))
  // ruler ticks
  g.strokeStyle = rgba(cont, 0.3)
  g.lineWidth = Math.max(1, 0.005 * s)
  g.beginPath()
  for (let i = 0; i <= 24; i++) {
    const x = xr - (span * i) / 24
    g.moveTo(x, Y(L.ruler.y1))
    g.lineTo(x, Y(i % 4 === 0 ? L.ruler.y0 + 0.01 : L.ruler.y1 - 0.02))
  }
  g.stroke()
  g.restore()

  // track headers on the right: a tile per track with a small mark
  const tracks = [L.video, L.audio, L.text]
  tracks.forEach((tr, i) => {
    const a = seg(b, 0.05 + 0.08 * i, 0.35 + 0.08 * i)
    if (a <= 0) return
    g.save()
    g.globalAlpha *= a
    const x0 = W / 2 - 0.16 * s
    g.fillStyle = rgba(cont, 0.08)
    g.beginPath()
    rrect(g, x0, Y(tr.y0), 0.12 * s, Y(tr.y1 - tr.y0), 0.02 * s)
    g.fill()
    g.strokeStyle = rgba(cont, 0.5)
    g.lineWidth = Math.max(1, 0.008 * s)
    const cx = x0 + 0.06 * s
    const cy = Y((tr.y0 + tr.y1) / 2)
    g.beginPath()
    if (i === 0) rrect(g, cx - 0.022 * s, cy - 0.016 * s, 0.044 * s, 0.032 * s, 0.006 * s)
    else if (i === 1) for (const [dx, hh] of [[-0.016, 0.01], [0, 0.022], [0.016, 0.014]] as const) {
      g.moveTo(cx + dx * s, cy - hh * s)
      g.lineTo(cx + dx * s, cy + hh * s)
    }
    else {
      g.moveTo(cx - 0.016 * s, cy - 0.016 * s)
      g.lineTo(cx + 0.016 * s, cy - 0.016 * s)
      g.moveTo(cx, cy - 0.016 * s)
      g.lineTo(cx, cy + 0.018 * s)
    }
    g.stroke()
    g.restore()
  })

  // each track is laid down right → left
  const front = (i: number) => xr - span * easeOutCubic(seg(b, 0.1 + 0.1 * i, 0.7 + 0.1 * i))
  const ph = playheadX(d.since, xl / s, xr / s) * s
  const cutXs = d.cuts.map((cu) => playheadX(cu, xl / s, xr / s) * s)

  // video: abutting clips whose boundaries keep clear of the cuts
  const bounds: number[] = []
  let x = xr
  while (x > xl + 0.12 * s) {
    let next = x - (0.22 + 0.2 * r()) * s
    for (const cx of cutXs) if (Math.abs(next - cx) < 0.05 * s) next = cx - 0.05 * s
    bounds.push(x)
    x = next
  }
  bounds.push(xl)
  const vy0 = Y(L.video.y0)
  const vh = Y(L.video.y1 - L.video.y0)
  g.save()
  g.beginPath()
  g.rect(front(0), vy0 - 1, xr - front(0) + 1, vh + 2)
  g.clip()
  for (let k = 0; k + 1 < bounds.length; k++) {
    const hi = bounds[k]!
    const lo = bounds[k + 1]!
    // cut gaps inside this clip split it into pieces
    const edges: [number, number][] = []
    let right = hi
    for (let j = 0; j < d.cuts.length; j++) {
      const cx = cutXs[j]!
      if (!(cx < hi && cx > lo) || d.since < d.cuts[j]!) continue
      const gap = TIMELINE.gap * s * easeOutCubic(seg(d.since, d.cuts[j]!, d.cuts[j]! + TIMELINE.gapSec))
      edges.push([cx + gap / 2, right])
      right = cx - gap / 2
    }
    edges.push([lo, right])
    const fill = k % 2 === 0 ? c.accent : rgba(cont, 0.32)
    for (const [a0, a1] of edges) {
      if (a1 - a0 < 0.5) continue
      g.fillStyle = fill
      g.beginPath()
      rrect(g, a0, vy0, a1 - a0, vh, 0.018 * s)
      g.fill()
      // a thumbnail strip along the clip's top
      g.fillStyle = rgba('#ffffff', 0.14)
      g.beginPath()
      rrect(g, a0 + 0.008 * s, vy0 + 0.012 * s, Math.max(0, a1 - a0 - 0.016 * s), 0.05 * s, 0.01 * s)
      g.fill()
    }
  }
  g.restore()

  // audio: the voice as a mirrored waveform; the played part (right of the playhead) in the accent
  const ay = Y((L.audio.y0 + L.audio.y1) / 2)
  const ah = Y(L.audio.y1 - L.audio.y0) / 2
  g.save()
  g.beginPath()
  g.rect(front(1), Y(L.audio.y0) - 1, xr - front(1) + 1, 2 * ah + 2)
  g.clip()
  g.fillStyle = rgba(cont, 0.07)
  g.beginPath()
  rrect(g, xl, Y(L.audio.y0), span, 2 * ah, 0.018 * s)
  g.fill()
  const step = 0.016 * s
  g.lineWidth = Math.max(1, 0.008 * s)
  const n = Math.floor(span / step)
  for (let i = 0; i < n; i++) {
    const bx = xr - (i + 0.5) * step
    const tau = ((xr - bx) / span) * TIMELINE.sweepSec
    const v = d.levels && d.levels.length ? levelAt(d.levels, tau)! : idleLevel(d.seed, tau) * (0.6 + 0.4 * hash01(d.seed, 100 + i))
    const hh = ah * (0.1 + 0.78 * v)
    g.strokeStyle = bx >= ph ? c.accent : rgba(cont, 0.5)
    g.beginPath()
    g.moveTo(bx, ay - hh)
    g.lineTo(bx, ay + hh)
    g.stroke()
  }
  g.restore()

  // text: chips, the first with the line of text
  const ty0 = Y(L.text.y0)
  const th = Y(L.text.y1 - L.text.y0)
  g.save()
  g.beginPath()
  g.rect(front(2), ty0 - 1, xr - front(2) + 1, th + 2)
  g.clip()
  let cx0 = xr - 0.03 * s
  for (let k = 0; k < 3 && cx0 > xl + 0.1 * s; k++) {
    const cw = Math.min(cx0 - xl, (0.2 + 0.12 * r()) * s)
    g.fillStyle = rgba(cont, k === 0 ? 0.16 : 0.1)
    g.beginPath()
    rrect(g, cx0 - cw, ty0, cw, th, th / 2)
    g.fill()
    if (k === 0) {
      g.strokeStyle = c.accent
      g.lineWidth = Math.max(1, 0.006 * s)
      g.stroke()
    }
    if (k === 0 && d.text) {
      let fs = th * 0.58
      g.font = `900 ${fs}px ${d.font}`
      const tw = g.measureText(d.text).width
      if (tw > cw - th * 0.6) {
        fs *= (cw - th * 0.6) / tw
        g.font = `900 ${fs}px ${d.font}`
      }
      g.fillStyle = cont
      g.direction = 'rtl'
      g.textAlign = 'right'
      g.textBaseline = 'middle'
      g.fillText(d.text, cx0 - th * 0.3, ty0 + th / 2)
    } else {
      g.strokeStyle = rgba(cont, 0.45)
      g.lineWidth = Math.max(1, th * 0.16)
      g.beginPath()
      g.moveTo(cx0 - th * 0.45, ty0 + th / 2)
      g.lineTo(cx0 - cw * 0.62, ty0 + th / 2)
      g.stroke()
    }
    cx0 -= cw + (0.06 + 0.1 * r()) * s
  }
  g.restore()

  // scissor ticks at the cuts: two strokes, popping in and fading
  for (let j = 0; j < d.cuts.length; j++) {
    const k = (d.since - d.cuts[j]!) / TIMELINE.scissorSec
    if (!(k >= 0 && k < 1)) continue
    const sc = easeOutBack(seg(k, 0, 0.25), 2.2)
    const a = L.scissor.a * s * sc
    const sx = cutXs[j]!
    const sy = Y(L.scissor.y)
    g.save()
    g.globalAlpha *= 1 - seg(k, 0.6, 1)
    g.strokeStyle = c.accent
    g.lineWidth = Math.max(1.2, 0.009 * s)
    for (const dir of [-1, 1]) {
      g.beginPath()
      g.moveTo(sx - dir * a, sy - a)
      g.lineTo(sx + dir * a * 0.45, sy + a * 0.55)
      g.arc(sx + dir * a * 0.62, sy + a * 0.72, a * 0.24, -Math.PI * 0.75, Math.PI * 1.25)
      g.stroke()
    }
    g.restore()
  }

  // playhead: a head on the ruler and a hairline down the tracks
  const pa = seg(b, 0.05, 0.3)
  if (pa > 0) {
    g.save()
    g.globalAlpha *= pa
    g.fillStyle = c.accent
    g.strokeStyle = c.accent
    g.lineWidth = Math.max(1.5, 0.008 * s)
    g.beginPath()
    g.moveTo(ph, Y(L.ruler.y1))
    g.lineTo(ph, Y(L.text.y1 + 0.02))
    g.stroke()
    const hw = 0.022 * s
    g.beginPath()
    g.moveTo(ph - hw, Y(L.ruler.y0))
    g.lineTo(ph + hw, Y(L.ruler.y0))
    g.lineTo(ph + hw, Y(L.ruler.y1 - 0.012))
    g.lineTo(ph, Y(L.ruler.y1 + 0.006))
    g.lineTo(ph - hw, Y(L.ruler.y1 - 0.012))
    g.closePath()
    g.fill()
    g.restore()
  }
  g.restore()
}

// ------------------------------------------------------------------ Task 6c shared

/** The light paper of an object on this world (a light world's bg lifted towards white; on ink, the fg) and the ink drawn on it. */
export function paperInk(c: ObjectColours): { light: boolean; paper: string; ink: string } {
  const light = lum(c.bg) > 0.5
  return { light, paper: light ? mixHex(c.bg, '#ffffff', 0.65) : c.fg, ink: light ? c.fg : c.bg }
}

/** Strokes the polyline `pts` up to `share` (0..1) of its length. */
export function partialLine(g: CanvasRenderingContext2D, pts: readonly Pt[], share: number): void {
  if (!(share > 0) || pts.length < 2) return
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])
  let left = total * Math.min(1, share)
  g.beginPath()
  g.moveTo(pts[0]![0], pts[0]![1])
  for (let i = 1; i < pts.length && left > 0; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    const f = l > 0 ? Math.min(1, left / l) : 1
    g.lineTo(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
    left -= l
  }
  g.stroke()
}

/** Decoration text (canvas, `aria-hidden` through the canvas): a whole word or line, shrunk to fit `maxW`. */
export function decoText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxW: number, font: string, weight: number, dir: 'rtl' | 'ltr', align: CanvasTextAlign): void {
  let fs = size
  g.font = `${weight} ${fs}px ${font}`
  const w = g.measureText(text).width
  if (w > maxW && w > 0) {
    fs *= maxW / w
    g.font = `${weight} ${fs}px ${font}`
  }
  g.direction = dir
  g.textAlign = align
  g.textBaseline = 'middle'
  g.fillText(text, x, y)
}

// ------------------------------------------------------------------ calendar

/** The Arabic month names on the calendar's header (decoration; the readable word is DOM text). */
export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'] as const
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/**
 * Calendar (Task 6c, "every month"): a month page `size` wide, 1.1 × size tall, two binder rings
 * over its top edge, an accent header bar with the month's name (canvas decoration), a row of
 * weekday dots and a 7 × 5 day grid laid out right → left. Build: the header wipes in from the
 * right and the days pop in in reading order. Idle: each page lasts `flipSec`; its days are crossed
 * off one by one in accent X strokes, then the page turns up over its top edge (it scales to 0 on
 * y about that edge, shading as it lifts) and the next month's page shows under it. Pure in t:
 * the page index and the phase come from `since`.
 */
export const CALENDAR_LAYOUT = {
  header: 0.25,
  dotsY: 0.295,
  grid: { top: 0.36, pitchX: 0.124, pitchY: 0.138 },
  rings: { dx: 0.27, width: 0.048, up: 0.075, hole: 0.026 },
  digit: 0.052,
  title: 0.105,
  xArm: 0.036,
  xWidth: 0.017,
} as const

/** Month `m` of the calendar seeded `seed`: its name index, its day count and the grid cell of its 1st. */
function calendarMonth(seed: number, m: number): { month: number; days: number; offset: number } {
  const start = Math.floor(hash01(seed, 3) * 12)
  let offset = Math.floor(hash01(seed, 4) * 7)
  for (let j = 0; j < m; j++) offset = (offset + MONTH_DAYS[(start + j) % 12]!) % 7
  const month = (start + m) % 12
  const days = MONTH_DAYS[month]!
  return { month, days, offset: Math.min(offset, 35 - days) }
}

/** One month page's contents over the page outline (`path`), the top at `top`; `phase` < 0 draws no X marks. */
function calendarPage(g: CanvasRenderingContext2D, d: ObjectDraw, s: number, top: number, m: number, phase: number, build: number): void {
  const c = d.colours
  const { paper, ink } = paperInk(c)
  const L = CALENDAR_LAYOUT
  const w = s
  const { month, days, offset } = calendarMonth(d.seed, m)
  g.save()
  g.clip(d.path)
  // header bar: wipes in from the right
  const hw = easeOutCubic(seg(build, 0, 0.45))
  if (hw > 0) {
    g.save()
    g.beginPath()
    g.rect(w / 2 - w * hw, top, w * hw, L.header * s)
    g.clip()
    g.fillStyle = c.accent
    g.fillRect(-w / 2, top, w, L.header * s)
    g.fillStyle = paper
    decoText(g, MONTHS_AR[month]!, 0, top + (L.header * 0.58) * s, L.title * s, 0.7 * w, d.font, 900, 'rtl', 'center')
    g.restore()
  }
  // weekday dots and row rules
  const gx0 = (7 * L.grid.pitchX * s) / 2
  const da = seg(build, 0.15, 0.45)
  if (da > 0) {
    g.save()
    g.globalAlpha *= da
    g.fillStyle = rgba(ink, 0.3)
    for (let col = 0; col < 7; col++) {
      g.beginPath()
      g.arc(gx0 - (col + 0.5) * L.grid.pitchX * s, top + L.dotsY * s, 0.012 * s, 0, TAU)
      g.fill()
    }
    g.fillStyle = rgba(ink, 0.08)
    for (let row = 1; row < 5; row++) g.fillRect(-gx0, top + (L.grid.top + row * L.grid.pitchY) * s, 2 * gx0, Math.max(1, 0.004 * s))
    g.restore()
  }
  // days: right → left, row by row, popping in in reading order
  const flipDur = Math.min(CALENDAR.flipDur, 0.5 * d.flipSec)
  const crossEnd = Math.max(CALENDAR.crossFrom, d.flipSec - flipDur - CALENDAR.xSec)
  g.textBaseline = 'middle'
  for (let day = 1; day <= days; day++) {
    const idx = offset + day - 1
    const col = idx % 7
    const row = Math.floor(idx / 7)
    const x = gx0 - (col + 0.5) * L.grid.pitchX * s
    const y = top + (L.grid.top + (row + 0.5) * L.grid.pitchY) * s
    const pop = seg(build, 0.2 + 0.55 * (idx / 35), 0.2 + 0.55 * (idx / 35) + 0.25)
    if (pop <= 0) continue
    g.save()
    g.globalAlpha *= Math.min(1, pop * 2)
    g.translate(x, y)
    const sc = 0.5 + 0.5 * easeOutBack(pop, 2)
    g.scale(sc, sc)
    g.fillStyle = rgba(ink, col === 6 ? 0.5 : 0.78)
    decoText(g, String(day), 0, 0, L.digit * s, L.grid.pitchX * s * 0.8, d.font, 700, 'ltr', 'center')
    g.restore()
    if (phase < 0) continue
    // the X: two accent strokes, the second after the first
    const x0 = CALENDAR.crossFrom + ((day - 1) / Math.max(1, days - 1)) * (crossEnd - CALENDAR.crossFrom)
    const k = seg(phase, x0, x0 + CALENDAR.xSec)
    if (k <= 0) continue
    const a = L.xArm * s
    g.save()
    g.strokeStyle = c.accent
    g.lineWidth = L.xWidth * s
    g.lineCap = 'round'
    partialLine(g, [[x + a, y - a], [x - a, y + a]], seg(k, 0, 0.5))
    partialLine(g, [[x - a, y - a], [x + a, y + a]], seg(k, 0.5, 1))
    g.restore()
  }
  g.restore()
}

function drawCalendar(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const { light, paper, ink } = paperInk(c)
  const geo = OBJECT_GEOMETRY.calendar
  const top = (-geo.h / 2) * s
  g.save()
  liftShadowPath(g, c, s, d.detailAlpha, d.path)
  g.fillStyle = paper
  g.fill(d.path)
  g.restore()
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  const idle = d.since - buildSecOf('calendar')
  const F = d.flipSec
  const m = idle > 0 ? Math.floor(idle / F) : 0
  const phase = idle > 0 ? idle - m * F : -1
  const flipDur = Math.min(CALENDAR.flipDur, 0.5 * F)
  const k = phase >= 0 ? seg(phase, F - flipDur, F) : 0
  if (k > 0) {
    // the next month under the turning page, then the page itself scaling up about its top edge
    calendarPage(g, d, s, top, m + 1, -1, 1)
    const sy = Math.cos((Math.PI / 2) * easeInCubic(k) ** 0.8)
    const lift = top + geo.h * s * sy
    g.save()
    g.beginPath()
    g.rect(-s, lift, 2 * s, 0.1 * s)
    g.clip()
    const sh = g.createLinearGradient(0, lift, 0, lift + 0.1 * s)
    sh.addColorStop(0, rgba(ink, 0.22 * (1 - k)))
    sh.addColorStop(1, rgba(ink, 0))
    g.fillStyle = sh
    g.fill(d.path)
    g.restore()
    g.save()
    g.translate(0, top)
    g.scale(1 + 0.03 * Math.sin(Math.PI * k), Math.max(0.001, sy))
    g.translate(0, -top)
    g.fillStyle = paper
    g.fill(d.path)
    calendarPage(g, d, s, top, m, phase, 1)
    g.fillStyle = rgba(ink, 0.3 * k)
    g.fill(d.path)
    g.restore()
  } else {
    calendarPage(g, d, s, top, m, phase, d.build)
  }
  // the page outline on light worlds, then the binder rings over the top edge
  if (light) {
    g.strokeStyle = rgba(ink, 0.85)
    g.lineWidth = Math.max(1.2, s * 0.008)
    g.stroke(d.path)
  }
  const R = CALENDAR_LAYOUT.rings
  const ra = easeOutBack(seg(d.build, 0, 0.35), 2)
  if (ra > 0) {
    for (const sx of [-1, 1]) {
      const x = sx * R.dx * s
      g.fillStyle = mixHex(c.accent, '#000000', 0.45)
      g.beginPath()
      g.ellipse(x, top + 0.045 * s, R.hole * s, R.hole * 0.8 * s, 0, 0, TAU)
      g.fill()
      g.strokeStyle = light ? c.fg : mixHex(c.fg, c.bg, 0.25)
      g.lineWidth = R.width * s * ra
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(x, top + 0.045 * s)
      g.lineTo(x, top + 0.045 * s - (0.045 + R.up) * s * ra)
      g.stroke()
    }
  }
  g.restore()
}

// ------------------------------------------------------------------ envelope

/**
 * Envelope (Task 6c, "invoices by email"): an envelope 1.4 × size wide, 0.9 × size tall, its flap
 * a triangle hinged on the top edge, a small accent «@» badge on the front. Build: the flap opens —
 * it turns up about its hinge (y scale 1 → −1) and shows its inside behind. Idle: an invoice (a
 * white page with a logo bar, three lines and an accent total «AED ###», canvas decoration) slides
 * up out of the envelope every `ENVELOPE.every` s, then fans out about a point inside the
 * envelope with a small tilt, one beside the other (at most five), swaying gently.
 */
export const ENVELOPE_LAYOUT = {
  flap: 0.5,
  pocketY: 0.06,
  pocketCorner: 0.06,
  invoice: { w: 0.42, h: 0.54, r: 0.025, pivotY: 0.14, from: -0.18, to: 0.64 },
  fanDeg: [28, 14, 0, -14, -28],
  badge: 0.15,
} as const

function drawEnvelope(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const { light, paper, ink } = paperInk(c)
  const geo = OBJECT_GEOMETRY.envelope
  const L = ENVELOPE_LAYOUT
  const l = (-geo.w / 2) * s
  const r = (geo.w / 2) * s
  const t = (-geo.h / 2) * s
  const b = (geo.h / 2) * s
  const inside = mixHex(paper, ink, 0.16)
  const line = rgba(ink, light ? 0.85 : 0.35)
  const lw = Math.max(1.2, s * 0.008)
  g.save()
  liftShadowPath(g, c, s, d.detailAlpha, d.path)
  g.fillStyle = paper
  g.fill(d.path)
  g.restore()
  if (!(d.detailAlpha > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  g.lineJoin = 'round'
  const open = easeInOutCubic(seg(d.build, 0, 0.9))
  const sy = Math.cos(Math.PI * open)
  const tip = t + L.flap * s * sy
  const flap = () => {
    g.beginPath()
    g.moveTo(l + 0.02 * s, t)
    g.lineTo(0, tip)
    g.lineTo(r - 0.02 * s, t)
    g.closePath()
  }
  // inside: the back panel and, once it has turned past its hinge, the open flap behind
  if (open > 0) {
    g.save()
    g.clip(d.path)
    g.fillStyle = inside
    g.globalAlpha *= seg(open, 0, 0.3)
    g.fillRect(l, t, r - l, b - t)
    g.restore()
  }
  if (sy < 0) {
    flap()
    g.fillStyle = mixHex(inside, ink, 0.06)
    g.fill()
    g.strokeStyle = line
    g.lineWidth = lw
    g.stroke()
  }
  // invoices: out of the envelope, then fanning out
  const I = L.invoice
  const iw = I.w * s
  const ih = I.h * s
  const idle0 = buildSecOf('envelope')
  g.save()
  g.beginPath()
  g.rect(-2 * s, -3 * s, 4 * s, 3 * s + b)
  g.clip()
  for (let i = 0; i < ENVELOPE.max; i++) {
    const t0 = idle0 + i * ENVELOPE.every
    const e1 = easeOutCubic(seg(d.since, t0, t0 + ENVELOPE.rise))
    if (e1 <= 0) continue
    const e2 = softSpring(seg(d.since, t0 + ENVELOPE.fanDelay, t0 + ENVELOPE.fanDelay + ENVELOPE.fan))
    const deg = L.fanDeg[i]! + 6 * (hash01(d.seed, 30 + i) - 0.5)
    const sway = (1.5 * Math.PI) / 180 * Math.sin(TAU * 0.5 * d.since + i * 1.3) * Math.min(1, e2)
    const a = (deg * Math.PI) / 180 * e2 + sway
    const dist = (I.from + (I.to - I.from) * e1) * s
    const px = Math.sin(a) * dist
    const py = I.pivotY * s - Math.cos(a) * dist
    g.save()
    g.translate(px, py)
    g.rotate(a)
    g.save()
    const card = new Path2D()
    rrect(card, -iw / 2, -ih / 2, iw, ih, I.r * s)
    if (light) softShadow(g, card, c.fg, 0.18, s * 0.05, s * 0.02)
    g.fillStyle = light ? '#ffffff' : mixHex(c.fg, '#ffffff', 0.45)
    g.fill(card)
    g.restore()
    g.strokeStyle = rgba(ink, 0.22)
    g.lineWidth = Math.max(1, s * 0.004)
    g.stroke()
    // logo bar, three lines (right-aligned, RTL), a rule and the accent total
    const xr = iw / 2 - 0.05 * s
    g.fillStyle = c.accent
    g.beginPath()
    rrect(g, xr - 0.13 * s, -ih / 2 + 0.05 * s, 0.13 * s, 0.035 * s, 0.012 * s)
    g.fill()
    g.strokeStyle = rgba(ink, 0.34)
    g.lineCap = 'round'
    g.lineWidth = 0.022 * s
    ;[0.26, 0.2, 0.24].forEach((len, j) => {
      const y = -ih / 2 + (0.15 + 0.065 * j) * s
      g.beginPath()
      g.moveTo(xr, y)
      g.lineTo(xr - len * s * (0.8 + 0.2 * hash01(d.seed, 40 + i * 3 + j)), y)
      g.stroke()
    })
    g.fillStyle = rgba(ink, 0.18)
    g.fillRect(-iw / 2 + 0.05 * s, -ih / 2 + 0.36 * s, iw - 0.1 * s, Math.max(1, 0.005 * s))
    const amount = 120 + 10 * Math.floor(hash01(d.seed, 20 + i) * 88)
    g.fillStyle = c.accent
    decoText(g, `${d.currency} ${amount}`, 0, -ih / 2 + 0.45 * s, 0.07 * s, iw - 0.08 * s, d.font, 900, 'ltr', 'center')
    g.restore()
  }
  g.restore()
  // the front pocket (a V under the opening) with its side folds and the badge
  const py = L.pocketY * s
  const pc = t + L.pocketCorner * s
  g.save()
  g.clip(d.path)
  g.beginPath()
  g.moveTo(l, pc)
  g.lineTo(0, py)
  g.lineTo(r, pc)
  g.lineTo(r, b)
  g.lineTo(l, b)
  g.closePath()
  g.fillStyle = paper
  g.fill()
  g.strokeStyle = line
  g.lineWidth = lw
  g.beginPath()
  g.moveTo(l, pc)
  g.lineTo(0, py)
  g.lineTo(r, pc)
  g.stroke()
  g.strokeStyle = rgba(ink, light ? 0.3 : 0.18)
  g.beginPath()
  g.moveTo(l, b)
  g.lineTo(0, 0.15 * s)
  g.lineTo(r, b)
  g.stroke()
  g.restore()
  const ba = easeOutBack(seg(d.build, 0.4, 1), 2)
  if (ba > 0) {
    const bs = L.badge * s * ba
    const bx = r - 0.17 * s
    const by = b - 0.15 * s
    g.fillStyle = c.accent
    g.beginPath()
    rrect(g, bx - bs / 2, by - bs / 2, bs, bs, bs * 0.25)
    g.fill()
    g.fillStyle = light ? paper : c.bg
    decoText(g, '@', bx, by + bs * 0.04, bs * 0.78, bs * 0.9, d.font, 900, 'ltr', 'center')
  }
  // the closed flap in front (until it turns past the hinge)
  if (sy > 0) {
    g.save()
    if (light) {
      const fp = new Path2D()
      fp.moveTo(l + 0.02 * s, t)
      fp.lineTo(0, tip)
      fp.lineTo(r - 0.02 * s, t)
      fp.closePath()
      softShadow(g, fp, c.fg, 0.12, s * 0.03, s * 0.01)
    }
    flap()
    g.fillStyle = mixHex(paper, ink, 0.05)
    g.fill()
    g.restore()
    flap()
    g.strokeStyle = line
    g.lineWidth = lw
    g.stroke()
  }
  if (light) {
    g.strokeStyle = line
    g.lineWidth = lw
    g.stroke(d.path)
  }
  g.restore()
}

// ------------------------------------------------------------------ bell

/**
 * Bell (Task 6c, "reminders"): an accent bell 0.7 × size wide and 0.72 × size tall (dome, waist,
 * flared lip) hanging from a knob, with a clapper under the lip. Idle: it rings every
 * `BELL.every` s — a damped swing of ±`BELL.swingDeg`° about the knob, every ring adding to the
 * last, so the swing is continuous — the clapper swinging `BELL.lag` s behind, two pairs of accent
 * ring marks flashing out beside it; sticky notes (accent and paper tints, a folded corner, two
 * scribbled lines) pop out to a seeded ring around it, one every `BELL.noteEvery` s, at most six.
 */
export const BELL_LAYOUT = {
  pivotY: -0.41,
  knob: 0.034,
  clapper: { y: 0.395, r: 0.055 },
  lipY: 0.27,
  notes: { rx: 0.75, ry: 0.62, side: 0.22, fold: 0.05, deg: [-35, -145, 12, 168, -90, 90] },
  wave: { cy: -0.12, r0: 0.44, gap: 0.1, grow: 0.12, deg: 26 },
} as const

/** The bell's swing angle (radians) `since` s into its state: the sum of the damped rings so far. */
function bellAngle(since: number): number {
  const idle = since - buildSecOf('bell')
  if (idle < 0) return 0
  const J = Math.floor(idle / BELL.every)
  const w = TAU / BELL.period
  let a = 0
  for (let j = Math.max(0, J - 3); j <= J; j++) {
    const tau = idle - j * BELL.every
    a += Math.exp(-BELL.decay * tau) * Math.sin(w * tau)
  }
  return ((BELL.swingDeg * Math.PI) / 180) * a
}

function drawBell(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const { light, paper, ink } = paperInk(c)
  const L = BELL_LAYOUT
  const py = L.pivotY * s
  const swing = d.detailAlpha * Math.min(1, d.build * 4)
  const th = bellAngle(d.since) * swing
  const thc = bellAngle(d.since - BELL.lag) * 1.35 * swing
  const idle = d.since - buildSecOf('bell')
  const rot = (a: number) => {
    g.translate(0, py)
    g.rotate(a)
    g.translate(0, -py)
  }

  // sticky notes around the bell (behind it), popping out one by one
  if (d.detailAlpha > 0 && idle > 0) {
    const N = L.notes
    const q = N.side * s
    const tints = [c.accent, paper, mixHex(paper, c.accent, 0.35)]
    for (let n = 0; n < BELL.notes; n++) {
      const t0 = n * BELL.noteEvery
      const e = seg(idle, t0, t0 + 0.35)
      if (e <= 0) continue
      const deg = N.deg[n]! + 20 * (hash01(d.seed, 60 + n) - 0.5)
      const a = (deg * Math.PI) / 180
      const out = 0.35 + 0.65 * easeOutCubic(e)
      const x = Math.cos(a) * N.rx * s * out
      const y = Math.sin(a) * N.ry * s * out + 0.012 * s * Math.sin(TAU * 0.6 * d.since + n * 1.7)
      const tilt = (24 * (hash01(d.seed, 70 + n) - 0.5) * Math.PI) / 180 - 0.7 * (1 - easeOutCubic(e))
      const sc = Math.max(0, easeOutBack(e, 2.2))
      const fill = tints[n % 3]!
      const f = N.fold * s
      g.save()
      g.globalAlpha *= d.detailAlpha * Math.min(1, e * 4)
      g.translate(x, y)
      g.rotate(tilt)
      g.scale(sc, sc)
      g.save()
      const note = new Path2D()
      note.moveTo(-q / 2, -q / 2)
      note.lineTo(q / 2, -q / 2)
      note.lineTo(q / 2, q / 2)
      note.lineTo(-q / 2 + f, q / 2)
      note.lineTo(-q / 2, q / 2 - f)
      note.closePath()
      liftShadowPath(g, c, s * 0.6, 1, note)
      g.fillStyle = fill
      g.fill(note)
      g.restore()
      g.fillStyle = mixHex(fill, ink, 0.18)
      g.beginPath()
      g.moveTo(-q / 2 + f, q / 2)
      g.lineTo(-q / 2 + f, q / 2 - f)
      g.lineTo(-q / 2, q / 2 - f)
      g.closePath()
      g.fill()
      // two scribbled lines, right-aligned (RTL)
      g.strokeStyle = fill === c.accent ? rgba(paper, 0.9) : rgba(ink, 0.55)
      g.lineWidth = 0.014 * s
      g.lineCap = 'round'
      ;[[-0.035, 0.14], [0.02, 0.095]].forEach(([yy, len]) => {
        g.beginPath()
        const x0 = q / 2 - 0.035 * s
        for (let i = 0; i <= 12; i++) {
          const u = i / 12
          const xx = x0 - len! * s * u
          const wy = yy! * s + 0.008 * s * Math.sin(u * 14 + n)
          if (i) g.lineTo(xx, wy)
          else g.moveTo(xx, wy)
        }
        g.stroke()
      })
      g.restore()
    }
  }

  // ring marks: two arcs each side, flashing out at every ring
  if (d.detailAlpha > 0 && idle > 0) {
    const W = L.wave
    const k = (idle - Math.floor(idle / BELL.every) * BELL.every) / BELL.waveSec
    if (k < 1) {
      g.save()
      g.globalAlpha *= d.detailAlpha * (1 - k)
      g.strokeStyle = c.accent
      g.lineWidth = 0.026 * s
      g.lineCap = 'round'
      const span = (W.deg * Math.PI) / 180
      for (let j = 0; j < 2; j++) {
        const rr = (W.r0 + j * W.gap + W.grow * easeOutCubic(k)) * s
        for (const base of [0, Math.PI]) {
          g.beginPath()
          g.arc(0, W.cy * s, rr, base - span, base + span)
          g.stroke()
        }
      }
      g.restore()
    }
  }

  // the clapper (behind the lip), swinging a little behind the bell
  if (d.detailAlpha > 0 && d.build > 0) {
    g.save()
    g.globalAlpha *= d.detailAlpha * seg(d.build, 0.2, 0.7)
    rot(thc)
    g.fillStyle = light ? c.fg : mixHex(c.fg, c.bg, 0.2)
    g.beginPath()
    g.arc(0, L.clapper.y * s, L.clapper.r * s, 0, TAU)
    g.fill()
    g.restore()
  }

  g.save()
  rot(th)
  // a ring strikes: a small swell of the body
  const strike = idle > 0 ? Math.exp(-12 * (idle - Math.floor(idle / BELL.every) * BELL.every)) : 0
  const sw = 1 + 0.035 * strike * swing
  g.translate(0, py)
  g.scale(sw, sw)
  g.translate(0, -py)
  g.save()
  liftShadowPath(g, c, s, d.detailAlpha, d.path)
  g.fillStyle = c.accent
  g.fill(d.path)
  g.restore()
  if (d.detailAlpha > 0 && d.build > 0) {
    g.save()
    g.globalAlpha *= d.detailAlpha
    g.clip(d.path)
    const b = d.build
    const hl = g.createLinearGradient(-0.35 * s, 0, 0.35 * s, 0)
    hl.addColorStop(0, `rgba(255,255,255,${0.24 * b})`)
    hl.addColorStop(0.42, 'rgba(255,255,255,0)')
    hl.addColorStop(1, `rgba(0,0,0,${0.16 * b})`)
    g.fillStyle = hl
    g.fillRect(-0.4 * s, -0.4 * s, 0.8 * s, 0.8 * s)
    // the lip band and a specular stroke on the dome
    g.fillStyle = mixHex(c.accent, '#000000', 0.22)
    g.globalAlpha *= seg(b, 0, 0.6)
    g.fillRect(-0.4 * s, L.lipY * s, 0.8 * s, 0.1 * s)
    g.strokeStyle = 'rgba(255,255,255,0.45)'
    g.lineWidth = 0.022 * s
    g.lineCap = 'round'
    partialLine(g, [[-0.13 * s, -0.25 * s], [-0.16 * s, -0.12 * s], [-0.165 * s, 0.02 * s]], seg(b, 0.2, 0.8))
    g.restore()
    // the knob it hangs from
    g.save()
    g.globalAlpha *= d.detailAlpha * seg(b, 0, 0.5)
    g.strokeStyle = light ? c.fg : mixHex(c.fg, c.bg, 0.2)
    g.lineWidth = 0.026 * s
    g.beginPath()
    g.arc(0, py, L.knob * s, 0, TAU)
    g.stroke()
    g.restore()
  }
  g.restore()
}

// ------------------------------------------------------------------ voice note

/**
 * Voice note (Task 6c, "record a note"): a chat bubble 1.5 × 0.42 × size, its tail at the top
 * right (RTL), in a pale accent tint; an accent play button on the right, a waveform of
 * `VOICE_NOTE.bars` bars to its left and a duration chip «0:07» under its left end (canvas
 * decoration). Idle: the waveform records right → left over `VOICE_NOTE.sweepSec` — each bar
 * pops up as the front passes it, as tall as the voice at that moment (`levels`, else seeded idle
 * motion) — while the play icon turns to pause, a pulse rings the button with the live level and
 * the chip counts up; then the progress fill replays it right → left in a loop.
 */
export const VOICE_LAYOUT = {
  play: { x: 0.47, r: 0.115 },
  wave: { xR: 0.3, xL: -0.62, y: -0.015, half: 0.085, width: 0.017 },
  chip: { x: -0.62, y: 0.145, size: 0.062 },
  ticks: { x: 0.31, y: 0.15 },
  rest: 0.45,
} as const

function drawVoiceNote(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const { light, paper, ink } = paperInk(c)
  const L = VOICE_LAYOUT
  const bubble = mixHex(paper, c.accent, light ? 0.13 : 0.1)
  g.save()
  liftShadowPath(g, c, s, d.detailAlpha, d.path)
  g.fillStyle = bubble
  g.fill(d.path)
  g.restore()
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  g.save()
  g.globalAlpha *= d.detailAlpha
  if (light) {
    g.strokeStyle = rgba(ink, 0.18)
    g.lineWidth = Math.max(1, s * 0.005)
    g.stroke(d.path)
  }
  const b = d.build
  const t0 = buildSecOf('voice-note')
  const T = VOICE_NOTE.sweepSec
  const rec = seg(d.since, t0, t0 + T)
  const after = d.since - t0 - T
  const replay = after > 0 ? Math.min(1, (after % (T + L.rest)) / T) : 0
  const front = after > 0 ? replay : rec
  const W = L.wave
  const xR = W.xR * s
  const xL = W.xL * s
  const xf = xR - (xR - xL) * front
  const cy = W.y * s

  // progress fill behind the played part
  if (d.since > t0) {
    g.fillStyle = rgba(c.accent, 0.12)
    g.beginPath()
    rrect(g, xf, cy - W.half * s, xR + 0.02 * s - xf, 2 * W.half * s, W.half * s)
    g.fill()
  }
  // waveform: bar i (from the right) is the voice when the recording front passed it
  const n = VOICE_NOTE.bars
  const pitch = (xR - xL) / n
  g.lineCap = 'round'
  g.lineWidth = W.width * s
  for (let i = 0; i < n; i++) {
    const x = xR - (i + 0.5) * pitch
    const ti = t0 + ((i + 0.5) / n) * T
    const grow = easeOutBack(seg(d.since, ti, ti + VOICE_NOTE.barIn), 2.2)
    if (grow <= 0) {
      // not recorded yet: a faint dot holds the bar's place
      g.fillStyle = rgba(ink, 0.14 * seg(b, 0.3, 1))
      g.beginPath()
      g.arc(x, cy, W.width * s * 0.45, 0, TAU)
      g.fill()
      continue
    }
    const v = voiceAt(d, ti - t0)
    const hh = (0.12 + 0.88 * v) * W.half * s * grow
    g.strokeStyle = x >= xf - 0.5 ? c.accent : rgba(ink, 0.42)
    g.beginPath()
    g.moveTo(x, cy - hh)
    g.lineTo(x, cy + hh)
    g.stroke()
  }
  // the scrubber knob on replay
  if (after > 0) {
    g.fillStyle = c.accent
    g.beginPath()
    g.arc(xf, cy, 0.028 * s, 0, TAU)
    g.fill()
  }

  // play button: pops in; while recording a pulse follows the live level
  const P = L.play
  const pb = easeOutBack(seg(b, 0, 0.7), 2)
  const px = P.x * s
  if (rec > 0 && rec < 1) {
    const v = voiceAt(d, d.since - t0)
    g.strokeStyle = rgba(c.accent, 0.4 * Math.sin(Math.PI * Math.min(1, rec * 6)))
    g.lineWidth = 0.016 * s
    g.beginPath()
    g.arc(px, 0, P.r * s * (1.12 + 0.32 * v), 0, TAU)
    g.stroke()
  }
  g.save()
  g.translate(px, 0)
  g.scale(pb, pb)
  g.fillStyle = c.accent
  g.beginPath()
  g.arc(0, 0, P.r * s, 0, TAU)
  g.fill()
  // ▶ (two halves) → ❚❚ as it starts playing
  const m = easeInOutCubic(seg(d.since, t0 - 0.08, t0 + 0.12))
  const u = P.r * s * 0.5
  const halves: [Pt[], Pt[]][] = [
    [[[-0.38, -0.55], [0.12, -0.27], [0.12, 0.27], [-0.38, 0.55]], [[-0.46, -0.5], [-0.12, -0.5], [-0.12, 0.5], [-0.46, 0.5]]],
    [[[0.12, -0.27], [0.62, 0], [0.62, 0], [0.12, 0.27]], [[0.12, -0.5], [0.46, -0.5], [0.46, 0.5], [0.12, 0.5]]],
  ]
  g.fillStyle = light ? paper : c.fg
  for (const [tri, bar] of halves) {
    g.beginPath()
    tri.forEach(([x0, y0], j) => {
      const [x1, y1] = bar[j]!
      const X = (x0 + (x1 - x0) * m) * u
      const Y = (y0 + (y1 - y0) * m) * u
      if (j) g.lineTo(X, Y)
      else g.moveTo(X, Y)
    })
    g.closePath()
    g.fill()
  }
  g.restore()

  // duration chip (counting up while recording) and the delivery ticks (accent once played)
  const ca = seg(b, 0.4, 1)
  if (ca > 0) {
    g.save()
    g.globalAlpha *= ca
    const sec = d.since > t0 ? Math.min(7, Math.floor(7 * rec + 1e-9)) : 0
    g.fillStyle = rgba(ink, 0.55)
    decoText(g, `0:0${after > 0 ? 7 : sec}`, L.chip.x * s, L.chip.y * s, L.chip.size * s, 0.2 * s, d.font, 700, 'ltr', 'left')
    g.strokeStyle = after > 0 ? c.accent : rgba(ink, 0.4)
    g.lineWidth = 0.012 * s
    g.lineJoin = 'round'
    const tx = L.ticks.x * s
    const ty = L.ticks.y * s
    for (const dx of [0, 0.03]) {
      g.beginPath()
      g.moveTo(tx - 0.05 * s + dx * s, ty)
      g.lineTo(tx - 0.035 * s + dx * s, ty + 0.016 * s)
      g.lineTo(tx - 0.005 * s + dx * s, ty - 0.018 * s)
      g.stroke()
    }
    g.restore()
  }
  g.restore()
}

// ------------------------------------------------------------------ phone app

/**
 * Phone app (Task 6c, "the app"): a phone 0.56 × 1.1 × size with a notch. Build: the screen lights
 * up and a simple invoices app lays out (a header, three list rows with an avatar, two lines and an
 * amount pill). Idle: at `PHONE_APP.notifyAt` a notification card slides down from the top of the
 * screen, its accent bell icon wiggling; at the state's `checkAt` the card turns into the paid
 * check — it shrinks and rounds into an accent disc at the screen centre (no green), a ✓ draws
 * itself in it, a ring pulses out and the app dims behind it.
 */
export const PHONE_LAYOUT = {
  bezel: 0.025,
  screenR: 0.075,
  notch: { w: 0.15, h: 0.032, y: -0.5 },
  header: { y: -0.45, h: 0.09 },
  rows: { y: [-0.3, -0.13, 0.04, 0.21], h: 0.15, w: 0.47 },
  card: { w: 0.47, h: 0.14, y: -0.41, r: 0.035, icon: 0.04 },
  check: { d: 0.3, y: 0 },
} as const

/** A small bell glyph (for the notification icon), centred, `r` across. */
function bellGlyph(g: CanvasRenderingContext2D, r: number): void {
  g.beginPath()
  g.moveTo(0, -r)
  g.bezierCurveTo(r * 0.55, -r, r * 0.62, -r * 0.5, r * 0.62, 0)
  g.lineTo(r * 0.62, r * 0.35)
  g.lineTo(r * 0.85, r * 0.62)
  g.lineTo(-r * 0.85, r * 0.62)
  g.lineTo(-r * 0.62, r * 0.35)
  g.lineTo(-r * 0.62, 0)
  g.bezierCurveTo(-r * 0.62, -r * 0.5, -r * 0.55, -r, 0, -r)
  g.closePath()
  g.fill()
  g.beginPath()
  g.arc(0, r * 0.82, r * 0.2, 0, TAU)
  g.fill()
}

function drawPhoneApp(g: CanvasRenderingContext2D, d: ObjectDraw): void {
  const s = 2 * d.r
  const c = d.colours
  const light = lum(c.bg) > 0.5
  const L = PHONE_LAYOUT
  const geo = OBJECT_GEOMETRY['phone-app']
  const body = light ? c.fg : mixHex(c.bg, c.fg, 0.16)
  const ink = light ? c.fg : c.bg
  const card = light ? '#ffffff' : mixHex(c.fg, '#ffffff', 0.55)
  g.save()
  liftShadowPath(g, c, s, d.detailAlpha, d.path)
  g.fillStyle = body
  g.fill(d.path)
  g.restore()
  if (!light) {
    g.save()
    g.strokeStyle = rgba(c.fg, 0.2)
    g.lineWidth = Math.max(1, s * 0.005)
    g.stroke(d.path)
    g.restore()
  }
  if (!(d.detailAlpha > 0) || !(d.build > 0)) return
  const b = d.build
  const sw = (geo.w / 2 - L.bezel) * s
  const sh = (geo.h / 2 - L.bezel) * s
  const screen = new Path2D()
  {
    const rr = L.screenR * s
    screen.moveTo(-sw + rr, -sh)
    screen.arcTo(sw, -sh, sw, sh, rr)
    screen.arcTo(sw, sh, -sw, sh, rr)
    screen.arcTo(-sw, sh, -sw, -sh, rr)
    screen.arcTo(-sw, -sh, sw, -sh, rr)
    screen.closePath()
  }
  g.save()
  g.globalAlpha *= d.detailAlpha
  // the screen lights up
  const lit = easeOutCubic(seg(b, 0, 0.6))
  const on = light ? mixHex(c.bg, '#ffffff', 0.45) : mixHex(c.fg, c.bg, 0.05)
  g.fillStyle = mixHex(mixHex(body, '#000000', 0.3), on, lit)
  g.fill(screen)
  g.save()
  g.clip(screen)
  g.fillStyle = `rgba(255,255,255,${0.35 * Math.sin(Math.PI * lit)})`
  g.fill(screen)

  // the app: status bar, header, three invoice rows sliding up into place
  const ua = seg(b, 0.35, 1)
  if (ua > 0) {
    g.save()
    g.globalAlpha *= ua
    g.translate(0, 0.04 * s * (1 - easeOutCubic(ua)))
    g.fillStyle = rgba(ink, 0.45)
    g.beginPath()
    rrect(g, sw - 0.1 * s, -sh + 0.018 * s, 0.06 * s, 0.018 * s, 0.009 * s)
    rrect(g, -sw + 0.04 * s, -sh + 0.018 * s, 0.05 * s, 0.018 * s, 0.005 * s)
    g.fill()
    const H = L.header
    g.fillStyle = rgba(ink, 0.06)
    g.fillRect(-sw, H.y * s - (H.h / 2) * s, 2 * sw, H.h * s)
    g.strokeStyle = rgba(ink, 0.72)
    g.lineCap = 'round'
    g.lineWidth = 0.028 * s
    g.beginPath()
    g.moveTo(sw - 0.05 * s, H.y * s)
    g.lineTo(sw - 0.23 * s, H.y * s)
    g.stroke()
    g.fillStyle = rgba(ink, 0.16)
    g.beginPath()
    g.arc(-sw + 0.07 * s, H.y * s, 0.026 * s, 0, TAU)
    g.fill()
    const R = L.rows
    R.y.forEach((ry, j) => {
      const a = easeOutCubic(seg(b, 0.45 + 0.15 * j, 0.8 + 0.15 * j))
      if (a <= 0) return
      g.save()
      g.globalAlpha *= a
      g.translate(0, 0.03 * s * (1 - a))
      const y0 = ry * s
      const hw = (R.w / 2) * s
      g.fillStyle = card
      g.beginPath()
      rrect(g, -hw, y0, 2 * hw, R.h * s, 0.03 * s)
      g.fill()
      const cy = y0 + (R.h / 2) * s
      g.fillStyle = mixHex(on, ink, 0.14 + 0.1 * j)
      g.beginPath()
      g.arc(hw - 0.06 * s, cy, 0.034 * s, 0, TAU)
      g.fill()
      g.strokeStyle = rgba(ink, 0.6)
      g.lineWidth = 0.02 * s
      g.beginPath()
      g.moveTo(hw - 0.12 * s, cy - 0.022 * s)
      g.lineTo(hw - (0.12 + 0.14 + 0.03 * hash01(d.seed, 80 + j)) * s, cy - 0.022 * s)
      g.stroke()
      g.strokeStyle = rgba(ink, 0.28)
      g.beginPath()
      g.moveTo(hw - 0.12 * s, cy + 0.024 * s)
      g.lineTo(hw - 0.22 * s, cy + 0.024 * s)
      g.stroke()
      g.fillStyle = rgba(ink, 0.12)
      g.beginPath()
      rrect(g, -hw + 0.03 * s, cy - 0.02 * s, 0.1 * s, 0.04 * s, 0.02 * s)
      g.fill()
      g.restore()
    })
    // the home indicator
    g.fillStyle = rgba(ink, 0.35)
    g.beginPath()
    rrect(g, -0.08 * s, sh - 0.03 * s, 0.16 * s, 0.012 * s, 0.006 * s)
    g.fill()
    g.restore()
  }

  // the notification: slides down, its bell wiggles; then it becomes the paid check
  const C = L.card
  const slide = softSpring(seg(d.since, PHONE_APP.notifyAt, PHONE_APP.notifyAt + PHONE_APP.slideSec))
  const k = softSpring(seg(d.since, d.checkAt, d.checkAt + PHONE_APP.morphSec))
  const kc = Math.min(1, Math.max(0, k))
  if (kc > 0) {
    // the app dims behind the check
    g.fillStyle = rgba(on, 0.6 * kc)
    g.fill(screen)
  }
  if (slide > 0) {
    const startY = -sh - (C.h / 2 + 0.02) * s
    const y0 = startY + (C.y * s - startY) * slide
    const cy = y0 + (L.check.y * s - y0) * k
    const w = C.w * s + (L.check.d * s - C.w * s) * k
    const h = C.h * s + (L.check.d * s - C.h * s) * k
    const rad = C.r * s + ((L.check.d / 2) * s - C.r * s) * kc
    const breathe = kc >= 1 ? 1 + 0.015 * Math.sin(TAU * 0.8 * (d.since - d.checkAt)) : 1
    g.save()
    g.translate(0, cy)
    g.scale(breathe, breathe)
    g.save()
    const cardPath = new Path2D()
    rrect(cardPath, -w / 2, -h / 2, w, h, rad)
    softShadow(g, cardPath, c.fg, light ? 0.22 : 0.4, s * 0.05, s * 0.015)
    g.fillStyle = mixHex(card, c.accent, seg(k, 0, 0.5))
    g.fill(cardPath)
    g.restore()
    const ca = 1 - seg(k, 0, 0.25)
    if (ca > 0) {
      g.save()
      g.globalAlpha *= ca
      const ix = C.w / 2 * s - 0.065 * s
      g.fillStyle = c.accent
      g.beginPath()
      g.arc(ix, 0, C.icon * s, 0, TAU)
      g.fill()
      const wig = 0.5 * Math.exp(-5 * Math.max(0, d.since - PHONE_APP.notifyAt - 0.15)) * Math.sin((TAU * Math.max(0, d.since - PHONE_APP.notifyAt - 0.15)) / 0.16)
      g.save()
      g.translate(ix, -0.012 * s)
      g.rotate(wig)
      g.translate(0, 0.012 * s)
      g.fillStyle = card
      bellGlyph(g, 0.022 * s)
      g.restore()
      g.strokeStyle = rgba(ink, 0.75)
      g.lineCap = 'round'
      g.lineWidth = 0.022 * s
      g.beginPath()
      g.moveTo(ix - 0.07 * s, -0.025 * s)
      g.lineTo(ix - 0.27 * s, -0.025 * s)
      g.stroke()
      g.strokeStyle = rgba(ink, 0.32)
      g.beginPath()
      g.moveTo(ix - 0.07 * s, 0.025 * s)
      g.lineTo(ix - 0.33 * s, 0.025 * s)
      g.stroke()
      g.restore()
    }
    // ✓
    const tick = seg(d.since, d.checkAt + 0.18, d.checkAt + 0.42)
    if (tick > 0) {
      g.strokeStyle = light ? '#ffffff' : c.fg
      g.lineWidth = 0.032 * s
      g.lineCap = 'round'
      g.lineJoin = 'round'
      partialLine(g, [[-0.065 * s, 0.005 * s], [-0.02 * s, 0.05 * s], [0.07 * s, -0.045 * s]], easeOutCubic(tick))
    }
    g.restore()
    const pulse = seg(d.since, d.checkAt + 0.3, d.checkAt + 1)
    if (pulse > 0 && pulse < 1) {
      g.strokeStyle = rgba(c.accent, 0.6 * (1 - pulse))
      g.lineWidth = 0.012 * s
      g.beginPath()
      g.arc(0, L.check.y * s, (L.check.d / 2 + 0.12 * easeOutCubic(pulse)) * s, 0, TAU)
      g.stroke()
    }
  }
  g.restore()
  // the notch
  g.fillStyle = body
  g.beginPath()
  rrect(g, (-L.notch.w / 2) * s, L.notch.y * s - (L.notch.h / 2) * s, L.notch.w * s, L.notch.h * s, (L.notch.h / 2) * s)
  g.fill()
  g.restore()
}
