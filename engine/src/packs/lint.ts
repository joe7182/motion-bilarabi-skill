import { PACKS } from './index'

/** The scene types that carry a headline, and how far its `y` may stray from the pack's before a note. */
export const PACK_LINT = { headlines: ['kinetic-text', 'laser-type', 'editorial-type'], band: 0.25 } as const

export interface PackNote {
  code: 'avoid-transition' | 'avoid-scene' | 'headline-band'
  /** Seconds into the video. */
  at: number
  message: string
}

interface LintStoryboard {
  pack?: string
  scenes: { id: string; type: string; start: number; params: Record<string, unknown> }[]
  transitions?: { type: string; at: number }[]
}

/**
 * Style notes for a storyboard that names a pack: a transition or scene type the pack advises
 * against, a headline far from where the pack keeps its headlines. Advice only — a person's pick is
 * never refused. Empty without a pack.
 */
export function packLint(sb: LintStoryboard): PackNote[] {
  const pack = sb.pack ? (PACKS as Record<string, (typeof PACKS)[keyof typeof PACKS]>)[sb.pack] : undefined
  if (!pack) return []
  const name = `«${pack.ar}»`
  const notes: PackNote[] = []
  for (const tr of sb.transitions ?? []) {
    if ((pack.avoid.transitions as string[]).includes(tr.type)) {
      const better = [pack.transitions.default, pack.transitions.section, ...pack.transitions.more].join(', ')
      notes.push({ code: 'avoid-transition', at: tr.at, message: `الانتقال ${tr.type} ما يلوگ لستايل ${name}؛ الأقرب له: ${better} — transition "${tr.type}" clashes with pack ${pack.id}; its own are ${better}` })
    }
  }
  for (const sc of sb.scenes) {
    if (pack.avoid.scenes.includes(sc.type)) {
      notes.push({ code: 'avoid-scene', at: sc.start, message: `المشهد ${sc.id} (${sc.type}) من ستايل ثاني غير ${name} — scene "${sc.id}" (${sc.type}) belongs to another look than pack ${pack.id}` })
    }
    const y = sc.params.y
    // A kinetic headline: `line` mode on the top tracks; giant and stacked words are shows, not headlines.
    const headline = (PACK_LINT.headlines as readonly string[]).includes(sc.type) && (sc.type !== 'kinetic-text' || (sc.params.mode === 'line' && sc.id.endsWith('-h')))
    if (headline && typeof y === 'number' && Math.abs(y - pack.layout.headline.y) > PACK_LINT.band) {
      notes.push({ code: 'headline-band', at: sc.start, message: `عنوان ${sc.id} بعيد عن مكان عناوين ${name} (y ${y}، والستايل ${pack.layout.headline.y}) — headline "${sc.id}" sits far from where pack ${pack.id} keeps its headlines (y ${y} vs ${pack.layout.headline.y})` })
    }
  }
  return notes.sort((a, b) => a.at - b.at)
}
