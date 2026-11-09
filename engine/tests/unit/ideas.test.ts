import { describe, it, expect } from 'vitest'
import { IDEA_IDS, IDEAS, type BeatInfo, type DirectorCtx } from '../../src/core/recipes/ideas'
import { styleSchema } from '../../src/core/style'

const ctx: DirectorCtx = { type: 'explainer', hero: false, camera: 'push' }

/** A beat over transcript words 0..n−1 (indices are transcript indices). */
const beat = (words: string[], o: Partial<BeatInfo> = {}): BeatInfo => ({ i: 1, from: 0, to: words.length, words, stress: [], numbers: [], keywords: [], ...o })

describe('IDEAS', () => {
  it('kashida-stretch needs a stressed (or keyword) word with a kashida slot: «تمدد» yes, «درود» no', () => {
    expect(IDEAS['kashida-stretch'].needs(beat(['تمدد'], { stress: [0] }), ctx)).toBe(true)
    expect(IDEAS['kashida-stretch'].needs(beat(['درود'], { stress: [0] }), ctx)).toBe(false)
    // Not stressed and not a keyword: nothing to stretch.
    expect(IDEAS['kashida-stretch'].needs(beat(['تمدد']), ctx)).toBe(false)
  })
  it('strike needs a negation (or number) followed by a word: «بدون 300» yes, «300» alone no', () => {
    expect(IDEAS.strike.needs(beat(['بدون', '300'], { numbers: [1] }), ctx)).toBe(true)
    expect(IDEAS.strike.needs(beat(['300'], { numbers: [0] }), ctx)).toBe(false)
    expect(IDEAS.strike.needs(beat(['لا', 'تنتظر']), ctx)).toBe(true)
  })
  it('section-number needs a section start; shape-states a UI word in explainer/product-launch; hero-handoff a hero', () => {
    expect(IDEAS['section-number'].needs(beat(['الحل'], { section: 'الحل', sectionIndex: 2 }), ctx)).toBe(true)
    expect(IDEAS['section-number'].needs(beat(['الحل']), ctx)).toBe(false)
    const ui = beat(['اضغط', 'الزر'], { keywords: [{ word: 1, visual: { type: 'ui' } }] })
    expect(IDEAS['shape-states'].needs(ui, ctx)).toBe(true)
    expect(IDEAS['shape-states'].needs(ui, { ...ctx, type: 'corporate' })).toBe(false)
    expect(IDEAS['shape-states'].needs(beat(['اضغط', 'هنا']), ctx)).toBe(false)
    expect(IDEAS['hero-handoff'].needs(beat(['كلمة']), ctx)).toBe(false)
    expect(IDEAS['hero-handoff'].needs(beat(['كلمة']), { ...ctx, hero: true })).toBe(true)
  })
  it('every idea has an Arabic name; the signature ideas are the 8 of the brief', () => {
    expect(IDEA_IDS).toHaveLength(16)
    for (const id of IDEA_IDS) expect(IDEAS[id].ar, id).toMatch(/^[؀-ۿ]/)
    expect(IDEA_IDS.filter((id) => IDEAS[id].signature).sort()).toEqual(
      ['camera-push', 'flood', 'hero-handoff', 'kashida-stretch', 'section-number', 'shape-states', 'word-wall', 'world-flip'].sort(),
    )
  })
  it('style.json signature is narrowed to idea ids', () => {
    const base = {
      version: 1,
      sources: [{ file: 'a.mp4', sha1: 'a'.repeat(40), duration: 10 }],
      rhythm: { eventsPerSec: [2, 3], medianEventGap: [0.3, 0.4], maxEventGap: 0.9, movingPct: 0.9, medianShot: 1, cutsPerSec: 0.5, continuous: false },
      colours: [],
      text: { density: 'medium' },
      motion: { size: 'medium' },
      warnings: [],
    }
    expect(styleSchema.safeParse({ ...base, signature: ['flood', 'kashida-stretch'] }).success).toBe(true)
    expect(styleSchema.safeParse({ ...base, signature: ['not-an-idea'] }).success).toBe(false)
  })
})
