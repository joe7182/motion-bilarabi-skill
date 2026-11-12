import type { Pack } from './schema'

/** Off-white paper with mustard, teal, coral and navy cut shapes around the text; bouncy, hand-made motion. */
export const cutPaper: Pack = {
  id: 'cut-paper', n: 6, ar: 'ورق مقصوص', en: 'Cut paper',
  does: 'ورق أبيض مطفي وأشكال ورق ملوّنة (خردلي، أخضر، مرجاني، كحلي) تدخل حول الكلام وتتبدّل بين الأقسام؛ حركة مرحة وكأنها شغل يد',
  ask: 'خلّ الستايل ورق مقصوص',
  look: 'cut-paper',
  layout: { headline: { y: 0.26, align: 'centre', maxPx: 190 }, showY: 0.58, objects: 'below', gap: 0.06, keyMark: 'box' },
  motion: { ease: 'snappy', enter: 'pop', blur: 0, camera: 'locked' },
  transitions: { default: 'page-turn', section: 'paper-tear', more: ['color-wipe'], params: { 'page-turn': { color: 'accent' }, 'color-wipe': { color: 'accent' } } },
  background: [{ type: 'backdrop', params: { world: 'paper' } }, { type: 'paper-shapes', params: {} }],
  stage: { kind: 'blob', colour: '#e0a526', width: 1.08 },
  talking: { captions: { skin: 'paper-tag', presentation: 'strip', emph: 'pop' }, punch: { zoom: 1.1, ease: 'smooth' }, popup: 'box', strip: 'blob' },
  roles: {
    headline: { type: 'kinetic-text', params: { mode: 'line', enter: 'pop' } },
    keySentence: { type: 'heavy-word', params: { size: 0.78 } },
    number: { type: 'counter', params: {} },
    list: { type: 'checklist', params: {} },
    quote: { type: 'kinetic-text', params: { mode: 'stack', enter: 'pop' } },
    compare: { type: 'before-after', params: {} },
    cta: { type: 'comment-cta', params: {} },
    signOff: { type: 'signature-card', params: {} },
  },
  avoid: { scenes: ['glitch-text', 'laser-type', 'laser-beam', 'tech-grid', 'glow-words'], transitions: ['glitch-cut', 'pixel-curtain', 'layer-explode'] },
}
