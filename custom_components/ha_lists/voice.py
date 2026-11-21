"""Expose connected lists to voice assistants through Home Assistant's own settings.

Home Assistant stores voice exposure per entity (Settings → Voice assistants →
Expose). HA Lists reads and changes that native setting; it keeps no copy, so
changes made in either place are reflected in both.
"""

from collections.abc import Callable
from typing import Any

from homeassistant.components.homeassistant.exposed_entities import (
    DATA_EXPOSED_ENTITIES,
    async_expose_entity,
    async_listen_entity_updates,
)
from homeassistant.core import HomeAssistant, callback

ASSIST = "conversation"
ALEXA = "cloud.alexa"
GOOGLE = "cloud.google_assistant"
ASSISTANT_NAMES = {
    ASSIST: "Assist",
    ALEXA: "Amazon Alexa",
    GOOGLE: "Google Assistant",
}


def _cloud_assistants(hass: HomeAssistant) -> list[str]:
    """Offer cloud assistants only when Home Assistant Cloud can use them.

    Reads the loaded cloud object instead of importing the optional cloud
    package, which pulls in heavy dependencies (the same data
    ``cloud.async_is_logged_in`` checks).
    """
    if "cloud" not in hass.config.components:
        return []
    cloud = hass.data.get("cloud")
    if not getattr(cloud, "is_logged_in", False):
        return []
    prefs = getattr(getattr(cloud, "client", None), "prefs", None)
    assistants = []
    if getattr(prefs, "alexa_enabled", True):
        assistants.append(ALEXA)
    if getattr(prefs, "google_enabled", True):
        assistants.append(GOOGLE)
    return assistants


@callback
def available_assistants(hass: HomeAssistant) -> list[str]:
    """Return assistants that can currently be offered, Assist first."""
    if DATA_EXPOSED_ENTITIES not in hass.data:
        return []
    return [ASSIST, *_cloud_assistants(hass)]


@callback
def voice_state(hass: HomeAssistant, entity_ids: list[str]) -> dict[str, Any] | None:
    """Describe each list's exposure without storing defaults as a side effect."""
    assistants = available_assistants(hass)
    if not assistants:
        return None
    exposed_entities = hass.data[DATA_EXPOSED_ENTITIES]
    return {
        "assistants": [
            {"id": assistant, "name": ASSISTANT_NAMES[assistant]}
            for assistant in assistants
        ],
        "exposure": {
            entity_id: {
                assistant: exposed_entities.async_get_should_expose(
                    assistant, entity_id
                )
                for assistant in assistants
            }
            for entity_id in entity_ids
        },
    }


@callback
def set_exposure(
    hass: HomeAssistant, entity_id: str, assistant: str, exposed: bool
) -> bool:
    """Change one native exposure setting; False when the assistant is unavailable."""
    if assistant not in available_assistants(hass):
        return False
    async_expose_entity(hass, assistant, entity_id, exposed)
    return True


@callback
def listen(hass: HomeAssistant, notify: Callable[[], None]) -> Callable[[], None]:
    """Follow exposure changes made anywhere, including HA's own settings page."""
    if DATA_EXPOSED_ENTITIES not in hass.data:
        return lambda: None
    removers = [
        async_listen_entity_updates(hass, assistant, notify)
        for assistant in ASSISTANT_NAMES
    ]

    def remove() -> None:
        for remover in removers:
            remover()

    return remove
