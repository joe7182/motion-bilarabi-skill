// Preview-only audio. Render audio is mixed by ffmpeg (node/audio.ts); the page never plays sound
// in render mode and this module is not even loaded there (main.ts imports it on demand). Here,
// like controls.ts, wall-clock playback is allowed: one <audio> element per clip follows the
// preview playhead and is re-synced when it drifts.

/** One clip as the preview plays it (built by the preview server from the storyboard's `audio[]`). */
export interface PreviewClip {
  id: string
  /** URL of the clip's media (served by the preview server). */
  src: string
  /** Timeline start (s). */
  at: number
  /** Source offset (s). */
  in: number
  /** Timeline length (s). */
  duration: number
  /** dB. */
  gain: number
  fadeIn: number
  fadeOut: number
}

export interface Playhead {
  t(): number
  playing(): boolean
}

/** An element is re-seeked when its time differs from the playhead's by more than this (s). */
export const RESYNC_SEC = 0.08

/** Where a clip should be at timeline time `t`: playing or not, its source time and volume (0..1). */
export function clipState(c: PreviewClip, t: number, playing: boolean): { active: boolean; pos: number; volume: number } {
  const local = t - c.at
  const active = playing && local >= 0 && local < c.duration
  const fadeIn = c.fadeIn > 0 ? Math.min(1, local / c.fadeIn) : 1
  const fadeOut = c.fadeOut > 0 ? Math.min(1, (c.duration - local) / c.fadeOut) : 1
  const volume = Math.min(1, Math.max(0, 10 ** (c.gain / 20) * Math.min(fadeIn, fadeOut)))
  return { active, pos: c.in + Math.max(0, local), volume }
}

/**
 * Plays `clips` along the preview playhead: one `<audio>` per clip, started and stopped as the
 * playhead enters and leaves it, re-seeked when it drifts more than RESYNC_SEC. Returns `detach`.
 */
export function attachPreviewAudio(clips: readonly PreviewClip[], playhead: Playhead): () => void {
  const els = clips.map((c) => {
    const el = document.createElement('audio')
    el.preload = 'auto'
    el.src = c.src
    return el
  })
  let raf = 0
  const tick = () => {
    const t = playhead.t()
    const playing = playhead.playing()
    clips.forEach((c, k) => {
      const el = els[k]!
      const s = clipState(c, t, playing)
      el.volume = s.volume
      if (!s.active) {
        if (!el.paused) el.pause()
        return
      }
      if (el.paused || Math.abs(el.currentTime - s.pos) > RESYNC_SEC) el.currentTime = s.pos
      if (el.paused) el.play().catch(() => {}) // autoplay may wait for the first user gesture
    })
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(raf)
    for (const el of els) {
      el.pause()
      el.removeAttribute('src')
    }
  }
}

/** Fetches the preview server's clip list (`/__audio.json`) and attaches it; no list, no sound. */
export async function loadPreviewAudio(playhead: Playhead): Promise<void> {
  const res = await fetch('/__audio.json').catch(() => null)
  if (!res?.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return
  const clips = (await res.json()) as PreviewClip[]
  if (Array.isArray(clips) && clips.length) attachPreviewAudio(clips, playhead)
}
