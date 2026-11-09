# The director — writing `concept` and `visual` in plan.json (signature look)

The `signature` look turns a voiceover into the kind of video Yousif approved in the hand-placed
tests: the hero dot becomes the objects the script talks about, the camera breathes and pushes on
them, each section opens into a new world, and the brand word forms out of particles. The engine
compiles exactly what `plan.json` says. Your job, before any visual, is to understand the script.

Workflow:

1. `mba explain <project> --plan` writes `plan.json` with an empty `concept` and the default
   director's `visual` for every beat (a fallback from the words alone).
2. Read the whole script (`script.md`) and every beat's `words` in `plan.json`.
3. Write `concept` (step A), then choose each beat's `visual` (step B). Leave beats you have no
   better idea for as the default director wrote them.
4. `mba explain <project>` compiles your plan (a hand-edited plan is compiled as written; an
   invalid one is refused with an Arabic-first message naming the beat), then `mba render --draft`,
   `mba verify`, `mba review`, and look at stills.

## A. Concept first

Fill these three fields before touching a single beat:

```json
"concept": {
  "idea": "one sentence: what the viewer must understand or feel by the end",
  "metaphor": "one central image that carries the idea through the whole video",
  "arc": ["one line per section, in order: what changes in that section"]
}
```

- **The idea** is the script's claim, not its topic. «تضيّع ساعات في المونتاج… والوقت فلوس… مع موشن
  بالعربي الموضوع بسيط» is not "about editing"; its idea is *the hours you lose editing are money, and
  this gives them back*.
- **The metaphor** is the one image every section returns to. For voice 1 it was *time becomes
  money*: the clock that the viewer watches grow, then flip into a coin. For voice 2 (invoicing) it
  was *the month you spend chasing payments*: a calendar whose pages fall while customers run away.
  Pick the image that the script's own nouns already point at; never import a metaphor the words do
  not support.
- **The arc** has one line per `# section` of `script.md` (problem → cost → answer → call, or
  whatever the script really does). Each section is a different world on screen (paper / ink), so
  each line should name what is different in it.

## B. One visual per beat, following the concept

Each beat is one headline line. Its `visual` is one of:

| `kind` | What it shows | Use it when |
|---|---|---|
| `object` | the hero becomes `object` (clock, coin, document, microphone, timeline, calendar, envelope, bell, voice-note, phone-app, brick, house, blueprint, eye, photo, chat; ring / bar / dot only as bridges) | the sentence names a thing or an action that has a shape |
| `chase` | small customers run ahead of the accent dot (`customers` 3–7) | chasing, following up, running after people |
| `wall` | a grid of one word (`word` = its transcript index in this beat) | repetition: the same work again and again |
| `loop` | one word scrolling in an endless column (`word`) | every day, always, a cycle |
| `particles` | the dot bursts into particles that form the word (`word`) | the brand / product name, once per video |
| `none` | the hero waits as a dot | sentences that are the voice's own emphasis (a question, a pause) |

Object options: `text` (the line a document writes first, ≤ 40 characters), `flipSec` (calendar:
seconds per month page), `checkAt` (phone-app: seconds until the notification becomes the paid
check; house / blueprint / eye / chat: their second beat — the windows light up, the signature,
the eye closes and is struck through, the photo is sent), `spin` (coin turns, default 1). A brick
state with `text: 'fall'` shows speed streaks on arrival. The coin also takes `IQD` («د.ع»).

Stage 2 objects (the cost and sun sections) take `beats` (seconds after arrival, ascending, ≤ 8;
missing ones keep the object's default spacing): `scale` (bills drop on the right pan with the price
tag = `text`, the beam tips, a faint «؟» card on the left pan), `materials` (brick, cement, sand,
gravel drop in; beats[4] doubles them per floor), `sun`, `room` (beats[0] summer, beats[1] winter),
`pin` (lands at beats[0]; label = `text`, e.g. «بغداد»), `window` (`text` 'rays' | 'glass' | 'zero':
the kWh meter up, double glass and down, or the «منور» gap that gets no sun), `sun-path` (summer
then winter arc), `file` (name = `text`; «مجاناً» stamp, software tiles struck through). A brick's
`text` also picks a variant: 'gulf', 'thermostone', 'measure'. Money in this reel is the
`banknote` (the Iraqi dinar is paper), never a coin.

