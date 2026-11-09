import { describe, expect, it } from 'vitest'
import { fillSignatureCards } from '../../src/node/render'
import { signatureCardParams } from '../../src/core/params/explainer'
import { parseBrand } from '../../src/core/brand'

const brand = parseBrand({
  name: 'سارة', handle: '@sara', nameEn: 'Sara Ali', tagline: 'أصمم بالذكاء الاصطناعي', taglineAccent: 'وأشاركك.',
  colors: { primary: '#2255ff', secondary: '#111111', bg: '#ffffff', text: '#111111' },
  avatar: 'me.jpg', links: { instagram: '@sara', site: 'sara.dev' },
})

describe('signature-card from brand.json', () => {
  it('fills what the scene leaves out, keeps what it sets', () => {
    const obj: Record<string, unknown> = { brand, scenes: [{ type: 'signature-card', params: { name: 'سارة علي' } }, { type: 'stamp', params: {} }] }
    fillSignatureCards(obj)
    const p = (obj.scenes as { params: Record<string, unknown> }[])[0]!.params
    expect(p.name).toBe('سارة علي')
    expect(p.photo).toBe('me.jpg')
    expect(p.en).toBe('Sara Ali')
    expect(p.links).toEqual({ instagram: '@sara', site: 'sara.dev' })
    expect(p.colors).toEqual({ bg: '#ffffff', ink: '#111111', accent: '#2255ff' })
    expect(signatureCardParams.parse(p).line).toBe('أصمم بالذكاء الاصطناعي')
    expect((obj.scenes as { params: Record<string, unknown> }[])[1]!.params).toEqual({})
  })
  it('without a brand and without a name the card is refused', () => {
    expect(signatureCardParams.safeParse({}).success).toBe(false)
  })
})
