"""Per-task due reminders: an HA event at each timed due moment, plus an action.

HA Lists only decides *which* tasks are due. What happens next (a phone
notification, a script, an announcement) belongs to the user's automation,
usually created from the bundled blueprint.
"""

import asyncio
from collections.abc import Callable
from datetime import date, datetime
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import (
    Event,
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_track_point_in_utc_time,
    async_track_state_change_event,
    async_track_state_report_event,
)
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import CONF_LISTS, DOMAIN

REMINDERS = f"{DOMAIN}_reminders"
EVENT_TASK_DUE = f"{DOMAIN}_task_due"
SERVICE_GET_DUE_TASKS = "get_due_tasks"
BLUEPRINT_PATH = f"{DOMAIN}/task_reminders.yaml"
BLUEPRINT_SOURCE_URL = (
    "https://github.com/JustinScott/ha-lists/blob/main/"
    "custom_components/ha_lists/blueprints/automation/task_reminders.yaml"
)
MAX_REMINDERS_PER_LIST = 5000


def parse_due(value: str | None) -> date | datetime | None:
    """Native items report a date (YYYY-MM-DD) or an ISO datetime."""
    if not value:
        return None
    if len(value) == 10:
        return dt_util.parse_date(value)
    parsed = dt_util.parse_datetime(value)
    if parsed is None:
        return None
    return (
        parsed
        if parsed.tzinfo
        else parsed.replace(tzinfo=dt_util.get_default_time_zone())
    )


def reminder_automations(hass: HomeAssistant) -> list[str]:
    """Automations created from the bundled blueprint (empty if none/unloaded)."""
    # Imported lazily: the automation component is optional for HA Lists itself.
    from homeassistant.components.automation import automations_with_blueprint  # noqa: PLC0415

    return automations_with_blueprint(hass, BLUEPRINT_PATH)


