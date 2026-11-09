"""Test the HA Lists WebSocket response and command schema."""

from unittest.mock import MagicMock

import pytest
import voluptuous as vol
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_lists import ws_lists
from custom_components.ha_lists.const import DOMAIN


async def test_lists_returns_selected_entities(hass):
    """The command returns the selected entity IDs from HA config entries."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Lists",
        data={},
        options={"lists": ["todo.groceries", "todo.hardware"]},
    )
    entry.add_to_hass(hass)
    connection = MagicMock()

    await ws_lists(hass, connection, {"id": 7, "type": "ha_lists/lists"})

    connection.send_result.assert_called_once_with(
        7, {"lists": ["todo.groceries", "todo.hardware"]}
    )


async def test_lists_returns_empty_when_not_configured(hass):
    """No config entry means no configured lists."""
    connection = MagicMock()
    await ws_lists(hass, connection, {"id": 8, "type": "ha_lists/lists"})
    connection.send_result.assert_called_once_with(8, {"lists": []})


def test_lists_command_rejects_unexpected_type():
    """The command schema rejects an unrelated WebSocket message type."""
    schema = ws_lists.__dict__.get("_ws_schema")
    if schema is None:
        pytest.skip("HA's websocket decorator does not expose its schema")
    with pytest.raises(vol.Invalid):
        schema({"id": 1, "type": "ha_lists/not_lists"})
