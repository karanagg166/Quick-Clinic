"""Identity workflows exercise HTTP contracts, persistence and atomic failures."""

from datetime import timedelta
from urllib.parse import quote

import httpx
import pytest
from sqlalchemy import func, insert, select, update

from app.core.config import get_settings
from app.core.security import issue_token
from app.features.auth import service
from app.features.auth.passwords import verify_password
from app.infrastructure.database import new_id, tables, utcnow


def auth(user):
    return {"Authorization": "Bearer " + issue_token(user)}


def signup(**changes):
    return {
        "name": "New Patient",
        "email": "new@example.test",
        "phoneNo": "9999999999",
        "address": "Clinic street",
        "age": 23,
        "gender": "FEMALE",
        "role": "PATIENT",
        "password": "password123",
        "pinCode": 110001,
        "city": "Delhi",
        "state": "Delhi",
        **changes,
    }


async def otp(db, user, *, expired=False, code="123456", created_at=None):
    await db.execute(
        insert(tables["Otp"]).values(
            id=new_id(),
            userId=user["id"],
            email=user["email"],
            code=code,
            createdAt=created_at or utcnow(),
            expiresAt=utcnow() + timedelta(minutes=-1 if expired else 10),
        )
    )


@pytest.mark.parametrize("role", ["PATIENT", "doctor"])
async def test_registration_creates_safe_account_and_audit_event(client, db, role):
    response = await client.post("/api/user/signup", json=signup(role=role))
    assert response.status_code == 201
    user = response.json()["user"]
    stored = (
        (await db.execute(select(tables["User"]).where(tables["User"].c.id == user["id"]))).mappings().one()
    )
    assert stored["role"] == role.upper() and not stored["emailVerified"]
    assert verify_password("password123", stored["password"])
    assert not {"password", "isActive"}.intersection(user)
    assert user["patientId"] is None and user["doctorId"] is None
    audit = (
        (await db.execute(select(tables["AuditLog"]).where(tables["AuditLog"].c.userId == user["id"])))
        .mappings()
        .one()
    )
    assert audit["action"] == "User Created"
    assert "password" not in str(audit["metadata"])


@pytest.mark.parametrize(
    "changes,status",
    [
        ({"role": "ADMIN"}, 403),
        ({"email": "invalid-email"}, 400),
        ({"name": "   "}, 400),
        ({"age": -1}, 400),
        ({"age": 151}, 400),
        ({"gender": "UNKNOWN"}, 400),
        ({"pinCode": 123}, 400),
        ({"password": "é" * 37}, 400),
    ],
)
async def test_invalid_signup_never_persists_partial_accounts(client, db, changes, status):
    response = await client.post("/api/user/signup", json=signup(**changes))
    assert response.status_code == status
    assert (await db.execute(select(func.count()).select_from(tables["User"]))).scalar_one() == 0
    assert (await db.execute(select(func.count()).select_from(tables["AuditLog"]))).scalar_one() == 0


async def test_duplicate_signup_does_not_overwrite_password_or_profile(client, db, seed_user):
    user = await seed_user(email="new@example.test", name="Original")
    response = await client.post("/api/user/signup", json=signup(name="Replacement"))
    assert response.status_code == 400
    stored = (
        (await db.execute(select(tables["User"]).where(tables["User"].c.id == user["id"]))).mappings().one()
    )
    assert stored["name"] == "Original" and stored["password"] == user["password"]


@pytest.mark.parametrize("case", ["unknown", "wrong-password", "inactive"])
async def test_login_rejects_unknown_wrong_password_and_inactive_users(client, seed_user, case):
    user = await seed_user(isActive=case != "inactive")
    response = await client.post(
        "/api/user/login",
        json={
            "email": "unknown@example.test" if case == "unknown" else user["email"],
            "password": "wrong-password" if case == "wrong-password" else "password123",
        },
    )
    assert response.status_code == (401 if case == "inactive" else 400)
    assert not response.headers.get_list("set-cookie")
    if case != "inactive":
        assert response.json() == {"error": "Invalid email or password"}


