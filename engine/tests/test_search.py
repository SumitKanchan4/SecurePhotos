"""Automated Test Suite for FTS5 Full-Text & Smart Categorical Search Engine."""

import pytest
from httpx import ASGITransport, AsyncClient
from engine.main import app
from engine.database import get_db_connection


@pytest.mark.asyncio
async def test_search_empty_query():
    """Verifies that empty query returns default category suggestions without errors."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/api/search?q=")
        assert res.status_code == 200
        data = res.json()
        assert data["total_photos"] == 0
        assert data["photos"] == []
        assert len(data["suggestions"]) > 0
        assert "Favorites" in data["suggestions"]


@pytest.mark.asyncio
async def test_search_fts5_and_ocr_matching():
    """Verifies that FTS5 accurately matches captions, filenames, and OCR text."""
    conn = await get_db_connection()
    photo_id = None
    try:
        cursor = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, caption, ocr_text, taken_at, is_encrypted)
            VALUES ('hawaiian_sunset_special.jpg', 'C:/dummy/hawaii.jpg', 1024, 'image/jpeg',
                    'A breathtaking Maui beach golden hour', 'Airport Gate 14 boarding pass Honolulu', '2024-07-15 18:30:00', 0);
            """
        )
        photo_id = cursor.lastrowid
        await conn.commit()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # 1. Search by caption keyword
            res1 = await client.get("/api/search?q=Maui")
            assert res1.status_code == 200
            data1 = res1.json()
            matching_ids = [p["id"] for p in data1["photos"]]
            assert photo_id in matching_ids
            # Verify match reason
            target = next(p for p in data1["photos"] if p["id"] == photo_id)
            assert "Caption" in (target["match_reason"] or "")

            # 2. Search by OCR document text
            res2 = await client.get("/api/search?q=Honolulu")
            assert res2.status_code == 200
            data2 = res2.json()
            matching_ids2 = [p["id"] for p in data2["photos"]]
            assert photo_id in matching_ids2
            target2 = next(p for p in data2["photos"] if p["id"] == photo_id)
            assert "OCR" in (target2["match_reason"] or "")

            # 3. Prefix search (e.g. "hawa" should match "hawaiian_sunset_special")
            res3 = await client.get("/api/search?q=hawa")
            assert res3.status_code == 200
            data3 = res3.json()
            matching_ids3 = [p["id"] for p in data3["photos"]]
            assert photo_id in matching_ids3

    finally:
        if photo_id:
            await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
            await conn.commit()
        await conn.close()


@pytest.mark.asyncio
async def test_search_zero_leak_vault_isolation():
    """CRITICAL SECURITY: Verifies encrypted vault photos are NEVER returned in public search."""
    conn = await get_db_connection()
    vault_photo_id = None
    try:
        cursor = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, caption, ocr_text, is_encrypted, vault_type)
            VALUES ('classified_topsecret_vault_doc.jpg', 'C:/dummy/vault.enc', 2048, 'image/jpeg',
                    'Secret confidential government memorandum', 'Top Secret Code 998877', 1, 'private');
            """
        )
        vault_photo_id = cursor.lastrowid
        await conn.commit()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.get("/api/search?q=topsecret")
            assert res.status_code == 200
            data = res.json()
            matching_ids = [p["id"] for p in data["photos"]]
            assert vault_photo_id not in matching_ids, "SECURITY REGRESSION: Encrypted vault photo leaked in search!"

            res_ocr = await client.get("/api/search?q=998877")
            assert res_ocr.status_code == 200
            data_ocr = res_ocr.json()
            matching_ocr_ids = [p["id"] for p in data_ocr["photos"]]
            assert vault_photo_id not in matching_ocr_ids, "SECURITY REGRESSION: Encrypted vault OCR leaked in search!"

    finally:
        if vault_photo_id:
            await conn.execute("DELETE FROM photos WHERE id = ?;", (vault_photo_id,))
            await conn.commit()
        await conn.close()


@pytest.mark.asyncio
async def test_search_zero_leak_trash_isolation():
    """Verifies that soft-deleted photos are NEVER returned in public search."""
    conn = await get_db_connection()
    trashed_id = None
    try:
        cursor = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, caption, is_encrypted, trashed_at)
            VALUES ('deleted_junk_recycle.jpg', 'C:/dummy/junk.jpg', 1024, 'image/jpeg',
                    'Old discarded picture of a bicycle', 0, CURRENT_TIMESTAMP);
            """
        )
        trashed_id = cursor.lastrowid
        await conn.commit()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.get("/api/search?q=bicycle")
            assert res.status_code == 200
            data = res.json()
            matching_ids = [p["id"] for p in data["photos"]]
            assert trashed_id not in matching_ids, "REGRESSION: Trashed photo leaked in search results!"

    finally:
        if trashed_id:
            await conn.execute("DELETE FROM photos WHERE id = ?;", (trashed_id,))
            await conn.commit()
        await conn.close()


