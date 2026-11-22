"""Task reminders: bell flags, due events, the due-tasks action and the blueprint."""

import shutil
from datetime import timedelta
from pathlib import Path

import pytest
from aiohttp import ClientWebSocketResponse
from freezegun.api import FrozenDateTimeFactory
from homeassistant.auth.models import User
from homeassistant.core import Event, HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from pytest_homeassistant.common import MockConfigEntry, async_fire_time_changed
from pytest_homeassistant.typing import WebSocketGenerator

from custom_components.ha_lists.const import DOMAIN
from custom_components.ha_lists.list_management import async_create_list
from custom_components.ha_lists.reminders import (
    BLUEPRINT_PATH,
    EVENT_TASK_DUE,
    REMINDERS,
)
from tests_ha.test_list_management import (
    lists_entry as lists_entry,
)
from tests_ha.test_list_management import (
    owner_socket as owner_socket,
)
from tests_ha.test_list_management import request, socket_for, tasks
from tests_ha.test_persistence import running_hass
from tests_ha.test_suggestions import create

BLUEPRINT = (
    Path(__file__).parents[1]
    / "custom_components"
    / "ha_lists"
    / "blueprints"
    / "automation"
    / "task_reminders.yaml"
)
NOW = "2030-05-15 12:00:00-07:00"


async def add(hass: HomeAssistant, entity_id: str, title: str, **due: str) -> str:
    await hass.services.async_call(
        "todo",
        "add_item",
        {"entity_id": entity_id, "item": title, **due},
        blocking=True,
    )
    await hass.async_block_till_done(wait_background_tasks=True)
    return next(
        item["uid"] for item in await tasks(hass, entity_id) if item["summary"] == title
    )


async def bell(
    client: ClientWebSocketResponse, entity_id: str, uid: str, enabled: bool = True
) -> dict:
    result = await request(
        client,
        type="ha_lists/reminder/set",
        entity_id=entity_id,
        uid=uid,
        enabled=enabled,
    )
    assert result["success"], result
    return result["result"]


async def due_tasks(hass: HomeAssistant, **data: object) -> list[dict]:
    result = await hass.services.async_call(
        DOMAIN, "get_due_tasks", data, blocking=True, return_response=True
    )
    return result["tasks"]


@pytest.fixture
def events(hass: HomeAssistant) -> list[Event]:
    captured: list[Event] = []
    hass.bus.async_listen(EVENT_TASK_DUE, captured.append)
    return captured


@pytest.mark.freeze_time(NOW)
async def test_bell_flags_persist_by_uid_and_forget_deleted_tasks(
    hass: HomeAssistant, owner_socket: ClientWebSocketResponse
) -> None:
    entity_id = await create(owner_socket, hass, "Reminder flags")
    keep = await add(hass, entity_id, "Keep", due_date="2030-05-15")
    gone = await add(hass, entity_id, "Gone", due_date="2030-05-15")
    assert (await bell(owner_socket, entity_id, keep))["uids"] == [keep]
    assert set((await bell(owner_socket, entity_id, gone))["uids"]) == {keep, gone}
    listed = await request(owner_socket, type="ha_lists/reminders", entity_id=entity_id)
    assert set(listed["result"]["uids"]) == {keep, gone}
    assert listed["result"]["automations"] == 0
    await hass.services.async_call(
        "todo", "remove_item", {"entity_id": entity_id, "item": gone}, blocking=True
    )
    await hass.async_block_till_done(wait_background_tasks=True)
    assert hass.data[REMINDERS].enabled(entity_id) == [keep]
    assert (await bell(owner_socket, entity_id, keep, False))["uids"] == []


async def test_reminder_commands_check_list_binding_and_permissions(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    hass_admin_user: User,
    owner_socket: ClientWebSocketResponse,
) -> None:
    entity_id = await create(owner_socket, hass, "Reminder access")
    uid = await add(hass, entity_id, "Private")
    unknown = await request(
        owner_socket, type="ha_lists/reminders", entity_id="todo.not_configured"
    )
    assert unknown["error"]["code"] == "unauthorized"
    malformed = await request(
        owner_socket, type="ha_lists/reminder/set", entity_id=entity_id, uid=uid
    )
    assert not malformed["success"]
    ordinary = await hass.auth.async_create_user("Ordinary", group_ids=["system-users"])
    client = await socket_for(hass, hass_ws_client, ordinary)
    blueprint = await request(client, type="ha_lists/reminders/blueprint")
    assert blueprint["error"]["code"] == "unauthorized"
    admin = await request(owner_socket, type="ha_lists/reminders/blueprint")
    assert admin["result"]["path"] == BLUEPRINT_PATH
    assert admin["result"]["yaml"] == BLUEPRINT.read_text("utf-8")


