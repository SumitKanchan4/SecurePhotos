"""Importing straight into the private vault (owner, 2026-11-21).

Each photo is copied into the library saved as ``PENDING_VAULT`` (shown nowhere, touched by no
worker), then encrypted at once by the vault's own crash-safe lock step. Only after that, and only
if asked, is the original removed from where it came from. So:

- no unencrypted copy is ever shown, scanned for faces or text, or enhanced;
- if the app stops halfway, the next start removes the half-imported copy (the original is still
  where it was, because it's removed only after encryption);
- if the vault locks during an import, the rest of the import stops; nothing is left unencrypted.

A photo that is already in the library is moved into the vault; one already in the vault is left
as it is (its original can still be removed, since an identical copy is safe in the vault).
"""

from __future__ import annotations

import asyncio
import logging
import os
import stat
from pathlib import Path
from typing import Optional

import aiosqlite

from engine.database import db_connection
from engine.services import vault_storage
from engine.services.ingestion_service import MANAGED, PENDING_VAULT, ingest_single_photo
from engine.services.media_paths import resolve_stored_path
from engine.services.work_queues import vault_files

logger = logging.getLogger("securephotos.vault_import")

# What happened to one file.
ADDED, ALREADY_IN_VAULT, SKIPPED, FAILED = "added", "already_in_vault", "skipped", "failed"


class VaultLockedError(Exception):
    """The vault locked during the import; the rest of it stops."""


def _remove_original(source: Path) -> None:
    try:
        os.chmod(source, stat.S_IWRITE)
    except OSError:
        pass
    source.unlink()
    logger.info("Removed the original after it was safely in the vault: %s", source.name)


async def import_one(conn: aiosqlite.Connection, source: Path, mvk: Optional[bytes], remove_original: bool) -> str:
    """Brings one file into the vault. Returns ADDED, ALREADY_IN_VAULT, SKIPPED or FAILED.

    Raises:
        VaultLockedError: The vault is locked (``mvk`` is None); nothing was changed.
    """
    if mvk is None:
        raise VaultLockedError()
    photo_id, is_new = await ingest_single_photo(conn, source, mode=MANAGED, return_is_new=True, into_vault=True)
    if not photo_id:
        return SKIPPED
    async with conn.execute(
        "SELECT id, filepath, thumbnail_path, preview_path, is_encrypted, trashed_at FROM photos WHERE id = ?;",
        (photo_id,),
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        return FAILED
    if row["is_encrypted"] == 1:
        outcome = ALREADY_IN_VAULT
    elif row["trashed_at"] is not None:
        return SKIPPED  # The same photo is in Trash; restore it from there instead.
    else:
        try:
            async with vault_files():
                locked = await vault_storage.lock_photo(conn, row, mvk)
                if locked:
                    await vault_storage.flush_deleted_data(conn)
        except vault_storage.VaultAssetError as err:
            logger.error("Couldn't encrypt an imported photo into the vault: %s", err)
            locked = False
        if not locked:
            if is_new:
                await remove_pending(conn, photo_id)
            return FAILED
        outcome = ADDED
    if remove_original:
        try:
            await asyncio.to_thread(_remove_original, source)
        except OSError as err:
            logger.warning("The original couldn't be removed (it is safe in the vault): %s", err)
    return outcome


async def remove_pending(conn: aiosqlite.Connection, photo_id: int) -> None:
    """Removes a photo that never made it into the vault: its library copies and its row."""
    async with conn.execute(
        "SELECT filepath, thumbnail_path, preview_path FROM photos WHERE id = ? AND is_encrypted = ?;",
        (photo_id, PENDING_VAULT),
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        return
    for stored in row:
        path = resolve_stored_path(stored)  # Only files inside the library; never a guess.
        if path is not None:
            try:
                path.unlink()
            except OSError as err:
                logger.warning("Couldn't remove a half-imported file %s: %s", path.name, err)
    await conn.execute("DELETE FROM photos WHERE id = ? AND is_encrypted = ?;", (photo_id, PENDING_VAULT))
    await conn.commit()


async def undo_interrupted_imports() -> int:
    """At start-up: removes photos left half-way into the vault by a stop or a crash.

    Their originals are still where they came from (they're removed only after encryption), so
    nothing is lost; the user imports them again. Returns how many were removed.
    """
    async with db_connection() as conn:
        async with conn.execute("SELECT id FROM photos WHERE is_encrypted = ?;", (PENDING_VAULT,)) as cur:
            ids = [r[0] for r in await cur.fetchall()]
        for photo_id in ids:
            await remove_pending(conn, photo_id)
    if ids:
        logger.info("Removed %d photo(s) left half-way into the vault; their originals are untouched.", len(ids))
    return len(ids)
