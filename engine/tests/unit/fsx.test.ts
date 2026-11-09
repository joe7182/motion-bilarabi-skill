import { describe, it, expect } from 'vitest'
import { isAtomicTemp, renameWithRetry, rmWithRetry, RENAME_DELAYS_MS } from '../../src/node/fsx'

const errno = (code: string) => Object.assign(new Error(`${code}: operation not permitted`), { code })

describe('renameWithRetry', () => {
  it('retries EPERM/EBUSY and succeeds', async () => {
    const calls: string[] = []
    const waits: number[] = []
    let n = 0
    await renameWithRetry('a.part', 'a.mp4', {
      rename: async (f, t) => {
        calls.push(`${f}>${t}`)
        if (n++ < 2) throw errno(n === 1 ? 'EPERM' : 'EBUSY')
      },
      sleep: async (ms) => void waits.push(ms),
    })
    expect(calls).toHaveLength(3)
    expect(waits).toEqual(RENAME_DELAYS_MS.slice(0, 2))
  })
  it('gives up after about 3 s with an Arabic-first message naming the file', async () => {
    let n = 0
    const waits: number[] = []
    const err = await renameWithRetry('x.tmp', 'C:/مشروع 100%/work/m1.mp4', {
      rename: async () => {
        n++
        throw errno('EACCES')
      },
      sleep: async (ms) => void waits.push(ms),
    }).then(() => null, (e: Error) => e)
    expect(n).toBe(RENAME_DELAYS_MS.length + 1)
    expect(n).toBeGreaterThanOrEqual(10)
    const total = waits.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(2500)
    expect(total).toBeLessThanOrEqual(3500)
    expect(err?.message).toMatch(/^تعذّر حفظ الملف — Could not write C:\/مشروع 100%\/work\/m1\.mp4 \(in use by another program\?\): EACCES$/)
  })
  it('does not retry other errors', async () => {
    let n = 0
    await expect(
      renameWithRetry('a', 'b', { rename: async () => void (n++, (() => { throw errno('ENOENT') })()), sleep: async () => {} }),
    ).rejects.toThrow(/^[؀-ۿ].*ENOENT/)
    expect(n).toBe(1)
  })
})

describe('isAtomicTemp', () => {
  it('matches only <base>.<pid>.tmp', () => {
    expect(isAtomicTemp('media.json.1234.tmp', 'media.json')).toBe(true)
    expect(isAtomicTemp('media.json.tmp', 'media.json')).toBe(false)
    expect(isAtomicTemp('mediaXjson.12.tmp', 'media.json')).toBe(false)
    expect(isAtomicTemp('m1.mp4.part', 'media.json')).toBe(false)
  })
})

describe('rmWithRetry (final review: rm in synced / scanned folders)', () => {
  it('retries EBUSY / EPERM / ENOTEMPTY / EACCES and succeeds, passing recursive + force', async () => {
    const seen: string[] = []
    const opts: unknown[] = []
    let n = 0
    await rmWithRetry('C:/t/frames', {
      rm: async (p, o) => {
        seen.push(p)
        opts.push(o)
        const codes = ['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']
        if (n < codes.length) throw errno(codes[n++]!)
      },
      sleep: async () => {},
    })
    expect(seen).toHaveLength(5)
    expect(opts[0]).toEqual({ recursive: true, force: true })
  })
  it('gives up Arabic first naming the path and the code', async () => {
    let n = 0
    const err = await rmWithRetry('C:/مشروع 100%/x', { rm: async () => void (n++, (() => { throw errno('EBUSY') })()), sleep: async () => {} }).then(
      () => null,
      (e: Error) => e,
    )
    expect(n).toBe(RENAME_DELAYS_MS.length + 1)
    expect(err?.message).toMatch(/^تعذّر حذف الملف — Could not remove C:\/مشروع 100%\/x \(in use by another program\?\): EBUSY$/)
  })
  it('does not retry other errors; a missing path is fine (force)', async () => {
    let n = 0
    await expect(rmWithRetry('a', { rm: async () => void (n++, (() => { throw errno('EINVAL') })()), sleep: async () => {} })).rejects.toThrow(/^[؀-ۿ].*EINVAL/)
    expect(n).toBe(1)
    await rmWithRetry('C:/does/not/exist/at/all-mba-test')
  })
})
