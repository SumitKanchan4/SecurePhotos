"""Deleting a story also deletes its cached video export (found by the Q2 linter: `os` was never imported)."""

from engine.config import settings
from engine.database import get_db_connection, run_migrations
from engine.services.media_paths import to_db_path
from engine.services.stories_service import delete_story


async def test_delete_story_removes_cached_export():
    await run_migrations()
    export = settings.data_dir / "originals" / "q2_story_export.mp4"
    export.parent.mkdir(parents=True, exist_ok=True)
    export.write_bytes(b"fake mp4")
    conn = await get_db_connection()
    try:
        cur = await conn.execute(
            "INSERT INTO stories (title, story_type, rendered_video_path) VALUES ('Trip', 'adventure', ?);",
            (to_db_path(export),),
        )
        story_id = cur.lastrowid
        await conn.commit()
    finally:
        await conn.close()

    assert await delete_story(story_id) is True  # Used to crash with NameError: name 'os' is not defined.
    assert not export.exists()
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT 1 FROM stories WHERE id = ?;", (story_id,)) as cur:
            assert await cur.fetchone() is None
    finally:
        await conn.close()
