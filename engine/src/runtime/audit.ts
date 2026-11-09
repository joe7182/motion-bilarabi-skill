import { hasArabic, TATWEEL } from '../core/text'
import { textDir } from './text/units'

/**
 * In-page text audit: the objective guard against broken or reversed Arabic, text outside the
 * safe area, text clipped by the frame, and text too small to read on a phone. Read-only: it
 * measures the current DOM and never writes to it.
 */
export type AuditRule = 'unsanctioned-arabic' | 'wrong-direction' | 'tatweel-split' | 'outside-safe' | 'too-small' | 'clipped-by-frame'

export interface AuditIssue {
  rule: AuditRule
  /** `data-mba-scene` of the scene layer holding the text ('' when it is in no layer). */
  sceneId: string
  /** The offending text node's text (for wrong-direction: the unit's full text). */
  text: string
  /** Human-readable measurement behind the issue. */
  detail: string
}

export interface AuditRect {
  x: number
  y: number
  w: number
  h: number
}

export const AUDIT = {
  /** A glyph box may stick out of the safe area by this much (px) before it counts. */
  safeTolerance: 2,
  /** Minimum rendered glyph height (px) at a 1080 px wide frame; scales with the frame width. */
  minGlyphPx: 28,
  refWidth: 1080,
  /** Text whose effective opacity is below this is not audited as visible text. */
  minOpacity: 0.5,
  /** Rounding slack (px) for the frame-edge test. */
  edgeEpsilon: 0.5,
} as const

const SANCTIONED = new Set(['word', 'line', 'typing'])
const EPS = 1e-6

/** R31: scale may deviate from 1 by this much and still count as rest (micro-motion: drift, punch-in). */
export const REST_SCALE_TOL = 0.15
/** Float slack so the boundary scales 0.85 and 1.15 are both inside the tolerance. */
const SCALE_EPS = 1e-9

/** Axis-aligned 2D scale of a matrix, or null when it rotates, skews or is 3D (never at rest). */
function planarScale(m: DOMMatrixReadOnly): { sx: number; sy: number } | null {
  if (!m.is2D || Math.abs(m.b) >= EPS || Math.abs(m.c) >= EPS) return null
  return { sx: m.a, sy: m.d }
}

const scaleAtRest = (sx: number, sy: number) =>
  Math.abs(sx - 1) <= REST_SCALE_TOL + SCALE_EPS && Math.abs(sy - 1) <= REST_SCALE_TOL + SCALE_EPS

/**
 * R31: micro-motion (<= 15% scale, any translate) counts as rest. True when the matrix is 2D, has
 * no rotation or skew (|b|, |c| < 1e-6) and both scales are within `REST_SCALE_TOL` of 1. Any
 * translate is allowed: glyph boxes come from `getClientRects`, which is already transformed, so
 * drifting text is measured where it actually is. (The audit applies the scale limit
 * cumulatively along the ancestor chain; see `inspect`.)
 */
export function isRestTransform(m: DOMMatrixReadOnly): boolean {
  const p = planarScale(m)
  return p !== null && scaleAtRest(p.sx, p.sy)
}

/** Scale factors of the individual `scale` property (`none` = 1; one value applies to both axes). */
function individualScale(cs: CSSStyleDeclaration): { sx: number; sy: number } {
  const v = cs.scale
  if (!v || v === 'none') return { sx: 1, sy: 1 }
  const [x, y] = v.split(/\s+/).map(parseFloat)
  return { sx: x!, sy: y ?? x! }
}

interface Visibility {
  layer: HTMLElement | null
  /** Visible text: in a visible scene layer, nothing hidden on the way, effective opacity ≥ 0.5. */
  visible: boolean
  /**
   * The text is not at rest (R31): some element from its parent up to its layer (inclusive) rotates,
   * skews or goes 3D, or the cumulative scale along that chain is more than 15% away from 1.
   */
  transformed: boolean
}

