/**
 * Closed-form spring motion: a pure function of time, so a spring frame depends only on `t`
 * (no integration state, no seek history).
 *
 * A spring is `{ response, damping }`: `response` is the undamped period in seconds
 * (ω = 2π / response) and `damping` the damping ratio ζ (1 = critical, < 1 overshoots).
 */
export interface Spring {
  response: number
  damping: number
}

export type SpringName = 'snappy' | 'default' | 'heavy' | 'playful'

/** The named springs (Motion Bil-Arabi's own values). */
export const SPRINGS: Record<SpringName, Spring> = {
  snappy: { response: 0.24, damping: 0.82 },
  default: { response: 0.42, damping: 0.88 },
  heavy: { response: 0.56, damping: 1 },
  playful: { response: 0.52, damping: 0.5 },
}

function resolveSpring(s: SpringName | Spring): Spring {
  const sp = typeof s === 'string' ? SPRINGS[s] : s
  if (!sp) throw new Error(`unknown spring "${String(s)}"`)
  if (!(sp.response > 0) || !Number.isFinite(sp.response)) throw new Error(`spring response must be > 0, got ${sp.response}`)
  if (!(sp.damping > 0) || !Number.isFinite(sp.damping)) throw new Error(`spring damping must be > 0, got ${sp.damping}`)
  return sp
}

/** |ζ − 1| below this uses the critical form (the other two forms divide by ~0 near ζ = 1). */
const CRITICAL_EPS = 1e-9

/**
 * Unit step response of the spring at `tau` seconds after the step: 0 for τ ≤ 0, tends to 1.
 * - ζ < 1: 1 − e^(−ζωτ) (cos ω_d τ + ζ/√(1−ζ²) · sin ω_d τ), ω_d = ω √(1−ζ²)
 * - ζ = 1: 1 − (1 + ωτ) e^(−ωτ)
 * - ζ > 1: 1 + (r₂ e^(r₁τ) − r₁ e^(r₂τ)) / (r₁ − r₂), r₁,₂ = −ω (ζ ∓ √(ζ²−1))
 */
export function springStep(tau: number, s: SpringName | Spring): number {
  const { response, damping: z } = resolveSpring(s)
  if (!(tau > 0)) return 0
  if (tau === Infinity) return 1
  const w = (2 * Math.PI) / response
  if (Math.abs(z - 1) < CRITICAL_EPS) return 1 - (1 + w * tau) * Math.exp(-w * tau)
  if (z < 1) {
    const root = Math.sqrt(1 - z * z)
    const wd = w * root
    return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + (z / root) * Math.sin(wd * tau))
  }
  const root = Math.sqrt(z * z - 1)
  const r1 = -w * (z - root)
  const r2 = -w * (z + root)
  return 1 + (r2 * Math.exp(r1 * tau) - r1 * Math.exp(r2 * tau)) / (r1 - r2)
}

/** One key of a spring track: at `time` the target becomes `value`, approached with spring `s`. */
export type SpringKey = readonly [time: number, value: number, s?: SpringName]

/**
 * A value driven by keyed spring steps:
 * `keys[0][1] + Σ_{k≥1} (v_k − v_{k−1}) · springStep(t − t_k, s_k ?? 'default')`.
 * The first key is the resting value; its time and spring are not used.
 */
export function springTrack(t: number, keys: ReadonlyArray<SpringKey>): number {
  if (keys.length === 0) throw new Error('springTrack: at least one key is required')
  let v = keys[0]![1]
  for (let k = 1; k < keys.length; k++) {
    const [tk, vk, sk] = keys[k]!
    v += (vk - keys[k - 1]![1]) * springStep(t - tk, sk ?? 'default')
  }
  return v
}

const LEAD_LEVEL = 0.6
const LEAD_TOL = 1e-4

/**
 * The τ at which `springStep` first reaches 0.6 (bisection to 1e-4 s). Start a spring this much
 * before a beat so the hit reads on the beat.
 */
export function springLead(s: SpringName | Spring): number {
  const sp = resolveSpring(s)
  const w = (2 * Math.PI) / sp.response
  // Bracket the first crossing where the step is still rising: up to the first peak (ζ < 1),
  // otherwise (monotone) grow the bracket until the level is reached.
  let hi: number
  if (sp.damping < 1 - CRITICAL_EPS) {
    hi = Math.PI / (w * Math.sqrt(1 - sp.damping * sp.damping))
  } else {
    hi = sp.response
    while (springStep(hi, sp) < LEAD_LEVEL) hi *= 2
  }
  let lo = 0
  while (hi - lo > LEAD_TOL) {
    const mid = (lo + hi) / 2
    if (springStep(mid, sp) < LEAD_LEVEL) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
