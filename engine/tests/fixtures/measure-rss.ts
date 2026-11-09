/**
 * Test helper (long.spec.ts): runs `review` or `verify` in THIS process and prints one JSON line with
 * its wall time and peak RSS, so the spec measures the tool's own Node process, not the test runner.
 *   node --import tsx tests/fixtures/measure-rss.ts review <storyboard.json> <outDir>
 *   node --import tsx tests/fixtures/measure-rss.ts verify <storyboard.json>
 * Peak RSS: `process.resourceUsage().maxRSS` (the OS peak) and a 25 ms `memoryUsage().rss` sample.
 * Chromium and ffmpeg run in their own processes and are not counted.
 */
import { buildReviewKit } from '../../src/node/review'
import { verifyDeterminism } from '../../src/node/verify'

const [cmd, sb, out] = process.argv.slice(2)
let sampled = 0
const sample = () => {
  sampled = Math.max(sampled, process.memoryUsage().rss)
}
const timer = setInterval(sample, 25)
const t0 = performance.now()
let result: unknown
if (cmd === 'review') {
  const m = await buildReviewKit({ storyboardPath: sb!, outDir: out! })
  result = { sheets: m.sheets, duration: m.duration, auditSamples: m.audit?.length ?? null, notes: m.notes }
} else if (cmd === 'verify') {
  const r = await verifyDeterminism({ storyboardPath: sb! })
  result = { probes: r.probes.length, mismatches: r.mismatches, pageErrors: r.pageErrors, frames: r.frames, wallSec: r.wallSec }
} else {
  throw new Error(`unknown command ${cmd}`)
}
clearInterval(timer)
sample()
const wallSec = (performance.now() - t0) / 1000
process.stdout.write(JSON.stringify({ wallSec, sampledPeakRss: sampled, maxRss: process.resourceUsage().maxRSS * 1024, result }) + '\n')
