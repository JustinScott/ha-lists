"""Home Assistant Lists integration foundation."""

from __future__ import annotations

from pathlib import Path

import voluptuous as vol
from homeassistant.components import panel_custom
from homeassistant.components.frontend import async_remove_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, SupportsResponse
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import CONF_CREATED_ENTRIES, DOMAIN, SIGNAL_LISTS_UPDATED
from .list_websocket import register_commands
from .reminder_websocket import register_commands as register_reminder_commands
from .reminders import (
    REMINDERS,
    SERVICE_GET_DUE_TASKS,
    ReminderManager,
    async_get_due_tasks,
)
from .suggestion_websocket import register_commands as register_suggestion_commands
from .suggestions import CATALOG, SuggestionCatalog
from .voice import listen as listen_voice

PANEL_PATH = "ha-lists"
ASSET_URL = "/ha_lists_static"
ASSETS_REGISTERED = f"{DOMAIN}_assets_registered"
PANEL_ELEMENT = "ha-lists-panel"
GET_DUE_TASKS_SCHEMA = vol.Schema(
    {
        vol.Optional("include_overdue", default=False): cv.boolean,
        vol.Optional("entity_id", default=[]): vol.All(
            cv.ensure_list, [vol.All(cv.entity_id, vol.Match(r"^todo\."))]
        ),
    }
)


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
    if catalog := hass.data.get(CATALOG):
        catalog.sync()
    if reminders := hass.data.get(REMINDERS):
        reminders.sync()


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
        register_suggestion_commands(hass)
        register_reminder_commands(hass)
        # Process-wide like the commands; raises "not_loaded" while unloaded.
        hass.services.async_register(
            DOMAIN,
            SERVICE_GET_DUE_TASKS,
            async_get_due_tasks,
            schema=GET_DUE_TASKS_SCHEMA,
            supports_response=SupportsResponse.ONLY,
        )
        # HTTP routes and WebSocket commands live for the entire HA process.
        hass.data[ASSETS_REGISTERED] = True
    catalog = SuggestionCatalog(hass, entry)
    await catalog.async_load()
    reminders = ReminderManager(hass, entry)
    await reminders.async_load()
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
    hass.data[CATALOG] = catalog
    hass.data[REMINDERS] = reminders
    catalog.sync()
    reminders.sync()
    entry.async_on_unload(entry.add_update_listener(async_entry_updated))
    entry.async_on_unload(
        listen_voice(hass, lambda: async_dispatcher_send(hass, SIGNAL_LISTS_UPDATED))
    )
    async_dispatcher_send(hass, SIGNAL_LISTS_UPDATED)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Remove the sidebar panel when the entry unloads."""
    if catalog := hass.data.pop(CATALOG, None):
        await catalog.async_stop()
    if reminders := hass.data.pop(REMINDERS, None):
        await reminders.async_stop()
    if hass.data.pop(DOMAIN, None):
        async_remove_panel(hass, PANEL_PATH)
        async_dispatcher_send(hass, SIGNAL_LISTS_UPDATED)


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Remove our learned history on uninstall; native lists/tasks remain intact."""
    await Store(hass, 1, f"{DOMAIN}.suggestions").async_remove()
    await Store(hass, 1, f"{DOMAIN}.reminders").async_remove()
