import { easeOutCubic, seg } from '../../core/ease'
import { springStep } from '../../core/springs'
import { DRIFT_MIN_FIT_SCALE, DRIFT_PER_SEC, driftCss, driftFitBox, translateDrift } from '../../core/params/drift'
import { PHONE_TIMING, phoneLineStart, phoneParams, type PhoneParams } from '../../core/params/phone'
import { FONT_WEIGHT } from '../looks'
import { bidiWordUnits } from '../text/units'
import { driftFit } from '../drift-fit'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

export const PHONE = {
  /** Height / width of the device. */
  aspect: 2.05,
  /** Share of the safe height the device may take. */
  maxH: 0.94,
  /** Corner radius, bezel, screen radius, notch size and screen top padding (× device width). */
  radius: 0.14,
  bezel: 0.035,
  screenRadius: 0.11,
  notchW: 0.3,
  notchH: 0.07,
  topPad: 0.15,
  /** Message font (× device width), floored at minPx (px at a 1080 px wide frame). */
  fontW: 0.062,
  minPx: 30,
  body: '#0b0b0c',
  screenBg: '#f4f1ec',
  /** A line rises by this much (× font px) as it fades in. */
  rise: 0.5,
} as const

/**
 * A phone: a rounded frame with a notch, tilted `tilt`°. The screen is a project image fitted
 * `cover` inside the screen clip, or message bubbles that enter whole (fade + rise) at their `at`
 * (each wraps as whole-word units, never split). The device pops in on the `playful` spring
 * (visible from frame 0) and keeps the shared slow drift (R16). Pure in `localT`.
 */
