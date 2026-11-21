---
name: enterprise-standards-and-docs
description: >-
  Coding, comment, test and documentation standards for SecurePhotos: Google-style Python docstrings,
  JSDoc/TypeScript types, comments that explain why, a failing-first test for every fix, and docs
  kept in step with the code. Use when writing or reviewing any code or documentation.
---

# Code, tests and documentation

## 1. Comments say why
Don't restate the code. Explain the reason, the risk, or the rejected option.

```python
# Never fall back to "any file with the same name": acting on a different file
# with the same name would destroy the wrong data.
```

## 2. Python: Google-style docstrings and type hints
Every module, class and public function has a docstring and full type hints. A real example
from `engine/services/media_paths.py`:

```python
def resolve_stored_path(stored: Optional[str]) -> Optional[Path]:
    """Resolves a path stored in SQLite to an existing file on disk.

    Relative paths resolve against the data folder (not the working directory).

    Args:
        stored: Path string from the database (relative or absolute).

    Returns:
        The existing file path, or None if it cannot be located safely.
    """
```

API endpoints return plain dicts or Pydantic models shaped for the screen, never raw rows with
internal columns.

## 3. TypeScript
- No `any`. API responses have interfaces in `src/services/`.
- Exported functions and components get a short JSDoc line when the name doesn't say it all.
- Pure logic (formatting, counting, layout) goes in `src/utils/` or a `*Format.ts` next to the
  screen, with its own test.

## 4. Tests
- Every fix has a test that **fails on the old code**; check by putting the bug back briefly.
- Engine tests (pytest) run on a throwaway library: `engine/tests/conftest.py` sets
  `SECUREPHOTOS_DATA_DIR` to a temporary folder before any engine import.
- App tests (Vitest) sit next to the file (`*.test.ts[x]`) and run with `npm test`.
- No test needs the network, a GPU, or a real model download; tests that depend on timing are
  made deterministic.

## 5. Documentation follows the code
- When behaviour changes, update every place that describes it: README, SECURITY, `docs/*.md`,
  screen wording, comments, and the rules and skills in `.agents/`. Search for the old wording.
- `engine/tests/test_docs_match_code.py` guards known false claims; add to it when one is found.
- Plain words, short sentences, no marketing terms or em dashes.
