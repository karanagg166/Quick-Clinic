"""Password and JWT boundary contracts without providers or database access."""

from datetime import timedelta

import jwt
import pytest
from fastapi import HTTPException

from app.core.config import get_settings
from app.core.security import SESSION_AUDIENCE, SOCKET_AUDIENCE, decode_token, ensure_owner, issue_token
from app.features.auth.passwords import hash_password, verify_password
from app.infrastructure.database import utcnow


@pytest.fixture
def signing_key(monkeypatch):
    value = "isolated-unit-signing-secret-at-least-64-characters-for-all-algorithms"
    monkeypatch.setattr(get_settings(), "jwt_secret", value)
    return value


@pytest.mark.parametrize("password", [None, 123456, "short", "é" * 37])
def test_password_hash_rejects_invalid_inputs(password):
    with pytest.raises(HTTPException) as error:
        hash_password(password)
    assert error.value.status_code == 400


def test_password_hash_is_salted_and_preserves_unicode():
    password = "médical-clinic-秘密"
    first, second = hash_password(password), hash_password(password)
    assert first != second
    assert verify_password(password, first)
    assert not verify_password("incorrect-password", first)
    assert not verify_password(password, "not-a-bcrypt-hash")
    assert not verify_password(None, first)


def test_legacy_bcrypt_long_password_login_truncates_at_72_bytes():
    prefix = "a" * 72
    stored = hash_password(prefix)
    assert verify_password(prefix + "legacy-suffix", stored)
    assert not verify_password("b" + prefix, stored)


def test_session_token_only_contains_allowlisted_identity_claims(signing_key):
    token = issue_token({"id": "patient", "role": "patient", "password": "secret", "bankIFSC": "secret"})
    claims = decode_token(token)
    assert claims["id"] == "patient" and claims["role"] == "PATIENT"
    assert claims["aud"] == SESSION_AUDIENCE
    assert "password" not in claims and "bankIFSC" not in claims
    assert claims["exp"] - claims["iat"] == 604800


@pytest.mark.parametrize(
    "claims",
    [
        {"id": "", "role": "PATIENT"},
        {"id": "   ", "role": "PATIENT"},
        {"id": 42, "role": "PATIENT"},
        {"id": "patient", "role": "SUPER_ADMIN"},
        {"id": "patient", "role": None},
        {"id": "patient", "userId": "other", "role": "PATIENT"},
        {"id": "patient", "role": "PATIENT", "aud": "another-service"},
    ],
)
def test_jwt_rejects_invalid_identity_and_audience(signing_key, claims):
    token = jwt.encode({"exp": utcnow() + timedelta(minutes=5), **claims}, signing_key, algorithm="HS256")
    with pytest.raises(HTTPException) as error:
        decode_token(token)
    assert error.value.status_code == 401


@pytest.mark.parametrize("mode", ["expired", "missing-expiry", "wrong-secret", "wrong-algorithm"])
def test_jwt_rejects_invalid_signature_lifetime_and_algorithm(signing_key, mode):
    claims = {"id": "patient", "role": "PATIENT", "exp": utcnow() + timedelta(minutes=5)}
    if mode == "expired":
        claims["exp"] = utcnow() - timedelta(seconds=1)
    if mode == "missing-expiry":
        claims.pop("exp")
    token = jwt.encode(
        claims,
        "another-signing-secret-32-characters" if mode == "wrong-secret" else signing_key,
        algorithm="HS384" if mode == "wrong-algorithm" else "HS256",
    )
    with pytest.raises(HTTPException) as error:
        decode_token(token)
    assert error.value.status_code == 401


def test_legacy_session_identity_is_supported_but_cannot_be_socket_ticket(signing_key):
    legacy = jwt.encode(
        {"userId": "legacy-user", "role": "doctor", "exp": utcnow() + timedelta(minutes=5)},
        signing_key,
        algorithm="HS256",
    )
    assert decode_token(legacy)["id"] == "legacy-user"
    with pytest.raises(HTTPException):
        decode_token(legacy, SOCKET_AUDIENCE)
    ticket = issue_token({"id": "doctor", "role": "DOCTOR"}, SOCKET_AUDIENCE, 60)
    assert decode_token(ticket, SOCKET_AUDIENCE)["id"] == "doctor"
    with pytest.raises(HTTPException):
        decode_token(ticket)


def test_owner_check_requires_explicit_admin_permission():
    admin = {"id": "admin", "role": "ADMIN"}
    ensure_owner(admin, "patient")
    ensure_owner(admin, "admin", allow_admin=False)
    with pytest.raises(HTTPException) as error:
        ensure_owner(admin, "patient", allow_admin=False)
    assert error.value.status_code == 403
