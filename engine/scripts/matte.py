"""Person matte for `mba matte`: reads a working copy, writes a grayscale matte video (white = person).

MediaPipe selfie segmentation (Apache-2.0). Usage:
  python scripts/matte.py <in.mp4> <out.mp4> <model.tflite> <ffmpeg> <fps>

The model sees a 256 x 256 image, so a tall frame squashed into it loses most of its detail. Here:
- small clips are upscaled so the matte is made (and written) at least 1080 wide;
- a portrait frame is segmented as two overlapping squares (top and bottom), blended in the overlap;
- the confidence is snapped to the real picture edges with a guided filter (the frame is the guide),
  then sharpened (smoothstep 0.25..0.75) and smoothed in time (65/35 with the previous frame).
Progress goes to stderr.
"""
import subprocess
import sys

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

MIN_WIDTH = 1080


def segmenter(model: str):
    opts = vision.ImageSegmenterOptions(
        base_options=mpt.BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.VIDEO,
        output_confidence_masks=True,
        output_category_mask=False,
    )
    return vision.ImageSegmenter.create_from_options(opts)


def confidence(seg, rgb: np.ndarray, ms: int) -> np.ndarray:
    res = seg.segment_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)), ms)
    conf = res.confidence_masks[-1].numpy_view().astype(np.float32)
    return conf[..., 0] if conf.ndim == 3 else conf


def guided(guide: np.ndarray, src: np.ndarray, r: int, eps: float) -> np.ndarray:
    if hasattr(cv2, "ximgproc"):
        return cv2.ximgproc.guidedFilter(guide, src, r, eps)
    # Plain grey guided filter (He et al.) when opencv-contrib is missing.
    g = cv2.cvtColor(guide, cv2.COLOR_RGB2GRAY) if guide.ndim == 3 else guide
    box = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))
    mg, ms_ = box(g), box(src)
    a = (box(g * src) - mg * ms_) / (box(g * g) - mg * mg + eps)
    b = ms_ - a * mg
    return box(a) * g + box(b)


def main() -> int:
    src, dst, model, ffmpeg, fps = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5])
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        print(f"cannot open {src}", file=sys.stderr)
        return 1
    w0 = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h0 = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    scale = max(1.0, MIN_WIDTH / w0)
    w, h = int(round(w0 * scale / 2) * 2), int(round(h0 * scale / 2) * 2)
    split = h > 1.15 * w  # portrait: two squares
    enc = subprocess.Popen(
        [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-framerate", f"{fps:g}", "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12", "-preset", "medium", dst],
        stdin=subprocess.PIPE,
    )
    # Blend weights for the two squares: 1 above the overlap (top square), ramping to 0 below it.
    ramp = None
    if split:
        lo, hi = h - w, w
        ys = np.arange(h, dtype=np.float32)
        ramp = np.clip((hi - ys) / max(1, hi - lo), 0, 1)[:, None]
    r = max(4, int(round(w / 135)))
    prev = None
    n = 0
    segs = [segmenter(model)] + ([segmenter(model)] if split else [])
    try:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            if scale > 1:
                bgr = cv2.resize(bgr, (w, h), interpolation=cv2.INTER_CUBIC)
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            ms = int(round(n * 1000 / fps))
            if split:
                top = confidence(segs[0], rgb[:w], ms)
                bottom = confidence(segs[1], rgb[h - w:], ms)
                conf = np.zeros((h, w), np.float32)
                conf[:w] += top * ramp[:w]
                conf[h - w:] += bottom * (1 - ramp[h - w:])
            else:
                conf = confidence(segs[0], rgb, ms)
                if conf.shape != (h, w):
                    conf = cv2.resize(conf, (w, h), interpolation=cv2.INTER_LINEAR)
            x = guided(rgb.astype(np.float32) / 255.0, conf, r, 1e-3)
            x = np.clip((x - 0.25) / 0.5, 0, 1)
            x = x * x * (3 - 2 * x)
            if prev is not None:
                x = 0.65 * x + 0.35 * prev
            prev = x
            enc.stdin.write((x * 255 + 0.5).astype(np.uint8).tobytes())
            n += 1
            if n % 30 == 0:
                print(f"[{n}/{total}]", file=sys.stderr, flush=True)
    finally:
        for s in segs:
            s.close()
    enc.stdin.close()
    code = enc.wait()
    print(f"frames {n}", file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
