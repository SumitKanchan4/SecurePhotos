"""Try again on an improved photo (T14, owner-approved mock-up 2026-11-22).

The improvement is made again from the original, with other settings (e.g. the other colour
style), and the person compares it with the copy they have now:

- **Use the new one**: the new copy takes over the current copy's details (favourite,
  caption, albums, folders, named faces, whether What to keep is still waiting), and the
  current copy goes to Trash for 30 days. **Undo** swaps them back.
- **Keep the current one**: the new result is discarded; nothing in the library changes.

Every fix the copy had is redone in one job: the colour and faded-colour fixes already take
"also sharpen faces" and "also repair scratches", so the retry is one ordinary job on the
original. The original is only read, also when it is in Trash after "Replace". The
remembered "When I keep a result" choice never applies: the person always chooses.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

import aiosqlite

from engine.services.photo_versions import KIND_ORDER

# Settings of the last run that are about that run only, never carried into a retry.
NOT_CARRIED = ("mask_in", "_mask", "strict", "keep_both", "redo_of")


def job_for(kinds: List[str]) -> Tuple[str, Dict[str, Any]]:
    """The one job that redoes ``kinds``: its kind and the "also do" switches."""
    k = set(kinds)
    if "colour" in k:
        kind = "colour"
    elif "fade" in k:
        kind = "fade"
    elif "faces" in k:
        kind = "faces"
    else:
        kind = "scratches"
    params: Dict[str, Any] = {}
    if kind in ("colour", "fade"):
        params["faces"] = "faces" in k  # Explicit: the faded-colour fix sharpens faces unless told not to.
    if kind != "scratches":
        params["scratches"] = "scratches" in k
    return kind, params


async def plan(conn: aiosqlite.Connection, copy_id: int) -> Optional[Dict[str, Any]]:
    """What Try again would do for ``copy_id``, or None when it can't be offered.

    Offered for an improved copy outside Trash whose original still exists (in the library,
    or in Trash after "Replace"); vault copies only with a vault original.
    """
    conn.row_factory = aiosqlite.Row
    async with conn.execute(
        """
        SELECT c.id, c.ai_kind, c.ai_params, c.is_encrypted, o.id AS original_id, o.is_encrypted AS original_encrypted,
               o.trashed_at AS original_trashed
        FROM photos c JOIN photos o ON o.id = c.derived_from_id
        WHERE c.id = ? AND c.trashed_at IS NULL AND c.ai_kind IS NOT NULL
          AND COALESCE(c.mime_type, '') NOT LIKE 'video/%';
        """,
        (copy_id,),
    ) as cur:
        row = await cur.fetchone()
    conn.row_factory = None
    if row is None or bool(row["is_encrypted"]) != bool(row["original_encrypted"]):
        return None
    kinds = [k for k in KIND_ORDER if k in set((row["ai_kind"] or "").split(","))]
    if not kinds:
        return None
    try:
        last = json.loads(row["ai_params"] or "{}")
    except ValueError:
        last = {}
    kind, params = job_for(kinds)
    style = last.get("style") if last.get("style") in ("natural", "vivid") else "natural"
    return {
        "copy_id": row["id"],
        "original_id": row["original_id"],
        "original_in_trash": row["original_trashed"] is not None,
        "kinds": kinds,
        "kind": kind,
        "params": params,
        "style": style if "colour" in kinds else None,
    }


def other_style(style: Optional[str]) -> str:
    """The retry starts with the colour style that wasn't used last time."""
    return "natural" if style == "vivid" else "vivid"


async def enqueue(copy_id: int, style: Optional[str] = None) -> int:
    """Queues the retry for ``copy_id`` on its original and returns the job id.

    Raises:
        ValueError: Try again doesn't fit this photo (see :func:`plan`).
    """
    from engine.database import db_connection
    from engine.services import restore_queue

    async with db_connection() as conn:
        found = await plan(conn, copy_id)
        if found is None:
            raise ValueError("Try again isn't available for this photo.")
        params = {**found["params"], "redo_of": copy_id}
        if found["kind"] == "colour":
            params["style"] = style if style in ("natural", "vivid") else other_style(found["style"])
        params_json = json.dumps(params, sort_keys=True)
        async with conn.execute(
            "SELECT id FROM restore_jobs WHERE photo_id = ? AND params = ? AND status IN ('queued', 'working');",
            (found["original_id"], params_json),
        ) as cur:
            existing = await cur.fetchone()
        if existing:
            return existing[0]
        # Straight in, not through restore_queue.enqueue: the original may be in Trash.
        cur = await conn.execute(
            "INSERT INTO restore_jobs (photo_id, kind, params, origin) VALUES (?, ?, ?, 'manual');",
            (found["original_id"], found["kind"], params_json),
        )
        job_id = cur.lastrowid
        await conn.commit()
    restore_queue._wake_worker()
    return job_id


def carried_params(params: Dict[str, Any]) -> Dict[str, Any]:
    """The settings stored with the new copy (what a later retry starts from)."""
    return {k: v for k, v in params.items() if k not in NOT_CARRIED}


async def use_new(conn: aiosqlite.Connection, job: aiosqlite.Row, staged: bytes, kind: str, key: Optional[bytes]) -> Dict[str, Any]:
    """"Use the new one": the new copy replaces the current one, which goes to Trash."""
    from engine.services import photo_versions

    params = json.loads(job["params"] or "{}")
    old_id = int(params["redo_of"])
    async with conn.execute("SELECT choice_pending FROM photos WHERE id = ?;", (old_id,)) as cur:
        old = await cur.fetchone()
    if old is None:
        raise photo_versions.VersionError("The photo you had no longer exists.")
    new_id = await photo_versions.create_version(
        conn, job["photo_id"], staged, kind, carried_params(params), key, details_from=old_id
    )
    await conn.execute("UPDATE photos SET choice_pending = ? WHERE id = ?;", (old[0] or 0, new_id))
    await photo_versions.trash_photo(conn, old_id)
    await conn.commit()
    return {"photo_id": new_id, "replaced_id": old_id}


async def undo(new_id: int, old_id: int) -> Dict[str, Any]:
    """Undo after "Use the new one": the earlier copy comes back and the new one goes to Trash.

    Raises:
        ValueError: The two photos aren't a retry and the copy it replaced.
    """
    from engine.database import db_connection
    from engine.services import photo_versions

    async with db_connection() as conn:
        async with conn.execute(
            """
            SELECT n.id FROM photos n JOIN photos o ON o.id = ?
            WHERE n.id = ? AND n.trashed_at IS NULL AND o.trashed_at IS NOT NULL
              AND n.derived_from_id IS NOT NULL AND n.derived_from_id = o.derived_from_id
              AND n.ai_kind IS NOT NULL AND o.ai_kind IS NOT NULL;
            """,
            (old_id, new_id),
        ) as cur:
            if await cur.fetchone() is None:
                raise ValueError("Nothing to undo.")
        await conn.execute("UPDATE photos SET trashed_at = NULL, trash_expires_at = NULL WHERE id = ?;", (old_id,))
        await photo_versions.trash_photo(conn, new_id)
        await conn.commit()
    return {"photo_id": old_id}
