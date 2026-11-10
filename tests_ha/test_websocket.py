"""Test the HA Lists WebSocket response and command schema."""

from unittest.mock import MagicMock

from homeassistant.auth.models import Group
from homeassistant.components import websocket_api
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_lists import ws_lists
from custom_components.ha_lists.const import DOMAIN


async def test_lists_returns_selected_entities(hass):
    """The command returns the selected entity IDs from HA config entries."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Lists",
        data={},
        options={"lists": ["todo.groceries", "todo.hardware"]},
    )
    entry.add_to_hass(hass)
    connection = MagicMock()

    ws_lists(hass, connection, {"id": 7, "type": "ha_lists/lists"})

    await hass.async_block_till_done()
    connection.send_result.assert_called_once_with(
        7, {"lists": ["todo.groceries", "todo.hardware"]}
    )


async def test_lists_returns_empty_when_not_configured(hass):
    """No config entry means no configured lists."""
    connection = MagicMock()
    ws_lists(hass, connection, {"id": 8, "type": "ha_lists/lists"})
    await hass.async_block_till_done()
    connection.send_result.assert_called_once_with(8, {"lists": []})


async def test_non_admin_receives_only_configured_entity_ids(hass):
    """The non-admin panel exposes configured IDs, never task contents."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Lists",
        data={},
        options={"lists": ["todo.example"]},
    )
    entry.add_to_hass(hass)
    connection = MagicMock()
    connection.user.is_admin = False

    ws_lists(hass, connection, {"id": 9, "type": "ha_lists/lists"})

    await hass.async_block_till_done()
    connection.send_result.assert_called_once_with(9, {"lists": ["todo.example"]})
    connection.send_error.assert_not_called()


async def test_registered_command_uses_authenticated_websocket(hass, hass_ws_client):
    """Exercise the real HA WebSocket command dispatcher, not just the handler."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Lists",
        data={},
        options={"lists": ["todo.example"]},
    )
    entry.add_to_hass(hass)
    websocket_api.async_register_command(hass, ws_lists)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "ha_lists/lists"})
    response = await client.receive_json()
    assert response == {
        "id": 1,
        "type": "result",
        "success": True,
        "result": {"lists": ["todo.example"]},
    }
    await client.send_json({"id": 2, "type": "ha_lists/not_lists"})
    invalid = await client.receive_json()
    assert invalid["id"] == 2
    assert invalid["success"] is False
    assert invalid["error"]["code"] == websocket_api.ERR_UNKNOWN_COMMAND


async def test_websocket_rejects_extra_payload(hass, hass_ws_client):
    """Reject unexpected arguments through the authenticated HA dispatcher."""
    websocket_api.async_register_command(hass, ws_lists)
    client = await hass_ws_client(hass)
    await client.send_json(
        {"id": 3, "type": "ha_lists/lists", "entity_id": "todo.other"}
    )
    response = await client.receive_json()
    assert response["id"] == 3
    assert response["success"] is False
    assert response["error"]["code"] == websocket_api.ERR_INVALID_FORMAT


async def test_discovery_uses_authenticated_users_entity_policy(
    hass, hass_ws_client, hass_owner_user
):
    """An authenticated user gets only configured lists they can read."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        options={"lists": ["todo.allowed", "todo.private"]},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    user = await hass.auth.async_create_user("Restricted reader")
    user.groups = [
        Group(
            name="Test readers",
            policy={
                "entities": {
                    "entity_ids": {
                        "todo.allowed": {"read": True},
                        "todo.unconfigured": {"read": True},
                    },
                },
            },
        )
    ]
    assert not user.is_admin
    refresh_token = await hass.auth.async_create_refresh_token(
        user, "https://example.com"
    )
    token = hass.auth.async_create_access_token(refresh_token)
    client = await hass_ws_client(hass, access_token=token)
    await client.send_json({"id": 1, "type": "ha_lists/lists"})
    assert await client.receive_json(timeout=5) == {
        "id": 1,
        "type": "result",
        "success": True,
        "result": {"lists": ["todo.allowed"]},
    }


async def test_websocket_rejects_invalid_authentication(hass, hass_client_no_auth):
    """The HA handshake rejects an invalid token before command dispatch."""
    entry = MockConfigEntry(domain=DOMAIN, options={"lists": ["todo.private"]})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    client = await hass_client_no_auth()
    async with client.ws_connect("/api/websocket") as socket:
        assert (await socket.receive_json(timeout=5))["type"] == "auth_required"
        await socket.send_json({"type": "auth", "access_token": "invalid-token"})
        assert (await socket.receive_json(timeout=5))["type"] == "auth_invalid"


async def test_non_admin_only_sees_authorized_entities(hass):
    """A restricted user must not receive configured but unreadable list IDs."""
    from homeassistant.auth.permissions.const import POLICY_READ

    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Lists",
        data={},
        options={"lists": ["todo.allowed", "todo.restricted"]},
    )
    entry.add_to_hass(hass)
    connection = MagicMock()
    connection.user.is_admin = False
    connection.user.permissions.check_entity.side_effect = lambda entity_id, policy: (
        policy == POLICY_READ and entity_id == "todo.allowed"
    )

    ws_lists(hass, connection, {"id": 10, "type": "ha_lists/lists"})
    await hass.async_block_till_done()
    connection.send_result.assert_called_once_with(10, {"lists": ["todo.allowed"]})
    connection.user.permissions.check_entity.assert_any_call(
        "todo.restricted", POLICY_READ
    )


async def test_no_entity_permissions_returns_no_lists(hass):
    """Configured entity IDs are not leaked to users without read access."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Lists",
        data={},
        options={"lists": ["todo.restricted"]},
    )
    entry.add_to_hass(hass)
    connection = MagicMock()
    connection.user.permissions.check_entity.return_value = False

    ws_lists(hass, connection, {"id": 11, "type": "ha_lists/lists"})
    await hass.async_block_till_done()
    connection.send_result.assert_called_once_with(11, {"lists": []})
