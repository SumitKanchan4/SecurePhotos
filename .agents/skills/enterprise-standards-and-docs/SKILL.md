---
name: enterprise-standards-and-docs
description: >-
  Enterprise documentation and coding standards skill. Enforces Google-style Python docstrings, JSDoc comments, strict type hinting, inline non-obvious rationale comments, comprehensive unit/integration test coverage, and continuous documentation sync.
---

# 📚 Enterprise Documentation, Coding Standards & Testing Skill

This skill enforces professional-grade documentation, clean code conventions, inline architectural rationale, and comprehensive test coverage across the entire project.

---

## 1. Documentation & Commenting Standards

### A. Non-Obvious Rationale Comments
- **Rule**: Do not write comments that merely restate what the code does (e.g., `# set x to 5`).
- **Standard**: Comments must explain **WHY** a specific design decision, optimization, or workaround was chosen.

```python
# GOOD: Explains architectural rationale
# Set journal_mode to WAL before spawning worker threads to allow concurrent 
# readers without blocking background thumbnail generation writes.
cursor.execute("PRAGMA journal_mode = WAL")
```

### B. Google-Style Python Docstrings
Every module, class, and public function must have Google-style docstrings with explicit type definitions:

```python
def derive_vault_key(password: str, salt: bytes, iterations: int = 100_000) -> bytes:
    """Derives a 256-bit cryptographic key using PBKDF2HMAC-SHA256.

    Args:
        password: User-provided plaintext password string.
        salt: Cryptographically secure 16-byte random salt.
        iterations: Number of PBKDF2 HMAC rounds (minimum 100,000).

    Returns:
        32-byte derived master key for AES-256-GCM encryption.

    Raises:
        ValueError: If the salt is shorter than 16 bytes or password is empty.
    """
```

### C. JSDoc for Frontend & TypeScript/JavaScript
```javascript
/**
 * Computes optimal virtualized row layout for the media masonry grid.
 * 
 * @param {number} containerWidth - Available parent container width in pixels.
 * @param {number} targetColumnWidth - Desired card width (default: 220px).
 * @returns {{ columns: number, itemWidth: number }} Calculated column count and card width.
 */
export function calculateGridColumns(containerWidth, targetColumnWidth = 220) {
  // ...
}
```

---

## 2. Strict Type Annotations & Schemas as Contracts

- **Backend**: Every function signature must have 100% parameter and return type hints (`typing` / `pydantic`). Never return raw database models from endpoints; always map to validated Pydantic schemas.
- **Frontend**: Explicit prop-types or TypeScript interfaces for all components and API responses.

---

## 3. Comprehensive Testing Standards

Every feature or bug fix must be accompanied by automated tests:

### A. Test Isolation & Architecture
1. **Unit Tests**: Test pure utility functions (e.g., crypto key derivation, EXIF parser, RRF ranker) in complete isolation.
2. **Contract & API Tests**: Verify that API endpoints adhere to expected status codes, headers (`X-Total-Count`), and response schemas.
3. **Regression Tests**: Any fixed bug must have a dedicated reproduction test added to the test suite to prevent regressions.

### B. Testing Rules
- No test should depend on external network access.
- Temporary database fixtures must be created in-memory (`sqlite:///:memory:`) or in a temporary directory and torn down cleanly.
