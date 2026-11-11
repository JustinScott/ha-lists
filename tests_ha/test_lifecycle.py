"""Exercise the panel lifecycle through Home Assistant's public interfaces."""

from homeassistant.components import panel_custom
from homeassistant.core import HomeAssistant
from pytest_homeassistant.common import MockConfigEntry
from pytest_homeassistant.typing import WebSocketGenerator

from custom_components.ha_lists import ASSET_URL, PANEL_PATH
from custom_components.ha_lists.const import DOMAIN


async def panel_paths(client):
    """Read the frontend panel registry as an authenticated client."""
    await client.send_json_auto_id({"type": "get_panels"})
    response = await client.receive_json(timeout=5)
    assert response["success"]
    return response["result"]


async def test_config_entry_reload_restores_panel_and_static_asset(
    hass, hass_ws_client, hass_client
):
    """A real unload and setup restore the panel and its existing asset route."""
    entry = MockConfigEntry(domain=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    socket = await hass_ws_client(hass)
    assert PANEL_PATH in await panel_paths(socket)
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert PANEL_PATH not in await panel_paths(socket)
    assert await hass.config_entries.async_setup(entry.entry_id)
    assert PANEL_PATH in await panel_paths(socket)

    client = await hass_client()
    async with client.get(f"{ASSET_URL}/panel.js") as response:
        assert response.status == 200
        assert response.content_type in {"application/javascript", "text/javascript"}


async def test_partial_setup_can_recover(hass, hass_ws_client, monkeypatch):
    """A panel failure after route registration allows a later setup."""
    entry = MockConfigEntry(domain=DOMAIN)
    entry.add_to_hass(hass)

    async def fail_panel(*args, **kwargs):
        raise RuntimeError("Synthetic panel registration failure")

    with monkeypatch.context() as patch:
        patch.setattr(panel_custom, "async_register_panel", fail_panel)
        assert not await hass.config_entries.async_setup(entry.entry_id)

    socket = await hass_ws_client(hass)
    assert PANEL_PATH not in await panel_paths(socket)
    assert await hass.config_entries.async_reload(entry.entry_id)
    assert PANEL_PATH in await panel_paths(socket)


async def test_repeated_reload_and_unload_clear_discovery(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    """Process-wide routes remain usable while unloaded entries expose no lists."""
    entry = MockConfigEntry(domain=DOMAIN, options={"lists": ["todo.synthetic"]})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    client = await hass_ws_client(hass)
    for _ in range(3):
        assert await hass.config_entries.async_reload(entry.entry_id)
        assert PANEL_PATH in await panel_paths(client)
    assert await hass.config_entries.async_unload(entry.entry_id)
    await client.send_json_auto_id({"type": "ha_lists/lists"})
    result = await client.receive_json(timeout=5)
    assert result["success"]
    assert result["result"] == {"lists": []}
    assert await hass.config_entries.async_setup(entry.entry_id)
    await client.send_json_auto_id({"type": "ha_lists/lists"})
    result = await client.receive_json(timeout=5)
    assert result["result"] == {"lists": ["todo.synthetic"]}
