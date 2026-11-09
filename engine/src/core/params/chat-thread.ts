import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { imageSrc, morphKey, oneLineAr as oneLine, rangeAr } from './common'
import { safePoint } from './line-art'
import type { SceneTimingIssue } from './index'

/** One message of `chat-thread`. `out` = the business / bot (LEFT, WhatsApp-Arabic), `in` = the customer (RIGHT). */
export const chatMessage = z.object({
  side: z.enum(['in', 'out']),
  /** The bubble text (it wraps inside the bubble); for a `card`, the card's header («تم الحجز»). */
  text: oneLine(48, 'text'),
  at: z.number().finite().min(0),
  kind: z.enum(['text', 'card']).default('text'),
  /** `card` only: up to 3 `[key, value]` rows. */
  rows: z
    .array(z.tuple([oneLine(16, 'key'), oneLine(24, 'value')]))
    .max(3, { message: 'ثلاثة صفوف على الأكثر — at most 3 rows' })
    .optional(),
  /** Timestamp under the bubble (default: the thread's `time`). */
  time: oneLine(8, 'time').optional(),
})

/**
 * Params of `chat-thread`: a phone-width messaging chat (booking demo). A header (round avatar,
 * name, status), a wallpaper-tinted body and ≤ 8 messages. Before every `out` message three typing
 * dots show for `CHAT.typingSec` in the message's own slot (reserved at build: nothing reflows). A
 * `card` message is a booking confirmation (accent header, ≤ 3 `key: value` rows). The thread
 * scrolls up smoothly when a new message would overflow.
 */
export const chatThreadParams = z
  .object({
    avatar: imageSrc,
    name: oneLine(24, 'name'),
    status: oneLine(20, 'status').default('متصل'),
    messages: z.array(chatMessage).min(1, { message: 'رسالة واحدة على الأقل — messages needs at least one message' }).max(8, { message: 'ثماني رسائل على الأكثر — at most 8 messages' }),
    /** Bubble / header accent (default: the look's accent). */
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'اللون بصيغة ‎#rrggbb — accent must be a #rrggbb colour' }).optional(),
    /** Default timestamp of every message. */
    time: oneLine(8, 'time').default('10:30'),
    placeholder: oneLine(24, 'placeholder').default('اكتب رسالة'),
    at: safePoint.default({ x: 0.5, y: 0.5 }),
    /** Panel width (× safe width) and height (× safe height). */
    width: rangeAr(0.5, 1, 'width').default(0.78),
    height: rangeAr(0.4, 1, 'height').default(0.8),
    key: morphKey,
  })
  .superRefine((p, ctx) => {
    p.messages.forEach((m, i) => {
      if (m.rows && m.kind !== 'card') ctx.addIssue({ code: 'custom', path: ['messages', i, 'rows'], message: 'الصفوف لبطاقة الحجز فقط (kind: "card") — rows need kind "card"' })
      if (i > 0 && m.at < p.messages[i - 1]!.at) ctx.addIssue({ code: 'custom', path: ['messages', i, 'at'], message: 'الرسائل مرتبة تصاعديًا — messages must be in ascending order of at' })
      if (i > 0 && m.side === 'out' && m.at - CHAT.typingSec < p.messages[i - 1]!.at) {
        ctx.addIssue({ code: 'custom', path: ['messages', i, 'at'], message: `الكتابة تبدأ قبل الرسالة السابقة؛ اترك ${CHAT.typingSec} ث على الأقل — an out message needs ${CHAT.typingSec} s of typing after the previous message` })
      }
    })
  })

export type ChatThreadParams = z.infer<typeof chatThreadParams>

export const CHAT = {
  /** Typing dots before an `out` message (s). */
  typingSec: 0.6,
  /** Bubble entrance: scale `popFrom` → 1 from its tail corner (settle) + fade, over `popSec`. */
  popFrom: 0.9,
  popSec: 0.32,
  /** The typing bubble fades in / out over `dotsFade`; the dots bounce with period `dotPeriod`. */
  dotsFade: 0.14,
  dotPeriod: 0.9,
  /** Scroll eases (easeInOutCubic) over `scrollSec` to each new bottom. */
  scrollSec: 0.45,
  /** The panel rises in over `panelSec`. */
  panelSec: 0.4,
  /** Font px at 1080 (scaled): message, name, status, timestamp, card rows. */
  textPx: 33,
  namePx: 34,
  statusPx: 24,
  timePx: 21,
  rowPx: 28,
  /** Fixed chat colours (a chat reads the same in every world). */
  wallpaper: '#efeae2',
  inBubble: '#ffffff',
  ink: '#111b21',
  muted: '#667781',
  header: '#ffffff',
  tick: '#53bdeb',
} as const

/** The typing window of message `i` (out only): [at − typingSec, at). */
export function typingWindow(p: Pick<ChatThreadParams, 'messages'>, i: number): [number, number] | undefined {
  const m = p.messages[i]!
  return m.side === 'out' ? [m.at - CHAT.typingSec, m.at] : undefined
}

/** Scene-level check: every message lies inside the scene. */
export function timingIssueOfChatThread(p: ChatThreadParams, sceneLen: number): SceneTimingIssue | undefined {
  const k = p.messages.findIndex((m) => m.at >= sceneLen)
  if (k >= 0) return { path: ['messages', k, 'at'], ar: `الرسالة ${k + 1} بعد نهاية المشهد (${sceneLen} ث)`, en: `messages[${k}] at ${p.messages[k]!.at} s is at or past the scene end (${sceneLen} s local)` }
  return undefined
}

/** Sound cues: a `pop` per message, a `final` on a booking card. */
export function cuesOfChatThread(p: ChatThreadParams, _ctx: { duration: number }): Cue[] {
  return p.messages.map((m) => ({ t: m.at, kind: m.kind === 'card' ? ('final' as const) : ('pop' as const) }))
}
