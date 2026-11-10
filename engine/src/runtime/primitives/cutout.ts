import { clamp01, easeInCubic, easeInOutCubic, easeInOutSine, easeOutBack, easeOutCubic, seg } from '../../core/ease'
import { cutoutParams, matteId, orbitRingParams, type CutoutParams, type OrbitRingParams } from '../../core/params/cutout'
import { videoFrameAt } from '../../core/video'
import { FONT_MONO } from '../looks'
import { lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'
import { frameUrl } from './video'

/**
 * `cutout`: the person of a clip, frame-exact, through the matte `mba matte` made (its frames are
 * served as media `<id>.matte`). Both frames are decoded, drawn `cover` into the frame size, and the
 * matte's brightness becomes the person's alpha. A lower track shows through everywhere else, so
 * anything placed below sits behind the person. Pure in `localT`: every frame is recomputed from the
 * two decoded images (no state kept between frames).
 */
async function load(img: HTMLImageElement, url: string): Promise<void> {
  if (img.dataset.url === url) return
  img.src = url
  await img.decode()
  img.dataset.url = url
}

function drawCover(g: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, fit: 'cover' | 'contain') {
  const s = fit === 'cover' ? Math.max(w / img.naturalWidth, h / img.naturalHeight) : Math.min(w / img.naturalWidth, h / img.naturalHeight)
  g.drawImage(img, (w - img.naturalWidth * s) / 2, (h - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s)
}

/** A fixed pseudo-random 0..1 for a pixel (no state, same every frame). */
const hash = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return v - Math.floor(v)
}

/** The frame drawn `cover`, overscanned by `over` around the centre (so a blur never shows an edge). */
function drawOver(g: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, fit: 'cover' | 'contain', over: number) {
  g.save()
  g.translate(w / 2, h / 2)
  g.scale(over, over)
  g.translate(-w / 2, -h / 2)
  drawCover(g, img, w, h, fit)
  g.restore()
}

/**
 * Matte → alpha: the matte is a true soft matte (MODNet), so it is kept soft — only the faint tails
 * are trimmed (below 14 → clear, above 242 → solid). Hair strands stay see-through.
 */
const EDGE = Uint8ClampedArray.from({ length: 256 }, (_, v) => {
  const x = Math.min(1, Math.max(0, (v - 14) / 228))
  return Math.round(255 * x * x * (3 - 2 * x))
})

/** Cards in the grid-zoom carousel, and the slot of the black-and-white card it scrolls to and picks. */
const GRID_CARDS = 7
const PICK_SLOT = -2

/** A code listing the code-body effect writes the frame with (Latin; one entry per line). */
const CODE_LINES = [
  "import { render } from './motion-bilarabi'",
  'const scene = { type: "cutout", mode: "code", fps: 60 }',
  'for (const frame of clip) frame.pixels.map((px) => glyph(px))',
  'export const look = { bg: "#f3efe7", ink: "#16130f" }',
  'await render(storyboard, { dir: "rtl", motionBlur: 3 })',
  'if (matte[i] > 110) person.push(cell); else room.push(cell)',
  'const words = transcript.words.filter((w) => w.at < end)',
  '// letters never break: the whole line is shaped first',
  'kashida.stretch(word, { to: 271, ease: "easy" })',
  'timeline.cut({ at: 7.3, label: "knowledge cutoff" })',
  'search.crawl(results).pick(2).open()',
  'return frames.length === 60 * seconds',
]

/** The room without the person: each row's covered span is filled by blending the room at its two ends. */
function cleanPlate(f: ImageData, w: number, h: number): ImageData {
  const out = new ImageData(new Uint8ClampedArray(f.data), w, h)
  const d = out.data
  const on = (x: number, y: number) => f.data[(y * w + x) * 4 + 3]! > 8
  const PAD = 10
  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      if (!on(x, y)) {
        x++
        continue
      }
      const x0 = Math.max(0, x - PAD)
      while (x < w && on(x, y)) x++
      const x1 = Math.min(w, x + PAD) // past the soft edge of the matte
      x = x1
      const L = x0 > 2 ? x0 - 3 : -1
      const R = x1 < w - 3 ? x1 + 2 : -1
      for (let xx = x0; xx < x1; xx++) {
        const u = x1 === x0 ? 0 : (xx - x0) / (x1 - x0)
        const o = (y * w + xx) * 4
        for (let c = 0; c < 3; c++) {
          const lv = L >= 0 ? f.data[(y * w + L) * 4 + c]! : R >= 0 ? f.data[(y * w + R) * 4 + c]! : y > 0 ? d[o - w * 4 + c]! : f.data[o + c]!
          const rv = R >= 0 ? f.data[(y * w + R) * 4 + c]! : lv
          d[o + c] = lv + (rv - lv) * u
        }
        d[o + 3] = 255
      }
    }
  }
  for (let i = 3; i < d.length; i += 4) d[i] = 255
  return out
}

