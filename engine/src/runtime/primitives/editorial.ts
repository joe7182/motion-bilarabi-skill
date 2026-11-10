import { easeInOutCubic, easeOutCubic, seg } from '../../core/ease'
import { EDITORIAL, editorialTypeParams, type EditorialTypeParams } from '../../core/params/editorial'
import { FONT_MONO, FONT_SERIF } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

const f3 = (x: number) => x.toFixed(3)
const BLUE = '#2f6bff'

interface Face {
  text: string
  serif: boolean
  accent: boolean
  el: HTMLElement
  /** Natural width in px (measured once). */
  w: number
}
interface Slot {
  el: HTMLElement
  faces: Face[]
  /** When each face after the first takes over (local s). */
  swapAt: number[]
  inAt: number
}

/** Blur-in amount (1 = fully in) of a word that arrives at `a` and leaves at `b` (or never). */
function shown(t: number, a: number, b: number | undefined): { o: number; blur: number; rise: number } {
  const i = easeOutCubic(seg(t, a, a + EDITORIAL.blurIn))
  const o = b === undefined ? 0 : easeInOutCubic(seg(t, b, b + EDITORIAL.blurOut))
  const v = i * (1 - o)
  return { o: v, blur: (1 - i) * 1 + o * 0.8, rise: (1 - i) * 0.14 - o * 0.1 }
}

