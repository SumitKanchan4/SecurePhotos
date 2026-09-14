"""Zero-Trust Vault Authentication, Streaming, and Migration API Router."""

import io
import logging
import secrets
import time
from pathlib import Path
from typing import Dict, List, Optional
from fastapi import APIRouter, HTTPException, Header, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from engine.database import get_db_connection
from engine.services.crypto_vault import (
    derive_key_from_password,
    derive_key_from_recovery_phrase,
    encrypt_file_chunked,
    decrypt_file_chunked_stream,
    decrypt_file_to_bytes,
    wrap_master_key,
    unwrap_master_key,
    generate_totp_secret,
    get_totp_provisioning_uri,
    verify_totp_code,
    zero_memory,
)

logger = logging.getLogger("securephotos.vault_api")
router = APIRouter(prefix="/api/vault", tags=["Vault"])

# Ephemeral in-memory session holding active Master Vault Key
ACTIVE_VAULT_SESSION: Dict[str, any] = {
    "mvk": None,                 # bytearray holding 32-byte key
    "session_token": None,
    "last_activity": 0.0,
    "is_unlocked": False,
    "batch_keepalive": False,     # True during active batch optimization
}


def get_active_mvk(token: Optional[str] = None) -> bytes:
    """Verifies that the vault is currently unlocked and session is valid."""
    if not ACTIVE_VAULT_SESSION["is_unlocked"] or not ACTIVE_VAULT_SESSION["mvk"]:
        raise HTTPException(status_code=401, detail="Vault is locked. Please authenticate.")

    # Check 30-second idle auto-lock (unless active batch keep-alive is active)
    now = time.time()
    if not ACTIVE_VAULT_SESSION["batch_keepalive"]:
        if now - ACTIVE_VAULT_SESSION["last_activity"] > 30.0:
            lock_vault_memory()
            raise HTTPException(status_code=401, detail="Vault auto-locked due to 30s inactivity.")

    ACTIVE_VAULT_SESSION["last_activity"] = now
    return bytes(ACTIVE_VAULT_SESSION["mvk"])


def lock_vault_memory() -> None:
    """Cleanses all cryptographic keys from volatile RAM."""
    if ACTIVE_VAULT_SESSION["mvk"]:
        zero_memory(ACTIVE_VAULT_SESSION["mvk"])
    ACTIVE_VAULT_SESSION["mvk"] = None
    ACTIVE_VAULT_SESSION["session_token"] = None
    ACTIVE_VAULT_SESSION["is_unlocked"] = False
    ACTIVE_VAULT_SESSION["batch_keepalive"] = False
    logger.info("Vault memory cleansed and locked.")


# ── Schemas ───────────────────────────────────────────────────────────────────

class VaultSetupRequest(BaseModel):
    password: str
    recovery_phrase: str
    password_hint: Optional[str] = None
    enable_totp: bool = False


class VaultUnlockRequest(BaseModel):
    password: Optional[str] = None
    recovery_phrase: Optional[str] = None
    totp_code: Optional[str] = None


class VaultPhotosLockRequest(BaseModel):
    photo_ids: List[int]


class VaultPhotosUnlockRequest(BaseModel):
    photo_ids: List[int]


class VaultStatusResponse(BaseModel):
    is_configured: bool
    is_unlocked: bool
    has_totp: bool
    has_biometrics: bool
    password_hint: Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=VaultStatusResponse, status_code=status.HTTP_200_OK)
async def get_vault_status() -> VaultStatusResponse:
    """Returns current setup and unlock state of the secure vault."""
    conn = await get_db_connection()
    row = None
    try:
        async with conn.execute(
            "SELECT is_configured, password_hint, totp_secret_encrypted, has_biometrics FROM vault_configs WHERE vault_type = 'private';"
        ) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        return VaultStatusResponse(
            is_configured=False,
            is_unlocked=False,
            has_totp=False,
            has_biometrics=False,
        )

    return VaultStatusResponse(
        is_configured=bool(row["is_configured"]),
        is_unlocked=ACTIVE_VAULT_SESSION["is_unlocked"],
        has_totp=bool(row["totp_secret_encrypted"]),
        has_biometrics=bool(row["has_biometrics"]),
        password_hint=row["password_hint"],
    )


