"""Privileged domain methods enforce input validation before mutating state."""

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select

from app.features.admin import service
from app.infrastructure.database import tables


@pytest.mark.parametrize("body", [{"isActive": "false"}, {"isActive": 0}, {"role": "UNKNOWN"}])
async def test_user_governance_service_rejects_invalid_types_without_mutation(db, seed_user, body):
    admin, patient = await seed_user("ADMIN"), await seed_user()
    with pytest.raises(HTTPException) as error:
        await service.update_user(patient["id"], body, admin, db)
    assert error.value.status_code == 400
    stored = (
        (await db.execute(select(tables["User"]).where(tables["User"].c.id == patient["id"])))
        .mappings()
        .one()
    )
    assert stored["isActive"] and stored["role"] == "PATIENT"


@pytest.mark.parametrize(
    "changes", [{"age": None}, {"age": "invalid"}, {"gender": "UNKNOWN"}, {"secretCode": 42}]
)
async def test_admin_onboarding_service_validates_internal_profile_values(db, seed_user, changes):
    admin = await seed_user("ADMIN")
    with pytest.raises(HTTPException) as error:
        await service.onboard_admin(
            {"userId": admin["id"], "secretCode": "isolated-test-super-admin-code", **changes}, admin, db
        )
    assert error.value.status_code == 400
    assert (
        await db.execute(select(tables["Admin"].c.managerId).where(tables["Admin"].c.userId == admin["id"]))
    ).scalar_one() is None


async def test_admin_without_profile_has_no_superadmin_privilege(db, seed_user):
    admin = await seed_user("ADMIN")
    await db.execute(delete(tables["Admin"]).where(tables["Admin"].c.id == admin["adminId"]))
    with pytest.raises(HTTPException) as error:
        await service.require_super_admin(db, admin)
    assert error.value.status_code == 403
