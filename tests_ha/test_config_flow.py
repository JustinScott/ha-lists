"""Exercise real Home Assistant configuration and options flows."""

from homeassistant import config_entries, data_entry_flow

from custom_components.ha_lists.const import DOMAIN


async def test_config_flow_creates_single_local_entry(hass):
    """A local entry can be created without external credentials."""
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] is data_entry_flow.FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is data_entry_flow.FlowResultType.CREATE_ENTRY
    assert result["title"] == "HA Lists"
    assert result["data"] == {}


async def test_options_flow_persists_list_selection(hass):
    """Options are stored on the entry rather than browser state."""
    entry = config_entries.ConfigEntry(
        version=1,
        minor_version=1,
        domain=DOMAIN,
        title="HA Lists",
        data={},
        source=config_entries.SOURCE_USER,
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
