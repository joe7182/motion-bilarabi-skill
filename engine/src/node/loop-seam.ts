import { spawnSync } from 'node:child_process'
import { SEAM_OK_DB } from '../core/loop'

/** Compares a video's first frame with its very last one (PSNR in dB; Infinity when identical). The tail is read backwards. */
export function loopSeam(mp4: string): { db: number; ok: boolean } {
  const graph = '[0:v]trim=end_frame=1,setpts=PTS-STARTPTS[a];[1:v]reverse,trim=end_frame=1,setpts=PTS-STARTPTS[b];[a][b]psnr'
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', mp4, '-sseof', '-0.25', '-i', mp4, '-lavfi', graph, '-f', 'null', '-'], { encoding: 'utf8' })
  const m = /average:(inf|[\d.]+)/.exec(r.stderr ?? '')
  if (!m) throw new Error(`ما قدرت أقيس نقطة اللف — could not measure the loop seam of ${mp4}: ${(r.stderr ?? '').slice(-300)}`)
  const db = m[1] === 'inf' ? Infinity : Number(m[1])
  return { db, ok: db >= SEAM_OK_DB }
}
