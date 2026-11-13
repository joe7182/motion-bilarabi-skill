import type { Pack } from './schema'

/**
 * Deep navy and a lilac glow (from the «٥ كونكتورز لـ Claude» reel): a soft drifting hue gradient
 * behind everything, Cairo only, the key word in the accent, objects on frosted glass, a glowing orb
 * for chapter cards (`orb-card`). Its light world (backdrop `ink`) turns the glows peach and pink.
 */
export const nebula: Pack = {
  id: 'nebula', n: 7, ar: 'نيبولا', en: 'Nebula',
  does: 'كحلي غامق وتوهّج بنفسجي: خلفية ألوان متدرّجة تتحرك ببطء (بدون نقاط)، خط Cairo فقط، الكلمة المهمة بلون التوهّج، الأشياء على زجاج مغبّش، وكرة مضيئة لبطاقات الفصول',
  ask: 'خلّ الستايل نيبولا',
  look: 'nebula',
  layout: { headline: { y: 0.2, align: 'centre', maxPx: 150 }, showY: 0.6, objects: 'below', gap: 0.06, keyMark: 'colour' },
  motion: { ease: 'easy', enter: 'rise', blur: 3, camera: 'locked' },
  transitions: { default: 'zoom-through', section: 'iris', more: ['flood', 'reveal'] },
  background: [{ type: 'backdrop', params: { world: 'paper' } }, { type: 'hue-field', params: {} }],
  stage: { kind: 'glass', width: 1.04 },
  talking: { captions: { skin: 'soft-shadow', presentation: 'pill', emph: 'accent' }, punch: { zoom: 1.08, ease: 'smooth' }, popup: 'colour', strip: 'glass' },
  roles: {
    headline: { type: 'kinetic-text', params: { mode: 'line', enter: 'rise' } },
    keySentence: { type: 'glow-words', params: { size: 90 } },
    number: { type: 'counter', params: {} },
    list: { type: 'checklist', params: {} },
    quote: { type: 'kinetic-text', params: { mode: 'stack', enter: 'fade' } },
    compare: { type: 'before-after', params: {} },
    cta: { type: 'comment-cta', params: {} },
    signOff: { type: 'signature-card', params: { colors: { bg: '#0b0a1f', ink: '#f4f2fb', accent: '#8f7bff' } } },
  },
  avoid: { scenes: ['sketch-words', 'red-pen', 'paper-shapes', 'geo-pattern', 'tech-grid'], transitions: ['paper-tear', 'page-turn', 'glitch-cut'] },
}
