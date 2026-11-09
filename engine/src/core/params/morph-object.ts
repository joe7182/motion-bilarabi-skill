import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { OBJECT_IDS, type ObjectId } from '../objects'
import { seg } from '../ease'
import { rng } from '../rng'
import { morphKey, oneLine } from './common'

/** Voice levels run at this rate: `levels[i]` is the level at `at + i / LEVELS_FPS` (Task 6b). */
export const LEVELS_FPS = 30
/** At most this many levels per state (two minutes at LEVELS_FPS). */
export const LEVELS_MAX = 3600

const morphState = z.object({
  /** Scene-local s at which the object IS this state (the move into it starts `MORPH_OBJECT.lead` s earlier). */
  at: z.number().min(0),
  object: z.enum(OBJECT_IDS, { error: `شكل غير معروف — object must be one of ${OBJECT_IDS.join(', ')}` }),
  /** Centre in the safe area (fractions). */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  /** Diameter (round objects) or width (bar), as a fraction of the safe width. */
  size: z.number().min(0.04).max(0.9),
  /** Coin only: turns of the flip over the state (from its `at` to the next move or the scene end). */
  spin: z.number().min(-8).max(8).optional(),
  /** Land on arrival: a squash (sx 1.45 / sy 0.58) decaying as `exp(−10k)·cos(28k)`, bottom anchored. */
  land: z.boolean().optional(),
  /**
   * Task 6b: the line a document writes first (a timeline shows it on its first text chip). Canvas
   * decoration only (`aria-hidden`); the readable word is DOM text elsewhere.
   */
  text: oneLine(40).optional(),
  /**
   * Task 6b: voice levels (0..1), one per 1/30 s from this state's `at` (Node: `voiceLevels`). The
   * microphone's bars and the timeline's waveform follow them; absent → seeded idle motion.
   */
  levels: z
    .array(z.number().min(0).max(1))
    .max(LEVELS_MAX, { message: `مستويات الصوت لا تزيد عن ${LEVELS_MAX} — levels has at most ${LEVELS_MAX} values` })
    .optional(),
  /**
   * Task 6c calendar: seconds per month page (the page flips every `flipSec`; default
   * `CALENDAR.flipSec`).
   */
  flipSec: z.number().positive({ error: 'مدة الصفحة flipSec يجب أن تكون أكبر من صفر — flipSec must be greater than 0' }).max(10).optional(),
  /**
   * Task 6c phone-app: seconds after `at` when the notification card becomes the paid check
   * (default `PHONE_APP.checkAt`). Stage 1A: the second beat of the house (its windows light up),
   * the blueprint (the signature), the eye (it closes and is struck through) and the chat (the
   * photo is sent); defaults in `HOUSE`, `BLUEPRINT`, `EYE`, `CHAT` (`checkAtOf`).
   */
  checkAt: z.number().positive({ error: 'وقت الدفع checkAt يجب أن يكون أكبر من صفر — checkAt must be greater than 0' }).max(30).optional(),
  /**
   * Stage 2: the state's 2nd, 3rd, … moments, seconds after its `at` (ascending, each ≥ 0, at most
   * `BEATS_MAX`). Each object reads the ones it uses (the scale's bills and «؟» card, the materials
   * dropping in, the room's summer and winter, …); a missing beat takes the object's default
   * (`beatsOf`).
   */
  beats: z
    .array(z.number({ error: 'الإيقاع رقم بالثواني — each beat must be a number of seconds' }).min(0, { message: 'الإيقاعات لا تكون سالبة — beats must be ≥ 0' }).max(30))
    .max(8, { message: 'الإيقاعات لا تزيد عن ٨ — beats has at most 8 values' })
    .refine((b) => b.every((v, i) => i === 0 || v >= b[i - 1]!), { message: 'الإيقاعات مرتبة تصاعديًا — beats must be in ascending order' })
    .optional(),
})

/**
 * Params of `morph-object` (Plan 3): the hero dot becomes objects (ring, bar, clock, a coin with
 * the currency sign) and back, drawn on a canvas.
 */
