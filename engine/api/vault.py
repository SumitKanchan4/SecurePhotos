"""Zero-Trust Vault Authentication, Streaming, and Migration API Router.

Unlock model (backlog C2/C3, owner decisions 2026-11-11):
- The master password (or a recovery key) is the only thing that opens the vault
  from scratch. It unwraps the master vault key (MVK) into memory.
- The 4-digit PIN is a quick re-unlock only. Any lock while the app is open
  (idle auto-lock, Lock button, L key) keeps the MVK in memory and the PIN
  releases it again. Nothing derived from the PIN wraps the MVK, so a copied
  drive can't be opened by guessing 10,000 PINs. 5 wrong PINs purge the key;
  closing the app purges it too.
- Forgot password: Emergency Card file (full key) or all 16 card numbers.
"""

import asyncio
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
    derive_key_from_card_cells,
    derive_key_from_password,
    derive_key_from_recovery_phrase,
    derive_key_from_grid_token,
    generate_grid_card,
    hash_pin,
    verify_pin,
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

AUTO_LOCK_SECONDS = 300.0
MAX_PIN_ATTEMPTS = 5

# Ephemeral in-memory session. "mvk" may be present while is_unlocked is False:
# that is the soft-locked state in which the PIN can re-unlock.
ACTIVE_VAULT_SESSION: Dict[str, Any] = {
    "mvk": None,                 # bytearray holding the 32-byte master vault key
    "session_token": None,
    "last_activity": 0.0,
    "is_unlocked": False,
    "batch_keepalive": False,    # True during active batch optimization
    "pin_verifier": None,        # Argon2id PIN hash loaded at password unlock
    "pin_failures": 0,
}


def get_active_mvk(token: Optional[str] = None) -> bytes:
    """Returns the master vault key if the vault is unlocked; soft-locks after 5 idle minutes."""
    if not ACTIVE_VAULT_SESSION["is_unlocked"] or not ACTIVE_VAULT_SESSION["mvk"]:
        raise HTTPException(status_code=401, detail="Vault is locked. Please authenticate.")

    now = time.time()
    if not ACTIVE_VAULT_SESSION["batch_keepalive"]:
        if now - ACTIVE_VAULT_SESSION["last_activity"] > AUTO_LOCK_SECONDS:
            soft_lock_vault()
            raise HTTPException(status_code=401, detail="Vault auto-locked due to 5 minutes of inactivity.")

    ACTIVE_VAULT_SESSION["last_activity"] = now
    return bytes(ACTIVE_VAULT_SESSION["mvk"])


def purge_vault_key() -> None:
    """Removes the master vault key from memory; the master password is needed again."""
    if ACTIVE_VAULT_SESSION["mvk"]:
        zero_memory(ACTIVE_VAULT_SESSION["mvk"])
    ACTIVE_VAULT_SESSION.update(
        mvk=None, session_token=None, is_unlocked=False, batch_keepalive=False,
        pin_verifier=None, pin_failures=0,
    )
    logger.info("Vault key purged from memory.")


def soft_lock_vault() -> None:
    """Locks the vault. With a PIN set, the key stays in memory for PIN re-unlock;
    without one, the key is purged."""
    if not ACTIVE_VAULT_SESSION["pin_verifier"]:
        purge_vault_key()
        return
    ACTIVE_VAULT_SESSION.update(session_token=None, is_unlocked=False, batch_keepalive=False)
    logger.info("Vault locked; PIN quick unlock available until the app closes.")


def _pin_unlock_available() -> bool:
    return bool(
        ACTIVE_VAULT_SESSION["mvk"]
        and ACTIVE_VAULT_SESSION["pin_verifier"]
        and not ACTIVE_VAULT_SESSION["is_unlocked"]
        and ACTIVE_VAULT_SESSION["pin_failures"] < MAX_PIN_ATTEMPTS
    )


def _open_session(mvk: bytes, pin_verifier: Optional[str]) -> str:
    session_token = secrets.token_hex(16)
    if ACTIVE_VAULT_SESSION["mvk"] and bytes(ACTIVE_VAULT_SESSION["mvk"]) != mvk:
        zero_memory(ACTIVE_VAULT_SESSION["mvk"])
    ACTIVE_VAULT_SESSION.update(
        mvk=bytearray(mvk), session_token=session_token, last_activity=time.time(),
        is_unlocked=True, pin_verifier=pin_verifier, pin_failures=0,
    )
    return session_token


