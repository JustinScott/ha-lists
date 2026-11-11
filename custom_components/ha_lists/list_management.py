"""Manage native Local To-do entries without owning their task storage."""

from typing import Any

from homeassistant import data_entry_flow
from homeassistant.auth.models import User
from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.config_entries import SOURCE_USER, ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from .const import CONF_CREATED_ENTRIES, CONF_LISTS, DOMAIN

ERRORS = {
    "not_loaded": "HA Lists is not loaded. Reload the integration and try again.",
    "invalid_name": "Enter a list name containing letters or numbers.",
    "list_exists": "A Local To-do list with this name already exists.",
    "cannot_create": "Home Assistant could not create the Local To-do list.",
    "missing_list": "This to-do list is no longer available. Refresh the lists.",
    "not_deletable": "Only connected Local To-do lists can be deleted here.",
    "local_only": "Only native Local To-do lists can be connected here.",
    "confirmation_changed": "The list name changed. Reopen the deletion confirmation.",
}


class ListManagementError(HomeAssistantError):
    """An expected, translatable list-management failure."""

    def __init__(self, key: str) -> None:
        super().__init__(ERRORS[key], translation_domain=DOMAIN, translation_key=key)


def active_entry(hass: HomeAssistant) -> ConfigEntry:
    """Resolve the currently loaded singleton, including after waiting for a lock."""
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries or not hass.data.get(DOMAIN):
        raise ListManagementError("not_loaded")
    return entries[0]


def local_entities(hass: HomeAssistant, entry_id: str) -> list[er.RegistryEntry]:
    """Use registry identity rather than guessing an entity ID from its title."""
    return [
        entity
        for entity in er.async_entries_for_config_entry(er.async_get(hass), entry_id)
        if entity.domain == "todo" and entity.platform == "local_todo"
    ]


def local_entry_for_entity(hass: HomeAssistant, entity_id: str) -> ConfigEntry | None:
    """Resolve the backing Local To-do entry without trusting caller/provider labels."""
    entity = er.async_get(hass).async_get(entity_id)
    if entity is None or entity.platform != "local_todo" or not entity.config_entry_id:
        return None
    entry = hass.config_entries.async_get_entry(entity.config_entry_id)
    return entry if entry is not None and entry.domain == "local_todo" else None


def state_for_user(hass: HomeAssistant, user: User) -> dict[str, Any]:
    """Return read-filtered selection and administrator-only management metadata."""
    try:
        entry = active_entry(hass)
    except ListManagementError:
        return {"lists": [], "management": None}
    lists = [
        entity_id
        for entity_id in entry.options.get(CONF_LISTS, [])
        if user.permissions.check_entity(entity_id, POLICY_READ)
    ]
    management = None
    if user.is_admin:
        deletable = {}
        pending = []
        for entity_id in lists:
            native = local_entry_for_entity(hass, entity_id)
            if native is not None:
                deletable[entity_id] = {
                    "entry_id": native.entry_id,
                    "name": native.title,
                }
        for native_id in entry.data.get(CONF_CREATED_ENTRIES, []):
            native = hass.config_entries.async_get_entry(native_id)
            if native is None or native.domain != "local_todo":
                continue
            info = {"entry_id": native_id, "name": native.title}
            entities = local_entities(hass, native_id)
            if not entities:
                pending.append(info)
        management = {
            "available": [
                {"entity_id": state.entity_id, "name": state.name}
                for state in hass.states.async_all("todo")
                if user.permissions.check_entity(state.entity_id, POLICY_READ)
                and local_entry_for_entity(hass, state.entity_id) is not None
            ],
            "deletable": deletable,
            "pending": pending,
        }
    return {"lists": lists, "management": management}


async def async_create_list(
    hass: HomeAssistant, entry: ConfigEntry, user: User, name: str
) -> dict[str, Any]:
    """Create through the native user flow and persist management/binding identity."""
    if not any(character.isalnum() for character in name):
        raise ListManagementError("invalid_name")
    result = await hass.config_entries.flow.async_init(
        "local_todo",
        context={"source": SOURCE_USER, "user_id": user.id},
        data={"todo_list_name": name},
    )
    if result["type"] is data_entry_flow.FlowResultType.ABORT:
        key = (
            "list_exists"
            if result["reason"] == "already_configured"
            else "cannot_create"
        )
        raise ListManagementError(key)
    if result["type"] is not data_entry_flow.FlowResultType.CREATE_ENTRY:
        hass.config_entries.flow.async_abort(result["flow_id"])
        raise ListManagementError("cannot_create")
    native = result["result"]
    if hass.config_entries.async_get_entry(entry.entry_id) is not entry:
        # Never roll back a native list by deleting its potentially populated data.
        raise ListManagementError("not_loaded")
    entities = local_entities(hass, native.entry_id)
    entity_id = entities[0].entity_id if len(entities) == 1 else None
    selected = list(entry.options.get(CONF_LISTS, []))
    if entity_id is not None and entity_id not in selected:
        selected.append(entity_id)
    hass.config_entries.async_update_entry(
        entry,
        data={
            **entry.data,
            CONF_CREATED_ENTRIES: [
                *entry.data.get(CONF_CREATED_ENTRIES, []),
                native.entry_id,
            ],
        },
        options={**entry.options, CONF_LISTS: selected},
    )
    return {"entity_id": entity_id, "created_entry_id": native.entry_id}


def set_list_visible(
    hass: HomeAssistant, entry: ConfigEntry, user: User, entity_id: str, visible: bool
) -> None:
    """Change selection only; hiding a list never removes its native entry/tasks."""
    selected = list(entry.options.get(CONF_LISTS, []))
    if visible:
        if not hass.states.get(entity_id) or not user.permissions.check_entity(
            entity_id, POLICY_READ
        ):
            raise ListManagementError("missing_list")
        if local_entry_for_entity(hass, entity_id) is None:
            raise ListManagementError("local_only")
        if entity_id not in selected:
            selected.append(entity_id)
    else:
        selected = [selected_id for selected_id in selected if selected_id != entity_id]
    hass.config_entries.async_update_entry(
        entry, options={**entry.options, CONF_LISTS: selected}
    )


async def async_delete_list(
    hass: HomeAssistant, entry: ConfigEntry, native_id: str, confirm_name: str
) -> dict[str, Any]:
    """Remove one confirmed connected Local To-do entry (or failed creation)."""
    native = hass.config_entries.async_get_entry(native_id)
    entities = local_entities(hass, native_id)
    connected = any(
        entity.entity_id in entry.options.get(CONF_LISTS, []) for entity in entities
    )
    pending_creation = (
        native_id in entry.data.get(CONF_CREATED_ENTRIES, []) and not entities
    )
    if (
        native is None
        or native.domain != "local_todo"
        or not (connected or pending_creation)
    ):
        raise ListManagementError("not_deletable")
    if confirm_name != native.title:
        raise ListManagementError("confirmation_changed")
    entity_ids = {entity.entity_id for entity in entities}
    result = await hass.config_entries.async_remove(native_id)
    if active_entry(hass) is entry:
        hass.config_entries.async_update_entry(
            entry,
            data={
                **entry.data,
                CONF_CREATED_ENTRIES: [
                    value
                    for value in entry.data.get(CONF_CREATED_ENTRIES, [])
                    if value != native_id
                ],
            },
            options={
                **entry.options,
                CONF_LISTS: [
                    value
                    for value in entry.options.get(CONF_LISTS, [])
                    if value not in entity_ids
                ],
            },
        )
    return result
