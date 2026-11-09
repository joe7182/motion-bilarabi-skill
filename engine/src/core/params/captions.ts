import { z } from 'zod'
import { splitWords } from '../text'

/**
 * Captions: the voice's words on screen a short phrase at a time, the word being spoken marked.
 * A phrase closes on a breath (a pause), on sentence punctuation, or when it is full.
 */

export const CAPTION_SKINS = ['spoken-box', 'karaoke', 'bold-outline', 'soft-shadow', 'paper-tag'] as const
export type CaptionSkin = (typeof CAPTION_SKINS)[number]

const captionWord = z.object({
  text: z
    .string()
    .min(1)
    .max(40)
    .refine((t) => t.trim() === t && splitWords(t).length === 1, { message: 'كلمة واحدة — one word per entry' }),
  /** Local seconds: when the word starts and ends. */
  at: z.number().min(0),
  end: z.number().min(0),
  /** Optional emphasis for one word: accent colour, underline, or a pop as it is spoken. */
  emph: z.enum(['accent', 'underline', 'pop']).optional(),
})

const phrase = z.object({ at: z.number().min(0), end: z.number().min(0), words: z.array(captionWord).min(1).max(9) })

export const captionsParams = z.object({
  cues: z.array(phrase).min(1).max(400),
  skin: z.enum(CAPTION_SKINS).default('spoken-box'),
  presentation: z.enum(['pill', 'minimal', 'strip']).default('pill'),
  /** Vertical centre of the caption, as a fraction of the frame height. */
  y: z.number().min(0.5).max(0.9).default(0.74),
  /** Font size ceiling in px at 1080 wide; long phrases shrink down to `CAPTIONS.minPx`. */
  maxPx: z.number().min(30).max(90).default(72),
})
export type CaptionsParams = z.infer<typeof captionsParams>

export const CAPTIONS = {
  /** Phrase building: the most words in one phrase, and the silence (s) that closes a phrase. */
  maxWords: 4,
  gap: 0.25,
  /** How long (s) a phrase may linger after its last word, if nothing follows sooner. */
  hold: 0.5,
  /** Fade-in length (s) of a new phrase. */
  enter: 0.067,
  minPx: 34,
  /** Width share of the safe area the phrase may use; box padding in em. */
  band: 0.94,
  padX: 0.55,
  padY: 0.22,
  /** The `pop` emphasis: peak scale and its length (s). */
  pop: 1.18,
  popSec: 0.18,
} as const

type TimedWord = { text: string; at: number; end: number }
const CLOSES_SENTENCE = /[.!?…،؟؛]$/

/** Turns a flat list of timed words into on-screen phrases that never overlap. */
export function groupCaptions(words: readonly TimedWord[], o: { maxWords?: number; gap?: number; hold?: number } = {}) {
  const limit = o.maxWords ?? CAPTIONS.maxWords
  const breath = o.gap ?? CAPTIONS.gap
  const linger = o.hold ?? CAPTIONS.hold
  const phrases: { at: number; end: number; words: TimedWord[] }[] = []
  let open: TimedWord[] = []
  const close = () => {
    if (open.length) phrases.push({ at: open[0]!.at, end: open[open.length - 1]!.end, words: open })
    open = []
  }
  for (const raw of words) {
    const text = raw.text.replace(/\s+/g, '')
    if (!text) continue
    const prev = open[open.length - 1]
    if (prev && (raw.at - prev.end > breath || open.length === limit)) close()
    open.push({ text, at: raw.at, end: raw.end })
    if (CLOSES_SENTENCE.test(text)) close()
  }
  close()
  for (let i = 0; i < phrases.length; i++) {
    const lingerTo = phrases[i]!.end + linger
    const nextAt = phrases[i + 1]?.at ?? Infinity
    phrases[i]!.end = Math.min(lingerTo, nextAt)
  }
  return phrases
}
