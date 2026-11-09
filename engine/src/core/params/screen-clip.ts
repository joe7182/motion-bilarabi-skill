import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { easeInCubic, easeOutCubic, seg } from '../ease'
import { springStep, springTrack, type SpringKey } from '../springs'
import { videoFrameAt, videoLastFrame } from '../video'
import { morphKey, oneLine } from './common'
import { safePoint } from './line-art'

/** A fraction of the source image (0..1). */
const unit = z.number().finite().min(0).max(1)
const sceneAt = z.number().finite().min(0)

/** One focus key: from `t` (scene s) the source point (x, y) is brought to the window centre at zoom `scale`. */
const focusKey = z.object({
  t: sceneAt,
  x: unit,
  y: unit,
  /** 1 = the image covers the window body (object-fit cover); larger zooms in. */
  scale: z
    .number()
    .finite()
    .min(1, { message: 'التكبير لا يقل عن ١ (الصورة تغطي النافذة) — scale must be ≥ 1 (1 = the image covers the window)' })
    .max(6, { message: 'التكبير لا يزيد عن ٦ — scale must be ≤ 6' }),
})

/** A pinned label on a source point. */
const callout = z.object({
  at: sceneAt,
  x: unit,
  y: unit,
  label: oneLine(18, 'label'),
})

/** A rectangle drawn around a source region (`hot` also fills it with a red pulse). */
const mark = z
  .object({
    at: sceneAt,
    x: unit,
    y: unit,
    w: z.number().finite().positive().max(1),
    h: z.number().finite().positive().max(1),
    style: z.enum(['box', 'hot']).default('box'),
  })
  .refine((m) => m.x + m.w <= 1 + 1e-9 && m.y + m.h <= 1 + 1e-9, {
    path: ['w'],
    message: 'المستطيل يخرج من الصورة (x + w ≤ 1 و y + h ≤ 1) — the mark must lie inside the image (x + w ≤ 1, y + h ≤ 1)',
  })

/** A cursor-less click ripple on a source point. */
const click = z.object({ at: sceneAt, x: unit, y: unit })

/**
 * Params of `screen-clip` (Stage 1B): the user's screen recording in a floating browser window,
 * as a designed object. All times are scene-local seconds; every (x, y) of focus / callouts /
 * marks / clicks is a point of the SOURCE image (0..1), tracked through the zoom.
 */
export const screenClipParams = z.object({
  /** Project media id (`m2`, …). */
  media: z.string().min(1),
  /** Media time (s) of the first frame (and, with `still`, of the one frame shown). */
  in: z.number().finite().min(0),
  speed: z.number().finite().min(0.25).max(4).default(1),
  /** Show the single frame at `in` for the whole scene. */
  still: z.boolean().default(false),
  /** Window centre in the safe area. */
  at: safePoint.default({ x: 0.5, y: 0.5 }),
  /** Window width as a fraction of the safe width. */
  width: z.number().min(0.3).max(1).default(0.94),
  /** Window body width / height; default the media's own aspect. A portrait body crops a tall region. */
  aspect: z.number().finite().min(0.3).max(4).optional(),
  /** Title bar with three dots and a url pill (default on); `false` drops the bar. */
  chrome: z.union([z.literal(false), z.object({ url: oneLine(40, 'url').optional() })]).default({}),
  enter: z.enum(['tilt', 'rise', 'none']).default('tilt'),
  /** Leave the same way in reverse over the last SCREEN_CLIP.exitSec. */
  exit: z.boolean().default(true),
  focus: z.array(focusKey).max(12, { message: 'مفاتيح التركيز لا تزيد عن ١٢ — focus has at most 12 keys' }).default([]),
  reveal: z.enum(['none', 'scan']).default('none'),
  revealSec: z.number().finite().min(0.2).max(5).default(0.9),
  callouts: z.array(callout).max(6, { message: 'التسميات لا تزيد عن ٦ — callouts has at most 6 entries' }).default([]),
  marks: z.array(mark).max(6, { message: 'التحديدات لا تزيد عن ٦ — marks has at most 6 entries' }).default([]),
  clicks: z.array(click).max(4, { message: 'النقرات لا تزيد عن ٤ — clicks has at most 4 entries' }).default([]),
  key: morphKey,
})

