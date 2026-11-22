"""Writes latest.json, the file the in-app updater reads to find a new version (T18).

Usage: python scripts/ci/updater_manifest.py <version> <bundle dir> <output file>

Tauri's build signs the installer (``<name>-setup.exe.sig`` next to it) but does not write
latest.json. This script does: the version, its notes from CHANGELOG.md, and for Windows the
installer's download address on the GitHub release and its signature. It fails when the
installer or its signature is missing, so a release can never go out unsigned again.
"""

from __future__ import annotations

import datetime
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_notes import ROOT, section  # noqa: E402

DEFAULT_REPOSITORY = "SumitKanchan4/SecurePhotos"
PLATFORM = "windows-x86_64"
# The updater shows the notes in a small window: the changelog section is enough.
NOTES_LIMIT = 4000


def find_installer(bundle_dir: Path) -> tuple[Path, Path]:
    """The NSIS installer and its signature, or SystemExit naming what is missing."""
    installers = sorted((bundle_dir / "nsis").glob("*-setup.exe"))
    if len(installers) != 1:
        raise SystemExit(f"Expected one *-setup.exe in {bundle_dir / 'nsis'}, found {len(installers)}.")
    installer = installers[0]
    signature = installer.with_name(installer.name + ".sig")
    if not signature.is_file() or not signature.read_text(encoding="utf-8").strip():
        raise SystemExit(
            f"{signature.name} is missing or empty: the installer was not signed. "
            "Check the TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD secrets."
        )
    return installer, signature


def manifest(version: str, installer: Path, signature: Path, notes: str, repository: str, now: datetime.datetime) -> dict:
    url = f"https://github.com/{repository}/releases/download/v{version}/{quote(installer.name)}"
    return {
        "version": version,
        "notes": notes[:NOTES_LIMIT],
        "pub_date": now.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {PLATFORM: {"signature": signature.read_text(encoding="utf-8").strip(), "url": url}},
    }


def main() -> None:
    version, bundle_dir, out = sys.argv[1].lstrip("v"), Path(sys.argv[2]), Path(sys.argv[3])
    installer, signature = find_installer(bundle_dir)
    if version not in installer.name:
        raise SystemExit(f"{installer.name} is not the installer for version {version}.")
    notes = section((ROOT / "CHANGELOG.md").read_text(encoding="utf-8"), version)
    data = manifest(version, installer, signature, notes, os.environ.get("GITHUB_REPOSITORY") or DEFAULT_REPOSITORY, datetime.datetime.now(datetime.timezone.utc))
    out.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out} for {version}: {data['platforms'][PLATFORM]['url']}")


if __name__ == "__main__":
    main()