@pytest.mark.freeze_time(NOW)
async def test_timed_due_fires_once_only_while_incomplete_and_enabled(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
    freezer: FrozenDateTimeFactory,
    events: list[Event],
) -> None:
    entity_id = await create(owner_socket, hass, "Timed reminders")
    soon = dt_util.now() + timedelta(minutes=30)
    on = await add(hass, entity_id, "Call", due_datetime=soon.isoformat())
    off = await add(hass, entity_id, "Quiet", due_datetime=soon.isoformat())
    done = await add(hass, entity_id, "Finished", due_datetime=soon.isoformat())
    for uid in (on, done):
        await bell(owner_socket, entity_id, uid)
    await hass.services.async_call(
        "todo",
        "update_item",
        {"entity_id": entity_id, "item": done, "status": "completed"},
        blocking=True,
    )
    await hass.async_block_till_done(wait_background_tasks=True)
    freezer.tick(timedelta(minutes=31))
    async_fire_time_changed(hass)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert [event.data["uid"] for event in events] == [on]
    data = events[0].data
    assert data["summary"] == "Call"
    assert data["list_name"] == "Timed reminders"
    assert data["entity_id"] == entity_id
    assert data["all_day"] is False
    assert data["days_overdue"] == 0
    assert off not in hass.data[REMINDERS].enabled(entity_id)
    freezer.tick(timedelta(days=1))
    async_fire_time_changed(hass)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert len(events) == 1, "a timed due fires once; daily repeats are the action's"


@pytest.mark.freeze_time(NOW)
async def test_rescheduling_a_due_time_moves_the_event(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
    freezer: FrozenDateTimeFactory,
    events: list[Event],
) -> None:
    entity_id = await create(owner_socket, hass, "Moved reminders")
    first = dt_util.now() + timedelta(minutes=10)
    uid = await add(hass, entity_id, "Moved", due_datetime=first.isoformat())
    await bell(owner_socket, entity_id, uid)
    await hass.services.async_call(
        "todo",
        "update_item",
        {
            "entity_id": entity_id,
            "item": uid,
            "due_datetime": (first + timedelta(hours=1)).isoformat(),
        },
        blocking=True,
    )
    await hass.async_block_till_done(wait_background_tasks=True)
    freezer.tick(timedelta(minutes=20))
    async_fire_time_changed(hass)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert events == []
    freezer.tick(timedelta(hours=1))
    async_fire_time_changed(hass)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert [event.data["uid"] for event in events] == [uid]


@pytest.mark.freeze_time(NOW)
async def test_due_tasks_action_covers_today_and_optionally_overdue(
    hass: HomeAssistant, owner_socket: ClientWebSocketResponse
) -> None:
    entity_id = await create(owner_socket, hass, "Daily reminders")
    other = await create(owner_socket, hass, "Other reminders")
    now = dt_util.now()
    today = await add(hass, entity_id, "Today", due_date="2030-05-15")
    late = await add(hass, entity_id, "Late", due_date="2030-05-12")
    timed_today = await add(
        hass,
        entity_id,
        "Timed today",
        due_datetime=(now - timedelta(hours=2)).isoformat(),
    )
    timed_late = await add(
        hass,
        entity_id,
        "Timed late",
        due_datetime=(now - timedelta(days=2)).isoformat(),
    )
    future = await add(hass, entity_id, "Future", due_date="2030-05-20")
    await add(hass, entity_id, "Bell off", due_date="2030-05-15")
    elsewhere = await add(hass, other, "Elsewhere", due_date="2030-05-15")
    for uid in (today, late, timed_today, timed_late, future):
        await bell(owner_socket, entity_id, uid)
    await bell(owner_socket, other, elsewhere)

    assert {task["summary"] for task in await due_tasks(hass)} == {"Today", "Elsewhere"}
    overdue = await due_tasks(hass, include_overdue=True)
    assert {task["summary"] for task in overdue} == {
        "Today",
        "Late",
        "Timed late",
        "Elsewhere",
    }
    assert next(task for task in overdue if task["uid"] == late)["days_overdue"] == 3
    assert next(task for task in overdue if task["uid"] == today)["all_day"] is True
    scoped = await due_tasks(hass, include_overdue=True, entity_id=[other])
    assert [task["summary"] for task in scoped] == ["Elsewhere"]


async def test_due_tasks_action_reports_unloaded_integration(
    hass: HomeAssistant, lists_entry: MockConfigEntry
) -> None:
    await hass.config_entries.async_unload(lists_entry.entry_id)
    with pytest.raises(ServiceValidationError):
        await due_tasks(hass)


