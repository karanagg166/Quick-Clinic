"""Appointment read queries for the Quick-Clinic Doctor AI Agent."""

from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.clock import clinic_zone, to_clinic_time, to_naive_utc
from app.infrastructure.database import tables


async def _owned_doctor_id(db: AsyncConnection, actor: dict[str, Any]) -> str:
    if not isinstance(actor, dict) or actor.get("role") != "DOCTOR" or actor.get("isActive") is not True:
        raise HTTPException(403, "Doctor authorization required")
    doctors = tables["Doctor"]
    row = (await db.execute(select(doctors.c.id).where(doctors.c.userId == actor["id"]))).first()
    if not row:
        raise HTTPException(404, "Doctor profile not found")
    return str(row[0])


async def get_my_appointments(
    db: AsyncConnection,
    actor: dict[str, Any],
    *,
    status: str | None = None,
    start_day: date | None = None,
    end_day: date | None = None,
) -> dict[str, Any]:
    """Return doctor appointments filtered by optional status and date range."""

    doctor_id = await _owned_doctor_id(db, actor)
    appointments = tables["Appointment"]
    slots = tables["Slot"]
    patients = tables["Patient"]
    users = tables["User"]

    stmt = (
        select(
            appointments.c.id,
            appointments.c.patientId,
            appointments.c.slotId,
            appointments.c.status,
            appointments.c.paymentMethod,
            appointments.c.notes,
            appointments.c.isAppointmentOffline,
            slots.c.date,
            slots.c.startTime,
            slots.c.endTime,
            users.c.name.label("patientName"),
        )
        .select_from(
            appointments.join(slots, slots.c.id == appointments.c.slotId)
            .join(patients, patients.c.id == appointments.c.patientId)
            .join(users, users.c.id == patients.c.userId)
        )
        .where(appointments.c.doctorId == doctor_id)
    )
    if status:
        stmt = stmt.where(appointments.c.status == status.upper())
    if start_day:
        start_utc = to_naive_utc(datetime.combine(start_day, time.min, tzinfo=clinic_zone()))
        stmt = stmt.where(slots.c.startTime >= start_utc)
    if end_day:
        end_utc = to_naive_utc(datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=clinic_zone()))
        stmt = stmt.where(slots.c.startTime < end_utc)

    rows = (await db.execute(stmt.order_by(slots.c.startTime.asc()).limit(50))).mappings().all()
    items = []
    for r in rows:
        local_start = to_clinic_time(r["startTime"])
        local_end = to_clinic_time(r["endTime"])
        items.append(
            {
                "appointmentId": r["id"],
                "patientId": r["patientId"],
                "patientName": r["patientName"],
                "slotId": r["slotId"],
                "status": r["status"],
                "paymentMethod": r["paymentMethod"],
                "isOffline": r["isAppointmentOffline"],
                "date": local_start.date().isoformat(),
                "startTime": local_start.strftime("%H:%M"),
                "endTime": local_end.strftime("%H:%M"),
                "notes": r["notes"],
            }
        )
    return {"type": "DOCTOR_APPOINTMENTS", "count": len(items), "appointments": items}


async def get_appointment_details(
    db: AsyncConnection,
    actor: dict[str, Any],
    appointment_id: str,
) -> dict[str, Any]:
    """Return full details for a single appointment owned by this doctor."""

    doctor_id = await _owned_doctor_id(db, actor)
    appointments = tables["Appointment"]
    slots = tables["Slot"]
    patients = tables["Patient"]
    users = tables["User"]

    row = (
        await db.execute(
            select(
                appointments.c.id,
                appointments.c.patientId,
                appointments.c.slotId,
                appointments.c.status,
                appointments.c.paymentMethod,
                appointments.c.notes,
                appointments.c.bookedAt,
                appointments.c.isAppointmentOffline,
                slots.c.startTime,
                slots.c.endTime,
                users.c.name.label("patientName"),
                users.c.age.label("patientAge"),
                users.c.gender.label("patientGender"),
            )
            .select_from(
                appointments.join(slots, slots.c.id == appointments.c.slotId)
                .join(patients, patients.c.id == appointments.c.patientId)
                .join(users, users.c.id == patients.c.userId)
            )
            .where(appointments.c.id == appointment_id, appointments.c.doctorId == doctor_id)
        )
    ).mappings().first()

    if row is None:
        raise HTTPException(404, "Appointment not found")

    local_start = to_clinic_time(row["startTime"])
    local_end = to_clinic_time(row["endTime"])
    return {
        "type": "APPOINTMENT_DETAILS",
        "appointment": {
            "appointmentId": row["id"],
            "patientId": row["patientId"],
            "patientName": row["patientName"],
            "patientAge": row["patientAge"],
            "patientGender": row["patientGender"],
            "slotId": row["slotId"],
            "status": row["status"],
            "paymentMethod": row["paymentMethod"],
            "isOffline": row["isAppointmentOffline"],
            "date": local_start.date().isoformat(),
            "startTime": local_start.strftime("%H:%M"),
            "endTime": local_end.strftime("%H:%M"),
            "notes": row["notes"],
            "bookedAt": row["bookedAt"].isoformat() if row["bookedAt"] else None,
        },
    }
