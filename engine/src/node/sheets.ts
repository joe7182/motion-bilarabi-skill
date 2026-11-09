import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { chromium, type Browser } from '@playwright/test'
import { SAFE_AREA } from '../core/types'

/** Image sheets for the review kit: a grid of labelled tiles, screenshotted by Chromium as JPEG q85. */

export interface SheetImage {
  path: string
  /** Shown under the tile, e.g. `t=1.50s`. */
  label: string
}

export interface SheetOptions {
  cols: number
  /** Tile width in px; the sheet is exactly cols × tileW wide. Tiles keep the image aspect. */
  tileW: number
  out: string
  /** `safe-9x16`: shade the 9:16 platform UI zones (top 14%, bottom 22%, right 12%) at 35% red. */
  overlay?: 'safe-9x16'
  /** Reuse this browser (one per review run); otherwise one is launched and closed. */
  browser?: Browser
}

/** Label for a frame time: `t=1.50s`. */
export function timeLabel(t: number): string {
  return `t=${t.toFixed(2)}s`
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }
const LABEL_H = 22

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/** The sheet as a self-contained HTML page (images inlined as data URLs: no file: access, no path issues). */
export async function sheetHtml(images: SheetImage[], o: Pick<SheetOptions, 'cols' | 'tileW' | 'overlay'>): Promise<string> {
  const cache = new Map<string, string>()
  const tiles: string[] = []
  const s = SAFE_AREA['9:16']
  const overlay =
    o.overlay === 'safe-9x16'
      ? `<i class="z" style="left:0;right:0;top:0;height:${s.top * 100}%"></i>` +
        `<i class="z" style="left:0;right:0;bottom:0;height:${s.bottom * 100}%"></i>` +
        `<i class="z" style="right:0;width:${s.right * 100}%;top:${s.top * 100}%;bottom:${s.bottom * 100}%"></i>`
      : ''
  for (const im of images) {
    const p = resolve(im.path)
    let url = cache.get(p)
    if (!url) {
      const mime = MIME[extname(p).toLowerCase()] ?? 'image/png'
      url = `data:${mime};base64,${(await readFile(p)).toString('base64')}`
      cache.set(p, url)
    }
    tiles.push(`<figure><div class="im"><img src="${url}">${overlay}</div><figcaption>${esc(im.label)}</figcaption></figure>`)
  }
  const w = o.cols * o.tileW
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#000;width:${w}px}
main{display:grid;grid-template-columns:repeat(${o.cols},${o.tileW}px);width:${w}px}
figure{margin:0;position:relative;width:${o.tileW}px}
.im{position:relative;width:${o.tileW}px;line-height:0}
.im img{display:block;width:${o.tileW}px;height:auto}
.im::after{content:'';position:absolute;inset:0;box-shadow:inset 0 0 0 1px rgba(0,0,0,.85)}
.z{position:absolute;display:block;background:rgba(255,0,0,.35)}
figcaption{height:${LABEL_H}px;line-height:${LABEL_H}px;padding:0 6px;font:13px/22px Consolas,Menlo,monospace;color:#e8e8e8;background:#151515;white-space:nowrap;overflow:hidden}
</style></head><body><main>${tiles.join('')}</main></body></html>`
}

/** Writes the sheet to `o.out` as JPEG q85 (device scale factor 1, exactly cols × tileW wide). */
export async function composeSheet(images: SheetImage[], o: SheetOptions): Promise<void> {
  if (!(o.cols >= 1 && o.tileW >= 1)) throw new Error(`مقاسات الورقة غير صالحة — Invalid sheet layout: cols ${o.cols}, tileW ${o.tileW}`)
  if (images.length === 0) throw new Error('لا توجد صور للورقة — No images for the sheet')
  const html = await sheetHtml(images, o)
  const own = o.browser ? undefined : await chromium.launch({ headless: true })
  const browser = o.browser ?? own!
  const width = o.cols * o.tileW
  const context = await browser.newContext({ viewport: { width, height: 200 }, deviceScaleFactor: 1 })
  try {
    const page = await context.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(async () => {
      await Promise.all([...document.images].map((im) => im.decode().catch(() => {})))
    })
    const height = await page.evaluate(() => Math.ceil(document.querySelector('main')!.getBoundingClientRect().height))
    await page.setViewportSize({ width, height: Math.max(1, height) })
    const buf = await page.screenshot({ type: 'jpeg', quality: 85, clip: { x: 0, y: 0, width, height: Math.max(1, height) } })
    const out = resolve(o.out)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, buf)
  } finally {
    await context.close().catch(() => {})
    await own?.close().catch(() => {})
  }
}

/** Most tiles on one sheet page: a 3-minute contact sheet is several readable pages, not one huge image. */
export const SHEET_PAGE_TILES = 60

/** `items` in pages of at most `perPage`, in order. */
export function paginate<T>(items: readonly T[], perPage: number = SHEET_PAGE_TILES): T[][] {
  if (!(Number.isInteger(perPage) && perPage >= 1)) throw new Error(`عدد صور الصفحة غير صالح — Invalid tiles per page: ${perPage}`)
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage))
  return pages
}

/** File name of page `page` (1-based) of a sheet: `contact.jpg`, `contact-2.jpg`, `contact-3.jpg`, … */
export function sheetPageName(base: string, page: number): string {
  return page === 1 ? `${base}.jpg` : `${base}-${page}.jpg`
}

/**
 * Writes `images` as pages of at most `perPage` tiles (`sheetPageName`) in `outDir`, and removes
 * pages of this sheet left over from an earlier, longer run. Returns the page file names in order.
 */
export async function composeSheetPages(
  images: SheetImage[],
  o: Omit<SheetOptions, 'out'> & { outDir: string; base: string; perPage?: number },
): Promise<string[]> {
  const pages = paginate(images, o.perPage ?? SHEET_PAGE_TILES)
  const names: string[] = []
  for (const [k, page] of pages.entries()) {
    const name = sheetPageName(o.base, k + 1)
    await composeSheet(page, { cols: o.cols, tileW: o.tileW, overlay: o.overlay, browser: o.browser, out: join(o.outDir, name) })
    names.push(name)
  }
  await removeSheetPages(o.outDir, o.base, pages.length)
  return names
}

/** Removes `<base>.jpg` / `<base>-N.jpg` pages beyond the first `keep` (all of them when keep = 0). */
export async function removeSheetPages(outDir: string, base: string, keep = 0): Promise<void> {
  if (!/^[a-z_]+$/.test(base)) throw new Error(`اسم ورقة غير صالح — Invalid sheet name: ${base}`)
  const re = new RegExp(`^${base}(?:-(\\d+))?\\.jpg$`)
  let names: string[]
  try {
    names = await readdir(outDir)
  } catch {
    return
  }
  for (const f of names) {
    const m = re.exec(f)
    if (!m) continue
    const page = m[1] === undefined ? 1 : Number(m[1])
    if (page > keep) await rm(join(outDir, f), { force: true })
  }
}
