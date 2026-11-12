import type { ZodType } from 'zod'
import { AUDIO_DEFAULTS, type AudioClip, type SfxName, type Storyboard } from './storyboard'
import { PARAMS } from './params/index'
import { cuesOfAppWindow } from './params/app-window'
import { cuesOfBuildNumber } from './params/build-number'
import { cuesOfChase } from './params/chase'
import { cuesOfChecklist } from './params/checklist'
import { cuesOfCommentCta } from './params/comment-cta'
import { cuesOfProfileCard } from './params/profile-card'
import { cuesOfTypeStretch } from './params/type-stretch'
import { cuesOfLettersJoin } from './params/letters-join'
import { cuesOfEffectList, cuesOfLiveCursor, cuesOfVoiceNote, cuesOfCommentDrop, cuesOfHeadStack, cuesOfPredictKeys, cuesOfDayDial, cuesOfPostWall, cuesOfPhotoLook } from './params/creator-fx'
import { cuesOfEditorialType } from './params/editorial'
import { cuesOfGlitchText, cuesOfZoomCallout } from './params/glitch'
import { cuesOfRedPen, cuesOfSketchWords } from './params/sketch'
import { cuesOfSpaceField } from './params/space'
import { cuesOfScreenMockup } from './params/screen-mockup'
import { cuesOfBeatPulse } from './params/beat'
import { cuesOfBounceBall } from './params/physics'
import { cuesOfFrameMarks } from './params/frame-marks'
import { cuesOfObjectFrame } from './params/object-frame'
import { cuesOfNameStrip } from './params/name-strip'
import { cuesOfGeoPattern, cuesOfPaperShapes } from './params/pack-fx'
import { cuesOfGlassCard, cuesOfOrderSteps, cuesOfPageFlyover, cuesOfPhoneReply } from './params/showcase-fx'
import { cuesOfUiMorph } from './params/ui-morph'
import { cuesOfHalftoneField, cuesOfSpringGraph } from './params/dots'
import { cuesOfBeforeAfter, cuesOfFanCards, cuesOfFunnel } from './params/concept-fx'
import { cuesOfGaugeRing, cuesOfLiveTimer, cuesOfNotifyStack, cuesOfStatBars } from './params/data-fx'
import { cuesOfBeatSlam, cuesOfGlowWords, cuesOfLaserBeam, cuesOfLaserType, cuesOfTechGrid } from './params/laser'
import { cuesOfSkillDeck, cuesOfTwinSync } from './params/skills-fx'
import { cuesOfCodeFile, cuesOfPermissionPrompt } from './params/devtools'
import { cuesOfLoadedDie, cuesOfServerBatch, cuesOfTokenOdds, cuesOfTokenStream } from './params/odds'
import { cuesOfCutout, cuesOfOrbitRing } from './params/cutout'
import { cuesOfCodeChat, cuesOfContextWindow, cuesOfKnowledgeTimeline, cuesOfMisquote, cuesOfSignatureCard, cuesOfWebCrawl } from './params/explainer'
import { cuesOfCommentStickers } from './params/comment-stickers'
import { cuesOfEcgLine } from './params/bio-fx'
import { cuesOfBookFlip } from './params/book-flip'
import { cuesOfHeavyWord, cuesOfSaidWritten, cuesOfWordCut } from './params/type-tricks'
import { cuesOfLogoRow } from './params/logo-row'
import { cuesOfLayerStack } from './params/layer-stack'
import { cuesOfNodeGraph } from './params/node-graph'
import { cuesOfChatThread } from './params/chat-thread'
import { cuesOfCounter } from './params/counter'
import { cuesOfHighlight } from './params/highlight'
import { cuesOfIcon } from './params/icon'
import { cuesOfKineticText } from './params/kinetic-text'
import { cuesOfLineArt } from './params/line-art'
import { cuesOfMorphObject } from './params/morph-object'
import { cuesOfNumberedSlots } from './params/numbered-slots'
import { cuesOfParticleWord } from './params/particle-word'
import { cuesOfPhone } from './params/phone'
import { cuesOfRepeatLoop } from './params/repeat-loop'
import { cuesOfScreenClip } from './params/screen-clip'
import { cuesOfSearchTyping } from './params/search-typing'
import { cuesOfSectionNumber, SECTION_IMPACT_GAIN } from './params/section-number'
import { cuesOfShapeStates } from './params/shape-states'
import { cutCue, defaultTransitionDuration, RISER_SEC } from './params/transitions'
import { cuesOfSlam } from './params/slam'
import { cuesOfStamp } from './params/stamp'
import { cuesOfWipeReveal } from './params/wipe-reveal'

