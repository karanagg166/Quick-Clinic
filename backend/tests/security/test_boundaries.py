"""Security regressions exercise real middleware and identity verification."""

import json
from datetime import timedelta

import httpx
import jwt
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.api import create_api
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.security import SESSION_AUDIENCE, SOCKET_AUDIENCE, decode_token
from app.infrastructure.database import utcnow


@pytest.mark.parametrize(
    "mutation",
    [
        {"exp": utcnow() - timedelta(seconds=1)},
        {"exp": None},
        {"id": ""},
        {"id": "   "},
        {"id": 123},
        {"role": "OWNER"},
        {"role": []},
        {"userId": "different-user"},
        {"aud": SOCKET_AUDIENCE},
        {"aud": [SESSION_AUDIENCE]},
    ],
)
def test_untrusted_token_claims_are_rejected(mutation):
    claims = {"id": "user", "role": "PATIENT", "aud": SESSION_AUDIENCE, "exp": utcnow() + timedelta(hours=1)}
    claims.update(mutation)
    token = jwt.encode(claims, get_settings().jwt_secret, algorithm="HS256")
    with pytest.raises(HTTPException) as failure:
        decode_token(token)
    assert failure.value.status_code == 401


@pytest.mark.parametrize("token", ["", "abc", "a.b.c", "Bearer xyz", "null", "eyJhbGciOiJub25lIn0.e30."])
def test_malformed_or_unsigned_tokens_cannot_authenticate(token):
    with pytest.raises(HTTPException) as failure:
        decode_token(token)
    assert failure.value.status_code == 401


def test_signature_from_another_environment_is_not_trusted():
    claims = {"id": "user", "role": "PATIENT", "exp": utcnow() + timedelta(hours=1)}
    token = jwt.encode(claims, "another-signing-secret-at-least-32-characters", algorithm="HS256")
    with pytest.raises(HTTPException):
        decode_token(token)


@pytest.mark.parametrize(
    "path",
    [
        "/api/user/me",
        "/api/patients/me/medical-documents",
        "/api/patients/me/medical-documents/unknown/file",
        "/api/doctors/me/medical-record-patients",
        "/api/doctors/me/patients/unknown/medical-documents",
        "/api/patients/unknown/appointments",
        "/api/doctors/unknown/appointments",
        "/api/socket/token",
    ],
)
async def test_private_resources_require_authentication(client, path):
    response = await client.get(path)
    assert response.status_code == 401
    assert "password" not in response.text
    assert "storagePath" not in response.text


@pytest.mark.parametrize(
    "path",
    [
        "/api/chatbot",
        "/api/chatbot/chat",
        "/api/ai/chat",
        "/api/search-sphere",
        "/medical-documents/private.pdf",
    ],
)
async def test_retired_ai_and_static_private_storage_are_unreachable(client, path):
    response = await client.get(path)
    assert response.status_code == 404


@pytest.mark.parametrize("origin,status", [("http://localhost:3000", 200), ("https://attacker.test", 400)])
async def test_cors_restricts_credentialed_browser_origins(client, origin, status):
    response = await client.options(
        "/api/user/me",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization,Content-Type",
        },
    )
    assert response.status_code == status
    if status == 200:
        assert response.headers["access-control-allow-origin"] == origin
        assert response.headers["access-control-allow-credentials"] == "true"
    else:
        assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("length,status", [(str(11 * 1024 * 1024 + 1), 413), ("not-a-number", 400)])
async def test_request_limits_reject_oversized_or_malformed_bodies(client, length, status):
    response = await client.post("/api/user/login", headers={"Content-Length": length}, content=b"{}")
    assert response.status_code == status


async def test_auth_rate_limit_cannot_be_evaded_with_forwarded_headers(client):
    responses = [
        await client.post("/api/user/login", json={}, headers={"X-Forwarded-For": f"192.0.2.{n}"})
        for n in range(21)
    ]
    assert all(response.status_code == 400 for response in responses[:20])
    assert responses[-1].status_code == 429
    assert responses[-1].headers["retry-after"] == "60"
    assert (await client.get("/api/health")).status_code == 200


async def test_error_responses_and_logs_do_not_disclose_private_input(caplog):
    secret = "PRIVATE-clinical-password-db-credential"
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/failure/{kind}")
    async def fail(kind: str):
        failures = {
            "database": DBAPIError("SELECT password", {"secret": secret}, RuntimeError(secret)),
            "conflict": IntegrityError("INSERT secret", {"secret": secret}, RuntimeError(secret)),
            "invalid": ValueError(secret),
            "unknown": RuntimeError(secret),
            "validation": RequestValidationError(
                [
                    {
                        "loc": ("body", "password"),
                        "msg": "Invalid value",
                        "type": "value_error",
                        "input": secret,
                    }
                ]
            ),
        }
        raise failures[kind]

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
    ) as client:
        for kind, status in [
            ("database", 503),
            ("conflict", 409),
            ("invalid", 400),
            ("unknown", 500),
            ("validation", 400),
        ]:
            response = await client.get(f"/failure/{kind}")
            assert response.status_code == status
            assert secret not in response.text
    assert secret not in caplog.text


async def test_success_and_auth_error_responses_are_private_and_traceable(client):
    first, second = await client.get("/api/health"), await client.get("/api/user/me")
    assert first.headers["x-request-id"] != second.headers["x-request-id"]
    for response in (first, second):
        assert len(response.headers["x-request-id"]) == 32
        assert response.headers["cache-control"] == "private, no-store"


async def test_distributed_limiter_fails_closed_when_redis_is_unavailable(client, monkeypatch):
    from redis.asyncio import Redis

    monkeypatch.setattr(get_settings(), "redis_url", "redis://localhost:1")

    def unavailable(*args, **kwargs):
        raise ConnectionError("credential must never leak")

    monkeypatch.setattr(Redis, "from_url", unavailable)
    response = await client.post("/api/user/login", json={})
    assert response.status_code == 503
    assert "credential" not in response.text


async def test_redis_counter_sets_expiry_and_limits_requests(client, monkeypatch):
    from unittest.mock import AsyncMock, MagicMock
    from redis.asyncio import Redis

    counter = AsyncMock()
    counter.incr.side_effect = [1, 21]
    context = MagicMock(__aenter__=AsyncMock(return_value=counter), __aexit__=AsyncMock(return_value=False))
    monkeypatch.setattr(get_settings(), "redis_url", "redis://localhost:6379")
    monkeypatch.setattr(Redis, "from_url", lambda *_: context)
    assert (await client.post("/api/user/login", json={})).status_code == 400
    assert (await client.post("/api/user/login", json={})).status_code == 429
    counter.expire.assert_awaited_once()
    assert counter.expire.call_args.args[1] == 61


def test_openapi_never_exposes_ai_endpoints_or_storage_fields():
    document = create_api().openapi()
    assert document["info"]["title"] == "Quick-Clinic API"
    assert not any("chatbot" in path or "search-sphere" in path for path in document["paths"])
    assert "supabase_secret_key" not in json.dumps(document)
