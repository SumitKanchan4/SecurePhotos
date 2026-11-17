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

Old-photo models (H10, ``ON_DEMAND_MODELS``) are too big to ship inside the installer
(~2.3 GB). The installer downloads them into ``<app>/data/models`` after it copies the app
(``engine/services/model_installer.py``, run as ``securephotos-engine --fetch-models``); if
that fails the app asks before the first feature that needs one. They live on this repo's
GitHub Release ``models-v1`` and are pinned by URL + SHA-256 in the same way.
``scripts/model_export/`` rebuilds them from the official weights. Only these exact files
are ever used: there is no way to point the app at another model (owner decision, A2c).
"""

import hashlib
import json
import logging
import os
import shutil
import threading
import urllib.request
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional

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

    An interrupted download (network drop, app closed) leaves ``<file>.download`` behind and
    the next attempt continues from there; a cancelled one is removed.

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
    total = int(spec.get("size", 0))
    done = tmp.stat().st_size if tmp.is_file() else 0
    if total and done >= total:
        done = 0  # A full-size leftover failed its check before; start again.
    headers = {"User-Agent": "SecurePhotos"}
    if done:
        headers["Range"] = f"bytes={done}-"
    req = urllib.request.Request(spec["url"], headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            if done and getattr(resp, "status", 200) != 206:
                done = 0  # The server ignored the range: start from the beginning.
            with open(tmp, "ab" if done else "wb") as fh:
                for block in iter(lambda: resp.read(1024 * 1024), b""):
                    if cancel is not None and cancel.is_set():
                        raise DownloadCancelled(spec["file"])
                    fh.write(block)
                    done += len(block)
                    if on_progress:
                        on_progress(done, total or done)
    except DownloadCancelled:
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


# Verifying a 1 GB file takes seconds, so a file already checked is remembered by
# (size, mtime): in memory, and in ``verified.json`` next to it so the next start is instant.
_verified_cache: Dict[str, tuple] = {}
VERIFIED_FILE = "verified.json"


def _stat_key(path: Path) -> tuple:
    st = path.stat()
    return (st.st_size, st.st_mtime_ns)


def _read_stamps(folder: Path) -> Dict[str, list]:
    try:
        data = json.loads((folder / VERIFIED_FILE).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _remember(path: Path, sha256: str) -> None:
    stamp = _stat_key(path)
    _verified_cache[str(path)] = (stamp, sha256)
    stamps = _read_stamps(path.parent)
    stamps[path.name] = [stamp[0], stamp[1], sha256]
    try:
        tmp = path.parent / (VERIFIED_FILE + ".tmp")
        tmp.write_text(json.dumps(stamps, indent=1), encoding="utf-8")
        os.replace(tmp, path.parent / VERIFIED_FILE)
    except OSError:
        pass  # Read-only folder: it is simply checked again next time.


def model_dirs(models_dir: Optional[Path] = None) -> List[Path]:
    """Where an old-photo model may be: the library's folder, then the app's own
    ``<app>/data/models`` (where the installer puts them) when that is a different folder."""
    first = models_dir or get_models_dir()
    dirs = [first]
    if models_dir is None:
        app_dir = get_bundled_models_dir()
        try:
            if app_dir.resolve() != first.resolve():
                dirs.append(app_dir)
        except OSError:
            pass
    return dirs


def _verified_here(path: Path, sha256: str) -> bool:
    if not path.is_file():
        return False
    stamp = _stat_key(path)
    if _verified_cache.get(str(path)) == (stamp, sha256):
        return True
    if _read_stamps(path.parent).get(path.name) == [stamp[0], stamp[1], sha256]:
        _verified_cache[str(path)] = (stamp, sha256)
        return True
    if sha256_of(path) != sha256:
        return False
    _remember(path, sha256)
    return True


def find_model(key: str, models_dir: Optional[Path] = None) -> Optional[Path]:
    """The verified file for on-demand model ``key``, or None if it isn't on this computer."""
    spec = ON_DEMAND_MODELS[key]
    for folder in model_dirs(models_dir):
        if _verified_here(folder / spec["file"], spec["sha256"]):
            return folder / spec["file"]
    return None


def is_model_ready(key: str, models_dir: Optional[Path] = None) -> bool:
    """True if on-demand model ``key`` is on this computer and matches its checksum."""
    return find_model(key, models_dir) is not None


def missing_models(keys: Iterable[str], models_dir: Optional[Path] = None) -> List[str]:
    """The keys among ``keys`` that still need downloading."""
    return [k for k in keys if not is_model_ready(k, models_dir)]


def download_size(keys: Iterable[str]) -> int:
    """Bytes to download for ``keys``."""
    return sum(int(ON_DEMAND_MODELS[k]["size"]) for k in keys)


def model_path(key: str, models_dir: Optional[Path] = None) -> Path:
    """The verified file for on-demand model ``key``.

    Raises:
        FileNotFoundError: The model hasn't been downloaded yet (or is damaged).
    """
    path = find_model(key, models_dir)
    if path is None:
        raise FileNotFoundError(f"The model {ON_DEMAND_MODELS[key]['file']} is not downloaded yet.")
    return path


def fetch_on_demand(
    key: str,
    models_dir: Optional[Path] = None,
    on_progress: Optional[Callable[[int, int], None]] = None,
    cancel: Optional[threading.Event] = None,
) -> Path:
    """Downloads on-demand model ``key`` into ``models_dir`` unless a verified copy is already there."""
    found = find_model(key, models_dir)
    if found is not None:
        return found
    path = download_verified(ON_DEMAND_MODELS[key], models_dir or get_models_dir(), on_progress, cancel)
    _remember(path, ON_DEMAND_MODELS[key]["sha256"])
    return path


def check_all_models() -> Dict[str, bool]:
    """Engine start: verifies every old-photo model once so the app knows which features work."""
    return {key: is_model_ready(key) for key in ON_DEMAND_MODELS}
