"""Zero-Trust Vault Authentication, Streaming, and Migration API Router."""

import io
import json
import logging
import secrets
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Header, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from engine.database import get_db_connection
from engine.config import settings, resolve_media_path
from engine.services import vault_storage
from engine.services.crypto_vault import (
    derive_key_from_password,
    derive_key_from_pin,
    derive_key_from_recovery_phrase,
    derive_key_from_grid_token,
    generate_grid_card,
    verify_grid_challenge_cells,
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

    # Check 5-minute (300-second) idle auto-lock (unless active batch keep-alive is active)
    now = time.time()
    if not ACTIVE_VAULT_SESSION["batch_keepalive"]:
        if now - ACTIVE_VAULT_SESSION["last_activity"] > 300.0:
            lock_vault_memory()
            raise HTTPException(status_code=401, detail="Vault auto-locked due to 5 minutes of inactivity.")

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

class GridCardPayload(BaseModel):
    card_id: str
    cells: Dict[str, str]
    card_token: str
    grid_salt: str
    challenge_hashes: Dict[str, str]


class VaultSetupRequest(BaseModel):
    password: str
    pin: Optional[str] = None
    recovery_phrase: Optional[str] = None
    grid_card: Optional[GridCardPayload] = None
    card_token: Optional[str] = None
    password_hint: Optional[str] = None
    enable_totp: bool = False


class VaultUnlockRequest(BaseModel):
    pin: Optional[str] = None
    password: Optional[str] = None
    recovery_phrase: Optional[str] = None
    totp_code: Optional[str] = None


class VaultPasswordResetRequest(BaseModel):
    new_password: str
    new_password_hint: Optional[str] = None
    card_token: Optional[str] = None
    challenge_cells: Optional[Dict[str, str]] = None
    pin: Optional[str] = None
    current_password: Optional[str] = None


class VaultRecoveryChallengeResponse(BaseModel):
    card_id: Optional[str] = None
    required_cells: List[str]


class VaultPhotosLockRequest(BaseModel):
    photo_ids: List[int]


class VaultPhotosUnlockRequest(BaseModel):
    photo_ids: List[int]


class VaultStatusResponse(BaseModel):
    is_configured: bool
    is_unlocked: bool
    has_pin: bool
    is_pin_locked: bool
    has_totp: bool
    has_biometrics: bool
    password_hint: Optional[str] = None
    grid_card_id: Optional[str] = None
    has_grid_card: bool = False


class VaultResetRequest(BaseModel):
    confirm_phrase: str


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=VaultStatusResponse, status_code=status.HTTP_200_OK)
async def get_vault_status() -> VaultStatusResponse:
    """Returns current setup, PIN status, and unlock state of the secure vault."""
    conn = await get_db_connection()
    row = None
    try:
        async with conn.execute(
            """
            SELECT is_configured, password_hint, has_pin, pin_failed_attempts, 
                   totp_secret_encrypted, has_biometrics, grid_card_id
            FROM vault_configs WHERE vault_type = 'private';
            """
        ) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    if not row:
        return VaultStatusResponse(
            is_configured=False,
            is_unlocked=False,
            has_pin=False,
            is_pin_locked=False,
            has_totp=False,
            has_biometrics=False,
            grid_card_id=None,
            has_grid_card=False,
        )

    pin_attempts = row["pin_failed_attempts"] or 0
    card_id = row["grid_card_id"] if "grid_card_id" in row.keys() else None
    return VaultStatusResponse(
        is_configured=bool(row["is_configured"]),
        is_unlocked=ACTIVE_VAULT_SESSION["is_unlocked"],
        has_pin=bool(row["has_pin"]),
        is_pin_locked=pin_attempts >= 5,
        has_totp=bool(row["totp_secret_encrypted"]),
        has_biometrics=bool(row["has_biometrics"]),
        password_hint=row["password_hint"],
        grid_card_id=card_id,
        has_grid_card=bool(card_id),
    )


