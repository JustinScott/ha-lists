# HA Lists

Local-first Home Assistant list manager, under active development.

**Status: Milestone 1 in progress.** The integration currently registers a
dedicated **Lists** sidebar panel. The panel discovers native `todo.*` entities
available in the signed-in Home Assistant frontend and lets you choose which
entity to inspect, add tasks to, and mark tasks complete.

## Development installation (not production-ready)

Copy `custom_components/ha_lists` to your **development** Home Assistant
configuration's `custom_components` directory. Restart that Home Assistant
instance and add **HA Lists** under Settings → Devices & services.
The sidebar should then show **Lists**.

Use a development instance with synthetic lists and tasks.

## Development checks

Use Python 3.13 and Node.js 22. On Windows, run the Python suite in WSL.
From the repository root, set up the dependencies once:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-test.txt
npm ci
```

Run `npm run test:all` for lint, syntax, Home Assistant and panel behavior tests.
Use `npm run test:python` or `npm test` to run either suite on its own.
The Home Assistant harness uses isolated fixtures and exercises real on-disk
storage in the restart test. CI publishes Python coverage with the test run.

### Disposable Home Assistant browser smoke test

With Docker running, install Chromium once using `npx playwright install chromium`
(use `--with-deps` on Linux when system libraries are missing). Then run
`npm run test:browser`. This starts a pinned Home Assistant container on a random
loopback port, configures a synthetic Local To-do list, and checks that task
changes appear across two browser sessions without a refresh. The test removes
the container and temporary configuration at the end.

In GitHub Actions, manually run **Validate** with the **browser** suite. The
regular push workflow runs without a Home Assistant container.

See [`specs.md`](specs.md) for requirements and [`AGENTS.md`](AGENTS.md)
for coding instructions. Never commit credentials, personal tasks, local
addresses, or real Home Assistant configuration.


## Configuration and everyday use (development preview)

1. Install this integration on a **development** Home Assistant instance, restart it, and add **HA Lists** under Settings → Devices & services.
2. Open the HA Lists integration's **Configure** options and select one or more existing native `todo` entities. Create those lists through their respective Home Assistant provider integrations first; HA Lists does not create provider lists.
3. Open the **Lists** sidebar entry. Select a list by its displayed name to inspect, add, or complete tasks. Select a task title to edit or delete it. The editor offers descriptions and date-only deadlines where the provider supports them. Delete asks you to confirm the task first.

The integration requires Home Assistant's frontend, HTTP, panel, and to-do components. It uses Home Assistant's authenticated frontend connection; there is no separate HA Lists account or public server. The initial configuration does not require a cloud provider.

## Removal (development preview)

Remove the HA Lists integration entry from Settings → Devices & services, then remove the `custom_components/ha_lists` directory from the development configuration and restart Home Assistant. If the panel remains visible, refresh the browser and verify that the integration entry is gone. **Do not delete the underlying native to-do integrations or entities:** HA Lists only selects and displays them.

## Supported features and current limitations

- **Available:** One local HA Lists config entry; select multiple existing native `todo` entities; named-list sidebar; task retrieval, creation, renaming, completion, reopening, and deletion; loading and error messages.
- **Not yet available:** Creating provider lists; editing timed deadlines; rich metadata; autocomplete/history; Assist-specific routing; provider migration.

The underlying `todo` integrations remain the source of truth for tasks. Removing HA Lists does not intentionally remove provider tasks. Provider capabilities vary; not every provider exposes completed items or rich task fields.
