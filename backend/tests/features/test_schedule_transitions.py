"""Detailed scheduling state transitions and private calendar aggregates."""

from datetime import date, datetime, timedelta
import json

import pytest
from sqlalchemy import insert, select

from app.core.security import issue_token
from app.infrastructure.database import new_id, tables


def auth(user):
    return {"Authorization": f"Bearer {issue_token(user)}"}


async def slot(db, doctor, status="AVAILABLE", minute=0):
    identifier = new_id()
    start = datetime(2035, 1, 1, 3, 30) + timedelta(minutes=minute)
    await db.execute(
        insert(tables["Slot"]).values(
            id=identifier,
            doctorId=doctor["doctorId"],
            date=start.date(),
            startTime=start,
            endTime=start + timedelta(minutes=10),
            status=status,
        )
    )
    return identifier


async def test_slot_single_and_bulk_updates_return_status_and_deduplicate_ids(client, db, seed_user):
    doctor = await seed_user("DOCTOR")
    first, second = await slot(db, doctor), await slot(db, doctor, minute=10)
    root = f"/api/doctors/{doctor['doctorId']}/slots"
    changed = await client.patch(root, headers=auth(doctor), json={"slotId": first, "status": "UNAVAILABLE"})
    assert changed.status_code == 200 and changed.json()["slot"]["status"] == "UNAVAILABLE"
    bulk = await client.patch(
        root, headers=auth(doctor), json={"slotIds": [first, second, first], "status": "AVAILABLE"}
    )
    assert bulk.status_code == 200 and bulk.json()["count"] == 2
    assert set((await db.execute(select(tables["Slot"].c.status))).scalars()) == {"AVAILABLE"}


async def test_available_slot_with_cancelled_history_cannot_be_deleted(client, db, seed_user):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    identifier = await slot(db, doctor)
    await db.execute(
        insert(tables["Appointment"]).values(
            doctorId=doctor["doctorId"], patientId=patient["patientId"], slotId=identifier, status="CANCELLED"
        )
    )
    response = await client.request(
        "DELETE",
        f"/api/doctors/{doctor['doctorId']}/slots",
        headers=auth(doctor),
        json={"slotId": identifier},
    )
    assert response.status_code == 409


async def test_ad_hoc_slot_rejects_reversed_times_and_doctor_leave(client, db, seed_user):
    doctor = await seed_user("DOCTOR")
    root = f"/api/doctors/{doctor['doctorId']}/slots"
    result = await client.post(
        root, headers=auth(doctor), json={"date": "2035-01-01", "startTime": "10:00", "endTime": "09:00"}
    )
    assert result.status_code == 400
    await db.execute(
        insert(tables["Leave"]).values(
            doctorId=doctor["doctorId"],
            startDate=datetime(2035, 1, 1, 3, 30),
            endDate=datetime(2035, 1, 1, 4),
            reason="Conference",
        )
    )
    result = await client.post(
        root, headers=auth(doctor), json={"date": "2035-01-01", "startTime": "09:00", "endTime": "09:10"}
    )
    assert result.status_code == 409


@pytest.mark.parametrize("schedule", ["json_string", "legacy_object"])
async def test_legacy_schedule_formats_generate_leave_aware_slots(db, seed_user, schedule):
    from app.features.scheduling.availability import daily_slots

    doctor = await seed_user("DOCTOR")
    weekly = [{"day": "Monday", "slots": [{"start": "09:00", "end": "09:20"}]}]
    legacy = json.dumps(weekly) if schedule == "json_string" else {"weeklySchedule": weekly}
    await db.execute(insert(tables["Schedule"]).values(doctorId=doctor["doctorId"], weeklySchedule=legacy))
    await db.execute(
        insert(tables["Leave"]).values(
            doctorId=doctor["doctorId"],
            startDate=datetime(2035, 1, 1, 3, 35),
            endDate=datetime(2035, 1, 1, 3, 40),
            reason="Synthetic leave",
        )
    )
    rows, generated = await daily_slots(db, doctor["doctorId"], date(2035, 1, 1))
    assert generated and [row["status"] for row in rows] == ["ON_LEAVE", "AVAILABLE"]


@pytest.mark.parametrize(
    "appointment_status,expected",
    [
        ("PENDING", "BOOKED"),
        ("CONFIRMED", "BOOKED"),
        ("COMPLETED", "UNAVAILABLE"),
        ("NO_SHOW", "UNAVAILABLE"),
        ("CANCELLED", "AVAILABLE"),
    ],
)
async def test_public_slots_derive_appointment_status_without_patient_identity(
    client, db, seed_user, appointment_status, expected
):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    identifier = await slot(db, doctor)
    await db.execute(
        insert(tables["Appointment"]).values(
            doctorId=doctor["doctorId"],
            patientId=patient["patientId"],
            slotId=identifier,
            status=appointment_status,
        )
    )
    result = await client.get(f"/api/doctors/{doctor['doctorId']}/slots?date=2035-01-01")
    row = result.json()["slots"][0]
    assert row["status"] == expected
    assert row["heldByPatientId"] is None and "patientId" not in row and "appointment" not in row


