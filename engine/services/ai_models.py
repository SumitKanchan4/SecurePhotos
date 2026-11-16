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

Old-photo models (H10, ``ON_DEMAND_MODELS``) are too big for the installer (~2.3 GB), so
they are fetched the first time the user improves an old photo, or imported from a file.
They live on this repo's GitHub Release ``models-v1`` and are pinned by URL + SHA-256 in
the same way. ``scripts/model_export/`` rebuilds them from the official weights.
"""

import hashlib
import logging
import os
import shutil
import threading
import urllib.request
from pathlib import Path
from typing import Callable, Dict, Optional

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

MODELS_RELEASE_URL = "https://github.com/SumitKanchan4/SecurePhotos/releases/download/models-v1/"

# Downloaded on first use, never bundled. ``size`` (bytes) drives the download progress bar.
ON_DEMAND_MODELS: Dict[str, Dict[str, str]] = {
    "ddcolor_large": {  # Colour for grey photos (DDColor ConvNeXt-L, any input size: 512 Natural, 768 Vivid).
        "file": "ddcolor_modelscope_dyn.onnx",
        "url": MODELS_RELEASE_URL + "ddcolor_modelscope_dyn.onnx",
        "sha256": "d50d71226e1405f7198bcffa354a8db54dd3c3a4e7e2483bcabbbc79173ef275",
        "size": "979685706",
        "license": "Apache-2.0",
    },
    "ddcolor_artistic": {  # Second colour opinion, merged per pixel with the large model.
        "file": "ddcolor_artistic_512.onnx",
        "url": MODELS_RELEASE_URL + "ddcolor_artistic_512.onnx",
        "sha256": "948838590ab1a753145e045a385fd708b24c9ea3f5cdfa3df2127127e00b88b3",
        "size": "979599968",
        "license": "Apache-2.0",
    },
    "gfpgan": {  # Sharper faces (GFPGAN v1.4, clean architecture).
        "file": "gfpgan_v1.4_512.onnx",
        "url": MODELS_RELEASE_URL + "gfpgan_v1.4_512.onnx",
        "sha256": "82493c5f1dcd8e666a7b651ac08eb2fd5a20fdbee2bb9b6d9c7863f04fff3df4",
        "size": "340357338",
        "license": "Apache-2.0",
    },
}


class DownloadCancelled(Exception):
    """The user cancelled a model download; nothing partial is kept."""


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


def download_verified(
    spec: Dict[str, str],
    dest_dir: Path,
    on_progress: Optional[Callable[[int, int], None]] = None,
    cancel: Optional[threading.Event] = None,
) -> Path:
    """Downloads one model from its pinned address into ``dest_dir`` and verifies it.

    Args:
        spec: Model entry from ``MODELS`` or ``ON_DEMAND_MODELS``.
        dest_dir: Folder to put the verified file in.
        on_progress: Called with (bytes so far, expected total) after each block.
        cancel: When set, the download stops and the partial file is removed.

    Raises:
        DownloadCancelled: ``cancel`` was set.
        IOError: If the download doesn't match the pinned SHA-256 (nothing is kept).
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / spec["file"]
    logger.info("Downloading %s (%s licence)...", spec["file"], spec["license"])
    tmp = path.with_name(path.name + ".download")
    req = urllib.request.Request(spec["url"], headers={"User-Agent": "SecurePhotos"})
    total = int(spec.get("size", 0))
    done = 0
    try:
        with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as fh:
            for block in iter(lambda: resp.read(1024 * 1024), b""):
                if cancel is not None and cancel.is_set():
                    raise DownloadCancelled(spec["file"])
                fh.write(block)
                done += len(block)
                if on_progress:
                    on_progress(done, total or done)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
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


# Verifying a 1 GB file takes seconds, so a file already checked is remembered by (size, mtime).
_verified_cache: Dict[str, tuple] = {}


def _stat_key(path: Path) -> tuple:
    st = path.stat()
    return (st.st_size, st.st_mtime_ns)


def is_model_ready(key: str, models_dir: Optional[Path] = None) -> bool:
    """True if the on-demand model ``key`` is present in the library and matches its checksum."""
    spec = ON_DEMAND_MODELS[key]
    path = (models_dir or get_models_dir()) / spec["file"]
    if not path.is_file():
        return False
    stamp = _stat_key(path)
    cached = _verified_cache.get(str(path))
    if cached == (stamp, spec["sha256"]):
        return True
    if sha256_of(path) != spec["sha256"]:
        return False
    _verified_cache[str(path)] = (stamp, spec["sha256"])
    return True


def model_path(key: str, models_dir: Optional[Path] = None) -> Path:
    """The verified file for on-demand model ``key``.

    Raises:
        FileNotFoundError: The model hasn't been downloaded or imported yet (or is damaged).
    """
    spec = ON_DEMAND_MODELS[key]
    path = (models_dir or get_models_dir()) / spec["file"]
    if not is_model_ready(key, models_dir):
        raise FileNotFoundError(f"The model {spec['file']} is not downloaded yet.")
    return path


def fetch_on_demand(
    key: str,
    models_dir: Optional[Path] = None,
    on_progress: Optional[Callable[[int, int], None]] = None,
    cancel: Optional[threading.Event] = None,
) -> Path:
    """Downloads on-demand model ``key`` unless a verified copy is already there."""
    models_dir = models_dir or get_models_dir()
    if is_model_ready(key, models_dir):
        return models_dir / ON_DEMAND_MODELS[key]["file"]
    path = download_verified(ON_DEMAND_MODELS[key], models_dir, on_progress, cancel)
    _verified_cache[str(path)] = (_stat_key(path), ON_DEMAND_MODELS[key]["sha256"])
    return path


def import_model_file(source: Path, models_dir: Optional[Path] = None) -> str:
    """Copies a model file the user picked (e.g. downloaded on another computer) into the library.

    The file is recognised by its checksum, not its name, so a renamed copy works and any
    other file is refused. It is copied to a temp name, checked again, then moved into place.

    Returns:
        The model's key in ``ON_DEMAND_MODELS``.

    Raises:
        ValueError: The file isn't one of the app's models (or is damaged).
    """
    models_dir = models_dir or get_models_dir()
    if not source.is_file():
        raise ValueError("That file doesn't exist.")
    size = source.stat().st_size
    candidates = [k for k, s in ON_DEMAND_MODELS.items() if int(s["size"]) == size]
    digest = sha256_of(source) if candidates else ""
    key = next((k for k in candidates if ON_DEMAND_MODELS[k]["sha256"] == digest), None)
    if key is None:
        raise ValueError("This file isn't one of SecurePhotos' old-photo models, or it is damaged.")
    spec = ON_DEMAND_MODELS[key]
    models_dir.mkdir(parents=True, exist_ok=True)
    dest = models_dir / spec["file"]
    tmp = dest.with_name(dest.name + ".import")
    try:
        shutil.copyfile(source, tmp)
        if sha256_of(tmp) != spec["sha256"]:
            raise ValueError("The copy didn't match; please try again.")
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
    _verified_cache[str(dest)] = (_stat_key(dest), spec["sha256"])
    return key
