import { easeInOutSine, easeOutCubic, seg } from '../../core/ease'
import {
  CAM, CUT, HEAVY, SAID,
  heavyWordParams, saidWrittenParams, viewfinderParams, wordCutParams,
  type HeavyWordParams, type SaidWrittenParams, type ViewfinderParams, type WordCutParams,
} from '../../core/params/type-tricks'
import { FONT_MONO, FONT_WEIGHT } from '../looks'
import { fitText, lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

const SVG = 'http://www.w3.org/2000/svg'
const easing = (e: 'out' | 'easy') => (e === 'easy' ? easeInOutSine : easeOutCubic)
const div = (part: string, style: Partial<CSSStyleDeclaration> = {}) => {
  const d = document.createElement('div')
  d.dataset.mbaPart = part
  Object.assign(d.style, style)
  return d
}

/**
 * heavy-word: the word's weight climbs from light to black (Cairo is variable), three arrows press
 * down on it, it sinks a little and the line under it sags. The box is sized at the heaviest weight,
 * so nothing reflows. Pure in `localT`.
 */
export const heavyWord: Primitive<HeavyWordParams> = {
  id: 'heavy-word',
  params: heavyWordParams,
  build(ctx, p) {
    const E = easing(p.ease)
    const c = safePointPx(ctx, p.place ?? { x: 0.5, y: 0.5 })
    const root = div('heavy-word', { position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', color: ctx.look.vars.fg })
    ctx.layer.append(root)
    const arrows = document.createElementNS(SVG, 'svg')
    arrows.setAttribute('viewBox', '0 0 120 40')
    const box = div('heavy-box', { fontFamily: ctx.look.fontDisplay, fontWeight: String(HEAVY.to), lineHeight: '1.25', whiteSpace: 'nowrap', textAlign: 'center' })
    const unit = lineUnit(box, p.word)
    // Measure in place: the box must be in the document before the fit.
    root.append(box)
    const px = fitText(box, { w: Math.floor(p.size * ctx.safe.w), h: Math.floor(0.35 * ctx.safe.h) }, 400, 48)
    box.style.width = `${box.offsetWidth}px`
    Object.assign(arrows.style, { width: `${(1.4 * px).toFixed(0)}px`, height: `${(0.47 * px).toFixed(0)}px`, overflow: 'visible' })
    const chevs = [20, 60, 100].map((x) => {
      const pth = document.createElementNS(SVG, 'path')
      pth.setAttribute('d', `M${x - 9} 8 L${x} 20 L${x + 9} 8`)
      pth.setAttribute('fill', 'none')
      pth.setAttribute('stroke', ctx.look.vars.accent)
      pth.setAttribute('stroke-width', '5')
      pth.setAttribute('stroke-linecap', 'round')
      pth.setAttribute('stroke-linejoin', 'round')
      arrows.append(pth)
      return pth
    })
    const line = document.createElementNS(SVG, 'svg')
    const w = box.offsetWidth
    const lh = HEAVY.sag * px + 8
    line.setAttribute('viewBox', `0 0 ${w} ${lh}`)
    Object.assign(line.style, { width: `${w}px`, height: `${lh}px`, overflow: 'visible' })
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', ctx.look.vars.fg)
    path.setAttribute('stroke-width', String(Math.max(4, Math.round(px * 0.03))))
    path.setAttribute('stroke-linecap', 'round')
    line.append(path)
    root.prepend(arrows)
    root.append(line)
    unit.style.fontWeight = String(HEAVY.from)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const e = E(seg(t, 0, HEAVY.enter))
        root.style.opacity = e === 1 ? '' : e.toFixed(4)
        const k = E(seg(t, p.at, p.at + p.duration))
        unit.style.fontWeight = String(Math.round(HEAVY.from + (HEAVY.to - HEAVY.from) * k))
        unit.style.transform = k === 0 ? '' : `translateY(${(k * HEAVY.sink * px).toFixed(2)}px)`
        chevs.forEach((ch, i) => {
          const a = E(seg(t, p.at + i * 0.08, p.at + i * 0.08 + p.duration * 0.6))
          ch.style.opacity = a.toFixed(4)
          ch.setAttribute('transform', `translate(0 ${(a * 14).toFixed(2)})`)
        })
        path.setAttribute('d', `M2 4 Q ${w / 2} ${(4 + k * HEAVY.sag * px * 2).toFixed(2)} ${w - 2} 4`)
      },
    }
  },
}

/**
 * said-written: two rows, «قلنا: علّق» then «كتبها: عَلَط»: the written word in accent with a wavy
 * underline and a ✗ badge, the mismatch made visible. Each row wipes in from the reading side.
 */
export const saidWritten: Primitive<SaidWrittenParams> = {
  id: 'said-written',
  params: saidWrittenParams,
  build(ctx, p) {
    const E = easing(p.ease)
    const c = safePointPx(ctx, p.place ?? { x: 0.5, y: 0.55 })
    const W = Math.floor(p.width * ctx.safe.w)
    const root = div('said-written', { position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, width: `${W}px`, transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', gap: '0.35em', fontSize: `${Math.round(W * 0.085)}px`, fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display) })
    root.dir = 'rtl'
    ctx.layer.append(root)
    const row = (label: string, word: string, wrong: boolean) => {
      const r = div('said-row', { display: 'flex', alignItems: 'center', gap: '0.5em', padding: '0.35em 0.6em', borderRadius: '0.35em', background: '#ffffff', color: '#141414', boxShadow: '0 0.25em 0.7em rgba(0,0,0,0.18)' })
      const lab = div('said-label', { fontSize: '0.5em', fontFamily: ctx.look.fontBody, fontWeight: String(FONT_WEIGHT.bodyBold), color: 'rgba(20,20,20,0.55)', minWidth: '3.2em' })
      lineUnit(lab, `${label}:`)
      const wd = div('said-word', { position: 'relative', color: wrong ? ctx.look.vars.accent : '#141414' })
      lineUnit(wd, word)
      r.append(lab, wd)
      let mark: HTMLElement | undefined
      let wave: SVGSVGElement | undefined
      if (wrong) {
        wave = document.createElementNS(SVG, 'svg')
        wave.setAttribute('viewBox', '0 0 100 10')
        wave.setAttribute('preserveAspectRatio', 'none')
        Object.assign(wave.style, { position: 'absolute', left: '0', right: '0', bottom: '-0.12em', width: '100%', height: '0.18em', overflow: 'visible' })
        const wp = document.createElementNS(SVG, 'path')
        wp.setAttribute('d', 'M0 5 Q 6.25 0 12.5 5 T 25 5 T 37.5 5 T 50 5 T 62.5 5 T 75 5 T 87.5 5 T 100 5')
        wp.setAttribute('fill', 'none')
        wp.setAttribute('stroke', ctx.look.vars.accent)
        wp.setAttribute('stroke-width', '2.5')
        wp.setAttribute('vector-effect', 'non-scaling-stroke')
        wave.append(wp)
        wd.append(wave)
        mark = div('said-mark', { marginInlineStart: 'auto', width: '1em', height: '1em', borderRadius: '50%', background: ctx.look.vars.accent, color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6em', fontFamily: ctx.look.fontBody })
        mark.textContent = '✗'
        r.append(mark)
      }
      root.append(r)
      return { r, mark, wave }
    }
    const a = row(p.saidLabel, p.said, false)
    const b = row(p.writtenLabel, p.written, true)
    const show = (r: HTMLElement, t: number, at: number) => {
      const k = E(seg(t, at, at + SAID.row))
      r.style.opacity = k === 1 ? '' : k.toFixed(4)
      r.style.clipPath = k >= 1 ? '' : `inset(0 0 0 ${((1 - k) * 100).toFixed(2)}%)`
      r.style.transform = k >= 1 ? '' : `translateX(${((1 - k) * 0.4).toFixed(3)}em)`
    }
    return {
      update(localT) {
        const t = Math.max(0, localT)
        show(a.r, t, p.saidAt)
        show(b.r, t, p.writtenAt)
        const m = E(seg(t, p.writtenAt + SAID.row, p.writtenAt + SAID.row + SAID.mark))
        b.mark!.style.transform = `scale(${m.toFixed(4)})`
        b.wave!.style.clipPath = `inset(0 0 0 ${((1 - m) * 100).toFixed(2)}%)`
      },
    }
  },
}

/**
 * word-cut: an editor timeline (two clips, a waveform, a playhead) under the stage; the playhead
 * runs to the cut and, on the frame it gets there, the word appears (a hard cut, no fade) and a red
 * cut mark drops on the track. The timeline reads left to right, as editors do.
 */
export const wordCut: Primitive<WordCutParams> = {
  id: 'word-cut',
  params: wordCutParams,
  build(ctx, p) {
    const E = easing(p.ease)
    const c = safePointPx(ctx, p.place ?? { x: 0.5, y: 0.5 })
    const W = Math.floor(0.86 * ctx.safe.w)
    const root = div('word-cut', { position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, width: `${W}px`, transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${Math.round(0.06 * W)}px`, color: ctx.look.vars.fg })
    ctx.layer.append(root)
    const stage = div('cut-stage', { fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display), lineHeight: '1.25', whiteSpace: 'nowrap', textAlign: 'center' })
    const unit = lineUnit(stage, p.word)
    root.append(stage)
    fitText(stage, { w: Math.floor(0.8 * W), h: Math.floor(0.22 * ctx.safe.h) }, 320, 48)
    stage.style.minHeight = `${stage.offsetHeight}px`
    const H = Math.round(CUT.trackH * W)
    const track = div('cut-track', { position: 'relative', width: `${W}px`, height: `${H}px`, borderRadius: `${Math.round(H * 0.12)}px`, background: '#1c1b1a', overflow: 'hidden', direction: 'ltr' })
    const clipA = div('cut-clip', { position: 'absolute', left: '3%', width: `${(CUT.x - 0.035) * 100}%`, top: '14%', height: '34%', borderRadius: '6px', background: 'rgba(255,255,255,0.18)' })
    const clipB = div('cut-clip', { position: 'absolute', left: `${(CUT.x + 0.005) * 100}%`, right: '3%', top: '14%', height: '34%', borderRadius: '6px', background: 'rgba(255,255,255,0.18)' })
    const wave = div('cut-wave', { position: 'absolute', left: '3%', right: '3%', top: '58%', height: '30%', display: 'flex', alignItems: 'center', gap: '2px' })
    for (let i = 0; i < CUT.bars; i++) {
      const h = 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7 + ctx.rng() * 2))
      wave.append(div('cut-bar', { flex: '1', height: `${(h * 100).toFixed(1)}%`, background: 'rgba(255,255,255,0.45)', borderRadius: '2px' }))
    }
    const mark = div('cut-mark', { position: 'absolute', left: `${CUT.x * 100}%`, top: '0', bottom: '0', width: '4px', marginLeft: '-2px', background: ctx.look.vars.accent })
    const head = div('cut-head', { position: 'absolute', top: '0', bottom: '0', width: '3px', marginLeft: '-1.5px', background: '#ffffff' })
    track.append(clipA, clipB, wave, mark, head)
    const tc = div('cut-tc', { fontFamily: FONT_MONO, fontSize: `${Math.max(Math.round(0.042 * W), Math.ceil(30 * (ctx.size.w / 1080)))}px`, opacity: '0.7', direction: 'ltr' })
    const tcText = document.createElement('span')
    tcText.dir = 'ltr'
    tc.append(tcText)
    root.append(track, tc)
    const fps = ctx.fps
    const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const e = E(seg(t, 0, CUT.enter))
        track.style.opacity = e === 1 ? '' : e.toFixed(4)
        tc.style.opacity = (0.7 * e).toFixed(4)
        // The playhead reaches the cut exactly at `at`, then keeps going at the same speed.
        const speed = (CUT.x - CUT.from) / p.at
        const x = Math.min(0.97, CUT.from + speed * t)
        head.style.left = `${(x * 100).toFixed(3)}%`
        const cut = t >= p.at
        unit.style.visibility = cut ? '' : 'hidden'
        mark.style.opacity = cut ? '1' : '0'
        clipA.style.background = cut ? ctx.look.vars.accent : 'rgba(255,255,255,0.18)'
        const f = Math.floor(t * fps)
        tcText.textContent = `00:00:${pad(f / fps)}:${pad(f % fps)}`
      },
    }
  },
}

/**
 * viewfinder: a camera REC frame over the scene: four corner brackets closing in (from `zoom`×),
 * a blinking red REC dot with its label, a running timecode and small readouts. All inside the safe
 * area; no Arabic text.
 */
export const viewfinder: Primitive<ViewfinderParams> = {
  id: 'viewfinder',
  params: viewfinderParams,
  build(ctx, p) {
    const E = easing(p.ease)
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const inset = CAM.inset * s.w
    const frame = div('viewfinder', { position: 'absolute', left: `${s.x + inset}px`, top: `${s.y + inset + 0.05 * s.h}px`, width: `${s.w - 2 * inset}px`, height: `${s.h - 2 * inset - 0.05 * s.h}px`, color: ctx.look.vars.fg, transformOrigin: '50% 50%', pointerEvents: 'none' })
    ctx.layer.append(frame)
    const L = Math.round(CAM.corner * s.w)
    const th = Math.max(4, Math.round(5 * k))
    for (const [v, h] of [['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']] as const) {
      frame.append(div('vf-corner', { position: 'absolute', [v]: '0', [h]: '0', width: `${L}px`, height: `${L}px`, [`border${v[0]!.toUpperCase()}${v.slice(1)}`]: `${th}px solid currentColor`, [`border${h[0]!.toUpperCase()}${h.slice(1)}`]: `${th}px solid currentColor` } as Partial<CSSStyleDeclaration>))
    }
    const font = `${Math.ceil(30 * k)}px`
    // The REC row sits at the bottom-left corner (the top edge belongs to the chapter bar and the headline).
    const top = div('vf-top', { position: 'absolute', left: `${L * 0.35}px`, bottom: `${L * 0.35}px`, display: 'flex', alignItems: 'center', gap: '0.4em', fontFamily: FONT_MONO, fontSize: font, direction: 'ltr' })
    const dot = div('vf-dot', { width: '0.7em', height: '0.7em', borderRadius: '50%', background: ctx.look.vars.accent })
    const rec = document.createElement('span')
    rec.dir = 'ltr'
    rec.textContent = p.label
    const tcv = document.createElement('span')
    tcv.dir = 'ltr'
    tcv.style.opacity = '0.7'
    top.append(dot, rec, tcv)
    const bottom = div('vf-bottom', { position: 'absolute', right: `${L * 0.35}px`, bottom: `${L * 0.35}px`, fontFamily: FONT_MONO, fontSize: font, opacity: '0.6', direction: 'ltr' })
    const ro = document.createElement('span')
    ro.dir = 'ltr'
    ro.textContent = 'F 2.8   ISO 400   4K'
    bottom.append(ro)
    frame.append(top, bottom)
    const fps = ctx.fps
    const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const e = E(seg(t, 0, CAM.enter))
        frame.style.opacity = e === 1 ? '' : e.toFixed(4)
        const sc = p.zoom + (1 - p.zoom) * e
        frame.style.transform = sc === 1 ? '' : `scale(${sc.toFixed(4)})`
        dot.style.opacity = Math.floor(t / (CAM.blink / 2)) % 2 === 0 ? '1' : '0.15'
        const f = Math.floor(t * fps)
        tcv.textContent = `${pad(f / fps / 60)}:${pad((f / fps) % 60)}:${pad(f % fps)}`
      },
    }
  },
}
