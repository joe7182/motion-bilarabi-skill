import { groupCaptions } from '../params/captions'
import { normalizeAr, type Transcript } from '../transcript'
import { SAFE_AREA } from '../types'
import type { Pack } from '../../packs/schema'

/**
 * The talking-video kit: a clip of a person talking becomes a reel in a style pack — captions with
 * the key word marked, a punch-in on each key word, the key word popping beside the speaker, and a
 * name strip at the start. One take: the clip plays through, nothing is cut.
 */

type Raw = Record<string, unknown>
const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface TalkingPreset {
  preset: 'talking'
  pack?: string
  look: string
  /** The clip (a project video with the voice in it) and where it starts. */
  media: string
  in: number
  name?: string
  handle?: string
  /** Words to mark, as said (each a phrase from the voice); absent: picked from the transcript. */
  keywords?: { say: string; text?: string }[]
  captions: boolean
  punch: boolean
  popups: boolean
  motion?: 'easy' | 'snappy'
}

/** What a pack gives a talking video (absent pack: these). */
export interface TalkingStyle {
  captions: { skin: string; presentation: string; emph: 'accent' | 'underline' | 'pop' }
  punch: { zoom: number; ease: 'smooth' | 'linear' | 'cut' }
  popup: 'box' | 'underline' | 'colour'
  strip: 'card' | 'panel' | 'spot' | 'column' | 'arch' | 'blob' | 'glass'
}
export const DEFAULT_TALKING: TalkingStyle = {
  captions: { skin: 'spoken-box', presentation: 'pill', emph: 'pop' },
  punch: { zoom: 1.1, ease: 'smooth' },
  popup: 'box',
  strip: 'card',
}

export const TALKING = {
  /** The clip runs this long after the last word. */
  tail: 0.6,
  /** Auto-picked key words: at least this many letters, at least this far apart (s), about one per `every` s. */
  minLetters: 4,
  minGap: 2.6,
  every: 3.4,
  /** A punch-in: seconds to move in, to hold at the least, and to ease back. */
  punchIn: 0.32,
  punchHold: 1.0,
  punchOut: 0.5,
  /** A pop-up stays this long at most, and every `popupEvery`-th key word gets one. */
  popup: 1.7,
  popupEvery: 2,
  /** The name strip: in and out (s). */
  strip: { at: 0.5, out: 3.6 },
  /** Where the camera looks without a known face: the upper middle. */
  look: { x: 0.5, y: 0.4 },
  /** Text keeps this far from the face (frame fractions): the chin sits below the face box, a pop-up needs this much above the head. */
  chin: 0.05,
  clear: 0.035,
  popupHalf: 0.05,
  stripHalf: 0.045,
  /** The captions' band (their centre and half height), which the name strip stays above. */
  captions: { y: 0.74, half: 0.04 },
  /** Words too common to be a key word. */
  stop: ['اليوم', 'اليوم،', 'الحين', 'هسه', 'اللي', 'هذا', 'هذي', 'هاي', 'على', 'الى', 'إلى', 'عشان', 'لأن', 'لان', 'يعني', 'بعد', 'قبل', 'كان', 'كانت', 'عندي', 'عندك', 'لازم', 'ممكن', 'هناك', 'هنا', 'اذا', 'إذا', 'انت', 'إنت', 'احنا', 'شلون', 'ليش', 'وين', 'منو', 'شنو', 'مثل', 'حتى', 'لكن', 'بس'],
} as const

const letters = (w: string) => normalizeAr(w).replace(/[^\p{L}]/gu, '')

