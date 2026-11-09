import { arabicMoveEntrance, arabicMoveExit, arabicMoveParams, lettersSnapAt, type ArabicMove, type ArabicMoveParams } from '../../core/params/arabic-move'
import {
  canvas2d, clamp01, displayFont, drawLine, drawPiece, ease, fitPx, inkLine, mix, noise, piecesOf, placeLine, span, tinted, wordSpans,
  type InkLine, type Piece,
} from '../arabic-ink'
import type { Primitive } from './registry'

/** Everything a move needs for one frame. Lengths are canvas pixels; `u` is 1/270 of the width. */
interface Frame {
  c: CanvasRenderingContext2D
  t: number
  text: string
  to: string
  stamp: string
  family: string
  ink: string
  accent: string
  /** The fitted headline size (px). */
  px: number
  W: number
  H: number
  u: number
  cx: number
  /** Baseline of the headline. */
  base: number
  /** Seconds until the move has landed (from the shared timing table). */
  enter: number
  floor: number
}
type Move = (f: Frame) => void

const letterCount = (s: string) => Array.from(s.replace(/[\sً-ٰٟ]/g, '')).length

/** Splits a piece list into bodies and marks, each mark paired with the body it overlaps most (or the nearest). */
function attachMarks(pieces: readonly Piece[]) {
  const bodies = pieces.filter((p) => !p.mark)
  const marksOf = new Map<Piece, Piece[]>(bodies.map((b) => [b, []]))
  for (const m of pieces.filter((p) => p.mark)) {
    let host: Piece | undefined
    let best = 0
    for (const b of bodies) {
      const overlap = Math.min(b.x + b.w, m.x + m.w) - Math.max(b.x, m.x)
      if (overlap > best) [best, host] = [overlap, b]
    }
    host ??= bodies.reduce<Piece | undefined>((near, b) => (!near || Math.abs(b.cx - m.cx) < Math.abs(near.cx - m.cx) ? b : near), undefined)
    if (host) marksOf.get(host)!.push(m)
  }
  return { bodies, marksOf }
}

/** True when a piece belongs to the line's last word (the one that turns accent). */
function inLastWord(f: Frame, line: InkLine) {
  f.c.font = displayFont(f.family, line.px)
  const spans = wordSpans(f.c, f.text.trim().split(/\s+/), line.w / 2)
  const last = spans[spans.length - 1]!
  const slack = line.px * 0.06
  return (p: Piece) => p.cx >= last.left - slack && p.cx <= last.right + slack
}

/** Draws a piece in ink, crossfading to accent by `k`. */
function inkToAccent(f: Frame, p: Piece, at: { x: number; y: number }, k: number, o: Parameters<typeof drawPiece>[4] = {}) {
  if (k < 1) drawPiece(f.c, p, f.ink, at, { ...o, alpha: (o.alpha ?? 1) * (1 - k) })
  if (k > 0) drawPiece(f.c, p, f.accent, at, { ...o, alpha: (o.alpha ?? 1) * k })
}

const dotsDrop: Move = (f) => {
  const line = inkLine(f.text, f.family, f.px)
  const pieces = piecesOf(line)
  const at = placeLine(line, f.cx, f.base)
  const marks = pieces.filter((p) => p.mark)
  const lastWord = inLastWord(f, line)
  const landed = 0.3 + 0.1 * Math.max(0, marks.length - 1) + 0.4
  const warm = ease.out3(span(f.t, landed, 0.3))
  const rise = ease.outSine(span(f.t, 0, 0.3))
  for (const b of pieces) if (!b.mark) inkToAccent(f, b, at, lastWord(b) ? warm : 0, { alpha: rise, dy: (1 - rise) * 6 * f.u })
  marks.forEach((m, i) => {
    const start = 0.3 + 0.1 * i
    if (f.t < start) return
    const k = span(f.t, start, 0.4)
    const fall = ease.outBack(k)
    inkToAccent(f, m, at, lastWord(m) ? warm : 0, { alpha: clamp01(k * 4), dy: -40 * f.u * (1 - fall), turn: (1 - ease.out3(k)) * 0.6 })
    const ring = span(f.t, start + 0.4, 0.25)
    if (ring <= 0 || ring >= 1) return
    f.c.save()
    f.c.globalAlpha *= 0.7 * (1 - ring)
    f.c.strokeStyle = f.accent
    f.c.lineWidth = 1.2 * f.u
    f.c.beginPath()
    f.c.ellipse(at.x + m.cx, at.y + m.cy + m.h * 0.3, m.w * (0.6 + 1.4 * ease.out3(ring)), m.h * (0.25 + 0.5 * ease.out3(ring)), 0, 0, Math.PI * 2)
    f.c.stroke()
    f.c.restore()
  })
}