def _validate_pin(pin: str) -> str:
    clean = (pin or "").strip()
    if not (clean.isdigit() and len(clean) == 4):
        raise HTTPException(status_code=400, detail="PIN must be exactly 4 numeric digits.")
    return clean


async def _load_vault_config() -> Optional[Any]:
    conn = await get_db_connection()
    try:
        async with conn.execute("SELECT * FROM vault_configs WHERE vault_type = 'private';") as cursor:
            return await cursor.fetchone()
    finally:
        await conn.close()


def _sealed(row: Any, mvk: bytes) -> Dict[str, Any]:
    """Document text and GPS of a vault photo (sealed since C4; plain columns are empty).

    Falls back to the plain columns for photos locked before C4.
    """
    if row["vault_meta_enc"]:
        return vault_storage.decrypt_vault_details(row, mvk)
    return {"ocr_text": row["ocr_text"], "latitude": row["latitude"], "longitude": row["longitude"]}


# ── Schemas ───────────────────────────────────────────────────────────────────

class GridCardPayload(BaseModel):
    card_id: str
    cells: Dict[str, str]
    card_token: str
    grid_salt: str


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


class VaultPinRequest(BaseModel):
    pin: Optional[str] = None   # None removes the PIN


class VaultPasswordResetRequest(BaseModel):
    new_password: str
    new_password_hint: Optional[str] = None
    card_token: Optional[str] = None
    card_cells: Optional[Dict[str, str]] = None   # all 16 numbers, A-P
    current_password: Optional[str] = None


class VaultPhotosLockRequest(BaseModel):
    photo_ids: List[int]


class VaultPhotosUnlockRequest(BaseModel):
    photo_ids: List[int]


class VaultStatusResponse(BaseModel):
    is_configured: bool
    is_unlocked: bool
    has_pin: bool
    is_pin_locked: bool            # True when a PIN is set but can't be used right now
    pin_unlock_available: bool = False
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
    """Returns setup state, whether the vault is open, and whether the PIN can be used now."""
    row = await _load_vault_config()
    if not row:
        return VaultStatusResponse(
            is_configured=False, is_unlocked=False, has_pin=False, is_pin_locked=False,
            has_totp=False, has_biometrics=False,
        )

    has_pin = bool(row["pin_verifier"])
    pin_available = has_pin and _pin_unlock_available()
    return VaultStatusResponse(
        is_configured=bool(row["is_configured"]),
        is_unlocked=ACTIVE_VAULT_SESSION["is_unlocked"],
        has_pin=has_pin,
        is_pin_locked=has_pin and not pin_available and not ACTIVE_VAULT_SESSION["is_unlocked"],
        pin_unlock_available=pin_available,
        has_totp=bool(row["totp_secret_encrypted"]),
        has_biometrics=bool(row["has_biometrics"]),
        password_hint=row["password_hint"],
        grid_card_id=row["grid_card_id"],
        has_grid_card=bool(row["grid_card_id"]),
    )


