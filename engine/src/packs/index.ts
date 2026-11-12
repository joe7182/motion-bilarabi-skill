import { arabicHeritage } from './arabic-heritage'
import { cinematicLaser } from './cinematic-laser'
import { cutPaper } from './cut-paper'
import { darkTech } from './dark-tech'
import { PACK_IDS, type Pack, type PackId } from './schema'
import { signatureCream } from './signature-cream'
import { swissRed } from './swiss-red'

export const PACKS: Record<PackId, Pack> = {
  'signature-cream': signatureCream,
  'dark-tech': darkTech,
  'cinematic-laser': cinematicLaser,
  'swiss-red': swissRed,
  'arabic-heritage': arabicHeritage,
  'cut-paper': cutPaper,
}

/** The packs in menu order. */
export const packList = (): Pack[] => PACK_IDS.map((id) => PACKS[id]).sort((a, b) => a.n - b.n)

/** A pack by id or by its menu number. */
export function getPack(idOrNumber: string): Pack {
  const key = idOrNumber.trim()
  const found = (PACKS as Record<string, Pack>)[key] ?? packList().find((p) => String(p.n) === key)
  if (!found) throw new Error(`ستايل غير معروف «${key}» — unknown pack "${key}". الموجود — available: ${packList().map((p) => `${p.n} ${p.id}`).join(', ')}`)
  return found
}

export { PACK_IDS, type Pack, type PackId }