/** Walks from `el` up to its scene layer (inclusive), multiplying opacity and noting hidden/transformed. */
function inspect(el: Element, root: HTMLElement): Visibility {
  const layer = el.closest<HTMLElement>('[data-mba-scene]')
  if (!layer || !root.contains(layer)) return { layer: null, visible: false, transformed: false }
  let opacity = 1
  let hidden = false
  let transformed = false
  let sx = 1
  let sy = 1
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cs = getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility !== 'visible') hidden = true
    opacity *= parseFloat(cs.opacity)
    if (cs.transform && cs.transform !== 'none') {
      const p = planarScale(new DOMMatrixReadOnly(cs.transform))
      if (p) {
        sx *= p.sx
        sy *= p.sy
      } else transformed = true
    }
    const ind = individualScale(cs)
    sx *= ind.sx
    sy *= ind.sy
    if (!/^(none|0(deg|rad|turn|grad)?)?$/.test((cs.rotate ?? '').trim())) transformed = true
    if (e === layer) break
  }
  if (!scaleAtRest(sx, sy)) transformed = true
  return { layer, visible: !hidden && opacity >= AUDIT.minOpacity, transformed }
}

const fmt = (n: number) => String(Math.round(n * 10) / 10)
const box = (r: AuditRect) => `[${fmt(r.x)}, ${fmt(r.y)}, ${fmt(r.x + r.w)}, ${fmt(r.y + r.h)}]`

/**
 * Audits the text currently in `root` (the `#frame`), in frame pixels: `safe` is the safe area,
 * `size` the frame size. Coordinates are normalised by `root`'s on-screen box, so a scaled
 * preview audits the same as the render page.
 *
 * Structural rules, unconditional (every node or unit, visible or not, at any pose):
 * - `unsanctioned-arabic`: an Arabic text node whose PARENT element is not itself a
 *   `[data-mba-text]` word | line | typing unit (leaf ownership, ruling R21). Every real unit is
 *   a leaf: word and line units hold their text directly, a typing unit holds one text node plus
 *   an empty caret. So Arabic split into per-letter (or any) child elements inside a unit is caught;
 *   it is reported once per unit (text = the unit's text), bare Arabic once per text node.
 *   Deliberately stricter than "visible text only" (ruling R16): hidden text becomes visible at
 *   some other time, and broken Arabic is the product's #1 failure.
 * - `wrong-direction`: a `[data-mba-text]` element whose `dir` is not `textDir(full text)`; the
 *   full text is `data-mba-full` for typing units, else `textContent`.
 *
 * - `tatweel-split`: a text node (a typing unit: its full text) that starts or ends with a tatweel
 *   (U+0640). A tatweel only ever sits between two letters of one word, so one at a unit edge
 *   means a stretched word was cut across units, or a stray tatweel. Two adjacent sibling units
 *   whose concatenation has a tatweel at the boundary are exactly a unit ending or starting
 *   with one, so the per-node check covers them.
 *
 * Geometric rules, only for visible text at its rest pose (ruling R17): inside a scene layer, no
 * element from the text's parent up to and including the layer has `visibility` ≠ visible,
 * `display: none` or a transform that is not at rest. R31: micro-motion counts as rest, i.e. a
 * CUMULATIVE scale (the product along the ancestor chain, of the matrix scale and the `scale`
 * property) within 15% of 1 and any translate; larger scales, rotation, skew and 3D do not (an
 * enter/exit, scale-in or camera move). Translate-only enters count as rest by design, mitigated
 * by the opacity gate and by the rest-window sampling. Also required: the product of the
 * computed opacities is ≥ 0.5. Consequence: text under an element with a
 * PERMANENT non-rest transform (e.g. a design that keeps a word rotated or scaled beyond 15%) is never
 * measured by the geometric rules; such primitives are exempt until audited otherwise.
 * - `too-small`: the tallest Range client rect of a text node is below 28 px × size.w / 1080.
 * - `outside-safe`: a glyph box sticks out of `safe` by more than 2 px. A text node already
 *   reported as clipped-by-frame is not also reported here (a box crossing the frame edge is
 *   always outside the safe area; one issue is enough).
 *
 * Exception (Plan 2a+): `clipped-by-frame` applies to EVERY visible text node, transformed or not.
 * Glyph boxes come from `getClientRects`, already transformed, so a scaled or rotated entrance whose
 * box crosses the frame edge at opacity ≥ `AUDIT.minOpacity` is an issue: entrances must stay
 * inside the frame or be under opacity. `outside-safe` and `too-small` stay rest-only, and
 * `checkedGeometric` still counts rest text only.
 * `clipped-by-frame` and `outside-safe` are skipped while `root` has `data-mba-tr="1"` (a
 * transition window, R3), but only for text in layers on tracks ≤ `data-mba-tr-track` (the
 * highest track with a live transition; its overlay covers that track and the ones below). Text on
 * a higher track (a caption over a cut of the video track) is still audited. Without
 * `data-mba-tr-track` the skip applies to every track.
 *
 * Camera (Plan 2a+ Task 6): layers under the one-world camera sit in a world wrapper
 * (`#mba-world`, `data-mba-world`) between the layer and `root`. Glyph boxes come from client
 * rects, so the camera's pan and zoom are already in every measurement: `too-small` measures the
 * ON-SCREEN size (zoomed-in text counts as larger) and a zoom that pushes text over the frame edge
 * is `clipped-by-frame`. The rest walk (`inspect`) stops at the layer and never reaches the
 * wrapper, so the camera itself never makes text count as moving.
 *
 * Morph clones (`[data-mba-morph-clone]`, Task 8) are skipped by every rule: they hold copies of
 * the keyed originals, which are audited themselves (no double count).
 *
 * Not considered (deferred, R18): `clip-path`. Text hidden by a wipe clip still counts as visible.
 * Whitespace-only text nodes are skipped. At most one issue per text node (or unit) per rule.
 */
