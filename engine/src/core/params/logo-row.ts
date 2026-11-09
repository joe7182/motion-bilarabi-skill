import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { imageSrc, indexBeats, morphKey, oneLineAr as oneLine, rangeAr } from './common'
import { safePoint } from './line-art'
import type { SceneTimingIssue } from './index'

/** One brand logo of `logo-row`: its image, an optional label under it, and the scene s it pops in. */
export const logoItem = z.object({
  image: imageSrc,
  label: oneLine(18, 'label').optional(),
  at: z.number().finite().min(0),
})

/**
 * Params of `logo-row`: 1..6 brand logos that pop in one by one (scale 0.6 → 1 + fade), in a row or
 * a grid of 3 per row. `focus` makes one item grow (×1.15) with an accent ring while the others dim
 * to 35 %; `strike` draws an accent line across an item («not the only option»); `out` fades them all.
 * Item indices are 0-based in reading order: index 0 is the RIGHTMOST logo (RTL).
 */
export const logoRowParams = z
  .object({
    items: z
      .array(logoItem)
      .min(1, { message: 'شعار واحد على الأقل — items needs at least one logo' })
      .max(6, { message: 'ستة شعارات على الأكثر — at most 6 logos' }),
    layout: z.enum(['row', 'grid']).default('row'),
    /** Tile side as a fraction of the safe width. */
    size: rangeAr(0.08, 0.4, 'size').default(0.2),
    /** Centre of the group in the safe area. */
    at: safePoint.default({ x: 0.5, y: 0.5 }),
    focus: indexBeats(12, 'focus'),
    strike: indexBeats(6, 'strike'),
    /** Scene s every logo fades out together (absent: they stay). */
    out: z.number().finite().min(0).optional(),
    key: morphKey,
  })
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    const n = p.items.length
    for (const k of ['focus', 'strike'] as const) {
      p[k].forEach((b, i) => {
        if (b.index >= n) issue([k, i, 'index'], `الشعار خارج القائمة (٠ إلى ${n - 1}) — index must be 0..${n - 1}`)
        if (i > 0 && b.at < p[k][i - 1]!.at) issue([k, i, 'at'], `الأوقات مرتبة تصاعديًا — ${k} must be in ascending order of at`)
      })
    }
    const cols = logoColumns(p.layout, n)
    const need = cols * p.size + (cols - 1) * LOGO_ROW.gap * p.size
    if (need > LOGO_ROW.maxRowW + 1e-9) {
      issue(['size'], `الصف أعرض من المنطقة الآمنة؛ صغّر size أو استخدم layout: "grid" — ${cols} logos of size ${p.size} need ${need.toFixed(2)} of the safe width (max ${LOGO_ROW.maxRowW})`)
    }
    if (p.out !== undefined && p.items.some((it) => it.at >= p.out!)) {
      issue(['out'], 'الخروج قبل ظهور كل الشعارات — out must come after every item has appeared')
    }
  })

export type LogoRowParams = z.infer<typeof logoRowParams>

export const LOGO_ROW = {
  /** Gap between tiles (× tile side), and the widest a row may be (× safe width). */
  gap: 0.28,
  maxRowW: 0.96,
  /** Grid: tiles per row. */
  perRow: 3,
  /** Pop: scale `popFrom` → 1 (settle) and fade, over `popSec`. */
  popFrom: 0.6,
  popSec: 0.35,
  /** Focus: the chosen tile grows to `focusScale`, the others dim to `dim`; changes ease over `focusSec`. */
  focusScale: 1.15,
  dim: 0.35,
  focusSec: 0.3,
  /** Strike: the line draws over `strikeSec`; the struck logo greys to `struckOpacity`. */
  strikeSec: 0.3,
  struckOpacity: 0.55,
  /** Out: everything fades (and shrinks to `outScale`) over `outSec`. */
  outSec: 0.3,
  outScale: 0.94,
  /** Label: font px at 1080 (× frame width / 1080), min px, gap under the tile (× side). */
  labelPx: 34,
  labelMinPx: 26,
  labelGap: 0.14,
} as const

/** Tiles per row of the layout. */
export function logoColumns(layout: 'row' | 'grid', n: number): number {
  return layout === 'grid' ? Math.min(n, LOGO_ROW.perRow) : n
}

/** Scene-level check: every beat lies inside the scene. */
export function timingIssueOfLogoRow(p: LogoRowParams, sceneLen: number): SceneTimingIssue | undefined {
  const k = p.items.findIndex((it) => it.at >= sceneLen)
  if (k >= 0) return { path: ['items', k, 'at'], ar: `الشعار ${k + 1} يظهر بعد نهاية المشهد (${sceneLen} ث)`, en: `items[${k}] appears at ${p.items[k]!.at} s, at or past the scene end (${sceneLen} s local)` }
  for (const f of ['focus', 'strike'] as const) {
    const j = p[f].findIndex((b) => b.at >= sceneLen)
    if (j >= 0) return { path: [f, j, 'at'], ar: `الحدث بعد نهاية المشهد (${sceneLen} ث)`, en: `${f}[${j}] at ${p[f][j]!.at} s is at or past the scene end (${sceneLen} s local)` }
  }
  if (p.out !== undefined && p.out >= sceneLen) return { path: ['out'], ar: `الخروج بعد نهاية المشهد (${sceneLen} ث)`, en: `out ${p.out} s is at or past the scene end (${sceneLen} s local)` }
  return undefined
}

/** Sound cues: a `pop` per logo, an `action` per focus change, a `tick` per strike. */
export function cuesOfLogoRow(p: LogoRowParams, _ctx: { duration: number }): Cue[] {
  const out: Cue[] = p.items.map((it) => ({ t: it.at, kind: 'pop' as const }))
  for (const f of p.focus) out.push({ t: f.at, kind: 'action' })
  for (const s of p.strike) out.push({ t: s.at, kind: 'tick' })
  return out.sort((a, b) => a.t - b.t)
}
