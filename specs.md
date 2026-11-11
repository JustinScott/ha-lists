# Lists — Home Assistant Application Specification

**Status:** Draft specification for implementation  
**Version:** 0.2 · 2026-11-02  
**Scope:** Provider-independent list management, dedicated Home Assistant UI, Assist voice support, and local suggestions/history.

## 1. Product goals

Build a free, local-first, application-style list manager integrated into Home Assistant. It must support multiple lists (groceries, hardware, home improvement, personal tasks), accessible from Home Assistant on desktop and Android, and usable through Home Assistant Assist. The application must work with native Home Assistant `todo` entities and allow changing providers without rewriting the UI or automations.

**Non-negotiables:** No paid service, billing account, cloud dependency, or Microsoft/Azure registration is required for the default installation. The default backend is Home Assistant Local To-do. Other providers, including Microsoft To Do, are optional and may have independent account/network requirements. No credentials, personal data, local addresses, user task content, or tokens may be committed to the public repository.

### Non-goals (initial release)

- Replacing the native Home Assistant `todo` platform.
- Automatically mirroring all provider-specific fields or guaranteeing seamless migrations between arbitrary providers.
- Building a full project-management or collaboration platform.
- Requiring AI inference, external APIs, or paid services for autocomplete.

## 2. Experience and UI

### Dedicated application shell

- Register a dedicated **Lists** sidebar entry opening a full-page panel, not a collection of scattered dashboard cards.
- Beacon-inspired clean task list, but **show full list names**, not icon-only list navigation.
- Desktop: persistent named-list sidebar, item counts, search, main list pane; optionally resizable split layout.
- Android: responsive list selector showing full names, touch-friendly rows, accessible controls, and a full-screen task editor.
- Follow Home Assistant theme, light/dark mode, spacing, accessibility and safe-area conventions. No separate login or publicly exposed web server.
- Provide loading, empty, offline, permission-denied, and error states; maintain keyboard and screen-reader support.

### Lists and items

- Create, rename, configure, reorder and archive lists **where supported**. A logical application list maps to an explicitly configured `todo` entity; do not assume generic HA services can create/delete provider lists.
- Fast add, checkbox complete/reopen, inline rename, remove with confirmation/undo where feasible, filter active/completed, sorting and searching.
- Clicking an item name opens a richer editor: title, description/instructions, due date, priority, additional notes, links, optional categories, subtasks, reference materials and future attachments.
- Desktop task detail: side pane/dialog; Android: full-screen detail view. Save/cancel and unsaved-change warning.
- List-specific presentation templates: **Simple/Grocery** mode defaults to compact entry; **Projects/Home Improvement** mode enables detailed fields; fields remain accessible regardless of mode.
- Optional grocery enhancements: quantity/unit, store section, frequent items, category grouping, quick-add shortcuts.
- Avoid unnecessary modals, icon-only navigation, swipe-only controls, and popup-only list access.

### Suggestions/autocomplete

- Update suggestions while typing, using case-insensitive prefix/substring matches; allow keyboard/touch selection and normal free-text entry.
- Prefer exact/prefix matches, then recency/frequency; optionally support typo tolerance later.
- Exclude already-active items from the same list (configurable).
- Keep a central **local suggestion catalog**, not browser-local state, so devices share suggestions.
- Seed catalog from provider completed items **when supported**, and learn from additions made through the UI, Assist, and automations when observable.
- Separate catalog per list by default; optionally share suggestions across lists. Store normalized label, display label, last-seen timestamp, frequency, source and list association.
- Provide controls to remove individual suggestions, clear history, disable learning, and rebuild from available provider history.
- Do not treat a provider's completed items as a guaranteed complete purchase history. Avoid double-counting on polling/restarts.

## 3. Provider-independent architecture

```text
Home Assistant sidebar panel (frontend)
                 |
     Authenticated HA WebSocket API
                 |
   Lists custom integration (Python)
      |                       |
Native HA todo adapter    Local metadata/catalog
      |                       |
Local To-do / Microsoft /  HA-managed persistent storage
other todo entities
```

