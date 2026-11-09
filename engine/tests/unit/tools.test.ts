import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { resolveFfmpeg, resolveFfprobe } from '../../src/node/tools'

const HOME = 'C:/Users/test user'
const PKG = 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe'
const WINGET = join(HOME, 'AppData/Local/Microsoft/WinGet/Packages', PKG, 'ffmpeg-9.0.1-full_build/bin/ffmpeg.exe')
const none = { exists: () => false, which: () => null, home: HOME, readdir: () => [] }

/** Fake directory listing so the winget glob can be exercised without touching the real disk. */
function fakeReaddir(files: string[]) {
  return (dir: string): string[] => {
    const prefix = join(dir, 'x').slice(0, -1)
    const names = new Set<string>()
    for (const f of files.map((x) => join(x))) {
      if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split(/[\\/]/)[0]!)
    }
    return [...names]
  }
}

describe('resolveFfmpeg', () => {
  it('MBA_FFMPEG wins', () => {
    expect(resolveFfmpeg({ MBA_FFMPEG: 'C:/x/ffmpeg.exe' }, { exists: () => true, which: () => '/usr/bin/ffmpeg' })).toBe('C:/x/ffmpeg.exe')
  })
  it('PATH is second', () => {
    expect(resolveFfmpeg({}, { ...none, exists: () => true, which: (n) => (n === 'ffmpeg' ? '/usr/bin/ffmpeg' : null) })).toBe('/usr/bin/ffmpeg')
  })
  it('falls back to the winget package folder', () => {
    const got = resolveFfmpeg({}, { exists: (p) => join(p) === WINGET, which: () => null, home: HOME, readdir: fakeReaddir([WINGET]) })
    expect(join(got)).toBe(WINGET)
  })
  it('picks the newest winget build', () => {
    const old = WINGET.replace('ffmpeg-9.0.1', 'ffmpeg-8.10.0')
    const newer = WINGET.replace('ffmpeg-9.0.1', 'ffmpeg-10.0.0')
    const all = [old, WINGET, newer]
    const got = resolveFfmpeg({}, { exists: (p) => all.includes(join(p)), which: () => null, home: HOME, readdir: fakeReaddir(all) })
    expect(join(got)).toBe(newer)
  })
  it('falls back to Homebrew paths', () => {
    expect(resolveFfmpeg({}, { ...none, exists: (p) => p === '/usr/local/bin/ffmpeg' })).toBe('/usr/local/bin/ffmpeg')
  })
  it('throws an Arabic-then-English message when nothing is found', () => {
    const run = () => resolveFfmpeg({}, none)
    expect(run).toThrow(/ffmpeg/)
    expect(run).toThrow(/^لم يتم العثور على ffmpeg/)
    expect(run).toThrow(/MBA_FFMPEG/)
  })
})

describe('resolveFfprobe', () => {
  it('looks beside the resolved ffmpeg first', () => {
    const probe = join('C:/x/ffprobe.exe')
    const exists = (p: string) => join(p) === probe || p === 'C:/x/ffmpeg.exe'
    expect(join(resolveFfprobe({ MBA_FFMPEG: 'C:/x/ffmpeg.exe' }, { ...none, exists }))).toBe(probe)
  })
  it('falls back to MBA_FFPROBE, then PATH', () => {
    expect(resolveFfprobe({ MBA_FFPROBE: '/opt/ffprobe' }, { ...none, exists: (p) => p === '/opt/ffprobe' })).toBe('/opt/ffprobe')
    expect(resolveFfprobe({}, { ...none, which: (n) => (n === 'ffprobe' ? '/bin/ffprobe' : null) })).toBe('/bin/ffprobe')
  })
  it('throws mentioning ffprobe when nothing is found', () => {
    expect(() => resolveFfprobe({}, none)).toThrow(/ffprobe/)
  })
})
