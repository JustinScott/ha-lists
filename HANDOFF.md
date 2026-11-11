# HA Lists — handoff for a new local Codex session

## Local list management update (2026-11-11)

- New panel controls let administrators create native Local To-do lists, connect
  existing Local To-do entities, hide selections without changing tasks, and
  permanently delete any connected Local To-do list after typing its native
  title. This includes lists created outside HA Lists. The warning explains all
  tasks are deleted throughout HA. Ordinary task permissions are unchanged.
- `list_management.py` delegates creation/removal to native config-entry APIs,
  resolves actual entity-registry identity, preserves unrelated configuration,
  and retains failed-setup identities for recovery or confirmed cancellation.
  Schema 1.2 adds optional `created_list_entries` in data; selected entities stay
  in options. Removing HA Lists leaves native lists/tasks intact.
- `list_websocket.py` provides validated admin commands and read-filtered state
  subscriptions. Config operations serialize through a lock. Entry listeners
  unload automatically; subscriptions belong to authenticated connections and
  clean up on unsubscribe/close. Unload sends empty configuration state.
- The panel preserves forms/drafts on failures and unchanged selections, ignores
  stale reads/replies, and avoids focus/list stealing after late creation. New
  connections are Local To-do only; existing provider bindings remain intact.
- The user's current third-party preference is explicit import/export without
  live editing, deferred to a future design discussion. No import/export or
  new third-party management is implemented. See specs section 12.
