import type { AuditIssue, AuditStats } from './audit'

/** The page API the renderer and tests drive (`window.__mba`). */
export interface MbaApi {
  /** Always resolves (never rejects): check `error` afterwards. */
  ready: Promise<void>
  /**
   * Sets the frame to time `t` seconds; resolves when the frame is fully drawn (async scene
   * updates included). Seeks are serialized by the stage, latest wins: always await it before a
   * screenshot. Rejects if the stage is not ready or failed, or for a non-finite `t`.
   * A superseded seek's promise resolves after the newest time has been painted, not its own; a
   * caller needing a specific frame must await its own seek before issuing another.
   */
  seek(t: number): Promise<void>
  /**
   * Audits the text of the CURRENT frame (as drawn by the last settled seek; await it first) and
   * returns every issue found, `[]` when clean. See `auditText` in audit.ts for the rules.
   * Available in render mode and preview alike. Throws if the stage is not ready or failed.
   */
  audit(): AuditIssue[]
  /** Diagnostic: `audit()` plus how many text nodes the geometric rules measured (tests). */
  auditStats(): AuditStats
  /** Storyboard duration in seconds (0 until ready). */
  duration: number
  /** Set when parsing or stage creation failed, e.g. `scenes[0].params.text: Invalid input...`. */
  error?: string
}

declare global {
  interface Window {
    __mba: MbaApi
    /** Storyboard JSON injected by the renderer before the page loads. */
    __MBA_STORYBOARD__?: unknown
    /**
     * Test-only primitives, read only when the page URL has `?test=1` (ignored otherwise):
     * an array of `{ id, params?, build }` registered before the stage is created. Ids must start
     * with `_`. See `registerTestPrimitives` in main.ts.
     */
    __MBA_TEST_PRIMITIVES__?: unknown
  }
}
