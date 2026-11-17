"""Remove scratches and spots (H10 / A7).

Two models, both permissive (``scripts/model_export/export_scratch_models.py``):

- **Finding damage:** the scratch detector of Microsoft's "Bringing Old Photos Back to Life"
  (MIT), run on a copy whose short side is 768 px, marks pixels with probability >= 0.6.
  When the user asked ("When I ask"), small isolated dust specks are added too.
- **Filling in:** Big-LaMa (Apache-2.0) on 512 x 512 areas of a copy whose long side is
  1024 px, only where something is marked; at full resolution only the marked pixels are
  replaced (softly), so the rest of the photo keeps its detail.

Measured on drawn damage on the owner's scans (A7 spike, 2026-11-17): light scratches are
found reliably; dark lines, dust and torn corners less so (about half of all damage by area),
with 0.3% of a clean scan wrongly marked. So the viewer shows the marks and offers **Touch up**
(paint what was missed, erase a wrong mark); a mask from Touch up is used as painted.

Faces are protected: marks the app made inside a face are dropped, because the fill-in
invents texture and could change a face ("Faces under a mark are left alone unless you
paint them"). **Automatic** repairs use the scratch detector only (strictest) and only when
it marks at least ``AUTO_MIN_MARKED`` of the photo, so a clean scan is left alone.
"""

from __future__ import annotations

import io
from typing import Callable, Optional, Sequence, Tuple

import numpy as np
from PIL import Image

from engine.services import onnx_sessions

MODELS = ("scratch_detector", "lama")
DETECT_SHORT_SIDE = 768
THRESHOLD = 0.6
WORK_LONG_SIDE = 1024
TILE, STEP = 512, 448
MASK_LONG_SIDE = 1024        # The mask shown and edited in the viewer.
AUTO_MIN_MARKED = 0.004      # 0.4%: clean scans averaged 0.18% wrong marks, scratched ones ~0.8% found.


def _cv2():
    import cv2

    return cv2


def _unit(shape: Sequence[int]) -> float:
    return max(shape[:2]) / 2000.0


def detect(rgb: np.ndarray) -> np.ndarray:
    """Scratch probability per pixel (0-1) at the photo's size."""
    cv2 = _cv2()
    h, w = rgb.shape[:2]
    s = DETECT_SHORT_SIDE / min(h, w)
    nh, nw = max(16, int(round(h * s / 16) * 16)), max(16, int(round(w * s / 16) * 16))
    grey = cv2.cvtColor(cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    with onnx_sessions.use_model("scratch_detector") as session:
        p = session.run(None, {"grey": ((grey - 0.5) / 0.5)[None, None]})[0][0, 0]
    return cv2.resize(p, (w, h), interpolation=cv2.INTER_LINEAR)


def specks(rgb: np.ndarray) -> np.ndarray:
    """Small isolated spots much lighter or darker than their surroundings (dust)."""
    cv2 = _cv2()
    unit = _unit(rgb.shape)
    grey = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    base = cv2.medianBlur(grey, max(5, int(round(9 * unit)) | 1))  # Never below 5 px, even on small photos.
    cand = (np.abs(grey.astype(np.int16) - base.astype(np.int16)) > 40).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(cand, 8)
    keep = np.zeros(n, bool)
    max_area = max(25.0, (10 * unit) ** 2)
    for i in range(1, n):
        _x, _y, cw, ch, area = stats[i]
        keep[i] = area <= max_area and max(cw, ch) <= 3 * max(1, min(cw, ch)) + 2
    return cv2.dilate(keep[labels].astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))


