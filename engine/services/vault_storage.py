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

import asyncio
import hashlib
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, List, Optional, Sequence, Tuple

import aiosqlite

from engine.config import settings
from engine.services.media_paths import ENC_SUFFIX, resolve_stored_path, to_db_path
from engine.services.media_paths import unique_path as _unique_path
from engine.services.work_queues import vault_files
from engine.services.crypto_vault import (
    decrypt_file_chunked_stream,
    decrypt_file_to_bytes,
    decrypt_photo_metadata,
    encrypt_file_chunked,
    encrypt_photo_metadata,
)

logger = logging.getLogger("securephotos.vault_storage")

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


# ── Path helpers (shared implementations live in media_paths) ─────────────────

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


async def _journal_start(
    conn: aiosqlite.Connection,
    photo_id: int,
    op: str,
    pairs: Sequence[FilePair],
    cleanup_paths: Sequence[Path] = (),
) -> None:
    """Records the planned files before anything changes.

    ``cleanup_paths`` are extra files (face crops) to delete once a *lock* has
    committed; recovery deletes them only if the row ended up encrypted.
    """
    await conn.execute(
        "INSERT OR REPLACE INTO vault_pending_ops (photo_id, operation, file_pairs, cleanup_paths) VALUES (?, ?, ?, ?);",
        (photo_id, op, _pairs_to_json(pairs), json.dumps([to_db_path(p) for p in cleanup_paths])),
    )
    await conn.commit()


# ── Sensitive details of vault photos (C4) ────────────────────────────────────

_SENSITIVE_FIELDS = ("ocr_text", "latitude", "longitude")


async def _read_sensitive_details(conn: aiosqlite.Connection, photo_id: int) -> Tuple[dict, List[int]]:
    """Returns (document text + GPS, ids of this photo's detected faces)."""
    async with conn.execute(
        f"SELECT {', '.join(_SENSITIVE_FIELDS)} FROM photos WHERE id = ?;", (photo_id,)
    ) as cur:
        row = await cur.fetchone()
    async with conn.execute("SELECT id FROM faces WHERE photo_id = ?;", (photo_id,)) as cur:
        face_ids = [r["id"] for r in await cur.fetchall()]
    return {k: row[k] for k in _SENSITIVE_FIELDS}, face_ids


def _face_crop_paths(face_ids: Sequence[int]) -> List[Path]:
    from engine.services.face_recognition_service import get_face_thumbnails_dir

    faces_dir = get_face_thumbnails_dir()
    return [faces_dir / f"{face_id}.webp" for face_id in face_ids]


def decrypt_vault_details(row: aiosqlite.Row, mvk: bytes) -> dict:
    """Document text and GPS of a vault photo for display while the vault is open.

    Returns empty values if the photo has no sealed details (or they can't be read).
    """
    blob = row["vault_meta_enc"] if "vault_meta_enc" in row.keys() else None
    if not blob:
        return {k: None for k in _SENSITIVE_FIELDS}
    try:
        return decrypt_photo_metadata(blob, mvk, row["id"])
    except Exception as err:
        logger.warning("Could not read sealed details of vault photo %s: %s", row["id"], err)
        return {k: None for k in _SENSITIVE_FIELDS}


