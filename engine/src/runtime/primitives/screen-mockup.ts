import { easeInOutCubic, easeOutCubic, seg } from '../../core/ease'
import { MOCKUP, screenMockupParams, type ScreenMockupParams } from '../../core/params/screen-mockup'
import { videoFrameAt } from '../../core/video'
import { frameUrl } from './video'
import type { Primitive } from './registry'

const f2 = (x: number) => x.toFixed(2)
const f3 = (x: number) => x.toFixed(3)
const div = (parent: HTMLElement, style: Partial<CSSStyleDeclaration>, text?: string) => {
  const d = document.createElement('div')
  Object.assign(d.style, style)
  if (text !== undefined) d.textContent = text
  parent.append(d)
  return d
}

/** screen-mockup: a screenshot in a browser or a phone; it scrolls, spotlights and zooms, and gets tapped. */
export const screenMockup: Primitive<ScreenMockupParams> = {
  id: 'screen-mockup',
  params: screenMockupParams,
  async build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const phone = p.device === 'phone'
    const dark = p.theme === 'dark'
    const accent = ctx.look.vars.accent
    const W = (p.size ?? (phone ? 0.6 : 0.96)) * s.w
    const H = W * (phone ? MOCKUP.phoneAspect : (p.aspect ?? MOCKUP.browserAspect))
    const cx = s.x + s.w / 2
    const cy = s.y + p.y * s.h
    const stage = div(ctx.layer, { position: 'absolute', left: `${f2(cx - W / 2)}px`, top: `${f2(cy - H / 2)}px`, width: `${f2(W)}px`, height: `${f2(H)}px`, perspective: `${f2(2400 * k)}px` })
    const device = div(stage, { position: 'absolute', inset: '0', transformOrigin: '50% 50%', direction: 'ltr' })

    // The window or the phone body, and the viewport the page scrolls in.
    let view: HTMLElement
    let viewTop: number
    let viewH: number
    if (phone) {
      const bezel = 16 * k
      Object.assign(device.style, { background: '#101012', borderRadius: `${f2(W * 0.15)}px`, boxShadow: `0 ${f2(40 * k)}px ${f2(90 * k)}px rgba(0,0,0,0.32), inset 0 0 0 ${f2(3 * k)}px #2a2a2e` })
      const screen = div(device, { position: 'absolute', left: `${f2(bezel)}px`, top: `${f2(bezel)}px`, right: `${f2(bezel)}px`, bottom: `${f2(bezel)}px`, borderRadius: `${f2(W * 0.12)}px`, overflow: 'hidden', background: dark ? '#000' : '#fff' })
      const bar = 64 * k
      const status = div(screen, { position: 'absolute', left: '0', right: '0', top: '0', height: `${f2(bar)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${f2(44 * k)}px`, boxSizing: 'border-box', font: `700 ${f2(28 * k)}px ${ctx.look.fontBody}`, color: dark ? '#fff' : '#111', background: dark ? '#000' : '#fff', zIndex: '3' })
      div(status, {}, '9:41')
      const bat = div(status, { width: `${f2(44 * k)}px`, height: `${f2(20 * k)}px`, borderRadius: `${f2(6 * k)}px`, border: `${f2(2.5 * k)}px solid currentColor`, boxSizing: 'border-box', padding: `${f2(2 * k)}px` })
      div(bat, { width: '75%', height: '100%', background: 'currentColor', borderRadius: `${f2(2 * k)}px` })
      div(screen, { position: 'absolute', left: '50%', top: `${f2(14 * k)}px`, width: `${f2(W * 0.3)}px`, height: `${f2(36 * k)}px`, transform: 'translateX(-50%)', borderRadius: `${f2(20 * k)}px`, background: '#000', zIndex: '4' })
      view = div(screen, { position: 'absolute', left: '0', right: '0', top: `${f2(bar)}px`, bottom: '0', overflow: 'hidden' })
      viewTop = bezel + bar
      viewH = H - 2 * bezel - bar
    } else {
      const bar = 92 * k
      Object.assign(device.style, { background: dark ? '#1d1d20' : '#ffffff', borderRadius: `${f2(22 * k)}px`, overflow: 'hidden', boxShadow: `0 ${f2(40 * k)}px ${f2(90 * k)}px rgba(0,0,0,0.28), 0 0 0 ${f2(1.5 * k)}px rgba(0,0,0,0.12)` })
      const top = div(device, { position: 'absolute', left: '0', right: '0', top: '0', height: `${f2(bar)}px`, display: 'flex', alignItems: 'center', gap: `${f2(22 * k)}px`, padding: `0 ${f2(26 * k)}px`, boxSizing: 'border-box', background: dark ? '#2a2a2e' : '#f1f1f3', borderBottom: `${f2(1.5 * k)}px solid ${dark ? '#3a3a3e' : '#dedee2'}` })
      const lights = div(top, { display: 'flex', gap: `${f2(12 * k)}px` })
      for (const c of ['#ff5f57', '#febc2e', '#28c840']) div(lights, { width: `${f2(20 * k)}px`, height: `${f2(20 * k)}px`, borderRadius: '50%', background: c })
      const pill = div(top, { flex: '1', height: `${f2(50 * k)}px`, borderRadius: `${f2(25 * k)}px`, background: dark ? '#1d1d20' : '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: `${f2(10 * k)}px`, font: `500 ${f2(26 * k)}px ${ctx.look.fontBody}`, color: dark ? '#ddd' : '#333', boxShadow: `inset 0 0 0 ${f2(1.5 * k)}px ${dark ? '#3a3a3e' : '#e0e0e4'}` })
      const lock = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      lock.setAttribute('viewBox', '0 0 16 16')
      Object.assign(lock.style, { width: `${f2(20 * k)}px`, height: `${f2(20 * k)}px` })
      lock.innerHTML = '<rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/>'
      pill.append(lock)
      div(pill, { whiteSpace: 'nowrap' }, p.url ?? '')
      div(top, { width: `${f2(56 * k)}px` })
      view = div(device, { position: 'absolute', left: '0', right: '0', top: `${f2(bar)}px`, bottom: '0', overflow: 'hidden', background: dark ? '#111' : '#fff' })
      viewTop = bar
      viewH = H - bar
    }
    const viewW = phone ? W - 32 * k : W

    const img = document.createElement('img')
    img.alt = ''
    img.decoding = 'sync'
    // A screenshot, or the first frame of a recording (its size sets the screen's page height).
    const frameOf = (t: number) => videoFrameAt(p, t, ctx.duration, ctx.fps)
    img.src = p.media ? frameUrl(p.media, frameOf(0)) : p.image!
    await img.decode()
    if (p.media) img.dataset.n = String(frameOf(0))
    const imgH = viewW * (img.naturalHeight / Math.max(1, img.naturalWidth))
    Object.assign(img.style, { position: 'absolute', left: '0', top: '0', width: `${f2(viewW)}px`, height: `${f2(imgH)}px`, maxWidth: 'none', display: 'block' })
    view.append(img)
    const range = Math.max(0, imgH - viewH)

    // Spotlight boxes (dim around, accent outline, a label chip above).
    const spots = p.focus.map((f) => {
      const box = div(view, { position: 'absolute', boxSizing: 'border-box', border: `${f2(5 * k)}px solid ${accent}`, borderRadius: `${f2(14 * k)}px`, boxShadow: '0 0 0 9999px rgba(10,10,12,0.55)', opacity: '0', zIndex: '5' })
      const chip = f.label ? div(box, { position: 'absolute', left: '50%', bottom: '100%', transform: 'translate(-50%, -12px)', background: accent, color: '#fff', font: `800 ${f2(30 * k)}px ${ctx.look.fontDisplay}`, padding: `${f2(6 * k)}px ${f2(16 * k)}px`, borderRadius: `${f2(10 * k)}px`, whiteSpace: 'nowrap', direction: 'rtl' }, f.label) : null
      return { box, chip }
    })
    // The pointer: an arrow cursor (browser) or a fingertip (phone), and its ripple.
    const pointer = div(view, { position: 'absolute', left: '0', top: '0', zIndex: '7', opacity: '0', pointerEvents: 'none' })
    if (phone) Object.assign(pointer.style, { width: `${f2(84 * k)}px`, height: `${f2(84 * k)}px`, marginLeft: `${f2(-42 * k)}px`, marginTop: `${f2(-42 * k)}px`, borderRadius: '50%', background: 'rgba(255,255,255,0.55)', border: `${f2(4 * k)}px solid rgba(0,0,0,0.25)`, boxSizing: 'border-box' })
    else pointer.innerHTML = `<svg width="${f2(46 * k)}" height="${f2(64 * k)}" viewBox="0 0 23 32"><path d="M1 1 L1 25 L7 19.5 L11.5 30 L15.5 28 L11 18 L19 18 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`
    const ripple = div(view, { position: 'absolute', width: `${f2(60 * k)}px`, height: `${f2(60 * k)}px`, marginLeft: `${f2(-30 * k)}px`, marginTop: `${f2(-30 * k)}px`, borderRadius: '50%', border: `${f2(5 * k)}px solid ${accent}`, boxSizing: 'border-box', zIndex: '6', opacity: '0' })

    const scrollAt = (t: number) => {
      let y = 0
      for (const key of p.scroll) y = y + (key.y - y) * easeInOutCubic(seg(t, key.at, key.at + key.dur))
      return y * range
    }

    return {
      async update(localT) {
        const t = Math.max(0, localT)
        if (p.media) {
          const n = String(frameOf(localT))
          if (img.dataset.n !== n) {
            delete img.dataset.n
            const url = frameUrl(p.media, Number(n))
            img.src = url
            try {
              await img.decode()
            } catch (e) {
              throw new Error(`تعذّر تحميل الإطار ${n} من المادة ${p.media} — screen-mockup ${p.media}: frame ${n} could not be loaded (${url}; ${e instanceof Error ? e.message : String(e)})`)
            }
            img.dataset.n = n
          }
        }
        const sy = scrollAt(t)
        img.style.transform = `translateY(${f2(-sy)}px)`

        // Entrance: rise, fade, and the tilt settling flat.
        const e = easeOutCubic(seg(t, p.at, p.at + 0.9))
        const rx = p.tilt ? 16 * (1 - e) : 0
        const ry = p.tilt ? -12 * (1 - e) : 0
        // Zoom onto the live spotlight (the strongest one).
        let z = 1
        let tx = 0
        let ty = 0
        p.focus.forEach((f, i) => {
          const on = easeInOutCubic(seg(t, f.at, f.at + 0.55)) * (f.out === undefined ? 1 : 1 - easeInOutCubic(seg(t, f.out, f.out + 0.45)))
          const bx = f.x * viewW + (phone ? 16 * k : 0)
          const by = f.y * imgH - sy + viewTop
          const bw = f.w * viewW
          const bh = f.h * imgH
          const sp = spots[i]!
          Object.assign(sp.box.style, { left: `${f2(f.x * viewW - 8 * k)}px`, top: `${f2(f.y * imgH - sy - 8 * k)}px`, width: `${f2(bw + 16 * k)}px`, height: `${f2(bh + 16 * k)}px`, opacity: f3(on) })
          if (on > 0.001) {
            const zz = 1 + (f.zoom - 1) * on
            if (zz > z) {
              z = zz
              tx = (W / 2 - (bx + bw / 2)) * on
              ty = (H / 2 - (by + bh / 2)) * on
            }
          }
        })
        device.style.transform = `translateY(${f2((1 - e) * 0.12 * ctx.size.h)}px) rotateX(${f2(rx)}deg) rotateY(${f2(ry)}deg) scale(${f3(z)}) translate(${f2(tx)}px, ${f2(ty)}px)`
        stage.style.opacity = f3(Math.min(1, seg(t, p.at, p.at + 0.3)))

        // Taps: glide (browser) or appear (phone), then press with a ripple.
        let pt: { x: number; y: number; o: number; press: number } | null = null
        let rip: { x: number; y: number; r: number } | null = null
        p.taps.forEach((tp, i) => {
          const x = tp.x * viewW
          const y = tp.y * imgH - sy
          const prev = i > 0 ? p.taps[i - 1]! : null
          const from = prev ? { x: prev.x * viewW, y: prev.y * imgH - sy } : { x: viewW * 0.7, y: viewH * 0.85 }
          const a = tp.at - 0.7
          if (t >= a && t < tp.at + 0.6) {
            const m = phone ? 1 : easeInOutCubic(seg(t, a, tp.at - 0.08))
            const o = phone ? Math.min(seg(t, tp.at - 0.25, tp.at - 0.1), 1 - seg(t, tp.at + 0.35, tp.at + 0.55)) : 1
            pt = { x: from.x + (x - from.x) * m, y: from.y + (y - from.y) * m, o, press: Math.sin(Math.PI * seg(t, tp.at - 0.06, tp.at + 0.14)) }
          }
          const r = seg(t, tp.at, tp.at + 0.55)
          if (r > 0 && r < 1) rip = { x, y, r }
        })
        const lastTap = p.taps[p.taps.length - 1]
        const P = pt as { x: number; y: number; o: number; press: number } | null
        if (P) {
          pointer.style.opacity = f3(P.o)
          pointer.style.transform = `translate(${f2(P.x)}px, ${f2(P.y)}px) scale(${f3(1 - 0.15 * P.press)})`
        } else if (!phone && lastTap && t >= lastTap.at) {
          // The cursor rests where it last clicked.
          pointer.style.opacity = '1'
          pointer.style.transform = `translate(${f2(lastTap.x * viewW)}px, ${f2(lastTap.y * imgH - sy)}px)`
        } else pointer.style.opacity = '0'
        const R = rip as { x: number; y: number; r: number } | null
        if (R) {
          ripple.style.opacity = f3(1 - R.r)
          ripple.style.transform = `translate(${f2(R.x)}px, ${f2(R.y)}px) scale(${f3(0.4 + 1.8 * easeOutCubic(R.r))})`
        } else ripple.style.opacity = '0'
      },
    }
  },
}
