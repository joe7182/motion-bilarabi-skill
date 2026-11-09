import { z } from 'zod'

/** Params of the internal `_probe` test primitive. */
export const probeParams = z.object({ text: z.string() })

export type ProbeParams = z.infer<typeof probeParams>