export const phone: Primitive<PhoneParams> = {
  id: 'phone',
  params: phoneParams,
  async build(ctx, p) {
    const k = ctx.size.w / 1080
    const move = translateDrift(ctx.rng, ctx.size.w)
    const c = safePointPx(ctx, p.at)
    const root = document.createElement('div')
    root.dataset.mbaPart = 'phone-root'
    Object.assign(root.style, { position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, transform: 'translate(-50%, -50%)' })
    const pop = document.createElement('div')
    pop.style.transformOrigin = '50% 60%'
    const device = document.createElement('div')
    device.dataset.mbaPart = 'phone'
    if (p.key) device.dataset.mbaKey = p.key
    Object.assign(device.style, {
      position: 'relative',
      background: PHONE.body,
      boxShadow: `0 0 0 ${Math.max(2, Math.round(3 * k))}px color-mix(in srgb, ${ctx.look.vars.fg} 22%, transparent)`,
      fontFamily: ctx.look.fontBody,
      fontWeight: String(FONT_WEIGHT.bodyBold),
      lineHeight: '1.4',
      color: '#ffffff',
      transform: `rotate(${p.tilt}deg)`,
    })
    const screen = document.createElement('div')
    screen.dataset.mbaPart = 'phone-screen'
    Object.assign(screen.style, { position: 'absolute', overflow: 'hidden', background: 'image' in p.screen ? '#000000' : PHONE.screenBg })
    const notch = document.createElement('div')
    Object.assign(notch.style, { position: 'absolute', left: '50%', transform: 'translateX(-50%)', background: PHONE.body, zIndex: '1' })
    device.append(screen, notch)
    pop.append(device)
    root.append(pop)
    ctx.layer.append(root)

    let img: HTMLImageElement | undefined
    const stack = document.createElement('div')
    const bubbles: HTMLElement[] = []
    if ('image' in p.screen) {
      img = document.createElement('img')
      img.alt = ''
      Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' })
      img.src = p.screen.image
      screen.append(img)
      try {
        await img.decode()
      } catch (e) {
        throw new Error(`تعذّر تحميل صورة شاشة الجوال — phone: the screen image could not be loaded (${p.screen.image.slice(0, 80)}; ${e instanceof Error ? e.message : String(e)})`)
      }
    } else {
      Object.assign(stack.style, { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.45em', padding: '0 0.6em' })
      stack.dir = 'rtl'
      for (const l of p.screen.lines) {
        const b = document.createElement('div')
        b.dataset.mbaPart = 'phone-line'
        Object.assign(b.style, { maxWidth: '85%', padding: '0.35em 0.7em', borderRadius: '0.9em', background: ctx.look.vars.accent, color: '#ffffff' })
        bidiWordUnits(b, l.text)
        stack.append(b)
        bubbles.push(b)
      }
      screen.append(stack)
    }

    /** Sizes the device to `fit`: width `size` of it, capped by the height. */
    const sizeTo = (fit: { w: number; h: number }) => {
      const w = Math.floor(Math.min(p.size * fit.w, (fit.h * PHONE.maxH) / PHONE.aspect))
      const h = Math.round(w * PHONE.aspect)
      const bz = Math.round(PHONE.bezel * w)
      Object.assign(device.style, { width: `${w}px`, height: `${h}px`, borderRadius: `${Math.round(PHONE.radius * w)}px` })
      Object.assign(screen.style, { left: `${bz}px`, top: `${bz}px`, right: `${bz}px`, bottom: `${bz}px`, borderRadius: `${Math.round(PHONE.screenRadius * w)}px` })
      Object.assign(notch.style, { top: `${bz}px`, width: `${Math.round(PHONE.notchW * w)}px`, height: `${Math.round(PHONE.notchH * w)}px`, borderRadius: `0 0 ${Math.round(PHONE.notchH * w * 0.6)}px ${Math.round(PHONE.notchH * w * 0.6)}px` })
      if (!img) {
        stack.style.paddingTop = `${Math.round(PHONE.topPad * w)}px`
        let px = Math.max(Math.round(PHONE.minPx * k), Math.round(PHONE.fontW * w))
        device.style.fontSize = `${px}px`
        // Shrink until every bubble fits the screen (floor: the readable minimum).
        while (px > Math.round(PHONE.minPx * k) && stack.offsetHeight > screen.clientHeight) {
          px -= 1
          device.style.fontSize = `${px}px`
        }
      }
    }
    sizeTo(ctx.safe)
    let fit = driftFit(ctx, root, [device], DRIFT_PER_SEC, move)
    if (fit < DRIFT_MIN_FIT_SCALE) {
      sizeTo(driftFitBox(ctx.safe, ctx.duration, DRIFT_PER_SEC, move))
      fit = driftFit(ctx, root, [device], DRIFT_PER_SEC, move)
    }
    const lines = 'lines' in p.screen ? p.screen.lines : []
    // Even at the readable minimum the bubbles overflow the screen: fail instead of clipping them.
    if (!img && stack.offsetHeight > screen.clientHeight + 1) {
      throw new Error(
        `رسائل الجوال لا تتسع للشاشة؛ قصّر الأسطر أو قلّل عددها أو كبّر الجوال — phone: the message lines do not fit the screen even at the minimum font size (${stack.offsetHeight} px > ${screen.clientHeight} px); shorten or drop lines, or raise size`,
      )
    }

    return {
      update(localT) {
        const t = Math.min(Math.max(localT, 0), ctx.duration)
        const s = PHONE_TIMING.popFrom + (1 - PHONE_TIMING.popFrom) * springStep(t, 'playful')
        pop.style.transform = `scale(${s.toFixed(4)})`
        root.style.transform = `translate(-50%, -50%) ${driftCss(t, DRIFT_PER_SEC, move, fit)}`
        bubbles.forEach((b, i) => {
          const a0 = phoneLineStart(lines[i]!)
          const x = seg(t, a0, a0 + PHONE_TIMING.lineIn)
          b.style.opacity = x === 1 ? '' : String(x)
          b.style.transform = x === 1 ? '' : `translateY(${((1 - easeOutCubic(x)) * PHONE.rise).toFixed(3)}em)`
        })
      },
    }
  },
}
