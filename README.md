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
