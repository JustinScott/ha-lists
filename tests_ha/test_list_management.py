"""Exercise list lifecycle through authenticated HA WebSockets and real Local To-do."""

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest
from aiohttp import ClientWebSocketResponse
from homeassistant import data_entry_flow
from homeassistant.auth.models import Group, User
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant.common import MockConfigEntry
from pytest_homeassistant.typing import WebSocketGenerator

from custom_components.ha_lists.const import CONF_CREATED_ENTRIES, DOMAIN
from custom_components.ha_lists.list_management import async_create_list
from tests_ha.test_persistence import running_hass


async def request(client: ClientWebSocketResponse, **payload: Any) -> dict[str, Any]:
    """Send one command on a socket without configuration subscriptions."""
    await client.send_json_auto_id(payload)
    return await client.receive_json(timeout=5)


async def socket_for(
    hass: HomeAssistant, generator: WebSocketGenerator, user: User
) -> ClientWebSocketResponse:
    """Authenticate an explicit owner or ordinary user."""
    refresh = await hass.auth.async_create_refresh_token(user, "https://example.com")
    return await generator(
        hass, access_token=hass.auth.async_create_access_token(refresh)
    )


@pytest.fixture
async def lists_entry(hass: HomeAssistant, tmp_path: Path) -> MockConfigEntry:
    """Keep all native config and task storage in synthetic temporary storage."""
    hass.config.config_dir = str(tmp_path)
    (tmp_path / ".storage").mkdir()
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


@pytest.fixture
async def owner_socket(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    hass_owner_user: User,
    lists_entry: MockConfigEntry,
) -> ClientWebSocketResponse:
    """An administrator connection independent of ordinary-user fixtures."""
    return await socket_for(hass, hass_ws_client, hass_owner_user)


async def tasks(hass: HomeAssistant, entity_id: str) -> list[dict[str, Any]]:
    result = await hass.services.async_call(
        "todo",
        "get_items",
        {"entity_id": entity_id},
        blocking=True,
        return_response=True,
    )
    return result[entity_id]["items"]


async def test_create_connect_hide_and_delete_preserve_other_native_lists(
    hass: HomeAssistant,
    lists_entry: MockConfigEntry,
    owner_socket: ClientWebSocketResponse,
    tmp_path: Path,
) -> None:
    """Resolve actual registry IDs; hiding is reversible and deletion is scoped."""
    registry = er.async_get(hass)
    occupied = registry.async_get_or_create(
        "todo", "synthetic", "occupied", suggested_object_id="synthetic_groceries"
    )
    hass.states.async_set(occupied.entity_id, "0")
    created = await request(
        owner_socket, type="ha_lists/list/create", name="  Synthetic groceries  "
    )
    assert created["success"]
    result = created["result"]
    entity_id = result["entity_id"]
    native_id = result["created_entry_id"]
    assert entity_id != occupied.entity_id
    assert registry.async_get(entity_id).config_entry_id == native_id
    assert lists_entry.options["lists"] == [entity_id]
    assert lists_entry.data[CONF_CREATED_ENTRIES] == [native_id]
    await hass.services.async_call(
        "todo",
        "add_item",
        {
            "entity_id": entity_id,
            "item": "Synthetic task",
            "description": "Keep identity",
        },
        blocking=True,
    )
    original = await tasks(hass, entity_id)
    native = hass.config_entries.async_get_entry(native_id)
    path = tmp_path / ".storage" / f"local_todo.{native.data['storage_key']}.ics"
    assert path.exists()
    hidden = await request(
        owner_socket,
        type="ha_lists/list/visibility",
        entity_id=entity_id,
        visible=False,
    )
    assert hidden["success"] and hidden["result"]["lists"] == []
    assert await tasks(hass, entity_id) == original
    assert hass.config_entries.async_get_entry(native_id) is native
    shown = await request(
        owner_socket, type="ha_lists/list/visibility", entity_id=entity_id, visible=True
    )
    assert shown["success"] and shown["result"]["lists"] == [entity_id]
    external_flow = await hass.config_entries.flow.async_init(
        "local_todo",
        context={"source": "user"},
        data={"todo_list_name": "External sample"},
    )
    external = external_flow["result"]
    external_id = er.async_entries_for_config_entry(registry, external.entry_id)[
        0
    ].entity_id
    denied = await request(
        owner_socket,
        type="ha_lists/list/delete",
        entry_id=external.entry_id,
        confirm_name=external.title,
    )
    assert denied["error"]["code"] == "not_deletable"
    linked = await request(
        owner_socket,
        type="ha_lists/list/visibility",
        entity_id=external_id,
        visible=True,
    )
    assert linked["success"]
    assert (
        linked["result"]["management"]["deletable"][external_id]["entry_id"]
        == external.entry_id
    )
    assert hass.config_entries.async_get_entry(external.entry_id) is external
    wrong_name = await request(
        owner_socket,
        type="ha_lists/list/delete",
        entry_id=native_id,
        confirm_name="Wrong name",
    )
    assert wrong_name["error"]["code"] == "confirmation_changed"
    assert await tasks(hass, entity_id) == original
    deleted = await request(
        owner_socket,
        type="ha_lists/list/delete",
        entry_id=native_id,
        confirm_name="Synthetic groceries",
    )
    assert deleted["success"] and not deleted["result"]["require_restart"]
    assert deleted["result"]["lists"] == [external_id]
    assert lists_entry.data[CONF_CREATED_ENTRIES] == []
    assert hass.config_entries.async_get_entry(native_id) is None
    assert registry.async_get(entity_id) is None
    assert hass.states.get(entity_id) is None
    assert not path.exists()
    assert hass.config_entries.async_get_entry(external.entry_id) is external
    assert hass.states.get(occupied.entity_id) is not None
    removed_external = await request(
        owner_socket,
        type="ha_lists/list/delete",
        entry_id=external.entry_id,
        confirm_name=external.title,
    )
    assert removed_external["success"]
    assert hass.config_entries.async_get_entry(external.entry_id) is None