# The automation's daily time trigger keeps a timer, as in HA Core tests.
@pytest.mark.parametrize("expected_lingering_timers", [True])
@pytest.mark.freeze_time(NOW)
async def test_bundled_blueprint_runs_reminder_actions_per_task(
    hass: HomeAssistant,
    owner_socket: ClientWebSocketResponse,
    freezer: FrozenDateTimeFactory,
) -> None:
    """End to end: an automation from the blueprint notifies on both paths."""
    target = Path(hass.config.config_dir) / "blueprints" / "automation" / BLUEPRINT_PATH
    target.parent.mkdir(parents=True)
    shutil.copy(BLUEPRINT, target)
    entity_id = await create(owner_socket, hass, "Blueprint reminders")
    timed = await add(
        hass,
        entity_id,
        "Timed task",
        due_datetime=(dt_util.now() + timedelta(minutes=5)).isoformat(),
    )
    dated = await add(hass, entity_id, "Dated task", due_date="2030-05-15")
    for uid in (timed, dated):
        await bell(owner_socket, entity_id, uid)
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": {
                "id": "task_reminders",
                "alias": "Task reminders",
                "use_blueprint": {
                    "path": BLUEPRINT_PATH,
                    "input": {
                        "reminder_time": "12:10:00",
                        "reminder_actions": [
                            {
                                "event": "test_reminder",
                                "event_data": {
                                    "summary": "{{ task.summary }}",
                                    "list": "{{ task.list_name }}",
                                },
                            }
                        ],
                    },
                },
            }
        },
    )
    await hass.async_block_till_done()
    listed = await request(owner_socket, type="ha_lists/reminders", entity_id=entity_id)
    assert listed["result"]["automations"] == 1

    reminded: list[Event] = []
    hass.bus.async_listen("test_reminder", reminded.append)
    freezer.tick(timedelta(minutes=6))
    async_fire_time_changed(hass)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert [event.data["summary"] for event in reminded] == ["Timed task"]
    assert reminded[0].data["list"] == "Blueprint reminders"
    freezer.tick(timedelta(minutes=5))
    async_fire_time_changed(hass)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert [event.data["summary"] for event in reminded] == ["Timed task", "Dated task"]


# The automation's daily time trigger keeps a timer, as in HA Core tests.
@pytest.mark.parametrize("expected_lingering_timers", [True])
async def test_blueprint_default_reminder_creates_a_notification(
    hass: HomeAssistant, owner_socket: ClientWebSocketResponse
) -> None:
    """The out-of-the-box action is valid and readable without customizing."""
    target = Path(hass.config.config_dir) / "blueprints" / "automation" / BLUEPRINT_PATH
    target.parent.mkdir(parents=True)
    shutil.copy(BLUEPRINT, target)
    assert await async_setup_component(hass, "persistent_notification", {})
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": {
                "id": "task_reminders",
                "use_blueprint": {"path": BLUEPRINT_PATH, "input": {}},
            }
        },
    )
    await hass.async_block_till_done()
    hass.bus.async_fire(
        EVENT_TASK_DUE,
        {
            "entity_id": "todo.example",
            "list_name": "Example",
            "uid": "abc",
            "summary": "Water plants",
            "description": "",
            "due": "2030-05-15T12:00:00-07:00",
            "all_day": False,
            "days_overdue": 2,
        },
    )
    await hass.async_block_till_done()
    notifications = await request(owner_socket, type="persistent_notification/get")
    [notification] = notifications["result"]
    assert notification["title"] == "Task due: Water plants"
    assert notification["message"] == "Example · 2 day(s) overdue"


async def test_bells_survive_restart_and_rearm_due_events(tmp_path: Path) -> None:
    """Flags live in HA storage; a fresh instance re-arms timed due events."""
    (tmp_path / ".storage").mkdir()
    async with running_hass(tmp_path) as first:
        app = (
            await first.config_entries.flow.async_init(
                DOMAIN, context={"source": "user"}, data={}
            )
        )["result"]
        user = await first.auth.async_create_user("Synthetic creator")
        created = await async_create_list(first, app, user, "Restart reminders")
        entity_id, native_id = created["entity_id"], created["created_entry_id"]
        await first.async_block_till_done(wait_background_tasks=True)
        due = (dt_util.utcnow() + timedelta(minutes=5)).replace(microsecond=0)
        uid = await add(first, entity_id, "Survives", due_datetime=due.isoformat())
        await first.data[REMINDERS].set_enabled(entity_id, uid, True)
        app_id = app.entry_id
    async with running_hass(tmp_path) as restarted:
        assert await restarted.config_entries.async_setup(native_id)
        assert await restarted.config_entries.async_setup(app_id)
        await restarted.async_block_till_done(wait_background_tasks=True)
        assert restarted.data[REMINDERS].enabled(entity_id) == [uid]
        fired: list[Event] = []
        restarted.bus.async_listen(EVENT_TASK_DUE, fired.append)
        [cancel] = restarted.data[REMINDERS].timers.values()
        # Firing itself is covered with a frozen clock above; freezegun cannot
        # be combined with Local To-do's calendar parsing across a restart.
        assert cancel.__self__.utc_point_in_time == due


async def test_flags_follow_entity_renames_and_removal(
    hass: HomeAssistant, owner_socket: ClientWebSocketResponse
) -> None:
    entity_id = await create(owner_socket, hass, "Renamed reminders")
    uid = await add(hass, entity_id, "Follow me")
    await bell(owner_socket, entity_id, uid)
    registry = er.async_get(hass)
    registry.async_update_entity(entity_id, new_entity_id="todo.renamed_list")
    await hass.async_block_till_done()
    manager = hass.data[REMINDERS]
    assert manager.data == {"todo.renamed_list": [uid]}
    registry.async_remove("todo.renamed_list")
    await hass.async_block_till_done()
    assert manager.data == {}