export type ScreenClipParams = z.infer<typeof screenClipParams>

export const SCREEN_CLIP = {
  /** Entrance: tilt rotateX `tiltDeg` → 0, scale `scaleFrom` → 1, opacity 0 → 1 over `enterSec`. */
  enterSec: 0.5,
  exitSec: 0.35,
  tiltDeg: 18,
  scaleFrom: 0.9,
  /** `rise`: the window comes up by this share of its height. */
  riseFrac: 0.14,
  /** Opacity reaches 1 by this share of the entrance. */
  fadeShare: 0.55,
  /** Perspective distance, × the window width. */
  perspective: 2.2,
  /** Title-bar height and url font (px at a 1080 px wide frame). */
  barPx: 66,
  urlPx: 28,
  urlMinPx: 26,
  /** Window corner radius (× window width) and its frame-px floor. */
  radius: 0.024,
  /** Scan reveal starts this long after the scene start when there is an entrance (0 without). */
  revealLead: 0.3,
  /** Seeded drift over the whole scene: pan ≤ `driftPan` of the image, zoom up by `driftZoom`. */
  driftPan: 0.008,
  driftZoom: 0.012,
  /** Callout: the pin pops over `pinPop`, the label `labelDelay` later; the pulse ring repeats every `pulse` s. */
  pinPop: 0.35,
  labelDelay: 0.08,
  pulse: 1.6,
  pinPx: 22,
  labelPx: 34,
  /** Mark: the stroke draws on over `markDraw`; a hot mark's fill pulses once over `hotSec`. */
  markDraw: 0.3,
  hotSec: 0.8,
  hotAlpha: 0.28,
  hotColor: '#E5372A',
  /** Click: two rings, the second `clickGap` later, each expanding over `clickSec`. */
  clickSec: 0.55,
  clickGap: 0.12,
  clickPx: 64,
} as const

/** Entrance / exit lengths in a scene of `len` s (a short scene compresses them). */
export function screenClipEdges(p: Pick<ScreenClipParams, 'enter' | 'exit'>, len: number): { enter: number; exit: number } {
  return {
    enter: p.enter === 'none' ? 0 : Math.min(SCREEN_CLIP.enterSec, len * 0.4),
    exit: p.exit ? Math.min(SCREEN_CLIP.exitSec, len * 0.3) : 0,
  }
}

/** Working-copy frame shown at local `t`: the frame at `in` for a still, else as `video` (core/video.ts). */
export function screenClipFrameAt(p: Pick<ScreenClipParams, 'in' | 'speed' | 'still'>, localT: number, sceneLen: number, fps: number): number {
  if (p.still) return Math.max(0, Math.round(p.in * fps))
  return videoFrameAt(p, localT, sceneLen, fps)
}

/** The last working-copy frame the scene can show. */
export function screenClipLastFrame(p: Pick<ScreenClipParams, 'in' | 'speed' | 'still'>, sceneLen: number, fps: number): number {
  if (p.still) return Math.max(0, Math.round(p.in * fps))
  return videoLastFrame(p, sceneLen, fps)
}

export interface ScreenFocus {
  x: number
  y: number
  scale: number
}

/**
 * The focus at local `t`: x, y and scale are spring tracks over the keys sorted by time (as the
 * `video` zoom). No keys: the source centre at scale 1.
 */
export function screenClipFocusAt(keys: ScreenClipParams['focus'], t: number): ScreenFocus {
  if (!keys.length) return { x: 0.5, y: 0.5, scale: 1 }
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const track = (f: (k: (typeof sorted)[number]) => number) => springTrack(t, sorted.map((k): SpringKey => [k.t, f(k)]))
  return { x: track((k) => k.x), y: track((k) => k.y), scale: track((k) => k.scale) }
}

/** A rectangle of the source image, in source fractions. */
export interface SourceRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The part of the source seen in the window body: the body's aspect cut from the source as large
 * as it covers (scale 1), divided by `scale`, centred on (x, y) and clamped inside the image.
 * `srcAspect` / `bodyAspect` are width / height.
 */