export function auditText(root: HTMLElement, safe: AuditRect, size: { w: number; h: number }): AuditIssue[] {
  return auditTextStats(root, safe, size).issues
}

/** Result of `auditTextStats`: the issues plus how many text nodes the geometric rules measured. */
export interface AuditStats {
  issues: AuditIssue[]
  /** Text nodes that were visible at rest and had glyph boxes, i.e. checked by the geometric rules. */
  checkedGeometric: number
}

/** `auditText` plus a diagnostic count (tests use it to prove a clean audit was not vacuous). */
export function auditTextStats(root: HTMLElement, safe: AuditRect, size: { w: number; h: number }): AuditStats {
  const issues: AuditIssue[] = []
  let checkedGeometric = 0
  const inTransition = root.dataset.mbaTr === '1'
  const trTrack = root.dataset.mbaTrTrack === undefined ? Infinity : Number(root.dataset.mbaTrTrack)
  /** True when a live transition covers `layer`'s track (the window skip applies to its text). */
  const coveredByTransition = (layer: HTMLElement | null): boolean =>
    inTransition && Number(layer?.dataset.mbaTrack ?? 0) <= trTrack
  const R = root.getBoundingClientRect()
  const sx = R.width > 0 ? size.w / R.width : 1
  const sy = R.height > 0 ? size.h / R.height : 1
  const minGlyph = AUDIT.minGlyphPx * (size.w / AUDIT.refWidth)
  const sceneOf = (el: Element | null) => el?.closest<HTMLElement>('[data-mba-scene]')?.dataset.mbaScene ?? ''

  /** Inside a morph clone: a copy of an audited original. */
  const isCopy = (el: Element) => el.closest('[data-mba-morph-clone]') !== null

  // Units: direction (structural, unconditional).
  for (const el of root.querySelectorAll<HTMLElement>('[data-mba-text]')) {
    if (isCopy(el)) continue
    const full = el.dataset.mbaFull ?? el.textContent ?? ''
    if (!full.trim()) continue
    const want = textDir(full)
    const got = el.getAttribute('dir') ?? ''
    if (got !== want) {
      issues.push({ rule: 'wrong-direction', sceneId: sceneOf(el), text: full, detail: `dir="${got}" but the text needs dir="${want}"` })
    }
  }

  // Text nodes: sanctioned Arabic (structural), then size, frame edge, safe area (visible text at rest).
  const splitUnits = new Set<Element>()
  const range = document.createRange()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const text = n.data
    if (!text.trim()) continue
    const parent = n.parentElement
    if (!parent || isCopy(parent)) continue
    const sceneId = sceneOf(parent)

    if (hasArabic(text) && !SANCTIONED.has(parent.getAttribute('data-mba-text') ?? '')) {
      const unit = parent.closest('[data-mba-text]')
      if (!unit || !root.contains(unit)) {
        issues.push({ rule: 'unsanctioned-arabic', sceneId, text, detail: 'Arabic text outside a text unit (owner: none)' })
      } else if (!splitUnits.has(unit)) {
        splitUnits.add(unit)
        const kind = unit.getAttribute('data-mba-text') ?? ''
        issues.push({
          rule: 'unsanctioned-arabic',
          sceneId,
          text: unit.textContent ?? text,
          detail: `Arabic split below its text unit (owner: ${kind}, held by <${parent.tagName.toLowerCase()}> inside it)`,
        })
      }
    }

    const edge = parent.dataset.mbaFull !== undefined && parent.dataset.mbaText === 'typing' ? parent.dataset.mbaFull.trim() : text.trim()
    if (edge.startsWith(TATWEEL) || edge.endsWith(TATWEEL)) {
      issues.push({ rule: 'tatweel-split', sceneId, text: edge, detail: 'a tatweel at the start or end of a text unit (it belongs between two joined letters of one word)' })
    }

    const v = inspect(parent, root)
    if (!v.visible) continue
    range.selectNodeContents(n)
    const rects: AuditRect[] = [...range.getClientRects()]
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: (r.left - R.left) * sx, y: (r.top - R.top) * sy, w: r.width * sx, h: r.height * sy }))
    if (rects.length === 0) continue
    const atRest = !v.transformed
    if (atRest) {
      checkedGeometric++
      const tallest = Math.max(...rects.map((r) => r.h))
      if (tallest < minGlyph) {
        issues.push({ rule: 'too-small', sceneId, text, detail: `glyph height ${fmt(tallest)} px < ${fmt(minGlyph)} px` })
      }
    }

    if (coveredByTransition(v.layer)) continue

    const e = AUDIT.edgeEpsilon
    const clipped = rects.find(
      (r) =>
        r.x + r.w > 0 && r.x < size.w && r.y + r.h > 0 && r.y < size.h && // overlaps the frame
        (r.x < -e || r.y < -e || r.x + r.w > size.w + e || r.y + r.h > size.h + e), // but crosses an edge
    )
    if (clipped) {
      issues.push({ rule: 'clipped-by-frame', sceneId, text, detail: `glyph box ${box(clipped)} crosses the frame edge (${size.w}×${size.h})` })
      continue
    }

    if (!atRest) continue
    const tol = AUDIT.safeTolerance
    const out = rects.find(
      (r) => r.x < safe.x - tol || r.y < safe.y - tol || r.x + r.w > safe.x + safe.w + tol || r.y + r.h > safe.y + safe.h + tol,
    )
    if (out) {
      const by = Math.max(safe.x - out.x, safe.y - out.y, out.x + out.w - (safe.x + safe.w), out.y + out.h - (safe.y + safe.h))
      issues.push({ rule: 'outside-safe', sceneId, text, detail: `glyph box ${box(out)} is ${fmt(by)} px outside the safe area ${box(safe)}` })
    }
  }
  range.detach()
  return { issues, checkedGeometric }
}
