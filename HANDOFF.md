# HA Lists — handoff for a new local Codex session

## Voice assistant access and Assist phrase matrix (2026-11-20)

- List settings has a "Voice assistants" section (admins only) between View
  options and This list. Checkboxes per assistant read/write HA's native
  exposure via `voice.py` (`exposed_entities`: `async_get_should_expose` to read
  without storing defaults, `async_expose_entity` to write). Assist always;
  Alexa/Google only when HA Cloud is signed in and enabled. New admin WS command
  `ha_lists/list/voice` (connected lists only; `assistant_unavailable` error).
  Exposure listeners re-push `ha_lists/subscribe` state so HA-settings changes
  appear live. `management.voice` is null when exposure support is absent.
- `tests_ha/test_assist_phrases.py`: 25 supported phrases pass, 12 strict xfail
  gaps (see README "Voice assistants"). Aliases and "Grocery List" naming work.
  Requirements: hassil, home-assistant-intents, gazetteer-matcher (pinned to HA
  2026.11.1) added to requirements-test.txt/lock. Browser config now loads
  `conversation:`; new voice-checks.mjs toggles Assist in the panel and verifies
  `/api/conversation/process` end to end plus live sync from HA's expose API.
- Local: lint/format/syntax, 90 Python tests + 12 xfail (97.48%), 76 panel tests,
  full installed-HA browser workflow (native-process mode) passed. A clean venv
  from the lockfile also passed. Real satellite/speech-to-text not verified.
- Production: the user's two lists are stored as not exposed to any assistant;
  their "Voice Assistant" satellite was unavailable on 2026-11-20.

## List settings menu and right-side drawer (2026-11-20)

