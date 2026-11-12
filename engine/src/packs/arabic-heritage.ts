import type { Pack } from './schema'

/** Deep teal and gold; a star tiling that draws itself, classic serif headlines, slow graceful motion. */
export const arabicHeritage: Pack = {
  id: 'arabic-heritage', n: 5, ar: 'تراث عربي', en: 'Arabic heritage',
  does: 'أخضر مزرق غامق وذهبي؛ زخرفة نجوم ترسم نفسها بالخلفية، عناوين بخط نسخي كلاسيكي بالنص، وحركة هادئة وأنيقة',
  ask: 'خلّ الستايل تراث عربي',
  look: 'heritage',
  layout: { headline: { y: 0.3, align: 'centre', maxPx: 200 }, showY: 0.6, objects: 'below', gap: 0.07, keyMark: 'colour' },
  motion: { ease: 'easy', enter: 'rise', blur: 3, camera: 'drift' },
  transitions: { default: 'iris', section: 'pixel-curtain', more: ['reveal'], params: { iris: { shape: 'star', color: 'accent' }, 'pixel-curtain': { color: 'accent' } } },
  background: [{ type: 'backdrop', params: { world: 'paper' } }, { type: 'geo-pattern', params: {} }],
  marks: { rules: [{ y: 0.03, from: 0.3, to: 0.7 }, { y: 0.985, from: 0.3, to: 0.7 }], alpha: 0.7 },
  stage: { kind: 'arch', width: 1.08 },
  talking: { captions: { skin: 'soft-shadow', presentation: 'minimal', emph: 'accent' }, punch: { zoom: 1.08, ease: 'smooth' }, popup: 'colour', strip: 'arch' },
  roles: {
    headline: { type: 'kinetic-text', params: { mode: 'line', enter: 'rise' } },
    keySentence: { type: 'editorial-type', params: { size: 170 } },
    number: { type: 'counter', params: {} },
    list: { type: 'checklist', params: {} },
    quote: { type: 'editorial-type', params: { size: 150 } },
    compare: { type: 'before-after', params: {} },
    cta: { type: 'comment-cta', params: {} },
    signOff: { type: 'signature-card', params: {} },
  },
  avoid: { scenes: ['glitch-text', 'laser-type', 'laser-beam', 'tech-grid', 'sketch-words'], transitions: ['glitch-cut', 'paper-tear', 'layer-explode', 'whip-pan'] },
}