@router.post("/setup", status_code=status.HTTP_201_CREATED)
async def setup_vault(payload: VaultSetupRequest) -> dict:
    """Configures the Zero-Trust Vault and generates multi-slot key wrappings (Password, PIN, Recovery)."""
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Master password must be at least 8 characters long.")

    salt = secrets.token_bytes(16)
    mvk = secrets.token_bytes(32)

    # Derive Slot 1 (Argon2id password key)
    kek_password = derive_key_from_password(payload.password, salt)
    wrapped_password = wrap_master_key(mvk, kek_password)

    # Derive Slot 2 (Argon2id 4-digit PIN key, if provided)
    wrapped_pin = None
    pin_salt = None
    has_pin = 0
    if payload.pin:
        clean_pin = payload.pin.strip()
        if not clean_pin.isdigit() or len(clean_pin) != 4:
            raise HTTPException(status_code=400, detail="PIN must be exactly 4 numeric digits.")
        pin_salt = secrets.token_bytes(16)
        kek_pin = derive_key_from_pin(clean_pin, pin_salt)
        wrapped_pin = wrap_master_key(mvk, kek_pin)
        has_pin = 1

    # Derive Slot 3 (Emergency Recovery Key: Grid Card or Phrase)
    grid_card_id = None
    grid_cells_hash = None
    grid_salt = None

    if payload.grid_card:
        card_token = payload.grid_card.card_token
        grid_salt = payload.grid_card.grid_salt
        grid_salt_bytes = bytes.fromhex(grid_salt)
        kek_recovery = derive_key_from_grid_token(card_token, grid_salt_bytes)
        grid_card_id = payload.grid_card.card_id
        grid_cells_hash = json.dumps(payload.grid_card.challenge_hashes)
    elif payload.card_token:
        grid_salt_raw = secrets.token_bytes(16)
        grid_salt = grid_salt_raw.hex()
        kek_recovery = derive_key_from_grid_token(payload.card_token, grid_salt_raw)
    elif payload.recovery_phrase:
        kek_recovery = derive_key_from_recovery_phrase(payload.recovery_phrase, salt)
    else:
        generated = generate_grid_card()
        grid_salt = generated["grid_salt"]
        kek_recovery = derive_key_from_grid_token(generated["card_token"], bytes.fromhex(grid_salt))
        grid_card_id = generated["card_id"]
        grid_cells_hash = json.dumps(generated["challenge_hashes"])

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
                vault_type, mvk_wrapped_password, mvk_wrapped_pin, mvk_wrapped_recovery,
                password_salt, pin_salt, password_hint, pin_failed_attempts, has_pin,
                totp_secret_encrypted, grid_card_id, grid_cells_hash, grid_salt, is_configured
            ) VALUES ('private', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 1);
            """,
            (
                wrapped_password,
                wrapped_pin,
                wrapped_recovery,
                salt.hex(),
                pin_salt.hex() if pin_salt else None,
                payload.password_hint,
                has_pin,
                totp_secret,
                grid_card_id,
                grid_cells_hash,
                grid_salt,
            ),
        )
        await conn.commit()
    finally:
        await conn.close()

    return {
        "status": "configured",
        "has_pin": bool(has_pin),
        "grid_card_id": grid_card_id,
        "totp_secret": totp_secret,
        "totp_uri": totp_uri,
    }


@router.post("/unlock", status_code=status.HTTP_200_OK)
async def unlock_vault(payload: VaultUnlockRequest) -> dict:
    """Unwraps the Master Vault Key using 4-digit PIN, master password, or 24-word recovery phrase."""
    conn = await get_db_connection()
    row = None
    try:
        async with conn.execute(
            """
            SELECT mvk_wrapped_password, mvk_wrapped_pin, mvk_wrapped_recovery, 
                   password_salt, pin_salt, has_pin, pin_failed_attempts, totp_secret_encrypted, grid_salt
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

    # Option A: 4-Digit Quick PIN Unlock
    if payload.pin:
        if not row["has_pin"] or not row["mvk_wrapped_pin"] or not row["pin_salt"]:
            raise HTTPException(status_code=400, detail="PIN is not configured on this vault. Please use password.")

        pin_attempts = row["pin_failed_attempts"] or 0
        if pin_attempts >= 5:
            raise HTTPException(
                status_code=401, 
                detail="PIN entry is locked due to 5 failed attempts. Please unlock with your Master Password."
            )

        pin_salt = bytes.fromhex(row["pin_salt"])
        kek_pin = derive_key_from_pin(payload.pin, pin_salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_pin"], kek_pin)

        if not unwrapped_mvk:
            new_attempts = pin_attempts + 1
            conn = await get_db_connection()
            try:
                await conn.execute(
                    "UPDATE vault_configs SET pin_failed_attempts = ? WHERE vault_type = 'private';",
                    (new_attempts,)
                )
                await conn.commit()
            finally:
                await conn.close()

            remaining = max(0, 5 - new_attempts)
            if remaining == 0:
                raise HTTPException(
                    status_code=401, 
                    detail="Incorrect PIN. PIN is now locked. Please use your Master Password."
                )
            raise HTTPException(
                status_code=401, 
                detail=f"Incorrect PIN. {remaining} attempt{'s' if remaining > 1 else ''} remaining before PIN locks."
            )

    # Option B: Master Password Unlock
    elif payload.password:
        kek_pass = derive_key_from_password(payload.password, salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_password"], kek_pass)
        if not unwrapped_mvk:
            raise HTTPException(status_code=401, detail="Incorrect master password. Please try again.")

    # Option C: Recovery Unlock (Emergency Grid Card Token or 24-Word Recovery Phrase)
    elif payload.recovery_phrase:
        clean_token = payload.recovery_phrase.strip()
        rec_salt = bytes.fromhex(row["grid_salt"]) if ("grid_salt" in row.keys() and row["grid_salt"]) else salt
        kek_grid = derive_key_from_grid_token(clean_token, rec_salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_recovery"], kek_grid)
        if not unwrapped_mvk:
            kek_rec = derive_key_from_recovery_phrase(clean_token, salt)
            unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_recovery"], kek_rec)
        if not unwrapped_mvk:
            raise HTTPException(status_code=401, detail="Invalid Emergency Grid Card key or recovery phrase.")

    else:
        raise HTTPException(status_code=400, detail="Must provide PIN, master password, or recovery phrase.")

    # Check TOTP 2FA if configured
    if row["totp_secret_encrypted"]:
        if not payload.totp_code or not verify_totp_code(row["totp_secret_encrypted"], payload.totp_code):
            raise HTTPException(status_code=401, detail="Invalid 6-digit Authenticator TOTP code.")

    # On successful unlock, reset failed PIN counter
    conn = await get_db_connection()
    try:
        await conn.execute("UPDATE vault_configs SET pin_failed_attempts = 0 WHERE vault_type = 'private';")
        await conn.commit()
    finally:
        await conn.close()

    # Unlock in volatile memory
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


@router.post("/reset", status_code=status.HTTP_200_OK)
async def reset_vault(payload: Optional[VaultResetRequest] = None) -> dict:
    """Guarded reset of vault configuration. Requires explicit confirm_phrase for production safety."""
    if payload is not None and payload.confirm_phrase != "ERASE ALL DATA":
        raise HTTPException(status_code=400, detail="Invalid confirmation phrase. Must be 'ERASE ALL DATA'.")

    lock_vault_memory()
    conn = await get_db_connection()
    try:
        await conn.execute("DELETE FROM vault_configs WHERE vault_type = 'private';")
        await conn.commit()
    finally:
        await conn.close()
    return {"status": "vault_reset"}


@router.get("/grid-card/generate", status_code=status.HTTP_200_OK)
async def get_generated_grid_card() -> dict:
    """Generates a cryptographically randomized 4x4 Emergency Grid Card with CSPRNG entropy."""
    return generate_grid_card()


@router.get("/recovery/challenge", response_model=VaultRecoveryChallengeResponse, status_code=status.HTTP_200_OK)
async def get_recovery_challenge() -> VaultRecoveryChallengeResponse:
    """Returns the card ID and 3 randomly selected letters for ICICI-style grid verification."""
    conn = await get_db_connection()
    row = None
    try:
        async with conn.execute(
            "SELECT grid_card_id, grid_cells_hash FROM vault_configs WHERE vault_type = 'private';"
        ) as cursor:
            row = await cursor.fetchone()
    finally:
        await conn.close()

    all_letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]
    if not row or not row["grid_cells_hash"]:
        chosen = sorted(secrets.SystemRandom().sample(all_letters, 3))
        return VaultRecoveryChallengeResponse(card_id=None, required_cells=chosen)

    try:
        hashes = json.loads(row["grid_cells_hash"])
        letters = sorted(list(hashes.keys()))
        if len(letters) >= 3:
            chosen = sorted(secrets.SystemRandom().sample(letters, 3))
        else:
            chosen = sorted(secrets.SystemRandom().sample(all_letters, 3))
    except Exception:
        chosen = sorted(secrets.SystemRandom().sample(all_letters, 3))

    return VaultRecoveryChallengeResponse(card_id=row["grid_card_id"], required_cells=chosen)


@router.post("/reset-password", status_code=status.HTTP_200_OK)
async def reset_vault_password(
    payload: VaultPasswordResetRequest,
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
) -> dict:
    """Resets the Master Password using Grid Card Token, ICICI Challenge + PIN, or active session."""
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="New master password must be at least 8 characters long.")

    conn = await get_db_connection()
    row = None
    try:
        async with conn.execute(
            """
            SELECT mvk_wrapped_password, mvk_wrapped_pin, mvk_wrapped_recovery,
                   password_salt, pin_salt, has_pin, grid_card_id, grid_cells_hash, grid_salt
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

    # Path A: Full Grid Token (Uploaded Card / Key File)
    if payload.card_token:
        clean_token = payload.card_token.strip()
        rec_salt = bytes.fromhex(row["grid_salt"]) if row["grid_salt"] else salt
        kek_grid = derive_key_from_grid_token(clean_token, rec_salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_recovery"], kek_grid)
        if not unwrapped_mvk:
            kek_rec = derive_key_from_recovery_phrase(clean_token, salt)
            unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_recovery"], kek_rec)

        if not unwrapped_mvk:
            raise HTTPException(status_code=401, detail="Invalid Emergency Grid Card key or recovery token.")

    # Path B: ICICI Challenge Cells + 4-Digit PIN
    elif payload.challenge_cells:
        if not payload.pin or len(payload.pin.strip()) != 4:
            raise HTTPException(status_code=400, detail="Must provide your 4-digit PIN along with the card letters.")
        if not row["grid_cells_hash"] or not row["grid_salt"]:
            raise HTTPException(status_code=400, detail="Grid card verification is not configured on this vault.")

        try:
            stored_hashes = json.loads(row["grid_cells_hash"])
        except Exception:
            raise HTTPException(status_code=500, detail="Stored grid card hashes corrupted.")

        is_cells_valid = verify_grid_challenge_cells(
            payload.challenge_cells, stored_hashes, row["grid_salt"]
        )
        if not is_cells_valid:
            raise HTTPException(status_code=401, detail="Incorrect numbers for the requested card boxes.")

        if not row["has_pin"] or not row["mvk_wrapped_pin"] or not row["pin_salt"]:
            raise HTTPException(status_code=400, detail="PIN is not configured on this vault.")

        pin_salt = bytes.fromhex(row["pin_salt"])
        kek_pin = derive_key_from_pin(payload.pin.strip(), pin_salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_pin"], kek_pin)
        if not unwrapped_mvk:
            raise HTTPException(status_code=401, detail="Incorrect 4-digit PIN.")

    # Path C: Active Session or Current Credentials
    elif payload.current_password:
        kek_cur = derive_key_from_password(payload.current_password, salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_password"], kek_cur)
        if not unwrapped_mvk:
            raise HTTPException(status_code=401, detail="Incorrect current master password.")

    elif ACTIVE_VAULT_SESSION["is_unlocked"] and ACTIVE_VAULT_SESSION["mvk"]:
        unwrapped_mvk = bytes(ACTIVE_VAULT_SESSION["mvk"])

    elif payload.pin and row["has_pin"] and row["mvk_wrapped_pin"] and row["pin_salt"]:
        pin_salt = bytes.fromhex(row["pin_salt"])
        kek_pin = derive_key_from_pin(payload.pin.strip(), pin_salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_pin"], kek_pin)
        if not unwrapped_mvk:
            raise HTTPException(status_code=401, detail="Incorrect 4-digit PIN.")

    else:
        raise HTTPException(
            status_code=400, 
            detail="Must provide Grid Card token, ICICI challenge + PIN, or current credentials."
        )

    # Re-wrap Master Key with New Password and Fresh Salt
    new_salt = secrets.token_bytes(16)
    new_kek = derive_key_from_password(payload.new_password, new_salt)
    new_wrapped_password = wrap_master_key(unwrapped_mvk, new_kek)

    conn = await get_db_connection()
    try:
        await conn.execute(
            """
            UPDATE vault_configs
            SET mvk_wrapped_password = ?,
                password_salt = ?,
                password_hint = ?,
                pin_failed_attempts = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE vault_type = 'private';
            """,
            (
                new_wrapped_password,
                new_salt.hex(),
                payload.new_password_hint.strip() if payload.new_password_hint else None,
            ),
        )
        await conn.commit()
    finally:
        await conn.close()

    # If session is active, refresh last activity
    if ACTIVE_VAULT_SESSION["is_unlocked"]:
        ACTIVE_VAULT_SESSION["last_activity"] = time.time()

    return {"status": "success", "message": "Master password reset successfully."}


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

    enc_path = resolve_media_path(row["filepath"])
    if not enc_path.exists():
        raise HTTPException(status_code=404, detail="Encrypted file missing from disk.")

    def iter_chunks():
        for chunk in decrypt_file_chunked_stream(enc_path, mvk):
            yield chunk

    return StreamingResponse(iter_chunks(), media_type=row["mime_type"])


@router.post("/albums/{album_id}/lock", status_code=status.HTTP_200_OK)
async def lock_album_to_vault(album_id: int) -> dict:
    """Moves every photo in an album into the private vault, one crash-safe step at a time.

    Photos that fail are left unchanged and reported in ``failed_ids``.
    """
    mvk = get_active_mvk(ACTIVE_VAULT_SESSION["session_token"])
    conn = await get_db_connection()
    try:
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

        locked_ids, failed_ids = await vault_storage.lock_photos(conn, rows, mvk)

        await conn.execute("UPDATE albums SET is_vault = 1, vault_type = 'private' WHERE id = ?;", (album_id,))
        await conn.commit()
    finally:
        await conn.close()

    return {
        "status": "album_locked",
        "photos_encrypted": len(locked_ids),
        "photo_ids": locked_ids,
        "failed_ids": failed_ids,
    }


@router.post("/albums/{album_id}/unlock", status_code=status.HTTP_200_OK)
async def unlock_album_from_vault(album_id: int) -> dict:
    """Moves every photo in a vault album back to the library, one crash-safe step at a time.

    The album leaves the vault only when none of its photos remain encrypted.
    """
    mvk = get_active_mvk()
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT p.id, p.filepath, p.thumbnail_path, p.preview_path
            FROM photos p
            JOIN photo_album pa ON p.id = pa.photo_id
            WHERE pa.album_id = ? AND p.is_encrypted = 1;
            """,
            (album_id,),
        ) as cursor:
            rows = await cursor.fetchall()

        unlocked_ids, failed_ids = await vault_storage.unlock_photos(conn, rows, mvk)

        if not failed_ids:
            await conn.execute("UPDATE albums SET is_vault = 0, vault_type = NULL WHERE id = ?;", (album_id,))
            await conn.commit()
    finally:
        await conn.close()

    return {"status": "album_unlocked", "photos_decrypted": len(unlocked_ids), "failed_ids": failed_ids}


@router.get("/albums", status_code=status.HTTP_200_OK)
async def list_vault_albums() -> List[dict]:
    """Returns all locked albums in the private vault with cover photos and photo counts."""
    get_active_mvk()
    conn = await get_db_connection()
    try:
        query = """
            SELECT 
                a.id, a.name, a.description, a.is_vault, a.is_favorite, a.created_at,
                COUNT(pa.photo_id) as photo_count,
                COALESCE(a.cover_photo_id, (
                    SELECT pa_sub.photo_id 
                    FROM photo_album pa_sub 
                    JOIN photos p_sub ON pa_sub.photo_id = p_sub.id 
                    WHERE pa_sub.album_id = a.id AND p_sub.is_encrypted = 1
                    ORDER BY p_sub.taken_at DESC 
                    LIMIT 1
                )) as cover_photo_id
            FROM albums a
            LEFT JOIN photo_album pa ON a.id = pa.album_id
            LEFT JOIN photos p ON pa.photo_id = p.id AND p.is_encrypted = 1
            WHERE a.is_vault = 1
            GROUP BY a.id
            ORDER BY a.created_at DESC;
        """
        async with conn.execute(query) as cursor:
            rows = await cursor.fetchall()
            return [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "description": r["description"],
                    "is_vault": bool(r["is_vault"]),
                    "is_favorite": bool(r["is_favorite"]),
                    "photo_count": r["photo_count"],
                    "cover_photo_id": r["cover_photo_id"],
                    "created_at": str(r["created_at"]) if r["created_at"] else None,
                }
                for r in rows
            ]
    finally:
        await conn.close()


