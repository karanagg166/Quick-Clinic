"""Fast process probes and dependency failure recovery."""

import importlib
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.mark.parametrize("path", ["/health", "/api/health"])
async def test_liveness_contract_does_not_require_a_database(client, path):
    response = await client.get(path)
    assert response.status_code == 200
    assert response.json()["service"] == "quick-clinic-backend"
    assert response.json()["status"] == "ok"
    assert response.json()["timestamp"].endswith("Z")


@pytest.mark.parametrize("path", ["/ready", "/api/ready", "/api/health/ready"])
@pytest.mark.parametrize("available", [True, False])
async def test_readiness_checks_database_and_sanitizes_failures(client, monkeypatch, path, available):
    health = importlib.import_module("app.features.health.router")
    connection = AsyncMock()
    if not available:
        connection.execute.side_effect = ConnectionError("postgres://secret/private")
    context = MagicMock(
        __aenter__=AsyncMock(return_value=connection), __aexit__=AsyncMock(return_value=False)
    )
    monkeypatch.setattr(health, "engine", MagicMock(connect=MagicMock(return_value=context)))
    response = await client.get(path)
    assert response.status_code == (200 if available else 503)
    assert response.json()["database"] == ("connected" if available else "disconnected")
    assert "secret" not in response.text
    connection.execute.assert_awaited_once()
