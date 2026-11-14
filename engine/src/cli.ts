import { parseArgs } from 'node:util'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadStoryboardFile, renderStills, renderVideo, startRuntimeServer } from './node/render'
import { createFrameServer } from './node/framesrv'
import { verifyDeterminism, verifyLoudness } from './node/verify'
import { buildReviewKit } from './node/review'
import { analyzeReferenceFull, fewCuts, loadStyleFile, sha1File, styleOf } from './node/reference'
import { compareVideos, parseUnits, type CompareUnits } from './node/compare'
import {
  addProjectMedia,
  findProjectFor,
  initProject,
  latestRender,
  nextCompareDir,
  nextReviewDir,
  nextVersion,
  openProject,
  PROJECT_EDIT,
  storyboardArg,
  type MediaRole,
} from './node/project'
import { ingestProject } from './node/ingest'
import { makeMatte, makePlate } from './node/matte'
import { transcribeMedia, TRANSCRIPT_FILE, whisperPromptArg } from './node/whisper'
import { explainProject } from './node/explain'
import { presetProject } from './node/preset'
import { doctorReport, runDoctor } from './node/doctor'
import { ToolMissingError } from './node/tools'
import { rmWithRetry, writeFileAtomic } from './node/fsx'
import { alignScript, parseScript, scriptPrompt } from './core/transcript'
import { FORMATS, type Format } from './core/types'
import { DEFAULT_FPS } from './core/project'
import { MAX_TRACK } from './core/storyboard'

/**
 * Render progress: in a terminal one line rewritten in place; otherwise (a log, or Claude reading
 * the output) one line per 10 %, so the output stays short.
 */
function writeProgress(done: number, total: number): void {
  if (process.stderr.isTTY) {
    process.stderr.write(`\r[${done}/${total}]`)
    return
  }
  const step = Math.max(1, Math.ceil(total / 10))
  if (done === total || done % step === 0) process.stderr.write(`[${done}/${total}] ${Math.round((done / total) * 100)}%\n`)
}

const USAGE = `الاستخدام — Usage:
  mba render <projectDir | storyboard.json> [--out out/video.mp4] [--fps 30|60] [--draft] [--chunk 10]
  mba still <projectDir | storyboard.json> --t 1.2,3.5 [--out out/stills]
  mba validate <projectDir | storyboard.json>
  mba verify <projectDir | storyboard.json> [--samples 1-5] [--budget 60]
  mba review <projectDir | storyboard.json | video.mp4> [--out review/r1]
  mba reference <video.mp4...> [--out refs/<name>] [--scene-thr 0.3] [--style style.json]
      (several videos: each goes to <out>/<name>; --style writes the style DNA of all of them)
  mba compare <reference.mp4> <projectDir | render.mp4> [--out dir] [--track N] [--units beats|scenes|shots|fixed:<s>] [--style style.json]
  mba compare <projectDir | render.mp4> --ref <reference.mp4> [same options]
      (--style adds an Adherence table; exit code 1 when a row is not ok)
      (default --out: <projectDir>/review/compare-<n>, or ./review/compare-<n> for a render file)
  mba preview <projectDir | storyboard.json>
  mba project init <dir> [media...] [--fps 30|60] [--format 9:16|16:9|1:1|4:5]   (no media: a script on a beat)
      (default 60 fps; 30 only when asked)
  mba project info <dir>
  mba project add <dir> <file> --kind music|sfx|voice
  mba ingest <projectDir>
  mba matte <projectDir> <mediaId> [--model selfie_segmenter.tflite]   (person matte for cutout scenes)
  mba board <projectDir | storyboard.json> [--port 4319]   (the review board: a still per moment with its words; the person writes notes or approves; saves notes.json)
  mba pick <projectDir> [--media mN] [--t s] [--title text] [--key word] [--faceless] [--port 4317]   (the style picker: style, font, colours, motion, drag the title on a frame of the clip, or on backgrounds when there is no clip; saves pick.json)
  mba dress <storyboard.json | projectDir> --pack <id|number> [--out file]   (put a style pack on a storyboard; fills only what it left open)
  mba recommend <projectDir> --from s --to s | "<sentence>" [--seconds s] [--top 3] [--pack id]   (the best concepts for a sentence, with ready scenes)
  mba record <recipe.json> [--out dir] [--only a,b]   (clean footage of a web tool, shot by shot: drags, slider sweeps, scrolls, typing)
  mba shot <url> <out.jpg> [--mobile] [--full] [--wait ms]   (a web page screenshot for a screen-mockup: desktop browser or phone)
  mba plate <projectDir> <mediaId> <photo-or-clip>   (optional: the empty scene from the same camera spot, for professional blow-away, clones, dolly, back focus)
  mba transcribe <projectDir> [--media m1]
  mba doctor
      (setup check: what is installed, and how to fix what is missing, by terminal or in the Claude app)
  mba preset <projectDir> [--preset preset.json] [--script script.txt [--bpm 120]]
      (--script: no voice, the script's words land on the beat)
      (a ready reel structure: preset.json + transcript → edit.json)
  mba explain <projectDir> [--brief brief.json] [--plan] [--force]
      (--plan writes plan.json only; without it a plan.json there is compiled, refused when the transcript changed unless --force)`

class UsageError extends Error {}

/** Seconds with at most 3 decimals, no trailing zeros (4.048, 1.45, 2). */
function fmtTime(t: number): string {
  return String(Number(t.toFixed(3)))
}

function usage(msg: string): never {
  throw new UsageError(msg)
}

