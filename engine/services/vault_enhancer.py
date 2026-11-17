"""Background enhancement of vault photos while the vault is open (backlog C7).

Owner decision (2026-11-11): vault photos get the same single-version
enhancement as library photos, but only while the vault is unlocked; while it is
locked nothing is processed and the encrypted original stays as it is. Nothing
unencrypted is ever written to disk (see ``vault_storage.enhance_vault_photo``).

The vault key is read with ``peek_active_mvk``, which never counts as user
activity, so this work cannot keep the vault from auto-locking.
"""

import asyncio
import logging
from typing import Any, Dict, Optional

from engine.database import get_db_connection
from engine.services.work_queues import vault_files

logger = logging.getLogger("securephotos.vault_enhancer")

BATTERY_RECHECK_SECONDS = 30

vault_enhancement_state: Dict[str, Any] = {
    "is_active": False,
    "completed_count": 0,
    "total_count": 0,
    "paused_reason": None,  # "on_battery"
}

_task: Optional[asyncio.Task] = None


def start_vault_enhancement() -> None:
    """Starts the background run if it isn't already running (needs a running event loop)."""
    global _task
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(run_vault_enhancement())


def _key() -> Optional[bytes]:
    from engine.api.vault import peek_active_mvk

    return peek_active_mvk()


async def _wait_for_power() -> bool:
    """Waits while the battery guard applies. Returns False if the vault locked meanwhile."""
    from engine.api import photos as photos_api

    while True:
        settings = await photos_api._load_enhancement_settings()
        if not photos_api.battery_guard_applies(settings):
            vault_enhancement_state["paused_reason"] = None
            return True
        vault_enhancement_state["paused_reason"] = "on_battery"
        if _key() is None:
            return False
        await asyncio.sleep(BATTERY_RECHECK_SECONDS)


async def run_vault_enhancement() -> Dict[str, Any]:
    """Enhances not-yet-enhanced vault photos one at a time while the vault stays open."""
    from engine.services import vault_storage
    from engine.services.enhancement_service import DEFAULT_QUALITY_SLIDER, slider_to_avif_quality
    from engine.api import photos as photos_api

    state = vault_enhancement_state
    if _key() is None:
        return {"status": "vault_locked"}

    state.update(is_active=True, completed_count=0, total_count=0, paused_reason=None)
    enhanced = 0
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT id, filepath FROM photos
            WHERE is_encrypted = 1 AND is_optimized = 0 AND trashed_at IS NULL
              AND (mime_type IS NULL OR mime_type NOT LIKE 'video/%')
            ORDER BY id ASC;
            """
        ) as cur:
            rows = await cur.fetchall()
        state["total_count"] = len(rows)

        from engine.services import cpu_budget

        for row in rows:
            if not await _wait_for_power():
                break
            settings = await photos_api._load_enhancement_settings()
            quality = slider_to_avif_quality(settings.get("quality_crf", DEFAULT_QUALITY_SLIDER))
            key = None
            try:
                # One heavy job at a time (after-import plan, D2). The key is taken only once the
                # slot is ours, so a vault locked meanwhile is noticed before any work starts.
                async with cpu_budget.heavy(cpu_budget.BACKGROUND, f"vault:{row['id']}"), vault_files():  # H7 too.
                    key = _key()
                    if key is None:
                        logger.info("Vault locked; vault photo enhancement stops until the next unlock.")
                        break
                    was_enhanced = await vault_storage.enhance_vault_photo(conn, row, key, quality, lambda: _key() is not None)
                if was_enhanced:
                    enhanced += 1
                elif _key() is None:
                    break
            except vault_storage.VaultAssetError as err:
                logger.warning("%s", err)
                # Don't retry an unreadable photo on every unlock.
                await conn.execute("UPDATE photos SET is_optimized = 1 WHERE id = ?;", (row["id"],))
                await conn.commit()
            finally:
                del key
            state["completed_count"] += 1
            await asyncio.sleep(0)
    finally:
        await conn.close()
        state.update(is_active=False, paused_reason=None)
    if enhanced:
        logger.info("Enhanced %d vault photo(s).", enhanced)
    return {"status": "done", "enhanced": enhanced}
