import gsap from 'gsap'
import { bidiWordUnits, fitText, lineUnit } from '../text/units'
import { FONT_WEIGHT } from '../looks'
import type { Primitive } from './registry'
import { slamParams, SLAM_TIMING, type SlamParams } from '../../core/params/slam'

/** Timing constants (seconds) for `slam`. Scenes shorter than INTRO + EXIT are compressed. */
export const SLAM = {
  /** Every word has landed by this time; the camera shake starts here. */
  intro: SLAM_TIMING.intro,
  /** Delay between consecutive words. */
  stagger: 0.06,
  /** Shortest word tween; long headlines shrink the stagger instead of going below it. */
  minWord: 0.3,
  fromScale: 2.2,
  fromBlur: 8,
  shake: 0.2,
  /** Peak camera offset in px, decaying linearly to 0 over the shake. */
  shakeAmp: 7,
  shakeSteps: 6,
  tag: 0.4,
  exit: SLAM_TIMING.exit,
  exitScale: 0.9,
  maxPx: 160,
  minPx: 56,
  tagPx: 44,
} as const

/**
 * Precomputed camera shake: keyframe offsets at evenly spaced times over the shake, starting and
 * ending at 0, amplitude decaying linearly from `amp`. Drawn from `rng` at build time only.
 */
export function shakeKeys(rng: () => number, steps: number, amp: number): { x: number; y: number }[] {
  const keys = [{ x: 0, y: 0 }]
  for (let k = 1; k < steps; k++) {
    const a = amp * (1 - (k - 1) / (steps - 1))
    const sx = k % 2 === 1 ? -1 : 1 // alternate direction so it reads as a shake, not a drift
    keys.push({ x: sx * a * (0.6 + 0.4 * rng()), y: (rng() * 2 - 1) * a })
  }
  keys.push({ x: 0, y: 0 })
  return keys
}

/** Pure: camera offset at `t` seconds into the shake (0 outside it). */
export function shakeAt(keys: { x: number; y: number }[], dur: number, t: number): { x: number; y: number } {
  if (!(t > 0 && t < dur)) return { x: 0, y: 0 }
  const f = (t / dur) * (keys.length - 1)
  const i = Math.floor(f)
  const u = f - i
  const a = keys[i]!
  const b = keys[i + 1]!
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
}

/**
 * Headline slam: words punch in from scale 2.2 / blurred / transparent, staggered, landing by
 * 0.55 s where a short decaying camera shake hits; holds; then shrinks and fades out in the last
 * 0.25 s. Optional `tag` pill above, optional `accent` word in the look's accent colour.
 */