/**
 * The sound-cue planner (spec §13.5, §17.5, §17.9): every primitive reports its cues (pure, local
 * seconds, from its params), and `planSfx` turns them into SFX clips at load time. Rules:
 *
 * - `action` → `tap` (UI) or `tick` (checklist/list types), on the cue's exact frame;
 * - `tick` → `tick` (a strike line); `type-letter` → one `key` per letter at its typed time;
 * - `count` → the `count` loop over the roll; `final` → `chime`; `pop` → `mallet` (variant = pop
 *   cue index mod 5: a pentatonic walk); `hit` (stamp) → `impact` at HIT_GAIN (−16 dB, R11);
 *   `impact` (section-number) → `impact` at SECTION_IMPACT_GAIN (−12 dB); `whoosh` (Plan 3) → the
 *   last WHOOSH.sec of the `riser`, from the cue on, faded out (there is no separate whoosh synth;
 *   a user `whoosh` file replaces the riser, R5);
 * - a transition with `hit: true` (hard cut) → a `riser` (RISER_SEC) ending exactly on `at`, an
 *   `impact` on `at`, nothing else in [at − QUIET_SEC, at), and every music clip dipped
 *   DIP.db over the DIP.sec before the riser (R4);
 * - a `reveal` (Plan 3) → a whoosh at its window start (at − d/2) and, with `hit`, an `impact` at
 *   its window end (at + d/2), where the new world has fully opened (no riser into the cut);
 * - slides, exits and plain transitions → nothing; one SFX per frame (PRIORITY); gains SFX_GAIN.
 *
 * User files (`mba project add --kind sfx` named whoosh|click|impact|pop, R5) replace the synth.
 */

export interface Cue {
  /** Local seconds (scene time, preroll included, like `update(localT)`). */
  t: number
  kind: 'action' | 'tick' | 'type-letter' | 'count' | 'final' | 'pop' | 'hit' | 'impact' | 'whoosh'
  /** `count` only: length of the roll (s). Default 1. */
  duration?: number
}

export type CuesOf = (params: any, ctx: { duration: number }) => Cue[]