async function main(argv: string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        out: { type: 'string' },
        fps: { type: 'string' },
        format: { type: 'string' },
        draft: { type: 'boolean' },
        chunk: { type: 'string' },
        t: { type: 'string' },
        samples: { type: 'string' },
        budget: { type: 'string' },
        'scene-thr': { type: 'string' },
        track: { type: 'string' },
        media: { type: 'string' },
        kind: { type: 'string' },
        model: { type: 'string' },
        mobile: { type: 'boolean' },
        full: { type: 'boolean' },
        wait: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        seconds: { type: 'string' },
        top: { type: 'string' },
        pack: { type: 'string' },
        brief: { type: 'string' },
        preset: { type: 'string' },
        script: { type: 'string' },
        bpm: { type: 'string' },
        ref: { type: 'string' },
        units: { type: 'string' },
        style: { type: 'string' },
        force: { type: 'boolean' },
        plan: { type: 'boolean' },
        port: { type: 'string' },
        title: { type: 'string' },
        key: { type: 'string' },
        only: { type: 'string' },
        faceless: { type: 'boolean' },
        // Hidden, test only: an ES module whose default export is the source of a browser function
        // returning test primitives (see tests/fixtures/test-primitives.js).
        'test-primitives': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    usage((e as Error).message)
  }
  const { values, positionals } = parsed
  const [command, sbArg, ...extra] = positionals
  if (values.help) {
    process.stdout.write(USAGE + '\n')
    return 0
  }
  if (!command) usage('أمر مفقود — Missing command')
  if (command === 'project') return projectCommand(values, positionals.slice(1))
  if (command === 'ingest') return ingestCommand(values, positionals.slice(1))
  if (command === 'transcribe') return transcribeCommand(values, positionals.slice(1))
  if (command === 'explain') return explainCommand(values, positionals.slice(1))
  if (command === 'preset') return presetCommand(values, positionals.slice(1))
  if (command === 'matte') {
    const [dir, id] = positionals.slice(1)
    if (!dir || !id) usage('الاستخدام: mba matte <projectDir> <mediaId> [--model file] — Usage: mba matte <projectDir> <mediaId> [--model file]')
    const out = await makeMatte(dir!, id!, (values.model as string | undefined) ?? undefined, (l) => process.stderr.write(l + '\n'))
    process.stdout.write(`قناع الشخص جاهز — Person matte written: ${out}\n`)
    return 0
  }
  if (command === 'board') {
    const target = positionals[1]
    if (!target) usage('الاستخدام: mba board <projectDir | storyboard.json> [--port 4319] — Usage: mba board <projectDir | storyboard.json> [--port 4319]')
    const { prepareBoard, serveBoard } = await import('./node/board')
    const data = await prepareBoard(target!, { log: (l) => process.stderr.write(l + '\n') })
    // the board closes once the notes are sent: the process ending is the signal to apply them
    return new Promise<number>((done) => {
      serveBoard(data, values.port ? Number(values.port) : 4319, (n, file) => {
        process.stdout.write(`انحفظت الملاحظات — notes saved: ${file}\n${n.approved ? 'approved: render' + (n.moments.length || n.general ? ' after applying the notes' : '') : 'notes to apply'}: ${n.moments.length} moment note(s)${n.general ? ' + a general note' : ''}\n`)
        done(0)
      }).then((url) => process.stdout.write(`لوحة المراجعة جاهزة — Review board ready: ${url}\nتنغلق لما تنرسل الملاحظات — closes once the notes are sent (${data.dir}\\notes.json)\n`), (e) => { process.stderr.write(String(e) + '\n'); done(1) })
    })
  }
  if (command === 'pick') {
    const dir = positionals[1]
    if (!dir) usage('الاستخدام: mba pick <projectDir> [--media mN] [--t ثواني] [--title "العنوان"] [--key "الكلمة"] [--faceless] [--port 4317] — Usage: mba pick <projectDir> [--media mN] [--t s] [--title text] [--key word] [--faceless] [--port 4317]')
    const { preparePick, servePick } = await import('./node/pick')
    const log = (l: string) => process.stderr.write(l + '\n')
    const data = await preparePick(dir!, { faceless: values.faceless === true, media: values.media as string | undefined, ...(values.t ? { t: Number(values.t) } : {}), title: values.title as string | undefined, key: values.key as string | undefined, log })
    // the picker closes once a choice is saved: the process ending is the signal to use it
    return new Promise<number>((done) => {
      servePick(data, values.port ? Number(values.port) : 4317, (file) => {
        process.stdout.write(`انحفظ الاختيار — pick saved: ${file}\n`)
        done(0)
      }).then((url) => process.stdout.write(`منتقي الستايل جاهز — Style picker ready: ${url}\nينغلق لما ينحفظ الاختيار — closes once a pick is saved (${data.project}\\pick.json)\n`), (e) => { process.stderr.write(String(e) + '\n'); done(1) })
    })
  }
  if (command === 'recommend') {
    const target = positionals[1]
    if (!target) usage('الاستخدام: mba recommend <projectDir> --from s --to s | mba recommend "جملة" [--seconds s] — Usage: mba recommend <projectDir> --from s --to s, or a sentence')
    const { recommendCommand } = await import('./node/recommend')
    const num = (v: unknown) => (v === undefined ? undefined : Number(v))
    process.stdout.write(recommendCommand(target!, { from: num(values.from), to: num(values.to), seconds: num(values.seconds), top: num(values.top), pack: values.pack as string | undefined }) + '\n')
    return 0
  }
  if (command === 'dress') {
    const target = positionals[1]
    if (!target || !values.pack) usage('الاستخدام: mba dress <storyboard.json | projectDir> --pack <اسم أو رقم> [--out file] — Usage: mba dress <storyboard.json | projectDir> --pack <id or number> [--out file]')
    const { dressCommand } = await import('./node/dress')
    const r = dressCommand(target!, { pack: values.pack as string, out: values.out as string | undefined })
    const body = r.changes.length ? `${r.changes.map((c) => `  + ${c}`).join('\n')}\nكُتب — written: ${r.file}` : 'ما في شي يتغيّر — nothing to change'
    process.stdout.write(`الستايل — pack: ${r.pack}\n${body}\n`)
    return 0
  }
  if (command === 'record') {
    const recipe = positionals[1]
    if (!recipe) usage('الاستخدام: mba record <recipe.json> [--out مجلد] [--only لقطة،لقطة] — Usage: mba record <recipe.json> [--out dir] [--only a,b]')
    const { record } = await import('./node/record')
    const r = await record(recipe!, { ...(values.out ? { out: values.out as string } : {}), ...(values.only ? { only: String(values.only).split(',').map((x) => x.trim()).filter(Boolean) } : {}), log: (l) => process.stderr.write(l + '\n') })
    process.stdout.write(`التسجيل جاهز — Recording written: ${r.video}\n${r.spans.map((x) => `  ${x.name}: ${x.from}–${x.to}s`).join('\n')}\n`)
    return 0
  }
  if (command === 'shot') {
    const [url, out] = positionals.slice(1)
    if (!url || !out) usage('الاستخدام: mba shot <رابط> <صورة.jpg> [--mobile] [--full] [--wait ms] — Usage: mba shot <url> <out.jpg> [--mobile] [--full] [--wait ms]')
    const { takeShot } = await import('./node/shot')
    const r = await takeShot(url!, out!, { mobile: values.mobile === true, full: values.full === true, ...(values.wait ? { wait: Number(values.wait) } : {}) })
    process.stdout.write(`لقطة الشاشة جاهزة — Screenshot written: ${r.file} (${r.w}×${r.h})\n`)
    return 0
  }
  if (command === 'plate') {
    const [dir, id, file] = positionals.slice(1)
    if (!dir || !id || !file) usage('الاستخدام: mba plate <projectDir> <mediaId> <صورة المكان فاضي> — Usage: mba plate <projectDir> <mediaId> <empty-scene photo or clip>')
    const out = await makePlate(dir!, id!, file!, (l) => process.stderr.write(l + '\n'))
    process.stdout.write(`خلفية المكان جاهزة — Clean plate written: ${out}\n`)
    return 0
  }
  if (command === 'doctor') {
    const r = doctorReport(await runDoctor())
    process.stdout.write(r.text + '\n')
    return r.ok ? 0 : 1
  }
  if (command === 'compare') return compareCommand(values, positionals.slice(1))
  if (!['render', 'still', 'validate', 'preview', 'verify', 'review', 'reference'].includes(command)) usage(`أمر غير معروف — Unknown command: ${command}`)
  if (values.track !== undefined) usage('الخيار --track خاص بالأمر compare — --track is only valid with compare')
  for (const k of ['ref', 'units'] as const) {
    if (values[k] !== undefined) usage(`الخيار --${k} خاص بالأمر compare — --${k} is only valid with compare`)
  }
  if (values.style !== undefined && command !== 'reference') usage('الخيار --style خاص بالأمر reference أو compare — --style is only valid with reference or compare')
  if (values.format !== undefined) usage('الخيار --format خاص بالأمر project init — --format is only valid with project init')
  if (values.media !== undefined) usage('الخيار --media خاص بالأمر transcribe — --media is only valid with transcribe')
  if (values.kind !== undefined) usage('الخيار --kind خاص بالأمر project add — --kind is only valid with project add')
  for (const k of ['preset', 'script', 'bpm'] as const) if (values[k] !== undefined) usage(`الخيار --${k} خاص بالأمر preset — --${k} is only valid with preset`)
  if (values.brief !== undefined || values.force !== undefined || values.plan !== undefined) {
    const k = values.brief !== undefined ? 'brief' : values.force !== undefined ? 'force' : 'plan'
    usage(`الخيار --${k} خاص بالأمر explain — --${k} is only valid with explain`)
  }
  if (!sbArg) {
    usage(
      command === 'review'
        ? 'ملف القصة أو الفيديو مفقود — Missing <storyboard.json | video.mp4>'
        : command === 'reference'
          ? 'ملف الفيديو المرجعي مفقود — Missing <video.mp4>'
          : 'ملف القصة مفقود — Missing <storyboard.json>',
    )
  }
  if (extra.length && command !== 'reference') usage(`وسائط زائدة — Unexpected arguments: ${extra.join(' ')}`)
  if (command !== 'verify') {
    if (values.samples !== undefined) usage('الخيار --samples خاص بالأمر verify — --samples is only valid with verify')
    if (values.budget !== undefined) usage('الخيار --budget خاص بالأمر verify — --budget is only valid with verify')
    if (values['test-primitives'] !== undefined) {
      usage('الخيار --test-primitives خاص بالأمر verify — --test-primitives is only valid with verify')
    }
  }

  if (command === 'review' || command === 'reference') {
    for (const k of ['fps', 'draft', 't'] as const) {
      if (values[k] !== undefined) usage(`الخيار --${k} غير صالح مع ${command} — --${k} is not valid with ${command}`)
    }
  }
  if (command !== 'render' && values.chunk !== undefined) usage('الخيار --chunk خاص بالأمر render — --chunk is only valid with render')
  if (command !== 'reference' && values['scene-thr'] !== undefined) {
    usage('الخيار --scene-thr خاص بالأمر reference — --scene-thr is only valid with reference')
  }

  // A project folder stands for its edit.json (a folder without mba-project.json is refused).
  const sbPath = command === 'reference' ? sbArg : await storyboardArg(sbArg)

  switch (command) {
    case 'review': {
      const isStoryboard = /\.json$/i.test(sbPath)
      // In a project the kit goes to the next <project>/review/r<N>, so earlier kits are kept.
      const project = values.out === undefined && isStoryboard ? await findProjectFor(sbPath) : null
      const out = resolve(values.out ?? (project ? join(project.dir, nextReviewDir(project)) : 'review/r1'))
      let shown = false
      const m = await buildReviewKit({
        ...(isStoryboard ? { storyboardPath: sbPath } : { videoPath: sbPath }),
        outDir: out,
        onProgress: (done, total) => {
          shown = true
          writeProgress(done, total)
        },
      }).finally(() => {
        if (shown) process.stderr.write('\n')
      })
      const s =(x: number) => `${fmtTime(x)} s`
      const issues = m.audit ? m.audit.reduce((a, x) => a + x.issues.length, 0) : null
      const lines = [
        `مراجعة الفيديو — Review: ${s(m.duration)}, ${m.fps} fps, ${m.format}`,
        `إطارات شبه فارغة — Near-blank frames: ${m.nearBlankTimes.length}${m.frame0Blank ? ' (الإطار الأول فارغ — frame 0 is blank)' : ''}`,
        `أطول ثبات — Longest static: ${s(m.longestStatic)}`,
        `أطول فجوة بين الأحداث — Max event gap: ${s(m.maxEventGap)}`,
        `الإيقاع — Pace: eventsPerSec ${fmtTime(m.eventsPerSec)}, medianEventGap ${s(m.medianEventGap)}, moving ${fmtTime(m.movingPct * 100)} %`,
        issues === null
          ? 'مشاكل النص — Audit issues: n/a (video input)'
          : `مشاكل النص — Audit issues: ${issues} (in ${m.audit!.filter((a) => a.issues.length).length} of ${m.audit!.length} samples)`,
        ...m.notes.map((n) => `ملاحظة — Note: ${n}`),
        `مجلد المراجعة — Review kit: ${out}`,
      ]
      // The delivery gate: a blank opening frame, a blank run over 0.2 s that no transition drew,
      // or any text audit issue fails the review (exit 1, verdict.json lists why).
      const problems: string[] = []
      if (m.frame0Blank) problems.push('frame 0 is blank')
      for (const r of m.nearBlankRuns) if (!r.designed && r.end - r.start > 0.2) problems.push(`blank frames ${fmtTime(r.start)}–${fmtTime(r.end)} s`)
      if (issues) problems.push(`${issues} text audit issue(s)`)
      await writeFileAtomic(join(out, 'verdict.json'), JSON.stringify({ pass: problems.length === 0, problems }, null, 2) + '\n')
      lines.push(problems.length ? `✗ لم تنجح المراجعة — Review failed: ${problems.join('; ')}` : '✓ نجحت المراجعة — Review passed')
      process.stdout.write(lines.join('\n') + '\n')
      return problems.length ? 1 : 0
    }
    case 'reference': {
      let sceneThr: number | undefined
      if (values['scene-thr'] !== undefined) {
        sceneThr = Number(values['scene-thr'])
        if (values['scene-thr'].trim() === '' || !(sceneThr > 0 && sceneThr < 1)) {
          usage(`قيمة --scene-thr يجب أن تكون بين 0 و 1 — --scene-thr must be a number between 0 and 1, got ${values['scene-thr']}`)
        }
      }
      const inputs = [sbPath, ...extra]
      const nameOf = (p: string) => basename(p, extname(p)).trim().replace(/\s+/g, '-') || 'reference'
      // Default: refs/<video name>, whitespace collapsed (Windows drops trailing spaces in folder names).
      // Several videos: each in its own folder (a repeated name gets -2, -3, …).
      const used = new Map<string, number>()
      const outs = inputs.map((p) => {
        const n = nameOf(p)
        const k = (used.get(n) ?? 0) + 1
        used.set(n, k)
        const name = k > 1 ? `${n}-${k}` : n
        return resolve(inputs.length === 1 ? (values.out ?? `refs/${name}`) : join(values.out ?? 'refs', name))
      })
      const s = (x: number) => `${fmtTime(x)} s`
      const analyses: { analysis: Awaited<ReturnType<typeof analyzeReferenceFull>>; file: string; sha1: string }[] = []
      for (const [i, video] of inputs.entries()) {
        const analysis = await analyzeReferenceFull({ videoPath: video, outDir: outs[i]!, ...(sceneThr !== undefined ? { sceneThr } : {}) })
        const r = analysis.report
        const lines = [
          `مرجع الفيديو — Reference: ${s(r.duration)}, ${r.fps} fps, ${r.w}x${r.h}`,
          `القطعات — Cuts: ${r.cuts.length} (scene > ${r.sceneThr})${r.cuts.length ? ` at ${r.cuts.map(fmtTime).join(', ')} s` : ''}`,
          `طول اللقطة — Shot length: avg ${s(r.avgShot)}, median ${s(r.medianShot)}`,
          `الإيقاع — Pace: eventsPerSec ${fmtTime(r.eventsPerSec)}, medianEventGap ${s(r.medianEventGap)}, maxEventGap ${s(r.maxEventGap)}`,
          `الحركة — Moving: ${fmtTime(r.movingPct * 100)} %, longest static ${s(r.longestStatic)}`,
          ...(fewCuts(r.cuts.length, r.duration, r.eventsPerSec)
            ? ['ملاحظة — Note: few hard cuts; the reference relies on continuous motion and morphs']
            : []),
          `مجلد المرجع — Reference kit: ${outs[i]}`,
        ]
        process.stdout.write(lines.join('\n') + '\n')
        if (values.style !== undefined) analyses.push({ analysis, file: basename(video), sha1: await sha1File(resolve(video)) })
      }
      if (values.style !== undefined) {
        const style = styleOf(analyses)
        const stylePath = resolve(values.style)
        await mkdir(dirname(stylePath), { recursive: true })
        await writeFileAtomic(stylePath, JSON.stringify(style, null, 2) + '\n')
        const [elo, ehi] = style.rhythm.eventsPerSec
        const [glo, ghi] = style.rhythm.medianEventGap
        const unknown = (v: unknown, f: (x: never) => string) => (v === null || v === 'unknown' ? 'غير معروف — unknown' : f(v as never))
        const lines = [
          `الأسلوب — Style (${style.sources.length} source${style.sources.length > 1 ? 's' : ''}): ${stylePath}`,
          `الإيقاع — Rhythm: events/s ${fmtTime(elo)}–${fmtTime(ehi)}, median gap ${fmtTime(glo)}–${fmtTime(ghi)} s, max gap ${s(style.rhythm.maxEventGap)}, moving ${fmtTime(style.rhythm.movingPct * 100)} %`,
          `القطعات — Cuts: ${unknown(style.rhythm.continuous, (c: boolean) => (c ? 'حركة متصلة — continuous (few cuts)' : 'قطعات — cut-driven'))}${style.rhythm.cutsPerSec === null ? '' : `, ${fmtTime(style.rhythm.cutsPerSec)}/s`}`,
          `الألوان — Colours: ${style.colours.map((c) => `${c.hex} ${c.role} ${fmtTime(c.share * 100)} %`).join(', ') || 'none'}`,
          `كثافة النص — Text density: ${unknown(style.text.density, (d: string) => d)}`,
          `حجم الحركة — Motion size: ${unknown(style.motion.size, (d: string) => d)}`,
          'ملاحظة — Note: signature is empty; the distinctive moves are for the watcher to name after looking at frames.jpg',
          ...style.warnings.map((w) => `تنبيه — Warning: ${w}`),
        ]
        process.stdout.write(lines.join('\n') + '\n')
      }
      return 0
    }
    case 'validate': {
      try {
        const loaded = await loadStoryboardFile(sbPath)
        for (const w of loaded.warnings) process.stderr.write(`تنبيه — Warning: ${w}\n`)
        // Advice only: a storyboard that strays from its pack is still valid.
        const { packLint } = await import('./packs/lint')
        const notes = packLint(loaded.sb)
        if (notes.length) process.stderr.write(`ملاحظات الستايل (نصيحة بس، اختيارك يمشي) — Style notes (advice only, your pick stands):\n${notes.map((n) => `  ${n.at.toFixed(2)} s · ${n.message}`).join('\n')}\n`)
      } catch (e) {
        process.stdout.write(`${(e as Error).message}\n`)
        return 1
      }
      process.stdout.write('OK\n')
      return 0
    }
    case 'render': {
      const fps = parseFps(values.fps)
      let chunkSec: number | undefined
      if (values.chunk !== undefined) {
        chunkSec = Number(values.chunk)
        if (values.chunk.trim() === '' || !(Number.isFinite(chunkSec) && chunkSec > 0)) {
          usage(`قيمة --chunk يجب أن تكون عدد ثوانٍ موجبًا — --chunk must be a positive number of seconds, got ${values.chunk}`)
        }
      }
      const storyboard = sbPath
      const project = await findProjectFor(storyboard)
      if (project && values.out !== undefined) {
        usage('الخيار --out غير صالح في مشروع: الناتج هو الإصدار التالي في renders — --out is not valid in a project: the output is the next version in renders/')
      }
      if (!project && chunkSec !== undefined) usage('الخيار --chunk خاص بعرض مشروع — --chunk is only valid when rendering a project')
      // Progress stays on one line (\r); other lines start on a fresh one.
      let onProgressLine = false
      const line = (text: string) => {
        process.stderr.write(`${onProgressLine ? '\n' : ''}${text}\n`)
        onProgressLine = false
      }
      const res = await renderVideo({
        storyboardPath: storyboard,
        ...(project ? {} : { outPath: resolve(values.out ?? 'out/video.mp4') }),
        fps,
        draft: values.draft ?? false,
        ...(chunkSec !== undefined ? { chunkSec } : {}),
        onStart: (st) => {
          if (st.version) {
            line(st.resumed ? `استئناف ${st.version} — resuming ${st.version}` : `الإصدار ${st.version} — version ${st.version}`)
          }
        },
        onChunk: (e) => {
          if (e.skipped) line(`القطعة ${e.index + 1}/${e.count} منجزة سابقًا، تُخطّت — chunk ${e.index + 1}/${e.count} already done, skipped`)
        },
        onEta: (text) => line(text),
        onWarning: (w) => line(`تنبيه — Warning: ${w}`),
        onProgress: (done, total) => {
          onProgressLine = true
          writeProgress(done, total)
        },
      }).finally(() => {
        if (onProgressLine) process.stderr.write('\n')
      })
      process.stdout.write(`${res.outPath}\n`)
      // a seamless loop: measure the seam (the first frame against the last one)
      if ((JSON.parse(readFileSync(storyboard, 'utf8')) as { loop?: boolean }).loop === true) {
        const { loopSeam } = await import('./node/loop-seam')
        const seam = loopSeam(res.outPath)
        const db = Number.isFinite(seam.db) ? `${seam.db.toFixed(1)} dB` : 'identical'
        process.stdout.write(
          seam.ok
            ? `نقطة اللف نظيفة — loop seam OK: the first and last frames match (${db})\n`
            : `تنبيه — Warning: نقطة اللف تبين — the loop seam shows: the first and last frames differ (${db}); end on the same picture the video starts with\n`,
        )
      }
      return 0
    }
    case 'still': {
      if (!values.t) usage('الخيار --t مطلوب — --t is required, e.g. --t 1.2,3.5')
      const times = values.t.split(',').map((s) => s.trim())
      const nums = times.map(Number)
      const bad = times.filter((s, i) => s === '' || !Number.isFinite(nums[i]) || nums[i]! < 0)
      if (bad.length) usage(`أوقات غير صالحة — Invalid --t values: ${bad.join(', ') || '(empty)'}`)
      const paths = await renderStills({ storyboardPath: sbPath, times: nums, outDir: resolve(values.out ?? 'out/stills') })
      for (const p of paths) process.stdout.write(`${p}\n`)
      return 0
    }
    case 'verify': {
      let samples: number | undefined
      if (values.samples !== undefined) {
        if (!/^[1-5]$/.test(values.samples)) usage(`قيمة --samples يجب أن تكون من 1 إلى 5 — --samples must be an integer from 1 to 5, got ${values.samples}`)
        samples = Number(values.samples)
      }
      let probeBudget: number | undefined
      if (values.budget !== undefined) {
        if (!/^[1-9]\d*$/.test(values.budget)) usage(`قيمة --budget يجب أن تكون عددًا صحيحًا موجبًا — --budget must be a positive integer, got ${values.budget}`)
        probeBudget = Number(values.budget)
      }
      let testPrimitivesSource: string | undefined
      const tpPath = values['test-primitives']
      if (tpPath !== undefined) {
        const abs = resolve(tpPath)
        if (!existsSync(abs) || !statSync(abs).isFile()) {
          usage(`لم يتم العثور على ملف الأنماط التجريبية — Test primitives module not found: ${abs}`)
        }
        const mod = (await import(pathToFileURL(abs).href)) as { default?: unknown }
        const def = mod.default
        if (typeof def === 'string') testPrimitivesSource = def
        else if (typeof def === 'function') testPrimitivesSource = def.toString()
        else {
          usage(`ملف الأنماط التجريبية لا يصدّر نصًا افتراضيًا — The test primitives module must default-export a function source string: ${abs}`)
        }
      }
      let shown = false
      const r = await verifyDeterminism({
        storyboardPath: sbPath,
        ...(samples !== undefined ? { samplesPerScene: samples } : {}),
        ...(probeBudget !== undefined ? { probeBudget } : {}),
        ...(testPrimitivesSource !== undefined ? { testPrimitivesSource } : {}),
        onProgress: (done, total) => {
          shown = true
          writeProgress(done, total)
        },
      }).finally(() => {
        if (shown) process.stderr.write('\n')
      })
      const n = r.probes.length
      const cost = `(${n} probes of a budget of ${r.probeBudget}, ${r.wallSec.toFixed(1)} s)`
      // Check `loudness`: the newest render of a project (a plain storyboard has none).
      const project = await findProjectFor(sbPath)
      const loud = project ? await verifyLoudness(project) : null
      const loudLine = loud ? `${loud.message}${loud.file ? ` (${loud.file})` : ''}\n` : ''
      if (r.mismatches.length === 0 && r.pageErrors.length === 0) {
        process.stdout.write(`التحقق من الحتمية — Determinism check: OK — ${n} probes identical ${cost}\n${loudLine}`)
        return loud && !loud.ok ? 1 : 0
      }
      process.stdout.write(loudLine)
      if (r.mismatches.length > 0) {
        process.stdout.write(
          `التحقق من الحتمية: إطارات غير متطابقة — Determinism check: FAILED — ${r.mismatches.length} of ${n} probes differ (cold vs warm)\n`,
        )
      } else {
        process.stdout.write(
          `التحقق من الحتمية: أخطاء في صفحة العرض — Determinism check: FAILED — ${n} probes identical, but the page logged ${r.pageErrors.length} page error(s)\n`,
        )
      }
      for (const m of r.mismatches) {
        process.stdout.write(
          m.unstable && m.diffPixels === 0
            ? `scene ${m.sceneId} @ ${fmtTime(m.t)}s: cold frame unstable (redraw differed)\n`
            : `scene ${m.sceneId} @ ${fmtTime(m.t)}s: ${m.diffPixels} px differ (max Δ ${m.maxChannelDelta})${m.unstable ? '; cold frame unstable (redraw differed)' : ''}\n`,
        )
        process.stdout.write(`  cold: ${m.coldPng}\n  warm: ${m.warmPng}\n`)
      }
      for (const e of r.pageErrors) process.stdout.write(`page error: ${e}\n`)
      process.stdout.write(`${cost}\n`)
      return 1
    }
    case 'preview': {
      // Fail up front (missing file, bad JSON, schema or params error) instead of serving a page
      // that can only show the error. The server still re-reads the file on every page load.
      let loaded: Awaited<ReturnType<typeof loadStoryboardFile>>
      try {
        loaded = await loadStoryboardFile(sbPath)
        for (const w of loaded.warnings) process.stderr.write(`تنبيه — Warning: ${w}
`)
      } catch (e) {
        const msg = (e as Error).message
        throw new Error(/[؀-ۿ]/.test(msg) ? msg : `ملف القصة غير صالح — Invalid storyboard: ${msg}`)
      }
      // A project storyboard (R1): video frames are extracted on demand as the preview asks for them.
      const frames = loaded.project ? createFrameServer(loaded.project, { session: true }) : undefined
      const { server, url } = await startRuntimeServer(5173, sbPath, frames)
      process.stdout.write(`${url}?sb=/__sb.json\n`)
      const stop = () => {
        void server
          .close()
          .then(() => frames?.release())
          .finally(() => process.exit(0))
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      await new Promise<never>(() => {})
    }
  }
  return 0
}

