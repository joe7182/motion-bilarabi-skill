import type { Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { FORMAT_SIZE, type Format } from '../../src/core/types'
import type {} from '../../src/runtime/mba-api'

export interface OpenOptions {
  /** Open the page with `?test=1` (test-primitive hook on). Defaults to true when `testPrimitives` is set. */
  test?: boolean
  /**
   * Source of a function, run in the page before it loads, that returns the test primitives
   * (`[{ id: '_x', params?, build }]`) for `window.__MBA_TEST_PRIMITIVES__`. Ids must start with `_`.
   */
  testPrimitives?: string
}

/** Injects the storyboard, opens the runtime page, waits for `__mba.ready` and sizes the viewport to the frame. */
export async function openStoryboard(page: Page, json: unknown, opts: OpenOptions = {}): Promise<void> {
  const format = (json as { format?: Format }).format ?? '9:16'
  const size = FORMAT_SIZE[format] ?? FORMAT_SIZE['9:16']
  await page.setViewportSize({ width: size.w, height: size.h })
  await page.addInitScript((sb) => {
    window.__MBA_STORYBOARD__ = sb
  }, json)
  if (opts.testPrimitives !== undefined) {
    await page.addInitScript({ content: `window.__MBA_TEST_PRIMITIVES__ = (${opts.testPrimitives})();` })
  }
  const test = opts.test ?? opts.testPrimitives !== undefined
  await page.goto(test ? '/?test=1' : '/')
  await page.waitForFunction(() => typeof window.__mba === 'object')
  await page.evaluate(() => window.__mba.ready)
}

/** Seeks the stage to `t` seconds and screenshots `#frame`. */
export async function frameAt(page: Page, t: number): Promise<Buffer> {
  await page.evaluate(async (tt) => {
    await window.__mba.seek(tt)
  }, t)
  return page.locator('#frame').screenshot({ caret: 'hide' })
}

/**
 * Lists every non-whitespace Arabic text node in `#frame` that is not owned by a sanctioned
 * text unit (nearest `[data-mba-text]` ancestor whose value is word | line | typing).
 * Delegates to the runtime audit (`window.__mba.audit()`, rule `unsanctioned-arabic`), the single
 * implementation; that rule walks every text node of the frame, visible or not.
 */
export async function unsanctionedArabicText(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    window.__mba
      .audit()
      .filter((i) => i.rule === 'unsanctioned-arabic')
      .map((i) => `${JSON.stringify(i.text)} (${i.detail}, scene ${i.sceneId || 'none'})`),
  )
}

/**
 * Horizontal box (left/right, px) of every code point of the first text node under the first
 * element matching `selector`, in logical order. Used to check visual order of LTR/RTL text.
 */
export async function charBoxes(page: Page, selector: string): Promise<{ ch: string; left: number; right: number }[]> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) throw new Error(`no element ${sel}`)
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode() as Text | null
    if (!node) return []
    const out: { ch: string; left: number; right: number }[] = []
    const range = document.createRange()
    let i = 0
    for (const ch of node.data) {
      range.setStart(node, i)
      range.setEnd(node, i + ch.length)
      const r = range.getBoundingClientRect()
      out.push({ ch, left: r.left, right: r.right })
      i += ch.length
    }
    return out
  }, selector)
}

/** True when the boxes go strictly left to right (ignoring zero-width boxes such as spaces at line ends). */
export function readsLeftToRight(boxes: { left: number; right: number }[]): boolean {
  const solid = boxes.filter((b) => b.right - b.left > 0.5)
  return solid.every((b, i) => i === 0 || b.left >= solid[i - 1]!.right - 0.5)
}

/** Mean RGB and the variance of Rec. 709 luminance (0..255 scale) over every pixel of a PNG. */
export function frameStats(png: Buffer): { mean: [number, number, number]; lumVariance: number } {
  const img = PNG.sync.read(png)
  const n = img.width * img.height
  let r = 0, g = 0, b = 0, sum = 0, sum2 = 0
  for (let i = 0; i < img.data.length; i += 4) {
    const R = img.data[i]!, G = img.data[i + 1]!, B = img.data[i + 2]!
    r += R; g += G; b += B
    const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
    sum += y
    sum2 += y * y
  }
  const m = sum / n
  return { mean: [r / n, g / n, b / n], lumVariance: Math.max(0, sum2 / n - m * m) }
}

/** True when the frame is near-uniform: luminance variance below `varThr`. */
export function isNearBlank(png: Buffer, varThr = 12): boolean {
  return frameStats(png).lumVariance < varThr
}

/**
 * True for an EMPTY frame: near-uniform AND its mean colour within `tol` (per channel) of the
 * look background `bgHex` (#rrggbb). A designed full-colour cover (e.g. color-wipe at the cut) is not empty.
 */
export function isEmptyFrame(png: Buffer, bgHex: string, varThr = 12, tol = 10): boolean {
  const st = frameStats(png)
  if (st.lumVariance >= varThr) return false
  const bg = [1, 3, 5].map((i) => parseInt(bgHex.slice(i, i + 2), 16))
  return st.mean.every((c, i) => Math.abs(c - bg[i]!) <= tol)
}

/**
 * Like `frameAt`, but forces a fresh paint before the screenshot (as the renderer's `seekFrame`
 * does), so frames compare exactly regardless of seek history.
 */
export async function freshFrameAt(page: Page, t: number): Promise<Buffer> {
  await page.evaluate(async (tt) => {
    await window.__mba.seek(tt)
    const frame = document.getElementById('frame')!
    const prev = frame.style.display
    frame.style.display = 'none'
    void frame.offsetHeight
    frame.style.display = prev
  }, t)
  return page.locator('#frame').screenshot({ caret: 'hide' })
}
