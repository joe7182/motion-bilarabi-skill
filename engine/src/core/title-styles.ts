/**
 * Title styles for `styled-title` and the style picker (`mba pick`): the styles, fonts, colours and
 * in/out motions, as CSS text and one HTML builder. Kept here (pure strings, no DOM) so the scene and
 * the picker page draw the same thing: what the person places in the picker is what renders.
 * Layout is on a 1080 × 1920 canvas (the frame at 9:16); the scene scales it to the real frame.
 */

export const TITLE_STYLES = [
  { id: 'nebula', ar: 'نيبولا', en: 'Nebula', css: `
    .hl { color:#fff; text-shadow:0 4px 24px rgba(20,10,60,.55); }
    .hl .k { background:linear-gradient(100deg,#c7b8ff,#ff92d2); -webkit-background-clip:text; background-clip:text; color:transparent; filter:drop-shadow(0 0 18px rgba(185,166,255,.55)); }
    .hl .pad { background:rgba(20,16,50,.42); border:1.5px solid rgba(255,255,255,.18); backdrop-filter:blur(14px); border-radius:28px; padding:14px 30px; }` },
  { id: 'electric', ar: 'أزرق كهربائي', en: 'Electric Blue', css: `
    .hl { color:#fff; text-shadow:0 4px 24px rgba(0,10,40,.6); }
    .hl .k { background:linear-gradient(100deg,#7cc4ff,#33f0d0); -webkit-background-clip:text; background-clip:text; color:transparent; filter:drop-shadow(0 0 18px rgba(64,150,255,.6)); }
    .hl .pad { background:rgba(4,10,30,.5); border:1.5px solid rgba(124,196,255,.35); backdrop-filter:blur(14px); border-radius:28px; padding:14px 30px; }` },
  { id: 'coral', ar: 'كورال', en: 'Claude Coral', css: `
    .hl { color:#fff8f2; text-shadow:0 4px 24px rgba(40,15,5,.6); }
    .hl .k { background:linear-gradient(100deg,#ffb38a,#ff7a59); -webkit-background-clip:text; background-clip:text; color:transparent; }
    .hl .pad { background:rgba(30,14,8,.5); border:1.5px solid rgba(255,179,138,.35); backdrop-filter:blur(14px); border-radius:28px; padding:14px 30px; }` },
  { id: 'cream', ar: 'كريمي', en: 'Signature cream', css: `
    .hl { color:#16130f; }
    .hl .pad { background:#f3efe7; border-radius:22px; padding:14px 30px; box-shadow:0 18px 40px rgba(0,0,0,.35); }
    .hl .k { background:#ff5a1f; color:#fff; border-radius:12px; padding:0 .18em; }` },
  { id: 'tech', ar: 'داكن تقني', en: 'Dark tech', css: `
    .hl { color:#f2ece2; }
    .hl .pad { background:rgba(14,13,12,.82); border:2px solid rgba(242,236,226,.25); border-radius:10px; padding:14px 30px; }
    .hl .k { color:#f2ece2; box-shadow:inset 0 -.16em 0 #ff5a1f; }` },
  { id: 'swiss', ar: 'سويسري أحمر', en: 'Swiss red', css: `
    .hl { color:#fff; text-shadow:0 3px 0 rgba(0,0,0,.35), 0 8px 30px rgba(0,0,0,.45); letter-spacing:-.01em; }
    .hl .k { color:#ff3b2f; }
    .hl .pad { border-right:10px solid #cf1f17; padding:6px 26px 6px 0; }` },
] as const
export const TITLE_STYLE_IDS = ['nebula', 'electric', 'coral', 'cream', 'tech', 'swiss'] as const

/** Cairo (default) and the bundled title faces (runtime/looks.ts TITLE_FACES, index.html @font-face). */
export const TITLE_FONTS = [
  { id: 'cairo', ar: 'القاهرة', family: 'Cairo', weight: 900, file: 'cairo/Cairo-Variable.ttf', range: '200 1000' },
  { id: 'alexandria', ar: 'الإسكندرية', family: 'Alexandria', weight: 800, file: 'alexandria/Alexandria-Variable.ttf', range: '100 900' },
  { id: 'lalezar', ar: 'لاله‌زار', family: 'Lalezar', weight: 400, file: 'lalezar/Lalezar-Regular.ttf', range: '400' },
  { id: 'reem-kufi', ar: 'ريم كوفي', family: 'Reem Kufi', weight: 700, file: 'reem-kufi/ReemKufi-Variable.ttf', range: '400 700' },
  { id: 'aref-ruqaa', ar: 'عارف رقعة', family: 'Aref Ruqaa', weight: 700, file: 'aref-ruqaa/ArefRuqaa-Bold.ttf', range: '700' },
  { id: 'marhey', ar: 'مرحي', family: 'Marhey', weight: 700, file: 'marhey/Marhey-Variable.ttf', range: '300 700' },
] as const
export const TITLE_FONT_IDS = ['cairo', 'alexandria', 'lalezar', 'reem-kufi', 'aref-ruqaa', 'marhey'] as const

