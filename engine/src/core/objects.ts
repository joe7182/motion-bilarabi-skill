/**
 * The morphable objects, as 240-point outlines centred on (0, 0), starting at top-centre and
 * running clockwise (the morph contract).
 * `size` is the diameter (round objects), the width (bar, document) or the height (microphone);
 * the timeline window is 1.5 × 0.9 of it. Task 6c script objects: the calendar page is 1 × 1.1,
 * the envelope 1.4 × 0.9, the bell 0.7 × 0.72 (its sticky notes fill the rest of the size), the
 * voice-note bubble 1.5 × 0.42 and the phone 0.56 × 1.1 of it. Stage 1A (the house reel): the brick
 * is 1 × 0.62, the house 1 × 0.9, the blueprint sheet 1 × 1.28, the eye 1 × 0.56, the photo
 * 0.9 × 1.08 and the chat panel 1.4 × 1 of it. Stage 2 (the cost and sun sections): the balance
 * scale is 1.2 × 1, the materials grid 1.1 × 1, the sun a disc (size = diameter), the cutaway room
 * 1.2 × 0.9, the map tile 1 × 1, the window's wall section 0.9 × 1.1, the sun-path dome 1.2 × 1 and
 * the file 0.8 × 1 of it. Video 2 (the hook and «مهمتي»): the three engineers in hard hats are
 * 1.3 × 1, the bulb 0.62 × 1, the AI chip's board 1 × 1, the gear-and-wrench tool a disc (size =
 * diameter), the results card under the magnifier 1.2 × 1, the profile card 1.3 × 0.8, the compass a
 * disc and the purchase-order slip 0.75 × 1.1 of it.
 */
import { circle, resample, roundRect, type Pt } from './morph'
import { EVERYDAY_GEOMETRY, EVERYDAY_IDS, everydayOutline, type EverydayId } from './objects-everyday'

/** Object ids known to the morph engine. */
export const OBJECT_IDS = ['dot', 'ring', 'bar', 'clock', 'coin', 'document', 'microphone', 'timeline', 'calendar', 'envelope', 'bell', 'voice-note', 'phone-app', 'brick', 'house', 'blueprint', 'eye', 'photo', 'chat', 'banknote', 'scale', 'materials', 'sun', 'room', 'pin', 'window', 'sun-path', 'file', 'hard-hat', 'bulb', 'ai-chip', 'tool', 'magnifier', 'follow', 'compass', 'receipt', ...EVERYDAY_IDS] as const
export type ObjectId = (typeof OBJECT_IDS)[number]

/**
 * Task 6b geometry, in units of `size`. Document: a page w × h with rounded corners and the
 * top-left corner folded (the prototype's `rrPts(…, { fold })`). Microphone: a capsule (the
 * prototype's MICP). Timeline: an editor window.
 */