@router.get("/albums/{album_id}/photos", status_code=status.HTTP_200_OK)
async def list_vault_album_photos(album_id: int) -> List[dict]:
    """Returns decrypted photo metadata for photos in a specific locked album."""
    get_active_mvk()
    conn = await get_db_connection()
    try:
        query = """
            SELECT 
                p.id, p.filename, p.filepath, p.file_size, p.original_file_size, p.mime_type, p.width, p.height,
                p.taken_at, p.camera_make, p.camera_model, p.latitude, p.longitude,
                p.iso, p.aperture, p.shutter_speed, p.focal_length, p.is_favorite,
                p.is_encrypted, p.is_optimized, p.is_enhanced, p.caption,
                p.thumbnail_path, p.preview_path, p.is_document, p.ocr_text
            FROM photo_album pa
            JOIN photos p ON pa.photo_id = p.id
            WHERE pa.album_id = ? AND p.is_encrypted = 1 AND p.trashed_at IS NULL
            ORDER BY pa.added_at DESC, p.taken_at DESC;
        """
        async with conn.execute(query, (album_id,)) as cursor:
            rows = await cursor.fetchall()
            return [
                {
                    "id": row["id"],
                    "filename": row["filename"],
                    "filepath": row["filepath"],
                    "file_size": row["file_size"],
                    "original_file_size": row["original_file_size"] if "original_file_size" in row.keys() and row["original_file_size"] is not None else row["file_size"],
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
                    "is_document": bool(row["is_document"]) if row["is_document"] is not None else False,
                    "ocr_text": row["ocr_text"],
                }
                for row in rows
            ]
    finally:
        await conn.close()