const penWrite: Move = (f) => {
  const line = inkLine(f.text, f.family, f.px)
  const at = placeLine(line, f.cx, f.base)
  const { bodies, marksOf } = attachMarks(piecesOf(line))
  const lastWord = inLastWord(f, line)
  const writing = Math.max(0.3, f.enter - 0.45)
  const totalW = bodies.reduce((s, b) => s + b.w, 0) || 1
  let clock = 0.15
  const plan = bodies.map((b) => {
    const len = Math.max(0.08, (writing * b.w) / totalW - 0.04)
    const item = { b, start: clock, end: clock + len }
    clock = item.end + 0.04
    return item
  })
  const doneAt = clock
  const warm = ease.out3(span(f.t, doneAt + 0.05, 0.3))
  let nib: { x: number; y: number } | undefined
  for (const { b, start, end } of plan) {
    if (f.t < start) break
    const k = ease.inOutSine(span(f.t, start, end - start))
    const right = at.x + b.x + b.w
    const edge = mix(right, at.x + b.x, k)
    const pad = f.px * 0.1
    const kw = lastWord(b) ? warm : 0
    f.c.save()
    f.c.beginPath()
    f.c.rect(edge, at.y + b.y - pad, right - edge + pad, b.h + 2 * pad)
    f.c.clip()
    inkToAccent(f, b, at, kw)
    f.c.restore()
    const wet = k < 1 ? 0.75 : 0.75 * (1 - span(f.t, end, 0.3))
    if (wet > 0) {
      f.c.save()
      f.c.beginPath()
      f.c.rect(edge, at.y + b.y - pad, Math.min(6 * f.u, right - edge), b.h + 2 * pad)
      f.c.clip()
      drawPiece(f.c, b, f.accent, at, { alpha: wet })
      f.c.restore()
    }
    if (f.t <= end) nib = { x: edge, y: at.y + b.cy }
    marksOf.get(b)!.sort((a, c) => c.cx - a.cx).forEach((m, j) => {
      const pop = span(f.t, end + 0.03 + 0.05 * j, 0.15)
      if (pop <= 0) return
      const s = 1.5 - 0.5 * ease.out3(pop)
      inkToAccent(f, m, at, lastWord(m) ? warm : 0, { alpha: clamp01(pop * 2), sx: s, sy: s })
    })
  }
  if (nib && f.t < doneAt) {
    f.c.save()
    f.c.translate(nib.x, nib.y)
    f.c.rotate(-0.45)
    f.c.fillStyle = f.accent
    f.c.shadowColor = 'rgba(0,0,0,0.25)'
    f.c.shadowBlur = 3 * f.u
    f.c.beginPath()
    f.c.moveTo(0, 0)
    f.c.lineTo(-2 * f.u, -9 * f.u)
    f.c.lineTo(2 * f.u, -9 * f.u)
    f.c.closePath()
    f.c.fill()
    f.c.fillRect(-2 * f.u, -16 * f.u, 4 * f.u, 7 * f.u)
    f.c.restore()
  }
}

