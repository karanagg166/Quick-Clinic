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
