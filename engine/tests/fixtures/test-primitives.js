/**
 * Test-only primitives for `mba verify` tests (never shipped, never documented to users).
 *
 * The default export is the SOURCE of a browser function returning the primitive list; the page
 * runs it as `window.__MBA_TEST_PRIMITIVES__ = (<source>)();` before it loads, and only registers
 * the list when the URL has `?test=1`. Used by tests/browser/verify.spec.ts (through
 * `verifyDeterminism({ testPrimitivesSource })`) and by the hidden CLI flag
 * `mba verify <sb.json> --test-primitives tests/fixtures/test-primitives.js`.
 *
 * `_nondet` is deliberately NONDETERMINISTIC: a module-level counter is incremented on every
 * `update` and painted as text, so a frame depends on how many seeks came before it. It styles
 * only a child of its layer, never the layer itself.
 *
 * `_pageerror` draws a fixed word but, at local times past 0.5 s, throws an uncaught error from a
 * microtask after each update (a page error that never rejects the seek). Used by verify.spec.ts
 * (fixture pageerror.json): verify must fail when the page logged errors while probing.
 *
 * `_badtext` (tests/browser/audit.spec.ts, fixture audit-bad.json) breaks each text-audit rule
 * exactly once, with offenders placed so no two rules overlap (9:16 safe area x 64.8..950.4,
 * y 268.8..1497.6):
 * - outside-safe: large Latin "TOP" above the safe area, fully inside the frame;
 * - too-small: 12 px Latin "tiny" inside the safe area;
 * - clipped-by-frame: large Latin "EDGE" at rest, crossing the left frame edge (left -40px); the
 *   audit reports a clipped node only as clipped, not also as outside-safe;
 * - wrong-direction: an Arabic word unit (data-mba-text=word) forced to dir=ltr;
 * - unsanctioned-arabic, twice: a bare Arabic text node outside any text unit, and a word unit
 *   (dir=rtl, so its direction is right) whose Arabic is split into one span per letter. The
 *   split unit is reported once, as a unit, not once per letter.
 * It also draws "ghosts" that would break a rule but must be skipped by the audit: small text
 * under an effective opacity of 0.6 x 0.6 = 0.36, small text under visibility:hidden, and a
 * scale(1.5) 12 px Latin word inside the frame (not at rest: no too-small or outside-safe; since
 * Plan 2a+ clipped-by-frame also covers transformed text, so it must stay inside the frame).
 * Only children are styled, never the layer.
 *
 * `_micro` (R31, tests/browser/audit.spec.ts, fixture audit-micro.json) holds one Latin caption in
 * a child container with a permanent transform: `scale(1.08) translateX(-20px)` (a punch-in with
 * drift, counts as rest). `_microout` is the same but the caption sits above the safe area (must be
 * reported as outside-safe), `_zoomed` uses `scale(1.5)` and `_tilted` `rotate(5deg)` with an
 * out-of-safe-area caption (both are NOT at rest, so skipped). `_single110` is one scale(1.1)
 * wrapper (rest, measured); `_stacked110` two nested scale(1.1) wrappers (cumulative 1.21, not at
 * rest, skipped). Only children are styled.
 *
 * Plan 2a+ Task 1 (fixture audit-scaled.json). `_scaleclip`: a Latin word scaled 1.3 (not at rest)
 * whose glyph box ends 20 px past the right frame edge: reported as clipped-by-frame.
 * `_scalesafe`: the same scale, fully inside the frame but about 10 px past the safe area's right
 * edge: no outside-safe (that rule is rest-only). `_tatweel`: a word unit whose text starts with a
 * tatweel: reported as tatweel-split. Only children are styled.
 */