export const cutout: Primitive<CutoutParams> = {
  id: 'cutout',
  params: cutoutParams,
  build(ctx, p) {
    const { w, h } = ctx.size
    const k = w / 1080
    const view = document.createElement('canvas')
    view.width = w
    view.height = h
    Object.assign(view.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px` })
    ctx.layer.append(view)
    const out = view.getContext('2d')!
    // Work canvases: the clip frame, and the person (the frame with the matte as alpha).
    const mk = () => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      return { c, g: c.getContext('2d', { willReadFrequently: true })! }
    }
    const frame = mk()
    const person = mk()
    const clean = mk()
    const fill = mk()
    const grow = mk()
    const deco = mk()
    const deco2 = mk()
    const bw = mk()
    // grid mode: the cards of the carousel (slot −3..3, the middle one is picked), each a look of the clip.
    const LOOKS = ['none', 'sepia(0.35) contrast(1.1)', 'sepia(0.55) saturate(1.3)', 'saturate(1.6) contrast(1.15)', 'hue-rotate(35deg) saturate(1.3)', 'brightness(1.15) contrast(0.9)', 'grayscale(0.4) sepia(0.3)']
    const gridCards = Array.from({ length: GRID_CARDS }, (_, i) => ({ slot: i - (GRID_CARDS >> 1), look: i - (GRID_CARDS >> 1) === PICK_SLOT ? 'grayscale(1) contrast(1.25)' : LOOKS[i % LOOKS.length]!, j: ctx.rng(), delay: Math.abs(i - (GRID_CARDS >> 1)) * 0.07 + ctx.rng() * 0.05 }))
    const letters = mk()
    // letters mode: the word drawn once, giant, black on clear; the dive pivots on a point inside a letter.
    const word = mk()
    let pivot: { x: number; y: number } | null = null
    const letterPivot = () => {
      if (pivot) return pivot
      word.g.clearRect(0, 0, w, h)
      word.g.fillStyle = '#000'
      word.g.textAlign = 'center'
      word.g.textBaseline = 'middle'
      word.g.direction = 'rtl'
      let fs = Math.round(0.42 * w)
      word.g.font = `900 ${fs}px ${ctx.look.fontDisplay}`
      while (word.g.measureText(p.word).width > w * 0.9 && fs > 40) {
        fs -= 8
        word.g.font = `900 ${fs}px ${ctx.look.fontDisplay}`
      }
      word.g.fillText(p.word, w / 2, h * 0.45)
      // The inked pixel nearest the word's centre: the camera dives into that stroke.
      const d = word.g.getImageData(0, 0, w, h).data
      let best = { x: w / 2, y: h * 0.45, d: Infinity }
      for (let y = Math.round(h * 0.3); y < h * 0.6; y += 4) {
        for (let x = 0; x < w; x += 4) {
          if (d[(y * w + x) * 4 + 3]! < 250) continue
          const dd = (x - w / 2) ** 2 + (y - h * 0.45) ** 2
          if (dd < best.d) best = { x, y, d: dd }
        }
      }
      pivot = { x: best.x, y: best.y }
      return pivot
    }
    // layers mode: the shot split into labelled glass panes in depth (room, you, list, type, sound).
    const layers = p.mode === 'layers' ? buildLayers(ctx, p, view) : null
    // The clean plate from `mba matte` (the real room), drawn once; without it the room is filled in per frame.
    let platePx: ImageData | null = null
    let plateTried = false
    const roomOf = (f: ImageData) => platePx ?? cleanPlate(f, w, h)
    const frameImg = new Image()
    const matteImg = new Image()
    frameImg.decoding = matteImg.decoding = 'sync'
    const mid = matteId(p.media)
    // Seeded clone offsets (one draw each, at build).
    const clones = Array.from({ length: p.clones * 2 }, (_, i) => ({ side: i % 2 ? 1 : -1, rank: Math.floor(i / 2) + 1, j: ctx.rng() }))
    return {
      async update(localT) {
        const n = videoFrameAt(p, Math.max(0, localT), ctx.duration, ctx.fps)
        await Promise.all([load(frameImg, frameUrl(p.media, n)), load(matteImg, frameUrl(mid, n))])
        if (p.plate && !plateTried) {
          plateTried = true
          const pi = new Image()
          pi.decoding = 'sync'
          await load(pi, p.plate)
          const pc = mk()
          drawCover(pc.g, pi, w, h, p.fit)
          platePx = pc.g.getImageData(0, 0, w, h)
        }
        frame.g.clearRect(0, 0, w, h)
        drawCover(frame.g, frameImg, w, h, p.fit)
        // The person: matte brightness → alpha.
        person.g.clearRect(0, 0, w, h)
        drawCover(person.g, matteImg, w, h, p.fit)
        const m = person.g.getImageData(0, 0, w, h)
        const f = frame.g.getImageData(0, 0, w, h)
        for (let i = 0; i < m.data.length; i += 4) {
          f.data[i + 3] = EDGE[m.data[i]!]!
        }
        person.g.putImageData(f, 0, 0)
        // Colour decontamination: a see-through edge pixel still carries the room's colour (a light
        // or dark fringe in the hair). Its colour is replaced by the person's own colour nearby: the
        // solid core of the cut-out (alpha ≥ 235) blurred — premultiplied, so only the person counts.
        const core = new ImageData(new Uint8ClampedArray(f.data), w, h)
        for (let i = 3; i < core.data.length; i += 4) if (core.data[i]! < 235) core.data[i] = 0
        deco.g.putImageData(core, 0, 0)
        deco2.g.clearRect(0, 0, w, h)
        deco2.g.filter = `blur(${(10 * k).toFixed(1)}px)`
        deco2.g.drawImage(deco.c, 0, 0)
        deco2.g.filter = 'none'
        const near = deco2.g.getImageData(0, 0, w, h).data
        // The room behind each pixel (the clean plate) solves the compositing equation
        // I = a·F + (1 − a)·B for the person's true colour F; faint pixels lean on the core colour.
        const room = roomOf(f).data
        let touched = false
        for (let i = 0; i < f.data.length; i += 4) {
          const a8 = f.data[i + 3]!
          if (a8 === 0 || a8 >= 250) continue
          const a = a8 / 255
          const trust = Math.min(1, Math.max(0, (a - 0.12) / 0.45))
          const hasCore = near[i + 3]! >= 4
          for (let c = 0; c < 3; c++) {
            const solved = Math.min(255, Math.max(0, (f.data[i + c]! - (1 - a) * room[i + c]!) / Math.max(a, 0.12)))
            const fallback = hasCore ? near[i + c]! : solved
            f.data[i + c] = fallback + (solved - fallback) * trust
          }
          touched = true
        }
        if (touched) person.g.putImageData(f, 0, 0)
        const t = Math.max(0, localT)
        const e = easeOutCubic(seg(t, p.at, p.at + p.dur))
        if (layers) {
          clean.g.putImageData(roomOf(f), 0, 0)
          layers.draw(t, clean.c, person.c)
          return
        }
        out.clearRect(0, 0, w, h)
        if (p.background === 'blur') {
          // Back focus: the room itself, only blurred — from the clean plate (the room without the
          // person), so no blurred ghost of the person halos around them. Overscanned a hair so the
          // blur never pulls in an edge.
          clean.g.putImageData(roomOf(f), 0, 0)
          out.save()
          out.filter = `blur(${(p.blur * k * e).toFixed(2)}px)`
          const over = 1 + 0.03 * e
          out.translate(w / 2, h / 2)
          out.scale(over, over)
          out.translate(-w / 2, -h / 2)
          out.drawImage(e > 0 ? clean.c : frame.c, 0, 0)
          out.restore()
        } else if (p.background === 'clean') {
          // The room without the person (blow away leaves the room behind): the shot as it is, and
          // over the person's place the room filled in from either side of each row, softened.
          clean.g.putImageData(roomOf(f), 0, 0)
          drawCover(out, frameImg, w, h, p.fit)
          fill.g.clearRect(0, 0, w, h)
          fill.g.filter = `blur(${(22 * k).toFixed(1)}px)`
          fill.g.drawImage(clean.c, 0, 0)
          fill.g.filter = 'none'
          // A grown mask: the matte blurred and stacked, so it covers the person's soft outline too.
          grow.g.clearRect(0, 0, w, h)
          grow.g.filter = `blur(${(14 * k).toFixed(1)}px)`
          for (let i = 0; i < 4; i++) grow.g.drawImage(person.c, 0, 0)
          grow.g.filter = 'none'
          fill.g.globalCompositeOperation = 'destination-in'
          fill.g.drawImage(grow.c, 0, 0)
          fill.g.globalCompositeOperation = 'source-over'
          out.drawImage(fill.c, 0, 0)
          if (p.dolly) {
            // Dolly zoom: the empty room scales about the frame centre; the person is drawn over it unscaled.
            const k2 = easeInOutSine(Math.min(1, t / Math.max(0.01, ctx.duration)))
            const s = p.dolly[0] + (p.dolly[1] - p.dolly[0]) * k2
            clean.g.clearRect(0, 0, w, h)
            clean.g.drawImage(out.canvas, 0, 0)
            out.clearRect(0, 0, w, h)
            out.drawImage(clean.c, (w - w * s) / 2, (h - h * s) / 2, w * s, h * s)
          }
        }
        if (p.mode === 'clones') {
          // A clone row: copies slide out from behind the person to both sides, smaller with
          // each rank, fully visible, far ranks drawn first, each lifted off the room by a shadow.
          // The top of the person's head (first matte row with real coverage), so the copies' heads line up.
          let top = 0
          for (let y = 0; y < h && !top; y += 4) {
            let run = 0
            for (let x = 0; x < w; x += 4) if (f.data[(y * w + x) * 4 + 3]! > 160) run++
            if (run > 6) top = y
          }
          for (const c of [...clones].sort((a, b) => b.rank - a.rank)) {
            const start = p.at + (c.rank - 1) * 0.1 + c.j * 0.04
            const pop = seg(t, start, start + 0.45)
            if (pop <= 0) continue
            const e2 = easeOutBack(pop, 1.4)
            const sc = 0.58 - 0.12 * (c.rank - 1)
            const off = (0.31 + 0.16 * (c.rank - 1)) * w
            // The copy's head sits a little below the person's (further back), its body behind them.
            const anchor = top + 0.035 * h * c.rank + sc * (h - top)
            out.save()
            out.globalAlpha = Math.min(1, pop * 3)
            // Depth: each rank further back is a little softer and darker.
            out.filter = `drop-shadow(0 ${(10 * k).toFixed(1)}px ${(16 * k).toFixed(1)}px rgba(0,0,0,0.4)) brightness(${(1 - 0.08 * c.rank).toFixed(3)})`
            out.translate(w / 2 + c.side * off * e2, anchor)
            out.scale(sc, sc)
            out.drawImage(person.c, -w / 2, -h)
            out.restore()
          }
          out.save()
          out.filter = `drop-shadow(0 ${(12 * k).toFixed(1)}px ${(18 * k).toFixed(1)}px rgba(0,0,0,0.4))`
          out.drawImage(person.c, 0, 0)
          out.restore()
        } else if (p.mode === 'code') {
          // The whole frame turns into code. Above a scan line sweeping down, every cell becomes a
          // character of a code listing: the room in faint grey-green lines, the person in their own
          // colours, brighter where they are bright. Below the line, the clip is untouched.
          const reach = e * h * 1.04
          drawCover(out, frameImg, w, h, p.fit)
          out.save()
          out.beginPath()
          out.rect(0, 0, w, reach)
          out.clip()
          out.fillStyle = '#0a0d0b'
          out.fillRect(0, 0, w, reach)
          const cell = Math.round(17 * k)
          const colW = cell * 0.6
          out.font = `700 ${cell}px ${FONT_MONO}`
          out.textBaseline = 'top'
          const px = f.data
          const cols = Math.ceil(w / colW)
          for (let row = 0, y = 0; y < Math.min(h, reach); row++, y += cell) {
            // Each row reads as a line of code; a few rows scroll as if being typed.
            const line = CODE_LINES[(row + Math.floor(hash(row, 3) * 40)) % CODE_LINES.length]!
            const shift = hash(row, 9) < 0.18 ? Math.floor(t * 14) : 0
            for (let c = 0; c < cols; c++) {
              const x = c * colW
              const ch = line[(c + shift) % line.length]!
              if (ch === ' ') continue
              const sx = Math.min(w - 1, Math.round(x + colW / 2))
              const i = (Math.min(h - 1, y + (cell >> 1)) * w + sx) * 4
              const l = (0.3 * px[i]! + 0.59 * px[i + 1]! + 0.11 * px[i + 2]!) / 255
              if (px[i + 3]! > 110) {
                const b = 0.8 + 0.55 * l
                out.fillStyle = `rgb(${Math.min(255, Math.round(px[i]! * b + 30))},${Math.min(255, Math.round(px[i + 1]! * b + 30))},${Math.min(255, Math.round(px[i + 2]! * b + 30))})`
              } else out.fillStyle = `rgba(150,175,158,${(0.08 + 0.32 * l).toFixed(3)})`
              out.fillText(ch, x, y)
            }
          }
          out.restore()
          if (e > 0 && e < 1) {
            out.save()
            out.fillStyle = '#d9ffe6'
            out.shadowColor = '#5cffa0'
            out.shadowBlur = 22 * k
            out.fillRect(0, reach - 2 * k, w, 3 * k)
            out.restore()
          }
        } else if (p.mode === 'grid') {
          // Grid zoom: a carousel of video cards flies in above the head, a cursor picks the middle
          // one, it drops onto the face and becomes a glowing lens, and the lens opens to fill the
          // frame — inside it the whole scene in black and white.
          drawCover(out, frameImg, w, h, p.fit)
          // Where the face is (from the matte): the head's top and the centre of its first rows.
          let top = 0
          for (let y = 0; y < h && !top; y += 4) {
            let run = 0
            for (let x = 0; x < w; x += 4) if (f.data[(y * w + x) * 4 + 3]! > 160) run++
            if (run > 6) top = y
          }
          let sx = 0
          let sn = 0
          for (let y = top; y < Math.min(h, top + 0.06 * h); y += 6) {
            for (let x = 0; x < w; x += 6) {
              if (f.data[(y * w + x) * 4 + 3]! > 160) {
                sx += x
                sn++
              }
            }
          }
          const face = { x: sn ? sx / sn : w / 2, y: top + 0.1 * h }
          const cw = 0.25 * w
          const ch = cw * 1.65
          const rowY = Math.max(ch * 0.62, top - ch * 0.55)
          const tIn = p.at
          const pickAt = p.at + p.pick
          const zoomAt = p.at + p.zoom
          const lensR = 0.075 * w
          // The carousel: cards along an arc, the middle one nearest; it drifts sideways slowly.
          // The carousel scrolls until the black-and-white card (the look about to be applied)
          // sits in the middle; that is the card the cursor picks.
          const scroll = PICK_SLOT * easeInOutCubic(seg(t, tIn + 0.55, pickAt - 0.2))
          const posOf = (c: { slot: number }) => c.slot - scroll
          for (const c of [...gridCards].sort((a, b) => Math.abs(posOf(b)) - Math.abs(posOf(a)))) {
            const isPick = c.slot === PICK_SLOT
            const pos = posOf(c)
            const inE = easeOutBack(seg(t, tIn + c.delay, tIn + c.delay + 0.55), 1.2)
            if (inE <= 0) continue
            const fall = isPick ? easeInCubic(seg(t, pickAt + 0.15, zoomAt - 0.1)) : 0
            const leave = 1 - seg(t, zoomAt - 0.1, zoomAt + 0.3)
            if (!isPick && leave <= 0) continue
            if (isPick && fall >= 1) continue
            const depth = 1 - Math.min(1, Math.abs(pos) * 0.22)
            const x0 = w / 2 + pos * cw * 0.95
            const y0 = rowY + Math.abs(pos) * ch * 0.06 - (1 - inE) * h * 0.25
            const x = x0 + (face.x - x0) * fall
            const y = y0 + (face.y - y0) * fall
            const sc = (0.55 + 0.45 * depth) * (isPick && t >= pickAt ? 1 + 0.1 * Math.sin(Math.PI * seg(t, pickAt, pickAt + 0.25)) : 1) * (1 - 0.55 * fall)
            out.save()
            out.globalAlpha = Math.min(1, inE * 1.5) * (isPick ? 1 : leave) * (0.55 + 0.45 * depth)
            out.translate(x, y)
            out.transform(1, 0, pos * -0.04, 1, 0, 0)
            out.rotate(pos * 0.06)
            out.scale(sc, sc)
            out.filter = `drop-shadow(0 ${(16 * k).toFixed(1)}px ${(26 * k).toFixed(1)}px rgba(0,0,0,0.45))${Math.abs(pos) > 1 ? ` blur(${(1.2 * k).toFixed(1)}px)` : ''}`
            out.beginPath()
            out.roundRect(-cw / 2, -ch / 2, cw, ch, 18 * k)
            out.fillStyle = '#111'
            out.fill()
            out.clip()
            out.filter = c.look
            const s0 = Math.max(cw / frameImg.naturalWidth, ch / frameImg.naturalHeight) * 1.15
            out.drawImage(frameImg, -frameImg.naturalWidth * s0 / 2, -frameImg.naturalHeight * s0 / 2 + ch * 0.06, frameImg.naturalWidth * s0, frameImg.naturalHeight * s0)
            out.filter = 'none'
            out.fillStyle = 'rgba(0,0,0,0.35)'
            out.fillRect(-cw / 2, -ch / 2, cw, ch * 0.18)
            out.fillStyle = 'rgba(255,255,255,0.9)'
            out.fillRect(-cw * 0.38, -ch * 0.44, cw * (0.35 + 0.35 * c.j), 5 * k)
            out.fillRect(-cw * 0.38, -ch * 0.4, cw * 0.3, 5 * k)
            out.restore()
            if (isPick && t >= pickAt - 0.05 && fall < 1) {
              out.save()
              out.strokeStyle = '#fff'
              out.lineWidth = 6 * k
              out.translate(x, y)
              out.rotate(pos * 0.06)
              out.scale(sc, sc)
              out.beginPath()
              out.roundRect(-cw / 2, -ch / 2, cw, ch, 18 * k)
              out.stroke()
              out.restore()
            }
          }
          // The cursor glides to the middle card and clicks.
          const cur = seg(t, tIn + 0.5, pickAt)
          if (t >= tIn + 0.5 && t < zoomAt) {
            const cx = w * 0.85 + (w / 2 + cw * 0.15 - w * 0.85) * easeOutCubic(cur)
            const cy = h * 0.55 + (rowY + ch * 0.15 - h * 0.55) * easeOutCubic(cur)
            const press = 1 - 0.15 * Math.sin(Math.PI * seg(t, pickAt - 0.05, pickAt + 0.15))
            out.save()
            out.translate(cx, cy)
            out.scale(press * 1.6 * k, press * 1.6 * k)
            out.fillStyle = '#fff'
            out.strokeStyle = '#111'
            out.lineWidth = 1.6
            out.beginPath()
            out.moveTo(0, 0)
            out.lineTo(0, 22)
            out.lineTo(6, 16.5)
            out.lineTo(10, 25)
            out.lineTo(13.5, 23.5)
            out.lineTo(9.6, 15.2)
            out.lineTo(17, 15)
            out.closePath()
            out.fill()
            out.stroke()
            out.restore()
          }
          // The lens: born where the card lands, then it opens past the frame's corners.
          const born = seg(t, zoomAt - 0.15, zoomAt + 0.2)
          if (born > 0) {
            const open = easeInCubic(seg(t, zoomAt + 0.35, zoomAt + 1.0))
            const R = lensR * easeOutBack(born, 1.6) + open * Math.hypot(w, h)
            // Inside the lens: the whole scene in black and white.
            bw.g.filter = 'grayscale(1) contrast(1.2)'
            drawCover(bw.g, frameImg, w, h, p.fit)
            bw.g.filter = 'none'
            out.save()
            out.beginPath()
            out.arc(face.x, face.y, R, 0, Math.PI * 2)
            out.clip()
            out.drawImage(bw.c, 0, 0)
            out.restore()
            if (open < 1) {
              out.save()
              out.strokeStyle = 'rgba(255,255,255,0.95)'
              out.lineWidth = 5 * k
              out.shadowColor = '#fff'
              out.shadowBlur = 26 * k
              out.beginPath()
              out.arc(face.x, face.y, R, 0, Math.PI * 2)
              out.stroke()
              out.restore()
            }
          }
        } else if (p.mode === 'letters') {
          // Letter dive: cream paper, a giant word with the clip playing inside its letters; the
          // camera dives into one letter until the clip fills the frame.
          const dive = seg(t, p.at, p.at + p.dur)
          const zoom = dive <= 0 ? 1 + 0.03 * seg(t, 0, p.at) : Math.exp(easeInCubic(dive) * Math.log(18))
          if (zoom > 16) {
            drawCover(out, frameImg, w, h, p.fit)
          } else {
            const pv = letterPivot()
            letters.g.setTransform(1, 0, 0, 1, 0, 0)
            letters.g.clearRect(0, 0, w, h)
            letters.g.globalCompositeOperation = 'source-over'
            letters.g.translate(pv.x, pv.y)
            letters.g.scale(zoom, zoom)
            letters.g.translate(-pv.x, -pv.y)
            letters.g.drawImage(word.c, 0, 0)
            letters.g.setTransform(1, 0, 0, 1, 0, 0)
            letters.g.globalCompositeOperation = 'source-in'
            drawCover(letters.g, frameImg, w, h, p.fit)
            letters.g.globalCompositeOperation = 'source-over'
            out.fillStyle = '#efe9dc'
            out.fillRect(0, 0, w, h)
            out.drawImage(letters.c, 0, 0)
          }
        } else if (p.mode === 'dust') {
          // The person blows away right to left. Pixels the sweep has not reached are the person
          // image itself; near and past the sweep each pixel is a grain of jittered size and place.
          const step = Math.max(2, Math.round(3 * k))
          const S = seg(t, p.at, p.at + p.dur * 2.2) * 1.556
          const xb = Math.max(0, Math.min(w, w * (1 - S) - 2 * step))
          out.save()
          out.beginPath()
          out.rect(0, 0, xb, h)
          out.clip()
          out.drawImage(person.c, 0, 0)
          out.restore()
          const px = f.data
          for (let y = 0; y < h; y += step) {
            for (let x = Math.floor(xb / step) * step; x < w; x += step) {
              const i = (y * w + x) * 4
              if (px[i + 3]! < 90) continue
              const n1 = hash(x, y)
              const n2 = hash(y + 7, x + 3)
              const leave = 1 - x / w + n1 * 0.25
              const age = (S * 0.9 - leave * 0.9) / 0.5
              if (age >= 1) continue
              const a = clamp01(age)
              const drift = easeInCubic(a)
              const gx = x + (n1 - 0.5) * step * (a > 0 ? 1.5 : 0.6) - drift * w * (0.45 + 0.35 * n2)
              const gy = y + (n2 - 0.5) * step * (a > 0 ? 1.5 : 0.6) - drift * h * (0.12 + 0.2 * n1) + Math.sin(y * 0.05 + a * 6) * a * 28 * k
              const size = step * (a > 0 ? 0.6 + 1.1 * n2 * (1 - a * 0.5) : 1.25)
              out.globalAlpha = (1 - a) * (px[i + 3]! / 255)
              out.fillStyle = `rgb(${px[i]},${px[i + 1]},${px[i + 2]})`
              out.fillRect(gx, gy, size, size)
            }
          }
          out.globalAlpha = 1
        } else out.drawImage(person.c, 0, 0)
      },
    }
  },
}

/** orbit-ring: words circling a point on a tilted ellipse; `half` draws only the back or front of it. */
export const orbitRing: Primitive<OrbitRingParams> = {
  id: 'orbit-ring',
  params: orbitRingParams,
  build(ctx, p) {
    const c = safePointPx(ctx, p.place)
    const R = p.radius * ctx.safe.w
    const fs = Math.round(p.size * ctx.safe.w)
    // The ring itself: a thin glowing ellipse, only its own half (back = the upper arc, front = the lower).
    const SVGNS = 'http://www.w3.org/2000/svg'
    const ringSvg = document.createElementNS(SVGNS, 'svg')
    ringSvg.setAttribute('viewBox', `0 0 ${ctx.size.w} ${ctx.size.h}`)
    Object.assign(ringSvg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' })
    const arc = document.createElementNS(SVGNS, 'path')
    arc.setAttribute('fill', 'none')
    arc.style.stroke = ctx.look.vars.accent
    arc.setAttribute('stroke-width', String(Math.max(2, 3 * (ctx.size.w / 1080))))
    arc.setAttribute('stroke-linecap', 'round')
    arc.style.filter = 'drop-shadow(0 0 6px #ff5a1f)'
    ringSvg.append(arc)
    ctx.layer.append(ringSvg)
    const words = p.words.map((wd, i) => {
      const el = document.createElement('div')
      el.dataset.mbaPart = 'orbit-word'
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${fs}px`, color: ctx.look.vars.accent, whiteSpace: 'nowrap', textShadow: '0 4px 18px #0007' })
      lineUnit(el, wd)
      ctx.layer.append(el)
      return { el, a0: (i / p.words.length) * Math.PI * 2 }
    })
    return {
      update(localT) {
        const t = Math.max(0, localT - p.at)
        const open = easeOutCubic(seg(t, 0, 0.6))
        const rx = R * open
        const ry = R * p.tilt * open
        const sweep = p.half === 'front' ? 0 : 1
        const half = (s2: number) => `M ${(c.x - rx).toFixed(2)} ${c.y.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 0 ${s2} ${(c.x + rx).toFixed(2)} ${c.y.toFixed(2)}`
        arc.setAttribute('d', open > 0 ? (p.half === 'both' ? `${half(1)} ${half(0)}` : half(sweep)) : '')
        arc.style.opacity = p.half === 'back' ? '0.55' : '0.95'
        for (const wd of words) {
          const a = wd.a0 + t * p.speed * Math.PI * 2
          const depth = Math.sin(a) // > 0: in front
          const show = p.half === 'both' || (p.half === 'front' ? depth >= 0 : depth < 0)
          wd.el.style.display = show && open > 0 ? '' : 'none'
          if (!show) continue
          const x = c.x + Math.cos(a) * R * open
          const y = c.y + depth * R * p.tilt * open
          const s = 0.72 + 0.34 * (depth + 1) / 2
          const rot = -Math.cos(a) * 14 * p.tilt
          wd.el.style.transform = `translate(${x.toFixed(3)}px, ${y.toFixed(3)}px) translate(-50%, -50%) rotate(${rot.toFixed(3)}deg) scale(${(s * open).toFixed(4)})`
          wd.el.style.opacity = (0.55 + 0.45 * (depth + 1) / 2).toFixed(4)
          // Depth of field: words behind the person go soft.
          wd.el.style.filter = depth < 0 ? `blur(${(1.6 * -depth).toFixed(2)}px)` : ''
        }
      },
    }
  },
}