@router.post("/setup", status_code=status.HTTP_201_CREATED)
async def setup_vault(payload: VaultSetupRequest) -> dict:
    """Configures the Zero-Trust Vault and generates multi-slot key wrappings."""
    salt = secrets.token_bytes(16)
    mvk = secrets.token_bytes(32)

    # Derive Slot 1 (Argon2id password key)
    kek_password = derive_key_from_password(payload.password, salt)
    wrapped_password = wrap_master_key(mvk, kek_password)

    # Derive Slot 3 (24-word recovery key)
    kek_recovery = derive_key_from_recovery_phrase(payload.recovery_phrase, salt)
    wrapped_recovery = wrap_master_key(mvk, kek_recovery)

    totp_secret = None
    totp_uri = None
    if payload.enable_totp:
        totp_secret = generate_totp_secret()
        totp_uri = get_totp_provisioning_uri(totp_secret)

    conn = await get_db_connection()
    try:
        await conn.execute(
            """
            INSERT OR REPLACE INTO vault_configs (
                vault_type, mvk_wrapped_password, mvk_wrapped_recovery,
                password_salt, password_hint, totp_secret_encrypted, is_configured
            ) VALUES ('private', ?, ?, ?, ?, ?, 1);
            """,
            (
                wrapped_password,
                wrapped_recovery,
                salt.hex(),
                payload.password_hint,
                totp_secret,
            ),
        )
        await conn.commit()
    finally:
        await conn.close()

    return {
        "status": "configured",
        "totp_secret": totp_secret,
        "totp_uri": totp_uri,
    }


