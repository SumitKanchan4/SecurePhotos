"""Writes the GitHub release notes for a version from CHANGELOG.md.

Usage: python scripts/ci/release_notes.py <version> <output file>

Uses the changelog section for that version ("## [0.2.0] - ..."), or the "## Unreleased" section
when the version has no section of its own yet, and adds the same short install notes to every
release. Fails if neither section exists, so a release never goes out with empty notes.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

INSTALL_NOTES = """
## Installing

Download `SecurePhotos_{version}_x64-setup.exe` below and run it. It updates an existing installation in place; your library is kept.

- The installer downloads the old-photo models once (about 2.7 GB), so it needs an internet connection the first time.
- If Windows shows "Windows protected your PC", choose **More info**, then **Run anyway**. Windows shows this for new apps until enough people have installed them.

The full history is in [CHANGELOG.md](https://github.com/SumitKanchan4/SecurePhotos/blob/master/CHANGELOG.md).
"""


def section(changelog: str, version: str) -> str:
    """The body of the changelog section for ``version``, or of "Unreleased"."""
    for heading in (rf"## \[{re.escape(version)}\][^\n]*", r"## \[?Unreleased\]?[^\n]*"):
        match = re.search(rf"^{heading}\n(.*?)(?=^## |\Z)", changelog, re.MULTILINE | re.DOTALL)
        if match and match.group(1).strip():
            return match.group(1).strip()
    raise SystemExit(f"CHANGELOG.md has no section for {version} and no Unreleased section.")


def main() -> None:
    version, out = sys.argv[1].lstrip("v"), Path(sys.argv[2])
    body = section((ROOT / "CHANGELOG.md").read_text(encoding="utf-8"), version)
    out.write_text(f"# SecurePhotos {version}\n\n{body}\n{INSTALL_NOTES.format(version=version)}", encoding="utf-8")


if __name__ == "__main__":
    main()
