/**
 * Everyday objects for any creator's topic (not tied to one reel): a camera, a heart, a star, a
 * video player, a shopping cart, an open book, a megaphone and a rocket. Same morph contract as
 * `objects.ts`: a 240-point outline centred on (0, 0), starting at top-centre, running clockwise;
 * sizes in units of `size` (the object's width, or its height for the rocket).
 */
import { resample, roundRect, type Pt } from './morph'

export const EVERYDAY_IDS = ['camera', 'heart', 'star', 'play', 'cart', 'book', 'megaphone', 'rocket'] as const
export type EverydayId = (typeof EVERYDAY_IDS)[number]

/** Boxes (w × h of the size) and the few numbers the drawings share with the outlines. */
export const EVERYDAY_GEOMETRY = {
  /** A camera body with the viewfinder hump on top; the lens is a detail. */
  camera: { w: 1, h: 0.74, body: { top: -0.23, r: 0.07 }, hump: { w: 0.36, top: -0.37 }, lens: { y: 0.07, r: 0.21 } },
  heart: { w: 1, h: 0.9 },
  /** A five-point star: the inner radius as a share of the outer. */
  star: { w: 1, h: 0.96, inner: 0.44 },
  /** A video player card. */
  play: { w: 1.3, h: 0.8, r: 0.08 },
  /** The basket of a shopping cart (the handle and the wheels are details outside the outline). */
  cart: { w: 1, h: 0.51, top: -0.31, bottom: 0.2, inset: 0.16 },
  /** An open book: the spine dips at the top and the bottom. */
  book: { w: 1.3, h: 0.84, dip: 0.07 },
  /** A megaphone facing the reading direction (its bell on the left). */
  megaphone: { w: 1.1, h: 0.8, bell: 0.4, neck: 0.13, grip: { x: 0.3, w: 0.1 } },
  /** A rocket standing up; its height is the size. */
  rocket: { w: 0.62, h: 1, body: 0.17, fin: 0.31, nose: -0.5, base: 0.36 },
} as const

const scale = (pts: Pt[], size: number): Pt[] => resample(pts.map(([x, y]) => [x * size, y * size] as Pt))
/** Right-half points mirrored to the left (the half starts at top-centre and ends at bottom-centre). */
const mirror = (half: Pt[]): Pt[] => [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as Pt)]
/** Points of a quarter turn of radius r around (cx, cy) from angle a0 (radians, clockwise on screen). */
const arc = (cx: number, cy: number, r: number, a0: number, turn = Math.PI / 2, n = 6): Pt[] => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(a0 + (turn * i) / n), cy + r * Math.sin(a0 + (turn * i) / n)] as Pt)

/** The heart curve in a unit box (width 1), centred. */
export function heartUnit(n = 120): Pt[] {
  const raw = Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2
    return [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))] as Pt
  })
  const ys = raw.map((p) => p[1])
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2
  return raw.map(([x, y]) => [x / 32, (y - mid) / 32] as Pt)
}

export function everydayOutline(id: EverydayId, size: number): Pt[] {
  const G = EVERYDAY_GEOMETRY
  switch (id) {
    case 'camera': {
      const g = G.camera
      const W = g.w / 2, bottom = g.h / 2, r = g.body.r, hw = g.hump.w / 2
      return scale(mirror([[0, g.hump.top], [hw - 0.04, g.hump.top], [hw + 0.03, g.body.top], ...arc(W - r, g.body.top + r, r, -Math.PI / 2), ...arc(W - r, bottom - r, r, 0), [0, bottom]]), size)
    }
    case 'heart':
      return scale(heartUnit(), size)
    case 'star': {
      const R = 0.5, r = R * G.star.inner
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const rad = i % 2 ? r : R
        return [rad * Math.cos(a), rad * Math.sin(a) + 0.02] as Pt
      })
      return scale(pts, size)
    }
    case 'play':
      return roundRect(0, 0, G.play.w * size, G.play.h * size, G.play.r * size)
    case 'cart': {
      const g = G.cart
      const W = g.w / 2
      return scale(mirror([[0, g.top], [W - 0.03, g.top], [W, g.top + 0.03], [W - g.inset, g.bottom - 0.03], [W - g.inset - 0.03, g.bottom], [0, g.bottom]]), size)
    }
    case 'book': {
      const g = G.book
      const W = g.w / 2, H = g.h / 2
      const top: Pt[] = Array.from({ length: 9 }, (_, i) => {
        const u = i / 8
        return [u * W, -H + g.dip * (1 - Math.sin((u * Math.PI) / 2)) + 0.03 * Math.sin(u * Math.PI)] as Pt
      })
      const bottom: Pt[] = Array.from({ length: 9 }, (_, i) => {
        const u = 1 - i / 8
        return [u * W, H - g.dip * Math.sin((u * Math.PI) / 2) + g.dip - 0.03 * Math.sin(u * Math.PI)] as Pt
      })
      return scale(mirror([...top, ...bottom]), size)
    }
    case 'megaphone': {
      const g = G.megaphone
      const W = g.w / 2
      // Clockwise from top-centre: along the cone's top edge to the grip on the right, around it, back along the bottom to the bell's rim on the left.
      return scale([[0, -0.24], [g.grip.x, -g.neck], [g.grip.x + g.grip.w, -g.neck], [W, -g.neck + 0.02], [W, g.neck - 0.02], [g.grip.x + g.grip.w, g.neck], [g.grip.x, g.neck], [0, 0.24], [-W + 0.05, g.bell], [-W, g.bell - 0.03], [-W, -g.bell + 0.03], [-W + 0.05, -g.bell]], size)
    }
    case 'rocket': {
      const g = G.rocket
      const nose: Pt[] = Array.from({ length: 9 }, (_, i) => {
        const u = i / 8
        return [g.body * Math.sin((u * Math.PI) / 2), g.nose + 0.3 * (1 - Math.cos((u * Math.PI) / 2))] as Pt
      })
      return scale(mirror([...nose, [g.body, 0.12], [g.fin, 0.44], [g.fin, 0.5], [g.body, g.base + 0.06], [g.body * 0.6, g.base + 0.06], [g.body * 0.6, g.base + 0.1], [0, g.base + 0.1]]), size)
    }
  }
}

/** Seconds after arrival of each object's own moment (the shutter, the pulse, the sparkle, the press, the drop, the page, the shout, the ignition). */
export const EVERYDAY_BEAT = 0.5
