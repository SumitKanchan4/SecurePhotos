"""latest.json for the in-app updater (scripts/ci/updater_manifest.py, T18)."""

import datetime
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/ci"))
spec = importlib.util.spec_from_file_location("updater_manifest", ROOT / "scripts/ci/updater_manifest.py")
updater_manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater_manifest)


def bundle(tmp_path, sig="dW50cnVzdGVkIGNvbW1lbnQ="):
    nsis = tmp_path / "nsis"
    nsis.mkdir()
    exe = nsis / "SecurePhotos_0.3.0_x64-setup.exe"
    exe.write_bytes(b"MZ")
    if sig is not None:
        (nsis / (exe.name + ".sig")).write_text(sig + "\n", encoding="utf-8")
    return tmp_path, exe


def test_manifest_points_at_the_release_installer_with_its_signature(tmp_path):
    root, exe = bundle(tmp_path)
    installer, signature = updater_manifest.find_installer(root)
    data = updater_manifest.manifest(
        "0.3.0", installer, signature, "Notes", "owner/repo", datetime.datetime(2026, 11, 22, 10, 0, tzinfo=datetime.timezone.utc)
    )
    assert data == {
        "version": "0.3.0",
        "notes": "Notes",
        "pub_date": "2026-11-22T10:00:00Z",
        "platforms": {
            "windows-x86_64": {
                "signature": "dW50cnVzdGVkIGNvbW1lbnQ=",
                "url": "https://github.com/owner/repo/releases/download/v0.3.0/SecurePhotos_0.3.0_x64-setup.exe",
            }
        },
    }


@pytest.mark.parametrize("sig", [None, "  "])
def test_an_unsigned_installer_stops_the_release(tmp_path, sig):
    root, _ = bundle(tmp_path, sig=sig)
    with pytest.raises(SystemExit, match="not signed"):
        updater_manifest.find_installer(root)


def test_no_installer_stops_the_release(tmp_path):
    (tmp_path / "nsis").mkdir()
    with pytest.raises(SystemExit, match="found 0"):
        updater_manifest.find_installer(tmp_path)


def test_main_writes_latest_json_with_changelog_notes(tmp_path, monkeypatch):
    root, _ = bundle(tmp_path)
    out = tmp_path / "latest.json"
    monkeypatch.setattr(sys, "argv", ["updater_manifest.py", "v0.3.0", str(root), str(out)])
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/repo")
    updater_manifest.main()
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["version"] == "0.3.0"
    assert data["notes"]  # the Unreleased section of CHANGELOG.md
    assert data["platforms"]["windows-x86_64"]["url"].endswith("/v0.3.0/SecurePhotos_0.3.0_x64-setup.exe")


def test_main_refuses_an_installer_for_another_version(tmp_path, monkeypatch):
    root, _ = bundle(tmp_path)
    monkeypatch.setattr(sys, "argv", ["updater_manifest.py", "0.4.0", str(root), str(tmp_path / "latest.json")])
    with pytest.raises(SystemExit, match="not the installer for version 0.4.0"):
        updater_manifest.main()
