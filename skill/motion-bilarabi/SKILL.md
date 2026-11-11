---
name: motion-bilarabi
description: Use when someone wants an Arabic motion-graphics video, reel, short, story or teaser (Instagram, TikTok, YouTube Shorts) from a script, an idea or a voice-over; when they say «موشن بالعربي», «سوّ لي ريل», «فيديو موشن», name a preset (قائمة، مشكلة وحل، خطوات، سألتوني، أداة، دليل حلقي، شرح نظام، تشويقة), or ask for storyboard images, a render, a beat, easy ease or a 60 fps vertical video; or want creator effects on a talking-head clip (cut-out, back focus, clones, blow away, orbit ring).
---

# موشن بالعربي · Creator Studio — Arabic motion graphics

## Overview
An engine that turns a script (and a voice-over, or just a beat) into a 60 fps vertical reel.
Arabic is first-class: letters never break, kashida stretches, RTL everywhere. You pick a
**preset**, fill `preset.json`, show **storyboard images**, and render only after approval.

All commands run in the `engine/` folder: `mba` = `npx tsx src/cli.ts`. The engine is the
`motion-bilarabi` folder the user downloaded: look in `~/motion-bilarabi/engine` first; if it is not
there, ask where they put it. Its `README.md` is the install guide.

## Workflow (follow in order)
1. **Setup once:** `mba doctor`. Fix anything marked ✗, giving the user both ways: the terminal
   command, and the sentence to paste in the Claude app's Code tab (doctor prints both).
