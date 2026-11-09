# Motion Bil-Arabi engine (dev notes)

Deterministic, Arabic-first motion-graphics engine: a storyboard JSON is rendered frame by frame
(seek -> screenshot) in headless Chromium and piped into ffmpeg. The user-facing README comes later.

## Commands (run in `engine/`)

```
npm test                 # vitest unit tests
npm run test:browser     # Playwright tests (runtime, primitives, renderer, preview)
npx tsc --noEmit         # type check

npm run mba -- render   examples/demo-ar.json --out "out/demo ar/demo.mp4" [--fps 30|60] [--draft]
npm run mba -- render   examples/demo-ar-1x1.json --out "out/demo ar/demo-1x1.mp4"   # same demo, 1:1
npm run mba -- still    examples/demo-ar.json --t 1.5,4.6 --out out/stills
npm run mba -- validate examples/demo-ar.json
npm run mba -- verify   examples/demo-ar.json [--samples 1-5] [--budget 60]   # determinism check, exit 1 on mismatch
npm run mba -- review   examples/demo-ar.json --out review/r1   # review kit (also takes a .mp4)
npm run mba -- reference "ref video.mp4" --out refs/ref [--scene-thr 0.3]  # learn a reference's rhythm
npm run mba -- preview  examples/demo-ar.json     # prints a URL; open it in a browser
npm run mba -- project init "my videos/p1" a.mp4 b.mp4 [--fps 30|60] [--format 9:16|16:9|1:1|4:5]   # 60 fps unless --fps 30
npm run mba -- project info "my videos/p1"        # media, durations, working copies, next version
npm run mba -- ingest "my videos/p1"              # upright, CFR, SDR working copies in work/
npm run mba -- render "my videos/p1" [--draft] [--chunk 10]   # next version renders/vNNN-<draft|final>.mp4, with audio
npm run mba -- verify "my videos/p1"              # a project folder stands for its edit.json
npm run mba -- review "my videos/p1"              # kit in <project>/review/r<N>
npm run mba -- explain "my videos/p1" [--brief brief.json] [--force]   # transcript + marks + brief → edit.json
```

`mba explain` (Task 10, `src/core/recipes/explain.ts`) writes `edit.json` with word anchors from
`transcript.json`, `marks.json` (stress, pauses and `# ` section titles of `script.md`) and
`brief.json` (`title`, `type` = explainer | educational | informational | product-launch | motion |
corporate, `hook: { family, text }`, `cta` (text, or `{ keyword }` for the comment end card),
`numbers`, `musicMedia`/`musicFrom`, `screens` in `source/`). It refuses to replace an `edit.json`
edited since its last run (exit 1) unless `--force`. Tracks: 0 `backdrop` (one colour world per
section, cross-faded), 1 main line (kinetic text in stacks of ≤ 3 words), 2 keyword visuals
(`core/keywords-ar.ts`), 3 accents and pace fillers (highlights on the main line), 4 HUD. With a
`title` (or `hook.text`) the hook replaces the voice's first ~1.5 s: stresses and keyword hits in
those words are dropped. Screens must be files in `source/` (portrait → `phone`, landscape →
`app-window` with `image`), `musicMedia` a project media id. The pace it prints is planned (an
estimate); `mba review` on the render is the judge.

### Project folders

`mba project init` creates `<dir>` (new or an existing empty folder; a file, a non-empty folder
and an existing project are refused; a failed init leaves a pre-existing folder empty) with
`mba-project.json` (the marker: the tool never writes into a folder without it), `source/`,
`work/`, `renders/`, `review/`, `edit.json` and `log.md`. Each media file is copied into `source/`
under its own name (`name (2).ext` on clashes) and the copy is made read-only; the original is only
read. Media ids are `m1`, `m2`, …; at most 180 s of media in total (v1). `edit.json` starts as one
`video` scene per media item, end to end on track 0. Renders are numbered across kinds:
`renders/v001-draft.mp4`, `renders/v002-final.mp4`, … A storyboard is project-aware when its
folder holds `mba-project.json`. Every command that takes a storyboard (`validate`, `verify`,
`render`, `still`, `review`, `preview`) also takes the project folder, which stands for its
`edit.json`. In a project, `mba review` writes its kit to the next `review/r<N>` (an unfinished
highest kit, without `metrics.json`, is reused so its draft resumes). Walkthrough on your own clip:
`examples/editor-demo/README.md`.

