"""Single-version photo enhancement pipeline (backlog item C1).

Owner decisions (2026-11-10): every imported photo is enhanced and the result
replaces the original; small photos are enlarged to 8K; output is AVIF with the
camera details kept; the quality slider controls AVIF quality. Blurry-face
restoration was removed in H9 (no permissively licensed model; CodeFormer is
non-commercial).

Everything happens in memory and the file is written exactly once:

    open -> read EXIF/ICC -> turn upright -> sharpen/upscale
         -> save AVIF to temp -> fsync -> verify -> atomic replace

The original file is NOT deleted here. The caller deletes it only after the
database row points at the new file (see ``engine.api.photos``).
"""

from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Tuple, Union

from PIL import Image, ImageFilter, ImageOps

from engine.services.media_paths import unique_path
from engine.services.super_resolution_service import enhance_pixels

logger = logging.getLogger("securephotos.enhancement")

TARGET_LONG_EDGE = 7680  # 8K
# Settings → Photo size (owner, 2026-11-19): the long edge each choice brings photos to.
PHOTO_SIZES = {"2k": 2560, "4k": 3840, "8k": 7680}
# Auto (owner, 2026-11-21; the default): decided per photo from its own pixel count when it is
# enhanced. Full-size photos (6 MP and up: phone and camera originals, scans) get 8K and stay
# lighter than the original JPEG; smaller ones (WhatsApp, screenshots) get 4K, so they aren't
# blown up to many times their size (measured 2026-11-21: small photos grew 4-8x at 8K).
AUTO = 0
AUTO_FULL_SIZE_PIXELS = 6_000_000
DEFAULT_PHOTO_SIZE = "auto"


def photo_size_to_long_edge(value) -> int:
    """The long edge for a stored ``photo_resolution`` setting; ``AUTO`` for "auto" and unknown
    values (the renderer then decides per photo, :func:`auto_long_edge`)."""
    return PHOTO_SIZES.get(str(value or "").lower(), AUTO)


def auto_long_edge(width: int, height: int) -> int:
    """Auto's choice for one photo: 8K for full-size photos, 4K for smaller ones."""
    return PHOTO_SIZES["8k"] if width * height >= AUTO_FULL_SIZE_PIXELS else PHOTO_SIZES["4k"]
EXIF_ORIENTATION_TAG = 0x0112

QUALITY_SLIDER_MIN, QUALITY_SLIDER_MAX = 12, 28
DEFAULT_QUALITY_SLIDER = 18


def slider_to_avif_quality(slider_value: int) -> int:
    """Maps the Settings quality slider (12 = best .. 28 = smallest) to AVIF quality.

    12 -> 92, 18 (default) -> 80, 28 -> 60. Out-of-range values are clamped.

    Args:
        slider_value: Stored ``quality_crf`` setting.

    Returns:
        AVIF quality (0-100 scale used by Pillow).
    """
    try:
        value = int(slider_value)
    except (TypeError, ValueError):
        value = DEFAULT_QUALITY_SLIDER
    value = max(QUALITY_SLIDER_MIN, min(QUALITY_SLIDER_MAX, value))
    return 92 - (value - QUALITY_SLIDER_MIN) * 2


@dataclass(frozen=True)
class EnhancedPhoto:
    """Result of enhancing one photo.

    Attributes:
        path: The new AVIF file (may differ from the source path).
        width: Pixel width.
        height: Pixel height.
        size: File size in bytes.
    """

    path: Path
    width: int
    height: int
    size: int

    mime_type: str = "image/avif"


# T31b (owner, 2026-11-24): small photos can be enlarged with AI (Real-ESRGAN) instead of the
# resize + sharpen, on computers whose graphics card the speed test found fast for it. Off by
# default (Settings → Photos) until the owner has compared both. Only for small photos: the model
# takes at most 1920 px, so a larger photo would lose detail on the way in and keeps more with the
# resize. WhatsApp-size photos (1600–2048 px) qualify; Auto brings them to 4K (about 1.9x).
AI_ENLARGE_MAX_SOURCE = 2048
AI_ENLARGE_MIN_SCALE = 1.5


def ai_enlarge_ready() -> bool:
    """True when this computer runs the enlarging model on its graphics card."""
    from engine.services import ai_device

    return ai_device.device_for("realesr") == ai_device.GPU


def _enlarge_with_ai(img: Image.Image, target_long_edge: int) -> "Image.Image | None":
    """Real-ESRGAN 4x, then brought to the exact size; None if it can't (the resize is used)."""
    from engine.services import ai_device
    from engine.services.neural_sr_service import neural_upscale

    try:
        big = neural_upscale(img)
    except Exception as err:
        logger.warning("AI enlarging failed; using the resize: %s", str(err)[:200])
        ai_device.mark_cpu(["realesr"], "stopped working on the graphics card")
        return None
    # The exact size the resize would give (from the original, so rounding never differs by a pixel).
    ratio = target_long_edge / max(img.size)
    size = (max(1, round(img.width * ratio)), max(1, round(img.height * ratio)))
    if big.size == size:
        return big
    scale = max(size) / max(big.size)
    resized = big.resize(size, Image.Resampling.LANCZOS)
    # Brought down from 4x it is already crisp; a very small photo still grows a little more.
    return resized.filter(ImageFilter.UnsharpMask(radius=0.8, percent=60, threshold=2)) if scale > 1 else resized