2. **Pick the preset** from the user's script — see `presets.md` (table + every field).
3. **Style and motion (one message, before any plan):** unless their words already chose them, ask:
   «أي ستايل تبي؟ ١ كريمي توقيع · ٢ داكن تقني · ٣ ليزر سينمائي · ٤ سويسري أحمر — والحركة ناعمة ولا حادة؟
   وإذا تبي مؤثر معيّن لجملة، اكتب الجملة واسمه (القائمة كاملة بصفحة EFFECTS.md).»
   The style is a **pack**: write its id from `catalog.md` as `"pack"` in `preset.json` (see «Style packs» below). Motion: smooth / ناعم /
   سلس / easy ease → `"motion": "easy"`; sharp / حاد / قوي / snappy / بدون ease → `"snappy"`; nothing
   said → leave `motion` out (the pack's own feel applies). If «سريع» could mean a short video rather than snappy motion, ask one question.
   No answer, or «إنت اختار» → pick the style that fits the script and say which in one line.
   **Per-sentence picks:** when the user names an effect for a sentence («الجملة ٢: شطب الكلمة»,
   «بين القسم ١ و٢: تمزيق ورق»), look the name up in `catalog.md` and use exactly that; design
   every other sentence yourself. If a pick breaks a rule below (text over the face, a headline
   on an object), keep the effect and move it, and say so.
4. **Project:** `mba project init <dir> [media...] --format 9:16` (60 fps by default; no media is
   fine for a video on a beat). It copies the user's files in — never edit their originals. Write
   `<dir>/preset.json`.
5. **Timing:**
   - Voice-over (needs whisper — `mba doctor` must show it ✓; install it first if not):
     `mba project add <dir> voice.mp3 --kind voice`, `mba ingest <dir>`, `mba transcribe <dir>`, then `mba preset <dir>`.
   - Voice-over without whisper: write `<dir>/transcript.json` by hand — `{"words":[{"text":"…","start":0.12,"end":0.48}, …]}`,
     times read from the waveform (or from silences: `ffmpeg -i voice.wav -af silencedetect=n=-35dB:d=0.25 -f null -`) — then `mba preset <dir>`.
   - No voice: `mba preset <dir> --script script.txt --bpm 120` (words on the beat).
   - Long pauses: list the silences over 0.5 s to the user and ask which to shorten; never cut them all.
     Keep the original voice untouched in `source/`; a tightened copy is a new file.
6. **Check the plan:** `mba validate <dir>` must say OK before any image.
7. **Storyboard images:** `mba preset` prints the exact `mba still …` command (one moment per
   section). Run it, look at every image yourself first (does each part show its idea? can a phone
   viewer read it?), show them, and **wait for approval.** Notes → edit, run again, new images.
8. **Render:** `mba render <dir>` → `<dir>/renders/vNNN-final.mp4`.
9. **Delivery gate (all must pass before you send the video):**
   - `mba verify <dir>` — the render matches the plan (frames, length, audio).
   - `mba review <video> --out <dir>/review/rN` — exits 1 and writes `verdict.json` when frame 0 is
     blank, a blank run over 0.2 s was not drawn by a transition, or the text audit finds issues.
   - Open `contact.jpg` and `phone.jpg` from the review kit; fix anything unreadable at phone size,
     then render again. Only then send the video.

## Rules that never bend
- Every final video is **60 fps**. No sound effects (presets set `autoSfx: false`).
- Headlines never touch or sit behind objects; one red-box word per headline at most.
- Every sentence gets a meaningful visual (an object, a real screenshot, a type trick) — never an
  abstract dot standing for an idea.
- Storyboard images before any render; nothing renders without the user's yes.
- The creator's name, handle, colour, avatar and comment keyword come from `~/.mba/brand.json`
  (template: `engine/examples/brand.json`); the project's `mba-brand.json` overrides it.
- Real logos and recordings only from the user or with a clear licence; note sources.

## Quick reference
| Need | Command / field |
|---|---|
| Is everything installed? | `mba doctor` |
| An effect by its Arabic name | `catalog.md` (the user sees EFFECTS.md with previews) |
| Ideas for a sentence | `mba recommend <dir> --from s --to s` (ready scenes timed to the words) |
| A web page or app screen | the user's screenshot, or `mba shot <url> img/x.jpg --full [--mobile]`, in a `screen-mockup` |
| Build the storyboard | `mba preset <dir>` (`--script s.txt --bpm 120` without voice) |
| Check a frame | `mba still <dir> --t 2.5,6 --out stills` |
| Validate | `mba validate <dir>` |
| Render / review | `mba render <dir>` · `mba review <video> --out r1` |
| Smooth vs snappy | `"motion": "easy" \| "snappy"` |
| Land on music | `"beat": { "bpm": 120 }` |
| Person cut-out (talking head) | `mba matte <dir> m1`, then a `cutout` scene; anything on a lower track sits behind the person |
| Motion blur | storyboard `"motionBlur": { "samples": 4, "shutter": 180 }` |

## Creator effects (scene types)
- Overlays: `effect-list`, `live-cursor`, `voice-note`, `comment-drop`, `head-stack`, `predict-keys`, `day-dial`, `post-wall`, `photo-look` (banknote · press · vintage newspaper · impact), `captions`, `arabic-move`.
- `arabic-move` with `cut: true` holds the word to a hard cut (no exit), so short voice lines (~1.7 s) fit: the scene needs only the entrance.
- A `video` scene plays the clip's own sound. When a separate voice-over carries the audio, set `muted: true` on every `video` scene of that clip.
- **Optional clean plate (offer it):** when the user wants an effect that shows the room without the
  person (blow away, clones, dolly zoom, back focus, layers), ask once: «تبي نتيجة احترافية؟ صوّر
  المكان فاضي (صورة أو ٢ ثانية فيديو) من نفس مكان الكاميرا وبنفس الإضاءة» — then
  `mba plate <dir> <mediaId> <photo-or-clip>` (fitted and aligned to the clip automatically; kept when
  the matte is rebuilt). If they skip it, the engine builds the room from what the clip shows.
- Text never covers a filmed face: line headlines and stamps over a person move below the chin (or
  above the head) automatically; `"face": "keep"` in a scene's params opts out.
- On a person (`cutout`, after `mba matte`; with MODNet installed the matte is a true soft matte — hair strands, no halo — so ask for a 1080p+ clip):
  - `background: "blur"` — back focus: the room itself, only blurred.
  - `mode: "grid"` (`pick`, `zoom`) — grid zoom: a carousel of video cards (the clip in different looks) over the head scrolls to the black-and-white card, the cursor picks it, it lands on the eyes as a lens and turns the whole scene black and white. A good opener.
  - `mode: "letters"` (`word`) — letter dive: the clip plays inside a giant word on paper, then the camera dives through a letter.
  - `mode: "clones"` — a clone row beside the person.
  - `mode: "code"` — the whole frame turns into code, the person in their own colours.
  - `mode: "dust"` + `background: "clean"` — blow away: the person dissolves, the room stays.
  - `mode: "layers"` (`word`, `items`, `lit`) — layer explode: the shot splits into labelled 3D panes (room, you, effect list, type, voice waveform) from `at` over `dur`, then folds back at the scene end.
  - `background: "clean"` + `dolly: [1.45, 1]` — dolly zoom: the empty room scales while the person holds still (no double head).
  - `orbit-ring` as a `back` scene below the cutout and a `front` scene above it.
- Cuts: `profile-grid` (the scene shrinks into a tile of the creator's profile grid, the camera dives into the next scene's tile; **ask the user for 6–10 of their own post covers** and pass them as `tiles` (files next to the storyboard), and their handle as `user`), `page-turn`, `paper-tear`, `pen-dot-curtain`, `pixel-curtain`, `ink-slab`, `blinds`, `blade-slice`, `layer-explode`.
- A transition only moves scenes on its own track and below: put a full-frame cutout on track 0 when a cut must carry it.

## How a model picks words (explainers)
- `token-stream` (`tokens[{text, at, joinNext}]`) — the answer builds token by token; `joinNext` keeps a split word joined.
- `token-odds` (`prompt`, `options[{text, p}]`, `temps[{at, t}]`, `showTemp`, `pick`) — next-token probability bars; temperature sharpens/flattens them live.
- `loaded-die` (`faces` ×6, `rolls[{at, face}]`) — a 3D die with a token per face; repeat the strong token to load it.
- `server-batch` (`questions`, `answer`, `changed`, `outAt`, `flipAt`) — questions from several people enter one server together; your answer comes out and one word flips.

## Developer-tool explainers
- `permission-prompt` (`command`, `option` 0 Yes · 1 don't ask again · 2 No, `moveAt`, `pickAt`, `note`) — Claude Code's approval box; the selector lands on the option.
- `code-file` (`file`, `lines[{text, at, mark: add|secret|ok, tag}]`) — an editor or terminal pane; lines type in, secrets glow red with a tag.

## Skill-package explainers
- `skill-deck` (`skills[{name, ver}]`, `docks[{name, tint}]`, `preloaded`, `question`, `source`, `fanAt`, `dealAt`, `dealTo`) — skills as cards; a package box fans them and deals them along arcs into app windows.
- `twin-sync` (`rows`, `you`, `friend`, `lock`, `lockAt`, `fillAt`, `matchAt`, `badge`) — your machine and a friend's; the lock file snaps shut and the friend's rows fill to match.

## Editorial type (magazine headline)
- `editorial-type` (`lines[{words[{text, at, serif, accent}]}]` ≤ 4 lines × 6 words, `select{line, word, at, out, label, colour: accent|blue|fg}`, `swaps[{line, word, to, at}]`, `out`, `y`, `size`) — bold sans words mixed with italic serif ones (Amiri), each blurring in as it is said; a design-tool selection box (dashed edges, handles, a label chip) lands on one word; a swap blurs the word out, resizes its slot and blurs the new word in, and the box follows. One or two serif words per headline; the serif word is the one to select or swap. Best on the cream looks. Lines that are too wide shrink to fit.

## Glitch and zoom callouts
- `glitch-text` (`lines` ≤ 2, `accent`, `at`, `settle`, `hits[{at, dur, strength}]`, `to{lines, accent, at}`, `out`, `scan`, `y`, `size`) — the headline glitches in (red/cyan split, slipping bands, blocks, scanlines through the letters) and snaps clean; `hits` are bursts on beats; `to` glitches it into new words; `out` breaks it away. Strongest on dark worlds (`backdrop` `world: ink`). Arabic words only (they are laid out right to left one by one).
- `zoom-callout` (`media`, `in`, `spot{x, y, r}`, `lens{x, y, size}`, `shape: circle|rect`, `at`, `out`, `label`) — over a `video` of the same media: a ring lands on the spot, two guide lines draw, and an inset grows there showing the spot magnified, with a label. `in` = the video's `in` + how far into that video this scene starts. Keep the lens and label off the face (`lens.y` low, over the shirt); pick a spot that stays still in the clip.

## Sketch and red pen
- `sketch-words` (`lines` ≤ 3, `accent`, `at`, `draw`, `fill: hatch|solid|none`, `boil`, `out`, `y`, `size`) — the words are traced in pencil (two wobbly passes), then cross-hatching fills them; the lines boil like a drawing. Best on the cream looks, for an idea that is still a draft.
- `red-pen` (`marks[{kind: circle|underline|strike|arrow|check|cross|caret|bracket, x, y, w, h, at, dur}]`, `notes[{text, x, y, at, dur, rotate, size}]`, `pen`, `colour: red|accent`, `out`) — an editor's red pen over what is on screen, on a track above it; each mark draws stroke by stroke with a pen nib at the tip, notes are handwritten in from the right. Boxes are frame fractions: take them from a still of the text underneath (an arrow runs from (x, y) to (x+w, y+h)). The classic: strike the wrong word, a caret under it, the right word as a note.

## Phone and data moments
- `notify-stack` (`items[{app, title, body, icon, tint, time, at}]` ≤ 8, `y`, `show`, `theme: light|dark`, `out`) — phone banners drop in from the top, newest on top; past `show` the older ones tuck behind. Real-looking but generic: app names only, never a real person's name or number.
- `stat-bars` (`title`, `rows[{label, value, hero}]` ≤ 7, `max`, `suffix`, `digits`, `at`, `stagger`, `grow`, `y`) — bars grow right to left one by one while their numbers count; the `hero` row is in the accent.
- `gauge-ring` (`value` 0–100, `from`, `label`, `suffix`, `digits`, `at`, `dur`, `size`, `y`) — a ring sweeps to the value with a glowing head and ticks; the number counts in the middle, the label sits under the ring.
- `live-timer` (`from`, `to`, `at`, `dur`, `format: mm:ss|mm:ss.cc|hh:mm:ss`, `digits`, `label`, `ring`, `warn`, `y`, `size`) — a stopwatch (from < to) or countdown (from > to) in tabular digits with a pulsing red dot; `warn` = the last seconds pulse in the accent. A long span over a short `dur` plays fast.

## One space (camera tour)
Every idea lives in one world; the camera flies from one to the next and each one's animation starts as the camera lands. Start from `engine/examples/one-space.json`.
- A stop = any scene with `"place": {"x", "y", "scale"}` (its centre in the world, frame fractions; `scale` 0.34 = a third of the frame, so the camera zooms ×3 to fill the screen). Stops on tracks 1–4 (0 and 5 are fixed). Keep stops apart (centres ≥ `scale` apart) so they never overlap; a zigzag down the frame reads well.
- `"camera": {"tour": {"travel": 1.1, "lift": 0.35}, "handheld": {"amp": 0.6}}` makes the camera keys: it holds on each stop, leaves `travel` s before the next stop's `start`, pulls back by `lift` mid-flight (the space shows), and lands exactly at that `start`. Give stop scenes durations that run to the end, so earlier stops stay in the world.
- Parallax with `space-field` layers (`kind: dots|grid|stars|shapes|bokeh`, `density`, `tint: fg|accent|mix`, `alpha`): a far `dots` or `stars` layer at `depth` 0.3–0.5 and near `bokeh` (accent) at depth 1.5–2. Keep the world clean: nothing between the stops but these layers.
- Stops can be anything: a headline, an animated illustration (`morph-object` states, e.g. bulb → ai-chip → document), a `screen-mockup` of a website or a phone, a gauge, a timer. Explainers and tutorials: alternate idea → illustration → real screen.
- Never end by pulling back to show every stop at once: the tour ends on its last stop. Let each stop's action (a scroll, a spotlight, a tap) finish before the camera leaves (`start` of the next stop − `travel`). Add `"motionBlur": {"samples": 3, "shutter": 180}` for the flights.

## Real screens (web and phone mockups)
- `screen-mockup` (`device: browser|phone`, `image`, `url`, `at`, `scroll[{at, y, dur}]`, `focus[{x, y, w, h, at, out, zoom, label}]`, `taps[{x, y, at}]`, `size`, `y`, `tilt`, `theme`) — a real screenshot in a browser window (address bar with `url`) or a phone (island, status bar). `scroll` y is 0 (top) … 1 (bottom) of a tall screenshot; `focus` and `taps` are fractions of the whole image (x, w of its width; y, h of its full height), read them off the screenshot; a focus dims the rest, outlines the box, zooms the device onto it and can carry a label; taps glide a cursor (browser) or show a fingertip (phone) with a ripple.
- **Reference images first.** When a sentence talks about a website, an app, a tool or a page, the visual is the real screen. Ask the user for screenshots or screen recordings (their own site, app, dashboard): «عندك لقطة شاشة للصفحة؟ أرسلها، أو أعطني الرابط وأصوّرها». Put them in the project folder (e.g. `img/`) and use the path.
- No screenshot but a public link: capture it — `mba shot <url> img/site.jpg --full` (desktop page, scrolled so everything loads; `--mobile` for a phone-sized page; `--wait 1500` for slow pages). Only public pages: never sign in, never capture private or paid content. Prefer the user's own sites; for someone else's site, say which page you captured and ask before publishing. Look at the screenshot yourself before using it (blank sections, banners, anything personal).

## Concepts: let the engine suggest (`mba recommend`)
Before designing a sentence by hand, ask the library: `mba recommend <dir> --from <s> --to <s>` (the sentence's span in `transcript.json`) or `mba recommend "<sentence>" --seconds 3`. It prints the best concepts (karaoke ball, growth graph, before/after slider, one-to-many, shortlist funnel, strike-and-replace, UI chain, object chain, question pulse) with a reason and **ready scenes timed to the words** — paste them into `edit.json`, then adjust the words and labels. Use it as a first draft, never as the final word: two sentences in a row never use the same concept, and every sentence still needs a meaningful visual (rules above).

## Physics and interface moments
- `bounce-ball` (`words[{text, at, key}]` or `targets[{x, y, at}]` or `drop{x, y, at, bounce}`, `size`, `colour`, `look: glossy|flat`, `arc`, `trail`, `y`, `fontSize`, `out`) — a ball with real bounce physics: it drops in and hops onto each word as it is said (word dips, key word lights in the accent), squashes on landings, stretches in flight, casts a shadow; `targets` land it on objects of other scenes; `drop` falls onto a spot and settles with decaying bounces. Long lines shrink to fit.
- `ui-morph` (`states[{kind: button|loader|check|toggle|slider|tabs|chart|toast|island, at, label, value}]`, `cursor`, `x`, `y`, `scale`) — one shape becomes each interface piece on springs; contents swap under a blur; a cursor clicks to cause each change. Put a state change on each beat or key word.
- `spring-graph` (`values`, `at`, `step`, `callout`, `from`, `to`, `y`, `height`, `width`) — the hero dot springs point to point (right to left) drawing the line, the callout («+٢٢٪») pops on the last point.
- `halftone-field` (`path[{x, y, at}]`, `hero`, `cell`, `reach`, `wipe{at, dur, colour}`, `alpha`) — a dot grid that swells around a moving hero dot; the wipe floods the frame with dots and opens the next scene (put the next scene's start inside the covered moment).
- `before-after` (`before{image|text, label, filter}`, `after{…}`, `at`, `dur`, `from`, `to`, `y`, `width`, `aspect`) — two states under one divider; a hand drags it and the after-state comes in from the right. One screenshot with `before.filter: "grayscale(1) brightness(0.75)"` makes a quick before/after.
- `fan-cards` (`input`, `outputs[{title, icon}]` 2–8, `at`, `stagger`, `y`) — one input card fans out into result cards along drawn curves.
- `funnel` (`items[{text, keep}]`, `label`, `result`, `at`, `dur`, `y`) — candidates pour in; kept ones pass the neck and line up, the rest are struck and thrown out.

## Beat stories (cut to music)
- No voice: lay every scene on a beat grid — `const b = (n) => n * 60 / BPM` — one change per beat or every other beat, a bigger hit on each bar (every 4 beats).
- `beat-pulse` (`bpm`, `from`, `count`, `accent`, or `at[]`; `kinds: ring|lines|edge`, `colour`, `strength`, `x`, `y`) on a top track: shockwave rings, speed lines and an edge flash on each beat. Pair it with camera kicks: `"camera": {"keys": [{"at": 0, "zoom": 1}], "pulses": [{"at": <beat s>, "amp": 0.035–0.09}], "shakes": [...]}` (bars stronger than beats).
- A song from Instagram's library can't be embedded: render silent, and also make a preview with a click track at the same BPM (ffmpeg `aevalsrc` sine clicks, higher pitch on each bar) so the person can judge the sync; they add the song in Instagram starting on a downbeat. Ask for a clip of the song to measure its tempo; if they can't, guess (epic/choir edits ≈ 120) and say so.
- Person effects on a talking clip at a desk: give `cutout` a desk line (`"below": 0.6`, `"feather": 0.1`, frame fraction) — the desk and laptop stay real and sharp in front, and clones stand behind the desk instead of carrying cut-out pieces of it.
- Screen recordings: `screen-mockup` with `"media": "m1", "in": <s>, "speed": 1` plays a recording inside the phone or browser (focus boxes and taps are fractions of the video frame).

## Style packs
A pack is one complete art direction. One choice sets the look, where the headline sits and which edge it hugs, how the key word is marked, the background, the frame marks, the transitions and the motion feel — so the video is coherent without picking effects one by one.
- **Preset videos:** `"pack": "<id>"` in `preset.json`, then `mba preset`. Do not also add backgrounds, transitions or marks by hand.
- **A storyboard you wrote yourself** (explainers, beat stories, concepts from `mba recommend`): `mba dress <dir or storyboard.json> --pack <id or number>`. It fills only what the storyboard left open (look, a headline's edge and entrance, background where track 0 is empty, a transition on cuts that have none, frame marks, motion blur) and never moves or retypes a scene; running it twice changes nothing. `mba recommend … --pack <id>` gives concept scenes already in the pack.
- **The person's pick always wins.** An effect or transition they name stays, even when it is from another look; `mba validate` prints style notes as advice only. `"motion"` set by the person overrides the pack's feel.
- **Which pack when nobody chose:** `signature-cream` for stories, tips and personal topics; `dark-tech` for tools, code and tutorials; `cinematic-laser` for hype, launches and beat videos; `swiss-red` for lists, numbers and business advice. Say which you picked in one line.

| `pack` | Headline | Key word | Marks | Under the object | Transitions |
|---|---|---|---|---|---|
| `signature-cream` | centred, upper third | orange box | chapter bar | a tilted paper card | paper tear, page turn, flood |
| `dark-tech` | flush right, under a code tag | drawn underline | tag + corner ticks | an interface panel | glitch cut, pixel curtain, blade slice |
| `cinematic-laser` | centred; a headline alone is laser-cut | accent colour | chapter bar | a pool of light and a glowing line | flood, iris, whip pan |
| `swiss-red` | large, flush right | one red word | rules + section number | a rule, a caption, a red square | colour wipe, ink slab, blinds |

`object-frame` (`kind: card | panel | spot | column`, `label`, `y`, `height`, `width`, `at`) is the pack's stage under the object of a sentence. A preset adds it by itself under small objects and words (never under a screen, a chat or the comment card). In a storyboard you write yourself, put it on the track just below the object, sized to the object's area, with the kind of the pack in use.

`frame-marks` (`tag{text, corner, mono}`, `rules[{y, from, to, at}]`, `ticks`, `number{value, corner}`, `alpha`) is the pack furniture on the edges of the safe area; put it on a fixed track. `kinetic-text` takes `"align": "right" | "left"` and a word takes `"underline": true`.

## Laser pack (dark cinematic tech look)
Use when the user asks for a tech / cinematic / dark / glowing style (or «ليزر», «تقني», «سينمائي»).
- `tech-grid` (`cell`, `glows`, `floor`) — the dark grid world; put it on track 0 under every Laser scene.
- `laser-type` (`lines` ≤ 2, `accent` words, `at`, `cut`, `y`, `size`) — a laser cuts the headline in: hot edge, cooling to white, sparks.
- `glow-words` (`words[{text, at, key}]`, `y`, `size`) — a dim sentence whose words light up as they are said; `key` words stay lit. English words keep their order.
- `laser-beam` (`beams[{from, to, at, dur, colour}]`, `boxes[{label, sub, x, y, from}]`, `marks`, `crosshair`) — beams with a hot head, diagram boxes, red ✕, guide lines. Two crossing red beams = strike-out.
- `beat-slam` (`words[{text, at}]`, `flash`) — on each beat a full-frame orange flash with one giant word.

## Explainers (when no preset fits)
An educational explainer («ليش…؟ شلون…؟») is written as its own `edit.json`, one visual per
sentence, timed to the voice's word times. Read `explainers.md` before writing one: the building
blocks (`knowledge-timeline`, `code-chat`, `web-crawl`, `misquote`, `context-window`,
`signature-card`), shortening long silences, and subtitles that never cross a sentence.
- AI chats are `code-chat` (a Claude-style terminal), never a messenger chat.
- The episode ends on `signature-card`; it fills itself from brand.json.

## Common mistakes
- A `say` phrase that is not in the transcript → the error names the slot; copy the words exactly
  as spoken (hamza and harakat don't matter).
- Two-word `show.word` for stretch / join / heavy / cut / brand → one word only.
- `stretch` on a word with no kashida slot (ورد، دار) → pick another word or use `heavy`.
- A `clip` whose `in` + section length runs past the recording → `validate` says so; lower `in`.
- Rendering before the images are approved.