- Native Home Assistant `todo` entities are the **source of truth** for supported core fields and completion state. Use standard `todo` actions (`todo.add_item`, `todo.update_item`, `todo.remove_item`, `todo.get_items`) as supported by each entity.
- Expose provider capabilities to the UI; do not assume every provider supports descriptions, due dates, completed-item retrieval, or stable item identifiers.
- Persist application-specific metadata (priority, rich notes, subtasks, suggestion history, UI preferences) separately in Home Assistant-managed storage, with schema versions and migration routines.
- Use durable internal item IDs and explicit mapping to provider item IDs when available; never rely on title alone. Define fallback matching and conflict handling when providers expose insufficient identity information.
- **Approved for initial release (Option A):** Provider independence means the UI can bind a logical list to a different native `todo` entity without changing frontend code. This does **not** copy existing tasks; tasks remain with their original provider. Explicitly warn users before changing the binding and preserve local metadata mappings.
- **Future optional goal (Option B; not required for initial release):** Implement a user-initiated, reversible provider migration workflow: export/backup, assess target capabilities, preview mapping, migrate/copy, verify counts and fields, preserve the source until verification, and allow rollback where feasible. Report unsupported fields and conflicts. Do not silently migrate or delete tasks.
- Define conflict rules for changes from multiple clients, stale data, provider errors, duplicate items, and eventual consistency. Do not silently overwrite newer changes.
- Never copy or delete source tasks without explicit user approval.
- Keep provider-specific APIs out of the frontend; define a narrow adapter/service layer in Python.

## 4. Voice and automation integration

- Expose intended `todo` entities to Assist; verify named-list intents route to the correct list.
- Document ambiguity between Home Assistant's built-in Shopping list intent and generic named-list intents. If needed, configure custom sentences/intent scripts that target explicitly selected `todo` entities.
- Support natural requests such as “Add milk to Groceries” and “Add batteries to Hardware Store”; test list names, synonyms, and duplicate handling.
- Prefer native Home Assistant `todo` actions in scripts and automations; keep provider-specific code behind the adapter.
- Provide reusable scripts or documented examples for voice add, mark complete and read-list operations, subject to supported Assist intents.
- Preserve the ability for future automations to add items even when the custom panel is closed.
- Do not claim universal voice support without end-to-end tests in the configured Assist pipeline.

## 5. Home Assistant integration implementation standards

- Implement as a properly structured custom integration under `custom_components/<domain>/` plus a separately built frontend bundle. Choose and document a unique domain before coding.
- Use `manifest.json` with version, requirements, documentation, issue tracker, integration type and appropriate dependencies; use config entries/config flow and options flow instead of requiring manual YAML.
- Follow Home Assistant async/event-loop rules; do not block the event loop with file I/O, network calls, database work or synchronous libraries.
- Use HA-managed storage and supported lifecycle methods; register/unregister listeners and panel resources correctly on setup/unload; avoid leaking tasks and subscriptions.
- Use Home Assistant's authenticated WebSocket extension mechanism for custom UI operations, with schema validation, authorization checks, bounded responses, and actionable errors. Prefer native services for standard to-do mutations.
- Register custom actions only where they add genuine functionality; validate schemas and targets. Avoid exposing unneeded services or undocumented private APIs.
- Follow Home Assistant's Integration Quality Scale and current developer documentation where applicable, including configuration, diagnostics, translations, tests, repair flows and clean unload/reload behavior.
- Use explicit capability detection and fail gracefully for unavailable, read-only or unsupported providers.
- Avoid unnecessary polling; subscribe to supported updates, and use bounded/debounced refresh or reconciliation when the underlying provider cannot push updates.

## 6. Frontend and dashboard standards

- Prefer a dedicated Home Assistant custom panel for the main application, with an optional reusable Lovelace card later.
- Use TypeScript and supported frontend APIs/components; prefer Lit/web components or another well-justified minimal approach. Avoid reliance on unstable HA internals.
- Use responsive layouts, accessible labels, visible focus, keyboard navigation, screen-reader announcements, minimum comfortable touch targets, and reduced-motion support.
- Use HA theme variables rather than hard-coded colors. Support dark mode, compact screens, landscape and large text.
- Sanitize/render Markdown safely; never inject unsanitized HTML from task notes or provider content.
- Debounce autocomplete, cancel stale requests, handle offline/reconnect, and prevent double-submit.
- Do not make users depend on hover, swipe, or drag-and-drop to complete essential operations.
- Provide clear success/failure feedback and retain unsaved edits if a write fails.

## 7. Python and code quality standards

- Target the Python version required by the supported Home Assistant release; do not pin an incompatible version.
- Follow PEP 8, modern type annotations, explicit data models, small cohesive modules, dependency injection where helpful, and separation of domain logic from HA integration glue.
- Prefer standard library and HA-provided helpers over unnecessary dependencies. Avoid global mutable state and hidden side effects.
- Use `ruff` for lint/format, `pytest` and `pytest-homeassistant-custom-component` for tests; add static type checking where practical and compatible.
- Add pre-commit/`prek` checks and CI to validate Python, frontend formatting/lint/typecheck, tests, manifests, and generated bundles.
- Use structured, redacted logging with useful error context; never log task contents or credentials at debug level by default.
- Document design decisions, edge cases, failure modes and migration compatibility; keep modules and interfaces readable to future maintainers.