/** Parses --fps (30 or 60). */
function parseFps(v: string | undefined): 30 | 60 | undefined {
  if (v === undefined) return undefined
  if (v !== '30' && v !== '60') usage(`قيمة --fps يجب أن تكون 30 أو 60 — --fps must be 30 or 60, got ${v}`)
  return Number(v) as 30 | 60
}

/** `mba project init <dir> <media...> [--fps] [--format]`, `mba project info <dir>` and `mba project add <dir> <file> --kind`. */
async function projectCommand(values: Record<string, string | boolean | undefined>, args: string[]): Promise<number> {
  const [sub, dir, ...rest] = args
  if (sub !== 'init' && sub !== 'info' && sub !== 'add') usage(`أمر فرعي غير معروف — Unknown project subcommand: ${sub ?? '(none)'}; use init, info or add`)
  const allowed = sub === 'init' ? ['fps', 'format'] : sub === 'add' ? ['kind'] : []
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && !allowed.includes(k)) usage(`الخيار --${k} غير صالح مع project ${sub} — --${k} is not valid with project ${sub}`)
  }
  if (!dir) usage('مجلد المشروع مفقود — Missing <dir>')
  const s = (x: number) => `${fmtTime(x)} s`
  const dur = (d: number | undefined) => (d !== undefined ? s(d) : '?')

  if (sub === 'init') {
    const fps = parseFps(values.fps as string | undefined)
    const fmt = values.format as string | undefined
    if (fmt !== undefined && !(FORMATS as readonly string[]).includes(fmt)) {
      usage(`قيمة --format غير صالحة — --format must be one of ${FORMATS.join(', ')}, got ${fmt}`)
    }
    const p = await initProject({ dir, media: rest, fps: fps ?? DEFAULT_FPS, ...(fmt ? { format: fmt as Format } : {}) })
    const total = p.manifest.media.reduce((a, m) => a + (m.durationSec ?? 0), 0)
    const lines = [
      `تم إنشاء المشروع — Project created: ${p.dir}`,
      `المقاس — Format: ${p.manifest.format}, ${p.manifest.fps} fps`,
      ...p.manifest.media.map((m) => `  ${m.id}  ${m.source}  ${dur(m.durationSec)}`),
      `المدة الكلية — Total: ${s(total)}`,
      'نُسخت الأصول للقراءة فقط إلى source/ — Originals copied read-only into source/',
    ]
    process.stdout.write(lines.join('\n') + '\n')
    return 0
  }

  if (sub === 'add') {
    const [file, ...more] = rest
    if (!file) usage('الملف مفقود — Missing <file>')
    if (more.length) usage(`وسائط زائدة — Unexpected arguments: ${more.join(' ')}`)
    const kind = values.kind as string | undefined
    if (kind !== 'music' && kind !== 'sfx' && kind !== 'voice') {
      usage(`قيمة --kind يجب أن تكون music أو sfx أو voice — --kind must be music, sfx or voice, got ${kind ?? '(none)'}`)
    }
    const { project, id } = await addProjectMedia(dir, file, kind as MediaRole)
    const m = project.manifest.media.find((x) => x.id === id)!
    const lines = [
      `أُضيفت المادة — Added: ${id}  ${m.source}  ${dur(m.durationSec)}  (${kind})`,
      `جهّزها بـ mba ingest ثم أضفها إلى audio في edit.json — Run mba ingest, then place it in edit.json audio[], e.g. { "kind": "${kind}", "media": "${id}" }`,
    ]
    process.stdout.write(lines.join('\n') + '\n')
    return 0
  }

  if (rest.length) usage(`وسائط زائدة — Unexpected arguments: ${rest.join(' ')}`)
  const p = await openProject(dir)
  const total = p.manifest.media.reduce((a, m) => a + (m.durationSec ?? 0), 0)
  const lines = [
    `المشروع — Project: ${p.dir}`,
    `المقاس — Format: ${p.manifest.format}, ${p.manifest.fps} fps`,
    `المواد — Media: ${p.manifest.media.length}`,
    ...p.manifest.media.map((m) => {
      const hasWork = m.work !== undefined && existsSync(join(p.dir, m.work))
      const work = hasWork ? `نسخة العمل موجودة — working copy: ${m.work}` : 'لا توجد نسخة عمل — working copy: none'
      const role = m.role ? `  (${m.role})` : ''
      return `  ${m.id}  ${m.source}  ${dur(m.durationSec)}${role}  ${work}`
    }),
    `المدة الكلية — Total: ${s(total)}`,
    `الإصدار التالي — Next version: ${nextVersion(p, 'draft')}`,
  ]
  process.stdout.write(lines.join('\n') + '\n')
  return 0
}

