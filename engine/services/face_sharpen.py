"""Sharpen faces (H10 / A5): GFPGAN v1.4 on each face, pasted back softly.

Recipe approved by the owner on their own photos in A0 (2026-11-16):

1. Find faces with YuNet (the app's face finder, already bundled) and their five landmarks
   (eyes, nose, mouth corners). Faces narrower than 24 px are left alone.
2. Line each face up with GFPGAN's 512 px template (similarity transform), run GFPGAN.
3. Paste the result back with a feathered mask at **80%**, so skin texture and the photo's
   grain survive and nothing looks pasted on.

**Identity check** (owner request): each restored face is compared with the original by SFace
(the app's face recogniser). A face that no longer looks like the same person is left as it
was (see ``LIKENESS_KEEP``).

The result keeps a small record of each face (landmarks, strength, likeness) and each
sharpened 512 px face, so the viewer can switch single faces off before keeping:
:func:`compose` rebuilds the image from the one before sharpening with only the faces
still on. (Simply putting the old pixels back would also undo part of a neighbour's face
in a group photo, where the soft edges overlap.)
"""

from __future__ import annotations

import io
from typing import Any, Callable, Dict, List, Optional, Sequence

import numpy as np

from engine.services import onnx_sessions

FACE_MODEL = "gfpgan"
SIZE = 512
STRENGTH = 0.8          # Owner-approved blend (A0).
MIN_FACE_PX = 24        # Narrower faces have too little to work with.
DETECT_LONG_SIDE = 1280
# SFace cosine similarity between the original face and the sharpened one (1 = identical).
# On the owner's 19 photos (143 faces, 2026-11-17) large faces scored 0.7-0.93; below about
# 0.45 GFPGAN was inventing a face (tiny or motion-blurred faces). Owner's rule: under 0.45
# the face is left as it was, otherwise 80%. A half-way 50% looked like a ghosted double image.
LIKENESS_KEEP = 0.45

# Where GFPGAN expects the eyes, nose and mouth corners in its 512 x 512 input (FFHQ template).
TEMPLATE = np.array(
    [[192.98138, 239.94708], [318.90277, 240.1936], [256.63416, 314.01935], [201.26117, 371.41043], [313.08905, 371.15118]],
    np.float32,
)


def _cv2():
    import cv2

    return cv2


def _face_models():
    from engine.services.face_recognition_service import ensure_face_models

    return ensure_face_models()


_detector = None
_recognizer = None


def _detector_for(width: int, height: int):
    global _detector
    cv2 = _cv2()
    if _detector is None:
        yunet, _ = _face_models()
        _detector = cv2.FaceDetectorYN.create(str(yunet), "", (320, 320), 0.7)
    _detector.setInputSize((width, height))
    return _detector


def _recognizer_once():
    global _recognizer
    if _recognizer is None:
        _, sface = _face_models()
        _recognizer = _cv2().FaceRecognizerSF.create(str(sface), "")
    return _recognizer


def find_faces(rgb: np.ndarray, min_px: int = MIN_FACE_PX) -> List[np.ndarray]:
    """YuNet faces (15 numbers each: box x, y, w, h, 5 landmarks, score) in ``rgb`` pixels."""
    cv2 = _cv2()
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    scale = min(1.0, DETECT_LONG_SIDE / max(bgr.shape[:2]))
    small = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else bgr
    _, found = _detector_for(small.shape[1], small.shape[0]).detect(small)
    if found is None:
        return []
    found = found.copy()
    found[:, :14] /= scale
    return [f for f in found if f[2] >= min_px]


def count_faces(rgb: np.ndarray, min_px: int = MIN_FACE_PX) -> int:
    return len(find_faces(rgb, min_px))


def _matrix(landmarks: np.ndarray) -> np.ndarray:
    M, _ = _cv2().estimateAffinePartial2D(np.asarray(landmarks, np.float32).reshape(5, 2), TEMPLATE, method=_cv2().LMEDS)
    return M


def _mask_512() -> np.ndarray:
    cv2 = _cv2()
    mask = np.zeros((SIZE, SIZE), np.float32)
    cv2.rectangle(mask, (40, 40), (SIZE - 40, SIZE - 40), 1.0, -1)
    return cv2.GaussianBlur(mask, (0, 0), 24)


def _region(M: np.ndarray, shape: Sequence[int]):
    """The part of the photo the 512 px face square lands on (x0, y0, x1, y1), clipped."""
    inv = _cv2().invertAffineTransform(M)
    corners = np.array([[0, 0, 1], [SIZE, 0, 1], [0, SIZE, 1], [SIZE, SIZE, 1]], np.float32) @ inv.T
    x0, y0 = np.floor(corners.min(0)).astype(int) - 2
    x1, y1 = np.ceil(corners.max(0)).astype(int) + 2
    h, w = shape[:2]
    return max(0, x0), max(0, y0), min(w, x1), min(h, y1), inv


