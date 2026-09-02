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


def get_active_mvk(token: Optional[str]) -> bytes:
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