/** Cue source of every scene type that makes a sound (Tasks 6–7 add theirs). */
export const CUES: Record<string, CuesOf> = {
  'app-window': cuesOfAppWindow,
  'build-number': cuesOfBuildNumber,
  chase: cuesOfChase,
  checklist: cuesOfChecklist,
  'comment-cta': cuesOfCommentCta,
  'profile-card': cuesOfProfileCard,
  'type-stretch': cuesOfTypeStretch,
  'letters-join': cuesOfLettersJoin,
  'comment-stickers': cuesOfCommentStickers,
  'knowledge-timeline': cuesOfKnowledgeTimeline as CuesOf,
  'signature-card': cuesOfSignatureCard as CuesOf,
  'code-chat': cuesOfCodeChat as CuesOf,
  'web-crawl': cuesOfWebCrawl as CuesOf,
  'misquote': cuesOfMisquote as CuesOf,
  'token-stream': cuesOfTokenStream as CuesOf,
  'token-odds': cuesOfTokenOdds as CuesOf,
  'loaded-die': cuesOfLoadedDie as CuesOf,
  'server-batch': cuesOfServerBatch as CuesOf,
  'permission-prompt': cuesOfPermissionPrompt as CuesOf,
  'code-file': cuesOfCodeFile as CuesOf,
  'skill-deck': cuesOfSkillDeck as CuesOf,
  'twin-sync': cuesOfTwinSync as CuesOf,
  'tech-grid': cuesOfTechGrid as CuesOf,
  'laser-type': cuesOfLaserType as CuesOf,
  'editorial-type': cuesOfEditorialType as CuesOf,
  'glitch-text': cuesOfGlitchText as CuesOf,
  'zoom-callout': cuesOfZoomCallout as CuesOf,
  'sketch-words': cuesOfSketchWords as CuesOf,
  'red-pen': cuesOfRedPen as CuesOf,
  'notify-stack': cuesOfNotifyStack as CuesOf,
  'stat-bars': cuesOfStatBars as CuesOf,
  'gauge-ring': cuesOfGaugeRing as CuesOf,
  'live-timer': cuesOfLiveTimer as CuesOf,
  'space-field': cuesOfSpaceField as CuesOf,
  'screen-mockup': cuesOfScreenMockup as CuesOf,
  'beat-pulse': cuesOfBeatPulse as CuesOf,
  'bounce-ball': cuesOfBounceBall as CuesOf,
  'frame-marks': cuesOfFrameMarks as CuesOf,
  'object-frame': cuesOfObjectFrame as CuesOf,
  'name-strip': cuesOfNameStrip as CuesOf,
  'geo-pattern': cuesOfGeoPattern as CuesOf,
  'paper-shapes': cuesOfPaperShapes as CuesOf,
  'page-flyover': cuesOfPageFlyover as CuesOf,
  'phone-reply': cuesOfPhoneReply as CuesOf,
  'order-steps': cuesOfOrderSteps as CuesOf,
  'glass-card': cuesOfGlassCard as CuesOf,
  'ui-morph': cuesOfUiMorph as CuesOf,
  'spring-graph': cuesOfSpringGraph as CuesOf,
  'halftone-field': cuesOfHalftoneField as CuesOf,
  'before-after': cuesOfBeforeAfter as CuesOf,
  'fan-cards': cuesOfFanCards as CuesOf,
  funnel: cuesOfFunnel as CuesOf,
  'laser-beam': cuesOfLaserBeam as CuesOf,
  'glow-words': cuesOfGlowWords as CuesOf,
  'beat-slam': cuesOfBeatSlam as CuesOf,
  'context-window': cuesOfContextWindow as CuesOf,
  cutout: cuesOfCutout as CuesOf,
  'orbit-ring': cuesOfOrbitRing as CuesOf,
  'photo-look': cuesOfPhotoLook as CuesOf,
  'predict-keys': cuesOfPredictKeys as CuesOf,
  'day-dial': cuesOfDayDial as CuesOf,
  'post-wall': cuesOfPostWall as CuesOf,
  'effect-list': cuesOfEffectList as CuesOf,
  'live-cursor': cuesOfLiveCursor as CuesOf,
  'voice-note': cuesOfVoiceNote as CuesOf,
  'comment-drop': cuesOfCommentDrop as CuesOf,
  'head-stack': cuesOfHeadStack as CuesOf,
  'ecg-line': cuesOfEcgLine as CuesOf,
  'book-flip': cuesOfBookFlip as CuesOf,
  'heavy-word': cuesOfHeavyWord as CuesOf,
  'said-written': cuesOfSaidWritten as CuesOf,
  'word-cut': cuesOfWordCut as CuesOf,
  'logo-row': cuesOfLogoRow,
  'layer-stack': cuesOfLayerStack,
  'node-graph': cuesOfNodeGraph,
  'chat-thread': cuesOfChatThread,
  counter: cuesOfCounter,
  highlight: cuesOfHighlight,
  icon: cuesOfIcon,
  'kinetic-text': cuesOfKineticText,
  'line-art': cuesOfLineArt,
  'morph-object': cuesOfMorphObject,
  'numbered-slots': cuesOfNumberedSlots,
  'particle-word': cuesOfParticleWord,
  phone: cuesOfPhone,
  'repeat-loop': cuesOfRepeatLoop,
  'screen-clip': cuesOfScreenClip,
  'search-typing': cuesOfSearchTyping,
  'section-number': cuesOfSectionNumber,
  'shape-states': cuesOfShapeStates,
  slam: cuesOfSlam,
  stamp: cuesOfStamp,
  'wipe-reveal': cuesOfWipeReveal,
}

/** Clip gain (dB) per effect: every one ≤ −12, well under the voice. */
export const SFX_GAIN: Record<SfxName, number> = {
  key: -20,
  tick: -18,
  tap: -16,
  mallet: -16,
  count: -18,
  chime: -14,
  riser: -14,
  impact: -12,
}

/** Gain (dB) of the `impact` a `hit` cue (stamp) plays: softer than a hard cut's impact (R11). */
export const HIT_GAIN = -16

