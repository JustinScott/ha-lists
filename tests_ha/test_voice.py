"""Voice-assistant exposure for connected lists, through real HA WebSockets."""

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from aiohttp import ClientWebSocketResponse
from homeassistant.auth.models import User
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant.common import MockConfigEntry
from pytest_homeassistant.typing import WebSocketGenerator

from custom_components.ha_lists.const import DOMAIN
from tests_ha.test_list_management import (
    lists_entry as lists_entry,
)
from tests_ha.test_list_management import (
    owner_socket as owner_socket,
)
from tests_ha.test_list_management import request, socket_for


async def create(client: ClientWebSocketResponse, name: str) -> dict[str, Any]:
    response = await request(client, type="ha_lists/list/create", name=name)
    assert response["success"], response
    return response["result"]


def assist_setting(hass: HomeAssistant, entity_id: str) -> bool | None:
    options = er.async_get(hass).async_get(entity_id).options
    return options.get("conversation", {}).get("should_expose")


async def test_voice_section_is_absent_without_native_exposure_support(
    hass: HomeAssistant, owner_socket: ClientWebSocketResponse
) -> None:
    entity_id = (await create(owner_socket, "Groceries"))["entity_id"]
    state = await request(owner_socket, type="ha_lists/state")
    assert state["result"]["management"]["voice"] is None
    response = await request(
        owner_socket,
        type="ha_lists/list/voice",
        entity_id=entity_id,
        assistant="conversation",
        exposed=True,
    )
    assert response["error"]["code"] == "assistant_unavailable"


async def test_admin_exposes_and_hides_a_list_from_assist(
    hass: HomeAssistant, owner_socket: ClientWebSocketResponse
) -> None:
    assert await async_setup_component(hass, "homeassistant", {})
    created = await create(owner_socket, "Groceries")
    entity_id = created["entity_id"]
    voice = created["management"]["voice"]
    assert voice["assistants"] == [{"id": "conversation", "name": "Assist"}]
    assert set(voice["exposure"]) == {entity_id}

    for exposed in (True, False, True):
        response = await request(
            owner_socket,
            type="ha_lists/list/voice",
            entity_id=entity_id,
            assistant="conversation",
            exposed=exposed,
        )
        assert response["success"], response
        exposure = response["result"]["management"]["voice"]["exposure"]
        assert exposure[entity_id] == {"conversation": exposed}
        assert assist_setting(hass, entity_id) is exposed


async def test_voice_changes_are_validated(
    hass: HomeAssistant, owner_socket: ClientWebSocketResponse
) -> None:
    assert await async_setup_component(hass, "homeassistant", {})
    entity_id = (await create(owner_socket, "Groceries"))["entity_id"]
    before = assist_setting(hass, entity_id)
    cases = [
        (
            {"entity_id": "todo.not_connected", "assistant": "conversation"},
            "missing_list",
        ),
        ({"entity_id": entity_id, "assistant": "cloud.alexa"}, "assistant_unavailable"),
        ({"entity_id": entity_id, "assistant": "siri"}, "invalid_format"),
        ({"entity_id": "light.kitchen", "assistant": "conversation"}, "invalid_format"),
    ]
    for payload, code in cases:
        response = await request(
            owner_socket, type="ha_lists/list/voice", exposed=True, **payload
        )
        assert response["error"]["code"] == code, payload
    assert assist_setting(hass, entity_id) == before
    state = await request(owner_socket, type="ha_lists/state")
    assert (
        "todo.not_connected" not in state["result"]["management"]["voice"]["exposure"]
    )


async def test_ordinary_user_cannot_change_voice_exposure(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    owner_socket: ClientWebSocketResponse,
) -> None:
    assert await async_setup_component(hass, "homeassistant", {})
    entity_id = (await create(owner_socket, "Groceries"))["entity_id"]
    before = assist_setting(hass, entity_id)
    user = await hass.auth.async_create_user("Ordinary list user")
    client = await socket_for(hass, hass_ws_client, user)
    response = await request(
        client,
        type="ha_lists/list/voice",
        entity_id=entity_id,
        assistant="conversation",
        exposed=not before,
    )
    assert response["error"]["code"] == "unauthorized"
    assert assist_setting(hass, entity_id) == before
    state = await request(client, type="ha_lists/state")
    assert state["result"]["management"] is None


async def test_changes_from_home_assistant_settings_reach_open_panels(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    hass_owner_user: User,
    tmp_path: Path,
) -> None:
    # Core sets up its exposure settings before any custom integration loads.
    assert await async_setup_component(hass, "homeassistant", {})
    hass.config.config_dir = str(tmp_path)
    (tmp_path / ".storage").mkdir()
    lists_entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN)
    lists_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(lists_entry.entry_id)
    await hass.async_block_till_done()
    panel = await socket_for(hass, hass_ws_client, hass_owner_user)
    entity_id = (await create(panel, "Groceries"))["entity_id"]
    await panel.send_json_auto_id({"type": "ha_lists/subscribe"})
    subscription = (await panel.receive_json(timeout=5))["id"]
    await panel.receive_json(timeout=5)  # initial state event

    settings = await socket_for(hass, hass_ws_client, hass_owner_user)
    for exposed in (True, False):
        result = await request(
            settings,
            type="homeassistant/expose_entity",
            assistants=["conversation"],
            entity_ids=[entity_id],
            should_expose=exposed,
        )
        assert result["success"], result
        while True:
            event = await panel.receive_json(timeout=5)
            assert event["id"] == subscription
            voice = event["event"]["management"]["voice"]
            if voice["exposure"][entity_id]["conversation"] is exposed:
                break

    await hass.config_entries.async_unload(lists_entry.entry_id)
    await hass.async_block_till_done()
    await request(
        settings,
        type="homeassistant/expose_entity",
        assistants=["conversation"],
        entity_ids=[entity_id],
        should_expose=True,
    )
    await hass.async_block_till_done()


async def test_cloud_assistants_follow_home_assistant_cloud_preferences(
    hass: HomeAssistant, owner_socket: ClientWebSocketResponse
) -> None:
    """Alexa/Google appear only when signed in to HA Cloud and enabled there."""
    from homeassistant.components import cloud  # noqa: PLC0415

    assert await async_setup_component(hass, "homeassistant", {})
    entity_id = (await create(owner_socket, "Groceries"))["entity_id"]
    prefs = SimpleNamespace(alexa_enabled=True, google_enabled=False)
    hass.data[cloud.DATA_CLOUD] = SimpleNamespace(client=SimpleNamespace(prefs=prefs))
    hass.config.components.add("cloud")

    async def assistants() -> list[str]:
        state = await request(owner_socket, type="ha_lists/state")
        voice = state["result"]["management"]["voice"]
        return [assistant["id"] for assistant in voice["assistants"]]

    with patch.object(cloud, "async_is_logged_in", return_value=False):
        assert await assistants() == ["conversation"]
    with patch.object(cloud, "async_is_logged_in", return_value=True):
        assert await assistants() == ["conversation", "cloud.alexa"]
        prefs.google_enabled = True
        assert await assistants() == [
            "conversation",
            "cloud.alexa",
            "cloud.google_assistant",
        ]
        response = await request(
            owner_socket,
            type="ha_lists/list/voice",
            entity_id=entity_id,
            assistant="cloud.alexa",
            exposed=True,
        )
        assert response["success"], response
        exposure = response["result"]["management"]["voice"]["exposure"][entity_id]
        assert exposure["cloud.alexa"] is True
        options = er.async_get(hass).async_get(entity_id).options
        assert options["cloud.alexa"]["should_expose"] is True
