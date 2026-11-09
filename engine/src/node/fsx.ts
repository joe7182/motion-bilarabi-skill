import { rename as fsRename, rm, writeFile } from 'node:fs/promises'

/**
 * File helpers for project writes. On Windows (and in synced folders such as OneDrive) replacing
 * a file can fail for a moment with EPERM/EBUSY/EACCES while a sync client, a virus scanner or a
 * preview holds it open; those renames are retried with a short backoff.
 */

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Waits between attempts, about 3 s in total over 10 tries. */
export const RENAME_DELAYS_MS = [30, 60, 100, 150, 250, 350, 450, 600, 700]

export interface RenameRetryOptions {
  /** Injected by tests. */
  rename?: (from: string, to: string) => Promise<void>
  /** Injected by tests (no real waiting). */
  sleep?: (ms: number) => Promise<void>
  delays?: readonly number[]
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const codeOf = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code ?? ''

/** The Arabic-first error for a file that could not be saved. */
export function couldNotWrite(path: string, e: unknown): Error {
  const code = codeOf(e)
  return new Error(
    `تعذّر حفظ الملف — Could not write ${path} (in use by another program?)` +
      `: ${code || (e as Error)?.message || String(e)}`,
  )
}

/**
 * Renames `from` over `to`, retrying EPERM/EBUSY/EACCES (RENAME_DELAYS_MS). Any final failure is
 * thrown Arabic first; `from` is left in place.
 */
export async function renameWithRetry(from: string, to: string, o: RenameRetryOptions = {}): Promise<void> {
  const rename = o.rename ?? fsRename
  const sleep = o.sleep ?? defaultSleep
  const delays = o.delays ?? RENAME_DELAYS_MS
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (e) {
      if (!RETRYABLE.has(codeOf(e)) || attempt >= delays.length) throw couldNotWrite(to, e)
      await sleep(delays[attempt]!)
    }
  }
}

/** Writes `text` to `<path>.<pid>.tmp`, then renames it over `path` (with retry). */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`
  try {
    await writeFile(tmp, text)
  } catch (e) {
    throw couldNotWrite(path, e)
  }
  try {
    await renameWithRetry(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

/** Pattern of the temp files `writeFileAtomic` leaves behind when a process dies mid-write. */
export const isAtomicTemp = (name: string, base: string) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+\\.tmp$`).test(name)

/** Runs a file-system step; errors are rethrown Arabic first with `what` and the path. */
export async function fsStep<T>(ar: string, en: string, path: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    throw new Error(`${ar} — ${en} ${path}: ${codeOf(e) || (e as Error)?.message || String(e)}`)
  }
}

/** Codes a removal is retried on (a sync client, scanner or viewer holding a file for a moment). */
const RM_RETRYABLE = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'])

export interface RmRetryOptions {
  /** Injected by tests. */
  rm?: (path: string, o: { recursive: true; force: true }) => Promise<void>
  /** Injected by tests (no real waiting). */
  sleep?: (ms: number) => Promise<void>
  delays?: readonly number[]
}

/**
 * Removes `path` (recursive, force: a missing path is fine), retrying EBUSY/EPERM/ENOTEMPTY/EACCES
 * like `renameWithRetry`. A final failure is thrown Arabic first with the path and the code.
 */
export async function rmWithRetry(path: string, o: RmRetryOptions = {}): Promise<void> {
  const remove = o.rm ?? ((p: string, x: { recursive: true; force: true }) => rm(p, x))
  const sleep = o.sleep ?? defaultSleep
  const delays = o.delays ?? RENAME_DELAYS_MS
  for (let attempt = 0; ; attempt++) {
    try {
      await remove(path, { recursive: true, force: true })
      return
    } catch (e) {
      if (!RM_RETRYABLE.has(codeOf(e)) || attempt >= delays.length) {
        throw new Error(`تعذّر حذف الملف — Could not remove ${path} (in use by another program?): ${codeOf(e) || (e as Error)?.message || String(e)}`)
      }
      await sleep(delays[attempt]!)
    }
  }
}
