"""Local, UID-deduplicated suggestion history, independent of open browsers."""

import asyncio
import unicodedata
from collections.abc import Callable
from copy import deepcopy
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_state_report_event,
)
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import CONF_LISTS, DOMAIN
from .list_management import ListManagementError, local_entry_for_entity

CATALOG = f"{DOMAIN}_suggestions"
MAX_LABELS = 2000
MAX_SEEN = 50000


def normalized(value: str) -> str:
    """Match case/Unicode/whitespace without changing the native task title."""
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


class SuggestionCatalog:
    """Observe configured Local To-do lists through public state/action APIs."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.store = Store[dict[str, Any]](hass, 1, f"{DOMAIN}.suggestions")
        self.data: dict[str, Any] = {}
        self.bindings: dict[str, str] = {}
        self.active: dict[str, set[str]] = {}
        self.pending: set[str] = set()
        self.removers: list[Callable[[], None]] = []
        self.running = True
        self.dirty: set[str] = set()
        self.lock = asyncio.Lock()

    async def async_load(self) -> None:
        """Restore HA-managed storage before registering observation hooks."""
        self.data = await self.store.async_load() or {}

    @callback
    def sync(self) -> None:
        """Rebind filtered listeners after list selection or identity changes."""
        if not self.running:
            return
        missing = [
            key
            for key in self.data
            if self.hass.config_entries.async_get_entry(key) is None
        ]
        for key in missing:
            self.data.pop(key)
        if missing:
            self.save_later()
        for remove in self.removers:
            remove()
        self.removers.clear()
        registry = er.async_get(self.hass)
        self.bindings = {
            entity_id: registry.async_get(entity_id).config_entry_id
            for entity_id in self.entry.options.get(CONF_LISTS, [])
            if local_entry_for_entity(self.hass, entity_id) is not None
        }
        for track in (async_track_state_change_event, async_track_state_report_event):
            self.removers.append(track(self.hass, self.bindings, self.changed))
        self.removers.append(
            self.hass.bus.async_listen(
                er.EVENT_ENTITY_REGISTRY_UPDATED, self.registry_changed
            )
        )
        for entity_id in self.bindings:
            self.schedule(entity_id)

    @callback
    def registry_changed(self, event: Event) -> None:
        """Follow renames and discard history after native identity removal."""
        if not event.data["entity_id"].startswith("todo."):
            return
        self.sync()

    @callback
    def changed(self, event: Event) -> None:
        """Coalesce reports, including changes which leave active counts unchanged."""
        self.schedule(event.data["entity_id"])

    @callback
    def schedule(self, entity_id: str) -> None:
        """Coalesce reports into one pending reconciliation per entity."""
        if not self.running:
            return
        if entity_id in self.pending:
            self.dirty.add(entity_id)
            return
        self.pending.add(entity_id)
        self.entry.async_create_background_task(
            self.hass, self.refresh(entity_id), "Refresh local suggestion catalog"
        )

    async def refresh(self, entity_id: str) -> None:
        """Read native tasks without writing or inferring purchase counts."""
        try:
            key = self.bindings.get(entity_id)
            state = self.hass.states.get(entity_id)
            if (
                key is None
                or state is None
                or state.state in ("unknown", "unavailable")
            ):
                return
            result = await self.hass.services.async_call(
                "todo",
                "get_items",
                {"entity_id": entity_id},
                blocking=True,
                return_response=True,
            )
            async with self.lock:
                if self.running and self.bindings.get(entity_id) == key:
                    self.ingest(key, result[entity_id]["items"])
        except HomeAssistantError:
            # Leave existing history intact; a later native report retries. Do
            # not log native exception text which may include private task data.
            pass
        finally:
            self.pending.discard(entity_id)
            if entity_id in self.dirty:
                self.dirty.discard(entity_id)
                self.schedule(entity_id)

    @callback
    def record(self, key: str) -> dict[str, Any]:
        """Get a catalog keyed by its native Local To-do config-entry identity."""
        record = self.data.setdefault(
            key,
            {
                "learning": True,
                "exclude_active": True,
                "initialized": False,
                "labels": {},
                "seen": [],
                "baseline_active": [],
            },
        )
        # Older catalogs cannot distinguish baseline items from intentionally
        # forgotten ones. Preserve that history; explicit Rebuild can recover it.
        record.setdefault("baseline_active", [])
        return record

    @callback
    def ingest(
        self, key: str, items: list[dict[str, Any]], *, rebuild: bool = False
    ) -> None:
        """Seed completed tasks once; learn each subsequent UID once across restarts."""
        record = self.record(key)
        self.active[key] = {
            normalized(item["summary"])
            for item in items
            if item.get("summary") and item.get("status") != "completed"
        }
        initial = not record["initialized"] or rebuild
        if rebuild:
            record["labels"] = {}
            record["seen"] = []
            record["baseline_active"] = []
        seen = set(record["seen"])
        baseline = set(record["baseline_active"])
        changed = initial
        for item in items:
            uid, title = item.get("uid"), item.get("summary")
            if not uid or not title:
                continue
            first_completion = uid in baseline and item.get("status") == "completed"
            if uid in seen and not first_completion:
                continue
            if uid not in seen and len(seen) >= MAX_SEEN:
                continue
            seen.add(uid)
            baseline.discard(uid)
            changed = True
            if not record["learning"] and not rebuild:
                continue
            if initial and item.get("status") != "completed":
                baseline.add(uid)
                continue
            if len(title) > 255:
                continue
            label = normalized(title)
            if not label:
                continue
            previous = record["labels"].get(label, {"count": 0})
            record["labels"][label] = {
                "label": title.strip(),
                "count": previous["count"] + 1,
                "last_seen": dt_util.utcnow().isoformat(),
                "source": "completed" if initial or first_completion else "observed",
            }
        record["seen"] = sorted(seen)
        record["baseline_active"] = sorted(baseline)
        record["initialized"] = True
        if len(record["labels"]) > MAX_LABELS:
            ordered = sorted(
                record["labels"],
                key=lambda label: record["labels"][label]["last_seen"],
                reverse=True,
            )
            record["labels"] = {
                label: record["labels"][label] for label in ordered[:MAX_LABELS]
            }
        if changed:
            self.save_later()

    @callback
    def save_later(self) -> None:
        """Batch disk writes through HA; Store flushes pending writes at shutdown."""
        self.store.async_delay_save(lambda: self.data, 2)

    @callback
    def query(
        self, entity_id: str, query: str, *, history: bool = False
    ) -> dict[str, Any]:
        """Return a bounded list without native reads for each keystroke."""
        key = self.bindings[entity_id]
        record = self.record(key)
        text = normalized(query)
        candidates = [
            (label, value)
            for label, value in record["labels"].items()
            if (text or history)
            and text in label
            and not (
                not history
                and record["exclude_active"]
                and label in self.active.get(key, set())
            )
        ]
        candidates.sort(
            key=lambda pair: (
                0 if pair[0] == text else 1 if pair[0].startswith(text) else 2,
                -pair[1]["count"],
                -dt_util.parse_datetime(pair[1]["last_seen"]).timestamp(),
                pair[0],
            )
        )
        return {
            "suggestions": [
                value["label"] for _, value in candidates[: 20 if history else 5]
            ],
            "learning": record["learning"],
            "exclude_active": record["exclude_active"],
            "count": len(record["labels"]),
            "capacity_reached": len(record["seen"]) >= MAX_SEEN,
        }

    async def manage(
        self, entity_id: str, action: str, value: str | bool | None
    ) -> None:
        """Change shared history only; never modify a native task."""
        async with self.lock:
            if not self.running:
                raise ListManagementError("not_loaded")
            await self._manage(entity_id, action, value)

    async def _manage(
        self, entity_id: str, action: str, value: str | bool | None
    ) -> None:
        """Persist one explicit edit while background ingestion is serialized."""
        key = self.bindings[entity_id]
        record = self.record(key)
        before = deepcopy(record)
        if action in ("clear", "forget", "learning", "rebuild"):
            result = await self.hass.services.async_call(
                "todo",
                "get_items",
                {"entity_id": entity_id},
                blocking=True,
                return_response=True,
            )
            self.ingest(key, result[entity_id]["items"], rebuild=action == "rebuild")
        if action == "clear":
            record["labels"] = {}
            record["baseline_active"] = []
        elif action == "forget":
            record["labels"].pop(normalized(str(value)), None)
            ignored = {
                item["uid"]
                for item in result[entity_id]["items"]
                if normalized(item.get("summary") or "") == normalized(str(value))
            }
            record["baseline_active"] = [
                uid for uid in record["baseline_active"] if uid not in ignored
            ]
        elif action in ("learning", "exclude_active"):
            record[action] = value
            if action == "learning" and value is False:
                record["baseline_active"] = []
        try:
            await self.store.async_save(self.data)
        except HomeAssistantError:
            self.data[key] = before
            raise

    async def async_stop(self) -> None:
        """Detach listeners and flush learned history before unload."""
        self.running = False
        for remove in self.removers:
            remove()
        self.removers.clear()
        async with self.lock:
            await self.store.async_save(self.data)
