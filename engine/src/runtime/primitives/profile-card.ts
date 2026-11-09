import { easeOutBack, easeOutCubic, seg } from '../../core/ease'
import { power3Out } from '../../core/params/counter'
import { PROFILE_TIMING, profileCardParams, type ProfileCardParams } from '../../core/params/profile-card'
import { FONT_WEIGHT } from '../looks'
import { lineUnit } from '../text/units'
import { safePointPx } from './line-art'
import type { Primitive } from './registry'

const SVG_NS = 'http://www.w3.org/2000/svg'

export const PROFILE = {
  /** Font px as a fraction of the card width. */
  fontW: 0.052,
  /** The card's own colours (a social profile card reads dark in every world). */
  card: '#0F1115',
  text: '#F4F2EE',
  muted: 'rgba(244,242,238,0.62)',
  /** Avatar diameter (em) and ring gap / width (em). */
  avatar: 5.2,
  ringGap: 0.32,
  ringW: 0.2,
  /** The card rises by this much (em) as it enters. */
  rise: 1.2,
} as const

/** `n` with thousands commas (Latin digits, as a profile shows them). */
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * profile-card: the creator's own profile («أنا يوسف»). A dark card rises in; the avatar pops in a
 * ring that draws itself (accent); the name wipes in; each stat rolls up from 0 (power3.out,
 * staggered); the follow button fades in and, at `pressAt`, presses and turns into `followed`
 * (accent). Stat columns are sized to their final text, so the rolling numbers never shift the
 * layout. Pure in `localT`.
 */
