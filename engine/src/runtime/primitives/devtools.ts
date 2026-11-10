import { easeOutBack, easeOutCubic, seg } from '../../core/ease'
import { codeFileParams, permissionPromptParams, type CodeFileParams, type PermissionPromptParams } from '../../core/params/devtools'
import { FONT_MONO } from '../looks'
import { lineUnit } from '../text/units'
import type { Primitive } from './registry'

const f3 = (x: number) => x.toFixed(3)
const div = (part: string, style: Partial<CSSStyleDeclaration> = {}) => {
  const d = document.createElement('div')
  d.dataset.mbaPart = part
  Object.assign(d.style, style)
  return d
}
const TERM_BG = '#0f1115'
const TERM_FG = '#e6e8ec'
const RED = '#ff4d4f'
const GREEN = '#3ecf8e'

/** permission-prompt: Claude Code's approval box; the selector lands on an option and it is chosen. */
export const permissionPrompt: Primitive<PermissionPromptParams> = {
  id: 'permission-prompt',
  params: permissionPromptParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const accent = ctx.look.vars.accent
    const box = div('pp-box', { position: 'absolute', left: `${s.x + s.w * 0.03}px`, width: `${s.w * 0.94}px`, top: `${s.y + p.top * s.h}px`, background: TERM_BG, color: TERM_FG, borderRadius: `${Math.round(26 * k)}px`, padding: `${Math.round(34 * k)}px ${Math.round(36 * k)}px`, boxSizing: 'border-box', boxShadow: '0 30px 80px #0007', fontFamily: FONT_MONO, fontSize: `${Math.round(30 * k)}px`, lineHeight: '1.5', direction: 'ltr', border: `${Math.round(3 * k)}px solid #c96442` })
    const title = div('pp-title', { color: '#c96442', fontWeight: '700', marginBottom: `${Math.round(16 * k)}px` })
    title.textContent = 'Bash command'
    const cmd = div('pp-cmd', { padding: `${Math.round(14 * k)}px ${Math.round(18 * k)}px`, background: '#1b1f27', borderRadius: `${Math.round(12 * k)}px`, marginBottom: `${Math.round(22 * k)}px`, wordBreak: 'break-all' })
    cmd.textContent = p.command
    const q = div('pp-q', { marginBottom: `${Math.round(12 * k)}px`, fontWeight: '700' })
    q.textContent = 'Do you want to proceed?'
    box.append(title, cmd, q)
    const labels = ['Yes', "Yes, and don't ask again for this command", 'No, and tell Claude what to do differently']
    const opts = labels.map((l, i) => {
      const row = div('pp-opt', { display: 'flex', gap: `${Math.round(14 * k)}px`, padding: `${Math.round(8 * k)}px ${Math.round(12 * k)}px`, borderRadius: `${Math.round(10 * k)}px`, position: 'relative' })
      const caret = document.createElement('span')
      caret.textContent = '❯'
      caret.style.opacity = '0'
      const txt = document.createElement('span')
      txt.textContent = `${i + 1}. ${l}`
      row.append(caret, txt)
      box.append(row)
      return { row, caret }
    })
    let note: HTMLElement | null = null
    if (p.note) {
      note = div('pp-note', { position: 'absolute', right: `${Math.round(-10 * k)}px`, top: '100%', marginTop: `${Math.round(10 * k)}px`, background: accent, color: '#fff', fontFamily: ctx.look.fontBody, fontWeight: '800', fontSize: `${Math.round(34 * k)}px`, padding: `${Math.round(8 * k)}px ${Math.round(20 * k)}px`, borderRadius: `${Math.round(30 * k)}px`, direction: 'rtl', whiteSpace: 'nowrap', zIndex: '2', opacity: '0' })
      lineUnit(note, p.note)
      opts[p.option]!.row.append(note)
    }
    ctx.layer.append(box)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const enter = easeOutBack(seg(t, 0, 0.4), 1.3)
        box.style.opacity = f3(Math.min(1, seg(t, 0, 0.15)))
        box.style.transform = `translateY(${f3((1 - enter) * 40 * k)}px)`
        // The selector starts on option 0 and steps down to the chosen one.
        const steps = p.option
        const prog = steps === 0 ? 1 : seg(t, p.moveAt, p.moveAt + 0.25 * steps)
        const cur = Math.min(steps, Math.floor(prog * steps + (prog >= 1 ? 0 : 0)))
        const chosen = t >= p.pickAt
        opts.forEach((o, i) => {
          const on = i === (prog >= 1 ? steps : cur)
          o.caret.style.opacity = on ? '1' : '0'
          o.row.style.color = on ? '#ffffff' : 'rgba(230,232,236,0.7)'
          o.row.style.background = on && chosen ? 'rgba(201,100,66,0.35)' : on ? 'rgba(255,255,255,0.06)' : 'transparent'
          o.row.style.transform = on && chosen ? `scale(${f3(1 + 0.03 * Math.sin(Math.PI * Math.min(1, seg(t, p.pickAt, p.pickAt + 0.25))))})` : ''
        })
        if (note) {
          const a = easeOutBack(seg(t, p.pickAt + 0.1, p.pickAt + 0.45), 1.6)
          note.style.opacity = f3(Math.min(1, seg(t, p.pickAt + 0.1, p.pickAt + 0.25)))
          note.style.transform = `scale(${f3(0.6 + 0.4 * a)})`
        }
      },
    }
  },
}

