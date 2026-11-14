/**
 * Colour variants: a storyboard's `"variant"` recolours its look — the ground, the ink, the accent —
 * and gives `hue-field` its glow palettes, so every scene that draws in the look's colours follows.
 * Made for the nebula look (the Claude Meetings and home-planner reels); any look takes them.
 * Hand-written colours inside `html-motion` scenes stay as written.
 */
export const VARIANT_IDS = ['electric', 'coral'] as const
export type VariantId = (typeof VARIANT_IDS)[number]

export interface Variant {
  ar: string
  en: string
  bg: string
  fg: string
  accent: string
  /** hue-field glows on a dark ground and on a light one (its `ink` world). */
  glows: { dark: [string, string, string, string]; light: [string, string, string, string] }
}

export const VARIANTS: Record<VariantId, Variant> = {
  electric: {
    ar: 'أزرق كهربائي', en: 'Electric Blue',
    bg: '#04060d', fg: '#f2f6fc', accent: '#3aa8ff',
    glows: { dark: ['#1f6bff', '#00b4ff', '#3a2bff', '#00e0c0'], light: ['#bfe1ff', '#cdd8ff', '#b8efe8', '#e4edfb'] },
  },
  coral: {
    ar: 'كورال', en: 'Claude Coral',
    bg: '#0d0a08', fg: '#fff8f2', accent: '#ff8a5c',
    glows: { dark: ['#d97757', '#ff9f5a', '#ff5f7e', '#8a4dff'], light: ['#ffc7a6', '#ffdcae', '#ffc1cf', '#efe2d4'] },
  },
}