- Guidance review: native [config flows](https://contributors.home-assistant.io/core/integrations/config-flow/)
  and [config entries](https://contributors.home-assistant.io/core/integrations/config-entries/)
  require lifecycle APIs rather than direct storage editing; implementation uses
  the Local To-do flow, entity registry and native removal. Actual HA tests and
  restart tests verify identities/tasks and cleanup. Native config/WebSocket
  source on both current Core and pinned HA 2026.11.1 confirms admin permissions;
  authenticated HA tests verify rejection, schema validation and filtered state.
  [Custom-panel guidance](https://contributors.home-assistant.io/frontend/custom-ui/panel/)
  maps to native HA header/narrow state, themed controls, keyboard focus and
  mobile Playwright checks. Core AGENTS/integration knowledge skill, current
  [HACS requirements](https://www.hacs.xyz/docs/publish/integration/), and official
  [pytest-homeassistant](https://github.com/home-assistant/core/tree/dev/packages/pytest-homeassistant)
  guidance were consulted; no dependencies or minimum HA version changed.
- English backend config/options/exception translations are bundled; run
  `python dev/sync_translations.py` after changing strings. The custom panel
  remains English, apart from native HA shell controls.
- Local verification: Ruff/format/syntax, 39 Python tests (99.08% integration
  coverage), 54 panel tests, and disposable-HA Playwright passed. Browser checks
  cover native list/task identity, two independent lists, existing native list
  connection/deletion, hide/reconnect, cancellation, cross-session changes and
  page reload. Real Android keyboard/IME remains an unverified manual check.
  Check the GitHub Validate run for the current commit separately.

The previous local-development summary and historical snapshot follow below.

## Local development update (2026-11-11)

- Local Windows/WSL setup is installed and verified. Use `dev/local.ps1 check`
  for ordinary checks and `dev/local.ps1 browser` for those checks plus the
  disposable-HA Playwright workflow. See `dev/README.md` for setup/start/stop.
- Task search is implemented: title/description literal
  substring matching, case-insensitive with surrounding whitespace ignored,
  intersected with the selected filter. Query survives list switches, resets on
  reload, and preserves entry/editor drafts. README/specs describe the behavior.
- The shell includes a themed header with HA's native sidebar control and follows
  HA's `narrow` state. Browser tests open/close the real drawer by touch/keyboard,
  navigate to native To-do and back, and check drafts during drawer/viewport
  changes. Wait for the native modal to finish closing before entering text.
- Active-task sorting supports Newest first (default/reversed source order) and
  Oldest first (source order). Completed tasks keep source order. This is a local
  display preference, retained across lists/updates and reset on reload; it does
  not change native task order. Native tasks have no general creation timestamp.
- The panel now uses native authenticated `todo/item/subscribe` snapshots so
  description-only changes update results. Subscriptions clean up on list or
  connection changes/disconnect, ignore stale results, and retain read/state
  fallback when rejected. Native tasks remain authoritative.
- `dev/local.ps1 browser` passed: Ruff/format/syntax, 18 Python tests (98.28%
  coverage), 48 panel tests, and the complete installed-HA browser workflow.
  Panel tests cover search, sorting, drafts, failures and subscription lifecycle/
  races; browser coverage verifies native order/data, description changes, filters,
  sorting, reload, list switching, focus, drafts, shell navigation and mobile
  overflow. Existing HA tests run unchanged because backend
  contracts/storage did not change; the browser tests exercise the native API.
- Guidance consulted: current official custom-panel docs, Core AGENTS/integration
  skill, native frontend To-do subscription implementation, entity docs, HACS
  requirements, and the official pytest framework guidance. No dependency,
  backend, permission, or minimum-version declaration changed. Consult the latest
  GitHub Validate run for the checked-out commit; local success does not certify
  CI. Real Android keyboard/IME verification remains outstanding.

The snapshot below describes the previously committed baseline.

This document lets a new session continue without access to the previous chat
or its cloud filesystem. It describes the state verified at commit `1068696`
(`106869676fdc5ff861c4803199524fa120104785`). Check newer commits and CI before
assuming this snapshot is current.

## Read first

1. [AGENTS.md](AGENTS.md): repository instructions and engineering workflow.
2. [specs.md](specs.md): approved requirements, decisions, and backlog. Some older
   milestone/testing notes are historical; consult the later baseline updates.
3. [dev/README.md](dev/README.md): Windows/WSL setup and local testing.
4. [README.md](README.md): current installation, features, and filter behavior.

Repository: https://github.com/JustinScott/ha-lists. Development changes described
here have been committed to `main`; a clone/pull includes the testing machinery.
GitHub is the transfer source. Local sessions do not need the old conversation.

## Product and implemented features

HA Lists is a local-first, HACS-installable Home Assistant custom integration.
The original conversation mentioned Microsoft To Do, but this project now wraps
native `todo` entities; Microsoft is an optional provider, not a required account
or a separate direct Microsoft API integration.

Implemented:

- A dedicated Lists sidebar panel and selection of existing native to-do lists.
- Add, rename, complete, reopen, and confirmed deletion of individual tasks.
- Descriptions, date-only deadlines, and timed deadlines where providers support
  them; native task identities and provider fields remain authoritative.
- Native To-do/HA Lists synchronization, including changes in another session.
- Filters: All (default), Active, Completed, Due today, and Overdue, with counts.

Not implemented: task search, user-selectable sorting, central autocomplete
history, provider list creation from the panel, and richer custom metadata.
Do not equate the current scaffold/milestones with release readiness or official
Home Assistant quality-scale certification.

## Latest feature: filters

- Filtering changes display only. Preserve task IDs, provider ordering, unsent
  quick-entry drafts, and open editor drafts.
- All includes completed tasks. Active excludes them; Completed includes only
  completed tasks. Existing display sorting is active tasks newest-first, then
  completed tasks in provider order.
- Due today and Overdue show unfinished tasks only, using the **browser user's
  time zone**, independently of the HA server zone. The UI displays that zone.
- Date-only deadlines remain due through the end of their local calendar day.
  Timed deadlines represent absolute instants and become overdue after the due
  instant. An overdue timed task may also be due today.
- Undated/invalid deadlines do not match date filters. Selection remains across
  list switches in one panel and resets to All on page reload.
- Date membership refreshes at deadline/midnight boundaries, on return to the
  tab, and within one minute of clock/time-zone changes. Timers/listeners are
  cleaned up on disconnect. This does not poll providers.

## Important pending decision: minimum HA version

**The user explicitly does not want to force users onto HA 2026.11.1.**

The currently published minimum in `hacs.json` is still **2026.11.1**, but it is
provisional. The priority compatibility backlog in `specs.md` requires:

1. Choose an older minimum based on actual API availability and testing.
2. Audit frontend components (including `ha-input`), native To-do capabilities,
   lifecycle contracts, and matching Python/test dependencies; adapt as needed.
3. Run integration and installed-HA browser tests against that exact minimum.
4. Test both minimum and current supported releases in CI.
5. Update the declared requirement and documentation only after verification.

Do not simply lower `hacs.json`, claim an untested older release works, or treat
use of the newest development runtime as a reason to require it of all users.
The compatibility task was recorded, not implemented. No specific older version
has been selected. The user then asked to resume feature work; filters are done.
Task search is a reasonable next feature, but no next feature has been approved.

Another backlog item is owner-or-administrator per-list write authorization.
Current writes use native HA entity control permissions. That is not equivalent
to enforcing list ownership against every ordinary local HA user.

## Verified testing baseline

For feature commit `1068696`:

- [GitHub Validate run 43060394283](https://github.com/JustinScott/ha-lists/actions/runs/43060394283)
  completed successfully: lint/syntax, Python integration tests/coverage, panel
  behavior tests, installed-HA browser scenario, Hassfest, HACS, and secret scan.
  Dependency review is PR-only and was correctly skipped on this push.
- Cloud checks passed: **18 Python tests**, **39 panel behavior tests**, and the
  complete installed-HA browser scenario. Python coverage was **98.28%** with
  a 95% enforced floor. No test skips were added for filters.
- Time tests cover UTC, America/Chicago, UTC+14, midnight, spring-forward,
  repeated fall-back times, timer cleanup, rollback, drafts, and sorting.
- Installed-HA browser tests verify five filters in two time zones, keyboard
  selection, completion/reopening, list switching, rejection/retry, and native
  synchronization/editing/deletion. Mobile/desktop screenshots were visually
  reviewed in the cloud; no horizontal overflow was found in the tested views.
- Real Android companion-app keyboard/IME behavior has **not** been verified.
  Browser mobile emulation is not a substitute for that manual acceptance test.

All automated suites are configured for pushes and pull requests. A group of
commits pushed together is tested at the resulting branch state. Manual Validate
runs can select all, pytest, behavioral, or browser. Inspect new CI results after
future changes; this handoff does not certify future commits.

Earlier run `43055826456` failed before browser tests because Ubuntu mirrors
could not resolve while downloading optional fonts. The successful filter run
uses `npx playwright install chromium` on Ubuntu 24.04, which already provides
required shared libraries. Tests/dependency validation were not disabled.

## Local setup and commands

Recommended Windows setup: WSL2 Ubuntu, Node.js 22, uv, and Docker Desktop with
WSL integration. Clone into the WSL Linux filesystem. Preserve any local edits
before pulling. See `dev/README.md` for prerequisites and full instructions.

From the repository root:

```bash
bash dev/setup.sh
bash dev/check.sh
```

Setup creates a Python 3.14 environment and installs committed Python/Node locks.
Do not reuse an older Python virtual environment. The tested runtime is HA
2026.11.1, Python 3.14.2+, frontend 20261028.5, and Local To-do ical 14.3.1.
The official `pytest-homeassistant` package replaces the retired
`pytest-homeassistant-custom-component`; do not install both.

For the browser suite, start Docker Desktop, then:

```bash
npx playwright install --with-deps chromium
bash dev/check.sh --browser
```

The disposable Docker instance creates synthetic accounts/tasks on a random
loopback port and removes its container/config afterward. Allow several GB of
free disk space. Normal Python/panel tests do not require Docker.

For an interactive development instance, run `npm run dev`, open
`http://localhost:8123`, and complete fresh onboarding. Configuration lives in
ignored `.dev-config/`. Do not connect tests to production HA.

Cloud browser checks used the optional isolated native-process mode because the
full HA image exceeded that workspace's disk capacity. That cloud Python
runtime, native libraries, credentials, and screenshots are not part of Git and
are not required when using the documented local Docker path.

## File map and working boundaries

- `custom_components/ha_lists/`: installable backend, manifest, translations,
  and bundled `frontend/panel.js`.
- `tests/`, `tests_ha/`, `tests_behavior/`, `tests_browser/`: packaging, real HA,
  simulated panel behavior, and installed-HA browser tests respectively.
- `dev/`: setup/check scripts, Windows guide, and sample development config.
- Root lockfiles, `.python-version`, `pyproject.toml`, `package.json`, and
  `compose.dev.yaml`: shared reproducible setup.
- `.github/workflows/validate.yml`: automated CI.

Keep credentials, account state, task data, caches, and installed environments
out of Git. Use synthetic data. Preserve native task identities and local-first
operation; do not add a required cloud/Microsoft account. Read the relevant spec
and current official HA guidance before editing; extend behavioral tests at the
layers that catch distinct regressions, and verify actual CI before reporting
success. Follow `AGENTS.md` for the full workflow.
