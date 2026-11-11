"""Test configuration changes through HA options and authenticated WebSocket."""

from homeassistant import data_entry_flow
from pytest_homeassistant.common import MockConfigEntry

from custom_components.ha_lists.const import DOMAIN


async def test_options_updates_are_visible_on_same_connection(hass, hass_ws_client):
    """Each request reflects the current selection, including cleared options."""
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    client = await hass_ws_client(hass)

    async def visible_lists():
        await client.send_json_auto_id({"type": "ha_lists/lists"})
        response = await client.receive_json(timeout=5)
        assert response["success"]
        return response["result"]["lists"]

    assert await visible_lists() == []
    for selected in (["todo.groceries", "todo.hardware"], ["todo.hardware"], []):
        result = await hass.config_entries.options.async_init(entry.entry_id)
        assert result["type"] is data_entry_flow.FlowResultType.FORM
        result = await hass.config_entries.options.async_configure(
            result["flow_id"], {"lists": selected}
        )
        assert result["type"] is data_entry_flow.FlowResultType.CREATE_ENTRY
        assert await visible_lists() == selected