export const morphObjectParams = z
  .object({
    states: z
      .array(morphState)
      .min(1, { message: 'الحالات لا تقل عن حالة واحدة — states needs at least 1 entry' })
      .max(12, { message: 'الحالات لا تزيد عن ١٢ — states has at most 12 entries' }),
    /** The sign embossed on a coin (AED, SAR, USD, EUR, IQD; case-insensitive). Unknown → AED, with a warning. */
    currency: z.string().default('AED'),
    /** A radial accent glow behind a coin or clock. */
    glow: z.boolean().default(true),
    /** Local times of thin accent rings expanding from the object. */
    rings: z.array(z.number().min(0)).max(32).default([]),
    key: morphKey,
  })
  .superRefine((p, ctx) => {
    for (let k = 1; k < p.states.length; k++) {
      if (!(p.states[k]!.at > p.states[k - 1]!.at)) {
        ctx.addIssue({
          code: 'custom',
          path: ['states', k, 'at'],
          message: `at الحالة ${k} يجب أن يكبر عن السابقة — states[${k}].at must be greater than states[${k - 1}].at`,
        })
        return
      }
    }
  })

export type MorphObjectParams = z.infer<typeof morphObjectParams>
export type MorphState = MorphObjectParams['states'][number]

export const MORPH_OBJECT = {
  /** A move starts this long before the state's `at` (less when the states are closer). */
  lead: 0.35,
  /** The soft spring (the prototype's `softSpring`): ζ, ω over a unit progress. */
  spring: { z: 0.55, w: 10 },
  /** The incoming object's inside details build over this long after arrival (s). */
  buildSec: 0.4,
  /** The outgoing object's details are gone by this share of the move (before its midpoint). */
  fadeBy: 0.45,
  /** Land squash: sx 1 + 0.45·q, sy 1 − 0.42·q, q = exp(−decay·k)·cos(freq·k), for `sec` s. */
  squash: { sx: 0.45, sy: 0.42, decay: 10, freq: 28, sec: 0.8 },
  /** Rings: radius `from` → `to` px over `sec` s (sine-out), alpha `alpha`·(1 − k), `width` px. */
  ring: { from: 50, to: 310, sec: 1, alpha: 0.55, width: 3 },
  /** Glow: accent at `alpha` from `inner`·r fading to 0 at `outer`·r. */
  glow: { inner: 0.6, outer: 2.3, alpha: 0.22 },
} as const

const springRaw = (p: number): number => {
  const { z: zeta, w } = MORPH_OBJECT.spring
  const wd = w * Math.sqrt(1 - zeta * zeta)
  return 1 - Math.exp(-zeta * w * p) * (Math.cos(wd * p) + ((zeta * w) / wd) * Math.sin(wd * p))
}
const SPRING_END = springRaw(1)

/** The prototype's `softSpring` ease (ζ 0.55, ω 10): 0 at p ≤ 0, exactly 1 at p ≥ 1, overshoots between. */
export function softSpring(p: number): number {
  if (p <= 0) return 0
  if (p >= 1) return 1
  return springRaw(p) + (1 - SPRING_END) * p
}

const power2InOut = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)

/**
 * Task 6b: inside details that take longer than `MORPH_OBJECT.buildSec` to build: the document
 * writes its six lines, the microphone draws its stand, the timeline lays its tracks down.
 */
export const OBJECT_BUILD_SEC: Partial<Record<ObjectId, number>> = {
  document: 0.8,
  microphone: 0.5,
  timeline: 0.6,
  // Task 6c: the calendar's day grid draws in, the envelope's flap opens, the voice-note bubble
  // fills in; the bell and the phone (its screen lighting up) keep the default 0.4 s.
  calendar: 0.6,
  envelope: 0.5,
  'voice-note': 0.5,
  // Stage 1A: the brick's edges ink-draw then its faces fill; the house is traced like an
  // elevation; the blueprint's plan draws itself; the photo frames, flashes and develops. The eye
  // (its lids opening) and the chat (panel, then composer) keep the default 0.4 s.
  brick: 0.5,
  house: 1.0,
  blueprint: 1.2,
  photo: 0.6,
  banknote: 0.6,
  // Stage 2: the scale assembles, the materials card lays out, the sun rises from its horizon, the
  // room is drawn, the map's streets draw in, the window is framed, the sky's arcs dash in, the
  // file's lines write.
  scale: 0.6,
  materials: 0.4,
  sun: 0.8,
  room: 0.6,
  pin: 0.5,
  window: 0.5,
  'sun-path': 0.6,
  file: 0.5,
  // Video 2: the engineers pop up one by one, the chip's traces draw outward, the gear and wrench
  // come together; the bulb, the magnifier's card, the profile card, the compass and the slip
  // printing keep the default 0.4 s.
  'hard-hat': 0.5,
  'ai-chip': 0.5,
  tool: 0.5,
}

