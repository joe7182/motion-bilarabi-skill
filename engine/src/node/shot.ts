import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium, devices } from '@playwright/test'

export interface ShotOptions {
  /** A phone-sized page (390 px wide, 2× pixels) instead of a 1440 × 900 desktop. */
  mobile?: boolean
  /** The whole page down to `maxHeight` CSS px (for a scrolling mockup) instead of one screen. */
  full?: boolean
  /** Extra wait after load (ms), for pages that animate in. */
  wait?: number
  /** Taller pages are cut at this many CSS px. */
  maxHeight?: number
}

/**
 * `mba shot <url> <out.jpg> [--mobile] [--full] [--wait ms]`: a screenshot of a public web page for a
 * `screen-mockup` (browser or phone). JPEG, quality 86. Cookie and consent banners are hidden by a
 * generic stylesheet when they match common names; nothing is clicked, typed or signed in to.
 */
export async function takeShot(url: string, out: string, o: ShotOptions = {}): Promise<{ file: string; w: number; h: number }> {
  if (!/^https?:\/\//i.test(url)) throw new Error(`الرابط لازم يبدأ بـ http أو https — the URL must start with http(s)://: ${url}`)
  const file = resolve(out)
  mkdirSync(dirname(file), { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = o.mobile
      ? await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 })
      : await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 })
    const page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => page.waitForLoadState('load'))
    await page.addStyleTag({
      content:
        '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[aria-label*="cookie" i],[id*="onetrust" i],[class*="onetrust" i]{display:none !important}',
    })
    if (o.full) {
      // Scroll down the page in steps so lazy images load and scroll-triggered sections animate in, then back to the top.
      await page.evaluate(async () => {
        const step = Math.round(window.innerHeight * 0.6)
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 160))
        }
        window.scrollTo(0, 0)
      })
      await page.waitForTimeout(800)
    }
    if (o.wait) await page.waitForTimeout(o.wait)
    const vp = page.viewportSize()!
    let h = vp.height
    if (o.full) {
      const total = await page.evaluate(() => document.documentElement.scrollHeight)
      h = Math.min(total, o.maxHeight ?? 6000)
    }
    await page.screenshot({ path: file, type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: vp.width, height: h }, fullPage: o.full === true })
    return { file, w: vp.width, h }
  } finally {
    await browser.close()
  }
}
