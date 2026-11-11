"""Home Assistant Lists integration foundation."""

from __future__ import annotations

from pathlib import Path

import voluptuous as vol
from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.components import panel_custom, websocket_api
from homeassistant.components.frontend import async_remove_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN

PANEL_PATH = "ha-lists"
ASSET_URL = "/ha_lists_static"
ASSETS_REGISTERED = f"{DOMAIN}_assets_registered"
PANEL_ELEMENT = "ha-lists-panel"
CONF_LISTS = "lists"


@websocket_api.websocket_command({vol.Required("type"): "ha_lists/lists"})
@websocket_api.async_response
async def ws_lists(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Return configured list IDs for an authenticated frontend."""
    entries = hass.config_entries.async_entries(DOMAIN)
    selected = (
        entries[0].options.get(CONF_LISTS, [])
        if entries and hass.data.get(DOMAIN)
        else []
    )
    visible = [
        entity_id
        for entity_id in selected
        if connection.user.permissions.check_entity(entity_id, POLICY_READ)
    ]
    connection.send_result(msg["id"], {"lists": visible})


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Register the sidebar and authenticated configuration endpoint."""
    if hass.data.get(DOMAIN):
        return
    if not hass.data.get(ASSETS_REGISTERED):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    f"{ASSET_URL}/panel.js",
                    str(Path(__file__).parent / "frontend" / "panel.js"),
                    cache_headers=False,
                )
            ]
        )
        websocket_api.async_register_command(hass, ws_lists)
        # HTTP routes and WebSocket commands live for the entire HA process.
        hass.data[ASSETS_REGISTERED] = True
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_PATH,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title="Lists",
        sidebar_icon="mdi:format-list-checks",
        module_url=f"{ASSET_URL}/panel.js",
        require_admin=False,
    )
    hass.data[DOMAIN] = True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Remove the sidebar panel when the entry unloads."""
    if hass.data.pop(DOMAIN, None):
        async_remove_panel(hass, PANEL_PATH)
