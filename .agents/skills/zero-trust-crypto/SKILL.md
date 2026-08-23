---
name: zero-trust-crypto
description: >-
  Enterprise zero-trust cryptographic standards for media vaults. Covers chunked AES-256-GCM authenticated streaming, Argon2id/PBKDF2 key derivation, zero-disk ephemeral decryption, RFC 6238 TOTP 2FA, session invalidation, and path traversal guards.
---

# 🔐 Zero-Trust Cryptography & Vault Security Skill

This skill enforces enterprise cryptographic standards, data-at-rest protection, and memory safety for sensitive documents and private media.

---

## 1. Core Cryptographic Specifications

| Parameter | Standard / Specification |
|---|---|
| **Cipher Algorithm** | **AES-256-GCM** (Authenticated Encryption with Associated Data) |
| **Streaming Chunk Size** | Fixed **64 KB** (65,536 bytes) per block with 12-byte IV + 16-byte Auth Tag |
| **Key Derivation Function** | **Argon2id** (Preferred) or **PBKDF2HMAC-SHA256** (100,000 rounds) |
| **Salt Size** | 16 bytes cryptographically secure pseudo-random (`os.urandom(16)`) |
| **Password Storage** | **bcrypt** with work factor 12 (Never store plaintext PINs/passwords) |
| **Two-Factor Auth** | **RFC 6238 TOTP** with encrypted secret keys at rest |

---

## 2. Chunked AES-256-GCM Streaming Protocol

To prevent Out-Of-Memory (OOM) crashes when encrypting multi-gigabyte video or RAW files, files are streamed in chunks:

```
Encrypted File Structure (.enc):
┌────────────────────────┬────────────────────────────────────────────────────────┐
│ Header (28 bytes)      │ Salt (16B) | Total Chunks Count (4B) | File Version (8B)│
├────────────────────────┼────────────────────────────────────────────────────────┤
│ Chunk 0 (64 KB + 28B)  │ Nonce (12B) | Ciphertext (64 KB) | Auth Tag (16B)       │
│ Chunk 1 (64 KB + 28B)  │ Nonce (12B) | Ciphertext (64 KB) | Auth Tag (16B)       │
│ ...                    │ ...                                                    │
└────────────────────────┴────────────────────────────────────────────────────────┘
```

- **Zero Disk Temporary Files**: When the user opens an encrypted video/photo in the lightbox, the backend decrypts chunk-by-chunk directly into memory and streams it over the local HTTP response.

---

## 3. Path Traversal & Injection Defenses

- Every file-system handler must canonicalize paths and verify confinement:
```python
def validate_safe_path(target_path: Path, allowed_root: Path) -> Path:
    resolved = target_path.resolve()
    if not resolved.is_relative_to(allowed_root.resolve()):
        raise PermissionError("Path traversal attempt detected")
    return resolved
```
