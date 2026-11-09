import { easeOutCubic, seg } from '../../core/ease'
import { CAPTIONS as C, captionsParams, type CaptionSkin, type CaptionsParams } from '../../core/params/captions'
import { FONT_WEIGHT } from '../looks'
import { bidiWordUnits, fitText } from '../text/units'
import type { Primitive } from './registry'

/** How a skin dresses the phrase box (`box`) and marks the spoken word (`mark`). */
interface SkinStyle {
  box: (accent: string, px: number) => Partial<CSSStyleDeclaration>
  mark: (u: HTMLElement, on: boolean, accent: string, emphasised: boolean) => void
  /** Box colours when shown on a pill / strip: [background, text]. */
  surface: [string, string]
}

const NAVY = '#13232B'
const shadowText = '0 0.05em 0.09em #000, 0 0 0.25em #000, 0 0 0.04em #000'

const SKINS: Record<CaptionSkin, SkinStyle> = {
  'spoken-box': {
    surface: ['rgba(19,35,43,0.86)', '#ffffff'],
    box: () => ({}),
    mark: (u, on, accent) => {
      u.style.background = on ? accent : ''
      u.style.boxShadow = on ? `0 0 0 0.08em ${accent}` : ''
    },
  },
  karaoke: {
    surface: ['rgba(19,35,43,0.86)', '#ffffff'],
    box: () => ({}),
    mark: (u, on, _a, emphasised) => {
      if (emphasised) return
      u.style.color = on ? '#FFE58A' : ''
      u.style.textDecorationLine = on ? 'underline' : ''
      u.style.textDecorationThickness = '0.07em'
      u.style.textUnderlineOffset = '0.16em'
    },
  },
  'bold-outline': {
    surface: ['rgba(19,35,43,0.86)', '#ffffff'],
    box: (_a, px) => ({ webkitTextStroke: `${Math.max(2, Math.round(px * 0.055))}px #101820`, paintOrder: 'stroke fill', textShadow: '0 0.05em 0 #101820' }),
    mark: (u, on) => {
      u.style.transform = on ? 'translateY(-0.04em)' : ''
    },
  },
  'soft-shadow': {
    surface: ['rgba(19,35,43,0.86)', '#ffffff'],
    box: () => ({ textShadow: shadowText }),
    mark: (u, on) => {
      u.style.opacity = on ? '' : '0.82'
    },
  },
  'paper-tag': {
    surface: ['#F6EEDD', '#231E18'],
    box: (_a, px) => ({ borderRadius: '0.06em', boxShadow: '0 0.07em 0 rgba(0,0,0,0.22)', borderBlock: `${Math.max(2, Math.round(px * 0.03))}px dashed #B9A78C` }),
    mark: (u, on, accent, emphasised) => {
      if (!emphasised) u.style.color = on ? accent : ''
    },
  },
}

/** Index of the word being spoken at `t`, or -1 between words. */
function spokenIndex(words: readonly { at: number; end: number }[], t: number): number {
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i]!
    if (t >= w.at && t < Math.max(w.end, w.at + 0.08)) return i
  }
  return -1
}

/**
 * captions: one phrase on screen at a time; the skin marks the spoken word. Layout happens once
 * at build (one span per word, Latin kept as its own run); `update` only flips styles, so any
 * frame can be drawn cold.
 */
export const captions: Primitive<CaptionsParams> = {
  id: 'captions',
  params: captionsParams,
  build(ctx, p) {
    const scale = ctx.size.w / 1080
    const maxPx = Math.round(p.maxPx * scale)
    const width = Math.floor(C.band * ctx.safe.w)
    const skin = SKINS[p.skin]
    const accent = ctx.look.vars.accent
    const paper = p.skin === 'paper-tag'
    const bare = p.presentation === 'minimal' && !paper
    const [surfaceBg, surfaceFg] = p.presentation === 'strip' && !paper ? ['#102027', '#ffffff'] : skin.surface
    const markColour = paper || !bare ? accent : NAVY

    const phrases = p.cues.map((cue) => {
      const holder = document.createElement('div')
      Object.assign(holder.style, { position: 'absolute', left: `${(ctx.size.w - width) / 2}px`, width: `${width}px`, top: `${p.y * ctx.size.h}px`, transform: 'translateY(-50%)', textAlign: 'center' })
      const box = document.createElement('div')
      box.dataset.mbaPart = 'caption'
      Object.assign(box.style, {
        display: 'inline-block', boxSizing: 'border-box', maxWidth: `${width}px`, whiteSpace: 'nowrap', visibility: 'hidden',
        padding: `${C.padY}em ${C.padX}em`, lineHeight: '1.35', textAlign: 'center',
        fontFamily: ctx.look.fontDisplay, fontWeight: String(FONT_WEIGHT.display),
        borderRadius: p.presentation === 'strip' ? '0.08em' : '0.4em',
        background: bare ? 'transparent' : surfaceBg,
        color: bare ? '#ffffff' : surfaceFg,
        boxShadow: bare ? 'none' : '0 0.06em 0.3em rgba(0,0,0,0.12)',
        textShadow: bare ? shadowText : 'none',
      }, skin.box(accent, maxPx))
      const line = document.createElement('div')
      line.dir = 'rtl'
      box.append(line)
      holder.append(box)
      ctx.layer.append(holder)
      const spans = bidiWordUnits(line, cue.words.map((w) => w.text).join(' '))
      spans.forEach((s, i) => {
        Object.assign(s.style, { borderRadius: '0.12em', padding: '0 0.08em', transformOrigin: '50% 60%' })
        const emph = cue.words[i]!.emph
        if (emph === 'accent') s.style.color = accent
        if (emph === 'underline') Object.assign(s.style, { textDecorationLine: 'underline', textDecorationColor: accent, textDecorationThickness: '0.08em', textUnderlineOffset: '0.18em' })
      })
      box.style.fontSize = `${maxPx}px`
      fitText(box, { w: width, h: Math.round(ctx.safe.h * 0.2) }, maxPx, Math.round(C.minPx * scale))
      return { cue, box, spans }
    })

    return {
      update(localT) {
        const t = Math.max(0, localT)
        for (const { cue, box, spans } of phrases) {
          const visible = t >= cue.at && t < cue.end
          box.style.visibility = visible ? '' : 'hidden'
          if (!visible) continue
          const inP = easeOutCubic(seg(t, cue.at - C.enter, cue.at))
          box.style.opacity = inP < 1 ? inP.toFixed(3) : ''
          box.style.transform = inP < 1 ? `translateY(${((1 - inP) * 6 * scale).toFixed(2)}px)` : ''
          const now = spokenIndex(cue.words, t)
          spans.forEach((s, i) => {
            const w = cue.words[i]!
            skin.mark(s, i === now, markColour, w.emph === 'accent' || w.emph === 'underline')
            if (w.emph !== 'pop') return
            const k = seg(t, w.at, w.at + C.popSec)
            const sc = k > 0 && k < 1 ? 1 + (C.pop - 1) * Math.sin(Math.PI * k) : 1
            s.style.transform = sc === 1 ? '' : `scale(${sc.toFixed(4)})`
          })
        }
      },
    }
  },
}
