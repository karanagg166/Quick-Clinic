"""Doctor ownership and presentation queries against existing database mappings."""

from fastapi import HTTPException
from sqlalchemy import select
from app.infrastructure.database import tables

(
    doctors_table,
    users_table,
    locations_table,
    qualifications_table,
    appointments_table,
    slots_table,
    patients_table,
    ratings_table,
    comments_table,
    withdrawals_table,
    bank_accounts_table,
) = (
    tables[n]
    for n in (
        "Doctor",
        "User",
        "Location",
        "DoctorQualification",
        "Appointment",
        "Slot",
        "Patient",
        "Rating",
        "Comment",
        "Withdrawal",
        "BankAccount",
    )
)


async def owned_doctor(db, doctor_id, user, lock=False):
    stmt = select(doctors_table).where(doctors_table.c.id == doctor_id)
    if lock:
        stmt = stmt.with_for_update()
    doctor = (await db.execute(stmt)).mappings().first()
    if not doctor:
        raise HTTPException(404, "Doctor not found")
    if user["role"] != "ADMIN" and (user["role"] != "DOCTOR" or doctor["userId"] != user["id"]):
        raise HTTPException(403, "Forbidden")
    return dict(doctor)


async def doctor_view(db, row):
    user = (await db.execute(select(users_table).where(users_table.c.id == row["userId"]))).mappings().one()
    location = (
        (await db.execute(select(locations_table).where(locations_table.c.pincode == user["pinCode"])))
        .mappings()
        .first()
    )
    qualifications = list(
        (
            await db.execute(
                select(qualifications_table.c.qualification).where(
                    qualifications_table.c.doctorId == row["id"]
                )
            )
        ).scalars()
    )
    return {
        **{
            k: row[k]
            for k in ("id", "userId", "specialty", "experience", "fees", "doctorBio", "latitude", "longitude")
        },
        **{k: user[k] for k in ("name", "gender", "age", "email", "profileImageUrl")},
        "qualifications": qualifications,
        "city": location["city"] if location else None,
        "state": location["state"] if location else None,
    }