export const OBJECT_GEOMETRY = {
  document: { w: 1, h: 1.26, r: 0.07, fold: 0.18 },
  microphone: { w: 0.6, h: 1 },
  timeline: { w: 1.5, h: 0.9, r: 0.07 },
  // Task 6c: the script's own objects.
  calendar: { w: 1, h: 1.1, r: 0.07 },
  envelope: { w: 1.4, h: 0.9, r: 0.05 },
  /** A bell (dome, waist, flared lip); `knob`/`clapper` sit outside the outline (details). */
  bell: { w: 0.7, h: 0.72 },
  /** A chat bubble: body 1.42 wide, the tail (RTL: top right) reaching the 1.5 box corner. */
  'voice-note': { w: 1.5, h: 0.42, r: 0.15, tail: 0.08 },
  'phone-app': { w: 0.56, h: 1.1, r: 0.1 },
  // Stage 1A: the house reel's objects.
  /**
   * The Iraqi brick (طابوقة) in a 3/4 view from above-front: a front face `front.w` × `front.h`
   * (bottom-left of the box), the top face receding by `depth` (dx, dy) and the right end face;
   * the silhouette is that hexagon with corners rounded by `r`.
   */
  brick: { w: 1, h: 0.62, front: { w: 0.78, h: 0.3 }, depth: { x: 0.22, y: -0.32 }, r: 0.028 },
  /**
   * A two-storey Iraqi house, front elevation: walls ±`wall` wide down to the ground at h/2, a
   * coping `coping.h` thick on the parapet (top at `coping.y`, full width), and the stair tower on
   * the roof at the right (x `tower.x0`..`tower.x1`, up to the box top).
   */
  house: { w: 1, h: 0.9, wall: 0.48, coping: { y: -0.28, h: 0.025 }, tower: { x0: 0.11, x1: 0.41 } },
  /** A portrait plan sheet with near-square corners. */
  blueprint: { w: 1, h: 1.28, r: 0.012 },
  /** An almond: the upper lid `(1 − u²)^top`, the lower lid `(1 − u²)^bottom` (u = 2x/w), both h/2 at the middle. */
  eye: { w: 1, h: 0.56, top: 0.85, bottom: 1.15 },
  /** A polaroid-style print: a white card around the image, a deeper strip at the bottom. */
  photo: { w: 0.9, h: 1.08, r: 0.022 },
  /** A chat panel card. */
  chat: { w: 1.4, h: 1, r: 0.07 },
  /** A banknote (the Iraqi dinar is paper, not a coin): a landscape bill with small corners. */
  banknote: { w: 1, h: 0.48, r: 0.022 },
  // Stage 2: the cost and sun sections.
  /**
   * A balance scale, front view: the finial on the post, the beam (`beam.y` its top, `beam.t`
   * thick, ±`beam.x`), the pans hanging from the beam ends (`hang` x) on strings to the rim at
   * `pan.y` (±`pan.r` wide, `pan.d` deep), the post (±`post`) down to a stepped base. The outline is
   * that silhouette at rest, the strings drawn as a filled triangle.
   */
  scale: { w: 1.2, h: 1, beam: { x: 0.44, y: -0.43, t: 0.03 }, hang: 0.42, pan: { y: 0.08, r: 0.18, d: 0.08 }, post: 0.022, base: { y: 0.4, top: 0.12, bottom: 0.22 }, finial: 0.045 },
  /** The 2 × 2 grid of building materials on a soft card. */
  materials: { w: 1.1, h: 1, r: 0.05 },
  /** The sun's disc (size = its diameter); the corona and the halo reach past it (details). */
  sun: { w: 1, h: 1 },
  /** A cutaway bedroom in a wall section. */
  room: { w: 1.2, h: 0.9, r: 0.03 },
  /** A map tile. */
  pin: { w: 1, h: 1, r: 0.08 },
  /** A window in a wall section. */
  window: { w: 0.9, h: 1.1, r: 0.012 },
  /** The sky dome over a small house: a half ellipse down to the ground at `ground`, a ground band below. */
  'sun-path': { w: 1.2, h: 1, ground: 0.36 },
  /** A file icon: a page with its top-right corner folded by `fold`. */
  file: { w: 0.8, h: 1, r: 0.05, fold: 0.2 },
  // Video 2: the hook («المهندسين راح يزعلون منّي») and the mission («مهمتي…»).
  /**
   * Three engineers in hard hats, front view: `heads` are [centre x, scale] (the big one in the
   * middle last, drawn in front); each head is drawn in the middle head's frame and scaled about
   * its bottom (y = h/2). In that frame: the helmet dome (centre `dome.y`, rx × ry, its top at the
   * box top), the brim (top `brim.y`, ±`brim.w`, `brim.t` thick), the face (an ellipse), and the
   * shoulders (top `body.y`, ±`body.w`, a superellipse cut by the box bottom).
   */
  'hard-hat': {
    w: 1.3,
    h: 1,
    heads: [[0.37, 0.78], [-0.37, 0.78], [0, 1]],
    dome: { y: -0.2, rx: 0.25, ry: 0.3 },
    brim: { y: -0.215, w: 0.31, t: 0.05 },
    face: { y: 0.02, rx: 0.195, ry: 0.235 },
    body: { y: 0.3, w: 0.36 },
  },
  /** A light bulb: the glass globe (centre `globe.y`, radius `globe.r`), the neck down to the screw base (±`base.w`, `base.y0`..`base.y1`), the contact tip (±`tip`). */
  bulb: { w: 0.62, h: 1, globe: { y: -0.19, r: 0.31 }, base: { w: 0.15, y0: 0.17, y1: 0.42 }, tip: 0.07 },
  /** A circuit-board tile with the AI chip in its middle. */
  'ai-chip': { w: 1, h: 1, r: 0.08 },
  /** A gear (size = its outer diameter) with a wrench crossed over it. */
  tool: { w: 1, h: 1 },
  /** A results card (a mini table) with a magnifying glass over it. */
  magnifier: { w: 1.2, h: 1, r: 0.05 },
  /** A profile card. */
  follow: { w: 1.3, h: 0.8, r: 0.08 },
  /** A compass (size = its bezel's diameter). */
  compass: { w: 1, h: 1 },
  /** A purchase-order slip: straight top with small corners, a zig-zag torn bottom of `teeth` teeth `tooth` deep. */
  receipt: { w: 0.75, h: 1.1, r: 0.02, teeth: 9, tooth: 0.04 },
  // Everyday objects (objects-everyday.ts).
  ...EVERYDAY_GEOMETRY,
} as const

