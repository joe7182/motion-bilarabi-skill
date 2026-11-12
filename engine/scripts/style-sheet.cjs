// Builds media/style-packs.jpg: the picture the skill shows when it asks "which style?".
// One moment of the same script in every pack, numbered. Run from engine/: node scripts/style-sheet.cjs
// (builds the four storyboards itself, takes one still each, lays them out).
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const engine = path.join(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-style-sheet-'))
const run = (args) => execFileSync('npx', ['tsx', ...args], { cwd: engine, stdio: ['ignore', 'pipe', 'inherit'], shell: true }).toString()

// The packs, from the registry (name, number, one line).
const packs = JSON.parse(run(['-e', '"import(\'./src/packs/index.ts\').then(m=>console.log(JSON.stringify(m.packList().map(p=>({id:p.id,n:p.n,ar:p.ar,en:p.en})))))"']))
const builder = path.join(tmp, 'build.ts')
fs.writeFileSync(builder, `
import { writeFileSync } from 'node:fs'
import { beatTranscript, parsePreset, presetStoryboard } from ${JSON.stringify(path.join(engine, 'src/core/recipes/presets.ts').replace(/\\/g, '/'))}
const tr = beatTranscript('ثلاث حركات تخلي الفيديو احترافي. أولاً الحروف خلها متصلة دائماً. ثانياً التطويل الكشيدة تتمدد بهدوء. تبي القالب علّق موشن.', 120)
for (const id of ${JSON.stringify(packs.map((p) => p.id))}) {
  const sb = presetStoryboard({ preset: parsePreset({ preset: 'list', beat: { bpm: 120 }, pack: id,
    hook: { say: 'ثلاث حركات', text: 'الفيديو احترافي', box: 'احترافي' },
    items: [{ say: 'أولاً الحروف', title: 'الحروف', text: 'خلها متصلة', show: { kind: 'join', word: 'العربي' } }, { say: 'ثانياً التطويل', title: 'التطويل', show: { kind: 'stretch', word: 'تتمدد' } }],
    cta: { say: 'تبي القالب', text: 'علّق: موشن', box: 'موشن', keyword: 'موشن' } }), transcript: tr, fps: 30, seed: 3 })
  writeFileSync(${JSON.stringify(tmp.replace(/\\/g, '/'))} + '/' + id + '.json', JSON.stringify(sb))
}
`)
run([JSON.stringify(builder)])
for (const p of packs) run(['src/cli.ts', 'still', JSON.stringify(path.join(tmp, `${p.id}.json`)), '--t', '9', '--out', JSON.stringify(path.join(tmp, p.id))])

const font = path.join(engine, 'assets/fonts/cairo/Cairo-Variable.ttf').replace(/\\/g, '/')
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Cairo;src:url(file:///${font});font-weight:200 1000}
body{margin:0;width:${packs.length * 400 + 60}px;background:#16161a;color:#f2f0ea;font-family:Cairo;padding:26px 30px 30px;box-sizing:border-box}
.g{display:grid;grid-template-columns:repeat(${packs.length},1fr);gap:20px}
.c img{width:100%;display:block;border-radius:10px;aspect-ratio:9/13;object-fit:cover;object-position:50% 22%}
.n{display:flex;align-items:center;gap:12px;margin-top:12px;direction:rtl}
.n b{font-size:34px;font-weight:900;color:#16161a;background:#ff7a3d;border-radius:10px;width:50px;height:50px;display:flex;align-items:center;justify-content:center;flex:none}
.n span{font-size:24px;font-weight:800;line-height:1.2}.n small{display:block;font-size:15px;font-weight:400;color:#a9a6a0;direction:ltr;text-align:right}
</style><div class="g">${packs.map((p) => `<div class="c"><img src="file:///${path.join(tmp, p.id, 'still-9.png').replace(/\\/g, '/')}"><div class="n"><b>${p.n}</b><span>${p.ar}<small>${p.en}</small></span></div></div>`).join('')}</div>`
const page = path.join(tmp, 'sheet.html')
fs.writeFileSync(page, html)
const out = path.join(engine, '..', 'media', 'style-packs.jpg')
const shot = `const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:${packs.length * 400 + 60},height:700}});await p.goto(${JSON.stringify('file:///' + page.replace(/\\/g, '/'))});await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(400);await p.screenshot({path:${JSON.stringify(out)},fullPage:true,type:'jpeg',quality:86});await b.close()})()`
execFileSync('node', ['-e', shot], { cwd: engine, stdio: 'inherit' })
fs.rmSync(tmp, { recursive: true, force: true })
console.log('wrote', out)