/** code-file: an editor pane; lines type in, a secret line glows red with a tag, an ok line gets a check. */
export const codeFile: Primitive<CodeFileParams> = {
  id: 'code-file',
  params: codeFileParams,
  build(ctx, p) {
    const k = ctx.size.w / 1080
    const s = ctx.safe
    const pane = div('cf-pane', { position: 'absolute', left: `${s.x + s.w * 0.03}px`, width: `${s.w * 0.94}px`, top: `${s.y + p.top * s.h}px`, minHeight: `${p.height * s.h}px`, background: TERM_BG, color: TERM_FG, borderRadius: `${Math.round(24 * k)}px`, boxSizing: 'border-box', boxShadow: '0 30px 80px #0007', fontFamily: FONT_MONO, fontSize: `${Math.round(p.size * k)}px`, lineHeight: '1.6', direction: 'ltr', overflow: 'hidden' })
    const bar = div('cf-bar', { display: 'flex', alignItems: 'center', gap: `${Math.round(12 * k)}px`, padding: `${Math.round(16 * k)}px ${Math.round(22 * k)}px`, background: '#171a21', borderBottom: '1px solid #262a33' })
    for (const c of ['#ff5f57', '#febc2e', '#28c840']) bar.append(div('cf-dot', { width: `${Math.round(18 * k)}px`, height: `${Math.round(18 * k)}px`, borderRadius: '50%', background: c }))
    const tab = div('cf-tab', { marginLeft: `${Math.round(16 * k)}px`, padding: `${Math.round(6 * k)}px ${Math.round(18 * k)}px`, background: TERM_BG, borderRadius: `${Math.round(10 * k)}px`, fontSize: `${Math.round(p.size * 0.85 * k)}px`, color: '#c9d1d9' })
    tab.textContent = p.file
    bar.append(tab)
    const body = div('cf-body', { padding: `${Math.round(18 * k)}px 0` })
    pane.append(bar, body)
    const rows = p.lines.map((l, i) => {
      const row = div('cf-row', { display: 'flex', alignItems: 'center', position: 'relative', padding: `0 ${Math.round(22 * k)}px`, minHeight: `${Math.round(p.size * 1.6 * k)}px` })
      const num = div('cf-num', { width: `${Math.round(p.size * 1.6 * k)}px`, flex: 'none', color: '#4b5263', textAlign: 'right', marginRight: `${Math.round(22 * k)}px` })
      num.textContent = String(i + 1)
      const code = div('cf-code', { whiteSpace: 'pre', color: l.mark === 'secret' ? '#ffd2d2' : l.mark === 'add' ? '#b8f5d4' : TERM_FG })
      const txt = document.createElement('span')
      code.append(txt)
      row.append(num, code)
      let tag: HTMLElement | null = null
      if (l.tag || l.mark === 'ok') {
        tag = div('cf-tag', { position: 'absolute', right: `${Math.round(18 * k)}px`, top: '50%', marginTop: `${Math.round(-p.size * 0.8 * k)}px`, padding: `${Math.round(2 * k)}px ${Math.round(14 * k)}px`, borderRadius: `${Math.round(20 * k)}px`, background: 'rgba(15,17,21,0.92)', fontFamily: ctx.look.fontBody, fontWeight: '800', fontSize: `${Math.round(p.size * 1.05 * k)}px`, color: l.mark === 'secret' ? RED : GREEN, direction: 'rtl', whiteSpace: 'nowrap', opacity: '0' })
        lineUnit(tag, l.tag ?? '✓')
        row.append(tag)
      }
      body.append(row)
      return { row, txt, tag, l }
    })
    ctx.layer.append(pane)
    return {
      update(localT) {
        const t = Math.max(0, localT)
        const enter = easeOutCubic(seg(t, 0, 0.3))
        pane.style.opacity = f3(enter)
        pane.style.transform = `translateY(${f3((1 - enter) * 30 * k)}px)`
        for (const r of rows) {
          // Type the line in over up to 0.5 s (38 chars a second).
          const n = Math.max(0, Math.min(r.l.text.length, Math.floor((t - r.l.at) * 38 + (t >= r.l.at ? 1 : 0))))
          r.txt.textContent = r.l.text.slice(0, n)
          r.row.style.visibility = t >= r.l.at ? 'visible' : 'hidden'
          const done = r.l.at + r.l.text.length / 38
          const glow = seg(t, done, done + 0.25)
          if (r.l.mark === 'secret') r.row.style.background = glow > 0 ? `rgba(255,77,79,${f3(0.22 * glow + 0.06 * glow * Math.sin(t * 8))})` : ''
          if (r.l.mark === 'add') r.row.style.background = glow > 0 ? `rgba(62,207,142,${f3(0.14 * glow)})` : ''
          if (r.tag) {
            const a = easeOutBack(seg(t, done + 0.1, done + 0.4), 1.6)
            r.tag.style.opacity = f3(Math.min(1, seg(t, done + 0.1, done + 0.2)))
            r.tag.style.transform = `scale(${f3(0.6 + 0.4 * a)})`
          }
        }
      },
    }
  },
}
