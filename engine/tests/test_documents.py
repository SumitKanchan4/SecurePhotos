"""Automated Unit & Integration Tests for Document Intelligence & Categorization API."""

import uuid
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import get_db_connection, run_migrations
from engine.main import app


@pytest.mark.asyncio
async def test_documents_lifecycle_and_categorization():
    """Verifies listing, scanning, filtering, and updating documents."""
    await run_migrations()
    transport = ASGITransport(app=app)
    uid = uuid.uuid4().hex[:8]

    test_ids = []
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Clean slate check: documents endpoint returns list
        res_initial = await client.get("/api/documents")
        assert res_initial.status_code == 200
        assert isinstance(res_initial.json(), list)

        # 2. Insert test items into database directly
        conn = await get_db_connection()
        try:
            # Item A: Receipt
            cursor = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, taken_at, is_document, content_tags, ocr_text)
                VALUES (?, ?, 1024, 'image/jpeg', '2026-03-10', 1, 'receipt', 'TARGET STORE TOTAL $42.50 VISA DEBIT');
                """,
                (f"grocery_receipt_target_{uid}.jpg", f"data/originals/receipt_{uid}.jpg"),
            )
            receipt_id = cursor.lastrowid
            test_ids.append(receipt_id)

            # Item B: Tax Form
            cursor = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, taken_at, is_document, content_tags, ocr_text)
                VALUES (?, ?, 2048, 'application/pdf', '2026-04-15', 1, 'tax', 'Department of Treasury Internal Revenue Service Form 1040');
                """,
                (f"irs_form_1040_tax_return_{uid}.pdf", f"data/originals/tax_return_{uid}.pdf"),
            )
            tax_id = cursor.lastrowid
            test_ids.append(tax_id)

            # Item C: Passport / ID
            cursor = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, taken_at, is_document, content_tags, ocr_text)
                VALUES (?, ?, 4096, 'image/png', '2025-08-20', 1, 'identity', 'PASSPORT NATIONAL IDENTIFICATION CITIZEN');
                """,
                (f"official_passport_id_{uid}.png", f"data/originals/passport_{uid}.png"),
            )
            passport_id = cursor.lastrowid
            test_ids.append(passport_id)

            # Item D: Normal family photo (not a document)
            cursor = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, taken_at, is_document)
                VALUES (?, ?, 5120, 'image/jpeg', '2025-07-04', 0);
                """,
                (f"family_beach_vacation_{uid}.jpg", f"data/originals/beach_{uid}.jpg"),
            )
            photo_id = cursor.lastrowid
            test_ids.append(photo_id)

            await conn.commit()
        finally:
            await conn.close()

        try:
            # 3. Verify GET /api/documents returns the 3 documents, excluding the vacation photo
            res_docs = await client.get("/api/documents")
            assert res_docs.status_code == 200
            docs = res_docs.json()
            doc_ids = [d["id"] for d in docs]
            assert receipt_id in doc_ids
            assert tax_id in doc_ids
            assert passport_id in doc_ids
            assert photo_id not in doc_ids

            # 4. Verify Category Filter: receipt
            res_receipts = await client.get("/api/documents?category=receipt")
            assert res_receipts.status_code == 200
            receipts = res_receipts.json()
            assert any(r["id"] == receipt_id for r in receipts)

            # 5. Verify OCR Text Search: '1040'
            res_search = await client.get("/api/documents?q=1040")
            assert res_search.status_code == 200
            search_results = res_search.json()
            assert len(search_results) >= 1
            assert any(s["id"] == tax_id for s in search_results)

            # 6. Verify PATCH /api/documents/{id} to reclassify
            res_patch = await client.patch(
                f"/api/documents/{receipt_id}",
                json={"category": "tax", "title": "Business Expense Tax Write-off"}
            )
            assert res_patch.status_code == 200
            assert res_patch.json()["status"] == "success"

            # Check that receipt now shows under tax
            res_updated = await client.get("/api/documents?category=tax")
            tax_docs = res_updated.json()
            assert any(t["id"] == receipt_id for t in tax_docs)

            # 7. Verify Toggle Document Endpoint
            res_toggle = await client.post(
                f"/api/documents/{photo_id}/toggle",
                json={"is_document": True}
            )
            assert res_toggle.status_code == 200
            assert res_toggle.json()["is_document"] is True

            # Now photo_id should be in /api/documents
            res_after_toggle = await client.get("/api/documents")
            assert any(d["id"] == photo_id for d in res_after_toggle.json())
        finally:
            # Teardown test rows
            conn = await get_db_connection()
            try:
                for tid in test_ids:
                    await conn.execute("DELETE FROM photos WHERE id = ?;", (tid,))
                await conn.commit()
            finally:
                await conn.close()


