import { z } from 'zod'

export interface Brand {
  name: string
  handle: string
  colors: { primary: string; secondary: string; bg: string; text: string }
  logo?: string
  watermark: boolean
  /** The creator's photo (profile card, signature card): a file path or data URL. */
  avatar?: string
  /** Where people find the creator (the end card, the comment DM). */
  links?: { instagram?: string; youtube?: string; tiktok?: string; site?: string }
  /** The comment keyword a CTA uses when the preset names none. */
  keyword?: string
  /** The name in Latin letters (signature card), and the tagline under it (`taglineAccent` in the accent colour). */
  nameEn?: string
  tagline?: string
  taglineAccent?: string
}

/** Validation error carrying a field path such as `colors.primary`. */
export class BrandError extends Error {
  path: string
  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message)
    this.name = 'BrandError'
    this.path = path
  }
}

export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = ''
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else out += out ? `.${String(seg)}` : String(seg)
  }
  return out
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour')

export const brandSchema = z.object({
  name: z.string().min(1),
  handle: z.string().min(1),
  colors: z.object({ primary: hex, secondary: hex, bg: hex, text: hex }),
  logo: z.string().min(1).optional(),
  watermark: z.boolean().default(false),
  avatar: z.string().min(1).optional(),
  links: z
    .object({ instagram: z.string().min(1).optional(), youtube: z.string().min(1).optional(), tiktok: z.string().min(1).optional(), site: z.string().min(1).optional() })
    .optional(),
  keyword: z.string().trim().min(1).max(20).optional(),
  nameEn: z.string().trim().min(1).max(30).optional(),
  tagline: z.string().trim().min(1).max(30).optional(),
  taglineAccent: z.string().trim().min(1).max(20).optional(),
})

export function parseBrand(json: unknown): Brand {
  const r = brandSchema.safeParse(json)
  if (!r.success) {
    const issue = r.error.issues[0]!
    throw new BrandError(formatPath(issue.path), issue.message)
  }
  return r.data as Brand
}
