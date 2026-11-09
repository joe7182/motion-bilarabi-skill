import gsap from 'gsap'
import { FORMAT_SIZE, safeRect } from '../core/types'
import { covers } from '../core/params/highlight'
import { CUT_TOLERANCE, MAX_TRACK, StoryboardError, storyboardDuration, trackOf, transitionCut, type Storyboard } from '../core/storyboard'
import { resolveWorld, worldOf, type WorldColours } from '../core/worlds'
import type { BackdropParams } from '../core/params/backdrop'
import { CAMERA, cameraAt, cameraJitter, cameraToScreen, cameraTransform, jitterAtDepth, poseAtDepth, screenToCamera } from '../core/camera'
import { rng } from '../core/rng'
import { parseSceneParams } from '../core/params/index'
import { applyLookVars, getLook, REQUIRED_FONTS } from './looks'
import { getPrimitive, hasPrimitive, type Built, type SceneInfo } from './primitives/registry'
import './primitives/index'
import { getTransition, type TransitionBuilt } from './transitions/registry'
import './transitions/index'

export interface Stage {
  duration: number
  /**
   * Sets the frame to time `t` (clamped to [0, duration]) and resolves once every visible scene's
   * `update` (sync or async) has finished. Rejects at once for a non-finite `t`.
   *
   * Seeks are serialized here (latest wins): a seek that arrives while another is in flight waits;
   * if several arrive meanwhile, only the latest time is applied and all of them resolve when it
   * is done. So the frame after `await seek(t)` equals a cold `seek(t)` only if no later seek was
   * issued before this one settled; otherwise the newest time is what is painted.
   */
  seek(t: number): Promise<void>
}

/**
 * Loads every bundled face explicitly (Cairo and Tajawal at 900/700/400); `fonts.check` alone is
 * true when no face matches at all, so each `load` must return at least one face.
 */
async function ensureFonts(): Promise<void> {
  for (const font of REQUIRED_FONTS) {
    const faces = await document.fonts.load(font)
    if (faces.length === 0) throw new Error(`font not available: ${font} (no matching @font-face loaded)`)
  }
  await document.fonts.ready
  for (const font of REQUIRED_FONTS) {
    if (!document.fonts.check(font)) throw new Error(`font not ready: ${font}`)
  }
}

/** Deterministic per-scene seed derived from the storyboard seed and the scene index. */
function sceneSeed(seed: number, index: number): number {
  return (Math.imul(seed, 0x9e3779b1) + index) >>> 0
}

/** Deterministic per-transition seed, disjoint from the scene seeds' usual range. */
function trSeed(seed: number, index: number): number {
  return (Math.imul(seed ^ 0x5bd1e995, 0x85ebca6b) + 0x10000 + index) >>> 0
}

/** Layer style properties owned by the stage and transitions; reset to '' on every seek. */
const LAYER_FX = ['transform', 'filter', 'clipPath', 'opacity', 'transformOrigin'] as const
/** The colour custom properties a `twoWorlds` transition's sides get on their layers (removed on every seek). */
const WORLD_VARS = ['--mba-bg', '--mba-fg', '--mba-accent'] as const

