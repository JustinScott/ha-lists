# HA Lists — handoff for a new local Codex session

## Local development update (2026-11-11; locally verified, CI pending)

- Local Windows/WSL setup is installed and verified. Use `dev/local.ps1 check`
  for ordinary checks and `dev/local.ps1 browser` for those checks plus the
  disposable-HA Playwright workflow. See `dev/README.md` for setup/start/stop.
- Task search is implemented: title/description literal
  substring matching, case-insensitive with surrounding whitespace ignored,
  intersected with the selected filter. Query survives list switches, resets on
  reload, and preserves entry/editor drafts. README/specs describe the behavior.
- The panel now uses native authenticated `todo/item/subscribe` snapshots so
  description-only changes update results. Subscriptions clean up on list or
  connection changes/disconnect, ignore stale results, and retain read/state
  fallback when rejected. Native tasks remain authoritative.
- `dev/local.ps1 browser` passed: Ruff/format/syntax, 18 Python tests (98.28%
  coverage), 44 panel tests, and the complete installed-HA browser workflow.
  Five new panel tests cover search and subscription lifecycle/races; browser
  coverage verifies native description changes, filters, list switching, focus,
  drafts, and mobile overflow. Existing HA tests run unchanged because backend
  contracts/storage did not change; the browser tests exercise the native API.
- Guidance consulted: current official custom-panel docs, Core AGENTS/integration
  skill, native frontend To-do subscription implementation, entity docs, HACS
  requirements, and the official pytest framework guidance. No dependency,
  backend, permission, or minimum-version declaration changed. Hosted validation
  and real Android keyboard/IME verification remain outstanding.

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
