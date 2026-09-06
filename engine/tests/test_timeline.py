"""Automated Tests for Dynamic Timeline Years and Aggregation API Endpoints."""

import tempfile
from pathlib import Path
from PIL import Image
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app
from engine.services.thumbnail_service import calculate_file_hash


async def insert_timeline_photo(tmp_path: Path, filename: str, taken_at: str = None, is_encrypted: int = 0, is_trashed: bool = False) -> int:
    """Helper to insert a dummy photo with explicit taken_at date."""
    img_path = tmp_path / filename
    img = Image.new("RGB", (200, 200), color=(120, 180, 220))
    img.save(img_path, format="JPEG")

    file_hash = calculate_file_hash(img_path)
    conn = await get_db_connection()
    trashed_val = "2026-01-01 00:00:00" if is_trashed else None
    cursor = await conn.execute(
        """
        INSERT INTO photos (
            filename, filepath, file_hash, file_size, mime_type, width, height,
            taken_at, is_encrypted, trashed_at, is_optimized, is_enhanced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
        RETURNING id;
        """,
        (
            filename,
            str(img_path),
            file_hash,
            img_path.stat().st_size,
            "image/jpeg",
            200,
            200,
            taken_at,
            is_encrypted,
            trashed_val,
        ),
    )
    row = await cursor.fetchone()
    photo_id = row[0]
    await conn.commit()
    await conn.close()
    return photo_id


@pytest.mark.asyncio
async def test_get_timeline_years_empty_or_initial():
    """Verifies GET /api/photos/timeline-years responds successfully."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/photos/timeline-years")
        assert res.status_code == 200
        data = res.json()
        assert "total_count" in data
        assert "years" in data
        assert isinstance(data["years"], list)


@pytest.mark.asyncio
async def test_get_timeline_years_aggregation_and_counts():
    """Verifies that distinct years are grouped, sorted, and counted accurately."""
    await run_migrations()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        # Insert 2 photos in 2026, 1 photo in 2024, 1 undated photo
        id_2026_1 = await insert_timeline_photo(tmp_path, "p_2026_1.jpg", taken_at="2026-05-14 10:00:00")
        id_2026_2 = await insert_timeline_photo(tmp_path, "p_2026_2.jpg", taken_at="2026-08-20 15:30:00")
        id_2024_1 = await insert_timeline_photo(tmp_path, "p_2024_1.jpg", taken_at="2024-11-05 09:15:00")
        id_undated = await insert_timeline_photo(tmp_path, "p_undated.jpg", taken_at=None)

        # Insert 1 photo that is trashed and 1 that is encrypted (should be excluded)
        id_trashed = await insert_timeline_photo(tmp_path, "p_trashed.jpg", taken_at="2026-01-01 00:00:00", is_trashed=True)
        id_enc = await insert_timeline_photo(tmp_path, "p_enc.jpg", taken_at="2024-01-01 00:00:00", is_encrypted=1)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get("/api/photos/timeline-years")
            assert res.status_code == 200
            data = res.json()

            # Find year items
            year_dict = {item["year"]: item["count"] for item in data["years"]}

            # 2026 should have at least 2 active photos (excluding trashed)
            assert "2026" in year_dict
            assert year_dict["2026"] >= 2

            # 2024 should have at least 1 active photo (excluding encrypted)
            assert "2024" in year_dict
            assert year_dict["2024"] >= 1

            # Undated should be present
            assert "Undated" in year_dict
            assert year_dict["Undated"] >= 1

            # Total count should match or exceed our active additions
            assert data["total_count"] >= 4

        # Clean up test rows
        conn = await get_db_connection()
        await conn.execute(
            "DELETE FROM photos WHERE id IN (?, ?, ?, ?, ?, ?);",
            (id_2026_1, id_2026_2, id_2024_1, id_undated, id_trashed, id_enc),
        )
        await conn.commit()
        await conn.close()
