"""Identity, patient privacy and money-movement regression contracts.

The isolated SQLite database never reads or writes the configured clinic database.
"""

from datetime import timedelta

import httpx
import jwt
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import insert, select, text, update
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.infrastructure.database import get_db, metadata, tables, utcnow
from app.features.admin import router as admin
from app.features.auth import router as identity
from app.features.patients import router as patients
from app.features.accounts import router as users
from app.features.auth.passwords import hash_password
from app.core.security import SOCKET_AUDIENCE, decode_token, issue_token


@pytest_asyncio.fixture
async def identity_client(monkeypatch):
    monkeypatch.setattr(get_settings(), "jwt_secret", "isolated-test-signing-secret-32-characters")
    monkeypatch.setattr(get_settings(), "node_env", "test")
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as connection:
        await connection.execute(text("PRAGMA foreign_keys=ON"))
        await connection.run_sync(metadata.create_all)
        await connection.execute(
            insert(tables["Location"]).values(pincode=110001, city="Delhi", state="Delhi")
        )
        for user_id, role in (
            ("patient-one", "PATIENT"),
            ("patient-two", "PATIENT"),
            ("doctor-one", "DOCTOR"),
            ("admin-one", "ADMIN"),
        ):
            await connection.execute(
                insert(tables["User"]).values(
                    id=user_id,
                    email=f"{user_id}@example.test",
                    name=user_id,
                    phoneNo="9999999999",
                    password=hash_password("password123"),
                    age=30,
                    gender="MALE",
                    role=role,
                    address="Test street",
                    pinCode=110001,
                    isActive=True,
                    emailVerified=True,
                )
            )
        for user_id in ("patient-one", "patient-two"):
            await connection.execute(
                insert(tables["Patient"]).values(
                    id=f"profile-{user_id}", userId=user_id, medicalHistory="private clinical history"
                )
            )
        await connection.execute(
            insert(tables["Doctor"]).values(
                id="doctor-profile", userId="doctor-one", specialty="GENERAL_PHYSICIAN", balance=5000
            )
        )
        await connection.execute(insert(tables["Admin"]).values(id="admin-profile", userId="admin-one"))
    app = FastAPI()
    for module in (identity, users, patients, admin):
        app.include_router(module.router)

    async def isolated_db():
        async with engine.begin() as connection:
            yield connection

    app.dependency_overrides[get_db] = isolated_db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, engine
    await engine.dispose()


def token(user_id, role):
    return {"Authorization": "Bearer " + issue_token({"id": user_id, "role": role})}


def test_audience_and_conflicting_identity(monkeypatch):
    monkeypatch.setattr(get_settings(), "jwt_secret", "isolated-test-signing-secret-32-characters")
    ticket = issue_token({"id": "one", "role": "PATIENT"}, SOCKET_AUDIENCE, 600)
    with pytest.raises(HTTPException) as error:
        decode_token(ticket)
    assert error.value.status_code == 401
    assert decode_token(ticket, SOCKET_AUDIENCE)["id"] == "one"
    conflict = jwt.encode(
        {"id": "one", "userId": "two", "role": "PATIENT", "exp": utcnow() + timedelta(minutes=10)},
        get_settings().jwt_secret,
        algorithm="HS256",
    )
    with pytest.raises(HTTPException):
        decode_token(conflict)


async def test_signup_login_cookie_and_profile_allowlist(identity_client):
    client, _ = identity_client
    payload = {
        "name": "New Patient",
        "email": "new@example.test",
        "phoneNo": "9999999999",
        "password": "password123",
        "age": "23",
        "gender": "FEMALE",
        "address": "Clinic street",
        "pinCode": "110001",
        "city": "Delhi",
        "state": "Delhi",
        "role": "PATIENT",
    }
    blocked = await client.post("/api/user/signup", json={**payload, "role": "ADMIN"})
    assert blocked.status_code == 403
    created = await client.post("/api/user/signup", json=payload)
    assert created.status_code == 201
    data = created.json()["user"]
    assert data["city"] == "Delhi"
    assert "password" not in data
    assert "HttpOnly" in created.headers.get_list("set-cookie")[0]
    profile = await client.get(f"/api/user/{data['id']}")
    assert profile.status_code == 200
    injected = await client.patch(
        f"/api/user/{data['id']}",
        json={"role": "ADMIN", "isActive": False, "password": "changed", "name": "Updated"},
    )
    assert injected.status_code == 200
    assert injected.json()["role"] == "PATIENT"
    await client.post("/api/user/logout")
    logged_in = await client.post(
        "/api/user/login", json={"email": payload["email"], "password": payload["password"]}
    )
    assert logged_in.status_code == 200


