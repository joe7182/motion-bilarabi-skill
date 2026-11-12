import type { ZodType } from 'zod'
import { formatPath } from '../brand'
import { StoryboardError, type Storyboard } from '../storyboard'
import { appWindowParams, timingIssueOfAppWindow } from './app-window'
import { resolveWorld } from '../worlds'
import { getLook } from '../../runtime/looks'
import { backdropParams, type BackdropParams } from './backdrop'
import { buildNumberParams, timingIssueOfBuildNumber } from './build-number'
import { chaseParams } from './chase'
import { checklistParams, timingIssueOfChecklist } from './checklist'
import { commentCtaParams, timingIssueOfCommentCta } from './comment-cta'
import { profileCardParams } from './profile-card'
import { typeStretchParams, timingIssueOfTypeStretch } from './type-stretch'
import { lettersJoinParams, timingIssueOfLettersJoin } from './letters-join'
import { chapterBarParams } from './chapter-bar'
import { captionsParams } from './captions'
import { arabicMoveParams, timingIssueOfArabicMove } from './arabic-move'
import { bookFlipParams, timingIssueOfBookFlip } from './book-flip'
import { ecgLineParams, microscopeParams, timingIssueOfEcgLine } from './bio-fx'
import { heavyWordParams, saidWrittenParams, timingIssueOfHeavyWord, timingIssueOfSaidWritten, timingIssueOfWordCut, viewfinderParams, wordCutParams } from './type-tricks'
import { effectListParams, liveCursorParams, voiceNoteParams, commentDropParams, headStackParams, predictKeysParams, dayDialParams, postWallParams, photoLookParams } from './creator-fx'
import { cutoutParams, orbitRingParams } from './cutout'
import { editorialTypeParams } from './editorial'
import { glitchTextParams, zoomCalloutParams } from './glitch'
import { redPenParams, sketchWordsParams } from './sketch'
import { spaceFieldParams } from './space'
import { screenMockupParams } from './screen-mockup'
import { beatPulseParams } from './beat'
import { bounceBallParams } from './physics'
import { frameMarksParams } from './frame-marks'
import { objectFrameParams } from './object-frame'
import { nameStripParams } from './name-strip'
import { geoPatternParams, paperShapesParams } from './pack-fx'
import { glassCardParams, orderStepsParams, pageFlyoverParams, phoneReplyParams } from './showcase-fx'
import { gooMergeParams, photoGridParams } from './merge-fx'
import { orbCardParams } from './orb-card'
import { htmlMotionParams } from './html-motion'
import { uiMorphParams } from './ui-morph'
import { halftoneFieldParams, springGraphParams } from './dots'
import { beforeAfterParams, fanCardsParams, funnelParams } from './concept-fx'
import { gaugeRingParams, liveTimerParams, notifyStackParams, statBarsParams } from './data-fx'
import { beatSlamParams, glowWordsParams, laserBeamParams, laserTypeParams, techGridParams } from './laser'
import { skillDeckParams, twinSyncParams } from './skills-fx'
import { codeFileParams, permissionPromptParams } from './devtools'
import { loadedDieParams, serverBatchParams, tokenOddsParams, tokenStreamParams } from './odds'
import { codeChatParams, contextWindowParams, knowledgeTimelineParams, misquoteParams, signatureCardParams, webCrawlParams } from './explainer'
import { commentStickersParams, timingIssueOfCommentStickers } from './comment-stickers'
import { logoRowParams, timingIssueOfLogoRow } from './logo-row'
import { layerStackParams, timingIssueOfLayerStack } from './layer-stack'
import { nodeGraphParams, timingIssueOfNodeGraph } from './node-graph'
import { chatThreadParams, timingIssueOfChatThread } from './chat-thread'
import { counterParams } from './counter'
import { heroParams } from './hero'
import { highlightParams, targetIssueOfHighlight, type HighlightParams } from './highlight'
import { hudParams, timingIssueOfHud } from './hud'
import { iconParams } from './icon'
import { kineticTextParams, timingIssueOfKineticText } from './kinetic-text'
import { lineArtParams } from './line-art'
import { morphObjectParams, type MorphObjectParams } from './morph-object'
import { numberedSlotsParams, timingIssueOfNumberedSlots } from './numbered-slots'
import { parseCurrency } from '../currency'
import { particleWordParams, targetIssueOfParticleWord, timingIssueOfParticleWord, type ParticleWordParams } from './particle-word'
import { phoneParams, timingIssueOfPhone } from './phone'
import { probeParams } from './probe'
import { repeatLoopParams } from './repeat-loop'
import { screenClipParams, timingIssueOfScreenClip } from './screen-clip'
import { searchTypingParams } from './search-typing'
import { sectionNumberParams } from './section-number'
import { shapeStatesParams, timingIssueOfShapeStates } from './shape-states'
import { slamParams } from './slam'
import { stampParams } from './stamp'
import { videoParams } from './video'
import { wipeRevealParams } from './wipe-reveal'
import { wordWallParams } from './word-wall'

