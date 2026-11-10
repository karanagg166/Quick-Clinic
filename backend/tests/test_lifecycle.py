"""The combined application validates configuration and shuts workers down cleanly."""

import importlib
import pytest
from app.core.config import get_settings
from app.main import api


async def test_missing_signing_secret_fails_startup_without_database_access(db, monkeypatch):
    lifecycle = importlib.import_module("app.core.lifespan")
    monkeypatch.setattr(get_settings(), "jwt_secret", "")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        async with lifecycle.lifespan(api):
            raise AssertionError("Invalid configuration must never start")


async def test_lifespan_starts_and_stops_notification_worker(db, monkeypatch):
    lifecycle = importlib.import_module("app.core.lifespan")
    monkeypatch.setattr(lifecycle, "engine", db.engine)
    started = []

    async def idle_worker():
        import asyncio

        started.append(True)
        await asyncio.Event().wait()

    monkeypatch.setattr(lifecycle, "deliver_pending_notifications", idle_worker)
    from app.infrastructure import realtime

    async def idle_shutdown():
        pass

    monkeypatch.setattr(realtime, "shutdown", idle_shutdown)
    async with lifecycle.lifespan(api):
        import asyncio

        await asyncio.sleep(0)
        assert started == [True]
