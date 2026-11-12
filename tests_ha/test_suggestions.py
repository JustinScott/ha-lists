"""Observe native Local To-do behavior, persistence and catalog permissions."""

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from aiohttp import ClientWebSocketResponse
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant.common import MockConfigEntry
from pytest_homeassistant.typing import WebSocketGenerator

from custom_components.ha_lists.const import DOMAIN
from custom_components.ha_lists.suggestions import CATALOG, normalized
from tests_ha.test_list_management import (
    lists_entry as lists_entry,
)
from tests_ha.test_list_management import (
    owner_socket as owner_socket,
)
from tests_ha.test_list_management import (
    request,
    socket_for,
    tasks,
)
from tests_ha.test_persistence import running_hass


async def create(
    client: ClientWebSocketResponse, hass: HomeAssistant, name: str = "Catalog sample"
) -> str:
    result = await request(client, type="ha_lists/list/create", name=name)
    assert result["success"]
    await hass.async_block_till_done(wait_background_tasks=True)
    return result["result"]["entity_id"]


async def add(hass: HomeAssistant, entity_id: str, title: str) -> None:
    await hass.services.async_call(
        "todo", "add_item", {"entity_id": entity_id, "item": title}, blocking=True
    )
    await hass.async_block_till_done(wait_background_tasks=True)


async def query(
    client: ClientWebSocketResponse, entity_id: str, text: str = "", **extra: object
) -> dict:
    result = await request(
        client, type="ha_lists/suggestions", entity_id=entity_id, query=text, **extra
    )
    assert result["success"]
    return result["result"]


async def manage(
    client: ClientWebSocketResponse, entity_id: str, action: str, **extra: object
) -> dict:
    return await request(
        client,
        type="ha_lists/suggestions/manage",
        entity_id=entity_id,
        action=action,
        **extra,
    )


async def test_completed_seed_and_uid_deduplication_without_browser(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
) -> None:
    native = await hass.config_entries.flow.async_init(
        "local_todo", context={"source": "user"}, data={"todo_list_name": "Seed sample"}
    )
    native_id = native["result"].entry_id
    entity = next(
        item.entity_id
        for item in er.async_entries_for_config_entry(er.async_get(hass), native_id)
    )
    await add(hass, entity, "Milk")
    await add(hass, entity, "Active seed")
    milk = (await tasks(hass, entity))[0]
    await hass.services.async_call(
        "todo",
        "update_item",
        {"entity_id": entity, "item": milk["uid"], "status": "completed"},
        blocking=True,
    )
    await request(
        owner_socket, type="ha_lists/list/visibility", entity_id=entity, visible=True
    )
    await hass.async_block_till_done(wait_background_tasks=True)
    assert (await query(owner_socket, entity, "mi"))["suggestions"] == ["Milk"]
    assert (await query(owner_socket, entity, "active"))["suggestions"] == []
    catalog = hass.data[CATALOG]
    key = catalog.bindings[entity]
    original = catalog.data[key]["labels"]["milk"].copy()
    await catalog.refresh(entity)
    await catalog.refresh(entity)
    assert catalog.data[key]["labels"]["milk"] == original
    await hass.services.async_call(
        "todo", "remove_item", {"entity_id": entity, "item": milk["uid"]}, blocking=True
    )
    await hass.async_block_till_done(wait_background_tasks=True)
    assert (await query(owner_socket, entity, "MI"))["suggestions"] == ["Milk"]


