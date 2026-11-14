
"""Authorized, read-only doctor slot queries."""

from datetime import date, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.clock import to_clinic_time
from app.features.booking.appointments import list_appointments
from app.features.doctors.repository import owned_doctor
from app.infrastructure.database import tables

from app.features.ai_agent.security.permissions import require_permission
from app.features.ai_agent.security.policies import audit_agent_action

from .availability import daily_slots


MAX_RESULTS = 40


def _local_time(value: datetime) -> str:
    return to_clinic_time(value).isoformat()


async def _get_owned_doctor_id(
    db: AsyncConnection,
    actor: dict[str, Any],
    permission: str,
) -> str:
    """Resolve the doctor from the authenticated account."""

    require_permission(actor, permission)

    if actor["role"] != "DOCTOR":
        raise HTTPException(
            status_code=403,
            detail="Doctor access required",
        )

    doctor_table = tables["Doctor"]

    doctor_id = (
        await db.execute(
            select(doctor_table.c.id).where(
                doctor_table.c.userId == actor["id"],
                doctor_table.c.isReleaseFixture.is_(False),
            )
        )
    ).scalar_one_or_none()

    if doctor_id is None:
        raise HTTPException(
            status_code=404,
            detail="Doctor profile not found",
        )

    await owned_doctor(db, doctor_id, actor)

    return doctor_id


async def get_my_free_slots(
    db: AsyncConnection,
    actor: dict[str, Any],
    day: date,
) -> dict[str, Any]:
    """Return only available, unbooked slots."""

    doctor_id = await _get_owned_doctor_id(
        db,
        actor,
        "get_available_slots",
    )

    slots, _ = await daily_slots(
        db,
        doctor_id,
        day,
        generate=False,
    )

    free_slots = [
        slot
        for slot in slots
        if slot["status"] == "AVAILABLE"
    ]

    await audit_agent_action(
        db,
        actor["id"],
        "CHECK_AVAILABILITY",
        {
            "doctorId": doctor_id,
            "date": day.isoformat(),
            "count": len(free_slots),
        },
    )

    return {
        "date": day.isoformat(),
        "timezone": "Asia/Kolkata",
        "type": "FREE_SLOTS",
        "total_free": len(free_slots),
        "materialized_slot_count": len(slots),
        "truncated": len(free_slots) > MAX_RESULTS,
        "slots": [
            {
                "slot_id": slot["id"],
                "start_time": _local_time(slot["startTime"]),
                "end_time": _local_time(slot["endTime"]),
            }
            for slot in free_slots[:MAX_RESULTS]
        ],
        "note": (
            "No slots have been materialized for this date; "
            "the weekly schedule may still define availability."
            if not slots
            else (
                "Materialized slots exist for this date, but zero are currently free "
                "(remaining slots are booked, held, or unavailable)."
                if not free_slots
                else "Free slots remain open for patient booking."
            )
        ),
    }


async def get_my_consultation_slots(
    db: AsyncConnection,
    actor: dict[str, Any],
    day: date,
) -> dict[str, Any]:
    """Return confirmed patient consultation appointments."""

    doctor_id = await _get_owned_doctor_id(
        db,
        actor,
        "doctor_appointments",
    )

    appointments = await list_appointments(
        db,
        {
            "date": day.isoformat(),
            "status": "CONFIRMED",
        },
        "Doctor",
        doctor_id,
    )

    await audit_agent_action(
        db,
        actor["id"],
        "GET_CONSULTATION_SLOTS",
        {
            "doctorId": doctor_id,
            "date": day.isoformat(),
            "count": len(appointments),
        },
    )

    return {
        "date": day.isoformat(),
        "timezone": "Asia/Kolkata",
        "type": "CONSULTATION_SLOTS",
        "total_confirmed": len(appointments),
        "truncated": len(appointments) > MAX_RESULTS,
        "appointments": [
            {
                "appointment_id": appointment["id"],
                "status": appointment["status"],
                "start_time": _local_time(
                    appointment["appointmentTime"]
                ),
            }
            for appointment in appointments[:MAX_RESULTS]
        ],
    }
