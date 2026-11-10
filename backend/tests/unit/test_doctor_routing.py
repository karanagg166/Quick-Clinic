"""Routing provider failures preserve bounded, usable discovery fallbacks."""

import json

import httpx
import pytest

from app.core.config import get_settings
from app.features.doctors import routing


def targets(count=1):
    return [dict(id=f"doctor-{index}", latitude=28.6, longitude=77.2) for index in range(count)]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"distances": [], "durations": []},
        {"distances": [[10, 20]], "durations": [[30]]},
        {"distances": None, "durations": None},
    ],
)
async def test_malformed_matrix_returns_empty_metrics_instead_of_failing_discovery(db, monkeypatch, body):
    monkeypatch.setattr(get_settings(), "openrouteservice_api_key", "synthetic-routing-key")
    original = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=body))
    monkeypatch.setattr(routing.httpx, "AsyncClient", lambda **kw: original(transport=transport, **kw))
    assert await routing.route_metrics(28.6, 77.2, targets()) == {}


@pytest.mark.parametrize("status", [401, 429, 500, 503])
async def test_routing_provider_failure_is_sanitized_and_uses_fallback(db, monkeypatch, caplog, status):
    monkeypatch.setattr(get_settings(), "openrouteservice_api_key", "synthetic-routing-key")
    original = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(status, text="provider-sensitive-detail"))
    monkeypatch.setattr(routing.httpx, "AsyncClient", lambda **kw: original(transport=transport, **kw))
    assert await routing.route_metrics(28.6, 77.2, targets()) == {}
    assert "provider-sensitive-detail" not in caplog.text and "synthetic-routing-key" not in caplog.text


async def test_route_matrix_bounds_provider_work_and_uses_lng_lat_order(db, monkeypatch):
    monkeypatch.setattr(get_settings(), "openrouteservice_api_key", "synthetic-routing-key")
    original = httpx.AsyncClient

    def respond(request):
        body = json.loads(request.content)
        assert len(body["locations"]) == 31
        assert body["locations"][0] == [77.3, 28.7]
        assert body["locations"][1] == [77.2, 28.6]
        assert len(body["destinations"]) == 30
        return httpx.Response(200, json={"distances": [[1000] * 30], "durations": [[60] * 30]})

    transport = httpx.MockTransport(respond)
    monkeypatch.setattr(routing.httpx, "AsyncClient", lambda **kw: original(transport=transport, **kw))
    metrics = await routing.route_metrics(28.7, 77.3, targets(50))
    assert len(metrics) == 30 and "doctor-30" not in metrics


async def test_missing_provider_key_or_coordinates_never_opens_network(db, monkeypatch):
    def forbidden(**kwargs):
        raise AssertionError("Network client must not be constructed")

    monkeypatch.setattr(routing.httpx, "AsyncClient", forbidden)
    assert await routing.route_metrics(0, 0, targets()) == {}
    monkeypatch.setattr(get_settings(), "openrouteservice_api_key", "synthetic-routing-key")
    assert (
        await routing.route_metrics(0, 0, [{"id": "no-location", "latitude": None, "longitude": None}]) == {}
    )


async def test_negative_route_values_are_discarded(db, monkeypatch):
    monkeypatch.setattr(get_settings(), "openrouteservice_api_key", "synthetic-routing-key")
    original = httpx.AsyncClient
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"distances": [[-1000, 1000]], "durations": [[60, -60]]})
    )
    monkeypatch.setattr(routing.httpx, "AsyncClient", lambda **kw: original(transport=transport, **kw))
    assert await routing.route_metrics(0, 0, targets(2)) == {}