async def test_observation_active_exclusion_rankings_and_controls(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
) -> None:
    entity = await create(owner_socket, hass)
    other = await create(owner_socket, hass, "Other catalog")
    for title in ["Milk", "Almond milk", "Milkshake", "MILK"]:
        await add(hass, entity, title)
    await add(hass, other, "Millet")
    assert (await query(owner_socket, entity, "mi"))["suggestions"] == []
    assert (await manage(owner_socket, entity, "exclude_active", value=False))[
        "success"
    ]
    assert (await query(owner_socket, entity, "mi"))["suggestions"] == [
        "MILK",
        "Milkshake",
        "Almond milk",
    ]
    assert (await query(owner_socket, other, "mi"))["suggestions"] == []
    before = await tasks(hass, entity)
    assert (await manage(owner_socket, entity, "forget", value=" milk "))["success"]
    assert (await query(owner_socket, entity, "mi"))["suggestions"] == [
        "Milkshake",
        "Almond milk",
    ]
    await hass.data[CATALOG].refresh(entity)
    assert (await query(owner_socket, entity, "milk"))["suggestions"] == [
        "Milkshake",
        "Almond milk",
    ]
    assert (await manage(owner_socket, entity, "clear"))["success"]
    await hass.data[CATALOG].refresh(entity)
    assert (await query(owner_socket, entity, "mi"))["suggestions"] == []
    assert await tasks(hass, entity) == before
    assert (await manage(owner_socket, entity, "learning", value=False))["success"]
    await add(hass, entity, "Disabled sample")
    assert (await manage(owner_socket, entity, "learning", value=True))["success"]
    await add(hass, entity, "Enabled sample")
    assert (await query(owner_socket, entity, "sample"))["suggestions"] == [
        "Enabled sample"
    ]
    assert (await manage(owner_socket, entity, "rebuild"))["success"]
    assert (await query(owner_socket, entity, "sample"))["suggestions"] == []
    assert normalized("  ＭＩＬＫ\t Carton ") == "milk carton"


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "ha_lists/suggestions", "entity_id": "light.fake", "query": "x"},
        {"type": "ha_lists/suggestions", "entity_id": "todo.fake", "query": "x" * 256},
        {
            "type": "ha_lists/suggestions/manage",
            "entity_id": "todo.fake",
            "action": "learning",
            "value": "yes",
        },
        {
            "type": "ha_lists/suggestions/manage",
            "entity_id": "todo.fake",
            "action": "forget",
        },
        {
            "type": "ha_lists/suggestions/manage",
            "entity_id": "todo.fake",
            "action": "clear",
            "value": True,
        },
    ],
)
async def test_invalid_catalog_commands(
    owner_socket: ClientWebSocketResponse, payload: dict
) -> None:
    assert not (await request(owner_socket, **payload))["success"]


async def test_catalog_permissions_and_unload(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
    hass_ws_client: WebSocketGenerator,
    lists_entry: MockConfigEntry,
) -> None:
    entity = await create(owner_socket, hass)
    await add(hass, entity, "Private sample")
    user = await hass.auth.async_create_user(
        "Synthetic reader", group_ids=["system-users"]
    )
    ordinary = await socket_for(hass, hass_ws_client, user)
    assert (await query(ordinary, entity))["count"] == 1
    assert not (await manage(ordinary, entity, "clear"))["success"]
    assert not (
        await request(
            ordinary,
            type="ha_lists/suggestions",
            entity_id=entity,
            query="",
            history=True,
        )
    )["success"]
    restricted = await hass.auth.async_create_user("Synthetic restricted user")
    restricted_socket = await socket_for(hass, hass_ws_client, restricted)
    denied = await request(
        restricted_socket,
        type="ha_lists/suggestions",
        entity_id=entity,
        query="Private",
    )
    assert denied["error"]["code"] == "unauthorized"
    catalog = hass.data[CATALOG]
    assert await hass.config_entries.async_unload(lists_entry.entry_id)
    assert not catalog.removers
    assert not catalog.running
    denied = await request(
        owner_socket, type="ha_lists/suggestions", entity_id=entity, query=""
    )
    assert denied["error"]["code"] == "unauthorized"
    original_tasks = await tasks(hass, entity)
    assert await hass.config_entries.async_remove(lists_entry.entry_id) == {
        "require_restart": False
    }
    replacement = (
        await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": "user"}, data={}
        )
    )["result"]
    hass.config_entries.async_update_entry(replacement, options={"lists": [entity]})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert (await query(owner_socket, entity))["count"] == 0
    assert await tasks(hass, entity) == original_tasks


