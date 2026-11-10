"""Pytest configuration for the SecurePhotos engine.

Test isolation (backlog item Q6): every test run gets its own throwaway data
folder and home folder, set *before* anything from ``engine`` is imported,
because ``engine.config.settings`` resolves the data folder once at import.
The run aborts if the data folder is ever the project's real ``data/`` library,
so tests can never read, change or erase a developer's photos.
"""

import os
import shutil
import tempfile
from pathlib import Path

# ── Isolation: must run before any `engine` import ───────────────────────────
_TEST_ROOT = Path(tempfile.mkdtemp(prefix="securephotos_tests_"))
_TEST_DATA_DIR = _TEST_ROOT / "data"
_TEST_HOME = _TEST_ROOT / "home"
_TEST_DATA_DIR.mkdir()
_TEST_HOME.mkdir()

os.environ["SECUREPHOTOS_DATA_DIR"] = str(_TEST_DATA_DIR)
# Point the home folder away from the real one too: engine.config's legacy
# migration copies and then deletes ~/.securephotos_data if it exists.
os.environ["USERPROFILE"] = str(_TEST_HOME)
os.environ["HOME"] = str(_TEST_HOME)

import asyncio  # noqa: E402
import sqlite3  # noqa: E402

import pytest  # noqa: E402

from engine.config import settings  # noqa: E402

_REAL_LIBRARY = (Path(__file__).resolve().parents[2] / "data").resolve()
if settings.data_dir.resolve() != _TEST_DATA_DIR.resolve() or settings.data_dir.resolve() == _REAL_LIBRARY:
    shutil.rmtree(_TEST_ROOT, ignore_errors=True)
    raise pytest.UsageError(
        f"Refusing to run tests: data folder is {settings.data_dir}, expected the throwaway "
        f"folder {_TEST_DATA_DIR}. Tests must never touch the real library."
    )

from engine.database import run_migrations  # noqa: E402
from engine.services.video_queue_service import pause_video_queue  # noqa: E402

# Fresh library: create the schema once so tests that don't migrate still find their tables.
asyncio.run(run_migrations())


def pytest_sessionfinish(session, exitstatus):
    """Deletes the throwaway library after the run."""
    shutil.rmtree(_TEST_ROOT, ignore_errors=True)


@pytest.fixture(autouse=True)
def isolate_video_queue_during_tests():
    """Keeps the background video queue paused and clears leftover queue items.

    Pausing prevents the worker racing tests that create queue items; leftover
    items whose photo is gone or trashed are deleted after each test.
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
        except sqlite3.Error:
            pass
