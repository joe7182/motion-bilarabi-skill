import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TITLE_FONTS, TITLE_IN, TITLE_OUT, TITLE_STYLES, titleCss, titleFontFaces } from '../core/title-styles'
import type { StyledTitleParams } from '../core/params/styled-title'
import { styledTitleParams } from '../core/params/styled-title'
import { groundOf, PICK_GROUNDS } from '../core/pick-grounds'
import { makeMatte } from './matte'
import { openProject } from './project'

/**
 * `mba pick <projectDir>`: the style picker. Takes one frame of the person's clip (where they are on
 * screen), renders a card per title style with the engine, and serves a local page where they pick a
 * style, a font, colours, one or two lines, an entrance and an exit, and drag the title into place
 * (in front, or behind the head). «استخدم هذا» saves `pick.json` in the project — a ready
 * `styled-title` scene (and the `cutout` scene for behind the head) — and renders that exact frame.
 * A faceless video (no clip in the project, or `--faceless`) gets the same page over backgrounds
 * instead (`core/pick-grounds.ts`): the pick then also names the look, the variant and the ground.
 */

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PAGE = join(ENGINE, 'picker', 'index.html')
const FONTS_DIR = join(ENGINE, 'assets', 'fonts')
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.ttf': 'font/ttf', '.mp4': 'video/mp4' }

export interface PickOptions { faceless?: boolean; media?: string; t?: number; port?: number; title?: string; key?: string; log?: (l: string) => void }

type Box = [number, number, number, number]
interface PickData { project: string; faceless: boolean; ground: string; grounds: { id: string; ar: string; ink?: { text: string; k1: string; k2: string; box: string; boxAlpha: number } }[]; media: string; t: number; fps: number; face: Box | null; hasMatte: boolean; place: { cx: number; cy: number; w: number; size: number }; text: { text: string; key: string }; styles: { id: string; ar: string; en: string }[] }

const cli = (args: string[]) => execFileSync('npx', ['tsx', 'src/cli.ts', ...args.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a))], { cwd: ENGINE, shell: true, stdio: ['ignore', 'pipe', 'pipe'] }).toString()

/** A board: the clip under the title (and, behind the head, the person cut out over it). */
function board(data: PickData, title: StyledTitleParams | null, opts: { clip?: boolean; ground?: string } = {}) {
  const dur = opts.clip ? 3.2 : data.t + 1
  if (data.faceless) {
    const g = groundOf(opts.ground ?? data.ground)
    const scenes: unknown[] = [{ id: 'ground', type: g.scene.type, track: 0, start: 0, duration: dur, params: g.scene.params }]
    if (title) scenes.push({ id: 'title', type: 'styled-title', track: 1, start: 0, duration: dur, params: opts.clip ? { ...title, layer: 'front', at: 0.2, outAt: 2.4 } : { ...title, layer: 'front', out: 'none' } })
    return { version: 1, format: '9:16', fps: data.fps, look: g.look, ...(g.variant ? { variant: g.variant } : {}), dir: 'rtl', seed: 1, autoSfx: false, scenes }
  }
  if (!title) throw new Error('a clip board needs a title')
  const vin = opts.clip ? Math.max(0, data.t - 1.2) : 0
  const scenes: unknown[] = [
    { id: 'v', type: 'video', track: 0, start: 0, duration: dur, params: { media: data.media, in: vin, fit: 'cover', muted: true } },
    { id: 'title', type: 'styled-title', track: 1, start: 0, duration: dur, params: opts.clip ? { ...title, at: 0.2, outAt: 2.4 } : { ...title, out: 'none' } },
  ]
  if (title.layer === 'behind') scenes.push({ id: 'person', type: 'cutout', track: 2, start: 0, duration: dur, params: { media: data.media, in: vin, fit: 'cover', muted: true, mode: 'person' } })
  return { version: 1, format: '9:16', fps: data.fps, look: 'dark-tech', dir: 'rtl', seed: 1, autoSfx: false, scenes }
}

