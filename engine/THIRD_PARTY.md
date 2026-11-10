# Third-party material

## Lucide icons

- **What:** 18 icons (the `ICON_NAMES` set in `src/core/params/icon.ts`), vendored as SVG node
  lists into `src/runtime/icons/lucide.ts` by `scripts/vendor-icons.ts` from
  [`lucide-static`](https://lucide.dev) 1.57.0 (devDependency, pinned exact). No other Lucide
  icon ships with the engine.
- **Licence:** ISC License, © Lucide Icons and Contributors. Some Lucide icons are derived from
  [Feather](https://feathericons.com) and stay under the MIT License, © 2013-present Cole Bemis.
  Of the vendored set, `clock`, `database`, `lock`, `smartphone`, `target` and `triangle-alert`
  (Feather's `alert-triangle`) are in Lucide's list of Feather-derived icons.
- The line art in `src/runtime/icons/line-art.ts` is Motion Bil-Arabi's own drawing, not Lucide.

The licence text below is Lucide's `LICENSE` file as shipped in `lucide-static` 1.57.0, verbatim
(the ISC licence for Lucide, then the MIT licence for the Feather-derived icons it lists).

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## JetBrains Mono (font)

- **What:** one face, JetBrains Mono Regular (400), Latin subset, as
  `assets/fonts/jetbrains-mono/jetbrains-mono-latin-400-normal.woff2`, copied unchanged from
  [`@fontsource/jetbrains-mono`](https://fontsource.org/fonts/jetbrains-mono) 5.2.8 (devDependency,
  pinned exact). Used for the typed Latin/code lines of the `app-window` terminal. No other weight,
  style or subset ships with the engine.
- **Licence:** SIL Open Font License 1.1, Copyright 2020 The JetBrains Mono Project Authors
  (https://github.com/JetBrains/JetBrainsMono). The full licence text is
  `assets/fonts/jetbrains-mono/OFL.txt` (the package's `LICENSE`, verbatim), shipped beside the font.

## Amiri (font)

- **What:** three faces, Amiri Bold (700), Italic (400) and Bold Italic (700), as
  `assets/fonts/amiri/Amiri-Bold.ttf`, `Amiri-Italic.ttf` and `Amiri-BoldItalic.ttf`, copied
  unchanged from the Google Fonts repository (`ofl/amiri`). Used for the serif words of the
  `editorial-type` scene.
- **Licence:** SIL Open Font License 1.1, Copyright 2010-2022 The Amiri Project Authors
  (https://github.com/aliftype/amiri). The full licence text is `assets/fonts/amiri/OFL.txt`
  (verbatim), shipped beside the fonts.
