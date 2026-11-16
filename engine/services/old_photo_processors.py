"""The image work behind "Add colour" and "Fix faded colours" (H10 / A3).

Recipes chosen by the owner on their own photos in the A0 test (2026-11-16):

- **Add colour, Natural (recipe F):** stretch the brightness (1st-99th percentile) before the
  model; DDColor large and artistic at 512 px; per pixel keep the more colourful prediction
  (soft blend, no seams); put the colour on the stretched brightness, which also restores the
  contrast of a faded print. About 9 s per photo on a typical laptop CPU.
- **Add colour, Vivid:** the same with the large model at 768 px: richer colour on crowded or
  sepia photos, sometimes a wrong hue, so never the default.
- **Sepia fallback:** after Natural, if more than about two-thirds of the coloured pixels are
  still orange/brown, Vivid is tried too and used if it removes the cast (in A0 this picked
  exactly the two photos the owner preferred in Vivid).
- **Fix faded colours (recipe Q, no AI):** each channel's own black and white point
  (0.5th-99.5th percentile, gain capped at 3x) removes the yellow/pink cast and the fade;
  gentle local contrast (CLAHE) on brightness; colour x 1.12. Under a second.

Each processor takes the photo's file bytes and returns a high-quality JPEG of the result;
``photo_versions`` turns it into the labelled AVIF copy. The original is never touched.
"""

from __future__ import annotations

import io
from typing import Any, Callable, Dict, List

import numpy as np
from PIL import Image, ImageOps

from engine.services import onnx_sessions
from engine.services.restore_queue import Processor, register_processor

COLOUR_MODELS = ("ddcolor_large", "ddcolor_artistic")
NATURAL_SIZE, VIVID_SIZE = 512, 768
SEPIA_SHARE = 0.67          # Share of coloured pixels still orange/brown that triggers the Vivid try.
# A grey or toned (sepia) print has ONE uniform tint, a colour photo varied colours. On the owner's
# 19 test photos the spread of Lab a/b was <= 1.0 / 2.9 for every grey or sepia print and >= 4.3 / 7.0
# for every colour photo (2026-11-16); the old "low saturation" rule missed strongly toned sepia.
TINT_STD_A, TINT_STD_B = 2.5, 4.5


def _cv2():
    import cv2

    return cv2


def decode_rgb(data: bytes) -> np.ndarray:
    """Upright RGB pixels of an image file."""
    with Image.open(io.BytesIO(data)) as im:
        return np.asarray(ImageOps.exif_transpose(im).convert("RGB"))


def encode_jpeg(rgb: np.ndarray) -> bytes:
    out = io.BytesIO()
    Image.fromarray(rgb).save(out, "JPEG", quality=95, subsampling=0)
    return out.getvalue()


def is_black_and_white(rgb: np.ndarray) -> bool:
    """Grey or sepia-toned photo (the app offers "Add colour" for these): one uniform tint."""
    cv2 = _cv2()
    small = cv2.resize(rgb, (256, max(1, int(256 * rgb.shape[0] / rgb.shape[1]))))
    lab = cv2.cvtColor(small.astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab)
    return float(lab[..., 1].std()) < TINT_STD_A and float(lab[..., 2].std()) < TINT_STD_B


# ── Add colour ──────────────────────────────────────────────────────────────


def _lab_l(rgb: np.ndarray) -> np.ndarray:
    return _cv2().cvtColor(rgb.astype(np.float32) / 255.0, _cv2().COLOR_RGB2Lab)[:, :, 0]


MAX_STRETCH = 2.5  # The owner's faded prints needed 1.3-1.4x; more would only amplify noise.


def stretch_brightness(L: np.ndarray) -> np.ndarray:
    """Auto-levels on Lab brightness (0-100): 1st..99th percentile to the full range.

    The gain is capped and centred on the photo's own mid-tone, so a nearly flat image
    (a scan of a blank area, an over-faded print) is lifted gently instead of turning black.
    """
    lo, hi = np.percentile(L, (1, 99))
    gain = min(100.0 / max(hi - lo, 1e-3), MAX_STRETCH)
    if gain < MAX_STRETCH:
        return np.clip((L - lo) * gain, 0, 100)
    mid = (lo + hi) / 2.0
    return np.clip((L - mid) * gain + 50.0, 0, 100)


def predict_ab(session: Any, L_full: np.ndarray, size: int) -> np.ndarray:
    """DDColor's colour (Lab a, b) for a brightness image, at full resolution."""
    cv2 = _cv2()
    small = cv2.resize(L_full, (size, size), interpolation=cv2.INTER_AREA)[:, :, None]
    grey = cv2.cvtColor(np.concatenate([small, np.zeros_like(small), np.zeros_like(small)], 2).astype(np.float32), cv2.COLOR_Lab2RGB)
    ab = session.run(None, {"input": grey.transpose(2, 0, 1)[None]})[0][0].transpose(1, 2, 0)
    return cv2.resize(ab, (L_full.shape[1], L_full.shape[0]), interpolation=cv2.INTER_CUBIC)


