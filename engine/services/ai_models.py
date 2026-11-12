"""The AI model files the app uses: where they come from and how they are verified (H8).

Every model is pinned to an exact upstream commit and SHA-256, so the bytes can never
change underneath the app. The release build ships them inside the installer: ``scripts/fetch_models.py`` fills
``build/models`` (never the live library, whose folder may hold other files) and the
installer copies that folder to ``<app>/data/models``. A fresh install works offline.
Lookup order:

1. A verified copy in the library's ``data/models`` folder.
2. The verified copy bundled with the installed app (``<app>/data/models``), copied into
   the library. This covers a library that was moved, e.g. to an external drive.
3. A download from the pinned address (development, or a damaged install), verified
   before it is used.

A file that fails its checksum is never loaded.
"""

import hashlib
import logging
import os
import shutil
import urllib.request
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger("securephotos.ai_models")

MODELS: Dict[str, Dict[str, str]] = {
    "yunet": {  # Face detection.
        "file": "face_detection_yunet_2023mar.onnx",
        "url": "https://huggingface.co/opencv/face_detection_yunet/resolve/"
               "3cc26e7f1014a5ee5d74a42acee58bafc9d0a310/face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "license": "MIT",
    },
    "sface": {  # Face recognition.
        "file": "face_recognition_sface_2021dec.onnx",
        "url": "https://huggingface.co/opencv/face_recognition_sface/resolve/"
               "3d7082438a6e4551e840c9b2bb60b71e8da4b524/face_recognition_sface_2021dec.onnx",
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        "license": "Apache-2.0",
    },
    "realesr": {  # Photo upscaling (Real-ESRGAN by Xintao Wang; ONNX export from a community mirror).
        "file": "realesr_general_x4v3.onnx",
        "url": "https://huggingface.co/huggingworld/onnx-image-models/resolve/"
               "fd3643143948de5f606ff87d5f97372e238ba277/realesr-general-x4v3.onnx",
        "sha256": "e8db65652ed421c2f8c92645d8f6fc6b07fd2868a916fdaa1a99c8d28091f097",
        "license": "BSD-3-Clause",
    },
}


def get_models_dir() -> Path:
    """The library's model folder (``<data>/models``)."""
    from engine.config import settings

    return settings.models_dir


def get_bundled_models_dir() -> Path:
    """The models shipped with the app: ``<app>/data/models`` when installed, ``build/models`` in development."""
    import sys

    from engine.services.video_runtime import get_app_root

    if getattr(sys, "frozen", False):
        return get_app_root() / "data" / "models"
    return get_app_root() / "build" / "models"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _is_verified(path: Path, spec: Dict[str, str]) -> bool:
    return path.is_file() and sha256_of(path) == spec["sha256"]


def download_verified(spec: Dict[str, str], dest_dir: Path) -> Path:
    """Downloads one model from its pinned address into ``dest_dir`` and verifies it.

    Raises:
        IOError: If the download doesn't match the pinned SHA-256 (nothing is kept).
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / spec["file"]
    logger.info("Downloading %s (%s licence)...", spec["file"], spec["license"])
    tmp = path.with_name(path.name + ".download")
    req = urllib.request.Request(spec["url"], headers={"User-Agent": "SecurePhotos"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as fh:
        for block in iter(lambda: resp.read(1024 * 1024), b""):
            fh.write(block)
    actual = sha256_of(tmp)
    if actual != spec["sha256"]:
        tmp.unlink(missing_ok=True)
        raise IOError(f"{spec['file']} failed its integrity check (got {actual[:12]}..., expected {spec['sha256'][:12]}...).")
    os.replace(tmp, path)
    return path


def ensure_model(spec: Dict[str, str], models_dir: Optional[Path] = None) -> Path:
    """Returns the verified model file, using the bundled copy or downloading it if needed."""
    models_dir = models_dir or get_models_dir()
    path = models_dir / spec["file"]
    if _is_verified(path, spec):
        return path

    bundled = get_bundled_models_dir() / spec["file"]
    if bundled.resolve() != path.resolve() and _is_verified(bundled, spec):
        models_dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".copy")
        shutil.copyfile(bundled, tmp)
        if sha256_of(tmp) == spec["sha256"]:
            os.replace(tmp, path)
            logger.info("Copied the bundled %s into the library.", spec["file"])
            return path
        tmp.unlink(missing_ok=True)

    return download_verified(spec, models_dir)
