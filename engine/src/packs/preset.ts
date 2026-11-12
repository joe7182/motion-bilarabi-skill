import { defaultTransitionDuration, type TransitionId } from '../core/params/transitions'
import type { Section } from '../core/recipes/presets'
import type { Pack } from './schema'

type Scene = { id: string; type: string; track?: number; start: number; duration: number; preroll?: number; params: Record<string, unknown> }
type Raw = Record<string, unknown>

const r3 = (n: number) => Math.round(n * 1000) / 1000
const two = (n: number) => String(n).padStart(2, '0')

export const PACK_PRESET = {
  /** The classic preset layout these rules start from: a headline over a show, and a headline alone. */
  classicY: 0.25,
  classicCentredY: 0.45,
  /** A headline over a show never sits lower than this, whatever the pack (the show needs the room). */
  overShowMaxY: 0.3,
  /** A pack whose headline is this low is a "centred headline" pack: a headline alone uses the pack's own y. */
  centredFrom: 0.35,
  /** Over a show, a centred-headline pack keeps the classic height and at most this font px (the show needs the room). */
  overShowMaxPx: 190,
  /** Frame marks live on this (fixed) track; transitions are never put on it. */
  marksTrack: 1,
  /** A transition takes at most this share of the shorter scene it joins, and is dropped when shorter than `minTransition`. */
  transitionShare: 0.8,
  minTransition: 0.2,
  /** Camera kicks of a `pulse` pack on a beat grid: on each bar and on the other beats. */
  pulseBar: 0.03,
  pulseBeat: 0.012,
  /** Longest line of a laser-cut headline (characters), as `laser-type` takes it. */
  laserLine: 18,
  /** The object stage goes under these shows (small objects and words; never a screen, a chat or a search bar) on this track. */
  staged: ['type-stretch', 'letters-join', 'morph-object', 'kinetic-text', 'heavy-word', 'said-written', 'word-cut', 'counter', 'build-number', 'icon', 'line-art'],
  stageTrack: 2,
  /** A show of stacked words is placed by the frame (not the safe area) and runs taller: its stage sits here (safe-area fractions). */
  wordsStage: { y: 0.645, height: 0.44 },
  /** A laser headline that opens the video is already this far into its cut on frame 0 (never a blank first frame). */
  laserPreroll: 0.45,
} as const

/** The words of a `kinetic-text` headline with the pack's key-word mark instead of the classic box. */
function markWords(words: Raw[], mark: Pack['layout']['keyMark']): Raw[] {
  if (mark === 'box') return words
  return words.map((w) => {
    if (!w.box) return w
    const { box: _box, ...rest } = w
    return mark === 'underline' ? { ...rest, underline: true } : { ...rest, color: 'accent' }
  })
}

/** A centred headline as a laser-cut title (one or two lines), or undefined when a line would be too long. */
function laserHeadline(sc: Scene, pack: Pack): Scene | undefined {
  const words = (sc.params.words as { text: string; box?: boolean }[]) ?? []
  const texts = words.map((w) => w.text)
  const one = texts.join(' ')
  const lines = one.length <= PACK_PRESET.laserLine ? [one] : [texts.slice(0, Math.ceil(texts.length / 2)).join(' '), texts.slice(Math.ceil(texts.length / 2)).join(' ')]
  if (lines.some((l) => l.length === 0 || l.length > PACK_PRESET.laserLine)) return undefined
  return { id: sc.id, type: 'laser-type', track: sc.track, start: sc.start, duration: sc.duration, ...(sc.start === 0 ? { preroll: PACK_PRESET.laserPreroll } : {}), params: { ...pack.roles.headline.params, lines, accent: words.filter((w) => w.box).map((w) => w.text), at: 0.1 } }
}

/** The highest track (never the marks track) on which exactly one scene ends and one other starts at `at`. */
function cutTrack(scenes: Scene[], at: number): { track: number; shortest: number } | undefined {
  for (let track = 5; track >= 0; track--) {
    if (track === PACK_PRESET.marksTrack) continue
    const on = scenes.filter((s) => (s.track ?? 0) === track)
    const outs = on.filter((s) => Math.abs(s.start + s.duration - at) <= 0.002)
    const ins = on.filter((s) => Math.abs(s.start - at) <= 0.002)
    if (outs.length === 1 && ins.length === 1 && outs[0] !== ins[0]) return { track, shortest: Math.min(outs[0]!.duration, ins[0]!.duration) }
  }
  return undefined
}

/**
 * Puts a pack on a storyboard a preset has just built (classic layout): the headline's place, edge,
 * entrance and key-word mark; the pack's background; its frame marks per section (instead of the
 * chapter bar); a transition on every section cut; motion blur and beat kicks. Pure: returns a new
 * storyboard object.
 */
