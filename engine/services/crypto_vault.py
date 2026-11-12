"""Zero-Trust Cryptographic Engine & Multi-Slot Vault Manager for SecurePhotos.

This module implements military-grade data protection:
1. Chunked authenticated streaming cipher (AES-256-GCM in 64 KB blocks).
2. Memory-hard Argon2id key derivation for password/PIN authentication.
3. Multi-slot Master Vault Key (MVK) wrapping (Password, Biometrics, 24-Word Recovery).
4. In-memory ephemeral streaming with zero disk-temp leakage and RAM key zeroing.
"""

import base64
import hashlib
import io
import json
import logging
import os
import secrets
import struct
from pathlib import Path
from typing import Any, Dict, Generator, Optional

import argon2
import argon2.exceptions
import argon2.low_level
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger("securephotos.crypto_vault")

# Magic header prefix for SecurePhotos encrypted files
VAULT_MAGIC_HEADER = b"SPENC03\x00"  # 8 bytes; only this format is read or written (H2).
FILE_SALT_SIZE = 32
HEADER_SIZE = len(VAULT_MAGIC_HEADER) + FILE_SALT_SIZE
CHUNK_SIZE = 64 * 1024               # 64 KB streaming chunk size
ARGON2_TIME_COST = 3
ARGON2_MEMORY_COST = 65536           # 64 MB RAM
ARGON2_PARALLELISM = 4
ARGON2_HASH_LEN = 32                 # 256-bit AES key


def zero_memory(buffer: bytearray | bytes) -> None:
    """Safely overwrites sensitive key memory buffers in RAM."""
    if isinstance(buffer, bytearray):
        for i in range(len(buffer)):
            buffer[i] = 0


def derive_key_from_password(password: str, salt: bytes) -> bytes:
    """Derives a 256-bit AES key from a user password using Argon2id.

    Args:
        password: User plaintext password.
        salt: Randomized 16-byte cryptographic salt.

    Returns:
        32-byte derived key.
    """
    return argon2.low_level.hash_secret_raw(
        secret=password.encode("utf-8"),
        salt=salt,
        time_cost=ARGON2_TIME_COST,
        memory_cost=ARGON2_MEMORY_COST,
        parallelism=ARGON2_PARALLELISM,
        hash_len=ARGON2_HASH_LEN,
        type=argon2.low_level.Type.ID,
    )


_PIN_HASHER = argon2.PasswordHasher(
    time_cost=ARGON2_TIME_COST,
    memory_cost=ARGON2_MEMORY_COST,
    parallelism=ARGON2_PARALLELISM,
    type=argon2.low_level.Type.ID,
)


def hash_pin(pin: str) -> str:
    """Returns an Argon2id hash used only to check the quick-unlock PIN.

    The PIN never wraps or derives the vault key (backlog C2): cracking this hash
    from a copied drive reveals the PIN but cannot decrypt anything, because the
    PIN only releases a key that is already in the running app's memory.

    Args:
        pin: Exactly 4 digits.

    Returns:
        Encoded Argon2id hash string (includes its own random salt).
    """
    return _PIN_HASHER.hash(pin.strip())


def verify_pin(pin_hash: str, pin: str) -> bool:
    """Checks a PIN against :func:`hash_pin` output in constant time."""
    try:
        return _PIN_HASHER.verify(pin_hash, pin.strip())
    except (argon2.exceptions.VerifyMismatchError, argon2.exceptions.InvalidHashError):
        return False


def derive_key_from_recovery_phrase(mnemonic: str, salt: bytes) -> bytes:
    """Derives a 256-bit key from a 24-word recovery phrase or paper key using PBKDF2-HMAC-SHA256.

    Args:
        mnemonic: Normalized recovery phrase or alphanumeric code.
        salt: Randomized 16-byte salt.

    Returns:
        32-byte derived key.
    """
    clean_phrase = " ".join(mnemonic.strip().lower().split())
    return hashlib.pbkdf2_hmac(
        "sha256",
        clean_phrase.encode("utf-8"),
        salt,
        iterations=600_000,
        dklen=32,
    )