@pytest.mark.asyncio
async def test_search_matching_albums_and_people():
    """Verifies parallel retrieval of matching albums and recognized individuals."""
    conn = await get_db_connection()
    album_id = None
    person_id = None
    test_photo_id = None
    test_face_id = None
    try:
        cursor1 = await conn.execute(
            "INSERT INTO albums (name, description, is_vault) VALUES ('Iceland Glaciers Adventure', 'Volcanoes and ice caves', 0);"
        )
        album_id = cursor1.lastrowid

        cursor2 = await conn.execute(
            "INSERT INTO persons (name, relationship_type, is_close_one) VALUES ('Elena Rostova', 'Colleague', 1);"
        )
        person_id = cursor2.lastrowid

        # Insert active photo and link face to Elena
        p_cur = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, is_encrypted, trashed_at)
            VALUES ('elena_test.jpg', 'C:\\mock\\elena_test.jpg', 1024, 'image/jpeg', 0, NULL)
            RETURNING id;
            """
        )
        test_photo_id = (await p_cur.fetchone())[0]

        f_cur = await conn.execute(
            """
            INSERT INTO faces (photo_id, person_id, cluster_id, box_x, box_y, box_w, box_h, quality_score, embedding)
            VALUES (?, ?, 'cluster_elena', 0.1, 0.1, 0.2, 0.2, 0.9, '[]')
            RETURNING id;
            """,
            (test_photo_id, person_id),
        )
        test_face_id = (await f_cur.fetchone())[0]
        await conn.commit()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res_album = await client.get("/api/search?q=Glaciers")
            assert res_album.status_code == 200
            data_album = res_album.json()
            album_matches = [a["name"] for a in data_album["albums"]]
            assert "Iceland Glaciers Adventure" in album_matches

            res_person = await client.get("/api/search?q=Elena")
            assert res_person.status_code == 200
            data_person = res_person.json()
            people_matches = [p["name"] for p in data_person["people"]]
            assert "Elena Rostova" in people_matches

    finally:
        if test_face_id:
            await conn.execute("DELETE FROM faces WHERE id = ?;", (test_face_id,))
        if test_photo_id:
            await conn.execute("DELETE FROM photos WHERE id = ?;", (test_photo_id,))
        if album_id:
            await conn.execute("DELETE FROM albums WHERE id = ?;", (album_id,))
        if person_id:
            await conn.execute("DELETE FROM persons WHERE id = ?;", (person_id,))
        await conn.commit()
        await conn.close()


@pytest.mark.asyncio
async def test_keyword_searches_filter_instead_of_matching_text():
    """'videos', 'favourites', a year or a month pick a filter; they are not text to find (R9c)."""
    conn = await get_db_connection()
    rows = [
        ("r9c_clip_a.mp4", "video/mp4", 0, "2024-03-02 10:00:00", None),
        ("r9c_clip_b.mp4", "video/mp4", 1, "2025-05-09 10:00:00", None),
        ("r9c_goa_beach.jpg", "image/jpeg", 1, "2025-05-10 10:00:00", "Sunset at Goa beach"),
        ("r9c_cat.jpg", "image/jpeg", 0, "2025-01-01 10:00:00", "A sleeping cat"),
    ]
    try:
        for name, mime, fav, taken, caption in rows:
            await conn.execute(
                "INSERT INTO photos (filename, filepath, file_size, mime_type, is_favorite, taken_at, caption, is_encrypted) "
                "VALUES (?, ?, 100, ?, ?, ?, ?, 0);",
                (name, f"C:/dummy/{name}", mime, fav, taken, caption),
            )
        await conn.commit()

        async def names(q):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                res = await client.get("/api/search", params={"q": q, "limit": 200})
            assert res.status_code == 200
            return sorted(p["filename"] for p in res.json()["photos"] if p["filename"].startswith("r9c_"))

        assert await names("videos") == ["r9c_clip_a.mp4", "r9c_clip_b.mp4"]
        assert await names("Favourites") == ["r9c_clip_b.mp4", "r9c_goa_beach.jpg"]
        assert await names("favorites") == ["r9c_clip_b.mp4", "r9c_goa_beach.jpg"]
        assert await names("2025") == ["r9c_cat.jpg", "r9c_clip_b.mp4", "r9c_goa_beach.jpg"]
        assert await names("videos from 2024") == ["r9c_clip_a.mp4"]
        assert await names("photos of goa in may") == ["r9c_goa_beach.jpg"]
        assert await names("cat") == ["r9c_cat.jpg"]
    finally:
        await conn.execute("DELETE FROM photos WHERE filename LIKE 'r9c_%';")
        await conn.commit()
        await conn.close()
