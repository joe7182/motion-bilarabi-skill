import { easeOutBack, easeOutCubic, seg } from '../../core/ease'
import { CTA_TIMING, commentCtaParams, type CommentCtaParams } from '../../core/params/comment-cta'
import { DRIFT_MIN_FIT_SCALE, DRIFT_PER_SEC, driftCss, driftFitBox, translateDrift } from '../../core/params/drift'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import { driftFit } from '../drift-fit'
import { safePointPx, strokeSvg } from './line-art'
import type { Primitive } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'

export const CTA = {
  /** Font px: × card width, capped by the safe height / `hDiv`, floored at minPx (× w / 1080). */
  fontW: 0.065,
  hDiv: 12,
  minPx: 34,
  /** Placeholder opacity (stays ≥ the audit's 0.5 so it is checked like any visible text). */
  placeholder: 0.55,
  /** Send pulse peak scale. */
  pulse: 0.25,
  /** The field rises by this much (em) as it enters; the DM card drops in from this far above (em). */
  rise: 0.6,
  drop: 1.2,
  /** The DM card is fully opaque this long after it starts (s); it keeps sliding until `dm[1]`. */
  dmFade: 0.15,
  /** Our own glyphs (24×24): a paper plane for send, a speech bubble for the DM. */
  sendPath: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
  dmPath: 'M4 5h16v11H9l-5 4z',
} as const