/**
 * layers mode: five full-frame panes in a 3D rig — the room (clean plate), you (the cut-out), the
 * effect list, the type and the sound. Flat they compose the plain shot; from `at` over `dur` they
 * pull apart in depth and turn to show their edges and labels, then fold back over the last 0.55 s.
 */
function buildLayers(ctx: Parameters<Primitive<CutoutParams>['build']>[0], p: CutoutParams, view: HTMLCanvasElement) {
  const { w, h } = ctx.size
  const k = w / 1080
  view.style.display = 'none'
  const stage = document.createElement('div')
  Object.assign(stage.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#0e1311', perspective: `${Math.round(2300 * k)}px`, perspectiveOrigin: '50% 46%' })
  const rig = document.createElement('div')
  Object.assign(rig.style, { position: 'absolute', inset: '0', transformStyle: 'preserve-3d' })
  stage.append(rig)
  ctx.layer.append(stage)
  const pane = (label: string, z: number, withCanvas: boolean) => {
    const d = document.createElement('div')
    Object.assign(d.style, { position: 'absolute', inset: '0', boxSizing: 'border-box', borderRadius: `${Math.round(10 * k)}px` })
    let g: CanvasRenderingContext2D | null = null
    if (withCanvas) {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      Object.assign(c.style, { position: 'absolute', inset: '0', width: `${w}px`, height: `${h}px` })
      d.append(c)
      g = c.getContext('2d')!
    }
    const tag = document.createElement('div')
    Object.assign(tag.style, { position: 'absolute', top: `${Math.round(26 * k)}px`, right: `${Math.round(30 * k)}px`, fontFamily: FONT_MONO, fontWeight: "700", fontSize: `${Math.round(40 * k)}px`, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.88)', direction: 'rtl', whiteSpace: 'nowrap' })
    lineUnit(tag, label)
    d.append(tag)
    rig.append(d)
    return { d, tag, z, g }
  }
  const room = pane('الخلفية · ROOM', -430, true)
  const me = pane('إنت · ME', -160, true)
  // The list pane: a dark panel of effect names, one lit.
  const list = pane('المؤثرات · LIST', 70, false)
  const panel = document.createElement('div')
  Object.assign(panel.style, { position: 'absolute', left: `${Math.round(60 * k)}px`, top: `${Math.round(270 * k)}px`, width: `${Math.round(330 * k)}px`, padding: `${Math.round(22 * k)}px`, boxSizing: 'border-box', background: 'rgba(16,40,30,0.94)', borderRadius: `${Math.round(18 * k)}px`, direction: 'rtl', fontFamily: ctx.look.fontBody, color: '#e8efe9' })
  const ttl = document.createElement('div')
  Object.assign(ttl.style, { fontSize: `${Math.round(22 * k)}px`, opacity: '0.7', marginBottom: `${Math.round(12 * k)}px` })
  lineUnit(ttl, 'بهذا الفيديو')
  panel.append(ttl)
  p.items.forEach((it, i) => {
    const row = document.createElement('div')
    const on = i === p.lit
    Object.assign(row.style, { fontSize: `${Math.round(30 * k)}px`, fontWeight: on ? '800' : '500', padding: `${Math.round(6 * k)}px ${Math.round(12 * k)}px`, borderRadius: `${Math.round(8 * k)}px`, background: on ? '#ffffff' : 'transparent', color: on ? '#10281e' : i < p.lit ? '#e8efe9' : 'rgba(232,239,233,0.5)' })
    lineUnit(row, it)
    panel.append(row)
  })
  list.d.append(panel)
  // The type pane: the scene's word, big, in the display face.
  const type = pane('النص · TYPE', 220, false)
  const word = document.createElement('div')
  Object.assign(word.style, { position: 'absolute', left: '0', right: '0', top: `${Math.round(h * 0.12)}px`, textAlign: 'center', fontFamily: ctx.look.fontDisplay, fontWeight: '900', fontSize: `${Math.round(200 * k)}px`, color: '#ffffff', textShadow: `0 ${Math.round(6 * k)}px ${Math.round(30 * k)}px rgba(0,0,0,0.45)` })
  lineUnit(word, p.word)
  type.d.append(word)
  // The sound pane: a waveform across the lower third, the played part in the accent colour.
  const sound = pane('الصوت · SOUND', 400, true)
  const bars = Array.from({ length: 64 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.43)) * (0.6 + 0.4 * ctx.rng()))
  const panes = [room, me, list, type, sound]
  const accentVar = ctx.look.vars.accent
  const accent = accentVar.startsWith('var(') ? getComputedStyle(ctx.layer).getPropertyValue(accentVar.slice(4, -1)).trim() || '#ff5a1f' : accentVar
  return {
    draw(t: number, cleanRoom: HTMLCanvasElement, personCanvas: HTMLCanvasElement) {
      const open = easeInOutCubic(seg(t, p.at, p.at + p.dur))
      const close = easeInOutCubic(seg(t, ctx.duration - 0.55, ctx.duration - 0.05))
      const e = open * (1 - close)
      room.g!.clearRect(0, 0, w, h)
      room.g!.drawImage(cleanRoom, 0, 0)
      me.g!.clearRect(0, 0, w, h)
      me.g!.drawImage(personCanvas, 0, 0)
      // Sound: the bars breathe with time; the played share grows.
      const sg = sound.g!
      sg.clearRect(0, 0, w, h)
      const bw = (w * 0.84) / bars.length
      const played = Math.min(1, t / Math.max(0.5, ctx.duration))
      bars.forEach((b, i) => {
        const amp = b * (0.7 + 0.3 * Math.sin(t * 9 + i * 0.8))
        const bh = amp * h * 0.11
        sg.fillStyle = i / bars.length < played ? accent : 'rgba(255,255,255,0.92)'
        sg.fillRect(w * 0.08 + i * bw, h * 0.76 - bh / 2, Math.max(2, bw * 0.55), bh)
      })
      rig.style.transform = `translateZ(${(-560 * k * e).toFixed(1)}px) rotateY(${(-38 * e).toFixed(2)}deg) rotateX(${(4 * e).toFixed(2)}deg)`
      panes.forEach((q, i) => {
        q.d.style.transform = `translateZ(${(q.z * k * e).toFixed(1)}px)`
        q.d.style.outline = e > 0.001 ? `${Math.max(1, Math.round(3 * k))}px solid rgba(255,255,255,${(0.6 * e).toFixed(3)})` : 'none'
        q.d.style.background = i >= 2 && e > 0.001 ? `rgba(255,255,255,${(0.05 * e).toFixed(3)})` : 'transparent'
        q.tag.style.opacity = e.toFixed(3)
        // List, type and sound exist only while the shot is apart.
        if (i >= 2) q.d.style.opacity = Math.min(1, e * 1.6).toFixed(3)
      })
    },
  }
}