def faces_area(rgb: np.ndarray) -> np.ndarray:
    """1 inside every face (with a margin), from the app's face finder."""
    from engine.services.face_sharpen import find_faces

    m = np.zeros(rgb.shape[:2], np.uint8)
    try:
        faces = find_faces(rgb, min_px=12)
    except Exception:  # Face finder unavailable: nothing to protect.
        return m
    for f in faces:
        x, y, fw, fh = (int(v) for v in f[:4])
        _cv2().rectangle(m, (x - fw // 4, y - fh // 4), (x + fw + fw // 4, y + fh + fh // 4), 1, -1)
    return m


def find_damage(rgb: np.ndarray, strict: bool = False) -> np.ndarray:
    """The marks (uint8 0/1) the app proposes: scratches, plus dust unless ``strict``;
    never inside a face."""
    mask = (detect(rgb) >= THRESHOLD).astype(np.uint8)
    if not strict:
        mask |= specks(rgb)
    mask[faces_area(rgb) > 0] = 0
    return mask


def repair(rgb: np.ndarray, mask: np.ndarray, progress: Callable[[int], None] = lambda _p: None,
           cancelled: Callable[[], bool] = lambda: False, span: Tuple[int, int] = (40, 95)) -> np.ndarray:
    """Fills the marked pixels with LaMa (see the module notes); unmarked pixels are untouched."""
    cv2 = _cv2()
    if not mask.any():
        return rgb.copy()
    h, w = rgb.shape[:2]
    s = min(1.0, WORK_LONG_SIDE / max(h, w))
    small = cv2.resize(rgb, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA) if s < 1 else rgb
    m_small = cv2.resize(mask.astype(np.uint8), (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    m_small = cv2.dilate(m_small, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    filled = small.astype(np.float32) / 255.0
    sh, sw = small.shape[:2]
    windows = []
    for y in range(0, max(1, sh - 64), STEP):
        for x in range(0, max(1, sw - 64), STEP):
            y0, x0 = min(y, max(0, sh - TILE)), min(x, max(0, sw - TILE))
            if m_small[y0:y0 + TILE, x0:x0 + TILE].any():
                windows.append((y0, x0))
    lo, hi = span
    with onnx_sessions.use_model("lama") as session:
        for i, (y0, x0) in enumerate(dict.fromkeys(windows)):
            if cancelled():
                break
            y1, x1 = min(sh, y0 + TILE), min(sw, x0 + TILE)
            mt = m_small[y0:y1, x0:x1]
            img = np.zeros((TILE, TILE, 3), np.float32)
            msk = np.zeros((TILE, TILE), np.float32)
            img[: y1 - y0, : x1 - x0] = filled[y0:y1, x0:x1]
            msk[: y1 - y0, : x1 - x0] = mt
            out = session.run(None, {"image": img.transpose(2, 0, 1)[None], "mask": msk[None, None]})[0][0].transpose(1, 2, 0)
            region = filled[y0:y1, x0:x1]
            sel = mt.astype(bool)
            region[sel] = out[: y1 - y0, : x1 - x0][sel]
            progress(int(lo + (hi - lo) * (i + 1) / max(1, len(windows))))
    big = cv2.resize(filled, (w, h), interpolation=cv2.INTER_CUBIC) if s < 1 else filled
    soft = cv2.GaussianBlur(cv2.dilate(mask.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))).astype(np.float32), (0, 0), 1.0)[..., None]
    return (rgb.astype(np.float32) * (1 - soft) + big * 255.0 * soft).round().clip(0, 255).astype(np.uint8)


def encode_mask(mask: np.ndarray) -> bytes:
    """The marks as a black/white PNG, long side ``MASK_LONG_SIDE`` (for the viewer)."""
    h, w = mask.shape[:2]
    s = min(1.0, MASK_LONG_SIDE / max(h, w))
    im = Image.fromarray((mask > 0).astype(np.uint8) * 255)
    if s < 1:
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.BOX)
        im = im.point(lambda v: 255 if v > 0 else 0)
    out = io.BytesIO()
    im.save(out, "PNG", optimize=True)
    return out.getvalue()


def decode_mask(data: bytes, shape: Sequence[int]) -> np.ndarray:
    """A painted mask (any size, white = repair) at the photo's size, 0/1."""
    with Image.open(io.BytesIO(data)) as im:
        grey = np.asarray(im.convert("L"))
    m = _cv2().resize((grey > 127).astype(np.uint8), (shape[1], shape[0]), interpolation=_cv2().INTER_NEAREST)
    return m


def auto_repair(rgb: np.ndarray) -> Optional[np.ndarray]:
    """Automatic rule: the strict marks, and only if the photo is clearly scratched.
    Returns the repaired photo, or None if there's nothing to fix."""
    mask = find_damage(rgb, strict=True)
    if mask.mean() < AUTO_MIN_MARKED:
        return None
    return repair(rgb, mask)