const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`

function glyph(d: string, color: string, size: string): SVGSVGElement {
  const svg = strokeSvg({ w: 24, h: 24 }, color, 2.2)
  Object.assign(svg.style, { width: size, height: size })
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  svg.append(path)
  return svg
}

/**
 * The «comment the word» end card: a comment field enters (0–0.3 s), the keyword wipes in right →
 * left (0.35–0.95 s) over the placeholder, the send button pulses (~1.0 s), the comment posts
 * (1.2 s: it rises out of the field into the thread, the field empties), and a DM card slides in
 * (1.7 s). Every text is one line unit. Pure in `localT`; the card keeps the shared slow drift (R16).
 */
export const commentCta: Primitive<CommentCtaParams> = {
  id: 'comment-cta',
  params: commentCtaParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const fg = ctx.look.vars.fg
    const move = translateDrift(ctx.rng, ctx.size.w)
    const c = safePointPx(ctx, p.at)
    const root = document.createElement('div')
    root.dataset.mbaPart = 'comment-cta-root'
    Object.assign(root.style, { position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, transform: 'translate(-50%, -50%)' })
    const card = document.createElement('div')
    card.dataset.mbaPart = 'comment-cta'
    if (p.key) card.dataset.mbaKey = p.key
    card.dir = 'rtl'
    Object.assign(card.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.6em',
      fontFamily: ctx.look.fontBody,
      fontWeight: String(FONT_WEIGHT.bodyBold),
      lineHeight: '1.35',
      color: fg,
    })
    root.append(card)
    ctx.layer.append(root)

    // DM card.
    const dm = document.createElement('div')
    dm.dataset.mbaPart = 'cta-dm'
    Object.assign(dm.style, { display: 'flex', alignItems: 'center', gap: '0.55em', padding: '0.55em 0.75em', borderRadius: '0.7em', background: mix(fg, 10), border: `0.06em solid ${mix(fg, 22)}` })
    const dmIcon = document.createElement('div')
    Object.assign(dmIcon.style, { width: '1.9em', height: '1.9em', borderRadius: '50%', background: ctx.look.vars.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0' })
    dmIcon.append(glyph(CTA.dmPath, '#ffffff', '1.1em'))
    const dmText = document.createElement('div')
    Object.assign(dmText.style, { display: 'flex', flexDirection: 'column', minWidth: '0' })
    const dmTitle = document.createElement('div')
    lineUnit(dmTitle, p.dmTitle)
    dmText.append(dmTitle)
    if (p.dmBody) {
      const body = document.createElement('div')
      Object.assign(body.style, { fontSize: '0.75em', fontWeight: String(FONT_WEIGHT.body), opacity: '0.8' })
      lineUnit(body, p.dmBody)
      dmText.append(body)
    }
    dm.append(dmIcon, dmText)

    // Posted comment.
    const posted = document.createElement('div')
    posted.dataset.mbaPart = 'cta-posted'
    Object.assign(posted.style, { display: 'flex', alignItems: 'center', gap: '0.45em' })
    const avatar = document.createElement('div')
    Object.assign(avatar.style, { width: '1.5em', height: '1.5em', borderRadius: '50%', background: ctx.look.vars.accent, flexShrink: '0' })
    const bubble = document.createElement('div')
    Object.assign(bubble.style, { padding: '0.3em 0.8em', borderRadius: '0.9em', background: mix(fg, 12) })
    lineUnit(bubble, p.keyword)
    posted.append(avatar, bubble)

    // Comment field.
    const field = document.createElement('div')
    field.dataset.mbaPart = 'cta-field'
    Object.assign(field.style, { display: 'flex', alignItems: 'center', gap: '0.5em', padding: '0.35em 0.4em 0.35em 0.4em', paddingInlineStart: '0.9em', borderRadius: '1.2em', border: `0.07em solid ${mix(fg, 35)}` })
    const area = document.createElement('div')
    Object.assign(area.style, { position: 'relative', flex: '1', minWidth: '0' })
    const placeholder = lineUnit(area, p.placeholder)
    placeholder.dataset.mbaPart = 'cta-placeholder'
    const keyword = lineUnit(area, p.keyword)
    keyword.dataset.mbaPart = 'cta-keyword'
    Object.assign(keyword.style, { position: 'absolute', right: '0', top: '0', color: fg })
    const send = document.createElement('div')
    send.dataset.mbaPart = 'cta-send'
    Object.assign(send.style, { width: '1.8em', height: '1.8em', borderRadius: '50%', background: ctx.look.vars.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0' })
    send.append(glyph(CTA.sendPath, '#ffffff', '1em'))
    field.append(area, send)

    card.append(dm, posted, field)

    const sizeTo = (fit: { w: number; h: number }) => {
      const w = Math.floor(p.size * fit.w)
      card.style.width = `${w}px`
      card.style.fontSize = `${Math.max(Math.round(CTA.minPx * k), Math.round(Math.min(CTA.fontW * w, fit.h / CTA.hDiv)))}px`
    }
    sizeTo(ctx.safe)
    let fit = driftFit(ctx, root, [card], DRIFT_PER_SEC, move)
    if (fit < DRIFT_MIN_FIT_SCALE) {
      sizeTo(driftFitBox(ctx.safe, ctx.duration, DRIFT_PER_SEC, move))
      fit = driftFit(ctx, root, [card], DRIFT_PER_SEC, move)
    }
    // The posted comment rises from the field's place.
    const riseFrom = field.offsetTop - posted.offsetTop

    return {
      update(localT) {
        const t = Math.min(Math.max(localT, 0), ctx.duration)
        root.style.transform = `translate(-50%, -50%) ${driftCss(t, DRIFT_PER_SEC, move, fit)}`
        const fIn = seg(t, CTA_TIMING.fieldIn[0], CTA_TIMING.fieldIn[1])
        field.style.opacity = fIn === 1 ? '' : String(fIn)
        field.style.transform = fIn === 1 ? '' : `translateY(${((1 - easeOutCubic(fIn)) * CTA.rise).toFixed(3)}em)`

        const w = seg(t, CTA_TIMING.keyword[0], CTA_TIMING.keyword[1])
        const post = seg(t, CTA_TIMING.post[0], CTA_TIMING.post[1])
        keyword.style.clipPath = w >= 1 ? '' : `inset(0% 0% 0% ${(100 * (1 - w)).toFixed(3)}%)`
        keyword.style.visibility = w > 0 && post < 1 ? '' : 'hidden'
        // On posting, the field's keyword fades out first, then the placeholder comes back (no overlap).
        const gone = seg(post, 0, 0.5)
        keyword.style.opacity = gone > 0 ? String(1 - gone) : ''
        const back = seg(post, 0.5, 1)
        const typed = t >= CTA_TIMING.keyword[0]
        placeholder.style.opacity = String(!typed ? CTA.placeholder : CTA.placeholder * back)

        const pu = seg(t, CTA_TIMING.pulse[0], CTA_TIMING.pulse[1])
        send.style.transform = pu > 0 && pu < 1 ? `scale(${(1 + CTA.pulse * Math.sin(Math.PI * pu)).toFixed(4)})` : ''

        posted.style.opacity = post === 1 ? '' : String(post)
        posted.style.transform = post === 1 ? '' : `translateY(${((1 - easeOutCubic(post)) * riseFrom).toFixed(2)}px)`

        const d = seg(t, CTA_TIMING.dm[0], CTA_TIMING.dm[1])
        const dOp = seg(t, CTA_TIMING.dm[0], CTA_TIMING.dm[0] + CTA.dmFade)
        dm.style.opacity = dOp === 1 ? '' : String(dOp)
        dm.style.transform = d === 1 ? '' : `translateY(${(-(1 - easeOutBack(d, 1.2)) * CTA.drop).toFixed(3)}em)`
      },
    }
  },
}
