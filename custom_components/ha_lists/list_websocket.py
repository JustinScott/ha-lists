"""Authenticated list discovery, notifications and administrator operations."""

import asyncio

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import LIST_LOCK, SIGNAL_LISTS_UPDATED
from .list_management import (
    ListManagementError,
    active_entry,
    async_create_list,
    async_delete_list,
    set_list_visible,
    state_for_user,
)


@websocket_api.websocket_command({vol.Required("type"): "ha_lists/lists"})
@callback
def ws_lists(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Preserve the original read-only discovery response for existing clients."""
    connection.send_result(
        msg["id"], {"lists": state_for_user(hass, connection.user)["lists"]}
    )


@websocket_api.websocket_command({vol.Required("type"): "ha_lists/state"})
@callback
def ws_state(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Return configuration and role-appropriate management capabilities."""
    connection.send_result(msg["id"], state_for_user(hass, connection.user))


@websocket_api.websocket_command({vol.Required("type"): "ha_lists/subscribe"})
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Notify this authenticated connection with freshly permission-filtered state."""

    @callback
    def send_update() -> None:
        connection.send_message(
            websocket_api.event_message(
                msg["id"], state_for_user(hass, connection.user)
            )
        )

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_LISTS_UPDATED, send_update
    )
    connection.send_result(msg["id"])
    send_update()


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_lists/list/create",
        vol.Required("name"): vol.All(str, str.strip, vol.Length(min=1, max=255)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_create(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Create a Local To-do list and automatically bind its registered entity."""
    try:
        async with hass.data.setdefault(LIST_LOCK, asyncio.Lock()):
            result = await async_create_list(
                hass, active_entry(hass), connection.user, msg["name"]
            )
    except ListManagementError as err:
        connection.send_error(
            msg["id"],
            err.translation_key,
            str(err),
            translation_domain=err.translation_domain,
            translation_key=err.translation_key,
        )
        return
    connection.send_result(
        msg["id"], {**state_for_user(hass, connection.user), **result}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_lists/list/visibility",
        vol.Required("entity_id"): vol.All(cv.entity_id, vol.Match(r"^todo\.")),
        vol.Required("visible"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_visibility(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Connect an existing entity or remove it from the panel without deleting it."""
    try:
        async with hass.data.setdefault(LIST_LOCK, asyncio.Lock()):
            set_list_visible(
                hass,
                active_entry(hass),
                connection.user,
                msg["entity_id"],
                msg["visible"],
            )
    except ListManagementError as err:
        connection.send_error(
            msg["id"],
            err.translation_key,
            str(err),
            translation_domain=err.translation_domain,
            translation_key=err.translation_key,
        )
        return
    connection.send_result(msg["id"], state_for_user(hass, connection.user))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_lists/list/delete",
        vol.Required("entry_id"): str,
        vol.Required("confirm_name"): vol.All(str, vol.Length(min=1, max=255)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Delete a connected Local To-do entry, confirmed by stable ID/name."""
    try:
        async with hass.data.setdefault(LIST_LOCK, asyncio.Lock()):
            result = await async_delete_list(
                hass, active_entry(hass), msg["entry_id"], msg["confirm_name"]
            )
    except ListManagementError as err:
        connection.send_error(
            msg["id"],
            err.translation_key,
            str(err),
            translation_domain=err.translation_domain,
            translation_key=err.translation_key,
        )
        return
    connection.send_result(
        msg["id"], {**state_for_user(hass, connection.user), **result}
    )


def register_commands(hass: HomeAssistant) -> None:
    """Register process-wide handlers once alongside the frontend asset route."""
    for command in (
        ws_lists,
        ws_state,
        ws_subscribe,
        ws_create,
        ws_visibility,
        ws_delete,
    ):
        websocket_api.async_register_command(hass, command)
