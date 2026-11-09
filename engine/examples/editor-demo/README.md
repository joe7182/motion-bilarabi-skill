# تجربة المحرّر على مقطعك — Editor demo on your own clip

<div dir="rtl">

## بالعربي

هذا الدليل يأخذ مقطعًا صوّرته بهاتفك ويمرّ به عبر المحرّر كله: إنشاء مشروع، ثم تجهيز المقطع،
ثم كتابة التعديل في `edit.json` (الفيديو على المسار 0 والموشن فوقه على المسار 1، مع انتقال بين
لقطتين)، ثم الفحص، ثم الإخراج النهائي مع الصوت، ثم المراجعة.

كل الأوامر تُشغَّل من داخل مجلد `engine/`. يمكن أن تحتوي المسارات على مسافات وحروف عربية
و`%`؛ ضع المسار بين علامتي تنصيص.

### ١. أنشئ المشروع

```
npm run mba -- project init "out/مشروعي" "C:/path/to/my-clip.mp4"
```

- يُنشئ المجلد `out/مشروعي` وفيه: `mba-project.json` (علامة المشروع)، و`source/` و`work/`
  و`renders/` و`review/`، و`edit.json` و`log.md`.
- يُنسخ مقطعك إلى `source/` نسخةً للقراءة فقط. **الملف الأصلي لا يُلمس أبدًا**، والأداة لا تكتب في
  مجلد لم تُنشئه هي.
- الحد في هذا الإصدار: 3 دقائق من المواد في المشروع كله.
- المقاس الافتراضي 9:16. إن كان مقطعك 4:5 أو 1:1 أضف `--format 4:5` (أو `1:1` أو `16:9`)،
  وإلا قُصّت الأطراف لتملأ الإطار.
- يمكن إضافة أكثر من مقطع: `project init "out/مشروعي" a.mp4 b.mp4`، فتأخذ المعرّفات `m1` و`m2`…

### ٢. جهّز المقطع (ingest)

```
npm run mba -- ingest "out/مشروعي"
```

- يصنع نسخة عمل `work/m1.mp4`: معدولة (يُصحَّح دوران الهاتف)، بمعدل إطارات ثابت 30 حتى لو كان
  مقطع الهاتف متغيّر المعدل، وبألوان عادية SDR إن كان HDR، وصوت AAC (أو مسار صامت إن لم يكن فيه صوت).
- يطبع سطرًا لكل مقطع بما وجده (مُدار 90°، إطارات متغيرة، HDR…).
- تشغيله مرة ثانية لا يعيد شيئًا إن لم يتغيّر المصدر.

### ٣. اكتب التعديل في `edit.json`

افتح `out/مشروعي/edit.json`. فيه في البداية مشهد `video` واحد بطول المقطع كله. استبدله بلقطاتك.
مثال (هو نفسه التعديل الذي جُرّب على مقطع حقيقي):

```json
{
  "version": 1,
  "format": "4:5",
  "fps": 30,
  "look": "dark-tech",
  "scenes": [
    { "id": "c1", "type": "video", "start": 0, "duration": 9, "track": 0, "params": { "media": "m1", "in": 3.0 } },
    { "id": "c2", "type": "video", "start": 9, "duration": 8, "track": 0, "params": { "media": "m1", "in": 33.0 } },
    { "id": "headline", "type": "slam", "start": 0.5, "duration": 2.5, "track": 1,
      "params": { "text": "تجربة المحرّر", "accent": "المحرّر" } },
    { "id": "outro", "type": "wipe-reveal", "start": 13.5, "duration": 3.5, "track": 1,
      "params": { "title": "يوسف", "subtitle": "@yousif_aljbouri" } }
  ],
  "transitions": [
    { "type": "whip-pan", "at": 9.0, "duration": 0.4, "track": 0, "params": { "direction": "left", "blur": 12 } }
  ]
}
```

ما تعنيه الحقول:

- `start` و`duration`: متى يظهر المشهد في الفيديو النهائي وكم يبقى (بالثواني).
- `params.media`: أي مقطع (`m1`، `m2`…)، و`params.in`: من أي ثانية في المقطع تبدأ اللقطة.
  اللقطة `c2` أعلاه تُظهر الثواني 33 إلى 41 من المقطع، في الثواني 9 إلى 17 من الفيديو.
- `format` و`fps` يجب أن يطابقا المشروع (`mba-project.json`).

القواعد بكلام بسيط:

- **المسارات (`track`)**: المسار الأعلى يُرسم فوق الأدنى. ضع الفيديو على المسار 0، والعناوين والموشن
  على المسار 1 أو أعلى. داخل المسار الواحد، المشهد المتأخر في القائمة يُرسم فوق السابق.
