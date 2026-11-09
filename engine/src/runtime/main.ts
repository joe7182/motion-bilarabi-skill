import { z, type ZodType } from 'zod'
import { parseStoryboard } from '../core/storyboard'
import { PRIMITIVE_IDS } from '../core/primitive-ids'
import { createStage, type Stage } from './stage'
import type { MbaApi } from './mba-api'
import { FORMAT_SIZE, safeRect, type Format } from '../core/types'
import { auditTextStats } from './audit'
import { mountPreview, startTimeFromUrl } from './preview/controls'
import { registerPrimitive, type Primitive } from './primitives/registry'

async function loadStoryboardJson(): Promise<unknown> {
  if (window.__MBA_STORYBOARD__ !== undefined) return window.__MBA_STORYBOARD__
  const url = new URLSearchParams(window.location.search).get('sb')
  if (!url) throw new Error('no storyboard: inject window.__MBA_STORYBOARD__ or pass ?sb=<url>')
  const res = await fetch(url)
  if (!res.ok) {
    // The preview server answers a storyboard that became invalid with the error as text.
    const body = (await res.text()).trim().slice(0, 2000)
    throw new Error(`could not load storyboard ${url}: HTTP ${res.status}${body ? `: ${body}` : ''}`)
  }
  return res.json()
}

let stage: Stage | undefined
/** The frame element and format, set together with `stage`; the audit needs both. */
let frame: { root: HTMLElement; format: Format } | undefined

/**
 * Test-primitive hook. Only when the page URL has `?test=1`: registers every primitive in
 * `window.__MBA_TEST_PRIMITIVES__` (an array of `{ id, params?, build }`, set by tests through
 * `addInitScript`) and returns their ids, which the caller adds to the known scene types.
 * Ids must start with `_` (and must not clash with a built-in id). `params` is any Zod schema
 * (or object with Zod's `safeParse`); when omitted, params pass through unchecked.
 * Without `?test=1` the global is ignored completely and this returns [].
 */
function registerTestPrimitives(): string[] {
  if (new URLSearchParams(window.location.search).get('test') !== '1') return []
  const list = window.__MBA_TEST_PRIMITIVES__
  if (list === undefined) return []
  if (!Array.isArray(list)) throw new Error('__MBA_TEST_PRIMITIVES__ must be an array')
  const ids: string[] = []
  for (const raw of list as Partial<Primitive>[]) {
    const id = raw?.id
    if (typeof id !== 'string' || !id.startsWith('_')) {
      throw new Error(`test primitive id must be a string starting with "_", got ${JSON.stringify(id)}`)
    }
    if (typeof raw.build !== 'function') throw new Error(`test primitive "${id}" has no build function`)
    registerPrimitive({ id, params: (raw.params ?? z.any()) as ZodType, build: raw.build.bind(raw) })
    ids.push(id)
  }
  return ids
}

/**
 * Preview only: shows a failed load on the page (an Arabic line, then the error) instead of a
 * blank frame. Render mode never calls this; it reads `__mba.error`.
 */
function showError(message: string): void {
  const box = document.createElement('div')
  box.id = 'mba-error'
  box.dir = 'auto'
  Object.assign(box.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '10',
    padding: '32px',
    background: '#141414',
    color: '#f2ece2',
    font: '18px/1.6 system-ui, sans-serif',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  })
  const title = document.createElement('div')
  title.dir = 'rtl'
  title.lang = 'ar'
  title.textContent = 'تعذّر تحميل القصة — The storyboard failed to load'
  Object.assign(title.style, { fontSize: '24px', fontWeight: '700', marginBottom: '16px', color: '#ff5a1f' })
  const detail = document.createElement('div')
  detail.dir = 'auto'
  detail.textContent = message
  box.append(title, detail)
  document.body.append(box)
}

const api: MbaApi = {
  ready: Promise.resolve(),
  duration: 0,
  // The latest-wins queue lives in the stage; this only forwards.
  async seek(t: number) {
    if (!stage) throw new Error(api.error ? `stage failed: ${api.error}` : 'stage not ready')
    await stage.seek(t)
  },
  audit() {
    return api.auditStats().issues
  },
  auditStats() {
    if (!stage || !frame) throw new Error(api.error ? `stage failed: ${api.error}` : 'stage not ready')
    return auditTextStats(frame.root, safeRect(frame.format), FORMAT_SIZE[frame.format])
  },
}

api.ready = (async () => {
  // Render mode injects the storyboard; only a hand-opened preview page gets controls.
  const previewing = window.__MBA_STORYBOARD__ === undefined
  try {
    const testIds = registerTestPrimitives()
    const sb = parseStoryboard(await loadStoryboardJson(), [...PRIMITIVE_IDS, ...testIds])
    const root = document.getElementById('frame')
    if (!root) throw new Error('#frame element missing')
    stage = await createStage(root, sb)
    frame = { root, format: sb.format }
    api.duration = stage.duration
    await stage.seek(0)
    if (previewing) {
      const playhead = mountPreview({ stage, frame: root, size: FORMAT_SIZE[sb.format], fps: sb.fps, startT: startTimeFromUrl(window.location.search) })
      // Preview only: the audio module is never loaded in render mode (render audio is ffmpeg's).
      void import('./preview/audio')
        .then((m) => m.loadPreviewAudio(playhead))
        .catch((e: unknown) => console.error('preview audio failed', e))
    }
  } catch (e) {
    api.error = e instanceof Error ? e.message : String(e)
    if (previewing) showError(api.error)
  }
})()

window.__mba = api
