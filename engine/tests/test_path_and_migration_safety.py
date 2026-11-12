"""M1: a missing photo never resolves to another file with the same name.
M3: starting the engine never copies, moves or deletes the old ~/.securephotos_data folder.
"""

from pathlib import Path

from engine.config import AppConfig
from engine.services import media_paths


def _library(tmp_path: Path) -> AppConfig:
    data = tmp_path / "data"
    (data / "originals" / "2026" / "01").mkdir(parents=True)
    return AppConfig(data_dir=data)


def test_missing_photo_does_not_resolve_to_same_name_file(tmp_path):
    config = _library(tmp_path)
    other = config.data_dir / "beach.jpg"  # A different photo that happens to share the name.
    other.write_bytes(b"someone else's photo")

    resolved = config.resolve_media_path(r"Z:\Elsewhere\Pictures\beach.jpg")

    assert resolved != other
    assert not resolved.exists()


def test_missing_photo_under_known_folder_is_missing(tmp_path):
    """A moved-library path whose file is gone stays missing (no same-name guess)."""
    config = _library(tmp_path)
    (config.data_dir / "beach.jpg").write_bytes(b"different photo")

    resolved = config.resolve_media_path(r"Z:\OldVault\data\originals\2026\01\beach.jpg")

    assert not resolved.exists()


def test_moved_library_still_found(tmp_path):
    """The real recovery path (library moved / new drive letter) keeps working."""
    config = _library(tmp_path)
    photo = config.data_dir / "originals" / "2026" / "01" / "beach.jpg"
    photo.write_bytes(b"the right photo")

    assert config.resolve_media_path(r"Z:\OldVault\data\originals\2026\01\beach.jpg") == photo


def test_empty_stored_path_is_missing_not_working_folder(tmp_path):
    config = _library(tmp_path)
    for empty in ("", None):
        resolved = config.resolve_media_path(empty)
        assert not resolved.exists()  # Path() would be "." - the working folder, which exists.
        assert not resolved.is_dir()


def test_resolve_stored_path_rejects_same_name_file(tmp_path, monkeypatch):
    config = _library(tmp_path)
    (config.data_dir / "beach.jpg").write_bytes(b"different photo")
    monkeypatch.setattr(media_paths, "settings", config)
    monkeypatch.setattr(media_paths, "resolve_media_path", config.resolve_media_path)

    assert media_paths.resolve_stored_path(r"Z:\Elsewhere\beach.jpg") is None


def test_startup_leaves_old_dev_folder_untouched(tmp_path, monkeypatch):
    home = tmp_path / "home"
    legacy = home / ".securephotos_data"
    (legacy / "originals").mkdir(parents=True)
    (legacy / "originals" / "old.jpg").write_bytes(b"old dev photo")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    config = AppConfig(data_dir=tmp_path / "data")

    config.ensure_directories()

    assert (legacy / "originals" / "old.jpg").read_bytes() == b"old dev photo"
    assert not (config.data_dir / "originals" / "old.jpg").exists()
    assert (config.data_dir / "originals").is_dir() and (config.data_dir / "thumbnails").is_dir()
