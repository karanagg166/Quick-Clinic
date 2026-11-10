"""Account deactivation closes pending work while retaining completed history."""

from datetime import timedelta

from sqlalchemy import insert, select

from app.core.security import issue_token
from app.infrastructure.database import new_id, tables, utcnow


def auth(user):
    return {"Authorization": "Bearer " + issue_token(user)}


async def scheduled_appointment(db, doctor, patient, status, offset):
    start = utcnow() + timedelta(days=1, minutes=offset)
    slot_id, appointment_id = new_id(), new_id()
    await db.execute(
        insert(tables["Slot"]).values(
            id=slot_id,
            doctorId=doctor["doctorId"],
            date=start.date(),
            startTime=start,
            endTime=start + timedelta(minutes=30),
            status="BOOKED",
        )
    )
    await db.execute(
        insert(tables["Appointment"]).values(
            id=appointment_id,
            doctorId=doctor["doctorId"],
            patientId=patient["patientId"],
            slotId=slot_id,
            status=status,
        )
    )
    return appointment_id, slot_id


async def test_disabling_doctor_cancels_open_appointments_and_clears_available_holds(client, db, seed_user):
    admin, doctor, patient = await seed_user("ADMIN"), await seed_user("DOCTOR"), await seed_user()
    ids = {}
    for index, status in enumerate(("PENDING", "CONFIRMED", "COMPLETED")):
        ids[status], _ = await scheduled_appointment(db, doctor, patient, status, index * 60)
    hold = new_id()
    start = utcnow() + timedelta(days=2)
    await db.execute(
        insert(tables["Slot"]).values(
            id=hold,
            doctorId=doctor["doctorId"],
            date=start.date(),
            startTime=start,
            endTime=start + timedelta(minutes=30),
            status="HELD",
            heldByPatientId=patient["patientId"],
            holdToken="isolated-hold",
            heldAt=utcnow(),
            holdExpiresAt=utcnow() + timedelta(minutes=10),
        )
    )
    response = await client.patch(
        f"/api/admin/users/{doctor['id']}", headers=auth(admin), json={"isActive": False}
    )
    assert response.status_code == 200
    states = dict(
        (await db.execute(select(tables["Appointment"].c.id, tables["Appointment"].c.status))).all()
    )
    assert states == {
        ids["PENDING"]: "CANCELLED",
        ids["CONFIRMED"]: "CANCELLED",
        ids["COMPLETED"]: "COMPLETED",
    }
    slot = (await db.execute(select(tables["Slot"]).where(tables["Slot"].c.id == hold))).mappings().one()
    assert slot["status"] == "UNAVAILABLE"
    assert all(slot[key] is None for key in ("heldByPatientId", "holdToken", "heldAt", "holdExpiresAt"))
    assert (await client.get(f"/api/user/{doctor['id']}", headers=auth(doctor))).status_code == 401


async def test_disabling_patient_releases_only_open_appointment_slots_and_preserves_other_patients(
    client, db, seed_user
):
    admin, doctor, patient, other = (
        await seed_user("ADMIN"),
        await seed_user("DOCTOR"),
        await seed_user(),
        await seed_user(),
    )
    pending, pending_slot = await scheduled_appointment(db, doctor, patient, "PENDING", 0)
    confirmed, confirmed_slot = await scheduled_appointment(db, doctor, patient, "CONFIRMED", 60)
    completed, completed_slot = await scheduled_appointment(db, doctor, patient, "COMPLETED", 120)
    unrelated, unrelated_slot = await scheduled_appointment(db, doctor, other, "CONFIRMED", 180)
    response = await client.patch(
        f"/api/admin/users/{patient['id']}", headers=auth(admin), json={"isActive": False}
    )
    assert response.status_code == 200
    states = dict(
        (await db.execute(select(tables["Appointment"].c.id, tables["Appointment"].c.status))).all()
    )
    assert states == {
        pending: "CANCELLED",
        confirmed: "CANCELLED",
        completed: "COMPLETED",
        unrelated: "CONFIRMED",
    }
    slots = dict((await db.execute(select(tables["Slot"].c.id, tables["Slot"].c.status))).all())
    assert slots == {
        pending_slot: "AVAILABLE",
        confirmed_slot: "AVAILABLE",
        completed_slot: "BOOKED",
        unrelated_slot: "BOOKED",
    }
