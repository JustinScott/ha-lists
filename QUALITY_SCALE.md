# Home Assistant Integration Quality Scale — HA Lists audit

This is a project-specific readiness tracker based on Home Assistant's Integration Quality Scale (IQS). **It is not an official Home Assistant certification or assigned grade.** HA Lists is a custom integration and a sidebar application, so entity/device-specific rules may not apply. Mark a rule done only after citing implementation, tests, and documentation; mark exemptions with a reason. Do not claim Bronze, Silver, Gold, or Platinum while prerequisites remain incomplete.

Official reference: https://developers.home-assistant.io/docs/core/integration-quality-scale/

## Bronze — baseline compliance and setup
- [x] Config flow creates a local entry (tests_ha/test_config_flow.py).
- [x] Duplicate configuration is rejected (tests_ha/test_config_flow.py).
- [x] Options flow stores selected native todo entities (tests_ha/test_config_flow.py).
- [ ] Validate setup and failure behavior using HA fixtures.
- [ ] Verify WebSocket authentication/authorization and invalid payload rejection.
  - Follow-up TODO: add end-to-end authenticated WebSocket tests with HA connection fixtures, including unauthenticated rejection, non-admin permissions, entity visibility, and malformed payloads. Existing direct-handler tests are not sufficient; do not mark complete.
- [ ] Document installation, removal, supported features and limitations.
- [x] Review the 20 current official Bronze rules and record provisional applicability below (2026-11-09). This completes the applicability review, **not** Bronze readiness.

## Silver — reliability and tests
- [ ] Test entry setup, unload and reload, including panel cleanup and listener lifecycle.
- [ ] Test errors from missing/unavailable todo entities and unsupported provider features.
- [ ] Test native todo item retrieval, add, update, complete/reopen and remove once implemented.
- [ ] Test permissions, provider failures, duplicate names, and concurrent changes.
- [ ] Establish meaningful test coverage for applicable integration code, not just a percentage.
- [ ] Review all other applicable current Silver rules; record explicit exemptions.

## Gold — user experience and resilience
- [ ] Document diagnostics, troubleshooting, use cases, known limitations and provider capabilities.
- [ ] Implement and test repair issues and translated errors where applicable.
- [ ] Test reconnection/recovery, persistent metadata, migrations, and failure states.
- [ ] Review all other applicable current Gold rules; record explicit exemptions.

## Platinum — maintainability
- [ ] Evaluate strict typing and async dependency/event-loop safety.
- [ ] Review all other applicable current Platinum rules; record explicit exemptions.

## CI policy
- Retain pytest-homeassistant-custom-component; do not replace it with pytest-homeassistant.
- Run existing Home Assistant integration tests, Ruff, Hassfest, HACS validation, and coverage.
- Add focused HA fixture-based tests for each behavior before marking a rule complete.
- Coverage reporting is diagnostic until a justified threshold is established.
- Hassfest/HACS passing is not evidence of IQS level achievement.


## Official Bronze rule-by-rule applicability review (2026-11-09)

Reference: https://contributors.home-assistant.io/core/quality-scale/rules/ (20 Bronze rules). This is a **custom integration** audit against Core's IQS, not an official Core grade. Statuses are evidence-based; provisional exemptions require confirmation against the individual rule guidance.

| Rule | Applicability / status | Evidence or next action |
| --- | --- | --- |
| action-setup | Provisional exempt | HA Lists registers no custom service actions; standard todo actions belong to native providers. Revisit if adding actions. |
| appropriate-polling | Provisional exempt | No backend polling; panel requests items on selection. Revisit if adding reconciliation. |
| brands | Open | Local brand/icon exists, but official rule expects assets in HA brands repository; local HACS icon alone does not establish compliance. |
| common-modules | Provisional exempt | No coordinator or base entity class exists. |
| config-flow | Implemented, verify | `config_flow.py` uses UI flow and options; inspect current rule details and translations. |
| config-flow-test-coverage | Partial | `tests_ha/test_config_flow.py` covers create, duplicate, options; add missing/error-path cases and verify coverage. |
| dependency-transparency | Provisional exempt | No external Python requirements; native HA dependencies declared in manifest. Recheck on dependency additions. |
| docs-actions | Provisional exempt | No integration-specific actions yet; document native todo actions separately when editing ships. |
| docs-conditions | Provisional exempt | No integration-specific conditions. |
| docs-high-level-description | Implemented, verify | README explains local-first native todo panel. |
| docs-installation-instructions | Implemented, verify | README development installation/configuration; confirm in development HA. |
| docs-removal-instructions | Implemented, verify | README removal steps; validate on development HA. |
| docs-triggers | Provisional exempt | No integration-specific triggers. |
| entity-event-setup | Provisional exempt | HA Lists creates no entities; it displays existing native todo entities. |
| entity-unique-id | Provisional exempt | No HA Lists entities; config entry uses unique ID. |
| has-entity-name | Provisional exempt | No HA Lists entities. |
| runtime-data | Provisional exempt, review | Current `hass.data[DOMAIN]` is a boolean panel registration marker, not config-entry runtime data. Revisit when per-entry runtime state exists. |
| test-before-configure | Provisional exempt | No external service/credentials to test; local-only setup. |
| test-before-setup | Open | Add HA fixture-based setup failure and recovery checks, including registration cleanup. |
| unique-config-entry | Implemented, verify | `async_set_unique_id` + duplicate abort; existing test. |

### Cross-cutting security and reliability follow-ups (not substitutes for IQS rules)
- [ ] End-to-end authenticated WebSocket authorization, entity visibility and malformed payload tests (direct handler tests are insufficient).
- [ ] Validate setup/unload/reload and partial-registration failure cleanup; ensure commands/resources do not duplicate or linger.
- [ ] Verify actual GitHub Actions results and run tests before marking implementation/test claims complete.
- [ ] Confirm exemption interpretations against the individual official rule pages and record justification in release review.

**Important:** The official 20-rule Bronze list differs from the original project-specific seven-item tracker. Do not infer that completing seven local items achieves Bronze.
