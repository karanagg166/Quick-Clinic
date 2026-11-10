"""Serialized slot generation and safe editing of public clinic availability."""

import json
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import new_id, tables, utcnow
from app.features.doctors.repository import owned_doctor
from .validation import aware, local_time, parse_date, time_minutes

(doctors_table, slots_table, schedules_table, leaves_table, appointments_table) = (
    tables[name] for name in ("Doctor", "Slot", "Schedule", "Leave", "Appointment")
)


async def daily_slots(db, doctor_id, day, generate=True):
    users_table = tables["User"]
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
    now = utcnow()
    stmt = (
        select(slots_table)
        .where(slots_table.c.doctorId == doctor_id, slots_table.c.date == day)
        .order_by(slots_table.c.startTime)
    )
    rows = (await db.execute(stmt)).mappings().all()
    generated = False
    if not rows and generate:
        # Lock doctor row during explicit materialization to prevent concurrent race
        await db.execute(select(doctors_table.c.id).where(doctors_table.c.id == doctor_id).with_for_update())
        # Recheck after acquiring lock
        rows = (await db.execute(stmt)).mappings().all()
        if not rows:
            row = (
                (await db.execute(select(schedules_table).where(schedules_table.c.doctorId == doctor_id)))
                .mappings()
                .first()
            )
            if not row:
                raise HTTPException(404, "Doctor schedule does not exist")
            weekly = row["weeklySchedule"]
            if isinstance(weekly, str):
                weekly = json.loads(weekly)
            if isinstance(weekly, dict):
                weekly = weekly.get("weeklySchedule", [])
            day_schedule = next(
                (item for item in weekly if item["day"].lower() == day.strftime("%A").lower()), None
            )
            list_leaves = (
                (await db.execute(select(leaves_table).where(leaves_table.c.doctorId == doctor_id)))
                .mappings()
                .all()
            )
            if day_schedule:
                for interval in day_schedule.get("slots", []):
                    (start_min, end_min) = (time_minutes(interval["start"]), time_minutes(interval["end"]))
                    for minute in range(start_min, end_min - 9, 10):
                        start = local_time(day.isoformat(), f"{minute // 60:02d}:{minute % 60:02d}")
                        end = start + timedelta(minutes=10)
                        on_leave = any(
                            (
                                start < aware(leave["endDate"]) and end > aware(leave["startDate"])
                                for leave in list_leaves
                            )
                        )
                        await db.execute(
                            insert(slots_table).values(
                                id=new_id(),
                                doctorId=doctor_id,
                                date=day,
                                startTime=start,
                                endTime=end,
                                status="ON_LEAVE" if on_leave else "AVAILABLE",
                            )
                        )
                        generated = True
            rows = (await db.execute(stmt)).mappings().all()
    result = []
    for row in rows:
        status = row["status"]
        if status == "HELD":
            expires_at = row["holdExpiresAt"]
            held_at = row["heldAt"]
            if (expires_at and expires_at <= now) or (
                not expires_at and held_at and held_at <= now - timedelta(minutes=10)
            ):
                status = "AVAILABLE"
        appt = (
            (
                await db.execute(
                    select(appointments_table)
                    .where(
                        appointments_table.c.slotId == row["id"], appointments_table.c.status != "CANCELLED"
                    )
                    .order_by(appointments_table.c.bookedAt.desc())
                    .limit(1)
                )
            )
            .mappings()
            .first()
        )
        if appt:
            status = "BOOKED" if appt["status"] in ("PENDING", "CONFIRMED") else "UNAVAILABLE"
        elif status == "AVAILABLE" and aware(row["startTime"]) < now:
            status = "UNAVAILABLE"
        result.append(
            {
                **{key: row[key] for key in ("id", "doctorId", "date", "startTime", "endTime")},
                "status": status,
                "heldByPatientId": None,
                "heldAt": None,
            }
        )
    return (result, generated)


