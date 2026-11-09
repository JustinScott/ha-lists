"""Contract checks for native to-do creation in the sidebar.

These checks supplement, but do not replace, browser and HA integration tests.
"""

from pathlib import Path

PANEL = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "ha_lists"
    / "frontend"
    / "panel.js"
)


def test_add_uses_native_todo_action():
    source = PANEL.read_text(encoding="utf-8")
    assert 'this._hass.callService("todo", "add_item"' in source
    assert "entity_id: entityId" in source
    assert "this._draft.trim()" in source
    assert "await this.loadItems()" in source


def test_add_handles_failure_and_double_submission():
    source = PANEL.read_text(encoding="utf-8")
    assert "this._adding || this._loading" in source
    assert "Unable to add task:" in source
    assert "this._adding = false;" in source
