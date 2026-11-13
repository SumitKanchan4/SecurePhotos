"""Import dialog support (redesign R6): what an import would bring in, and Stop import."""

import asyncio
import tempfile
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from engine.api import photos as photos_api
from engine.database import run_migrations
from engine.main import app


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=120)


def _jpeg(path: Path, colour) -> Path:
    Image.new("RGB", (64, 48), colour).save(path, "JPEG")
    return path


@pytest.mark.asyncio
async def test_preview_counts_types_size_and_photos_already_in_the_library():
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / "Goa trip"
        (folder / "day 2").mkdir(parents=True)
        known = _jpeg(folder / "known.jpg", (200, 10, 10))
        _jpeg(folder / "new.jpg", (10, 200, 10))
        _jpeg(folder / "day 2" / "nested.jpg", (10, 10, 200))
        (folder / "clip.mp4").write_bytes(b"\x00" * 2048)
        (folder / "notes.txt").write_text("not media")

        async with _client() as client:
            # Put one of the photos in the library first.
            assert (await client.post("/api/photos/import", json={"file_paths": [str(known)]})).status_code == 201
            res = await client.post("/api/photos/import-preview", json={"source_directory": str(folder)})
            assert res.status_code == 200
            data = res.json()
            assert data["name"] == "Goa trip" and data["is_folder"] is True
            assert (data["photos"], data["videos"], data["documents"]) == (3, 1, 0)
            assert data["unsupported"] == 1
            assert data["already_in_library"] == 1
            assert data["to_import"] == 3
            expected = sum(p.stat().st_size for p in folder.rglob("*") if p.suffix in (".jpg", ".mp4"))
            assert data["total_bytes"] == expected

            single = await client.post("/api/photos/import-preview", json={"file_paths": [str(folder / "new.jpg")]})
            assert single.json()["name"] == "new.jpg" and single.json()["is_folder"] is False

            missing = await client.post("/api/photos/import-preview", json={"source_directory": str(Path(tmp) / "nope")})
            assert missing.status_code == 400


@pytest.mark.asyncio
async def test_unsupported_files_are_not_counted_as_skipped_photos():
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        _jpeg(folder / "a.jpg", (1, 2, 3))
        (folder / "readme.txt").write_text("x")
        async with _client() as client:
            data = (await client.post("/api/photos/import", json={"source_directory": str(folder)})).json()
        assert data["total_found"] == 1
        assert data["skipped"] == 0 and data["unsupported"] == 1


@pytest.mark.asyncio
async def test_stop_import_finishes_the_current_file_and_keeps_what_was_imported(monkeypatch):
    await run_migrations()
    real_ingest = photos_api.ingest_single_photo

    async def slow_ingest(*args, **kwargs):
        await asyncio.sleep(0.05)
        return await real_ingest(*args, **kwargs)

    monkeypatch.setattr(photos_api, "ingest_single_photo", slow_ingest)
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        for i in range(40):
            _jpeg(folder / f"p{i:02d}.jpg", (i * 5, 255 - i * 5, 100))
        async with _client() as client:
            assert (await client.post("/api/photos/import/cancel")).json() == {"status": "idle"}
            job = asyncio.create_task(client.post("/api/photos/import", json={"source_directory": str(folder)}))
            for _ in range(200):
                progress = (await client.get("/api/photos/import-progress")).json()
                if progress["is_active"] and progress["completed_count"] >= 3:
                    break
                await asyncio.sleep(0.02)
            assert progress["started_at"] is not None
            assert (await client.post("/api/photos/import/cancel")).json() == {"status": "stopping"}
            data = (await job).json()
            after = (await client.get("/api/photos/import-progress")).json()
        assert data["cancelled"] is True
        assert 3 <= data["imported"] < 40
        assert after["is_active"] is False and after["cancel_requested"] is False
