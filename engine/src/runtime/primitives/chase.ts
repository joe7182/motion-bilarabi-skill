import { CHASE, chaseCurve, chaseParams, chasePoint, chasePose, type ChaseBody, type ChaseParams } from '../../core/params/chase'
import { easeOutBack, seg } from '../../core/ease'
import { resolvedWorld, sceneCanvas } from '../canvas'
import { rgba } from '../materials'
import type { Primitive } from './registry'

/** What `ctx.sceneParams(id).exports()` returns for a chase scene. */
export interface ChaseExports {
  kind: 'chase'
  /** The pursuer and every customer (nearest first) at this scene's local time, in frame px (their feet on the curve). */
  at(localT: number): { pursuer: { x: number; y: number }; figures: { x: number; y: number }[] }
}

/** Canvas bleed (px): figures near the frame edge stay whole under camera motion. */
const BLEED = 64
const TAU = Math.PI * 2

/**
 * One running customer (fg): a head, a body capsule leaning into the run, scissoring legs and
 * swinging arms, bobbing with the stride, a soft shadow at the feet. `face` (−1..1) mirrors it to
 * the direction of travel (narrow while it runs up or down the screen); `pop` scales it in.
 */
function drawFigure(g: CanvasRenderingContext2D, f: ChaseBody, H: number, phase: number, face: number, pop: number, fg: string): void {
  if (!(pop > 0)) return
  const stride = Math.sin(phase)
  const bob = -0.07 * H * Math.abs(Math.sin(phase))
  g.save()
  g.translate(f.x, f.y)
  g.fillStyle = rgba(fg, 0.12)
  g.beginPath()
  g.ellipse(0, 0, 0.22 * H * pop, 0.05 * H * pop, 0, 0, TAU)
  g.fill()
  g.scale(pop * face, pop)
  g.translate(0, bob)
  g.strokeStyle = fg
  g.fillStyle = fg
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const hipY = -0.36 * H
  const lean = 0.2
  // legs: thigh + shin, front and back swapping with the stride
  g.lineWidth = 0.1 * H
  for (const sgn of [1, -1]) {
    const a = 0.75 * stride * sgn
    const kx = Math.sin(a) * 0.19 * H
    const ky = hipY + Math.cos(a) * 0.19 * H
    const bend = sgn * stride > 0 ? 0.1 : 0.7
    const fx = kx + Math.sin(a - bend) * 0.18 * H
    const fy = ky + Math.cos(a - bend) * 0.18 * H
    g.beginPath()
    g.moveTo(0, hipY)
    g.lineTo(kx, ky)
    g.lineTo(fx, Math.min(fy, -0.01 * H))
    g.stroke()
  }
  // body, leaning forward
  g.save()
  g.translate(0, hipY)
  g.rotate(lean)
  g.lineWidth = 0.24 * H
  g.beginPath()
  g.moveTo(0, -0.03 * H)
  g.lineTo(0, -0.3 * H)
  g.stroke()
  // arms, opposite to the legs
  g.lineWidth = 0.075 * H
  for (const sgn of [1, -1]) {
    const a = -0.9 * stride * sgn
    const ex = Math.sin(a) * 0.14 * H
    const ey = -0.28 * H + Math.cos(a) * 0.14 * H
    g.beginPath()
    g.moveTo(0, -0.28 * H)
    g.lineTo(ex, ey)
    g.lineTo(ex + 0.1 * H, ey - 0.05 * H)
    g.stroke()
  }
  // head
  g.beginPath()
  g.arc(0.02 * H, -0.5 * H, 0.13 * H, 0, TAU)
  g.fill()
  g.restore()
  g.restore()
}

/**
 * chase (Plan 3 Task 6c, "follow your customers"): small customer figures run along a seeded
 * closed curve, always just ahead of an accent pursuer (the hero dot) whose dotted trail follows
 * the same curve; it gains on them but never catches them (the gap breathes, `chasePose`). The
 * figures bob and run with legs and arms in stride, facing the way they run; a faint dashed track
 * shows the loop. Everything pops in in turn over the first half second. One canvas, decoration
 * only (`aria-hidden`, no DOM text), every frame a pure function of local time; colours from
 * `resolvedWorld(ctx.layer)`.
 */