/**
 * Stage 2 brick variants (a brick state's `text`): each is the brick's own outline scaled by
 * (`sx`, `sy`) — the Gulf brick a little larger, the thermostone block about 1.3× as wide.
 * Any other text (`'iraqi'`, `'fall'`, none) is the Iraqi brick.
 */
export const BRICK_VARIANTS = {
  iraqi: { sx: 1, sy: 1 },
  gulf: { sx: 1.08, sy: 1.06 },
  thermostone: { sx: 1.3, sy: 1.2 },
  measure: { sx: 1, sy: 1 },
} as const
export type BrickVariant = keyof typeof BRICK_VARIANTS
/** The brick variant a state's `text` names (the Iraqi brick for anything else). */
export const brickVariantOf = (text: string | undefined): BrickVariant =>
  text !== undefined && Object.hasOwn(BRICK_VARIANTS, text) ? (text as BrickVariant) : 'iraqi'

/** Corner arc resolution before resampling. */
const ARC_STEPS = 24

/** A rounded page (w × h, corner radius r) whose top-left corner is cut by a fold of `fold` px. */
function foldedPage(w: number, h: number, r: number, fold: number): Pt[] {
  const l = -w / 2, rt = w / 2, t = -h / 2, b = h / 2
  const pts: Pt[] = [[l + fold, t]]
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= ARC_STEPS; i++) {
      const a = a0 + (Math.PI / 2) * (i / ARC_STEPS)
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  arc(rt - r, t + r, -Math.PI / 2)
  arc(rt - r, b - r, 0)
  arc(l + r, b - r, Math.PI / 2)
  pts.push([l, t + fold])
  return resample(pts)
}

/** Samples a cubic Bézier (excluding its start point) into `out`. */
function cubic(out: Pt[], p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps = ARC_STEPS): void {
  for (let i = 1; i <= steps; i++) {
    const u = i / steps
    const v = 1 - u
    const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]])
  }
}

/**
 * The bell's right half, top-centre down to bottom-centre, in units of the size (box ±0.35 × ±0.36):
 * a dome, the waist, the flare and a rounded lip. Mirrored for the left half.
 */
function bellOutline(size: number): Pt[] {
  const half: Pt[] = [[0, -0.36]]
  cubic(half, [0, -0.36], [0.13, -0.36], [0.21, -0.29], [0.215, -0.13])
  cubic(half, [0.215, -0.13], [0.22, 0.07], [0.26, 0.2], [0.35, 0.27])
  cubic(half, [0.35, 0.27], [0.355, 0.3], [0.355, 0.33], [0.335, 0.36], 8)
  half.push([0, 0.36])
  const right = half.map(([x, y]) => [x * size, y * size] as Pt)
  const left = right.slice(1, -1).reverse().map(([x, y]) => [-x, y] as Pt)
  return resample([...right, ...left])
}