export function dressPreset(sb: Raw, secs: Section[], pack: Pack, opts: { beat?: { bpm: number; offset: number } } = {}): Raw {
  const L = pack.layout
  const end = secs.at(-1)!.end
  let scenes = (sb.scenes as Scene[]).map((sc) => ({ ...sc }))

  // Headlines.
  scenes = scenes.map((sc) => {
    if (!sc.id.endsWith('-h') || sc.type !== 'kinetic-text') return sc
    const alone = sc.params.y === PACK_PRESET.classicCentredY
    if (alone && pack.roles.headline.type === 'laser-type') {
      const laser = laserHeadline(sc, pack)
      if (laser) return laser
    }
    const centredPack = L.headline.y >= PACK_PRESET.centredFrom
    const y = alone ? (centredPack ? L.headline.y : PACK_PRESET.classicCentredY) : centredPack ? PACK_PRESET.classicY : Math.min(L.headline.y, PACK_PRESET.overShowMaxY)
    const maxPx = !alone && centredPack ? Math.min(L.headline.maxPx, PACK_PRESET.overShowMaxPx) : L.headline.maxPx
    return { ...sc, params: { ...sc.params, y, align: L.headline.align, enter: pack.motion.enter, maxPx, words: markWords(sc.params.words as Raw[], L.keyMark) } }
  })

  // Background: a pack with a backdrop keeps every section in that colour world (the look stays itself:
  // cream stays cream); a pack without one lays its background once, under everything.
  const backdrop = pack.background.find((b) => b.type === 'backdrop')
  if (backdrop) {
    scenes = scenes.map((sc) => (sc.type === 'backdrop' && sc.id.endsWith('-bg') ? { ...sc, params: { ...sc.params, ...backdrop.params } } : sc))
    // Its other background layers lie over the backdrops for the whole video; a layer that re-arranges does so at each section.
    pack.background.filter((b) => b.type !== 'backdrop').forEach((b, i) => {
      const shifts = b.type === 'paper-shapes' ? { shifts: secs.slice(1).map((s) => r3(s.start)) } : {}
      scenes.push({ id: `pack-bg${i + 1}`, type: b.type, track: 0, start: 0, duration: r3(end), params: { ...b.params, ...shifts } })
    })
  } else {
    scenes = scenes.filter((sc) => !(sc.type === 'backdrop' && sc.id.endsWith('-bg')))
    scenes.unshift(...pack.background.map((b, i) => ({ id: `pack-bg${i + 1}`, type: b.type, track: 0, start: 0, duration: r3(end), params: { ...b.params } })))
  }

  // Frame marks per section; they carry the section index, so the chapter bar goes.
  if (pack.marks) {
    scenes = scenes.filter((sc) => sc.type !== 'chapter-bar')
    const m = pack.marks as { tag?: Raw; number?: Raw }
    secs.forEach((sec, i) => {
      const label = sec.bar?.label ?? sec.badge?.title
      const text = `${two(i + 1)}${label ? ` / ${label}` : ''}`.slice(0, 28)
      scenes.push({
        id: `${sec.id}-marks`, type: 'frame-marks', track: PACK_PRESET.marksTrack, start: r3(sec.start), duration: r3(sec.end - sec.start),
        params: { ...pack.marks, ...(m.tag ? { tag: { ...m.tag, text } } : {}), ...(m.number ? { number: { ...m.number, value: i + 1 } } : {}) },
      })
    })
  }

  // The pack's stage under each staged show, for as long as the show is up.
  if (pack.stage) {
    const { kind, ...place } = pack.stage
    for (const sec of secs) {
      const show = scenes.find((sc) => sc.id === `${sec.id}-show`)
      if (!show || !(PACK_PRESET.staged as readonly string[]).includes(show.type) || show.params.mode === 'giant') continue
      const label = (sec.badge?.title ?? sec.headline.join(' ')).slice(0, 28)
      scenes.push({ id: `${sec.id}-frame`, type: 'object-frame', track: PACK_PRESET.stageTrack, start: show.start, duration: show.duration, params: { kind, ...(show.type === 'kinetic-text' ? PACK_PRESET.wordsStage : {}), ...place, ...(label ? { label } : {}) } })
    }
  }

  // A transition on every section cut: the section transition into the first and the last section,
  // the default one between. (A morph needs keyed scenes, which a preset does not have.)
  const usable = (t: TransitionId) => t !== 'morph'
  const between = [pack.transitions.default, ...pack.transitions.more].find(usable) ?? pack.transitions.section
  const outer = usable(pack.transitions.section) ? pack.transitions.section : between
  const transitions: Raw[] = []
  let lastEnd = -Infinity
  for (let i = 1; i < secs.length; i++) {
    const at = secs[i]!.start
    const cut = cutTrack(scenes, at)
    if (!cut) continue
    const type = i === 1 || i === secs.length - 1 ? outer : between
    const duration = r3(Math.min(defaultTransitionDuration(type), cut.shortest * PACK_PRESET.transitionShare, 2 * (at - lastEnd) - 0.02))
    if (duration < PACK_PRESET.minTransition) continue
    transitions.push({ type, at: r3(at), duration, track: cut.track, params: { ...pack.transitions.params?.[type] } })
    lastEnd = at + duration / 2
  }

  const camera = { ...(sb.camera as Raw) }
  if (pack.marks) camera.fixedTracks = [...new Set([...((camera.fixedTracks as number[]) ?? []), PACK_PRESET.marksTrack])].sort((a, b) => a - b)
  if (pack.motion.camera === 'pulse' && opts.beat) {
    const B = 60 / opts.beat.bpm
    const pulses: { at: number; amp: number }[] = []
    for (let n = 1; opts.beat.offset + n * B < end && pulses.length < 256; n++) pulses.push({ at: r3(opts.beat.offset + n * B), amp: n % 4 === 0 ? PACK_PRESET.pulseBar : PACK_PRESET.pulseBeat })
    if (pulses.length) camera.pulses = pulses
  }

  return {
    ...sb,
    look: pack.look,
    pack: pack.id,
    camera,
    ...(pack.motion.blur ? { motionBlur: { samples: pack.motion.blur, shutter: 180 } } : {}),
    scenes,
    ...(transitions.length ? { transitions } : {}),
  }
}
