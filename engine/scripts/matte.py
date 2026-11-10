"""Person matte for `mba matte`: reads a working copy, writes a grayscale matte video (white = person).

Usage:
  python scripts/matte.py <in.mp4> <out.mp4> <selfie.tflite> <ffmpeg> <fps> [modnet.onnx]

Two engines:
- MODNet portrait matting (Apache-2.0, ONNX, when the model file and onnxruntime are present): a true
  alpha matte — soft hair, see-through edges. MediaPipe still runs as a guard: alpha far from the
  person is cleared and the person's solid core is filled, so the matte never has holes or specks.
- MediaPipe selfie segmentation alone (the fallback): a confidence mask, sharpened.

Both then: small clips are upscaled so the matte is at least 1080 wide; portrait frames are segmented
as two overlapping squares; the edge is snapped to the real picture with a guided filter (the frame
is the guide); and the matte is smoothed in time only where the picture is still (motion-aware), so
it does not flicker and does not lag behind movement. Frames repeated by the fps conversion reuse
the previous result. Progress goes to stderr.
"""
import os
import subprocess
import sys

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

MIN_WIDTH = 1080
MODNET_SHORT = 640  # MODNet input: the short side, a multiple of 32


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
    g = cv2.cvtColor(guide, cv2.COLOR_RGB2GRAY) if guide.ndim == 3 else guide
    box = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))
    mg, ms_ = box(g), box(src)
    a = (box(g * src) - mg * ms_) / (box(g * g) - mg * mg + eps)
    b = ms_ - a * mg
    return box(a) * g + box(b)


def modnet_session(path: str):
    try:
        import onnxruntime as ort
    except ImportError:
        return None
    if not path or not os.path.exists(path):
        return None
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) - 1)
    return ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])


def modnet_alpha(sess, rgb: np.ndarray) -> np.ndarray:
    h, w = rgb.shape[:2]
    if w <= h:
        iw, ih = MODNET_SHORT, int(round(h * MODNET_SHORT / w / 32) * 32)
    else:
        ih, iw = MODNET_SHORT, int(round(w * MODNET_SHORT / h / 32) * 32)
    x = cv2.resize(rgb, (iw, ih), interpolation=cv2.INTER_AREA).astype(np.float32) / 127.5 - 1.0
    x = np.transpose(x, (2, 0, 1))[None]
    out = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
    return cv2.resize(out.astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)


def main() -> int:
    src, dst, model, ffmpeg, fps = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5])
    modnet_path = sys.argv[6] if len(sys.argv) > 6 else ""
    sess = modnet_session(modnet_path)
    print(f"engine: {'modnet + mediapipe guard' if sess else 'mediapipe'}", file=sys.stderr, flush=True)
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        print(f"cannot open {src}", file=sys.stderr)
        return 1
    w0 = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h0 = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    scale = max(1.0, MIN_WIDTH / w0)
    w, h = int(round(w0 * scale / 2) * 2), int(round(h0 * scale / 2) * 2)
    split = h > 1.15 * w
    enc = subprocess.Popen(
        [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-framerate", f"{fps:g}", "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "10", "-preset", "medium", dst],
        stdin=subprocess.PIPE,
    )
    ramp = None
    if split:
        lo, hi = h - w, w
        ys = np.arange(h, dtype=np.float32)
        ramp = np.clip((hi - ys) / max(1, hi - lo), 0, 1)[:, None]
    unit = w / 1080.0
    r_fine = max(2, int(round(4 * unit)))
    r_coarse = max(4, int(round(8 * unit)))
    guard_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(60 * unit) | 1, int(60 * unit) | 1))
    core_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(24 * unit) | 1, int(24 * unit) | 1))
    prev = None
    prev_gray = None
    prev_small = None
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
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
            small = cv2.resize(gray, (96, int(96 * h / w)), interpolation=cv2.INTER_AREA)
            # A frame repeated by the fps conversion: reuse the previous matte unchanged.
            if prev is not None and prev_small is not None and float(np.mean(np.abs(small - prev_small))) < 0.0015:
                x = prev
            else:
                ms = int(round(n * 1000 / fps))
                if split:
                    conf = np.zeros((h, w), np.float32)
                    conf[:w] += confidence(segs[0], rgb[:w], ms) * ramp[:w]
                    conf[h - w:] += confidence(segs[1], rgb[h - w:], ms) * (1 - ramp[h - w:])
                else:
                    conf = confidence(segs[0], rgb, ms)
                    if conf.shape != (h, w):
                        conf = cv2.resize(conf, (w, h), interpolation=cv2.INTER_LINEAR)
                guide = rgb.astype(np.float32) / 255.0
                if sess is not None:
                    a = modnet_alpha(sess, rgb)
                    # Guard: nothing far from the person; the solid core always filled.
                    near = cv2.dilate((conf > 0.2).astype(np.uint8), guard_k).astype(np.float32)
                    near = cv2.GaussianBlur(near, (0, 0), 12 * unit)
                    core = cv2.erode((conf > 0.92).astype(np.uint8), core_k).astype(np.float32)
                    core = cv2.GaussianBlur(core, (0, 0), 4 * unit)
                    a = np.maximum(np.clip(a, 0, 1) * near, core)
                    x = np.clip(guided(guide, a, r_fine, 1e-4), 0, 1)
                    if scale >= 1.5:
                        # An upscaled small clip has no real strand detail: tighten the soft zone so
                        # the edge does not read as blur.
                        x = np.clip((x - 0.1) / 0.8, 0, 1)
                        x = x * x * (3 - 2 * x)
                else:
                    x = guided(guide, conf, r_coarse, 1e-3)
                    x = np.clip((x - 0.25) / 0.5, 0, 1)
                    x = x * x * (3 - 2 * x)
                # Motion-aware smoothing: hold the edge where the picture is still, follow it where it moves.
                if prev is not None and prev_gray is not None:
                    motion = cv2.GaussianBlur(np.abs(gray - prev_gray), (0, 0), 6 * unit)
                    keep = 0.5 * (1 - np.clip(motion / 0.06, 0, 1))
                    x = x * (1 - keep) + prev * keep
                x = np.where(x < 0.015, 0, np.where(x > 0.985, 1, x)).astype(np.float32)
                prev_gray = gray
            prev = x
            prev_small = small
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
