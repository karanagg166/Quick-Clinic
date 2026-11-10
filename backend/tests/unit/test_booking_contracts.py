"""Small reservation contracts that do not require an HTTP server."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import insert, select

from app.features.booking.appointments import change_status
from app.features.booking.schemas import AppointmentConfirmationRequest, SlotHoldCancellationRequest
from app.features.booking.service import as_utc_datetime, insert_unique, require_patient_profile
from app.infrastructure.database import tables, utcnow


def test_naive_database_datetime_is_interpreted_as_utc():
    value = datetime(2026, 1, 2, 3, 4, 5)
    assert as_utc_datetime(value) == value.replace(tzinfo=timezone.utc)


def test_aware_datetime_retains_its_instant_and_timezone():
    value = datetime(2026, 1, 2, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    assert as_utc_datetime(value) is value


@pytest.mark.parametrize("token", ["", "not-a-uuid", "../other-hold", "0" * 36])
def test_release_request_requires_a_real_uuid(token):
    with pytest.raises(ValidationError):
        SlotHoldCancellationRequest(slotId="slot", holdToken=token)


@pytest.mark.parametrize("method", ["CASH", "online", "", None])
def test_confirmation_payment_method_is_a_closed_enum(method):
    with pytest.raises(ValidationError):
        AppointmentConfirmationRequest(
            slotId="slot", doctorId="doctor", holdToken=uuid4(), paymentMethod=method
        )


@pytest.mark.parametrize("role", ["DOCTOR", "ADMIN"])
async def test_nonpatients_cannot_get_a_patient_booking_profile(db, seed_user, role):
    user = await seed_user(role)
    with pytest.raises(HTTPException) as exc:
        await require_patient_profile(db, user)
    assert exc.value.status_code == 403


async def test_missing_patient_profile_fails_closed(db):
    with pytest.raises(HTTPException) as exc:
        await require_patient_profile(db, {"id": "missing", "role": "PATIENT"})
    assert exc.value.status_code == 403


async def test_unique_insert_recovers_existing_row_without_aborting_transaction(db, seed_user):
    user = await seed_user()
    table = tables["Notification"]
    values = dict(id="notice-first", userId=user["id"], eventId="dedup", message="first")
    await db.execute(insert(table).values(**values))
    duplicate = await insert_unique(
        db,
        table,
        dict(values, id="notice-second", message="second"),
        table.c.userId == user["id"],
        table.c.eventId == "dedup",
    )
    assert duplicate["id"] == "notice-first"
    await db.execute(insert(table).values(id="notice-third", userId=user["id"], message="after conflict"))
    assert len((await db.execute(select(table))).all()) == 2


@pytest.mark.parametrize(
    ("initial", "target"),
    [
        ("PENDING", "COMPLETED"),
        ("COMPLETED", "CANCELLED"),
        ("CANCELLED", "CONFIRMED"),
        ("NO_SHOW", "CONFIRMED"),
        ("EXPIRED", "CONFIRMED"),
        ("RESCHEDULED", "COMPLETED"),
    ],
)
async def test_invalid_lifecycle_transition_has_no_database_effect(db, seed_user, initial, target):
    doctor, patient = await seed_user("DOCTOR"), await seed_user()
    now = utcnow()
    await db.execute(
        insert(tables["Slot"]).values(
            id="transition-slot",
            doctorId=doctor["doctorId"],
            date=now.date(),
            startTime=now,
            endTime=now + timedelta(minutes=30),
            status="BOOKED",
        )
    )
    appointment = dict(
        id="transition-appt",
        doctorId=doctor["doctorId"],
        patientId=patient["patientId"],
        slotId="transition-slot",
        status=initial,
        paymentMethod="OFFLINE",
    )
    await db.execute(insert(tables["Appointment"]).values(**appointment))
    with pytest.raises(HTTPException) as exc:
        await change_status(db, appointment, target)
    assert exc.value.status_code == 400
    assert (await db.execute(select(tables["Appointment"].c.status))).scalar_one() == initial
    assert not (await db.execute(select(tables["NotificationOutbox"]))).all()


async def test_deleted_appointment_cannot_transition(db):
    with pytest.raises(HTTPException) as exc:
        await change_status(db, {"id": "deleted"}, "CANCELLED")
    assert exc.value.status_code == 404
