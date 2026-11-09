import { hasArabic, splitWords } from '../../core/text'

/**
 * Text units: the only sanctioned way to put text on stage. Arabic is never split below a whole
 * word, so letters keep their joined shapes. Each unit carries `data-mba-text` = word | line | typing,
 * `dir="rtl"` + `lang="ar"` when its text contains Arabic, and `dir="ltr"` otherwise.
 */
export type TextUnitKind = 'word' | 'line' | 'typing'

/** `rtl` when `text` has any Arabic letter, else `ltr`. */
export function textDir(text: string): 'rtl' | 'ltr' {
  return hasArabic(text) ? 'rtl' : 'ltr'
}

function tag(el: HTMLElement, kind: TextUnitKind, text: string, cls?: string, word?: number): void {
  el.dataset.mbaText = kind
  // Transcript word index: lets a highlight or emphasis address the unit by word, not by position.
  if (word !== undefined) el.dataset.mbaWord = String(word)
  // Always set an explicit direction: a Latin-only unit inheriting the stage's rtl would put its
  // edge punctuation on the wrong side ("#AI!" shown as "!AI#").
  el.dir = textDir(text)
  if (hasArabic(text)) el.lang = 'ar'
  if (cls) el.className = cls
}

/**
 * One inline-block span per `splitWords` word, separated by single-space text nodes. `words`, when
 * given, holds one transcript word index per word in order (`data-mba-word`).
 */
export function wordUnits(parent: HTMLElement, text: string, cls?: string, words?: readonly (number | undefined)[]): HTMLSpanElement[] {
  const spans: HTMLSpanElement[] = []
  splitWords(text).forEach((word, i) => {
    if (i > 0) parent.append(document.createTextNode(' '))
    const span = document.createElement('span')
    tag(span, 'word', word, cls, words?.[i])
    span.style.display = 'inline-block'
    span.textContent = word
    parent.append(span)
    spans.push(span)
  })
  return spans
}

/**
 * Word units for a line that mixes Arabic with Latin words or digits (e.g. `تحديث Gemini 3 الجديد`).
 *
 * Inline-block word units are bidi-neutral, so inside an RTL line a run like `Gemini 3` would be
 * laid out right to left as `3 Gemini`. Each run of consecutive words without Arabic letters is
 * therefore wrapped in an inline `dir=ltr` isolate (`data-mba-bidi="ltr"`) that keeps its
 * left-to-right order, while the run as a whole takes its place in the RTL line. Returns the word
 * spans in logical (`splitWords`) order; words are never split. `words` (one transcript index per
 * word, in order) is forwarded to `wordUnits`.
 */
export function bidiWordUnits(parent: HTMLElement, text: string, cls?: string, words?: readonly (number | undefined)[]): HTMLSpanElement[] {
  const runs: { ltr: boolean; words: string[] }[] = []
  for (const word of splitWords(text)) {
    const ltr = !hasArabic(word)
    const last = runs[runs.length - 1]
    if (last && last.ltr === ltr) last.words.push(word)
    else runs.push({ ltr, words: [word] })
  }
  const spans: HTMLSpanElement[] = []
  let done = 0
  runs.forEach((run, i) => {
    if (i > 0) parent.append(document.createTextNode(' '))
    let host = parent
    if (run.ltr) {
      host = document.createElement('span')
      host.dataset.mbaBidi = 'ltr'
      host.dir = 'ltr'
      host.style.unicodeBidi = 'isolate'
      parent.append(host)
    }
    spans.push(...wordUnits(host, run.words.join(' '), cls, words?.slice(done, done + run.words.length)))
    done += run.words.length
  })
  return spans
}

/** A whole line of text in one non-wrapping inline-block span; `word` is its transcript word index. */
export function lineUnit(parent: HTMLElement, text: string, cls?: string, word?: number): HTMLElement {
  const span = document.createElement('span')
  tag(span, 'line', text, cls, word)
  span.style.display = 'inline-block'
  span.style.whiteSpace = 'pre'
  span.textContent = text
  parent.append(span)
  return span
}

/**
 * A growing string rendered into a single text node (never one node per letter), followed by a
 * caret element with no text. `setProgress(n)` shows the first `n` code points of `full`, which
 * is also kept in `data-mba-full`.
 * The direction comes from the FULL text, so it never flips while the prefix grows; the caret sits
 * at the trailing edge (left for rtl, right for ltr).
 */
export function typingUnit(
  parent: HTMLElement,
  full: string,
): { el: HTMLElement; caret: HTMLElement; setProgress(chars: number): void } {
  const el = document.createElement('span')
  tag(el, 'typing', full)
  // The audit checks `dir` against the full text, not the growing prefix.
  el.dataset.mbaFull = full
  el.style.whiteSpace = 'pre'
  const node = document.createTextNode('')
  const caret = document.createElement('span')
  caret.dataset.mbaCaret = ''
  caret.setAttribute('aria-hidden', 'true')
  caret.style.display = 'inline-block'
  el.append(node, caret)
  parent.append(el)
  const points = [...full]
  return {
    el,
    caret,
    setProgress(chars: number) {
      const n = Math.max(0, Math.min(points.length, Math.floor(chars)))
      node.data = points.slice(0, n).join('')
    },
  }
}

/**
 * Binary-searches the integer font-size in [minPx, maxPx] so `el` fits inside `box`
 * (layout size, ignoring transforms). Sets and returns the chosen px; returns minPx if nothing fits.
 */
export function fitText(el: HTMLElement, box: { w: number; h: number }, maxPx: number, minPx: number): number {
  let lo = Math.ceil(minPx)
  let hi = Math.floor(maxPx)
  let best = lo
  const fits = () =>
    Math.max(el.scrollWidth, el.offsetWidth) <= box.w && Math.max(el.scrollHeight, el.offsetHeight) <= box.h
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    el.style.fontSize = `${mid}px`
    if (fits()) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  el.style.fontSize = `${best}px`
  return best
}