/** How long the inside details of `id` take to build (s). */
export const buildSecOf = (id: ObjectId): number => OBJECT_BUILD_SEC[id] ?? MORPH_OBJECT.buildSec

/**
 * Task 6c: the largest `size` (fraction of the safe width) of the objects that reach well past
 * their size — the envelope's invoice fan, the bell's ring of notes, the voice-note bubble — so a
 * recipe size keeps them inside the frame. A larger size is drawn at the cap.
 */
export const OBJECT_SIZE_CAP: Partial<Record<ObjectId, number>> = { envelope: 0.62, bell: 0.5, 'voice-note': 0.6, chat: 0.62, sun: 0.56, file: 0.5, scale: 0.7, 'hard-hat': 0.62, magnifier: 0.7, follow: 0.66 }

/**
 * Task 6c timing, seconds after a state's `at` unless noted.
 *
 * - calendar: a month page lasts `flipSec`; its days are crossed off one by one over its first
 *   part (`crossFrom` .. `flipSec − flipDur − xSec`), each X drawn in `xSec`; then the page turns up
 *   over its top edge in `flipDur` (at most half the page) and the next month shows.
 * - envelope: after the flap opens, an invoice slides up out of it every `every` s (at most `max`),
 *   rising over `rise` s, then fanning out on the soft spring over `fan` s.
 * - bell: a ring every `every` s from the build end: a damped swing of ±`swingDeg`° (period
 *   `period`, decay `decay`/s), the clapper `lag` s behind; a sticky note pops in every `noteEvery`
 *   s, at most `notes`.
 * - voice-note: the waveform records right → left over `sweepSec` from the build end, then the
 *   progress fill replays it in a loop.
 * - phone-app: the notification card slides down at `notifyAt` (over `slideSec`), its bell
 *   wiggles, and at `checkAt` it becomes the accent paid check (over `morphSec`).
 */
export const CALENDAR = { flipSec: 0.45, flipDur: 0.18, crossFrom: 0.03, xSec: 0.08 } as const
export const ENVELOPE = { every: 0.3, max: 5, rise: 0.35, fanDelay: 0.2, fan: 0.4 } as const
export const BELL = { every: 0.6, swingDeg: 18, period: 0.4, decay: 4, lag: 0.06, noteEvery: 0.25, notes: 6, waveSec: 0.3 } as const
export const VOICE_NOTE = { sweepSec: 1.6, bars: 28, barIn: 0.12 } as const
export const PHONE_APP = { notifyAt: 0.4, slideSec: 0.35, checkAt: 1.2, morphSec: 0.4 } as const

/**
 * Stage 1A timing (the house reel), seconds after a state's `at` unless noted.
 *
 * - brick: with `text: 'fall'`, `streaks` faint speed streaks show above it for `streakSec` after
 *   arrival (the storyboard moves it: it falls, freezes, lands with `land`).
 * - house: at `checkAt` it is lived in — its windows light up one by one, `lightEvery` s apart,
 *   each over `lightSec`, and warm light spills under the door.
 * - blueprint: after the build its dimension labels scramble, new digits every `scrambleEvery`
 *   s; at `checkAt` an accent signature scribbles over `signSec`, then an underline flicks in
 *   over `flickSec`.
 * - eye: the iris looks around (a seeded glance every `lookEvery` s, each taking `lookSec`); at
 *   `checkAt` the lids close over `closeSec` and stay closed, then an accent slash draws across
 *   over `slashSec`.
 * - photo: four viewfinder brackets snap from `bracketFrom`× to 1× over `bracketSec`; then a
 *   white flash fades over `flashSec` while the image develops (contrast low → full) over
 *   `developSec`.
 * - chat: at `checkAt` the send button presses (over `pressSec`) and the photo flies up into a
 *   sent bubble (over `flySec`); `typingAfter` s after it lands three typing dots pulse in the
 *   assistant's bubble; `replyAfter` s after that the bubble opens into a reply card (over
 *   `openSec`) where a house elevation draws itself over `drawSec`.
 */