/** Plan 3 `whoosh` cue: the riser's climax, `sec` long from the cue, faded out over `fadeOut` s. */
export const WHOOSH = { sec: 0.35, fadeOut: 0.12 } as const

/** Same-frame winner: higher wins (impact > chime > tick > tap > key). */
const PRIORITY: Record<SfxName, number> = { impact: 7, riser: 6, chime: 5, count: 4, tick: 3, tap: 2, mallet: 2, key: 1 }

export { RISER_SEC }
/** Before a hard cut: no other SFX over this long (the riser itself and the near-silence before it). */
export const QUIET_SEC = 0.85
/** Music dip before each riser (R4). */
export const DIP = { sec: 0.25, db: -12 } as const

/** Scene types whose `action` is a list tick rather than a UI tap (Tasks 6–7 add theirs). */
export const LIST_TYPES: ReadonlySet<string> = new Set(['checklist'])

/** R5: user SFX file stem → the effects it replaces. */
const USER_SFX: Record<string, SfxName[]> = { whoosh: ['riser'], click: ['tap', 'key'], impact: ['impact'], pop: ['mallet'] }

/** Effect → media id, from the project's `sfx` media named whoosh|click|impact|pop (first wins). */
export function userSfxMap(media: readonly { id: string; role?: string; source: string }[]): Partial<Record<SfxName, string>> {
  const out: Partial<Record<SfxName, string>> = {}
  for (const m of media) {
    if (m.role !== 'sfx') continue
    const stem = (m.source.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '').trim().toLowerCase()
    for (const name of USER_SFX[stem] ?? []) out[name] ??= m.id
  }
  return out
}

interface Planned {
  name: SfxName
  at: number
  variant: number
  duration?: number
  alignEnd?: boolean
  /** Overrides SFX_GAIN[name]. */
  gain?: number
  /** Overrides AUDIO_DEFAULTS.sfx.fadeOut. */
  fadeOut?: number
}

/**
 * The SFX clips of `sb` (ids `auto<n>`), plus a copy of every music clip with the pre-riser dips
 * added (same id: `mergePlannedAudio` replaces it). Pure.
 */