@pytest.mark.asyncio
async def test_documents_scan_endpoint():
    """Verifies that the /api/documents/scan endpoint detects candidate documents."""
    transport = ASGITransport(app=app)
    uid = uuid.uuid4().hex[:8]
    candidate_id = None

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        conn = await get_db_connection()
        try:
            cursor = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, taken_at, is_document)
                VALUES (?, ?, 1500, 'image/jpeg', '2026-02-14', 0);
                """,
                (f"amazon_prime_invoice_order_{uid}.jpg", f"data/originals/invoice_{uid}.jpg"),
            )
            candidate_id = cursor.lastrowid
            await conn.commit()
        finally:
            await conn.close()

        try:
            # Call POST /api/documents/scan
            res_scan = await client.post("/api/documents/scan")
            assert res_scan.status_code == 200
            data = res_scan.json()
            assert "total_scanned" in data
            assert "newly_detected" in data
            assert data["newly_detected"] >= 1

            # Check that candidate_id is now classified
            res_docs = await client.get("/api/documents")
            cand_doc = next(d for d in res_docs.json() if d["id"] == candidate_id)
            assert cand_doc["category"] == "receipt"
        finally:
            if candidate_id:
                conn = await get_db_connection()
                try:
                    await conn.execute("DELETE FROM photos WHERE id = ?;", (candidate_id,))
                    await conn.commit()
                finally:
                    await conn.close()


@pytest.mark.asyncio
async def test_document_pin_toggle_and_top_ordering():
    """Verifies that pinning a document anchors it to the top of the collection."""
    await run_migrations()
    transport = ASGITransport(app=app)
    uid = uuid.uuid4().hex[:8]

    conn = await get_db_connection()
    try:
        # Document A: Newer date, unpinned
        cur_a = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, taken_at, is_document, content_tags, is_pinned)
            VALUES (?, ?, 1024, 'application/pdf', '2026-09-01', 1, 'legal', 0);
            """,
            (f"newer_contract_{uid}.pdf", f"data/originals/newer_{uid}.pdf"),
        )
        doc_a_id = cur_a.lastrowid

        # Document B: Older date, initially unpinned
        cur_b = await conn.execute(
            """
            INSERT INTO photos (filename, filepath, file_size, mime_type, taken_at, is_document, content_tags, is_pinned)
            VALUES (?, ?, 2048, 'application/pdf', '2025-01-01', 1, 'identity', 0);
            """,
            (f"older_passport_{uid}.pdf", f"data/originals/older_{uid}.pdf"),
        )
        doc_b_id = cur_b.lastrowid

        await conn.commit()
    finally:
        await conn.close()

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Initially, Doc A (newer) should appear before Doc B (older)
            res1 = await client.get("/api/documents")
            assert res1.status_code == 200
            docs1 = res1.json()
            ids1 = [d["id"] for d in docs1 if d["id"] in (doc_a_id, doc_b_id)]
            assert ids1 == [doc_a_id, doc_b_id]

            # 2. Pin Document B
            res_pin = await client.post(f"/api/documents/{doc_b_id}/pin")
            assert res_pin.status_code == 200
            assert res_pin.json()["is_pinned"] is True

            # 3. Verify Document B now appears FIRST, despite its older date
            res2 = await client.get("/api/documents")
            assert res2.status_code == 200
            docs2 = res2.json()
            ids2 = [d["id"] for d in docs2 if d["id"] in (doc_a_id, doc_b_id)]
            assert ids2 == [doc_b_id, doc_a_id]
            doc_b_data = next(d for d in docs2 if d["id"] == doc_b_id)
            assert doc_b_data["is_pinned"] is True

            # 4. Unpin Document B
            res_unpin = await client.post(f"/api/documents/{doc_b_id}/pin")
            assert res_unpin.status_code == 200
            assert res_unpin.json()["is_pinned"] is False

            # 5. Verify ordering reverts back
            res3 = await client.get("/api/documents")
            assert res3.status_code == 200
            docs3 = res3.json()
            ids3 = [d["id"] for d in docs3 if d["id"] in (doc_a_id, doc_b_id)]
            assert ids3 == [doc_a_id, doc_b_id]
    finally:
        conn = await get_db_connection()
        try:
            await conn.execute("DELETE FROM photos WHERE id IN (?, ?);", (doc_a_id, doc_b_id))
            await conn.commit()
        finally:
            await conn.close()


@pytest.mark.asyncio
async def test_direct_document_import(tmp_path):
    """Verifies direct ingestion of document files via POST /api/documents/import."""
    await run_migrations()
    transport = ASGITransport(app=app)

    # Create dummy test document file
    doc_file = tmp_path / "irs_tax_statement_2026.pdf"
    doc_file.write_bytes(b"%PDF-1.4 simulated tax return content for unit test")

    imported_id = None
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        try:
            res_imp = await client.post(
                "/api/documents/import",
                json={"file_paths": [str(doc_file)]},
            )
            assert res_imp.status_code == 201
            data = res_imp.json()
            assert len(data) >= 1
            imported_id = data[0]["id"]
            assert data[0]["category"] == "tax"

            # Check that it shows up in GET /api/documents
            res_get = await client.get("/api/documents?category=tax")
            assert res_get.status_code == 200
            assert any(d["id"] == imported_id for d in res_get.json())
        finally:
            if imported_id:
                conn = await get_db_connection()
                try:
                    await conn.execute("DELETE FROM photos WHERE id = ?;", (imported_id,))
                    await conn.commit()
                finally:
                    await conn.close()