/** The key moments: the user's phrases (their last word), or the longest uncommon word of a phrase every few seconds. */
export function keyMoments(tr: Transcript, keywords: { say: string; text?: string }[] | undefined, find: (say: string, from: number) => number): { word: number; at: number; text: string }[] {
  if (keywords?.length) {
    let cur = 0
    return keywords.map((k) => {
      const first = find(k.say, cur)
      const last = first + k.say.trim().split(/\s+/).length - 1
      const w = tr.words[Math.min(last, tr.words.length - 1)]!
      cur = w.i + 1
      return { word: w.i, at: w.start, text: k.text ?? w.text }
    })
  }
  const stop = new Set(TALKING.stop.map((s) => letters(s)))
  const out: { word: number; at: number; text: string }[] = []
  for (const ph of groupCaptions(tr.words.map((w) => ({ text: w.text, at: w.start, end: w.end })))) {
    const last = out.at(-1)
    if (last && ph.at - last.at < TALKING.every) continue
    const best = ph.words
      .map((w) => ({ w, n: letters(w.text).length }))
      .filter((x) => x.n >= TALKING.minLetters && !stop.has(letters(x.w.text)) && !/\d/.test(x.w.text))
      .sort((a, b) => b.n - a.n)[0]
    if (!best || (last && best.w.at - last.at < TALKING.minGap)) continue
    const i = tr.words.findIndex((w) => Math.abs(w.start - best.w.at) < 1e-6 && w.text === best.w.text)
    out.push({ word: i, at: best.w.at, text: best.w.text.replace(/[.،؟?!,:]/g, '') })
  }
  return out
}