async def test_unavailable_list_preserves_history_and_queries_do_not_read_provider(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entity = await create(owner_socket, hass)
    await add(hass, entity, "Retained sample")
    await manage(owner_socket, entity, "exclude_active", value=False)
    hass.states.async_set(entity, "unavailable")
    await hass.async_block_till_done(wait_background_tasks=True)
    reader = AsyncMock(side_effect=AssertionError("Typing must not read native tasks"))
    monkeypatch.setattr(type(hass.services), "async_call", reader)
    assert (await query(owner_socket, entity, "ret"))["suggestions"] == [
        "Retained sample"
    ]
    reader.assert_not_called()


async def test_catalog_and_seen_uids_survive_real_restart(tmp_path: Path) -> None:
    (tmp_path / ".storage").mkdir()
    async with running_hass(tmp_path) as first:
        native = (
            await first.config_entries.flow.async_init(
                "local_todo",
                context={"source": "user"},
                data={"todo_list_name": "Restart catalog"},
            )
        )["result"]
        app = (
            await first.config_entries.flow.async_init(
                DOMAIN, context={"source": "user"}, data={}
            )
        )["result"]
        entity = er.async_entries_for_config_entry(
            er.async_get(first), native.entry_id
        )[0].entity_id
        first.config_entries.async_update_entry(app, options={"lists": [entity]})
        await first.async_block_till_done(wait_background_tasks=True)
        await add(first, entity, "Restart milk")
        catalog = first.data[CATALOG]
        await catalog.manage(entity, "exclude_active", False)
        before = catalog.query(entity, "milk")
        native_id, app_id = native.entry_id, app.entry_id
    async with running_hass(tmp_path) as restarted:
        assert await restarted.config_entries.async_setup(native_id)
        assert await restarted.config_entries.async_setup(app_id)
        await restarted.async_block_till_done(wait_background_tasks=True)
        restored = restarted.data[CATALOG]
        assert restored.query(entity, "milk") == before
        key = restored.bindings[entity]
        assert restored.data[key]["labels"]["restart milk"]["count"] == 1


async def test_same_count_reports_reconcile_active_titles_and_native_deletion(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
) -> None:
    entity = await create(owner_socket, hass)
    await add(hass, entity, "Milk")
    catalog = hass.data[CATALOG]
    key = catalog.bindings[entity]
    item = (await tasks(hass, entity))[0]
    assert (await query(owner_socket, entity, "milk"))["suggestions"] == []
    await hass.services.async_call(
        "todo",
        "update_item",
        {"entity_id": entity, "item": item["uid"], "rename": "Renamed sample"},
        blocking=True,
    )
    await hass.async_block_till_done(wait_background_tasks=True)
    assert hass.states.get(entity).state == "1"
    assert (await query(owner_socket, entity, "milk"))["suggestions"] == ["Milk"]
    registry = er.async_get(hass)
    registry.async_update_entity(entity, new_entity_id="todo.renamed_catalog")
    app = hass.config_entries.async_entries(DOMAIN)[0]
    hass.config_entries.async_update_entry(
        app, options={"lists": ["todo.renamed_catalog"]}
    )
    await hass.async_block_till_done(wait_background_tasks=True)
    assert catalog.bindings["todo.renamed_catalog"] == key
    assert catalog.data[key]["labels"]["milk"]["count"] == 1
    native = hass.config_entries.async_get_entry(key)
    deleted = await request(
        owner_socket,
        type="ha_lists/list/delete",
        entry_id=key,
        confirm_name=native.title,
    )
    assert deleted["success"]
    await hass.async_block_till_done(wait_background_tasks=True)
    assert key not in catalog.data


async def test_native_assist_addition_is_observed_without_panel(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
) -> None:
    from homeassistant.components.todo import intent as todo_intent
    from homeassistant.helpers import intent

    entity = await create(owner_socket, hass)
    await todo_intent.async_setup_intents(hass)
    await intent.async_handle(
        hass,
        "test",
        "HassListAddItem",
        {
            "name": {"value": "Catalog sample"},
            "item": {"value": "Voice sample"},
        },
    )
    await hass.async_block_till_done(wait_background_tasks=True)
    result = await query(owner_socket, entity, "Voice", history=True)
    assert result["suggestions"] == ["Voice sample"]


async def test_native_read_failure_retains_history_and_save_failure_rolls_back(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entity = await create(owner_socket, hass)
    await add(hass, entity, "Preserved sample")
    catalog = hass.data[CATALOG]
    before = catalog.query(entity, "", history=True)
    with monkeypatch.context() as patch:
        patch.setattr(
            type(hass.services),
            "async_call",
            AsyncMock(side_effect=HomeAssistantError("Private synthetic exception")),
        )
        await catalog.refresh(entity)
    assert catalog.query(entity, "", history=True) == before

    with monkeypatch.context() as patch:
        patch.setattr(
            catalog.store,
            "async_save",
            AsyncMock(side_effect=HomeAssistantError("Synthetic save failure")),
        )
        with pytest.raises(HomeAssistantError):
            await catalog.manage(entity, "clear", None)
    assert catalog.query(entity, "", history=True) == before


@pytest.mark.parametrize(
    ("label_cap", "seen_cap", "expected", "full"),
    [(2000, 50000, 7, False), (3, 4, 3, True)],
)
async def test_catalog_limits_bound_history_and_results_without_changing_tasks(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
    monkeypatch: pytest.MonkeyPatch,
    label_cap: int,
    seen_cap: int,
    expected: int,
    full: bool,
) -> None:
    monkeypatch.setattr("custom_components.ha_lists.suggestions.MAX_LABELS", label_cap)
    monkeypatch.setattr("custom_components.ha_lists.suggestions.MAX_SEEN", seen_cap)
    entity = await create(owner_socket, hass)
    await manage(owner_socket, entity, "exclude_active", value=False)
    for number in range(7):
        await add(hass, entity, f"Bounded sample {number}")
    result = await query(owner_socket, entity, "Bounded")
    assert len(result["suggestions"]) == min(expected, 5)
    assert result["count"] == expected
    assert result["capacity_reached"] is full
    assert len(await tasks(hass, entity)) == 7
