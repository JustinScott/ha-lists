"""Validated, permission-checked access to task reminder flags."""

from pathlib import Path

import voluptuous as vol
from homeassistant.auth.permissions.const import POLICY_CONTROL, POLICY_READ
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers import config_validation as cv

from .reminders import (
    BLUEPRINT_PATH,
    BLUEPRINT_SOURCE_URL,
    REMINDERS,
    ReminderManager,
    reminder_automations,
)

BLUEPRINT_FILE = (
    Path(__file__).parent / "blueprints" / "automation" / "task_reminders.yaml"
)
TODO_ENTITY = vol.All(cv.entity_id, vol.Match(r"^todo\."))


def manager_for(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    entity_id: str,
    policy: str,
) -> ReminderManager:
    """Only configured lists the user may read (or control, for changes)."""
    manager = hass.data.get(REMINDERS)
    if (
        manager is None
        or entity_id not in manager.bindings
        or not connection.user.permissions.check_entity(entity_id, policy)
    ):
        raise Unauthorized()
    return manager


def reminder_state(
    hass: HomeAssistant, manager: ReminderManager, entity_id: str
) -> dict:
    """Flags for one list plus whether reminder delivery is set up."""
    return {
        "uids": manager.enabled(entity_id),
        "automations": len(reminder_automations(hass)),
    }


@websocket_api.websocket_command(
    {vol.Required("type"): "ha_lists/reminders", vol.Required("entity_id"): TODO_ENTITY}
)
@websocket_api.async_response
async def ws_reminders(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Which tasks in a list have their bell on."""
    manager = manager_for(hass, connection, msg["entity_id"], POLICY_READ)
    connection.send_result(msg["id"], reminder_state(hass, manager, msg["entity_id"]))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_lists/reminder/set",
        vol.Required("entity_id"): TODO_ENTITY,
        vol.Required("uid"): vol.All(str, vol.Length(min=1, max=255)),
        vol.Required("enabled"): bool,
    }
)
@websocket_api.async_response
async def ws_set_reminder(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Toggle one task's bell; needs the same control permission as editing it."""
    manager = manager_for(hass, connection, msg["entity_id"], POLICY_CONTROL)
    await manager.set_enabled(msg["entity_id"], msg["uid"], msg["enabled"])
    connection.send_result(msg["id"], reminder_state(hass, manager, msg["entity_id"]))


@websocket_api.websocket_command({vol.Required("type"): "ha_lists/reminders/blueprint"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_blueprint(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Bundled blueprint for one-tap setup; the panel saves it via HA's API."""
    yaml = await hass.async_add_executor_job(BLUEPRINT_FILE.read_text, "utf-8")
    connection.send_result(
        msg["id"],
        {
            "path": BLUEPRINT_PATH,
            "yaml": yaml,
            "source_url": BLUEPRINT_SOURCE_URL,
        },
    )


def register_commands(hass: HomeAssistant) -> None:
    """Register alongside the process-wide panel routes."""
    websocket_api.async_register_command(hass, ws_reminders)
    websocket_api.async_register_command(hass, ws_set_reminder)
    websocket_api.async_register_command(hass, ws_blueprint)
