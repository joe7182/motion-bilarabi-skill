import type { Brand } from '../core/brand'
import type { LookId } from '../core/storyboard'

/**
 * Colour and type tokens for a look. `fontDisplay` / `fontBody` are CSS `font-family` values;
 * the weights that go with them are in `FONT_WEIGHT` (display = Cairo 900, body = Tajawal).
 */
export interface LookTokens {
  /** Hex colours, for Node-side maths (metrics, contrast) and as the values of the CSS variables. */
  bg: string
  fg: string
  accent: string
  /**
   * What the runtime writes wherever a CSS or SVG colour is needed: custom properties set on the
   * frame root (`applyLookVars`), so a backdrop's colour world can flip every colour at once.
   */
  vars: { bg: 'var(--mba-bg)'; fg: 'var(--mba-fg)'; accent: 'var(--mba-accent)' }
  fontDisplay: string
  fontBody: string
}

export const FONT_WEIGHT = { display: 900, bodyBold: 700, body: 400 } as const

/**
 * The bundled families (see the @font-face rules in index.html: Cairo is one variable face,
 * Tajawal has 400/700/900 files). Every family is preloaded at every FONT_WEIGHT, which covers
 * every bundled face.
 */
export const BUNDLED_FAMILIES = ['Cairo', 'Tajawal'] as const

/** The bundled code face (index.html): JetBrains Mono 400, Latin subset (app-window terminal lines). */
export const MONO_FAMILY = 'JetBrains Mono'
export const FONT_MONO = `'${MONO_FAMILY}', monospace`

/** The bundled editorial serif (index.html): Amiri bold, italic and bold italic (editorial-type). */
export const SERIF_FAMILY = 'Amiri'
export const FONT_SERIF = `'${SERIF_FAMILY}', serif`
const SERIF_FACES = [`700 40px '${SERIF_FAMILY}'`, `italic 400 40px '${SERIF_FAMILY}'`, `italic 700 40px '${SERIF_FAMILY}'`]

/**
 * The bundled title faces (index.html; OFL, Google Fonts), each at the weight a title uses: Alexandria
 * (modern geometric), Lalezar (heavy display), Reem Kufi (modern Kufi), Aref Ruqaa (Ruqaa
 * calligraphy), Marhey (rounded, playful). Cairo stays the default.
 */
export const TITLE_FACES = [
  { id: 'alexandria', family: 'Alexandria', weight: 800 },
  { id: 'lalezar', family: 'Lalezar', weight: 400 },
  { id: 'reem-kufi', family: 'Reem Kufi', weight: 700 },
  { id: 'aref-ruqaa', family: 'Aref Ruqaa', weight: 700 },
  { id: 'marhey', family: 'Marhey', weight: 700 },
] as const

/** CSS font shorthands to preload: each bundled family at each distinct FONT_WEIGHT, plus the code face. */
export const REQUIRED_FONTS: readonly string[] = [
  ...BUNDLED_FAMILIES.flatMap((family) => [...new Set(Object.values(FONT_WEIGHT))].map((w) => `${w} 40px ${family}`)),
  `400 40px '${MONO_FAMILY}'`,
  ...SERIF_FACES,
  ...TITLE_FACES.map((f) => `${f.weight} 40px '${f.family}'`),
]

const DISPLAY = "'Cairo', sans-serif"
const BODY = "'Tajawal', sans-serif"

const VARS = { bg: 'var(--mba-bg)', fg: 'var(--mba-fg)', accent: 'var(--mba-accent)' } as const

const LOOKS: Record<LookId, LookTokens> = {
  'dark-tech': { bg: '#0e0d0c', fg: '#f2ece2', accent: '#ff5a1f', vars: VARS, fontDisplay: DISPLAY, fontBody: BODY },
  'light-editorial': { bg: '#f2ece2', fg: '#151311', accent: '#ff5a1f', vars: VARS, fontDisplay: DISPLAY, fontBody: BODY },
  // Our own values: cream paper, ink, editorial red.
  'paper-editorial': { bg: '#f3eadb', fg: '#141210', accent: '#c8201a', vars: VARS, fontDisplay: DISPLAY, fontBody: BODY },
  // Plan 3: the creative prototype's cream / black / orange (backdrop materials add paper and grain).
  signature: { bg: '#f3efe7', fg: '#16130f', accent: '#ff5a1f', vars: VARS, fontDisplay: DISPLAY, fontBody: BODY },
  // Swiss editorial: off-white paper, near-black ink, signal red. Flat (no paper grain needed); one red word per line.
  'swiss-red': { bg: '#efede8', fg: '#111111', accent: '#cf1f17', vars: VARS, fontDisplay: DISPLAY, fontBody: BODY },
  // Arabic heritage: deep teal, warm parchment ink, gold; headlines in the classic serif.
  heritage: { bg: '#0e3a48', fg: '#f3ead2', accent: '#d7ae55', vars: VARS, fontDisplay: FONT_SERIF, fontBody: BODY },
  // Cut paper: off-white paper, soft black, coral (the other paper colours come from the pack's shapes).
  // Nebula: deep navy and a lilac glow (its ink world is near-white with a navy ink).
  nebula: { bg: '#0b0a1f', fg: '#f4f2fb', accent: '#8f7bff', vars: VARS, fontDisplay: DISPLAY, fontBody: DISPLAY },
  'cut-paper': { bg: '#f2ead9', fg: '#1d1b18', accent: '#bf3a12', vars: VARS, fontDisplay: DISPLAY, fontBody: BODY },
}

/** Sets the three colour custom properties (`--mba-bg/fg/accent`) on `el`: what `look.vars.*` read. */
/** Relative luminance of a #rrggbb or rgb(...) colour (0 dark … 1 light); NaN when unreadable. */
export function luminance(c: string): number {
  const s = c.trim()
  let rgb: number[] | undefined
  const h = /^#([0-9a-f]{6})$/i.exec(s)
  if (h) rgb = [0, 2, 4].map((i) => parseInt(h[1]!.slice(i, i + 2), 16))
  const m = /rgba?\(([^)]+)\)/i.exec(s)
  if (!rgb && m) rgb = m[1]!.split(/[ ,/]+/).slice(0, 3).map(Number)
  if (!rgb || rgb.some((v) => Number.isNaN(v))) return NaN
  const [r, g, b] = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** Whether the colour world `el` sits in right now (its live `--mba-bg`) is a light one. */
export function worldIsLight(el: HTMLElement): boolean {
  const L = luminance(getComputedStyle(el).getPropertyValue('--mba-bg'))
  return !Number.isNaN(L) && L >= 0.35
}

export function applyLookVars(el: HTMLElement, c: { bg: string; fg: string; accent: string }): void {
  el.style.setProperty('--mba-bg', c.bg)
  el.style.setProperty('--mba-fg', c.fg)
  el.style.setProperty('--mba-accent', c.accent)
}

/** Returns a fresh copy of the look's tokens; a brand's `colors.primary` overrides `accent`. */
export function getLook(id: LookId, brand?: Brand): LookTokens {
  const base = LOOKS[id]
  if (!base) throw new Error(`unknown look "${String(id)}"`)
  return { ...base, ...(brand ? { accent: brand.colors.primary } : {}) }
}