## 8. AI-assisted development rules

- Read current Home Assistant developer docs, relevant ADRs, integration quality rules, and repository instructions **before changing architecture or code**; do not assume remembered APIs are current.
- Follow the repository's `AGENTS.md` (to be created) and this `specs.md`; these are project-specific instructions, not substitutes for upstream Home Assistant rules.
- Make small, reviewable, test-backed changes; preserve existing behavior unless an approved requirement changes it.
- Never invent HA APIs, services, entity capabilities, imports or frontend hooks. Verify against the supported HA version or existing source/tests.
- For every change, state assumptions, affected files, security implications, test commands, results and unverified limitations.
- Run formatting, lint, tests, type checking and HA integration validation when tooling is available; never report a check as passing unless it ran successfully.
- Use fixtures and synthetic task names; do not put actual personal lists, credentials, tokens, IP addresses or account identifiers in prompts, tests, screenshots, docs or public commits.
- Do not bypass security checks, suppress failing tests, or weaken validation just to get green CI.
- Require human review before destructive migrations, external publication, or modifying live Home Assistant configuration.

## 9. Security, privacy and zero-cost requirements

- Local-first, no required telemetry, advertising, subscription, Azure billing, or third-party backend.
- Use Home Assistant authentication and permission checks. Never expose an unauthenticated HTTP endpoint or standalone server by default.
- Validate all inputs; limit note length, payload size, query result count and request rate. Protect against XSS, injection and path traversal.
- Store sensitive data only in HA-approved protected locations; exclude `.storage`, `.env`, `.secrets`, logs, exports and real task data from source control.
- Add `.gitignore`, secret scanning, dependency vulnerability scanning and CI checks for accidental disclosure. Check both staged diffs and repository history before publication.
- Use sample configuration and synthetic fixtures only; no real hostnames, LAN IPs, passwords, personal information or task content in public repository.
- No elevated privileges, host networking, shell execution or internet access required for the default local backend.
- Backups/export must be explicit and privacy-conscious. Document retention and deletion of local suggestion/metadata history.

## 10. Test and acceptance criteria

### Functional

- Multiple Local To-do lists can be selected by full name, edited and used on Android and desktop.
- Items added through panel appear in native HA `todo` entities and vice versa.
- Complete/reopen, rename, delete, search, filtering and detailed editing behave correctly.
- Rich metadata survives restart and is not lost when core task fields change.
- Autocomplete updates as user types, learns from observable additions, respects list boundaries, and can be cleared.
- Named-list Assist commands add to the correct entity; built-in Shopping list ambiguity is tested and documented.
- Provider unsupported capabilities are communicated clearly without data loss.
- Initial-release provider rebinding between two test adapters changes the selected entity without copying or deleting tasks, and preserves existing metadata associations.
- Future Option B acceptance (deferred): migration between test adapters preserves supported fields and local metadata, reports unmappable fields, and requires explicit approval.

### Reliability and security

- Integration setup, reload, unload, restart and upgrade work without duplicate listeners or lost data.
- Concurrent edits, duplicate titles, missing provider IDs, offline state, provider timeouts and stale responses are covered by tests.
- UI remains usable with keyboard and screen reader; mobile layout has no horizontal overflow.
- No credentials, personal data, addresses or real list content exist in tracked files or test fixtures.
- CI passes lint, formatting, Python tests, frontend checks, and relevant HA integration validation before release.

### Executable behavioral regression suite (added 2026-11-09)

- CI runs Node-based DOM behavioral tests in `tests_behavior/panel.test.mjs` on every push and pull request, independently of Python/HA tests. These tests execute the actual frontend panel code with synthetic Home Assistant state and mocked authenticated WebSocket/service calls; they are not source-text contract checks.
- Current scenarios cover configured-list loading, empty states, list switching, native add via Enter and Add, consecutive entry and retained input element, composition/duplicate submission, failed additions, completion/reopening and sorting, rollback on failed update, pending-update suppression, and safe text rendering.
- `.github/workflows/validate.yml` offers manual `workflow_dispatch` suite choices: `all`, `pytest` (Home Assistant tests), or `behavioral`. The existing lint-and-contracts job also runs regular `tests/` Pytest on push/PR. The manual `pytest` choice runs both the regular `tests/` and Home Assistant `tests_ha/` suites as separate jobs.
- All new features and bug fixes must add executable behavioral tests as applicable before being considered complete. Browser DOM simulations do **not** replace real Android companion-app keyboard/IME verification or integration tests against HA.
- These tests were committed without an observed passing CI run; do not mark the suite verified until GitHub Actions results are checked.

