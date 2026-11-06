"""Dependency-free frontend and configuration contract checks."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "custom_components" / "ha_lists"


def test_options_translation_matches_config_key():
    strings = json.loads((INTEGRATION / "strings.json").read_text())
    assert strings["options"]["step"]["init"]["data"]["lists"]


def test_frontend_uses_authenticated_native_websocket():
    js = (INTEGRATION / "frontend" / "panel.js").read_text()
    assert 'type: "ha_lists/lists"' in js
    assert 'type: "todo/item/list"' in js
    assert "sendMessagePromise" in js
    assert "textContent" in js
    assert "this._requestId" in js


def test_no_production_endpoint_in_frontend():
    js = (INTEGRATION / "frontend" / "panel.js").read_text()
    assert "192.168." not in js
    assert "localhost:" not in js
    assert "https://api.openai.com" not in js