@router.post("/setup", status_code=status.HTTP_201_CREATED)
async def setup_vault(payload: VaultSetupRequest) -> dict:
    """Creates the vault: password slot, optional quick PIN, and recovery slots.

    Recovery slots: with an Emergency Card, one slot for the card file's key and
    one for all 16 card numbers; otherwise a recovery phrase or card token.
    """
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Master password must be at least 8 characters long.")
    pin_verifier = await asyncio.to_thread(hash_pin, _validate_pin(payload.pin)) if payload.pin else None

    salt = secrets.token_bytes(16)
    mvk = secrets.token_bytes(32)
    wrapped_password = wrap_master_key(mvk, await asyncio.to_thread(derive_key_from_password, payload.password, salt))

    generated_card = None
    card = payload.grid_card
    if card is None and not payload.card_token and not payload.recovery_phrase:
        generated_card = generate_grid_card()
        card = GridCardPayload(**generated_card)

    grid_card_id = grid_salt = wrapped_card_cells = card_cells_salt = None
    if card is not None:
        grid_card_id, grid_salt = card.card_id, card.grid_salt
        kek_recovery = await asyncio.to_thread(derive_key_from_grid_token, card.card_token, bytes.fromhex(grid_salt))
        cells_salt = secrets.token_bytes(16)
        try:
            kek_cells = await asyncio.to_thread(derive_key_from_card_cells, card.cells, cells_salt)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
        wrapped_card_cells, card_cells_salt = wrap_master_key(mvk, kek_cells), cells_salt.hex()
    elif payload.card_token:
        grid_salt_raw = secrets.token_bytes(16)
        grid_salt = grid_salt_raw.hex()
        kek_recovery = await asyncio.to_thread(derive_key_from_grid_token, payload.card_token, grid_salt_raw)
    else:
        kek_recovery = await asyncio.to_thread(derive_key_from_recovery_phrase, payload.recovery_phrase, salt)
    wrapped_recovery = wrap_master_key(mvk, kek_recovery)

    totp_secret = totp_uri = None
    if payload.enable_totp:
        totp_secret = generate_totp_secret()
        totp_uri = get_totp_provisioning_uri(totp_secret)

    conn = await get_db_connection()
    try:
        await conn.execute(
            """
            INSERT OR REPLACE INTO vault_configs (
                vault_type, mvk_wrapped_password, mvk_wrapped_pin, mvk_wrapped_recovery,
                password_salt, pin_salt, password_hint, pin_failed_attempts, has_pin, pin_verifier,
                totp_secret_encrypted, grid_card_id, grid_cells_hash, grid_salt,
                mvk_wrapped_card_cells, card_cells_salt, is_configured
            ) VALUES ('private', ?, NULL, ?, ?, NULL, ?, 0, ?, ?, ?, ?, NULL, ?, ?, ?, 1);
            """,
            (
                wrapped_password, wrapped_recovery, salt.hex(), payload.password_hint,
                1 if pin_verifier else 0, pin_verifier, totp_secret, grid_card_id, grid_salt,
                wrapped_card_cells, card_cells_salt,
            ),
        )
        await conn.commit()
    finally:
        await conn.close()

    purge_vault_key()
    result = {
        "status": "configured",
        "has_pin": bool(pin_verifier),
        "grid_card_id": grid_card_id,
        "totp_secret": totp_secret,
        "totp_uri": totp_uri,
    }
    if generated_card:
        result["grid_card"] = generated_card  # Otherwise the user would never see their card.
    return result


