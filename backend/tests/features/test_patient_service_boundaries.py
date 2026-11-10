"""Internal patient operations fail closed when profiles or identifiers are absent."""

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select

from app.features.patients import service
from app.infrastructure.database import tables


@pytest.mark.parametrize("user_id", [None, 42, ""])
async def test_patient_creation_service_requires_nonempty_text_identity(db, seed_user, user_id):
    admin = await seed_user("ADMIN")
    with pytest.raises(HTTPException) as error:
        await service.create_patient_profile({"userId": user_id}, admin, db)
    assert error.value.status_code == 400
    assert (await db.execute(select(func.count()).select_from(tables["Patient"]))).scalar_one() == 0


async def test_admin_cannot_create_patient_profile_for_doctor_account(db, seed_user):
    admin, doctor = await seed_user("ADMIN"), await seed_user("DOCTOR")
    with pytest.raises(HTTPException) as error:
        await service.create_patient_profile({"userId": doctor["id"]}, admin, db)
    assert error.value.status_code == 404
    assert (await db.execute(select(func.count()).select_from(tables["Patient"]))).scalar_one() == 0


async def test_doctor_without_onboarding_profile_cannot_search_patients(db, seed_user):
    doctor = await seed_user("DOCTOR")
    await db.execute(delete(tables["Doctor"]).where(tables["Doctor"].c.id == doctor["doctorId"]))
    with pytest.raises(HTTPException) as error:
        await service.list_patients({}, doctor, db)
    assert error.value.status_code == 404
