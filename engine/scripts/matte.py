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


def head_box(x: np.ndarray):
    """The head in a matte, normalized [x0, y0, x1, y1]: from the top of the person down to about the
    chin (1.55 head widths), the head width taken just below the crown. None when no person."""
    hh, ww = 192, 108
    m = cv2.resize(x, (ww, hh), interpolation=cv2.INTER_AREA) > 0.5
    rows = np.where(m.sum(axis=1) > 2)[0]
    if rows.size == 0:
        return None
    top = int(rows[0])
    band = m[top + 4: top + 14]
    widths = band.sum(axis=1) if band.size else np.array([0])
    hw = float(np.median(widths)) if widths.size else 0.0
    if hw < 3:
        return None
    ys, xs = np.nonzero(m[top: top + int(hw * 1.2) + 1])
    cx = float(xs.mean()) if xs.size else ww / 2
    cell = (x.shape[1] / ww) / (x.shape[0] / hh)  # a grid cell's width over its height
    chin = top + 1.55 * hw * cell
    return [round(max(0.0, (cx - 0.55 * hw) / ww), 4), round(top / hh, 4), round(min(1.0, (cx + 0.55 * hw) / ww), 4), round(min(1.0, chin / hh), 4)]


def main() -> int:
    src, dst, model, ffmpeg, fps = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5])
    modnet_path = sys.argv[6] if len(sys.argv) > 6 else ""
    keep_plate = len(sys.argv) > 7 and sys.argv[7] == "keep-plate"
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
    faces = []
    plate_sum = None
    plate_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(0.035 * w) | 1, int(0.035 * w) | 1))
    plate_n = None
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
            faces.append(head_box(x))
            # The clean plate: every bit of room the person ever uncovers, averaged over time.
            if plate_sum is None:
                plate_sum = np.zeros((h, w, 3), np.float32)
                plate_n = np.zeros((h, w), np.float32)
            free = (cv2.dilate(x, plate_k) < 0.03).astype(np.float32)
            plate_sum += bgr.astype(np.float32) * free[..., None]
            plate_n += free
            enc.stdin.write((x * 255 + 0.5).astype(np.uint8).tobytes())
            n += 1
            if n % 30 == 0:
                print(f"[{n}/{total}]", file=sys.stderr, flush=True)
    finally:
        for s in segs:
            s.close()
    enc.stdin.close()
    code = enc.wait()
    # The clean plate (work/<id>.plate.jpg): the room seen behind the person; places never seen are
    # filled smoothly from around them (inpainting), then softened so the fill does not read as a patch.
    if plate_sum is not None and not keep_plate:
        seen = plate_n >= max(3, 0.08 * n)  # trust only room seen in enough frames
        plate = np.where(seen[..., None], plate_sum / np.maximum(plate_n, 1)[..., None], 0).astype(np.uint8)
        hole = (~seen).astype(np.uint8) * 255
        if hole.any():
            # Normalized blur (only seen room counts): the wall's colours continue smoothly into the
            # hole, coarse to fine, with no dark rim where the hole meets the room.
            sw, sh = max(8, w // 8), max(8, h // 8)
            m = cv2.resize(seen.astype(np.float32), (sw, sh), interpolation=cv2.INTER_AREA)
            c = cv2.resize(plate.astype(np.float32) * seen[..., None], (sw, sh), interpolation=cv2.INTER_AREA)
            fill = np.zeros_like(c)
            have = np.zeros((sh, sw), np.float32)
            for sigma in (2, 6, 16, 40, 110):
                num = cv2.GaussianBlur(c, (0, 0), sigma)
                den = cv2.GaussianBlur(m, (0, 0), sigma)
                ok = (den > 0.02) & (have < 1)
                fill[ok] = num[ok] / den[ok][:, None]
                have[ok] = 1
            if (have < 1).any():  # still unreached: the room's mean colour
                mean = (c.reshape(-1, 3).sum(0) / max(1e-3, m.sum()))
                fill[have < 1] = mean
            fill = cv2.GaussianBlur(fill, (0, 0), 2)
            up = cv2.resize(fill, (w, h), interpolation=cv2.INTER_CUBIC)
            plate = np.where(seen[..., None], plate, np.clip(up, 0, 255)).astype(np.uint8)  # no black left in the hole
            soft = cv2.GaussianBlur(hole.astype(np.float32) / 255, (0, 0), 10 * unit)[..., None]
            plate = np.clip(plate.astype(np.float32) * (1 - soft) + up * soft, 0, 255).astype(np.uint8)
        cv2.imwrite(dst.replace('.matte.mp4', '.plate.jpg'), plate, [cv2.IMWRITE_JPEG_QUALITY, 90])
    # The head per frame, for face-aware placement of text (work/<id>.matte.face.json).
    import json
    with open(dst.rsplit('.', 1)[0] + '.face.json', 'w') as fh:
        json.dump({'fps': fps, 'w': w, 'h': h, 'boxes': faces}, fh)
    print(f"frames {n}", file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
