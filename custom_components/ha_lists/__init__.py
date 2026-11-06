"""Home Assistant Lists integration foundation."""

from __future__ import annotations

from pathlib import Path

import voluptuous as vol
from homeassistant.components import panel_custom, websocket_api
from homeassistant.components.frontend import async_remove_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN

PANEL_PATH = "ha-lists"
ASSET_URL = "/ha_lists_static"
PANEL_ELEMENT = "ha-lists-panel"
CONF_LISTS = "lists"


@websocket_api.websocket_command({vol.Required("type"): "ha_lists/lists"})
@websocket_api.async_response
async def ws_lists(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Return configured list IDs for an authenticated frontend."""
    entries = hass.config_entries.async_entries(DOMAIN)
    selected = entries[0].options.get(CONF_LISTS, []) if entries else []
    connection.send_result(msg["id"], {"lists": selected})


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Register the sidebar and authenticated configuration endpoint."""
    if not hass.data.get(DOMAIN):
        websocket_api.async_register_command(hass, ws_lists)
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    f"{ASSET_URL}/panel.js",
                    str(Path(__file__).parent / "frontend" / "panel.js"),
                    cache_headers=False,
                )
            ]
        )
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
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the sidebar panel when the entry unloads."""
    if hass.data.pop(DOMAIN, None):
        async_remove_panel(hass, PANEL_PATH)
    return True