/** `preset.json` (talking) + transcript → storyboard JSON. `face`: the speaker's usual face box in the frame (0..1), when known. */
export function talkingStoryboard(i: { preset: TalkingPreset; pack?: Pack; style: TalkingStyle; transcript: Transcript; fps: number; seed: number; face?: [number, number, number, number]; clipSec?: number; find: (say: string, from: number) => number }): Raw {
  const { preset: p, transcript: tr, style: st } = i
  // The video ends a moment after the last word, and never after the clip itself.
  const end = r3(Math.min(tr.words.at(-1)!.end + TALKING.tail, i.clipSec === undefined ? Infinity : i.clipSec - p.in))
  const safe = SAFE_AREA['9:16']
  // The camera centre at a punch: toward the face, but never so far that an edge of the clip shows.
  const Z = p.punch ? st.punch.zoom : 1
  const hold = (c: number) => r3(Math.min(Math.max(c, 0.5 / Z), 1 - 0.5 / Z))
  const cx = hold(i.face ? (i.face[0] + i.face[2]) / 2 : TALKING.look.x)
  const cy = hold(i.face ? (i.face[1] + i.face[3]) / 2 : TALKING.look.y)
  // Where the head top and the chin are on screen at the punch (the face is at its largest then).
  const onScreen = (y: number) => 0.5 + (y - cy) * Z
  const headTop = i.face ? Math.min(i.face[1], onScreen(i.face[1])) : undefined
  const chin = i.face ? Math.max(i.face[3], onScreen(i.face[3])) + TALKING.chin : undefined
  // A pop-up sits above the head when there is room under the top of the safe area; a tight close-up gets none.
  const above = headTop === undefined ? 0.2 : headTop - TALKING.clear - TALKING.popupHalf
  const aboveFits = above - TALKING.popupHalf >= safe.top
  // The name strip sits between the chin and the captions, else above the head (before the first pop-up), else it is left out.
  const below = chin === undefined ? 0.62 : chin + TALKING.clear + TALKING.stripHalf
  const stripY = below + TALKING.stripHalf <= TALKING.captions.y - TALKING.captions.half - 0.01 ? below : headTop !== undefined && headTop - TALKING.clear - 2 * TALKING.stripHalf >= safe.top ? headTop - TALKING.clear - TALKING.stripHalf : undefined
  // No room above the head: a pop-up takes the place under the chin instead, once the name strip has left it.
  const under = chin === undefined ? undefined : chin + TALKING.clear + TALKING.popupHalf
  const underFits = under !== undefined && under + TALKING.popupHalf <= TALKING.captions.y - TALKING.captions.half - 0.01
  const stripLeaves = p.name && stripY !== undefined && stripY > (chin ?? 0) ? TALKING.strip.out + 0.6 : 0
  const popupY = aboveFits ? above : under
  const popupsFit = aboveFits || underFits
  const toSafe = (y: number) => r3((y - safe.top) / (1 - safe.top - safe.bottom))
  const keys = keyMoments(tr, p.keywords, i.find)
  const keyWords = new Set(keys.map((k) => k.word))
  const scenes: Raw[] = [{ id: 'clip', type: 'video', track: 0, start: 0, duration: end, params: { media: p.media, in: p.in, muted: tr.media !== 'beat' && tr.media !== p.media } }]

  if (p.captions) {
    const cues = groupCaptions(tr.words.map((w) => ({ text: w.text, at: w.start, end: w.end })))
    let n = 0
    scenes.push({
      id: 'captions', type: 'captions', track: 5, start: 0, duration: end,
      params: {
        skin: st.captions.skin, presentation: st.captions.presentation,
        cues: cues.map((c) => ({ at: r3(c.at), end: r3(Math.min(end, c.end)), words: c.words.map((w) => ({ text: w.text, at: r3(w.at), end: r3(w.end), ...(keyWords.has(n++) ? { emph: st.captions.emph } : {}) })) })),
      },
    })
  }

  if (p.popups && popupsFit) {
    keys.forEach((k, n) => {
      if (n % TALKING.popupEvery !== 0) return
      if (!aboveFits && k.at < stripLeaves) return
      const next = keys[n + 1]?.at ?? end
      const dur = r3(Math.min(TALKING.popup, next - k.at - 0.15, end - k.at))
      if (dur < 0.8) return
      const mark = st.popup === 'box' ? { box: true } : st.popup === 'underline' ? { underline: true } : { color: 'accent' }
      scenes.push({
        id: `pop${n + 1}`, type: 'kinetic-text', track: 6, start: r3(k.at), duration: dur,
        params: { mode: 'line', enter: i.pack?.motion.enter ?? 'pop', ease: (p.motion ?? i.pack?.motion.ease ?? 'easy') === 'easy' ? 'easy' : 'out', y: r3(popupY!), maxPx: 130, ...(i.pack && i.pack.layout.headline.align !== 'centre' ? { align: i.pack.layout.headline.align } : {}), words: [{ text: k.text, at: 0.02, ...mark }] },
      })
    })
  }

  if (p.name) {
    const out = Math.min(TALKING.strip.out, end - 0.6)
    if (out > TALKING.strip.at + 0.7 && stripY !== undefined) scenes.push({ id: 'name', type: 'name-strip', track: 7, start: 0, duration: end, params: { name: p.name, ...(p.handle ? { handle: p.handle } : {}), kind: st.strip, y: toSafe(stripY), at: TALKING.strip.at, out: r3(out) } })
  }

  // Punch-ins toward the face on each key word: in, hold while the phrase lasts, back out before the next.
  const cam: Raw[] = [{ at: 0, x: 0.5, y: 0.5, zoom: 1 }]
  if (p.punch) {
    let free = 0
    for (let n = 0; n < keys.length; n++) {
      const k = keys[n]!
      const next = keys[n + 1]?.at ?? end
      const inAt = Math.max(free, k.at - (st.punch.ease === 'cut' ? 0.02 : TALKING.punchIn * 0.6))
      const holdTo = Math.min(k.at + TALKING.punchHold, next - TALKING.punchOut - 0.4, end - TALKING.punchOut - 0.05)
      if (holdTo - k.at < 0.3 || inAt >= k.at) continue
      const ease = st.punch.ease === 'cut' ? 'linear' : st.punch.ease
      cam.push({ at: r3(inAt), x: 0.5, y: 0.5, zoom: 1, ease }, { at: r3(k.at), x: cx, y: cy, zoom: st.punch.zoom, ease }, { at: r3(holdTo), x: cx, y: cy, zoom: st.punch.zoom, ease: 'smooth' }, { at: r3(holdTo + TALKING.punchOut), x: 0.5, y: 0.5, zoom: 1, ease: 'smooth' })
      free = holdTo + TALKING.punchOut + 0.05
    }
  }

  return {
    version: 1,
    format: '9:16',
    fps: i.fps,
    look: i.pack?.look ?? p.look,
    ...(i.pack ? { pack: i.pack.id } : {}),
    dir: 'rtl',
    seed: i.seed,
    autoSfx: false,
    // The clip (track 0) is under the camera, so a punch-in is a real push toward the speaker.
    camera: { fixedTracks: [5, 6, 7], keys: cam },
    ...(tr.media === 'beat' ? {} : { audio: [{ kind: 'voice', media: tr.media }] }),
    scenes,
  }
}