async def test_duplicates_and_invalid_names_never_adopt_or_remove_existing_lists(
    hass: HomeAssistant, owner_socket: ClientWebSocketResponse
) -> None:
    created = await request(
        owner_socket, type="ha_lists/list/create", name="Existing sample"
    )
    duplicate = await request(
        owner_socket, type="ha_lists/list/create", name="Existing sample"
    )
    assert duplicate["error"]["code"] == "list_exists"
    invalid = await request(owner_socket, type="ha_lists/list/create", name="!!!")
    assert invalid["error"]["code"] == "invalid_name"
    missing = await request(
        owner_socket,
        type="ha_lists/list/visibility",
        entity_id="todo.missing",
        visible=True,
    )
    assert missing["error"]["code"] == "missing_list"
    hidden = await request(
        owner_socket,
        type="ha_lists/list/visibility",
        entity_id="todo.missing",
        visible=False,
    )
    assert hidden["success"]
    assert len(hass.config_entries.async_entries("local_todo")) == 1
    assert (
        hass.config_entries.async_get_entry(created["result"]["created_entry_id"])
        is not None
    )


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"type": "ha_lists/list/create", "name": " "}, id="blank"),
        pytest.param({"type": "ha_lists/list/create", "name": "x" * 256}, id="long"),
        pytest.param(
            {"type": "ha_lists/list/create", "name": 42}, id="wrong-name-type"
        ),
        pytest.param(
            {"type": "ha_lists/list/create", "name": "Sample", "domain": "other"},
            id="forged-provider",
        ),
        pytest.param(
            {
                "type": "ha_lists/list/visibility",
                "entity_id": "light.sample",
                "visible": True,
            },
            id="wrong-domain",
        ),
        pytest.param(
            {
                "type": "ha_lists/list/visibility",
                "entity_id": "todo.sample",
                "visible": "false",
            },
            id="wrong-boolean",
        ),
        pytest.param(
            {"type": "ha_lists/list/delete", "entry_id": "sample"},
            id="missing-confirmation",
        ),
    ],
)
async def test_malformed_management_commands_are_rejected(
    hass: HomeAssistant, owner_socket: ClientWebSocketResponse, payload: dict[str, Any]
) -> None:
    response = await request(owner_socket, **payload)
    assert not response["success"]
    assert response["error"]["code"] == "invalid_format"
    assert hass.config_entries.async_entries("local_todo") == []
    assert (await request(owner_socket, type="ha_lists/state"))["success"]


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"type": "ha_lists/list/create", "name": "Sample"}, id="create"),
        pytest.param(
            {
                "type": "ha_lists/list/visibility",
                "entity_id": "todo.sample",
                "visible": False,
            },
            id="hide",
        ),
        pytest.param(
            {
                "type": "ha_lists/list/delete",
                "entry_id": "sample",
                "confirm_name": "Sample",
            },
            id="delete",
        ),
    ],
)
@pytest.mark.usefixtures("lists_entry")
async def test_ordinary_user_cannot_forge_administrator_operations(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    payload: dict[str, Any],
) -> None:
    user = await hass.auth.async_create_user("Ordinary list user")
    client = await socket_for(hass, hass_ws_client, user)
    response = await request(client, **payload)
    assert response["error"]["code"] == "unauthorized"
    assert hass.config_entries.async_entries("local_todo") == []
    state = await request(client, type="ha_lists/state")
    assert state["result"] == {"lists": [], "management": None}