/**
 * The voice-note bubble (w × h, corner radius r) whose top-right corner is a tail reaching the box
 * corner: the body is `w − tail` wide, its right edge at w/2 − tail.
 */
function bubbleOutline(w: number, h: number, r: number, tail: number): Pt[] {
  const l = -w / 2, t = -h / 2, b = h / 2
  const br = w / 2 - tail
  const pts: Pt[] = []
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= ARC_STEPS; i++) {
      const a = a0 + (Math.PI / 2) * (i / ARC_STEPS)
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  pts.push([l + r, t], [w / 2, t])
  // the tail: from its tip back to the body's right edge, a concave curve
  cubic(pts, [w / 2, t], [br + tail * 0.35, t + h * 0.12], [br, t + h * 0.22], [br, t + h * 0.42])
  arc(br - r, b - r, 0)
  arc(l + r, b - r, Math.PI / 2)
  arc(l + r, t + r, Math.PI)
  return resample(pts)
}

/**
 * A closed polygon with every corner cut by a quadratic fillet `r` long along each edge (at most
 * 0.45 of the shorter edge), densely sampled for `resample`.
 */
export function roundedPolygon(corners: readonly Pt[], r: number): Pt[] {
  const n = corners.length
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const p = corners[(i + n - 1) % n]!
    const c = corners[i]!
    const q = corners[(i + 1) % n]!
    const la = Math.hypot(p[0] - c[0], p[1] - c[1])
    const lb = Math.hypot(q[0] - c[0], q[1] - c[1])
    const k = Math.min(r, 0.45 * la, 0.45 * lb)
    if (!(k > 0)) {
      out.push(c)
      continue
    }
    const a: Pt = [c[0] + ((p[0] - c[0]) * k) / la, c[1] + ((p[1] - c[1]) * k) / la]
    const b: Pt = [c[0] + ((q[0] - c[0]) * k) / lb, c[1] + ((q[1] - c[1]) * k) / lb]
    for (let j = 0; j <= 8; j++) {
      const u = j / 8
      const v = 1 - u
      out.push([v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]])
    }
  }
  return out
}

/** The brick's six silhouette corners (clockwise from the top face's back-left), in units of the size. */
export function brickCorners(): Pt[] {
  const g = OBJECT_GEOMETRY.brick
  const l = -g.w / 2, b = g.h / 2
  const ft = b - g.front.h
  const fr = l + g.front.w
  return [
    [l + g.depth.x, ft + g.depth.y],
    [fr + g.depth.x, ft + g.depth.y],
    [fr + g.depth.x, b + g.depth.y],
    [fr, b],
    [l, b],
    [l, ft],
  ]
}

/** The house silhouette (main walls with the coping, the stair tower on the roof), clockwise from the coping's top-left, in units of the size. */
export function houseCorners(): Pt[] {
  const g = OBJECT_GEOMETRY.house
  const t = -g.h / 2, b = g.h / 2, W = g.w / 2
  const cy = g.coping.y, ch = cy + g.coping.h
  return [
    [-W, cy],
    [g.tower.x0, cy],
    [g.tower.x0, t],
    [g.tower.x1, t],
    [g.tower.x1, cy],
    [W, cy],
    [W, ch],
    [g.wall, ch],
    [g.wall, b],
    [-g.wall, b],
    [-g.wall, ch],
    [-W, ch],
  ]
}

/** The eye's lid curves at u ∈ [−1, 1] (u = 2x / w): upper and lower y in units of the size. */
export function eyeLids(u: number): { top: number; bottom: number } {
  const g = OBJECT_GEOMETRY.eye
  const q = Math.max(0, 1 - u * u)
  return { top: (-g.h / 2) * q ** g.top, bottom: (g.h / 2) * q ** g.bottom }
}