`mba ingest <dir>` turns each phone clip into a working copy `work/<id>.mp4`: upright (ffmpeg
autorotate, display matrix or `rotate` tag), constant frame rate at the project fps (frame n is the
picture at n/fps, also for variable-frame-rate sources), HDR (PQ/HLG) tone-mapped to 8-bit bt709
SDR with `zscale` (or the approximate `colorspace` filter when this ffmpeg has no zscale; the path
used is written to `log.md` and `work/media.json`), long side at most 1920, x264 CRF 16 with a
15-frame GOP, and AAC 48 kHz stereo (a silent track when the clip has none). Every copy is BT.709
limited range and tagged so: BT.601 (`smpte170m`/`bt470bg`) and untagged clips are converted
(an untagged clip counts as BT.709 when HD, shorter side ≥ 720 px, else BT.601; full-range
clips are read as such). Frames reach the browser as JPEG converted to
the BT.601 full range a browser decodes JPEG with, and renders are converted back to BT.709 and
tagged, so a flat colour comes out within a few levels of itself (`tests/browser/colour.spec.ts`). The copy is written as
`work/<id>.mp4.part` and renamed when complete. `work/media.json` keeps the sha1 of each source;
a copy whose source hash still matches is left alone, so a second run writes nothing. The 180 s
limit applies here too. It prints one line per clip with what it found (rotation, variable frame
rate, HDR, frame-rate change, resize, missing audio). A video stream that starts after its audio is
padded back to t = 0 (first frame repeated), and the audio runs to the end of the video.

`mba render <dir>` (or a storyboard inside a project) renders `edit.json` to the next version
`renders/v<N>-draft.mp4` / `-final.mp4` and prints its path. It renders in chunks of `--chunk`
seconds (default 10) under `<tmp>/mba/<project id>/parts/<version>/`: each chunk extracts only its
own video frames, writes `chunk-<NNN>.mp4` and a `chunk-<NNN>.done` marker, then deletes its
frames. Extracted frames (`<tmp>/mba/<project id>/frames/`) and chunk parts live in the system
temp folder, never in the project folder, which is often synced (OneDrive); the project id comes
from `mba-project.json`. A preview keeps at most 600 on-demand frames per clip. If the render is
interrupted (crash, closed laptop, killed process), running the same command again resumes the
same version: finished chunks are kept, an unfinished one is redone (as long as the temp folder was
not cleared). A changed `edit.json`, brand, working copy, option or ffmpeg build starts a new
version instead; a running render of the same job (its `job.lock` pid is alive) is never taken
over, a dead one's lock is. Orphaned temp jobs (e.g. an interrupted render whose edit changed)
stay in `<tmp>/mba/<id>/parts` until `mba clean` exists; a copied project folder shares its id,
and so its temp data, with the original. Final frames are captured as JPEG q95 (drafts q80) and encoded BT.709. The
chunks are joined, the clips’ own audio is placed on the timeline (speed changes via `atempo`,
silence elsewhere, 8 ms fades at each cut, a 0.97 peak limiter) and muxed as AAC 256k; `log.md`
gets a line. After the first 60 frames, and after every chunk, it prints
`الوقت المتبقي تقريباً ~ M:SS — about M:SS left` on stderr.

### Quality loop

Every storyboard (and every new primitive or transition) goes through the same three checks before
anyone watches it:

1. `mba verify <sb.json>`: cold frame == warm frame at 5 probes per scene plus every transition
   window and hard cut, within a budget of 60 probes (determinism, below).
2. `mba review <sb.json> --out <dir>`: renders a draft, then reports near-blank frames (frame 0
   included), static holds, motion events and the text audit every 0.5 s. Open `contact.jpg` and the
   two `strip_fast_*.jpg` and look at them: Arabic joined, cuts and transitions readable, no empty frame.
3. `mba reference <video.mp4>` once per reference ad you like, then compare its `eventsPerSec` and
   `medianEventGap` with the same numbers in the review's `metrics.json` (both come from the same
   `paceOf`, at the same 30 fps analysis rate; the review also reports `movingPct`).

`tests/browser/demo.spec.ts` holds the demos to this: `verify` has 0 mismatches and `review` shows
no audit issue, a non-blank frame 0 and no near-blank frame, for both `demo-ar.json` (9:16) and
`demo-ar-1x1.json` (1:1).

