/**
 * The style packs by id, and the look each one uses. Kept here (no imports) so the storyboard schema
 * can know them; the packs themselves live in src/packs (a unit test keeps the two in step).
 */
export const PACK_IDS = ['signature-cream', 'dark-tech', 'cinematic-laser', 'swiss-red', 'arabic-heritage', 'cut-paper', 'nebula'] as const
export type PackId = (typeof PACK_IDS)[number]
export const PACK_LOOK = { 'signature-cream': 'signature', 'dark-tech': 'dark-tech', 'cinematic-laser': 'dark-tech', 'swiss-red': 'swiss-red', 'arabic-heritage': 'heritage', 'cut-paper': 'cut-paper', nebula: 'nebula' } as const satisfies Record<PackId, string>
