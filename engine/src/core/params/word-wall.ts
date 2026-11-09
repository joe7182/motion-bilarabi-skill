import { z } from 'zod'
import { oneLine, morphKey } from './common'

/** Params of `word-wall`: a grid of copies of one word, rows drifting in alternating directions. */
export const wordWallParams = z
  .object({
    text: oneLine(24),
    rows: z.number().int().min(3).max(9).default(6),
    cols: z.number().int().min(1).max(4).default(2),
    /** Index (row-major) of the one copy in the accent colour, at full opacity; it does not move. */
    highlight: z.number().int().min(0).optional(),
    /** Row speed in px/s at a 1080 px wide frame (scaled with the frame width). */
    speed: z.number().min(0).max(60).default(18),
    /**
     * Opacity of the copies (the highlighted one is at 1). At most 0.45: the wall copies are texture
     * below AUDIT.minOpacity (0.5), so the grid mask never produces an audit issue (the audit ignores
     * overflow clipping); the `highlight` copy is the readable one and stays inside the safe area.
     */
    alpha: z.number().min(0.08).max(0.45).default(0.14),
    key: morphKey,
  })
  .refine((p) => p.highlight === undefined || p.highlight < p.rows * p.cols, {
    path: ['highlight'],
    message: 'highlight must be a copy of the grid (0..rows × cols − 1)',
  })

export type WordWallParams = z.infer<typeof wordWallParams>