async def flush_deleted_data(conn: aiosqlite.Connection) -> None:
    """Moves committed changes out of the write-ahead log so old values don't linger there.

    With ``secure_delete`` on, freed pages are zeroed when the WAL is checkpointed.
    Best effort: a busy reader can postpone it until the next checkpoint.
    """
    try:
        await conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    except Exception as err:
        logger.debug("WAL checkpoint postponed: %s", err)


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

    # C4: document text + GPS are sealed with the vault key; this photo's face
    # records are dropped (only this photo's; library faces are untouched).
    details, face_ids = await _read_sensitive_details(conn, photo_id)
    sealed_details = await asyncio.to_thread(encrypt_photo_metadata, details, mvk, photo_id)
    face_crops = _face_crop_paths(face_ids)

    await _journal_start(conn, photo_id, "lock", pairs, face_crops)
    done: List[FilePair] = []
    try:
        for pair in pairs:
            # H7: whole-file encryption runs off the event loop so the app stays responsive.
            await asyncio.to_thread(encrypt_and_verify, pair, mvk)
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
            vault_type = 'private',
            vault_meta_enc = ?,
            ocr_text = NULL, latitude = NULL, longitude = NULL
        WHERE id = ?;
        """,
        (
            to_db_path(main.enc),
            to_db_path(thumb.enc) if thumb else None,
            to_db_path(preview.enc) if preview else None,
            sealed_details,
            photo_id,
        ),
    )
    await conn.execute("DELETE FROM faces WHERE photo_id = ?;", (photo_id,))
    await conn.commit()

    for pair in pairs:
        _safe_unlink(pair.plain)
    for crop in face_crops:
        _safe_unlink(crop)
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

    # C4: open the sealed document text + GPS first; if that fails, nothing changes.
    async with conn.execute("SELECT vault_meta_enc FROM photos WHERE id = ?;", (photo_id,)) as cur:
        sealed = (await cur.fetchone())["vault_meta_enc"]
    details = {k: None for k in _SENSITIVE_FIELDS}
    if sealed:
        try:
            details = decrypt_photo_metadata(sealed, mvk, photo_id)
        except Exception as err:
            raise VaultAssetError(f"Could not read the sealed details of photo {photo_id}: {err}") from err

    await _journal_start(conn, photo_id, "unlock", pairs)
    done: List[FilePair] = []
    try:
        for pair in pairs:
            await asyncio.to_thread(decrypt_to_file, pair, mvk)  # H7: off the event loop.
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
            vault_type = NULL,
            vault_meta_enc = NULL,
            ocr_text = ?, latitude = ?, longitude = ?,
            faces_scanned = 0
        WHERE id = ?;
        """,
        (
            to_db_path(main.plain),
            to_db_path(thumb.plain) if thumb else None,
            to_db_path(preview.plain) if preview else None,
            details.get("ocr_text"),
            details.get("latitude"),
            details.get("longitude"),
            photo_id,
        ),
    )
    await conn.commit()

    for pair in pairs:
        _safe_unlink(pair.enc)
    await _journal_end(conn, photo_id)
    return True