`mba review` writes a review kit built from the rendered MP4 (a draft is rendered first for a storyboard):
`contact.jpg` (2 fps), `strip_fast_1/2.jpg` (12 frames around the two fastest moments), `phone.jpg`
(1 fps at 360 px), `safe.jpg` (9:16, platform UI zones shaded) and `metrics.json` (every sheet file in
`sheets`: contact, phone and safe sheets hold at most 60 tiles a page, so a 3-minute video has
`contact.jpg`, `contact-2.jpg`, … `contact-6.jpg`; near-blank frames: no detail and, for a storyboard, the look's background colour,
so a flat accent cover is not blank; each run has its mean colour and `designed` = inside a transition window; static
runs, motion events, pace: max/median event gap, events per second, moving share, and for a storyboard the text audit every 0.5 s). Motion is measured
per block (largest block of a 6x8 grid), so small moving text is not averaged away, and always on the
video resampled to 30 fps (`analysisFps`, `ANALYSIS_FPS`), so the same clip at 30 or 60 fps gives the
same numbers (`mba reference` does the same). Exit 0 even when issues are found.

`mba reference` learns the grammar (never the content) of a video the user likes: hard cuts (ffmpeg
scene score > 0.3), shot lengths, a 4 Hz motion profile and the pace (motion events per second,
median/max event gap, moving share, longest static hold, measured exactly as `mba review` does, so a
reference and our render compare directly). It writes `frames.jpg` (2 fps), `cuts.jpg` (first frame
of each shot), `reference.json` and `reference.md`, a style-guide skeleton whose observations are
left as TODOs for Claude to fill from the sheets.

Preview keys: space play/pause, left/right +-1 s (shift +-5 s), `,` `.` +-1 frame, `h` hide the UI.
`?t=<sec>` sets the start time. The same page also loads `?sb=/examples/<file>.json` directly.

## Storyboard shape

`{ version: 1, format, fps, look, seed, brand?, scenes: [{ id, type, start, duration, preroll?, track?, params }], transitions? }`.
Formats (`src/core/types.ts`): `9:16` 1080x1920, `16:9` 1920x1080, `1:1` 1080x1080, `4:5` 1080x1350.
Safe area (fractions of the frame): 9:16 top 14%, bottom 22%, left 6%, right 12%; 1:1 and 4:5
6/8/6/6% (top/bottom/left/right); 16:9 6/8/5/5%.
Schema: `src/core/storyboard.ts`. Scene types and their params: `src/runtime/primitives/`
(`slam`, `wipe-reveal`, `search-typing`). Example: `examples/demo-ar.json`.
If there is no `brand`, `mba-brand.json` beside the storyboard is used.

`backdrop` (Task 10): `tone` = base | warm | cool | deep, a static glow over the look background;
`fadeIn` (s) fades it in over the backdrop below it. `app-window` also takes an `image` (a
screenshot above its lines; inlined at load like a phone screen).

Explainer devices (Task 9; params in `src/core/params/<id>.ts`): `phone` (`screen.image` is a file
path beside the storyboard, inlined as a data URL at load like `brand.logo`, or `screen.lines`),
`app-window` (`terminal` types Latin per character with a caret and wipes Arabic lines right → left;
`app` fades lines in), `stamp` (cue `hit` → `impact` at −16 dB), `highlight` (`circle` | `burst` |
`underline` around a `target` key of an earlier scene that overlaps it in time, e.g. on a lower track,
or a `box`), `hud` (section label + pips on a top track; no drift) and `comment-cta` (the «comment the
word» end card, ≥ 2.05 s). A `key` must sit on an element that carries its own type styles (morph
copies it out of context); the audit ignores morph clones (`[data-mba-morph-clone]`).

