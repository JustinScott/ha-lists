"""Home Assistant Lists integration foundation."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import panel_custom
from homeassistant.components.frontend import async_remove_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import CONF_CREATED_ENTRIES, DOMAIN, SIGNAL_LISTS_UPDATED
from .list_websocket import register_commands

PANEL_PATH = "ha-lists"
ASSET_URL = "/ha_lists_static"
ASSETS_REGISTERED = f"{DOMAIN}_assets_registered"
PANEL_ELEMENT = "ha-lists-panel"


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Add optional management identity without changing list/task bindings."""
    if entry.version == 1 and entry.minor_version < 2:
        hass.config_entries.async_update_entry(
            entry,
            data={CONF_CREATED_ENTRIES: [], **entry.data},
            minor_version=2,
        )


async def async_entry_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Wake connected panels after configuration/options changes."""
    async_dispatcher_send(hass, SIGNAL_LISTS_UPDATED)


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
        register_commands(hass)
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
    entry.async_on_unload(entry.add_update_listener(async_entry_updated))
    async_dispatcher_send(hass, SIGNAL_LISTS_UPDATED)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Remove the sidebar panel when the entry unloads."""
    if hass.data.pop(DOMAIN, None):
        async_remove_panel(hass, PANEL_PATH)
        async_dispatcher_send(hass, SIGNAL_LISTS_UPDATED)