export const BRICK = { streakSec: 0.25, streaks: 7 } as const
export const HOUSE = { checkAt: 0.9, lightEvery: 0.12, lightSec: 0.25 } as const
export const BLUEPRINT = { scrambleEvery: 0.09, checkAt: 1.6, signSec: 0.6, flickSec: 0.15 } as const
export const EYE = { lookEvery: 0.55, lookSec: 0.09, checkAt: 0.6, closeSec: 0.18, slashSec: 0.25 } as const
export const PHOTO = { bracketSec: 0.2, bracketFrom: 1.25, flashSec: 0.3, developSec: 0.4 } as const
/**
 * banknote: its engraving draws in over the build; at `checkAt` a stack of `fan` more bills fans out
 * behind it, one every `fanEvery` s, each turning over `fanSec`; a sheen sweeps the front bill every
 * `sheenEvery` s.
 */
export const BANKNOTE = { checkAt: 0.5, fan: 4, fanEvery: 0.08, fanSec: 0.32, sheenEvery: 1.6 } as const
export const CHAT = { checkAt: 0.5, pressSec: 0.16, flySec: 0.36, typingAfter: 0.3, replyAfter: 0.9, openSec: 0.3, drawSec: 0.6 } as const

/** At most this many beats per state. */
export const BEATS_MAX = 8

/**
 * A state's beats with the object's defaults filled in (pure): `given[i]` when the state gives it,
 * else the previous beat plus the default spacing (`defaults[i] − defaults[i − 1]`), or
 * `defaults[0]` for the first — so a state that moves one beat later keeps the rest in step.
 */
export function beatsOf(given: readonly number[] | undefined, defaults: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < defaults.length; i++) {
    const g = given?.[i]
    out.push(g !== undefined ? g : i === 0 ? defaults[0]! : Math.max(out[i - 1]!, out[i - 1]! + defaults[i]! - defaults[i - 1]!))
  }
  return out
}

/**
 * Stage 2 timing (the cost and sun sections), seconds after a state's `at`; `beats` are the
 * defaults of the state's `beats` (`beatsOf`).
 *
 * - scale: beats[0] a bundle of bills (with the price tag, the state `text`) drops onto the RIGHT
 *   pan over `dropSec`; as it lands the beam tips `tiltDeg`° toward it on a damped spring (ζ
 *   `zeta`, ω `omega`: settled in ~0.8 s); beats[1] a faint dashed «؟» card fades onto the LEFT
 *   pan over `cardSec`.
 * - materials: beats[0..3] the brick stack, the cement bag, the sand and the gravel drop in (RTL:
 *   top-right first), each over `dropSec` with a small bounce; beats[4] («لكل طابق») the set
 *   slides up into the upper floor row («الأول») over `floorSec` and a second set builds in the
 *   ground floor row («الأرضي») below, `again` s apart.
 * - sun: its corona turns `spinDeg`°/s and each ray breathes `breathe` of its length (seeded period
 *   `breatheSec`); the disc rises from below its horizon over the first `riseShare` of the build,
 *   then the rays grow out one by one.
 * - room: beats[0] summer comes in over `summerSec`, beats[1] winter over `winterSec`.
 * - pin: the pin drops over `dropSec`, landing at beats[0] with a squash; a pulse ring every
 *   `pulseEvery` s; the label pops in `labelAfter` s after the landing.
 * - window: `text` 'rays' (default) — the meter counts 0 → `kwh` landing at beats[0]; 'glass' —
 *   counts up by `countSec`, then at beats[0] the double pane slides in over `paneSec` and the
 *   meter counts down to `kwhGlass` over `downSec`; 'zero' — the low winter sun crosses from
 *   beats[0] over `travelSec`, the meter's «0.0» pulses red at beats[1].
 * - sun-path: beats[0] the summer sun travels the high arc over `travelSec`, beats[1] the winter sun
 *   the low arc.
 * - file: beats[0] the «مجاناً» stamp slams (from `stampFrom`× over `stampSec`); beats[1] three
 *   engineering-software tiles fan out (`tileEvery` s apart, over `tileSec`), each struck through
 *   `strikeAfter` s after it lands, over `strikeSec`.
 */
