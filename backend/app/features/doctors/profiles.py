"""Doctor onboarding and profile updates preserve authorization and review eligibility."""

from fastapi import HTTPException
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import new_id, utcnow
from .repository import (
    doctors_table,
    users_table,
    qualifications_table,
    appointments_table,
    patients_table,
    ratings_table,
    doctor_view,
    owned_doctor,
)
from .schemas import profile_values
from .reviews import list_comments, rating_summary


async def create_doctor_profile(body, user, db: AsyncConnection):
    user_id = body.get("userId")
    if user["role"] != "ADMIN" and (user["role"] != "DOCTOR" or user_id != user["id"]):
        raise HTTPException(403, "Forbidden")
    values = profile_values(body)
    if not user_id or "specialty" not in values:
        raise HTTPException(400, "userId and specialty are required")
    target = (await db.execute(select(users_table).where(users_table.c.id == user_id))).mappings().first()
    if not target or target["role"] != "DOCTOR":
        raise HTTPException(400, "Doctor user required")
    if (await db.execute(select(doctors_table.c.id).where(doctors_table.c.userId == user_id))).first():
        raise HTTPException(409, "Doctor profile already exists for this user")
    doctor_id = new_id()
    await db.execute(insert(doctors_table).values(id=doctor_id, userId=user_id, **values))
    for qualification in set(body.get("qualifications", [])):
        await db.execute(
            insert(qualifications_table).values(id=new_id(), doctorId=doctor_id, qualification=qualification)
        )
    return {
        "doctor": dict(
            (await db.execute(select(doctors_table).where(doctors_table.c.id == doctor_id))).mappings().one()
        )
    }


async def get_doctor_profile(doctor_id: str, viewer, db: AsyncConnection):
    doctor = (
        (
            await db.execute(
                select(doctors_table)
                .join(users_table, doctors_table.c.userId == users_table.c.id)
                .where(
                    doctors_table.c.id == doctor_id,
                    doctors_table.c.isReleaseFixture.is_(False),
                    users_table.c.isActive.is_(True),
                )
            )
        )
        .mappings()
        .first()
    )
    if not doctor:
        raise HTTPException(404, "Doctor not found")
    (can_review, user_rating) = (False, None)
    if viewer and viewer["role"] == "PATIENT":
        patient_id = (
            await db.execute(select(patients_table.c.id).where(patients_table.c.userId == viewer["id"]))
        ).scalar()
        can_review = bool(
            (
                await db.execute(
                    select(appointments_table.c.id)
                    .where(
                        appointments_table.c.doctorId == doctor_id,
                        appointments_table.c.patientId == patient_id,
                        appointments_table.c.status == "COMPLETED",
                    )
                    .limit(1)
                )
            ).first()
        )
        user_rating = (
            await db.execute(
                select(ratings_table.c.rating).where(
                    ratings_table.c.doctorId == doctor_id, ratings_table.c.patientId == patient_id
                )
            )
        ).scalar()
    return {
        "doctor": await doctor_view(db, doctor),
        "rating": await rating_summary(doctor_id, db),
        "comments": (await list_comments(doctor_id, db))["comments"],
        "canReview": can_review,
        "userRating": user_rating,
    }


async def update_doctor_profile(doctor_id: str, body, user, db: AsyncConnection):
    await owned_doctor(db, doctor_id, user, lock=True)
    await db.execute(
        update(doctors_table)
        .where(doctors_table.c.id == doctor_id)
        .values(**profile_values(body), updatedAt=utcnow())
    )
    if "qualifications" in body:
        await db.execute(delete(qualifications_table).where(qualifications_table.c.doctorId == doctor_id))
        for qualification in set(body["qualifications"]):
            await db.execute(
                insert(qualifications_table).values(
                    id=new_id(), doctorId=doctor_id, qualification=qualification
                )
            )
    return {
        "doctor": dict(
            (await db.execute(select(doctors_table).where(doctors_table.c.id == doctor_id))).mappings().one()
        )
    }
