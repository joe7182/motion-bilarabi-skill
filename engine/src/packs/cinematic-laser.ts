import type { Pack } from './schema'

/** A dark grid floor and glow; one huge centred headline cut by a laser, hits on the beat. */
export const cinematicLaser: Pack = {
  id: 'cinematic-laser', n: 3, ar: 'ليزر سينمائي', en: 'Cinematic laser', img: 'laser-type',
  does: 'أرضية شبكة داكنة وتوهّج؛ عنوان واحد كبير بالنص يتقصّ بالليزر، وكلمات تتوهّج، وضربات على الإيقاع',
  ask: 'خلّ الستايل ليزر سينمائي',
  look: 'dark-tech',
  layout: { headline: { y: 0.42, align: 'centre', maxPx: 240 }, showY: 0.72, objects: 'around', gap: 0.08, keyMark: 'colour' },
  motion: { ease: 'easy', enter: 'fade', blur: 3, camera: 'pulse' },
  transitions: { default: 'flood', section: 'iris', more: ['whip-pan', 'layer-explode'] },
  background: [{ type: 'tech-grid', params: { floor: true, glows: 2 } }],
  roles: {
    headline: { type: 'laser-type', params: { size: 220 } },
    keySentence: { type: 'glow-words', params: { size: 96 } },
    number: { type: 'counter', params: {} },
    list: { type: 'checklist', params: {} },
    quote: { type: 'glow-words', params: { size: 84 } },
    compare: { type: 'before-after', params: {} },
    cta: { type: 'comment-cta', params: {} },
    signOff: { type: 'signature-card', params: {} },
  },
  avoid: { scenes: ['sketch-words', 'red-pen', 'heavy-word'], transitions: ['paper-tear', 'page-turn', 'blinds'] },
}
