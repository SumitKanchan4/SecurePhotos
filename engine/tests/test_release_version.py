"""Unit tests for release version detection, calculations, and synchronization."""

import pytest
import tempfile
from pathlib import Path

from scripts.release_version import (
    parse_semver,
    format_semver,
    calculate_next_version,
    sync_all_manifests,
)


def test_parse_semver_valid():
    assert parse_semver("0.1.0") == (0, 1, 0)
    assert parse_semver("v0.1.0") == (0, 1, 0)
    assert parse_semver("1.25.3") == (1, 25, 3)
    assert parse_semver("v2.0.0-rc1") == (2, 0, 0)


def test_parse_semver_invalid():
    with pytest.raises(ValueError):
        parse_semver("invalid")
    with pytest.raises(ValueError):
        parse_semver("1.0")


def test_format_semver():
    assert format_semver(0, 1, 0) == "0.1.0"
    assert format_semver(1, 0, 5) == "1.0.5"


def test_calculate_next_version_patch():
    assert calculate_next_version("0.1.0", "patch") == "0.1.1"
    assert calculate_next_version("0.0.11", "patch") == "0.0.12"
    assert calculate_next_version("1.9.9", "patch") == "1.9.10"


def test_calculate_next_version_minor():
    assert calculate_next_version("0.1.0", "minor") == "0.2.0"
    assert calculate_next_version("0.1.5", "minor") == "0.2.0"
    assert calculate_next_version("1.2.3", "minor") == "1.3.0"


def test_calculate_next_version_major():
    assert calculate_next_version("0.1.0", "major") == "1.0.0"
    assert calculate_next_version("1.4.2", "major") == "2.0.0"


def test_calculate_next_version_unsupported():
    with pytest.raises(ValueError):
        calculate_next_version("0.1.0", "custom")
    with pytest.raises(ValueError):
        calculate_next_version("0.1.0", "hotfix")


def test_sync_all_manifests_isolated_tempdir():
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        (root / "src-tauri").mkdir(parents=True)
        (root / "engine").mkdir(parents=True)
        (root / "src" / "components").mkdir(parents=True)

        pkg_json = root / "package.json"
        pkg_json.write_text('{\n  "version": "0.1.0"\n}\n', encoding="utf-8")

        tauri_conf = root / "src-tauri" / "tauri.conf.json"
        tauri_conf.write_text('{\n  "version": "0.1.0"\n}\n', encoding="utf-8")

        cargo_toml = root / "src-tauri" / "Cargo.toml"
        cargo_toml.write_text('[package]\nname = "securephotos"\nversion = "0.1.0"\n', encoding="utf-8")

        engine_cfg = root / "engine" / "config.py"
        engine_cfg.write_text('    app_version: str = "0.1.0"\n', encoding="utf-8")

        res = sync_all_manifests("0.1.0", "0.1.1", repo_dir=root, dry_run=False)
        assert res is True

        assert '"version": "0.1.1"' in pkg_json.read_text(encoding="utf-8")
        assert '"version": "0.1.1"' in tauri_conf.read_text(encoding="utf-8")
        assert 'version = "0.1.1"' in cargo_toml.read_text(encoding="utf-8")
        assert 'app_version: str = "0.1.1"' in engine_cfg.read_text(encoding="utf-8")