/** `mba ingest <projectDir>`: one Arabic + English line per media on stdout, progress on stderr. */
async function ingestCommand(values: Record<string, string | boolean | undefined>, args: string[]): Promise<number> {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) usage(`الخيار --${k} غير صالح مع ingest — --${k} is not valid with ingest`)
  }
  const [dir, ...rest] = args
  if (!dir) usage('مجلد المشروع مفقود — Missing <projectDir>')
  if (rest.length) usage(`وسائط زائدة — Unexpected arguments: ${rest.join(' ')}`)
  const p = await openProject(dir)
  let shown = ''
  const results = await ingestProject(p, {
    onProgress: (e) => {
      if (e.phase !== 'encoding') return
      // At most one line per 10 % step and media.
      const line = `${e.id} (${e.index + 1}/${e.count}) ${Math.floor(e.fraction * 10) * 10}%`
      if (line !== shown) process.stderr.write(`تجهيز — ingesting ${line}\n`)
      shown = line
    },
  })
  const lines = [`نسخ العمل — Working copies: ${p.dir} (${p.manifest.fps} fps)`]
  for (const r of results) {
    const found = r.issues.length ? r.issues.join('؛ ') : 'لا مشكلات — no issues'
    const done =
      r.status === 'up-to-date'
        ? `محدّثة — up to date: ${r.work}`
        : r.info.hasVideo
          ? `جُهّزت — done: ${r.work} (${r.workInfo.w}×${r.workInfo.h}, ${p.manifest.fps} fps${r.hdrPath ? `, HDR→SDR: ${r.hdrPath}` : ''})`
          : `جُهّزت — done: ${r.work} (صوت 48 kHz — audio 48 kHz)`
    lines.push(`  ${r.id} ${r.source}: ${found} → ${done}`)
  }
  process.stdout.write(lines.join('\n') + '\n')
  return 0
}