export const slam: Primitive<SlamParams> = {
  id: 'slam',
  params: slamParams,
  build(ctx, p) {
    // Whole-pixel fit box: a fractional safe width (e.g. 885.6) would never fit an integer offsetWidth.
    const fitW = Math.floor(ctx.safe.w)
    const fitH = Math.floor(ctx.safe.h)
    // camera (shake, via update) > content (exit tween) > tag + headline (intro tweens)
    const camera = document.createElement('div')
    camera.dataset.mbaPart = 'camera'
    Object.assign(camera.style, {
      position: 'absolute',
      left: `${ctx.safe.x}px`,
      top: `${ctx.safe.y}px`,
      width: `${ctx.safe.w}px`,
      height: `${ctx.safe.h}px`,
    })
    const content = document.createElement('div')
    Object.assign(content.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
    })
    camera.append(content)
    ctx.layer.append(camera)

    let tagEl: HTMLElement | undefined
    let tagSpace = 0
    if (p.tag) {
      tagEl = document.createElement('div')
      tagEl.dataset.mbaPart = 'tag'
      Object.assign(tagEl.style, {
        fontFamily: ctx.look.fontBody,
        fontWeight: String(FONT_WEIGHT.bodyBold),
        fontSize: `${SLAM.tagPx}px`,
        lineHeight: '1.3',
        background: ctx.look.vars.fg,
        color: ctx.look.vars.bg,
        padding: '0.2em 0.9em',
        borderRadius: '999px',
        marginBottom: `${Math.round(SLAM.tagPx * 0.6)}px`,
      })
      lineUnit(tagEl, p.tag)
      content.append(tagEl)
      // A tag too wide for the safe area shrinks (it never wraps: it is one line unit).
      if (tagEl.offsetWidth > fitW) fitText(tagEl, { w: fitW, h: SLAM.tagPx * 2 }, SLAM.tagPx, 24)
      tagSpace = tagEl.offsetHeight + Math.round(SLAM.tagPx * 0.6)
    }

    const headline = document.createElement('div')
    headline.dataset.mbaPart = 'headline'
    Object.assign(headline.style, {
      width: `${fitW}px`,
      fontFamily: ctx.look.fontDisplay,
      fontWeight: String(FONT_WEIGHT.display),
      lineHeight: '1.3',
      color: ctx.look.vars.fg,
      textAlign: 'center',
    })
    content.append(headline)
    const words = bidiWordUnits(headline, p.text)
    for (const w of words) {
      if (p.accent !== undefined && w.textContent === p.accent) w.style.color = ctx.look.vars.accent
    }
    // Text that cannot fit even at minPx still renders at minPx (fitText returns minPx).
    let px = fitText(headline, { w: fitW, h: fitH - tagSpace }, SLAM.maxPx, SLAM.minPx)
    // fitText fits the line boxes (line-height 1.3), but the glyph boxes (the font's content area,
    // about 1.87 em for Cairo) of the first and last lines hang out of them. When the headline is
    // height-limited, that overhang crossed the safe area (caught by the text audit on slam-long),
    // so shrink until the glyph boxes fit too. Measured before any tween sets a transform.
    const glyphH = () => {
      const r = document.createRange()
      r.selectNodeContents(headline)
      return r.getBoundingClientRect().height
    }
    while (px > SLAM.minPx && glyphH() > fitH - tagSpace) {
      px -= 1
      headline.style.fontSize = `${px}px`
    }

    // Compress every phase proportionally when the scene is shorter than intro + exit.
    const k = Math.min(1, ctx.duration / (SLAM.intro + SLAM.exit))
    const intro = SLAM.intro * k
    const n = words.length
    let stagger = SLAM.stagger * k
    let wordDur = intro - stagger * (n - 1)
    if (wordDur < SLAM.minWord * k) {
      wordDur = SLAM.minWord * k
      stagger = n > 1 ? (intro - wordDur) / (n - 1) : 0
    }
    const exitDur = SLAM.exit * k
    const exitAt = ctx.duration - exitDur
    const shakeDur = SLAM.shake * k
    const keys = shakeKeys(ctx.rng, SLAM.shakeSteps, SLAM.shakeAmp)

    const tl = gsap.timeline({ paused: true })
    tl.fromTo(
      words,
      { scale: SLAM.fromScale, transformOrigin: '50% 55%' },
      { scale: 1, duration: wordDur, ease: 'back.out(1.6)', stagger },
      0,
    )
    tl.fromTo(
      words,
      { opacity: 0, filter: `blur(${SLAM.fromBlur}px)` },
      { opacity: 1, filter: 'blur(0px)', duration: wordDur, ease: 'power2.out', stagger },
      0,
    )
    if (tagEl) {
      tl.fromTo(tagEl, { opacity: 0, y: -16 }, { opacity: 1, y: 0, duration: SLAM.tag * k, ease: 'power3.out' }, 0)
    }
    // immediateRender: the exit's start values are written at build time, so before `exitAt` the
    // DOM is the same whether or not a seek has ever passed the exit (cold == warm, `mba verify`).
    // `content` is targeted by no other tween.
    tl.fromTo(
      content,
      { scale: 1, opacity: 1 },
      { scale: SLAM.exitScale, opacity: 0, duration: exitDur, ease: 'power2.in', immediateRender: true },
      exitAt,
    )

    return {
      timeline: tl,
      update(localT) {
        const o = shakeAt(keys, shakeDur, localT - intro)
        camera.style.transform = o.x === 0 && o.y === 0 ? '' : `translate(${o.x.toFixed(2)}px, ${o.y.toFixed(2)}px)`
      },
    }
  },
}
