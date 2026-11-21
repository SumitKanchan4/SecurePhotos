---
name: vault-crypto
description: >-
  How the SecurePhotos private vault actually encrypts: one master vault key wrapped in several slots
  (password, emergency card token, 16 card numbers), Argon2id key derivation, the SPENC03 chunked
  AES-256-GCM file format with per-file keys, sealed photo details, a session-only PIN, crash-safe
  lock/unlock, and honest key-in-memory handling. Use it before changing anything in the vault.
---

# Vault cryptography (as built)

This skill describes what the code does today (`engine/services/crypto_vault.py`,
`engine/services/vault_storage.py`, `engine/api/vault.py`). Change the code and this file together.
The reasons behind each choice are in the git history of the fix named in brackets (C2, H2, ...).

---

## 1. Keys

| Item | How |
|---|---|
| **Master vault key (MVK)** | 32 random bytes, created at setup. Encrypts every vault file and sealed detail. Never stored in plaintext. |
| **Password slot** | KEK = **Argon2id** (time 3, 64 MB memory, parallelism 4, 32-byte output) of the password + 16-byte salt; MVK wrapped with AES-256-GCM (`nonce‖ciphertext‖tag`, base64). |
| **Emergency card** | The printed card has a 64-hex token (PBKDF2-HMAC-SHA256, 600,000 rounds; the token is high-entropy) and 16 numbers A-P (Argon2id). Each unwraps its own MVK slot. Recovery = card file **or** all 16 numbers (C3). |
| **Quick PIN** | **Not a key slot.** Only an Argon2id verifier. A normal lock keeps the MVK in memory and the PIN reopens it until the app closes; 5 wrong PINs, or no PIN set, purge the key (C2). |
| **Removed** | TOTP (H3), bcrypt, the 24-word phrase as a setup option (the unlock code still accepts it for older vaults). |

## 2. Vault file format: SPENC03 (H2)

```
[ magic "SPENC03\0" (8 B) | file salt (32 B) ]          header, authenticated as AAD in every chunk
[ AES-256-GCM chunk 0: ciphertext (<= 64 KB) | tag 16 B ]
[ ... ]
[ last chunk (may be empty), flagged as last ]
```
- Per-file key = HKDF-SHA256(MVK, file salt, info `securephotos-vault-file-v3`).
- Nonce = 11-byte chunk counter + 1-byte "last chunk" flag (STREAM construction). Truncation, reordering, mixing chunks of two files, appended data and header edits all fail to decrypt.
- Only SPENC03 is read or written; older formats are refused.
- Viewing decrypts chunk by chunk into memory and streams it; no decrypted temp files.

## 3. Sealed photo details (C4)
- OCR text and GPS of a vault photo are sealed with AES-256-GCM under the MVK, with the photo id as AAD (`encrypt_photo_metadata`), and the plain columns are cleared. Face records of that photo are deleted; library faces are untouched.

## 4. Lock and unlock are crash-safe (C5)
- Journal row in `vault_pending_ops` first; write `.enc` (temp file, fsync, replace); verify it decrypts to the same SHA-256; update the row and commit; only then delete the plaintext. Startup `reconcile_pending_vault_ops` finishes or rolls back.
- `PRAGMA secure_delete` + WAL checkpoint so freed database pages don't keep old plaintext.
- File work runs off the event loop and through `work_queues.vault_files()` (H7).
- Vault enhancement only while unlocked, in memory, re-encrypted to SPENC03 (C7).

## 5. Keys in memory: be honest (H4)
- The session key lives in one `bytearray`, overwritten by `purge_vault_key`. Copies made by Python and the crypto library cannot be overwritten; Windows may page memory to disk. Never claim "wiped from RAM" or "military-grade". See `docs/architecture.md` → "Vault key in memory".

## 6. Engine access
- Every engine request needs the IPC token header or the session cookie (`HttpOnly; SameSite=None; Secure`); no tokens in URLs; frozen builds fail closed and hide `/docs` (H1, H6, M6). The token comes only from the OS random source (M5).

## 7. Paths
- Vault paths are stored relative to the library (`to_db_path`) and resolved with `resolve_stored_path`; never act on a guessed file (M1, M2).