/**
 * `mba transcribe <projectDir> [--media m1]`: whisper.cpp word timings → transcript.json. With a
 * `script.md` in the project, its stress/pause markup is aligned and written to marks.json, and
 * script words not heard in the voice are listed (Arabic first). Default media: the first audio one.
 */
async function transcribeCommand(values: Record<string, string | boolean | undefined>, args: string[]): Promise<number> {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && k !== 'media') usage(`الخيار --${k} غير صالح مع transcribe — --${k} is not valid with transcribe`)
  }
  const [dir, ...rest] = args
  if (!dir) usage('مجلد المشروع مفقود — Missing <projectDir>')
  if (rest.length) usage(`وسائط زائدة — Unexpected arguments: ${rest.join(' ')}`)
  const p = await openProject(dir)
  const media = p.manifest.media
  const mediaId = typeof values.media === 'string' ? values.media : (media.find((m) => m.kind === 'audio') ?? media[0])?.id
  if (!mediaId) usage('لا توجد مواد في المشروع — The project has no media')
  let shown = -1
  const scriptFile = join(p.dir, 'script.md')
  // M3: the script's words steer whisper's spelling (offline; nothing leaves the machine).
  const prompt = existsSync(scriptFile) ? scriptPrompt(await readFile(scriptFile, 'utf8')) : undefined
  const t = await transcribeMedia(p, mediaId, {
    ...(prompt ? { prompt } : {}),
    onProgress: (f) => {
      // At most one line per 10 % step.
      const step = Math.floor(f * 10) * 10
      if (step !== shown) process.stderr.write(`تفريغ — transcribing ${mediaId} ${step}%\n`)
      shown = step
    },
  })
  const lines = [`التفريغ — Transcript: ${join(p.dir, TRANSCRIPT_FILE)} (${t.words.length} كلمة — words, ${t.model}${prompt && whisperPromptArg(prompt) ? ', script.md as --prompt' : ''})`]
  if (prompt && !whisperPromptArg(prompt)) {
    lines.push('  لم يُمرَّر النص إلى whisper (صفحة الترميز لا تحمل العربية) — script.md was not passed as --prompt: this Windows code page cannot carry Arabic to whisper-cli')
  }
  const marksFile = join(p.dir, 'marks.json')
  if (existsSync(scriptFile)) {
    const warnings: string[] = []
    const marks = alignScript(parseScript(await readFile(scriptFile, 'utf8'), { warnings }), t.words)
    await writeFileAtomic(marksFile, JSON.stringify(marks, null, 2) + '\n')
    lines.push(`العلامات — Marks: ${marksFile} (${marks.stress.length} تشديد — stressed, ${marks.pauses.length} وقفة — pauses, ${marks.sections?.length ?? 0} قسم — sections)`)
    for (const w of warnings) lines.push(`  ${w}`)
    for (const w of marks.unmatched) lines.push(`  كلمة من النص لم تُسمع: ${w} — script word not heard in the voice: ${w}`)
  } else if (existsSync(marksFile)) {
    // Marks of a script that no longer exists would not match this transcript.
    await rmWithRetry(marksFile)
    lines.push(`حُذف marks.json القديم (لا يوجد script.md) — Removed the stale marks.json (no script.md)`)
  }
  process.stdout.write(lines.join('\n') + '\n')
  return 0
}