export const SCALE = { beats: [0.3, 1.2], dropSec: 0.22, tiltDeg: 11, zeta: 0.32, omega: 13, cardSec: 0.35 } as const
export const MATERIALS = { beats: [0.12, 0.34, 0.56, 0.78, 1.6], dropSec: 0.32, floorSec: 0.45, again: 0.09 } as const
export const SUN = { spinDeg: 6, breathe: 0.12, breatheSec: [1.6, 2.6], riseShare: 0.55, rays: 16 } as const
export const ROOM = { beats: [0.4, 1.4], summerSec: 0.4, winterSec: 0.6 } as const
export const PIN = { beats: [0.25], dropSec: 0.3, pulseEvery: 1.2, pulseSec: 1.0, labelAfter: 0.08 } as const
export const WINDOW = {
  beats: { rays: [1.2], glass: [1.5], zero: [0.2, 1.0] },
  kwh: 3.3,
  kwhGlass: 1.4,
  countFrom: 0.15,
  countSec: 0.9,
  paneSec: 0.35,
  downSec: 0.7,
  travelSec: 1.4,
  pulseSec: 0.45,
} as const
export type WindowMode = keyof typeof WINDOW.beats
/** The window's mode from a state's `text` ('rays' for anything else). */
export const windowModeOf = (text: string | undefined): WindowMode => (text === 'glass' || text === 'zero' ? text : 'rays')
export const SUN_PATH = { beats: [0.5, 1.7], travelSec: 1.0 } as const
export const FILE = { beats: [0.4, 1.4], stampFrom: 1.6, stampSec: 0.18, tileEvery: 0.1, tileSec: 0.35, strikeAfter: 0.12, strikeSec: 0.2 } as const

/**
 * Video 2 timing (the hook and «مهمتي»), seconds after a state's `at`; `beats` are the defaults of
 * the state's `beats` (`beatsOf`).
 *
 * - hard-hat: the heads pop up from below one by one (`popEvery` s apart, each over `popSec`);
 *   beats[0] they turn upset over `upsetSec` (brows slant, mouths frown, cheeks flush); beats[1]
 *   steam puffs burst from the helmets' sides (each over `puffSec`, a second puff `puffAgain` s
 *   later) and the middle hat jumps once over `jumpSec`. Idle: a seeded bob of `bob` × size.
 * - bulb: beats[0] it switches on (a stutter over `onSec`: the filament glows, the globe fills warm,
 *   the halo and `rays` short rays flick out); lit, the halo flickers by `flicker`.
 * - ai-chip: after beats[0] pulses run along the traces INTO the chip, each over `pulseSec`, resting
 *   a seeded `gapSec` between runs; the die glows in over `glowSec`.
 * - tool: after the build the gear turns `spinDeg`°/s; beats[0] the wrench turns the bolt `turnDeg`°
 *   over `turnSec` (overshoot), holds `holdSec`, swings back over `backSec`; three sparkles pop.
 * - magnifier: after the build the glass glides down the rows, `rowSec` per row (back up again if
 *   it is not stopped yet); beats[0] it stops (settling over `stopSec`), an accent check draws over
 *   the card over `checkSec`, then a soft ring pulses over `ringSec`. The lens magnifies `zoom`×.
 * - follow: beats[0] the button presses (down to `squash` over `pressSec`, back on a spring over
 *   `releaseSec`), fills accent over `fillSec` and reads «تتابعه ✓»; a «+1» floats up over `plusSec`
 *   and `confetti` dots burst over `confettiSec`.
 * - compass: from `swingFrom` the needle swings ±`swingDeg`° on a damped oscillation (ζ `zeta`, ω
 *   `omega`) and is settled on «ش» by beats[0]; then «ش» lights accent over `lightSec`.
 * - receipt: it prints top → bottom over the build; beats[0] an accent strike draws across it over
 *   `strikeSec`; `stampAfter` s later the stamp «تقدير أولي» slams on (from `stampFrom`× over
 *   `stampSec`, with a squash).
 */
export const HARD_HAT = { beats: [0.5, 1.1], popSec: 0.24, popEvery: 0.12, upsetSec: 0.25, puffSec: 0.75, puffAgain: 0.32, jumpSec: 0.32, bob: 0.006 } as const
export const BULB = { beats: [0.3], onSec: 0.16, rays: 10, raySec: 0.3, flicker: 0.12 } as const
export const AI_CHIP = { beats: [0.2], pulseSec: 0.62, gapSec: [0.25, 1.0], glowSec: 0.5 } as const
export const TOOL = { beats: [0.4], spinDeg: 40, turnDeg: 60, turnSec: 0.34, holdSec: 0.12, backSec: 0.3, sparkSec: 0.45 } as const
export const MAGNIFIER = { beats: [1.5], rowSec: 0.35, rows: 4, stopSec: 0.2, checkSec: 0.3, ringSec: 0.9, zoom: 1.6 } as const
export const FOLLOW = { beats: [0.4], squash: 0.9, pressSec: 0.08, releaseSec: 0.32, fillSec: 0.22, plusSec: 0.9, confetti: 16, confettiSec: 0.8 } as const
export const COMPASS = { beats: [0.9], swingFrom: 0.12, swingDeg: 75, zeta: 0.22, omega: 12, lightSec: 0.25 } as const
export const RECEIPT = { beats: [0.5], strikeSec: 0.25, stampAfter: 0.3, stampFrom: 1.6, stampSec: 0.18 } as const