async def create_ad_hoc_slot(doctor_id: str, body, user, db: AsyncConnection):
    await owned_doctor(db, doctor_id, user, lock=True)
    day = parse_date(body.get("date"))
    (start, end) = (
        local_time(day.isoformat(), body.get("startTime", "")),
        local_time(day.isoformat(), body.get("endTime", "")),
    )
    if start >= end:
        raise HTTPException(400, "Invalid time range")
    existing = (
        await db.execute(
            select(slots_table.c.id).where(
                slots_table.c.doctorId == doctor_id,
                slots_table.c.startTime < end,
                slots_table.c.endTime > start,
            )
        )
    ).first()
    leave = (
        await db.execute(
            select(leaves_table.c.id).where(
                leaves_table.c.doctorId == doctor_id,
                leaves_table.c.startDate < end,
                leaves_table.c.endDate > start,
            )
        )
    ).first()
    if existing or leave:
        raise HTTPException(409, "Time range overlaps an existing slot or leave")
    slot_id = new_id()
    await db.execute(
        insert(slots_table).values(
            id=slot_id, doctorId=doctor_id, date=day, startTime=start, endTime=end, status="AVAILABLE"
        )
    )
    return {
        "slot": dict(
            (await db.execute(select(slots_table).where(slots_table.c.id == slot_id))).mappings().one()
        )
    }


async def set_slot_availability(doctor_id: str, body, user, db: AsyncConnection):
    await owned_doctor(db, doctor_id, user, lock=True)
    status = body.get("status")
    ids = body.get("slotIds") or [body.get("slotId")]
    if (
        not isinstance(ids, list)
        or not ids
        or any((not isinstance(item, str) or not item for item in ids))
        or (status not in ("AVAILABLE", "UNAVAILABLE", "CANCELLED", "ON_LEAVE"))
    ):
        raise HTTPException(400, "slotId(s) and an editable status are required")
    rows = (
        (
            await db.execute(
                select(slots_table)
                .where(slots_table.c.id.in_(ids), slots_table.c.doctorId == doctor_id)
                .with_for_update()
            )
        )
        .mappings()
        .all()
    )
    if len(rows) != len(set(ids)):
        raise HTTPException(404, "Slot not found")
    if any((row["status"] in ("BOOKED", "HELD") for row in rows)):
        raise HTTPException(409, "Booked or held slots cannot be edited")
    if status == "AVAILABLE":
        for row in rows:
            if (
                await db.execute(
                    select(leaves_table.c.id).where(
                        leaves_table.c.doctorId == doctor_id,
                        leaves_table.c.startDate < row["endTime"],
                        leaves_table.c.endDate > row["startTime"],
                    )
                )
            ).first():
                raise HTTPException(409, "Slot overlaps doctor leave")
    await db.execute(
        update(slots_table)
        .where(slots_table.c.id.in_(ids), slots_table.c.doctorId == doctor_id)
        .values(status=status, updatedAt=utcnow())
    )
    if body.get("slotId"):
        return {
            "slot": dict(
                (await db.execute(select(slots_table).where(slots_table.c.id == body["slotId"])))
                .mappings()
                .one()
            )
        }
    return {"success": True, "count": len(rows)}


async def remove_available_slot(doctor_id: str, body, user, db: AsyncConnection):
    await owned_doctor(db, doctor_id, user, lock=True)
    slot_id = body.get("slotId")
    row = (
        (
            await db.execute(
                select(slots_table)
                .where(slots_table.c.id == slot_id, slots_table.c.doctorId == doctor_id)
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(404, "Slot not found")
    if (
        row["status"] != "AVAILABLE"
        or (
            await db.execute(select(appointments_table.c.id).where(appointments_table.c.slotId == slot_id))
        ).first()
    ):
        raise HTTPException(409, "Only unused AVAILABLE slots can be deleted")
    await db.execute(delete(slots_table).where(slots_table.c.id == slot_id))
    return {"ok": True}
