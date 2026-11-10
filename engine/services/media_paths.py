"""Shared, safe path handling for media files stored in the SecurePhotos database.

Rule §2 (portable drives): paths inside the data folder are stored relative to
it, so the library works whatever drive letter Windows assigns. Code that
reads a stored path must resolve it against the data folder, never against
the process's current working directory.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from engine.config import resolve_media_path, settings

ENC_SUFFIX = ".enc"


def to_db_path(path: Path) -> str:
    """Converts a filesystem path to the form stored in SQLite.

    Paths inside the data directory are stored relative to it with forward
    slashes. Paths outside it are stored as-is.

    Args:
        path: Absolute filesystem path.

    Returns:
        Portable relative path string, or the absolute path string.
    """
    try:
        return path.resolve().relative_to(settings.data_dir.resolve()).as_posix()
    except ValueError:
        return str(path)


def resolve_stored_path(stored: Optional[str]) -> Optional[Path]:
    """Resolves a path stored in SQLite to an existing file on disk.

    Relative paths resolve against the data folder (not the working directory).
    Absolute paths are tried as-is, then with drive-letter remapping. Unlike
    :func:`engine.config.resolve_media_path`, this never falls back to "any
    file with the same name in the data directory", because acting on a
    different file with the same name would destroy the wrong data.

    Args:
        stored: Path string from the database (relative or absolute).

    Returns:
        The existing file path, or None if it cannot be located safely.
    """
    if not stored:
        return None
    raw = Path(stored)
    if not raw.is_absolute():
        candidate = settings.data_dir / raw
        return candidate if candidate.is_file() else None
    if raw.is_file():
        return raw
    remapped = resolve_media_path(stored)
    if remapped == settings.data_dir / raw.name:
        return None  # Reject the name-only fallback.
    return remapped if remapped.is_file() else None


def unique_path(path: Path) -> Path:
    """Returns ``path`` if it is free, otherwise ``stem (n)ext`` that is free.

    A trailing ``.enc`` is kept at the end (``a.jpg.enc`` -> ``a (1).jpg.enc``).
    Prevents writing over an unrelated file that happens to sit at the target name.
    """
    if not path.exists():
        return path
    name, tail = path.name, ""
    if name.endswith(ENC_SUFFIX):
        name, tail = name[: -len(ENC_SUFFIX)], ENC_SUFFIX
    stem, ext = os.path.splitext(name)
    n = 1
    while True:
        candidate = path.with_name(f"{stem} ({n}){ext}{tail}")
        if not candidate.exists():
            return candidate
        n += 1