/**
 * The params schema of every scene type, DOM-free so Node (CLI `validate`, renderer, preview) and
 * the runtime check params with the same rules. The keys are the engine's scene types
 * (`PRIMITIVE_IDS`); ids starting with `_` are internal/test-only and never documented.
 */
export const PARAMS = {
  _probe: probeParams,
  'app-window': appWindowParams,
  'arabic-move': arabicMoveParams,
  backdrop: backdropParams,
  'book-flip': bookFlipParams,
  'build-number': buildNumberParams,
  captions: captionsParams,
  'chapter-bar': chapterBarParams,
  chase: chaseParams,
  'chat-thread': chatThreadParams,
  checklist: checklistParams,
  'comment-cta': commentCtaParams,
  'knowledge-timeline': knowledgeTimelineParams,
  'signature-card': signatureCardParams,
  'code-chat': codeChatParams,
  'web-crawl': webCrawlParams,
  'misquote': misquoteParams,
  'token-stream': tokenStreamParams,
  'token-odds': tokenOddsParams,
  'loaded-die': loadedDieParams,
  'server-batch': serverBatchParams,
  'permission-prompt': permissionPromptParams,
  'code-file': codeFileParams,
  'skill-deck': skillDeckParams,
  'twin-sync': twinSyncParams,
  'tech-grid': techGridParams,
  'laser-type': laserTypeParams,
  'editorial-type': editorialTypeParams,
  'glitch-text': glitchTextParams,
  'zoom-callout': zoomCalloutParams,
  'sketch-words': sketchWordsParams,
  'red-pen': redPenParams,
  'notify-stack': notifyStackParams,
  'stat-bars': statBarsParams,
  'gauge-ring': gaugeRingParams,
  'live-timer': liveTimerParams,
  'space-field': spaceFieldParams,
  'screen-mockup': screenMockupParams,
  'beat-pulse': beatPulseParams,
  'bounce-ball': bounceBallParams,
  'frame-marks': frameMarksParams,
  'object-frame': objectFrameParams,
  'name-strip': nameStripParams,
  'geo-pattern': geoPatternParams,
  'paper-shapes': paperShapesParams,
  'page-flyover': pageFlyoverParams,
  'phone-reply': phoneReplyParams,
  'order-steps': orderStepsParams,
  'glass-card': glassCardParams,
  'goo-merge': gooMergeParams,
  'photo-grid': photoGridParams,
  'orb-card': orbCardParams,
  'html-motion': htmlMotionParams,
  'ui-morph': uiMorphParams,
  'spring-graph': springGraphParams,
  'halftone-field': halftoneFieldParams,
  'before-after': beforeAfterParams,
  'fan-cards': fanCardsParams,
  funnel: funnelParams,
  'laser-beam': laserBeamParams,
  'glow-words': glowWordsParams,
  'beat-slam': beatSlamParams,
  'context-window': contextWindowParams,
  cutout: cutoutParams,
  'orbit-ring': orbitRingParams,
  'photo-look': photoLookParams,
  'predict-keys': predictKeysParams,
  'day-dial': dayDialParams,
  'post-wall': postWallParams,
  'effect-list': effectListParams,
  'live-cursor': liveCursorParams,
  'voice-note': voiceNoteParams,
  'comment-drop': commentDropParams,
  'head-stack': headStackParams,
  'comment-stickers': commentStickersParams,
  counter: counterParams,
  'ecg-line': ecgLineParams,
  'heavy-word': heavyWordParams,
  hero: heroParams,
  highlight: highlightParams,
  hud: hudParams,
  icon: iconParams,
  'kinetic-text': kineticTextParams,
  'layer-stack': layerStackParams,
  'letters-join': lettersJoinParams,
  'line-art': lineArtParams,
  'logo-row': logoRowParams,
  microscope: microscopeParams,
  'morph-object': morphObjectParams,
  'node-graph': nodeGraphParams,
  'numbered-slots': numberedSlotsParams,
  'particle-word': particleWordParams,
  phone: phoneParams,
  'profile-card': profileCardParams,
  'repeat-loop': repeatLoopParams,
  'said-written': saidWrittenParams,
  'screen-clip': screenClipParams,
  'search-typing': searchTypingParams,
  'section-number': sectionNumberParams,
  'shape-states': shapeStatesParams,
  slam: slamParams,
  stamp: stampParams,
  'type-stretch': typeStretchParams,
  video: videoParams,
  viewfinder: viewfinderParams,
  'wipe-reveal': wipeRevealParams,
  'word-cut': wordCutParams,
  'word-wall': wordWallParams,
} as const satisfies Record<string, ZodType>

export type PrimitiveId = keyof typeof PARAMS

/** `scenes[i].params` + the issue path (`.title`, `[0]`, ...). */
export function paramsPath(i: number, issuePath: ReadonlyArray<PropertyKey>): string {
  const sub = formatPath(issuePath)
  if (!sub) return `scenes[${i}].params`
  return sub.startsWith('[') ? `scenes[${i}].params${sub}` : `scenes[${i}].params.${sub}`
}

