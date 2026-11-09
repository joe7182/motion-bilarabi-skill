# جرّب الآن — Try it now

فيديو تجريبي ٣١ ثانية على مقطعك أنت: تتكلم أمام الكاميرا ٢٥ ثانية على الأقل، جدار بسيط خلفك أفضل.
A 31-second demo on your own clip: you talking to camera for at least 25 s (a plain wall behind you works best).

It shows grid zoom, back focus, letter dive, a clone row, an orbit ring, code body, dolly zoom,
blow away, the profile-grid cut, the Arabic keyboard and a comment call to action.

From the `engine` folder:

```bash
npx tsx src/cli.ts project init my-demo your-clip.mp4
```
```bash
npx tsx src/cli.ts ingest my-demo
```
```bash
npx tsx src/cli.ts matte my-demo m1
```
Copy `examples/try-it/edit.json` into `my-demo/` (replace the one there), then:
```bash
npx tsx src/cli.ts render my-demo
```

Or in Claude: «سوّ لي الفيديو التجريبي من examples/try-it على مقطعي هذا» and attach your clip.

Needs the optional person cut-out tools (`mba doctor` checks them). To show your own posts in the
profile-grid cut, add `"tiles": ["post1.jpg", …]` (images next to edit.json) and your handle as `user`.
