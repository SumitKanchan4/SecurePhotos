"""H8: AI models are pinned (commit + SHA-256), bundled with the app, and never loaded unverified."""

import hashlib
import importlib.util
import io
import re
from pathlib import Path

import pytest

from engine.services import ai_models


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _spec(data: bytes) -> dict:
    return {"file": "model.onnx", "url": "https://example.invalid/model.onnx",
            "sha256": hashlib.sha256(data).hexdigest(), "license": "MIT"}


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    library, bundled = tmp_path / "library_models", tmp_path / "app" / "data" / "models"
    bundled.mkdir(parents=True)
    monkeypatch.setattr(ai_models, "get_bundled_models_dir", lambda: bundled)
    return library, bundled


def _no_download(monkeypatch):
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: pytest.fail("must not download"))


def test_every_model_is_pinned_to_a_commit_and_checksum():
    assert set(ai_models.MODELS) == {"yunet", "sface", "realesr"}
    for spec in ai_models.MODELS.values():
        assert re.search(r"/resolve/[0-9a-f]{40}/", spec["url"]), spec["url"]  # Not a moving branch like main.
        assert re.fullmatch(r"[0-9a-f]{64}", spec["sha256"])


def test_download_with_wrong_checksum_is_refused(dirs, monkeypatch):
    library, _ = dirs
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: FakeResponse(b"tampered model bytes"))
    with pytest.raises(IOError):
        ai_models.ensure_model(_spec(b"the real model"), library)
    assert list(library.iterdir()) == []  # Nothing partial or tampered is left behind.


def test_verified_copy_in_library_is_used_as_is(dirs, monkeypatch):
    library, _ = dirs
    library.mkdir()
    (library / "model.onnx").write_bytes(b"good")
    _no_download(monkeypatch)
    assert ai_models.ensure_model(_spec(b"good"), library) == library / "model.onnx"


def test_bundled_copy_is_used_offline(dirs, monkeypatch):
    """Fresh install or a library moved to another drive: the installer's copy is used, no internet needed."""
    library, bundled = dirs
    (bundled / "model.onnx").write_bytes(b"bundled model")
    _no_download(monkeypatch)
    path = ai_models.ensure_model(_spec(b"bundled model"), library)
    assert path == library / "model.onnx" and path.read_bytes() == b"bundled model"


def test_damaged_bundled_copy_is_not_used(dirs, monkeypatch):
    library, bundled = dirs
    (bundled / "model.onnx").write_bytes(b"damaged")
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda *a, **k: FakeResponse(b"real model"))
    path = ai_models.ensure_model(_spec(b"real model"), library)
    assert path.read_bytes() == b"real model"


def test_release_script_fetches_and_verifies_all_models(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[2] / "scripts" / "fetch_models.py"
    spec = importlib.util.spec_from_file_location("fetch_models", script)
    fetch_models = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fetch_models)

    fake = {name: f"model {name}".encode() for name in ai_models.MODELS}
    monkeypatch.setattr(fetch_models, "MODELS", {
        name: {**s, "sha256": hashlib.sha256(fake[name]).hexdigest()} for name, s in ai_models.MODELS.items()
    })
    by_url = {s["url"]: fake[name] for name, s in ai_models.MODELS.items()}
    monkeypatch.setattr(ai_models.urllib.request, "urlopen", lambda req, **k: FakeResponse(by_url[req.full_url]))
    (tmp_path / "placeholder.txt").write_text("placeholder")

    fetch_models.fetch_all(tmp_path)

    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(s["file"] for s in ai_models.MODELS.values())


def test_installer_bundles_the_build_folder_not_the_live_library():
    """The live data/models folder may hold other (e.g. retired, non-redistributable) models."""
    import json

    root = Path(__file__).resolve().parents[2]
    resources = json.loads((root / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8"))["bundle"]["resources"]
    assert resources.get("../build/models/*") == "data/models/"
    assert not any(src.startswith("../data/") for src in resources)
    assert resources.get("../THIRD_PARTY_NOTICES.md") == "THIRD_PARTY_NOTICES.md"  # Licences travel with the models.
    assert ai_models.get_bundled_models_dir() == root / "build" / "models"  # Development runs use the same folder.