/**
 * Builds the frame inside `root` (sized to FORMAT_SIZE, background = the look's bg variable), one layer per
 * scene, and one paused master timeline. Nothing moves unless `seek` is called.
 *
 * Z-order (tracks): scene layers sit in DOM order sorted by (track, storyboard index), so a higher
 * track draws above a lower one and, inside a track, a later scene above an earlier one. Each
 * transition's overlay sits right after the last layer of its own track (after earlier overlays of
 * that track): it covers its track and the ones below, never a higher track (e.g. captions above
 * the user's video stay visible through a cut's transition).
 *
 * Camera (Plan 2a+ Task 6): with `sb.camera`, the layers and overlays of every track outside
 * `camera.fixedTracks` sit inside a world wrapper (`#mba-world`; one wrapper per contiguous run of
 * camera tracks, so the track order above holds across fixed tracks), and every seek writes
 * `cameraTransform(cameraAt(camera, t))` on each wrapper before any scene update. Without
 * `sb.camera` there is no wrapper and nothing changes.
 *
 * Living camera (Plan 3 Task 4): a layer under the camera with a scene `depth` ≠ 1 (and an overlay
 * whose incoming scene has one) sits in its own wrapper (`data-mba-depth`), split off from the run
 * so the track order still holds; every wrapper gets `cameraTransform(poseAtDepth(pose, d), size,
 * jitter × d)` with the handheld / shake jitter (`cameraJitter`). Depth-1 layers keep `#mba-world`
 * (the jitter applies there); fixed tracks get no jitter. `toThisSpace` maps through the same
 * depth and jitter.
 *
 * Two worlds (Plan 3 Task 6, `TransitionBuilt.twoWorlds`, i.e. reveal): over the window every layer
 * of both sides of the cut (`TransitionCtx.inLayers` / `outLayers`) shows, each side's layers carry
 * that side's backdrop world as `--mba-*` (written before any scene update, removed on every seek
 * like `LAYER_FX`), the overlay keeps the outgoing world's colours, and the frame root holds the
 * outgoing world for p < 0.5 and the incoming one from 0.5 (re-asserted after every side scene's
 * update, so canvases on other layers read it). Without such a transition nothing of this runs.
 */