const hexRgb = (s: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim())
  const n = m ? parseInt(m[1]!, 16) : 0xffffff
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}
const meltBuffers = new Map<string, HTMLCanvasElement>()
const wordMelt: Move = (f) => {
  const px = Math.min(fitPx(f.c, f.text, f.family, 0.29 * f.W, 0.81 * f.W, f.floor), fitPx(f.c, f.to, f.family, 0.29 * f.W, 0.81 * f.W, f.floor))
  const k = ease.inOutSine(span(f.t, 0.9, 0.9))
  if (k <= 0 || k >= 1) {
    drawLine(f.c, k <= 0 ? f.text : f.to, f.cx, f.base, f.family, px, k <= 0 ? f.ink : f.accent)
    return
  }
  // A half-size buffer: both words blurred against each other, then cut back to hard edges at a soft threshold.
  const bw = Math.round(f.W / 2)
  const bh = Math.round(px * 1.3)
  const key = `${bw}x${bh}`
  let buf = meltBuffers.get(key)
  if (!buf) {
    buf = document.createElement('canvas')
    buf.width = bw
    buf.height = bh
    meltBuffers.set(key, buf)
  }
  const m = canvas2d(buf)
  m.setTransform(1, 0, 0, 1, 0, 0)
  m.globalAlpha = 1
  m.filter = 'none'
  m.clearRect(0, 0, bw, bh)
  const half = px / 2
  const baseline = bh * 0.62
  m.filter = `blur(${(0.06 * px * k ** 1.3).toFixed(2)}px)`
  m.globalAlpha = (1 - k) ** 0.5
  drawLine(m, f.text, bw / 2, baseline, f.family, half, '#000')
  m.filter = `blur(${(0.06 * px * (1 - k) ** 1.3).toFixed(2)}px)`
  m.globalAlpha = k ** 0.5
  drawLine(m, f.to, bw / 2, baseline, f.family, half, '#000')
  m.filter = 'none'
  m.globalAlpha = 1
  const img = m.getImageData(0, 0, bw, bh)
  const from = hexRgb(f.ink)
  const into = hexRgb(f.accent)
  const rgb = [0, 1, 2].map((i) => Math.round(mix(from[i]!, into[i]!, k)))
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const a = clamp01((d[i + 3]! / 255 - 0.4) / 0.18)
    d[i] = rgb[0]!
    d[i + 1] = rgb[1]!
    d[i + 2] = rgb[2]!
    d[i + 3] = Math.round(255 * a * a * (3 - 2 * a))
  }
  m.putImageData(img, 0, 0)
  f.c.drawImage(buf, 0, f.base - baseline * 2, f.W, bh * 2)
}

const unblur: Move = (f) => {
  const words = f.text.trim().split(/\s+/)
  const px = fitPx(f.c, f.text, f.family, 0.16 * f.W, 0.67 * f.W, f.floor)
  f.c.font = displayFont(f.family, px)
  wordSpans(f.c, words, f.cx).forEach((s, i) => {
    const k = ease.out3(span(f.t, 0.2 * i, 0.7))
    if (k <= 0) return
    f.c.save()
    f.c.globalAlpha *= k
    f.c.filter = k < 1 ? `blur(${((1 - k) * 8 * f.u).toFixed(2)}px)` : 'none'
    f.c.translate(s.mid, f.base + (1 - k) * 10 * f.u)
    const sc = 1.2 - 0.2 * k
    f.c.scale(sc, sc)
    drawLine(f.c, s.word, 0, 0, f.family, px, i === words.length - 1 ? f.accent : f.ink)
    f.c.restore()
  })
}

const SCRAMBLE = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'
const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]!)
const decrypt: Move = (f) => {
  const chars = Array.from(f.text)
  const real = chars.filter((ch) => !/\s/.test(ch)).length || 1
  const tick = Math.floor(f.t * 20)
  let locked = 0
  const shown = chars
    .map((ch, i) => {
      if (/\s/.test(ch)) return ch
      if (f.t < 0.03 * i) return ''
      if (f.t >= 0.3 + 0.14 * i) {
        locked++
        return ch
      }
      return SCRAMBLE[Math.floor(noise(i, tick) * SCRAMBLE.length)]!
    })
    .join('')
  const done = 0.3 + 0.14 * Math.max(0, chars.length - 1)
  const px = fitPx(f.c, f.text, f.family, f.px, 0.84 * f.W, f.floor)
  const y = f.base - 0.01 * f.H
  f.c.save()
  f.c.translate(f.cx, y)
  f.c.scale(1 + 0.05 * Math.sin(Math.PI * span(f.t, done, 0.3)), 1)
  drawLine(f.c, shown, 0, 0, f.family, px, f.t >= done ? f.accent : f.ink)
  f.c.restore()
  const share = locked / real
  const barY = f.base + 0.068 * f.H
  const half = 0.28 * f.W
  const thick = 1.5 * f.u
  f.c.save()
  f.c.globalAlpha *= 0.25
  f.c.fillStyle = f.ink
  f.c.fillRect(f.cx - half, barY, 2 * half, thick)
  f.c.restore()
  f.c.fillStyle = f.accent
  f.c.fillRect(f.cx + half - 2 * half * share, barY, 2 * half * share, thick)
  drawLine(f.c, `${toArabicDigits(Math.round(share * 100))}٪`, f.cx, barY + 0.06 * f.H, f.family, 11 * f.u, f.ink)
}

