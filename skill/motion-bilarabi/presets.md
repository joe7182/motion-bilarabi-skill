# Presets — fields and examples

Every part has `say`: the phrase it is spoken on (first match after the previous part). Optional on
every part: `text` (headline, ≤ 4 words; default: the phrase), `box` (the one word in the red box),
`show` (what sits under the headline), `rec: true` (a camera REC frame over the part).
Every preset also takes `"pack"` (the style: `signature-cream`, `dark-tech`, `cinematic-laser`, `swiss-red` — it sets the look, layout, marks, transitions and motion feel; see «Style packs» in SKILL.md), `look` (only without a pack), `"motion": "easy" | "snappy"` (leave it out to use the pack's feel) and `"beat": { "bpm": 120 }`.

## Which preset
| # | `preset` | Script shape | Default look |
|---|---|---|---|
| 1 | `list` | «٤ أشياء…» then أولاً / ثانياً… then a comment CTA | swiss-red |
| 2 | `tool` | A real tool / site: what it is, the recorded moments, the result | signature |
| 3 | `loop` | A tip video whose last sentence runs into the first (the search bar opens and closes) | signature |
| 4 | `system` | How a system works: layers, flow, tools | signature |
| 5 | `teaser` | Short poetic lines → the brand word → «قريباً» | signature |
| 6 | `problem` | Pains → the cost («والنتيجة؟») → the solution in steps → CTA | signature |
| 7 | `steps` | A hook question → who it's for → steps 1-2-3 → the promise → CTA | swiss-red |
| 9 | `asked` | Followers' questions (pop as comment stickers) → the answer in steps → CTA | swiss-red |

Looks: `swiss-red` (paper / ink / red), `signature` (cream / ink / orange), `paper-editorial`,
`light-editorial`, `dark-tech`.

## Fields per preset
- `list`: `label` (bar word, «حركة»), `hook`, `items[2..8]` (+ `title`), `cta` (+ `keyword`).
- `tool`: `hook`, `intro?`, `demos[1..5]` (show `clip`), `result?`, `cta`.
- `loop`: `topic` (search text ≤ 26), `open`, `tips[2..6]` (+ `title`), `close`, `label`.
- `system`: `hook`, `parts[2..6]`, `cta`.
- `teaser`: `lines[2..6]` (+ `object`: the hero morphs into it), `brand` (+ `word`), `soon` (+ `stamp`).
- `problem`: `hook`, `pains[1..4]`, `cost`, `steps[2..4]` (+ `title`), `cta`.
- `steps`: `label` («خطوة»), `hook`, `audience?`, `steps[2..5]` (+ `title`), `promise?`, `cta`.
- `asked`: `title` («سألتوني»), `questions[1..6]` (`say`, `text`), `steps[1..5]` (+ `title`), `cta`.
A `cta` without `keyword` takes the brand's `keyword`.

## Shows (`show.kind`)
| kind | fields | use for |
|---|---|---|
| `words` | — | the spoken words, 3 at a time (default for items) |
| `object` | `objects[1..4]` | drawn objects that morph in turn — pick only from the guide below |
| `stretch` | `word` | kashida growing with a ruler («تتمـــدّد +271px») |
| `join` | `word`, `reverse?` | letters melting into the word (reverse: breaking apart — the mistake) |
| `heavy` | `word` | a word getting heavy |
| `said` | `said`, `written` | «قلنا: علّق / كتبها: عَلَط» |
| `cut` | `word` | an editor timeline cutting exactly on the word |
| `strike` | `wrong`, `right` | the wrong word struck, the right one in red |
| `clip` | `media`, `in`, `still?`, `url?`, `zoom?{x,y,scale}`, `mark?{x,y,w,h}`, `label?{x,y,text}` | a real recording / screenshot in a window |
| `layers` | `layers[2..5]{title, subtitle?, say?}` | a stack lighting up layer by layer |
| `graph` | `nodes[2..6]{id, label, kind?}`, `title?` | a flow wired in order |
| `logos` | `items[1..6]{image, label?}` | real logos popping in |
| `stamp` | `text` | a stamped word |
| `search` | `text` | a search bar typing |

`stretch`, `join`, `heavy`, `cut`, `strike.wrong`, `strike.right` and `brand.word` take **one word** each.

## Every part needs a visual — the hook too
The hook is the most important frame: give it a `show` (a `stamp` of the number, a `heavy` word,
a `strike`, an object), never bare words. For each part ask «what does this sentence *mean*?» and
show that. If no object below shows the idea, use a type trick (`strike` for a mistake, `stamp`
for a verdict, `said` for said-vs-written, `heavy` for a burden) — **never a near-miss object**
(a magnifier on a data table does not mean «an example»).

## Objects — what each one draws
| id | draws | good for |
|---|---|---|
| `document` | a page with text lines | a request, an article, a prompt, «كل شي بورقة وحدة» |
| `file` | a file icon | a file, an attachment |
| `chat` | a chat panel with bubbles | a conversation, asking an assistant |
| `ai-chip` | a circuit board with an AI chip | AI, a model |
| `bulb` | a light bulb | an idea |
| `magnifier` | a magnifier over a results card | searching, inspecting results (not «an example») |
| `tool` | a gear and a wrench | a tool, settings, fixing |
| `clock` | a clock face | time, waiting, speed |
| `calendar` | a calendar page | a date, a deadline, a schedule |
| `timeline` | a video-editor timeline window | editing video only |
| `microphone` / `voice-note` | a mic / a voice-message bubble | voice, recording, a voice-over |
| `envelope` / `bell` | a letter / a bell with notes | email, messages / notifications, reminders |
| `phone-app` / `follow` | a phone with an app / a follow button | an app / follow, subscribe |
| `photo` / `eye` | a photo / an eye | an image / seeing, attention |
| `coin` / `banknote` / `receipt` | money / an order slip | price, cost / a purchase |
| `scale` | a balance scale | comparing, a trade-off |
| `compass` / `pin` | a compass / a map pin | direction / a place |
| `hard-hat` | engineers in hard hats | a team, builders |
| `house`, `brick`, `blueprint`, `room`, `window`, `materials`, `sun`, `sun-path` | the home-building set | architecture and building videos only |
| `dot`, `ring`, `bar` | plain shapes | transitions only — never the idea of a sentence |

## Example (`list`)
```json
{
  "preset": "list", "label": "رقم", "motion": "easy",
  "hook":  { "say": "أربع أشياء", "text": "العربي يبان احترافي", "box": "احترافي", "show": { "kind": "heavy", "word": "احترافي" } },
  "items": [
    { "say": "أولاً الحروف",   "title": "الحروف",  "text": "خلها متصلة",    "show": { "kind": "join", "word": "العربي" } },
    { "say": "ثانياً التطويل", "title": "التطويل", "text": "الكشيدة تمدّ",   "show": { "kind": "stretch", "word": "تتمدد" } },
    { "say": "ثالثاً اللون",   "title": "اللون",   "text": "كلمة وحدة حمرة", "show": { "kind": "words" } },
    { "say": "رابعاً الكثرة",  "title": "الكثرة",  "text": "لا تكتب كلشي",   "show": { "kind": "strike", "wrong": "الجملة", "right": "الكلمة" } }
  ],
  "cta": { "say": "تبي القالب", "text": "علّق: عربي", "box": "عربي", "keyword": "عربي" }
}
```
More examples: `engine/examples/presets/`.