def generate_grid_card() -> Dict[str, Any]:
    """Generates an ICICI Bank-style 4x4 Emergency Grid Card with CSPRNG entropy.

    Returns:
        Dict containing:
            - card_id: Formatted card serial (e.g. SP-8492-7104).
            - cells: Dict mapping 'A' through 'P' to 2-digit numeric codes.
            - card_token: 32-byte (64-char hex) raw recovery token.
            - grid_salt: 16-byte hex salt for the card-file key slot.
    """
    letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"]
    
    available_numbers = list(range(10, 100))
    rng = secrets.SystemRandom()
    rng.shuffle(available_numbers)
    selected_numbers = available_numbers[:16]
    
    cells = {letters[i]: f"{selected_numbers[i]:02d}" for i in range(16)}
    
    card_id = f"SP-{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}"
    card_token = secrets.token_hex(32)
    grid_salt = secrets.token_bytes(16)
    grid_salt_hex = grid_salt.hex()
    
    return {
        "card_id": card_id,
        "cells": cells,
        "card_token": card_token,
        "grid_salt": grid_salt_hex,
    }


def derive_key_from_grid_token(token: str, salt: bytes) -> bytes:
    """Derives a 256-bit AES key from an Emergency Grid Card recovery token.

    Args:
        token: 64-character hex card token string.
        salt: Randomized 16-byte cryptographic salt.

    Returns:
        32-byte derived Key Encryption Key (KEK).
    """
    clean_token = token.strip().lower()
    return hashlib.pbkdf2_hmac(
        "sha256",
        clean_token.encode("utf-8"),
        salt,
        iterations=600_000,
        dklen=32,
    )


CARD_LETTERS = tuple("ABCDEFGHIJKLMNOP")


def normalize_card_cells(cells: Dict[str, str]) -> str:
    """Validates and canonicalises all 16 Emergency Card numbers.

    Args:
        cells: Mapping of letters A-P to their 2-digit numbers (any case/spacing).

    Returns:
        Canonical string ``"A=12;B=47;...;P=90"``.

    Raises:
        ValueError: If any letter is missing or duplicated, or a number isn't 10-99.
    """
    clean: Dict[str, str] = {}
    for letter, code in cells.items():
        key = str(letter).strip().upper()
        value = str(code).strip()
        if key not in CARD_LETTERS or key in clean:
            raise ValueError("Each card letter A to P must appear exactly once.")
        if not (value.isdigit() and len(value) == 2 and 10 <= int(value) <= 99):
            raise ValueError("Each card number must be two digits between 10 and 99.")
        clean[key] = value
    if len(clean) != len(CARD_LETTERS):
        raise ValueError("All 16 card numbers (A to P) are required.")
    return ";".join(f"{k}={clean[k]}" for k in CARD_LETTERS)


def derive_key_from_card_cells(cells: Dict[str, str], salt: bytes) -> bytes:
    """Derives a 256-bit key from all 16 Emergency Card numbers using Argon2id.

    16 distinct numbers from 10-99 in a fixed order give about 103 bits of
    entropy, so a printed card alone is strong enough to recover the vault.

    Raises:
        ValueError: If the cells are incomplete or malformed.
    """
    return derive_key_from_password(normalize_card_cells(cells), salt)


def wrap_master_key(master_key: bytes, kek: bytes) -> str:
    """Wraps (encrypts) the Master Vault Key using a Key Encryption Key (KEK) via AES-256-GCM.

    Args:
        master_key: 32-byte raw Master Vault Key.
        kek: 32-byte derived Key Encryption Key.

    Returns:
        Base64-encoded string formatted as 'nonce:ciphertext:tag'.
    """
    aesgcm = AESGCM(kek)
    nonce = secrets.token_bytes(12)
    # AESGCM.encrypt appends 16-byte tag to ciphertext
    ciphertext_and_tag = aesgcm.encrypt(nonce, master_key, None)
    wrapped = nonce + ciphertext_and_tag
    return base64.b64encode(wrapped).decode("utf-8")


