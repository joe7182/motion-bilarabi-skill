import { defaultTransitionDuration } from '../core/params/transitions'
import { PACK_PRESET } from './preset'
import type { Pack } from './schema'

type Raw = Record<string, unknown>
type Scene = { id: string; type: string; track?: number; start: number; duration: number; params: Raw }

const r3 = (n: number) => Math.round(n * 1000) / 1000
const MAX_TRACK = 9

/** What a pack fills on one scene that left it open: a headline's edge and entrance. Never its type, text, times or place. */
export function dressScene<T extends { type: string; params: Record<string, unknown> }>(sc: T, pack: Pack): T {
  if (sc.type !== 'kinetic-text' || sc.params.mode === 'giant') return sc
  const fill: Raw = {}
  if (sc.params.align === undefined && pack.layout.headline.align !== 'centre') fill.align = pack.layout.headline.align
  if (sc.params.enter === undefined) fill.enter = pack.motion.enter
  return Object.keys(fill).length ? { ...sc, params: { ...sc.params, ...fill } } : sc
}

/**
 * Puts a pack on any storyboard (raw JSON), filling only what the storyboard left open:
 * `pack` (and `look` when absent); a headline's edge and entrance when the scene names none; the
 * pack background wherever track 0 is empty; the pack's transition on a cut that has none; its frame
 * marks when the storyboard has none; motion blur when unset. It never changes a scene's type, text,
 * times or place, so running it on its own result changes nothing.
 */
export function dressStoryboard(raw: Raw, pack: Pack): { storyboard: Raw; changes: string[] } {
  const sb = structuredClone(raw) as Raw
  const changes: string[] = []
  if (sb.pack !== pack.id) {
    sb.pack = pack.id
    changes.push(`pack: ${pack.id}`)
  }
  if (sb.look === undefined) {
    sb.look = pack.look
    changes.push(`look: ${pack.look}`)
  }
  let scenes = ((sb.scenes as Scene[]) ?? []).map((sc) => {
    const d = dressScene(sc, pack)
    if (d !== sc) changes.push(`${sc.id}: headline edge and entrance`)
    return d
  })
  if (pack.motion.blur && sb.motionBlur === undefined) {
    sb.motionBlur = { samples: pack.motion.blur, shutter: 180 }
    changes.push('motion blur')
  }

  // The rest needs times in seconds (a file may still hold word anchors).
  const timed = scenes.length > 0 && scenes.every((s) => typeof s.start === 'number' && typeof s.duration === 'number')
  if (!timed) {
    if (scenes.length) changes.push('times are word anchors: background, transitions and marks were left alone')
    sb.scenes = scenes
    return { storyboard: sb, changes }
  }
  const end = Math.max(...scenes.map((s) => s.start + s.duration))
  const ids = new Set(scenes.map((s) => s.id))
  const fresh = (base: string) => {
    let id = base
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
    ids.add(id)
    return id
  }

  // Background wherever track 0 is empty.
  const floor = scenes.filter((s) => (s.track ?? 0) === 0).sort((a, b) => a.start - b.start)
  const gaps: { a: number; b: number }[] = []
  let cursor = 0
  for (const s of floor) {
    if (s.start - cursor > 0.02) gaps.push({ a: cursor, b: s.start })
    cursor = Math.max(cursor, s.start + s.duration)
  }
  if (end - cursor > 0.02) gaps.push({ a: cursor, b: end })
  const added: Scene[] = []
  for (const g of gaps) for (const b of pack.background) added.push({ id: fresh('pack-bg'), type: b.type, track: 0, start: r3(g.a), duration: r3(g.b - g.a), params: { ...b.params } })
  if (added.length) changes.push(`background: ${pack.background.map((b) => b.type).join(' + ')} (${gaps.length}×)`)

  // The pack's transition on every cut that has none (a morph needs keyed scenes: use the next one).
  const type = [pack.transitions.default, ...pack.transitions.more, pack.transitions.section].find((t) => t !== 'morph')!
  const transitions = [...((sb.transitions as { at: number; duration?: number; track?: number }[]) ?? [])]
  const cuts = new Map<number, { track: number; shortest: number }>()
  for (let track = MAX_TRACK; track >= 1; track--) {
    const on = scenes.filter((s) => (s.track ?? 0) === track)
    for (const a of on) {
      const at = r3(a.start + a.duration)
      if (cuts.has(at)) continue
      const outs = on.filter((s) => Math.abs(s.start + s.duration - at) <= 0.002)
      const ins = on.filter((s) => Math.abs(s.start - at) <= 0.002)
      if (outs.length === 1 && ins.length === 1 && outs[0] !== ins[0]) cuts.set(at, { track, shortest: Math.min(outs[0]!.duration, ins[0]!.duration) })
    }
  }
  let addedCuts = 0
  for (const [at, cut] of [...cuts].sort((a, b) => a[0] - b[0])) {
    const near = (t: { at: number; duration?: number }) => Math.abs(t.at - at) < (t.duration ?? 0.6) / 2 + 0.3
    if (transitions.some(near)) continue
    const duration = r3(Math.min(defaultTransitionDuration(type), cut.shortest * PACK_PRESET.transitionShare))
    if (duration < PACK_PRESET.minTransition) continue
    transitions.push({ type, at, duration, track: cut.track, params: {} } as never)
    addedCuts++
  }
  if (addedCuts) {
    sb.transitions = transitions
    changes.push(`transitions: ${type} on ${addedCuts} cut(s)`)
  }

  // Frame marks, on a free track, when the storyboard has none.
  if (pack.marks && !scenes.some((s) => s.type === 'frame-marks')) {
    const used = new Set(scenes.map((s) => s.track ?? 0))
    const track = [PACK_PRESET.marksTrack, ...Array.from({ length: MAX_TRACK }, (_, i) => MAX_TRACK - i)].find((t) => t > 0 && !used.has(t))
    if (track !== undefined) {
      added.push({ id: fresh('pack-marks'), type: 'frame-marks', track, start: 0, duration: r3(end), params: structuredClone(pack.marks) as Raw })
      const cam = sb.camera as { fixedTracks?: number[] } | undefined
      if (cam) cam.fixedTracks = [...new Set([...(cam.fixedTracks ?? [5]), track])].sort((a, b) => a - b)
      changes.push('frame marks')
    }
  }

  scenes = [...added.filter((s) => s.track === 0), ...scenes, ...added.filter((s) => s.track !== 0)]
  sb.scenes = scenes
  return { storyboard: sb, changes }
}