function still(data: PickData, title: StyledTitleParams | null, name: string, outJpg: string, ground?: string): void {
  const file = join(data.project, `pick-board-${name}.json`)
  writeFileSync(file, JSON.stringify(board(data, title, { ...(ground ? { ground } : {}) })))
  const dir = join(data.project, 'work', 'pick', 'renders', name)
  rmSync(dir, { recursive: true, force: true })
  cli(['still', file, '--t', String(data.t), '--out', dir])
  const png = readdirSync(dir).find((f) => f.endsWith('.png'))!
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', join(dir, png), '-vf', 'scale=540:-1', '-q:v', '3', outJpg])
}

function clip(data: PickData, title: StyledTitleParams, outMp4: string, ground?: string): void {
  const file = join(data.project, 'pick-board-preview.json')
  writeFileSync(file, JSON.stringify(board(data, title, { clip: true, ...(ground ? { ground } : {}) })))
  const out = cli(['render', file, '--draft'])
  const m = out.match(/[A-Za-z]:[^\r\n]*?\.mp4|\/[^\r\n]*?\.mp4/g)
  if (!m) throw new Error('no clip path in the render output')
  copyFileSync(m[m.length - 1]!.trim(), outMp4)
}

/** The page's choice → styled-title params (validated). */
function titleOf(c: Record<string, unknown>): StyledTitleParams {
  const colors = c.colors && typeof c.colors === 'object' ? c.colors : undefined
  let text = String(c.text || '').trim()
  let key = String(c.key || '').trim()
  // only a key word: it is the whole title; nothing at all: say so
  if (!text && key) { text = key; key = '' }
  if (!text) throw new Error('اكتب العنوان أول — type the title first')
  return styledTitleParams.parse({
    text, key, lines: c.lines === 2 ? 2 : 1,
    style: c.style, font: c.font, layer: c.layer === 'behind' ? 'behind' : 'front',
    cx: Number(c.cx), cy: Number(c.cy), w: Number(c.w), size: Math.round(Number(c.size)),
    in: c.animIn, out: c.animOut, ...(colors ? { colors } : {}),
  })
}