Video 2 objects (the hook and «مهمتي»), also with `beats`: `hard-hat` (three engineers pop up;
beats[0] they turn upset, beats[1] steam huffs and the middle hat jumps — «المهندسين راح يزعلون منّي»),
`bulb` (switches on at beats[0] — an idea), `ai-chip` (pulses run into the chip after beats[0] — AI),
`tool` (gear and wrench; the wrench turns the bolt at beats[0] — a useful tool), `magnifier` (the glass
reads a results card, stops at beats[0] with a check — verifying results), `follow` (a profile card;
the follow button is pressed at beats[0] — «تابعني»), `compass` (the needle settles on «ش» by beats[0]
— direction), `receipt` (a purchase order struck through and stamped «تقدير أولي» at beats[0] — an
estimate, not an order).

Rules (Yousif's, from the reviews of the hand-placed tests):

1. **The most specific object for the sentence's own nouns and verbs.** «فواتير بالإيميل» is an
   envelope with invoices, not a document; «سجّل ملاحظة بصوتك» is a voice note, not a microphone;
   «سجّل صوتك» (recording content) is the microphone; «اكتب السكربت» is the document writing
   «السكربت»; «تلاحق عملاءك» is the chase. When the concept gives a better object than the literal
   word (a calendar for «كم ساعة تضيّع كل شهر» in an invoicing script), follow the concept.
2. **Abstract dot / ring / bar are bridges only**, between two ideas or in a section that names no
   thing at all — never the visual of a sentence that names something.
3. **Never reuse another script's sequence.** Voice 1 and voice 2 both start with time and end with a
   call; their objects differ because their concepts differ. Choose from this script's words.
4. **One signature moment per section**: the moment the section is remembered by (the clock flipping
   into a coin, the particles forming the brand, the chase). Do not stack two big moments in one
   section; let the others be quieter objects or `none`.
5. **Let objects breathe.** An object needs about a second on screen before the next replaces it;
   two short sentences about the same thing keep one object (`none` on the second keeps it there).
6. **The particle word once**, on the brand or CTA keyword where it is first said (not in the first
   beat). The engine shows that word in the accent colour, fading in as the particles land.
7. **The end card's section** needs no object: the comment card is its visual.
8. **Words stay readable.** Objects live in the lower object zone, headlines in the top zone; the
   engine keeps them apart in every format. A `wall` sits behind its headline as faint texture.

## What the engine does with your plan

- Headlines: one short line per beat (≤ 3 words), in the top zone, on a track the camera does not
  move; a stressed word punches only when it is alone on its line, else it is drawn in the accent.
- The hero morphs into each beat's object at that beat's first object word (else its first stressed
  word, else its start), lands on the first object of each section, rests as a dot between ideas,
  waits low and small during a chase / wall / loop and under the end card.
- Sections alternate paper / ink (halftone dots in the last), opening through a reveal (circle,
  bands, panel) from wherever the hero is.
- The camera drifts (handheld), shakes on stressed words and object landings, and pushes in a little
  on each object (less on wide objects; not at all where the push would bring the object into the
  headlines).
- Microphone, voice note and timeline follow the real voice levels.
- A coin shows `brief.currency` (AED, SAR, USD, EUR; anything else falls back to AED with a warning).

## Example (voice 1, «موشن بالعربي»)

```json
"concept": {
  "idea": "الساعات التي تضيع في المونتاج فلوس، وموشن بالعربي يرجعها لك",
  "metaphor": "الساعة تكبر ثم تنقلب عملة",
  "arc": ["وقتك يضيع كل أسبوع", "الوقت الضائع شغل مكرر… وفلوس", "الحل: اكتب، سجّل، والمهارة تحرّك", "جرّبها: علّق موشن"]
}
```

Beats (abridged): «تضيّع ساعات» → `{ "kind": "object", "object": "clock" }`; «كل أسبوع» →
`{ "kind": "object", "object": "calendar" }`; «على شغل مكرر» → `{ "kind": "wall", "word": 17 }`;
«فلوس» → `{ "kind": "object", "object": "coin" }`; «مع موشن بالعربي» →
`{ "kind": "particles", "word": 22 }`; «أولاً اكتب السكربت» →
`{ "kind": "object", "object": "document", "text": "السكربت" }`; «ثانياً سجّل صوتك» → microphone;
«ثالثاً خل المهارة» → timeline; «تبي تجربها؟» → `{ "kind": "none" }`.