async def test_login_sets_production_cookie_flags_and_logout_removes_session(client, seed_user, monkeypatch):
    user = await seed_user()
    monkeypatch.setattr(get_settings(), "node_env", "production")
    response = await client.post("/api/user/login", json={"email": user["email"], "password": "password123"})
    assert response.status_code == 200
    cookies = response.headers.get_list("set-cookie")
    assert "HttpOnly" in cookies[0] and "Secure" in cookies[0] and "SameSite=lax" in cookies[0]
    assert "Max-Age=604800" in cookies[0] and "SameSite=strict" in cookies[1]
    assert response.json()["patientId"] == user["patientId"]
    client.cookies.clear()
    monkeypatch.setattr(get_settings(), "node_env", "test")
    await client.post("/api/user/login", json={"email": user["email"], "password": "password123"})
    assert (await client.get(f"/api/user/{user['id']}")).status_code == 200
    logged_out = await client.post("/api/user/logout")
    assert logged_out.status_code == 200
    assert "Max-Age=0" in logged_out.headers.get_list("set-cookie")[0]
    assert (await client.get(f"/api/user/{user['id']}")).status_code == 401


@pytest.mark.parametrize("mode", ["missing", "unknown-user", "role-changed", "malformed"])
async def test_session_requires_existing_active_matching_identity(client, db, seed_user, mode):
    user = await seed_user()
    headers = auth({**user, "id": "missing-user"}) if mode == "unknown-user" else auth(user)
    if mode == "missing":
        headers = {}
    elif mode == "malformed":
        headers = {"Authorization": "Bearer invalid.token.value"}
    elif mode == "role-changed":
        await db.execute(
            update(tables["User"]).where(tables["User"].c.id == user["id"]).values(role="DOCTOR")
        )
    assert (await client.get(f"/api/user/{user['id']}", headers=headers)).status_code == 401


async def test_url_encoded_cookie_is_accepted_and_takes_precedence_over_bearer(client, seed_user):
    user = await seed_user()
    client.cookies.set("token", quote(issue_token(user)))
    response = await client.get(f"/api/user/{user['id']}", headers={"Authorization": "Bearer invalid"})
    assert response.status_code == 200


@pytest.mark.parametrize("identity_key", ["email", "userId"])
async def test_password_change_requires_old_password_and_updates_login(client, db, seed_user, identity_key):
    user = await seed_user()
    payload = {
        identity_key: user["email" if identity_key == "email" else "id"],
        "currentPassword": "password123",
        "newPassword": "new-password123",
    }
    assert (
        await client.post("/api/user/change-password", headers=auth(user), json=payload)
    ).status_code == 200
    stored = (
        await db.execute(select(tables["User"].c.password).where(tables["User"].c.id == user["id"]))
    ).scalar_one()
    assert verify_password("new-password123", stored) and not verify_password("password123", stored)
    assert (
        await client.post("/api/user/login", json={"email": user["email"], "password": "new-password123"})
    ).status_code == 200


@pytest.mark.parametrize(
    "changes,status",
    [
        ({"userId": "another-user"}, 403),
        ({"currentPassword": "incorrect"}, 400),
        ({"newPassword": "short"}, 400),
        ({"newPassword": "é" * 37}, 400),
    ],
)
async def test_failed_password_change_leaves_existing_hash(client, db, seed_user, changes, status):
    user = await seed_user()
    payload = {
        "userId": user["id"],
        "currentPassword": "password123",
        "newPassword": "valid-password",
        **changes,
    }
    response = await client.post("/api/user/change-password", headers=auth(user), json=payload)
    assert response.status_code == status
    assert (
        await db.execute(select(tables["User"].c.password).where(tables["User"].c.id == user["id"]))
    ).scalar_one() == user["password"]


@pytest.mark.parametrize("failure", ["expired", "wrong-code", "another-user", "unknown-user"])
async def test_password_reset_cannot_consume_wrong_or_expired_otp(client, db, seed_user, failure):
    user = await seed_user()
    other = await seed_user()
    await otp(db, user, expired=failure == "expired")
    email = other["email"] if failure == "another-user" else user["email"]
    if failure == "unknown-user":
        email = "unknown@example.test"
    response = await client.post(
        "/api/user/reset-password",
        json={
            "email": email,
            "otp": "654321" if failure == "wrong-code" else "123456",
            "newPassword": "replacement-password",
        },
    )
    assert response.status_code == 400
    assert (await db.execute(select(func.count()).select_from(tables["Otp"]))).scalar_one() == 1
    assert (
        await db.execute(select(tables["User"].c.password).where(tables["User"].c.id == user["id"]))
    ).scalar_one() == user["password"]