async def test_configuration_subscription_filters_permissions_and_unsubscribes(
    hass: HomeAssistant,
    lists_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    user = await hass.auth.async_create_user("Restricted list reader")
    user.groups = [
        Group(
            name="Synthetic readers",
            policy={"entities": {"entity_ids": {"todo.allowed": {"read": True}}}},
        )
    ]
    hass.config_entries.async_update_entry(
        lists_entry, options={"lists": ["todo.allowed", "todo.private"]}
    )
    await hass.async_block_till_done()
    client = await socket_for(hass, hass_ws_client, user)
    await client.send_json({"id": 1, "type": "ha_lists/subscribe"})
    assert (await client.receive_json())["success"]
    initial = await client.receive_json()
    assert initial["event"] == {"lists": ["todo.allowed"], "management": None}
    hass.config_entries.async_update_entry(
        lists_entry, options={"lists": ["todo.private"]}
    )
    await hass.async_block_till_done()
    assert (await client.receive_json())["event"] == {"lists": [], "management": None}
    await client.send_json({"id": 2, "type": "unsubscribe_events", "subscription": 1})
    assert (await client.receive_json())["success"]
    hass.config_entries.async_update_entry(
        lists_entry, options={"lists": ["todo.allowed"]}
    )
    await hass.async_block_till_done()
    await client.send_json({"id": 3, "type": "ha_lists/state"})
    assert (await client.receive_json())["id"] == 3
    await client.send_json({"id": 4, "type": "ha_lists/subscribe"})
    assert (await client.receive_json())["success"]
    await client.receive_json()
    assert await hass.config_entries.async_unload(lists_entry.entry_id)
    assert (await client.receive_json())["event"] == {"lists": [], "management": None}


async def test_failed_native_setup_is_kept_for_recovery(
    hass: HomeAssistant,
    lists_entry: MockConfigEntry,
    owner_socket: ClientWebSocketResponse,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_setup = hass.config_entries.async_setup

    async def no_native_setup(entry_id: str) -> bool:
        if hass.config_entries.async_get_entry(entry_id).domain == "local_todo":
            return False
        return await original_setup(entry_id)

    with monkeypatch.context() as patch:
        patch.setattr(hass.config_entries, "async_setup", no_native_setup)
        response = await request(
            owner_socket, type="ha_lists/list/create", name="Pending sample"
        )
    assert response["success"]
    result = response["result"]
    native_id = result["created_entry_id"]
    assert result["entity_id"] is None
    assert result["management"]["pending"] == [
        {"entry_id": native_id, "name": "Pending sample"}
    ]
    assert lists_entry.data[CONF_CREATED_ENTRIES] == [native_id]
    assert await hass.config_entries.async_setup(native_id)
    recovered_id = er.async_entries_for_config_entry(er.async_get(hass), native_id)[
        0
    ].entity_id
    assert (
        await request(
            owner_socket,
            type="ha_lists/list/visibility",
            entity_id=recovered_id,
            visible=True,
        )
    )["success"]
    state = await request(owner_socket, type="ha_lists/state")
    assert state["result"]["management"]["pending"] == []
    assert len(state["result"]["management"]["deletable"]) == 1


async def test_unexpected_interactive_flow_is_aborted_without_deleting_data(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    abort = Mock()
    monkeypatch.setattr(
        hass.config_entries.flow,
        "async_init",
        AsyncMock(
            return_value={
                "type": data_entry_flow.FlowResultType.FORM,
                "flow_id": "synthetic",
            }
        ),
    )
    monkeypatch.setattr(hass.config_entries.flow, "async_abort", abort)
    response = await request(owner_socket, type="ha_lists/list/create", name="Sample")
    assert response["error"]["code"] == "cannot_create"
    abort.assert_called_once_with("synthetic")


async def test_unloaded_entry_rejects_management_and_minor_migration_preserves_options(
    hass: HomeAssistant,
    lists_entry: MockConfigEntry,
    owner_socket: ClientWebSocketResponse,
) -> None:
    assert lists_entry.minor_version == 2
    assert lists_entry.data[CONF_CREATED_ENTRIES] == []
    assert await hass.config_entries.async_unload(lists_entry.entry_id)
    for payload in (
        {"type": "ha_lists/list/create", "name": "Sample"},
        {
            "type": "ha_lists/list/visibility",
            "entity_id": "todo.sample",
            "visible": False,
        },
        {
            "type": "ha_lists/list/delete",
            "entry_id": "sample",
            "confirm_name": "Sample",
        },
    ):
        response = await request(owner_socket, **payload)
        assert response["error"]["code"] == "not_loaded"
    assert (await request(owner_socket, type="ha_lists/state"))["result"] == {
        "lists": [],
        "management": None,
    }


async def test_legacy_provider_binding_is_preserved_but_new_management_is_local_only(
    hass: HomeAssistant,
    lists_entry: MockConfigEntry,
    owner_socket: ClientWebSocketResponse,
) -> None:
    foreign = MockConfigEntry(domain="synthetic_provider", title="Foreign sample")
    foreign.add_to_hass(hass)
    entity = er.async_get(hass).async_get_or_create(
        "todo", "synthetic_provider", "synthetic-list", config_entry=foreign
    )
    hass.states.async_set(entity.entity_id, "0", {"friendly_name": "Foreign sample"})
    hass.config_entries.async_update_entry(
        lists_entry,
        data={CONF_CREATED_ENTRIES: [foreign.entry_id, "missing"]},
        options={"lists": [entity.entity_id]},
    )
    state = await request(owner_socket, type="ha_lists/state")
    assert state["result"]["lists"] == [entity.entity_id]
    assert state["result"]["management"]["available"] == []
    assert state["result"]["management"]["deletable"] == {}
    refused = await request(
        owner_socket,
        type="ha_lists/list/visibility",
        entity_id=entity.entity_id,
        visible=True,
    )
    assert refused["error"]["code"] == "local_only"
    assert lists_entry.options["lists"] == [entity.entity_id]
    response = await request(
        owner_socket,
        type="ha_lists/list/delete",
        entry_id=foreign.entry_id,
        confirm_name=foreign.title,
    )
    assert response["error"]["code"] == "not_deletable"
    assert hass.config_entries.async_get_entry(foreign.entry_id) is foreign
    hidden = await request(
        owner_socket,
        type="ha_lists/list/visibility",
        entity_id=entity.entity_id,
        visible=False,
    )
    assert hidden["success"]
    assert lists_entry.options["lists"] == []
    assert hass.states.get(entity.entity_id) is not None


async def test_failed_native_removal_preserves_selection_identity_and_tasks(
    hass: HomeAssistant,
    lists_entry: MockConfigEntry,
    owner_socket: ClientWebSocketResponse,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = (
        await request(
            owner_socket, type="ha_lists/list/create", name="Recoverable sample"
        )
    )["result"]
    entity_id = created["entity_id"]
    native_id = created["created_entry_id"]
    await hass.services.async_call(
        "todo",
        "add_item",
        {"entity_id": entity_id, "item": "Preserved task"},
        blocking=True,
    )
    original = await tasks(hass, entity_id)
    monkeypatch.setattr(
        hass.config_entries,
        "async_remove",
        AsyncMock(side_effect=HomeAssistantError("Synthetic removal failure")),
    )
    failed = await request(
        owner_socket,
        type="ha_lists/list/delete",
        entry_id=native_id,
        confirm_name="Recoverable sample",
    )
    assert failed["error"]["code"] == "home_assistant_error"
    assert lists_entry.options["lists"] == [entity_id]
    assert lists_entry.data[CONF_CREATED_ENTRIES] == [native_id]
    assert hass.config_entries.async_get_entry(native_id) is not None
    assert await tasks(hass, entity_id) == original


async def test_minor_migration_preserves_legacy_data_and_bindings(
    hass: HomeAssistant,
) -> None:
    legacy = MockConfigEntry(
        domain=DOMAIN,
        unique_id=DOMAIN,
        version=1,
        minor_version=1,
        data={"preserved": "value"},
        options={"lists": ["todo.existing"]},
    )
    legacy.add_to_hass(hass)
    assert await hass.config_entries.async_setup(legacy.entry_id)
    assert legacy.minor_version == 2
    assert legacy.data == {"preserved": "value", CONF_CREATED_ENTRIES: []}
    assert legacy.options == {"lists": ["todo.existing"]}


async def test_management_identity_and_tasks_survive_restart(tmp_path: Path) -> None:
    """Restore actual config entries and native storage in a fresh HA instance."""
    (tmp_path / ".storage").mkdir()
    async with running_hass(tmp_path) as first:
        app_flow = await first.config_entries.flow.async_init(
            DOMAIN, context={"source": "user"}, data={}
        )
        app = app_flow["result"]
        user = await first.auth.async_create_user("Synthetic creator")

        created = await async_create_list(first, app, user, "Restart sample")
        entity_id = created["entity_id"]
        native_id = created["created_entry_id"]
        app_id = app.entry_id
        await first.services.async_call(
            "todo",
            "add_item",
            {"entity_id": entity_id, "item": "Restart task"},
            blocking=True,
        )
        original = await tasks(first, entity_id)
    async with running_hass(tmp_path) as restarted:
        assert await restarted.config_entries.async_setup(native_id)
        assert await restarted.config_entries.async_setup(app_id)
        restored = restarted.config_entries.async_get_entry(app_id)
        assert restored.data[CONF_CREATED_ENTRIES] == [native_id]
        assert restored.options["lists"] == [entity_id]
        assert await tasks(restarted, entity_id) == original
