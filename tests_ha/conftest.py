"""Fixtures for Home Assistant integration tests."""

import pytest


@pytest.fixture(autouse=True)
def enable_custom_integrations(enable_custom_integrations):
    """Enable loading custom integrations in the HA test harness."""
    return enable_custom_integrations
