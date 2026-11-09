import type { Cue } from '../audio-plan'
import { z } from 'zod'
import { oneLineAr } from './common'

/**
 * `knowledge-timeline`: the hero of an "AI knowledge" explainer. A time line read right → left
 * (Arabic): data drops onto it up to a cutoff, a flag marks the cutoff, everything after it fogs
 * (news the model never saw, with «؟»), and — optionally — a search bridge arcs over the fog to
 * «اليوم», fetches a page and carries it back, clearing the news it lands on.
 */
export const knowledgeTimelineParams = z.object({
  /** Tick labels, oldest first (shown right → left). */
  ticks: z.array(oneLineAr(8, 'ticks[]')).min(2).max(8).default(['٢٠٢٢', '٢٠٢٣', '٢٠٢٤', '٢٠٢٥', '٢٠٢٦']),
  /** Where the cutoff sits along the line (0 = the first tick, 1 = today). */
  cut: z.number().min(0.2).max(0.9).default(0.6),
  cutLabel: oneLineAr(18, 'cutLabel').default('توقّف المعرفة'),
  todayLabel: oneLineAr(10, 'todayLabel').default('اليوم'),
  /** News cards in the fog (short labels). */
  news: z.array(oneLineAr(14, 'news[]')).max(3).default(['خبر اليوم', 'تحديث جديد', 'نتيجة مباراة']),
  /** The line's height in the frame (fraction of the safe height). */
  y: z.number().min(0.2).max(0.9).default(0.74),
  /** Local s: the data fills, the cutoff drops, the fog rolls in, the search bridge (optional). */
  fillAt: z.number().min(0).default(0.1),
  fillDur: z.number().min(0.3).max(5).default(1.6),
  cutAt: z.number().min(0).default(1.9),
  fogAt: z.number().min(0).default(2.8),
  bridgeAt: z.number().min(0).optional(),
  bridgeLabel: oneLineAr(10, 'bridgeLabel').default('بحث'),
})
export type KnowledgeTimelineParams = z.infer<typeof knowledgeTimelineParams>
export const TIMELINE = { cutDrop: 0.45, fog: 0.7, bridge: 0.9, fetch: 0.8 } as const

export const cuesOfKnowledgeTimeline = (p: KnowledgeTimelineParams): Cue[] => [
  { t: p.fillAt, kind: 'count', duration: p.fillDur },
  { t: p.cutAt, kind: 'impact' },
  ...(p.bridgeAt !== undefined ? [{ t: p.bridgeAt, kind: 'whoosh' as const }] : []),
]

/**
 * `signature-card`: the vertical version of the creator's master signature card
 * (`brand/signature-card.html`): photo in a drawn ring, name, the Latin name, the tagline, a rule,
 * and the creator's links. Everything left out comes from brand.json (render fills it).
 */
