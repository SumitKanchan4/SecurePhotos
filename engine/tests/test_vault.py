"""Automated Tests for Zero-Trust Vault Encryption, Key Wrapping & API Endpoints."""

import secrets
import tempfile
from pathlib import Path
import pytest
from httpx import ASGITransport, AsyncClient

from engine.database import run_migrations
from engine.main import app
from engine.services.crypto_vault import (
    derive_key_from_password,
    derive_key_from_recovery_phrase,
    wrap_master_key,
    unwrap_master_key,
    encrypt_file_chunked,
    decrypt_file_chunked_stream,
    decrypt_file_to_bytes,
    generate_totp_secret,
    verify_totp_code,
)


def test_argon2_and_recovery_key_derivation():
    """Verifies that Argon2id and PBKDF2 derive independent 256-bit keys."""
    salt = secrets.token_bytes(16)
    key_pass = derive_key_from_password("VaultSecret123!", salt)
    assert len(key_pass) == 32

    phrase = "apple timber ocean canyon desert mountain river breeze stone valley thunder shadow"
    key_rec = derive_key_from_recovery_phrase(phrase, salt)
    assert len(key_rec) == 32
    assert key_pass != key_rec


def test_master_key_wrapping_and_unwrapping():
    """Verifies multi-slot wrapping and unwrapping of 256-bit Master Vault Key."""
    mvk = secrets.token_bytes(32)
    salt = secrets.token_bytes(16)

    kek = derive_key_from_password("MySuperPassword", salt)
    wrapped_b64 = wrap_master_key(mvk, kek)

    # Valid unwrap
    unwrapped = unwrap_master_key(wrapped_b64, kek)
    assert unwrapped == mvk

    # Invalid password attempt (must fail cleanly)
    bad_kek = derive_key_from_password("WrongPassword", salt)
    bad_unwrap = unwrap_master_key(wrapped_b64, bad_kek)
    assert bad_unwrap is None


def test_chunked_file_encryption_and_decryption():
    """Verifies 64 KB chunked authenticated AES-256-GCM streaming encryption."""
    mvk = secrets.token_bytes(32)
    sample_data = b"Enterprise zero-trust media payload with authentications." * 5000  # ~285 KB

    with tempfile.TemporaryDirectory() as tmpdir:
        src = Path(tmpdir) / "original.jpg"
        enc = Path(tmpdir) / "original.jpg.enc"
        src.write_bytes(sample_data)

        # Encrypt file
        encrypt_file_chunked(src, enc, mvk)
        assert enc.exists()
        assert enc.stat().st_size > src.stat().st_size  # Header & tags overhead

        # Decrypt into bytes and stream chunks
        decrypted_bytes = decrypt_file_to_bytes(enc, mvk)
        assert decrypted_bytes == sample_data

        chunks = list(decrypt_file_chunked_stream(enc, mvk))
        assert len(chunks) >= 4  # Proves chunked streaming worked
        assert b"".join(chunks) == sample_data


