// Preview-only UI. This is the one place in src/runtime where wall-clock APIs (rAF,
// performance.now) are allowed: playback maps wall-clock -> t -> stage.seek(t). Everything the
// stage draws is still a pure function of t, so preview and export stay frame-identical.
import type { Stage } from '../stage'

export interface PreviewOptions {
  stage: Stage
  /** The #frame element (already sized by the stage). Moved into a scaling wrapper. */
  frame: HTMLElement
  size: { w: number; h: number }
  fps: number
  /** Start time in seconds (from `?t=`). */
  startT: number
}

const BAR_H = 56

export function startTimeFromUrl(search: string): number {
  const raw = new URLSearchParams(search).get('t')
  if (raw === null || raw.trim() === '') return 0
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Mounts the preview controls; returns the playhead (time and play state) for preview audio. */
export function mountPreview(o: PreviewOptions): { t(): number; playing(): boolean } {
  const { stage, frame, size, fps } = o
  const duration = stage.duration
  const clamp = (t: number) => Math.min(Math.max(t, 0), duration)

  // Fit-to-window wrapper: the scale lives on the wrapper, never on #frame's own size.
  const fit = document.createElement('div')
  fit.id = 'mba-fit'
  Object.assign(fit.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${size.w}px`,
    height: `${size.h}px`,
    transformOrigin: '0 0',
  })
  frame.parentElement?.insertBefore(fit, frame)
  fit.appendChild(frame)
  document.body.style.background = '#050505'

  const bar = document.createElement('div')
  bar.id = 'mba-controls'
  bar.dir = 'ltr'
  Object.assign(bar.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: '0',
    height: `${BAR_H}px`,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '0 16px',
    boxSizing: 'border-box',
    background: '#141414',
    color: '#eee',
    font: '14px system-ui, sans-serif',
  })
  const playBtn = document.createElement('button')
  playBtn.id = 'mba-play'
  Object.assign(playBtn.style, { width: '72px', height: '32px', cursor: 'pointer' })
  const scrub = document.createElement('input')
  scrub.id = 'mba-scrub'
  scrub.type = 'range'
  scrub.min = '0'
  scrub.max = String(duration)
  scrub.step = 'any'
  scrub.value = '0'
  Object.assign(scrub.style, { flex: '1' })
  const time = document.createElement('span')
  time.id = 'time'
  Object.assign(time.style, { fontVariantNumeric: 'tabular-nums', minWidth: '48px', textAlign: 'right' })
  const total = document.createElement('span')
  total.textContent = `/ ${duration.toFixed(2)}`
  total.style.opacity = '0.6'
  const hint = document.createElement('span')
  hint.textContent = 'space play | arrows 1s (shift 5s) | , . frame | h hide'
  Object.assign(hint.style, { opacity: '0.5', fontSize: '12px' })
  bar.append(playBtn, scrub, time, total, hint)
  document.body.appendChild(bar)

  let t = clamp(o.startT)
  let playing = false
  let wallStart = 0
  let tStart = 0
  let raf = 0

  const layout = () => {
    const barH = bar.style.display === 'none' ? 0 : BAR_H
    const availW = window.innerWidth
    const availH = Math.max(window.innerHeight - barH, 1)
    const scale = Math.min(availW / size.w, availH / size.h)
    const x = (availW - size.w * scale) / 2
    const y = (availH - size.h * scale) / 2
    fit.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }

  const render = () => {
    // Not awaited: the stage's latest-wins queue coalesces seeks that arrive while one is still
    // drawing, so a slow async frame never piles up a seek per animation frame.
    stage.seek(t).catch((e: unknown) => console.error('seek failed', e))
    time.textContent = t.toFixed(2)
    scrub.value = String(t)
    playBtn.textContent = playing ? 'Pause' : 'Play'
  }

  const tick = () => {
    if (!playing) return
    const next = tStart + (performance.now() - wallStart) / 1000
    if (next >= duration) {
      t = duration
      playing = false
    } else {
      t = next
    }
    render()
    if (playing) raf = requestAnimationFrame(tick)
  }

  const pause = () => {
    playing = false
    cancelAnimationFrame(raf)
    render()
  }
  const play = () => {
    if (t >= duration) t = 0
    playing = true
    tStart = t
    wallStart = performance.now()
    render()
    raf = requestAnimationFrame(tick)
  }
  const toggle = () => (playing ? pause() : play())
  const jump = (to: number) => {
    t = clamp(to)
    if (playing) {
      tStart = t
      wallStart = performance.now()
    }
    render()
  }
  const stepFrames = (n: number) => {
    if (playing) pause()
    // Snap to the frame grid so repeated steps land on exact frames (2.00 -> 2.03 at 30 fps).
    jump((Math.round(t * fps) + n) / fps)
  }

  playBtn.addEventListener('click', toggle)
  scrub.addEventListener('input', () => jump(Number(scrub.value)))
  window.addEventListener('resize', layout)
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    switch (e.key) {
      case ' ':
        e.preventDefault()
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        toggle()
        break
      case 'ArrowLeft':
        e.preventDefault()
        jump(t - (e.shiftKey ? 5 : 1))
        break
      case 'ArrowRight':
        e.preventDefault()
        jump(t + (e.shiftKey ? 5 : 1))
        break
      case ',':
        stepFrames(-1)
        break
      case '.':
        stepFrames(1)
        break
      case 'h':
      case 'H':
        bar.style.display = bar.style.display === 'none' ? 'flex' : 'none'
        layout()
        break
    }
  })

  layout()
  render()
  return { t: () => t, playing: () => playing }
}
