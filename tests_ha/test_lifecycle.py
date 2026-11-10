"""Exercise the integration panel lifecycle with HA fixtures."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_lists import (
    PANEL_PATH,
    async_setup_entry,
    async_unload_entry,
)
from custom_components.ha_lists.const import DOMAIN


async def test_setup_and_unload_panel(hass):
    """Setup registers the panel; unload removes it."""
    entry = MockConfigEntry(domain=DOMAIN, title="HA Lists", data={})
    entry.add_to_hass(hass)

    with (
        patch("custom_components.ha_lists.websocket_api.async_register_command") as register_command,
        patch(
            "custom_components.ha_lists.panel_custom.async_register_panel",
            new_callable=AsyncMock,
        ) as register_panel,
        patch("custom_components.ha_lists.async_remove_panel") as remove_panel,
        patch.object(hass, "http", SimpleNamespace(async_register_static_paths=AsyncMock())),
    ):
        assert await async_setup_entry(hass, entry)
        assert hass.data[DOMAIN] is True
        register_command.assert_called_once()
        register_panel.assert_awaited_once()
        hass.http.async_register_static_paths.assert_awaited_once()

        assert await async_unload_entry(hass, entry)
        remove_panel.assert_called_once_with(hass, PANEL_PATH)
        assert DOMAIN not in hass.data


async def test_setup_failure_does_not_mark_loaded(hass):
    """Failed registration must not leave the integration marked loaded."""
    entry = MockConfigEntry(domain=DOMAIN, title="HA Lists", data={})
    entry.add_to_hass(hass)

    with (
        patch("custom_components.ha_lists.websocket_api.async_register_command"),
        patch.object(hass, "http", SimpleNamespace(async_register_static_paths=AsyncMock())),
    ):
        hass.http.async_register_static_paths.side_effect = RuntimeError(
            "synthetic static-path failure"
        )
        try:
            await async_setup_entry(hass, entry)
        except RuntimeError as err:
            assert "synthetic static-path failure" in str(err)
        else:
            raise AssertionError("Expected registration failure")
        assert DOMAIN not in hass.data