@pytest.mark.asyncio
async def test_vault_setup_and_unlock_api():
    """Verifies /api/vault/setup and /api/vault/unlock API workflow."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Setup vault
        setup_res = await client.post(
            "/api/vault/setup",
            json={
                "password": "MasterVaultPassword99!",
                "recovery_phrase": "timber ocean canyon desert mountain river breeze stone valley thunder shadow apple",
                "password_hint": "Favorite nature words",
                "enable_totp": False,
            },
        )
        assert setup_res.status_code == 201

        # Check status
        status_res = await client.get("/api/vault/status")
        assert status_res.status_code == 200
        assert status_res.json()["is_configured"] is True

        # Unlock with valid password
        unlock_res = await client.post(
            "/api/vault/unlock",
            json={"password": "MasterVaultPassword99!"},
        )
        assert unlock_res.status_code == 200
        assert unlock_res.json()["status"] == "unlocked"
        assert "session_token" in unlock_res.json()

        # Unlock with wrong password (should fail 401)
        bad_unlock = await client.post(
            "/api/vault/unlock",
            json={"password": "IncorrectPassword!"},
        )
        assert bad_unlock.status_code == 401

        # Lock vault
        lock_res = await client.post("/api/vault/lock")
        assert lock_res.status_code == 200

        # Clean up test vault state so dev DB is not polluted
        await client.post("/api/vault/reset")


@pytest.mark.asyncio
async def test_vault_photos_crud_and_streaming_api():
    """Verifies complete photo locking, thumbnail streaming, listing, and unlocking workflow."""
    from PIL import Image
    from engine.database import get_db_connection

    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Setup and unlock vault
        await client.post(
            "/api/vault/setup",
            json={
                "password": "SecureVaultPass456!",
                "recovery_phrase": "timber ocean canyon desert mountain river breeze stone valley thunder shadow apple",
                "enable_totp": False,
            },
        )
        unlock_res = await client.post(
            "/api/vault/unlock",
            json={"password": "SecureVaultPass456!"},
        )
        assert unlock_res.status_code == 200

        with tempfile.TemporaryDirectory() as tmpdir:
            orig_path = Path(tmpdir) / "secret_document.jpg"
            thumb_path = Path(tmpdir) / "secret_document_thumb.jpg"

            # Create test image
            img = Image.new("RGB", (200, 200), color=(255, 100, 50))
            img.save(orig_path, format="JPEG")
            img.resize((64, 64)).save(thumb_path, format="JPEG")

            # Insert into photos DB table
            conn = await get_db_connection()
            cursor = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, thumbnail_path, is_encrypted, is_favorite)
                VALUES ('secret_document.jpg', ?, 1024, 'image/jpeg', ?, 0, 0);
                """,
                (str(orig_path.resolve()), str(thumb_path.resolve())),
            )
            photo_id = cursor.lastrowid
            await conn.commit()
            await conn.close()

            # 2. Lock photo into Vault
            lock_res = await client.post(
                "/api/vault/photos/lock",
                json={"photo_ids": [photo_id]},
            )
            assert lock_res.status_code == 200
            assert lock_res.json()["locked_count"] == 1

            # Verify unencrypted files removed from disk, .enc created
            assert not orig_path.exists()
            enc_orig = orig_path.with_suffix(".jpg.enc")
            assert enc_orig.exists()

            # 3. List photos in Vault
            list_res = await client.get("/api/vault/photos")
            assert list_res.status_code == 200
            vault_items = list_res.json()
            assert any(p["id"] == photo_id and p["is_encrypted"] is True for p in vault_items)

            # 4. Stream decrypted thumbnail
            thumb_res = await client.get(f"/api/vault/thumbnail/{photo_id}")
            assert thumb_res.status_code == 200
            assert thumb_res.headers["content-type"] == "image/jpeg"
            assert len(thumb_res.content) > 0

            # 5. Stream decrypted full-res media
            stream_res = await client.get(f"/api/vault/stream/{photo_id}")
            assert stream_res.status_code == 200
            assert stream_res.headers["content-type"] == "image/jpeg"
            assert len(stream_res.content) > 0

            # 6. Unlock / Restore photo back to public library
            unlock_photo_res = await client.post(
                "/api/vault/photos/unlock",
                json={"photo_ids": [photo_id]},
            )
            assert unlock_photo_res.status_code == 200
            assert unlock_photo_res.json()["unlocked_count"] == 1

            # Verify unencrypted file restored on disk and .enc removed
            assert orig_path.exists()
            assert not enc_orig.exists()

            # 7. Lock the entire vault and verify 401 gate
            await client.post("/api/vault/lock")
            unauth_res = await client.get("/api/vault/photos")
            assert unauth_res.status_code == 401

            # Clean up test vault and test photo row
            await client.post("/api/vault/reset")
            conn = await get_db_connection()
            await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
            await conn.commit()
            await conn.close()


