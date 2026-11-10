"""Configuration, UTC representation and transactional infrastructure contracts."""

import importlib
from datetime import UTC, date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Response
from hypothesis import given, strategies as st

from app.core.config import Settings, get_settings
from app.core.serialization import encode_utc, utc_endpoint
from app.infrastructure import database


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("postgres://localhost/test", "postgresql+asyncpg://localhost/test"),
        (
            "postgresql://localhost/test?sslmode=require&channel_binding=require&pgbouncer=true",
            "postgresql+asyncpg://localhost/test?ssl=require",
        ),
        ("postgresql://localhost/test?sslmode=disable", "postgresql+asyncpg://localhost/test"),
        ("sqlite+aiosqlite://", "sqlite+aiosqlite://"),
    ],
)
def test_database_urls_preserve_driver_and_translate_libpq(monkeypatch, raw, expected):
    monkeypatch.setattr(get_settings(), "database_url", raw)
    assert database.database_url() == expected


def test_cors_origins_are_explicit_and_normalized():
    settings = Settings(_env_file=None, frontend_url=" https://one.test/, ,https://two.test/ ")
    assert settings.cors_origins == ["https://one.test", "https://two.test"]


@given(st.datetimes(min_value=datetime(2000, 1, 1), max_value=datetime(2099, 12, 31)))
def test_naive_database_timestamps_roundtrip_as_utc(value):
    encoded = encode_utc({"nested": [value, value.date()]})
    assert datetime.fromisoformat(encoded["nested"][0]) == value.replace(tzinfo=UTC)
    assert encoded["nested"][1] == value.date().isoformat()


@pytest.mark.parametrize("offset", [-720, -330, 0, 330, 840])
def test_aware_timestamps_convert_to_the_same_utc_instant(offset):
    instant = datetime(2026, 1, 1, 23, 55, tzinfo=timezone(timedelta(minutes=offset)))
    assert datetime.fromisoformat(encode_utc(instant)) == instant.astimezone(UTC)


async def test_endpoint_wrapper_preserves_response_identity_and_signature():
    response = Response(b"private", headers={"X-Test": "retained"})

    async def endpoint(value: str = "abc"):
        return response

    wrapped = utc_endpoint(endpoint)
    assert await wrapped() is response
    assert wrapped.__name__ == endpoint.__name__
    assert wrapped.__wrapped__ is endpoint


async def test_endpoint_wrapper_serializes_nested_dates():
    async def endpoint():
        return {"dates": (date(2026, 1, 2), datetime(2026, 1, 2))}

    assert await utc_endpoint(endpoint)() == {"dates": ["2026-01-02", "2026-01-02T00:00:00Z"]}


@pytest.mark.parametrize(
    "failure", [None, ValueError("invalid"), RuntimeError("failed"), __import__("asyncio").CancelledError()]
)
async def test_connection_commits_success_and_rolls_back_all_failures(monkeypatch, failure):
    connection = AsyncMock()
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=connection)
    context.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(database, "engine", MagicMock(connect=MagicMock(return_value=context)))
    generator = database.get_db()
    assert await anext(generator) is connection
    if failure is None:
        with pytest.raises(StopAsyncIteration):
            await anext(generator)
        connection.commit.assert_awaited_once()
        connection.rollback.assert_not_awaited()
    else:
        with pytest.raises(type(failure)):
            await generator.athrow(failure)
        connection.rollback.assert_awaited_once()
        connection.commit.assert_not_awaited()
    context.__aexit__.assert_awaited_once()


@pytest.mark.parametrize(
    "field,value,message",
    [
        ("jwt_secret", "short", "JWT_SECRET"),
        ("backend_public_url", "http://insecure.test", "HTTPS"),
        ("document_storage_backend", "local", "durable"),
    ],
)
async def test_production_configuration_fails_before_starting_workers(monkeypatch, field, value, message):
    lifecycle = importlib.import_module("app.core.lifespan")
    settings = get_settings()
    monkeypatch.setattr(settings, "node_env", "production")
    monkeypatch.setattr(settings, "backend_public_url", "https://backend.test")
    monkeypatch.setattr(settings, "document_storage_backend", "local")
    if field == "document_storage_backend":
        monkeypatch.setenv("RENDER", "true")
    else:
        monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setattr(settings, field, value)
    with pytest.raises(RuntimeError, match=message):
        async with lifecycle.lifespan(None):
            pytest.fail("Invalid production configuration was accepted")


def test_public_user_never_returns_password_hash():
    original = {"id": "patient", "password": "$2b$secret", "name": "Example"}
    assert database.public_user(original) == {"id": "patient", "name": "Example"}
    assert "password" in original


@pytest.mark.parametrize(
    "failure", [ConnectionRefusedError("private-database-address"), TimeoutError("private-database-address")]
)
async def test_database_connectivity_failures_return_retryable_sanitized_error(monkeypatch, failure):
    from fastapi import HTTPException

    context = MagicMock(__aenter__=AsyncMock(side_effect=failure), __aexit__=AsyncMock(return_value=False))
    monkeypatch.setattr(database, "engine", MagicMock(connect=MagicMock(return_value=context)))
    with pytest.raises(HTTPException) as error:
        await anext(database.get_db())
    assert error.value.status_code == 503
    assert error.value.detail["code"] == "DATABASE_UNAVAILABLE"
    assert "private-database-address" not in str(error.value.detail)
