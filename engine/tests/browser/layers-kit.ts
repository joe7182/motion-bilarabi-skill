import { expect, type Page } from '@playwright/test'
import { freshFrameAt } from './helpers'
import type {} from '../../src/runtime/mba-api'

/** A test logo: a white rounded tile with a coloured mark (an SVG data URL, like the reel's `*-tile.svg`). */
export function tile(color: string, shape: 'dot' | 'star' | 'bars' = 'dot'): string {
  const mark =
    shape === 'dot'
      ? `<circle cx="16" cy="16" r="8" fill="${color}"/>`
      : shape === 'star'
        ? `<path d="M16 6c.8 6 3.2 8.4 9.2 9.2-6 .8-8.4 3.2-9.2 9.2-.8-6-3.2-8.4-9.2-9.2 6-.8 8.4-3.2 9.2-9.2z" fill="${color}"/>`
        : `<rect x="8" y="9" width="16" height="3.5" rx="1.7" fill="${color}"/><rect x="8" y="14.5" width="12" height="3.5" rx="1.7" fill="${color}"/><rect x="8" y="20" width="14" height="3.5" rx="1.7" fill="${color}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7.5" fill="#FFFFFF"/>${mark}</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

export const seek = (page: Page, t: number) => page.evaluate((tt) => window.__mba.seek(tt), t)

/**
 * The LAYOUT box (offset chain to the frame, transforms ignored) of every text unit in `#frame`
 * that is shown, keyed by its path in the DOM: a reflow moves or resizes one of these, an
 * animation (transform / opacity / clip) never does.
 */
export async function layoutBoxes(page: Page): Promise<Record<string, [number, number, number, number]>> {
  return page.evaluate(() => {
    const frame = document.getElementById('frame')!
    const out: Record<string, [number, number, number, number]> = {}
    const pathOf = (el: Element) => {
      const parts: string[] = []
      for (let e: Element | null = el; e && e !== frame; e = e.parentElement) parts.push(String([...(e.parentElement?.children ?? [])].indexOf(e)))
      return parts.reverse().join('/')
    }
    for (const el of frame.querySelectorAll<HTMLElement>('[data-mba-text]')) {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue // display: none somewhere above
      let x = 0
      let y = 0
      for (let e: HTMLElement | null = el; e && e !== frame; e = e.offsetParent as HTMLElement | null) {
        x += e.offsetLeft
        y += e.offsetTop
      }
      out[pathOf(el)] = [x, y, el.offsetWidth, el.offsetHeight]
    }
    return out
  })
}

/** The text layout is identical at every one of `times` (each unit shown at both compared times). */
export async function expectNoReflow(page: Page, times: number[]): Promise<void> {
  const boxes: Record<string, [number, number, number, number]>[] = []
  for (const t of times) {
    await seek(page, t)
    boxes.push(await layoutBoxes(page))
  }
  const first = boxes[0]!
  expect(Object.keys(first).length, 'text units measured').toBeGreaterThan(0)
  for (const [i, b] of boxes.entries()) {
    for (const [k, v] of Object.entries(b)) if (first[k]) expect(v, `unit ${k} at ${times[i]} s vs ${times[0]} s`).toEqual(first[k])
  }
}

/** Audit clean at every one of `times`; at least `minChecked` text nodes measured at the last one. */
export async function expectAuditClean(page: Page, times: number[], minChecked = 1): Promise<void> {
  for (const t of times) {
    await seek(page, t)
    expect(await page.evaluate(() => window.__mba.audit()), `audit at ${t}`).toEqual([])
  }
  expect(await page.evaluate(() => window.__mba.auditStats().checkedGeometric)).toBeGreaterThanOrEqual(minChecked)
}

/** Cold seeks (fresh page each) and warm seeks (one page, scrambled order) give identical frames. */
export async function expectColdWarm(page: Page, times: number[], end: number): Promise<void> {
  const cold: Buffer[] = []
  for (const t of times) {
    await page.reload()
    await page.evaluate(() => window.__mba.ready)
    cold.push(await freshFrameAt(page, t))
  }
  await page.reload()
  await page.evaluate(() => window.__mba.ready)
  for (const t of [end, 0.05, ...[...times].reverse()]) await seek(page, t)
  for (const [i, t] of times.entries()) {
    await seek(page, (end * (i + 1)) / (times.length + 1))
    expect(Buffer.compare(cold[i]!, await freshFrameAt(page, t)), `cold / warm at ${t}`).toBe(0)
  }
}
