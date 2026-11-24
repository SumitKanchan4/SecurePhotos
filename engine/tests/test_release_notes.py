"""The release workflow takes its notes from CHANGELOG.md (scripts/ci/release_notes.py)."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("release_notes", ROOT / "scripts/ci/release_notes.py")
release_notes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_notes)

CHANGELOG = """# Changelog

## Unreleased

### Fixes
- Something new.

## [0.1.0] - 2026-09-06

The first public release.
"""


def test_a_released_version_gets_its_own_section():
    assert release_notes.section(CHANGELOG, "0.1.0") == "The first public release."


def test_a_new_version_gets_the_unreleased_section():
    assert release_notes.section(CHANGELOG, "0.2.0") == "### Fixes\n- Something new."


def test_no_notes_stops_the_release():
    with pytest.raises(SystemExit):
        release_notes.section("# Changelog\n", "0.2.0")


def test_the_real_changelog_has_notes_for_the_version_in_the_repo():
    """The version in package.json has its own notes. Right after a release the Unreleased
    section is empty, which is fine: the release step itself stops when there are no notes."""
    import json

    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    assert release_notes.section((ROOT / "CHANGELOG.md").read_text(encoding="utf-8"), version)