- **الانتقال (`transitions`)**: يقع على قَطع بين لقطتين **على المسار نفسه**: `at` يجب أن يكون نهاية
  مشهد واحد وبداية مشهد آخر على ذلك المسار. مدته بين 0.1 و1.2 ثانية، ونصفها يجب أن يتّسع في
  اللقطتين. الانتقال يغطّي مساره وما تحته فقط، **ولا يغطّي أبدًا مسارًا أعلى**: عنوان على المسار 1
  يبقى ظاهرًا فوق انتقال على المسار 0.
- **لا preroll لمشاهد الفيديو (R6)**: نقطة `in` هي أول إطار يظهر، فلا تضع `preroll` على مشهد
  `video` (يُرفض). مشاهد الموشن يمكن أن تأخذ `preroll`.
- يجب أن تكفي مدة المقطع: `in + duration` لا يتجاوز طول نسخة العمل، وإلا ظهر خطأ يحدّد الحقل.

للتأكد من صحة الملف دون إخراج:

```
npm run mba -- validate "out/مشروعي"
```

### ٤. افحص الثبات (verify)

```
npm run mba -- verify "out/مشروعي"
```

- يرسم إطارات مختارة مرتين (على صفحة جديدة، وبعد قفزات عشوائية) ويتأكد أنها متطابقة بكسلًا
  ببكسل، ضمن ميزانية 60 فحصًا. الناتج المطلوب: `Determinism check: OK`.
- عند الفشل يطبع مسارات صورتي الإطار المختلفتين في `review/verify/`.

### ٥. أخرج الفيديو (render)

```
npm run mba -- render "out/مشروعي"            # نهائي بالحجم الكامل
npm run mba -- render "out/مشروعي" --draft    # مسودة أسرع بنصف الحجم
```

- الناتج هو الإصدار التالي: `renders/v001-final.mp4` ثم `v002-…` وهكذا؛ لا يُكتب فوق إصدار سابق.
- يُخرَج على قطع من 10 ثوانٍ. إن انقطع (إغلاق الجهاز مثلًا) فشغّل الأمر نفسه ثانيةً: يُكمل من آخر
  قطعة منتهية.
- صوت مقطعك يوضع على الخط الزمني مع كل لقطة، وصمت حيث لا لقطة.
- يطبع الوقت المتبقي تقريبًا، ويضيف سطرًا إلى `log.md`.

### ٦. راجع (review)

```
npm run mba -- review "out/مشروعي"
```

- يصنع عُدّة مراجعة في `review/r1` (ثم `r2`… فلا يُمحى ما سبق؛ وإن انقطعت مراجعة أُكملت في
  مجلدها نفسه):
  - `contact.jpg`: إطاران في الثانية مع الوقت تحت كل صورة (وفي الفيديو الطويل `contact-2.jpg`…).
  - `strip_fast_1.jpg` و`strip_fast_2.jpg`: أسرع لحظتين، إطارًا إطارًا.
  - `phone.jpg`: كيف يبدو على شاشة الهاتف. و`safe.jpg` (لمقاس 9:16 فقط): مناطق واجهة المنصّات.
  - `metrics.json`: الإطارات شبه الفارغة، والثبات، والإيقاع، وفحص النص كل نصف ثانية.
  - `draft.mp4`: المسودة التي حُلّلت.
- افتح `contact.jpg` وانظر: العربي متصل وغير مقطّع، القَطع والانتقال واضحان، لا إطار فارغ.

</div>

## English summary

How to try the editor on your own phone clip, from `engine/`:

1. `npm run mba -- project init "out/my project" "my-clip.mp4" [--format 4:5]` creates the
   project (`mba-project.json`, `source/` with a read-only copy, `work/`, `renders/`, `review/`,
   `edit.json`, `log.md`). The original is never touched; at most 3 minutes of media. Pick the
   `--format` that matches the clip, or the edges are cropped to fill the frame.
2. `npm run mba -- ingest "out/my project"` makes the working copy `work/m1.mp4`: upright, constant
   30 fps, SDR, AAC audio (silence if none). A second run is a no-op.
3. Edit `edit.json`: `video` scenes on track 0 (`params.media` = `m1`, `params.in` = where in the
   clip the shot starts), motion (`slam`, `wipe-reveal`, …) on track 1+, and transitions on a cut of
   one track. Rules: a higher track always draws above a lower one; a transition sits on a cut of its
   own track and covers only that track and the ones below, never a higher one; video scenes take no
   `preroll` (R6: the in-point is the first visible frame). `npm run mba -- validate "out/my project"`
   checks it.
4. `npm run mba -- verify "out/my project"`: cold vs warm frames, pixel-identical, within a 60-probe
   budget.
5. `npm run mba -- render "out/my project" [--draft]`: the next version `renders/v001-final.mp4`,
   rendered in resumable 10 s chunks with the clip's audio; rerun the same command to resume.
6. `npm run mba -- review "out/my project"`: a review kit in `review/r1` (then `r2`, …; an unfinished
   kit is resumed): contact sheet(s), fast-moment strips, phone sheet, `metrics.json` and the draft.
   Look at `contact.jpg`.

Every command that takes a storyboard also takes the project folder (it stands for its `edit.json`).
