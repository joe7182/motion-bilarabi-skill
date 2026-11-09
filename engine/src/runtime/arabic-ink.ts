/**
 * Arabic ink: a headline line drawn once, whole, by the browser (so it is shaped and joined
 * correctly), then split into its separate ink pieces — the connected letter bodies and the dots and
 * marks that float above or below them. Moves animate pieces, never individual characters.
 */

export const canvas2d = (cv: HTMLCanvasElement): CanvasRenderingContext2D => {
  const c = cv.getContext('2d', { willReadFrequently: true })
  if (!c) throw new Error('arabic ink needs a 2D canvas')
  return c
}

export const displayFont = (family: string, px: number) => `900 ${px.toFixed(2)}px ${family}`

/** Font px so that `text` is at most `maxW` wide, between `floorPx` and `maxPx`. */
export function fitPx(c: CanvasRenderingContext2D, text: string, family: string, maxPx: number, maxW: number, floorPx = 1): number {
  c.font = displayFont(family, 100)
  const at100 = c.measureText(text).width
  const px = at100 > 0 ? Math.min(maxPx, (100 * maxW) / at100) : maxPx
  return Math.max(floorPx, Math.floor(px * 4) / 4)
}

/** Draws one RTL line centred on (x, baseline). */
export function drawLine(c: CanvasRenderingContext2D, text: string, x: number, baseline: number, family: string, px: number, colour: string, outline = 0): void {
  c.font = displayFont(family, px)
  c.direction = 'rtl'
  c.textAlign = 'center'
  c.textBaseline = 'alphabetic'
  if (outline > 0) {
    c.lineWidth = outline
    c.strokeStyle = colour
    c.strokeText(text, x, baseline)
  } else {
    c.fillStyle = colour
    c.fillText(text, x, baseline)
  }
}

/** Each word's horizontal span, first word on the right (RTL), for a line centred on `cx`. */
export function wordSpans(c: CanvasRenderingContext2D, words: readonly string[], cx: number) {
  const gap = c.measureText(' ').width
  const sizes = words.map((w) => c.measureText(w).width)
  const total = sizes.reduce((s, w) => s + w, 0) + gap * (words.length - 1)
  let right = cx + total / 2
  return words.map((word, i) => {
    const span = { word, right, left: right - sizes[i]!, mid: right - sizes[i]! / 2 }
    right = span.left - gap
    return span
  })
}

/** A line rendered white on its own transparent canvas. `base` is the baseline's y on that canvas. */
export interface InkLine {
  cv: HTMLCanvasElement
  w: number
  h: number
  base: number
  px: number
}

const lineCache = new Map<string, InkLine>()
export function inkLine(text: string, family: string, px: number): InkLine {
  const key = `${family}\u0000${px}\u0000${text}`
  const hit = lineCache.get(key)
  if (hit) return hit
  const probe = canvas2d(document.createElement('canvas'))
  probe.font = displayFont(family, px)
  probe.direction = 'rtl'
  const m = probe.measureText(text)
  const margin = Math.ceil(px * 0.25)
  const up = Math.ceil(Math.max(m.actualBoundingBoxAscent || 0, px * 0.55))
  const down = Math.ceil(Math.max(m.actualBoundingBoxDescent || 0, px * 0.12))
  const span = Math.ceil(Math.max(m.width, (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0)))
  const cv = document.createElement('canvas')
  cv.width = span + 2 * margin
  cv.height = up + down + 2 * margin
  const line: InkLine = { cv, w: cv.width, h: cv.height, base: margin + up, px }
  drawLine(canvas2d(cv), text, cv.width / 2, line.base, family, px, '#ffffff')
  if (lineCache.size > 48) lineCache.delete(lineCache.keys().next().value!)
  lineCache.set(key, line)
  return line
}

/** One connected run of ink. `mark` = a dot or small mark rather than a letter body. */
export interface Piece {
  index: number
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
  pixels: number
  mark: boolean
  /** The piece alone, white, `w` × `h`. */
  cv: HTMLCanvasElement
}

const ALPHA_CUT = 40
const pieceCache = new WeakMap<InkLine, Piece[]>()

