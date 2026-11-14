import { describe, expect, it } from 'vitest'
import { styledTitleParams } from '../../src/core/params/styled-title'
import { TITLE_FONT_IDS, TITLE_FONTS, TITLE_STYLE_IDS, TITLE_STYLES, titleCss, titleHtml, type TitleSpec } from '../../src/core/title-styles'

const base: TitleSpec = { text: '٣ أخطاء', key: 'بالمونتاج', lines: 1, style: 'nebula', font: 'cairo', layer: 'front', cx: 0.5, cy: 0.5, w: 0.8, size: 100, animIn: 'words', animOut: 'blur', at: 0.2, outAt: 2.4 }

describe('title styles (styled-title and mba pick)', () => {
  it('the id lists match the style and font tables', () => {
    expect(TITLE_STYLES.map((s) => s.id)).toEqual([...TITLE_STYLE_IDS])
    expect(TITLE_FONTS.map((f) => f.id)).toEqual([...TITLE_FONT_IDS])
  })
  it('one span per word, the key word last, a line break only in two-line mode', () => {
    const one = titleHtml(base)
    expect(one.match(/class="w/g)).toHaveLength(3)
    expect(one).toMatch(/class="w k"[^>]*>بالمونتاج</)
    expect(one).not.toContain('<br>')
    expect(titleHtml({ ...base, lines: 2 })).toContain('<br><span class="w k"')
  })
  it('classes carry style, font, layer, motion; out "none" leaves the exit off', () => {
    const h = titleHtml({ ...base, font: 'lalezar', layer: 'behind', animOut: 'none' })
    expect(h).toMatch(/class="hl s-nebula behind one f-lalezar in-words"/)
  })
  it('custom colours become variables (box with its opacity)', () => {
    const h = titleHtml({ ...base, colors: { text: '#ffffff', k1: '#ffd23f', k2: '#ffb000', box: '#000000', boxAlpha: 0.6 } })
    expect(h).toContain(' cc ')
    expect(h).toContain('--c-box:rgba(0,0,0,0.60)')
  })
  it('a title with no key word has no key span; text is escaped', () => {
    const h = titleHtml({ ...base, text: 'a<b', key: '' })
    expect(h).not.toContain('class="w k"')
    expect(h).toContain('a&lt;b')
  })
  it('the CSS is scoped and covers every style and font', () => {
    const css = titleCss('.x')
    for (const id of TITLE_STYLE_IDS) expect(css).toContain(`.x .hl.s-${id}`)
    for (const id of TITLE_FONT_IDS) expect(css).toContain(`.x .hl.f-${id}`)
  })
  it('params: defaults, and a pick.json title parses', () => {
    const p = styledTitleParams.parse({ text: 'عنوان' })
    expect(p).toMatchObject({ lines: 1, style: 'nebula', font: 'cairo', layer: 'front', in: 'blur', out: 'blur' })
    expect(() => styledTitleParams.parse({ text: 'x', font: 'comic-sans' })).toThrow()
  })
})
