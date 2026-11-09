# Home Assistant Integration Quality Scale — HA Lists audit

This is a project-specific readiness tracker based on Home Assistant's Integration Quality Scale (IQS). **It is not an official Home Assistant certification or assigned grade.** HA Lists is a custom integration and a sidebar application, so entity/device-specific rules may not apply. Mark a rule done only after citing implementation, tests, and documentation; mark exemptions with a reason. Do not claim Bronze, Silver, Gold, or Platinum while prerequisites remain incomplete.

Official reference: https://developers.home-assistant.io/docs/core/integration-quality-scale/

## Bronze — baseline compliance and setup
- [x] Config flow creates a local entry (tests_ha/test_config_flow.py).
- [x] Duplicate configuration is rejected (tests_ha/test_config_flow.py).
- [x] Options flow stores selected native todo entities (tests_ha/test_config_flow.py).
- [ ] Validate setup and failure behavior using HA fixtures.
- [ ] Verify WebSocket authentication/authorization and invalid payload rejection.\n  - Follow-up TODO: add end-to-end authenticated WebSocket tests with HA connection fixtures, including unauthenticated rejection, non-admin permissions, entity visibility, and malformed payloads. Existing direct-handler tests are not sufficient; do not mark complete.
- [ ] Document installation, removal, supported features and limitations.
- [ ] Review all other applicable current Bronze rules; record explicit exemptions.

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