/** editorial-type: bold sans + italic serif words blurring in, a selection box, word swaps. */
export const editorialType: Primitive<EditorialTypeParams> = {
  id: 'editorial-type',
  params: editorialTypeParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const px = p.size * k
    const accentVar = ctx.look.vars.accent
    const fg = ctx.look.vars.fg
    const box = document.createElement('div')
    Object.assign(box.style, {
      position: 'absolute', left: `${s.x}px`, width: `${s.w}px`, top: `${s.y + p.y * s.h}px`, transform: 'translateY(-50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${Math.round(0.13 * px)}px`, direction: 'rtl',
    })
    ctx.layer.append(box)

    const styleFace = (el: HTMLElement, serif: boolean, accent: boolean) => {
      Object.assign(el.style, serif
        ? { fontFamily: FONT_SERIF, fontStyle: 'italic', fontWeight: '700', fontSize: `${f3(px * 1.4)}px`, lineHeight: '1.05' }
        : { fontFamily: ctx.look.fontDisplay, fontStyle: 'normal', fontWeight: '900', fontSize: `${f3(px)}px`, lineHeight: '1.3' })
      el.style.color = accent ? accentVar : fg
      // Harakat (a shadda, a fatha…) sit above the line box: give the word room so they never touch the line above.
      if (/[ً-ْٰ]/.test(el.textContent ?? '')) el.style.paddingTop = serif ? '0.32em' : '0.22em'
      el.style.gridArea = '1 / 1'
      el.style.justifySelf = 'center'
      el.style.willChange = 'filter, transform, opacity'
    }

    const slots: Slot[][] = p.lines.map((line, li) => {
      const row = document.createElement('div')
      Object.assign(row.style, { display: 'flex', direction: 'rtl', alignItems: 'baseline', justifyContent: 'center', gap: `0 ${f3(0.26 * px)}px` })
      box.append(row)
      return line.words.map((wd, wi) => {
        const el = document.createElement('div')
        Object.assign(el.style, { display: 'grid', position: 'relative', overflow: 'visible' })
        row.append(el)
        const first: Face = { text: wd.text, serif: wd.serif, accent: wd.accent, el: lineUnit(el, wd.text), w: 0 }
        styleFace(first.el, wd.serif, wd.accent)
        const faces = [first]
        const swapAt: number[] = []
        for (const sw of [...p.swaps].filter((x) => x.line === li && x.word === wi).sort((a, b) => a.at - b.at)) {
          const prev = faces[faces.length - 1]!
          const f: Face = { text: sw.to, serif: sw.serif ?? prev.serif, accent: sw.accent ?? prev.accent, el: lineUnit(el, sw.to), w: 0 }
          styleFace(f.el, f.serif, f.accent)
          faces.push(f)
          swapAt.push(sw.at)
        }
        return { el, faces, swapAt, inAt: wd.at }
      })
    })

    // The selection box: dashed edges, four corner handles, a label chip.
    const sel = p.select
    const selColour = sel ? (sel.colour === 'blue' ? BLUE : sel.colour === 'fg' ? fg : accentVar) : ''
    const frame = document.createElement('div')
    const handles: HTMLElement[] = []
    let chip: HTMLElement | null = null
    if (sel) {
      const bw = Math.max(2, 3 * k)
      Object.assign(frame.style, { position: 'absolute', pointerEvents: 'none', border: `${f3(bw)}px dashed ${selColour}`, boxSizing: 'border-box', opacity: '0' })
      box.append(frame)
      const hs = 24 * k
      for (let i = 0; i < 4; i++) {
        const h = document.createElement('div')
        Object.assign(h.style, { position: 'absolute', width: `${f3(hs)}px`, height: `${f3(hs)}px`, background: '#ffffff', border: `${f3(bw)}px solid ${selColour}`, boxSizing: 'border-box', [i < 2 ? 'top' : 'bottom']: `${f3(-hs / 2 - bw / 2)}px`, [i % 2 ? 'left' : 'right']: `${f3(-hs / 2 - bw / 2)}px` })
        frame.append(h)
        handles.push(h)
      }
      if (sel.label) {
        chip = document.createElement('div')
        chip.textContent = sel.label
        Object.assign(chip.style, { position: 'absolute', top: `${f3(-50 * k)}px`, right: `${f3(-bw)}px`, background: selColour, color: '#ffffff', font: `400 ${f3(28 * k)}px ${FONT_MONO}`, padding: `${f3(4 * k)}px ${f3(12 * k)}px`, borderRadius: `${f3(4 * k)}px`, whiteSpace: 'nowrap', direction: 'ltr' })
        frame.append(chip)
      }
    }

    let measured = false
    const measure = () => {
      if (measured) return
      measured = true
      for (const row of slots) for (const sl of row) for (const f of sl.faces) f.w = f.el.offsetWidth
      // Shrink the whole block when its widest line (each slot at its widest word) is wider than the safe area.
      const gap = 0.26 * px
      const widest = Math.max(...slots.map((row) => row.reduce((a, sl) => a + Math.max(...sl.faces.map((f) => f.w)), 0) + gap * (row.length - 1) + 0.3 * px))
      if (widest > s.w) box.style.transform = `translateY(-50%) scale(${f3(s.w / widest)})`
    }
    const pad = 0.18 * px

    return {
      update(localT) {
        measure()
        const t = Math.max(0, localT)
        slots.forEach((row, li) =>
          row.forEach((sl, wi) => {
            const out = p.out === undefined ? undefined : p.out + 0.05 * (li * 3 + wi)
            // Slot width: lerps between faces as each swap lands.
            let w = sl.faces[0]!.w
            sl.swapAt.forEach((a, j) => {
              const r = easeInOutCubic(seg(t, a + 0.1, a + 0.1 + EDITORIAL.resize))
              w = w + (sl.faces[j + 1]!.w - w) * r
            })
            sl.el.style.width = `${f3(w)}px`
            sl.faces.forEach((f, j) => {
              const a = j === 0 ? sl.inAt : sl.swapAt[j - 1]! + 0.22
              const b = j < sl.swapAt.length ? sl.swapAt[j]! : out
              const st = t < a && j > 0 ? { o: 0, blur: 1, rise: 0.14 } : shown(t, a, b)
              f.el.style.opacity = f3(st.o)
              f.el.style.filter = st.blur > 0.001 ? `blur(${f3(st.blur * 18 * k)}px)` : ''
              f.el.style.transform = Math.abs(st.rise) > 0.0005 ? `translateY(${f3(st.rise * px)}px)` : ''
            })
          }),
        )
        if (sel) {
          const sl = slots[sel.line]![sel.word]!
          const x = sl.el.offsetLeft - pad
          const y = sl.el.offsetTop - 0.1 * px
          const ww = sl.el.offsetWidth + 2 * pad
          const hh = sl.el.offsetHeight + 0.16 * px
          const end = sel.out ?? p.out
          const i = easeOutCubic(seg(t, sel.at, sel.at + 0.3))
          const o = end === undefined ? 0 : seg(t, end, end + 0.2)
          const v = i * (1 - o)
          Object.assign(frame.style, { left: `${f3(x)}px`, top: `${f3(y)}px`, width: `${f3(ww)}px`, height: `${f3(hh)}px`, opacity: f3(v), transform: v < 1 ? `scale(${f3(1.12 - 0.12 * i)})` : '' })
          for (const h of handles) h.style.transform = `scale(${f3(Math.min(1, seg(t, sel.at + 0.12, sel.at + 0.32)))})`
          if (chip) chip.style.opacity = f3(seg(t, sel.at + 0.2, sel.at + 0.4))
        }
      },
    }
  },
}