@pytest.mark.asyncio
async def test_vault_pin_workflow_and_rate_limiting():
    """Verifies 4-digit PIN setup, rapid unlock, 5-attempt brute-force lock, and recovery unwrap."""
    await run_migrations()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Setup with Master Password and 4-digit PIN
        setup_res = await client.post(
            "/api/vault/setup",
            json={
                "password": "MasterSecretPassword789!",
                "pin": "1234",
                "recovery_phrase": "timber ocean canyon desert mountain river breeze stone valley thunder shadow apple",
                "password_hint": "Pin is 1234",
            },
        )
        assert setup_res.status_code == 201
        assert setup_res.json()["has_pin"] is True

        # Check status shows has_pin=True and is_pin_locked=False
        status_res = await client.get("/api/vault/status")
        assert status_res.status_code == 200
        assert status_res.json()["has_pin"] is True
        assert status_res.json()["is_pin_locked"] is False

        # 1. Unlock with valid PIN
        pin_unlock = await client.post(
            "/api/vault/unlock",
            json={"pin": "1234"},
        )
        assert pin_unlock.status_code == 200
        assert pin_unlock.json()["status"] == "unlocked"

        # Lock vault
        await client.post("/api/vault/lock")

        # 2. Test PIN brute-force protection (enter wrong PIN 5 times)
        for i in range(1, 6):
            wrong_res = await client.post(
                "/api/vault/unlock",
                json={"pin": "9999"},
            )
            assert wrong_res.status_code == 401
            if i < 5:
                assert f"{5 - i} attempt" in wrong_res.json()["detail"]
            else:
                assert "PIN is now locked" in wrong_res.json()["detail"]

        # Check status shows is_pin_locked=True
        locked_status = await client.get("/api/vault/status")
        assert locked_status.json()["is_pin_locked"] is True

        # 3. Attempting PIN while locked fails immediately
        locked_pin_res = await client.post(
            "/api/vault/unlock",
            json={"pin": "1234"},  # Even correct PIN is blocked
        )
        assert locked_pin_res.status_code == 401
        assert "PIN entry is locked" in locked_pin_res.json()["detail"]

        # 4. Master Password unlocks and resets the PIN lock
        pass_unlock = await client.post(
            "/api/vault/unlock",
            json={"password": "MasterSecretPassword789!"},
        )
        assert pass_unlock.status_code == 200
        assert pass_unlock.json()["status"] == "unlocked"

        # Check status: PIN lock is cleared!
        cleared_status = await client.get("/api/vault/status")
        assert cleared_status.json()["is_pin_locked"] is False

        # Lock and verify PIN works again
        await client.post("/api/vault/lock")
        pin_ok = await client.post("/api/vault/unlock", json={"pin": "1234"})
        assert pin_ok.status_code == 200

        # Clean up test vault
        await client.post("/api/vault/reset")


