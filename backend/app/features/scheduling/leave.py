"""Leave transitions cancel appointments and reserve refunds in one database transaction."""

from fastapi import HTTPException
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import new_id, tables, utcnow
from app.features.doctors.repository import owned_doctor
from .validation import aware, parse_datetime

(doctors_table, slots_table, schedules_table, leaves_table, appointments_table) = (
    tables[name] for name in ("Doctor", "Slot", "Schedule", "Leave", "Appointment")
)


async def apply_leave(db, doctor_id, start, end, reason):
    from app.features.booking.service import persist_side_effects
    from app.features.payments.refunds import enqueue_refund

    appointments = (
        (
            await db.execute(
                select(appointments_table)
                .join(slots_table, appointments_table.c.slotId == slots_table.c.id)
                .where(
                    appointments_table.c.doctorId == doctor_id,
                    appointments_table.c.status.in_(["PENDING", "CONFIRMED"]),
                    slots_table.c.startTime < end,
                    slots_table.c.endTime > start,
                )
                .with_for_update()
            )
        )
        .mappings()
        .all()
    )
    for appt in appointments:
        await db.execute(
            update(appointments_table)
            .where(appointments_table.c.id == appt["id"])
            .values(status="CANCELLED", updatedAt=utcnow())
        )
        if appt["paymentMethod"] == "ONLINE":
            payment_table = tables["Payment"]
            payment = (
                (
                    await db.execute(
                        select(payment_table).where(payment_table.c.id == appt["paymentId"]).with_for_update()
                    )
                )
                .mappings()
                .first()
            )
            if payment:
                await enqueue_refund(db, dict(payment), f"Doctor leave: {reason}")
        await persist_side_effects(db, dict(appt), status="CANCELLED")
    await db.execute(
        update(slots_table)
        .where(
            slots_table.c.doctorId == doctor_id,
            slots_table.c.startTime < end,
            slots_table.c.endTime > start,
            slots_table.c.status.in_(["AVAILABLE", "HELD", "BOOKED"]),
        )
        .values(
            status="ON_LEAVE",
            holdToken=None,
            holdExpiresAt=None,
            heldByPatientId=None,
            heldAt=None,
            updatedAt=utcnow(),
        )
    )
    return len(appointments)


async def restore_leave(db, doctor_id):
    rows = (
        (
            await db.execute(
                select(slots_table).where(
                    slots_table.c.doctorId == doctor_id, slots_table.c.status == "ON_LEAVE"
                )
            )
        )
        .mappings()
        .all()
    )
    list_leaves = (
        (await db.execute(select(leaves_table).where(leaves_table.c.doctorId == doctor_id))).mappings().all()
    )
    for row in rows:
        if not any(
            (
                aware(row["startTime"]) < aware(leave["endDate"])
                and aware(row["endTime"]) > aware(leave["startDate"])
                for leave in list_leaves
            )
        ):
            booked = (
                await db.execute(
                    select(appointments_table.c.id).where(
                        appointments_table.c.slotId == row["id"],
                        appointments_table.c.status.in_(["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"]),
                    )
                )
            ).first()
            if not booked:
                await db.execute(
                    update(slots_table)
                    .where(slots_table.c.id == row["id"])
                    .values(status="AVAILABLE", updatedAt=utcnow())
                )


async def list_leaves(doctor_id: str, filters, user, db: AsyncConnection):
    await owned_doctor(db, doctor_id, user)
    stmt = select(leaves_table).where(leaves_table.c.doctorId == doctor_id)
    for key in ("startDate", "endDate"):
        if filters.get(key):
            value = parse_datetime(filters[key])
            stmt = stmt.where(
                leaves_table.c.startDate >= value if key == "startDate" else leaves_table.c.endDate <= value
            )
    if filters.get("reason"):
        stmt = stmt.where(leaves_table.c.reason.ilike("%" + filters["reason"] + "%"))
    return {
        "leaves": [
            dict(row) for row in (await db.execute(stmt.order_by(leaves_table.c.startDate.desc()))).mappings()
        ]
    }


async def upsert_leave(doctor_id: str, body, method, user, db: AsyncConnection):
    await owned_doctor(db, doctor_id, user, lock=True)
    existing = None
    if method == "PATCH":
        existing = (
            (
                await db.execute(
                    select(leaves_table).where(
                        leaves_table.c.id == body.get("leaveId"), leaves_table.c.doctorId == doctor_id
                    )
                )
            )
            .mappings()
            .first()
        )
        if not existing:
            raise HTTPException(404, "Leave not found")
    start = parse_datetime(
        body.get("newStartDate" if existing else "startDate")
        or (existing["startDate"].isoformat() if existing else None)
    )
    end = parse_datetime(
        body.get("newEndDate" if existing else "endDate")
        or (existing["endDate"].isoformat() if existing else None)
    )
    reason = body.get("reason", existing["reason"] if existing else "")
    if not isinstance(reason, str) or not reason.strip() or start >= end or (end <= utcnow()):
        raise HTTPException(400, "A future, positive leave range and reason are required")
    leave_id = existing["id"] if existing else new_id()
    if (
        await db.execute(
            select(leaves_table.c.id).where(
                leaves_table.c.doctorId == doctor_id,
                leaves_table.c.id != leave_id,
                leaves_table.c.startDate < end,
                leaves_table.c.endDate > start,
            )
        )
    ).first():
        raise HTTPException(409, "Leave conflicts with another leave")
    values = dict(doctorId=doctor_id, startDate=start, endDate=end, reason=reason.strip())
    if existing:
        await db.execute(update(leaves_table).where(leaves_table.c.id == leave_id).values(**values))
        await restore_leave(db, doctor_id)
    else:
        await db.execute(insert(leaves_table).values(id=leave_id, **values))
    cancelled = await apply_leave(db, doctor_id, start, end, reason.strip())
    row = dict((await db.execute(select(leaves_table).where(leaves_table.c.id == leave_id))).mappings().one())
    return (
        {"ok": True, "leave": row, "message": "Leave updated. Freed slots have been restored."}
        if existing
        else {**row, "cancelledAppointments": cancelled}
    )


async def cancel_leave(doctor_id: str, leave_id: str, user, db: AsyncConnection):
    await owned_doctor(db, doctor_id, user, lock=True)
    leave = (
        (
            await db.execute(
                select(leaves_table).where(
                    leaves_table.c.id == leave_id, leaves_table.c.doctorId == doctor_id
                )
            )
        )
        .mappings()
        .first()
    )
    if not leave:
        raise HTTPException(404, "Leave not found")
    if aware(leave["endDate"]) <= utcnow():
        raise HTTPException(400, "Cannot cancel past leaves")
    await db.execute(delete(leaves_table).where(leaves_table.c.id == leave_id))
    await restore_leave(db, doctor_id)
    return {"ok": True, "message": "Leave cancelled and slots restored"}
