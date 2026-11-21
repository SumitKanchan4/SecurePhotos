"""Q1: guards against documentation drifting away from the code again."""

import json
import re
from pathlib import Path

import pytest

from engine.services.ai_models import MODELS

ROOT = Path(__file__).resolve().parents[2]
USER_DOCS = ["README.md", "SECURITY.md", "docs/architecture.md", "docs/development.md"]

# Claims that were false in earlier docs; they must not come back.
FALSE_CLAIMS = [
    r"military[- ]grade", r"bank[- ]grade", r"\bJWT\b", r"\bbcrypt\b", r"MobileCLIP", r"Moondream",
    r"BCryptGenRandom", r"\bTOTP\b", r"Windows Hello authentication", r"7-day TTL", r"never connects to the internet",
]


@pytest.mark.parametrize("doc", USER_DOCS)
def test_no_known_false_claims(doc):
    text = (ROOT / doc).read_text(encoding="utf-8")
    found = [p for p in FALSE_CLAIMS if re.search(p, text, re.IGNORECASE)]
    assert not found, f"{doc} contains outdated claims: {found}"


def test_react_version_in_docs_matches_package_json():
    deps = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["dependencies"]
    major = re.search(r"\d+", deps["react"]).group()
    for doc in ("docs/architecture.md", "docs/development.md"):
        mentioned = set(re.findall(r"React (\d+)", (ROOT / doc).read_text(encoding="utf-8")))
        assert mentioned == {major}, f"{doc} mentions React {mentioned}, package.json has {major}"


def test_every_bundled_model_and_font_has_its_licence_notice():
    notices = (ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    for spec in MODELS.values():
        assert spec["file"] in notices
    for name in ("## YuNet: MIT License", "## SFace: Apache License 2.0", "## Real-ESRGAN: BSD 3-Clause License",
                 "## Fonts: SIL Open Font License 1.1"):
        assert name in notices
    deps = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["dependencies"]
    for pkg in (d for d in deps if d.startswith("@fontsource/")):
        assert f"`{pkg}`" in notices, f"{pkg} is bundled but not listed"


def test_checklist_points_at_helpers_that_exist():
    rules = (ROOT / ".agents/rules/engineering-checklists.md").read_text(encoding="utf-8")
    code = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "engine").rglob("*.py") if "tests" not in p.parts)
    for helper in ("resolve_stored_path", "to_db_path", "vault_files", "imports", "ingest_single_photo", "purge_vault_key"):
        assert helper in rules and f"def {helper}" in code, helper
    for path in ("engine/services/ai_models.py", "scripts/fetch_models.py", "THIRD_PARTY_NOTICES.md"):
        assert path in rules and (ROOT / path).exists(), path


def test_ui_does_not_offer_a_24_word_recovery_phrase():
    """V1: setup creates an emergency card; the UI must not ask for a recovery phrase that never existed."""
    sources = [p for p in (ROOT / "src").rglob("*.tsx")] + [p for p in (ROOT / "src").rglob("*.ts")]
    offenders = [p.name for p in sources if re.search(r"24-word|recovery phrase", p.read_text(encoding="utf-8"), re.IGNORECASE)]
    assert not offenders, offenders
