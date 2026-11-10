"""Crash-safe vault file migration (lock / unlock) for SecurePhotos.

Moving a photo into or out of the private vault touches up to three files
(original, thumbnail, preview) plus one database row. A crash, power loss or
hot-unplug can happen at any point, so every operation follows the same
ordering, one photo at a time:

    1. Journal   - record the planned file pairs in ``vault_pending_ops`` and commit.
    2. Write     - write every target file via temp file + fsync + atomic replace,
                   and (on lock) verify the ciphertext decrypts back to the source.
    3. Commit    - update the ``photos`` row and commit. From here on the new
                   files are the source of truth.
    4. Clean up  - delete the now-superseded source files.
    5. Close     - delete the journal entry and commit.

If the process dies between steps, :func:`reconcile_pending_vault_ops` (run at
engine startup) reads the journal and keeps whichever side the committed row
points at, deleting only the other side, and only when the kept side exists.
Source files are never deleted before the row that replaces them is committed.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

import aiosqlite

from engine.config import resolve_media_path, settings
from engine.services.crypto_vault import decrypt_file_chunked_stream, encrypt_file_chunked

logger = logging.getLogger("securephotos.vault_storage")

ENC_SUFFIX = ".enc"
_HASH_BLOCK = 1024 * 1024


class VaultAssetError(Exception):
    """Raised when a single photo could not be moved into or out of the vault.

    The photo's files and database row are left exactly as they were before the
    attempt, so the caller can report the failure and continue with other photos.
    """


@dataclass(frozen=True)
class FilePair:
    """One plaintext file and its encrypted counterpart.

    Attributes:
        plain: Path of the plaintext file.
        enc: Path of the ``.enc`` file.
    """

    plain: Path
    enc: Path


# ── Path helpers ──────────────────────────────────────────────────────────────

def to_db_path(path: Path) -> str:
    """Converts a filesystem path to the form stored in SQLite.

    Paths inside the data directory are stored relative to it with forward
    slashes (portable across drive letters, rule §2). Paths outside it are
    stored as-is.

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

    Unlike :func:`engine.config.resolve_media_path`, this never falls back to
    "any file with the same name in the data directory", because acting on a
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


