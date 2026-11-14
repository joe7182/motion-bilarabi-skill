import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boardMoments, type BoardNotes, type Moment } from '../core/board-moments'
import { storyboardArg } from './project'

/**
 * `mba board <projectDir | storyboard.json>`: the review board. Renders one still per moment of the
 * storyboard (a new thing on screen, with the words said over it) and serves a local page where the
 * person taps a moment and writes a note, or approves the whole video. «أرسل» saves `notes.json`
 * beside the storyboard: the notes Claude applies in one pass (or `approved: true`).
 */

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PAGE = join(ENGINE, 'board', 'index.html')
const CAIRO = join(ENGINE, 'assets', 'fonts', 'cairo', 'Cairo-Variable.ttf')
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.ttf': 'font/ttf' }

export interface BoardData { storyboard: string; dir: string; total: number; moments: (Moment & { img: string })[] }

const cli = (args: string[]) => execFileSync('npx', ['tsx', 'src/cli.ts', ...args.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a))], { cwd: ENGINE, shell: true, stdio: ['ignore', 'pipe', 'pipe'] }).toString()

/** Finds the moments, renders their stills (one engine run), writes the board's data. */
export async function prepareBoard(arg: string, o: { log?: (l: string) => void } = {}): Promise<BoardData> {
  const log = o.log ?? (() => {})
  const storyboard = resolve(await storyboardArg(arg))
  const dir = dirname(storyboard)
  const sb = JSON.parse(readFileSync(storyboard, 'utf8')) as { scenes: { id: string; type: string; track?: number; start: number; duration: number }[] }
  const total = Math.max(...sb.scenes.map((s) => s.start + s.duration))
  const trFile = join(dir, 'transcript.json')
  const words = existsSync(trFile) ? ((JSON.parse(readFileSync(trFile, 'utf8')) as { words?: { text: string; start: number; end: number }[] }).words ?? []) : []
  const moments = boardMoments(sb.scenes, words, total)
  const out = join(dir, 'work', 'board', basename(storyboard, '.json'))
  const stills = join(out, 'stills')
  rmSync(stills, { recursive: true, force: true })
  mkdirSync(stills, { recursive: true })
  log(`${moments.length} لقطة — moments; رسم الصور — rendering the stills…`)
  cli(['still', storyboard, '--t', moments.map((m) => String(m.t)).join(','), '--out', stills])
  // still-<t>.png → <n>.jpg (the engine names a still by its time)
  const pngs = readdirSync(stills).filter((f) => f.endsWith('.png'))
  const byT = new Map(pngs.map((f) => [Number(f.slice('still-'.length, -'.png'.length)), f]))
  const withImg = moments.map((m) => {
    const png = byT.get(m.t) ?? [...byT.entries()].sort((a, b) => Math.abs(a[0] - m.t) - Math.abs(b[0] - m.t))[0]?.[1]
    if (!png) throw new Error(`ما انرسمت صورة اللقطة ${m.n} — no still for moment ${m.n} (t=${m.t})`)
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', join(stills, png), '-vf', 'scale=540:-1', '-q:v', '3', join(out, `${m.n}.jpg`)])
    return { ...m, img: `/img/${m.n}.jpg` }
  })
  const data: BoardData = { storyboard, dir, total, moments: withImg }
  writeFileSync(join(out, 'moments.json'), JSON.stringify(data, null, 1))
  return data
}

/** Serves the board until the process is stopped. */
export function serveBoard(data: BoardData, port = 4319, onSaved?: (notes: BoardNotes, file: string) => void): Promise<string> {
  const out = join(data.dir, 'work', 'board', basename(data.storyboard, '.json'))
  const send = (res: import('node:http').ServerResponse, code: number, body: string | Buffer, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body) }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'POST' && url.pathname === '/notes') {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', () => {
        try {
          const c = JSON.parse(raw) as { approved?: boolean; general?: string; notes?: Record<string, string> }
          const notes: BoardNotes = {
            storyboard: data.storyboard,
            at: new Date().toISOString(),
            approved: c.approved === true,
            general: String(c.general ?? '').slice(0, 4000),
            moments: data.moments
              .map((m) => ({ n: m.n, from: m.from, to: m.to, t: m.t, words: m.words, scenes: m.scenes, note: String(c.notes?.[String(m.n)] ?? '').trim().slice(0, 2000) }))
              .filter((m) => m.note),
          }
          const file = join(data.dir, 'notes.json')
          writeFileSync(file, JSON.stringify(notes, null, 1))
          send(res, 200, JSON.stringify({ ok: true, saved: file, count: notes.moments.length, approved: notes.approved }), TYPES['.json'])
          // stop serving once the notes are saved: the process can then end, which is the signal
          if (onSaved) setTimeout(() => { onSaved(notes, file); server.close(); server.closeAllConnections() }, 300)
        } catch (e) {
          send(res, 500, JSON.stringify({ ok: false, error: String((e as Error).message || e).slice(0, 300) }), TYPES['.json'])
        }
      })
      return
    }
    if (url.pathname === '/') return send(res, 200, readFileSync(PAGE), TYPES['.html'])
    if (url.pathname === '/moments.json') return send(res, 200, JSON.stringify({ total: data.total, name: basename(data.dir), moments: data.moments }), TYPES['.json'])
    if (url.pathname === '/cairo.ttf') return send(res, 200, readFileSync(CAIRO), TYPES['.ttf'])
    if (url.pathname.startsWith('/img/')) {
      const f = resolve(out, decodeURIComponent(url.pathname.slice('/img/'.length)))
      if (f.startsWith(out + sep) && existsSync(f) && !statSync(f).isDirectory()) return send(res, 200, readFileSync(f), TYPES[extname(f)] ?? 'application/octet-stream')
    }
    send(res, 404, 'not found')
  })
  return new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => ok(`http://localhost:${port}`))
  })
}