/** Prepares the frame, the face, the person cut-out and the style cards; returns the page data. */
export async function preparePick(projectDir: string, o: PickOptions = {}): Promise<PickData> {
  const log = o.log ?? (() => {})
  const project = await openProject(projectDir)
  const dir = project.dir
  const styles = TITLE_STYLES.map(({ id, ar, en }) => ({ id, ar, en }))
  const grounds = PICK_GROUNDS.map(({ id, ar, ink }) => ({ id, ar, ...(ink ? { ink } : {}) }))
  const hasClip = project.manifest.media.some((x) => x.kind === 'video')
  if (o.faceless || (!hasClip && !o.media)) {
    // faceless: the title over each background (a style card shows its own background)
    const out = join(dir, 'work', 'pick')
    mkdirSync(join(out, 'cards'), { recursive: true })
    mkdirSync(join(out, 'grounds'), { recursive: true })
    const data: PickData = { project: dir, faceless: true, ground: PICK_GROUNDS[0]!.id, grounds, media: '', t: 1, fps: project.manifest.fps, face: null, hasMatte: false, place: { cx: 0.5, cy: 0.42, w: 0.84, size: 104 }, text: { text: o.title ?? 'اكتب عنوانك', key: o.key ?? 'هنا' }, styles }
    for (const g of PICK_GROUNDS) {
      log(`خلفية — background: ${g.id}`)
      still(data, null, `ground-${g.id}`, join(out, 'grounds', `${g.id}.jpg`), g.id)
    }
    copyFileSync(join(out, 'grounds', `${data.ground}.jpg`), join(out, 'frame.jpg'))
    for (const s of TITLE_STYLES) {
      log(`بطاقة — card: ${s.id}`)
      const g = groundOf(s.id)
      still(data, styledTitleParams.parse({ ...data.text, style: s.id, ...data.place, ...(g.id === s.id && g.ink ? { colors: g.ink } : {}) }), `card-${s.id}`, join(out, 'cards', `${s.id}.jpg`), g.id)
    }
    writeFileSync(join(out, 'data.json'), JSON.stringify(data, null, 1))
    return data
  }
  const m = project.manifest.media.find((x) => (o.media ? x.id === o.media : x.kind === 'video'))
  if (!m || m.kind !== 'video') throw new Error(`لا يوجد فيديو بالمشروع${o.media ? ` بالرقم ${o.media}` : ''} — no video clip in the project${o.media ? ` with id ${o.media}` : ''}`)
  const work = join(dir, 'work', `${m.id}.mp4`)
  if (!existsSync(work)) throw new Error(`شغّل mba ingest أول — run mba ingest first (missing ${work})`)
  const t = Math.min(Math.max(0, o.t ?? Math.min(2, (m.durationSec ?? 4) / 2)), Math.max(0, (m.durationSec ?? 1) - 0.1))
  const matte = join(dir, 'work', `${m.id}.matte.mp4`)
  const faceFile = join(dir, 'work', `${m.id}.matte.face.json`)
  if (!existsSync(matte) || !existsSync(faceFile)) {
    log('قصّ الشخص من الفيديو (مرة وحدة) — cutting the person out of the clip (once)…')
    await makeMatte(dir, m.id, undefined, log)
  }
  const out = join(dir, 'work', 'pick')
  mkdirSync(join(out, 'cards'), { recursive: true })
  const faceJson = existsSync(faceFile) ? (JSON.parse(readFileSync(faceFile, 'utf8')) as { fps: number; boxes: Box[] }) : null
  const face = faceJson ? faceJson.boxes[Math.min(faceJson.boxes.length - 1, Math.round(t * faceJson.fps))] ?? null : null
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', work, '-frames:v', '1', '-vf', 'scale=1080:1920', '-q:v', '2', join(out, 'frame.jpg')])
  const hasMatte = existsSync(matte)
  if (hasMatte) {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', work, '-ss', String(t), '-i', matte, '-frames:v', '1', '-filter_complex', '[0]scale=1080:1920[c];[1]scale=1080:1920,format=gray[m];[c][m]alphamerge', join(out, 'person.png')])
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', matte, '-frames:v', '1', '-vf', 'scale=270:480,format=gray', join(out, 'matte-small.png')])
  }
  const place = { cx: 0.5, cy: face ? Math.min(0.66, face[3] + 0.13) : 0.6, w: 0.84, size: 92 }
  const text = { text: o.title ?? 'اكتب عنوانك', key: o.key ?? 'هنا' }
  const data: PickData = { project: dir, faceless: false, ground: '', grounds: [], media: m.id, t, fps: project.manifest.fps, face, hasMatte, place, text, styles }
  for (const s of TITLE_STYLES) {
    log(`بطاقة — card: ${s.id}`)
    still(data, styledTitleParams.parse({ ...text, style: s.id, ...place }), `card-${s.id}`, join(out, 'cards', `${s.id}.jpg`))
  }
  writeFileSync(join(out, 'data.json'), JSON.stringify(data, null, 1))
  return data
}