/** The default second-beat time (`checkAt`, s after `at`) of an object; the phone's for the others. */
export function checkAtOf(id: ObjectId): number {
  switch (id) {
    case 'house': return HOUSE.checkAt
    case 'blueprint': return BLUEPRINT.checkAt
    case 'eye': return EYE.checkAt
    case 'chat': return CHAT.checkAt
    case 'banknote': return BANKNOTE.checkAt
    default: return PHONE_APP.checkAt
  }
}

/**
 * The voice level `since` seconds after a state's `at`: `levels[round(since · 30)]`, clamped to
 * the array (pure in t); undefined without levels.
 */
export function levelAt(levels: readonly number[] | undefined, since: number): number | undefined {
  if (!levels || levels.length === 0) return undefined
  const i = Math.round(since * LEVELS_FPS)
  return levels[Math.max(0, Math.min(levels.length - 1, i))]
}

/**
 * Task 6b timeline: the playhead sweeps the track area right → left over `sweepSec` (looping),
 * starting `playheadIn` s after arrival; three cuts split the video clip under the playhead, the
 * first `cutFirst` (+ up to `cutJitter`) s after arrival, then every `cutStep` (+ jitter). A cut's
 * gap opens over `gapSec` to `gap` × size; its scissor mark shows for `scissorSec`.
 */
export const TIMELINE = {
  playheadIn: 0,
  sweepSec: 2.4,
  cutFirst: 0.28,
  cutStep: 0.42,
  cutJitter: 0.1,
  cutCount: 3,
  gapSec: 0.12,
  gap: 0.022,
  scissorSec: 0.6,
} as const

/** Seconds after arrival of the timeline cuts of state `k` (seeded by its index and time; pure). */
export function timelineCutOffsets(k: number, at: number): number[] {
  const r = rng((k + 1) * 7919 + Math.round(at * 1000) * 31)
  const out: number[] = []
  let c = TIMELINE.cutFirst + TIMELINE.cutJitter * r()
  for (let i = 0; i < TIMELINE.cutCount; i++) {
    out.push(c)
    c += TIMELINE.cutStep + 3 * TIMELINE.cutJitter * r()
  }
  return out
}

/**
 * Local times of the cuts of state `k` while it shows: none unless it is a timeline; a cut after
 * the next move starts (or at/after `end`) never shows, so it is dropped.
 */
export function timelineCuts(p: Pick<MorphObjectParams, 'states'>, k: number, end: number): number[] {
  const s = p.states[k]
  if (!s || s.object !== 'timeline') return []
  const until = k + 1 < p.states.length ? p.states[k + 1]!.at - morphLeadOf(p, k + 1) : end
  return timelineCutOffsets(k, s.at)
    .map((c) => s.at + c)
    .filter((t) => t < until && t < end)
}

/** Objects that get the glow and a chime when they finish building. */
export const BUILT_OBJECTS: ReadonlySet<ObjectId> = new Set(['coin', 'clock'])

/** The move into state k starts this long before its `at` (the gap since the previous state caps it). */
export const morphLeadOf = (p: Pick<MorphObjectParams, 'states'>, k: number): number =>
  k === 0 ? MORPH_OBJECT.lead : Math.min(MORPH_OBJECT.lead, p.states[k]!.at - p.states[k - 1]!.at)

/** A state's size as a fraction of the safe width, at most its object's `OBJECT_SIZE_CAP`. */
export const stateSize = (s: MorphState): number => Math.min(s.size, OBJECT_SIZE_CAP[s.object] ?? Infinity)

/** The object at a local time, in frame px. */
export interface MorphPose {
  /** Index of the state being left (= `to` when resting or entering) and of the state being reached. */
  from: number
  to: number
  /** Spring progress of the move from → to (unclamped: it overshoots); 1 when resting. */
  u: number
  /** Linear progress of the move (0..1). */
  move: number
  /** Centre (px; a landing squash keeps the bottom on the ground, so it shifts down) and size (px). */
  x: number
  y: number
  size: number
  /** The two endpoint sizes (px), scaled by `enter`, for the outline blend. */
  sizeFrom: number
  sizeTo: number
  /** Entrance of the first state (0 → 1 on the soft spring, ending at its `at`). */
  enter: number
  /** Landing squash scales. */
  sx: number
  sy: number
  /** Coin flip angles (radians) of the outgoing and incoming states. */
  angleFrom: number
  angleTo: number
  /** Outgoing details alpha (1 → 0 before the move's midpoint) and incoming details build (0 → 1 over `buildSec` after arrival). */
  fade: number
  build: number
  /** The move joins two states of the same object: it moves / resizes with its details kept (no fade, no rebuild). */
  same: boolean
}

