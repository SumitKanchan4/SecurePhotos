"""Downloads and verifies the AI models that ship inside the installer (H8).

Usage: python scripts/fetch_models.py build/models

The installer bundles build/models (src-tauri/tauri.conf.json), never the live library folder.

Every model comes from its pinned commit address and must match its pinned SHA-256
(see engine/services/ai_models.py); a mismatch stops the build. Files that are
already present and verified are kept. The placeholder file is removed.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.services.ai_models import MODELS, download_verified, sha256_of  # noqa: E402


def fetch_all(dest: Path) -> list:
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "placeholder.txt").unlink(missing_ok=True)
    ready = []
    for spec in MODELS.values():
        path = dest / spec["file"]
        if not (path.is_file() and sha256_of(path) == spec["sha256"]):
            path = download_verified(spec, dest)
        ready.append(path)
        print(f"ok  {spec['file']}  ({path.stat().st_size / 1e6:.1f} MB, {spec['license']})")
    return ready


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python scripts/fetch_models.py <dest_dir>")
    fetch_all(Path(sys.argv[1]))
