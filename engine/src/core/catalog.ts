/**
 * The effects catalog: every scene type, its modes and every transition, with the Arabic name people
 * use, what it does, and a sentence to ask Claude. `scripts/catalog.ts` writes EFFECTS.md (with the
 * preview images in media/effects) and skill/motion-bilarabi/catalog.md from this list; a unit test
 * checks it against the engine.
 *
 * `id`: a scene type (`stamp`), a mode of one (`cutout:grid`, `arabic-move:dots-drop`,
 * `kinetic-text:strike`) or a transition (`transition:paper-tear`).
 */
export interface CatalogEntry {
  id: string
  group: CatalogGroup
  ar: string
  does: string
  ask: string
  img?: string
  /** How to write it when the id alone does not say (a param rather than a mode). */
  use?: string
}

export const CATALOG_GROUPS = ['text', 'arabic', 'laser', 'person', 'transitions', 'objects', 'screens', 'ai', 'creator', 'basics'] as const
export type CatalogGroup = (typeof CATALOG_GROUPS)[number]
export const GROUP_TITLES: Record<CatalogGroup, string> = {
  text: 'حركات النص — Text animation',
  arabic: 'حركات العنوان العربي — Arabic headline moves',
  laser: 'ستايل الليزر — Laser (dark cinematic tech)',
  person: 'مؤثرات على شخصك — Effects on you (needs a clip + mba matte)',
  transitions: 'الانتقالات — Transitions',
  objects: 'أشياء ورسومات — Objects & diagrams',
  screens: 'شاشات وواجهات — Screens & apps',
  ai: 'شرح الذكاء الاصطناعي — AI explainers',
  creator: 'عناصر الكرييتر والختام — Creator elements & endings',
  basics: 'أساسيات — Basics',
}