const redactedStamp: Move = (f) => {
  const words = f.text.trim().split(/\s+/)
  const px = fitPx(f.c, f.text, f.family, 0.17 * f.W, 0.81 * f.W, f.floor)
  f.c.font = displayFont(f.family, px)
  const y = f.base - 0.03 * f.H
  const barH = px * 0.62
  wordSpans(f.c, words, f.cx).forEach((s, i) => {
    const lift = ease.inOut3(span(f.t, 0.8 + 0.6 * i, 0.35))
    drawLine(f.c, s.word, s.mid, y, f.family, px, lift > 0 ? f.accent : f.ink)
    const grow = ease.outExpo(span(f.t, 0.06 * i, 0.3))
    const right = mix(s.right + 3 * f.u, s.left - 3 * f.u, lift)
    const width = (right - (s.left - 3 * f.u)) * grow
    if (width < 0.5) return
    f.c.save()
    f.c.translate(right, y - px * 0.4)
    f.c.rotate((noise(i, 7) - 0.5) * 0.035)
    f.c.fillStyle = f.ink
    f.c.beginPath()
    const steps = 7
    for (let j = 0; j <= steps; j++) f.c.lineTo((-width * j) / steps, -barH / 2 + (noise(i, j) - 0.5) * 2 * f.u)
    for (let j = steps; j >= 0; j--) f.c.lineTo((-width * j) / steps, barH / 2 + (noise(j, i + 40) - 0.5) * 2 * f.u)
    f.c.closePath()
    f.c.fill()
    f.c.restore()
  })
  if (!f.stamp) return
  const land = 0.8 + 0.6 * (words.length - 1) + 0.4
  if (f.t < land) return
  const k = span(f.t, land, 0.25)
  const after = f.t - land - 0.25
  const shake = after > 0 ? 1.6 * f.u * Math.sin(after * 88) * (1 - span(after, 0, 0.2)) : 0
  const sc = mix(1.7, 1, ease.outBack(k))
  f.c.save()
  f.c.globalAlpha *= clamp01(k * 2)
  f.c.translate(f.cx + 0.04 * f.W + shake, f.base + 0.17 * f.H)
  f.c.rotate(-0.14)
  f.c.scale(sc, sc)
  f.c.strokeStyle = f.accent
  const bw = 78 * f.u
  const bh = 40 * f.u
  f.c.lineWidth = 2 * f.u
  f.c.beginPath()
  f.c.roundRect(-bw / 2, -bh / 2, bw, bh, 8 * f.u)
  f.c.stroke()
  f.c.lineWidth = f.u
  f.c.beginPath()
  f.c.roundRect(-bw / 2 + 4 * f.u, -bh / 2 + 4 * f.u, bw - 8 * f.u, bh - 8 * f.u, 6 * f.u)
  f.c.stroke()
  drawLine(f.c, f.stamp, 0, 9 * f.u, f.family, fitPx(f.c, f.stamp, f.family, 26 * f.u, 62 * f.u), f.accent)
  f.c.restore()
}

const lettersSnap: Move = (f) => {
  const line = inkLine(f.text, f.family, f.px)
  const n = Math.max(1, letterCount(f.text))
  const snapAt = lettersSnapAt(n)
  const pull = ease.inExpo(span(f.t, snapAt - 0.35, 0.35))
  const settle = 1 - span(f.t, snapAt - 0.5, 0.5)
  const gap = Math.max(0, Math.min(15 * f.u, (0.86 * f.W - line.w) / Math.max(1, n - 1))) * (1 - pull)
  const joined = span(f.t, snapAt, 0.06)
  const ink = tinted(line.cv, f.ink)
  const cell = line.w / n
  const top = f.base - line.base
  if (joined < 1)
    for (let i = 0; i < n; i++) {
      const k = span(f.t, 0.05 * i, 0.35)
      if (k <= 0) continue
      const pop = ease.outBack(k)
      const sc = 0.6 + 0.4 * pop
      const x = f.cx + line.w / 2 - (i + 0.5) * cell + ((n - 1) / 2 - i) * gap
      f.c.save()
      f.c.globalAlpha *= clamp01(k * 1.5) * (1 - joined)
      f.c.translate(x, f.base + Math.sin(Math.PI * f.t + i * 1.7) * 2.5 * f.u * settle)
      f.c.rotate((noise(i, 3) - 0.5) * 0.14 * settle)
      f.c.scale(sc, sc)
      f.c.drawImage(ink, line.w - (i + 1) * cell, 0, cell, line.h, -cell / 2, -line.base, cell, line.h)
      f.c.restore()
    }
  if (joined <= 0) return
  const after = f.t - snapAt
  const squash = 1 + 0.045 * Math.exp(-after * 6) * Math.cos(after * 19)
  const shake = 1.5 * f.u * Math.sin(after * 88) * (1 - span(after, 0, 0.18))
  f.c.save()
  f.c.globalAlpha *= joined
  f.c.translate(f.cx + shake, f.base)
  f.c.scale(squash, 1)
  f.c.drawImage(ink, -line.w / 2, -line.base)
  f.c.restore()
  const flash = span(after, 0, 0.3)
  if (flash > 0 && flash < 1)
    for (const side of [-1, 1]) {
      f.c.save()
      f.c.globalAlpha *= 0.75 * (1 - flash)
      f.c.strokeStyle = f.accent
      f.c.lineWidth = 1.5 * f.u
      f.c.beginPath()
      f.c.arc(f.cx + side * (line.w / 2 - line.px * 0.2), top + line.base - line.px * 0.35, (3 + 12 * ease.out3(flash)) * f.u, 0, Math.PI * 2)
      f.c.stroke()
      f.c.restore()
    }
}

