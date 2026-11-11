"""Configuration and options flows for HA Lists."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers import selector

from .const import CONF_CREATED_ENTRIES, CONF_LISTS, DOMAIN


class ListsConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure one local task manager instance."""

    VERSION = 1
    MINOR_VERSION = 2

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Create the local configuration entry."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(
                title="HA Lists", data={CONF_CREATED_ENTRIES: []}
            )
        return self.async_show_form(step_id="user")

    @staticmethod
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> ListsOptionsFlow:
        """Return the options flow for selecting native to-do entities."""
        return ListsOptionsFlow()


class ListsOptionsFlow(config_entries.OptionsFlow):
    """Store selected native to-do entity IDs in Home Assistant config entries."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Choose which native lists are displayed in the panel."""
        if user_input is not None:
            return self.async_create_entry(data={CONF_LISTS: user_input[CONF_LISTS]})
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_LISTS,
                        default=self.config_entry.options.get(CONF_LISTS, []),
                    ): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="todo", multiple=True)
                    )
                }
            ),
        )
