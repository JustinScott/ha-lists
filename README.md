# HA Lists

Local-first Home Assistant list manager, under active development.

**Status: Milestone 1 in progress.** The integration currently registers a
dedicated **Lists** sidebar panel. The panel discovers native `todo.*` entities
available in the signed-in Home Assistant frontend and lets you choose which
entity to inspect. This is **read-only discovery**, not yet a task editor,
persistent provider configuration, or provider migration.

## Development installation (not production-ready)

Copy `custom_components/ha_lists` to your **development** Home Assistant
configuration's `custom_components` directory. Restart that Home Assistant
instance and add **HA Lists** under Settings → Devices & services.
The sidebar should then show **Lists**.

Do not install this early scaffold on a production instance. This project has
not yet passed a full Home Assistant integration test.

## Development checks

```bash
python -m pip install ruff pytest
ruff check .
ruff format --check .
pytest -q
```

See [`specs.md`](specs.md) for requirements and [`AGENTS.md`](AGENTS.md)
for coding instructions. Never commit credentials, personal tasks, local
addresses, or real Home Assistant configuration.


## Configuration and everyday use (development preview)

1. Install this integration on a **development** Home Assistant instance, restart it, and add **HA Lists** under Settings → Devices & services.
2. Open the HA Lists integration's **Configure** options and select one or more existing native `todo` entities. Create those lists through their respective Home Assistant provider integrations first; HA Lists does not create provider lists.
3. Open the **Lists** sidebar entry. Select a list by its displayed name to inspect tasks. The current panel is read-only.

The integration requires Home Assistant's frontend, HTTP, panel, and to-do components. It uses Home Assistant's authenticated frontend connection; there is no separate HA Lists account or public server. The initial configuration does not require a cloud provider.

## Removal (development preview)

Remove the HA Lists integration entry from Settings → Devices & services, then remove the `custom_components/ha_lists` directory from the development configuration and restart Home Assistant. If the panel remains visible, refresh the browser and verify that the integration entry is gone. **Do not delete the underlying native to-do integrations or entities:** HA Lists only selects and displays them.

## Supported features and current limitations

- **Available:** One local HA Lists config entry; select multiple existing native `todo` entities; named-list sidebar; read-only task retrieval; loading and error messages.
- **Not yet available:** Creating provider lists; adding, editing, completing, reopening, or deleting tasks in the HA Lists panel; rich metadata; autocomplete/history; Assist-specific routing; provider migration.
- **Security not fully validated:** End-to-end WebSocket authentication, entity permissions, and malformed-request handling still need HA fixture-based tests. Do not treat this preview as production-ready.
- **Reliability not fully validated:** Setup/unload failure recovery and repeated reload behavior require further tests. CI results must be verified before claiming readiness.

The underlying `todo` integrations remain the source of truth for tasks. Removing HA Lists does not intentionally remove provider tasks. Provider capabilities vary; not every provider exposes completed items or rich task fields.