def unwrap_master_key(wrapped_b64: str, kek: bytes) -> Optional[bytes]:
    """Unwraps (decrypts) the Master Vault Key using a Key Encryption Key (KEK).

    Args:
        wrapped_b64: Base64-encoded wrapped key payload.
        kek: 32-byte derived Key Encryption Key.

    Returns:
        32-byte Master Vault Key, or None if authentication fails.
    """
    try:
        raw = base64.b64decode(wrapped_b64.encode("utf-8"))
        nonce = raw[:12]
        ciphertext_and_tag = raw[12:]
        aesgcm = AESGCM(kek)
        return aesgcm.decrypt(nonce, ciphertext_and_tag, None)
    except Exception as e:
        logger.warning(f"Key unwrapping failed: {e}")
        return None


def _metadata_aad(photo_id: int) -> bytes:
    # Binds the ciphertext to one photo, so a sealed blob can't be copied onto another row.
    return f"securephotos:vault-meta:v1:{photo_id}".encode("utf-8")


def encrypt_photo_metadata(metadata: Dict[str, Any], master_key: bytes, photo_id: int) -> str:
    """Encrypts a vault photo's sensitive details (document text, GPS) with AES-256-GCM.

    Args:
        metadata: JSON-serialisable details, e.g. ``{"ocr_text": ..., "latitude": ...}``.
        master_key: 32-byte master vault key.
        photo_id: Row id; authenticated as associated data.

    Returns:
        Base64 string ``nonce || ciphertext+tag``.
    """
    nonce = secrets.token_bytes(12)
    plaintext = json.dumps(metadata, separators=(",", ":")).encode("utf-8")
    sealed = AESGCM(master_key).encrypt(nonce, plaintext, _metadata_aad(photo_id))
    return base64.b64encode(nonce + sealed).decode("ascii")


def decrypt_photo_metadata(blob: str, master_key: bytes, photo_id: int) -> Dict[str, Any]:
    """Reverses :func:`encrypt_photo_metadata`.

    Raises:
        cryptography.exceptions.InvalidTag: Wrong key, wrong photo, or tampered data.
    """
    raw = base64.b64decode(blob.encode("ascii"))
    plaintext = AESGCM(master_key).decrypt(raw[:12], raw[12:], _metadata_aad(photo_id))
    return json.loads(plaintext.decode("utf-8"))