def _back(square: np.ndarray, M: np.ndarray, shape: Sequence[int]):
    """Warps a 512 px square (face or mask) back onto its region of the photo."""
    cv2 = _cv2()
    x0, y0, x1, y1, inv = _region(M, shape)
    if x1 <= x0 or y1 <= y0:
        return None
    shifted = inv.copy()
    shifted[:, 2] -= (x0, y0)
    out = cv2.warpAffine(square, shifted, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return (x0, y0, x1, y1), out


def _gfpgan(session: Any, crop: np.ndarray) -> np.ndarray:
    x = (crop.astype(np.float32) / 255.0 - 0.5) / 0.5
    y = session.run(None, {"input": x.transpose(2, 0, 1)[None]})[0][0].transpose(1, 2, 0)
    return np.clip(y * 0.5 + 0.5, 0, 1) * 255.0


def likeness(before: np.ndarray, after: np.ndarray, face: np.ndarray) -> Optional[float]:
    """SFace cosine similarity of one face before and after (None if it can't be measured)."""
    cv2 = _cv2()
    rec = _recognizer_once()
    try:
        a = rec.feature(rec.alignCrop(cv2.cvtColor(before, cv2.COLOR_RGB2BGR), face))
        b = rec.feature(rec.alignCrop(cv2.cvtColor(after, cv2.COLOR_RGB2BGR), face))
        return float(rec.match(a, b, cv2.FaceRecognizerSF_FR_COSINE))
    except cv2.error:
        return None


def strength_for(similarity: Optional[float]) -> float:
    """80%, or 0 (left as it was) when the face no longer looks like the same person.
    A face the recogniser can't measure is left as it was too (no guessing)."""
    return STRENGTH if similarity is not None and similarity >= LIKENESS_KEEP else 0.0


def _paste(image: np.ndarray, restored: np.ndarray, M: np.ndarray, strength: float, mask512: np.ndarray) -> None:
    """In place: image = image * (1 - m) + restored * m, inside the face's region only."""
    face = _back(restored, M, image.shape)
    mask = _back(mask512, M, image.shape)
    if face is None or mask is None:
        return
    (x0, y0, x1, y1), pixels = face
    m = mask[1][:, :, None] * strength
    region = image[y0:y1, x0:x1].astype(np.float32)
    image[y0:y1, x0:x1] = (region * (1 - m) + pixels * m).round().clip(0, 255).astype(np.uint8)


def sharpen_faces(
    rgb: np.ndarray,
    progress: Callable[[int], None] = lambda _p: None,
    cancelled: Callable[[], bool] = lambda: False,
    span: Sequence[int] = (5, 95),
) -> tuple[np.ndarray, List[Dict[str, Any]], List[np.ndarray]]:
    """Sharpens every face in ``rgb``. Returns (new image, one record per face found, the
    sharpened 512 px faces as uint8, for :func:`compose`).

    Records: ``{"landmarks": [[x, y] x5], "box": [x, y, w, h], "strength": 0.8 | 0,
    "likeness": float | None}`` in pixels of ``rgb``.
    """
    faces = find_faces(rgb)
    out = rgb.copy()
    records: List[Dict[str, Any]] = []
    crops: List[np.ndarray] = []
    if not faces:
        return out, records, crops
    cv2 = _cv2()
    mask512 = _mask_512()
    lo, hi = span
    with onnx_sessions.use_model(FACE_MODEL) as session:
        for i, face in enumerate(faces):
            if cancelled():
                break
            M = _matrix(face[4:14])
            crop = cv2.warpAffine(rgb, M, (SIZE, SIZE), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            restored = _gfpgan(session, crop).round().astype(np.uint8).astype(np.float32)
            # Measure the likeness on the face pasted at full strength, then choose the touch.
            trial = rgb.copy()
            _paste(trial, restored, M, 1.0, mask512)
            similarity = likeness(rgb, trial, face)
            del trial
            strength = strength_for(similarity)
            if strength > 0:
                _paste(out, restored, M, strength, mask512)
            crops.append(restored.astype(np.uint8))
            records.append({
                "landmarks": [[float(x), float(y)] for x, y in face[4:14].reshape(5, 2)],  # Full precision: compose() must match.
                "box": [round(float(v), 1) for v in face[:4]],
                "strength": strength,
                "likeness": None if similarity is None else round(similarity, 3),
            })
            progress(int(lo + (hi - lo) * (i + 1) / len(faces)))
    return out, records, crops


def compose(base: np.ndarray, records: List[Dict[str, Any]], crops: List[np.ndarray], off: Sequence[int] = ()) -> np.ndarray:
    """The image before sharpening with every face pasted back except those in ``off``.
    With ``off`` empty this gives exactly what :func:`sharpen_faces` returned."""
    out = base.copy()
    mask512 = _mask_512()
    skip = set(int(i) for i in off)
    for i, (record, crop) in enumerate(zip(records, crops)):
        if i in skip or record["strength"] <= 0:
            continue
        M = _matrix(np.asarray(record["landmarks"], np.float32))
        _paste(out, crop.astype(np.float32), M, float(record["strength"]), mask512)
    return out


def pack_faces(crops: List[np.ndarray]) -> bytes:
    """The sharpened faces as one compressed blob (staged next to the result)."""
    buf = io.BytesIO()
    np.savez_compressed(buf, *crops)
    return buf.getvalue()


def unpack_faces(blob: bytes) -> List[np.ndarray]:
    with np.load(io.BytesIO(blob), allow_pickle=False) as data:
        return [data[f"arr_{i}"] for i in range(len(data.files))]
