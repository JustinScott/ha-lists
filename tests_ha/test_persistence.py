"""Exercise disk-backed HA configuration and Local To-do task persistence."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import pytest
from homeassistant import data_entry_flow, loader
from homeassistant.config_entries import SOURCE_USER, ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant.common import async_test_home_assistant

from custom_components.ha_lists.const import DOMAIN

LIST_ID = "todo.groceries"


@asynccontextmanager
async def running_hass(config_dir: Path) -> AsyncIterator[HomeAssistant]:
    """Use real storage and reinitialize config entries for each HA instance."""
    async with async_test_home_assistant(config_dir=str(config_dir)) as hass:
        hass.data.pop(loader.DATA_CUSTOM_COMPONENTS)
        await hass.config_entries.async_initialize()
        try:
            yield hass
        finally:
            await hass.async_stop(force=True)


async def get_tasks(hass: HomeAssistant) -> list[dict]:
    """Read tasks through Home Assistant's public To-do action."""
    result = await hass.services.async_call(
        "todo", "get_items", {"entity_id": LIST_ID}, blocking=True, return_response=True
    )
    return result[LIST_ID]["items"]


@pytest.mark.parametrize(
    ("due_field", "due_value"),
    [("due_date", "2030-04-06"), ("due_datetime", "2030-07-05T10:30:47-05:00")],
)
async def test_selected_list_and_tasks_survive_home_assistant_restart(
    due_field: str,
    due_value: str,
    tmp_path: Path,
) -> None:
    """A fresh HA instance restores list binding, task identity, and metadata."""
    (tmp_path / ".storage").mkdir()
    async with running_hass(tmp_path) as first:
        local = await first.config_entries.flow.async_init(
            "local_todo",
            context={"source": SOURCE_USER},
            data={"todo_list_name": "Groceries"},
        )
        lists = await first.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_USER}
        )
        lists = await first.config_entries.flow.async_configure(lists["flow_id"], {})
        assert local["type"] is data_entry_flow.FlowResultType.CREATE_ENTRY
        assert lists["type"] is data_entry_flow.FlowResultType.CREATE_ENTRY
        local_id = local["result"].entry_id
        lists_id = lists["result"].entry_id
        options = await first.config_entries.options.async_init(lists_id)
        saved = await first.config_entries.options.async_configure(
            options["flow_id"], {"lists": [LIST_ID]}
        )
        assert saved["type"] is data_entry_flow.FlowResultType.CREATE_ENTRY

        await first.services.async_call(
            "todo",
            "add_item",
            {
                "entity_id": LIST_ID,
                "item": "Apples",
                "description": "Two green apples",
                "due_date": "2030-04-05",
            },
            blocking=True,
        )
        [created] = await get_tasks(first)
        assert first.states.get(LIST_ID).state == "1"
        await first.services.async_call(
            "todo",
            "update_item",
            {"entity_id": LIST_ID, "item": created["uid"], "status": "completed"},
            blocking=True,
        )
        await first.services.async_call(
            "todo",
            "update_item",
            {
                "entity_id": LIST_ID,
                "item": created["uid"],
                "rename": "Green apples",
                "description": "Updated shopping note",
                due_field: due_value,
            },
            blocking=True,
        )
        await first.services.async_call(
            "todo",
            "add_item",
            {"entity_id": LIST_ID, "item": "Green apples"},
            blocking=True,
        )
        duplicate = next(
            task for task in await get_tasks(first) if task["uid"] != created["uid"]
        )
        await first.services.async_call(
            "todo",
            "remove_item",
            {"entity_id": LIST_ID, "item": duplicate["uid"]},
            blocking=True,
        )
        assert first.states.get(LIST_ID).state == "0"

    async with running_hass(tmp_path) as restarted:
        assert restarted is not first
        assert await restarted.config_entries.async_setup(local_id)
        assert await restarted.config_entries.async_setup(lists_id)
        entry = restarted.config_entries.async_get_entry(lists_id)
        assert entry.state is ConfigEntryState.LOADED
        assert entry.options["lists"] == [LIST_ID]
        [restored] = await get_tasks(restarted)
        assert restored["uid"] == created["uid"]
        assert restored["summary"] == "Green apples"
        assert restored["description"] == "Updated shopping note"
        if due_field == "due_datetime":
            assert datetime.fromisoformat(restored["due"]) == datetime.fromisoformat(
                due_value
            )
        else:
            assert restored["due"] == due_value
        assert restored["status"] == "completed"
        assert restarted.states.get(LIST_ID).state == "0"


async def test_read_only_websocket_cannot_write_tasks(
    hass, hass_ws_client, hass_read_only_user, tmp_path
):
    """Native task writes require control permission even for a visible list."""
    hass.config.config_dir = str(tmp_path)
    (tmp_path / ".storage").mkdir()
    result = await hass.config_entries.flow.async_init(
        "local_todo",
        context={"source": SOURCE_USER},
        data={"todo_list_name": "Groceries"},
    )
    assert result["type"] is data_entry_flow.FlowResultType.CREATE_ENTRY
    await hass.services.async_call(
        "todo", "add_item", {"entity_id": LIST_ID, "item": "Apples"}, blocking=True
    )
    [created] = await get_tasks(hass)
    refresh = await hass.auth.async_create_refresh_token(
        hass_read_only_user, "https://example.com"
    )
    client = await hass_ws_client(
        hass, access_token=hass.auth.async_create_access_token(refresh)
    )
    await client.send_json({"id": 1, "type": "todo/item/list", "entity_id": LIST_ID})
    response = await client.receive_json(timeout=5)
    assert response["success"]
    assert response["result"]["items"] == [created]
    for msg_id, service, data in (
        (2, "add_item", {"item": "Unauthorized task"}),
        (3, "update_item", {"item": created["uid"], "status": "completed"}),
        (4, "update_item", {"item": created["uid"], "rename": "Unauthorized rename"}),
        (5, "remove_item", {"item": created["uid"]}),
        (
            6,
            "update_item",
            {"item": created["uid"], "due_datetime": "2030-07-05T10:30:00-05:00"},
        ),
    ):
        await client.send_json(
            {
                "id": msg_id,
                "type": "call_service",
                "domain": "todo",
                "service": service,
                "target": {"entity_id": LIST_ID},
                "service_data": data,
            }
        )
        response = await client.receive_json(timeout=5)
        assert response["id"] == msg_id
        assert not response["success"]
        assert response["error"]["message"] == "Unauthorized"
    assert await get_tasks(hass) == [created]
    assert hass.states.get(LIST_ID).state == "1"