async def test_verification_marks_only_owner_verified_and_consumes_code(client, db, seed_user):
    user = await seed_user(emailVerified=False)
    other = await seed_user(emailVerified=False)
    await otp(db, user)
    assert (
        await client.post(f"/api/user/{other['id']}/otp/verify", json={"otp": "123456"})
    ).status_code == 400
    assert (
        await client.post(f"/api/user/{user['id']}/otp/verify", json={"otp": "123456"})
    ).status_code == 200
    assert (
        await client.post(f"/api/user/{user['id']}/otp/verify", json={"otp": "123456"})
    ).status_code == 400
    rows = dict((await db.execute(select(tables["User"].c.id, tables["User"].c.emailVerified))).all())
    assert rows[user["id"]] and not rows[other["id"]]


async def test_expired_verification_code_cannot_verify_email(client, db, seed_user):
    user = await seed_user(emailVerified=False)
    await otp(db, user, expired=True)
    response = await client.post(f"/api/user/{user['id']}/otp/verify", json={"otp": "123456"})
    assert response.status_code == 400
    assert not (
        await db.execute(select(tables["User"].c.emailVerified).where(tables["User"].c.id == user["id"]))
    ).scalar_one()


@pytest.mark.parametrize("case,status", [("unknown", 404), ("unconfigured", 503), ("throttled", 429)])
async def test_otp_send_failure_has_no_partial_token_write(client, db, seed_user, case, status):
    user = await seed_user()
    if case == "throttled":
        await otp(db, user)
    response = await client.post(f"/api/user/{'missing' if case == 'unknown' else user['id']}/otp/send")
    assert response.status_code == status
    assert (await db.execute(select(func.count()).select_from(tables["Otp"]))).scalar_one() == (
        case == "throttled"
    )


@pytest.mark.parametrize("provider_status", [200, 429, 500])
async def test_otp_delivery_refreshes_old_code_or_rolls_back_provider_failure(
    client, db, seed_user, monkeypatch, provider_status
):
    user = await seed_user()
    await otp(db, user, created_at=utcnow() - timedelta(minutes=2))
    monkeypatch.setattr(get_settings(), "resend_api_key", "isolated-provider-key")
    requests = []

    def deliver(request):
        requests.append(request)
        return httpx.Response(provider_status, json={"id": "email-id"})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        service.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(deliver), **kwargs),
    )
    response = await client.post(f"/api/user/{user['id']}/otp/send")
    assert response.status_code == (200 if provider_status == 200 else 502)
    assert len(requests) == 1 and requests[0].url.host == "api.resend.com"
    stored = (
        (await db.execute(select(tables["Otp"]).where(tables["Otp"].c.userId == user["id"]))).mappings().one()
    )
    if provider_status == 200:
        assert stored["code"].isdigit() and len(stored["code"]) == 6
        assert stored["createdAt"] > utcnow() - timedelta(minutes=1)
        assert stored["code"] not in response.text
    else:
        assert stored["code"] == "123456" and stored["createdAt"] < utcnow() - timedelta(minutes=1)


@pytest.mark.parametrize("failure", ["timeout", "malformed-json"])
async def test_otp_provider_transport_or_invalid_json_returns_sanitized_error_and_restores_code(
    client, db, seed_user, monkeypatch, failure
):
    user = await seed_user()
    await otp(db, user, created_at=utcnow() - timedelta(minutes=2))
    monkeypatch.setattr(get_settings(), "resend_api_key", "isolated-provider-secret")

    def fail_delivery(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("isolated-provider-secret timed out", request=request)
        return httpx.Response(200, content=b"not json: isolated-provider-secret")

    original = httpx.AsyncClient
    monkeypatch.setattr(
        service.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(fail_delivery), **kwargs),
    )
    response = await client.post(f"/api/user/{user['id']}/otp/send")
    assert response.status_code == 502
    assert "isolated-provider-secret" not in response.text
    row = (
        (await db.execute(select(tables["Otp"]).where(tables["Otp"].c.userId == user["id"]))).mappings().one()
    )
    assert row["code"] == "123456" and row["createdAt"] < utcnow() - timedelta(minutes=1)
