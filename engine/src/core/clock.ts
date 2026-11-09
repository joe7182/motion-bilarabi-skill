export function frameCount(durationSec: number, fps: number): number {
  return Math.round(durationSec * fps)
}

export function frameToTime(frame: number, fps: number): number {
  return frame / fps
}
