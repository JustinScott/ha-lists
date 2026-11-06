"""Fixtures for Home Assistant integration tests."""

import pytest


@pytest.fixture(autouse=True)
def allow_custom_components(enable_custom_integrations):
    """Enable custom integrations through the HA test plugin's fixture."""
    return enable_custom_integrations
