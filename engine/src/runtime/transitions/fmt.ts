/** Compact CSS number: at most 3 decimals, no trailing zeros, never "-0". */
export function n(x: number): string {
  const v = Number(x.toFixed(3))
  return String(v === 0 ? 0 : v)
}