/**
 * `mba explain <projectDir> [--brief brief.json] [--plan] [--force]`: the explainer recipe → plan.json
 * (`--plan`: only that, with the hook options and the signature moments) → edit.json (refused, exit 1,
 * when edit.json holds edits made since the recipe last wrote it, or when plan.json was made for
 * another transcript, unless --force).
 */
async function explainCommand(values: Record<string, string | boolean | undefined>, args: string[]): Promise<number> {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && k !== 'brief' && k !== 'force' && k !== 'plan') usage(`الخيار --${k} غير صالح مع explain — --${k} is not valid with explain`)
  }
  const [dir, ...rest] = args
  if (!dir) usage('مجلد المشروع مفقود — Missing <projectDir>')
  if (rest.length) usage(`وسائط زائدة — Unexpected arguments: ${rest.join(' ')}`)
  const r = await explainProject(dir, {
    ...(typeof values.brief === 'string' ? { briefPath: values.brief } : {}),
    force: values.force === true,
    plan: values.plan === true,
  })
  const signature = `اللحظات المميزة: ${r.signatureLabels.join('، ') || '—'} — Signature moments: ${r.signature.join(', ') || 'none'}`
  const lines = r.editPath
    ? [
        `القصة — Storyboard: ${r.editPath} (${r.type}: ${r.scenes} مشهد — scenes, ${r.transitions} انتقال — transitions)`,
        `الخطة — Plan: ${r.planPath}`,
        signature,
        `الإيقاع المخطط (تقدير، والحكم لـ mba review) — Planned pace (an estimate; mba review decides): maxEventGap ${fmtTime(r.pace!.maxEventGap)} s, medianEventGap ${fmtTime(r.pace!.medianEventGap)} s`,
        ...r.warnings.map((w) => `تنبيه — Warning: ${w}`),
        'راجعه بـ mba preview ثم mba render — Check it with mba preview, then mba render',
      ]
    : [
        `الخطة — Plan: ${r.planPath} (${r.type})`,
        'افتتاحيات مقترحة — Hook options:',
        ...r.hookOptions.map((h, k) => `  ${k + 1}. ${h}`),
        signature,
        ...r.warnings.map((w) => `تنبيه — Warning: ${w}`),
        ...(r.look === 'signature'
          ? ['اكتب الفكرة والاستعارة والقصة (concept) ثم اختيار كل مقطع (visual) في plan.json — Write the concept and every beat’s visual in plan.json (engine/review/DIRECTOR.md)']
          : []),
        'عدّل plan.json إن شئت ثم شغّل mba explain — Edit plan.json if you like, then run mba explain',
      ]
  process.stdout.write(lines.join('\n') + '\n')
  return 0
}