Product-demo devices (Stage 1B; params in `src/core/params/<id>.ts`): `screen-clip` shows a project
video (`media`, `in`, `speed`, or `still` = the frame at `in` throughout) in a floating browser window
(`chrome.url`, `width` of the safe width, body `aspect`, default the media's) that tilts or rises in
and back out. `focus` keys bring a SOURCE point (0..1) to the window centre at a zoom (1 = cover,
clamped to the image, plus a ≤ 1 % seeded drift); `reveal: scan` draws the picture top → bottom;
`callouts` (pin + Arabic label pill), `marks` (`box` | `hot`) and `clicks` sit on source points and
track the zoom. Frames come from the frame server like `video` (no preroll; the window must fit the
safe area, checked at load). `numbered-slots` is a row of 2..5 numbered cards (slot «١» rightmost,
indices 0-based) with optional `labels`, per-slot `appear`, one `locked` slot opened at `unlockAt`,
and `active` highlights. Cues: whoosh / pop / tap (screen-clip), pop / hit / tap (slots).

System explainers («layers»; params in `src/core/params/<id>.ts`, images are project files inlined at
load like a phone screen, remote URLs refused): `logo-row` pops 1..6 brand logos in a `row` (index 0
rightmost) or a `grid` of 3, with labels, `focus` (×1.15 + accent ring, others 35 %), `strike` (an
accent line across one) and `out`. `layer-stack` stacks 2..4 isometric slabs listed TOP to BOTTOM
(each lands at its `at`; ≤ 3 logos on it; title / subtitle on a leader with a badge, 1 = the bottom
slab), `active` lifts one (+4 %, accent rim, others veiled to 45 %), `flowAt` sends pulses up the
wires. `node-graph` is a workflow canvas: ≤ 8 nodes (`trigger` | `step` | `agent` | `slot`, a slot
fills at `fillAt`) at panel points 0..1, ≤ 10 wires (`main` left → right beziers, `sub` dashed drops),
`flowAt` pulses, `focus` outlines. `chat-thread` is a WhatsApp-style chat (business `out` LEFT,
customer `in` RIGHT), ≤ 8 messages with typing dots before each `out`, a booking `card`, smooth
scroll; its slots are measured once, so nothing reflows. Cues: pops, plus action / tick / hit / final.

`build-number` (Stage 2) stacks vector items into the digits of a number (`value`: Latin digits,
`,` `٬` `.`, `?` `؟`, ≤ 11): bricks in running bond (3 × 7 per digit), cement sacks or bills (3 × 5;
a single glyph is drawn big, 5 × 9). They `fall` from above the frame (or bills `flutter` in, extras
falling past; `from` bursts them out of a point), land over `buildSec` from `fallFrom`, and at
`morphAt` pull together into the clean number (DOM text, accent) with the `label` under it;
`scramble` keeps its digits (and question marks) rolling. Cues: clustered ticks (whoosh for bills),
pop at the morph. Morph-object states also take `beats` (Stage 2 objects' later moments).

Optional scene `preroll` (seconds, 0 ≤ preroll ≤ min(1, duration), default 0) starts a scene's
animation before it appears, so its first frame is not the empty start of an intro. The scene is
still shown only over `[start, start + duration)`, but its primitive is built for a scene of
`duration + preroll` seconds and evaluated at local time `(t − start) + preroll` (its timeline sits
at `start − preroll` on the master). The exit therefore still ends exactly at `start + duration`.
Cuts and transitions use `start`/end only. The demo uses 0.5 s on the search (frame 0 shows the landed
bar with the first typed letter) and 0.15 s on the slam (the whip-pan cut frame shows it).

Optional scene `track` (integer 0–9, default 0) sets the z-order: higher tracks draw above lower
ones, and inside a track a later scene (storyboard order) draws above an earlier one. In the editor
the user's video sits on track 0, motion graphics and captions on higher tracks. Fixture:
`tests/fixtures/tracks.json` (captions on track 2 change on the same cut as a track-0 color-wipe).

Optional `transitions: [{ type, at, duration?, track?, params? }]` put an effect on a cut:
`color-wipe` (`color` accent|fg|bg, `direction` rtl|ltr|up|down), `whip-pan` (`direction`
left|right|up|down, `blur`), `zoom-through` (`scale`), `glitch-cut` (`intensity`), `morph` (`key`: the
element with that `key` in the outgoing scene flies into the one with the same `key` in the incoming
scene, both scenes cross-fading; default duration 0.6 s; every library primitive takes `key`). Every
transition takes `hit` (a hard cut: riser + impact). A transition
belongs to a `track` (default 0): `at` must be the end of exactly one scene and the start of exactly
one other on that track (within 1 ms); scenes on other tracks may start, end or overlap there
freely. `duration` is 0.1–1.2 s (default 0.4, morph 0.6) and half of it must fit in both scenes; windows
`[at − d/2, at + d/2]` on the same track must not overlap. The overlay draws right above the last
layer of its track, so it covers that track and the lower ones, never a higher track. While any
window is active `#frame` carries `data-mba-tr="1"` and `data-mba-tr-track` (the highest live
transition's track; the audit skips frame-edge and safe-area checks only for layers on that track
or below). Example (from the demo):

```json
"transitions": [
  { "type": "whip-pan",   "at": 3.9,  "duration": 0.4, "params": { "direction": "left", "blur": 12 } },
  { "type": "color-wipe", "at": 5.75, "duration": 0.5, "params": { "color": "accent", "direction": "rtl" } }
]
```

Inside a window the transition's progress p (0.5 exactly at the cut) decides which of its two layers
shows: the outgoing one for p < 0.5, the incoming one from p = 0.5 (other scenes keep their own windows). Schemas:
`src/core/params/transitions.ts`; effects: `src/runtime/transitions/`. Fixtures: `tests/fixtures/tr-*.json`.

## Determinism rules

- Every frame is a pure function of `t`; the stage only moves on `stage.seek(t)`.
- `seek(t)` (stage and `window.__mba`) returns a Promise: it resolves once every visible scene's
  `update` has finished, including async ones. The latest-wins queue lives in the stage
  (`src/runtime/stage.ts`): a seek that arrives while one is drawing waits, and of the seeks that
  piled up only the newest time is drawn (all of them resolve then). Always await it before a
  screenshot; preview playback just calls it every animation frame and lets the queue coalesce.
- Motion helpers: `src/core/springs.ts` (closed-form springs `snappy`/`default`/`heavy`/`playful`,
  `springStep`, `springTrack`, `springLead`) and `src/core/ease.ts` (cubic/expo/back easings,
  `clamp01`, `seg`). Both are pure functions of time.
- No `Math.random`, `Date.now`, `performance.now` or `requestAnimationFrame` in `src/runtime/`,
  except `src/runtime/preview/` (wall-clock playback). Randomness comes from the seeded `rng`.
- No CSS transitions or animations outside `preview/`; motion is paused GSAP timelines.
- Arabic text is never split into letters: the smallest unit is a word or a line.
- Primitives never style their own scene layer (`ctx.layer`): its visibility, transform, filter,
  clip-path and opacity belong to the stage and the transitions, which reset them on every seek.
  A primitive styles only the children it appends.
- Text audit (`src/runtime/audit.ts`, `window.__mba.audit()` after an awaited seek, render mode
  too): `unsanctioned-arabic` (Arabic outside a text unit, any text node), `wrong-direction`
  (`dir` ≠ the unit's full-text direction; typing units keep it in `data-mba-full`), `too-small`
  (glyph height < 28 px × width/1080), `clipped-by-frame` (glyph box crossing the frame edge) and
  `outside-safe` (glyph box > 2 px outside the safe area). The first two run on every node; the
  last three only on visible text (opacity ≥ 0.5) at rest (no transform up to the layer), and the
  last two are skipped while `data-mba-tr="1"`. `clip-path` is not considered yet.
- `mba verify` (`src/node/verify.ts`) checks this: for 5 probe times per scene
  (`start + f·duration`, f = .08/.3/.5/.7/.92) the frame drawn on a fresh page with one seek
  (cold) must equal, pixel for pixel, the frame drawn on one long-lived page after 6 seeded random
  seeks across the whole storyboard (warm). It also probes every transition window (at − d/4,
  at − 1/fps, at, at + 1/fps, at + d/4) and every hard cut per track (cut − 1/fps, cut), from the storyboard
  (`defaultExtraTimes`; an explicit `extraTimes` in the API replaces them). Every new primitive,
  transition, CSS 3D or Three.js scene must pass it. Exit 0 = all identical and no page error,
  1 = mismatch (one line per probe) or the page logged an error while probing, 2 = usage error.
  A long storyboard is checked within a probe budget (`--budget`, default 60). Over budget: one
  sample per scene is reserved first (at most 20 % of the budget); then whole cut/transition units
  (a hard cut's 2 probes, a transition's window of 5) are kept, as many as fit, spread evenly over
  the timeline; the remaining probes are scene samples in proportion to scene duration (a scene
  with fewer samples than asked is probed at its midpoint first). Cold frames are kept as
  SHA-1 hashes; only a mismatch writes its cold and warm PNGs (to `<project>/review/verify/`, or a
  temp folder for a loose storyboard; old ones are cleared at the start of every run), and their
  paths are printed. A cold frame that redraws differently is reported as `cold frame unstable`.
  The run prints its probe count and wall time. Video frames are extracted per batch of 10 probes and released after it.
- GSAP runs with `force3D: false` (no implicit `translate3d`); the renderer's `seekFrame` forces a
  fresh layout/paint of `#frame` after every seek, so Chromium never reuses paint from earlier frames.
- Render mode (storyboard injected as `window.__MBA_STORYBOARD__`) must keep `#frame` at (0,0)
  with no transform; the preview controls mount only when it is absent.

## Test-only primitives (`?test=1`)

Browser tests can add throwaway scene types without touching the registry:
`openStoryboard(page, sb, { testPrimitives: '() => [{ id: "_x", build(ctx, p) { ... } }]' })`.
The helper sets `window.__MBA_TEST_PRIMITIVES__` with `addInitScript` and opens `/?test=1`;
`main.ts` then registers each entry before the stage is created and accepts its id as a known scene
type. Ids must start with `_` and must not clash with a built-in id. `params` is optional (any Zod
schema; omitted = params pass through unchecked). Without `?test=1` the global is ignored
completely, so render and preview never see test types. The only Node-side way in is the hidden,
test-only `mba verify <sb.json> --test-primitives <module.js>` flag (module default export = the
same function source string; see `tests/fixtures/test-primitives.js`).
