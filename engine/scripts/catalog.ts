/**
 * Writes the effects catalog pages from src/core/catalog.ts:
 *   ../EFFECTS.md                        (Arabic, with preview images, for GitHub)
 *   ../skill/motion-bilarabi/catalog.md  (for Claude: names → how to write them)
 * Run from engine/: `npx tsx scripts/catalog.ts`
 */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { effectsMd, skillCatalogMd } from '../src/core/catalog-docs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
writeFileSync(resolve(root, 'EFFECTS.md'), effectsMd())
writeFileSync(resolve(root, 'skill', 'motion-bilarabi', 'catalog.md'), skillCatalogMd())
console.log('wrote EFFECTS.md and skill/motion-bilarabi/catalog.md')
