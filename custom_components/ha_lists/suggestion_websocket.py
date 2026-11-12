"""Validated, permission-checked access to local suggestion history."""

import voluptuous as vol
from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers import config_validation as cv

from .suggestions import CATALOG, SuggestionCatalog


def catalog_for(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, entity_id: str
) -> SuggestionCatalog:
    """Check each request against current selection and native read permissions."""
    catalog = hass.data.get(CATALOG)
    if (
        catalog is None
        or entity_id not in catalog.bindings
        or not connection.user.permissions.check_entity(entity_id, POLICY_READ)
    ):
        raise Unauthorized()
    return catalog


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_lists/suggestions",
        vol.Required("entity_id"): vol.All(cv.entity_id, vol.Match(r"^todo\.")),
        vol.Required("query"): vol.All(str, vol.Length(max=255)),
        vol.Optional("history", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_suggestions(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Query cached labels without native provider reads or exposing other lists."""
    catalog = catalog_for(hass, connection, msg["entity_id"])
    if msg["history"] and not connection.user.is_admin:
        raise Unauthorized()
    connection.send_result(
        msg["id"], catalog.query(msg["entity_id"], msg["query"], history=msg["history"])
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_lists/suggestions/manage",
        vol.Required("entity_id"): vol.All(cv.entity_id, vol.Match(r"^todo\.")),
        vol.Required("action"): vol.In(
            ["forget", "clear", "rebuild", "learning", "exclude_active"]
        ),
        vol.Optional("value"): vol.Any(bool, vol.All(str, vol.Length(min=1, max=255))),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_manage_suggestions(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Administrators manage shared history; native tasks are untouched."""
    action, value = msg["action"], msg.get("value")
    if (
        (action in ("learning", "exclude_active") and type(value) is not bool)
        or (action == "forget" and not isinstance(value, str))
        or (action in ("clear", "rebuild") and value is not None)
    ):
        connection.send_error(
            msg["id"], "invalid_format", "Invalid suggestion setting value"
        )
        return
    catalog = catalog_for(hass, connection, msg["entity_id"])
    await catalog.manage(msg["entity_id"], action, value)
    connection.send_result(msg["id"], catalog.query(msg["entity_id"], ""))


def register_commands(hass: HomeAssistant) -> None:
    """Register alongside the process-wide panel routes."""
    websocket_api.async_register_command(hass, ws_suggestions)
    websocket_api.async_register_command(hass, ws_manage_suggestions)
