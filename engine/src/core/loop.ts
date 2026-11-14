/**
 * Seamless loops (`"loop": true`): the reel's last frame leads straight back into its first. Things
 * that move on their own clock (the `hue-field` drift) snap their periods so they are back at the
 * start when the video ends; after a render the seam is measured (first frame vs last frame).
 */

/**
 * A sway period `p` (s) stretched or shrunk so a whole number of sways fits the loop of `total`
 * seconds (one sway = 2p). Never fewer than one sway.
 */
export function loopPeriod(p: number, total: number): number {
  if (!(total > 0) || !(p > 0)) return p
  const n = Math.max(1, Math.round(total / (2 * p)))
  return total / (2 * n)
}

/** PSNR (dB) at or above which the seam reads as one continuous picture. */
export const SEAM_OK_DB = 35