interface TileGrid { rows: number; cols: number; cell: number; x0: number; y0: number; on: { row: number; col: number; jitter: number }[] }
const gridCache = new WeakMap<InkLine, TileGrid>()
function tileGrid(line: InkLine): TileGrid {
  const hit = gridCache.get(line)
  if (hit) return hit
  const a = canvas2d(line.cv).getImageData(0, 0, line.w, line.h).data
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < line.w && y < line.h && a[(y * line.w + x) * 4 + 3]! > 127
  let minX = line.w, minY = line.h, maxX = 0, maxY = 0
  for (let y = 0; y < line.h; y++)
    for (let x = 0; x < line.w; x++)
      if (solid(x, y)) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
  const rows = 14
  const cell = Math.max(1, (maxY - minY + 1) / rows)
  const cols = Math.max(1, Math.ceil((maxX - minX + 1) / cell))
  const x0 = (minX + maxX + 1) / 2 - (cols * cell) / 2
  const on: TileGrid['on'] = []
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      let hits = 0, all = 0
      for (let y = Math.floor(minY + row * cell); y < Math.floor(minY + (row + 1) * cell); y++)
        for (let x = Math.floor(x0 + col * cell); x < Math.floor(x0 + (col + 1) * cell); x++) {
          all++
          if (solid(x, y)) hits++
        }
      if (all > 0 && hits >= all / 2) on.push({ row, col, jitter: noise(row, col + 100) })
    }
  const grid = { rows, cols, cell, x0, y0: minY, on }
  gridCache.set(line, grid)
  return grid
}
const kufiTiles: Move = (f) => {
  const line = inkLine(f.text, f.family, fitPx(f.c, f.text, f.family, 0.41 * f.W, 0.83 * f.W, f.floor))
  const g = tileGrid(line)
  const zoom = Math.min((0.81 * f.W) / (g.cols * g.cell), (0.4 * f.H) / (g.rows * g.cell))
  const cs = g.cell * zoom
  const gw = g.cols * cs
  const gh = g.rows * cs
  const left = f.cx - gw / 2
  const top = 0.4 * f.H - gh / 2
  const sweep = Math.max(0.4, f.enter - 1.45)
  const solidAt = f.enter - 0.6
  const guides = ease.out3(span(f.t, 0, 0.3)) * (1 - span(f.t, 0.3 + sweep, 0.4))
  if (guides > 0) {
    f.c.save()
    f.c.globalAlpha *= 0.3 * guides
    f.c.strokeStyle = f.ink
    f.c.lineWidth = 0.6 * f.u
    f.c.beginPath()
    for (let col = 0; col <= g.cols; col++) {
      f.c.moveTo(left + gw - col * cs, top)
      f.c.lineTo(left + gw - col * cs, top + gh * guides)
    }
    for (let row = 0; row <= g.rows; row++) {
      f.c.moveTo(left + gw, top + row * cs)
      f.c.lineTo(left + gw - gw * guides, top + row * cs)
    }
    f.c.stroke()
    f.c.restore()
  }
  const solid = ease.inOut3(span(f.t, solidAt, 0.4))
  if (solid < 1) {
    f.c.fillStyle = f.accent
    for (const q of g.on) {
      const start = 0.3 + (sweep * (g.cols - 1 - q.col)) / Math.max(1, g.cols) + 0.04 * q.jitter
      const k = span(f.t, start, 0.25)
      if (k <= 0) continue
      const inset = cs * 0.05
      const w = (cs - 2 * inset) * ease.outBack(k)
      const h = (cs - 2 * inset) * (1 - 0.15 * solid)
      f.c.save()
      f.c.globalAlpha *= 1 - solid
      f.c.fillRect(left + q.col * cs + cs / 2 - w / 2, top + q.row * cs + cs / 2 - h / 2, w, h)
      f.c.restore()
    }
  }
  if (solid > 0) {
    f.c.save()
    f.c.globalAlpha *= solid
    f.c.drawImage(tinted(line.cv, f.accent), left - g.x0 * zoom, top - g.y0 * zoom, line.w * zoom, line.h * zoom)
    f.c.restore()
  }
}