function eyeOutline(size: number): Pt[] {
  const g = OBJECT_GEOMETRY.eye
  const N = 72
  const pts: Pt[] = []
  for (let i = 0; i <= N; i++) {
    const u = -1 + (2 * i) / N
    pts.push([(u * g.w * size) / 2, eyeLids(u).top * size])
  }
  for (let i = N - 1; i >= 1; i--) {
    const u = -1 + (2 * i) / N
    pts.push([(u * g.w * size) / 2, eyeLids(u).bottom * size])
  }
  return resample(pts)
}

/**
 * The balance scale's silhouette at rest (units of the size), clockwise from the finial's top:
 * finial, beam, the right strings and pan, the post and the base, the left pan and strings.
 */
export function scaleCorners(): Pt[] {
  const g = OBJECT_GEOMETRY.scale
  const B = g.beam
  const by = B.y + B.t
  const out: Pt[] = []
  const f = g.finial
  const fy = -g.h / 2 + f
  // the finial: the right half of a knob from the top down to where it meets the beam
  const aEnd = Math.asin(Math.min(1, (B.y - fy) / f))
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2 + aEnd)
    out.push([f * Math.cos(a), fy + f * Math.sin(a)])
  }
  const bowl = (side: 1 | -1): Pt[] => {
    const cx = side * g.hang
    const P = g.pan
    const pts: Pt[] = []
    // from the rim edge farther along the clockwise walk (outer on the right, inner on the left)
    for (let i = 0; i <= 10; i++) {
      const u = 1 - (2 * i) / 10
      pts.push([cx + P.r * u, P.y + P.d * (1 - u * u) ** 0.8])
    }
    return pts
  }
  out.push([B.x, B.y], [B.x, by])
  // right strings down to the rim, the bowl from its outer edge round to the inner one, back up
  out.push(...bowl(1))
  out.push([g.hang - 0.02, by], [g.post, by], [g.post, g.base.y], [g.base.top, g.base.y], [g.base.bottom, 0.5], [-g.base.bottom, 0.5], [-g.base.top, g.base.y], [-g.post, g.base.y], [-g.post, by], [-g.hang + 0.02, by])
  out.push(...bowl(-1))
  out.push([-B.x, by], [-B.x, B.y])
  for (let i = 8; i >= 1; i--) {
    const a = -Math.PI / 2 - (i / 8) * (Math.PI / 2 + aEnd)
    out.push([f * Math.cos(a), fy + f * Math.sin(a)])
  }
  return out
}

/** The sun-path dome (units of the size): a half ellipse from the top down to the ground, then the ground band. */
function domeOutline(size: number): Pt[] {
  const g = OBJECT_GEOMETRY['sun-path']
  const W = g.w / 2
  const ry = g.ground + g.h / 2
  const pts: Pt[] = []
  const N = 64
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + (i / N) * (Math.PI / 2)
    pts.push([W * Math.cos(a) * size, (g.ground + ry * Math.sin(a)) * size])
  }
  pts.push([W * size, (g.h / 2) * size], [-W * size, (g.h / 2) * size])
  for (let i = N; i >= 1; i--) {
    const a = -Math.PI / 2 - (i / N) * (Math.PI / 2)
    pts.push([W * Math.cos(a) * size, (g.ground + ry * Math.sin(a)) * size])
  }
  return resample(pts)
}

/** A rounded page (w × h, corner radius r) whose top-RIGHT corner is cut by a fold of `fold` (the file icon). */
function filePage(w: number, h: number, r: number, fold: number): Pt[] {
  const l = -w / 2, rt = w / 2, t = -h / 2, b = h / 2
  const pts: Pt[] = []
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= ARC_STEPS; i++) {
      const a = a0 + (Math.PI / 2) * (i / ARC_STEPS)
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  pts.push([rt - fold, t], [rt, t + fold])
  arc(rt - r, b - r, 0)
  arc(l + r, b - r, Math.PI / 2)
  arc(l + r, t + r, Math.PI)
  return resample(pts)
}

