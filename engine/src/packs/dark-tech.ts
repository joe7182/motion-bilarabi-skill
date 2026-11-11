import type { Pack } from './schema'

/** Charcoal and a fine grid; the headline hugs the right edge under a small code tag, interface objects below. */
export const darkTech: Pack = {
  id: 'dark-tech', n: 2, ar: 'داكن تقني', en: 'Dark tech', img: 'counter',
  does: 'خلفية فحمية بشبكة خفيفة؛ العنوان على اليمين وتحته خط يرسم نفسه، وسم صغير بخط الكود، وحركة حادة',
  ask: 'خلّ الستايل داكن',
  look: 'dark-tech',
  layout: { headline: { y: 0.24, align: 'right', maxPx: 130 }, showY: 0.6, objects: 'below', gap: 0.06, keyMark: 'underline' },
  motion: { ease: 'snappy', enter: 'mask', blur: 0, camera: 'locked' },
  transitions: { default: 'glitch-cut', section: 'pixel-curtain', more: ['blade-slice', 'zoom-through'], params: { 'pixel-curtain': { color: 'accent' } } },
  background: [{ type: 'tech-grid', params: { cell: 0.045, glows: 0 } }],
  marks: { tag: { text: '01', corner: 'top-right', mono: true }, ticks: true },
  stage: { kind: 'panel', width: 1 },
  roles: {
    headline: { type: 'kinetic-text', params: { mode: 'line', enter: 'mask' } },
    keySentence: { type: 'glitch-text', params: { scan: true } },
    number: { type: 'counter', params: {} },
    list: { type: 'checklist', params: {} },
    quote: { type: 'kinetic-text', params: { mode: 'stack', enter: 'mask' } },
    compare: { type: 'before-after', params: {} },
    cta: { type: 'comment-cta', params: {} },
    signOff: { type: 'signature-card', params: {} },
  },
  avoid: { scenes: ['sketch-words', 'red-pen', 'heavy-word'], transitions: ['paper-tear', 'page-turn'] },
}