/**
 * The object at scene-local `t` (pure, closed form). `end` = the scene's local length (duration +
 * preroll): the last state's spin runs until then. `safe` = the safe area in frame px.
 */
export function morphObjectPose(
  p: Pick<MorphObjectParams, 'states'>,
  t: number,
  end: number,
  safe: { x: number; y: number; w: number; h: number },
): MorphPose {
  const st = p.states
  let k = 0
  for (let i = 1; i < st.length; i++) if (t >= st[i]!.at - morphLeadOf(p, i)) k = i
  const a = st[k === 0 ? 0 : k - 1]!
  const b = st[k]!
  const s0 = st[0]!
  const enter = softSpring(seg(t, s0.at - MORPH_OBJECT.lead, s0.at))
  let u = 1
  let move = 1
  if (k > 0) {
    const lead = morphLeadOf(p, k)
    move = seg(t, b.at - lead, b.at)
    u = softSpring(move)
  }
  const ax = safe.x + a.x * safe.w
  const ay = safe.y + a.y * safe.h
  const bx = safe.x + b.x * safe.w
  const by = safe.y + b.y * safe.h
  const sizeFrom = stateSize(a) * safe.w * enter
  const sizeTo = stateSize(b) * safe.w * enter
  const size = sizeFrom + (sizeTo - sizeFrom) * u

  // Landing squash: the latest state with `land` that has arrived.
  let q = 0
  for (let i = st.length - 1; i >= 0; i--) {
    const s = st[i]!
    if (s.at > t) continue
    if (s.land) {
      const kk = t - s.at
      const sq = MORPH_OBJECT.squash
      if (kk < sq.sec) q = Math.exp(-sq.decay * kk) * Math.cos(sq.freq * kk)
    }
    break
  }
  const sx = 1 + MORPH_OBJECT.squash.sx * q
  const sy = 1 - MORPH_OBJECT.squash.sy * q

  // Spin of a state: from its `at` to the start of the next move (or the scene end), power2.inOut.
  // A run of states of the same object adds up, so a coin moving to a coin keeps its face.
  const spinOf = (i: number): number => {
    const s = st[i]!
    const prev = i > 0 && st[i - 1]!.object === s.object ? spinOf(i - 1) : 0
    if (!s.spin) return prev
    const next = i + 1 < st.length ? st[i + 1]!.at - morphLeadOf(p, i + 1) : end
    return prev + 2 * Math.PI * s.spin * power2InOut(seg(t, s.at, Math.max(s.at, next)))
  }
  const same = k > 0 && a.object === b.object

  const x = ax + (bx - ax) * u
  const y = ay + (by - ay) * u + (size / 2) * (1 - sy)
  return {
    from: k === 0 ? 0 : k - 1,
    to: k,
    u,
    move,
    x,
    y,
    size,
    sizeFrom,
    sizeTo,
    enter,
    sx,
    sy,
    angleFrom: spinOf(k === 0 ? 0 : k - 1),
    angleTo: spinOf(k),
    fade: k === 0 ? 0 : same ? 1 : 1 - seg(move, 0, MORPH_OBJECT.fadeBy),
    build: same ? 1 : seg(t, b.at, b.at + buildSecOf(b.object)),
    same,
  }
}

/** The object's centre and radius in frame px at local t (what `exports().at` returns). */
export function morphObjectAt(
  p: Pick<MorphObjectParams, 'states'>,
  t: number,
  end: number,
  safe: { x: number; y: number; w: number; h: number },
): { x: number; y: number; r: number } {
  const pose = morphObjectPose(p, t, end, safe)
  return { x: pose.x, y: pose.y, r: pose.size / 2 }
}

/**
 * Task 6c: the local time of state `k`'s paid check (`at + checkAt`) if it is a phone-app state and
 * the check lands before the next move starts (or the scene ends); else undefined.
 */