def merge_more_colourful(ab1: np.ndarray, ab2: np.ndarray) -> np.ndarray:
    """Per pixel, keep the prediction with more colour (smoothed so there are no seams)."""
    cv2 = _cv2()
    c1 = cv2.GaussianBlur(np.hypot(ab1[..., 0], ab1[..., 1]), (0, 0), 6)
    c2 = cv2.GaussianBlur(np.hypot(ab2[..., 0], ab2[..., 1]), (0, 0), 6)
    w = np.clip((c2 - c1) / 8.0 + 0.5, 0, 1)[..., None]
    return ab1 * (1 - w) + ab2 * w


def brown_share(ab: np.ndarray) -> float:
    """Share of clearly coloured pixels whose hue is orange/brown (Lab hue 30-100 degrees)."""
    chroma = np.hypot(ab[..., 0], ab[..., 1])
    hue = np.degrees(np.arctan2(ab[..., 1], ab[..., 0])) % 360
    coloured = chroma > 8
    return float(((hue > 30) & (hue < 100) & coloured).sum() / max(int(coloured.sum()), 1))


def lab_to_rgb(L: np.ndarray, ab: np.ndarray) -> np.ndarray:
    cv2 = _cv2()
    out = cv2.cvtColor(np.concatenate([L[:, :, None], ab], 2).astype(np.float32), cv2.COLOR_Lab2RGB)
    return (np.clip(out, 0, 1) * 255).round().astype(np.uint8)


def _models_in_loading_order() -> List[str]:
    """The model already in memory first, so a batch swaps models half as often."""
    loaded = onnx_sessions.loaded_model()
    return sorted(COLOUR_MODELS, key=lambda k: k != loaded)


def add_colour(data: bytes, params: Dict[str, Any], progress: Callable[[int], None], cancelled: Callable[[], bool]) -> bytes:
    """Recipe F (Natural) or the 768 px variant (Vivid), with the sepia fallback."""
    rgb = decode_rgb(data)
    Ls = stretch_brightness(_lab_l(rgb))
    vivid = params.get("style") == "vivid"
    predictions: Dict[str, np.ndarray] = {}
    progress(5)
    for i, key in enumerate(_models_in_loading_order()):
        if cancelled():
            return b""
        size = VIVID_SIZE if (vivid and key == "ddcolor_large") else NATURAL_SIZE
        with onnx_sessions.use_model(key) as session:
            predictions[key] = predict_ab(session, Ls, size)
        progress(45 if i == 0 else 80)
    ab = merge_more_colourful(predictions["ddcolor_large"], predictions["ddcolor_artistic"])
    if not vivid and not cancelled() and brown_share(ab) > SEPIA_SHARE:
        with onnx_sessions.use_model("ddcolor_large") as session:
            vivid_ab = merge_more_colourful(predict_ab(session, Ls, VIVID_SIZE), predictions["ddcolor_artistic"])
        if brown_share(vivid_ab) < brown_share(ab):
            ab = vivid_ab
    progress(95)
    return encode_jpeg(lab_to_rgb(Ls, ab))


# ── Fix faded colours ───────────────────────────────────────────────────────


def fix_faded_colours(rgb: np.ndarray) -> np.ndarray:
    """Recipe Q: per-channel black/white points, gentle local contrast, slightly richer colour."""
    cv2 = _cv2()
    f = rgb.astype(np.float32) / 255.0
    small = cv2.resize(f, (512, max(1, int(512 * f.shape[0] / f.shape[1]))), interpolation=cv2.INTER_AREA)
    out = np.empty_like(f)
    for c in range(3):
        lo, hi = np.percentile(small[..., c], (0.5, 99.5))
        gain = min(1.0 / max(hi - lo, 1e-3), 3.0)  # A nearly empty channel isn't blown up.
        out[..., c] = (f[..., c] - lo) * gain
    lab = cv2.cvtColor(np.clip(out, 0, 1), cv2.COLOR_RGB2Lab)
    L8 = np.clip(lab[..., 0] * 2.55, 0, 255).astype(np.uint8)
    lab[..., 0] = cv2.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8)).apply(L8).astype(np.float32) / 2.55
    lab[..., 1:] *= 1.12
    return (np.clip(cv2.cvtColor(lab, cv2.COLOR_Lab2RGB), 0, 1) * 255).round().astype(np.uint8)


def fade(data: bytes, params: Dict[str, Any], progress: Callable[[int], None], cancelled: Callable[[], bool]) -> bytes:
    progress(20)
    result = fix_faded_colours(decode_rgb(data))
    progress(95)
    return encode_jpeg(result)


def apply_intensity(result: bytes, source: bytes, intensity: float) -> bytes:
    """The viewer's strength slider: mixes the result with the original (1 = full result)."""
    intensity = max(0.0, min(1.0, float(intensity)))
    if intensity >= 0.999:
        return result
    new, old = decode_rgb(result).astype(np.float32), decode_rgb(source).astype(np.float32)
    if old.shape != new.shape:
        old = _cv2().resize(old, (new.shape[1], new.shape[0]), interpolation=_cv2().INTER_AREA)
    return encode_jpeg((old * (1 - intensity) + new * intensity).round().clip(0, 255).astype(np.uint8))


def register() -> None:
    """Plugs the processors into the queue (called once at engine start)."""
    register_processor("colour", Processor(models=COLOUR_MODELS, run=add_colour))
    register_processor("fade", Processor(models=(), run=fade))
