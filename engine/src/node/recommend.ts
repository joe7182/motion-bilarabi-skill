import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { recommend, sentenceOf, type Sentence } from '../library/concepts'

/**
 * `mba recommend <projectDir> --from s --to s` or `mba recommend "<sentence>" [--seconds s]`:
 * the best concepts for a sentence, with reasons and ready scenes timed to its words (from the
 * project's transcript.json when a project is given).
 */
export function recommendCommand(target: string, o: { from?: number; to?: number; seconds?: number; top?: number }): string {
  let s: Sentence
  if (existsSync(target) && statSync(target).isDirectory()) {
    const tf = join(target, 'transcript.json')
    if (!existsSync(tf)) throw new Error(`لا يوجد transcript.json — no transcript.json in ${target}; run mba transcribe first`)
    if (o.from === undefined || o.to === undefined) throw new Error('أعطِ --from و --to بالثواني — give --from and --to (seconds)')
    const all = (JSON.parse(readFileSync(tf, 'utf8')) as { words: { text: string; start: number; end: number }[] }).words
    const words = all.filter((w) => w.start >= o.from! - 0.05 && w.start < o.to!)
    if (words.length === 0) throw new Error(`لا كلمات بين ${o.from} و ${o.to} — no words between ${o.from} and ${o.to} s`)
    s = { words, start: o.from, end: o.to, text: words.map((w) => w.text).join(' ') }
  } else {
    const seconds = o.seconds ?? Math.max(1.5, target.trim().split(/\s+/).length * 0.42)
    s = sentenceOf(target, 0, seconds)
  }
  const recs = recommend(s, o.top ?? 3)
  const lines = [`«${s.text}» — ${(s.end - s.start).toFixed(2)} s`]
  if (recs.length === 0) lines.push('ما لقيت فكرة مناسبة — no concept fits; design this sentence by hand')
  recs.forEach((r, i) => {
    lines.push('', `${i + 1}. ${r.ar} (${r.id}) — ${r.score}`, `   ${r.why}`, `   scenes: ${JSON.stringify(r.scenes)}`)
  })
  return lines.join('\n')
}
