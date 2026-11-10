"""Dependency-free frontend and configuration contract checks."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "custom_components" / "ha_lists"


def test_options_translation_matches_config_key():
    strings = json.loads((INTEGRATION / "strings.json").read_text())
    assert strings["options"]["step"]["init"]["data"]["lists"]
