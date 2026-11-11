import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dressStoryboard } from '../packs/dress'
import { getPack } from '../packs/index'

/**
 * `mba dress <storyboard.json | projectDir> --pack <id|number> [--out file]`: puts a style pack on
 * a storyboard, filling only what it left open (see `dressStoryboard`). A project folder means its
 * `edit.json`. Returns the file written and what changed.
 */
export function dressCommand(target: string, o: { pack: string; out?: string }): { file: string; changes: string[]; pack: string } {
  const pack = getPack(o.pack)
  const file = existsSync(target) && statSync(target).isDirectory() ? join(target, 'edit.json') : target
  if (!existsSync(file)) throw new Error(`الملف غير موجود — no such storyboard: ${file}`)
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  const { storyboard, changes } = dressStoryboard(raw, pack)
  const out = o.out ?? file
  if (changes.length || out !== file) writeFileSync(out, JSON.stringify(storyboard, null, 1) + '\n')
  return { file: out, changes, pack: `${pack.n} · ${pack.ar} — ${pack.en}` }
}