def _unique_path(path: Path) -> Path:
    """Returns ``path`` if it is free, otherwise ``stem (n)suffix`` that is free.

    Prevents a lock or unlock from overwriting an unrelated file that happens
    to sit at the target name.
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


def _enc_temp(enc: Path) -> Path:
    """Temp path used by :func:`encrypt_file_chunked` while writing ``enc``."""
    return enc.parent / f".{enc.name}.tmp"


def _dec_temp(plain: Path) -> Path:
    """Temp path used while decrypting into ``plain``."""
    return plain.parent / f".{plain.name}.dec.tmp"


def _safe_unlink(path: Path) -> None:
    """Deletes a file, logging instead of raising (cleanup must not abort a flow)."""
    try:
        path.unlink(missing_ok=True)
    except OSError as err:
        logger.warning("Could not delete %s: %s", path, err)


# ── File operations ───────────────────────────────────────────────────────────

def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fin:
        for block in iter(lambda: fin.read(_HASH_BLOCK), b""):
            digest.update(block)
    return digest.hexdigest()


def _sha256_decrypted(enc: Path, mvk: bytes) -> str:
    digest = hashlib.sha256()
    for chunk in decrypt_file_chunked_stream(enc, mvk):
        digest.update(chunk)
    return digest.hexdigest()


def encrypt_and_verify(pair: FilePair, mvk: bytes) -> None:
    """Encrypts ``pair.plain`` into ``pair.enc`` and proves it decrypts back.

    The plaintext is not touched. On any failure the partial ``.enc`` and its
    temp file are removed.

    Raises:
        VaultAssetError: If encryption or verification fails.
    """
    try:
        source_hash = _sha256_file(pair.plain)
        encrypt_file_chunked(pair.plain, pair.enc, mvk)
        if _sha256_decrypted(pair.enc, mvk) != source_hash:
            raise VaultAssetError(f"Encrypted copy of {pair.plain.name} failed verification.")
    except Exception as err:
        _safe_unlink(pair.enc)
        _safe_unlink(_enc_temp(pair.enc))
        if isinstance(err, VaultAssetError):
            raise
        raise VaultAssetError(f"Could not encrypt {pair.plain.name}: {err}") from err


def decrypt_to_file(pair: FilePair, mvk: bytes) -> None:
    """Decrypts ``pair.enc`` into ``pair.plain`` via temp file + fsync + atomic replace.

    Every chunk's authentication tag is checked before the final file appears,
    so a corrupted ``.enc`` never produces a partial plaintext file.

    Raises:
        VaultAssetError: If decryption or writing fails.
    """
    temp = _dec_temp(pair.plain)
    try:
        with open(temp, "wb") as fout:
            for chunk in decrypt_file_chunked_stream(pair.enc, mvk):
                fout.write(chunk)
            fout.flush()
            os.fsync(fout.fileno())
        os.replace(temp, pair.plain)
    except Exception as err:
        _safe_unlink(temp)
        raise VaultAssetError(f"Could not decrypt {pair.enc.name}: {err}") from err


# ── Journal ───────────────────────────────────────────────────────────────────

def _pairs_to_json(pairs: Sequence[FilePair]) -> str:
    return json.dumps([[to_db_path(p.plain), to_db_path(p.enc)] for p in pairs])


def _pairs_from_json(raw: str) -> List[Tuple[str, str]]:
    return [(plain, enc) for plain, enc in json.loads(raw)]


async def _journal_start(conn: aiosqlite.Connection, photo_id: int, op: str, pairs: Sequence[FilePair]) -> None:
    await conn.execute(
        "INSERT OR REPLACE INTO vault_pending_ops (photo_id, operation, file_pairs) VALUES (?, ?, ?);",
        (photo_id, op, _pairs_to_json(pairs)),
    )
    await conn.commit()


async def _journal_end(conn: aiosqlite.Connection, photo_id: int) -> None:
    await conn.execute("DELETE FROM vault_pending_ops WHERE photo_id = ?;", (photo_id,))
    await conn.commit()


# ── Lock / unlock one photo ───────────────────────────────────────────────────

async def lock_photo(conn: aiosqlite.Connection, row: aiosqlite.Row, mvk: bytes) -> bool:
    """Moves one photo (original, thumbnail, preview) into the private vault.

    Args:
        conn: Open connection with no uncommitted changes.
        row: Row with ``id``, ``filepath``, ``thumbnail_path``, ``preview_path``.
        mvk: Active master vault key.

    Returns:
        True if the photo was locked, False if its original file is missing.

    Raises:
        VaultAssetError: If any file could not be encrypted. Nothing is changed.
    """
    photo_id = row["id"]
    original = resolve_stored_path(row["filepath"])
    if original is None or original.suffix == ENC_SUFFIX:
        return False

    def plan(src: Optional[Path]) -> Optional[FilePair]:
        if src is None or src.suffix == ENC_SUFFIX:
            return None
        return FilePair(plain=src, enc=_unique_path(src.with_name(src.name + ENC_SUFFIX)))

    main = plan(original)
    thumb = plan(resolve_stored_path(row["thumbnail_path"]))
    preview = plan(resolve_stored_path(row["preview_path"]))
    pairs = [p for p in (main, thumb, preview) if p is not None]

    await _journal_start(conn, photo_id, "lock", pairs)
    done: List[FilePair] = []
    try:
        for pair in pairs:
            encrypt_and_verify(pair, mvk)
            done.append(pair)
    except VaultAssetError:
        for pair in done:
            _safe_unlink(pair.enc)
        await _journal_end(conn, photo_id)
        raise

    await conn.execute(
        """
        UPDATE photos
        SET is_encrypted = 1,
            filepath = ?,
            thumbnail_path = COALESCE(?, thumbnail_path),
            preview_path = COALESCE(?, preview_path),
            vault_type = 'private'
        WHERE id = ?;
        """,
        (
            to_db_path(main.enc),
            to_db_path(thumb.enc) if thumb else None,
            to_db_path(preview.enc) if preview else None,
            photo_id,
        ),
    )
    await conn.commit()

    for pair in pairs:
        _safe_unlink(pair.plain)
    await _journal_end(conn, photo_id)
    return True


async def unlock_photo(conn: aiosqlite.Connection, row: aiosqlite.Row, mvk: bytes) -> bool:
    """Moves one photo out of the private vault back into the library.

    Args:
        conn: Open connection with no uncommitted changes.
        row: Row with ``id``, ``filepath``, ``thumbnail_path``, ``preview_path``.
        mvk: Active master vault key.

    Returns:
        True if the photo was unlocked, False if its encrypted file is missing.

    Raises:
        VaultAssetError: If any file could not be decrypted. Nothing is changed.
    """
    photo_id = row["id"]
    enc_original = resolve_stored_path(row["filepath"])
    if enc_original is None or enc_original.suffix != ENC_SUFFIX:
        return False

    def plan(src: Optional[Path]) -> Optional[FilePair]:
        # Only files that are actually encrypted are decrypted; a plaintext
        # thumbnail left from an older version is kept as-is.
        if src is None or src.suffix != ENC_SUFFIX:
            return None
        return FilePair(plain=_unique_path(src.with_suffix("")), enc=src)

    main = plan(enc_original)
    thumb = plan(resolve_stored_path(row["thumbnail_path"]))
    preview = plan(resolve_stored_path(row["preview_path"]))
    pairs = [p for p in (main, thumb, preview) if p is not None]

    await _journal_start(conn, photo_id, "unlock", pairs)
    done: List[FilePair] = []
    try:
        for pair in pairs:
            decrypt_to_file(pair, mvk)
            done.append(pair)
    except VaultAssetError:
        for pair in done:
            _safe_unlink(pair.plain)
        await _journal_end(conn, photo_id)
        raise

    await conn.execute(
        """
        UPDATE photos
        SET is_encrypted = 0,
            filepath = ?,
            thumbnail_path = COALESCE(?, thumbnail_path),
            preview_path = COALESCE(?, preview_path),
            vault_type = NULL
        WHERE id = ?;
        """,
        (
            to_db_path(main.plain),
            to_db_path(thumb.plain) if thumb else None,
            to_db_path(preview.plain) if preview else None,
            photo_id,
        ),
    )
    await conn.commit()

    for pair in pairs:
        _safe_unlink(pair.enc)
    await _journal_end(conn, photo_id)
    return True


async def lock_photos(conn: aiosqlite.Connection, rows: Iterable[aiosqlite.Row], mvk: bytes) -> Tuple[List[int], List[int]]:
    """Locks several photos, one at a time, continuing past individual failures.

    Returns:
        (locked_ids, failed_ids). Photos whose original file is missing are in neither.
    """
    locked, failed = [], []
    for row in rows:
        try:
            if await lock_photo(conn, row, mvk):
                locked.append(row["id"])
        except VaultAssetError as err:
            logger.error("Vault lock failed for photo %s: %s", row["id"], err)
            failed.append(row["id"])
    return locked, failed


async def unlock_photos(conn: aiosqlite.Connection, rows: Iterable[aiosqlite.Row], mvk: bytes) -> Tuple[List[int], List[int]]:
    """Unlocks several photos, one at a time, continuing past individual failures.

    Returns:
        (unlocked_ids, failed_ids). Photos whose encrypted file is missing are in neither.
    """
    unlocked, failed = [], []
    for row in rows:
        try:
            if await unlock_photo(conn, row, mvk):
                unlocked.append(row["id"])
        except VaultAssetError as err:
            logger.error("Vault unlock failed for photo %s: %s", row["id"], err)
            failed.append(row["id"])
    return unlocked, failed


# ── Startup reconciliation ────────────────────────────────────────────────────

async def _is_referenced_elsewhere(conn: aiosqlite.Connection, photo_id: int, path: Path) -> bool:
    """True if any other photo row points at ``path`` (in any stored form)."""
    forms = {to_db_path(path), str(path), str(path.resolve()), path.as_posix()}
    placeholders = ",".join("?" for _ in forms)
    params = [photo_id, *forms, *forms, *forms]
    async with conn.execute(
        f"""
        SELECT 1 FROM photos
        WHERE id != ? AND (filepath IN ({placeholders})
                           OR thumbnail_path IN ({placeholders})
                           OR preview_path IN ({placeholders}))
        LIMIT 1;
        """,
        params,
    ) as cursor:
        return await cursor.fetchone() is not None


def _path_from_journal(stored: str) -> Path:
    """Journal paths are written by :func:`to_db_path`; resolve them without requiring existence."""
    raw = Path(stored)
    if not raw.is_absolute():
        return settings.data_dir / raw
    found = resolve_stored_path(stored)
    return found if found is not None else raw


async def reconcile_pending_vault_ops(conn: Optional[aiosqlite.Connection] = None) -> int:
    """Finishes or rolls back vault operations interrupted by a crash.

    For each journal entry, the committed ``photos`` row decides the outcome:
    if it says encrypted, the plaintext copies are leftovers; otherwise the
    ``.enc`` copies are. A leftover is deleted only if the file being kept
    exists and no other row references the leftover. Temp files are always
    removed. Needs no vault key.

    Args:
        conn: Optional open connection. If None, one is opened and closed.

    Returns:
        Number of journal entries processed.
    """
    from engine.database import get_db_connection

    own_conn = conn is None
    if own_conn:
        conn = await get_db_connection()
    processed = 0
    try:
        async with conn.execute("SELECT photo_id, operation, file_pairs FROM vault_pending_ops;") as cursor:
            entries = await cursor.fetchall()

        for entry in entries:
            photo_id = entry["photo_id"]
            async with conn.execute("SELECT is_encrypted FROM photos WHERE id = ?;", (photo_id,)) as cursor:
                photo = await cursor.fetchone()

            try:
                pairs = _pairs_from_json(entry["file_pairs"])
            except (ValueError, TypeError):
                logger.error("Unreadable vault journal entry for photo %s; leaving files untouched.", photo_id)
                pairs = []

            for plain_s, enc_s in pairs:
                plain, enc = _path_from_journal(plain_s), _path_from_journal(enc_s)
                _safe_unlink(_enc_temp(enc))
                _safe_unlink(_dec_temp(plain))
                if photo is None:
                    continue  # Row gone: keep both files rather than guess.
                keep, drop = (enc, plain) if photo["is_encrypted"] else (plain, enc)
                if keep.is_file() and drop.is_file() and not await _is_referenced_elsewhere(conn, photo_id, drop):
                    logger.info("Vault recovery: removing leftover %s (photo %s)", drop, photo_id)
                    _safe_unlink(drop)

            await conn.execute("DELETE FROM vault_pending_ops WHERE photo_id = ?;", (photo_id,))
            await conn.commit()
            processed += 1
    finally:
        if own_conn:
            await conn.close()

    if processed:
        logger.info("Vault recovery finished %d interrupted operation(s).", processed)
    return processed
