"""Clean plate from the user for `mba plate`: a photo (or a short clip) of the empty scene, taken
from the same camera spot, becomes work/<id>.plate.jpg — the real room behind the person, used by
blow-away, clones, dolly, back focus and layers.

Usage:
  python scripts/plate.py <work.mp4> <matte.mp4|-> <photo-or-clip> <out.jpg>

The plate is fitted to the clip's frame (cover), and when a matte exists it is aligned to the clip
(ECC, affine) using only the room around the person, so a camera that moved a little still lines
up. A clip is reduced to its per-pixel median, which removes anything that passes through.
"""
import sys

import cv2
import numpy as np


def read_plate(path: str) -> np.ndarray:
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is not None:
        return img
    cap = cv2.VideoCapture(path)
    frames = []
    while len(frames) < 90:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    if not frames:
        raise SystemExit(f"cannot read the plate: {path}")
    step = max(1, len(frames) // 15)
    return np.median(np.stack(frames[::step]), axis=0).astype(np.uint8)


def cover(img: np.ndarray, w: int, h: int) -> np.ndarray:
    ih, iw = img.shape[:2]
    s = max(w / iw, h / ih)
    r = cv2.resize(img, (int(round(iw * s)), int(round(ih * s))), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    y0 = (r.shape[0] - h) // 2
    x0 = (r.shape[1] - w) // 2
    return r[y0:y0 + h, x0:x0 + w]


def middle_frame(path: str):
    cap = cv2.VideoCapture(path)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, n // 2))
    ok, f = cap.read()
    return f if ok else None


def main() -> int:
    work, matte, src, out = sys.argv[1:5]
    frame = middle_frame(work)
    if frame is None:
        print(f"cannot read {work}", file=sys.stderr)
        return 1
    plate = read_plate(src)
    h, w = frame.shape[:2]
    # The matte may be larger than the clip (small clips are matted at 1080 wide): write the plate at the matte's size.
    mframe = middle_frame(matte) if matte != '-' else None
    if mframe is not None:
        h, w = mframe.shape[:2]
        frame = cv2.resize(frame, (w, h), interpolation=cv2.INTER_CUBIC)
    plate = cover(plate, w, h)
    aligned = False
    if mframe is not None:
        m = cv2.cvtColor(mframe, cv2.COLOR_BGR2GRAY)
        room = (cv2.dilate(m, np.ones((41, 41), np.uint8)) < 10).astype(np.uint8)
        if room.mean() > 0.15:
            sc = 0.25
            a = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), None, fx=sc, fy=sc).astype(np.float32) / 255
            b = cv2.resize(cv2.cvtColor(plate, cv2.COLOR_BGR2GRAY), None, fx=sc, fy=sc).astype(np.float32) / 255
            mk = cv2.resize(room, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_NEAREST)
            warp = np.eye(2, 3, dtype=np.float32)
            try:
                _, warp = cv2.findTransformECC(a, b, warp, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-5), mk, 5)
                warp[:, 2] /= sc
                plate = cv2.warpAffine(plate, warp, (w, h), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
                aligned = True
            except cv2.error:
                pass
    cv2.imwrite(out, plate, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f"plate {w}x{h} {'aligned' if aligned else 'fitted'}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
