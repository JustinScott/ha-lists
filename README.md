# HA Lists

Local-first Home Assistant list manager, under active development.

**Status: Milestone 1 in progress.** The integration currently registers a
dedicated **Lists** sidebar panel. Administrators can create and manage native
Local To-do lists. Users can choose a connected list to inspect, add tasks to,
and mark tasks complete.

## Development installation (not production-ready)

Copy `custom_components/ha_lists` to your **development** Home Assistant
configuration's `custom_components` directory. Restart that Home Assistant
instance and add **HA Lists** under Settings → Devices & services.
The sidebar should then show **Lists**.

Use a development instance with synthetic lists and tasks.

## Development checks

For Windows/box1, see [the local development guide](dev/README.md). Setup and
check commands are grouped under `dev/`; all test suites sync with the repository.

Requires Home Assistant **2026.11.1 or newer**. The tested baseline is HA
2026.11.1 with Python 3.14 and frontend 20261028.5. Earlier releases are not
supported; the panel uses `ha-input`.

Use Python 3.14.2 or newer and Node.js 22. On Windows, run the Python suite in WSL.
From the repository root, set up the dependencies once:

```bash
python3.14 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-test.lock
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

Browser checks run on pushes and pull requests as well as manual **Validate**
runs with the **all** or **browser** suite. Python tests use the official
`pytest-homeassistant` package matched to HA 2026.11.1; do not install it together
with the retired custom-component test package. Coverage must stay at or above 95%.

See [`specs.md`](specs.md) for requirements and [`AGENTS.md`](AGENTS.md)
for coding instructions. Never commit credentials, personal tasks, local
addresses, or real Home Assistant configuration.


## Configuration and everyday use (development preview)

1. Install this integration on a **development** Home Assistant instance, restart it, and add **HA Lists** under Settings → Devices & services.
2. Open **Lists**. Administrators can use **New list** to create native Local To-do lists, or **Connect existing list** to show existing Local To-do entities. The integration's **Configure** options also retain the existing native entity selection workflow.
3. Open the **Lists** sidebar entry. Select a list by its displayed name to inspect, add, or complete tasks. Select a task title to edit or delete it. The editor offers descriptions, due dates, and due times where the provider supports them. Due times use the browser time zone shown in the editor. Clear deadline removes both date and time. Delete asks you to confirm the task first.

The integration requires Home Assistant's frontend, HTTP, panel, and to-do components. It uses Home Assistant's authenticated frontend connection; there is no separate HA Lists account or public server. The initial configuration does not require a cloud provider.

## Removal (development preview)

Remove the HA Lists integration entry from Settings → Devices & services, then remove the `custom_components/ha_lists` directory from the development configuration and restart Home Assistant. If the panel remains visible, refresh the browser and verify that the integration entry is gone. Native lists and tasks remain, including lists created through HA Lists.

Administrators can **Remove list from panel** without deleting its data. The separate
**Delete list…** action permanently deletes any connected Local To-do list and all
its tasks throughout Home Assistant, including lists created outside HA Lists.
It requires typing the native list name and confirming. Keep a backup if needed;
there is no undo here. Ordinary users do not see list-management controls.
If native creation cannot finish setup, recover that list in HA Settings and
connect it, or explicitly confirm deletion of the pending list.

## Supported features and current limitations

- **Available:** One local HA Lists config entry; administrator creation, connection, hiding and confirmed deletion of native Local To-do lists; named-list sidebar; task retrieval, creation, renaming, completion, reopening, and deletion; task title/description search; All/Active/Completed/Due today/Overdue filters; newest/oldest active-task sorting; loading and error messages.
- **Not yet available:** Creating/deleting third-party lists; rich metadata; autocomplete/history; Assist-specific routing; provider migration or import/export. Third-party import/export versus live editing remains a future design discussion; existing bindings and data are preserved.

The underlying `todo` integrations remain the source of truth for tasks. Removing HA Lists does not intentionally remove provider tasks. Provider capabilities vary; not every provider exposes completed items or rich task fields.

## Repeatable development instance

With Docker and Docker Compose installed, run `npm run dev` from the repository
root. `compose.dev.yaml` pins HA 2026.11.1, mounts this integration read-only,
and stores development state in the ignored `.dev-config/` directory. Open
`http://localhost:8123`, finish onboarding, add a Local To-do list and HA Lists,
then select the list under HA Lists → Configure. Use synthetic tasks only.
Stop it with `docker compose -f compose.dev.yaml down`; state is retained.
Port 8123 must be free. Back up `.dev-config/` before upgrading the pinned image.
No privileged container or host networking is required.

For a fresh Python test environment, `uv venv --python 3.14 .venv` and
`uv pip install --python .venv/bin/python -r requirements-test.lock` are equivalent
to the setup above. Use the checked-in `.python-version`, requirements file, and
`requirements-test.lock` and `package-lock.json` rather than installing
unpinned latest packages. Regenerate the Python lock after editing
`requirements-test.txt` with `uv pip compile --python 3.14 requirements-test.txt
-o requirements-test.lock`. Do not reuse a Python 3.13 virtual environment.

When the HA Docker image cannot fit locally, browser tests also accept
`HA_TEST_PYTHON=/absolute/path/to/python npm run test:browser`. That interpreter
must run HA 2026.11.1 with frontend 20261028.5, Local To-do's `ical==14.3.1`,
and the runtime libraries required by HA's service descriptions (conversation,
Assist, TTS, camera and FFmpeg). Linux needs the TurboJPEG shared library.
Use the full HA container in CI to include these native dependencies.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally selects an installed Chromium.
The native test always creates temporary storage and a random loopback port;
it never accepts an existing HA URL or uses your development account.

Mobile browser emulation checks touch interactions, focus, and horizontal
layout. It does not verify a real Android companion app's keyboard or IME;
that remains a manual acceptance check before a release.

## Task search, filters and sorting

Use **Search tasks** to find a literal substring in task titles or descriptions
in the selected list. Matching ignores case and surrounding spaces, and combines
with **Show tasks**. **Clear search** keeps the current filter. The query stays
when switching lists and resets on reload. Search runs locally on loaded tasks;
it does not fetch extra provider history or change tasks. Counts include both
search and filter restrictions.

Use **Show tasks** to choose **All**, **Active**, **Completed**, **Due today**,
or **Overdue**. The count shows matching tasks out of the selected list's total.
Filters keep the current sort order and do not change or delete provider tasks.
The selection stays when switching lists in the panel; reloading defaults to All.

Use **Sort active tasks** to choose **Newest first** (default) or **Oldest first**.
These use the source list's order: Newest first reverses active items and Oldest
first keeps their original order. Local To-do appends new items, while other
providers may order them differently. Completed tasks stay below active tasks
and keep their source order. Sorting works with search and filters, stays when
switching lists in the open panel, and resets on reload. It changes only the
display, preserving provider tasks and unsaved drafts.

Due today and Overdue show unfinished tasks in **your browser's time zone**,
which appears beside the selector. A date-only task becomes overdue after local
midnight at the end of its due date. A timed task becomes overdue after its due
instant; it can therefore appear in both Due today and Overdue. Tasks without a
valid deadline are excluded from both date filters. Views update at deadline/day
boundaries and when you return to the tab, with clock/time-zone rechecks within
one minute. Completed tasks remain available under Completed and All.