def _file_key(master_key: bytes, file_salt: bytes) -> bytes:
    """Per-file AES-256 key: HKDF-SHA256(master key, salt=file salt)."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    return HKDF(algorithm=hashes.SHA256(), length=32, salt=file_salt, info=b"securephotos-vault-file-v3").derive(master_key)


def _chunk_nonce(index: int, last: bool) -> bytes:
    """11-byte big-endian chunk counter + 1-byte last-chunk flag (STREAM construction)."""
    return index.to_bytes(11, "big") + (b"\x01" if last else b"\x00")


def encrypt_file_chunked(
    source_path: Path | str | bytes,
    dest_path: Path | str,
    master_key: bytes,
) -> None:
    """Encrypts a file into the SPENC03 format (H2).

    Layout::

        [8B magic "SPENC03\0"][32B random file salt]
        repeated: [4B big-endian ciphertext length][AES-256-GCM ciphertext + 16B tag]

    - Each file has its own key, HKDF(master key, file salt), so nonces never
      repeat across files.
    - Chunk nonce = chunk number + "last chunk" flag; decryption rejects a
      missing last chunk (truncation), data after it, reordering and dropped chunks.
    - The header is authenticated as associated data in every chunk.
    - An empty source still produces one (empty) last chunk.

    The output is written to a temp file, fsynced and atomically renamed.

    Args:
        source_path: Path to the plaintext file, or the plaintext itself as bytes
            (lets vault photos be re-encrypted from memory without ever writing
            an unencrypted copy to disk).
        dest_path: Path for the output ``.enc`` file.
        master_key: 32-byte Master Vault Key.
    """
    file_salt = secrets.token_bytes(FILE_SALT_SIZE)
    header = VAULT_MAGIC_HEADER + file_salt
    aesgcm = AESGCM(_file_key(master_key, file_salt))

    dest_file = Path(dest_path)
    dest_file.parent.mkdir(parents=True, exist_ok=True)
    temp_dest = dest_file.parent / f".{dest_file.name}.tmp"

    source = io.BytesIO(source_path) if isinstance(source_path, (bytes, bytearray)) else open(source_path, "rb")
    with source as fin, open(temp_dest, "wb") as fout:
        fout.write(header)
        index = 0
        chunk = fin.read(CHUNK_SIZE)
        while True:
            following = fin.read(CHUNK_SIZE)
            last = not following
            sealed = aesgcm.encrypt(_chunk_nonce(index, last), chunk, header)
            fout.write(struct.pack(">I", len(sealed)))
            fout.write(sealed)
            if last:
                break
            chunk = following
            index += 1
        fout.flush()
        os.fsync(fout.fileno())

    os.replace(temp_dest, dest_file)


def decrypt_file_chunked_stream(
    encrypted_path: Path | str,
    master_key: bytes,
) -> Generator[bytes, None, None]:
    """Streams decrypted chunks of an SPENC03 file into memory (no disk writes).

    Raises:
        ValueError: Unknown/old format, truncated file, missing last chunk, data
            after the last chunk, or any chunk that fails authentication.
    """
    with open(encrypted_path, "rb") as fin:
        header = fin.read(HEADER_SIZE)
        if len(header) != HEADER_SIZE or header[: len(VAULT_MAGIC_HEADER)] != VAULT_MAGIC_HEADER:
            raise ValueError("Not a SecurePhotos vault file in the current format (SPENC03).")
        aesgcm = AESGCM(_file_key(master_key, header[len(VAULT_MAGIC_HEADER):]))

        index = 0
        while True:
            len_bytes = fin.read(4)
            if not len_bytes:
                raise ValueError("Vault file is incomplete: its last part is missing.")
            if len(len_bytes) != 4:
                raise ValueError("Vault file is damaged: truncated chunk header.")
            chunk_len = struct.unpack(">I", len_bytes)[0]
            if chunk_len < 16 or chunk_len > CHUNK_SIZE + 16:
                raise ValueError("Vault file is damaged: invalid chunk length.")
            sealed = fin.read(chunk_len)
            if len(sealed) != chunk_len:
                raise ValueError("Vault file is incomplete: a chunk was cut short.")

            try:
                plaintext = aesgcm.decrypt(_chunk_nonce(index, False), sealed, header)
                last = False
            except Exception:
                try:
                    plaintext = aesgcm.decrypt(_chunk_nonce(index, True), sealed, header)
                    last = True
                except Exception as err:
                    raise ValueError("Vault file failed its integrity check (wrong key, damaged or tampered).") from err

            yield plaintext
            if last:
                if fin.read(1):
                    raise ValueError("Vault file has unexpected data after its last part.")
                return
            index += 1


def decrypt_file_to_bytes(
    encrypted_path: Path | str,
    master_key: bytes,
) -> bytes:
    """Decrypts an entire encrypted file directly into an in-memory byte buffer.

    Args:
        encrypted_path: Path to .enc file.
        master_key: 32-byte Master Vault Key.

    Returns:
        Complete decrypted plaintext bytes.
    """
    buffer = io.BytesIO()
    for chunk in decrypt_file_chunked_stream(encrypted_path, master_key):
        buffer.write(chunk)
    return buffer.getvalue()

