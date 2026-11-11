"""Exercise Home Assistant's real config and options flow machinery."""

from homeassistant import data_entry_flow
from pytest_homeassistant.common import MockConfigEntry

from custom_components.ha_lists.const import DOMAIN


async def test_config_flow_creates_local_entry(hass):
    """Create a local entry without credentials."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": "user"}
    )
    assert result["type"] is data_entry_flow.FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is data_entry_flow.FlowResultType.CREATE_ENTRY
    assert result["title"] == "HA Lists"
    assert result["data"] == {"created_list_entries": []}
    assert result["result"].minor_version == 2


async def test_config_flow_rejects_duplicate_instance(hass):
    """A second configuration must not create another HA Lists instance."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Lists",
        data={},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": "user"}
    )
    assert result["type"] is data_entry_flow.FlowResultType.ABORT
    assert result["reason"] == "already_configured"