def _has_alpha(img: Image.Image) -> bool:
    return img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)


def render_enhanced_avif(
    source: Union[Path, bytes], avif_quality: int, target_long_edge: int = AUTO, ai_enlarge: bool = False
) -> Tuple[bytes, int, int]:
    """Enhances an image entirely in memory and returns it encoded as AVIF.

    The camera details (EXIF: date, GPS, camera) and colour profile are kept.
    The orientation tag is reset to "normal" because the pixels are already
    turned upright; otherwise viewers would rotate the photo a second time.
    The encoded result is decoded once to verify it before it is returned.

    Args:
        source: Image file path, or the image file's bytes (e.g. a decrypted vault photo).
        avif_quality: AVIF quality from :func:`slider_to_avif_quality`.
        target_long_edge: Photo size from :func:`photo_size_to_long_edge` (``AUTO``: by the photo's own size).
        ai_enlarge: Settings → Photos, "Enlarge small photos with AI" (T31b): used only when the
            photo is small (``AI_ENLARGE_MAX_SOURCE``), grows at least ``AI_ENLARGE_MIN_SCALE`` and the
            graphics card runs the model.

    Returns:
        (AVIF bytes, width, height).
    """
    opened = Image.open(io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else source)
    with opened as im:
        exif = im.getexif()
        icc_profile = im.info.get("icc_profile")
        # An improved copy's AI label (IPTC digital source type, H10) must survive 8K (P2).
        xmp = im.info.get("xmp")
        upright = ImageOps.exif_transpose(im)
        alpha = _has_alpha(upright)
        upright = upright.convert("RGBA" if alpha else "RGB")

    if EXIF_ORIENTATION_TAG in exif:
        exif[EXIF_ORIENTATION_TAG] = 1

    if target_long_edge == AUTO:
        target_long_edge = auto_long_edge(*upright.size)
    enhanced = None
    small = max(upright.size) <= AI_ENLARGE_MAX_SOURCE and target_long_edge >= AI_ENLARGE_MIN_SCALE * max(upright.size)
    if ai_enlarge and not alpha and small and ai_enlarge_ready():
        enhanced = _enlarge_with_ai(upright, target_long_edge)
    if enhanced is None:
        enhanced = enhance_pixels(upright, target_long_edge)

    save_kwargs = {"quality": avif_quality}
    if len(exif):
        save_kwargs["exif"] = exif.tobytes()
    if icc_profile:
        save_kwargs["icc_profile"] = icc_profile
    if xmp:
        save_kwargs["xmp"] = xmp if isinstance(xmp, (bytes, bytearray)) else str(xmp).encode("utf-8")
    buffer = io.BytesIO()
    enhanced.save(buffer, "AVIF", **save_kwargs)
    data = buffer.getvalue()

    with Image.open(io.BytesIO(data)) as check:
        check.verify()
    with Image.open(io.BytesIO(data)) as check:
        if check.size != enhanced.size:
            raise IOError(f"Enhanced image has wrong size {check.size}, expected {enhanced.size}.")
    return data, enhanced.size[0], enhanced.size[1]


def enhance_to_avif(source: Path, avif_quality: int, target_long_edge: int = AUTO, ai_enlarge: bool = False) -> EnhancedPhoto:
    """Enhances one library photo and writes it as AVIF next to the source.

    See :func:`render_enhanced_avif` for what is kept and changed. The file is
    written to a temp name, fsynced, then atomically moved into place.

    Args:
        source: Existing image file.
        avif_quality: AVIF quality from :func:`slider_to_avif_quality`.

    Returns:
        The new file's details. ``path`` is ``source`` itself if it was already
        ``.avif``; otherwise a free ``<name>.avif`` beside it.

    Raises:
        Exception: Any decode/encode/verification error. No file is left behind
            on failure; the source is never modified.
    """
    dest = source if source.suffix.lower() == ".avif" else unique_path(source.with_suffix(".avif"))
    temp = dest.parent / f".{dest.name}.opt.tmp"
    try:
        data, width, height = render_enhanced_avif(source, avif_quality, target_long_edge, ai_enlarge)
        with open(temp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temp, dest)
    except Exception:
        temp.unlink(missing_ok=True)
        raise

    logger.info("Enhanced %s -> %s (%dx%d, %d bytes)", source.name, dest.name, width, height, len(data))
    return EnhancedPhoto(path=dest, width=width, height=height, size=len(data))
