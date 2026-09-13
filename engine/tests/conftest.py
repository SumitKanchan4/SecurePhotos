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
    4. Resumes the queue worker safely.
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
        resume_video_queue()
