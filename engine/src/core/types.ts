export type Format = '9:16' | '16:9' | '1:1' | '4:5'

/** Every format, in schema order (the storyboard `format` enum is built from this). */
export const FORMATS = ['9:16', '16:9', '1:1', '4:5'] as const satisfies readonly Format[]

export const FORMAT_SIZE: Record<Format, { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
  '1:1': { w: 1080, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
}

/**
 * Fractions of the frame. 9:16 keeps the top clear of the Reels/TikTok header and the
 * bottom/right clear of the caption and action buttons.
 */
export const SAFE_AREA: Record<Format, { top: number; bottom: number; left: number; right: number }> = {
  '9:16': { top: 0.14, bottom: 0.22, left: 0.06, right: 0.12 },
  '16:9': { top: 0.06, bottom: 0.08, left: 0.05, right: 0.05 },
  '1:1': { top: 0.06, bottom: 0.08, left: 0.06, right: 0.06 },
  '4:5': { top: 0.06, bottom: 0.08, left: 0.06, right: 0.06 },
}

/** The safe area of `format` as a rectangle in frame pixels. */
export function safeRect(format: Format): { x: number; y: number; w: number; h: number } {
  const size = FORMAT_SIZE[format]
  const a = SAFE_AREA[format]
  return { x: size.w * a.left, y: size.h * a.top, w: size.w * (1 - a.left - a.right), h: size.h * (1 - a.top - a.bottom) }
}
