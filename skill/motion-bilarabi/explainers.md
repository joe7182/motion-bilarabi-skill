# Explainers — building blocks and recipe

For a script that explains an idea (not a list, tool demo or teaser preset). Every field is
documented in `engine/src/core/params/<file>.ts`; `mba validate` names any wrong field.

## Recipe
1. **Concept first.** Find the one object that carries the whole idea (e.g. a knowledge timeline
   for «knowledge cutoff»), and give every sentence its own visual built from that idea, not a
   word-to-icon match.
2. **Voice:** `mba project init <dir> voice.mp3`, `mba ingest <dir>`, `mba transcribe <dir>`.
   Check the transcript words line up with the script (whisper may split or misspell words);
   take the **text from the script**, the **times from the transcript**.
3. **Long silences:** find them with ffmpeg `silencedetect=noise=-38dB:d=0.4` and **show the list
   to the user** (time, length, the words around it). Shorten only the ones they pick — a pause
   the script marks `[long pause]` is often deliberate emphasis. Suggested lengths: 0.45 s for a
   kept beat, 0.3 s otherwise. Keep the original voice untouched; write the tightened copy as a new
   file (atrim + concat), map every time through the cuts, and say in the storyboard where time
   was removed.
4. **Layout:** headline on track 5 (`kinetic-text`, `mode: line`, one boxed word, `y` ≈ 0.06);
   objects on track 3 below it, never touching it; the bottom ~15 % stays free for subtitles.
5. **Subtitles:** one `captions` scene (track 6, `y` 0.88) whose cues come from `groupCaptions`
   on the script words, cut at every `. ؟ … ، :` first so no subtitle crosses a sentence.
6. **End:** `signature-card` (its own track, after the subtitles end).
7. Storyboard stills → approval → `mba render` → check, send. 60 fps, `autoSfx: false`.

## Building blocks
| Scene type | What it shows | Key fields |
|---|---|---|
| `knowledge-timeline` | A right-to-left time line: data drops up to a cutoff flag, the rest fogs over news marked «؟»; with `bridgeAt` a search bridge arcs to «اليوم» and brings a page back | `cut`, `fillAt`, `fillDur`, `cutAt`, `fogAt`, `bridgeAt?`, `news[]`, `y` |
| `code-chat` | A Claude Code-style terminal chat: prompt line, thinking spinner, typed reply, source links | `messages[{role: user\|ai, text, at, sources?}]`, `think`, `top`, `height` |
| `web-crawl` | A search page, a crawler bot scanning results, the picked page opening (`weak`: no lock, ads, broken picture) | `query`, `results[{title, url}]`, `pick`, `weak`, `typeAt`, `listAt`, `crawlAt`, `openAt` |
| `misquote` | A page's sentence (fact highlighted) and the AI summary getting the fact wrong — circled and struck | `page[3]`, `said[3]` (before · fact · after), `strikeAt` |
| `context-window` | Result cards break into tokens that fill «نافذة السياق» until «ممتلئة» | `sources[]`, `at`, `pour` |
| `signature-card` | The creator's closing card: photo ring, name, Latin name, tagline, links | all optional — filled from brand.json (`avatar`, `name`, `nameEn`, `tagline`, `taglineAccent`, `links`, `colors`) |
| `stamp` | A slammed word («مو دائماً», «صفحة ضعيفة») | `text`, `at`, `size`, `rot` |
| `kinetic-text` | Headlines; `mode: stack` with `strike` for «يقلّل… ما يمنعها» | `words[{text, at, box?, strike?}]` |
| `comment-drop` | Several answers dropping in (e.g. «نفس السؤال… جواب مختلف») | `comments[{name, text, at}]` |
| `live-cursor` | A named pointer selecting something («اضغط على المصدر») + a title pill | `path[]`, `box`, `title`, `titleAt` |

Cuts between beats: `iris`, `blade-slice` (a hard «لا»), `pixel-curtain`, `page-turn`.

## Don't
- Messenger-style chat for an AI answer → use `code-chat`.
- Receipts, image walls or icons that only match a word → the visual must show the idea.
- A visual or headline that covers the subtitles band.