/** `mba preset <projectDir> [--preset preset.json]`: a preset (preset.json + transcript) → edit.json. */
async function presetCommand(values: Record<string, string | boolean | undefined>, args: string[]): Promise<number> {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && !['preset', 'script', 'bpm'].includes(k)) usage(`الخيار --${k} غير صالح مع preset — --${k} is not valid with preset`)
  }
  const [dir, ...rest] = args
  if (!dir) usage('مجلد المشروع مفقود — Missing <projectDir>')
  if (rest.length) usage(`وسائط زائدة — Unexpected arguments: ${rest.join(' ')}`)
  const bpm = typeof values.bpm === 'string' ? Number(values.bpm) : undefined
  if (bpm !== undefined && !(bpm >= 40 && bpm <= 220)) usage('السرعة من ٤٠ إلى ٢٢٠ — --bpm must be 40..220')
  if (bpm !== undefined && typeof values.script !== 'string') usage('--bpm يحتاج --script — --bpm needs --script (a video with no voice)')
  const r = await presetProject(dir, {
    ...(typeof values.preset === 'string' ? { presetPath: values.preset } : {}),
    ...(typeof values.script === 'string' ? { script: values.script } : {}),
    ...(bpm !== undefined ? { bpm } : {}),
  })
  process.stdout.write(
    [
      `القصة — Storyboard: ${r.editPath} (${r.preset}: ${r.scenes} مشهد — scenes, ${fmtTime(r.seconds)} s)`,
      'صور الستوري بورد (لحظة من كل قسم) — Storyboard images, one moment per section:',
      `  mba still "${dir}" --t ${r.stills.join(',')} --out "${join(dir, 'stills')}"`,
      'وبعد الموافقة: mba render — After approval: mba render',
    ].join('\n') + '\n',
  )
  return 0
}

