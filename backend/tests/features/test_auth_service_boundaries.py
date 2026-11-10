"""Internal authentication callers retain validation independently of HTTP schemas."""

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.features.auth import service
from app.infrastructure.database import tables


@pytest.mark.parametrize(
    "changes",
    [
        {"gender": "UNKNOWN"},
        {"email": "invalid"},
        {"age": None},
        {"age": "not-a-number"},
        {"age": -1},
        {"age": 151},
    ],
)
async def test_registration_service_rejects_malformed_domain_values_before_writes(db, changes):
    body = {
        "name": "New Patient",
        "email": "new@example.test",
        "phoneNo": "9999999999",
        "address": "Clinic street",
        "age": 23,
        "gender": "FEMALE",
        "role": "PATIENT",
        "password": "password123",
        "pinCode": 110001,
        **changes,
    }
    with pytest.raises(HTTPException) as error:
        await service.register_user(body, db)
    assert error.value.status_code == 400
    for model in ("User", "Location", "AuditLog"):
        assert (await db.execute(select(func.count()).select_from(tables[model]))).scalar_one() == 0


@pytest.mark.parametrize(
    "body", [{}, {"email": 42, "password": "password123"}, {"email": "user@example.test", "password": None}]
)
async def test_authentication_service_rejects_missing_email_or_password(db, body):
    with pytest.raises(HTTPException) as error:
        await service.authenticate_user(body, db)
    assert error.value.status_code == 400


async def test_password_reset_service_requires_textual_otp_before_password_update(db, seed_user):
    user = await seed_user()
    with pytest.raises(HTTPException) as error:
        await service.reset_password(
            {"email": user["email"], "otp": 123456, "newPassword": "replacement-password"}, db
        )
    assert error.value.status_code == 400
    stored = (
        await db.execute(select(tables["User"].c.password).where(tables["User"].c.id == user["id"]))
    ).scalar_one()
    assert stored == user["password"]
