"""Screen-sized previews for the viewer (A8, owner: "loading should be smooth").

Library photos are 8K AVIFs (7680 px). Decoding one takes ~0.7 s on this laptop's CPU (more while
AI work runs), every time the viewer shows it. A 2560 px WebP preview is enough for any screen
at "fit" and decodes ~7x faster; the viewer loads the full photo only when zooming in.

The preview is made once, the first time it is needed (or right after 8K enhancement), and
recorded in ``photos.preview_path``. Moving the photo into the Private Vault encrypts it like
the photo itself (``vault_storage``); deleting the photo for good deletes it.
"""

from __future__ import annotations

import io
import logging
import os
from pathlib import Path
from typing import Optional

from PIL import Image, ImageOps

logger = logging.getLogger("securephotos.display_preview")

PREVIEW_LONG_EDGE = 2560
PREVIEW_QUALITY = 85
# A photo already this small is shown as it is (a preview would not be faster).
SMALL_ENOUGH = int(PREVIEW_LONG_EDGE * 1.25)


def preview_path_for(previews_dir: Path, photo_id: int, file_hash: Optional[str]) -> Path:
    """Where the preview of this exact file lives (a new file version gets a new name)."""
    tag = (file_hash or "nohash")[:16]
    return previews_dir / "display" / f"{photo_id}_{tag}.webp"


def make_preview(source: Path, dest: Path) -> bool:
    """Writes a 2560 px WebP of ``source`` to ``dest`` (atomic). False when not worth it.

    The colour profile is kept and the picture is turned upright, so it looks exactly like
    the photo. Never changes ``source``.
    """
    with Image.open(source) as im:
        if max(im.size) <= SMALL_ENOUGH:
            return False
        icc = im.info.get("icc_profile")
        im.draft("RGB", (PREVIEW_LONG_EDGE, PREVIEW_LONG_EDGE))  # JPEG: decode at a smaller scale.
        upright = ImageOps.exif_transpose(im)
        upright = upright.convert("RGBA" if upright.mode in ("RGBA", "LA", "PA") else "RGB")
    upright.thumbnail((PREVIEW_LONG_EDGE, PREVIEW_LONG_EDGE), Image.LANCZOS)
    buffer = io.BytesIO()
    kwargs = {"quality": PREVIEW_QUALITY, "method": 4}
    if icc:
        kwargs["icc_profile"] = icc
    upright.save(buffer, "WEBP", **kwargs)
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_name(f".{dest.name}.tmp")
    try:
        with open(temp, "wb") as fh:
            fh.write(buffer.getvalue())
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temp, dest)
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    return True