export default `() => {
  let calls = 0
  const box = (ctx, text, css) => {
    const el = document.createElement('div')
    Object.assign(el.style, { position: 'absolute', whiteSpace: 'pre', lineHeight: '1.3', color: ctx.look.fg, fontFamily: ctx.look.fontDisplay }, css)
    el.textContent = text
    ctx.layer.append(el)
    return el
  }
  return [
    {
      id: '_badtext',
      build(ctx) {
        box(ctx, 'TOP', { left: '100px', top: '60px', fontSize: '80px' }).dataset.bad = 'outside-safe'
        box(ctx, 'tiny', { left: '100px', top: '400px', fontSize: '12px' }).dataset.bad = 'too-small'
        box(ctx, 'EDGE', { left: '-40px', top: '600px', fontSize: '80px' }).dataset.bad = 'clipped-by-frame'
        const holder = box(ctx, '', { left: '100px', top: '800px', fontSize: '80px' })
        const word = document.createElement('span')
        word.dataset.mbaText = 'word'
        word.dir = 'ltr'
        word.lang = 'ar'
        word.style.display = 'inline-block'
        word.textContent = 'مرحبا'
        holder.append(word)
        holder.dataset.bad = 'wrong-direction'
        box(ctx, 'سلام', { left: '100px', top: '1000px', fontSize: '80px' }).dataset.bad = 'unsanctioned-arabic'
        const splitHolder = box(ctx, '', { left: '500px', top: '1000px', fontSize: '80px' })
        const split = document.createElement('span')
        split.dataset.mbaText = 'word'
        split.dir = 'rtl'
        split.lang = 'ar'
        split.style.display = 'inline-block'
        for (const ch of 'كلمة') {
          const letter = document.createElement('span')
          letter.textContent = ch
          split.append(letter)
        }
        splitHolder.append(split)
        splitHolder.dataset.bad = 'unsanctioned-arabic-split'
        // Ghosts: each would break a rule, but none is visible text at a rest pose.
        const dim = box(ctx, '', { left: '100px', top: '1200px', opacity: '0.6' })
        const dimmer = document.createElement('div')
        dimmer.style.opacity = '0.6'
        dimmer.style.fontSize = '12px'
        dimmer.textContent = 'ghost dim'
        dim.append(dimmer)
        box(ctx, 'ghost hidden', { left: '100px', top: '1250px', fontSize: '12px', visibility: 'hidden' })
        box(ctx, 'ghost moving', { left: '500px', top: '500px', fontSize: '12px', transform: 'scale(1.5)' })
        return {}
      },
    },
    ...[
      ['_micro', 'scale(1.08) translateX(-20px)', 400],
      ['_microout', 'scale(1.08) translateX(-20px)', 150],
      ['_zoomed', 'scale(1.5)', 150],
      ['_tilted', 'rotate(5deg)', 150],
      ['_single110', 'scale(1.1)', 400],
      ['_stacked110', 'scale(1.1)', 400, 'scale(1.1)'],
    ].map(([id, transform, top, innerTransform]) => ({
      id,
      build(ctx) {
        const wrap = document.createElement('div')
        Object.assign(wrap.style, { position: 'absolute', left: '0px', top: '0px', width: ctx.size.w + 'px', height: ctx.size.h + 'px', transform })
        ctx.layer.append(wrap)
        if (innerTransform) {
          const inner = document.createElement('div')
          Object.assign(inner.style, { position: 'absolute', left: '0px', top: '0px', width: ctx.size.w + 'px', height: ctx.size.h + 'px', transform: innerTransform })
          wrap.append(inner)
          wrap.inner = inner
        }
        const el = document.createElement('div')
        Object.assign(el.style, { position: 'absolute', whiteSpace: 'pre', lineHeight: '1.3', color: ctx.look.fg, fontFamily: ctx.look.fontDisplay, left: '300px', top: top + 'px', fontSize: '80px' })
        el.textContent = 'DRIFT'
        ;(wrap.inner ?? wrap).append(el)
        return {}
      },
    })),
    ...[
      ['_scaleclip', -20],
      ['_scalesafe', 120],
    ].map(([id, right]) => ({
      id,
      build(ctx) {
        // Right edge pinned and scaled about it, so the glyph box ends exactly right px from the frame edge.
        const el = box(ctx, 'DRIFT', { right: right + 'px', top: '700px', fontSize: '80px', transform: 'scale(1.3)', transformOrigin: 'right center' })
        el.dataset.scaled = id
        return {}
      },
    })),
    {
      id: '_tatweel',
      build(ctx) {
        const holder = box(ctx, '', { left: '300px', top: '700px', fontSize: '80px' })
        const word = document.createElement('span')
        word.dataset.mbaText = 'word'
        word.dir = 'rtl'
        word.lang = 'ar'
        word.style.display = 'inline-block'
        word.textContent = 'ـتمدد'
        holder.append(word)
        return {}
      },
    },
    {
      id: '_pageerror',
      build(ctx) {
        box(ctx, 'ERR', { left: ctx.safe.x + 'px', top: ctx.safe.y + 'px', fontSize: '120px' })
        return {
          update(localT) {
            // Deterministic picture, but past 0.5 s every seek throws an uncaught error outside
            // the seek (a microtask), so only the page's pageerror event sees it.
            if (localT > 0.5) queueMicrotask(() => { throw new Error('_pageerror boom') })
          },
        }
      },
    },
    {
      id: '_nondet',
      build(ctx) {
        const el = document.createElement('div')
        el.id = 'nondet-count'
        Object.assign(el.style, {
          position: 'absolute',
          left: ctx.safe.x + 'px',
          top: ctx.safe.y + ctx.safe.h / 3 + 'px',
          width: ctx.safe.w + 'px',
          fontFamily: ctx.look.fontDisplay,
          fontSize: '160px',
          color: ctx.look.fg,
          textAlign: 'center',
        })
        ctx.layer.append(el)
        return {
          update() {
            calls++
            el.textContent = String(calls)
          },
        }
      },
    },
  ]
}`
