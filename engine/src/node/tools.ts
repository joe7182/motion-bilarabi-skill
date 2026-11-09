import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

export interface ToolLookupOptions {
  /** True when a file exists at `p`. Injected by tests. */
  exists?: (p: string) => boolean
  /** Full path of executable `n` found on PATH, or null. Injected by tests. */
  which?: (n: string) => string | null
  /** User home directory (used when LOCALAPPDATA is not set). */
  home?: string
  /** Directory listing (names only); [] when the directory is missing. Injected by tests. */
  readdir?: (dir: string) => string[]
}

type Env = Record<string, string | undefined>

/**
 * An external tool (or its model file) is not installed. The message is Arabic first, then English,
 * and says how to install it; the CLI exits with code 2.
 */
export class ToolMissingError extends Error {
  readonly tool: string
  constructor(tool: string, message: string) {
    super(message)
    this.name = 'ToolMissingError'
    this.tool = tool
  }
}

const isWin = process.platform === 'win32'

function defaultExists(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function defaultReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Looks `name` up on PATH (with PATHEXT on Windows). */
export function whichSync(name: string, env: Env = process.env): string | null {
  const pathVar = env.PATH ?? env.Path ?? ''
  const exts = isWin ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : ['']
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue
    const clean = dir.replace(/^"(.*)"$/, '$1')
    for (const ext of exts) {
      const p = join(clean, name + ext.toLowerCase())
      if (defaultExists(p)) return p
    }
  }
  return null
}

const byVersionDesc = (a: string, b: string) => b.localeCompare(a, 'en', { numeric: true })

/** `<LOCALAPPDATA>/Microsoft/WinGet/Packages/Gyan.FFmpeg* /ffmpeg-* /bin/<exe>`, newest build first. */
function wingetCandidates(exe: string, env: Env, home: string, readdir: (d: string) => string[]): string[] {
  const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
  const pkgs = join(local, 'Microsoft', 'WinGet', 'Packages')
  const found: { build: string; path: string }[] = []
  for (const pkg of readdir(pkgs).filter((n) => n.startsWith('Gyan.FFmpeg'))) {
    for (const build of readdir(join(pkgs, pkg)).filter((n) => n.startsWith('ffmpeg-'))) {
      found.push({ build, path: join(pkgs, pkg, build, 'bin', exe) })
    }
  }
  return found.sort((a, b) => byVersionDesc(a.build, b.build)).map((f) => f.path)
}

function lookup(name: 'ffmpeg' | 'ffprobe', envVar: string, env: Env, opts: ToolLookupOptions): string | null {
  const exists = opts.exists ?? defaultExists
  const which = opts.which ?? ((n: string) => whichSync(n, env))
  const readdir = opts.readdir ?? defaultReaddir
  const home = opts.home ?? homedir()

  const fromEnv = env[envVar]
  if (fromEnv) {
    if (exists(fromEnv)) return fromEnv
    throw new Error(`المسار في ${envVar} غير موجود — ${envVar} points to a file that does not exist: ${fromEnv}`)
  }
  const onPath = which(name)
  if (onPath) return onPath
  for (const p of wingetCandidates(`${name}.exe`, env, home, readdir)) if (exists(p)) return p
  for (const p of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) if (exists(p)) return p
  return null
}

/**
 * Finds ffmpeg: `MBA_FFMPEG` → PATH → winget (Gyan.FFmpeg, newest build) → Homebrew paths.
 * Throws an Error whose message is Arabic first, then English.
 */
export function resolveFfmpeg(env: Env = process.env, opts: ToolLookupOptions = {}): string {
  const p = lookup('ffmpeg', 'MBA_FFMPEG', env, opts)
  if (p) return p
  throw new Error('لم يتم العثور على ffmpeg — ffmpeg was not found. Install it or set MBA_FFMPEG.')
}

/**
 * Finds ffprobe: beside the resolved ffmpeg → `MBA_FFPROBE` → PATH → winget → Homebrew paths.
 */
export function resolveFfprobe(env: Env = process.env, opts: ToolLookupOptions = {}): string {
  const exists = opts.exists ?? defaultExists
  let ffmpeg: string | null = null
  try {
    ffmpeg = resolveFfmpeg(env, opts)
  } catch {
    ffmpeg = null
  }
  if (ffmpeg) {
    for (const exe of ['ffprobe.exe', 'ffprobe']) {
      const p = join(dirname(ffmpeg), exe)
      if (exists(p)) return p
    }
  }
  const p = lookup('ffprobe', 'MBA_FFPROBE', env, opts)
  if (p) return p
  throw new Error('لم يتم العثور على ffprobe — ffprobe was not found. Install ffmpeg (it includes ffprobe) or set MBA_FFPROBE.')
}

export interface VersionRunResult {
  code: number | null
  stdout: string
  stderr: string
}

function runVersion(cmd: string, args: string[]): Promise<VersionRunResult> {
  return new Promise((res) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (d: string) => (stdout += d))
    proc.stderr.resume()
    proc.once('error', () => res({ code: null, stdout, stderr: '' }))
    proc.once('close', (code) => res({ code, stdout, stderr: '' }))
  })
}

const versionCache = new Map<string, string>()

/**
 * The first line of `<ffmpeg> -version` (e.g. `ffmpeg version 9.0.1-full_build-…`), asked once
 * per binary and process. Part of a render job's hash: chunks of another ffmpeg build are never
 * mixed into a resumed render. 'unknown' when it cannot be run (not cached; asked again next time).
 */
export async function ffmpegVersionLine(
  ffmpeg: string = resolveFfmpeg(),
  runner: (cmd: string, args: string[]) => Promise<VersionRunResult> = runVersion,
): Promise<string> {
  const hit = versionCache.get(ffmpeg)
  if (hit !== undefined) return hit
  const r = await runner(ffmpeg, ['-version'])
  const line = r.code === 0 ? r.stdout.split(/\r?\n/)[0]!.trim() : ''
  if (!line) return 'unknown'
  versionCache.set(ffmpeg, line)
  return line
}
