"""Pytest test configuration and isolation fixtures for SecurePhotos Engine."""

import pytest
import sqlite3
from engine.config import settings
from engine.services.video_queue_service import pause_video_queue, resume_video_queue


@pytest.fixture(autouse=True)
def isolate_video_queue_during_tests():
    """Automatically isolates the background video queue during all tests.
    
    1. Pauses the worker to prevent concurrency races while creating test items.
    2. Runs the test.
    3. Cleans up any leftover orphaned or test-generated queue items.
    4. Keeps background queue processing paused to prevent race conditions during loop teardown.
    """
    pause_video_queue()
    try:
        yield
    finally:
        try:
            conn = sqlite3.connect(settings.database_path)
            conn.execute(
                "DELETE FROM video_processing_queue WHERE photo_id NOT IN (SELECT id FROM photos WHERE trashed_at IS NULL);"
            )
            conn.commit()
            conn.close()
        except Exception:
            pass


@pytest.fixture(autouse=True)
def isolate_vault_configs_during_tests():
    """Automatically backs up and restores vault_configs so automated tests never erase user's vault setup."""
    saved_rows = []
    col_names = []
    try:
        conn = sqlite3.connect(settings.database_path)
        conn.row_factory = sqlite3.Row
        cur = conn.execute("SELECT * FROM vault_configs;")
        rows = cur.fetchall()
        if rows:
            col_names = [description[0] for description in cur.description]
            saved_rows = [list(r) for r in rows]
        conn.close()
    except Exception:
        pass

    try:
        yield
    finally:
        try:
            conn = sqlite3.connect(settings.database_path)
            conn.execute("DELETE FROM vault_configs;")
            if saved_rows and col_names:
                placeholders = ",".join("?" for _ in col_names)
                cols_str = ",".join(col_names)
                conn.executemany(f"INSERT INTO vault_configs ({cols_str}) VALUES ({placeholders});", saved_rows)
            conn.commit()
            conn.close()
        except Exception:
            pass

