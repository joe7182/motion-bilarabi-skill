import { z } from 'zod'
import type { Cue } from '../audio-plan'
import { oneLineAr } from './common'

/**
 * Developer-tool explainers.
 * - permission-prompt: Claude Code's terminal approval box for a command; the selector moves to an
 *   option and it is chosen at `pickAt` (option 1 = «Yes, and don't ask again»).
 * - code-file: an editor pane (file tab, line numbers); lines type in at their times and can be
 *   marked `add` (green), `secret` (red glow + a tag) or `ok` (a check).
 */

const at = z.number().min(0)

export const permissionPromptParams = z.object({
  /** The command Claude wants to run (Latin, shown as typed). */
  command: z.string().min(1).max(70),
  /** The option chosen: 0 Yes · 1 Yes, and don't ask again · 2 No. */
  option: z.number().int().min(0).max(2).default(1),
  /** Local s the selector starts moving, and the moment the option is chosen. */
  moveAt: at.default(0.6),
  pickAt: at.default(1.4),
  /** An Arabic note pinned to the chosen option. */
  note: oneLineAr(28, 'note').optional(),
  /** Box top, fraction of the safe height. */
  top: z.number().min(0).max(0.6).default(0.2),
})
export type PermissionPromptParams = z.infer<typeof permissionPromptParams>

export const codeFileParams = z.object({
  /** The file tab (Latin path). */
  file: z.string().min(1).max(48),
  lines: z
    .array(z.object({ text: z.string().max(64), at, mark: z.enum(['add', 'secret', 'ok']).optional(), tag: oneLineAr(20, 'lines[].tag').optional() }))
    .min(1)
    .max(14),
  /** Pane top and height, fractions of the safe height. */
  top: z.number().min(0).max(0.7).default(0.18),
  height: z.number().min(0.2).max(0.8).default(0.5),
  /** Font px at 1080 wide. */
  size: z.number().min(20).max(48).default(30),
})
export type CodeFileParams = z.infer<typeof codeFileParams>

export const cuesOfPermissionPrompt = (p: PermissionPromptParams): Cue[] => [{ t: p.pickAt, kind: 'action' }]
export const cuesOfCodeFile = (p: CodeFileParams): Cue[] => p.lines.filter((l) => l.mark === 'secret').map((l) => ({ t: l.at, kind: 'hit' as const }))