async def test_past_available_slot_is_publicly_unavailable(client, db, seed_user):
    doctor = await seed_user("DOCTOR")
    await db.execute(
        insert(tables["Slot"]).values(
            doctorId=doctor["doctorId"],
            date=date(2000, 1, 1),
            startTime=datetime(2000, 1, 1, 4),
            endTime=datetime(2000, 1, 1, 4, 10),
        )
    )
    result = await client.get(f"/api/doctors/{doctor['doctorId']}/slots?date=2000-01-01")
    assert result.json()["slots"][0]["status"] == "UNAVAILABLE"


async def test_daily_overview_patient_details_and_week_month_aggregates(client, db, seed_user):
    doctor, patient = await seed_user("DOCTOR"), await seed_user(name="Synthetic Patient")
    identifier = await slot(db, doctor, "BOOKED")
    await db.execute(
        insert(tables["Appointment"]).values(
            doctorId=doctor["doctorId"], patientId=patient["patientId"], slotId=identifier, status="CONFIRMED"
        )
    )
    await db.execute(
        insert(tables["Leave"]).values(
            doctorId=doctor["doctorId"],
            startDate=datetime(2035, 1, 2),
            endDate=datetime(2035, 1, 3),
            reason="Conference",
        )
    )
    root = f"/api/doctors/{doctor['doctorId']}/schedule/overview"
    day = (await client.get(root, headers=auth(doctor), params={"date": "2035-01-01"})).json()
    assert day["slots"][0]["appointment"]["patient"]["name"] == "Synthetic Patient"
    assert day["metrics"]["bookedCount"] == 1
    week = (
        await client.get(root, headers=auth(doctor), params={"view": "week", "startDate": "2035-01-01"})
    ).json()
    assert week["weekMetrics"] == {
        "totalSlots": 1,
        "totalBooked": 1,
        "totalAvailable": 0,
        "occupancyRate": 100,
    }
    month = (
        await client.get(root, headers=auth(doctor), params={"view": "month", "year": "2035", "month": "1"})
    ).json()
    assert month["days"][0]["statusSummary"] == "BOOKED"
    assert month["days"][1]["isLeave"] is True and month["days"][1]["statusSummary"] == "ON_LEAVE"


async def test_cancel_and_patch_leave_reject_missing_and_past_leave(client, db, seed_user):
    doctor = await seed_user("DOCTOR")
    root = f"/api/doctors/{doctor['doctorId']}/leave"
    assert (await client.patch(root, headers=auth(doctor), json={"leaveId": "missing"})).status_code == 404
    assert (await client.delete(root, headers=auth(doctor), params={"leaveId": "missing"})).status_code == 404
    identifier = new_id()
    await db.execute(
        insert(tables["Leave"]).values(
            id=identifier,
            doctorId=doctor["doctorId"],
            startDate=datetime(2000, 1, 1),
            endDate=datetime(2000, 1, 2),
            reason="Historical leave",
        )
    )
    assert (
        await client.delete(root, headers=auth(doctor), params={"leaveId": identifier})
    ).status_code == 400


async def test_leave_online_cancellation_queues_refund_without_provider_call(client, db, seed_user):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    identifier = await slot(db, doctor, "BOOKED")
    payment_id = new_id()
    await db.execute(
        insert(tables["Payment"]).values(
            id=payment_id,
            amount=50000,
            userId=patient["id"],
            status="CAPTURED",
            razorpayOrderId="synthetic-leave-order",
            razorpayPaymentId="synthetic-leave-payment",
        )
    )
    await db.execute(
        insert(tables["Appointment"]).values(
            doctorId=doctor["doctorId"],
            patientId=patient["patientId"],
            slotId=identifier,
            status="CONFIRMED",
            paymentMethod="ONLINE",
            paymentId=payment_id,
        )
    )
    result = await client.post(
        f"/api/doctors/{doctor['doctorId']}/leave",
        headers=auth(doctor),
        json={"startDate": "2035-01-01T03:30Z", "endDate": "2035-01-01T03:40Z", "reason": "Conference"},
    )
    assert result.status_code == 201 and result.json()["cancelledAppointments"] == 1
    refund = (await db.execute(select(tables["Refund"]))).mappings().one()
    assert refund["paymentId"] == payment_id and refund["amount"] == 50000 and refund["status"] == "PENDING"
    assert (await db.execute(select(tables["Payment"].c.status))).scalar_one() == "REFUND_PENDING"


async def test_restore_leave_preserves_other_leave_and_completed_appointment(db, seed_user):
    from app.features.scheduling.leave import restore_leave

    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    blocked, completed, free = [await slot(db, doctor, "ON_LEAVE", minute) for minute in (0, 10, 20)]
    await db.execute(
        insert(tables["Leave"]).values(
            doctorId=doctor["doctorId"],
            startDate=datetime(2035, 1, 1, 3, 30),
            endDate=datetime(2035, 1, 1, 3, 40),
            reason="Remaining leave",
        )
    )
    await db.execute(
        insert(tables["Appointment"]).values(
            doctorId=doctor["doctorId"], patientId=patient["patientId"], slotId=completed, status="COMPLETED"
        )
    )
    await restore_leave(db, doctor["doctorId"])
    rows = {row["id"]: row["status"] for row in (await db.execute(select(tables["Slot"]))).mappings()}
    assert rows == {blocked: "ON_LEAVE", completed: "ON_LEAVE", free: "AVAILABLE"}