export const CATALOG: CatalogEntry[] = [
  // Text
  { id: 'kinetic-text', group: 'text', ar: 'عنوان متحرك', does: 'كلمات تدخل وحدة وحدة، وكلمة وحدة بصندوق ملوّن', ask: 'خلّ العنوان يطلع كلمة كلمة، و«…» بالصندوق', img: 'kinetic-line' },
  { id: 'kinetic-text:giant', group: 'text', ar: 'كلمة عملاقة', does: 'كلمة وحدة تملأ الشاشة', ask: 'خلّ كلمة «…» عملاقة بالنص' },
  { id: 'kinetic-text:stack', group: 'text', ar: 'كلمات فوق بعض', does: 'كلمات تتراكم سطر تحت سطر', ask: 'رتّب «…» كلمات فوق بعض', img: 'kinetic-stack' },
  { id: 'kinetic-text:strike', group: 'text', ar: 'شطب الكلمة', does: 'خط يشطب كلمة غلط لحظة ما تقولها', ask: 'اشطب كلمة «…» لما أقول «…»', img: 'strike', use: 'a word in kinetic-text with `"strike": { "at": s }`' },
  { id: 'editorial-type', group: 'text', ar: 'تحريري متحرك', does: 'خط عريض ويا خط مائل (أميري) بنفس العنوان، الكلمات تطلع من الضبابية، صندوق تحديد مثل برامج التصميم، وكلمة تتبدّل بكلمة', ask: 'سوّ العنوان تحريري، «…» بالخط المائل، وحدّدها وبدّلها بـ «…»', img: 'editorial-type' },
  { id: 'glitch-text', group: 'text', ar: 'جلتش', does: 'العنوان يتشوّش ويدخل: نسخ حمرة وزرقة تنفصل وشرائح تزحلق، ضربات على الإيقاع، ويتشوّش لكلمات ثانية', ask: 'خلّ «…» يدخل بجلتش ويتحوّل لـ «…»', img: 'glitch-text' },
  { id: 'sketch-words', group: 'text', ar: 'رسم بالقلم', does: 'الكلمات تنرسم بالرصاص: حدود الحروف تنخطّ وبعدين تظليل خطوط، والخط يرتجف مثل الرسم اليدوي', ask: 'ارسم «…» بالقلم الرصاص', img: 'sketch-words' },
  { id: 'red-pen', group: 'text', ar: 'قلم المحرّر الأحمر', does: 'قلم أحمر يشطب، يدوّر، يخطّ تحت، يحط ✓ و✗ وسهم، ويكتب ملاحظة بخط اليد', ask: 'اشطب «…» بالأحمر واكتب فوقها «…»', img: 'red-pen' },
  { id: 'slam', group: 'text', ar: 'ضربة العنوان', does: 'الكلمات تنضرب من كبير ومغبّش لمكانها', ask: 'خلّ العنوان ينضرب بقوة' },
  { id: 'type-stretch', group: 'text', ar: 'تمدّد الكشيدة', does: 'الكلمة تتمدّد بالكشيدة ويا مسطرة', ask: 'مدّد كلمة «…» بالكشيدة', img: 'type-stretch' },
  { id: 'letters-join', group: 'text', ar: 'تجميع الحروف', does: 'الحروف تطير وتتجمّع لكلمة متصلة', ask: 'خلّ حروف «…» تتجمّع', img: 'letters-join' },
  { id: 'heavy-word', group: 'text', ar: 'كلمة ثقيلة', does: 'كلمة تنزل وتثقّل الخط تحتها', ask: 'خلّ «…» كلمة ثقيلة', img: 'heavy-word' },
  { id: 'said-written', group: 'text', ar: 'قلنا وكتبها', does: 'اللي انقال ضد اللي انكتب غلط', ask: 'وريني «قلنا … كتبها …»' },
  { id: 'word-cut', group: 'text', ar: 'قصّ على الكلمة', does: 'تايم لاين مونتاج يقصّ على الكلمة', ask: 'سوّ قصّ مونتاج على كلمة «…»' },
  { id: 'stamp', group: 'text', ar: 'ختم', does: 'ختم مائل ينضرب على الشاشة', ask: 'اختم «…» على الشاشة', img: 'stamp' },
  { id: 'highlight', group: 'text', ar: 'تعليم باليد', does: 'دائرة أو خط مرسوم باليد حول شي', ask: 'دوّر على «…» بخط اليد' },
  { id: 'word-wall', group: 'text', ar: 'جدار كلمة', does: 'الكلمة تتكرر وتملأ الخلفية', ask: 'سوّ جدار من كلمة «…»' },
  { id: 'wipe-reveal', group: 'text', ar: 'كشف بالمسح', does: 'العنوان ينكشف بمسحة من اليمين', ask: 'اكشف العنوان بمسحة' },
  { id: 'repeat-loop', group: 'text', ar: 'تكرار الصدى', does: 'نسخ باهتة من الجملة تدور حولها', ask: 'كرّر الجملة كصدى حولها' },
  { id: 'section-number', group: 'text', ar: 'رقم القسم', does: 'رقم كبير يطلع من تحت الشاشة', ask: 'حط رقم كبير لكل قسم' },
  { id: 'particle-word', group: 'text', ar: 'جزيئات تصير كلمة', does: 'جزيئات تنفجر من شي وتتجمّع كلمة', ask: 'خلّ المصباح ينفجر جزيئات وتصير «…»', img: 'particle-word' },
  // Arabic moves
  { id: 'arabic-move:letters-snap', group: 'arabic', ar: 'الحروف تتطابق', does: 'شرائح من السطر تطفو وبعدين تنطبق', ask: 'خلّ «…» تتطابق حروفها', img: 'letters-snap' },
  { id: 'arabic-move:dots-drop', group: 'arabic', ar: 'النقاط تنزل', does: 'نقاط الحروف تنزل بمكانها', ask: 'خلّ نقاط «…» تنزل', img: 'dots-drop' },
  { id: 'arabic-move:pen-write', group: 'arabic', ar: 'قلم يكتب', does: 'قلم يكتب الكلمة جزء جزء', ask: 'خلّ القلم يكتب «…»', img: 'pen-write' },
  { id: 'arabic-move:word-melt', group: 'arabic', ar: 'الكلمة تذوب', does: 'كلمة تذوب وتصير كلمة ثانية', ask: 'ذوّب «…» وخلّها تصير «…»', img: 'word-melt' },
  { id: 'arabic-move:decrypt', group: 'arabic', ar: 'تشفير', does: 'حروف عشوائية تستقر على الكلمة', ask: 'شفّر «…» وبعدين تنكشف', img: 'decrypt' },
  { id: 'arabic-move:unblur', group: 'arabic', ar: 'وضوح تدريجي', does: 'الكلمات تتوضح وحدة وحدة', ask: 'خلّ الجملة تتوضح كلمة كلمة' },
  { id: 'arabic-move:redacted-stamp', group: 'arabic', ar: 'السر ينكشف', does: 'شرائط سودة تنشال وبعدين ختم', ask: 'خبّي «…» بشريط أسود وبعدين اكشفه', img: 'redacted-stamp' },
  { id: 'arabic-move:kufi-tiles', group: 'arabic', ar: 'مربعات كوفي', does: 'مربعات تبني الكلمة على شبكة', ask: 'ابني «…» بمربعات كوفي', img: 'kufi-tiles' },
  { id: 'arabic-move:echo-stack', group: 'arabic', ar: 'صدى', does: 'نسخ مفرّغة فوق وتحت الكلمة', ask: 'سوّ صدى لكلمة «…»', img: 'echo-stack' },
  // Laser
  { id: 'tech-grid', group: 'laser', ar: 'شبكة تقنية', does: 'خلفية داكنة بشبكة وتوهّج خفيف، أو أرضية منظور', ask: 'خلّ الستايل تقني ليزر', img: 'tech-floor' },
  { id: 'laser-type', group: 'laser', ar: 'قصّ بالليزر', does: 'ليزر يقصّ العنوان، الحافة حمرة وتبرد للأبيض، وشرار', ask: 'خلّ العنوان يتقصّ بالليزر', img: 'laser-type' },
  { id: 'laser-beam', group: 'laser', ar: 'أشعة ليزر', does: 'شعاع ليزر، خطوط إرشاد، مخطط بصناديق وعلامة ✕', ask: 'خلّ شعاع ليزر يمرّ، وارسم مخطط «…» ← «…»', img: 'laser-beam' },
  { id: 'glow-words', group: 'laser', ar: 'كلمات تتوهّج', does: 'الجملة باهتة وكل كلمة تتوهّج لما تنقال', ask: 'خلّ الجملة تتوهّج كلمة كلمة', img: 'glow-words' },
  { id: 'beat-slam', group: 'laser', ar: 'ضربات الإيقاع', does: 'على كل ضربة، الشاشة برتقالية وكلمة عملاقة', ask: 'سوّ ضربات «و · هذا · جنون» على الإيقاع', img: 'beat-slam' },
  // Person
  { id: 'cutout', group: 'person', ar: 'قصّ الشخص', does: 'يقصّك من الفيديو بحواف احترافية؛ أي شي بمسار أوطى يصير وراك', ask: 'حط العنوان وراي' },
  { id: 'cutout:grid', group: 'person', ar: 'شبكة زوم', does: 'كروت فيديو فوق راسك، يختار الأبيض والأسود ويدخل', ask: 'سوّ شبكة زوم فوق راسي', img: 'grid' },
  { id: 'cutout:letters', group: 'person', ar: 'غوص بالحروف', does: 'الفيديو داخل كلمة عملاقة والكاميرا تغوص', ask: 'خلّ الفيديو داخل كلمة «…» وغوص فيها', img: 'letter-dive' },
  { id: 'cutout:clones', group: 'person', ar: 'نسخ متكررة', does: 'نسخ منك تطلع على الجانبين', ask: 'سوّ نسخ مني على الجانبين', img: 'clones' },
  { id: 'cutout:code', group: 'person', ar: 'جسم من الكود', does: 'الشاشة كلها تصير كود وإنت بألوانك', ask: 'خلّني جسم من الكود', img: 'code-body' },
  { id: 'cutout:dust', group: 'person', ar: 'يتطاير', does: 'تتطاير غبار والغرفة تبقى', ask: 'خلّني أتطاير', img: 'blow-away' },
  { id: 'cutout:layers', group: 'person', ar: 'انفجار طبقات', does: 'اللقطة تنفصل طبقات ثلاثية: الخلفية، إنت، النص، الصوت', ask: 'فجّر المشهد طبقات', img: 'layers' },
  { id: 'cutout:dolly', group: 'person', ar: 'زوم دوللي', does: 'الخلفية تبتعد وإنت ثابت', ask: 'سوّ زوم دوللي', img: 'dolly-zoom', use: 'cutout with `"background": "clean", "dolly": [1, 1.35]`' },
  { id: 'cutout:blur', group: 'person', ar: 'تركيز خلفي', does: 'الغرفة تتغبّش وإنت واضح', ask: 'غبّش الخلفية وخلّني واضح', img: 'back-focus', use: 'cutout with `"background": "blur"`' },
  { id: 'orbit-ring', group: 'person', ar: 'حلقة مدار', does: 'كلمات تدور حول راسك من قدّام ومن ورا', ask: 'خلّ كلمات «…» تدور حول راسي', img: 'orbit-ring' },
  { id: 'zoom-callout', group: 'person', ar: 'عدسة تكبير', does: 'دائرة على تفصيلة بالمقطع، خطين، وعدسة تطلع تكبّرها ويا عنوان', ask: 'كبّر «…» بعدسة واكتب «…»' },
  { id: 'video', group: 'person', ar: 'مقطع فيديو', does: 'مقطعك كما هو، مع زوم أو كتم الصوت', ask: 'حط مقطعي هنا، وكتّم صوته' },
  // Transitions
  { id: 'space-field', group: 'transitions', ar: 'مساحة واحدة', does: 'كل الأفكار بمساحة وحدة: الكاميرا تطير من فكرة لفكرة وكل وحدة تبدأ حركتها لما توصل، طبقات بارالاكس، وبالنهاية ترجع تشوف المساحة كلها', ask: 'خلّ الفيديو مساحة وحدة والكاميرا تتنقّل بين الأفكار', img: 'one-space', use: 'scenes with `"place": {x, y, scale}` + `"camera": {"tour": {}}` + `space-field` layers — copy engine/examples/one-space.json' },
  { id: 'transition:paper-tear', group: 'transitions', ar: 'تمزيق ورق', does: 'اللقطة نفسها تتمزّق بحواف ورق حقيقية', ask: 'انتقل بتمزيق ورق', img: 'paper-tear' },
  { id: 'transition:page-turn', group: 'transitions', ar: 'قلب صفحة', does: 'صفحة تنقلب مثل كتاب عربي', ask: 'انتقل بقلب صفحة', img: 'page-turn' },
  { id: 'transition:blade-slice', group: 'transitions', ar: 'قصّ بالشفرة', does: 'شفرة تقصّ المشهد ونصّه يزحلق', ask: 'انتقل بقصّة شفرة' },
  { id: 'transition:blinds', group: 'transitions', ar: 'ستائر', does: 'شرائح تنفتح من اليمين', ask: 'انتقل بستائر' },
  { id: 'transition:ink-slab', group: 'transitions', ar: 'لوح حبر', does: 'لوح غامق بحافة ملوّنة يمسح الشاشة', ask: 'انتقل بلوح حبر' },
  { id: 'transition:pixel-curtain', group: 'transitions', ar: 'ستارة بكسل', does: 'مربعات تغطي وتكشف', ask: 'انتقل ببكسلات' },
  { id: 'transition:pen-dot-curtain', group: 'transitions', ar: 'نقاط القلم', does: 'قطرة حبر وبعدين معيّنات تغطي', ask: 'انتقل بنقاط القلم' },
  { id: 'transition:profile-grid', group: 'transitions', ar: 'شبكة البروفايل', does: 'المشهد يصير مربع بشبكة حسابك ويدخل بالثاني', ask: 'انتقل بشبكة بروفايلي (وأرسل صور منشوراتك)', img: 'profile-grid' },
  { id: 'transition:layer-explode', group: 'transitions', ar: 'انفجار ألواح', does: 'المشهد يميل لوح زجاج ويطلع الثاني', ask: 'انتقل بانفجار ألواح' },
  { id: 'transition:iris', group: 'transitions', ar: 'دائرة', does: 'دائرة تفتح أو تسكّر', ask: 'انتقل بدائرة' },
  { id: 'transition:color-wipe', group: 'transitions', ar: 'مسحة لون', does: 'لون يمسح الشاشة', ask: 'انتقل بمسحة لون' },
  { id: 'transition:whip-pan', group: 'transitions', ar: 'سحبة سريعة', does: 'الكاميرا تنسحب بسرعة للمشهد الثاني', ask: 'انتقل بسحبة سريعة' },
  { id: 'transition:zoom-through', group: 'transitions', ar: 'زوم عبر', does: 'زوم داخل المشهد للثاني', ask: 'انتقل بزوم داخل' },
  { id: 'transition:glitch-cut', group: 'transitions', ar: 'قطع جلتش', does: 'قطع بتشويش رقمي', ask: 'انتقل بجلتش' },
  { id: 'transition:morph', group: 'transitions', ar: 'تحوّل', does: 'عنصر من المشهد يطير ويصير جزء من الثاني', ask: 'خلّ «…» يتحوّل للمشهد الجاي' },
  { id: 'transition:flood', group: 'transitions', ar: 'فيضان لون', does: 'لون يفيض من نقطة ويغطي', ask: 'انتقل بفيضان لون' },
  { id: 'transition:reveal', group: 'transitions', ar: 'كشف', does: 'العالم الجديد ينكشف تحت القديم', ask: 'اكشف المشهد الجاي من تحت' },
  // Objects
  { id: 'morph-object', group: 'objects', ar: 'شي يتحوّل', does: 'رسومات (مصباح، ملف، بيت، عملة…) تتحوّل لبعض', ask: 'ارسم مصباح ويتحوّل لـ «…»', img: 'bulb' },
  { id: 'line-art', group: 'objects', ar: 'رسم خطّي', does: 'رسمة خطوط بسيطة لفكرة', ask: 'ارسم «…» بخطوط بسيطة' },
  { id: 'icon', group: 'objects', ar: 'أيقونة', does: 'أيقونة وعنوانها', ask: 'حط أيقونة «…»' },
  { id: 'stat-bars', group: 'objects', ar: 'أشرطة أرقام', does: 'أشرطة تكبر وحدة وحدة والأرقام تعدّ، وشريط بطل باللون', ask: 'سوّ أشرطة: «…» ٤٥٪، «…» ٢٠٪، والأول بطل', img: 'stat-bars' },
  { id: 'gauge-ring', group: 'objects', ar: 'عدّاد دائري', does: 'حلقة تمتلي لحد النسبة والرقم يعدّ بالنص', ask: 'سوّ عدّاد دائري يوصل ٨٧٪ «…»', img: 'gauge-ring' },
  { id: 'live-timer', group: 'objects', ar: 'مؤقّت حي', does: 'ساعة إيقاف أو عدّ تنازلي بنقطة تنبض وحلقة تقدّم', ask: 'سوّ عدّ تنازلي من ١٠ ثواني «…»', img: 'live-timer' },
  { id: 'counter', group: 'objects', ar: 'عدّاد', does: 'رقم يعدّ لحد قيمة', ask: 'خلّ الرقم يعدّ لـ «…»', img: 'counter' },
  { id: 'build-number', group: 'objects', ar: 'رقم يتبني', does: 'أشياء تنزل وتبني رقم', ask: 'ابني الرقم «…» من قطع' },
  { id: 'numbered-slots', group: 'objects', ar: 'خانات مرقّمة', does: 'كروت مرقّمة من اليمين', ask: 'سوّ ٣ خانات مرقّمة' },
  { id: 'checklist', group: 'objects', ar: 'قائمة تتعلّم', does: 'بنود تنعلّم ✓ وحدة وحدة', ask: 'سوّ قائمة تتعلّم: «…»', img: 'checklist' },
  { id: 'node-graph', group: 'objects', ar: 'مخطط سير عمل', does: 'صناديق متصلة مثل n8n', ask: 'ارسم سير العمل: «…» ← «…»' },
  { id: 'layer-stack', group: 'objects', ar: 'طبقات متكدّسة', does: 'ألواح فوق بعض لشرح نظام', ask: 'وريني الطبقات: «…»' },
  { id: 'ecg-line', group: 'objects', ar: 'نبض', does: 'خط نبض والكلمات على الضربات', ask: 'سوّ خط نبض والكلمات عليه' },
  { id: 'shape-states', group: 'objects', ar: 'شكل يتنقّل', does: 'شكل واحد يتحوّل زر، كرت، نافذة', ask: 'خلّ الزر يتحوّل لنافذة' },
  { id: 'book-flip', group: 'objects', ar: 'كتاب يتقلّب', does: 'كتاب مفتوح صفحاته تتقلّب', ask: 'قلّب صفحات كتاب' },
  { id: 'chase', group: 'objects', ar: 'مطاردة', does: 'أشخاص صغار يركضون ورا شي', ask: 'خلّ الزبائن يركضون ورا «…»' },
  { id: 'microscope', group: 'objects', ar: 'عدسة', does: 'عدسة تكبّر جزء والباقي يغمق', ask: 'كبّر «…» بعدسة' },
  { id: 'viewfinder', group: 'objects', ar: 'إطار كاميرا', does: 'زوايا REC تتسكّر على المشهد', ask: 'حط إطار كاميرا يسجّل' },
  { id: 'hero', group: 'objects', ar: 'العنصر البطل', does: 'نقطة أو كرة تتنقّل بين المشاهد', ask: 'خلّ نقطة وحدة تمشي ويا الفيديو كله' },
  { id: 'logo-row', group: 'objects', ar: 'صف شعارات', does: 'شعارات تطلع وحدة وحدة', ask: 'حط شعارات «…»' },
  // Screens
  { id: 'code-chat', group: 'screens', ar: 'شاشة Claude Code', does: 'محادثة ذكاء اصطناعي كشاشة برمجة', ask: 'وريني المحادثة بشاشة Claude Code', img: 'code-chat' },
  { id: 'permission-prompt', group: 'screens', ar: 'نافذة الموافقة', does: 'Claude يطلب موافقة وتنختار «لا تسألني مرة ثانية»', ask: 'وريني نافذة موافقة Claude', img: 'permission-prompt' },
  { id: 'code-file', group: 'screens', ar: 'ملف كود', does: 'محرّر أسطره تنكتب، والسر يتوهّج أحمر', ask: 'وريني ملف «…» والسطر الخطر', img: 'code-file' },
  { id: 'app-window', group: 'screens', ar: 'نافذة تطبيق', does: 'نافذة تطبيق أو طرفية فيها أسطر', ask: 'حط نافذة طرفية تكتب «…»' },
  { id: 'screen-clip', group: 'screens', ar: 'تسجيل شاشة', does: 'تسجيل شاشتك داخل نافذة متصفح', ask: 'حط تسجيل الشاشة بنافذة' },
  { id: 'search-typing', group: 'screens', ar: 'بحث يتكتب', does: 'شريط بحث يكتب', ask: 'خلّ البحث يكتب «…»' },
  { id: 'web-crawl', group: 'screens', ar: 'زاحف البحث', does: 'نتائج بحث وروبوت يختار صفحة', ask: 'وريني البحث والروبوت يختار صفحة' },
  { id: 'phone', group: 'screens', ar: 'جوال', does: 'جوال بشاشة صورة أو رسائل', ask: 'حط «…» على شاشة جوال', img: 'phone' },
  { id: 'notify-stack', group: 'screens', ar: 'إشعارات الجوال', does: 'إشعارات تنزل من فوق وتتكدّس: واتساب، إنستغرام، البنك…', ask: 'نزّل إشعارات: «…»، «…»، «…»', img: 'notify-stack' },
  { id: 'chat-thread', group: 'screens', ar: 'محادثة واتساب', does: 'محادثة رسائل حجز', ask: 'سوّ محادثة رسائل' },
  { id: 'profile-card', group: 'screens', ar: 'كرت بروفايل', does: 'كرت حساب بالأرقام', ask: 'حط كرت بروفايلي' },
  { id: 'skill-deck', group: 'screens', ar: 'كروت السكلز', does: 'صندوق يوزّع كروت على Claude Code وCursor', ask: 'وزّع السكلز على الأدوات', img: 'skill-deck' },
  { id: 'twin-sync', group: 'screens', ar: 'جهازين متطابقين', does: 'جهازك وجهاز صديقك بنفس النسخ وملف قفل', ask: 'وريني جهازي وجهاز صديقي متطابقين', img: 'twin-sync' },
  // AI explainers
  { id: 'knowledge-timeline', group: 'ai', ar: 'تاريخ توقّف المعرفة', does: 'خط زمني يتعلّم لحد تاريخ وبعده ضباب', ask: 'اشرح تاريخ توقّف المعرفة' },
  { id: 'misquote', group: 'ai', ar: 'ملخص غلط', does: 'الصفحة تقول رقم والملخص يقول غيره', ask: 'وريني ملخص غلط لصفحة' },
  { id: 'context-window', group: 'ai', ar: 'نافذة السياق', does: 'كروت تتكسر توكنز وتملأ النافذة', ask: 'وريني نافذة السياق تمتلي' },
  { id: 'token-stream', group: 'ai', ar: 'توكن ورا توكن', does: 'الجواب ينبني قطعة قطعة', ask: 'وريني الجواب ينكتب توكن ورا توكن', img: 'token-stream' },
  { id: 'token-odds', group: 'ai', ar: 'نسب الكلمة الجاية', does: 'أشرطة نسب، وشريط temperature يغيّرها', ask: 'وريني نسب الكلمة الجاية وtemperature', img: 'token-odds' },
  { id: 'loaded-die', group: 'ai', ar: 'زار مغشوش', does: 'زار ثلاثي بوجوه كلمات', ask: 'اشرح العشوائية بزار مغشوش', img: 'loaded-die' },
  { id: 'server-batch', group: 'ai', ar: 'السيرفر بنفس اللحظة', does: 'أسئلة كثيرة تدخل السيرفر وكلمة بجوابك تتغيّر', ask: 'وريني السيرفر يحسب أسئلة كثيرة', img: 'server-batch' },
  // Creator
  { id: 'effect-list', group: 'creator', ar: 'قائمة المؤثرات', does: 'لوحة «بهذا الفيديو» تتعلّم', ask: 'حط قائمة المؤثرات بالزاوية', img: 'effect-list' },
  { id: 'live-cursor', group: 'creator', ar: 'مؤشّر حي', does: 'سهم ماوس يتحرك ويختار', ask: 'خلّ المؤشر يضغط على «…»' },
  { id: 'voice-note', group: 'creator', ar: 'رسالة صوتية', does: 'فقاعة رسالة صوتية تشتغل', ask: 'حط رسالة صوتية', img: 'voice-note' },
  { id: 'comment-drop', group: 'creator', ar: 'تعليقات تنزل', does: 'إشعارات تعليقات تنزل وحدة وحدة', ask: 'نزّل تعليقات: «…»', img: 'comment-drop' },
  { id: 'comment-stickers', group: 'creator', ar: 'ملصقات الأسئلة', does: 'تعليقات المتابعين كملصقات مائلة', ask: 'حط أسئلة المتابعين كملصقات' },
  { id: 'head-stack', group: 'creator', ar: 'ملصقات فوق الراس', does: 'تاغات تتكدّس فوق نقطة', ask: 'كدّس كلمات «…» فوق راسي' },
  { id: 'predict-keys', group: 'creator', ar: 'كيبورد عربي', does: 'كيبورد يكتب ويقترح كلمات', ask: 'خلّ الكيبورد يكتب «…»' },
  { id: 'day-dial', group: 'creator', ar: 'قرص الأيام', does: 'قرص يدور ويوقف على اليوم', ask: 'دوّر القرص على «…»' },
  { id: 'post-wall', group: 'creator', ar: 'جدار المنشورات', does: 'منشورات تملأ الشاشة وعدّاد', ask: 'سوّ جدار منشورات وعداد «…»' },
  { id: 'photo-look', group: 'creator', ar: 'ستايل صورة', does: 'صورتك بجريدة قديمة، صحيفة، ورقة نقدية، أو إمباكت', ask: 'حط صورتي بجريدة قديمة', img: 'vintage-newspaper' },
  { id: 'comment-cta', group: 'creator', ar: 'زر «علّق»', does: 'خانة تعليق تكتب كلمتك', ask: 'خلّ الختام «علّق: …»', img: 'comment-cta' },
  { id: 'signature-card', group: 'creator', ar: 'بطاقة التوقيع', does: 'اسمك وصورتك وروابطك بالنهاية', ask: 'اختم ببطاقتي', img: 'signature-card' },
  // Basics
  { id: 'backdrop', group: 'basics', ar: 'خلفية', does: 'خلفية ورقية فاتحة أو داكنة', ask: 'خلّ الخلفية داكنة' },
  { id: 'captions', group: 'basics', ar: 'ترجمة', does: 'ترجمة كلامك والكلمة المنطوقة ملوّنة', ask: 'حط ترجمة على كلامي' },
  { id: 'chapter-bar', group: 'basics', ar: 'شريط الأقسام', does: 'شرطات أعلى الشاشة لكل بند', ask: 'حط شريط أقسام فوق' },
  { id: 'hud', group: 'basics', ar: 'شريط علوي', does: 'معلومة ثابتة أعلى الشاشة', ask: 'حط «…» ثابت فوق' },
]