export const signatureCardParams = z.object({
  /** The creator's photo; without one the card shows the name's first letter. Filled from brand.json `avatar`. */
  photo: z.string().min(1).optional(),
  /** Filled from brand.json `name` when left out. */
  name: z
    .string({ error: 'الاسم مطلوب: اكتب name أو أضف ملف ~/.mba/brand.json — name is required: set it or create ~/.mba/brand.json' })
    .pipe(oneLineAr(24, 'name')),
  en: z.string().min(1).max(30).optional(),
  line: oneLineAr(30, 'line').optional(),
  lineAccent: oneLineAr(20, 'lineAccent').optional(),
  /** Only the links given get a row (filled from brand.json `links`). A handle (@name) or a full address. */
  links: z.object({ instagram: z.string().min(1).max(40).optional(), youtube: z.string().min(1).max(40).optional(), tiktok: z.string().min(1).max(40).optional(), site: z.string().min(1).max(40).optional() }).default({}),
  /** Card colours (filled from brand.json `colors`: bg, text, primary). */
  colors: z.object({ bg: z.string().regex(/^#[0-9a-fA-F]{6}$/), ink: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).optional(),
})
export type SignatureCardParams = z.infer<typeof signatureCardParams>
export const cuesOfSignatureCard = (): Cue[] => [{ t: 0.1, kind: 'pop' }]

/**
 * `web-crawl`: a search page (a query typed into a search bar, results slide in), a crawler bot
 * that scans down the results and picks one, and the picked page opening as an illustrated web
 * page (address bar, a picture block, text lines; `weak` adds the signs of a weak page: no lock,
 * ad blocks, a broken picture).
 */
export const webCrawlParams = z.object({
  query: oneLineAr(30, 'query'),
  results: z.array(z.object({ title: oneLineAr(30, 'results[].title'), url: z.string().min(3).max(34) })).min(2).max(5),
  /** The result the bot picks (0-based). */
  pick: z.number().int().min(0).default(2),
  weak: z.boolean().default(true),
  typeAt: z.number().min(0).default(0.2),
  listAt: z.number().min(0).default(1.0),
  crawlAt: z.number().min(0).default(1.6),
  openAt: z.number().min(0).default(3.0),
})
export type WebCrawlParams = z.infer<typeof webCrawlParams>
export const CRAWL = { type: 0.6, perRow: 0.32, open: 0.5 } as const

/**
 * `misquote`: a web page with one highlighted sentence, and the AI's summary of it underneath that
 * gets one thing wrong; the wrong part is circled, then struck, and the page's version glows.
 */
export const misquoteParams = z.object({
  url: z.string().min(3).max(34).default('news-site.com/article'),
  /** The page's sentence, split around the fact: before · fact · after. */
  page: z.tuple([oneLineAr(24, 'page[0]'), oneLineAr(10, 'page[1]'), oneLineAr(20, 'page[2]')]),
  /** The AI summary's version of the same sentence (its fact is the wrong one). */
  said: z.tuple([oneLineAr(24, 'said[0]'), oneLineAr(10, 'said[1]'), oneLineAr(20, 'said[2]')]),
  aiName: oneLineAr(20, 'aiName').default('ملخّص المساعد'),
  pageAt: z.number().min(0).default(0.1),
  saidAt: z.number().min(0).default(0.9),
  strikeAt: z.number().min(0).default(1.8),
})
export type MisquoteParams = z.infer<typeof misquoteParams>

/**
 * `context-window`: search result cards break into token blocks that pour into a framed window
 * («نافذة السياق»); a capacity meter climbs; at full the window flashes «ممتلئة».
 */
export const contextWindowParams = z.object({
  title: oneLineAr(20, 'title').default('نافذة السياق'),
  fullLabel: oneLineAr(12, 'fullLabel').default('ممتلئة'),
  sources: z.array(oneLineAr(18, 'sources[]')).min(1).max(4).default(['نتيجة ١', 'نتيجة ٢', 'نتيجة ٣']),
  /** Local s the cards break up, and how long the pour takes. */
  at: z.number().min(0).default(0.4),
  pour: z.number().min(0.5).max(6).default(2.6),
})
export type ContextWindowParams = z.infer<typeof contextWindowParams>

export const cuesOfWebCrawl = (p: WebCrawlParams): Cue[] => [{ t: p.typeAt, kind: 'type-letter' }, { t: p.openAt, kind: 'action' }]
export const cuesOfMisquote = (p: MisquoteParams): Cue[] => [{ t: p.strikeAt, kind: 'hit' }]
export const cuesOfContextWindow = (p: ContextWindowParams): Cue[] => [{ t: p.at, kind: 'whoosh' }, { t: p.at + p.pour, kind: 'impact' }]

/**
 * `code-chat`: a Claude Code-style terminal chat. The user's line on a «>» prompt, a thinking
 * spinner, then the reply typed in after an orange bullet, with optional source links under it;
 * an input box with a blinking cursor at the bottom.
 */
export const codeChatParams = z.object({
  title: z.string().min(1).max(30).default('claude'),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'ai']),
        text: oneLineAr(80, 'messages[].text'),
        at: z.number().min(0),
        /** ai only: source links shown under the reply. */
        sources: z.array(z.string().min(3).max(40)).max(3).optional(),
      }),
    )
    .min(1)
    .max(4),
  /** Seconds of «thinking» before each reply. */
  think: z.number().min(0).max(3).default(0.7),
  /** Window top and height as fractions of the safe height. */
  top: z.number().min(0).max(0.6).default(0.2),
  height: z.number().min(0.3).max(0.8).default(0.6),
})
export type CodeChatParams = z.infer<typeof codeChatParams>
export const cuesOfCodeChat = (p: CodeChatParams): Cue[] => p.messages.map((m) => ({ t: m.at, kind: m.role === 'ai' ? ('pop' as const) : ('type-letter' as const) }))
