import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseBrand, type Brand } from '../core/brand'

const FILE = 'mba-brand.json'

/** The creator's own brand, set once for every project: `~/.mba/brand.json`. */
export const personalBrandPath = (home: string = homedir()) => join(home, '.mba', 'brand.json')

/** The project's `mba-brand.json`, else the personal `~/.mba/brand.json`, else null. */
export async function loadBrand(dir: string, home: string = homedir()): Promise<Brand | null> {
  let text: string | null = null
  for (const path of [join(dir, FILE), personalBrandPath(home)]) {
    try {
      text = await readFile(path, 'utf8')
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
  if (text === null) return null
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return parseBrand(JSON.parse(text))
}

export async function saveBrand(dir: string, b: Brand): Promise<void> {
  await writeFile(join(dir, FILE), JSON.stringify(b, null, 2) + '\n', 'utf8')
}