/** Serves the picker until the process is stopped. */
export function servePick(data: PickData, port = 4317, onChosen?: (file: string) => void): Promise<string> {
  const out = join(data.project, 'work', 'pick')
  const send = (res: import('node:http').ServerResponse, code: number, body: string | Buffer, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body) }
  const json = (res: import('node:http').ServerResponse, code: number, v: unknown) => send(res, code, JSON.stringify(v), TYPES['.json'])
  const post = (req: import('node:http').IncomingMessage, fn: (c: Record<string, unknown>) => unknown, res: import('node:http').ServerResponse) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      try { json(res, 200, { ok: true, ...(fn(JSON.parse(raw)) as object) }) } catch (e) { json(res, 500, { ok: false, error: String((e as Error).message || e).slice(0, 400) }) }
    })
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'POST' && url.pathname === '/choose') return post(req, (c) => {
      const title = titleOf(data.faceless ? { ...c, layer: 'front' } : c)
      if (data.faceless) {
        const g = groundOf(c.ground)
        const pick = {
          faceless: true,
          look: g.look,
          ...(g.variant ? { variant: g.variant } : {}),
          ground: { type: g.scene.type, params: g.scene.params },
          title: { type: 'styled-title', params: title },
          howTo: 'Set "look" (and "variant") at the top of the storyboard, put the ground scene on track 0 for the whole video, and the title scene on a track above it for the moment it belongs to.',
          at: new Date().toISOString(),
        }
        const file = join(data.project, 'pick.json')
        writeFileSync(file, JSON.stringify(pick, null, 1))
        still(data, title, 'choice', join(out, 'choice.jpg'), g.id)
        if (onChosen) setTimeout(() => { onChosen(file); server.close(); server.closeAllConnections() }, 1500)
        return { img: '/choice.jpg?' + Date.now(), saved: file, choice: title }
      }
      const pick = {
        media: data.media, frameAt: data.t,
        title: { type: 'styled-title', params: title },
        cutout: title.layer === 'behind' ? { type: 'cutout', params: { media: data.media, fit: 'cover', muted: true, mode: 'person' } } : null,
        howTo: 'Put the title scene on a track above the video for the moment it belongs to. With a cutout, put it on the next track up with the same start, duration and `in` as the video under it.',
        at: new Date().toISOString(),
      }
      const file = join(data.project, 'pick.json')
      writeFileSync(file, JSON.stringify(pick, null, 1))
      still(data, title, 'choice', join(out, 'choice.jpg'))
      // stop serving once the choice is saved: the process can then end, which is the signal
      if (onChosen) setTimeout(() => { onChosen(file); server.close(); server.closeAllConnections() }, 1500)
      return { img: '/choice.jpg?' + Date.now(), saved: file, choice: title }
    }, res)
    if (req.method === 'POST' && url.pathname === '/preview') return post(req, (c) => {
      clip(data, titleOf(data.faceless ? { ...c, layer: 'front' } : c), join(out, 'preview.mp4'), data.faceless ? groundOf(c.ground).id : undefined)
      return { video: '/preview.mp4?' + Date.now() }
    }, res)
    if (url.pathname === '/') return send(res, 200, readFileSync(PAGE), TYPES['.html'])
    if (url.pathname === '/styles.css') return send(res, 200, titleFontFaces('/fonts/') + titleCss(''), TYPES['.css'])
    if (url.pathname === '/fonts.json') return json(res, 200, TITLE_FONTS.map(({ id, ar, family }) => ({ id, ar, family })))
    if (url.pathname === '/anims.json') return json(res, 200, { in: TITLE_IN, out: TITLE_OUT })
    if (url.pathname.startsWith('/fonts/')) {
      const f = resolve(FONTS_DIR, decodeURIComponent(url.pathname.slice('/fonts/'.length)))
      if (f.startsWith(FONTS_DIR + sep) && existsSync(f)) return send(res, 200, readFileSync(f), TYPES['.ttf'])
      return send(res, 404, 'not found')
    }
    const f = resolve(out, decodeURIComponent(url.pathname.slice(1)))
    if (!f.startsWith(out + sep) || !existsSync(f) || statSync(f).isDirectory()) return send(res, 404, 'not found')
    send(res, 200, readFileSync(f), TYPES[extname(f)] ?? 'application/octet-stream')
  })
  return new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => ok(`http://localhost:${port}`))
  })
}