export function phoneCheckOf(p: Pick<MorphObjectParams, 'states'>, k: number, end: number): number | undefined {
  const s = p.states[k]
  if (!s || s.object !== 'phone-app') return undefined
  const until = k + 1 < p.states.length ? p.states[k + 1]!.at - morphLeadOf(p, k + 1) : end
  const t = s.at + (s.checkAt ?? PHONE_APP.checkAt)
  return t < until && t < end ? t : undefined
}

/** Task 6c: the local times of every paid check that shows. */
export function phoneCheckCues(p: Pick<MorphObjectParams, 'states'>, end: number): number[] {
  return p.states.flatMap((_, k) => phoneCheckOf(p, k, end) ?? [])
}

/**
 * Stage 2: the sound of state `k`'s own moments (local s) that land before the next move starts
 * (or the scene ends): the scale's bills land (`tick`), each material drops in (`pop`), the pin
 * lands (`pop`), the file's stamp slams (`hit`). Video 2: the engineers' huff (`pop`), the bulb
 * switching on (`tick`), the wrench's turn (`tick`), the magnifier's check (`final`), the follow
 * press (`pop`), the receipt's stamp (`hit`).
 */
export function beatCuesOf(p: Pick<MorphObjectParams, 'states'>, k: number, end: number): Cue[] {
  const s = p.states[k]
  if (!s) return []
  const until = k + 1 < p.states.length ? p.states[k + 1]!.at - morphLeadOf(p, k + 1) : end
  let out: Cue[] = []
  switch (s.object) {
    case 'scale':
      out = [{ t: s.at + beatsOf(s.beats, SCALE.beats)[0]! + SCALE.dropSec, kind: 'tick' }]
      break
    case 'materials':
      out = beatsOf(s.beats, MATERIALS.beats).slice(0, 4).map((b): Cue => ({ t: s.at + b + MATERIALS.dropSec, kind: 'pop' }))
      break
    case 'pin':
      out = [{ t: s.at + beatsOf(s.beats, PIN.beats)[0]!, kind: 'pop' }]
      break
    case 'file':
      out = [{ t: s.at + beatsOf(s.beats, FILE.beats)[0]! + FILE.stampSec, kind: 'hit' }]
      break
    // Video 2: the engineers huff, the bulb clicks on, the wrench turns, the check lands, the
    // follow button pops, the stamp hits.
    case 'hard-hat':
      out = [{ t: s.at + beatsOf(s.beats, HARD_HAT.beats)[1]!, kind: 'pop' }]
      break
    case 'bulb':
      out = [{ t: s.at + beatsOf(s.beats, BULB.beats)[0]!, kind: 'tick' }]
      break
    case 'tool':
      out = [{ t: s.at + beatsOf(s.beats, TOOL.beats)[0]!, kind: 'tick' }]
      break
    case 'magnifier':
      out = [{ t: s.at + beatsOf(s.beats, MAGNIFIER.beats)[0]! + MAGNIFIER.stopSec, kind: 'final' }]
      break
    case 'follow':
      out = [{ t: s.at + beatsOf(s.beats, FOLLOW.beats)[0]!, kind: 'pop' }]
      break
    case 'receipt':
      out = [{ t: s.at + beatsOf(s.beats, RECEIPT.beats)[0]! + RECEIPT.stampAfter + RECEIPT.stampSec, kind: 'hit' }]
      break
  }
  return out.filter((c) => c.t < until && c.t < end)
}

/**
 * Sound: a `tap` at every state's `at`; a `chime` when a coin or clock finishes building (a state
 * that keeps the previous state's object does not rebuild, so it does not chime); a `tick` at
 * every timeline cut that shows (Task 6b); a `chime` when a phone's paid check lands (Task 6c).
 */
export function cuesOfMorphObject(p: MorphObjectParams, ctx: { duration: number }): Cue[] {
  return p.states.flatMap((s, i): Cue[] => {
    const check = phoneCheckOf(p, i, ctx.duration)
    return [
      { t: s.at, kind: 'action' },
      ...(BUILT_OBJECTS.has(s.object) && p.states[i - 1]?.object !== s.object ? [{ t: s.at + MORPH_OBJECT.buildSec, kind: 'final' as const }] : []),
      ...timelineCuts(p, i, ctx.duration).map((t): Cue => ({ t, kind: 'tick' })),
      ...(check === undefined ? [] : [{ t: check, kind: 'final' as const }]),
      ...beatCuesOf(p, i, ctx.duration),
    ]
  })
}
