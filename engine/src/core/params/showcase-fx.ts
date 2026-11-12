import { z } from 'zod'
import type { Cue } from '../audio-plan'

/**
 * Product-showcase moments.
 * - page-flyover: a page or app screenshot lies tilted in space; the camera glides down it, pieces
 *   of the page lift off as floating layers with soft shadows, then it rises overhead and lands flat
 *   as a card. One continuous move, no cuts.
 * - phone-reply: a phone chat — messages arrive, the keyboard rises, a reply is typed word by word
 *   (keys light as it types) and is sent.
 * - order-steps: an order-status stepper; each step fills in turn along a line that runs the
 *   reading way, the current one pulsing.
 * - glass-card: a frosted-glass panel over whatever is beneath (a clip, a photo, a scene): blurred
 *   backdrop, a bright rim, a light sweep as it lands.
 */

const at = z.number().min(0)
const unit = z.number().min(0).max(1)
const line = (max: number) => z.string().min(1).max(max).refine((t) => !/[\r\n]/.test(t), { message: 'سطر واحد — one line' })

export const pageFlyoverParams = z.object({
  /** The screenshot: one screen or a tall page (a project image path; `mba shot <url> out.jpg --full`). */
  image: z.string().min(1),
  /** Pieces that lift off the page, in image fractions; each rises at its `at` (default: one after another during the glide). */
  layers: z.array(z.object({ x: unit, y: unit, w: unit, h: unit, lift: z.number().min(0.02).max(0.3).default(0.1), at: at.optional() })).max(8).default([]),
  /** The tilt of the page during the glide (degrees back from the lens). */
  tilt: z.number().min(20).max(70).default(56),
  /** Where the landing card shows the page from (0 = top, 1 = bottom of the image). */
  land: unit.default(0),
  /** Page width as a fraction of the safe width when it lands, and the landing's vertical centre (safe fraction). */
  size: z.number().min(0.4).max(1).default(0.9),
  y: unit.default(0.52),
  /** The landed card's height / width (it crops a tall page). */
  aspect: z.number().min(0.4).max(2.2).default(1.25),
})
export type PageFlyoverParams = z.infer<typeof pageFlyoverParams>

export const phoneReplyParams = z
  .object({
    /** Messages that arrive (the other person), each at its `at`. */
    messages: z.array(z.object({ text: line(60), at })).min(1).max(3),
    /** The reply: typed word by word from `typeAt`, sent at `sendAt`. */
    reply: line(60),
    typeAt: at,
    sendAt: at,
    /** The contact's name on the chat's bar. */
    name: line(24).optional(),
    theme: z.enum(['light', 'dark']).default('light'),
    /** Phone width as a fraction of the safe width; vertical centre (safe fraction). */
    size: z.number().min(0.4).max(0.95).default(0.8),
    y: unit.default(0.5),
  })
  .refine((p) => p.sendAt > p.typeAt + 0.4, { path: ['sendAt'], message: 'الإرسال بعد الكتابة — sendAt must come after typeAt (by 0.4 s or more)' })
  .refine((p) => p.messages.every((m) => m.at < p.typeAt), { path: ['typeAt'], message: 'الرد بعد وصول الرسائل — the reply is typed after the messages arrive' })
export type PhoneReplyParams = z.infer<typeof phoneReplyParams>

export const orderStepsParams = z
  .object({
    steps: z.array(z.object({ label: line(18), at })).min(2).max(5),
    title: line(36).optional(),
    y: unit.default(0.5),
    width: z.number().min(0.5).max(1).default(0.94),
    /** A card behind the stepper. */
    card: z.boolean().default(true),
  })
  .refine((p) => p.steps.every((s, i) => i === 0 || s.at > p.steps[i - 1]!.at), { path: ['steps'], message: 'أوقات الخطوات تصاعدية — step times must rise' })
export type OrderStepsParams = z.infer<typeof orderStepsParams>

export const glassCardParams = z.object({
  title: line(40),
  /** Up to three lines under the title. */
  lines: z.array(line(48)).max(3).default([]),
  /** Small chips along the bottom (labels). */
  chips: z.array(line(16)).max(4).default([]),
  at: at.default(0.1),
  y: unit.default(0.6),
  width: z.number().min(0.4).max(1).default(0.86),
  /** The glass tint: light glass (dark text) or dark glass (light text). */
  tint: z.enum(['light', 'dark']).default('dark'),
  /** Liquid glass: the backdrop also bends through the panel, like thick glass (strongest near its edges). */
  liquid: z.boolean().default(false),
})
export type GlassCardParams = z.infer<typeof glassCardParams>

export const SHOWCASE = {
  /** page-flyover: shares of the scene for the glide, the rise overhead, and the landing. */
  glide: 0.46,
  rise: 0.72,
  /** phone-reply: seconds per typed word, the keyboard's rise, a bubble's pop. */
  word: 0.28,
  keys: 0.4,
  pop: 0.35,
  /** order-steps: seconds a step takes to fill. */
  fill: 0.45,
  /** glass-card: seconds to land, and the light sweep's length. */
  land: 0.55,
  sweep: 0.9,
} as const

/** The three letter rows of an Arabic phone keyboard (right to left as drawn). */
export const AR_KEYS = ['ضصثقفغعهخحج', 'شسيبلاتنمكط', 'ذءؤرىةوزظد'] as const

export const cuesOfPageFlyover = (): Cue[] => [{ t: 0, kind: 'whoosh' }]
export const cuesOfPhoneReply = (p: PhoneReplyParams): Cue[] => [...p.messages.map((m) => ({ t: m.at, kind: 'pop' as const })), { t: p.sendAt, kind: 'whoosh' as const }]
export const cuesOfOrderSteps = (p: OrderStepsParams): Cue[] => p.steps.map((s) => ({ t: s.at, kind: 'tick' as const }))
export const cuesOfGlassCard = (p: GlassCardParams): Cue[] => [{ t: p.at, kind: 'whoosh' }]
