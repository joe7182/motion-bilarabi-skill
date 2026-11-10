import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePreset } from '../../src/core/recipes/presets'

const SKILL = join(__dirname, '..', '..', '..', 'skill', 'motion-bilarabi')

/** Every ```json block in the skill's guides. */
function jsonBlocks(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const f of readdirSync(SKILL).filter((x) => x.endsWith('.md'))) {
    const md = readFileSync(join(SKILL, f), 'utf8')
    for (const m of md.matchAll(/```json\r?\n([\s\S]*?)```/g)) out.push({ file: f, text: m[1]! })
  }
  return out
}

describe('documented examples', () => {
  const presets = jsonBlocks().filter((b) => /"preset"\s*:/.test(b.text))
  it('the guides contain preset examples', () => {
    expect(presets.length).toBeGreaterThan(0)
  })
  it('every preset example parses, and its hook has a visual (the guide’s own rule)', () => {
    for (const b of presets) {
      const p = parsePreset(JSON.parse(b.text)) as { hook?: { show?: unknown } }
      expect(p.hook?.show, `${b.file}: the hook needs a show`).toBeDefined()
    }
  })
})