/** The line's pieces, right to left. Flood fill over 8-neighbours; a piece is a mark when it is small in every direction. */
export function piecesOf(line: InkLine): Piece[] {
  const cached = pieceCache.get(line)
  if (cached) return cached
  const { w: W, h: H } = line
  const alpha = canvas2d(line.cv).getImageData(0, 0, W, H).data
  const owner = new Int32Array(W * H).fill(-1)
  const queue = new Int32Array(W * H)
  const found: { x0: number; y0: number; x1: number; y1: number; cells: Int32Array }[] = []
  for (let seed = 0; seed < W * H; seed++) {
    if (owner[seed] !== -1 || alpha[seed * 4 + 3]! <= ALPHA_CUT) continue
    const id = found.length
    let head = 0
    let tail = 0
    queue[tail++] = seed
    owner[seed] = id
    let x0 = W, y0 = H, x1 = 0, y1 = 0
    while (head < tail) {
      const at = queue[head++]!
      const x = at % W
      const y = (at / W) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let ny = Math.max(0, y - 1); ny <= Math.min(H - 1, y + 1); ny++)
        for (let nx = Math.max(0, x - 1); nx <= Math.min(W - 1, x + 1); nx++) {
          const n = ny * W + nx
          if (owner[n] === -1 && alpha[n * 4 + 3]! > ALPHA_CUT) {
            owner[n] = id
            queue[tail++] = n
          }
        }
    }
    found.push({ x0, y0, x1, y1, cells: queue.slice(0, tail) })
  }
  const px = line.px
  const pieces = found.map((f) => {
    const w = f.x1 - f.x0 + 1
    const h = f.y1 - f.y0 + 1
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const c = canvas2d(cv)
    const img = c.createImageData(w, h)
    for (const at of f.cells) {
      const sx = at % W
      const sy = (at / W) | 0
      const o = ((sy - f.y0) * w + (sx - f.x0)) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255
      img.data[o + 3] = alpha[at * 4 + 3]!
    }
    c.putImageData(img, 0, 0)
    const mark = w < 0.45 * px && h < 0.36 * px && f.cells.length < 0.07 * px * px
    return { index: 0, x: f.x0, y: f.y0, w, h, cx: f.x0 + w / 2, cy: f.y0 + h / 2, pixels: f.cells.length, mark, cv }
  })
  pieces.sort((a, b) => b.x + b.w - (a.x + a.w) || a.y - b.y)
  pieces.forEach((p, i) => (p.index = i))
  pieceCache.set(line, pieces)
  return pieces
}

const tintCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>()
/** A white canvas recoloured (cached per colour). */
export function tinted(src: HTMLCanvasElement, colour: string): HTMLCanvasElement {
  let byColour = tintCache.get(src)
  if (!byColour) tintCache.set(src, (byColour = new Map()))
  const hit = byColour.get(colour)
  if (hit) return hit
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const c = canvas2d(out)
  c.fillStyle = colour
  c.fillRect(0, 0, out.width, out.height)
  c.globalCompositeOperation = 'destination-in'
  c.drawImage(src, 0, 0)
  byColour.set(colour, out)
  return out
}

/** Where the line's canvas sits when the line is centred on `cx` with its baseline at `baseline`. */
export const placeLine = (line: InkLine, cx: number, baseline: number) => ({ x: cx - line.w / 2, y: baseline - line.base })

/** Draws a piece in its place in the line, optionally moved, turned and scaled about its own centre. */
export function drawPiece(
  c: CanvasRenderingContext2D, piece: Piece, colour: string, origin: { x: number; y: number },
  o: { alpha?: number; dx?: number; dy?: number; turn?: number; sx?: number; sy?: number } = {},
): void {
  const a = o.alpha ?? 1
  if (a <= 0) return
  c.save()
  c.globalAlpha *= a
  c.translate(origin.x + piece.cx + (o.dx ?? 0), origin.y + piece.cy + (o.dy ?? 0))
  if (o.turn) c.rotate(o.turn)
  if (o.sx !== undefined || o.sy !== undefined) c.scale(o.sx ?? 1, o.sy ?? 1)
  c.drawImage(tinted(piece.cv, colour), -piece.w / 2, -piece.h / 2)
  c.restore()
}

// ---- small maths ----
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
/** Progress of t through [start, start + length]. */
export const span = (t: number, start: number, length: number) => clamp01((t - start) / length)
export const mix = (a: number, b: number, k: number) => a + (b - a) * k
/** A stable pseudo-random number in [0, 1) from two integers. */
export function noise(a: number, b = 0): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}
export const ease = {
  out3: (x: number) => 1 - (1 - x) ** 3,
  in3: (x: number) => x * x * x,
  inOut3: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  outSine: (x: number) => Math.sin((x * Math.PI) / 2),
  inOutSine: (x: number) => 0.5 - Math.cos(Math.PI * x) / 2,
  outExpo: (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: (x: number) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  /** Overshoots a little past 1, then settles. */
  outBack: (x: number) => {
    const s = 1.6
    return 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2
  },
}