export const chase: Primitive<ChaseParams> = {
  id: 'chase',
  params: chaseParams,
  build(ctx, p) {
    const surface = sceneCanvas(ctx, { bleed: BLEED })
    const { el, g } = surface
    el.dataset.mbaPart = 'chase'
    if (p.key) el.dataset.mbaKey = p.key
    const seed = Math.floor(ctx.rng() * 2 ** 31)
    const curve = chaseCurve(seed, p, ctx.safe)
    const end = ctx.duration
    const H = curve.figH
    const dot = CHASE.dotD * ctx.safe.w
    const exports: ChaseExports = {
      kind: 'chase',
      at(t) {
        const pose = chasePose(p, curve, t, end)
        return { pursuer: { x: pose.pursuer.x, y: pose.pursuer.y }, figures: pose.figures.map((f) => ({ x: f.x, y: f.y })) }
      },
    }
    // the track as one path
    const track = new Path2D()
    curve.pts.forEach(([x, y], i) => (i ? track.lineTo(x, y) : track.moveTo(x, y)))
    track.closePath()

    const paint = (t: number) => {
      g.save()
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.clearRect(0, 0, el.width, el.height)
      g.restore()
      const c = resolvedWorld(ctx.layer)
      const pose = chasePose(p, curve, t, end)

      // the faint dashed track, drawing itself in
      const tr = seg(t, 0, 0.5)
      if (tr > 0) {
        g.save()
        g.strokeStyle = rgba(c.fg, 0.14)
        g.lineWidth = Math.max(1.5, 0.006 * ctx.safe.w)
        g.lineCap = 'round'
        g.setLineDash([0.012 * ctx.safe.w, 0.016 * ctx.safe.w])
        g.globalAlpha = tr
        g.stroke(track)
        g.restore()
      }

      // the pursuer's dotted trail along the same curve, then the pursuer
      const pp = Math.max(0, easeOutBack(seg(t, 0, CHASE.enterSec), 2))
      if (pp > 0) {
        g.save()
        g.fillStyle = c.accent
        for (let j = CHASE.trail.n; j >= 1; j--) {
          const q = chasePoint(curve, pose.pursuer.s - j * CHASE.trail.step * ctx.safe.w)
          const k = 1 - j / (CHASE.trail.n + 1)
          g.globalAlpha = 0.75 * k * Math.min(1, pp)
          g.beginPath()
          g.arc(q.x, q.y - dot / 2, (dot / 2) * (0.25 + 0.4 * k) * Math.min(1, pp), 0, TAU)
          g.fill()
        }
        g.globalAlpha = 0.18 * Math.min(1, pp)
        g.beginPath()
        g.arc(pose.pursuer.x, pose.pursuer.y - dot / 2, dot * 0.95 * pp, 0, TAU)
        g.fill()
        g.globalAlpha = 1
        g.translate(pose.pursuer.x, pose.pursuer.y - dot / 2)
        g.rotate(Math.atan2(pose.pursuer.dy, pose.pursuer.dx))
        g.scale(1.14 * pp, 0.9 * pp)
        g.beginPath()
        g.arc(0, 0, dot / 2, 0, TAU)
        g.fill()
        g.restore()
      }

      // the customers, the furthest up the screen first so the nearer ones overlap them
      const order = pose.figures.map((f, k) => ({ f, k })).sort((a, b) => a.f.y - b.f.y)
      for (const { f, k } of order) {
        const pop = Math.max(0, easeOutBack(seg(t, (k + 1) * CHASE.stagger, (k + 1) * CHASE.stagger + CHASE.enterSec), 2))
        const face = Math.tanh(4 * f.dx)
        const facing = (face >= 0 ? 1 : -1) * Math.max(0.6, Math.abs(face))
        const phase = TAU * CHASE.stride * t + curve.phases[k]!
        drawFigure(g, f, H, phase, facing, pop, c.fg)
      }
    }

    return {
      exports,
      update(localT) {
        paint(localT)
      },
    }
  },
}
