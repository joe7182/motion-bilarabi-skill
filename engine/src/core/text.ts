/** Split on Unicode whitespace; never splits inside a word, punctuation stays attached. */
export function splitWords(text: string): string[] {
  return text.split(/\s+/u).filter((w) => w.length > 0)
}

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/u

export function hasArabic(s: string): boolean {
  return ARABIC.test(s)
}

/**
 * Kashida (tatweel U+0640): stretching an Arabic word by lengthening its joins, never by spacing
 * letters apart. Operates on logical text only (presentation forms never reach these functions).
 */
export const TATWEEL = 'ـ'

/** Letters that do not join to the letter after them: a tatweel can never follow them. */
export const NO_JOIN_LEFT: ReadonlySet<string> = new Set([...'اأإآٱدذرزوؤةىء'])

/** Fathatan…sukun, superscript alef; the tatweel itself counts so re-stretching never doubles. */
export const HARAKAT = /[ً-ْٰـ]/u

/** Most tatweels one word may carry, however large the request. */
export const MAX_TATWEEL = 12
/** Most tatweels in one join; beyond this a word looks like a rope, so other joins take the rest. */
export const KASHIDA_MAX_PER_SLOT = 4

const ARABIC_LETTER = /[ء-يٮ-ۓۺ-ۿݐ-ݿ]/u
const ALEF_FORMS = new Set([...'اأإآٱ'])

/**
 * Code-point indices after which a tatweel may go. A slot is the last mark of a joining Arabic
 * letter whose next base letter is Arabic too. Excluded: letters in `NO_JOIN_LEFT`, lam + alef
 * (a ligature a tatweel would break).
 */
export function kashidaSlots(word: string): number[] {
  const cp = [...word]
  const isMark = (c: string) => HARAKAT.test(c)
  const baseAfter = (i: number): number => {
    let j = i + 1
    while (j < cp.length && isMark(cp[j]!)) j++
    return j
  }
  const slots: number[] = []
  for (let i = 0; i < cp.length; i++) {
    const c = cp[i]!
    if (isMark(c) || !ARABIC_LETTER.test(c) || NO_JOIN_LEFT.has(c)) continue
    const next = baseAfter(i)
    if (next >= cp.length || !ARABIC_LETTER.test(cp[next]!)) continue
    if (c === 'ل' && ALEF_FORMS.has(cp[next]!)) continue
    slots.push(next - 1)
  }
  return slots
}

/** True when `word` has at least one place for a tatweel. */
export function isStretchable(word: string): boolean {
  return kashidaSlots(word).length > 0
}

/**
 * Inserts `n` tatweels (clamped to 0..`MAX_TATWEEL`), spread over the slots: the slot nearest the
 * middle of the word first, then alternating outward, one at a time (round-robin, at most
 * `KASHIDA_MAX_PER_SLOT` per slot). A word that already holds a tatweel is returned unchanged, so
 * stretching twice never doubles.
 */
export function stretchArabic(word: string, n: number): string {
  const want = Math.max(0, Math.min(MAX_TATWEEL, Math.floor(n)))
  if (want === 0 || word.includes(TATWEEL)) return word
  const cp = [...word]
  const mid = (cp.length - 1) / 2
  const slots = kashidaSlots(word).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
  if (slots.length === 0) return word
  const per = new Map<number, number>(slots.map((s) => [s, 0]))
  let left = Math.min(want, slots.length * KASHIDA_MAX_PER_SLOT)
  while (left > 0) {
    for (const s of slots) {
      if (left === 0) break
      if (per.get(s)! < KASHIDA_MAX_PER_SLOT) {
        per.set(s, per.get(s)! + 1)
        left--
      }
    }
  }
  return cp.map((c, i) => c + TATWEEL.repeat(per.get(i) ?? 0)).join('')
}