class ReminderManager:
    """Store reminder flags by stable registry identity; schedule timed due events."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.store = Store[dict[str, Any]](hass, 1, f"{DOMAIN}.reminders")
        # {entity_id: [task uid, ...]}; renames are followed from registry events.
        self.data: dict[str, list[str]] = {}
        self.bindings: set[str] = set()
        self.timers: dict[tuple[str, str], Callable[[], None]] = {}
        self.removers: list[Callable[[], None]] = []
        self.pending: set[str] = set()
        self.dirty: set[str] = set()
        self.running = True
        self.lock = asyncio.Lock()

    async def async_load(self) -> None:
        """Restore flags before observing lists."""
        stored = await self.store.async_load() or {}
        self.data = {key: list(value) for key, value in stored.get("tasks", {}).items()}
        # Shutdown does not unload entries; stop arming timers for a stopping HA.
        self.entry.async_on_unload(
            self.hass.bus.async_listen(EVENT_HOMEASSISTANT_STOP, self.halt)
        )

    @callback
    def halt(self, _event: Event | None = None) -> None:
        """Cancel listeners and timers without writing (Store flushes itself)."""
        self.running = False
        for remove in [*self.removers, *self.timers.values()]:
            remove()
        self.removers.clear()
        self.timers.clear()

    @callback
    def sync(self) -> None:
        """Bind to every configured list, whatever its provider."""
        if not self.running:
            return
        for remove in self.removers:
            remove()
        self.removers.clear()
        self.bindings = set(self.entry.options.get(CONF_LISTS, []))
        for key in [key for key in self.timers if key[0] not in self.bindings]:
            self.timers.pop(key)()
        for track in (async_track_state_change_event, async_track_state_report_event):
            self.removers.append(track(self.hass, list(self.bindings), self.changed))
        self.removers.append(
            self.hass.bus.async_listen(
                er.EVENT_ENTITY_REGISTRY_UPDATED, self.registry_changed
            )
        )
        for entity_id in self.bindings:
            self.schedule(entity_id)

    @callback
    def registry_changed(self, event: Event) -> None:
        """Carry flags across entity renames; drop them with removed entities."""
        entity_id = event.data["entity_id"]
        if not entity_id.startswith("todo."):
            return
        old = event.data.get("old_entity_id")
        if event.data["action"] == "update" and old in self.data:
            self.data[entity_id] = self.data.pop(old)
            self.save_later()
        elif event.data["action"] == "remove" and entity_id in self.data:
            self.data.pop(entity_id)
            self.save_later()

    @callback
    def changed(self, event: Event) -> None:
        """Due dates can change without changing the incomplete count (state report)."""
        self.schedule(event.data["entity_id"])

    @callback
    def schedule(self, entity_id: str) -> None:
        """Coalesce native reports into one pending refresh per list."""
        if not self.running:
            return
        if entity_id in self.pending:
            self.dirty.add(entity_id)
            return
        self.pending.add(entity_id)
        self.entry.async_create_background_task(
            self.hass, self.refresh(entity_id), "Refresh HA Lists reminders"
        )

    async def read_items(self, entity_id: str) -> list[dict[str, Any]] | None:
        """Read native tasks; None when the list cannot be read right now."""
        state = self.hass.states.get(entity_id)
        if state is None or state.state in ("unknown", "unavailable"):
            return None
        try:
            result = await self.hass.services.async_call(
                "todo",
                "get_items",
                {"entity_id": entity_id},
                blocking=True,
                return_response=True,
            )
        except HomeAssistantError:
            # Do not log provider text, which may contain private task data.
            return None
        return result[entity_id]["items"]

    async def refresh(self, entity_id: str) -> None:
        """Re-arm timers from the native snapshot; forget flags of deleted tasks."""
        try:
            items = await self.read_items(entity_id)
            if items is None or entity_id not in self.bindings or not self.running:
                return
            uids = {item.get("uid") for item in items}
            enabled = self.data.get(entity_id, [])
            kept = [uid for uid in enabled if uid in uids]
            if kept != enabled:
                if kept:
                    self.data[entity_id] = kept
                else:
                    self.data.pop(entity_id, None)
                self.save_later()
            self.arm(entity_id, items)
        finally:
            self.pending.discard(entity_id)
            if entity_id in self.dirty:
                self.dirty.discard(entity_id)
                self.schedule(entity_id)

    @callback
    def arm(self, entity_id: str, items: list[dict[str, Any]]) -> None:
        """One timer per enabled, incomplete task with a future timed due."""
        for key in [key for key in self.timers if key[0] == entity_id]:
            self.timers.pop(key)()
        enabled = set(self.enabled(entity_id))
        now = dt_util.utcnow()
        for item in items:
            due = parse_due(item.get("due"))
            uid = item.get("uid")
            if (
                uid in enabled
                and item.get("status") == "needs_action"
                and isinstance(due, datetime)
                and due > now
            ):
                self.timers[(entity_id, uid)] = async_track_point_in_utc_time(
                    self.hass, self.fire_later(entity_id, uid, item["due"]), due
                )

    def fire_later(
        self, entity_id: str, uid: str, due: str
    ) -> Callable[[datetime], None]:
        """Build a timer callback which re-checks the native task before firing."""

        @callback
        def fire(_now: datetime) -> None:
            self.timers.pop((entity_id, uid), None)
            self.entry.async_create_background_task(
                self.hass,
                self.fire_if_current(entity_id, uid, due),
                "HA Lists task due",
            )

        return fire

    async def fire_if_current(self, entity_id: str, uid: str, due: str) -> None:
        """Fire only if the task is still incomplete, still due then, still enabled."""
        items = await self.read_items(entity_id)
        if items is None or not self.running or uid not in self.enabled(entity_id):
            return
        for item in items:
            if (
                item.get("uid") == uid
                and item.get("status") == "needs_action"
                and item.get("due") == due
            ):
                self.hass.bus.async_fire(
                    EVENT_TASK_DUE, self.payload(entity_id, item, dt_util.now().date())
                )
                return

    def payload(
        self, entity_id: str, item: dict[str, Any], today: date
    ) -> dict[str, Any]:
        """Task data handed to automations (event data and action response)."""
        due = parse_due(item.get("due"))
        due_day = due if not isinstance(due, datetime) else dt_util.as_local(due).date()
        state = self.hass.states.get(entity_id)
        return {
            "entity_id": entity_id,
            "list_name": state.name if state else entity_id,
            "uid": item.get("uid"),
            "summary": item.get("summary") or "",
            "description": item.get("description") or "",
            "due": item.get("due"),
            "all_day": not isinstance(due, datetime),
            "days_overdue": max((today - due_day).days, 0) if due_day else 0,
        }

    @callback
    def enabled(self, entity_id: str) -> list[str]:
        """Task UIDs with reminders on for one configured list."""
        if entity_id not in self.bindings:
            return []
        return list(self.data.get(entity_id, []))

    async def set_enabled(self, entity_id: str, uid: str, enabled: bool) -> list[str]:
        """Persist one bell toggle, then re-arm that list's timers."""
        async with self.lock:
            key = entity_id
            if key not in self.bindings or not self.running:
                raise ServiceValidationError(
                    translation_domain=DOMAIN, translation_key="missing_list"
                )
            uids = [value for value in self.data.get(key, []) if value != uid]
            if enabled:
                if len(uids) >= MAX_REMINDERS_PER_LIST:
                    raise ServiceValidationError(
                        translation_domain=DOMAIN, translation_key="too_many_reminders"
                    )
                uids.append(uid)
            before = self.data.get(key)
            if uids:
                self.data[key] = uids
            else:
                self.data.pop(key, None)
            try:
                await self.store.async_save({"tasks": self.data})
            except HomeAssistantError:
                if before is None:
                    self.data.pop(key, None)
                else:
                    self.data[key] = before
                raise
        self.schedule(entity_id)
        return self.enabled(entity_id)

    async def due_tasks(
        self, include_overdue: bool, entity_ids: list[str] | None = None
    ) -> list[dict[str, Any]]:
        """Reminder-enabled, incomplete tasks due today (and earlier, if asked).

        Timed tasks due today are left to the event at their exact time, so a
        daily run never repeats a reminder that already fired today.
        """
        today = dt_util.now().date()
        tasks: list[dict[str, Any]] = []
        for entity_id in self.bindings:
            if entity_ids and entity_id not in entity_ids:
                continue
            enabled = set(self.enabled(entity_id))
            if not enabled or (items := await self.read_items(entity_id)) is None:
                continue
            for item in items:
                due = parse_due(item.get("due"))
                if (
                    item.get("uid") not in enabled
                    or item.get("status") != "needs_action"
                    or due is None
                ):
                    continue
                day = dt_util.as_local(due).date() if isinstance(due, datetime) else due
                due_today = not isinstance(due, datetime) and day == today
                if due_today or (include_overdue and day < today):
                    tasks.append(self.payload(entity_id, item, today))
        return tasks

    @callback
    def save_later(self) -> None:
        """Batch background cleanups; HA flushes delayed saves at shutdown."""
        self.store.async_delay_save(lambda: {"tasks": self.data}, 2)

    async def async_stop(self) -> None:
        """Cancel timers and listeners; flush flags."""
        self.halt()
        async with self.lock:
            await self.store.async_save({"tasks": self.data})


async def async_get_due_tasks(call: ServiceCall) -> ServiceResponse:
    """Action handler: `ha_lists.get_due_tasks`."""
    manager: ReminderManager | None = call.hass.data.get(REMINDERS)
    if manager is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="not_loaded"
        )
    entity_ids = call.data.get("entity_id") or None
    return {"tasks": await manager.due_tasks(call.data["include_overdue"], entity_ids)}