async def enhance_vault_photo(
    conn: aiosqlite.Connection,
    row: aiosqlite.Row,
    mvk: bytes,
    avif_quality: int,
    still_unlocked: Callable[[], bool],
) -> bool:
    """Enhances one vault photo without ever writing unencrypted data to disk (C7).

    Steps: decrypt into memory -> enhance + encode AVIF in memory -> encrypt into a
    new ``.avif.enc`` (temp, fsync, replace) -> verify it decrypts to the same
    bytes -> if the vault is still unlocked, point the row at it and commit ->
    delete the old ``.enc``. Journaled like lock/unlock, so a crash at any point
    leaves exactly the copy the row points at.

    Args:
        conn: Open connection with no uncommitted changes.
        row: Row with ``id`` and ``filepath`` of an encrypted photo.
        mvk: Master vault key (read without counting as user activity).
        avif_quality: AVIF quality from the Settings slider.
        still_unlocked: Called right before committing; if it returns False the
            enhanced copy is discarded and the original stays as it is.

    Returns:
        True if the photo was replaced by its enhanced version.

    Raises:
        VaultAssetError: Decrypt/enhance/encrypt failed; the photo is unchanged.
    """
    import hashlib as _hashlib

    from engine.services.enhancement_service import render_enhanced_avif

    photo_id = row["id"]
    old_enc = resolve_stored_path(row["filepath"])
    if old_enc is None or old_enc.suffix != ENC_SUFFIX:
        return False

    plain_name = old_enc.name[: -len(ENC_SUFFIX)]
    new_plain_name = os.path.splitext(plain_name)[0] + ".avif"
    new_enc = _unique_path(old_enc.with_name(new_plain_name + ENC_SUFFIX))
    pair = FilePair(plain=old_enc, enc=new_enc)  # Journal convention for "enhance": plain=old, enc=new.

    try:
        data = await asyncio.to_thread(decrypt_file_to_bytes, old_enc, mvk)
        avif, width, height = await asyncio.to_thread(render_enhanced_avif, data, avif_quality)
        del data
    except Exception as err:
        raise VaultAssetError(f"Could not enhance vault photo {photo_id}: {err}") from err

    await _journal_start(conn, photo_id, "enhance", [pair])
    try:
        await asyncio.to_thread(encrypt_file_chunked, avif, new_enc, mvk)
        expected = _hashlib.sha256(avif).hexdigest()
        if await asyncio.to_thread(_sha256_decrypted, new_enc, mvk) != expected:
            raise VaultAssetError(f"Enhanced copy of vault photo {photo_id} failed verification.")
    except Exception as err:
        _safe_unlink(new_enc)
        _safe_unlink(_enc_temp(new_enc))
        await _journal_end(conn, photo_id)
        if isinstance(err, VaultAssetError):
            raise
        raise VaultAssetError(f"Could not save enhanced vault photo {photo_id}: {err}") from err

    if not still_unlocked():
        # The vault locked while this photo was being processed: respect it.
        _safe_unlink(new_enc)
        await _journal_end(conn, photo_id)
        return False

    await conn.execute(
        """
        UPDATE photos
        SET filepath = ?, filename = ?, mime_type = 'image/avif',
            original_file_size = COALESCE(original_file_size, file_size),
            original_file_hash = COALESCE(original_file_hash, file_hash),
            file_hash = ?, file_size = ?, width = ?, height = ?,
            is_optimized = 1, is_enhanced = 1
        WHERE id = ? AND is_encrypted = 1;
        """,
        (to_db_path(new_enc), new_plain_name, expected, len(avif), width, height, photo_id),
    )
    await conn.commit()
    _safe_unlink(old_enc)
    await _journal_end(conn, photo_id)
    return True


async def lock_photos(conn: aiosqlite.Connection, rows: Iterable[aiosqlite.Row], mvk: bytes) -> Tuple[List[int], List[int]]:
    """Locks several photos, one at a time, continuing past individual failures.

    Returns:
        (locked_ids, failed_ids). Photos whose original file is missing are in neither.
    """
    locked, failed = [], []
    async with vault_files():  # H7: one vault operation at a time (a repeat becomes a no-op).
        for row in rows:
            try:
                if await lock_photo(conn, row, mvk):
                    locked.append(row["id"])
            except VaultAssetError as err:
                logger.error("Vault lock failed for photo %s: %s", row["id"], err)
                failed.append(row["id"])
        if locked:
            await flush_deleted_data(conn)
    return locked, failed


async def unlock_photos(conn: aiosqlite.Connection, rows: Iterable[aiosqlite.Row], mvk: bytes) -> Tuple[List[int], List[int]]:
    """Unlocks several photos, one at a time, continuing past individual failures.

    Returns:
        (unlocked_ids, failed_ids). Photos whose encrypted file is missing are in neither.
    """
    unlocked, failed = [], []
    async with vault_files():  # H7: one vault operation at a time.
        for row in rows:
            try:
                if await unlock_photo(conn, row, mvk):
                    unlocked.append(row["id"])
            except VaultAssetError as err:
                logger.error("Vault unlock failed for photo %s: %s", row["id"], err)
                failed.append(row["id"])
        if unlocked:
            await flush_deleted_data(conn)
    return unlocked, failed


# ── Vault erase (factory reset) ───────────────────────────────────────────────

_VAULT_PHOTOS_SQL = "SELECT id FROM photos WHERE is_encrypted = 1"


