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
3. **Read the motion feel** from their words: smooth / ناعم / سلس / easy ease → `"motion": "easy"`;
   sharp / حاد / قوي / snappy / بدون ease → `"snappy"`; nothing said → `easy`. If «سريع» could mean
   a short video rather than snappy motion, ask one question.
4. **Project:** `mba project init <dir> [media...] --format 9:16` (60 fps by default; no media is
   fine for a video on a beat). It copies the user's files in — never edit their originals. Write
   `<dir>/preset.json`.
5. **Timing:**
   - Voice-over: `mba project add <dir> voice.mp3 --kind voice`, `mba ingest <dir>`, `mba transcribe <dir>`, then `mba preset <dir>`.
   - No voice: `mba preset <dir> --script script.txt --bpm 120` (words on the beat).
6. **Storyboard images:** `mba preset` prints the exact `mba still …` command (one moment per
   section). Run it, look at every image yourself first (does each part show its idea?), show them,
   and **wait for approval.** Notes → edit `preset.json`, run `mba preset` again, new images.
7. **Render:** `mba render <dir>` → `<dir>/renders/vNNN-final.mp4`. Then `mba review <video> --out …`
   and check `metrics.json`: no `nearBlankRuns` longer than 0.2 s. Send the video.

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
- On a person (`cutout`, after `mba matte`):
  - `background: "blur"` — back focus: the room itself, only blurred.
  - `mode: "grid"` (`pick`, `zoom`) — grid zoom: a carousel of video cards (the clip in different looks) over the head scrolls to the black-and-white card, the cursor picks it, it lands on the eyes as a lens and turns the whole scene black and white. A good opener.
  - `mode: "letters"` (`word`) — letter dive: the clip plays inside a giant word on paper, then the camera dives through a letter.
  - `mode: "clones"` — a clone row beside the person.
  - `mode: "code"` — the whole frame turns into code, the person in their own colours.
  - `mode: "dust"` + `background: "clean"` — blow away: the person dissolves, the room stays.
  - `orbit-ring` as a `back` scene below the cutout and a `front` scene above it; clip `zoom` under a still cutout = dolly zoom.
- Cuts: `profile-grid` (the scene shrinks into a tile of the creator's profile grid, the camera dives into the next scene's tile; **ask the user for 6–10 of their own post covers** and pass them as `tiles` (files next to the storyboard), and their handle as `user`), `page-turn`, `paper-tear`, `pen-dot-curtain`, `pixel-curtain`, `ink-slab`, `blinds`, `blade-slice`, `layer-explode`.
- A transition only moves scenes on its own track and below: put a full-frame cutout on track 0 when a cut must carry it.

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