export function planSfx(
  sb: Storyboard,
  o: { fps: number; userSfx?: Partial<Record<SfxName, string>>; /** Extra cue sources (tests). */ cues?: Record<string, CuesOf> },
): AudioClip[] {
  const snap = (t: number) => Math.round(t * o.fps) / o.fps
  const frame = (t: number) => Math.round(t * o.fps)
  const out: Planned[] = []
  let pops = 0
  let keys = 0
  for (const sc of sb.scenes) {
    const cuesOf = o.cues?.[sc.type] ?? CUES[sc.type]
    if (!cuesOf) continue
    const schema = (PARAMS as Record<string, ZodType | undefined>)[sc.type]
    const params = schema ? schema.parse(sc.params) : sc.params
    const preroll = sc.preroll ?? 0
    for (const c of cuesOf(params, { duration: sc.duration + preroll })) {
      const abs = sc.start - preroll + c.t
      if (abs < sc.start - 1e-9 || abs >= sc.start + sc.duration - 1e-9) continue
      const at = snap(abs)
      switch (c.kind) {
        case 'action':
          out.push({ name: LIST_TYPES.has(sc.type) ? 'tick' : 'tap', at, variant: 0 })
          break
        case 'tick':
          out.push({ name: 'tick', at, variant: 0 })
          break
        case 'type-letter':
          out.push({ name: 'key', at, variant: keys++ % 4 })
          break
        case 'count':
          out.push({ name: 'count', at, variant: 0, duration: Math.min(c.duration ?? 1, sc.start + sc.duration - at) })
          break
        case 'final':
          out.push({ name: 'chime', at, variant: 0 })
          break
        case 'pop':
          out.push({ name: 'mallet', at, variant: pops++ % 5 })
          break
        case 'hit':
          out.push({ name: 'impact', at, variant: 0, gain: HIT_GAIN })
          break
        case 'impact':
          out.push({ name: 'impact', at, variant: 0, gain: SECTION_IMPACT_GAIN })
          break
        case 'whoosh':
          out.push({ name: 'riser', at, variant: 0, duration: Math.min(WHOOSH.sec, sc.start + sc.duration - at), alignEnd: true, fadeOut: WHOOSH.fadeOut })
          break
      }
    }
  }
  // A plain flood (no hit) lands a soft mallet on its cover moment (the cut); a hit one gets the riser + impact below.
  // A reveal whooshes as the shape starts to open and, with hit, lands an impact when it has opened.
  for (const tr of sb.transitions ?? []) {
    if (tr.type === 'flood' && tr.params.hit !== true) out.push({ name: 'mallet', at: snap(tr.at), variant: pops++ % 5 })
    if (tr.type === 'reveal') {
      const d = tr.duration ?? defaultTransitionDuration('reveal')
      out.push({ name: 'riser', at: snap(Math.max(0, tr.at - d / 2)), variant: 0, duration: WHOOSH.sec, alignEnd: true, fadeOut: WHOOSH.fadeOut })
      if (tr.params.hit === true) out.push({ name: 'impact', at: snap(tr.at + d / 2), variant: 0 })
    }
  }
  // One SFX per frame: the highest priority wins (ties: the first).
  const byFrame = new Map<number, Planned>()
  for (const p of out) {
    const f = frame(p.at)
    const had = byFrame.get(f)
    if (!had || PRIORITY[p.name] > PRIORITY[had.name]) byFrame.set(f, p)
  }
  let kept = [...byFrame.values()]
  // Hard cuts: near-silence, then riser into impact.
  const dips: { at: number; duration: number; db: number }[] = []
  for (const tr of sb.transitions ?? []) {
    const cue = cutCue(tr)
    if (!cue) continue
    const { riserAt, impactAt: at } = cue
    kept = kept.filter((p) => !(p.at >= at - QUIET_SEC - 1e-9 && p.at < at - 1e-9) && frame(p.at) !== frame(at))
    // End-aligned: at resolve time the source's last `duration` s play, ending on the cut, so a
    // short riser (cut before RISER_SEC) and any user whoosh length still climax on the cut.
    kept.push({ name: 'riser', at: riserAt, variant: 0, duration: at - riserAt, alignEnd: true })
    kept.push({ name: 'impact', at, variant: 0 })
    const dipAt = Math.max(0, riserAt - DIP.sec)
    if (riserAt > dipAt) dips.push({ at: dipAt, duration: riserAt - dipAt, db: DIP.db })
  }
  kept.sort((a, b) => a.at - b.at || PRIORITY[b.name] - PRIORITY[a.name])
  const clips: AudioClip[] = kept.map((p, n) => {
    const media = o.userSfx?.[p.name]
    return {
      id: `auto${n}`,
      kind: 'sfx',
      ...(media !== undefined ? { media } : { sfx: p.name, variant: p.variant }),
      at: p.at,
      in: 0,
      ...(p.duration !== undefined ? { duration: p.duration } : {}),
      ...(p.alignEnd ? { align: 'end' as const } : {}),
      gain: (p.gain ?? SFX_GAIN[p.name]) + (sb.sfxGainDb ?? 0),
      fadeIn: AUDIO_DEFAULTS.sfx.fadeIn,
      fadeOut: p.fadeOut ?? AUDIO_DEFAULTS.sfx.fadeOut,
    }
  })
  if (dips.length) {
    for (const m of sb.audio ?? []) {
      if (m.kind === 'music') clips.push({ ...m, dips: [...(m.dips ?? []), ...dips] })
    }
  }
  return clips
}

/**
 * The storyboard's `audio[]` with the planned clips: a planned clip with the id of an existing
 * one replaces it (music with dips), the others are appended (user-written SFX are kept). A
 * planned `auto<n>` id the user already took is renamed.
 *
 * Not applied to user-written clips (deferred): the one-SFX-per-frame rule and the quiet window
 * before a hard cut only filter planned clips; a user clip on the same frame plays as written.
 */
export function mergePlannedAudio(audio: readonly AudioClip[] | undefined, planned: readonly AudioClip[]): AudioClip[] {
  const out = [...(audio ?? [])]
  const ids = new Set(out.map((c) => c.id))
  for (const p of planned) {
    const j = out.findIndex((c) => c.id === p.id && c.kind === 'music' && p.kind === 'music')
    if (j >= 0) {
      out[j] = p
      continue
    }
    let id = p.id
    for (let n = 2; ids.has(id); n++) id = `${p.id}_${n}`
    ids.add(id)
    out.push({ ...p, id })
  }
  return out
}