/**
 * Video 2: the top of one engineer's silhouette (helmet dome, brim, face, shoulders) at x, in units
 * of the size, in the middle head's frame; `undefined` where the head has nothing.
 */
function headTop(x: number): number | undefined {
  const g = OBJECT_GEOMETRY['hard-hat']
  let y: number | undefined
  const take = (v: number) => (y = y === undefined ? v : Math.min(y, v))
  const ax = Math.abs(x)
  if (ax < g.dome.rx) take(g.dome.y - g.dome.ry * Math.sqrt(1 - (x / g.dome.rx) ** 2))
  if (ax < g.brim.w) take(g.brim.y)
  if (ax < g.face.rx) take(g.face.y - g.face.ry * Math.sqrt(1 - (x / g.face.rx) ** 2))
  if (ax < g.body.w) take(0.5 - (0.5 - g.body.y) * (1 - (ax / g.body.w) ** 4) ** 0.25)
  return y
}

/** The three engineers' silhouette top at x (units of the size): the highest of the heads there, else the box bottom. */
export function hardHatTop(x: number): number {
  const g = OBJECT_GEOMETRY['hard-hat']
  let y = g.h / 2
  for (const [hx, hs] of g.heads) {
    const t = headTop((x - hx) / hs)
    if (t !== undefined) y = Math.min(y, g.h / 2 + hs * (t - g.h / 2))
  }
  return y
}

/** The three engineers: the silhouette top from the middle helmet's crown round to the right, the flat bottom, back up the left. */
function hardHatOutline(size: number): Pt[] {
  const W = OBJECT_GEOMETRY['hard-hat'].w / 2
  const H = OBJECT_GEOMETRY['hard-hat'].h / 2
  const N = 160
  const pts: Pt[] = []
  for (let i = 0; i <= N; i++) {
    const x = (W * i) / N
    pts.push([x * size, hardHatTop(x) * size])
  }
  pts.push([W * size, H * size], [-W * size, H * size])
  for (let i = N; i >= 1; i--) {
    const x = (-W * i) / N
    pts.push([x * size, hardHatTop(x) * size])
  }
  return resample(pts)
}

/** The bulb's right half (units of the size), from the crown down to the contact tip's centre. */
export function bulbHalf(): Pt[] {
  const g = OBJECT_GEOMETRY.bulb
  const { y: cy, r } = g.globe
  const half: Pt[] = []
  const a1 = (52 * Math.PI) / 180
  for (let i = 0; i <= 40; i++) {
    const a = -Math.PI / 2 + (i / 40) * (Math.PI / 2 + a1)
    half.push([r * Math.cos(a), cy + r * Math.sin(a)])
  }
  // the neck: from the globe down to the screw base, tangent to the globe
  const p0 = half[half.length - 1]!
  const tx = -Math.sin(a1), ty = Math.cos(a1)
  cubic(half, p0, [p0[0] + tx * 0.07, p0[1] + ty * 0.07], [g.base.w, g.base.y0 - 0.05], [g.base.w, g.base.y0], 16)
  half.push([g.base.w, g.base.y1])
  cubic(half, [g.base.w, g.base.y1], [g.base.w, g.base.y1 + 0.04], [g.tip + 0.03, g.h / 2], [g.tip, g.h / 2], 10)
  half.push([0, g.h / 2])
  return half
}

function bulbOutline(size: number): Pt[] {
  const right = bulbHalf().map(([x, y]) => [x * size, y * size] as Pt)
  const left = right.slice(1, -1).reverse().map(([x, y]) => [-x, y] as Pt)
  return resample([...right, ...left])
}