@router.post("/unlock", status_code=status.HTTP_200_OK)
async def unlock_vault(payload: VaultUnlockRequest) -> dict:
    """Unwraps the Master Vault Key using password or recovery phrase."""
    conn = await get_db_connection()
    row = None
    try:
        async with conn.execute(
            """
            SELECT mvk_wrapped_password, mvk_wrapped_recovery, password_salt, totp_secret_encrypted
            FROM vault_configs WHERE vault_type = 'private';
            """
        ) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        raise HTTPException(status_code=400, detail="Vault is not configured yet.")

    salt = bytes.fromhex(row["password_salt"])
    unwrapped_mvk = None

    # Try Slot 1: Password unlock
    if payload.password:
        kek_pass = derive_key_from_password(payload.password, salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_password"], kek_pass)

    # Try Slot 3: Recovery phrase reset
    elif payload.recovery_phrase:
        kek_rec = derive_key_from_recovery_phrase(payload.recovery_phrase, salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_recovery"], kek_rec)

    if not unwrapped_mvk:
        raise HTTPException(status_code=401, detail="Invalid password or recovery phrase.")

    # Check TOTP 2FA if configured
    if row["totp_secret_encrypted"]:
        if not payload.totp_code or not verify_totp_code(row["totp_secret_encrypted"], payload.totp_code):
            raise HTTPException(status_code=401, detail="Invalid 6-digit Authenticator TOTP code.")

    # Unlock in memory
    session_token = secrets.token_hex(16)
    ACTIVE_VAULT_SESSION["mvk"] = bytearray(unwrapped_mvk)
    ACTIVE_VAULT_SESSION["session_token"] = session_token
    ACTIVE_VAULT_SESSION["last_activity"] = time.time()
    ACTIVE_VAULT_SESSION["is_unlocked"] = True

    return {"status": "unlocked", "session_token": session_token}


@router.post("/lock", status_code=status.HTTP_200_OK)
async def lock_vault() -> dict:
    """Manually locks the vault and purges keys from RAM."""
    lock_vault_memory()
    return {"status": "locked"}


@router.get("/stream/{photo_id}")
async def stream_vault_photo(photo_id: int):
    """Streams decrypted photo/video chunks directly to memory blob URLs with zero disk temp writes."""
    mvk = get_active_mvk(ACTIVE_VAULT_SESSION["session_token"])

    conn = await get_db_connection()
    row = None
    try:
        async with conn.execute("SELECT filepath, mime_type FROM photos WHERE id = ? AND is_encrypted = 1;", (photo_id,)) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Encrypted photo not found.")

    enc_path = Path(row["filepath"])
    if not enc_path.exists():
        raise HTTPException(status_code=404, detail="Encrypted file missing from disk.")

    def iter_chunks():
        for chunk in decrypt_file_chunked_stream(enc_path, mvk):
            yield chunk

    return StreamingResponse(iter_chunks(), media_type=row["mime_type"])


@router.post("/albums/{album_id}/lock", status_code=status.HTTP_200_OK)
async def lock_album_to_vault(album_id: int) -> dict:
    """Encrypts all photos in an album and migrates them into the private vault."""
    mvk = get_active_mvk(ACTIVE_VAULT_SESSION["session_token"])
    conn = await get_db_connection()

    try:
        # Query all photos in the album
        async with conn.execute(
            """
            SELECT p.id, p.filepath, p.thumbnail_path, p.preview_path
            FROM photos p
            JOIN photo_album pa ON p.id = pa.photo_id
            WHERE pa.album_id = ? AND p.is_encrypted = 0;
            """,
            (album_id,),
        ) as cursor:
            rows = await cursor.fetchall()

        encrypted_count = 0
        for row in rows:
            photo_id = row["id"]
            orig_file = Path(row["filepath"])
            if orig_file.exists():
                enc_file = orig_file.with_suffix(orig_file.suffix + ".enc")
                encrypt_file_chunked(orig_file, enc_file, mvk)
                orig_file.unlink()  # Clean unencrypted original

                # Encrypt thumbnail
                if row["thumbnail_path"]:
                    t_orig = Path(row["thumbnail_path"])
                    if t_orig.exists():
                        t_enc = t_orig.with_suffix(".enc")
                        encrypt_file_chunked(t_orig, t_enc, mvk)
                        t_orig.unlink()

                await conn.execute(
                    """
                    UPDATE photos
                    SET is_encrypted = 1, filepath = ?, vault_type = 'private'
                    WHERE id = ?;
                    """,
                    (str(enc_file.resolve()), photo_id),
                )
                encrypted_count += 1

        await conn.execute("UPDATE albums SET is_vault = 1, vault_type = 'private' WHERE id = ?;", (album_id,))
        await conn.commit()
    finally:
        await conn.close()

    return {"status": "album_locked", "photos_encrypted": encrypted_count}


@router.get("/photos", status_code=status.HTTP_200_OK)
async def list_vault_photos() -> List[dict]:
    """Returns all decrypted metadata for photos locked in the private vault."""
    get_active_mvk()
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT id, filename, filepath, file_size, mime_type, width, height,
                   taken_at, camera_make, camera_model, latitude, longitude,
                   iso, aperture, shutter_speed, focal_length, is_favorite,
                   is_encrypted, is_optimized, is_enhanced, caption, thumbnail_path, preview_path
            FROM photos
            WHERE is_encrypted = 1 AND vault_type = 'private' AND trashed_at IS NULL
            ORDER BY taken_at DESC, id DESC;
            """
        ) as cursor:
            rows = await cursor.fetchall()
            return [
                {
                    "id": row["id"],
                    "filename": row["filename"],
                    "filepath": row["filepath"],
                    "file_size": row["file_size"],
                    "mime_type": row["mime_type"],
                    "width": row["width"],
                    "height": row["height"],
                    "taken_at": row["taken_at"],
                    "camera_make": row["camera_make"],
                    "camera_model": row["camera_model"],
                    "latitude": row["latitude"],
                    "longitude": row["longitude"],
                    "iso": row["iso"],
                    "aperture": row["aperture"],
                    "shutter_speed": row["shutter_speed"],
                    "focal_length": row["focal_length"],
                    "is_favorite": bool(row["is_favorite"]),
                    "is_encrypted": bool(row["is_encrypted"]),
                    "is_optimized": bool(row["is_optimized"]),
                    "is_enhanced": bool(row["is_enhanced"]),
                    "caption": row["caption"],
                    "thumbnail_path": row["thumbnail_path"],
                    "preview_path": row["preview_path"],
                }
                for row in rows
            ]
    finally:
        await conn.close()


@router.get("/thumbnail/{photo_id}")
async def get_vault_thumbnail(photo_id: int):
    """Streams decrypted thumbnail bytes directly from memory with zero disk writes."""
    mvk = get_active_mvk()
    conn = await get_db_connection()
    row = None
    try:
        async with conn.execute(
            "SELECT filepath, thumbnail_path, mime_type FROM photos WHERE id = ? AND is_encrypted = 1;",
            (photo_id,),
        ) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Encrypted photo not found.")

    # Try encrypted thumbnail file if present
    thumb_path = Path(row["thumbnail_path"]) if row["thumbnail_path"] else None
    if thumb_path and thumb_path.exists():
        try:
            data = decrypt_file_to_bytes(thumb_path, mvk)
            return Response(
                content=data,
                media_type="image/jpeg",
                headers={"Cache-Control": "private, no-store, max-age=0"},
            )
        except Exception as e:
            logger.warning("Failed to decrypt thumbnail %s: %s", thumb_path, e)

    # Fallback: decrypt original in-memory and generate thumbnail on the fly
    orig_path = Path(row["filepath"])
    if not orig_path.exists():
        raise HTTPException(status_code=404, detail="Encrypted file not found on disk.")

    try:
        data = decrypt_file_to_bytes(orig_path, mvk)
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        img.thumbnail((360, 360), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.convert("RGB").save(out, format="JPEG", quality=85)
        return Response(
            content=out.getvalue(),
            media_type="image/jpeg",
            headers={"Cache-Control": "private, no-store, max-age=0"},
        )
    except Exception as e:
        logger.error("Error generating vault thumbnail for photo %s: %s", photo_id, e)
        raise HTTPException(status_code=500, detail="Failed to decrypt thumbnail.")


@router.post("/photos/lock", status_code=status.HTTP_200_OK)
async def lock_photos_to_vault(payload: VaultPhotosLockRequest) -> dict:
    """Encrypts individual photos/videos chunked and migrates them into the private vault."""
    mvk = get_active_mvk()
    if not payload.photo_ids:
        return {"status": "ok", "locked_count": 0}

    conn = await get_db_connection()
    locked_count = 0
    try:
        placeholders = ",".join("?" for _ in payload.photo_ids)
        async with conn.execute(
            f"""
            SELECT id, filepath, thumbnail_path, preview_path
            FROM photos
            WHERE id IN ({placeholders}) AND is_encrypted = 0;
            """,
            payload.photo_ids,
        ) as cursor:
            rows = await cursor.fetchall()

        for row in rows:
            photo_id = row["id"]
            orig_file = Path(row["filepath"])
            if orig_file.exists():
                enc_file = orig_file.with_suffix(orig_file.suffix + ".enc")
                encrypt_file_chunked(orig_file, enc_file, mvk)
                orig_file.unlink()

                enc_thumb_str = None
                if row["thumbnail_path"]:
                    t_orig = Path(row["thumbnail_path"])
                    if t_orig.exists():
                        t_enc = t_orig.with_suffix(t_orig.suffix + ".enc")
                        encrypt_file_chunked(t_orig, t_enc, mvk)
                        t_orig.unlink()
                        enc_thumb_str = str(t_enc.resolve())

                enc_prev_str = None
                if row["preview_path"]:
                    p_orig = Path(row["preview_path"])
                    if p_orig.exists():
                        p_enc = p_orig.with_suffix(p_orig.suffix + ".enc")
                        encrypt_file_chunked(p_orig, p_enc, mvk)
                        p_orig.unlink()
                        enc_prev_str = str(p_enc.resolve())

                await conn.execute(
                    """
                    UPDATE photos
                    SET is_encrypted = 1,
                        filepath = ?,
                        thumbnail_path = COALESCE(?, thumbnail_path),
                        preview_path = COALESCE(?, preview_path),
                        vault_type = 'private'
                    WHERE id = ?;
                    """,
                    (str(enc_file.resolve()), enc_thumb_str, enc_prev_str, photo_id),
                )
                locked_count += 1

        await conn.commit()
    finally:
        await conn.close()

    return {"status": "photos_locked", "locked_count": locked_count}


@router.post("/photos/unlock", status_code=status.HTTP_200_OK)
async def restore_photos_from_vault(payload: VaultPhotosUnlockRequest) -> dict:
    """Decrypts photos/videos from the private vault and restores them to the public library."""
    mvk = get_active_mvk()
    if not payload.photo_ids:
        return {"status": "ok", "unlocked_count": 0}

    conn = await get_db_connection()
    unlocked_count = 0
    try:
        placeholders = ",".join("?" for _ in payload.photo_ids)
        async with conn.execute(
            f"""
            SELECT id, filepath, thumbnail_path, preview_path
            FROM photos
            WHERE id IN ({placeholders}) AND is_encrypted = 1;
            """,
            payload.photo_ids,
        ) as cursor:
            rows = await cursor.fetchall()

        for row in rows:
            photo_id = row["id"]
            enc_file = Path(row["filepath"])
            if enc_file.exists():
                orig_file = enc_file.with_suffix("") if enc_file.suffix == ".enc" else enc_file.with_name("restored_" + enc_file.name)
                with open(orig_file, "wb") as fout:
                    for chunk in decrypt_file_chunked_stream(enc_file, mvk):
                        fout.write(chunk)
                enc_file.unlink()

                restored_thumb_str = None
                if row["thumbnail_path"]:
                    t_enc = Path(row["thumbnail_path"])
                    if t_enc.exists():
                        t_orig = t_enc.with_suffix("") if t_enc.suffix == ".enc" else t_enc.with_name("restored_" + t_enc.name)
                        with open(t_orig, "wb") as fout:
                            for chunk in decrypt_file_chunked_stream(t_enc, mvk):
                                fout.write(chunk)
                        t_enc.unlink()
                        restored_thumb_str = str(t_orig.resolve())

                restored_prev_str = None
                if row["preview_path"]:
                    p_enc = Path(row["preview_path"])
                    if p_enc.exists():
                        p_orig = p_enc.with_suffix("") if p_enc.suffix == ".enc" else p_enc.with_name("restored_" + p_enc.name)
                        with open(p_orig, "wb") as fout:
                            for chunk in decrypt_file_chunked_stream(p_enc, mvk):
                                fout.write(chunk)
                        p_enc.unlink()
                        restored_prev_str = str(p_orig.resolve())

                await conn.execute(
                    """
                    UPDATE photos
                    SET is_encrypted = 0,
                        filepath = ?,
                        thumbnail_path = COALESCE(?, thumbnail_path),
                        preview_path = COALESCE(?, preview_path),
                        vault_type = NULL
                    WHERE id = ?;
                    """,
                    (str(orig_file.resolve()), restored_thumb_str, restored_prev_str, photo_id),
                )
                unlocked_count += 1

        await conn.commit()
    finally:
        await conn.close()

    return {"status": "photos_unlocked", "unlocked_count": unlocked_count}


@router.delete("/photos/{photo_id}", status_code=status.HTTP_200_OK)
async def delete_vault_photo_permanently(photo_id: int) -> dict:
    """Permanently purges an encrypted photo from the vault and disk with zero recovery."""
    get_active_mvk()
    conn = await get_db_connection()
    try:
        async with conn.execute(
            "SELECT filepath, thumbnail_path, preview_path FROM photos WHERE id = ? AND is_encrypted = 1;",
            (photo_id,),
        ) as cursor:
            row = await cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Vault photo not found.")

        for p_key in ["filepath", "thumbnail_path", "preview_path"]:
            if row[p_key]:
                fpath = Path(row[p_key])
                if fpath.exists():
                    try:
                        fpath.unlink()
                    except Exception as e:
                        logger.warning("Could not unlink %s: %s", fpath, e)

        await conn.execute("DELETE FROM photos WHERE id = ?;", (photo_id,))
        await conn.commit()
    finally:
        await conn.close()

    return {"status": "purged", "photo_id": photo_id}