export const TITLE_IN = [
  { id: 'blur', ar: 'ظهور ناعم' }, { id: 'words', ar: 'كلمة كلمة' }, { id: 'pop', ar: 'قفزة' },
  { id: 'type', ar: 'ينكتب' }, { id: 'rise', ar: 'يطلع من ورا' },
] as const
export const TITLE_IN_IDS = ['blur', 'words', 'pop', 'type', 'rise'] as const
export const TITLE_OUT = [{ id: 'blur', ar: 'يختفي ناعم' }, { id: 'drop', ar: 'ينزل' }, { id: 'wipe', ar: 'يمسح' }, { id: 'pop', ar: 'ينكمش' }, { id: 'none', ar: 'يبقى' }] as const
export const TITLE_OUT_IDS = ['blur', 'drop', 'wipe', 'pop', 'none'] as const

const EASE = 'cubic-bezier(.2,.8,.2,1)'
const BOUNCE = 'cubic-bezier(.3,1.5,.5,1)'
const MOTION_CSS = `
.hl.in-blur .w { animation:mbat-blur .6s ${EASE} both; animation-delay:calc(var(--at) + var(--i) * .07s); }
.hl.in-words .w { animation:mbat-word .5s ${BOUNCE} both; animation-delay:calc(var(--at) + var(--i) * .16s); }
.hl.in-pop .in { animation:mbat-pop .55s ${BOUNCE} both; animation-delay:var(--at); }
.hl.in-type .in { animation:mbat-type .8s steps(14) both; animation-delay:var(--at); }
.hl.in-rise .in { animation:mbat-rise .7s ${EASE} both; animation-delay:var(--at); }
.hl.out-blur .o { animation:mbat-out-blur .4s ease both; animation-delay:var(--out); }
.hl.out-drop .o { animation:mbat-out-drop .45s cubic-bezier(.5,0,.75,0) both; animation-delay:var(--out); }
.hl.out-wipe .o { animation:mbat-out-wipe .45s ease-in both; animation-delay:var(--out); }
.hl.out-pop .o { animation:mbat-out-pop .35s ease-in both; animation-delay:var(--out); }
.hl[class*=" in-"] .pad { animation:mbat-boxin .35s ease both; animation-delay:var(--at); }
@keyframes mbat-boxin { from { opacity:0; transform:scale(.96) } to { opacity:1; transform:none } }
@keyframes mbat-blur { from { opacity:0; filter:blur(16px); transform:translateY(22px) } to { opacity:1; filter:none; transform:none } }
@keyframes mbat-word { from { opacity:0; transform:translateY(55%) scale(.85) } to { opacity:1; transform:none } }
@keyframes mbat-pop { 0% { opacity:0; transform:scale(.4) } 60% { opacity:1; transform:scale(1.08) } 100% { opacity:1; transform:scale(1) } }
@keyframes mbat-type { from { clip-path:inset(-20% 0 -20% 100%) } to { clip-path:inset(-20% 0 -20% 0) } }
@keyframes mbat-rise { from { opacity:0; transform:translateY(75%) } 30% { opacity:1 } to { opacity:1; transform:none } }
@keyframes mbat-out-blur { to { opacity:0; filter:blur(14px) } }
@keyframes mbat-out-drop { to { opacity:0; transform:translateY(60px) } }
@keyframes mbat-out-wipe { from { clip-path:inset(-20% 0 -20% 0) } to { clip-path:inset(-20% 100% -20% 0) } }
@keyframes mbat-out-pop { to { opacity:0; transform:scale(.6) } }
`
const FONT_CSS = TITLE_FONTS.map((f) => `.hl.f-${f.id} { font-family:'${f.family}',sans-serif; font-weight:${f.weight}; }`).join('\n')
/** Custom colours (class .cc + variables on the element) win over the style's own. */
const COLOR_CSS = `
.hl.cc { color:var(--c-text) !important; }
.hl.cc.ink, .hl.cc.ink .k { text-shadow:none !important; }
.hl.cc .k { background:linear-gradient(100deg,var(--c-k1),var(--c-k2)) !important; -webkit-background-clip:text !important; background-clip:text !important; color:transparent !important; box-shadow:none !important; padding:0 !important; border-radius:0 !important; filter:none !important; }
.hl.cc .pad { background:var(--c-box) !important; }
.hl.cc.behind .pad { background:none !important; }
`
const BASE_CSS = `
.hl { position:absolute; transform:translate(-50%,-50%); font-family:'Cairo',sans-serif; font-weight:900; line-height:1.25; text-align:center; direction:rtl; white-space:normal; --at:0.2s; --out:99s; }
.hl .pad, .hl .in, .hl .o, .hl .w { display:inline-block; }
.hl.one { white-space:nowrap; }
.hl.behind .pad { background:none !important; border:0 !important; box-shadow:none !important; backdrop-filter:none !important; padding:0 !important; }
.hl.behind { color:#fff !important; text-shadow:0 8px 40px rgba(0,0,0,.35); line-height:1.05; }
` + MOTION_CSS + FONT_CSS + COLOR_CSS