## 11. Suggested milestones

1. **Foundation:** repository, documentation, `AGENTS.md`, CI, secret scanning, integration scaffold, config flow, HA panel registration, Local To-do discovery/selection.
2. **Core lists UI:** named-list sidebar, responsive list view, add/edit/complete/delete, loading/error states, native entity synchronization.
3. **Rich task editor:** descriptions, notes, priority, due date, subtasks, metadata persistence and capability-aware editing.
4. **Suggestions:** central local catalog, provider history import where supported, frequency/recency ranking, autocomplete, clear-history controls.
5. **Assist and automations:** expose lists, voice test matrix, optional sentence routing, reusable scripts, end-to-end tests.
6. **Provider portability (Option A):** adapter hardening, safe rebinding, capability checks, conflict handling and validation against a second provider. Full migration preview/export/import is deferred to a separately approved future milestone (Option B).
7. **Polish/release:** accessibility, Android testing, performance, documentation, HACS distribution and release checklist.

### Milestone 2 — task completion and reopening (implementation pending verification, 2026-11-09)

- Each task row has an accessible, touch-friendly checkbox to complete or reopen it.
- Display active tasks in reverse provider order so newly added Local To-do tasks appear at the top. Completed tasks stay below active tasks, keep their provider order, and display with struck-through titles. Sorting changes the HA Lists display only.
- Future enhancement: allow users to choose a task sort order, including newest-first and oldest-first.
- Use native `todo.update_item` with the provider's stable item UID where available, falling back to summary only when needed. Respect provider capability and error responses.
- Prevent duplicate updates while an item change is pending, and restore the prior displayed status if the update fails.
- Verify both directions against a Local To-do entity and in the Android companion app; add regression tests for status updates, failures, sorting, and repeated taps.
- Implementation started in commit `7fe7aa3`; this is **not yet user-verified or release-ready**.

### Milestone 2 — task title editing

- Selecting an editable task title opens a title field with Save and Cancel. Enable editing for lists that support native item updates and tasks with a stable provider UID.
- Save sends the trimmed title through the native To-do update action. Cancel discards the draft. A failed save preserves the draft and displays the error.
- Before saving, fetch the current task by UID. If it was removed or its title changed since editing began, preserve the draft and ask the user to reopen the task. The native update action does not provide an atomic compare-and-set.
- Verify that native To-do reflects a rename made in HA Lists without refreshing the browser. Verify that the renamed task retains its UID and existing fields after a Local To-do restart.

### Milestone 2 — deleting individual tasks

- On lists that support removal, open a task by its title and choose Delete. Show the task title in the confirmation and focus Keep task by default.
- After confirmation, send the stable task UID through the native To-do remove action. Keep the task visible if the provider rejects removal. Other tasks with the same title retain their own identities.
- Verify removal across HA Lists and native To-do without refreshing, including a completed task with an active duplicate. Verify denied writes and that a deleted UID remains absent after restart.

### Milestone 2 — task-entry UX acceptance criteria (approved 2026-11-09)