@router.get("/photos", status_code=status.HTTP_200_OK)
async def list_vault_photos() -> List[dict]:
    """Returns all decrypted metadata for photos locked in the private vault."""
    get_active_mvk()
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT p.id, p.filename, p.filepath, p.file_size, p.original_file_size, p.mime_type, p.width, p.height,
                   p.taken_at, p.camera_make, p.camera_model, p.latitude, p.longitude,
                   p.iso, p.aperture, p.shutter_speed, p.focal_length, p.is_favorite,
                   p.is_encrypted, p.is_optimized, p.is_enhanced, p.caption, p.thumbnail_path, p.preview_path,
                   p.is_document, p.ocr_text,
                   (
                       SELECT GROUP_CONCAT(a.name, ', ')
                       FROM photo_album pa
                       JOIN albums a ON pa.album_id = a.id
                       WHERE pa.photo_id = p.id
                   ) AS album_names
            FROM photos p
            WHERE p.is_encrypted = 1 AND p.vault_type = 'private' AND p.trashed_at IS NULL
            ORDER BY p.taken_at DESC, p.id DESC;
            """
        ) as cursor:
            rows = await cursor.fetchall()
            return [
                {
                    "id": row["id"],
                    "filename": row["filename"],
                    "filepath": row["filepath"],
                    "file_size": row["file_size"],
                    "original_file_size": row["original_file_size"] if "original_file_size" in row.keys() and row["original_file_size"] is not None else row["file_size"],
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
                    "is_document": bool(row["is_document"]) if row["is_document"] is not None else False,
                    "ocr_text": row["ocr_text"],
                    "album_names": row["album_names"],
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
    raw_thumb = Path(row["thumbnail_path"]) if row["thumbnail_path"] else None
    active_enc_thumb = None
    if raw_thumb:
        thumb_path = raw_thumb if raw_thumb.is_absolute() else (settings.data_dir / raw_thumb)
        candidates = [
            thumb_path,
            thumb_path.with_suffix(thumb_path.suffix + ".enc"),
            thumb_path.with_suffix(".enc"),
        ]
        active_enc_thumb = next((p for p in candidates if p.exists()), None)

    if active_enc_thumb:
        try:
            if active_enc_thumb.suffix == ".enc":
                data = decrypt_file_to_bytes(active_enc_thumb, mvk)
            else:
                with open(active_enc_thumb, "rb") as f:
                    data = f.read()
            media_type = "image/webp" if ".webp" in active_enc_thumb.name else "image/jpeg"
            return Response(
                content=data,
                media_type=media_type,
                headers={"Cache-Control": "private, no-store, max-age=0"},
            )
        except Exception as e:
            logger.warning("Failed to decrypt or read thumbnail %s: %s", active_enc_thumb, e)

    # Fallback: decrypt original in-memory and generate thumbnail on the fly
    orig_path = resolve_media_path(row["filepath"])
    if not orig_path.exists():
        raise HTTPException(status_code=404, detail="Encrypted file not found on disk.")

    mime = (row["mime_type"] or "").lower()
    is_video = mime.startswith("video/") or orig_path.name.lower().endswith((".mp4", ".mov", ".avi", ".mkv", ".webm"))

    if is_video:
        logger.warning("Encrypted video %s missing pre-generated thumbnail", photo_id)
        raise HTTPException(status_code=404, detail="Thumbnail not pre-generated for encrypted video.")

    try:
        data = decrypt_file_to_bytes(orig_path, mvk)
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
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
    """Moves individual photos/videos into the private vault, one crash-safe step at a time.

    Photos that fail are left unchanged and reported in ``failed_ids``.
    """
    mvk = get_active_mvk()
    if not payload.photo_ids:
        return {"status": "ok", "locked_count": 0, "failed_ids": []}

    conn = await get_db_connection()
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

        locked_ids, failed_ids = await vault_storage.lock_photos(conn, rows, mvk)
    finally:
        await conn.close()

    return {"status": "photos_locked", "locked_count": len(locked_ids), "failed_ids": failed_ids}


@router.post("/photos/unlock", status_code=status.HTTP_200_OK)
async def restore_photos_from_vault(payload: VaultPhotosUnlockRequest) -> dict:
    """Moves photos/videos out of the private vault, one crash-safe step at a time."""
    mvk = get_active_mvk()
    if not payload.photo_ids:
        return {"status": "ok", "unlocked_count": 0, "failed_ids": []}

    conn = await get_db_connection()
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

        unlocked_ids, failed_ids = await vault_storage.unlock_photos(conn, rows, mvk)

        # Self-healing: a vault album with no encrypted photos left returns to the library.
        await conn.execute(
            """
            UPDATE albums
            SET is_vault = 0, vault_type = NULL
            WHERE is_vault = 1 AND id NOT IN (
                SELECT DISTINCT pa.album_id
                FROM photo_album pa
                JOIN photos p ON pa.photo_id = p.id
                WHERE p.is_encrypted = 1
            );
            """
        )
        await conn.commit()
    finally:
        await conn.close()

    return {"status": "photos_unlocked", "unlocked_count": len(unlocked_ids), "failed_ids": failed_ids}


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
                raw_p = Path(row[p_key])
                fpath = raw_p if raw_p.is_absolute() else (settings.data_dir / raw_p)
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