/** The purchase-order slip: a straight top with small corners, the right side, a zig-zag torn bottom (right → left), the left side. */
function receiptOutline(size: number): Pt[] {
  const g = OBJECT_GEOMETRY.receipt
  const W = g.w / 2, H = g.h / 2, r = g.r
  const pts: Pt[] = [[0, -H]]
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2)
    pts.push([W - r + r * Math.cos(a), -H + r + r * Math.sin(a)])
  }
  pts.push([W, H - g.tooth])
  for (let i = 1; i <= 2 * g.teeth; i++) pts.push([W - (i * g.w) / (2 * g.teeth), i % 2 ? H : H - g.tooth])
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (i / 8) * (Math.PI / 2)
    pts.push([-W + r + r * Math.cos(a), -H + r + r * Math.sin(a)])
  }
  return resample(pts.map(([x, y]) => [x * size, y * size] as Pt))
}

/** Outline of an object: a circle for dot/ring/clock/coin, a thin capsule for bar, a page, a capsule mic, a window. */
export function objectOutline(id: ObjectId, size: number): Pt[] {
  switch (id) {
    case 'dot':
    case 'ring':
    case 'clock':
    case 'coin':
      return circle(0, 0, size / 2)
    case 'bar':
      return roundRect(0, 0, size, size * 0.16, size * 0.08)
    case 'document': {
      const g = OBJECT_GEOMETRY.document
      return foldedPage(g.w * size, g.h * size, g.r * size, g.fold * size)
    }
    case 'microphone': {
      const g = OBJECT_GEOMETRY.microphone
      return roundRect(0, 0, g.w * size, g.h * size, (g.w * size) / 2)
    }
    case 'timeline': {
      const g = OBJECT_GEOMETRY.timeline
      return roundRect(0, 0, g.w * size, g.h * size, g.r * size)
    }
    case 'calendar':
    case 'envelope':
    case 'phone-app': {
      const g = OBJECT_GEOMETRY[id]
      return roundRect(0, 0, g.w * size, g.h * size, g.r * size)
    }
    case 'bell':
      return bellOutline(size)
    case 'brick':
      return resample(roundedPolygon(brickCorners().map(([x, y]) => [x * size, y * size] as Pt), OBJECT_GEOMETRY.brick.r * size))
    case 'house':
      return resample(roundedPolygon(houseCorners().map(([x, y]) => [x * size, y * size] as Pt), 0.003 * size))
    case 'blueprint':
    case 'photo':
    case 'chat':
    case 'banknote': {
      const g = OBJECT_GEOMETRY[id]
      return roundRect(0, 0, g.w * size, g.h * size, g.r * size)
    }
    case 'eye':
      return eyeOutline(size)
    case 'scale':
      return resample(roundedPolygon(scaleCorners().map(([x, y]) => [x * size, y * size] as Pt), 0.004 * size))
    case 'sun':
      return circle(0, 0, size / 2)
    case 'materials':
    case 'room':
    case 'pin':
    case 'window': {
      const g = OBJECT_GEOMETRY[id]
      return roundRect(0, 0, g.w * size, g.h * size, g.r * size)
    }
    case 'sun-path':
      return domeOutline(size)
    case 'file': {
      const g = OBJECT_GEOMETRY.file
      return filePage(g.w * size, g.h * size, g.r * size, g.fold * size)
    }
    case 'hard-hat':
      return hardHatOutline(size)
    case 'bulb':
      return bulbOutline(size)
    case 'tool':
    case 'compass':
      return circle(0, 0, size / 2)
    case 'ai-chip':
    case 'magnifier':
    case 'follow': {
      const g = OBJECT_GEOMETRY[id]
      return roundRect(0, 0, g.w * size, g.h * size, g.r * size)
    }
    case 'receipt':
      return receiptOutline(size)
    case 'voice-note': {
      const g = OBJECT_GEOMETRY['voice-note']
      return bubbleOutline(g.w * size, g.h * size, g.r * size, g.tail * size)
    }
    default:
      if ((EVERYDAY_IDS as readonly string[]).includes(id)) return everydayOutline(id as EverydayId, size)
      throw new Error(`شكل غير معروف "${String(id)}" — unknown object "${String(id)}" (expected ${OBJECT_IDS.join(', ')})`)
  }
}
