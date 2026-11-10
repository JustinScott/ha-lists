"""Exercise the integration panel lifecycle with HA fixtures."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.components.frontend import DATA_PANELS
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_lists import (
    ASSET_URL,
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
        patch(
            "custom_components.ha_lists.websocket_api.async_register_command"
        ) as register_command,
        patch(
            "custom_components.ha_lists.panel_custom.async_register_panel",
            new_callable=AsyncMock,
        ) as register_panel,
        patch("custom_components.ha_lists.async_remove_panel") as remove_panel,
        patch.object(
            hass,
            "http",
            SimpleNamespace(async_register_static_paths=AsyncMock()),
        ),
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
        patch.object(
            hass,
            "http",
            SimpleNamespace(async_register_static_paths=AsyncMock()),
        ),
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


async def test_repeated_setup_registers_resources_once(hass):
    """Multiple setup calls must not register duplicate panels or commands."""
    entry = MockConfigEntry(domain=DOMAIN, title="HA Lists", data={})
    entry.add_to_hass(hass)
    with (
        patch(
            "custom_components.ha_lists.websocket_api.async_register_command"
        ) as command,
        patch(
            "custom_components.ha_lists.panel_custom.async_register_panel",
            new_callable=AsyncMock,
        ) as panel,
        patch.object(
            hass,
            "http",
            SimpleNamespace(async_register_static_paths=AsyncMock()),
        ),
    ):
        assert await async_setup_entry(hass, entry)
        assert await async_setup_entry(hass, entry)
        command.assert_called_once()
        panel.assert_awaited_once()
        hass.http.async_register_static_paths.assert_awaited_once()


async def test_config_entry_reload_restores_panel_and_static_asset(hass, hass_client):
    """A real config entry reload can reuse the registered HTTP route."""
    entry = MockConfigEntry(domain=DOMAIN, title="HA Lists", data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    client = await hass_client()
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert PANEL_PATH not in hass.data[DATA_PANELS]
    assert await hass.config_entries.async_setup(entry.entry_id)
    assert PANEL_PATH in hass.data[DATA_PANELS]
    async with client.get(f"{ASSET_URL}/panel.js") as response:
        assert response.status == 200
        assert "class HaListsPanel" in await response.text()


async def test_panel_registration_failure_can_retry(hass):
    """A retry after panel setup fails can reuse the registered resources."""
    entry = MockConfigEntry(domain=DOMAIN, title="HA Lists", data={})
    entry.add_to_hass(hass)
    with (
        patch(
            "custom_components.ha_lists.websocket_api.async_register_command"
        ) as command,
        patch(
            "custom_components.ha_lists.panel_custom.async_register_panel",
            new_callable=AsyncMock,
        ) as panel,
        patch.object(
            hass,
            "http",
            SimpleNamespace(async_register_static_paths=AsyncMock()),
        ),
    ):
        panel.side_effect = [RuntimeError("temporary panel failure"), None]
        with pytest.raises(RuntimeError, match="temporary panel failure"):
            await async_setup_entry(hass, entry)
        assert DOMAIN not in hass.data
        assert await async_setup_entry(hass, entry)
        assert panel.await_count == 2
        command.assert_called_once()
        hass.http.async_register_static_paths.assert_awaited_once()
        assert hass.data[DOMAIN] is True


async def test_failed_setup_can_retry(hass):
    """A transient static asset registration failure permits a later setup."""
    entry = MockConfigEntry(domain=DOMAIN, title="HA Lists", data={})
    entry.add_to_hass(hass)
    with (
        patch("custom_components.ha_lists.websocket_api.async_register_command"),
        patch(
            "custom_components.ha_lists.panel_custom.async_register_panel",
            new_callable=AsyncMock,
        ) as panel,
        patch.object(
            hass,
            "http",
            SimpleNamespace(async_register_static_paths=AsyncMock()),
        ),
    ):
        hass.http.async_register_static_paths.side_effect = [
            RuntimeError("temporary failure"),
            None,
        ]
        try:
            await async_setup_entry(hass, entry)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Expected first setup to fail")
        assert DOMAIN not in hass.data
        assert await async_setup_entry(hass, entry)
        panel.assert_awaited_once()
        assert hass.data[DOMAIN] is True