export async function createStage(root: HTMLElement, sb: Storyboard): Promise<Stage> {
  await ensureFonts()

  const size = FORMAT_SIZE[sb.format]
  const safe = safeRect(sb.format)
  const look = getLook(sb.look, sb.brand)
  const duration = storyboardDuration(sb)

  Object.assign(root.style, {
    position: 'relative',
    width: `${size.w}px`,
    height: `${size.h}px`,
    overflow: 'hidden',
    background: look.vars.bg,
    color: look.vars.fg,
    fontFamily: look.fontBody,
  })
  // The frame's colours are CSS variables (`look.vars`): the look's own until a backdrop world says otherwise.
  applyLookVars(root, look)
  root.replaceChildren()

  // Never let the ticker advance anything: all state comes from explicit seeks.
  gsap.ticker.lagSmoothing(0)
  // GSAP's default force3D "auto" writes translate3d() while a tween is mid-way and 2D at its ends,
  // so elements get composited layers only at some times. Chromium's layer state then depends on
  // seek history and timing, and text in those elements rasterizes a sub-pixel apart (caught by
  // `mba verify`). All GSAP transforms stay 2D; 3D must be opted into explicitly and verified.
  gsap.config({ force3D: false })
  const master = gsap.timeline({ paused: true })
  // Scene preroll (R27): a scene's timeline is placed so its local time `preroll` lines up with the
  // scene start, i.e. at start − preroll. That can be before 0 (a prerolled first scene), so every
  // child sits `offset` later on the master and the master is sought at t + offset. With no preroll
  // reaching before 0, offset is 0 and the master is exactly as before.
  const offset = Math.max(0, ...sb.scenes.map((sc) => (sc.preroll ?? 0) - sc.start))

  const scenes: { start: number; end: number; preroll: number; track: number; layer: HTMLElement; built: Built }[] = []

  // The camera's world wrappers: one per contiguous run (in z-order) of nodes under the camera that
  // share a track run (tracks between two fixed tracks) and a depth.
  const camera = sb.camera
  const fixed = new Set(camera?.fixedTracks ?? CAMERA.fixedTracks)
  /** True when layers of `track` are under the camera (inside a world wrapper). */
  const underCamera = (track: number): boolean => camera !== undefined && !fixed.has(track)
  /** The camera depth a node of `track` follows (scene `depth`, default 1); undefined: not under the camera. */
  const depthOf = (track: number, depth: number | undefined): number | undefined => (underCamera(track) ? (depth ?? 1) : undefined)
  /** The run of camera tracks `track` belongs to: from just above the fixed track below to just below the one above. */
  const runOf = (track: number): { lo: number; hi: number } => {
    let lo = track
    let hi = track
    while (lo - 1 >= 0 && !fixed.has(lo - 1)) lo--
    while (hi + 1 <= MAX_TRACK && !fixed.has(hi + 1)) hi++
    return { lo, hi }
  }
  /** Every layer and overlay, in z-order: by track, then insertion order. */
  const placed: { el: HTMLElement; track: number; depth: number | undefined }[] = []
  type World = { lo: number; hi: number; depth: number; el: HTMLElement }
  let worlds: World[] = []
  /** Puts `parent`'s children in the order `want`, moving only the nodes out of place. */
  const order = (parent: HTMLElement, want: HTMLElement[]): void => {
    let cur = parent.firstElementChild
    for (const n of want) {
      if (n === cur) cur = cur.nextElementSibling
      else parent.insertBefore(n, cur)
    }
  }
  /**
   * Lays out `placed` in the DOM: a node of a fixed track goes straight into the frame; consecutive
   * nodes under the camera with the same run and depth share a wrapper (`data-mba-world="lo-hi"`;
   * depth ≠ 1 adds `data-mba-depth`). Without any depth ≠ 1 that is exactly one wrapper per run of
   * camera tracks, as before. Depth-1 wrappers are `#mba-world`, `#mba-world-2`, … in z-order: a
   * later one is the run above a fixed track, or a later slice of the SAME camera run split off by a
   * depth wrapper between its nodes (e.g. depth-1 track 0, a depth-0.3 layer, then depth-1 track 1).
   */
  const arrange = (): void => {
    type Group = { lo: number; hi: number; depth: number; nodes: HTMLElement[]; world?: World }
    const seq: (HTMLElement | Group)[] = []
    for (const n of placed) {
      if (n.depth === undefined) {
        seq.push(n.el)
        continue
      }
      const last = seq.at(-1)
      const run = runOf(n.track)
      if (last && !(last instanceof HTMLElement) && last.lo === run.lo && last.depth === n.depth) last.nodes.push(n.el)
      else seq.push({ ...run, depth: n.depth, nodes: [n.el] })
    }
    const groups = seq.filter((g): g is Group => !(g instanceof HTMLElement))
    const free = new Set(worlds)
    const same = (w: World, g: Group) => free.has(w) && w.lo === g.lo && w.depth === g.depth
    for (const g of groups) {
      // Keep a group in the wrapper that already holds its first node, when it can.
      let w = worlds.find((x) => same(x, g) && g.nodes.some((n) => n.parentElement === x.el)) ?? worlds.find((x) => same(x, g))
      if (!w) {
        const el = document.createElement('div')
        el.dataset.mbaWorld = `${g.lo}-${g.hi}`
        if (g.depth !== 1) el.dataset.mbaDepth = String(g.depth)
        Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: `${size.w}px`, height: `${size.h}px`, transformOrigin: '0 0' })
        w = { lo: g.lo, hi: g.hi, depth: g.depth, el }
      }
      free.delete(w)
      g.world = w
    }
    order(
      root,
      seq.map((g) => (g instanceof HTMLElement ? g : g.world!.el)),
    )
    for (const g of groups) order(g.world!.el, g.nodes)
    for (const w of free) w.el.remove()
    worlds = groups.map((g) => g.world!)
    let k1 = 0
    let kd = 0
    for (const w of worlds) {
      if (w.depth === 1) w.el.id = k1++ === 0 ? 'mba-world' : `mba-world-${k1}`
      else w.el.id = `mba-depth-${++kd}`
    }
  }
  /**
   * Inserts a layer or overlay of `track` (scene depth `depth`): z-order by track, after the nodes
   * already placed on it; then lays out the wrappers.
   */
  const insertOnTrack = (node: HTMLElement, track: number, depth: number | undefined): void => {
    const at = placed.findIndex((p) => p.track > track)
    placed.splice(at < 0 ? placed.length : at, 0, { el: node, track, depth: depthOf(track, depth) })
    arrange()
  }

  /** Parsed params of every scene, on demand (`sceneParams` reads scenes not built yet). */
  const parsedParams = new Map<number, Record<string, unknown>>()
  const paramsOf = (i: number): Record<string, unknown> => {
    let p = parsedParams.get(i)
    if (!p) {
      const sc = sb.scenes[i]!
      p = (hasPrimitive(sc.type) ? parseSceneParams(getPrimitive(sc.type).params, i, sc.params) : sc.params) as Record<string, unknown>
      parsedParams.set(i, p)
    }
    return p
  }
  /** `Built.exports` by scene id (set once each scene is built). */
  const exportsOf = new Map<string, unknown>()
  const transitions: {
    outIdx: number
    inIdx: number
    track: number
    cut: number
    a: number
    b: number
    d: number
    overlay: HTMLElement
    built: TransitionBuilt
    /** Scene indices of each side of the cut (see TransitionCtx.inLayers) and the world each side shows. */
    outSide: number[]
    inSide: number[]
    worlds: { out: WorldColours; in: WorldColours }
  }[] = []
  /** The matrix of the camera wrapper holding `el` (identity outside any wrapper or before the first seek). */
  const wrapperMatrix = (el: HTMLElement): DOMMatrix => {
    const w = el.parentElement
    const tf = w && w.dataset.mbaWorld !== undefined ? w.style.transform : ''
    return tf ? new DOMMatrix(tf) : new DOMMatrix()
  }
  /**
   * The colour world in force just before (`out`) / just after (`in`) the cut at `cut`: the last
   * backdrop in storyboard order shown there (the root rule of `backdrop.update`), else the look.
   */
  const worldAround = (cut: number, side: 'out' | 'in'): WorldColours => {
    let w: WorldColours = { bg: look.bg, fg: look.fg, accent: look.accent }
    sb.scenes.forEach((sc, j) => {
      if (sc.type !== 'backdrop') return
      const end = sc.start + sc.duration
      const shows =
        side === 'out' ? sc.start < cut - CUT_TOLERANCE && end >= cut - CUT_TOLERANCE : sc.start <= cut + CUT_TOLERANCE && end > cut + CUT_TOLERANCE
      if (shows) w = worldOf(look, resolveWorld(look, (paramsOf(j) as BackdropParams).world))
    })
    return w
  }
  /** Draws scene `idx` at absolute `t` (build-time measuring for transitions; see TransitionCtx.pose). */
  const pose = async (idx: number, t: number): Promise<void> => {
    master.seek(t + offset, true)
    const s = scenes[idx]!
    const r = s.built.update?.(t - s.start + s.preroll)
    if (r) await r
  }
  try {
    for (const [i, sc] of sb.scenes.entries()) {
      if (!hasPrimitive(sc.type)) {
        throw new StoryboardError(`scenes[${i}].type`, `scene type "${sc.type}" has no registered primitive yet`)
      }
      const prim = getPrimitive(sc.type)
      // Same rules and `scenes[i].params.<field>` paths as the Node-side check (core/params).
      const params = paramsOf(i)

      const layer = document.createElement('div')
      layer.dataset.mbaScene = sc.id
      // The audit scopes its window skip by track (data-mba-tr-track).
      layer.dataset.mbaTrack = String(trackOf(sc))
      layer.dir = sb.dir
      Object.assign(layer.style, { position: 'absolute', inset: '0', visibility: 'hidden' })
      // Scenes are visited in storyboard order, so inserting before the first layer of a higher
      // track keeps the DOM sorted by (track, index).
      insertOnTrack(layer, trackOf(sc), sc.depth)

      const preroll = sc.preroll ?? 0
      /** The first element matching `selector` in an earlier built scene shown over the whole of this one. */
      const inCoveringScene = (selector: string): HTMLElement | null => {
        for (const s of scenes) {
          if (!covers({ start: s.start, duration: s.end - s.start }, sc)) continue
          const el = s.layer.querySelector<HTMLElement>(selector)
          if (el) return el
        }
        return null
      }
      /** The first element matching `selector` in an earlier built scene overlapping this one (Task 6). */
      const inOverlappingScene = (selector: string): HTMLElement | null => {
        for (const s of scenes) {
          if (!(s.start < sc.start + sc.duration && sc.start < s.end)) continue
          const el = s.layer.querySelector<HTMLElement>(selector)
          if (el) return el
        }
        return null
      }
      const selfStart = sc.start
      const built = await prim.build(
        {
          layer,
          size: { ...size },
          safe: { ...safe },
          look,
          ...(sb.brand ? { brand: sb.brand } : {}),
          rng: rng(sceneSeed(sb.seed, i)),
          dir: sb.dir,
          fps: sb.fps,
          // The primitive sees a scene of length duration + preroll (its local 0 is `preroll` before
          // the scene start), so its exit still lands exactly at start + duration.
          duration: sc.duration + preroll,
          keyed: (key, field) => {
            const el = inCoveringScene(`[data-mba-key="${CSS.escape(key)}"]`)
            if (el) return el
            throw new StoryboardError(
              `scenes[${i}].params.${field}`,
              `لا يوجد مشهد سابق يغطي مدة المشهد كلها فيه العنصر ذو المفتاح «${key}» — no earlier scene shown over this whole scene has an element with key "${key}"`,
            )
          },
          keyedWord: (n, field) => {
            const el = inCoveringScene(`[data-mba-word="${n}"]`)
            if (el) return el
            throw new StoryboardError(`scenes[${i}].params.${field}`, `لا توجد كلمة بالرقم ${n} معروضة طوال هذا المشهد — no word ${n} shown over this whole scene`)
          },
          keyedAny: (key, field) => {
            const el = inOverlappingScene(`[data-mba-key="${CSS.escape(key)}"]`)
            if (el) return el
            throw new StoryboardError(
              `scenes[${i}].params.${field}`,
              `لا يوجد مشهد سابق يتقاطع مع هذا المشهد فيه العنصر ذو المفتاح «${key}» — no earlier scene overlapping this one has an element with key "${key}"`,
            )
          },
          sceneParams: (id): SceneInfo | undefined => {
            const j = sb.scenes.findIndex((o) => o.id === id)
            if (j < 0) return undefined
            const o = sb.scenes[j]!
            const oStart = o.start
            const oEnd = o.start + o.duration
            const oPre = o.preroll ?? 0
            return {
              start: oStart,
              end: oEnd,
              params: paramsOf(j),
              localOf: (localT) => {
                // This scene's local time → absolute → the other scene's local time (same rule as `visible`).
                const abs = localT - preroll + selfStart
                const shows = (abs >= oStart && abs < oEnd) || (abs === duration && oEnd === duration)
                return shows ? abs - oStart + oPre : undefined
              },
              exports: () => exportsOf.get(id),
              toThisSpace: (pt, localT) => {
                // The depth each layer follows (undefined: a fixed track, i.e. the screen).
                const otherD = depthOf(trackOf(o), o.depth)
                const selfD = depthOf(trackOf(sc), sc.depth)
                if (!camera || otherD === selfD) return { x: pt.x, y: pt.y }
                // The camera of the frame this scene is drawing (the absolute time of `localT`),
                // seen at each layer's depth exactly as `apply` writes it on the wrappers.
                const abs = localT - preroll + selfStart
                const cam = cameraAt(camera, abs)
                const j = cameraJitter(camera, abs)
                const screen = otherD === undefined ? pt : cameraToScreen(poseAtDepth(cam, otherD), size, pt, jitterAtDepth(j, otherD))
                return selfD === undefined ? { x: screen.x, y: screen.y } : screenToCamera(poseAtDepth(cam, selfD), size, screen, jitterAtDepth(j, selfD))
              },
            }
          },
        },
        params,
      )
      if (built.timeline) {
        if (!built.timeline.paused()) {
          throw new StoryboardError(`scenes[${i}].type`, `primitive "${sc.type}" returned a timeline that is not paused`)
        }
        // Children of the paused master must themselves play so the master can render them.
        built.timeline.paused(false)
        master.add(built.timeline, sc.start - preroll + offset)
      }
      scenes.push({ start: sc.start, end: sc.start + sc.duration, preroll, track: trackOf(sc), layer, built })
      if (built.exports !== undefined) exportsOf.set(sc.id, built.exports)
    }
    // Transitions: one overlay each, right above the last layer of its track (below every higher
    // track); overlays of one track stay in storyboard order.
    const allJoins = (sb.transitions ?? []).map((tr) => transitionCut(sb.scenes, tr))
    for (const [i, tr] of (sb.transitions ?? []).entries()) {
      // The cut is looked up on the transition's track only (same rule as parseStoryboard).
      const joins = allJoins[i]!
      const outIdx = joins.outs[0] ?? -1
      const inIdx = joins.ins[0] ?? -1
      if (outIdx < 0 || inIdx < 0) throw new StoryboardError(`transitions[${i}].at`, `transition at ${tr.at}s is not on a cut on track ${trackOf(tr)}`)
      const fx = getTransition(tr.type)
      const r = fx.params.safeParse(tr.params)
      if (!r.success) throw new StoryboardError(`transitions[${i}].params`, r.error.issues[0]!.message)
      const overlay = document.createElement('div')
      overlay.dataset.mbaTrOverlay = tr.type
      Object.assign(overlay.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', visibility: 'hidden' })
      // Under the camera the overlay follows its incoming scene's depth (it draws over that layer).
      insertOnTrack(overlay, trackOf(tr), sb.scenes[inIdx]!.depth)
      // The window is centred on the incoming scene's start (equal to `at` within CUT_TOLERANCE), so
      // the cut is exactly p = 0.5; during the window `apply` shows the outgoing layer only for
      // p < 0.5 and the incoming only for p >= 0.5 (unless the transition keeps both), whatever the
      // scenes' own ends say.
      const cut = sb.scenes[inIdx]!.start
      const a = cut - tr.duration / 2
      const b = cut + tr.duration / 2
      // The two worlds of the cut: the joined scenes, plus every lower-track scene ending / starting
      // at it that no other transition joins (TransitionCtx.inLayers).
      const taken = new Set(allJoins.flatMap((j, k) => (k === i ? [] : [...j.outs, ...j.ins])))
      const lowerAt = (edge: (sc: (typeof sb.scenes)[number]) => number): number[] =>
        sb.scenes.flatMap((sc, j) => (trackOf(sc) < trackOf(tr) && !taken.has(j) && Math.abs(edge(sc) - tr.at) <= CUT_TOLERANCE ? [j] : []))
      const outSide = [outIdx, ...lowerAt((sc) => sc.start + sc.duration)]
      const inSide = [inIdx, ...lowerAt((sc) => sc.start)]
      const built = await fx.build(
        {
          overlay,
          out: scenes[outIdx]!.layer,
          in: scenes[inIdx]!.layer,
          size: { ...size },
          look,
          rng: rng(trSeed(sb.seed, i)),
          duration: tr.duration,
          dir: sb.dir,
          index: i,
          outId: sb.scenes[outIdx]!.id,
          inId: sb.scenes[inIdx]!.id,
          pose: (side) => (side === 'out' ? pose(outIdx, a) : pose(inIdx, b)),
          inLayers: inSide.map((j) => scenes[j]!.layer),
          outLayers: outSide.map((j) => scenes[j]!.layer),
          toLayer: (el) => wrapperMatrix(el).inverse().multiply(wrapperMatrix(overlay)),
        },
        r.data,
      )
      const worlds = { out: worldAround(cut, 'out'), in: worldAround(cut, 'in') }
      transitions.push({ outIdx, inIdx, track: trackOf(tr), cut, a, b, d: tr.duration, overlay, built, outSide, inSide, worlds })
    }
  } catch (e) {
    master.kill()
    root.replaceChildren()
    throw e
  }

  /**
   * Shows or hides a scene layer or a transition overlay. Hidden means `display: none`, not only
   * `visibility: hidden`. Updates run only for visible scenes and live transitions, so a hidden
   * layer keeps whatever was last written into it, which depends on seek history. With visibility
   * alone that stale subtree stayed in layout and paint, and it changed how Chromium rasterized the
   * visible scene: in the 1:1 demo, one earlier seek into search-typing's camera zoom (2.0–3.75 s)
   * moved an outro underline edge pixel by one level at 7.767 s (`mba verify` cold ≠ warm; Task 7
   * fix round 4). `display: none` takes it out of layout, paint and compositing, so only visible
   * DOM, a pure function of t, reaches the pixels. Layers are built with visibility only, so
   * primitives can still measure text at build time.
   */
  const hide = (el: HTMLElement, hidden: boolean): void => {
    el.style.visibility = hidden ? 'hidden' : 'visible'
    el.style.display = hidden ? 'none' : ''
  }

  /** Draws the frame at `t`; awaits only the updates that return a promise. */
  const apply = async (t: number): Promise<void> => {
    const tt = Math.min(Math.max(t, 0), duration)
    // suppressEvents = true: .call()/onStart/onComplete/onUpdate never fire on seek, because
    // they would fire only when the playhead crosses them, making a frame depend on seek history.
    master.seek(tt + offset, true)
    // 0. The look's colours; a visible backdrop's update (3) overrides them with its world's.
    applyLookVars(root, look)
    // The camera (pure in t), before any scene update, so an update that measures sees this frame's world.
    // Each wrapper follows the pose at its depth and the jitter × depth (depth 1: the camera itself).
    if (camera) {
      const pose = cameraAt(camera, tt)
      const j = cameraJitter(camera, tt)
      for (const w of worlds) w.el.style.transform = cameraTransform(poseAtDepth(pose, w.depth), size, jitterAtDepth(j, w.depth))
    }
    // 1. Nothing a transition wrote outlives its window: reset the layers, hide every overlay.
    for (const s of scenes) for (const k of LAYER_FX) s.layer.style[k] = ''
    for (const tr of transitions) {
      hide(tr.overlay, true)
      tr.built.reset?.()
      if (tr.built.twoWorlds) {
        for (const j of [...tr.outSide, ...tr.inSide]) for (const v of WORLD_VARS) scenes[j]!.layer.style.removeProperty(v)
        for (const v of WORLD_VARS) tr.overlay.style.removeProperty(v)
      }
    }
    // 2. Which scenes show. Normally each scene's own [start, end). Inside an active transition
    // window the transition's p decides for its own two layers (its out/in scenes on its track; every
    // other scene, on any track, keeps its own window) instead: outgoing only for p < 0.5,
    // incoming only for p >= 0.5 (both over the whole window for a `bothVisible` transition, i.e. morph). Validation lets the cut differ from the scenes' end/start by up to
    // CUT_TOLERANCE (and float sums such as 0.1 + 0.2 do), so without this the outgoing layer could
    // stay visible, untransformed, under the incoming one at the cut, or both could be hidden.
    const visible = scenes.map((s) => (tt >= s.start && tt < s.end) || (tt === duration && s.end === duration))
    const live: { tr: (typeof transitions)[number]; p: number }[] = []
    /** Scenes on either side of a live `twoWorlds` transition. */
    const sideScenes = new Set<number>()
    for (const tr of transitions) {
      if (tt < tr.a || tt > tr.b) continue
      // p = (t − (at − d/2)) / d, computed from the cut so the cut itself is exactly 0.5 (no float
      // drift); the window's own edges are exactly 0 and 1 (2.3 − 2 = 0.2999… would give p < 1).
      const p = tt <= tr.a ? 0 : tt >= tr.b ? 1 : Math.min(Math.max(0.5 + (tt - tr.cut) / tr.d, 0), 1)
      visible[tr.outIdx] = tr.built.bothVisible === true || p < 0.5
      visible[tr.inIdx] = tr.built.bothVisible === true || p >= 0.5
      live.push({ tr, p })
      if (!tr.built.twoWorlds) continue
      // Both worlds whole: every layer of each side shows, in its own colours (written before any
      // update, so canvases read them); a backdrop's root write does not reach these layers.
      for (const j of [...tr.outSide, ...tr.inSide]) visible[j] = true
      for (const j of tr.outSide) applyLookVars(scenes[j]!.layer, tr.worlds.out)
      for (const j of tr.inSide) applyLookVars(scenes[j]!.layer, tr.worlds.in)
      // The edge (ring, band edges, panel line) keeps the outgoing world's colours over the whole window.
      applyLookVars(tr.overlay, tr.worlds.out)
      for (const j of [...tr.outSide, ...tr.inSide]) sideScenes.add(j)
    }
    // Every other layer (and the root background) flips world at the cut, as it would without the
    // reveal (the root holds the cut-side world before any update and again after each side
    // scene's update, as a side backdrop writes its own world to the root), so a canvas outside both
    // sides reads the right world whatever the update order.
    const cutSideRoot = (): void => {
      for (const { tr, p } of live) if (tr.built.twoWorlds) applyLookVars(root, p < 0.5 ? tr.worlds.out : tr.worlds.in)
    }
    cutSideRoot()
    // 3. Scenes: visibility and update.
    for (const [i, s] of scenes.entries()) {
      hide(s.layer, !visible[i])
      if (visible[i]) {
        // Local time includes the preroll; the layer is still shown only from `start` (see `visible`).
        const r = s.built.update?.(tt - s.start + s.preroll)
        if (r) await r
        if (sideScenes.has(i)) cutSideRoot()
      }
    }
    // 4. Active transitions (t in [cut − d/2, cut + d/2]), in storyboard order; each overlay's DOM
    // position puts it above its track and the lower ones, below every higher track.
    for (const { tr, p } of live) {
      hide(tr.overlay, false)
      tr.built.update(p)
    }
    const active = live.length > 0
    // Marks frames inside a transition window (audits rely on it); set or cleared on every seek.
    // `data-mba-tr-track` is the highest track with a live transition; its overlay covers that
    // track and the ones below, so the audit's window skip applies to those layers only.
    if (active) {
      root.dataset.mbaTr = '1'
      root.dataset.mbaTrTrack = String(Math.max(...live.map((l) => l.tr.track)))
    } else {
      delete root.dataset.mbaTr
      delete root.dataset.mbaTrTrack
    }
  }

  // Latest-wins seek queue: at most one `apply` runs; `pendingT` holds the newest waiting time
  // and `waiters` every caller that will be settled when that time has been drawn.
  let draining = false
  let pendingT: number | undefined
  let waiters: { resolve: () => void; reject: (e: unknown) => void }[] = []
  const drain = async (): Promise<void> => {
    draining = true
    try {
      while (pendingT !== undefined) {
        const t = pendingT
        const batch = waiters
        pendingT = undefined
        waiters = []
        try {
          await apply(t)
          for (const w of batch) w.resolve()
        } catch (e) {
          for (const w of batch) w.reject(e)
        }
      }
    } finally {
      draining = false
    }
  }

  return {
    duration,
    seek(t: number): Promise<void> {
      if (!Number.isFinite(t)) return Promise.reject(new Error(`seek: time must be a finite number, got ${t}`))
      return new Promise<void>((resolve, reject) => {
        pendingT = t
        waiters.push({ resolve, reject })
        if (!draining) void drain()
      })
    },
  }
}
