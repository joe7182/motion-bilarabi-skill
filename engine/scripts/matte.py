"""Person matte for `mba matte`: reads a working copy, writes a grayscale matte video (white = person).

MediaPipe selfie segmentation (Apache-2.0). Usage:
  python scripts/matte.py <in.mp4> <out.mp4> <model.tflite> <ffmpeg> <fps>
Each frame's person confidence is sharpened (smoothstep 0.3..0.7), feathered 1.5 px and smoothed in
time (60/40 with the previous frame) so the edge does not flicker. Progress goes to stderr.
"""
import subprocess
import sys

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision


def main() -> int:
    src, dst, model, ffmpeg, fps = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5])
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        print(f"cannot open {src}", file=sys.stderr)
        return 1
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    opts = vision.ImageSegmenterOptions(
        base_options=mpt.BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.VIDEO,
        output_confidence_masks=True,
        output_category_mask=False,
    )
    enc = subprocess.Popen(
        [ffmpeg, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-framerate", f"{fps:g}", "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12", "-preset", "medium", dst],
        stdin=subprocess.PIPE,
    )
    prev = None
    n = 0
    with vision.ImageSegmenter.create_from_options(opts) as seg:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            res = seg.segment_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(round(n * 1000 / fps)))
            masks = res.confidence_masks
            conf = masks[-1].numpy_view().astype(np.float32)
            if conf.ndim == 3:
                conf = conf[..., 0]
            x = np.clip((conf - 0.3) / 0.4, 0, 1)
            x = x * x * (3 - 2 * x)
            x = cv2.GaussianBlur(x, (0, 0), 1.5)
            if prev is not None:
                x = 0.6 * x + 0.4 * prev
            prev = x
            enc.stdin.write((x * 255 + 0.5).astype(np.uint8).tobytes())
            n += 1
            if n % 30 == 0:
                print(f"[{n}/{total}]", file=sys.stderr, flush=True)
    enc.stdin.close()
    code = enc.wait()
    print(f"frames {n}", file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
