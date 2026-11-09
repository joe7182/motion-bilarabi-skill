import type { TransitionId } from '../params/transitions'

/**
 * Video types (§17.12 item 1) and hook families (§17.12 item 2) of the explainer recipe. Pure data;
 * the wording is our own.
 */
export const BRIEF_TYPES = ['educational', 'informational', 'explainer', 'product-launch', 'motion', 'corporate'] as const
export type BriefType = (typeof BRIEF_TYPES)[number]

export interface TypePreset {
  /** 1 calm … 5 relentless. Pro Pace (maxEventGap ≤ 1.0 s) binds from 3 up. */
  intensity: 1 | 2 | 3 | 4 | 5
  /** Target median gap between visual events (s), checked with `plannedPace`. */
  medianGap: [number, number]
  /** Which cuts are hard cuts (`hit: true`: riser + impact). */
  hitCuts: 'none' | 'pauses' | 'sections'
  /** Transitions the recipe may use (it cycles through them, seeded). */
  transitions: TransitionId[]
  /** dB added to every planned SFX (storyboard `sfxGainDb`). */
  sfxOffsetDb: number
  /** A `hud` with the script's sections (when it has any). */
  hud: boolean
  /**
   * Plan 2a+ Task 9: the fewest signature moments (`IDEAS[id].signature`) the creative director
   * plans for a video of up to 30 s; one more per 20 s beyond (`signatureMinOf`).
   */
  signatureMin: number
}

/** The type's signature minimum for a video of `duration` s: `signatureMin`, +1 per 20 s beyond 30 s. */
export function signatureMinOf(p: TypePreset, duration: number): number {
  return p.signatureMin + Math.max(0, Math.ceil((duration - 30) / 20 - 1e-9))
}

const TEACHING: TypePreset = {
  intensity: 3,
  medianGap: [0.35, 0.5],
  hitCuts: 'pauses',
  // Critic round 2: no whip-pan — between two centred kinetic-text beats its middle frame is empty
  // (the outgoing text has left, the incoming one is still 0.8 frame away).
  transitions: ['color-wipe', 'zoom-through', 'morph'],
  sfxOffsetDb: 0,
  hud: true,
  signatureMin: 2,
}

export const TYPE_PRESETS: Record<BriefType, TypePreset> = {
  corporate: { intensity: 1, medianGap: [0.6, 0.9], hitCuts: 'none', transitions: ['color-wipe', 'morph'], sfxOffsetDb: -4, hud: false, signatureMin: 1 },
  educational: TEACHING,
  informational: TEACHING,
  explainer: TEACHING,
  // Problem → chaos → ask → the product doing the work (the user's screens) → payoff.
  'product-launch': {
    intensity: 4,
    medianGap: [0.35, 0.5],
    hitCuts: 'sections',
    transitions: ['whip-pan', 'zoom-through', 'glitch-cut', 'color-wipe', 'morph'],
    sfxOffsetDb: 0,
    hud: true,
    signatureMin: 3,
  },
  // Hits on sections and on stressed words; every transition. R23: the median range is 0.3–0.45 s
  // (0.4 s is out of reach at a normal speaking rate).
  motion: {
    intensity: 5,
    medianGap: [0.3, 0.45],
    hitCuts: 'sections',
    transitions: ['color-wipe', 'whip-pan', 'zoom-through', 'glitch-cut', 'morph'],
    sfxOffsetDb: 0,
    hud: true,
    signatureMin: 4,
  },
}

/** How frame 0 looks for a hook family. Every one shows the hook text on frame 0. */
export type HookTreatment = 'counter' | 'stamp' | 'hud' | 'question' | 'before-after' | 'text'

/** The 12 hook families: `id` is what `brief.json` names (Arabic); `aliases` are accepted too. */
export const HOOK_FAMILIES_AR = [
  { id: 'نتيجة/رقم', aliases: ['رقم', 'نتيجة'], idea: 'ابدأ بالنتيجة أو بالرقم قبل أي شرح', treatment: 'counter' },
  { id: 'تحذير', aliases: [], idea: 'نبّه المشاهد إلى خطأ يقع فيه الآن', treatment: 'stamp' },
  { id: 'فضول', aliases: [], idea: 'افتح سؤالاً لا يُجاب عنه إلا في آخر المقطع', treatment: 'text' },
  { id: 'عكس السائد', aliases: [], idea: 'قل عكس ما يردده الجميع ثم أثبته', treatment: 'text' },
  { id: 'ألم', aliases: [], idea: 'صف المشكلة كما يعيشها المشاهد بكلماته', treatment: 'text' },
  { id: 'دليل أولاً', aliases: ['دليل'], idea: 'اعرض الدليل أو اللقطة الحقيقية قبل الادعاء', treatment: 'text' },
  { id: 'قبل/بعد', aliases: ['قبل', 'بعد'], idea: 'ضع الحال قبل بجانب الحال بعد في ثانية واحدة', treatment: 'before-after' },
  { id: 'وعد بقائمة', aliases: ['قائمة'], idea: 'عِد بعدد محدد من النقاط وأظهر خاناتها', treatment: 'hud' },
  { id: 'سؤال مباشر', aliases: ['سؤال'], idea: 'اسأل المشاهد سؤالاً يجيب عنه في رأسه', treatment: 'question' },
  { id: 'قصة من المنتصف', aliases: ['قصة'], idea: 'ادخل في القصة من أكثر لحظاتها توتراً', treatment: 'text' },
  { id: 'هوية', aliases: [], idea: 'خاطب فئة بعينها حتى تشعر أن المقطع لها', treatment: 'text' },
  { id: 'تحدٍّ/مؤقت', aliases: ['تحدي', 'مؤقت'], idea: 'ضع تحدياً أو مهلة قصيرة يتابعها المشاهد', treatment: 'text' },
] as const satisfies readonly { id: string; aliases: readonly string[]; idea: string; treatment: HookTreatment }[]

export type HookFamily = (typeof HOOK_FAMILIES_AR)[number]['id']