- The mobile **My lists** drawer now slides in from the right, next to its header
  button; backdrop dismissal is on the left. The task heading's former hamburger
  "List menu" is a cogwheel named **List settings**. Its menu shows View options
  first, then a "This list" section with **Hide from Lists** (renamed from "Remove
  list from panel", with a hint that tasks stay in HA) and red **Delete list…**.
  Styling only: full-width rows, decorative aria-hidden MDI icons, one card
  instead of nested boxes, aligned selects. No backend, storage, permission,
  translation or packaging change; native disclosure/select semantics retained.
- Tests: new panel regression for name/order/icon semantics; browser drawer check
  asserts right-edge placement and clicks the left backdrop; browser helpers use
  the new names; two new screenshots (list-settings-mobile, -view-mobile).
  Local: lint/format/syntax, 59 Python tests (97.09%), 74 panel tests and the full
  installed-HA browser workflow (native-process mode) passed. Android Companion
  and screen-reader checks remain unverified.

## Narrow-screen list drawer (2026-11-15)

- HA-supplied narrow mode places the existing list pane inside a native modal
  dialog, opened with the labelled hamburger “My lists” button in the header.
  Desktop keeps the persistent pane. There is one shared selector/management
  form tree; moving it on responsive changes never detaches task entry. List
  selection closes the drawer, restores opener focus and retains the quick draft.
- Native dialog supplies modal background inertness; explicit Tab/Shift+Tab
  boundary wrapping keeps focus out of browser chrome. Close, Escape and backdrop
  dismissal work. Opening slides from the left (now from the right, 2026-11-20); reduced motion disables animation.
  Resizing to desktop closes the modal and restores the inline pane. Close it on
  unload. Preserve focused list identity through native navigation rerenders.
- New/Connect stay in the drawer. Deletion confirmation/errors open it on narrow
  screens, focusing Keep list; cancelling or successful deletion returns to the
  task pane. Creation closes it when the new list is automatically selected.
  Existing admin permissions, confirmations and native task authority remain.
- Guidance mapping: current HA custom-panel/context docs require the native HA
  header/sidebar and supplied narrow state; those stay separate from the local
  selector and task-options menu. HTML dialog and WAI-ARIA modal guidance map to
  native showModal/close, labelling, focus containment/restoration and dismissal.
  Installed-HA browser tests verify actual focus cycles, touch/keyboard selection,
  backdrop/Escape, retained geometry/drafts, desktop resizing, native HA sidebar
  and all management workflows. The panel regression covers state/lifecycle and
  stable task input with a minimal dialog test double; it cannot prove modality.
  Sources: https://contributors.home-assistant.io/frontend/custom-ui/panel/
  https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element
  https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
  Core AGENTS/integration knowledge, HACS and official pytest guidance were
  reconsulted. No backend API/storage/dependency/packaging change; existing real
  HA integration tests remain the backend gate. Specs and README updated.
- Local lint/format/syntax, 59 Python tests (97.09% coverage), 73 panel tests and
  the complete disposable-HA browser workflow passed. Reviewed synthetic mobile
  open/closed drawer screenshots. Browser helpers use actual visible navigation,
  await HA narrow-state updates on resize and animation completion for screenshots;
  no assertions/timeouts were removed. Android Companion/keyboard and manual
  screen-reader verification remain unverified. No production writes/deployment.
  Consult final commit's GitHub Validate status separately.

## Explicit Enter during dictation (2026-11-15)

- Composition session state now controls suggestion continuity, not a blanket
  keyboard/form submission veto. Native KeyboardEvent.isComposing or process-key
  code 229 still guard IME candidate confirmation. A normal Enter resets the
  session flag and submits once; native form submission remains available even
  with an open session. Browser implicit-submit handling consumes genuine IME
  confirmation. Removed the special pointer-click composing-submit workaround;
  the ordinary form handles Add, including touch clicks with detail=0.
- The previous session-wide guard deterministically rejects explicit Enter before
  compositionend. New panel regression covers normal Enter and native submit
  with a session open. The former blanket-veto assertion now checks the genuine
  legacy process-key signal (229 with isComposing absent), alongside existing
  native isComposing/repeated Enter tests. This changes the intended contract
  for explicit dictation actions without removing candidate-confirmation safety.
- Installed-HA Playwright keeps actual Chromium composition open, dispatches
  emulated DOM key signals on the native HA input, rejects candidate confirmation
  and accepts a non-composing Enter. Existing every-frame geometry, focus,
  newest-first, touch and consecutive-entry assertions still apply. It does not
  operate a real microphone or establish Android keyboard compatibility.
- Guidance mapping: current HA custom-panel context/themes and pinned ha-input
  contract retain native shell/input. Chrome's IME-safe Enter guidance specifies
  per-key isComposing + 229 checks and native form availability; Chromium Android
  editor actions synthesize Enter when enterkeyhint is specified. These inform
  the narrowed guard, tested by panel event regressions and installed-HA shadow
  input/native-write checks. Reconsulted Core AGENTS/integration knowledge,
  HACS and official pytest guidance. No backend API, storage, dependency,
  packaging or translation change; existing real-HA tests remain the backend gate.
  Sources: https://developer.chrome.com/docs/modern-web-guidance/guides/forms/ime-safe-enter-submit
  https://w3c.github.io/uievents/#dom-keyboardevent-iscomposing
  https://contributors.home-assistant.io/frontend/custom-ui/panel/
  https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/public/android/java/src/org/chromium/content/browser/input/ImeAdapterImpl.java
- Local lint/format/syntax, 59 Python tests (97.09% coverage), 72 panel tests and
  the complete disposable-HA browser workflow passed. Actual Android microphone
  keyboard events remain unverified; do not equate emulated signals with a real
  dictation session. No production writes/deployment. Check final commit's CI.

## Steady task entry (2026-11-15)

- Add retains its label/size; disabled state and form aria-busy indicate progress.
  Pointerdown preserves an already-focused native input. Focus is established
  synchronously with preventScroll when needed, never twice after async writes.
  Moving focus elsewhere during a write is respected. Explicit pointer/touch Add
  can submit a composing draft; IME confirmation Enter remains guarded. Chromium
  touch clicks can have detail=0, so use pointerType as well as click count.
- Keep the current entity's last successful native snapshot during refresh and
  refresh failure. Clear snapshot ownership on connection/list changes; never
  show another list's tasks. Initial loads still show loading feedback. This
  avoids collapsing the page and clamping its scroll position after each add.
- Four panel regressions cover pending refresh/button geometry contracts,
  pointer focus/late focus stealing, refresh failure/list isolation and explicit
  composing Add. Each affected behavior failed before its fix. Installed-HA
  browser checks sample control bounds every frame in a 390x430 viewport, assert
  no input blur, exercise actual Chromium composition plus touch Add and immediate
  keyboard entry, and verify confirmed additions appear first. The whole form is
  made visible before measurement so automation's initial scrolling is excluded.
- First CI run passed the entry-geometry checks but exposed a dropped Enter in
  list creation: a pending native task read blocked adds while retained snapshot
  counts were already visible. A deterministic delayed-read regression reproduces
  it. Native adds no longer depend on snapshot reads; duplicate pending writes
  remain blocked and native service validation still applies. No browser
  assertion or timeout was weakened to hide the race.
- Guidance mapping: current HA custom-panel/theme/context guidance preserves the
  native shell and ha-input; pinned HA input delegatesFocus plus HTML focus and
  Pointer Events guidance inform preventScroll and retained native focus. Verify
  through panel focus/race tests and installed-HA bounds/touch/keyboard/IME checks.
  Reconsulted Core AGENTS/integration knowledge, HACS and official pytest guidance;
  backend permissions, storage, packaging and translations are unchanged, so no
  new Python test is needed. Existing real-HA tests remain mandatory.
  Sources: https://contributors.home-assistant.io/frontend/custom-ui/panel/
  https://html.spec.whatwg.org/multipage/interaction.html#dom-focus-dev
  https://www.w3.org/TR/pointerevents3/#the-pointerdown-event
  https://github.com/home-assistant/frontend/blob/20261028.5/src/components/input/wa-input-mixin.ts
- Local lint/format/syntax, 59 Python tests (97.09% coverage), 71 panel tests and
  the complete disposable-HA browser workflow passed. Actual Android Companion
  keyboard/viewport and manual screen-reader verification remain unverified.
  No production writes/deployment. Consult final commit's GitHub Validate status.

## IME suggestion continuity (2026-11-15)

- Composing input now refreshes nonempty suggestion queries and invalidates old
  replies. Temporary empty IME replacement retains the popup; composition state
  guards Enter and form submission. Ordinary clear, no-match and blur still close
  it. No backend, task data, dependency, packaging or translation change.
- Regression fails against 90638ef: a stale no-match reply closes the popup while
  a newer composing draft is present. Panel coverage also checks composing
  queries, retained option nodes and accidental Enter prevention. Installed-HA
  Playwright uses Chromium's IME protocol through the real HA input, checks
  changing suggestions before composition ends and observes popup visibility.
- Guidance mapping: current custom-panel context/theme requirements retain the
  existing native shell and input; WAI-ARIA combobox editing/focus guidance and
  W3C input/composition events inform read-only composing queries and submission
  guards. Verify with panel event regressions and installed-HA IME, keyboard,
  touch and navigation checks. Reconsulted Core AGENTS/integration knowledge,
  HACS packaging and official pytest guidance; no Python or package-contract
  change requires a new backend test. Existing HA integration tests still run.
  Sources: https://contributors.home-assistant.io/frontend/custom-ui/panel/
  https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
  https://www.w3.org/TR/input-events-2/
  HA input contract: https://github.com/home-assistant/frontend/blob/20261028.5/src/components/input/ha-input.ts
- Local all-checks passed: 59 Python tests, 97.09% integration coverage, 66 panel
  tests, lint/format/syntax. Disposable-HA browser suite passed with IME editing;
  actual Android keyboard/WebView and manual screen-reader validation remain
  unverified. HACS reports 90638ef installed; that does not identify JavaScript
  already cached in an individual Android session. No production writes or tests.
  Check GitHub Validate separately for the final commit's CI status.

## Stable list layout and first-completion fix (2026-11-12)

- The left list-name card no longer stretches with the task card; selected names
  change background without font-weight wrapping changes. Actual desktop bounds
  are checked across lists with different task counts.
- Search and a labelled List menu button sit at the task heading's top-right.
  Remove/Delete and View options (including history) are inside the floating
  menu. Existing admin guards and deletion confirmations remain. Escape closes
  the current disclosure; outside pointer/focus or list switching closes the menu.
  Search expands below the heading. The native HA sidebar control stays separate.
- Suggestions are an anchored, shadowed overlay, scroll-limited to available
  viewport space and placed above when necessary. They do not move task rows.
  Retain previous option nodes/results while a debounced query refreshes, mark
  aria-busy, reset selection and ignore stale replies. Same-list native updates
  requery focused drafts without clearing the popup. Viewport/page listeners
  reposition overlays and clean up on disconnect. Browser tests observe hidden
  mutations through real keystrokes and compare task geometry.
- Reproduced a missed case: tasks active at first initialization were marked seen
  forever, so their later completion never taught a title. Optional persisted
  `baseline_active` UID eligibility now learns those once on first completion,
  including after restart. Clear/Forget/disable cancel the corresponding
  eligibility; repeated snapshots/reopening do not inflate frequency. Old records
  without eligibility preserve seen/forgotten history. After updating an affected
  installation, explicitly use List menu → View options → Suggestion history →
  Rebuild from completed items to recover missed completed titles without changing
  native tasks. No automatic rebuild or production changes were performed.
- Guidance reconsulted: current HA To-do entity/state-report docs and pinned
  public API contracts, Core AGENTS/integration knowledge skill, official pytest
  framework and HACS requirements. Native authority/async persistence map to real
  Local To-do first-completion, restart and controls regressions. Current custom
  panel and WAI-ARIA combobox/disclosure guidance map to native shell/narrow state,
  labelled buttons, form semantics, focus restoration, stable input/overlay DOM
  and installed-HA keyboard/touch checks. No new dependency, config schema,
  minimum HA version, native task mutation or translation contract changed.
  Specs/README document the changed UI and optional store field.
  Sources: https://contributors.home-assistant.io/core/entities/todo/
  https://contributors.home-assistant.io/blog/2024/03/20/state_reported_timestamp/
  https://contributors.home-assistant.io/frontend/custom-ui/panel/
  https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
  https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
- Layer choices: HA integration tests cover first completion, persisted
  eligibility, old-catalog recovery and non-relearning after history controls;
  panel tests cover pending-query continuity and accessible menu/focus behavior;
  Playwright covers actual layout, hidden-state stability, native interactions
  and first-completion suggestions. Existing panel/task/list tests remain intact.
  Real Android keyboard/IME and manual screen-reader verification remain pending.
- Final local checks passed: Ruff/format/syntax, 59 Python tests (97.09%
  integration coverage), 65 panel tests and the complete disposable-HA browser
  workflow. Reviewed desktop/mobile floating-popup and menu screenshots. Browser
  geometry checks wait for HA's asynchronous narrow-layout update to settle,
  then retain the original no-overflow assertions. Consult GitHub Validate for
  the current commit's CI result separately.

## Local suggestions/autocomplete update (2026-11-12)

- Autocomplete uses a shared HA-managed Store (schema 1, key
  `ha_lists.suggestions`), separate per connected Local To-do config-entry ID.
  Native tasks remain authoritative. There is no third-party history workflow,
  cloud, AI or Recorder dependency; previous provider bindings remain intact.
- `suggestions.py` observes selected entities with public filtered state-change
  and state-report helpers (including unchanged counts), coalesces reports and
  reads `todo.get_items` on attachment/updates. Completed tasks seed the first
  snapshot; existing active tasks are baselined. New observed UIDs are learned
  once, including native Assist and automation additions with no panel open.
  UID markers/settings survive restart. Unknown/deleted historical activity
  cannot be reconstructed; frequency is observed use, not purchase count.
- Labels normalize Unicode NFKC/case/whitespace; exact/prefix/substring ranking,
  then frequency/recency/alphabetical ties. Cap at 2,000 labels and 50,000 seen
  UIDs per list; stop new learning at the UID cap. Native renames preserve catalog
  identity; native deletion is pruned on reconciliation/startup. Integration
  removal deletes its catalog without touching native tasks.
- `suggestion_websocket.py` validates bounded queries, current selected Local
  identities and HA read permissions. Shared history management/history browsing
  is admin-only. Explicit saves serialize with ingestion; lifecycle listeners,
  background tasks and pending frontend requests clean up on unload/disconnect.
- The panel debounces 150 ms, displays five options below quick entry, adds a new
  task on tap or highlighted Enter, and preserves free text, IME and focus.
  Actual native input semantics use composed focus events and ARIA element
  references across HA shadow roots. Stale replies and optional query failures
  cannot interfere with normal entry. Admin controls under View options provide
  searchable history, Forget, learning/exclude toggles and confirmed Clear/Rebuild.
  Clearing preserves UID markers; disabling learning baselines UIDs without
  learning labels. Rebuild explicitly replaces history from completed items.
- Guidance consulted: current Core AGENTS/integration knowledge skill, official
  To-do entity docs and pinned native entity/intent implementation; public
  filtered state-report guidance maps to selected-entity observation (no private
  entity-component access). HA Store/config-entry lifecycle maps to versioned
  async storage, cleanup and real disk-restart tests. Current custom-panel and
  WAI-ARIA combobox guidance maps to native shell/narrow behavior, stable focus,
  keyboard/touch and actual input/listbox element references. Current HACS and
  official pytest-homeassistant guidance reviewed; no dependency, minimum-version,
  config schema, native task API or backend translation contract changed.
  Sources: https://contributors.home-assistant.io/core/entities/todo/
  https://contributors.home-assistant.io/blog/2024/03/20/state_reported_timestamp/
  https://contributors.home-assistant.io/frontend/custom-ui/panel/
  https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- Layer choices: real HA tests cover native/Assist observation, UID identity,
  permissions, controls, caps, failure recovery, unload/uninstall and disk restart;
  panel tests cover matching presentation, safe text, debounce, selection/IME,
  focus, stale replies and history failures. Installed-HA Playwright covers
  completed seeding, native identities, keyboard/touch, active exclusion,
  cross-session/closed-panel learning and non-destructive history controls.
  Real Android keyboard/IME and manual screen-reader testing remain outstanding.
- Final local verification passed: Ruff/format/syntax, 54 Python tests with
  97.42% integration coverage, 63 panel tests, and the complete disposable-HA
  browser workflow. Browser assertions verify actual native-input ARIA controls
  and active-descendant element references, beyond merely setting attributes on
  the HA input host. Reviewed suggestion/history mobile and desktop screenshots.
  Check GitHub Validate for CI on the current commit; local success alone does
  not certify CI.
- Follow-up review preserves the focused history-search field while fetching
  new results; transient refresh failures leave existing controls visible.
  The first GitHub browser run cancelled during setup when Node's event loop
  went idle with a pending promise. The harness now owns a referenced lifetime
  until teardown, retaining the existing timeout/assertions and logging setup
  milestones. Node's official test/AbortSignal guidance was consulted:
  https://nodejs.org/api/test.html
  https://github.com/nodejs/node/blob/v22.23.4/lib/internal/abort_controller.js

The compact-toolbar and earlier updates below describe previous baselines.

## Compact task toolbar update (2026-11-11)

- Search starts collapsed behind a magnifying-glass button, expands/focuses on
  activation, and collapses when empty on blur or Escape. Active queries stay
  visible; Clear search retains field focus. Filter/sort controls and help now
  live in a closed-by-default View options disclosure. Escape closes options and
  restores button focus. Counts and non-default choice summaries remain visible.
- Frontend-only change: existing native task, backend permission and storage
  contracts are unchanged. New panel tests cover hidden defaults, retained
  choices, query visibility, closing/focus and no provider writes. Playwright
  exercises actual touch/keyboard controls, prior search/filter/sort behavior,
  drafts, native synchronization and desktop/mobile layouts.
- Guidance reconsulted: current HA custom-panel guidance (native shell/narrow
  state retained), Core AGENTS/integration knowledge skill, HACS packaging and
  official pytest-homeassistant README (existing backend suite remains required).
  WAI-ARIA disclosure guidance maps to native buttons with aria-expanded and
  aria-controls; form controls remain native, without menu roles:
  https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
  No dependency, minimum-version, backend API or translation contract changed;
  the custom panel remains English as before. Specs/README updated together.
- Empty-search blur waits until an active pointer gesture finishes, then updates
  only the search controls. This avoids shifting/replacing a task click target
  during a tap. Document pointer listeners and pending timers clean up on
  disconnect; panel regression tests cover gesture ordering and cleanup.
- Verified locally: Ruff/format/syntax, 39 Python tests (99.08% coverage),
  58 panel tests, and the full disposable-HA Playwright workflow passed.
  Reviewed compact/expanded mobile and desktop screenshots. Real Android
  keyboard/IME verification remains manual; consult the current commit's GitHub
  Validate run for CI results.

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