@pytest.mark.asyncio
async def test_album_lock_and_unlock_workflow():
    """Validates locking an entire album into the vault and decrypting it back."""
    from engine.database import get_db_connection

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Reset and setup vault
        await client.post("/api/vault/reset")
        await client.post(
            "/api/vault/setup",
            json={"password": "AlbumVaultPassword123!", "recovery_phrase": "test words phrase"},
        )
        await client.post(
            "/api/vault/unlock",
            json={"password": "AlbumVaultPassword123!"},
        )

        test_dir = Path("data/tests_scratch")
        test_dir.mkdir(parents=True, exist_ok=True)
        test_file = test_dir / "test_album_photo.jpg"
        test_file.write_bytes(b"TEST_ALBUM_IMAGE_DATA_1234567890")

        conn = await get_db_connection()
        photo_id = None
        album_id = None
        try:
            # Insert test photo
            cursor = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, taken_at)
                VALUES ('test_album_photo.jpg', ?, 32, 'image/jpeg', '2023-01-01 12:00:00');
                """,
                (str(test_file.resolve()),),
            )
            photo_id = cursor.lastrowid

            # Insert test album
            cursor = await conn.execute(
                """
                INSERT INTO albums (name, description, is_vault)
                VALUES ('Vault Test Album', 'Test album for vault lock/unlock', 0);
                """
            )
            album_id = cursor.lastrowid

            # Associate photo with album
            await conn.execute(
                "INSERT INTO photo_album (photo_id, album_id) VALUES (?, ?);",
                (photo_id, album_id),
            )
            await conn.commit()

            # 1. Lock album to vault
            lock_res = await client.post(f"/api/vault/albums/{album_id}/lock")
            assert lock_res.status_code == 200
            lock_data = lock_res.json()
            assert lock_data["photos_encrypted"] == 1
            assert lock_data["photo_ids"] == [photo_id]

            # Verify album is_vault = 1
            async with conn.execute("SELECT is_vault FROM albums WHERE id = ?;", (album_id,)) as cur:
                a_row = await cur.fetchone()
                assert a_row["is_vault"] == 1

            # Verify photo is_encrypted = 1 and .enc file exists
            enc_file = test_file.with_suffix(test_file.suffix + ".enc")
            assert enc_file.exists()
            assert not test_file.exists()

            # Zero-Leak Audit: Verify photo and album are completely absent from all public views
            public_photos = await client.get("/api/photos")
            assert public_photos.status_code == 200
            assert photo_id not in [p["id"] for p in public_photos.json()]

            public_albums = await client.get("/api/albums")
            assert public_albums.status_code == 200
            assert album_id not in [a["id"] for a in public_albums.json()]

            public_album_detail = await client.get(f"/api/albums/{album_id}")
            assert public_album_detail.status_code == 404

            # Verify locked album and its photos appear in Vault endpoints
            vault_albums = await client.get("/api/vault/albums")
            assert vault_albums.status_code == 200
            assert any(a["id"] == album_id for a in vault_albums.json())

            vault_album_photos = await client.get(f"/api/vault/albums/{album_id}/photos")
            assert vault_album_photos.status_code == 200
            assert len(vault_album_photos.json()) == 1
            assert vault_album_photos.json()[0]["id"] == photo_id

            # Verify GET /api/vault/photos contains album_names tag
            vault_photos = await client.get("/api/vault/photos")
            assert vault_photos.status_code == 200
            vault_p = next(p for p in vault_photos.json() if p["id"] == photo_id)
            assert vault_p["album_names"] == "Vault Test Album"

            # 2. Unlock album from vault
            unlock_res = await client.post(f"/api/vault/albums/{album_id}/unlock")
            assert unlock_res.status_code == 200
            assert unlock_res.json()["photos_decrypted"] == 1

            # Verify album is_vault = 0
            async with conn.execute("SELECT is_vault FROM albums WHERE id = ?;", (album_id,)) as cur:
                a_row = await cur.fetchone()
                assert a_row["is_vault"] == 0

            # Verify photo is_encrypted = 0 and plain file restored
            assert test_file.exists()
            assert not enc_file.exists()
            assert test_file.read_bytes() == b"TEST_ALBUM_IMAGE_DATA_1234567890"

            # Verify restored photo and album immediately reappear in public views
            public_photos_restored = await client.get("/api/photos")
            assert any(p["id"] == photo_id for p in public_photos_restored.json())

            public_albums_restored = await client.get("/api/albums")
            assert any(a["id"] == album_id for a in public_albums_restored.json())

            public_album_detail_restored = await client.get(f"/api/albums/{album_id}")
            assert public_album_detail_restored.status_code == 200
            assert len(public_album_detail_restored.json()["photos"]) == 1

        finally:
            if photo_id:
                await conn.execute("DELETE FROM photo_album WHERE photo_id = ?;", (photo_id,))
                await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
            if album_id:
                await conn.execute("DELETE FROM albums WHERE id = ?;", (album_id,))
            await conn.commit()
            await conn.close()

            # Clean disk
            if test_file.exists():
                test_file.unlink()
            enc_file = test_file.with_suffix(test_file.suffix + ".enc")
            if enc_file.exists():
                enc_file.unlink()
            if test_dir.exists():
                import shutil
                shutil.rmtree(test_dir, ignore_errors=True)

            # Reset vault
            await client.post("/api/vault/reset")


@pytest.mark.asyncio
async def test_vault_documents_and_self_healing_workflow():
    """Verifies document categorization (is_document, ocr_text) and automated album self-healing."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/vault/reset")

        setup_res = await client.post(
            "/api/vault/setup",
            json={
                "password": "DocVaultPassword123!",
                "pin": "9999",
                "recovery_phrase": "twenty four test words recovery phrase for test setup",
                "password_hint": "doc hint",
                "enable_totp": False,
            },
        )
        assert setup_res.status_code in (200, 201)

        unlock_res = await client.post(
            "/api/vault/unlock",
            json={"password": "DocVaultPassword123!"},
        )
        assert unlock_res.status_code == 200

        test_uid = secrets.token_hex(4)
        test_dir = Path(f"data/tests_doc_vault_{test_uid}")
        test_dir.mkdir(parents=True, exist_ok=True)
        doc_file = test_dir / f"tax_invoice_{test_uid}.jpg"
        doc_file.write_bytes(b"TAX_INVOICE_IMAGE_BYTES_1234567890")

        from engine.database import get_db_connection
        conn = await get_db_connection()
        doc_id = None
        album_id = None
        try:
            cursor = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, taken_at, is_document, ocr_text)
                VALUES ('tax_invoice_2025.jpg', ?, 32, 'image/jpeg', '2025-04-15 10:00:00', 1, 'IRS Form 1040 Income Tax Return');
                """,
                (str(doc_file.resolve()),),
            )
            doc_id = cursor.lastrowid

            cursor = await conn.execute(
                """
                INSERT INTO albums (name, description, is_vault)
                VALUES ('Tax Records 2025', 'Confidential Tax Records', 0);
                """
            )
            album_id = cursor.lastrowid

            await conn.execute("INSERT INTO photo_album (photo_id, album_id) VALUES (?, ?);", (doc_id, album_id))
            await conn.commit()

            # 1. Lock the album into Vault
            lock_res = await client.post(f"/api/vault/albums/{album_id}/lock")
            assert lock_res.status_code == 200
            assert lock_res.json()["photo_ids"] == [doc_id]

            # 2. Check GET /api/vault/photos returns is_document = True and ocr_text
            vault_photos_res = await client.get("/api/vault/photos")
            assert vault_photos_res.status_code == 200
            vault_doc = next(p for p in vault_photos_res.json() if p["id"] == doc_id)
            assert vault_doc["is_document"] is True
            assert "IRS Form 1040" in vault_doc["ocr_text"]

            # 3. Test self-healing: Unlock the photo directly via /api/vault/photos/unlock
            unlock_photo_res = await client.post(
                "/api/vault/photos/unlock",
                json={"photo_ids": [doc_id]},
            )
            assert unlock_photo_res.status_code == 200
            assert unlock_photo_res.json()["unlocked_count"] == 1

            # 4. Verify that the parent album automatically self-healed to is_vault = 0
            async with conn.execute("SELECT is_vault FROM albums WHERE id = ?;", (album_id,)) as cur:
                a_row = await cur.fetchone()
                assert a_row["is_vault"] == 0

            # Verify public albums now includes the self-healed album
            public_albums = await client.get("/api/albums")
            assert any(a["id"] == album_id for a in public_albums.json())

        finally:
            if doc_id:
                await conn.execute("DELETE FROM photo_album WHERE photo_id = ?;", (doc_id,))
                await conn.execute("DELETE FROM photos WHERE id = ?;", (doc_id,))
            if album_id:
                await conn.execute("DELETE FROM albums WHERE id = ?;", (album_id,))
            await conn.commit()
            await conn.close()

            if doc_file.exists():
                doc_file.unlink()
            enc_file = doc_file.with_suffix(doc_file.suffix + ".enc")
            if enc_file.exists():
                enc_file.unlink()
            if test_dir.exists():
                import shutil
                shutil.rmtree(test_dir, ignore_errors=True)

            await client.post("/api/vault/reset")


@pytest.mark.asyncio
async def test_vault_thumbnail_exif_rotation_preservation():
    """Validates that portrait photos with EXIF orientation 6 maintain upright portrait orientation in vault thumbnails."""
    from engine.database import get_db_connection
    import piexif
    from PIL import Image
    import io

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/api/vault/reset")
        await client.post(
            "/api/vault/setup",
            json={"password": "ExifVaultPass123!", "recovery_phrase": "exif test phrase"},
        )
        await client.post(
            "/api/vault/unlock",
            json={"password": "ExifVaultPass123!"},
        )

        test_dir = Path("data/tests_scratch")
        test_dir.mkdir(parents=True, exist_ok=True)
        img_path = test_dir / "portrait_orientation6.jpg"

        # Create a 400x200 landscape raw image with EXIF orientation 6 (90 CW, meaning portrait upright 200x400)
        img = Image.new("RGB", (400, 200), color="blue")
        exif_bytes = piexif.dump({"0th": {piexif.ImageIFD.Orientation: 6}})
        img.save(img_path, "JPEG", exif=exif_bytes)

        conn = await get_db_connection()
        photo_id = None
        try:
            cursor = await conn.execute(
                """
                INSERT INTO photos (filename, filepath, file_size, mime_type, taken_at)
                VALUES ('portrait_orientation6.jpg', ?, ?, 'image/jpeg', '2023-01-01 12:00:00');
                """,
                (str(img_path.resolve()), img_path.stat().st_size),
            )
            photo_id = cursor.lastrowid
            await conn.commit()

            # Lock to vault (individual lock)
            lock_res = await client.post("/api/vault/photos/lock", json={"photo_ids": [photo_id]})
            assert lock_res.status_code == 200
            assert lock_res.json()["locked_count"] == 1

            # Request vault thumbnail
            thumb_res = await client.get(f"/api/vault/thumbnail/{photo_id}")
            assert thumb_res.status_code == 200
            assert len(thumb_res.content) > 0

            # Verify that resulting thumbnail has been rotated to portrait (height > width)
            with Image.open(io.BytesIO(thumb_res.content)) as thumb_img:
                assert thumb_img.height > thumb_img.width, f"Expected portrait orientation (height > width), got {thumb_img.width}x{thumb_img.height}"

        finally:
            if photo_id:
                await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
                await conn.commit()
            await conn.close()

            if img_path.exists():
                img_path.unlink()
            enc_file = img_path.with_suffix(img_path.suffix + ".enc")
            if enc_file.exists():
                enc_file.unlink()
            if test_dir.exists():
                import shutil
                shutil.rmtree(test_dir, ignore_errors=True)

            await client.post("/api/vault/reset")