export function screenClipView(f: ScreenFocus, srcAspect: number, bodyAspect: number): SourceRect {
  const s = Math.max(1, f.scale)
  let w = 1
  let h = 1
  if (bodyAspect < srcAspect) w = bodyAspect / srcAspect
  else h = srcAspect / bodyAspect
  w /= s
  h /= s
  const clamp = (c: number, half: number) => Math.min(Math.max(c, half), 1 - half)
  return { x: clamp(f.x, w / 2) - w / 2, y: clamp(f.y, h / 2) - h / 2, w, h }
}

/**
 * The focus with the seeded drift added at local `t` of a `len` s scene: a pan of at most
 * SCREEN_CLIP.driftPan along direction `ang` (turns, from the scene's rng), centred on mid-scene,
 * and a zoom creeping up by SCREEN_CLIP.driftZoom, so a still never freezes.
 */
export function screenClipDrift(f: ScreenFocus, ang: number, t: number, len: number): ScreenFocus {
  const u = len > 0 ? Math.min(Math.max(t / len, 0), 1) : 0
  const a = ang * 2 * Math.PI
  return {
    x: f.x + Math.cos(a) * SCREEN_CLIP.driftPan * (u - 0.5),
    y: f.y + Math.sin(a) * SCREEN_CLIP.driftPan * (u - 0.5),
    scale: f.scale * (1 + SCREEN_CLIP.driftZoom * u),
  }
}

/** A source point in window-body px for view `v` over a `bw` × `bh` body. */
export const sourceToBody = (v: SourceRect, bw: number, bh: number, x: number, y: number) => ({
  x: ((x - v.x) / v.w) * bw,
  y: ((y - v.y) / v.h) * bh,
})

/** Window geometry in frame px: the box (centre at `at`), its title bar and body. */
export interface ScreenClipBox {
  x: number
  y: number
  w: number
  h: number
  bar: number
  bodyW: number
  bodyH: number
  aspect: number
}

/**
 * The window's box for a source of aspect `srcAspect` (w / h) in a frame `frameW` px wide with
 * safe area `safe`: width = `width` × safe width, body height = width / aspect, plus the bar.
 * A window that would leave the safe area is refused (Arabic first, with the param path).
 */
export function screenClipLayout(
  p: Pick<ScreenClipParams, 'at' | 'width' | 'aspect' | 'chrome'>,
  srcAspect: number,
  safe: { x: number; y: number; w: number; h: number },
  frameW: number,
): { box: ScreenClipBox } | { issue: { path: (string | number)[]; ar: string; en: string } } {
  const aspect = p.aspect ?? srcAspect
  const w = Math.floor(p.width * safe.w)
  const bar = p.chrome === false ? 0 : Math.round((SCREEN_CLIP.barPx * frameW) / 1080)
  const bodyH = Math.round(w / aspect)
  const h = bodyH + bar
  const cx = safe.x + p.at.x * safe.w
  const cy = safe.y + p.at.y * safe.h
  const box: ScreenClipBox = { x: cx - w / 2, y: cy - h / 2, w, h, bar, bodyW: w, bodyH, aspect }
  const tol = 0.5
  if (h > safe.h + tol) {
    return {
      issue: {
        path: [p.aspect === undefined ? 'width' : 'aspect'],
        ar: `النافذة أطول من المنطقة الآمنة (${h} > ${Math.floor(safe.h)} بكسل)؛ صغّر width أو كبّر aspect`,
        en: `the window is ${h} px tall, taller than the safe area (${Math.floor(safe.h)} px); lower width or raise aspect`,
      },
    }
  }
  if (box.x < safe.x - tol || box.x + w > safe.x + safe.w + tol || box.y < safe.y - tol || box.y + h > safe.y + safe.h + tol) {
    return {
      issue: {
        path: ['at'],
        ar: 'النافذة تخرج من المنطقة الآمنة عند هذا الموضع؛ قرّب at من المركز أو صغّر width',
        en: `the window (${Math.round(w)}×${Math.round(h)} px) at (${p.at.x}, ${p.at.y}) leaves the safe area; move at toward the centre or lower width`,
      },
    }
  }
  return { box }
}

