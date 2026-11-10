"""Test the HA Lists WebSocket response and command schema."""

from homeassistant.auth.models import Group
from homeassistant.components import websocket_api
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_lists.const import DOMAIN


async def test_registered_command_uses_authenticated_websocket(hass, hass_ws_client):
    """Exercise the real HA WebSocket command dispatcher, not just the handler."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Lists",
        data={},
        options={"lists": ["todo.example"]},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
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
    entry = MockConfigEntry(domain=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
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