/**
 * `mba compare <reference.mp4> <projectDir | render.mp4> [--out dir]`: a project stands for its
 * newest render and its edit.json (scenes); the result goes to `--out`, else the next
 * `<project>/review/compare-<n>` (plain render: `review/compare-<n>` here). Never overwrites.
 */
async function compareCommand(values: Record<string, string | boolean | undefined>, args: string[]): Promise<number> {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && !['out', 'track', 'ref', 'units', 'style'].includes(k)) usage(`الخيار --${k} غير صالح مع compare — --${k} is not valid with compare`)
  }
  // `mba compare <reference.mp4> <target>` or `mba compare <target> --ref <reference.mp4>`.
  const [first, second, ...rest] = args
  const byFlag = typeof values.ref === 'string'
  const reference = byFlag ? (values.ref as string) : first
  const target = byFlag ? first : second
  if (byFlag && second !== undefined) rest.unshift(second)
  if (!reference) usage('ملف الفيديو المرجعي مفقود — Missing <reference.mp4>')
  if (!target) usage('مجلد المشروع أو ملف العرض مفقود — Missing <projectDir | render.mp4>')
  if (rest.length) usage(`وسائط زائدة — Unexpected arguments: ${rest.join(' ')}`)
  let track: number | undefined
  if (values.track !== undefined) {
    const t = String(values.track)
    track = Number(t)
    if (!/^\d+$/.test(t.trim()) || !(track >= 0 && track <= MAX_TRACK)) {
      usage(`قيمة --track يجب أن تكون عددًا صحيحًا بين 0 و ${MAX_TRACK} — --track must be an integer 0..${MAX_TRACK}, got ${t}`)
    }
  }
  let units: CompareUnits | undefined
  if (values.units !== undefined) {
    try {
      units = parseUnits(String(values.units))
    } catch (e) {
      usage((e as Error).message)
    }
  }
  const style = typeof values.style === 'string' ? await loadStyleFile(values.style) : undefined
  const outArg = typeof values.out === 'string' ? values.out : undefined
  let render = target
  let storyboard: string | undefined
  let out: string
  if (existsSync(target) && statSync(target).isDirectory()) {
    const project = await openProject(target)
    const latest = await latestRender(project)
    if (!latest) {
      throw new Error(`لا يوجد عرض في المشروع، شغّل mba render أولًا — No render in the project (renders/v<N>-draft|final.mp4); run mba render first: ${project.dir}`)
    }
    render = latest
    const edit = join(project.dir, PROJECT_EDIT)
    if (existsSync(edit)) storyboard = edit
    out = resolve(outArg ?? join(project.dir, nextCompareDir(project.dir)))
  } else {
    if (track !== undefined) usage('الخيار --track يحتاج مجلد مشروع فيه edit.json — --track needs a project folder (its edit.json holds the tracks)')
    out = resolve(outArg ?? nextCompareDir(process.cwd()))
  }
  const rep = await compareVideos({ reference, render, ...(storyboard ? { storyboard } : {}), ...(track !== undefined ? { track } : {}), ...(units !== undefined ? { units } : {}), ...(style ? { style } : {}), outDir: out })
  const pct = (x: number) => `${fmtTime(x * 100)} %`
  const fixes = rep.scenes.filter((s) => s.verdict === 'fix')
  const shorts = rep.scenes.filter((s) => s.verdict === 'short')
  const verdict = (v: string) => (v === 'fix' ? 'fix — يحتاج إصلاحًا' : v === 'short' ? 'short — قصير، للاستئناس فقط' : 'ok')
  const tiling = rep.tiling.gaps.length || rep.tiling.overlaps.length
    ? [
        ...rep.tiling.gaps.map((g) => `فجوة في المسار — Gap on the track: ${fmtTime(g.a)}–${fmtTime(g.b)} s (not scored)`),
        ...rep.tiling.overlaps.map((o) => `تداخل في المسار — Overlap on the track: ${o.ids[0]} / ${o.ids[1]} over ${fmtTime(o.a)}–${fmtTime(o.b)} s`),
      ]
    : []
  const lines = [
    `المقارنة — Compare: ${render}`,
    `المشاهد — ${rep.source.summary}`,
    ...tiling,
    ...rep.scenes.map(
      (s) =>
        `  ${s.id}  ${fmtTime(s.a)}–${fmtTime(s.b)} s  moving ${pct(s.ours.movingPct)} / ${pct(s.ref.movingPct)}  ` +
        `events/s ${fmtTime(s.ours.eventsPerSec)} / ${fmtTime(s.ref.eventsPerSec)}  ${verdict(s.verdict)}`,
    ),
    `مشاهد تحتاج إصلاحًا — Scenes to fix: ${fixes.length} of ${rep.scenes.length - shorts.length} scored${shorts.length ? ` (${shorts.length} short, indicative)` : ''}`,
    `مجلد المقارنة — Compare kit: ${out}`,
    ...(rep.adherence
      ? [
          'التزام الأسلوب — Style adherence:',
          ...rep.adherence.map((r) => `  ${r.field}  target ${r.target}  ours ${r.ours}  ${r.ok ? 'ok' : 'not ok — خارج الهدف'}`),
        ]
      : []),
  ]
  process.stdout.write(lines.join('\n') + '\n')
  // Warnings go to stderr, Arabic first, so they are not lost in the table.
  for (const w of rep.warnings) process.stderr.write(`تنبيه — Warning: ${w}\n`)
  // Variants gate on the style: a row that is not ok is exit code 1.
  return rep.adherence?.some((r) => !r.ok) ? 1 : 0
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (e: unknown) => {
    if (e instanceof UsageError) {
      process.stderr.write(`${e.message}\n\n${USAGE}\n`)
      process.exitCode = 2
    } else if (e instanceof ToolMissingError) {
      process.stderr.write(`${e.message}\n`)
      process.exitCode = 2
    } else {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
      process.exitCode = 1
    }
  },
)
