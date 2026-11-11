"""Dependency-free contract tests for the integration scaffold."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "custom_components" / "ha_lists"


def test_manifest_has_local_config_flow() -> None:
    manifest = json.loads((INTEGRATION / "manifest.json").read_text())
    assert manifest["domain"] == "ha_lists"
    assert manifest["config_flow"] is True
    assert manifest["requirements"] == []
    assert "todo" in manifest["dependencies"]


def test_translation_source_is_valid_json() -> None:
    strings = json.loads((INTEGRATION / "strings.json").read_text())
    assert "user" in strings["config"]["step"]


def test_bundled_english_matches_translation_source() -> None:
    """Prevent stale config/options and exception messages in installed HA."""
    source = json.loads((INTEGRATION / "strings.json").read_text(encoding="utf-8"))
    bundled = json.loads(
        (INTEGRATION / "translations" / "en.json").read_text(encoding="utf-8")
    )
    assert bundled == source
