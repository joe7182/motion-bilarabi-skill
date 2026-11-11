import type { Pack } from './schema'

/** Flat matte white, black, one red word; a very large headline flush right on a strict grid with thin rules. */
export const swissRed: Pack = {
  id: 'swiss-red', n: 4, ar: 'سويسري أحمر', en: 'Swiss red',
  does: 'أبيض مطفي وأسود وكلمة حمرة وحدة بكل سطر؛ عنوان كبير على اليمين، خطوط رفيعة وأرقام أقسام، وحركة مستقيمة دقيقة',
  ask: 'خلّ الستايل سويسري أحمر',
  look: 'swiss-red',
  layout: { headline: { y: 0.3, align: 'right', maxPx: 250 }, showY: 0.62, objects: 'side', gap: 0.05, keyMark: 'colour' },
  motion: { ease: 'snappy', enter: 'mask-line', blur: 0, camera: 'locked' },
  transitions: { default: 'color-wipe', section: 'ink-slab', more: ['blinds', 'reveal'] },
  background: [{ type: 'backdrop', params: { world: 'paper' } }],
  marks: { rules: [{ y: 0.06 }, { y: 0.97 }], number: { value: 1, corner: 'top-left' } },
  stage: { kind: 'column', width: 1.06 },
  roles: {
    headline: { type: 'kinetic-text', params: { mode: 'stack', enter: 'mask-line' } },
    keySentence: { type: 'editorial-type', params: { size: 170 } },
    number: { type: 'section-number', params: {} },
    list: { type: 'checklist', params: {} },
    quote: { type: 'editorial-type', params: { size: 150 } },
    compare: { type: 'before-after', params: {} },
    cta: { type: 'comment-cta', params: {} },
    signOff: { type: 'signature-card', params: {} },
  },
  avoid: { scenes: ['glitch-text', 'laser-type', 'glow-words', 'sketch-words'], transitions: ['glitch-cut', 'paper-tear', 'layer-explode'] },
}