/** The window's pose at local `t`: entrance / exit (rotateX deg, scale, rise as a share of its height, opacity). */
export function screenClipPose(p: Pick<ScreenClipParams, 'enter' | 'exit'>, t: number, len: number): { rot: number; scale: number; rise: number; opacity: number } {
  const e = screenClipEdges(p, len)
  if (p.enter === 'none' && !p.exit) return { rot: 0, scale: 1, rise: 0, opacity: 1 }
  // in: 0 → 1 over the entrance; out: 0 → 1 over the exit.
  const xin = e.enter > 0 ? seg(t, 0, e.enter) : 1
  const xout = e.exit > 0 ? seg(t, len - e.exit, len) : 0
  // The engine's `default` spring over the entrance, normalised to land exactly on 1 at its end.
  const ein = xin >= 1 ? 1 : springStep(xin * e.enter, 'default') + (1 - springStep(e.enter, 'default')) * xin
  const eout = easeInCubic(xout)
  const fadeIn = e.enter > 0 ? easeOutCubic(seg(t, 0, e.enter * SCREEN_CLIP.fadeShare)) : 1
  const fadeOut = e.exit > 0 ? easeOutCubic(seg(t, len - e.exit * 0.8, len)) : 0
  const opacity = Math.min(fadeIn, 1 - fadeOut)
  const kind = p.enter === 'none' ? 'tilt' : p.enter
  const away = Math.max(1 - ein, eout)
  if (kind === 'rise') {
    return { rot: 0, scale: 1 - 0.04 * away, rise: SCREEN_CLIP.riseFrac * away, opacity }
  }
  return { rot: SCREEN_CLIP.tiltDeg * away, scale: 1 - (1 - SCREEN_CLIP.scaleFrom) * away, rise: 0, opacity }
}

/** Scan progress 0..1 at local `t` (1 without a scan). */
export function screenClipReveal(p: Pick<ScreenClipParams, 'reveal' | 'revealSec' | 'enter'>, t: number): number {
  if (p.reveal !== 'scan') return 1
  const t0 = p.enter === 'none' ? 0 : SCREEN_CLIP.revealLead
  const x = seg(t, t0, t0 + p.revealSec)
  // An in-out quad: the line accelerates off the top and settles onto the bottom edge.
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
}

/** Scene-level check: every callout / mark / click / focus key starts inside the scene. */
export function timingIssueOfScreenClip(p: ScreenClipParams, sceneLen: number) {
  const lists = [
    ['callouts', p.callouts.map((c) => c.at)],
    ['marks', p.marks.map((c) => c.at)],
    ['clicks', p.clicks.map((c) => c.at)],
    ['focus', p.focus.map((c) => c.t)],
  ] as const
  for (const [field, ats] of lists) {
    const k = ats.findIndex((a) => a >= sceneLen)
    if (k >= 0) {
      return {
        path: [field, k, field === 'focus' ? 't' : 'at'],
        ar: `الوقت ${ats[k]} ث بعد نهاية المشهد (${sceneLen} ث)`,
        en: `${field}[${k}] starts at ${ats[k]} s, at or past the scene end (${sceneLen} s local)`,
      }
    }
  }
  return undefined
}

/**
 * Sound cues of `screen-clip`: a `whoosh` as the window arrives (tilt / rise), a `pop` per callout
 * and per mark, an `action` (a tap) per click.
 */
export function cuesOfScreenClip(p: ScreenClipParams, _ctx: { duration: number }): Cue[] {
  const out: Cue[] = []
  if (p.enter !== 'none') out.push({ t: 0, kind: 'whoosh' })
  for (const c of p.callouts) out.push({ t: c.at, kind: 'pop' })
  for (const m of p.marks) out.push({ t: m.at, kind: 'pop' })
  for (const c of p.clicks) out.push({ t: c.at, kind: 'action' })
  return out.sort((a, b) => a.t - b.t)
}