async def count_vault_contents(conn: aiosqlite.Connection) -> dict:
    """Counts what a vault reset would erase.

    Returns:
        ``{"photo_count": int, "album_count": int}``.
    """
    async with conn.execute(f"SELECT COUNT(*) FROM ({_VAULT_PHOTOS_SQL});") as cur:
        photo_count = (await cur.fetchone())[0]
    async with conn.execute("SELECT COUNT(*) FROM albums WHERE is_vault = 1;") as cur:
        album_count = (await cur.fetchone())[0]
    return {"photo_count": photo_count, "album_count": album_count}


async def erase_vault_contents(conn: aiosqlite.Connection) -> dict:
    """Permanently deletes every vault photo, its files, face crops and the vault albums.

    Files are deleted first, rows afterwards in one transaction. If the process
    dies part-way, the rows still exist (pointing at already-deleted files) and
    running the erase again finishes the job, so it is safe to repeat.

    The caller deletes the vault keys (``vault_configs``) in the same commit, so
    keys disappear only once nothing encrypted is left.

    Args:
        conn: Open connection with no uncommitted changes.

    Returns:
        ``{"photo_count": int, "album_count": int}`` that were erased. The
        transaction is left open; the caller commits.
    """
    from engine.services.face_recognition_service import get_face_thumbnails_dir

    counts = await count_vault_contents(conn)

    async with conn.execute(
        f"SELECT id, filepath, thumbnail_path, preview_path FROM photos WHERE id IN ({_VAULT_PHOTOS_SQL});"
    ) as cur:
        photos = await cur.fetchall()
    for row in photos:
        for key in ("filepath", "thumbnail_path", "preview_path"):
            found = resolve_stored_path(row[key])
            if found is not None:
                _safe_unlink(found)

    faces_dir = get_face_thumbnails_dir()
    async with conn.execute(f"SELECT id FROM faces WHERE photo_id IN ({_VAULT_PHOTOS_SQL});") as cur:
        face_ids = [r["id"] for r in await cur.fetchall()]
    for face_id in face_ids:
        _safe_unlink(faces_dir / f"{face_id}.webp")

    # Faces, album links and duplicate entries cascade from the photos rows.
    await conn.execute(f"DELETE FROM vault_pending_ops WHERE photo_id IN ({_VAULT_PHOTOS_SQL});")
    await conn.execute(f"DELETE FROM photos WHERE id IN ({_VAULT_PHOTOS_SQL});")
    await conn.execute("DELETE FROM albums WHERE is_vault = 1;")
    return counts


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
        async with conn.execute("SELECT photo_id, operation, file_pairs, cleanup_paths FROM vault_pending_ops;") as cursor:
            entries = await cursor.fetchall()

        for entry in entries:
            photo_id = entry["photo_id"]
            async with conn.execute("SELECT is_encrypted, filepath FROM photos WHERE id = ?;", (photo_id,)) as cursor:
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
                if entry["operation"] == "enhance":
                    # Both are encrypted (old and enhanced copy): keep the one the row points at.
                    keep, drop = (enc, plain) if photo["filepath"] == enc_s else (plain, enc)
                else:
                    keep, drop = (enc, plain) if photo["is_encrypted"] else (plain, enc)
                if keep.is_file() and drop.is_file() and not await _is_referenced_elsewhere(conn, photo_id, drop):
                    logger.info("Vault recovery: removing leftover %s (photo %s)", drop, photo_id)
                    _safe_unlink(drop)

            # Face crops of a lock that committed must not survive (C4).
            if photo is not None and photo["is_encrypted"] and entry["cleanup_paths"]:
                try:
                    for stored in json.loads(entry["cleanup_paths"]):
                        _safe_unlink(_path_from_journal(stored))
                except (ValueError, TypeError):
                    logger.error("Unreadable cleanup list for photo %s.", photo_id)

            await conn.execute("DELETE FROM vault_pending_ops WHERE photo_id = ?;", (photo_id,))
            await conn.commit()
            processed += 1
    finally:
        if own_conn:
            await conn.close()

    if processed:
        logger.info("Vault recovery finished %d interrupted operation(s).", processed)
    return processed