const echoStack: Move = (f) => {
  const px = fitPx(f.c, f.text, f.family, Math.min(f.px, 0.155 * f.W), 0.55 * f.W, f.floor)
  const step = 0.82 * px
  const mid = 0.51 * f.H - 0.3 * px
  const drift = -Math.min(18 * f.u, 10 * f.u * Math.max(0, f.t - 0.5))
  for (let row = -3; row <= 3; row++) {
    const d = Math.abs(row)
    const k = ease.outExpo(span(f.t, 0.05 * d, 0.45))
    const y = mid + row * step + drift
    f.c.save()
    f.c.beginPath()
    f.c.rect(0, y - 1.15 * px, f.W, 1.5 * px)
    f.c.clip()
    f.c.globalAlpha *= row === 0 ? 1 : Math.max(0, 1 - 0.2 * d)
    drawLine(f.c, f.text, f.cx, y + 1.2 * px * (1 - k), f.family, px, row === 0 ? f.accent : f.ink, row === 0 ? 0 : 0.75 * f.u)
    f.c.restore()
  }
}

const MOVES: Record<ArabicMove, Move> = {
  'dots-drop': dotsDrop, 'pen-write': penWrite, 'word-melt': wordMelt, unblur, decrypt,
  'redacted-stamp': redactedStamp, 'letters-snap': lettersSnap, 'kufi-tiles': kufiTiles, 'echo-stack': echoStack,
}

/**
 * arabic-move: draws its move into a full-frame canvas as a pure function of local time. Without
 * `cut`, every move leaves the same way: a fade and a small lift over its last moments.
 */
export const arabicMove: Primitive<ArabicMoveParams> = {
  id: 'arabic-move',
  params: arabicMoveParams,
  build(ctx, p) {
    const cv = document.createElement('canvas')
    cv.dataset.mbaPart = 'arabic-move'
    cv.setAttribute('aria-label', p.text)
    cv.width = ctx.size.w
    cv.height = ctx.size.h
    Object.assign(cv.style, { position: 'absolute', left: '0', top: `${(p.dy * ctx.size.h).toFixed(1)}px`, width: `${ctx.size.w}px`, height: `${ctx.size.h}px` })
    ctx.layer.append(cv)
    const c = canvas2d(cv)
    const styles = getComputedStyle(ctx.layer)
    const colour = (v: string) => (v.startsWith('var(') ? styles.getPropertyValue(v.slice(4, -1)).trim() || '#f3efe7' : v)
    const W = ctx.size.w
    const u = W / 270
    const family = ctx.look.fontDisplay
    const floor = p.fitFloor * u
    const px = fitPx(c, p.text, family, 64 * u, 226 * u, floor)
    const enter = arabicMoveEntrance(p)
    const exitLen = arabicMoveExit(p.move)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        c.setTransform(1, 0, 0, 1, 0, 0)
        c.globalAlpha = 1
        c.filter = 'none'
        c.clearRect(0, 0, cv.width, cv.height)
        c.save()
        if (!p.cut) {
          const out = ease.in3(span(t, ctx.duration - exitLen, exitLen * 0.7))
          c.globalAlpha = 1 - out
          c.translate(0, -8 * u * out)
        }
        // Colours are read every frame: a backdrop may switch the world's --mba-fg / --mba-accent.
        MOVES[p.move]({
          c, t, text: p.text, to: p.to ?? p.text, stamp: p.stamp ?? '', family, ink: colour(ctx.look.vars.fg), accent: colour(ctx.look.vars.accent),
          px, W, H: ctx.size.h, u, cx: W / 2, base: 0.535 * ctx.size.h, enter, floor,
        })
        c.restore()
      },
    }
  },
}
