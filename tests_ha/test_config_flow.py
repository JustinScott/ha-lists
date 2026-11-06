"""Exercise Home Assistant's real config and options flow machinery."""

from homeassistant import data_entry_flow
from pytest_homeassistant_custom_component.common import MockConfigEntry

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
    assert result["data"] == {}


async def test_options_flow_persists_selected_lists(hass):
    """Use HA's options manager and a real to-do entity selector."""
    hass.states.async_set("todo.groceries", "0")
    hass.states.async_set("todo.hardware", "0")
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Lists",
        data={},
        options={},
        unique_id=DOMAIN,
    )
    entry.add_to_hass(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is data_entry_flow.FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"lists": ["todo.groceries", "todo.hardware"]}
    )
    assert result["type"] is data_entry_flow.FlowResultType.CREATE_ENTRY
    assert entry.options["lists"] == ["todo.groceries", "todo.hardware"]