- Task entry must work in the Home Assistant Android companion app as well as Chrome, Firefox, and desktop browsers. Use a compatible Home Assistant input component (currently `ha-input`); avoid unmounting or replacing the active input during asynchronous updates, which can dismiss the Android keyboard.
- Pressing **Enter/Done** in the task input and activating **Add** must each submit the current item exactly once through the configured native `todo` entity.
- **After a successful add**, clear the input, keep or restore focus to the task-entry field, and keep the Android soft keyboard available for immediate entry of the next item without another tap. This applies to both Enter and Add-button submission.
- On failure, preserve the unsent draft and show a clear error. Do not steal focus when navigating away or changing lists while a submission is pending. Handle IME composition, pending submissions, and duplicate-submit prevention.
- Regression-test keyboard focus, consecutive additions, and submission in the Android companion app where feasible. The browser-only pass does not establish Android-app compatibility.
- Track implementation in [GitHub issue #1](https://github.com/JustinScott/ha-lists/issues/1). This is a **Milestone 2 core task-entry requirement**, to complete before expanding to task completion/editing. The issue is not itself evidence that the behavior is implemented.

### Milestone 3 — native descriptions and due dates

- Edit descriptions and date-only deadlines for tasks whose providers support those fields. Save only changed fields through the native To-do update action. Clearing an editable field sends a null value.
- Allow timed deadlines when the provider supports them. Show the browser time zone beside the editor, convert the entered local date and time to an explicit UTC instant on save, and preserve the original value when the deadline is unchanged. Allow conversion to date-only when supported and clearing the entire deadline. Reject nonexistent daylight-saving times and retain the draft. Newly entered ambiguous fall-back times use the browser's earlier occurrence. Overdue and Due today filters follow the task-filter rules below.
- Preserve the draft on save failure. Check changed fields against the latest provider values before writing, so a detected concurrent change to the same field is not overwritten.
- Verify capability handling, field clearing and conflict behavior in the panel suite, updated values after a Local To-do restart, and updates in the open native To-do browser session.

### Task filters — All, Active, Completed, Due today, and Overdue

- Provide an accessible "Show tasks" selector with All (default), Active,
  Completed, Due today, and Overdue. Filtering changes display only: preserve
  task identities, native provider order, existing active/completed sorting,
  unsent quick-entry drafts, and the current task editor.
- Active excludes completed tasks; Completed shows completed tasks only. Due
  today and Overdue show unfinished tasks only. Undated tasks remain visible
  in All/Active but do not match date filters. Invalid provider deadlines do
  not match date filters.
- Use the browser user's local time zone, shown beside the date filters,
  independently of the HA server's time zone. A date-only deadline is a calendar
  date and becomes overdue after that date's local midnight. A timed deadline
  is an absolute instant: Overdue matches once that instant is past; Due today
  matches its local calendar day, including earlier times today. The two date
  filters can overlap. Account for daylight-saving and date-boundary changes.
- Refresh date membership at local midnight and timed deadlines, recheck the
  clock/time zone within one minute, and refresh on return to the tab. This is
  client-side display work and does not poll the provider. Clean up timers and
  visibility listeners when the panel disconnects.
- Retain the selection across list switches in the open panel; a new panel or
  page reload defaults to All. Show matching/total task counts and distinguish
  an empty list from a list with no filter matches. Completing/reopening tasks
  updates filter membership after provider success and recovers on failure.
- Test behavior with fixed clocks across UTC, America/Chicago, and UTC+14,
  including date-only versus timed deadlines, DST, empty results, draft and
  sort preservation, cleanup and failed updates. Installed-HA browser tests
  cover all five filters, keyboard selection, completion/reopening, and two
  simultaneous users' time-zone views with synthetic tasks.

### Backlog — per-user list write permissions

- Define list ownership and enforce owner-or-administrator task writes on the server. Native Home Assistant To-do lists currently follow Home Assistant entity permissions, including access granted to ordinary local users.
- Add a real Home Assistant regression test with a list owner, an administrator, and another ordinary local user. Verify that the owner and administrator can add, rename, complete, reopen, and delete tasks. Verify that the other user is denied and the list stays unchanged, including when that user calls the native To-do actions directly.

### Backlog — lower and verify the minimum Home Assistant version (priority)

- [ ] Replace the provisional HA 2026.11.1 user requirement with an older,
  deliberately chosen support baseline. Users should not need the latest HA
  release merely because development/testing uses it. Determine the exact
  older version from API availability and compatibility tests; do not assume it.
- [ ] Audit frontend components (including `ha-input`), native To-do features,
  lifecycle return contracts, and Python/test-framework requirements. Make the
  compatibility adjustments needed for the chosen older release.
- [ ] Run the Python integration suite and installed-HA browser suite against
  that exact minimum version, with its matching frontend, Python and test
  dependencies. Verify setup/reload, configuration, task operations, persistence,
  permissions, and failure recovery before declaring support.
- [ ] Add CI coverage for both the chosen minimum and the current supported HA
  release on pushes and pull requests, keeping the latest development runtime
  independent from the minimum version required of users.
- [ ] Update `hacs.json`, README, dependency/test configurations and compatibility
  documentation together after the older baseline passes. Until then, the
  published 2026.11.1 minimum remains provisional; this backlog entry does not
  claim older versions already work or change the installed requirement.

## 12. Approved architecture decisions and open implementation details

**Approved:** Extended task data and suggestion history reside in Home Assistant-managed local storage. Initial provider portability is Option A (rebind without task migration). Option B remains a documented future goal, not an initial-release requirement. Package as one HACS-compatible custom integration with a bundled dedicated frontend panel; no standalone server or add-on is required.

**Still to determine during implementation:**

- Final integration domain/repository name.
- Whether Local To-do list creation is handled through HA's existing configuration flow or an optional guided UI.
- Metadata persistence strategy and item identity mapping for providers without stable IDs.
- Exact supported HA version baseline and compatibility matrix.
- Whether attachments are metadata-only links initially or require a secure local file-management component.
- How Assist aliases are configured and how ambiguous shopping-list phrases are handled.

## 13. Primary references

- Home Assistant developer integration scaffold: https://developers.home-assistant.io/docs/creating_component_index/
- Home Assistant configuration guidance: https://developers.home-assistant.io/docs/configuration_yaml_index/
- Home Assistant WebSocket extension: https://developers.home-assistant.io/docs/frontend/extending/websocket-api/
- Home Assistant service actions: https://developers.home-assistant.io/docs/dev_101_services/
- Home Assistant frontend custom cards: https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card-feature/
- Home Assistant frontend component updates (2026.8): https://developers.home-assistant.io/blog/2026/07/31/frontend-component-updates-2026.8/
- Home Assistant developer documentation: https://developers.home-assistant.io/

**Specification rule:** If implementation reveals a conflict between this specification and supported Home Assistant APIs, document the conflict and propose a spec amendment before silently changing behavior.

## 14. Specification maintenance policy

`AGENTS.md` requires every architecture, functionality, persistence, API, UX, or compatibility change to review this specification. If requirements or behavior change, update `specs.md` in the same change set. If no update is necessary, the change summary must explicitly state why. Proposed deviations from approved requirements require approval before implementation.

### Milestone 1 implementation decisions

- Integration domain: `ha_lists` (working name).
- Foundation uses a UI configuration flow with no external credentials or network requirements.
- Milestone 1 is incremental: establish an importable integration, lifecycle-safe setup/unload, test and CI infrastructure first; implement a production-ready sidebar panel and Local To-do selection only after verifying the supported Home Assistant frontend and to-do APIs.


### Milestone 1 progress: sidebar and entity discovery (2026-11-03)

- The initial sidebar panel is registered through Home Assistant's `panel_custom` integration and a bundled, locally served JavaScript module.
- The panel currently discovers visible `todo.*` entities from the authenticated frontend state, displays full friendly names, and allows **temporary, read-only selection**. Selection is not yet persisted and does not change the underlying provider.
- Task retrieval, mutation, metadata persistence, responsive drawer/editor, and provider migration remain unimplemented.
- This JavaScript panel is an intentionally small foundation. A maintainable TypeScript/Lit frontend and a proper build pipeline are still required before release.
- The first production-ready provider-selection implementation must persist an explicit mapping in the integration and handle unavailable, renamed, and deleted entities.
- Do not interpret the current panel as an end-to-end integration test; verify registration and teardown against a dedicated Home Assistant development instance.


### Milestone 1 progress: configured lists and native item reads (2026-11-06)

- Added a Home Assistant Options flow using a multiple-entity selector restricted to `todo` entities. Selected entity IDs persist in config-entry options; no credentials or personal task content are stored in the repository.
- Added an authenticated integration WebSocket command, `ha_lists/lists`, that exposes the selected IDs to the bundled frontend.
- Added frontend read-only task retrieval using the native `todo/item/list` WebSocket command, with loading/empty/error states and stale-response protection when switching lists.
- The selection is a list visibility preference, not provider migration or a portable logical-list identity mapping. Entity rename/removal recovery remains pending.
- Task creation, mutation, metadata persistence, and visual/runtime integration validation remain pending. The current implementation is unverified against a running Home Assistant instance.


### CI and automated test harness (2026-11-06)

- GitHub Actions validates Python lint/format/syntax, frontend JavaScript syntax via Node, dependency-free contracts, and a separate Home Assistant pytest job using `pytest-homeassistant-custom-component`.
- The initial HA harness covers local configuration entry creation and persistence of selected `todo` entity IDs in options.
- These checks do not deploy to production, test actual provider task retrieval end-to-end, or replace browser visual testing.
- The workflow and HA tests must be verified against real GitHub Actions job results before treating them as passing quality gates.


## Engineering standards and automated testing acceptance criteria (2026-11-07)

**Scope:** All implementation milestones, CI changes, refactors, bug fixes, and generated code. The companion `AGENTS.md` makes these standards mandatory before committing. These requirements are intended to follow current Home Assistant developer guidance, its repository AI/agent instructions and integration knowledge skill, the custom-component testing framework, and Python best practices; refresh references whenever implementing a change.

### Required source-of-truth hierarchy

- Approved product requirements and security boundaries in this specification remain authoritative for project scope; changes need approval. For implementation details, consult current official Home Assistant contributor documentation, architecture decisions, Core `AGENTS.md` and relevant official AI integration skill, applicable integration quality-scale rules, supported HA APIs, and the framework documentation.
- Prefer proven Gold/Platinum integrations as implementation examples, but do not copy features irrelevant to Lists. Core-only rules and commands are guidance rather than automatically executable requirements for this HACS custom component. Record conflicts and applicability decisions.
- Use modern, idiomatic Python: explicit concrete type annotations, simple maintainable modules, predictable exception handling, minimal dependencies, Ruff lint/format, pytest, and async-safe HA patterns. Never block the event loop with synchronous network or disk work; clean up listeners and registered resources on unload.

### Custom-component test framework requirements

- Test against a declared, supported HA version using `pytest-homeassistant-custom-component`, `pytest`, and `pytest-asyncio`. Set `asyncio_mode = "auto"`; ensure the repository root is importable (e.g., `python -m pytest`). Use `enable_custom_integrations` correctly and preserve special fixture setup order.
- Use `MockConfigEntry` from `pytest_homeassistant_custom_component.common`, not Home Assistant Core's `tests.common` import. Use native Local To-do for task behavior and persistence. Use synthetic entity states or provider doubles for cases that need deterministic control. Keep fixtures deterministic, synthetic, and free of production data; colocate `fixtures/` files with tests. Configure the framework-specific Syrupy extension if snapshots are introduced.
- Exercise integration behavior through HA interfaces: configuration/options flows, config entry setup/unload, HA states/services, authenticated WebSocket clients, and registries when relevant. Pure-logic unit tests are complementary. Source-text contract checks and JavaScript/Python syntax checks alone do not establish runtime correctness.
- Write typed tests, use parameterization with named cases instead of branching, use `@pytest.mark.usefixtures` for unused fixtures, and avoid fragile time-dependent expectations. Use a freezer fixture for time. Every bug fix must have a regression test that fails without the fix.
- Test configuration flow success, duplicate abort, validation errors and recovery, options persistence and invalid selection, startup/shutdown, deleted/unavailable lists, provider errors, permission enforcement, malformed WebSocket inputs, asynchronous race handling, and changes to persisted data. Expand tests when new capabilities are introduced; do not prematurely assert support for features not yet implemented.
- Use coverage reports to find untested behaviors. The repository has no numeric coverage gate. Home Assistant's quality-scale criteria apply separately if the project pursues that designation.

### Translation, security, and release quality gates

- Keep UI-facing messages translatable and validate configuration and options strings. Regenerate/check `translations/en.json` after `strings.json` changes using a documented workflow appropriate for a custom integration; do not assume Home Assistant Core's translation scripts are installed in this repo.
- Validate authentication and authorization of WebSocket calls, least privilege, no leaked tokens/task data, safe logging, offline/error behavior, local-first operation, compatibility with native `todo` capabilities, and backward-compatible persisted state.
- Run `npm run test:all` for code changes and run the feature-specific checks selected below. CI runs the regular checks on push. Report any applicable check that could not be run, and verify GitHub Actions results before reporting that CI passed.
- No tests may be skipped, assertions weakened, or checks removed merely to obtain a green CI run. A commit, workflow trigger, or green lint job does not prove integration tests pass. Never test against production Home Assistant without separate explicit authorization.
- Each handoff must identify references consulted, spec/agent impact, tests and exact results, coverage when available, the actual CI run and outcome, risks, and any unverified behavior.

### Reference documentation

- Home Assistant contributors: https://contributors.home-assistant.io/core/
- Integration creation: https://contributors.home-assistant.io/core/integrations/create/
- Official testing practices: https://contributors.home-assistant.io/core/development/tests/
- Running tests and coverage: https://contributors.home-assistant.io/core/development/testing/
- Integration quality scale: https://contributors.home-assistant.io/core/quality-scale/
- Home Assistant Core AI agent instructions: https://github.com/home-assistant/core/blob/dev/AGENTS.md
- Home Assistant integration AI knowledge: https://github.com/home-assistant/core/blob/dev/.claude/skills/ha-integration-knowledge/SKILL.md
- Custom-component test framework: https://pypi.org/project/pytest-homeassistant-custom-component/
- Python: https://docs.python.org/3/
- pytest: https://docs.pytest.org/
- Ruff: https://docs.astral.sh/ruff/

### Persistence, permissions, and state-change regression coverage

- Home Assistant persists the configured list IDs in config-entry options. Native Local To-do persists tasks and their supported fields. The restart test reads both from the same configuration directory in a fresh Home Assistant instance.
- HA Lists discovery applies the authenticated user's entity read policy. The panel sends task writes through native To-do actions, which enforce entity control permissions. Home Assistant owns the native To-do WebSocket endpoints.
- Reload restores the panel and reuses the registered HTTP asset and WebSocket command. The open panel refreshes tasks when Home Assistant publishes a changed state for the selected entity, while preserving the draft input. Changes that do not produce an entity state update may require a fresh task request.

### Behavior-first testing workflow

Every new feature must add or extend an automated test that verifies its observable behavior. For each feature, review every layer below and choose where each distinct regression can be caught reliably. In the change summary, briefly record the layers used and why any other layer adds no distinct coverage. Features that cross layers may need more than one test, such as a real HA authorization test and a browser test for the error shown to the user.

| Test layer | Use it to verify |
| --- | --- |
| Fast checks and focused unit tests | Packaging, translations, syntax, and isolated logic whose edge cases are easier to exercise directly. Keep Ruff, Hassfest, HACS validation, and secret scanning in push CI. |
| Home Assistant integration tests | Behavior through public config flows, authenticated WebSocket commands, native To-do actions, entity state, and entry lifecycle. Use real Local To-do and temporary on-disk storage for persistence, reload, or restart behavior. |
| Panel behavior tests | What users see and do in the panel, including keyboard entry, errors, focus, stale responses, and rapid actions. Control timing or inject a specific failure when that makes a scenario reproducible. |
| Disposable HA instance and real browser | Workflows that depend on the installed integration, HA frontend, authentication, browser interaction, or synchronization between clients. Run the browser suite on demand for changes to these paths and extend it when a new feature introduces a distinct end-to-end risk. The existing smoke test follows a task from native To-do to HA Lists and its completion back to native To-do. Use synthetic data in the isolated instance. |

Run the Python suite once in push CI and publish coverage as a diagnostic report. See the README for local and on-demand CI commands. Keep the tests that would catch a realistic regression, assert results at the public boundary, and consolidate duplicates once a stronger scenario covers their distinct behavior. Use narrow test doubles where real services cannot reliably reproduce a failure or race. Review brittle tests and slow checks for the behavior they protect before adding more mandatory steps. A test should help a maintainer diagnose a regression, whether the change was written by a person or an agent.

### Verified runtime and reliability baseline (2026-11-11)

- The provisional minimum is Home Assistant 2026.11.1, pending the priority
  compatibility backlog above. It is currently declared in `hacs.json` and
  exercised by both Python and installed-HA browser tests. Python is 3.14.2+;
  frontend 20261028.5 and Local To-do ical 14.3.1 match this HA release.
- The official `pytest-homeassistant==2026.11.1` package replaces the retired
  `pytest-homeassistant-custom-component` harness referenced in earlier sections.
  Imports and fixture setup follow the official package's migration guide.
  This supersedes older framework and Python 3.13 guidance above.
- Setup and unload hooks use HA's current `None` return contract. Process-wide
  static routes/WebSocket registration survive reloads; unloaded or failed
  entries return no configured list IDs. Authentication, per-entity read/control
  policy, invalid payload recovery, repeated reload and partial setup recovery
  are tested through HA interfaces. This is not a claim of IQS certification.
- CI runs installed-HA browser checks for pushes, pull requests, and manual
  `all`/`browser` runs. Python coverage has an enforced 95% floor. Requirements
  pin the matching official harness and runtime dependencies, with a committed
  transitive Python lock; Node dependencies
  use the lockfile. Update the minimum, harness, frontend, image and docs together.
- `compose.dev.yaml` provides a loopback-only development instance and ignored
  persistent state. Browser tests retain a disposable Docker default, with an
  optional isolated native process for constrained environments. No existing
  real HA instance or credentials are accepted by the test runner.
- Expanded browser acceptance includes rapid entry/double-submit, list switching,
  injected service rejection with draft preservation and recovery, and mobile
  overflow/focus checks. Mobile emulation does not establish Android keyboard/IME
  acceptance; test that manually on a companion app before a release.
- Display Home Assistant's structured error message when available instead of
  rendering an opaque JavaScript object. Preserve drafts after provider failures.

- Authentication rejection runs against the installed HA server in the browser
  suite and asserts both `auth_invalid` and closure. This retains the assertion
  while avoiding a heartbeat-timer leak in the fixture-based aiohttp 3.14.5
  rejected-auth teardown; no cleanup verification is disabled.

- Local Windows development uses WSL2, with setup/check scripts and a guide in
  `dev/`. Scripts install the committed Python/Node locks and invoke the same
  checks as CI; generated environments, credentials and task data stay ignored.

- Browser CI installs Chromium without the optional system-package installer:
  the Ubuntu 24.04 runner already provides Chromium's shared libraries. The
  earlier run failed downloading optional fonts from Ubuntu mirrors before
  executing browser tests; tests and runtime dependency validation stay enabled.