async def test_profile_idor_and_deactivated_token(identity_client):
    client, engine = identity_client
    headers = token("patient-one", "PATIENT")
    assert (await client.get("/api/user/patient-two", headers=headers)).status_code == 403
    assert (
        await client.patch(
            "/api/patients/profile-patient-two", headers=headers, json={"medicalHistory": "stolen"}
        )
    ).status_code == 403
    assert (await client.get("/api/patients/profile-patient-two", headers=headers)).status_code == 403
    async with engine.begin() as connection:
        await connection.execute(
            update(tables["User"]).where(tables["User"].c.id == "patient-one").values(isActive=False)
        )
    assert (await client.get("/api/user/patient-one", headers=headers)).status_code == 401


async def test_doctor_medical_access_requires_eligible_appointment(identity_client):
    client, engine = identity_client
    headers = token("doctor-one", "DOCTOR")
    url = "/api/patients/profile-patient-one"
    assert (await client.get(url, headers=headers)).status_code == 403
    async with engine.begin() as connection:
        await connection.execute(
            insert(tables["DoctorPatientRelation"]).values(
                id="relation", doctorsUserId="doctor-one", patientsUserId="patient-one"
            )
        )
        await connection.execute(
            insert(tables["Slot"]).values(
                id="slot",
                doctorId="doctor-profile",
                date=utcnow().date(),
                startTime=utcnow(),
                endTime=utcnow() + timedelta(minutes=30),
            )
        )
        await connection.execute(
            insert(tables["Appointment"]).values(
                id="appointment",
                doctorId="doctor-profile",
                patientId="profile-patient-one",
                slotId="slot",
                status="PENDING",
            )
        )
    assert (await client.get(url, headers=headers)).status_code == 403
    async with engine.begin() as connection:
        await connection.execute(
            update(tables["Appointment"])
            .where(tables["Appointment"].c.id == "appointment")
            .values(status="CONFIRMED")
        )
    response = await client.get(url, headers=headers)
    assert response.status_code == 200
    assert response.json()["patient"]["medicalHistory"] == "private clinical history"
    assert "password" not in response.json()["patient"]["user"]
    assert (await client.get("/api/patients?scope=all", headers=headers)).status_code == 403


async def test_password_reset_consumes_otp_once(identity_client):
    client, engine = identity_client
    async with engine.begin() as connection:
        await connection.execute(
            insert(tables["Otp"]).values(
                id="otp-one",
                email="patient-one@example.test",
                userId="patient-one",
                code="123456",
                expiresAt=utcnow() + timedelta(minutes=10),
            )
        )
    payload = {"email": "patient-one@example.test", "otp": "123456", "newPassword": "newpassword"}
    first = await client.post("/api/user/reset-password", json=payload)
    assert first.status_code == 200
    replay = await client.post(
        "/api/user/reset-password", json={**payload, "newPassword": "attackerpassword"}
    )
    assert replay.status_code == 400
    assert (
        await client.post("/api/user/login", json={"email": payload["email"], "password": "newpassword"})
    ).status_code == 200


async def test_withdrawal_rejection_credits_reserved_balance_once(identity_client):
    client, engine = identity_client
    async with engine.begin() as connection:
        await connection.execute(
            insert(tables["Withdrawal"]).values(
                id="withdrawal", doctorId="doctor-profile", amount=2000, status="PENDING"
            )
        )
    headers = token("admin-one", "ADMIN")
    payload = {"withdrawalId": "withdrawal", "status": "REJECTED"}
    assert (await client.patch("/api/admin/withdrawals", headers=headers, json=payload)).status_code == 200
    assert (await client.patch("/api/admin/withdrawals", headers=headers, json=payload)).status_code == 409
    async with engine.begin() as connection:
        assert (
            await connection.execute(
                select(tables["Doctor"].c.balance).where(tables["Doctor"].c.id == "doctor-profile")
            )
        ).scalar_one() == 7000


async def test_bank_ownership_and_admin_password_redaction(identity_client):
    client, _ = identity_client
    payload = {
        "bankAccountNumber": "123456789012",
        "bankIFSC": "ABCD0123456",
        "bankAccountHolderName": "Doctor",
        "bankName": "Test Bank",
    }
    assert (
        await client.patch(
            "/api/doctors/doctor-profile/bank-details", headers=token("patient-one", "PATIENT"), json=payload
        )
    ).status_code == 403
    saved = await client.patch(
        "/api/doctors/doctor-profile/bank-details", headers=token("doctor-one", "DOCTOR"), json=payload
    )
    assert saved.status_code == 200
    listed = await client.get("/api/admin/users", headers=token("admin-one", "ADMIN"))
    assert listed.status_code == 200
    assert all("password" not in row for row in listed.json()["users"])
