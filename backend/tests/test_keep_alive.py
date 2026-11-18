"""A health monitor expires after 30 days and only targets a Render HTTPS origin."""

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location(
    "keep_alive", Path(__file__).parents[1] / "scripts/deployment/keep_alive.py"
)
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


def test_keep_alive_stops_after_deadline_and_rejects_long_extensions():
    now = datetime.now(UTC)
    assert monitor.active_window((now + timedelta(days=30)).isoformat(), now)
    assert not monitor.active_window((now - timedelta(seconds=1)).isoformat(), now)
    with pytest.raises(ValueError):
        monitor.active_window((now + timedelta(days=31)).isoformat(), now)
    with pytest.raises(ValueError):
        monitor.active_window("2026-12-10T00:00:00", now)


def test_keep_alive_rejects_arbitrary_destinations_and_embedded_credentials():
    assert (
        monitor.health_url("https://quick-clinic-api.onrender.com")
        == "https://quick-clinic-api.onrender.com/api/health"
    )
    for target in (
        "http://quick-clinic-api.onrender.com",
        "https://example.com",
        "https://user@x.onrender.com",
        "https://x.onrender.com/other",
        "https://x.onrender.com?token=secret",
    ):
        with pytest.raises(ValueError):
            monitor.health_url(target)


def test_keep_alive_classifies_all_states():
    assert (
        monitor.classify_probe(
            200,
            {},
            {"status": "ok", "service": "quick-clinic-backend"},
            200,
            {"status": "ready", "database": "connected"},
        )
        == monitor.STATE_HEALTHY
    )
    assert (
        monitor.classify_probe(
            404,
            {"x-render-routing": "no-server"},
            None,
            None,
            None,
        )
        == monitor.STATE_DEPLOYMENT_UNAVAILABLE
    )
    assert monitor.classify_probe(503, {}, None, None, None) == monitor.STATE_WAKING_UP
    assert monitor.classify_probe(None, {}, None, None, None) == monitor.STATE_WAKING_UP
    assert (
        monitor.classify_probe(
            200,
            {},
            {"status": "ok", "service": "quick-clinic-backend"},
            503,
            {"status": "unready", "database": "disconnected", "error": "DATABASE_UNAVAILABLE"},
        )
        == monitor.STATE_DATABASE_UNAVAILABLE
    )
    assert (
        monitor.classify_probe(
            500,
            {},
            {"status": "error"},
            None,
            None,
        )
        == monitor.STATE_UNHEALTHY
    )


def test_keep_alive_main_fails_on_404_and_recovers_from_cold_start(monkeypatch):
    monkeypatch.setenv("QUICK_CLINIC_BACKEND_URL", "https://quick-clinic-api.onrender.com")
    monkeypatch.setenv("KEEPALIVE_UNTIL", "always")
    monkeypatch.setattr(monitor.time, "sleep", lambda _secs: None)

    calls: list[str] = []

    def fail_404(url: str, timeout: int = 30):
        calls.append(url)
        return 404, {"x-render-routing": "no-server"}, None

    monkeypatch.setattr(monitor, "_fetch_json", fail_404)
    assert monitor.main() == 1
    assert len(calls) == 1  # Does not retry 404 deployment unavailable

    calls.clear()
    responses = [
        (503, {}, None),
        (200, {}, {"status": "ok", "service": "quick-clinic-backend"}),
        (200, {}, {"status": "ready", "database": "connected"}),
    ]

    def cold_start_then_ready(url: str, timeout: int = 30):
        calls.append(url)
        return responses.pop(0)

    monkeypatch.setattr(monitor, "_fetch_json", cold_start_then_ready)
    assert monitor.main() == 0
    assert len(calls) == 3


def test_keep_alive_main_recovers_after_extended_render_cold_boot(monkeypatch):
    monkeypatch.setenv("QUICK_CLINIC_BACKEND_URL", "https://quick-clinic-api-u91s.onrender.com")
    monkeypatch.setenv("KEEPALIVE_UNTIL", "always")
    monkeypatch.setattr(monitor.time, "sleep", lambda _secs: None)

    calls: list[str] = []
    # 5 consecutive 502 waking responses (~75-90s cold boot) then healthy + ready
    responses = [(502, {}, None)] * 5 + [
        (200, {}, {"status": "ok", "service": "quick-clinic-backend"}),
        (200, {}, {"status": "ready", "database": "connected"}),
    ]

    def slow_wake(url: str, timeout: int = 30):
        calls.append(url)
        return responses.pop(0)

    monkeypatch.setattr(monitor, "_fetch_json", slow_wake)
    assert monitor.main() == 0
    assert len(calls) == 7