@router.post("/unlock", status_code=status.HTTP_200_OK)
async def unlock_vault(payload: VaultUnlockRequest) -> dict:
    """Opens the vault with the master password or a recovery key, or re-opens it with the PIN.

    The PIN only works while the key is still in memory (after a password unlock
    since the app opened). 5 wrong PINs purge the key.
    """
    row = await _load_vault_config()
    if not row:
        raise HTTPException(status_code=400, detail="Vault is not configured yet.")

    salt = bytes.fromhex(row["password_salt"])
    unwrapped_mvk = None

    if payload.pin:
        if not row["pin_verifier"]:
            raise HTTPException(status_code=400, detail="No PIN is set. Please use your master password.")
        if not _pin_unlock_available():
            raise HTTPException(
                status_code=401,
                detail="Please unlock with your master password. Your PIN works after that until you close the app.",
            )
        if not await asyncio.to_thread(verify_pin, ACTIVE_VAULT_SESSION["pin_verifier"], payload.pin):
            ACTIVE_VAULT_SESSION["pin_failures"] += 1
            remaining = MAX_PIN_ATTEMPTS - ACTIVE_VAULT_SESSION["pin_failures"]
            if remaining <= 0:
                purge_vault_key()
                raise HTTPException(status_code=401, detail="Incorrect PIN. Please unlock with your master password.")
            raise HTTPException(
                status_code=401,
                detail=f"Incorrect PIN. {remaining} attempt{'s' if remaining > 1 else ''} left before your master password is needed.",
            )
        unwrapped_mvk = bytes(ACTIVE_VAULT_SESSION["mvk"])

    elif payload.password:
        kek_pass = await asyncio.to_thread(derive_key_from_password, payload.password, salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_password"], kek_pass)
        if not unwrapped_mvk:
            raise HTTPException(status_code=401, detail="Incorrect master password. Please try again.")

    elif payload.recovery_phrase:
        clean_token = payload.recovery_phrase.strip()
        rec_salt = bytes.fromhex(row["grid_salt"]) if row["grid_salt"] else salt
        kek_grid = await asyncio.to_thread(derive_key_from_grid_token, clean_token, rec_salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_recovery"], kek_grid)
        if not unwrapped_mvk:
            kek_rec = await asyncio.to_thread(derive_key_from_recovery_phrase, clean_token, salt)
            unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_recovery"], kek_rec)
        if not unwrapped_mvk:
            raise HTTPException(status_code=401, detail="Invalid Emergency Card key or recovery phrase.")

    else:
        raise HTTPException(status_code=400, detail="Must provide PIN, master password, or recovery phrase.")

    if row["totp_secret_encrypted"]:
        if not payload.totp_code or not verify_totp_code(row["totp_secret_encrypted"], payload.totp_code):
            raise HTTPException(status_code=401, detail="Invalid 6-digit Authenticator TOTP code.")

    session_token = _open_session(unwrapped_mvk, row["pin_verifier"])
    return {"status": "unlocked", "session_token": session_token}


@router.post("/lock", status_code=status.HTTP_200_OK)
async def lock_vault() -> dict:
    """Locks the vault. With a PIN set, the PIN can re-open it until the app closes."""
    soft_lock_vault()
    return {"status": "locked", "pin_unlock_available": _pin_unlock_available()}


@router.post("/pin", status_code=status.HTTP_200_OK)
async def set_vault_pin(payload: VaultPinRequest) -> dict:
    """Sets, changes or removes the quick-unlock PIN. The vault must be unlocked."""
    get_active_mvk()
    pin_verifier = await asyncio.to_thread(hash_pin, _validate_pin(payload.pin)) if payload.pin else None
    conn = await get_db_connection()
    try:
        await conn.execute(
            "UPDATE vault_configs SET pin_verifier = ?, has_pin = ?, mvk_wrapped_pin = NULL, pin_salt = NULL, "
            "updated_at = CURRENT_TIMESTAMP WHERE vault_type = 'private';",
            (pin_verifier, 1 if pin_verifier else 0),
        )
        await conn.commit()
    finally:
        await conn.close()
    ACTIVE_VAULT_SESSION["pin_verifier"] = pin_verifier
    ACTIVE_VAULT_SESSION["pin_failures"] = 0
    return {"status": "pin_set" if pin_verifier else "pin_removed", "has_pin": bool(pin_verifier)}


VAULT_RESET_PHRASE = "ERASE ALL DATA"


@router.get("/reset-preview", status_code=status.HTTP_200_OK)
async def get_vault_reset_preview() -> dict:
    """Returns how many vault photos and albums a reset would permanently erase.

    Deliberately separate from ``/status`` so the vault size isn't sent with every
    status poll; it's only requested when the user opens the reset screen.
    """
    conn = await get_db_connection()
    try:
        return await vault_storage.count_vault_contents(conn)
    finally:
        await conn.close()


@router.post("/reset", status_code=status.HTTP_200_OK)
async def reset_vault(payload: VaultResetRequest) -> dict:
    """Factory-resets the vault: permanently erases every vault photo, file, face crop and
    vault album, then the keys.

    The confirmation phrase is mandatory. Keys are deleted in the same commit as the
    last rows, so a crash mid-reset never leaves unreadable files behind without keys
    being kept; running reset again finishes the job.
    """
    if payload.confirm_phrase.strip() != VAULT_RESET_PHRASE:
        raise HTTPException(status_code=400, detail=f"Invalid confirmation phrase. Must be '{VAULT_RESET_PHRASE}'.")

    purge_vault_key()
    conn = await get_db_connection()
    try:
        erased = await vault_storage.erase_vault_contents(conn)
        await conn.execute("DELETE FROM vault_configs WHERE vault_type = 'private';")
        await conn.commit()
    finally:
        await conn.close()
    logger.info("Vault reset: erased %d photos and %d albums.", erased["photo_count"], erased["album_count"])
    return {"status": "vault_reset", "erased_photos": erased["photo_count"], "erased_albums": erased["album_count"]}


@router.get("/grid-card/generate", status_code=status.HTTP_200_OK)
async def get_generated_grid_card() -> dict:
    """Generates a cryptographically randomized 4x4 Emergency Grid Card with CSPRNG entropy."""
    return generate_grid_card()


@router.post("/reset-password", status_code=status.HTTP_200_OK)
async def reset_vault_password(payload: VaultPasswordResetRequest) -> dict:
    """Sets a new master password, proven by one of:

    - the Emergency Card file (its full key),
    - all 16 numbers from the printed Emergency Card,
    - the current master password,
    - an unlocked vault (changing the password from Settings).
    """
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="New master password must be at least 8 characters long.")

    row = await _load_vault_config()
    if not row:
        raise HTTPException(status_code=400, detail="Vault is not configured yet.")

    salt = bytes.fromhex(row["password_salt"])
    unwrapped_mvk = None

    if payload.card_token:
        clean_token = payload.card_token.strip()
        rec_salt = bytes.fromhex(row["grid_salt"]) if row["grid_salt"] else salt
        kek_grid = await asyncio.to_thread(derive_key_from_grid_token, clean_token, rec_salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_recovery"], kek_grid)
        if not unwrapped_mvk:
            kek_rec = await asyncio.to_thread(derive_key_from_recovery_phrase, clean_token, salt)
            unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_recovery"], kek_rec)
        if not unwrapped_mvk:
            raise HTTPException(status_code=401, detail="That Emergency Card file doesn't match this vault.")

    elif payload.card_cells is not None:
        if not row["mvk_wrapped_card_cells"] or not row["card_cells_salt"]:
            raise HTTPException(status_code=400, detail="This vault has no Emergency Card numbers set up.")
        try:
            kek_cells = await asyncio.to_thread(
                derive_key_from_card_cells, payload.card_cells, bytes.fromhex(row["card_cells_salt"])
            )
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_card_cells"], kek_cells)
        if not unwrapped_mvk:
            raise HTTPException(status_code=401, detail="Those numbers don't match your Emergency Card.")

    elif payload.current_password:
        kek_cur = await asyncio.to_thread(derive_key_from_password, payload.current_password, salt)
        unwrapped_mvk = unwrap_master_key(row["mvk_wrapped_password"], kek_cur)
        if not unwrapped_mvk:
            raise HTTPException(status_code=401, detail="Incorrect current master password.")

    elif ACTIVE_VAULT_SESSION["is_unlocked"] and ACTIVE_VAULT_SESSION["mvk"]:
        unwrapped_mvk = bytes(ACTIVE_VAULT_SESSION["mvk"])

    else:
        raise HTTPException(
            status_code=400,
            detail="Provide your Emergency Card file, all 16 card numbers, or your current password.",
        )

    new_salt = secrets.token_bytes(16)
    new_kek = await asyncio.to_thread(derive_key_from_password, payload.new_password, new_salt)
    new_wrapped_password = wrap_master_key(unwrapped_mvk, new_kek)

    conn = await get_db_connection()
    try:
        await conn.execute(
            """
            UPDATE vault_configs
            SET mvk_wrapped_password = ?, password_salt = ?, password_hint = ?, updated_at = CURRENT_TIMESTAMP
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
    mvk = get_active_mvk()
    conn = await get_db_connection()
    try:
        query = """
            SELECT 
                p.id, p.filename, p.filepath, p.file_size, p.original_file_size, p.mime_type, p.width, p.height,
                p.taken_at, p.camera_make, p.camera_model, p.latitude, p.longitude,
                p.iso, p.aperture, p.shutter_speed, p.focal_length, p.is_favorite,
                p.is_encrypted, p.is_optimized, p.is_enhanced, p.caption,
                p.thumbnail_path, p.preview_path, p.is_document, p.ocr_text, p.vault_meta_enc
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
                    "latitude": _sealed(row, mvk)["latitude"],
                    "longitude": _sealed(row, mvk)["longitude"],
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
                    "ocr_text": _sealed(row, mvk)["ocr_text"],
                }
                for row in rows
            ]
    finally:
        await conn.close()


@router.get("/photos", status_code=status.HTTP_200_OK)
async def list_vault_photos() -> List[dict]:
    """Returns all decrypted metadata for photos locked in the private vault."""
    mvk = get_active_mvk()
    conn = await get_db_connection()
    try:
        async with conn.execute(
            """
            SELECT p.id, p.filename, p.filepath, p.file_size, p.original_file_size, p.mime_type, p.width, p.height,
                   p.taken_at, p.camera_make, p.camera_model, p.latitude, p.longitude,
                   p.iso, p.aperture, p.shutter_speed, p.focal_length, p.is_favorite,
                   p.is_encrypted, p.is_optimized, p.is_enhanced, p.caption, p.thumbnail_path, p.preview_path,
                   p.is_document, p.ocr_text, p.vault_meta_enc,
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
                    "latitude": _sealed(row, mvk)["latitude"],
                    "longitude": _sealed(row, mvk)["longitude"],
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
                    "ocr_text": _sealed(row, mvk)["ocr_text"],
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

