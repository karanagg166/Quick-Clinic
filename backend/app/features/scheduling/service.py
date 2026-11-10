"""Scheduling application-service boundary."""

from fastapi import HTTPException
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import new_id, tables, utcnow
from app.features.doctors.repository import owned_doctor
from .validation import validate_schedule
from .availability import daily_slots, create_ad_hoc_slot, set_slot_availability, remove_available_slot
from .leave import list_leaves, upsert_leave, cancel_leave
from .overview import get_schedule_overview
from .validation import parse_date, local_time
from .overview import day_metrics

(doctors_table, slots_table, schedules_table, leaves_table, appointments_table) = (
    tables[name] for name in ("Doctor", "Slot", "Schedule", "Leave", "Appointment")
)


async def get_schedule(doctor_id: str, db: AsyncConnection):
    row = (
        (await db.execute(select(schedules_table).where(schedules_table.c.doctorId == doctor_id)))
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(404, "No schedule found for this doctor")
    return dict(row)


async def upsert_schedule(doctor_id: str, body, user, db: AsyncConnection):
    await owned_doctor(db, doctor_id, user, lock=True)
    weekly = validate_schedule(body.get("weeklySchedule"))
    existing = (
        await db.execute(select(schedules_table.c.id).where(schedules_table.c.doctorId == doctor_id))
    ).scalar()
    if existing:
        await db.execute(
            update(schedules_table)
            .where(schedules_table.c.id == existing)
            .values(weeklySchedule=weekly, updatedAt=utcnow())
        )
    else:
        await db.execute(
            insert(schedules_table).values(id=new_id(), doctorId=doctor_id, weeklySchedule=weekly)
        )
    return await get_schedule(doctor_id, db)


__all__ = [
    "get_schedule",
    "upsert_schedule",
    "daily_slots",
    "create_ad_hoc_slot",
    "set_slot_availability",
    "remove_available_slot",
    "list_leaves",
    "upsert_leave",
    "cancel_leave",
    "get_schedule_overview",
    "parse_date",
    "validate_schedule",
    "local_time",
    "day_metrics",
]