/** Parses scene `i`'s params with `schema`; the first issue becomes a StoryboardError at `scenes[i].params.<field>`. */
export function parseSceneParams<P>(schema: ZodType<P>, i: number, params: unknown): P {
  const r = schema.safeParse(params)
  if (!r.success) {
    const issue = r.error.issues[0]!
    throw new StoryboardError(paramsPath(i, issue.path), issue.message)
  }
  return r.data
}

/** A params problem that needs the scene's length (Arabic first, then English). */
export interface SceneTimingIssue {
  path: (string | number)[]
  ar: string
  en: string
}

/**
 * Scene-level params checks: `sceneLen` = duration + preroll, the scene's local time span.
 * These run in Node only (`validateSceneParams`: CLI validate, render); the in-page stage and
 * preview call `parseSceneParams` alone, so a word or row past the scene end just never shows there.
 */
export const SCENE_TIMING_CHECKS: Partial<Record<PrimitiveId, (p: any, sceneLen: number) => SceneTimingIssue | undefined>> = {
  'app-window': timingIssueOfAppWindow,
  'arabic-move': timingIssueOfArabicMove,
  'book-flip': timingIssueOfBookFlip,
  'build-number': timingIssueOfBuildNumber,
  'chat-thread': timingIssueOfChatThread,
  checklist: timingIssueOfChecklist,
  'comment-cta': timingIssueOfCommentCta,
  'comment-stickers': timingIssueOfCommentStickers,
  'ecg-line': timingIssueOfEcgLine,
  'heavy-word': timingIssueOfHeavyWord,
  hud: timingIssueOfHud,
  'kinetic-text': timingIssueOfKineticText,
  'layer-stack': timingIssueOfLayerStack,
  'letters-join': timingIssueOfLettersJoin,
  'logo-row': timingIssueOfLogoRow,
  'node-graph': timingIssueOfNodeGraph,
  'numbered-slots': timingIssueOfNumberedSlots,
  'particle-word': timingIssueOfParticleWord,
  phone: timingIssueOfPhone,
  'said-written': timingIssueOfSaidWritten,
  'screen-clip': timingIssueOfScreenClip,
  'shape-states': timingIssueOfShapeStates,
  'type-stretch': timingIssueOfTypeStretch,
  'word-cut': timingIssueOfWordCut,
}

/**
 * Checks every scene of a known type against its params schema, then its scene-level timing
 * check, then (highlight, particle-word) that its `target` key is in an earlier covering scene (throws the
 * first error). Non-fatal findings are appended to `warnings` (Arabic first).
 */
export function validateSceneParams(sb: Storyboard, warnings?: string[]): void {
  sb.scenes.forEach((sc, i) => {
    if (!Object.hasOwn(PARAMS, sc.type)) return
    const p = parseSceneParams(PARAMS[sc.type as PrimitiveId] as ZodType, i, sc.params)
    if (sc.type === 'backdrop' && (p as BackdropParams).world === 'accent') {
      const look = getLook(sb.look, sb.brand)
      if (resolveWorld(look, 'accent') !== 'accent') {
        warnings?.push('الجو «accent» لا يحقق تباين ٤٫٥ في هذا الستايل؛ استُبدل بـ «ink» — accent world fails 4.5 contrast for this look; using ink')
      }
    }
    if (sc.type === 'morph-object') {
      const unknown = parseCurrency((p as MorphObjectParams).currency).unknown
      if (unknown !== undefined) {
        warnings?.push(
          `عملة غير معروفة «${unknown}» (scenes[${i}].params.currency)؛ تُرسم علامة الدرهم — ` +
            `unknown currency "${unknown}", the coin shows AED`,
        )
      }
    }
    const react = sc.type === 'backdrop' ? (p as BackdropParams).react : undefined
    if (react) {
      // Task 6: live. A react.hero naming no hero scene is accepted and ignored, with a warning.
      const target = sb.scenes.find((o) => o.id === react.hero)
      if (target?.type !== 'hero') {
        warnings?.push(
          `لا يوجد مشهد hero بالمعرّف «${react.hero}» فيُتجاهل حقل react (scenes[${i}].params.react) — ` +
            `there is no hero scene "${react.hero}", so the backdrop's react field is ignored`,
        )
      }
    }
    const issue =
      SCENE_TIMING_CHECKS[sc.type as PrimitiveId]?.(p, sc.duration + (sc.preroll ?? 0)) ??
      (sc.type === 'highlight' ? targetIssueOfHighlight(sb, i, p as HighlightParams) : undefined) ??
      (sc.type === 'particle-word' ? targetIssueOfParticleWord(sb, i, p as ParticleWordParams) : undefined)
    if (issue) throw new StoryboardError(paramsPath(i, issue.path), `${issue.ar} — ${issue.en}`)
  })
}
