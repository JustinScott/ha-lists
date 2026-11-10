"""Test options changes through the actual HA flow and WebSocket handler."""

from unittest.mock import MagicMock

from homeassistant import data_entry_flow
from homeassistant.auth.permissions.const import POLICY_READ
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_lists import ws_lists
from custom_components.ha_lists.const import DOMAIN


async def _visible_lists(hass, allowed):
    """Read the configured list IDs as a user with specific read permissions."""
    connection = MagicMock()
    connection.user.permissions.check_entity.side_effect = (
        lambda entity_id, policy: policy == POLICY_READ and entity_id in allowed
    )
    ws_lists(hass, connection, {"id": 42, "type": "ha_lists/lists"})
    await hass.async_block_till_done()
    connection.send_error.assert_not_called()
    connection.send_result.assert_called_once()
    return connection.send_result.call_args.args[1]["lists"]


async def _select_lists(hass, entry, selected):
    """Save list selection through HA's options flow, not by mutating options."""
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is data_entry_flow.FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"lists": selected}
    )
    assert result["type"] is data_entry_flow.FlowResultType.CREATE_ENTRY


async def test_options_updates_are_visible_without_reloading_panel(hass):
    """The next panel request reflects saved options, not cached initial data."""
    hass.states.async_set("todo.groceries", "0")
    hass.states.async_set("todo.hardware", "0")
    entry = MockConfigEntry(
        domain=DOMAIN, title="HA Lists", data={}, options={"lists": []},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    allowed = {"todo.groceries", "todo.hardware"}

    assert await _visible_lists(hass, allowed) == []
    await _select_lists(hass, entry, ["todo.groceries"])
    assert entry.options["lists"] == ["todo.groceries"]
    assert await _visible_lists(hass, allowed) == ["todo.groceries"]

    await _select_lists(hass, entry, ["todo.hardware"])
    assert entry.options["lists"] == ["todo.hardware"]
    assert await _visible_lists(hass, allowed) == ["todo.hardware"]

    await _select_lists(hass, entry, [])
    assert entry.options["lists"] == []
    assert await _visible_lists(hass, allowed) == []


async def test_options_update_never_exposes_unreadable_list(hass):
    """Changes to the selected lists must still respect entity permissions."""
    hass.states.async_set("todo.allowed", "0")
    hass.states.async_set("todo.private", "0")
    entry = MockConfigEntry(
        domain=DOMAIN, title="HA Lists", data={}, options={},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)

    await _select_lists(hass, entry, ["todo.allowed", "todo.private"])
    assert entry.options["lists"] == ["todo.allowed", "todo.private"]
    assert await _visible_lists(hass, {"todo.allowed"}) == ["todo.allowed"]
    assert await _visible_lists(hass, set()) == []
    assert await _visible_lists(hass, {"todo.allowed", "todo.private"}) == [
        "todo.allowed", "todo.private"
    ]