export interface CatalogStyle {
  n: number
  ar: string
  en: string
  look: string
  does: string
  ask: string
  img?: string
  /** Extra scene types this style puts in (beyond the look). */
  with?: string[]
}

/** The style menu the skill offers before the storyboard: one look for the whole video. */
export const STYLES: CatalogStyle[] = [
  { n: 1, ar: 'كريمي توقيع', en: 'Signature cream', look: 'signature', does: 'ورق كريمي، حبر أسود، كلمة بصندوق برتقالي؛ رسومات تبني نفسها', ask: 'خلّ الستايل كريمي', img: 'heavy-word' },
  { n: 2, ar: 'داكن تقني', en: 'Dark tech', look: 'dark-tech', does: 'خلفية فحمية وكتابة فاتحة وبرتقالي؛ للشروحات التقنية', ask: 'خلّ الستايل داكن', img: 'counter' },
  { n: 3, ar: 'ليزر سينمائي', en: 'Cinematic laser', look: 'dark-tech', with: ['tech-grid', 'laser-type', 'glow-words', 'laser-beam', 'beat-slam'], does: 'شبكة داكنة، عنوان يتقصّ بالليزر، كلمات تتوهّج، ضربات على الإيقاع', ask: 'خلّ الستايل ليزر سينمائي', img: 'laser-type' },
  { n: 4, ar: 'سويسري أحمر', en: 'Swiss red', look: 'swiss-red', does: 'أبيض مطفي، أسود، وكلمة حمرة وحدة بكل سطر؛ نظيف ومسطّح', ask: 'خلّ الستايل سويسري أحمر' },
]

/** Scene types left out of the catalog: ids starting with `_` are internal/test-only. */
export const isInternal = (id: string) => id.startsWith('_')