export const profileCard: Primitive<ProfileCardParams> = {
  id: 'profile-card',
  params: profileCardParams,
  build(ctx, p) {
    const accent = ctx.look.vars.accent
    const c = safePointPx(ctx, p.at)
    const w = Math.floor(p.size * ctx.safe.w)
    const root = document.createElement('div')
    root.dataset.mbaPart = 'profile-card-root'
    Object.assign(root.style, { position: 'absolute', left: `${c.x}px`, top: `${c.y}px`, transform: 'translate(-50%, -50%)' })
    const card = document.createElement('div')
    card.dataset.mbaPart = 'profile-card'
    if (p.key) card.dataset.mbaKey = p.key
    card.dir = 'ltr'
    Object.assign(card.style, {
      width: `${w}px`, boxSizing: 'border-box', fontSize: `${Math.round(PROFILE.fontW * w)}px`, padding: '1.1em 1.2em',
      borderRadius: '1.1em', background: PROFILE.card, color: PROFILE.text, fontFamily: ctx.look.fontDisplay,
      fontWeight: String(FONT_WEIGHT.bodyBold), lineHeight: '1.15', display: 'flex', flexDirection: 'column', gap: '0.9em',
      boxShadow: '0 1.4em 2.6em rgba(0,0,0,0.28), 0 0.2em 0.5em rgba(0,0,0,0.2)', border: '0.05em solid rgba(255,255,255,0.08)',
    })
    root.append(card)
    ctx.layer.append(root)

    // Top row: the avatar in its ring, then the name over the stats.
    const top = document.createElement('div')
    Object.assign(top.style, { display: 'flex', alignItems: 'center', gap: '1em' })
    const box = PROFILE.avatar + 2 * (PROFILE.ringGap + PROFILE.ringW)
    const av = document.createElement('div')
    Object.assign(av.style, { position: 'relative', width: `${box}em`, height: `${box}em`, flexShrink: '0' })
    const ring = document.createElementNS(SVG_NS, 'svg')
    ring.setAttribute('viewBox', '0 0 100 100')
    Object.assign(ring.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', transform: 'rotate(-90deg)' })
    const rr = 50 - (PROFILE.ringW / box) * 50
    const circ = 2 * Math.PI * rr
    const arc = document.createElementNS(SVG_NS, 'circle')
    arc.setAttribute('cx', '50'); arc.setAttribute('cy', '50'); arc.setAttribute('r', rr.toFixed(3))
    arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', accent); arc.setAttribute('stroke-width', ((PROFILE.ringW / box) * 100).toFixed(3))
    arc.setAttribute('stroke-linecap', 'round'); arc.setAttribute('stroke-dasharray', circ.toFixed(3))
    ring.append(arc)
    const img = document.createElement('img')
    img.alt = ''
    img.src = p.avatar
    const inset = PROFILE.ringGap + PROFILE.ringW
    Object.assign(img.style, { position: 'absolute', left: `${inset}em`, top: `${inset}em`, width: `${PROFILE.avatar}em`, height: `${PROFILE.avatar}em`, borderRadius: '50%', objectFit: 'cover', display: 'block' })
    av.append(ring, img)

    const right = document.createElement('div')
    Object.assign(right.style, { display: 'flex', flexDirection: 'column', gap: '0.55em', minWidth: '0', flex: '1' })
    const name = document.createElement('div')
    Object.assign(name.style, { fontSize: '0.88em', whiteSpace: 'nowrap' })
    const nameUnit = lineUnit(name, p.name)
    const statsRow = document.createElement('div')
    Object.assign(statsRow.style, { display: 'flex', gap: '1.3em' })
    const nums: HTMLElement[] = []
    for (const s of p.stats) {
      const col = document.createElement('div')
      Object.assign(col.style, { display: 'flex', flexDirection: 'column', gap: '0.1em' })
      const num = document.createElement('div')
      Object.assign(num.style, { fontSize: '1.25em', fontVariantNumeric: 'tabular-nums' })
      const numUnit = lineUnit(num, fmt(s.value))
      const lab = document.createElement('div')
      Object.assign(lab.style, { fontSize: '0.78em', color: PROFILE.muted, fontWeight: String(FONT_WEIGHT.body) })
      lineUnit(lab, s.label)
      col.append(num, lab)
      statsRow.append(col)
      nums.push(numUnit)
    }
    right.append(name, statsRow)
    top.append(av, right)

    const btn = document.createElement('div')
    Object.assign(btn.style, { position: 'relative', textAlign: 'center', padding: '0.5em 0', borderRadius: '0.6em', fontSize: '0.95em', background: accent, color: '#ffffff' })
    const btnLabel = lineUnit(btn, p.button)
    card.append(top, btn)

    // Fix each number's width at its final text so the roll never shifts the layout.
    for (const n of nums) n.style.minWidth = `${n.getBoundingClientRect().width}px`
    nameUnit.style.display = 'inline-block'

    return {
      update(localT) {
        const t = Math.max(0, localT)
        const T = PROFILE_TIMING
        const cin = seg(t, T.cardIn[0], T.cardIn[1])
        card.style.opacity = cin === 1 ? '' : String(easeOutCubic(cin))
        card.style.transform = cin === 1 ? '' : `translateY(${((1 - easeOutCubic(cin)) * PROFILE.rise).toFixed(3)}em)`

        const a = seg(t, T.avatar[0], T.avatar[1])
        img.style.transform = a === 1 ? '' : `scale(${Math.max(0, easeOutBack(a, 1.6)).toFixed(4)})`
        img.style.opacity = a > 0 ? '' : '0'
        const r = easeOutCubic(seg(t, T.ring[0], T.ring[1]))
        arc.setAttribute('stroke-dashoffset', (circ * (1 - r)).toFixed(3))

        const nm = easeOutCubic(seg(t, T.name[0], T.name[1]))
        nameUnit.style.clipPath = nm >= 1 ? '' : `inset(0% ${(100 * (1 - nm)).toFixed(3)}% 0% 0%)`

        p.stats.forEach((s, i) => {
          const from = T.rollFrom + i * T.stagger
          const k = seg(t, from, from + T.roll)
          nums[i]!.textContent = fmt(s.value * power3Out(k))
        })

        const bi = easeOutCubic(seg(t, T.buttonIn[0], T.buttonIn[1]))
        let scale = 1
        let pressed = false
        if (p.pressAt !== undefined && t >= p.pressAt) {
          const k = seg(t, p.pressAt, p.pressAt + T.press)
          scale = 1 - 0.1 * Math.sin(Math.PI * k)
          pressed = k >= 0.5
        }
        btn.style.opacity = bi === 1 ? '' : String(bi)
        btn.style.transform = scale === 1 ? '' : `scale(${scale.toFixed(4)})`
        btn.style.background = pressed ? 'rgba(255,255,255,0.12)' : accent
        btnLabel.textContent = pressed ? p.followed : p.button
      },
    }
  },
}