/** All the title CSS, every selector under `scope` (a class selector, or '' for a page). */
export function titleCss(scope = ''): string {
  const s = (css: string) => css.replace(/\.hl/g, `${scope} .hl`)
  return s(BASE_CSS) + TITLE_STYLES.map((st) => st.css.replace(/\.hl/g, `${scope} .hl.s-${st.id}`)).join('\n')
}

/** @font-face rules for a page that serves the engine's fonts under `base` (the engine page has its own). */
export const titleFontFaces = (base = '/fonts/') =>
  TITLE_FONTS.map((f) => `@font-face { font-family:'${f.family}'; src:url('${base}${f.file}') format('truetype'); font-weight:${f.range}; font-display:block; }`).join('\n')

export interface TitleColors { text: string; k1: string; k2: string; box: string; boxAlpha: number }
export interface TitleSpec {
  text: string
  key: string
  lines: 1 | 2
  style: (typeof TITLE_STYLE_IDS)[number]
  font: (typeof TITLE_FONT_IDS)[number]
  layer: 'front' | 'behind'
  /** Centre, as fractions of the frame; width, a fraction of the frame width; font px on the 1080 canvas. */
  cx: number
  cy: number
  w: number
  size: number
  animIn: (typeof TITLE_IN_IDS)[number]
  animOut: (typeof TITLE_OUT_IDS)[number]
  /** Local s the entrance starts and the exit starts. */
  at: number
  outAt: number
  colors?: TitleColors
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
export const hexAlpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(2)})`
}

/** Dark custom letters (a light ground) need no dark drop shadow: that is only there to lift light text off video. */
export const darkInk = (hex: string): boolean => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.3
}

/** The title element on the 1080 × 1920 canvas: one span per word (for word-by-word), the key word last. */
export function titleHtml(p: TitleSpec): string {
  let i = 0
  const span = (t: string, k = false) => `<span class="w${k ? ' k' : ''}" style="--i:${i++}">${esc(t)}</span>`
  const words = p.text.trim().split(/\s+/).filter(Boolean)
  const keys = p.key.trim().split(/\s+/).filter(Boolean)
  const inner = words.map((t) => span(t)).join(' ') + (keys.length ? (p.lines === 2 ? '<br>' : ' ') + keys.map((t) => span(t, true)).join(' ') : '')
  const cls = ['hl', `s-${p.style}`, p.layer === 'behind' ? 'behind' : '', p.lines === 2 ? 'two' : 'one', `f-${p.font}`, p.colors ? 'cc' : '', p.colors && darkInk(p.colors.text) ? 'ink' : '', `in-${p.animIn}`, p.animOut === 'none' ? '' : `out-${p.animOut}`].filter(Boolean).join(' ')
  const c = p.colors
  const vars = c ? `;--c-text:${c.text};--c-k1:${c.k1};--c-k2:${c.k2};--c-box:${hexAlpha(c.box, c.boxAlpha)}` : ''
  return `<div class="${cls}" style="left:${(p.cx * 1080).toFixed(1)}px;top:${(p.cy * 1920).toFixed(1)}px;width:${(p.w * 1080).toFixed(1)}px;font-size:${Math.round(p.size)}px;--at:${p.at}s;--out:${p.outAt}s${vars}"><span class="o"><span class="pad"><span class="in">${inner}</span></span></span></div>`
}
