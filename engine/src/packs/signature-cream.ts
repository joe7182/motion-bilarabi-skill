import type { Pack } from './schema'

/** Cream paper, black ink, one orange accent; a centred headline over one self-building illustration. */
export const signatureCream: Pack = {
  id: 'signature-cream', n: 1, ar: 'كريمي توقيع', en: 'Signature cream', img: 'heavy-word',
  does: 'ورق كريمي وحبر أسود وكلمة بصندوق برتقالي؛ العنوان بالنص ورسمة تبني نفسها تحته، وحركة ناعمة',
  ask: 'خلّ الستايل كريمي',
  look: 'signature',
  layout: { headline: { y: 0.25, align: 'centre', maxPx: 180 }, showY: 0.58, objects: 'below', gap: 0.06, keyMark: 'box' },
  motion: { ease: 'easy', enter: 'rise', blur: 3, camera: 'drift' },
  transitions: { default: 'morph', section: 'paper-tear', more: ['page-turn', 'flood'] },
  background: [{ type: 'backdrop', params: { world: 'paper' } }],
  roles: {
    headline: { type: 'kinetic-text', params: { mode: 'line', enter: 'rise' } },
    keySentence: { type: 'heavy-word', params: { size: 0.78 } },
    number: { type: 'counter', params: {} },
    list: { type: 'checklist', params: {} },
    quote: { type: 'editorial-type', params: { size: 150 } },
    compare: { type: 'before-after', params: {} },
    cta: { type: 'comment-cta', params: {} },
    signOff: { type: 'signature-card', params: {} },
  },
  avoid: { scenes: ['glitch-text', 'laser-type', 'laser-beam', 'tech-grid'], transitions: ['glitch-cut', 'pixel-curtain'] },
}
